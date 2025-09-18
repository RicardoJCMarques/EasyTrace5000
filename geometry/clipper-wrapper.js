// geometry/clipper-wrapper.js
// Abstraction layer for Clipper2 WASM - isolates all low-level WASM interaction
// ENHANCED: 64-bit metadata packing for lossless arc reconstruction

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
            
            // Metadata packing configuration
            this.metadataPacking = {
                curveIdBits: 24n,      // Bits 0-23: supports 16.7 million curves
                segmentIndexBits: 32n,  // Bits 24-55: supports 4.2 billion points per curve
                reservedBits: 8n        // Bits 56-63: reserved for future use
            };
            
            // Pre-calculate bit masks for efficiency
            this.bitMasks = {
                curveId: (1n << this.metadataPacking.curveIdBits) - 1n,        // 0xFFFFFF
                segmentIndex: (1n << this.metadataPacking.segmentIndexBits) - 1n, // 0xFFFFFFFF
                reserved: (1n << this.metadataPacking.reservedBits) - 1n        // 0xFF
            };
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
                this.log(`Metadata packing: ${24}-bit curveId, ${32}-bit segmentIndex, ${8}-bit reserved`);
                return true;
                
            } catch (error) {
                console.error('Failed to initialize Clipper2:', error);
                this.initialized = false;
                throw error;
            }
        }
        
        // Pack metadata into 64-bit Z coordinate
        packMetadata(curveId, segmentIndex, reserved = 0) {
            if (!curveId || curveId === 0) return BigInt(0);
            
            const packedCurveId = BigInt(curveId) & this.bitMasks.curveId;
            const packedSegmentIndex = BigInt(segmentIndex || 0) & this.bitMasks.segmentIndex;
            const packedReserved = BigInt(reserved) & this.bitMasks.reserved;
            
            // Pack: reserved(8) | segmentIndex(32) | curveId(24)
            const z = packedCurveId | 
                     (packedSegmentIndex << 24n) | 
                     (packedReserved << 56n);
            
            return z;
        }
        
        // Unpack metadata from 64-bit Z coordinate
        unpackMetadata(z) {
            if (!z || z === 0n) {
                return { curveId: 0, segmentIndex: 0, reserved: 0 };
            }
            
            const zBigInt = BigInt(z);
            
            const curveId = Number(zBigInt & this.bitMasks.curveId);
            const segmentIndex = Number((zBigInt >> 24n) & this.bitMasks.segmentIndex);
            const reserved = Number((zBigInt >> 56n) & this.bitMasks.reserved);
            
            return { curveId, segmentIndex, reserved };
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
                    const clipperPath = this._jsPathToClipper(path.points || path, path.curveIds);
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
                        path.curveIds,
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
                        path.curveIds,
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
        
        // Convert JS path to Clipper Path64 with metadata packing
        _jsPathToClipper(points, curveIds = [], polarity = 'dark') {
            const { Path64, Point64, AreaPath64 } = this.clipper2;
            
            if (!points || points.length < 3) return null;
            
            const path = new Path64();
            
            try {
                let metadataPointCount = 0;
                let debugSample = null;
                
                // Add points with metadata packing
                points.forEach((p, index) => {
                    const x = BigInt(Math.round(p.x * this.scale));
                    const y = BigInt(Math.round(p.y * this.scale));
                    
                    // Pack metadata into Z coordinate
                    let z = BigInt(0);
                    if (this.supportsZ) {
                        // Check for point-level metadata
                        if (p.curveId !== undefined && p.curveId !== null && p.curveId > 0) {
                            z = this.packMetadata(
                                p.curveId,
                                p.segmentIndex || 0,
                                0 // reserved
                            );
                            metadataPointCount++;
                            
                            // Capture first tagged point for debug
                            if (!debugSample && this.debug) {
                                debugSample = {
                                    index,
                                    curveId: p.curveId,
                                    segmentIndex: p.segmentIndex || 0,
                                    packedZ: z.toString(16)
                                };
                            }
                        }
                        // Fallback to primitive-level curve IDs if no point-level data
                        else if (curveIds && curveIds[index] !== undefined) {
                            z = this.packMetadata(
                                curveIds[index],
                                index,
                                0
                            );
                            metadataPointCount++;
                        }
                    }
                    
                    const point = new Point64(x, y, z);
                    path.push_back(point);
                    point.delete();
                });
                
                if (this.debug && metadataPointCount > 0) {
                    this.log(`Packed metadata for ${metadataPointCount}/${points.length} points`);
                    if (debugSample) {
                        this.log(`Sample: Point ${debugSample.index} - curveId=${debugSample.curveId}, segmentIndex=${debugSample.segmentIndex}, Z=0x${debugSample.packedZ}`);
                    }
                }
                
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
        
        // Convert Clipper PolyTree to JS primitives with metadata unpacking
        _polyTreeToJS(polyNode) {
            const primitives = [];
            
            const traverse = (node, isHole) => {
                const polygon = node.polygon();
                
                if (polygon && polygon.size() > 2) {
                    const points = [];
                    const curveIds = new Set();
                    const metadataMap = new Map(); // Track metadata statistics
                    
                    for (let i = 0; i < polygon.size(); i++) {
                        const pt = polygon.get(i);
                        const point = {
                            x: Number(pt.x) / this.scale,
                            y: Number(pt.y) / this.scale
                        };
                        
                        // Extract and unpack metadata from Z
                        if (this.supportsZ && pt.z !== undefined) {
                            const z = BigInt(pt.z);
                            
                            if (z > 0n) {
                                const metadata = this.unpackMetadata(z);
                                
                                if (metadata.curveId > 0) {
                                    point.curveId = metadata.curveId;
                                    point.segmentIndex = metadata.segmentIndex;
                                    // Reserved field available as metadata.reserved for future use
                                    
                                    curveIds.add(metadata.curveId);
                                    
                                    // Track metadata for debugging
                                    if (!metadataMap.has(metadata.curveId)) {
                                        metadataMap.set(metadata.curveId, {
                                            count: 0,
                                            minIndex: metadata.segmentIndex,
                                            maxIndex: metadata.segmentIndex
                                        });
                                    }
                                    const stats = metadataMap.get(metadata.curveId);
                                    stats.count++;
                                    stats.minIndex = Math.min(stats.minIndex, metadata.segmentIndex);
                                    stats.maxIndex = Math.max(stats.maxIndex, metadata.segmentIndex);
                                }
                            }
                        }
                        
                        points.push(point);
                    }
                    
                    if (this.debug && metadataMap.size > 0) {
                        this.log(`Unpacked metadata for polygon with ${points.length} points:`);
                        metadataMap.forEach((stats, curveId) => {
                            this.log(`  Curve ${curveId}: ${stats.count} points, indices ${stats.minIndex}-${stats.maxIndex}`);
                        });
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
                            primitive.hasReconstructableCurves = true;
                        }
                        
                        // Process children as holes
                        for (let i = 0; i < node.count(); i++) {
                            const child = node.child(i);
                            const childPolygon = child.polygon();
                            
                            if (childPolygon && childPolygon.size() > 2) {
                                const holePoints = [];
                                const holeCurveIds = new Set();
                                
                                for (let j = 0; j < childPolygon.size(); j++) {
                                    const pt = childPolygon.get(j);
                                    const holePoint = {
                                        x: Number(pt.x) / this.scale,
                                        y: Number(pt.y) / this.scale
                                    };
                                    
                                    // Unpack metadata for hole points
                                    if (this.supportsZ && pt.z !== undefined) {
                                        const z = BigInt(pt.z);
                                        if (z > 0n) {
                                            const metadata = this.unpackMetadata(z);
                                            if (metadata.curveId > 0) {
                                                holePoint.curveId = metadata.curveId;
                                                holePoint.segmentIndex = metadata.segmentIndex;
                                                holeCurveIds.add(metadata.curveId);
                                            }
                                        }
                                    }
                                    
                                    holePoints.push(holePoint);
                                }
                                
                                primitive.holes.push(holePoints);
                                
                                // Store hole curve IDs for potential reconstruction
                                if (holeCurveIds.size > 0) {
                                    if (!primitive.holeCurveIds) {
                                        primitive.holeCurveIds = [];
                                    }
                                    primitive.holeCurveIds.push(Array.from(holeCurveIds));
                                }
                                
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
            
            if (this.debug && primitives.length > 0) {
                const totalWithCurves = primitives.filter(p => p.curveIds && p.curveIds.length > 0).length;
                this.log(`Extracted ${primitives.length} primitives, ${totalWithCurves} with curve metadata`);
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
                scale: this.scale,
                metadataPacking: {
                    curveIdBits: Number(this.metadataPacking.curveIdBits),
                    segmentIndexBits: Number(this.metadataPacking.segmentIndexBits),
                    reservedBits: Number(this.metadataPacking.reservedBits),
                    maxCurveId: Number(this.bitMasks.curveId),
                    maxSegmentIndex: Number(this.bitMasks.segmentIndex)
                }
            };
        }
        
        // Test metadata packing/unpacking
        testMetadataPacking() {
            const testCases = [
                { curveId: 1, segmentIndex: 0, reserved: 0 },
                { curveId: 100, segmentIndex: 42, reserved: 0 },
                { curveId: 16777215, segmentIndex: 4294967295, reserved: 255 }, // Max values
                { curveId: 12345, segmentIndex: 67890, reserved: 7 }
            ];
            
            console.log('[ClipperWrapper] Testing metadata packing/unpacking:');
            
            for (const test of testCases) {
                const packed = this.packMetadata(test.curveId, test.segmentIndex, test.reserved);
                const unpacked = this.unpackMetadata(packed);
                
                const success = unpacked.curveId === test.curveId &&
                               unpacked.segmentIndex === test.segmentIndex &&
                               unpacked.reserved === test.reserved;
                
                console.log(`  Test: curveId=${test.curveId}, segmentIndex=${test.segmentIndex}, reserved=${test.reserved}`);
                console.log(`  Packed: 0x${packed.toString(16)}`);
                console.log(`  Unpacked: curveId=${unpacked.curveId}, segmentIndex=${unpacked.segmentIndex}, reserved=${unpacked.reserved}`);
                console.log(`  Result: ${success ? 'PASS' : 'FAIL'}`);
            }
        }
    }
    
    // Export
    window.ClipperWrapper = ClipperWrapper;
    
})();