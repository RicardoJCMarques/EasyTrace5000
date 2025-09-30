// geometry/geometry-arc-reconstructor.js
// Arc detection and reconstruction with consistent orientation
// FIXED: Use registered clockwise property instead of index progression

(function() {
    'use strict';
    
    class ArcReconstructor {
        constructor(options = {}) {
            this.debug = options.debug || false;
            this.scale = options.scale || 10000;
            
            // Simplified thresholds
            this.minArcPoints = 2;  // Allow 2-point arcs
            this.maxGapPoints = 1;  // Maximum untagged points between tagged sequences
            this.minCirclePoints = 4; // Reduced: small circles may have fewer points
            
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
        
        // Main reconstruction method - process fused primitives
        processForReconstruction(primitives) {
            if (!primitives || primitives.length === 0) return primitives;
            
            if (this.debug) {
                console.log(`[ArcReconstructor] Processing ${primitives.length} fused primitives`);
            }
            
            const reconstructed = [];
            
            for (const primitive of primitives) {
                const hasCurveIds = (primitive.curveIds && primitive.curveIds.length > 0) ||
                                   (primitive.points && primitive.points.some(p => p.curveId > 0));
                
                if (hasCurveIds && primitive.type === 'path') {
                    const result = this.reconstructPrimitive(primitive);
                    reconstructed.push(...result);
                } else {
                    reconstructed.push(primitive);
                }
            }
            
            if (this.debug) {
                console.log(`[ArcReconstructor] Results: ${primitives.length} → ${reconstructed.length} primitives`);
                console.log(`[ArcReconstructor] Arcs found: ${this.stats.partialArcs}`);
            }
            
            return reconstructed;
        }
        
        // Reconstruct primitive with curve data
        reconstructPrimitive(primitive) {
            if (!primitive.points || primitive.points.length < 3) {
                return [primitive];
            }
            
            this.stats.pathsWithCurves++;
            
            // Group points with gap tolerance
            const groups = this.groupPointsWithGaps(primitive.points, primitive.closed);
            
            if (this.debug && groups.length > 0) {
                console.log(`[ArcReconstructor] Found ${groups.length} groups in primitive`);
            }
            
            // Check if we can reconstruct as a single complete circle
            if (groups.length === 1 && groups[0].type === 'curve') {
                const circleResult = this.attemptFullCircleReconstruction(groups[0], primitive.properties);
                if (circleResult) {
                    return [circleResult];
                }
            }
            
            // Otherwise, enhance with arc segments
            const enhancedPath = this.reconstructPathWithArcs(primitive, groups);
            return [enhancedPath];
        }
        
        // Group points with gap tolerance
        groupPointsWithGaps(points, isClosed = false) {
            if (!points || points.length === 0) return [];
            
            const groups = [];
            let currentGroup = null;
            let gapCounter = 0;
            
            for (let i = 0; i < points.length; i++) {
                const point = points[i];
                const curveId = point.curveId > 0 ? point.curveId : null;
                
                if (currentGroup && currentGroup.type === 'curve') {
                    if (curveId === currentGroup.curveId) {
                        // Continue current curve group
                        currentGroup.points.push(point);
                        currentGroup.indices.push(i);
                        gapCounter = 0;
                    } else if (curveId === null && gapCounter < this.maxGapPoints) {
                        // Tolerate gap
                        gapCounter++;
                        currentGroup.points.push(point);
                        currentGroup.indices.push(i);
                    } else {
                        // End current group
                        if (gapCounter > 0) {
                            // Remove gap points from end
                            currentGroup.points.splice(-gapCounter, gapCounter);
                            currentGroup.indices.splice(-gapCounter, gapCounter);
                        }
                        groups.push(currentGroup);
                        
                        // Start new group
                        currentGroup = {
                            type: curveId ? 'curve' : 'straight',
                            curveId: curveId,
                            points: [point],
                            indices: [i]
                        };
                        gapCounter = 0;
                    }
                } else {
                    // Start new group
                    if (currentGroup) {
                        groups.push(currentGroup);
                    }
                    
                    currentGroup = {
                        type: curveId ? 'curve' : 'straight',
                        curveId: curveId,
                        points: [point],
                        indices: [i]
                    };
                    gapCounter = 0;
                }
            }
            
            // Add final group
            if (currentGroup) {
                if (gapCounter > 0 && currentGroup.type === 'curve') {
                    currentGroup.points.splice(-gapCounter, gapCounter);
                    currentGroup.indices.splice(-gapCounter, gapCounter);
                }
                groups.push(currentGroup);
            }
            
            // Handle wrap-around for closed paths
            if (isClosed && groups.length > 1) {
                const firstGroup = groups[0];
                const lastGroup = groups[groups.length - 1];
                
                if (firstGroup.type === 'curve' && 
                    lastGroup.type === 'curve' && 
                    firstGroup.curveId === lastGroup.curveId) {
                    
                    // Merge wrapped groups
                    lastGroup.points.push(...firstGroup.points);
                    lastGroup.indices.push(...firstGroup.indices);
                    groups.shift();
                    this.stats.wrappedGroups++;
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
            
            // Adaptive threshold based on radius (smaller circles need fewer points)
            const isSmallCircle = curveData.radius < 1.0; // mm
            const adaptiveMinPoints = isSmallCircle ? 4 : this.minCirclePoints;
            
            if (group.points.length < adaptiveMinPoints) {
                if (this.debug) {
                    console.log(`[ArcReconstructor] Circle rejected: ${group.points.length} points < ${adaptiveMinPoints} min (r=${curveData.radius.toFixed(3)}mm)`);
                }
                return null;
            }
            
            // Calculate actual coverage
            const coverage = this.calculateSimpleCoverage(group.points, curveData);
            
            if (this.debug) {
                console.log(`[ArcReconstructor] Circle r=${curveData.radius.toFixed(3)}mm: ${group.points.length} points, ${(coverage * 100).toFixed(1)}% coverage`);
            }
            
            // Adaptive coverage threshold: small circles (pin flashes) need less coverage
            const minCoverage = isSmallCircle ? 0.60 : (group.points.length < 20 ? 0.75 : 0.85);
            
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
        
        // Calculate coverage
        calculateSimpleCoverage(points, curveData) {
            if (points.length === 0 || !curveData) return 0;
            
            // Adaptive segment expectation based on circle size
            const isSmallCircle = curveData.radius < 1.0; // mm
            let expectedSegments = isSmallCircle ? 16 : 48;
            
            if (curveData.type === 'circle') {
                if (typeof GeometryUtils !== 'undefined') {
                    expectedSegments = GeometryUtils.getOptimalSegments(curveData.radius);
                    // Override for small circles
                    if (isSmallCircle) {
                        expectedSegments = Math.min(expectedSegments, 16);
                    }
                } else {
                    const circumference = 2 * Math.PI * curveData.radius;
                    expectedSegments = Math.max(8, Math.min(128, Math.ceil(circumference / 0.1)));
                    if (isSmallCircle) {
                        expectedSegments = Math.min(expectedSegments, 16);
                    }
                }
            }
            
            // Count unique segment indices if available
            const uniqueIndices = new Set();
            let hasIndices = false;
            
            points.forEach(p => {
                if (p.segmentIndex !== undefined) {
                    uniqueIndices.add(p.segmentIndex);
                    hasIndices = true;
                }
            });
            
            if (hasIndices && uniqueIndices.size > 0) {
                return Math.min(1.0, uniqueIndices.size / expectedSegments);
            } else {
                return Math.min(1.0, points.length / expectedSegments);
            }
        }
        
        // Reconstruct path with arc segments
        reconstructPathWithArcs(primitive, groups) {
            const detectedArcSegments = [];
            
            for (const group of groups) {
                // Allow 2-point arcs
                if (group.type === 'curve' && group.points.length >= this.minArcPoints) {
                    const curveData = this.getCurve(group.curveId);
                    
                    if (curveData) {
                        const arcFromPoints = this.calculateArcFromPoints(group.points, curveData);
                        
                        if (arcFromPoints) {
                            detectedArcSegments.push({
                                startIndex: group.indices[0],
                                endIndex: group.indices[group.indices.length - 1],
                                center: arcFromPoints.center,
                                radius: arcFromPoints.radius,
                                startAngle: arcFromPoints.startAngle,
                                endAngle: arcFromPoints.endAngle,
                                sweepAngle: arcFromPoints.sweepAngle,
                                clockwise: arcFromPoints.clockwise,
                                curveId: group.curveId,
                                pointCount: group.points.length,
                                originalCenter: curveData.center,
                                originalRadius: curveData.radius
                            });
                            
                            this.stats.partialArcs++;
                            
                            if (this.debug) {
                                const angleDeg = Math.abs(arcFromPoints.sweepAngle) * 180 / Math.PI;
                                console.log(`[ArcReconstructor] Arc: ${group.points.length} pts, ${angleDeg.toFixed(1)}°, ${arcFromPoints.clockwise ? 'CW' : 'CCW'}`);
                            }
                        }
                    }
                }
            }
            
            // Create enhanced primitive
            const enhancedPrimitive = {
                ...primitive,
                arcSegments: detectedArcSegments,
                properties: {
                    ...primitive.properties,
                    hasDetectedArcs: detectedArcSegments.length > 0,
                    hasReconstructedArcs: detectedArcSegments.length > 0,
                    detectedArcCount: detectedArcSegments.length
                }
            };
            
            if (detectedArcSegments.length > 0) {
                this.stats.reconstructed += detectedArcSegments.length;
            }
            
            // Return as proper PathPrimitive if available
            if (typeof PathPrimitive !== 'undefined') {
                const pathPrim = new PathPrimitive(enhancedPrimitive.points, enhancedPrimitive.properties);
                pathPrim.arcSegments = enhancedPrimitive.arcSegments;
                pathPrim.holes = enhancedPrimitive.holes || [];
                return pathPrim;
            }
            
            return enhancedPrimitive;
        }
        
        // FIXED: Calculate arc parameters using registered direction
        calculateArcFromPoints(points, curveData) {
            if (points.length < 2) return null;
            
            const startPoint = points[0];
            const endPoint = points[points.length - 1];
            
            const startAngle = Math.atan2(
                startPoint.y - curveData.center.y, 
                startPoint.x - curveData.center.x
            );
            const endAngle = Math.atan2(
                endPoint.y - curveData.center.y, 
                endPoint.x - curveData.center.x
            );
            
            // FIXED: Use the registered clockwise property directly
            // If not specified (e.g., circles), default to CCW (false)
            const clockwise = curveData.clockwise === true;
            
            // Calculate sweep angle respecting registered direction
            let sweepAngle = endAngle - startAngle;
            
            // Normalize sweep angle based on registered direction
            if (clockwise) {
                // For CW, we want negative sweep
                if (sweepAngle > 0) sweepAngle -= 2 * Math.PI;
            } else {
                // For CCW, we want positive sweep  
                if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
            }
            
            if (this.debug) {
                console.log(`[ArcReconstructor] Arc from registry: ${clockwise ? 'CW' : 'CCW'} (registered), sweep: ${(sweepAngle * 180 / Math.PI).toFixed(1)}°`);
            }
            
            return {
                center: curveData.center,
                radius: curveData.radius,
                startAngle: startAngle,
                endAngle: endAngle,
                sweepAngle: sweepAngle,
                clockwise: clockwise
            };
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
    }
    
    // Export
    window.ArcReconstructor = ArcReconstructor;
    
})();