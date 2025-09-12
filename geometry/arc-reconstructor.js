// geometry/arc-reconstructor.js
// Consolidated arc detection and reconstruction for boolean operations

(function() {
    'use strict';
    
    class ArcReconstructor {
        constructor(options = {}) {
            this.debug = options.debug || false;
            this.tolerance = options.tolerance || 0.01;
            this.scale = options.scale || 10000;
            
            // Enhanced tolerance for noisy data
            this.noiseTolerance = options.noiseTolerance || 0.05;
            this.minArcPoints = 5; // Minimum points to consider arc reconstruction
            this.maxGapRatio = 0.3; // Maximum gap in arc coverage to still reconstruct
            
            // Enhanced curve registry
            this.registry = new Map();
            this.nextId = 1;
            
            // Mapping from primitive index to curve IDs
            this.primitiveIndexToCurves = new Map();
            
            // Statistics
            this.stats = {
                detected: 0,
                registered: 0,
                reconstructed: 0,
                failed: 0,
                pathsWithCurves: 0,
                pointsWithCurves: 0,
                partialArcs: 0,
                noisyReconstructions: 0
            };
        }
        
        // Clear all registered curves
        clear() {
            this.registry.clear();
            this.primitiveIndexToCurves.clear();
            this.nextId = 1;
            this.stats = {
                detected: 0,
                registered: 0,
                reconstructed: 0,
                failed: 0,
                pathsWithCurves: 0,
                pointsWithCurves: 0,
                partialArcs: 0,
                noisyReconstructions: 0
            };
            if (this.debug) {
                console.log('[ArcReconstructor] Registry cleared');
            }
        }
        
        // Main detection method - enhanced with decomposition
        detectCurves(primitives) {
            const detectedCurves = [];
            
            primitives.forEach((primitive, index) => {
                // Check if primitive should register curves
                if (this.shouldRegisterCurve(primitive)) {
                    const metadata = this.extractCurveMetadata(primitive);
                    if (metadata) {
                        // FIXED: Decompose composite metadata before registration
                        const decomposed = this.decomposeMetadata(metadata);
                        decomposed.forEach(curveData => {
                            const id = this.registerCurve(curveData);
                            detectedCurves.push({ ...curveData, id, primitiveIndex: index });
                            
                            // Map primitive index to curve IDs
                            if (!this.primitiveIndexToCurves.has(index)) {
                                this.primitiveIndexToCurves.set(index, []);
                            }
                            this.primitiveIndexToCurves.get(index).push(id);
                            
                            this.stats.detected++;
                        });
                    }
                }
                
                // Check for arc segments within paths
                if (primitive.type === 'path' && primitive.arcSegments && primitive.arcSegments.length > 0) {
                    primitive.arcSegments.forEach(arcSeg => {
                        const metadata = {
                            type: 'arc',
                            center: { ...arcSeg.center },
                            radius: arcSeg.radius,
                            startAngle: arcSeg.startAngle,
                            endAngle: arcSeg.endAngle,
                            clockwise: arcSeg.clockwise,
                            source: 'path_arc_segment'
                        };
                        const id = this.registerCurve(metadata);
                        detectedCurves.push({ ...metadata, id, primitiveIndex: index });
                        
                        if (!this.primitiveIndexToCurves.has(index)) {
                            this.primitiveIndexToCurves.set(index, []);
                        }
                        this.primitiveIndexToCurves.get(index).push(id);
                        
                        this.stats.detected++;
                    });
                }
            });
            
            if (this.debug && detectedCurves.length > 0) {
                console.log(`[ArcReconstructor] Detected ${detectedCurves.length} curves from ${primitives.length} primitives`);
            }
            
            return detectedCurves;
        }
        
        // FIXED: Decompose composite metadata into individual curves
        decomposeMetadata(metadata) {
            const curves = [];
            
            if (metadata.type === 'obround') {
                // Extract individual arcs from obround metadata
                if (metadata.curves && Array.isArray(metadata.curves)) {
                    metadata.curves.forEach(curve => {
                        if (curve.type === 'arc' && curve.center && curve.radius) {
                            curves.push({
                                type: 'arc',
                                center: { ...curve.center },
                                radius: curve.radius,
                                startAngle: curve.startAngle,
                                endAngle: curve.endAngle,
                                clockwise: curve.clockwise,
                                source: 'obround_component'
                            });
                        }
                    });
                }
            } else if (metadata.type === 'path_with_arcs') {
                // Extract individual segments from path metadata
                if (metadata.segments && Array.isArray(metadata.segments)) {
                    metadata.segments.forEach(segment => {
                        if (segment.type === 'arc' && segment.center && segment.radius) {
                            curves.push({
                                type: 'arc',
                                center: { ...segment.center },
                                radius: segment.radius,
                                startAngle: segment.startAngle,
                                endAngle: segment.endAngle,
                                clockwise: segment.clockwise,
                                source: 'path_segment'
                            });
                        }
                    });
                }
            } else if ((metadata.type === 'circle' || metadata.type === 'arc') && 
                       metadata.center && metadata.radius) {
                // Simple curves are registered as-is
                curves.push(metadata);
            }
            
            return curves.length > 0 ? curves : [metadata];
        }
        
        // Check if primitive should register curves
        shouldRegisterCurve(primitive) {
            // Direct curve primitives
            if (primitive.type === 'circle' || primitive.type === 'arc') {
                return true;
            }
            
            // Obrounds have curves
            if (primitive.type === 'obround') {
                return true;
            }
            
            // Paths with arc segments
            if (primitive.type === 'path' && primitive.arcSegments && primitive.arcSegments.length > 0) {
                return true;
            }
            
            // Primitives with curve metadata generation
            if (primitive.generateCurveMetadata && typeof primitive.generateCurveMetadata === 'function') {
                const metadata = primitive.generateCurveMetadata();
                return metadata !== null;
            }
            
            return false;
        }
        
        // Extract curve metadata from primitive
        extractCurveMetadata(primitive) {
            // Try primitive's own method first
            if (primitive.generateCurveMetadata && typeof primitive.generateCurveMetadata === 'function') {
                return primitive.generateCurveMetadata();
            }
            
            // Handle known primitive types
            if (primitive.type === 'circle' && primitive.center && primitive.radius) {
                return {
                    type: 'circle',
                    center: { ...primitive.center },
                    radius: primitive.radius,
                    source: 'direct'
                };
            }
            
            if (primitive.type === 'arc' && primitive.center && primitive.radius) {
                return {
                    type: 'arc',
                    center: { ...primitive.center },
                    radius: primitive.radius,
                    startAngle: primitive.startAngle,
                    endAngle: primitive.endAngle,
                    clockwise: primitive.clockwise,
                    source: 'direct'
                };
            }
            
            return null;
        }
        
        // Register curve and return ID
        registerCurve(metadata) {
            // Validate curve has required properties
            if (!metadata.center || metadata.radius === undefined) {
                if (this.debug) {
                    console.warn('[ArcReconstructor] Skipping registration of curve without center/radius:', metadata);
                }
                return null;
            }
            
            const id = this.nextId++;
            this.registry.set(id, metadata);
            this.stats.registered++;
            
            if (this.debug) {
                const angleInfo = metadata.startAngle !== undefined ? 
                    ` (${(metadata.startAngle * 180 / Math.PI).toFixed(1)}° to ${(metadata.endAngle * 180 / Math.PI).toFixed(1)}°)` : '';
                console.log(`[ArcReconstructor] Registered curve ${id}: ${metadata.type} r=${metadata.radius.toFixed(3)}${angleInfo}`);
            }
            
            return id;
        }
        
        // Get curve by ID
        getCurve(id) {
            return this.registry.get(id);
        }
        
        // Get curve IDs for primitive index
        getCurveIdsForPrimitive(primitiveIndex) {
            return this.primitiveIndexToCurves.get(primitiveIndex) || [];
        }
        
        // Main reconstruction method - process fused primitives
        processForReconstruction(primitives) {
            if (!primitives || primitives.length === 0) return primitives;
            
            if (this.debug) {
                console.log(`[ArcReconstructor] Processing ${primitives.length} primitives for reconstruction`);
            }
            
            const reconstructed = [];
            
            for (const primitive of primitives) {
                // Check if primitive has curve IDs
                if (primitive.curveIds && primitive.curveIds.length > 0) {
                    const result = this.reconstructPrimitiveWithCurves(primitive);
                    reconstructed.push(...(Array.isArray(result) ? result : [result]));
                    continue;
                }
                
                // Check points for curve IDs
                if (primitive.type === 'path' && primitive.points) {
                    const result = this.reconstructPathWithCurvePoints(primitive);
                    reconstructed.push(...(Array.isArray(result) ? result : [result]));
                    continue;
                }
                
                // No curves to reconstruct
                reconstructed.push(primitive);
            }
            
            if (this.debug) {
                console.log(`[ArcReconstructor] Reconstruction complete: ${this.stats.reconstructed} curves reconstructed`);
                if (this.stats.partialArcs > 0) {
                    console.log(`  Partial arcs: ${this.stats.partialArcs}`);
                }
                if (this.stats.noisyReconstructions > 0) {
                    console.log(`  Noisy reconstructions: ${this.stats.noisyReconstructions}`);
                }
            }
            
            return reconstructed;
        }
        
        // Reconstruct primitive that has curve IDs
        reconstructPrimitiveWithCurves(primitive) {
            if (primitive.curveIds.length === 1) {
                // Single curve - try to reconstruct entire primitive
                const curveData = this.getCurve(primitive.curveIds[0]);
                if (curveData && this.verifyPointsMatchCurve(primitive.points, curveData, true)) {
                    const reconstructed = this.createReconstructedPrimitive(curveData, primitive.points);
                    if (reconstructed) {
                        this.stats.reconstructed++;
                        return reconstructed;
                    }
                }
            }
            
            // Multiple curves or failed single reconstruction
            return this.reconstructPathWithCurvePoints(primitive);
        }
        
        // Reconstruct path with curve points - enhanced for noisy data
        reconstructPathWithCurvePoints(primitive) {
            if (!primitive.points || primitive.points.length < 3) {
                return primitive;
            }
            
            // Check if any points have curve IDs
            const hasCurveIds = primitive.points.some(p => p.curveId && p.curveId > 0);
            if (!hasCurveIds) {
                return primitive;
            }
            
            this.stats.pathsWithCurves++;
            
            // Group consecutive points by curve ID
            const segments = this.groupPointsByCurveId(primitive.points);
            const reconstructed = [];
            let currentPath = [];
            
            for (const segment of segments) {
                if (segment.curveId === 0) {
                    // Non-curve segment
                    currentPath.push(...segment.points);
                } else {
                    // Try to reconstruct curve
                    const curveData = this.getCurve(segment.curveId);
                    
                    if (curveData && segment.points.length >= this.minArcPoints) {
                        const verification = this.verifyPointsMatchCurve(segment.points, curveData, true);
                        
                        if (verification) {
                            // Flush current path
                            if (currentPath.length > 0) {
                                reconstructed.push(this.createPathPrimitive(currentPath, primitive.properties));
                                currentPath = [];
                            }
                            
                            // Add reconstructed curve with detected extents
                            const curve = this.createReconstructedPrimitive(curveData, segment.points);
                            if (curve) {
                                reconstructed.push(curve);
                                this.stats.reconstructed++;
                                this.stats.pointsWithCurves += segment.points.length;
                                
                                if (verification.isPartial) {
                                    this.stats.partialArcs++;
                                }
                                if (verification.isNoisy) {
                                    this.stats.noisyReconstructions++;
                                }
                            } else {
                                currentPath.push(...segment.points);
                            }
                        } else {
                            // Verification failed
                            currentPath.push(...segment.points);
                            this.stats.failed++;
                        }
                    } else {
                        // No metadata or not enough points
                        currentPath.push(...segment.points);
                        if (!curveData && this.debug) {
                            console.warn(`[ArcReconstructor] No curve data found for ID ${segment.curveId}`);
                        }
                    }
                }
            }
            
            // Flush remaining path
            if (currentPath.length > 0) {
                const finalPath = this.createPathPrimitive(currentPath, primitive.properties);
                if (primitive.holes) {
                    finalPath.holes = primitive.holes;
                }
                reconstructed.push(finalPath);
            }
            
            return reconstructed.length === 1 ? reconstructed[0] : reconstructed;
        }
        
        // Group consecutive points by curve ID
        groupPointsByCurveId(points) {
            const segments = [];
            let currentSegment = null;
            
            for (const point of points) {
                const curveId = point.curveId || 0;
                
                if (!currentSegment || currentSegment.curveId !== curveId) {
                    currentSegment = {
                        curveId: curveId,
                        points: [point]
                    };
                    segments.push(currentSegment);
                } else {
                    currentSegment.points.push(point);
                }
            }
            
            if (this.debug && segments.length > 1) {
                const summary = segments.map(s => `ID${s.curveId}:${s.points.length}pts`).join(', ');
                console.log(`[ArcReconstructor] Grouped into ${segments.length} segments: ${summary}`);
            }
            
            return segments;
        }
        
        // Enhanced verification for noisy/partial curves
        verifyPointsMatchCurve(points, curveData, allowPartial = false) {
            if (!points || points.length < this.minArcPoints) return false;
            
            // FIXED: Validate curveData has required properties
            if (!curveData || !curveData.center || curveData.radius === undefined) {
                if (this.debug) {
                    console.warn('[ArcReconstructor] Invalid curve data for verification:', curveData);
                }
                return false;
            }
            
            const { center, radius } = curveData;
            let maxError = 0;
            let totalError = 0;
            let errorCount = 0;
            
            // Calculate angle range of points for partial arc detection
            let minAngle = Infinity, maxAngle = -Infinity;
            const angles = [];
            
            for (const point of points) {
                const dist = Math.sqrt(
                    Math.pow(point.x - center.x, 2) +
                    Math.pow(point.y - center.y, 2)
                );
                const error = Math.abs(dist - radius);
                maxError = Math.max(maxError, error);
                totalError += error;
                
                if (error > this.noiseTolerance) {
                    errorCount++;
                }
                
                // Track angle for partial arc detection
                const angle = Math.atan2(point.y - center.y, point.x - center.x);
                angles.push(angle);
                minAngle = Math.min(minAngle, angle);
                maxAngle = Math.max(maxAngle, angle);
            }
            
            const avgError = totalError / points.length;
            const errorRatio = errorCount / points.length;
            
            // More lenient for noisy data
            const isNoisy = avgError > this.tolerance;
            const acceptableNoise = errorRatio <= 0.2 && maxError < this.noiseTolerance * 2;
            
            if (!acceptableNoise && !allowPartial) {
                if (this.debug) {
                    console.log(`[ArcReconstructor] Verification failed: ${errorCount}/${points.length} points out of tolerance, max error: ${maxError.toFixed(4)}`);
                }
                return false;
            }
            
            // Check if this is a partial arc
            let isPartial = false;
            if (curveData.type === 'arc' && allowPartial) {
                const originalSpan = this.normalizeAngleSpan(
                    curveData.startAngle, 
                    curveData.endAngle, 
                    curveData.clockwise
                );
                const detectedSpan = this.calculateAngleSpan(angles);
                const coverage = detectedSpan / Math.abs(originalSpan);
                
                isPartial = coverage < (1 - this.maxGapRatio);
                
                if (this.debug && isPartial) {
                    console.log(`[ArcReconstructor] Partial arc detected: ${(coverage * 100).toFixed(1)}% coverage`);
                }
            }
            
            return {
                verified: true,
                isPartial: isPartial,
                isNoisy: isNoisy,
                avgError: avgError,
                angles: angles
            };
        }
        
        // Calculate angle span from point angles
        calculateAngleSpan(angles) {
            if (angles.length < 2) return 0;
            
            angles.sort((a, b) => a - b);
            
            // Check for wrap-around (arc crosses 0°)
            let maxGap = 0;
            let maxGapIndex = -1;
            
            for (let i = 0; i < angles.length - 1; i++) {
                const gap = angles[i + 1] - angles[i];
                if (gap > maxGap) {
                    maxGap = gap;
                    maxGapIndex = i;
                }
            }
            
            // Check wrap-around gap
            const wrapGap = (angles[0] + 2 * Math.PI) - angles[angles.length - 1];
            if (wrapGap > maxGap) {
                // Arc crosses 0°
                return 2 * Math.PI - wrapGap;
            } else {
                // Normal arc
                return angles[angles.length - 1] - angles[0];
            }
        }
        
        // Normalize angle span
        normalizeAngleSpan(startAngle, endAngle, clockwise) {
            let span = endAngle - startAngle;
            if (clockwise) {
                if (span > 0) span -= 2 * Math.PI;
            } else {
                if (span < 0) span += 2 * Math.PI;
            }
            return span;
        }
        
        // Create reconstructed primitive - enhanced for partial arcs
        createReconstructedPrimitive(curveData, points = null) {
            try {
                // Adjust angles for partial arcs if points provided
                let actualStart = curveData.startAngle;
                let actualEnd = curveData.endAngle;
                
                if (points && points.length >= 2 && curveData.type === 'arc') {
                    // Use actual point positions for arc extents
                    const firstPoint = points[0];
                    const lastPoint = points[points.length - 1];
                    
                    actualStart = Math.atan2(
                        firstPoint.y - curveData.center.y,
                        firstPoint.x - curveData.center.x
                    );
                    actualEnd = Math.atan2(
                        lastPoint.y - curveData.center.y,
                        lastPoint.x - curveData.center.x
                    );
                }
                
                if (curveData.type === 'circle') {
                    if (typeof CirclePrimitive !== 'undefined') {
                        return new CirclePrimitive(curveData.center, curveData.radius, {
                            reconstructed: true,
                            originalCurveId: curveData.id,
                            source: curveData.source
                        });
                    }
                } else if (curveData.type === 'arc') {
                    if (typeof ArcPrimitive !== 'undefined') {
                        return new ArcPrimitive(
                            curveData.center,
                            curveData.radius,
                            actualStart,
                            actualEnd,
                            curveData.clockwise,
                            {
                                reconstructed: true,
                                originalCurveId: curveData.id,
                                source: curveData.source,
                                wasPartial: actualStart !== curveData.startAngle || actualEnd !== curveData.endAngle
                            }
                        );
                    }
                }
            } catch (error) {
                if (this.debug) {
                    console.error('[ArcReconstructor] Failed to create primitive:', error);
                }
            }
            
            return null;
        }
        
        // Create path primitive
        createPathPrimitive(points, properties) {
            if (typeof PathPrimitive !== 'undefined') {
                return new PathPrimitive(points, properties);
            }
            
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
                    return { minX, minY, maxX, maxY };
                }
            };
        }
        
        // Get statistics
        getStats() {
            return {
                ...this.stats,
                registrySize: this.registry.size,
                successRate: this.stats.registered > 0 ? 
                    (this.stats.reconstructed / this.stats.registered * 100).toFixed(1) + '%' : '0%',
                partialRate: this.stats.reconstructed > 0 ?
                    (this.stats.partialArcs / this.stats.reconstructed * 100).toFixed(1) + '%' : '0%',
                noisyRate: this.stats.reconstructed > 0 ?
                    (this.stats.noisyReconstructions / this.stats.reconstructed * 100).toFixed(1) + '%' : '0%'
            };
        }
        
        // Export registry for debugging
        exportRegistry() {
            const exported = [];
            this.registry.forEach((curve, id) => {
                exported.push({ id, ...curve });
            });
            return exported;
        }
    }
    
    // Export
    window.ArcReconstructor = ArcReconstructor;
    
})();