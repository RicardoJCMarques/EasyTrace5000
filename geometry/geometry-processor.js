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
    
    const config = window.PCBCAMConfig || {};
    const geomConfig = config.geometry || {};
    const debugConfig = config.debug || {};
    
    class GeometryProcessor {
        constructor(options = {}) {
            this.options = {
                debug: options.debug !== undefined ? options.debug : debugConfig.enabled,
                scale: options.scale || geomConfig.clipperScale || 10000,
                preserveOriginals: options.preserveOriginals !== undefined ? options.preserveOriginals : true,
                ...options
            };
            
            // Initialize sub-modules
            this.clipper = new ClipperWrapper({
                scale: this.options.scale,
                debug: this.options.debug
            });
            
            this.arcReconstructor = new ArcReconstructor({
                debug: this.options.debug,
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
                
                this.debug('GeometryProcessor initialized with arc reconstruction pipeline');
                return true;
            } catch (error) {
                console.error('Failed to initialize GeometryProcessor:', error);
                return false;
            }
        }
        
        // Main fusion pipeline with arc reconstruction
        async fuseGeometry(primitives, options = {}) {
            console.log('[Geometry-Processor] fuseGeometry() - Entered fuseGeometry. Received options:', options);

            await this.ensureInitialized();
            
            if (!primitives || primitives.length === 0) return [];
            
            const fusionOptions = {
                enableArcReconstruction: options.enableArcReconstruction || false,
                ...options
            };
            
            this.debug(`=== FUSION PIPELINE START ===`);
            this.debug(`Input: ${primitives.length} primitives`);
            this.debug(`Arc reconstruction: ${fusionOptions.enableArcReconstruction ? 'ENABLED' : 'DISABLED'}`);
            
            // Step 1: Cache originals with indices
            primitives.forEach((p, idx) => {
                p._originalIndex = idx;
            });
            this.cachedStates.originalPrimitives = primitives;
            
            // Step 2: Count registered curves from global registry
            if (fusionOptions.enableArcReconstruction && window.globalCurveRegistry) {
                const registryStats = window.globalCurveRegistry.getStats();
                this.stats.curvesRegistered = registryStats.registrySize;
                
                this.debug(`Global registry has ${registryStats.registrySize} curves`);
                this.debug(`  Circles: ${registryStats.circles}`);
                this.debug(`  Arcs: ${registryStats.arcs}`);
                this.debug(`  End caps: ${registryStats.endCaps}`);
            }
            
            // Step 3: Preprocess primitives (convert to polygons with metadata)
            const preprocessed = this._preprocessPrimitives(
                this.cachedStates.originalPrimitives, 
                fusionOptions
            );

            // Accumulate preprocessed geometry, don't replace it
            if (!this.cachedStates.preprocessedGeometry) {
                this.cachedStates.preprocessedGeometry = [];
            }
            this.cachedStates.preprocessedGeometry.push(...preprocessed);
            
            // Verify metadata propagation
            if (fusionOptions.enableArcReconstruction && this.options.debug) {
                this.verifyMetadataPropagation(preprocessed, 'After preprocessing');
            }
            
            // Step 4: Perform boolean fusion
            const fused = await this._performFusion(preprocessed, fusionOptions);
            
            // Verify metadata survival
            if (fusionOptions.enableArcReconstruction && this.options.debug) {
            this.verifyMetadataPropagation(fused, 'After fusion');
        }
        
        // Step 5: Reconstruct arcs if enabled, otherwise use the fused geometry directly.
        let finalGeometry; // Initialize as undefined.

        console.log('[Geometry-Processor] FuseGeometry() - About to check if (fusionOptions.enableArcReconstruction).');
        if (fusionOptions.enableArcReconstruction) {
            console.log('[Geometry-Processor] Entered Step 5 - Reconstruction? Received options:', options);
            this.debug(`=== RECONSTRUCTION PHASE ===`);
            
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
            
            if (this.options.debug) {
                this.verifyReconstructionResults(finalGeometry);
            }
            console.log('[Geometry-Processor] <<< Exiting arc reconstruction block. Result count:', finalGeometry.length);
            
        } else {
            // If reconstruction is disabled, the fused geometry is the final geometry.
            console.log('[Geometry-Processor] Arc reconstruction is DISABLED, skipping block.');
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
                        return this._createPathPrimitive(p.points, {
                            ...p.properties,
                            curveIds: p.curveIds,
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
        async difference(subjectPrimitives, clipPrimitives, options = {}) {
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
                        return this._createPathPrimitive(p.points, {
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
                
                if (prim.points) {
                    const taggedPoints = prim.points.filter(p => p.curveId !== undefined && p.curveId > 0);
                    if (taggedPoints.length > 0) {
                        pointsWithCurveIds += taggedPoints.length;
                        hasPointCurveIds = true;
                        taggedPoints.forEach(p => uniqueCurveIds.add(p.curveId));
                    }
                }
                
                if (hasPointCurveIds && !prim.curveIds) {
                    primitivesWithCurveIds++;
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
       _preprocessPrimitives(primitives, options) {
            const preprocessed = [];
            this.stats.strokesConverted = 0;
            
            for (const primitive of primitives) {
                if (!this._validatePrimitive(primitive)) continue;
                
                const originalIndex = primitive._originalIndex;
                const curveIds = primitive.curveIds || [];
                
                if (this.options.debug && curveIds.length > 0) {
                    this.debug(`Primitive ${originalIndex} has ${curveIds.length} registered curves: [${curveIds.join(', ')}]`);
                }
                
                const operationType = primitive.properties?.operationType;
                const isCutoutOp = operationType === 'cutout';

                // Determine if it looks like a stroke based on properties
                const looksLikeStroke = (primitive.properties?.stroke && !primitive.properties?.fill) || primitive.properties?.isTrace;

                // Only convert actual strokes intended for isolation, NOT cutout segments
                const shouldConvertStroke = looksLikeStroke && !isCutoutOp && 
                                            (operationType === 'isolation' || operationType === 'clear');

                let processedPrimitive;
                if (shouldConvertStroke) {
                    this.stats.strokesConverted++;
                    processedPrimitive = this._convertStrokeToPolygon(primitive);
                } else {
                    processedPrimitive = this.standardizePrimitive(primitive, curveIds, options);
                }
                
                if (processedPrimitive) {
                    processedPrimitive._originalIndex = originalIndex;
                    if (curveIds.length > 0) {
                        processedPrimitive.curveIds = curveIds;
                    }
                    preprocessed.push(processedPrimitive);
                }
            }
            
            this.debug(`Preprocessing: ${primitives.length} → ${preprocessed.length} (${this.stats.strokesConverted} strokes converted)`);
            return preprocessed;
        }
        
        // Standardize primitive to polygon with curve metadata
        standardizePrimitive(primitive, curveIds, options) {

            // If it's already a path, just ensure properties and return.
            if (primitive.type === 'path') {
                return primitive;
            }

            const localCurveIds = curveIds || [];

            // For all other analytic primitives (circle, rect, arc, etc.), delegate to the central GeometryUtils function.
            if (typeof GeometryUtils !== 'undefined' && GeometryUtils.primitiveToPath) {
                const pathPrimitive = GeometryUtils.primitiveToPath(primitive, localCurveIds);

                // Check if tessellation was successful
                if (pathPrimitive) {
                    // This is the fix for your typo: use localCurveIds
                    if (localCurveIds.length > 0) {
                        pathPrimitive.curveIds = localCurveIds;
                    }
                    return pathPrimitive;
                } else {
                    // This is the new, more useful logging
                    if (localCurveIds.length > 0) {
                        console.warn(`[GeometryProcessor] standardizePrimitive: Tessellation failed for ${primitive.type} (ID: ${primitive.id}), but it HAD curve IDs: [${localCurveIds.join(',')}]`);
                    } else if (this.options.debug) {
                        console.warn(`[GeometryProcessor] standardizePrimitive: Tessellation failed or produced no points for ${primitive.type} (ID: ${primitive.id})`);
                    }
                    return null;
                }
            }

            console.error(`[GeometryProcessor] standardizePrimitive failed: GeometryUtils.primitiveToPath is missing.`);
            return null;
        }
        
        // Perform boolean fusion
        async _performFusion(primitives, options) { // options parameter remains unused
            const darkPrimitives = [];
            const clearPrimitives = []; // Holes or clear areas

            // 1. Separate primitives by polarity
            primitives.forEach(primitive => {
                if (!primitive || !primitive.points || primitive.points.length < 3) {
                     console.warn('[GeoProcessor._performFusion] Skipping invalid or empty primitive:', primitive);
                    return;
                }
                
                if (!primitive.properties) primitive.properties = {};
                
                const finalPolarity = primitive.properties?.polarity || 'dark';
                if (finalPolarity === 'clear') {
                    clearPrimitives.push(primitive);
                } else {
                    darkPrimitives.push(primitive);
                }
            });

            console.log(`[GeoProcessor._performFusion] Received ${primitives.length} total primitives. Separated into: ${darkPrimitives.length} dark (subjects) and ${clearPrimitives.length} clear (clips).`);

            this.debug(`_performFusion Input (Post-Standardization): ${darkPrimitives.length} dark, ${clearPrimitives.length} clear`);


            // 2. Enforce Winding Order *before* Clipper
            if (typeof GeometryUtils !== 'undefined' && GeometryUtils.isClockwise) {
                let darkReversed = 0;
                let clearReversed = 0;
                darkPrimitives.forEach(prim => { // Ensure dark are CCW
                    if (GeometryUtils.isClockwise(prim.points)) {
                        prim.points.reverse(); darkReversed++;
                    }
                });
                clearPrimitives.forEach(prim => { // Ensure clear are CW
                    if (!GeometryUtils.isClockwise(prim.points)) {
                        prim.points.reverse(); clearReversed++;
                    }
                });
                 if (this.options.debug) { // Hide log behind debug flag
                     console.log(`[GeoProcessor._performFusion] Pre-Clipper Winding: Reversed ${darkReversed} dark, ${clearReversed} clear.`);
                 }
            } else {
                 console.warn('[GeoProcessor._performFusion] Cannot enforce pre-Clipper winding: GeometryUtils missing or isClockwise not found.');
            }

            // 3. Perform Boolean Operation
            const rawResult = await this.clipper.difference(darkPrimitives, clearPrimitives);
             console.log('[GeometryProcessor._performFusion] Raw Clipper Result Count:', rawResult.length);
             
             const directHolesCount = rawResult.filter(p => p && p.contours && p.contours.filter(c => c.isHole).length > 0).length;
             console.log('[GeometryProcessor._performFusion] Primitives with structured hole contours in raw result:', directHolesCount);

            // 4. Normalize Winding on Clipper Result
            // The 'rawResult' from the wrapper is already the array of PathPrimitives with the correct 'contours' structure. We just need to normalize winding.
            if (typeof GeometryUtils !== 'undefined' && GeometryUtils.isClockwise) {
                console.log(`[GeoProcessor._performFusion] Normalizing winding for ${rawResult.length} final primitives.`);
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
                                if (this.options.debug) {
                                    console.log(`  - Reversing contour ${index}:${contourIdx} (isHole=${contour.isHole}). Was ${pathIsClockwise ? 'CW' : 'CCW'}, expected ${expectedClockwise ? 'CW' : 'CCW'}.`);
                                }
                                contour.points.reverse();
                            }
                        });
                    }
                });
            } else {
                 console.warn('[GeoProcessor._performFusion] Cannot normalize post-Clipper winding: GeometryUtils missing or isClockwise function not found.');
            }
            
            // The raw result IS the final result.
            const finalPrimitives = rawResult;

             const totalFinalHoles = finalPrimitives.reduce((sum, p) => sum + (p.contours ? p.contours.filter(c => c.isHole).length : 0), 0);
             console.log(`[GeoProcessor._performFusion] Mapped ${finalPrimitives.length} final primitives. Total structured hole contours: ${totalFinalHoles}`);

            return finalPrimitives;
        }
        
        // Convert stroke to polygon
        _convertStrokeToPolygon(primitive) {
            if (primitive.type === 'path' && primitive.points && primitive.properties?.strokeWidth) {
                const polygonPoints = GeometryUtils.polylineToPolygon(
                    primitive.points,
                    primitive.properties.strokeWidth
                );
                
                return this._createPathPrimitive(polygonPoints, {
                    ...primitive.properties,
                    isPreprocessed: true,
                    wasStroke: true,
                    fill: true,
                    stroke: false,
                    strokeWidth: 0,
                    closed: true
                });

            } else if (primitive.type === 'arc' && primitive.properties?.strokeWidth) {
                 if (this.options.debug) {
                    console.log(`[GeoProcessor] Converting arc stroke ${primitive.id} to polygon...`);
                 }
                // Use the primitive's own strokeWidth, not an offset
                const polygonPoints = GeometryUtils.arcToPolygon(
                    primitive,
                    primitive.properties.strokeWidth
                );

                if (!polygonPoints || polygonPoints.length < 3) {
                     console.warn(`[GeoProcessor] arcToPolygon failed for arc ${primitive.id}`);
                    return null;
                }

                // Collect all curve IDs generated by arcToPolygon
                const allCurveIds = polygonPoints.curveIds || [];

                return this._createPathPrimitive(polygonPoints, {
                    ...primitive.properties,
                    isPreprocessed: true,
                    wasStroke: true,
                    fill: true,
                    stroke: false,
                    strokeWidth: 0,
                    closed: true,
                    curveIds: allCurveIds, // Pass generated curve IDs
                    arcSegments: polygonPoints.arcSegments || [] // Pass generated arc metadata
                });
            }

            console.log(`[GeoProcessor] _convertStrokeToPolygon: No conversion applied for type ${primitive.type}`);
            return null; // Return null if not converted
        }
        
        // Validate primitive
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
        
        // Create path primitive
        // Now primarily relies on PathPrimitive class, but ensures fallback handles holes
        _createPathPrimitive(points, properties) {
            // Check if PathPrimitive class is available
            if (typeof PathPrimitive !== 'undefined' && PathPrimitive) {
                if (this.options.debug) {
                    console.log("[GeoProcessor._createPathPrimitive] Using PathPrimitive CLASS constructor.");
                    // Log the properties being passed, specifically looking for 'contours'
                    console.log("  - Input properties:", {
                        hasContours: properties && properties.contours && properties.contours.length > 0,
                        contourCount: properties && properties.contours ? properties.contours.length : 0,
                        pointsLength: points ? points.length : 0
                    });
                }

                // The PathPrimitive constructor correctly uses `properties.contours` if available.
                try {
                    const primitive = new PathPrimitive(points, properties);

                    // Handle legacy arcSegments at primitive level
                    // Convert to contour-level storage for consistency
                    if (properties.arcSegments && (!properties.contours || properties.contours.length === 0)) {
                        // Legacy format: move arcSegments into first contour
                        const mainContour = {
                            points: points,
                            isHole: false,
                            nestingLevel: 0,
                            parentId: null,
                            curveIds: properties.curveIds || [],
                            arcSegments: properties.arcSegments
                        };
                        primitive.contours = [mainContour];
                        delete properties.arcSegments;  // Remove from top level
                    }
                    
                    if (properties.curveIds) { primitive.curveIds = properties.curveIds; }
                    if (properties.hasReconstructableCurves) { primitive.hasReconstructableCurves = true; }
                    // Check if contours were actually set by the constructor
                    if (!primitive.contours || primitive.contours.length === 0) {
                        if (this.options.debug) {
                            console.warn(`[GeoProcessor._createPathPrimitive] PathPrimitive constructor resulted in NO contours despite input. Input contours count: ${properties?.contours?.length || 0}`);
                        }
                    } else {
                        const holeContours = primitive.contours.filter(c => c.isHole).length;
                        if (this.options.debug) {
                            console.log(`[GeoProcessor._createPathPrimitive] Constructed PathPrimitive ${primitive.id}. Final contour count: ${primitive.contours.length}, Hole contours: ${holeContours}`);
                        }
                    }

                    return primitive;
                } catch (e) {
                    if (this.options.debug) {
                        console.error("[GeoProcessor._createPathPrimitive] Error constructing PathPrimitive:", e, "Points:", points, "Properties:", properties);
                    }
                    return null; // Return null if construction fails
                }
            }

            // Fallback object creation (If PathPrimitive class somehow fails or is unavailable)
            console.warn("[GeoProcessor._createPathPrimitive] PathPrimitive class NOT available/failed. Using fallback object.");
        
            // The new logic only checks for 'properties.contours'.
            // If 'contours' exists, it's used.
            // If not, a single contour is created from 'points'.
            let fallbackContours = properties?.contours;

            if (!fallbackContours || fallbackContours.length === 0) {
                // Create a default single contour from the main points
                fallbackContours = [{ 
                    points: points, 
                    isHole: false, 
                    nestingLevel: 0, 
                    parentId: null, 
                    curveIds: properties?.curveIds || [] // Try to preserve curveIds
                }];
                console.log("[GeoProcessor Fallback] No contours provided, creating single contour from main points.");
            } else {
                console.log(`[GeoProcessor Fallback] Using ${fallbackContours.length} provided contours.`);
            }

            // Handle legacy arcSegments at top level
            if (properties?.arcSegments && fallbackContours.length > 0) {
                fallbackContours[0].arcSegments = properties.arcSegments;
            }

            return {
                type: 'path',
                points: points,
                properties: properties || {},
                closed: properties?.closed !== false,
                contours: fallbackContours,
                curveIds: properties?.curveIds || [],
                hasReconstructableCurves: properties?.hasReconstructableCurves || false,
                getBounds: function() {
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    // Calculate bounds from CONTOURS in fallback
                    if (this.contours) {
                        this.contours.forEach(c => {
                             if (!c.isHole && c.points) { // Only use outer contours for bounds
                                c.points.forEach(p => {
                                    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
                                    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
                                });
                            }
                        });
                    }
                    return { minX, minY, maxX, maxY };
                }
            };
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
        
        // Ensure initialized
        async ensureInitialized() {
            if (!this.clipper.initialized) {
                await this.initPromise;
            }
            if (!this.clipper.initialized) {
                throw new Error('GeometryProcessor not initialized');
            }
        }
        
        // Statistics
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
        
        // Debug
        debug(message, data = null) {
            if (this.options.debug) {
                if (data) {
                    console.log(`[GeometryProcessor] ${message}`, data);
                } else {
                    console.log(`[GeometryProcessor] ${message}`);
                }
            }
        }
        
        // Compatibility methods
        getPreprocessedPrimitives() {
            return this.getCachedState('preprocessedGeometry');
        }
        
        getFusedPrimitives() {
            return this.getCachedState('fusedGeometry');
        }
    }
    
    // Export
    window.GeometryProcessor = GeometryProcessor;
    
})();