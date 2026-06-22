/*!
 * @file        operations/shape-relief-handler.js
 * @description Relief / 2.5D-mold operation handler — heightmap-driven
 *              3D surfacing (roughing + finishing rasters). Not Wired.
 *
 *              Mirrors ShapeVCarveHandler: parameters are parked in a
 *              module const until the profile-shape.json wiring pass,
 *              geometry lands in the standard operation.offsets[]
 *              container with is3DToolpath metadata, and every output
 *              primitive carries properties.is3DContour so the shared
 *              3D pipeline (translate3DContour → optimizer guards →
 *              MachineProcessor 3D macro) handles it with zero
 *              relief-specific downstream code.
 *
 *              The heightmap is sliced ON DEMAND from the operation's
 *              mesh (operation.reliefMesh) at every generation, so
 *              resolution/orientation parameter changes always take
 *              effect. An image-sourced heightmap (HeightmapPrimitive
 *              already in operation.primitives) is used as-is.
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

    // ════════════════════════════════════════════════════════════════
    // TODO(re-wire): These belong in profile-shape.json "parameters"
    // (geometry stage, relief operationType) and should then flow in
    // through compileOperationParams / the parameter manager. Parked
    // here so the wiring is a single-file change later — same pattern
    // as VCARVE_PARAM_DEFAULTS.
    // ════════════════════════════════════════════════════════════════
    const RELIEF_PARAM_DEFAULTS = {
        // Depth mapping
        reliefDepth: 5,            // total carve depth (mm). UI: 0.5 – stock thickness
        reliefStartDepth: 0,       // surface offset below Z0 (mm)
        reliefInvert: false,       // true = mold (high model → deep cut)

        // Slicing (heightmap resolution)
        // cellSize 0 = auto: longest model axis / gridMaxDim.
        reliefCellSize: 0,         // mm per grid cell. UI: 0 (auto) – 1.0
        reliefGridMaxDim: 1024,    // grid cap when cellSize is auto

        // Tool
        // toolDiameter comes from the operation's tool selection.
        reliefToolShape: 'ball',   // 'ball' | 'flat'

        // Roughing
        reliefRoughing: true,
        reliefRoughStepdown: 1.5,  // mm per layer
        reliefRoughStepoverPct: 45,// % of tool diameter
        reliefRoughStock: 0.3,     // mm left for finishing

        // Finishing
        reliefFinishStepoverPct: 10, // % of tool diameter
        reliefCrossFinish: false,    // 90° second finishing pass
        reliefRasterAxis: 'x',       // 'x' | 'y'

        // Output density 
        // 3D Douglas-Peucker tolerance (mm). The pipeline's 2D
        // simplifier is gated off for 3D plans, so this is the ONLY
        // thing keeping G-code size sane. 0 = off (one point per cell).
        reliefSimplifyTolerance: 0.01,
        reliefMinSegmentLength: 0.2  // drop roughing slivers (mm)
    };

    class ShapeReliefHandler extends BaseOperationHandler {

        // Orchestration

        async orchestrateGeneration(operation, params, core, options = {}) {
            core.resetOperationState(operation.id);
            const opParams = core.compileOperationParams(operation, params);

            if (!this.getHeightmapSource(operation)) {
                return {
                    success: false,
                    message: 'No relief source — import an STL model or heightmap image for this operation',
                    status: 'warning'
                };
            }

            await this.generateGeometry(operation, { ...params, ...opParams });

            const total = operation.offsets?.reduce(
                (s, o) => s + (o.primitives?.length || 0), 0) || 0;

            if (total === 0) {
                return {
                    success: false,
                    message: 'No relief paths generated — model may be flat or below resolution',
                    status: 'warning'
                };
            }

            const passes = operation.offsets.map(o => o.type).join(' + ');
            return {
                success: true,
                message: `Generated ${total} relief path(s) [${passes}]`,
                status: 'success'
            };
        }

        // Source resolution & on-demand slicing

        /** Returns whatever relief source the operation carries, or null. */
        getHeightmapSource(operation) {
            const existing = (operation.primitives || [])
                .find(p => p.type === 'heightmap');
            if (existing) return existing;
            if (operation.reliefMesh?.triangles?.length) return operation.reliefMesh;
            return null;
        }

        /**
         * Resolves a HeightmapPrimitive, slicing the mesh on demand so
         * the grid always reflects the current resolution parameters.
         * Image-sourced heightmaps (already a primitive) pass through.
         */
        resolveHeightmap(operation, settings) {
            const meshSource = operation.reliefMesh;
            if (meshSource?.triangles?.length) {
                const hm = HeightmapBuilder.fromMesh(meshSource.triangles, {
                    cellSize: settings.reliefCellSize > 0 ? settings.reliefCellSize : null,
                    gridMaxDim: settings.reliefGridMaxDim
                });
                const prim = new HeightmapPrimitive(hm);
                // Cache for rendering/bounds; replaced on every generation
                operation.primitives = [prim];
                operation.bounds = prim.getBounds();
                return prim;
            }
            return (operation.primitives || []).find(p => p.type === 'heightmap') || null;
        }

        // Geometry generation

        async generateGeometry(operation, settings) {
            this.debug('=== RELIEF PIPELINE START ===');
            this.debug(`Operation: ${operation.id} (${operation.type})`);

            if (typeof ReliefGenerator === 'undefined') {
                throw new Error('ReliefGenerator module missing (geometry-utils-relief.js not loaded)');
            }
            if (typeof HeightmapBuilder === 'undefined') {
                throw new Error('HeightmapBuilder module missing (geometry-utils-heightmap.js not loaded)');
            }

            // Merge parked defaults under any already-wired params
            const p = { ...RELIEF_PARAM_DEFAULTS, ...settings };

            const heightmapPrim = this.resolveHeightmap(operation, p);
            if (!heightmapPrim) {
                operation.offsets = [];
                return [];
            }

            const toolDiameter = p.toolDiameter || 3;
            const generatorOptions = {
                toolDiameter,
                toolShape: p.reliefToolShape,
                reliefDepth: p.reliefDepth,
                startDepth: p.reliefStartDepth,
                invert: p.reliefInvert,
                roughing: p.reliefRoughing,
                roughStepdown: p.reliefRoughStepdown,
                roughStepover: toolDiameter * (p.reliefRoughStepoverPct / 100),
                roughStock: p.reliefRoughStock,
                finishStepover: toolDiameter * (p.reliefFinishStepoverPct / 100),
                crossFinish: p.reliefCrossFinish,
                rasterAxis: p.reliefRasterAxis,
                simplifyTolerance: p.reliefSimplifyTolerance,
                minSegmentLength: p.reliefMinSegmentLength
            };
            this.debug('Generator options:', generatorOptions);

            const allPrimitives = ReliefGenerator.generateReliefPaths(heightmapPrim, generatorOptions);

            const roughing = allPrimitives.filter(pr => pr.properties?.reliefPass === 'roughing');
            const finishing = allPrimitives.filter(pr => pr.properties?.reliefPass !== 'roughing');

            // Two offset groups so the UI can toggle/delete roughing and
            // finishing independently. Both flagged is3DToolpath; every
            // primitive carries is3DContour for per-primitive dispatch
            // in GeometryTranslator — same contract as V-Carve.
            const sharedMeta = {
                generatedAt: Date.now(),
                toolDiameter,
                toolShape: p.reliefToolShape,
                reliefDepth: p.reliefDepth,
                startDepth: p.reliefStartDepth,
                gridCols: heightmapPrim.heightmap.cols,
                gridRows: heightmapPrim.heightmap.rows,
                cellSize: heightmapPrim.heightmap.cellSize,
                is3DToolpath: true
            };

            const offsets = [];
            if (roughing.length > 0) {
                offsets.push({
                    id: `relief_rough_${operation.id}`,
                    distance: 0,
                    pass: 1,
                    type: 'relief-roughing',
                    primitives: roughing,
                    metadata: { ...sharedMeta, finalCount: roughing.length },
                    settings: { ...settings }
                });
            }
            if (finishing.length > 0) {
                offsets.push({
                    id: `relief_finish_${operation.id}`,
                    distance: 0,
                    pass: offsets.length + 1,
                    type: 'relief-finishing',
                    primitives: finishing,
                    metadata: { ...sharedMeta, finalCount: finishing.length },
                    settings: { ...settings }
                });
            }
            operation.offsets = offsets;

            this.debug(`Generated ${roughing.length} roughing + ${finishing.length} finishing primitive(s)`);
            this.debug('=== RELIEF PIPELINE COMPLETE ===');
            return operation.offsets;
        }
    }

    window.ShapeReliefHandler = ShapeReliefHandler;
})();
