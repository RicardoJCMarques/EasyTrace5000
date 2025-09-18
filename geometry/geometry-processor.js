// geometry/geometry-processor.js
// High-level geometry processing pipeline orchestrator
// FIXED: Uses global curve registry consistently

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
                curvesReconstructed: 0
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
                let pointsWithCurveIds = 0;
                let primitivesWithCurveIds = 0;
                
                preprocessed.forEach(prim => {
                    if (prim.curveIds && prim.curveIds.length > 0) {
                        primitivesWithCurveIds++;
                    }
                    if (prim.points) {
                        const taggedPoints = prim.points.filter(p => p.curveId !== undefined && p.curveId > 0);
                        if (taggedPoints.length > 0) {
                            pointsWithCurveIds += taggedPoints.length;
                        }
                    }
                });
                
                this.debug(`After preprocessing: ${primitivesWithCurveIds} primitives with curve IDs, ${pointsWithCurveIds} points tagged`);
            }
            
            // Step 4: Perform boolean fusion
            const fused = await this._performFusion(preprocessed, fusionOptions);
            
            // Verify metadata survival
            if (fusionOptions.enableArcReconstruction && this.options.debug) {
                let fusedPointsWithCurveIds = 0;
                let fusedPrimitivesWithCurveIds = 0;
                
                fused.forEach(prim => {
                    if (prim.curveIds && prim.curveIds.length > 0) {
                        fusedPrimitivesWithCurveIds++;
                    }
                    if (prim.points) {
                        const taggedPoints = prim.points.filter(p => p.curveId !== undefined && p.curveId > 0);
                        if (taggedPoints.length > 0) {
                            fusedPointsWithCurveIds += taggedPoints.length;
                        }
                    }
                });
                
                this.debug(`After fusion: ${fusedPrimitivesWithCurveIds} primitives with curve IDs, ${fusedPointsWithCurveIds} points tagged`);
            }
            
            // Step 5: Reconstruct arcs if enabled
            let finalGeometry = fused;
            if (fusionOptions.enableArcReconstruction && window.globalCurveRegistry?.registry?.size > 0) {
                this.debug(`=== RECONSTRUCTION PHASE ===`);
                finalGeometry = this.arcReconstructor.processForReconstruction(fused);
                
                const stats = this.arcReconstructor.getStats();
                this.stats.curvesReconstructed = stats.reconstructed;
                
                this.debug(`Reconstruction complete:`);
                this.debug(`  Curves in registry: ${stats.registrySize}`);
                this.debug(`  Curves reconstructed: ${stats.reconstructed}`);
                this.debug(`  Success rate: ${stats.successRate}`);
                this.debug(`  Partial arcs: ${stats.partialArcs}`);
                this.debug(`  Full circles: ${stats.fullCircles}`);
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
        
        // Preprocess primitives with curve ID preservation
        _preprocessPrimitives(primitives, options) {
            const preprocessed = [];
            this.stats.strokesConverted = 0;
            
            for (const primitive of primitives) {
                if (!this._validatePrimitive(primitive)) continue;
                
                // Preserve original index
                const originalIndex = primitive._originalIndex;
                
                // Get curve IDs from primitive itself (already registered)
                const curveIds = primitive.curveIds || [];
                
                if (this.options.debug && curveIds.length > 0) {
                    this.debug(`Primitive ${originalIndex} has ${curveIds.length} registered curves: [${curveIds.join(', ')}]`);
                }
                
                // Determine if stroke conversion is needed
                const operationType = primitive.properties?.operationType;
                const isStroke = (primitive.properties?.stroke && !primitive.properties?.fill) || 
                               primitive.properties?.isTrace;
                const shouldConvertStroke = isStroke && operationType === 'isolation';
                
                let processedPrimitive;
                if (shouldConvertStroke) {
                    this.stats.strokesConverted++;
                    processedPrimitive = this._convertStrokeToPolygon(primitive);
                } else {
                    processedPrimitive = this._standardizePrimitive(primitive, curveIds, options);
                }
                
                if (processedPrimitive) {
                    // Preserve the original index through preprocessing
                    processedPrimitive._originalIndex = originalIndex;
                    // Store curve IDs at primitive level
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
        _standardizePrimitive(primitive, curveIds, options) {
            let points = [];
            let arcSegments = [];
            
            if (this.options.debug && curveIds.length > 0) {
                this.debug(`Standardizing ${primitive.type} with curve IDs: [${curveIds.join(', ')}]`);
            }
            
            if (primitive.type === 'path') {
                points = primitive.points;
                // Preserve arc segments from path
                if (primitive.arcSegments) {
                    arcSegments = primitive.arcSegments;
                }
            } else if (primitive.type === 'circle') {
                // Convert to polygon with curve metadata
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
                    // Fallback conversion
                    const segments = GeometryUtils.getOptimalSegments(primitive.radius);
                    for (let i = 0; i < segments; i++) {
                        const angle = (i / segments) * 2 * Math.PI;
                        const point = {
                            x: primitive.center.x + primitive.radius * Math.cos(angle),
                            y: primitive.center.y + primitive.radius * Math.sin(angle)
                        };
                        // Tag points with curve ID if available
                        if (curveIds.length > 0) {
                            point.curveId = curveIds[0];
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
                // Convert to polygon with curve metadata
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
                // Convert to polygon with curve metadata
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
                    // Tag points with curve ID if available
                    if (curveIds.length > 0) {
                        points = points.map((p, i) => ({ 
                            ...p, 
                            curveId: curveIds[0],
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
                
                // Preserve arc segments
                if (arcSegments.length > 0) {
                    pathPrimitive.arcSegments = arcSegments;
                }
                
                // Store curve IDs at primitive level
                if (curveIds.length > 0) {
                    pathPrimitive.curveIds = curveIds;
                }
                
                return pathPrimitive;
            }
            
            return null;
        }
        
        // Perform boolean fusion
        async _performFusion(primitives, options) {
            // Separate by polarity
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
            
            // Execute boolean difference
            const result = await this.clipper.difference(darkPrimitives, clearPrimitives);
            
            // Count holes
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
                
                // Restore arc segments if present
                if (properties.arcSegments) {
                    primitive.arcSegments = properties.arcSegments;
                }
                
                // Store curve IDs if present
                if (properties.curveIds) {
                    primitive.curveIds = properties.curveIds;
                }
                
                // Mark if has reconstructable curves
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
                    // Include holes in bounds
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
        
        // Placeholder methods for future offset functionality
        async prepareForOffsetGeneration() {
            await this.ensureInitialized();
            const fusedPrimitives = await this.fuseGeometry(this.getFuseablePrimitives());
            this.debug('Offset preparation not yet implemented');
            return fusedPrimitives;
        }
        
        async generateOffsetGeometry(offsetDistance, options = {}) {
            await this.ensureInitialized();
            this.debug(`Offset generation (${offsetDistance}mm) not yet implemented`);
            return [];
        }
        
        // Compatibility methods
        getPreprocessedPrimitives() {
            return this.getCachedState('preprocessedGeometry');
        }
        
        getFusedPrimitives() {
            return this.getCachedState('fusedGeometry');
        }
        
        getFuseablePrimitives() {
            // This should be called by cam-core.js
            return [];
        }
    }
    
    // Export
    window.GeometryProcessor = GeometryProcessor;
    
})();