/**
 * @file        geometry/geometry-processor.js
 * @description Processes geometric boolean operations
 * @comment     Fixed: End-cap curves registered with explicit clockwise=false
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
            
            // Clear previous state
            this.clearCachedStates();
            
            // Step 1: Cache originals with indices
            this.cachedStates.originalPrimitives = primitives.map((p, idx) => ({
                ...p,
                _originalIndex: idx
            }));
            
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
            this.cachedStates.preprocessedGeometry = preprocessed;
            
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
            
            // if (this.options.debug) {
                this.verifyReconstructionResults(finalGeometry);
            // }
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
                    if (p.holes && p.holes.length > 0) {
                        holesFound += p.holes.length;
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
                            holes: p.holes || [],
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
                            holes: p.holes || [],
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
                const isStroke = (primitive.properties?.stroke && !primitive.properties?.fill) || 
                               primitive.properties?.isTrace;
                const shouldConvertStroke = isStroke && operationType === 'isolation';
                
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
            // --- FIX: Provide default values for optional parameters ---
            const localCurveIds = curveIds || [];
            const localOptions = options || {};
            // --- END FIX ---

            let points = [];
            let arcSegments = [];
            
            if (this.options.debug && localCurveIds.length > 0) {
                this.debug(`Standardizing ${primitive.type} with curve IDs: [${localCurveIds.join(', ')}]`);
            }
            
            if (primitive.type === 'path') {
                points = primitive.points;
                if (primitive.arcSegments) {
                    arcSegments = primitive.arcSegments;
                }
            } else if (primitive.type === 'circle') {
                if (primitive.toPolygon && typeof primitive.toPolygon === 'function') {
                    const pathPrimitive = primitive.toPolygon();
                    
                    if (this.options.debug && pathPrimitive.points) {
                        const taggedCount = pathPrimitive.points.filter(p => p.curveId !== undefined).length;
                        if (taggedCount > 0) {
                            this.debug(`Circle converted with ${taggedCount}/${pathPrimitive.points.length} tagged points`);
                        }
                    }
                    
                    return pathPrimitive;
                } else {
                    const segments = GeometryUtils.getOptimalSegments(primitive.radius);
                    for (let i = 0; i < segments; i++) {
                        const angle = (i / segments) * 2 * Math.PI;
                        const point = {
                            x: primitive.center.x + primitive.radius * Math.cos(angle),
                            y: primitive.center.y + primitive.radius * Math.sin(angle)
                        };
                        if (localCurveIds.length > 0) {
                            point.curveId = localCurveIds[0];
                            point.segmentIndex = i;
                        }
                        points.push(point);
                    }
                }
            } else if (primitive.type === 'rectangle') {
                const { x, y } = primitive.position;
                const w = primitive.width || 0;
                const h = primitive.height || 0;
                points = [
                    { x, y },
                    { x: x + w, y },
                    { x: x + w, y: y + h },
                    { x, y: y + h }
                ];
            } else if (primitive.type === 'obround') {
                if (primitive.toPolygon && typeof primitive.toPolygon === 'function') {
                    const pathPrimitive = primitive.toPolygon();
                    
                    if (this.options.debug && pathPrimitive.points) {
                        const taggedCount = pathPrimitive.points.filter(p => p.curveId !== undefined).length;
                        if (taggedCount > 0) {
                            this.debug(`Obround converted with ${taggedCount}/${pathPrimitive.points.length} tagged points`);
                        }
                    }
                    
                    return pathPrimitive;
                } else {
                    points = GeometryUtils.obroundToPoints(primitive);
                }
            } else if (primitive.type === 'arc') {
                if (primitive.toPolygon && typeof primitive.toPolygon === 'function') {
                    const pathPrimitive = primitive.toPolygon();
                    
                    if (this.options.debug && pathPrimitive.points) {
                        const taggedCount = pathPrimitive.points.filter(p => p.curveId !== undefined).length;
                        if (taggedCount > 0) {
                            this.debug(`Arc converted with ${taggedCount}/${pathPrimitive.points.length} tagged points`);
                        }
                    }
                    
                    return pathPrimitive;
                } else {
                    points = GeometryUtils.interpolateArc(
                        primitive.startPoint,
                        primitive.endPoint,
                        primitive.center,
                        primitive.clockwise
                    );
                    if (localCurveIds.length > 0) {
                        points = points.map((p, i) => ({ 
                            ...p, 
                            curveId: localCurveIds[0],
                            segmentIndex: i
                        }));
                    }
                }
            }
            
            if (points.length >= 3) {
                const pathPrimitive = this._createPathPrimitive(points, {
                    ...primitive.properties,
                    originalType: primitive.type
                });
                
                if (arcSegments.length > 0) {
                    pathPrimitive.arcSegments = arcSegments;
                }
                
                if (localCurveIds.length > 0) {
                    pathPrimitive.curveIds = localCurveIds;
                }
                
                return pathPrimitive;
            }
            
            return null;
        }
        
        // Perform boolean fusion
        async _performFusion(primitives, options) {
            const darkPrimitives = [];
            const clearPrimitives = [];
            
            for (const primitive of primitives) {
                const polarity = primitive.properties?.polarity || 'dark';
                
                if (polarity === 'clear') {
                    clearPrimitives.push(primitive);
                } else {
                    darkPrimitives.push(primitive);
                }
            }
            
            this.debug(`Fusion input: ${darkPrimitives.length} dark, ${clearPrimitives.length} clear`);
            
            const result = await this.clipper.difference(darkPrimitives, clearPrimitives);
            
            let holesFound = 0;
            result.forEach(p => {
                if (p.holes && p.holes.length > 0) {
                    holesFound += p.holes.length;
                }
            });
            
            if (holesFound > 0) {
                this.stats.holesDetected = holesFound;
                this.debug(`Detected ${holesFound} holes in fused geometry`);
            }
            
            return result.map(p => {
                if (typeof PathPrimitive !== 'undefined' && !(p instanceof PathPrimitive)) {
                    return this._createPathPrimitive(p.points, {
                        ...p.properties,
                        holes: p.holes || [],
                        curveIds: p.curveIds,
                        hasReconstructableCurves: p.hasReconstructableCurves
                    });
                }
                return p;
            });
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
            }
            
            return null;
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
        _createPathPrimitive(points, properties) {
            if (typeof PathPrimitive !== 'undefined') {
                const primitive = new PathPrimitive(points, properties);
                
                if (properties.arcSegments) {
                    primitive.arcSegments = properties.arcSegments;
                }
                
                if (properties.curveIds) {
                    primitive.curveIds = properties.curveIds;
                }
                
                if (properties.hasReconstructableCurves) {
                    primitive.hasReconstructableCurves = true;
                }
                
                return primitive;
            }
            
            // Fallback
            return {
                type: 'path',
                points: points,
                properties: properties || {},
                closed: properties?.closed !== false,
                holes: properties?.holes || [],
                arcSegments: properties?.arcSegments || [],
                curveIds: properties?.curveIds || [],
                hasReconstructableCurves: properties?.hasReconstructableCurves || false,
                getBounds: function() {
                    let minX = Infinity, minY = Infinity;
                    let maxX = -Infinity, maxY = -Infinity;
                    this.points.forEach(p => {
                        minX = Math.min(minX, p.x);
                        minY = Math.min(minY, p.y);
                        maxX = Math.max(maxX, p.x);
                        maxY = Math.max(maxY, p.y);
                    });
                    if (this.holes && this.holes.length > 0) {
                        this.holes.forEach(hole => {
                            hole.forEach(p => {
                                minX = Math.min(minX, p.x);
                                minY = Math.min(minY, p.y);
                                maxX = Math.max(maxX, p.x);
                                maxY = Math.max(maxY, p.y);
                            });
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