// geometry/geometry-processor.js
// High-level geometry processing pipeline orchestrator

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
                fusedGeometry: null
            };
            
            // Statistics
            this.stats = {
                fusionOperations: 0,
                primitivesProcessed: 0,
                primitivesReduced: 0,
                strokesConverted: 0,
                holesDetected: 0
            };
            
            // Initialize promise
            this.initPromise = this.initialize();
        }
        
        async initialize() {
            try {
                await this.clipper.initialize();
                this.debug('GeometryProcessor initialized with modular architecture');
                return true;
            } catch (error) {
                console.error('Failed to initialize GeometryProcessor:', error);
                return false;
            }
        }
        
        // Main fusion pipeline
        async fuseGeometry(primitives, options = {}) {
            await this.ensureInitialized();
            
            if (!primitives || primitives.length === 0) return [];
            
            const fusionOptions = {
                enableArcReconstruction: this.options.enableArcReconstruction || false,
                ...options
            };
            
            this.debug(`Starting fusion pipeline: ${primitives.length} primitives`);
            if (fusionOptions.enableArcReconstruction) {
                this.debug('Arc reconstruction ENABLED');
            }
            
            // Clear previous state
            this.clearCachedStates();
            
            // Step 1: Cache originals with indices
            this.cachedStates.originalPrimitives = primitives.map((p, idx) => ({
                ...p,
                _originalIndex: idx
            }));
            
            // Step 2: Detect curves if arc reconstruction is enabled
            if (fusionOptions.enableArcReconstruction) {
                this.arcReconstructor.clear();
                const detectedCurves = this.arcReconstructor.detectCurves(primitives);
                this.debug(`Detected ${detectedCurves.length} curves`);
            }
            
            // Step 3: Preprocess primitives (maintains _originalIndex)
            const preprocessed = this._preprocessPrimitives(this.cachedStates.originalPrimitives, fusionOptions);
            this.cachedStates.preprocessedGeometry = preprocessed;
            
            // Step 4: Perform boolean fusion
            const fused = await this._performFusion(preprocessed, fusionOptions);
            
            // Step 5: Reconstruct arcs if enabled
            let finalGeometry = fused;
            if (fusionOptions.enableArcReconstruction && this.arcReconstructor.registry.size > 0) {
                finalGeometry = this.arcReconstructor.processForReconstruction(fused);
                const stats = this.arcReconstructor.getStats();
                this.debug(`Arc reconstruction: ${stats.reconstructed}/${stats.registered} curves recovered`);
            }
            
            this.cachedStates.fusedGeometry = finalGeometry;
            
            // Update statistics
            this.stats.fusionOperations++;
            this.stats.primitivesProcessed += primitives.length;
            this.stats.primitivesReduced = preprocessed.length - finalGeometry.length;
            
            this.debug(`Fusion complete: ${primitives.length} → ${finalGeometry.length} primitives`);
            
            return finalGeometry;
        }
        
        // Preprocess primitives
        _preprocessPrimitives(primitives, options) {
            const preprocessed = [];
            this.stats.strokesConverted = 0;
            
            for (const primitive of primitives) {
                if (!this._validatePrimitive(primitive)) continue;
                
                // Preserve original index
                const originalIndex = primitive._originalIndex;
                
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
                    processedPrimitive = this._standardizePrimitive(primitive, options);
                }
                
                if (processedPrimitive) {
                    // Preserve the original index through preprocessing
                    processedPrimitive._originalIndex = originalIndex;
                    preprocessed.push(processedPrimitive);
                }
            }
            
            this.debug(`Preprocessing: ${primitives.length} → ${preprocessed.length} (${this.stats.strokesConverted} strokes converted)`);
            return preprocessed;
        }
        
        // Perform boolean fusion
        async _performFusion(primitives, options) {
            // Separate by polarity
            const darkPrimitives = [];
            const clearPrimitives = [];
            
            for (const primitive of primitives) {
                const polarity = primitive.properties?.polarity || 'dark';
                
                // Points should already be tagged with curve IDs from standardization
                // No need for primitive-level tagging here
                
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
            
            // Convert back to primitives
            return result.map(p => this._createPathPrimitive(p.points, {
                ...p.properties,
                holes: p.holes || [],
                curveIds: p.curveIds // Preserve curve IDs through fusion
            }));
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
        
        // FIXED: Standardize primitive with proper curve ID tagging
        _standardizePrimitive(primitive, options) {
            let points = [];
            let arcSegments = [];
            
            // Get curve IDs for this primitive if arc reconstruction is enabled
            const curveIds = (options?.enableArcReconstruction && primitive._originalIndex !== undefined) ?
                this.arcReconstructor.getCurveIdsForPrimitive(primitive._originalIndex) : [];
            
            if (primitive.type === 'path') {
                points = primitive.points;
                // Preserve arc segments from path
                if (primitive.arcSegments) {
                    arcSegments = primitive.arcSegments;
                }
            } else if (primitive.type === 'circle') {
                // FIXED: Pass curve IDs to toPolygon for circles
                if (primitive.toPolygon && typeof primitive.toPolygon === 'function') {
                    const pathPrimitive = primitive.toPolygon(null, null, curveIds);
                    return pathPrimitive;
                } else {
                    const segments = GeometryUtils.getOptimalSegments(primitive.radius);
                    for (let i = 0; i < segments; i++) {
                        const angle = (i / segments) * 2 * Math.PI;
                        points.push({
                            x: primitive.center.x + primitive.radius * Math.cos(angle),
                            y: primitive.center.y + primitive.radius * Math.sin(angle)
                        });
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
                // FIXED: Pass curve IDs to toPolygon for obrounds
                if (primitive.toPolygon && typeof primitive.toPolygon === 'function') {
                    const pathPrimitive = primitive.toPolygon(null, curveIds);
                    return pathPrimitive;
                } else {
                    points = GeometryUtils.obroundToPoints(primitive);
                }
            } else if (primitive.type === 'arc') {
                // FIXED: Pass curve IDs to toPolygon for arcs
                if (primitive.toPolygon && typeof primitive.toPolygon === 'function') {
                    const pathPrimitive = primitive.toPolygon(null, null, curveIds);
                    return pathPrimitive;
                } else {
                    points = GeometryUtils.interpolateArc(
                        primitive.startPoint,
                        primitive.endPoint,
                        primitive.center,
                        primitive.clockwise
                    );
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
                
                return pathPrimitive;
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
                
                return primitive;
            }
            
            return {
                type: 'path',
                points: points,
                properties: properties || {},
                closed: properties?.closed !== false,
                holes: properties?.holes || [],
                arcSegments: properties?.arcSegments || [],
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
                fusedGeometry: null
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
        debug(message) {
            if (this.options.debug) {
                console.log(`[GeometryProcessor] ${message}`);
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