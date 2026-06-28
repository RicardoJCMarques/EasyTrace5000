/*!
 * @file        operations/shape-vcarve-handler.js
 * @description V-Carve operation handler - straight-skeleton 3D centerline paths.
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 *
 * SPDX-FileCopyrightText: 2025-2026 Eltryus - Ricardo Marques
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Not wired
(function() {
    'use strict';

    const C = window.CAMConfig.constants;
    const PRECISION = C.precision.coordinate;

    // ════════════════════════════════════════════════════════════════
    // TODO(re-wire): These belong in profile-shape.json "parameters"
    // (geometry stage, vcarve operationType) and should then flow in
    // through compileOperationParams / the parameter manager. Parked
    // here so the wiring is a single-file change later.
    // ════════════════════════════════════════════════════════════════
    const VCARVE_PARAM_DEFAULTS = {
        // RDP pre-simplification of source contours (mm). Controls
        // skeleton "spoke" density on tessellated curves. 0 = off.
        // Sensible UI range: 0 – 0.05, step 0.005.
        vcarveSimplifyTolerance: 0.01,

        // Drop output chains shorter than this (mm). 0 = keep everything.
        vcarveMinChainLength: 0,

        // Clamp Z at -vcarveMaxDepth. This is SAFETY clamping only -
        // flat-floor clearing (vcarveFlatDepth / vcarveClearingTool)
        // is deferred. Set false to pass maxDepth: null to the generator.
        vcarveClampToMaxDepth: true
    };

    class ShapeVCarveHandler extends BaseOperationHandler {

        // ════════════════════════════════════════════════════════════
        // Validation helpers
        // ════════════════════════════════════════════════════════════

        // TODO(refactor): duplicated from OffsetOperationHandler.
        // Both copies should move UP to BaseOperationHandler - it has no
        // offset-pipeline dependencies (pure GeometryUtils closure check).
        countOpenPaths(operation) {
            return (operation.primitives || []).filter(p => {
                if (p.type === 'circle' || p.type === 'rectangle' || p.type === 'obround') return false;
                return !GeometryUtils.isPrimitiveClosed(p, PRECISION);
            }).length;
        }

        // TODO(refactor): duplicated from OffsetOperationHandler.
        // Same situation as countOpenPaths - move both to
        // BaseOperationHandler in the same pass. V-Carve NEEDS this:
        // a letter "O" imported as two separate circles must become one
        // compound (outer + hole) or the inner circle gets carved as a
        // solid cone instead of bounding the ring.
        // REVIEW - DEPRECATED FROM offset-operation-handler because resolveContourTopology() now does all the heavy lifting. Rework when final operation is written.
        async detectAndMergeNesting(primitives) {
            if (!primitives || primitives.length < 2) return primitives;

            const loops = primitives.map(prim => {
                if (prim.type === 'path') return prim;
                const path = GeometryUtils.primitiveToPath(prim);
                if (path) {
                    path.properties = { ...prim.properties, ...path.properties };
                }
                return path || prim;
            }).filter(p => p && p.contours?.length > 0);

            if (loops.length < 2) return primitives;

            const topology = GeometryUtils.classifyCutoutTopology(loops);
            const hasNesting = topology.some(t => t.isHole);
            if (!hasNesting) return primitives;

            const compounds = GeometryUtils.assembleCutoutCompounds(topology);
            if (compounds.length > 0) {
                this.debug(`Nesting detected: ${primitives.length} shapes → ${compounds.length} compound(s)`);
                return compounds;
            }
            return primitives;
        }

        // Orchestration

        async orchestrateGeneration(operation, params, core, options = {}) {
            core.resetOperationState(operation.id);
            const opParams = core.compileOperationParams(operation, params);

            // V-Carve is strictly closed-region work
            const openCount = this.countOpenPaths(operation);
            if (openCount > 0) {
                return {
                    success: false,
                    message: `V-Carve requires closed paths - ${openCount} open path(s) in selection`,
                    status: 'warning'
                };
            }

            await this.generateGeometry(operation, { ...params, ...opParams });

            const total = operation.offsets?.reduce(
                (s, o) => s + (o.primitives?.length || 0), 0) || 0;

            if (total === 0) {
                return {
                    success: false,
                    message: 'No V-Carve paths generated - shapes may be degenerate or too small',
                    status: 'warning'
                };
            }

            return {
                success: true,
                message: `Generated ${total} V-Carve path(s)`,
                status: 'success'
            };
        }

        // Geometry generation

        async generateGeometry(operation, settings) {
            this.debug('=== V-CARVE PIPELINE START ===');
            this.debug(`Operation: ${operation.id} (${operation.type})`);

            if (!operation.primitives || operation.primitives.length === 0) {
                operation.offsets = [];
                return [];
            }
            if (typeof VCarveGenerator === 'undefined') {
                throw new Error('VCarveGenerator module missing (geometry-utils-vcarve.js not loaded)');
            }

            const vbitAngle = settings.vbitAngle || 90;
            const startDepth = Math.max(0, settings.vcarveStartDepth || 0);
            const maxDepth = VCARVE_PARAM_DEFAULTS.vcarveClampToMaxDepth
                ? Math.abs(settings.vcarveMaxDepth || 3)
                : null;

            // Merge separate-but-nested primitives into compounds with
            // proper hole flags. The generator requires one connected
            // region (outer + its holes) per call.
            const merged = await this.detectAndMergeNesting(operation.primitives);

            const generatorOptions = {
                vbitAngle,
                startDepth,
                maxDepth,
                simplifyTolerance: VCARVE_PARAM_DEFAULTS.vcarveSimplifyTolerance,
                minChainLength: VCARVE_PARAM_DEFAULTS.vcarveMinChainLength
            };
            this.debug('Generator options:', generatorOptions);

            const vcarvePrimitives = [];
            for (const prim of merged) {
                const paths = VCarveGenerator.generateVCarvePaths(prim, generatorOptions);
                vcarvePrimitives.push(...paths);
            }

            // Standard offsets container so renderer / preview / export
            // flow untouched. metadata.is3DToolpath flags the group;
            // each primitive also carries properties.is3DContour for the
            // per-primitive dispatch in GeometryTranslator.
            operation.offsets = [{
                id: `vcarve_${operation.id}`,
                distance: 0,
                pass: 1,
                type: 'vcarve',
                primitives: vcarvePrimitives,
                metadata: {
                    generatedAt: Date.now(),
                    sourceCount: merged.length,
                    finalCount: vcarvePrimitives.length,
                    toolDiameter: settings.toolDiameter,   // V-bit TIP diameter (preview + tool selection)
                    vbitAngle,
                    startDepth,
                    maxDepth,
                    is3DToolpath: true
                },
                settings: { ...settings }
            }];

            this.debug(`Generated ${vcarvePrimitives.length} 3D path primitive(s)`);
            this.debug('=== V-CARVE PIPELINE COMPLETE ===');
            return operation.offsets;
        }
    }

    window.ShapeVCarveHandler = ShapeVCarveHandler;
})();