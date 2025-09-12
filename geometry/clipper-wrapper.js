// geometry/clipper-wrapper.js
// Abstraction layer for Clipper2 WASM - isolates all low-level WASM interaction

(function() {
    'use strict';
    
    class ClipperWrapper {
        constructor(options = {}) {
            this.scale = options.scale || 10000;
            this.debug = options.debug || false;
            
            this.clipper2 = null;
            this.initialized = false;
            this.supportsZ = false;
            
            // Track allocated WASM objects for cleanup
            this.allocatedObjects = [];
        }
        
        async initialize() {
            if (this.initialized) return true;
            
            try {
                if (typeof Clipper2ZFactory === 'undefined') {
                    throw new Error('Clipper2ZFactory not found');
                }
                
                const clipper2Core = await Clipper2ZFactory();
                if (!clipper2Core) {
                    throw new Error('Failed to load Clipper2 core module');
                }
                
                this.clipper2 = clipper2Core;
                
                // Verify required APIs
                const requiredAPIs = [
                    'Paths64', 'Path64', 'Point64', 'Clipper64',
                    'ClipType', 'FillRule', 'PolyPath64', 'AreaPath64'
                ];
                
                for (const api of requiredAPIs) {
                    if (!this.clipper2[api]) {
                        throw new Error(`Required Clipper2 API '${api}' not found`);
                    }
                }
                
                // Check Z coordinate support
                const testPoint = new this.clipper2.Point64(BigInt(0), BigInt(0), BigInt(1));
                this.supportsZ = testPoint.z !== undefined;
                testPoint.delete();
                
                this.initialized = true;
                this.log(`Clipper2 initialized (Z support: ${this.supportsZ})`);
                return true;
                
            } catch (error) {
                console.error('Failed to initialize Clipper2:', error);
                this.initialized = false;
                throw error;
            }
        }
        
        // Union multiple paths into merged regions
        async union(paths, fillRule = 'nonzero') {
            await this.ensureInitialized();
            
            const { Paths64, ClipType, FillRule, Clipper64, PolyPath64 } = this.clipper2;
            const objects = [];
            
            try {
                const input = new Paths64();
                objects.push(input);
                
                // Convert JS paths to Clipper paths
                paths.forEach(path => {
                    const clipperPath = this._jsPathToClipper(path.points || path, path.curveId);
                    if (clipperPath) {
                        input.push_back(clipperPath);
                        objects.push(clipperPath);
                    }
                });
                
                const clipper = new Clipper64();
                const solution = new PolyPath64();
                objects.push(clipper, solution);
                
                clipper.AddSubject(input);
                
                const fr = fillRule === 'evenodd' ? FillRule.EvenOdd : FillRule.NonZero;
                const success = clipper.ExecutePoly(ClipType.Union, fr, solution);
                
                if (!success) {
                    this.log('Union operation failed');
                    return [];
                }
                
                return this._polyTreeToJS(solution);
                
            } finally {
                this._cleanup(objects);
            }
        }
        
        // Difference operation (subtract clipPaths from subjectPaths)
        async difference(subjectPaths, clipPaths, fillRule = 'nonzero') {
            await this.ensureInitialized();
            
            const { Paths64, ClipType, FillRule, Clipper64, PolyPath64 } = this.clipper2;
            const objects = [];
            
            try {
                const subjects = new Paths64();
                const clips = new Paths64();
                objects.push(subjects, clips);
                
                // Add subject paths (ensure CCW for positive)
                subjectPaths.forEach(path => {
                    const clipperPath = this._jsPathToClipper(
                        path.points || path,
                        path.curveId,
                        'dark'
                    );
                    if (clipperPath) {
                        subjects.push_back(clipperPath);
                        objects.push(clipperPath);
                    }
                });
                
                // Add clip paths (ensure CW for negative)
                clipPaths.forEach(path => {
                    const clipperPath = this._jsPathToClipper(
                        path.points || path,
                        path.curveId,
                        'clear'
                    );
                    if (clipperPath) {
                        clips.push_back(clipperPath);
                        objects.push(clipperPath);
                    }
                });
                
                const clipper = new Clipper64();
                const solution = new PolyPath64();
                objects.push(clipper, solution);
                
                if (subjects.size() > 0) clipper.AddSubject(subjects);
                if (clips.size() > 0) clipper.AddClip(clips);
                
                const fr = fillRule === 'evenodd' ? FillRule.EvenOdd : FillRule.NonZero;
                const success = clipper.ExecutePoly(ClipType.Difference, fr, solution);
                
                if (!success) {
                    this.log('Difference operation failed');
                    return [];
                }
                
                return this._polyTreeToJS(solution);
                
            } finally {
                this._cleanup(objects);
            }
        }
        
        // Convert JS path to Clipper Path64
        _jsPathToClipper(points, curveId = 0, polarity = 'dark') {
            const { Path64, Point64, AreaPath64 } = this.clipper2;
            
            if (!points || points.length < 3) return null;
            
            const path = new Path64();
            
            try {
                // Add points with optional curve ID in Z
                points.forEach(p => {
                    const x = BigInt(Math.round(p.x * this.scale));
                    const y = BigInt(Math.round(p.y * this.scale));
                    const z = this.supportsZ ? BigInt(curveId || 0) : BigInt(0);
                    
                    const point = new Point64(x, y, z);
                    path.push_back(point);
                    point.delete();
                });
                
                // Check and fix winding based on polarity
                const area = AreaPath64(path);
                const isClockwise = area < 0;
                
                const needsReversal = 
                    (polarity === 'dark' && isClockwise) ||
                    (polarity === 'clear' && !isClockwise);
                
                if (needsReversal) {
                    const reversed = new Path64();
                    for (let i = path.size() - 1; i >= 0; i--) {
                        reversed.push_back(path.get(i));
                    }
                    path.delete();
                    return reversed;
                }
                
                return path;
                
            } catch (error) {
                console.error('Error converting path to Clipper:', error);
                path.delete();
                return null;
            }
        }
        
        // Convert Clipper PolyTree to JS primitives
        _polyTreeToJS(polyNode) {
            const primitives = [];
            
            const traverse = (node, isHole) => {
                const polygon = node.polygon();
                
                if (polygon && polygon.size() > 2) {
                    const points = [];
                    const curveIds = new Set();
                    
                    for (let i = 0; i < polygon.size(); i++) {
                        const pt = polygon.get(i);
                        const point = {
                            x: Number(pt.x) / this.scale,
                            y: Number(pt.y) / this.scale
                        };
                        
                        // Extract curve ID from Z if supported
                        if (this.supportsZ && pt.z !== undefined) {
                            const curveId = Number(pt.z);
                            if (curveId > 0) {
                                point.curveId = curveId;
                                curveIds.add(curveId);
                            }
                        }
                        
                        points.push(point);
                    }
                    
                    if (!isHole) {
                        // Create proper PathPrimitive
                        const primitive = this._createPathPrimitive(points, {
                            isFused: true,
                            fill: true,
                            polarity: 'dark',
                            closed: true
                        });
                        
                        if (curveIds.size > 0) {
                            primitive.curveIds = Array.from(curveIds);
                        }
                        
                        // Process children as holes
                        for (let i = 0; i < node.count(); i++) {
                            const child = node.child(i);
                            const childPolygon = child.polygon();
                            
                            if (childPolygon && childPolygon.size() > 2) {
                                const holePoints = [];
                                for (let j = 0; j < childPolygon.size(); j++) {
                                    const pt = childPolygon.get(j);
                                    const holePoint = {
                                        x: Number(pt.x) / this.scale,
                                        y: Number(pt.y) / this.scale
                                    };
                                    
                                    if (this.supportsZ && pt.z !== undefined) {
                                        const curveId = Number(pt.z);
                                        if (curveId > 0) {
                                            holePoint.curveId = curveId;
                                        }
                                    }
                                    
                                    holePoints.push(holePoint);
                                }
                                primitive.holes.push(holePoints);
                                
                                // Recursively process hole's children (islands)
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
            
            // Start from root's children
            for (let i = 0; i < polyNode.count(); i++) {
                const result = traverse(polyNode.child(i), false);
                if (result) {
                    primitives.push(...result);
                }
            }
            
            return primitives;
        }
        
        // Helper to create PathPrimitive with getBounds method
        _createPathPrimitive(points, properties) {
            // Try to use PathPrimitive class if available
            if (typeof PathPrimitive !== 'undefined') {
                return new PathPrimitive(points, properties);
            }
            
            // Fallback with getBounds method
            return {
                type: 'path',
                points: points,
                properties: properties || {},
                closed: properties?.closed !== false,
                holes: [],
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
        
        // Ensure initialized
        async ensureInitialized() {
            if (!this.initialized) {
                await this.initialize();
            }
            if (!this.initialized) {
                throw new Error('Clipper2 not initialized');
            }
        }
        
        // Clean up WASM objects
        _cleanup(objects) {
            objects.forEach(obj => {
                try {
                    if (obj && typeof obj.delete === 'function' && !obj.isDeleted()) {
                        obj.delete();
                    }
                } catch (e) {
                    // Ignore cleanup errors
                }
            });
        }
        
        // Debug logging
        log(message, data = null) {
            if (this.debug) {
                if (data) {
                    console.log(`[ClipperWrapper] ${message}`, data);
                } else {
                    console.log(`[ClipperWrapper] ${message}`);
                }
            }
        }
        
        // Get capabilities
        getCapabilities() {
            return {
                initialized: this.initialized,
                supportsZ: this.supportsZ,
                scale: this.scale
            };
        }
    }
    
    // Export
    window.ClipperWrapper = ClipperWrapper;
    
})();