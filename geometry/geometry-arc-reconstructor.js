/*!
 * @file        geometry/geometry-arc-reconstructor.js
 * @description Custom built system to recover arcs after Clipper2 booleans
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

/*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2025-2026 Eltryus
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

    const C = window.PCBCAMConfig.constants;
    const D = window.PCBCAMConfig.defaults;
    const debugState = D.debug;

    class ArcReconstructor {
        constructor(options = {}) {
            this.options = {
                scale: options.scale
            };

            // Simplified thresholds
            const arcConfig = C.geometry.arcReconstruction;
            this.minArcPoints = arcConfig.minArcPoints;
            this.maxGapPoints = arcConfig.maxGapPoints;
            this.minCirclePoints = arcConfig.minCirclePoints;

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
            this.debug('Stats reset');
        }

        // Get curve by ID from global registry
        getCurve(id) {
            return this.registry.getCurve(id);
        }

        // Main reconstruction method - process fused primitives
        processForReconstruction(primitives) {
            this.debug(`processForReconstruction() called with ${primitives ? primitives.length : 0} primitives.`);

            if (!primitives || primitives.length === 0) return primitives;

            this.debug(`Processing ${primitives.length} fused primitives`);

            const reconstructed = [];

            for (const primitive of primitives) {
                // Check if this is a composite primitive with contours
                if (primitive.type === 'path' && primitive.contours && primitive.contours.length > 1) {
                    // Compound path - process each contour but maintain structure
                    this.debug(`Processing compound primitive with ${primitive.contours.length} contours`);

                    const reconstructedContours = [];

                    for (const contour of primitive.contours) {
                        if (!contour.points || contour.points.length < 3) continue;

                        // Process this contour's points for curve reconstruction
                        const groups = this.groupPointsWithGaps(contour.points, true);
                        const enhancedContour = this.reconstructContour(contour, groups);
                        reconstructedContours.push(enhancedContour);
                    }

                    if (reconstructedContours.length === 0) continue;

                    // Return compound primitive with all contours
                    const compoundResult = new PathPrimitive(reconstructedContours, {
                        ...primitive.properties,
                        hasDetectedArcs: reconstructedContours.some(c => c.arcSegments && c.arcSegments.length > 0)
                    });

                    reconstructed.push(compoundResult);
                    continue;
                    } else if (primitive.type === 'path') {
                    const contour = (primitive.contours && primitive.contours.length > 0) ? primitive.contours[0] : null;

                    const hasCurveIds = contour && (
                                        (contour.curveIds && contour.curveIds.length > 0) ||
                                        (contour.arcSegments && contour.arcSegments.length > 0) ||
                                        (contour.points && contour.points.some(p => p.curveId > 0))
                    );

                    if (hasCurveIds) {
                        const result = this.reconstructPrimitive(primitive);
                        reconstructed.push(...result);
                    } else {
                        reconstructed.push(primitive);
                    }
                }  
            }

            if (debugState.enabled) {
                const holes = reconstructed.filter(p => p.properties?.isHole).length;
                console.log(`[ArcReconstructor] Results: ${primitives.length} → ${reconstructed.length} primitives (${holes} holes)`);
                console.log(`[ArcReconstructor] Full circles: ${this.stats.fullCircles}, Partial arcs: ${this.stats.partialArcs}`);
            }

            return reconstructed;
        }

        reconstructContour(originalContour, groups) {
            const newPoints = [];
            const detectedArcSegments = [];

            for (const group of groups) {
                if (group.type === 'curve' && group.points.length >= this.minArcPoints) {
                    const curveData = this.getCurve(group.curveId);

                    if (curveData) {
                        const arcFromPoints = this.calculateArcFromPoints(group.points, curveData);

                        // Pre-determine if this should be a full circle
                        const expectedSegments = GeometryUtils.getOptimalSegments(curveData.radius, curveData.type === 'circle' ? 'circle' : 'arc');
                        const isFullCircle = curveData.type === 'circle' && group.points.length >= expectedSegments;

                        // Correct the sweep angle before validation
                        if (arcFromPoints && isFullCircle) {
                            arcFromPoints.sweepAngle = this.calculateAngularSweep(group.points, curveData.center, true);
                        }

                        // Bypass worthiness checks if it's known it's a full circle
                        if (arcFromPoints && (isFullCircle || this._isArcWorthReconstruction(arcFromPoints, group.points))) {
                            const startPoint = group.points[0];
                            const endPoint = group.points[group.points.length - 1];
                            newPoints.push(startPoint);
                            const arcStartIdx = newPoints.length - 1;

                            if (isFullCircle) {
                                this.stats.fullCircles++;
                                newPoints.push({ x: startPoint.x, y: startPoint.y });
                            } else {
                                this.stats.partialArcs++;
                                newPoints.push(endPoint);
                            }

                            const arcEndIdx = newPoints.length - 1;

                            detectedArcSegments.push({
                                startIndex: arcStartIdx,
                                endIndex: arcEndIdx,
                                center: arcFromPoints.center,
                                radius: arcFromPoints.radius,
                                startAngle: arcFromPoints.startAngle,
                                endAngle: arcFromPoints.endAngle,
                                sweepAngle: arcFromPoints.sweepAngle, // Uses the corrected sweep
                                clockwise: arcFromPoints.clockwise,
                                curveId: group.curveId
                            });
                        } else {
                            for (const p of group.points) {
                                newPoints.push({ x: p.x, y: p.y });
                            }
                        }
                    } else {
                        for (const p of group.points) {
                            newPoints.push({ x: p.x, y: p.y });
                        }
                    }
                } else {
                    // For straight groups, dedup the first point against the last in newPoints
                    const groupPts = group.points;
                    let startIdx = 0;
                    if (newPoints.length > 0 && groupPts.length > 0) {
                        const last = newPoints[newPoints.length - 1];
                        const first = groupPts[0];
                        const dx = last.x - first.x;
                        const dy = last.y - first.y;
                        if ((dx * dx + dy * dy) <= 1e-9) {
                            startIdx = 1; // skip duplicate
                        }
                    }
                    for (let i = startIdx; i < groupPts.length; i++) {
                        newPoints.push(groupPts[i]);
                    }
                }
            }

            // Deduplicate adjacent points and remap arc indices
            const dedupedPoints = [newPoints[0]];
            const indexRemap = [0];

            // Protect arc endpoints from deduplication so 360-degree sweeps survive
            const protectedIndices = new Set();
            detectedArcSegments.forEach(arc => {
                protectedIndices.add(arc.startIndex);
                protectedIndices.add(arc.endIndex);
            });

            for (let j = 1; j < newPoints.length; j++) {
                const prev = dedupedPoints[dedupedPoints.length - 1];
                const curr = newPoints[j];
                const dx = prev.x - curr.x;
                const dy = prev.y - curr.y;

                if ((dx * dx + dy * dy) > 1e-9 || protectedIndices.has(j)) {
                    indexRemap.push(dedupedPoints.length);
                    dedupedPoints.push(curr);
                } else {
                    indexRemap.push(dedupedPoints.length - 1);
                }
            }

            const remappedArcs = detectedArcSegments.map(arc => {
                const newStart = indexRemap[arc.startIndex];
                const newEnd = indexRemap[arc.endIndex];
                if (newStart >= 0 && newEnd >= 0) {
                    return { ...arc, startIndex: newStart, endIndex: newEnd };
                }
                return null;
            }).filter(Boolean);

            // Return reconstructed contour
            return {
                points: dedupedPoints,
                isHole: originalContour.isHole,
                nestingLevel: originalContour.nestingLevel,
                parentId: originalContour.parentId,
                arcSegments: remappedArcs,
                curveIds: Array.from(new Set(remappedArcs.map(s => s.curveId)))
            };
        }

        reconstructPrimitive(primitive) {
            if (!primitive.contours || primitive.contours.length === 0) {
                return [primitive];
            }

            const contour = primitive.contours[0];
            if (!contour.points || contour.points.length < 3) {
                return [primitive];
            }

            this.stats.pathsWithCurves++;

            // Pass the contour's points to the grouper
            const groups = this.groupPointsWithGaps(contour.points, primitive.closed);
            if (groups.length === 1 && groups[0].type === 'curve') {
                const circleResult = this.attemptFullCircleReconstruction(groups[0], primitive);
                if (circleResult) {
                    return [circleResult];
                }
            }

            // Pass the original primitive and the groups from its contour
            const enhancedPath = this.reconstructPathWithArcs(primitive, groups);
            return [enhancedPath];
        }

        // Group points with strict 1-point gap tolerance for intersection artifacts
        groupPointsWithGaps(points, isClosed = false) {
            if (!points || points.length === 0) return [];

            const groups = [];

            // Start the first group
            let currentCurveId = points[0].curveId > 0 ? points[0].curveId : null;
            let currentGroup = {
                type: currentCurveId ? 'curve' : 'straight',
                curveId: currentCurveId,
                points: [points[0]],
                indices: [0]
            };

            for (let i = 1; i < points.length; i++) {
                const point = points[i];
                const curveId = point.curveId > 0 ? point.curveId : null;

                // Case 1: Direct Match - Continue the group
                if (curveId === currentGroup.curveId) {
                    currentGroup.points.push(point);
                    currentGroup.indices.push(i);
                    continue;
                } 

                // Case 2: Mismatch - Try Strict 1-Point Bridge
                // Only attempt if currently tracking a valid curve
                if (currentGroup.curveId) {
                    const nextIndex = i + 1;

                    // Check exactly one point ahead
                    if (nextIndex < points.length) {
                        const nextPoint = points[nextIndex];
                        const nextId = nextPoint.curveId > 0 ? nextPoint.curveId : null;

                        // If the valid ID resumes immediately after this point
                        if (nextId === currentGroup.curveId) {
                            // It's an intersection artifact. Absorb it and the next point.
                            currentGroup.points.push(point);      // The artifact (no ID)
                            currentGroup.points.push(nextPoint);  // The resumption (valid ID)
                            currentGroup.indices.push(i);
                            currentGroup.indices.push(nextIndex);

                            // Skip the next point in the loop since it was just processed
                            i++; 
                            continue;
                        }
                    }
                }
        
                // Case 3: Genuine break or >1 point gap - Finalize current and start new
                groups.push(currentGroup);
                currentGroup = {
                    type: curveId ? 'curve' : 'straight',
                    curveId: curveId,
                    points: [point],
                    indices: [i]
                };
            }

            // Add the last group
            if (currentGroup) {
                groups.push(currentGroup);
            }

            // Case 4: Closed Loop Wrap-Around Merge
            // If the path is closed, the start and end might be the same broken curve
            if (isClosed && groups.length > 1) {
                const firstGroup = groups[0];
                const lastGroup = groups[groups.length - 1];

                if (firstGroup.type === 'curve' && 
                    lastGroup.type === 'curve' && 
                    firstGroup.curveId === lastGroup.curveId) {

                    // Merge first group points into the last group
                    lastGroup.points.push(...firstGroup.points);
                    lastGroup.indices.push(...firstGroup.indices);

                    // Remove the now-merged first group
                    groups.shift();
                    this.stats.wrappedGroups++;
                }
            }

            if (debugState.enabled && groups.length > 1) {
                const curveGroups = groups.filter(g => g.type === 'curve');
                if (curveGroups.length > 1) {
                    console.warn(`[ArcReconstructor] Fragmentation Alert: Path split into ${groups.length} groups. Curve fragments: ${curveGroups.length}. This indicates Clipper generated >1 point gaps.`);
                    curveGroups.forEach((g, idx) => {
                        console.log(`   Fragment ${idx}: ${g.points.length} points, ID: ${g.curveId}`);
                    });
                }
            }

            this.stats.groupsFound += groups.length;
            return groups;
        }

        /**
         * Calculates the total angular sweep of a set of points around a center.
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

            // If the path is closed, add the final segment's sweep
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
            const curveData = this.getCurve(group.curveId);
            if (!curveData || curveData.type !== 'circle') {
                console.warn(`[ArcReconstructor] Failed curve data check for ID ${group.curveId}.`);
                return null;
            }

            // All tessellation points must be present — missing points means Clipper2 clipped this circle.
            const expectedSegments = GeometryUtils.getOptimalSegments(curveData.radius, 'circle');
            if (group.points.length < expectedSegments) {
                this.debug(`Full circle rejected: ${group.points.length}/${expectedSegments} points present (ID: ${group.curveId})`);
                return null;
            }

            this.stats.fullCircles++;
            this.stats.reconstructed++;

            if (typeof CirclePrimitive !== 'undefined') {
                return new CirclePrimitive(
                    curveData.center,
                    curveData.radius,
                    {
                        ...primitive.properties,
                        reconstructed: true,
                        originalCurveId: group.curveId,
                        reconstructionMethod: 'sweep'
                    }
                );
            }

            return null;
        }

        reconstructPathWithArcs(primitive, groups) {
            if (!primitive.contours || primitive.contours.length === 0) {
                return [primitive];
            }

            const contour = primitive.contours[0];
            if (!contour.points || contour.points.length < 3) {
                return [primitive];
            }

            this.stats.pathsWithCurves++;
            const originalPointCount = contour.points.length;

            // Build the new points array and detect arc segments
            const detectedArcSegments = [];
            const newPoints = [];

            for (const group of groups) {
                if (group.type === 'curve' && group.points.length >= this.minArcPoints) {
                    const curveData = this.getCurve(group.curveId);

                    if (curveData) {
                        const arcFromPoints = this.calculateArcFromPoints(group.points, curveData);

                        // Pre-determine if this should be a full circle
                        const expectedSegments = GeometryUtils.getOptimalSegments(curveData.radius, curveData.type === 'circle' ? 'circle' : 'arc');
                        const isFullCircle = curveData.type === 'circle' && group.points.length >= expectedSegments;

                        // Correct the sweep angle before validation
                        if (arcFromPoints && isFullCircle) {
                            arcFromPoints.sweepAngle = this.calculateAngularSweep(group.points, curveData.center, true);
                        }

                        // Bypass worthiness checks if it's a full circle
                        if (arcFromPoints && (isFullCircle || this._isArcWorthReconstruction(arcFromPoints, group.points))) {
                            const startPoint = group.points[0];
                            const endPoint = group.points[group.points.length - 1];

                            newPoints.push(startPoint);
                            const arcStartIdx = newPoints.length - 1;

                            if (isFullCircle) {
                                this.stats.fullCircles++;
                                newPoints.push({ x: startPoint.x, y: startPoint.y });
                            } else {
                                this.stats.partialArcs++;
                                newPoints.push(endPoint);
                            }

                            const arcEndIdx = newPoints.length - 1;

                            detectedArcSegments.push({
                                startIndex: arcStartIdx,
                                endIndex: arcEndIdx,
                                center: arcFromPoints.center,
                                radius: arcFromPoints.radius,
                                startAngle: arcFromPoints.startAngle,
                                endAngle: arcFromPoints.endAngle,
                                sweepAngle: arcFromPoints.sweepAngle,
                                clockwise: arcFromPoints.clockwise,
                                curveId: group.curveId
                            });
                        } else {
                            // Arc rejected — strip curveId so DP can simplify these points
                            for (const p of group.points) {
                                newPoints.push({ x: p.x, y: p.y });
                            }
                        }
                    } else {
                        for (const p of group.points) {
                            newPoints.push({ x: p.x, y: p.y });
                        }
                    }
                } else {
                    // This is a group of straight line segments, so add all its points.
                    newPoints.push(...group.points);
                }
            }

            const dedupedPoints = [newPoints[0]];
            const indexRemap = [0];

            const protectedIndices = new Set();
            detectedArcSegments.forEach(arc => {
                protectedIndices.add(arc.startIndex);
                protectedIndices.add(arc.endIndex);
            });

            for (let j = 1; j < newPoints.length; j++) {
                const prev = dedupedPoints[dedupedPoints.length - 1];
                const curr = newPoints[j];
                const dx = prev.x - curr.x;
                const dy = prev.y - curr.y;

                if ((dx * dx + dy * dy) > 1e-9 || protectedIndices.has(j)) {
                    indexRemap.push(dedupedPoints.length);
                    dedupedPoints.push(curr);
                } else {
                    indexRemap.push(dedupedPoints.length - 1);
                }
            }

            const remappedArcs = detectedArcSegments.map(arc => {
                const newStart = indexRemap[arc.startIndex];
                const newEnd = indexRemap[arc.endIndex];
                if (newStart >= 0 && newEnd >= 0) {
                    return { ...arc, startIndex: newStart, endIndex: newEnd };
                }
                return null;
            }).filter(Boolean);

            if (debugState.enabled && remappedArcs.length > 0) {
                if (dedupedPoints.length >= originalPointCount) {
                    console.warn(`[ArcReconstructor] Point count not reduced: ${originalPointCount} -> ${dedupedPoints.length}. Acceptable if arcs had few segments.`, {
                        primitiveId: primitive.id
                    });
                } else {
                    this.debug(`Point count reduced: ${originalPointCount} -> ${dedupedPoints.length}`);
                }
            }

            if (remappedArcs.length > 0) {
                this.stats.reconstructed += remappedArcs.length;
            }

            const newContour = {
                points: dedupedPoints,
                isHole: primitive.properties.isHole || false,
                nestingLevel: primitive.properties.nestingLevel || 0,
                parentId: primitive.properties.parentId || null,
                arcSegments: remappedArcs,
                curveIds: Array.from(new Set(remappedArcs.map(s => s.curveId)))
            };

            return new PathPrimitive([newContour], {
                ...primitive.properties,
                hasDetectedArcs: remappedArcs.length > 0
            });
        }

        /**
         * Determines if a detected arc is worth reconstructing.
         * Tiny, nearly-flat arcs are left as linear segments so downstream simplification (DP) can handle them if need be.
         */
        _isArcWorthReconstruction(arcParams, points) {
            const minSweepDeg = 2.0;
            const minChordLen = 0.01;

            const maxFlatnessRatio = 1.0001; // REVIEW - Double check relationship to tolerance? 1+EPSILON?

            const absSweep = Math.abs(arcParams.sweepAngle);

            if (absSweep < (minSweepDeg * Math.PI / 180)) {
                this.debug(`Arc Rejected: Sweep too small (${absSweep.toFixed(2)}° < ${minSweepDeg}°)`, { curveId: arcParams.curveId });
                return false;
            }

            const p0 = points[0];
            const pN = points[points.length - 1];
            const dx = pN.x - p0.x;
            const dy = pN.y - p0.y;
            const chordLen = Math.sqrt(dx * dx + dy * dy);

            if (chordLen < minChordLen) {
                this.debug(`Arc Rejected: Chord too short (${chordLen.toFixed(4)} < ${minChordLen})`, { curveId: arcParams.curveId });
                return false;
            }

            const arcLen = arcParams.radius * absSweep;
            if (chordLen > 0 && (arcLen / chordLen) < maxFlatnessRatio) {
                this.debug(`Arc Rejected: Arc too flat (Ratio: ${(arcLen / chordLen).toFixed(3)} < ${maxFlatnessRatio})`, { curveId: arcParams.curveId });
                return false;
            }

            return true;
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

                    // Normalize to [-π, π] // Can this derect 0 crossings?
                    while (angleDelta > Math.PI) angleDelta -= 2 * Math.PI;
                    while (angleDelta < -Math.PI) angleDelta += 2 * Math.PI;

                    // Y-up: positive delta = CCW, negative delta = CW
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
                
                // Y-up: negative diff = CW
                actuallyClockwise = angleDiff < 0;
            }

            // Calculate sweep angle
            let sweepAngle = endAngle - startAngle;

            if (actuallyClockwise) {
                // Y-up standard: CW = negative sweep
                if (sweepAngle > 0) sweepAngle -= 2 * Math.PI;
            } else {
                // Y-up standard: CCW = positive sweep
                if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
            }

            if (curveData.clockwise !== actuallyClockwise) {
                this.debug(`Corrected: ${curveData.clockwise ? 'CW' : 'CCW'} → ${actuallyClockwise ? 'CW' : 'CCW'}`);
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

        debug(message, data = null) {
            if (debugState.enabled) {
                if (data) {
                    console.log(`[ArcReconstructor] ${message}`, data);
                } else {
                    console.log(`[ArcReconstructor] ${message}`);
                }
            }
        }

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

    window.ArcReconstructor = ArcReconstructor;
})();