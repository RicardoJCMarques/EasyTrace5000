/*!
 * @file        operations/offset-operation-handler.js
 * @description Shared offset pipeline for all contour-based operations
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

/*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2025-2026 Eltryus
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

(function() {
    'use strict';

    const C = window.PCBCAMConfig.constants;
    const D = window.PCBCAMConfig.defaults;
    const PRECISION = C.precision.coordinate;

    /**
     * Owns the full topology-aware offset pipeline (boolean unions,
     * differences, arc reconstruction, simplification).
     * Subclasses override hook methods for operation-specific behavior.
     */
    class OffsetOperationHandler extends BaseOperationHandler {

        // HOOKS (override in subclasses)

        /**
         * Whether offsets grow inward (clearing) or outward (isolation).
         * Base implementation respects settings.cutSide for cutout/drill compatibility.
         */
        _isInternalOffset(operation, settings) {
            return settings.cutSide === 'inside';
        }

        /**
         * Whether tool follows the geometry line with zero offset.
         */
        _isOnLine(operation, settings) {
            return settings.cutSide === 'on';
        }

        /**
         * Whether to skip a primitive during offset generation.
         * Base skips drill holes/slots in CNC mode (laser processes everything).
         */
        _shouldSkipPrimitive(primitive, settings) {
            if (settings.clearStrategy !== undefined) return false;
            return primitive.properties?.role === 'drill_hole' ||
                   primitive.properties?.role === 'drill_slot';
        }

        /**
         * Whether KiCad cut-in resolution (union of filled regions) is needed.
         * Copper layers override to return true.
         */
        _needsCutInResolution() {
            return false;
        }

        /**
         * Returns the clearance zone for filled/hatch laser strategies.
         * Override in IsolationOperationHandler and ClearingOperationHandler.
         */
        async _getClearanceZone(operation, settings) {
            return null;
        }

        // MAIN OFFSET PIPELINE

        async generateGeometry(operation, settings) {
            // Clone to prevent mutating shared state
            settings = { ...settings };

            operation._debugStrokes = [];

            this.debug('=== OFFSET PIPELINE START ===');
            this.debug(`Operation: ${operation.id} (${operation.type})`);

            await this.core.ensureProcessorReady();
            if (!this.core.geometryOffsetter || !this.core.geometryProcessor) {
                throw new Error('Geometry processors not initialized');
            }
            if (!operation.primitives || operation.primitives.length === 0) {
                return [];
            }

            // Determine offset direction via hooks
            let isInternal = this._isInternalOffset(operation, settings);
            let isOnLine = this._isOnLine(operation, settings);

            // Calculate offset distances
            let offsetDistances;
            if (isOnLine) {
                offsetDistances = [0];
            } else {
                offsetDistances = this.core._calculateOffsetDistances(
                    settings.toolDiameter,
                    settings.passes,
                    settings.stepOver,
                    isInternal
                );
            }

            // Guard: prevent internal offsets from collapsing small circular features
            if (isInternal && offsetDistances.length > 0) {
                const circles = operation.primitives.filter(p => p.type === 'circle' && p.radius);
                if (circles.length > 0) {
                    const smallestFeature = Math.min(...circles.map(p => p.radius * 2));
                    const largestOffset = Math.max(...offsetDistances.map(d => Math.abs(d)));
                    if (smallestFeature > 0 && largestOffset >= smallestFeature / 2) {
                        this.debug(`Internal offset ${largestOffset.toFixed(3)}mm would collapse features (smallest: ${smallestFeature.toFixed(3)}mm). Falling back to on-line.`);
                        offsetDistances = [0];
                    }
                }
            }

            if (isOnLine) {
                offsetDistances = [0];
            }

            // Auto-cap internal offsets to prevent wasted WASM calls
            if (isInternal && offsetDistances.length > 1 && operation.bounds) {
                const smallestDim = Math.min(
                    operation.bounds.maxX - operation.bounds.minX,
                    operation.bounds.maxY - operation.bounds.minY
                );
                const maxInwardOffset = smallestDim / 2;
                const cappedDistances = offsetDistances.filter(d => Math.abs(d) <= maxInwardOffset);
                if (cappedDistances.length > 0 && cappedDistances.length < offsetDistances.length) {
                    this.debug(`Auto-capped internal offsets: ${offsetDistances.length} → ${cappedDistances.length} (smallest dim: ${smallestDim.toFixed(3)}mm)`);
                    offsetDistances = cappedDistances;
                }
            }

            // PRE-FUSION FOR CUT-IN RESOLUTION
            let primitivesToProcess = operation.primitives;

            if (this._needsCutInResolution()) {
                const resolvedPrimitives = [];
                for (const prim of primitivesToProcess) {
                    const isRegion = prim.type === 'path' && prim.properties?.fill &&
                                     !prim.properties?.stroke && !prim.properties?.isTrace &&
                                     !prim.properties?.isComposited;

                    if (isRegion) {
                        try {
                            const hasArcs = prim.contours?.some(c => c.arcSegments?.length > 0);
                            let primForClipper = prim;
                            if (hasArcs) {
                                const tessContours = prim.contours.map(c => GeometryUtils.contourArcsToPath(c));
                                primForClipper = new PathPrimitive(tessContours, { ...prim.properties });
                                if (prim.curveIds) primForClipper.curveIds = prim.curveIds;
                            }

                            let resolved = await this.core.geometryProcessor.unionGeometry([primForClipper]);

                            if (hasArcs && resolved && resolved.length > 0 && this.core.geometryProcessor?.arcReconstructor) {
                                resolved = this.core.geometryProcessor.arcReconstructor.processForReconstruction(resolved);
                            }

                            if (resolved && resolved.length > 0) {
                                resolved.forEach(r => Object.assign(r.properties || (r.properties = {}), prim.properties));
                                resolvedPrimitives.push(...resolved);
                            } else { resolvedPrimitives.push(prim); }
                        } catch (e) { resolvedPrimitives.push(prim); }
                    } else {
                        resolvedPrimitives.push(prim);
                    }
                }
                primitivesToProcess = resolvedPrimitives;
            }

            // TOPOLOGICAL CATEGORIZATION
            const levelBuckets = [];
            const complexRegions = [];
            const simpleGeometry = [];

            const isLaserPipeline = settings.clearStrategy !== undefined;

            primitivesToProcess.forEach(prim => {
                if (this._shouldSkipPrimitive(prim, settings)) return;

                if (prim.properties?.isComposited) {
                    if (prim.contours && prim.contours.length > 0) {
                        prim.contours.forEach(contour => {
                            const lvl = contour.nestingLevel || 0;
                            if (!levelBuckets[lvl]) levelBuckets[lvl] = [];
                            levelBuckets[lvl].push(new PathPrimitive([contour], { ...prim.properties }));
                        });
                    } else {
                        if (!levelBuckets[0]) levelBuckets[0] = [];
                        levelBuckets[0].push(prim);
                    }
                } else {
                    const isTraceOrPad = prim.properties?.isTrace || prim.properties?.isPad ||
                                         prim.properties?.isFlash || prim.properties?.stroke;

                    if (prim.type === 'path' && prim.contours && prim.contours.length > 0 && !isTraceOrPad) {
                        const hasHoles = prim.contours.some(c => c.isHole);
                        if (hasHoles) {
                            complexRegions.push(prim);
                        } else {
                            simpleGeometry.push(prim);
                        }
                    } else {
                        simpleGeometry.push(prim);
                    }
                }
            });

            // PER-PASS OFFSET GENERATION
            operation.offsets = [];
            const passResults = [];

            for (let passIndex = 0; passIndex < offsetDistances.length; passIndex++) {
                const distance = offsetDistances[passIndex];
                const offsetType = distance >= 0 ? 'external' : 'internal';

                this.debug(`--- PASS ${passIndex + 1}/${offsetDistances.length}: ${distance.toFixed(3)}mm (${offsetType}) ---`);

                const processGroup = async (group, dist) => {
                    const out = [];
                    for (const p of group) {
                        const res = await this.core.geometryOffsetter.offsetPrimitive(p, dist);
                        if (Array.isArray(res)) out.push(...res);
                        else if (res) out.push(res);
                    }
                    return out;
                };

                let shellPassGeometry = [];
                let holePassGeometry = [];

                if (levelBuckets.length > 0) {
                    // EAGLE LOGIC: Level-by-Level Recomposition
                    const offsetSimpleGeom = await processGroup(simpleGeometry, distance);

                    for (let lvl = 0; lvl < levelBuckets.length; lvl++) {
                        const bucket = levelBuckets[lvl];
                        if (!bucket || bucket.length === 0) continue;

                        const isHoleLevel = lvl % 2 === 1;
                        const dist = isHoleLevel ? -distance : distance;
                        const offsetBucket = await processGroup(bucket, dist);

                        if (offsetBucket.length === 0) continue;

                        if (lvl === 0) {
                            shellPassGeometry = await this.core.geometryProcessor.unionGeometry(offsetBucket);
                        } else if (isHoleLevel) {
                            const holeUnion = await this.core.geometryProcessor.unionGeometry(offsetBucket);
                            if (shellPassGeometry.length > 0) {
                                shellPassGeometry = await this.core.geometryProcessor.difference(shellPassGeometry, holeUnion);
                            }
                        } else {
                            const islandUnion = await this.core.geometryProcessor.unionGeometry(offsetBucket);
                            shellPassGeometry = await this.core.geometryProcessor.unionGeometry(shellPassGeometry.concat(islandUnion));
                        }
                    }

                    if (offsetSimpleGeom.length > 0) {
                        if (shellPassGeometry.length > 0) {
                            shellPassGeometry = await this.core.geometryProcessor.unionGeometry(shellPassGeometry.concat(offsetSimpleGeom));
                        } else {
                            shellPassGeometry = await this.core.geometryProcessor.unionGeometry(offsetSimpleGeom);
                        }
                    }
                } else {
                    // KICAD LOGIC: Per-Region Resolution
                    const offsetSimpleGeom = await processGroup(simpleGeometry, distance);
                    const resolvedOffsetRegions = [];

                    for (const regionPrim of complexRegions) {
                        const regionShells = [];
                        const regionHoles = [];

                        regionPrim.contours.forEach(contour => {
                            const simplePrim = new PathPrimitive([contour], { ...regionPrim.properties });
                            if (contour.isHole) regionHoles.push(simplePrim);
                            else regionShells.push(simplePrim);
                        });

                        const offsetShells = await processGroup(regionShells, distance);
                        const offsetHoles = await processGroup(regionHoles, -distance);

                        let regionResult = [];
                        if (offsetShells.length > 0) {
                            const shellUnion = await this.core.geometryProcessor.unionGeometry(offsetShells);
                            if (offsetHoles.length > 0) {
                                const holeUnion = await this.core.geometryProcessor.unionGeometry(offsetHoles);
                                regionResult = await this.core.geometryProcessor.difference(shellUnion, holeUnion);
                            } else {
                                regionResult = shellUnion;
                            }
                        }
                        if (regionResult.length > 0) {
                            resolvedOffsetRegions.push(...regionResult);
                        }
                    }

                    if (resolvedOffsetRegions.length > 0) {
                        if (offsetSimpleGeom.length > 0) {
                            shellPassGeometry = await this.core.geometryProcessor.unionGeometry(resolvedOffsetRegions.concat(offsetSimpleGeom));
                        } else {
                            shellPassGeometry = await this.core.geometryProcessor.unionGeometry(resolvedOffsetRegions);
                        }
                    } else if (offsetSimpleGeom.length > 0) {
                        shellPassGeometry = await this.core.geometryProcessor.unionGeometry(offsetSimpleGeom);
                    }
                }

                // POST-PROCESSING
                const processBucket = (geometryBucket, groupTag, actualDist) => {
                    if (geometryBucket.length === 0) return;

                    if (!settings.skipArcReconstruction && Math.abs(actualDist) >= PRECISION) {
                        geometryBucket = this.core.geometryProcessor.arcReconstructor.processForReconstruction(geometryBucket);
                    }
                    this.core.geometryOffsetter.simplifyOffsetResult(geometryBucket, Math.abs(actualDist));

                    const thermalGroup = actualDist < 0 ? 'internal' : 'external';

                    const reconstructedGeometry = geometryBucket.map(p => {
                        if (!p.properties) p.properties = {};
                        p.properties.isOffset = true;
                        p.properties.pass = passIndex + 1;
                        p.properties.offsetDistance = distance;
                        p.properties.offsetType = offsetType;
                        p.properties.thermalGroup = thermalGroup;
                        p.properties.hasAnalyticArcs = (p.type === 'circle') || (p.arcSegments && p.arcSegments.length > 0);
                        return p;
                    });

                    passResults.push({
                        distance: distance,
                        actualDistance: actualDist,
                        pass: passIndex + 1,
                        offsetType: offsetType,
                        thermalGroup: thermalGroup,
                        primitives: reconstructedGeometry,
                        metadata: {
                            sourceCount: primitivesToProcess.length,
                            finalCount: reconstructedGeometry.length,
                            generatedAt: Date.now(),
                            toolDiameter: settings.toolDiameter,
                            wasFused: primitivesToProcess !== operation.primitives,
                            thermalGroup: thermalGroup
                        }
                    });
                };

                processBucket(shellPassGeometry, 'shell', distance);
                processBucket(holePassGeometry, 'hole', -distance);
            }

            // COMBINE PASSES
            if (settings.combineOffsets && passResults.length > 1) {
                const allPassPrimitives = passResults.flatMap(p => p.primitives);
                operation.offsets = [{
                    id: `offset_combined_${operation.id}`,
                    distance: offsetDistances[0],
                    pass: 1,
                    primitives: allPassPrimitives,
                    type: 'offset',
                    metadata: {
                        sourceCount: primitivesToProcess.length,
                        finalCount: allPassPrimitives.length,
                        generatedAt: Date.now(),
                        toolDiameter: settings.toolDiameter,
                        offset: {
                            combined: true,
                            passes: passResults.length,
                            offsetCount: allPassPrimitives.length
                        }
                    },
                    settings: { ...settings }
                }];
            } else {
                operation.offsets = passResults.map((passResult, index) => ({
                    id: `offset_${operation.id}_${index}`,
                    ...passResult,
                    settings: { ...settings }
                }));
            }

            const totalPrimitives = operation.offsets.reduce((sum, o) => sum + o.primitives.length, 0);
            this.debug(`Generated ${operation.offsets.length} offset group(s), ${totalPrimitives} total primitives.`);
            this.debug(`=== OFFSET PIPELINE COMPLETE ===`);

            this.core.isToolpathCacheValid = false;
            return operation.offsets;
        }

        // LASER GEOMETRY

        async generateLaserGeometry(operation, settings) {
            this.debug(`=== LASER GEOMETRY GENERATION: ${settings.clearStrategy} ===`);

            const strategy = settings.clearStrategy || 'offset';

            if (strategy === 'offset') {
                await this.generateGeometry(operation, settings);
                this.core.isToolpathCacheValid = false;
                return operation.offsets;
            }

            // Filled/hatch strategies need a clearance zone
            let clearanceZone = operation.clearancePolygon;

            if (!clearanceZone || clearanceZone.length === 0) {
                clearanceZone = await this._getClearanceZone(operation, settings);
            }

            if (!clearanceZone || clearanceZone.length === 0) {
                this.debug('Clearance zone empty, falling back to offset strategy');
                await this.generateGeometry(operation, settings);
                return operation.offsets;
            }

            switch (strategy) {
                case 'filled': {
                    let filledGeometry = clearanceZone;
                    if (this.core.geometryProcessor?.arcReconstructor) {
                        filledGeometry = this.core.geometryProcessor.arcReconstructor
                            .processForReconstruction(clearanceZone);
                        this.debug(`Filled: reconstructed ${clearanceZone.length} → ${filledGeometry.length} primitives`);
                    }

                    operation.offsets = [{
                        distance: 0,
                        pass: 1,
                        type: 'filled',
                        primitives: filledGeometry,
                        metadata: {
                            strategy: 'filled',
                            isolationWidth: settings.isolationWidth || 0,
                            isBoardClearing: settings.isBoardClearing || false,
                            finalCount: filledGeometry.length
                        }
                    }];
                    break;
                }

                case 'hatch': {
                    if (typeof HatchGenerator !== 'undefined') {
                        operation.offsets = HatchGenerator.generate(clearanceZone, settings);
                        this.debug(`Hatch: generated ${operation.offsets.length} pass(es)`);
                    } else {
                        console.warn('[OffsetOperationHandler] HatchGenerator missing, falling back to offset.');
                        await this.generateGeometry(operation, settings);
                    }
                    break;
                }

                default:
                    this.debug(`Unknown laser strategy: ${strategy}, falling back to offset`);
                    await this.generateGeometry(operation, settings);
                    break;
            }

            this.core.isToolpathCacheValid = false;
            return operation.offsets;
        }

        // CLEARANCE POLYGON (shared helper for filled/hatch)

        async _generateClearancePolygon(operation, isolationWidth) {
            await this.core.ensureProcessorReady();

            if (!operation.primitives || operation.primitives.length === 0) return [];

            this.debug(`=== CLEARANCE POLYGON GENERATION: width=${isolationWidth.toFixed(3)}mm ===`);

            const savedOffsets = operation.offsets;

            try {
                await this.generateGeometry(operation, {
                    toolDiameter: isolationWidth * 2,
                    passes: 1,
                    stepOver: 0,
                    combineOffsets: true,
                    skipArcReconstruction: true
                });

                const expanded = operation.offsets.flatMap(o => o.primitives);

                if (expanded.length === 0) {
                    this.debug('Offset expansion produced no geometry');
                    return [];
                }

                const footprint = [];
                for (const prim of operation.primitives) {
                    const standardized = this.core.geometryProcessor.standardizePrimitive(prim, prim.curveIds || []);
                    if (!standardized) continue;
                    if (Array.isArray(standardized)) {
                        footprint.push(...standardized);
                    } else {
                        footprint.push(standardized);
                    }
                }

                if (footprint.length === 0) {
                    this.debug('Fusion produced no copper footprint');
                    return [];
                }

                this.debug(`Expanded boundary: ${expanded.length} primitive(s)`);
                this.debug(`Copper footprint: ${footprint.length} primitive(s)`);

                const clearanceZone = await this.core.geometryProcessor.difference(expanded, footprint);

                this.debug(`Clearance polygon: ${clearanceZone.length} polygon(s)`);
                this.debug(`=== CLEARANCE POLYGON COMPLETE ===`);

                operation.clearancePolygon = clearanceZone;
                return clearanceZone;

            } finally {
                operation.offsets = savedOffsets;
            }
        }
    }

    window.OffsetOperationHandler = OffsetOperationHandler;
})();