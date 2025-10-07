/**
 * @file        geometry/geometry-arc-reconstructor.js
 * @description Custom system to recover arcs after Clipper2 booleans
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

            const groups = this.groupPointsWithGaps(primitive.points, primitive.closed);

            if (groups.length === 1 && groups[0].type === 'curve') {
                const circleResult = this.attemptFullCircleReconstruction(groups[0], primitive);
                if (circleResult) {
                    return [circleResult];
                }
            }

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
                        currentGroup.points.push(point);
                        currentGroup.indices.push(i);
                        gapCounter = 0;
                    } else if (curveId === null && gapCounter < this.maxGapPoints) {
                        gapCounter++;
                        currentGroup.points.push(point);
                        currentGroup.indices.push(i);
                    } else {
                        if (gapCounter > 0) {
                            currentGroup.points.splice(-gapCounter, gapCounter);
                            currentGroup.indices.splice(-gapCounter, gapCounter);
                        }
                        groups.push(currentGroup);
                        currentGroup = {
                            type: curveId ? 'curve' : 'straight',
                            curveId: curveId,
                            points: [point],
                            indices: [i]
                        };
                        gapCounter = 0;
                    }
                } else {
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

            if (currentGroup) {
                if (gapCounter > 0 && currentGroup.type === 'curve') {
                    currentGroup.points.splice(-gapCounter, gapCounter);
                    currentGroup.indices.splice(-gapCounter, gapCounter);
                }
                groups.push(currentGroup);
            }

            if (isClosed && groups.length > 1) {
                const firstGroup = groups[0];
                const lastGroup = groups[groups.length - 1];
                if (firstGroup.type === 'curve' && lastGroup.type === 'curve' && firstGroup.curveId === lastGroup.curveId) {
                    lastGroup.points.push(...firstGroup.points);
                    lastGroup.indices.push(...firstGroup.indices);
                    groups.shift();
                    this.stats.wrappedGroups++;
                }
            }

            this.stats.groupsFound += groups.length;
            return groups;
        }

        /**
         * Calculates the total angular sweep of a set of points around a center.
         * NOW INCLUDES THE CLOSING SEGMENT FOR CLOSED PATHS.
         * @param {Array<object>} points The points of the curve segment.
         * @param {object} center The center of the original curve.
         * @param {boolean} isClosed - Whether to include the sweep from the last point to the first.
         * @returns {number} The total sweep angle in radians.
         */
        calculateAngularSweep(points, center, isClosed) {
            if (points.length < 2) return 0;

            let totalSweep = 0;
            // Calculate sweep for the main body of points
            for (let i = 1; i < points.length; i++) {
                const p1 = points[i - 1];
                const p2 = points[i];
                const angle1 = Math.atan2(p1.y - center.y, p1.x - center.x);
                const angle2 = Math.atan2(p2.y - center.y, p2.x - center.x);
                let delta = angle2 - angle1;

                // Handle wrapping around PI/-PI to get the shortest angle
                if (delta > Math.PI) delta -= 2 * Math.PI;
                if (delta < -Math.PI) delta += 2 * Math.PI;
                totalSweep += delta;
            }

            // CRITICAL FIX: If the path is closed, add the final segment's sweep
            if (isClosed && points.length > 1) {
                const p_last = points[points.length - 1];
                const p_first = points[0];
                const angle1 = Math.atan2(p_last.y - center.y, p_last.x - center.x);
                const angle2 = Math.atan2(p_first.y - center.y, p_first.x - center.x);
                let delta = angle2 - angle1;

                if (delta > Math.PI) delta -= 2 * Math.PI;
                if (delta < -Math.PI) delta += 2 * Math.PI;
                totalSweep += delta;
            }

            return totalSweep;
        }
        
        // Attempt to reconstruct a full circle
        attemptFullCircleReconstruction(group, primitive) {
            const curveData = this.getCurve(group.curveId); //
            if (!curveData || curveData.type !== 'circle') { //
                return null; //
            }

            const totalSweep = this.calculateAngularSweep(group.points, curveData.center, primitive.closed);

            if (Math.abs(totalSweep) >= (2 * Math.PI * 0.99)) {
                this.stats.fullCircles++;
                this.stats.reconstructed++;

                if (typeof CirclePrimitive !== 'undefined') {
                    return new CirclePrimitive(
                        curveData.center,
                        curveData.radius,
                        { //
                            ...primitive.properties,
                            reconstructed: true,
                            originalCurveId: group.curveId,
                            reconstructionMethod: 'sweep'
                        }
                    );
                }
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
        
        // Calculate arc parameters detecting actual point traversal
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
            
            // Detect actual traversal by checking angular progression
            let actuallyClockwise = false;
            
            if (points.length >= 3) {
                // Check multiple sample points for robustness
                const sampleCount = Math.min(5, points.length);
                let cwVotes = 0;
                let ccwVotes = 0;
                
                for (let i = 1; i < sampleCount; i++) {
                    const idx = Math.floor((i / sampleCount) * points.length);
                    if (idx >= points.length) continue;
                    
                    const prevIdx = Math.floor(((i - 1) / sampleCount) * points.length);
                    
                    const angle1 = Math.atan2(
                        points[prevIdx].y - curveData.center.y,
                        points[prevIdx].x - curveData.center.x
                    );
                    const angle2 = Math.atan2(
                        points[idx].y - curveData.center.y,
                        points[idx].x - curveData.center.x
                    );
                    
                    // Check if going CW or CCW between these points
                    let angleDelta = angle2 - angle1;
                    
                    // Normalize to [-π, π]
                    while (angleDelta > Math.PI) angleDelta -= 2 * Math.PI;
                    while (angleDelta < -Math.PI) angleDelta += 2 * Math.PI;
                    
                    // In screen coords (Y-down): positive delta = CCW, negative = CW
                    if (angleDelta > 0) {
                        ccwVotes++;
                    } else if (angleDelta < 0) {
                        cwVotes++;
                    }
                }
                
                actuallyClockwise = cwVotes > ccwVotes;
                
            } else {
                // 2-point arc: use shortest path
                let angleDiff = endAngle - startAngle;
                while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
                actuallyClockwise = angleDiff < 0;
            }
            
            // Calculate sweep angle
            let sweepAngle = endAngle - startAngle;
            
            if (actuallyClockwise) {
                if (sweepAngle > 0) sweepAngle -= 2 * Math.PI;
            } else {
                if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
            }
            
            if (this.debug && curveData.clockwise !== actuallyClockwise) {
                console.log(`[ArcReconstructor] Corrected: ${curveData.clockwise ? 'CW' : 'CCW'} → ${actuallyClockwise ? 'CW' : 'CCW'}`);
            }
            
            return {
                center: curveData.center,
                radius: curveData.radius,
                startAngle: startAngle,
                endAngle: endAngle,
                sweepAngle: sweepAngle,
                clockwise: actuallyClockwise
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