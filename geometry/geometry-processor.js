// geometry/geometry-processor2.js
// Clipper2 WASM-based geometry processor with polarity-aware winding
// Handles boolean operations with proper dark/clear separation
// FIXED: Enhanced debugging and validation for fusion operations
(function() {
    'use strict';
    
    // Check for required primitive classes
    const requiredClasses = ['PathPrimitive', 'CirclePrimitive', 'RectanglePrimitive'];
    let missingClasses = [];

    requiredClasses.forEach(className => {
        if (typeof window[className] === 'undefined') {
            missingClasses.push(className);
        }
    });

    if (missingClasses.length > 0) {
        console.warn('[GeometryProcessor] Missing primitive classes:', missingClasses);
        console.warn('[GeometryProcessor] Will use generic path primitives as fallback');
    }

    class GeometryProcessor {
        constructor(options = {}) {
            this.options = {
                debug: options.debug || false,
                scale: options.scale || 1000, // Use 1000 like test page, not 10000
                preserveOriginals: true,
                skipInit: options.skipInit || false,
                ...options
            };

            this.clipper2 = null;
            this.initialized = false;
            this.initializationError = null;
            this.stats = { 
                fusionOperations: 0, 
                primitivesProcessed: 0, 
                primitivesReduced: 0, 
                errors: 0,
                darkPrimitives: 0,
                clearPrimitives: 0,
                holesDetected: 0,
                invalidPrimitives: 0,
                emptyPrimitives: 0,
                convertedPrimitives: 0
            };

            if (!this.options.skipInit) {
                this.initPromise = this.initializeClipper2();
            } else {
                this.initPromise = Promise.resolve(false);
            }
            this.debug('GeometryProcessor created with polarity support');
        }

        async initializeClipper2() {
            this.debug('Initializing Clipper2 WASM modules...');
            try {
                if (typeof Clipper2ZFactory === 'undefined') {
                    throw new Error('Clipper2ZFactory not found');
                }
                const clipper2Core = await Clipper2ZFactory();
                if (!clipper2Core) {
                    throw new Error('Failed to load Clipper2 core module');
                }
                this.clipper2 = clipper2Core;
                
                // Check for all required APIs
                const requiredAPIs = ['Paths64', 'Path64', 'Point64', 'Union64', 'Difference64', 
                                     'FillRule', 'AreaPath64', 'Clipper64', 'ClipType', 'PolyPath64'];
                for (const api of requiredAPIs) {
                    if (!this.clipper2[api]) throw new Error(`Required Clipper2 API '${api}' not found`);
                }
                
                this.initialized = true;
                this.debug('✅ Clipper2 WASM initialized with polarity support');
                return true;
            } catch (error) {
                console.error('[GeometryProcessor] Failed to initialize Clipper2:', error);
                this.initialized = false;
                this.initializationError = error;
                return false;
            }
        }
        
        async ensureInitialized() {
            if (!this.initialized) await this.initPromise;
            if (!this.initialized) throw new Error(this.initializationError?.message || 'Clipper2 not initialized');
        }

        /**
         * Create Path64 with proper coordinate conversion and winding enforcement
         * This matches the test page's approach
         */
        _makePath64(coords, polarity = 'dark') {
            const { Path64, Point64, AreaPath64 } = this.clipper2;
            
            let path = new Path64();
            
            try {
                // Add all points to the path
                let pointCount = 0;
                for (let i = 0; i < coords.length; i += 2) {
                    if (i + 1 < coords.length) {
                        const point = new Point64(
                            BigInt(coords[i]), 
                            BigInt(coords[i + 1]), 
                            BigInt(0)
                        );
                        path.push_back(point);
                        point.delete();
                        pointCount++;
                    }
                }
                
                if (pointCount < 3) {
                    this.debug(`WARNING: Path has only ${pointCount} points, skipping`);
                    path.delete();
                    return null;
                }
                
                // Calculate signed area using Clipper2's built-in function
                const area = AreaPath64(path);
                
                // In Clipper2: positive area = CCW, negative area = CW
                const isClockwise = area < 0;
                
                // Determine if we need to reverse based on polarity
                const needsReversal = 
                    (polarity === 'dark' && isClockwise) ||    // Dark must be CCW (positive area)
                    (polarity === 'clear' && !isClockwise);     // Clear must be CW (negative area)
                
                if (needsReversal) {
                    // Create reversed path
                    const reversed = new Path64();
                    for (let i = path.size() - 1; i >= 0; i--) {
                        reversed.push_back(path.get(i));
                    }
                    path.delete();
                    path = reversed;
                    
                    if (this.options.debug) {
                        this.debug(`Reversed winding for ${polarity} primitive (area was ${area})`);
                    }
                }
                
                return path;
                
            } catch (e) {
                console.error('Error creating Path64:', e);
                if (path) path.delete();
                throw e;
            }
        }

        async fuseGeometry(primitives) {
            await this.ensureInitialized();
            if (!primitives || primitives.length === 0) return [];

            this.debug(`Starting Clipper2 fusion of ${primitives.length} primitives`);
            this.stats.fusionOperations++;
            this.stats.primitivesProcessed += primitives.length;

            const wasmObjects = [];
            try {
                const { Paths64, ClipType, FillRule, Clipper64, PolyPath64 } = this.clipper2;
                
                // Separate paths by polarity
                const darkPaths = new Paths64();
                const clearPaths = new Paths64();
                wasmObjects.push(darkPaths);
                wasmObjects.push(clearPaths);

                let darkCount = 0;
                let clearCount = 0;
                let skippedCount = 0;
                
                // Process each primitive based on its polarity
                for (let i = 0; i < primitives.length; i++) {
                    const primitive = primitives[i];
                    
                    // Validate primitive
                    if (!this.validatePrimitiveForFusion(primitive, i)) {
                        skippedCount++;
                        continue;
                    }
                    
                    const result = this.primitiveToCoordinates(primitive);
                    
                    if (!result || !result.coords || result.coords.length < 6) {
                        this.debug(`WARNING: Primitive ${i} produced invalid coordinates`);
                        this.stats.invalidPrimitives++;
                        skippedCount++;
                        continue;
                    }
                    
                    try {
                        // Create path with polarity-aware winding
                        const path64 = this._makePath64(result.coords, result.polarity);
                        
                        if (!path64) {
                            this.debug(`WARNING: Failed to create Path64 for primitive ${i}`);
                            this.stats.emptyPrimitives++;
                            skippedCount++;
                            continue;
                        }
                        
                        // Add to appropriate container based on polarity
                        if (result.polarity === 'clear') {
                            clearPaths.push_back(path64);
                            clearCount++;
                            if (this.options.debug) {
                                this.debug(`Added clear primitive ${i} to subtraction set`);
                            }
                        } else {
                            darkPaths.push_back(path64);
                            darkCount++;
                            if (this.options.debug) {
                                this.debug(`Added dark primitive ${i} to union set`);
                            }
                        }
                        
                        path64.delete();
                    } catch (e) {
                        console.error(`Failed to create Path64 for primitive ${i}:`, primitive, "Error:", e);
                        this.stats.errors++;
                        skippedCount++;
                    }
                }

                this.stats.darkPrimitives = darkCount;
                this.stats.clearPrimitives = clearCount;
                
                console.log(`[GeometryProcessor] Fusion input summary:`);
                console.log(`  Total primitives: ${primitives.length}`);
                console.log(`  Dark primitives: ${darkCount}`);
                console.log(`  Clear primitives: ${clearCount}`);
                console.log(`  Skipped/Invalid: ${skippedCount}`);

                // Use Clipper64 with PolyTree for proper hole handling
                const clipper = new Clipper64();
                const solutionPoly = new PolyPath64();
                wasmObjects.push(clipper);
                wasmObjects.push(solutionPoly);
                
                let fusedPrimitives = [];
                
                if (darkCount > 0 && clearCount === 0) {
                    // Only dark regions - simple union
                    console.log('[GeometryProcessor] Performing union of dark regions only');
                    clipper.AddSubject(darkPaths);
                    const success = clipper.ExecutePoly(ClipType.Union, FillRule.NonZero, solutionPoly);
                    
                    if (success) {
                        fusedPrimitives = this.polyTreeToPrimitives(solutionPoly);
                        console.log(`[GeometryProcessor] Union successful: ${fusedPrimitives.length} output primitives`);
                    } else {
                        console.error('[GeometryProcessor] Union operation failed');
                    }
                    
                } else if (darkCount > 0 && clearCount > 0) {
                    // Both dark and clear - union dark first, then subtract clear
                    console.log('[GeometryProcessor] Processing dark and clear regions with PolyTree');
                    clipper.AddSubject(darkPaths);
                    clipper.AddClip(clearPaths);
                    const success = clipper.ExecutePoly(ClipType.Difference, FillRule.NonZero, solutionPoly);
                    
                    if (success) {
                        fusedPrimitives = this.polyTreeToPrimitives(solutionPoly);
                        console.log(`[GeometryProcessor] Difference successful: ${fusedPrimitives.length} output primitives`);
                    } else {
                        console.error('[GeometryProcessor] Difference operation failed');
                    }
                    
                } else if (clearCount > 0) {
                    // Only clear regions - unusual but possible
                    console.log('[GeometryProcessor] Warning: Only clear regions found, returning empty');
                    // Return empty array
                    
                } else {
                    // No valid primitives
                    console.log('[GeometryProcessor] No valid primitives to fuse');
                    return [];
                }

                this.stats.primitivesReduced = (darkCount + clearCount) - fusedPrimitives.length;
                
                console.log(`[GeometryProcessor] Fusion complete:`);
                console.log(`  Input: ${darkCount + clearCount} primitives`);
                console.log(`  Output: ${fusedPrimitives.length} primitives`);
                console.log(`  Reduction: ${this.stats.primitivesReduced} primitives`);
                
                // Debug: Check for holes in result
                let holesFound = 0;
                fusedPrimitives.forEach((prim, idx) => {
                    if (prim.holes && prim.holes.length > 0) {
                        holesFound += prim.holes.length;
                        console.log(`[GeometryProcessor] Primitive ${idx} contains ${prim.holes.length} holes`);
                    }
                });
                if (holesFound > 0) {
                    this.stats.holesDetected = holesFound;
                    console.log(`[GeometryProcessor] Total holes detected: ${holesFound}`);
                }
                
                return fusedPrimitives;

            } catch (error) {
                console.error('[GeometryProcessor] Clipper2 fusion failed:', error);
                this.stats.errors++;
                return primitives;
            } finally {
                this.cleanupWasmObjects(wasmObjects);
            }
        }

        /**
         * Validate primitive before fusion
         */
        validatePrimitiveForFusion(primitive, index) {
            // Check basic structure
            if (!primitive) {
                this.debug(`WARNING: Primitive ${index} is null/undefined`);
                return false;
            }
            
            // Check for properties
            if (!primitive.properties) {
                this.debug(`WARNING: Primitive ${index} missing properties`);
                return false;
            }
            
            // Check polarity
            const polarity = primitive.properties.polarity;
            if (polarity !== 'dark' && polarity !== 'clear') {
                this.debug(`WARNING: Primitive ${index} has invalid polarity: ${polarity}, defaulting to 'dark'`);
                primitive.properties.polarity = 'dark';
            }
            
            // Special handling for different primitive types
            if (primitive.type === 'path') {
                if (!primitive.points || !Array.isArray(primitive.points) || primitive.points.length < 2) {
                    this.debug(`WARNING: Path primitive ${index} has invalid points`);
                    return false;
                }
                
                // Skip stroked paths for fusion (they should be converted to filled polygons)
                if (primitive.properties.stroke && !primitive.properties.fill) {
                    this.debug(`INFO: Converting stroked path ${index} to filled polygon for fusion`);
                    this.stats.convertedPrimitives++;
                    // The conversion happens in primitiveToCoordinates
                }
            }
            
            return true;
        }

        /**
         * Convert primitive to coordinates with polarity extraction
         * CRITICAL: Must return both coords AND polarity
         * FIXED: Better handling of stroked paths
         */
        primitiveToCoordinates(primitive) {
            const scale = this.options.scale;
            const coords = [];
            
            // Extract polarity - CRITICAL
            const polarity = primitive.properties?.polarity || 'dark';

            try {
                if (!primitive) return { coords: null, polarity };

                const addPoint = (x, y) => {
                    if (Number.isFinite(x) && Number.isFinite(y)) {
                        coords.push(Math.round(x * scale));
                        coords.push(Math.round(y * scale));
                    } else {
                        this.debug('WARNING: Skipping invalid coordinate:', { x, y });
                    }
                };
                
                // Handle different primitive types
                if (primitive.type === 'path' && primitive.points) {
                    // Check if this is a stroked path that needs conversion
                    if (primitive.properties?.stroke && primitive.properties?.strokeWidth && !primitive.properties?.fill) {
                        // Convert stroked path to filled polygon
                        const strokeWidth = primitive.properties.strokeWidth;
                        
                        // For simple lines, create a rectangle around the stroke
                        if (primitive.points.length === 2) {
                            const p1 = primitive.points[0];
                            const p2 = primitive.points[1];
                            const dx = p2.x - p1.x;
                            const dy = p2.y - p1.y;
                            const len = Math.sqrt(dx * dx + dy * dy);
                            
                            if (len > 0) {
                                // Unit perpendicular vector
                                const nx = -dy / len * strokeWidth / 2;
                                const ny = dx / len * strokeWidth / 2;
                                
                                // Create rectangle points
                                addPoint(p1.x + nx, p1.y + ny);
                                addPoint(p2.x + nx, p2.y + ny);
                                addPoint(p2.x - nx, p2.y - ny);
                                addPoint(p1.x - nx, p1.y - ny);
                            }
                        } else {
                            // For complex paths, just use the points as-is
                            // (proper stroke expansion would require more complex algorithm)
                            primitive.points.forEach(point => {
                                if (point) addPoint(point.x, point.y);
                            });
                        }
                    } else {
                        // Regular filled path
                        primitive.points.forEach(point => {
                            if (point) addPoint(point.x, point.y);
                        });
                    }
                } else if (primitive.type === 'circle' && primitive.center && primitive.radius > 0) {
                    const segments = this.getOptimalCircleSegments(primitive.radius);
                    for (let i = 0; i < segments; i++) {
                        const angle = (i / segments) * 2 * Math.PI;
                        const x = primitive.center.x + primitive.radius * Math.cos(angle);
                        const y = primitive.center.y + primitive.radius * Math.sin(angle);
                        addPoint(x, y);
                    }
                } else if (primitive.type === 'arc' && primitive.center && primitive.radius > 0) {
                    const segments = this.getOptimalCircleSegments(primitive.radius);
                    const angleSweep = primitive.endAngle - primitive.startAngle;
                    const arcSegments = Math.max(2, Math.ceil(segments * (Math.abs(angleSweep) / (2 * Math.PI))));
                    for (let i = 0; i <= arcSegments; i++) {
                        const angle = primitive.startAngle + (angleSweep * i / arcSegments);
                        const x = primitive.center.x + primitive.radius * Math.cos(angle);
                        const y = primitive.center.y + primitive.radius * Math.sin(angle);
                        addPoint(x, y);
                    }
                } else if (primitive.type === 'rectangle' && primitive.position) {
                    const { x, y } = primitive.position;
                    const w = primitive.width || 0;
                    const h = primitive.height || 0;
                    addPoint(x, y); 
                    addPoint(x + w, y); 
                    addPoint(x + w, y + h); 
                    addPoint(x, y + h);
                } else if (primitive.type === 'obround' && primitive.position) {
                    const points = this.obroundToPoints(primitive);
                    points.forEach(point => addPoint(point.x, point.y));
                }

                // Debug output for converted coordinates
                if (this.options.debug && coords.length > 0) {
                    this.debug(`Converted ${primitive.type} to ${coords.length / 2} points, polarity: ${polarity}`);
                }

                // Return both coordinates AND polarity
                return { coords, polarity };
                
            } catch (error) {
                this.debug('Error converting primitive to coordinates:', error, primitive);
                return { coords: null, polarity };
            }
        }

        /**
         * Convert PolyTree to primitives with proper hole handling
         */
        polyTreeToPrimitives(polyNode) {
            const scale = this.options.scale;
            const primitives = [];

            // Recursive helper function to traverse the tree
            const traverse = (node, isHole) => {
                const polygon = node.polygon();
                
                if (polygon && polygon.size() > 2) {
                    const points = [];
                    for (let i = 0; i < polygon.size(); i++) {
                        const pt = polygon.get(i);
                        points.push({ x: Number(pt.x) / scale, y: Number(pt.y) / scale });
                    }

                    if (!isHole) {
                        // This is an outer boundary
                        const primitive = this.createPathPrimitive(points, {
                            isFused: true,
                            fill: true,
                            closed: true,
                            polarity: 'dark',
                            holes: []
                        });

                        // Process children as holes
                        for (let i = 0; i < node.count(); i++) {
                            const child = node.child(i);
                            const childPolygon = child.polygon();
                            
                            if (childPolygon && childPolygon.size() > 2) {
                                const holePoints = [];
                                for (let j = 0; j < childPolygon.size(); j++) {
                                    const pt = childPolygon.get(j);
                                    holePoints.push({ x: Number(pt.x) / scale, y: Number(pt.y) / scale });
                                }
                                primitive.holes.push(holePoints);
                                
                                // Process hole's children (islands within holes) recursively
                                for (let k = 0; k < child.count(); k++) {
                                    const grandchildren = traverse(child.child(k), false);
                                    if (grandchildren) {
                                        primitives.push(...grandchildren);
                                    }
                                }
                            }
                        }
                        
                        return [primitive];
                    }
                }
                
                // Process children
                const childPrimitives = [];
                for (let i = 0; i < node.count(); i++) {
                    const children = traverse(node.child(i), !isHole);
                    if (children) {
                        childPrimitives.push(...children);
                    }
                }
                
                return childPrimitives.length > 0 ? childPrimitives : null;
            };

            // Start traversing from the root's children
            for (let i = 0; i < polyNode.count(); i++) {
                const result = traverse(polyNode.child(i), false);
                if (result) {
                    primitives.push(...result);
                }
            }

            return primitives;
        }

        getOptimalCircleSegments(radius, minSegments = 16, maxSegments = 128) {
            const targetSegmentLength = 0.1;
            if (radius <= 0) return minSegments;
            const circumference = 2 * Math.PI * radius;
            const desiredSegments = Math.ceil(circumference / targetSegmentLength);
            return Math.max(minSegments, Math.min(maxSegments, desiredSegments));
        }

        obroundToPoints(obround) {
            const points = [];
            const { x, y } = obround.position;
            const w = obround.width || 0;
            const h = obround.height || 0;
            const r = Math.min(w, h) / 2;
            if (r <= 0) return [];
            const segments = this.getOptimalCircleSegments(r, 8, 32);
            const halfSegments = Math.ceil(segments / 2);

            if (w > h) { // Horizontal
                const c1x = x + r; const c2x = x + w - r; const cy = y + r;
                for (let i = 0; i <= halfSegments; i++) {
                    const angle = Math.PI / 2 + (i / halfSegments) * Math.PI;
                    points.push({ x: c1x + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
                }
                for (let i = 0; i <= halfSegments; i++) {
                    const angle = -Math.PI / 2 + (i / halfSegments) * Math.PI;
                    points.push({ x: c2x + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
                }
            } else { // Vertical
                const cx = x + r; const c1y = y + r; const c2y = y + h - r;
                for (let i = 0; i <= halfSegments; i++) {
                    const angle = Math.PI + (i / halfSegments) * Math.PI;
                    points.push({ x: cx + r * Math.cos(angle), y: c1y + r * Math.sin(angle) });
                }
                for (let i = 0; i <= halfSegments; i++) {
                    const angle = (i / halfSegments) * Math.PI;
                    points.push({ x: cx + r * Math.cos(angle), y: c2y + r * Math.sin(angle) });
                }
            }
            return points;
        }

        createPathPrimitive(points, properties) {
            if (typeof PathPrimitive !== 'undefined') {
                return new PathPrimitive(points, properties);
            }
            return {
                type: 'path', points, properties, closed: properties.closed !== false,
                holes: properties.holes || [],
                getBounds: function() {
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    this.points.forEach(p => {
                        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
                        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
                    });
                    // Include holes in bounds
                    if (this.holes && this.holes.length > 0) {
                        this.holes.forEach(hole => {
                            hole.forEach(p => {
                                minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
                                maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
                            });
                        });
                    }
                    return { minX, minY, maxX, maxY };
                }
            };
        }

        cleanupWasmObjects(objects) {
            objects.forEach(obj => {
                try {
                    if (obj && !obj.isDeleted()) obj.delete();
                } catch (e) { /* ignore */ }
            });
        }

        debug(message, ...args) {
            if (this.options.debug) {
                console.log('[GeometryProcessor]', message, ...args);
            }
        }
        
        getStats() { 
            return { ...this.stats, initialized: this.initialized }; 
        }

        // Prepare geometry for offset generation (placeholder for future implementation)
        prepareForOffset(primitives) {
            console.log('[GeometryProcessor] Offset preparation not yet implemented');
            return primitives;
        }

        // Generate offset geometry (placeholder for future implementation)
        generateOffset(geometry, offsetDistance, options = {}) {
            console.log('[GeometryProcessor] Offset generation not yet implemented');
            return [];
        }
    }

    window.GeometryProcessor = GeometryProcessor;

})();