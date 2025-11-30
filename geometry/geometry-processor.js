/**
 * @file        geometry/geometry-processor.js
 * @description Processes geometric boolean operations
 * @author      Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

/*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2025 Eltryus
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

    const config = window.PCBCAMConfig;
    const geomConfig = config.geometry;
    const debugConfig = config.debug;

    class GeometryProcessor {
        constructor(options = {}) {
            this.options = {
                scale: options.scale || geomConfig.clipperScale,
                preserveOriginals: options.preserveOriginals !== undefined ? options.preserveOriginals : true,
                ...options
            };

            // Initialize sub-modules
            this.clipper = new ClipperWrapper({
                scale: this.options.scale,
            });

            this.arcReconstructor = new ArcReconstructor({
                scale: this.options.scale
            });

            // State caching
            this.cachedStates = {
                originalPrimitives: null,
                preprocessedGeometry: null,
                fusedGeometry: null,
                registeredCurves: null
            };

            // Statistics
            this.stats = {
                fusionOperations: 0,
                primitivesProcessed: 0,
                primitivesReduced: 0,
                strokesConverted: 0,
                holesDetected: 0,
                curvesRegistered: 0,
                curvesReconstructed: 0,
                unionOperations: 0
            };

            // Initialize promise
            this.initPromise = this.initialize();
        }

        async initialize() {
            try {
                await this.clipper.initialize();
                
                this.debug('Initialized with arc reconstruction pipeline');
                return true;
            } catch (error) {
                console.error('[GeometryProcessor] Failed to initialize:', error);
                return false;
            }
        }

        // Main fusion pipeline with arc reconstruction
        async fuseGeometry(primitives, options = {}) {
            this.debug('Entered fuseGeometry(). Received options:', options);

            await this.ensureInitialized();

            if (!primitives || primitives.length === 0) return [];

            const fusionOptions = {
                enableArcReconstruction: options.enableArcReconstruction || false,
                ...options
            };

            this.debug(`=== FUSION PIPELINE START ===`);
            this.debug(`Input: ${primitives.length} primitives`);
            this.debug(`Arc reconstruction: ${fusionOptions.enableArcReconstruction ? 'Enabled' : 'Disabled'}`);

            // Cache originals with indices
            primitives.forEach((p, idx) => {
                p._originalIndex = idx;
            });
            this.cachedStates.originalPrimitives = primitives;

            // Count registered curves from global registry
            if (fusionOptions.enableArcReconstruction && window.globalCurveRegistry) {
                const registryStats = window.globalCurveRegistry.getStats();
                this.stats.curvesRegistered = registryStats.registrySize;

                this.debug(`Global registry has ${registryStats.registrySize} curves`);
                this.debug(`  Circles: ${registryStats.circles}`);
                this.debug(`  Arcs: ${registryStats.arcs}`);
                this.debug(`  End caps: ${registryStats.endCaps}`);
            }

            // Preprocess primitives (convert to polygons with metadata)
            const preprocessed = this._preprocessPrimitives(
                this.cachedStates.originalPrimitives
            );

            // Accumulate preprocessed geometry, don't replace it
            if (!this.cachedStates.preprocessedGeometry) {
                this.cachedStates.preprocessedGeometry = [];
            }
            this.cachedStates.preprocessedGeometry.push(...preprocessed);

            // Verify metadata propagation
            if (fusionOptions.enableArcReconstruction && debugConfig.enabled) {
                this.verifyMetadataPropagation(preprocessed, 'After preprocessing');
            }

            // Perform boolean fusion
            const fused = await this._performFusion(preprocessed);

            // Verify metadata survival
            if (fusionOptions.enableArcReconstruction && debugConfig.enabled) {
            this.verifyMetadataPropagation(fused, 'After fusion');
        }

        // Reconstruct arcs if enabled, otherwise use the fused geometry directly.
        let finalGeometry; // Initialize as undefined.

        this.debug('About to check if (fusionOptions.enableArcReconstruction).');
        if (fusionOptions.enableArcReconstruction) {
            this.debug(`=== RECONSTRUCTION PHASE ===`);
            this.debug('Received options:', options);

            const preReconstructionCount = fused.length;

            // The reconstructor is now the single source of truth for the final geometry.
            finalGeometry = this.arcReconstructor.processForReconstruction(fused);

            const stats = this.arcReconstructor.getStats();
            this.stats.curvesReconstructed = stats.reconstructed;

            this.debug(`Reconstruction complete:`);
            this.debug(`  Primitives: ${preReconstructionCount} → ${finalGeometry.length}`);
            this.debug(`  Full circles reconstructed: ${stats.fullCircles}`);
            this.debug(`  Partial arcs found: ${stats.partialArcs}`);
            this.debug(`  Groups with gaps merged: ${stats.wrappedGroups}`);

            if (debugConfig.enabled) {
                this.verifyReconstructionResults(finalGeometry);
            }
            this.debug('Exiting arc reconstruction block. Result count:', finalGeometry.length);

        } else {
            // If reconstruction is disabled, the fused geometry is the final geometry.
            this.debug('Arc reconstruction is Disabled, skipping block.');
            finalGeometry = fused;
        }

        this.cachedStates.fusedGeometry = finalGeometry;

        // Update statistics
        this.stats.fusionOperations++;
        this.stats.primitivesProcessed += primitives.length;
        this.stats.primitivesReduced = primitives.length - finalGeometry.length;

        this.debug(`=== FUSION PIPELINE COMPLETE ===`);
        this.debug(`Result: ${primitives.length} → ${finalGeometry.length} primitives`);

        return finalGeometry;
    }

        // Union geometry for offset pass merging
        async unionGeometry(primitives, options = {}) {
            await this.ensureInitialized();

            if (!primitives || primitives.length === 0) return [];

            this.debug(`=== UNION OPERATION START ===`);
            this.debug(`Input: ${primitives.length} primitives`);

            // Ensure all primitives have dark polarity for union
            const darkPrimitives = primitives.map(p => {
                const copy = { ...p };
                if (!copy.properties) copy.properties = {};
                copy.properties.polarity = 'dark';
                return copy;
            });

            try {
                // Use Clipper union operation
                const result = await this.clipper.union(darkPrimitives);

                // Count holes in result
                let holesFound = 0;
                result.forEach(p => {
                    if (p.contours && p.contours.length > 0) {
                        // Count all contours that are marked as holes
                        holesFound += p.contours.filter(c => c.isHole).length;
                    }
                });

                if (holesFound > 0) {
                    this.debug(`Union preserved ${holesFound} holes`);
                }

                // Update statistics
                this.stats.unionOperations++;

                this.debug(`=== UNION OPERATION COMPLETE ===`);
                this.debug(`Result: ${primitives.length} → ${result.length} primitives`);

                // Ensure proper primitive structure
                return result.map(p => {
                    if (typeof PathPrimitive !== 'undefined' && !(p instanceof PathPrimitive)) {
                        const contour = {
                            points: result.points,
                            isHole: false,
                            nestingLevel: 0,
                            parentId: null,
                            arcSegments: result.arcSegments,
                            curveIds: result.curveIds
                        };

                        return this._createPathPrimitive([contour], {
                            ...p.properties,
                            hasReconstructableCurves: p.hasReconstructableCurves
                        });
                    }
                    return p;
                });

            } catch (error) {
                console.error('Union operation failed:', error);
                throw error;
            }
        }

        // Difference geometry for hole cutting
        async difference(subjectPrimitives, clipPrimitives) {
            await this.ensureInitialized();

            if (!subjectPrimitives || subjectPrimitives.length === 0) {
                return []; // Nothing to subtract from
            }
            if (!clipPrimitives || clipPrimitives.length === 0) {
                return subjectPrimitives; // Nothing to subtract
            }

            this.debug(`=== DIFFERENCE OPERATION START ===`);
            this.debug(`Input: ${subjectPrimitives.length} subjects, ${clipPrimitives.length} clips`);

            try {
                // Use Clipper difference operation
                const result = await this.clipper.difference(subjectPrimitives, clipPrimitives);

                this.debug(`=== DIFFERENCE OPERATION COMPLETE ===`);
                this.debug(`Result: ${result.length} primitives`);

                // Ensure proper primitive structure
                return result.map(p => {
                    if (typeof PathPrimitive !== 'undefined' && !(p instanceof PathPrimitive)) {
                        const contour = {
                            points: result.points,
                            isHole: false,
                            nestingLevel: 0,
                            parentId: null,
                            arcSegments: result.arcSegments,
                            curveIds: result.curveIds
                        };

                        return this._createPathPrimitive([contour], {
                            ...p.properties,
                            contours: p.contours || [],
                            curveIds: p.curveIds,
                            hasReconstructableCurves: p.hasReconstructableCurves
                        });
                    }
                    return p;
                });

            } catch (error) {
                console.error('Difference operation failed:', error);
                throw error;
            }
        }

        // Verify metadata propagation through pipeline
        verifyMetadataPropagation(primitives, stage) {
            let pointsWithCurveIds = 0;
            let primitivesWithCurveIds = 0;
            let uniqueCurveIds = new Set();

            primitives.forEach(prim => {
                let hasPointCurveIds = false;

                if (prim.curveIds && prim.curveIds.length > 0) {
                    primitivesWithCurveIds++;
                    prim.curveIds.forEach(id => uniqueCurveIds.add(id));
                }

                // Iterate over contours to check points
                if (prim.contours && prim.contours.length > 0) {
                    prim.contours.forEach(contour => {
                        if (contour.points) {
                            const taggedPoints = contour.points.filter(p => p.curveId !== undefined && p.curveId > 0);
                            if (taggedPoints.length > 0) {
                                pointsWithCurveIds += taggedPoints.length;
                                hasPointCurveIds = true;
                                taggedPoints.forEach(p => uniqueCurveIds.add(p.curveId));
                            }
                        }
                    });
                } 
                // Legacy data structure check (should be empty)
                else if (prim.points) {
                     // Warn if it's populated
                     console.warn("[GeometryProcessor] verifyMetadata found primitive.points on ID:", prim.id);
                }

                if (hasPointCurveIds && !prim.curveIds) {
                    primitivesWithCurveIds++; // Count implicit tagging
                }
            });

            this.debug(`${stage}:`);
            this.debug(`  ${primitivesWithCurveIds}/${primitives.length} primitives with curve data`);
            this.debug(`  ${pointsWithCurveIds} points tagged`);
            this.debug(`  ${uniqueCurveIds.size} unique curve IDs`);
        }

        // Verify reconstruction results
        verifyReconstructionResults(primitives) {
            let reconstructedCircles = 0;
            let reconstructedPaths = 0;
            let pathsWithArcs = 0;
            let totalArcSegments = 0;

            primitives.forEach(prim => {
                if (prim.properties?.reconstructed) {
                    if (prim.type === 'circle') {
                        reconstructedCircles++;
                        this.debug(`  Reconstructed circle: r=${prim.radius.toFixed(3)}, coverage=${(prim.properties.coverage * 100).toFixed(1)}%`);
                    } else if (prim.type === 'path') {
                        reconstructedPaths++;
                        if (prim.arcSegments && prim.arcSegments.length > 0) {
                            pathsWithArcs++;
                            totalArcSegments += prim.arcSegments.length;
                        }
                    }
                }
            });

            this.debug(`Reconstruction verification:`);
            this.debug(`  Circles reconstructed: ${reconstructedCircles}`);
            this.debug(`  Paths with arc segments: ${pathsWithArcs}`);
            this.debug(`  Total arc segments: ${totalArcSegments}`);
        }

        // Preprocess primitives with curve ID preservation
       _preprocessPrimitives(primitives) {
            const preprocessed = [];
            let strokeCount = 0;

            for (const primitive of primitives) {
                if (!this._validatePrimitive(primitive)) continue;

                const curveIds = primitive.curveIds || [];
                
                // Track strokes for statistics
                if ((primitive.properties?.stroke && !primitive.properties?.fill) || 
                    primitive.properties?.isTrace) {
                    strokeCount++;
                }

                // primitiveToPath handles everything: strokes, analytics, paths
                const processed = this.standardizePrimitive(primitive, curveIds);
                
                if (processed) {
                    processed._originalIndex = primitive._originalIndex;
                    if (curveIds.length > 0) processed.curveIds = curveIds;
                    preprocessed.push(processed);
                }
            }

            this.stats.strokesConverted = strokeCount;
            this.debug(`Preprocessing: ${primitives.length} → ${preprocessed.length} (${strokeCount} strokes)`);
            return preprocessed;
        }

        standardizePrimitive(primitive, curveIds) {
            const props = primitive.properties;
            const isStroke = (props.stroke && !props.fill) || props.isTrace;

            // Strokes need conversion to filled polygons regardless of primitive type
            if (isStroke && props.strokeWidth > 0) {
                if (typeof GeometryUtils !== 'undefined' && GeometryUtils.primitiveToPath) {
                    const converted = GeometryUtils.primitiveToPath(primitive, curveIds || []);
                    if (converted) {
                        return converted;
                    }
                    // Fall through if conversion fails
                }
            }

            // If it's already a path, validate it has contours
            if (primitive.type === 'path') {
                if (!primitive.contours || primitive.contours.length === 0) {
                    console.error(`[GeometryProcessor] Path primitive ${primitive.id} has no contours!`);
                    return null;
                }
                return primitive; // Already valid
            }

            const localCurveIds = curveIds || [];

            // For analytic primitives, convert to path
            if (typeof GeometryUtils !== 'undefined' && GeometryUtils.primitiveToPath) {
                const pathPrimitive = GeometryUtils.primitiveToPath(primitive, localCurveIds);

                if (pathPrimitive) {
                    // Verify contours were created
                    if (!pathPrimitive.contours || pathPrimitive.contours.length === 0) {
                        console.error(`[GeometryProcessor] primitiveToPath failed to create contours for ${primitive.type} (ID: ${primitive.id})`);
                        return null;
                    }
                    
                    if (localCurveIds.length > 0) {
                        pathPrimitive.curveIds = localCurveIds;
                    }
                    return pathPrimitive;
                } else {
                    console.error(`[GeometryProcessor] Tessellation failed for ${primitive.type} (ID: ${primitive.id})`);
                    return null;
                }
            }

            console.error(`[GeometryProcessor] GeometryUtils.primitiveToPath is missing.`);
            return null;
        }

        // Perform boolean fusion
        async _performFusion(primitives) {
            const darkPrimitives = [];
            const clearPrimitives = [];

            primitives.forEach(primitive => {
                if (!primitive) {
                    console.warn('[GeometryProcessor] Skipping null primitive');
                    return;
                }

                // For paths, check contours; for others, trust getBounds()
                if (primitive.type === 'path') {
                    if (!primitive.contours || primitive.contours.length === 0) {
                        console.warn('[GeometryProcessor] Skipping path with no contours:', primitive.id);
                        return;
                    }

                    const hasValidGeometry = primitive.contours.some(c => 
                        c.points && c.points.length >= 3
                    );

                    if (!hasValidGeometry) {
                        console.warn('[GeometryProcessor] Skipping path with invalid contour geometry:', primitive.id);
                        return;
                    }
                }

                if (!primitive.properties) primitive.properties = {};

                const finalPolarity = primitive.properties?.polarity || 'dark';
                if (finalPolarity === 'clear') {
                    clearPrimitives.push(primitive);
                } else {
                    darkPrimitives.push(primitive);
                }
            });

            this.debug(`Received ${primitives.length} total primitives. Separated into: ${darkPrimitives.length} dark (subjects) and ${clearPrimitives.length} clear (clips).`);
            this.debug(`_performFusion Input (Post-Standardization): ${darkPrimitives.length} dark, ${clearPrimitives.length} clear`);

            // 2. Enforce Winding Order *before* Clipper
            if (typeof GeometryUtils !== 'undefined' && GeometryUtils.isClockwise) {
                let darkReversed = 0;
                let clearReversed = 0;
                darkPrimitives.forEach(prim => { // Ensure dark are CCW
                    if (prim.contours && prim.contours[0] && GeometryUtils.isClockwise(prim.contours[0].points)) {
                        prim.contours[0].points.reverse(); darkReversed++;
                    }
                });
                clearPrimitives.forEach(prim => { // Ensure clear are CW
                    if (prim.contours && prim.contours[0] && !GeometryUtils.isClockwise(prim.contours[0].points)) {
                        prim.contours[0].points.reverse(); clearReversed++;
                    }
                });
                 this.debug(`Pre-Clipper Winding: Reversed ${darkReversed} dark, ${clearReversed} clear.`);
            } else {
                 console.warn('[GeometryProcessor] Cannot enforce pre-Clipper winding: GeometryUtils missing or isClockwise not found.');
            }

            // 3. Perform Boolean Operation
            const rawResult = await this.clipper.difference(darkPrimitives, clearPrimitives);
            this.debug('Raw Clipper Result Count:', rawResult.length);

            const directHolesCount = rawResult.filter(p => p && p.contours && p.contours.filter(c => c.isHole).length > 0).length;
            this.debug('Primitives with structured hole contours in raw result:', directHolesCount);

            // 4. Normalize Winding on Clipper Result
            if (typeof GeometryUtils !== 'undefined' && GeometryUtils.isClockwise) {
                this.debug(`Normalizing winding for ${rawResult.length} final primitives.`);
                rawResult.forEach((primitive, index) => {
                    // Mark as fused. The wrapper already applied properties.
                    if (primitive.properties) {
                        primitive.properties.isFused = true;
                    } else {
                        primitive.properties = { isFused: true };
                    }

                    if (primitive.type === 'path' && primitive.contours && primitive.contours.length > 0) {
                        primitive.contours.forEach((contour, contourIdx) => {
                            const pathIsClockwise = GeometryUtils.isClockwise(contour.points);
                            const expectedClockwise = contour.isHole; // Holes should be CW

                            if (pathIsClockwise !== expectedClockwise) {
                                this.debug(`  - Reversing contour ${index}:${contourIdx} (isHole=${contour.isHole}). Was ${pathIsClockwise ? 'CW' : 'CCW'}, expected ${expectedClockwise ? 'CW' : 'CCW'}.`);
                                contour.points.reverse();
                            }
                        });
                    }
                });
            } else {
                 console.warn('[GeometryProcessor] Cannot normalize post-Clipper winding: GeometryUtils missing or isClockwise function not found.');
            }

            // The raw result IS the final result.
            const finalPrimitives = rawResult;

            const totalFinalHoles = finalPrimitives.reduce((sum, p) => sum + (p.contours ? p.contours.filter(c => c.isHole).length : 0), 0);
            this.debug(`[GeometryProcessor] Mapped ${finalPrimitives.length} final primitives. Total structured hole contours: ${totalFinalHoles}`);

            return finalPrimitives;
        }

        _validatePrimitive(primitive) {
            if (!primitive) return false;
            if (!primitive.properties) {
                primitive.properties = {};
            }

            const polarity = primitive.properties.polarity;
            if (polarity !== 'dark' && polarity !== 'clear') {
                primitive.properties.polarity = 'dark';
            }

            return true;
        }

        _createPathPrimitive(contours, properties = {}) {
            if (typeof PathPrimitive !== 'undefined' && PathPrimitive) {
                const primitive = new PathPrimitive(contours, properties);

                if (properties.hasReconstructableCurves) { 
                    primitive.hasReconstructableCurves = true; 
                }

                if (!primitive.contours || primitive.contours.length === 0) {
                    this.debug(`PathPrimitive created with no contours`);
                }

                return primitive;
            }
        }

        // State management
        clearCachedStates() {
            this.cachedStates = {
                originalPrimitives: null,
                preprocessedGeometry: null,
                fusedGeometry: null,
                registeredCurves: null
            };
        }

        clearProcessorCache() {
            this.clearCachedStates();
        }

        getCachedState(stateName) {
            return this.cachedStates[stateName] || null;
        }

        async ensureInitialized() {
            if (!this.clipper.initialized) {
                await this.initPromise;
            }
            if (!this.clipper.initialized) {
                throw new Error('GeometryProcessor not initialized');
            }
        }

        getStats() {
            return {
                ...this.stats,
                clipper: this.clipper.getCapabilities(),
                arcReconstruction: this.arcReconstructor.getStats()
            };
        }

        getArcReconstructionStats() {
            return this.arcReconstructor.getStats();
        }

        debug(message, data = null) {
            if (debugConfig.enabled) {
                if (data) {
                    console.log(`[GeometryProcessor] ${message}`, data);
                } else {
                    console.log(`[GeometryProcessor] ${message}`);
                }
            }
        }

    }

    window.GeometryProcessor = GeometryProcessor;
})();