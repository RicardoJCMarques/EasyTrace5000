// geometry/arc-reconstructor.js
// Simplified arc detection and reconstruction for boolean operations
// FIXED: Better wrap-around handling, simpler fallback

(function() {
    'use strict';
    
    class ArcReconstructor {
        constructor(options = {}) {
            this.debug = options.debug || false;
            this.scale = options.scale || 10000;
            
            // Minimum points to reconstruct an arc
            this.minArcPoints = 3;  // Increased from 2 for better reliability
            this.maxGapRatio = 0.3; // Maximum gap in arc coverage to still reconstruct
            
            // Use global registry
            this.registry = window.globalCurveRegistry;
            if (!this.registry) {
                console.error('[ArcReconstructor] Global curve registry not found!');
                this.registry = { 
                    register: () => null, 
                    getCurve: () => null,
                    clear: () => {},
                    getCurvesForPrimitive: () => []
                };
            }
            
            // Statistics
            this.stats = {
                detected: 0,
                registered: 0,
                reconstructed: 0,
                failed: 0,
                pathsWithCurves: 0,
                pointsWithCurves: 0,
                partialArcs: 0,
                fullCircles: 0,
                groupsFound: 0,
                wrappedGroups: 0
            };
        }
        
        // Clear all registered curves
        clear() {
            // Don't clear global registry - just reset local stats
            this.stats = {
                detected: 0,
                registered: 0,
                reconstructed: 0,
                failed: 0,
                pathsWithCurves: 0,
                pointsWithCurves: 0,
                partialArcs: 0,
                fullCircles: 0,
                groupsFound: 0,
                wrappedGroups: 0
            };
            if (this.debug) {
                console.log('[ArcReconstructor] Stats reset');
            }
        }
        
        // Get curve by ID from global registry
        getCurve(id) {
            return this.registry.getCurve(id);
        }
        
        // Get curves for a primitive
        getCurveIdsForPrimitive(primitiveIndex) {
            // For now, we'll track this locally since primitives don't have stable IDs
            return this.registry.getCurvesForPrimitive(primitiveIndex) || [];
        }
        
        // Main detection method - uses global registry for new curves only
        detectCurves(primitives) {
            const detectedCurves = [];
            
            primitives.forEach((primitive, index) => {
                // Primitives should have already registered their curves
                // This is just for verification and stats
                const curveIds = this.registry.getCurvesForPrimitive(primitive.id || `temp_${index}`);
                
                if (curveIds && curveIds.length > 0) {
                    curveIds.forEach(id => {
                        const curveData = this.registry.getCurve(id);
                        if (curveData) {
                            detectedCurves.push({ ...curveData, id, primitiveIndex: index });
                            this.stats.detected++;
                        }
                    });
                }
            });
            
            if (this.debug && detectedCurves.length > 0) {
                console.log(`[ArcReconstructor] Found ${detectedCurves.length} registered curves from ${primitives.length} primitives`);
            }
            
            return detectedCurves;
        }
        
        // Main reconstruction method - process fused primitives
        processForReconstruction(primitives) {
            if (!primitives || primitives.length === 0) return primitives;
            
            if (this.debug) {
                console.log(`[ArcReconstructor] === RECONSTRUCTION PHASE ===`);
                console.log(`[ArcReconstructor] Processing ${primitives.length} fused primitives`);
                
                // Count points with curve IDs
                let totalPointsWithCurveIds = 0;
                let primitivesWithCurveIds = 0;
                
                primitives.forEach(prim => {
                    let hasPointCurveIds = false;
                    
                    if (prim.points) {
                        prim.points.forEach(pt => {
                            if (pt.curveId && pt.curveId > 0) {
                                totalPointsWithCurveIds++;
                                hasPointCurveIds = true;
                            }
                        });
                    }
                    
                    if (hasPointCurveIds || (prim.curveIds && prim.curveIds.length > 0)) {
                        primitivesWithCurveIds++;
                    }
                });
                
                console.log(`[ArcReconstructor] Input analysis:`);
                console.log(`[ArcReconstructor]   Primitives with curve data: ${primitivesWithCurveIds}`);
                console.log(`[ArcReconstructor]   Total tagged points: ${totalPointsWithCurveIds}`);
            }
            
            const reconstructed = [];
            
            for (const primitive of primitives) {
                // Check if primitive has any curve data
                const hasCurveIds = (primitive.curveIds && primitive.curveIds.length > 0) ||
                                   (primitive.points && primitive.points.some(p => p.curveId > 0));
                
                if (hasCurveIds && primitive.type === 'path') {
                    const result = this.reconstructPrimitive(primitive);
                    reconstructed.push(...result);
                } else {
                    // No curves to reconstruct
                    reconstructed.push(primitive);
                }
            }
            
            if (this.debug) {
                console.log(`[ArcReconstructor] === RECONSTRUCTION COMPLETE ===`);
                console.log(`[ArcReconstructor] Results:`);
                console.log(`[ArcReconstructor]   Input primitives: ${primitives.length}`);
                console.log(`[ArcReconstructor]   Output primitives: ${reconstructed.length}`);
                console.log(`[ArcReconstructor]   Curves reconstructed: ${this.stats.reconstructed}`);
                console.log(`[ArcReconstructor]   Partial arcs: ${this.stats.partialArcs}`);
                console.log(`[ArcReconstructor]   Full circles: ${this.stats.fullCircles}`);
                console.log(`[ArcReconstructor]   Failed reconstructions: ${this.stats.failed}`);
            }
            
            return reconstructed;
        }
        
        // Reconstruct primitive with curve data
        reconstructPrimitive(primitive) {
            if (!primitive.points || primitive.points.length < 3) {
                return [primitive]; // Pass through unchanged
            }
            
            this.stats.pathsWithCurves++;
            
            // Group consecutive points by curveId with wrap-around handling
            const groups = this.groupConsecutivePointsByCurveId(primitive.points, primitive.closed);
            const reconstructedPrimitives = [];
            
            if (this.debug) {
                console.log(`[ArcReconstructor] Found ${groups.length} groups in primitive (closed: ${primitive.closed})`);
                groups.forEach((group, idx) => {
                    console.log(`[ArcReconstructor]   Group ${idx}: type=${group.type}, curveId=${group.curveId || 'none'}, points=${group.points.length}`);
                });
            }
            
            // Check if we can reconstruct as a single complete circle
            if (groups.length === 1 && groups[0].type === 'curve') {
                const circleResult = this.attemptFullCircleReconstruction(groups[0], primitive.properties);
                if (circleResult) {
                    reconstructedPrimitives.push(circleResult);
                    return reconstructedPrimitives;
                }
            }
            
            // Otherwise, reconstruct as a path with arc segments
            const enhancedPath = this.reconstructPathWithArcs(primitive, groups);
            reconstructedPrimitives.push(enhancedPath);
            
            return reconstructedPrimitives;
        }
        
        // Group consecutive points by curveId with improved wrap-around detection
        groupConsecutivePointsByCurveId(points, isClosed = false) {
            if (!points || points.length === 0) {
                return [];
            }
            
            const groups = [];
            let currentGroup = null;
            
            // First pass: linear scan
            for (let i = 0; i < points.length; i++) {
                const point = points[i];
                const curveId = point.curveId > 0 ? point.curveId : null;
                const type = curveId ? 'curve' : 'straight';
                
                if (!currentGroup || currentGroup.type !== type || currentGroup.curveId !== curveId) {
                    if (currentGroup) {
                        groups.push(currentGroup);
                    }
                    currentGroup = {
                        type,
                        curveId,
                        points: [point],
                        indices: [i]  // Track indices for debugging
                    };
                } else {
                    currentGroup.points.push(point);
                    currentGroup.indices.push(i);
                }
            }
            
            if (currentGroup) {
                groups.push(currentGroup);
            }
            
            // Handle wrap-around for closed polygons
            if (isClosed && groups.length > 1) {
                const firstGroup = groups[0];
                const lastGroup = groups[groups.length - 1];
                
                // Check if both are curve groups with the same ID
                if (firstGroup.type === 'curve' && 
                    lastGroup.type === 'curve' && 
                    firstGroup.curveId === lastGroup.curveId) {
                    
                    // Check for continuity in segment indices
                    const lastSegmentIndex = lastGroup.points[lastGroup.points.length - 1].segmentIndex;
                    const firstSegmentIndex = firstGroup.points[0].segmentIndex;
                    
                    // Allow wrapping if indices suggest continuity (0 follows max)
                    const seemsContinuous = firstSegmentIndex === 0 || 
                                           Math.abs(lastSegmentIndex - firstSegmentIndex) <= 1;
                    
                    if (seemsContinuous) {
                        if (this.debug) {
                            console.log(`[ArcReconstructor] Merging wrap-around group for curveId ${firstGroup.curveId}`);
                            console.log(`[ArcReconstructor]   Last segment index: ${lastSegmentIndex}, First segment index: ${firstSegmentIndex}`);
                        }
                        
                        // Merge: append first group's points to the last group
                        lastGroup.points.push(...firstGroup.points);
                        lastGroup.indices.push(...firstGroup.indices);
                        groups.shift(); // Remove the first group
                        this.stats.wrappedGroups++;
                    }
                }
            }
            
            this.stats.groupsFound += groups.length;
            return groups;
        }
        
        // Attempt to reconstruct a full circle
        attemptFullCircleReconstruction(group, properties) {
            const curveData = this.getCurve(group.curveId);
            if (!curveData || curveData.type !== 'circle') {
                return null;
            }
            
            // Calculate coverage
            const coverage = this.calculateCoverage(group.points);
            
            if (this.debug) {
                console.log(`[ArcReconstructor] Circle reconstruction attempt:`);
                console.log(`[ArcReconstructor]   Curve ID: ${group.curveId}`);
                console.log(`[ArcReconstructor]   Points: ${group.points.length}`);
                console.log(`[ArcReconstructor]   Coverage: ${(coverage * 100).toFixed(1)}%`);
            }
            
            // Need near-complete coverage for a full circle
            // Lower threshold for smaller circles with fewer points
            const minCoverage = group.points.length < 20 ? 0.80 : 0.90;
            if (coverage >= minCoverage) {
                this.stats.fullCircles++;
                this.stats.reconstructed++;
                
                // Use CirclePrimitive if available
                if (typeof CirclePrimitive !== 'undefined') {
                    return new CirclePrimitive(
                        curveData.center,
                        curveData.radius,
                        {
                            ...properties,
                            reconstructed: true,
                            originalCurveId: group.curveId,
                            coverage: coverage
                        }
                    );
                }
                
                // Fallback
                return {
                    type: 'circle',
                    center: curveData.center,
                    radius: curveData.radius,
                    properties: {
                        ...properties,
                        reconstructed: true,
                        originalCurveId: group.curveId,
                        coverage: coverage
                    }
                };
            }
            
            return null;
        }
        
        // Reconstruct a path with arc segments (simplified fallback)
        reconstructPathWithArcs(primitive, groups) {
            // Always return the preprocessed primitive with enhanced metadata
            // This is the safest fallback that preserves the correct geometry
            
            // Create a copy with arc segments if we found any curves
            const enhancedPrimitive = {
                ...primitive,
                arcSegments: [],
                properties: {
                    ...primitive.properties,
                    hasReconstructedArcs: false,
                    reconstructed: false
                }
            };
            
            let currentPointIndex = 0;
            let arcsFound = 0;
            
            for (const group of groups) {
                if (group.type === 'curve' && group.points.length >= this.minArcPoints) {
                    const curveData = this.getCurve(group.curveId);
                    
                    if (curveData) {
                        const startPoint = group.points[0];
                        const endPoint = group.points[group.points.length - 1];
                        
                        // Calculate actual angles from the points
                        const startAngle = Math.atan2(
                            startPoint.y - curveData.center.y,
                            startPoint.x - curveData.center.x
                        );
                        const endAngle = Math.atan2(
                            endPoint.y - curveData.center.y,
                            endPoint.x - curveData.center.x
                        );
                        
                        // Add arc segment metadata
                        enhancedPrimitive.arcSegments.push({
                            startIndex: currentPointIndex,
                            endIndex: currentPointIndex + group.points.length - 1,
                            center: curveData.center,
                            radius: curveData.radius,
                            startAngle: startAngle,
                            endAngle: endAngle,
                            clockwise: curveData.clockwise || false,
                            curveId: group.curveId,
                            coverage: this.calculateCoverage(group.points)
                        });
                        
                        arcsFound++;
                        this.stats.partialArcs++;
                        
                        if (this.debug) {
                            console.log(`[ArcReconstructor] Added arc segment:`);
                            console.log(`[ArcReconstructor]   Curve ID: ${group.curveId}`);
                            console.log(`[ArcReconstructor]   Points: ${currentPointIndex} to ${currentPointIndex + group.points.length - 1}`);
                        }
                    }
                }
                
                currentPointIndex += group.points.length;
            }
            
            // Mark as having reconstructed arcs if any were found
            if (arcsFound > 0) {
                enhancedPrimitive.properties.hasReconstructedArcs = true;
                enhancedPrimitive.properties.reconstructed = true;
                this.stats.reconstructed += arcsFound;
            }
            
            // Return as proper PathPrimitive if available
            if (typeof PathPrimitive !== 'undefined') {
                return new PathPrimitive(enhancedPrimitive.points, enhancedPrimitive.properties);
            }
            
            return enhancedPrimitive;
        }
        
        // Calculate coverage percentage of a curve
        calculateCoverage(points) {
            if (points.length === 0) return 0;
            
            // Find the range of segment indices
            let minIndex = Infinity;
            let maxIndex = -Infinity;
            let totalSegments = 0;
            const uniqueIndices = new Set();
            
            points.forEach(p => {
                if (p.segmentIndex !== undefined) {
                    minIndex = Math.min(minIndex, p.segmentIndex);
                    maxIndex = Math.max(maxIndex, p.segmentIndex);
                    uniqueIndices.add(p.segmentIndex);
                    if (p.totalSegments !== undefined) {
                        totalSegments = Math.max(totalSegments, p.totalSegments);
                    }
                }
            });
            
            if (totalSegments === 0) {
                // Estimate based on point count (assuming ~32-64 points for a full circle)
                return Math.min(1.0, points.length / 48);
            }
            
            // Check for wrap-around case
            const hasWrapAround = uniqueIndices.has(0) && uniqueIndices.has(totalSegments - 1);
            
            if (hasWrapAround) {
                // Use unique indices count for wrap-around
                return Math.min(1.0, uniqueIndices.size / totalSegments);
            } else {
                // Normal case: continuous range
                const range = maxIndex - minIndex + 1;
                return Math.min(1.0, range / totalSegments);
            }
        }
        
        // Get statistics
        getStats() {
            const globalStats = this.registry.getStats ? this.registry.getStats() : {};
            const successRate = this.stats.registered > 0 ? 
                (this.stats.reconstructed / this.stats.registered * 100).toFixed(1) : '0';
                
            return {
                ...this.stats,
                ...globalStats,
                registrySize: globalStats.registrySize || 0,
                successRate: `${successRate}%`,
                wrapAroundMerges: this.stats.wrappedGroups
            };
        }
        
        // Export registry for debugging
        exportRegistry() {
            if (this.registry.registry && this.registry.registry instanceof Map) {
                const exported = [];
                this.registry.registry.forEach((curve, id) => {
                    exported.push({ id, ...curve });
                });
                return exported;
            }
            return [];
        }
    }
    
    // Export
    window.ArcReconstructor = ArcReconstructor;
    
})();