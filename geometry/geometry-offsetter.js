/**
 * @file        geometry/geometry-offsetter.js
 * @description Handles geometry offsetting
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

    const config = window.PCBCAMConfig || {};
    const geomConfig = config.geometry || {};
    const debugConfig = config.debug || {};

    class GeometryOffsetter {
        constructor(options = {}) {
            this.options = {
                precision: options.precision || geomConfig.coordinatePrecision || 0.001,
                miterLimit: options.miterLimit
            };
            this.initialized = true;
            this.geometryProcessor = null;
        }
        
        debug(message, data = null) {
            if (debugConfig.enabled) {
                if (data) {
                    console.log(`${message}`, data);
                } else {
                    console.log(`${message}`);
                }
            }
        }
        
        setGeometryProcessor(processor) {
            this.geometryProcessor = processor;
        }
        
        async offsetPrimitive(primitive, distance, options = {}) {
            if (!primitive || !primitive.type) return null;
            if (Math.abs(distance) < this.options.precision) return primitive;

            const props = primitive.properties || {};
            const isCutout = props.isCutout || props.layerType === 'cutout';
            const isStroke = !isCutout && ((props.stroke && !props.fill) || props.isTrace);

            // Handle analytic stroke offsetting
            if (isStroke) {
                const originalWidth = props.strokeWidth || 0;
                // totalWidth is the original trace width PLUS the isolation offset on both sides
                // Use (distance * 2) directly, preserving the sign.
                // +distance (isolation) will grow the width.
                // -distance (clear) will shrink the width.
                const totalWidth = originalWidth + (distance * 2);
                
                if (totalWidth < this.options.precision) {
                    this.debug(`Stroke width too small, skipping: ${totalWidth}`);
                    return null;
                }

                let polygonPoints;

                if (primitive.type === 'arc') {
                    this.debug(`Polygonizing ArcStroke ${primitive.id} with total width ${totalWidth}`);
                    polygonPoints = GeometryUtils.arcToPolygon(primitive, totalWidth);
                } else if (primitive.type === 'path' && primitive.points && primitive.points.length > 0) {
                    this.debug(`Polygonizing PathStroke ${primitive.id} with total width ${totalWidth}`);
                    // polylineToPolygon correctly handles single-segment (lineToPolygon) and multi-segment paths
                    polygonPoints = GeometryUtils.polylineToPolygon(primitive.points, totalWidth);
                } else {
                    if (debugConfig.enabled) console.warn(`Unhandled stroke type: ${primitive.type}`);
                    return null;
                }

                if (!polygonPoints || polygonPoints.length < 3) {
                    if (debugConfig.enabled) console.warn(`Polygonization of stroke ${primitive.id} failed to produce points.`);
                    return null;
                }
                
                const isInternal = distance < 0;
                
                // Create a new PathPrimitive from the resulting "sausage" polygon and pass curveIds and arcSegments from the utils to the new primitive
                return new PathPrimitive(polygonPoints, {
                    ...props,
                    fill: true,
                    stroke: false,
                    isOffset: true,
                    offsetDistance: distance,
                    offsetType: isInternal ? 'internal' : 'external',
                    polygonized: true,
                    curveIds: polygonPoints.curveIds || [],
                    arcSegments: polygonPoints.arcSegments || []
                });
            }

            // If not a stroke, proceed with analytic/fill offset logic
            switch (primitive.type) {
                case 'circle':
                    return this.offsetCircle(primitive, distance);
                case 'rectangle':
                    return this.offsetRectangle(primitive, distance);
                case 'path':
                    return this.offsetPath(primitive, distance);
                case 'arc':
                    return this.offsetArc(primitive, distance);
                case 'obround':
                    return this.offsetObround(primitive, distance);
                default:
                    if (debugConfig.enabled) {
                        console.warn(`Unknown type: ${primitive.type}`);
                    }
                    return null;
            }
        }
        
        offsetCircle(circle, distance) {
            const newRadius = circle.radius + distance;  // Positive distance = external (grow)
            this.debug(`Offsetting circle with ${circle.radius} radius`);
            this.debug(`Offsetting circle with ${newRadius} new radius`);
            
            const isInternal = distance < 0;  // Negative = internal (shrink)

            // Register with proper metadata
            const offsetCurveId = window.globalCurveRegistry?.register({
                type: 'circle',
                center: { ...circle.center },
                radius: newRadius,
                clockwise: isInternal,
                isOffsetDerived: true,
                offsetDirection: isInternal ? 'internal' : 'external',
                sourceCurveId: circle.properties?.originalCurveId || null,
                offsetDistance: distance,
                source: 'circle_offset'
            });
            
            // Create circle with metadata
            const offsetCircle = {
                type: 'circle',
                center: { ...circle.center },
                radius: newRadius,
                properties: {
                    ...circle.properties,
                    isOffset: true,
                    offsetDistance: distance,
                    offsetType: isInternal ? 'internal' : 'external',
                    expectedWinding: isInternal ? 'ccw' : 'cw',
                    originalCurveId: offsetCurveId
                },
                getBounds: function() {
                    return {
                        minX: this.center.x - this.radius,
                        minY: this.center.y - this.radius,
                        maxX: this.center.x + this.radius,
                        maxY: this.center.y + this.radius
                    };
                }
            };
            
            return new CirclePrimitive(circle.center, newRadius, offsetCircle.properties);
        }

        /**
         * Calculates the intersection point of two lines.
         * @param {object} p1 - Point 1 of line 1 {x, y}
         * @param {object} p2 - Point 2 of line 1 {x, y}
         * @param {object} p3 - Point 3 of line 2 {x, y}
         * @param {object} p4 - Point 4 of line 2 {x, y}
         * @returns {object|null} The intersection point {x, y} or null if lines are parallel.
         */
        lineLineIntersection(p1, p2, p3, p4) {
            const den = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);

            const epsilon = geomConfig.offsetting?.epsilon || 1e-9;
            if (Math.abs(den) < epsilon) {
                // Lines are parallel or collinear
                return null;
            }

            const t_num = (p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x);
            const u_num = -((p1.x - p2.x) * (p1.y - p3.y) - (p1.y - p2.y) * (p1.x - p3.x));
            
            const t = t_num / den;
            
            return {
                x: p1.x + t * (p2.x - p1.x),
                y: p1.y + t * (p2.y - p1.y)
            };
        }
        
        /**
         * - Internal offsets (distance < 0) are TRIMMED (mitered/beveled).
         * - External offsets (distance > 0) are ROUNDED at convex corners and TRIMMED at reflex (concave) corners.
         */
        offsetPath(path, distance, options = {}) {
            if (!path.points || path.points.length < 2) {
                this.debug('Insufficient points');
                return null;
            }
            
            const isInternal = distance < 0;
            const offsetDist = Math.abs(distance);
            const props = path.properties || {};

            // 1. Check for analytic arc paths (no change to this logic)
            const hasAnalyticArcs = (path.properties.arcSegments && path.properties.arcSegments.length > 0) ||
                                    (path.contours && path.contours[0]?.arcSegments?.length > 0) ||
                                    (path.arcSegments && path.arcSegments.length > 0);

            if (hasAnalyticArcs) {
                const arcCount = (path.properties.arcSegments?.length) || (path.contours && path.contours[0]?.arcSegments?.length) || path.arcSegments.length;
                this.debug(`Path has ${arcCount} arc segments, attempting analytic offset`);
                return this.offsetPathWithArcs(path, distance, options);
            }
            
            // 2. Prepare polygon points
            let polygonPoints = path.points.slice();
            const first = polygonPoints[0];
            const last = polygonPoints[polygonPoints.length - 1];
            if (Math.hypot(first.x - last.x, first.y - last.y) < this.options.precision) {
                polygonPoints.pop(); // Remove duplicate closing point
            }

            // De-noise the path before offsetting, ONLY for internal offsets.
            const simplificationConfig = window.PCBCAMConfig?.geometry?.simplification;

            if (isInternal && simplificationConfig?.enabled && polygonPoints.length > 10) {
                // Read tolerance from the config file
                const tolerance = simplificationConfig.tolerance || 0.001;
                const sqTolerance = tolerance * tolerance;
                
                const originalCount = polygonPoints.length;
                polygonPoints = this._simplifyDouglasPeucker(polygonPoints, sqTolerance);
                const newCount = polygonPoints.length;

                if (originalCount > newCount) {
                    this.debug(`Simplified internal path from ${originalCount} to ${newCount} points.`);
                }
            }
            
            const n = polygonPoints.length;
            if (n < 3) return null;
            
            // 3. Determine winding and normal direction
            const isPathClockwise = GeometryUtils.isClockwise(polygonPoints);
            let normalDirection = isInternal ? 1 : -1;
            if (isPathClockwise) {
                normalDirection *= -1;
            }

            // 4. Create offset line segments (Same as before)
            const offsetSegments = [];
            for (let i = 0; i < n; i++) {
                const p1 = polygonPoints[i];
                const p2 = polygonPoints[(i + 1) % n];
                
                const v = { x: p2.x - p1.x, y: p2.y - p1.y };
                const len = Math.hypot(v.x, v.y);
                if (len < this.options.precision) continue;
                
                const nx = normalDirection * (-v.y / len);
                const ny = normalDirection * (v.x / len);

                offsetSegments.push({
                    p1: { x: p1.x + nx * offsetDist, y: p1.y + ny * offsetDist },
                    p2: { x: p2.x + nx * offsetDist, y: p2.y + ny * offsetDist }
                });
            }

            // 5. Process joints between segments (Refactored Loop)
            const finalPoints = [];
            const numSegs = offsetSegments.length;
            if (numSegs < 2) return null; // Need at least 2 segments to join

            const miterLimit = (this.options.miterLimit) * offsetDist;

            for (let i = 0; i < numSegs; i++) {
                const seg1 = offsetSegments[i];
                const seg2 = offsetSegments[(i + 1) % numSegs];
                
                // Add the start point of the first segment, once
                if (finalPoints.length === 0) {
                    finalPoints.push(seg1.p1);
                }

                // Get original corner geometry
                const curr = polygonPoints[(i + 1) % n];
                const prev = polygonPoints[i];
                const next = polygonPoints[(i + 2) % n];

                const v1_vec = { x: curr.x - prev.x, y: curr.y - prev.y };
                const v2_vec = { x: next.x - curr.x, y: next.y - curr.y };

                // Calculate cross product to determine corner type
                const crossProduct = (v1_vec.x * v2_vec.y) - (v1_vec.y * v2_vec.x);
                const isReflexCorner = isPathClockwise ? (crossProduct > 0) : (crossProduct < 0);

                // Check for collinearity to handle tessellation noise
                const len1 = Math.hypot(v1_vec.x, v1_vec.y);
                const len2 = Math.hypot(v2_vec.x, v2_vec.y);
                let dot = 0;

                if (len1 > this.options.precision && len2 > this.options.precision) {
                    // Normalized dot product: 1 = 0°, 0 = 90°, -1 = 180°
                    dot = (v1_vec.x * v2_vec.x + v1_vec.y * v2_vec.y) / (len1 * len2);
                }

                // Segments are collinear (just noise) if dot is near 1 OR if segments are degenerate
                const collinearThreshold = geomConfig.offsetting?.collinearDotThreshold || 0.995;
                const isCollinear = (dot > collinearThreshold) || (len1 < this.options.precision) || (len2 < this.options.precision);

                // Determine joint type
                // Miter joint for internal offsets, reflex corners, OR collinear segments
                const isMiterJoint = isInternal || isReflexCorner || isCollinear;

                if (isMiterJoint) {
                    // A. MITER / BEVEL JOINT
                    // (Used for all internal, reflex, and collinear corners)
                    const jointPoints = this._createMiterBevelJoint(
                        seg1, seg2, curr, miterLimit
                    );
                    finalPoints.push(...jointPoints);

                } else {
                    // B. ROUND JOINT
                    // (Used *only* for external, convex, NON-collinear corners)
                    
                    // Add the end of the straight segment
                    finalPoints.push(seg1.p2);

                    // Add the arc points for the joint
                    const arcPoints = this._createRoundJoint(
                        curr, v1_vec, v2_vec, normalDirection, offsetDist, distance
                    );
                    finalPoints.push(...arcPoints);
                }
            }
            
            if (finalPoints.length < 3) {
                this.debug('Insufficient offset points generated');
                return null;
            }
            
            // 6. Close the final path (Same as before)
            const firstFinal = finalPoints[0];
            const lastFinal = finalPoints[finalPoints.length - 1];
            if (Math.hypot(firstFinal.x - lastFinal.x, firstFinal.y - lastFinal.y) > this.options.precision) {
                finalPoints.push(firstFinal);
            }
            
            return new PathPrimitive(finalPoints, {
                ...path.properties, originalType: 'filled_path', closed: true, fill: true, stroke: false,
                isOffset: true, offsetDistance: distance, offsetType: isInternal ? 'internal' : 'external',
                polygonized: true
            });
        }

        /**
         * Calculates the points for a miter or bevel joint.
         * @returns {Array<object>} An array containing 1 point (miter) or 2 points (bevel).
         */
        _createMiterBevelJoint(seg1, seg2, originalCorner, miterLimit) {
            const intersection = this.lineLineIntersection(
                seg1.p1, seg1.p2, // Line 1
                seg2.p1, seg2.p2  // Line 2
            );

            if (intersection) {
                // Check miter length
                const miterLength = Math.hypot(intersection.x - originalCorner.x, intersection.y - originalCorner.y);

                if (miterLength > miterLimit) {
                    // Miter limit exceeded. BEVEL the joint.
                    // Return the two endpoints of the parallel segments to create a flat cap.
                    return [seg1.p2, seg2.p1];
                } else {
                    // Miter is within limit. Return the single intersection point.
                    return [intersection];
                }
            } else {
                // Parallel lines (180 deg corner), just add the segment's end point.
                // This will be joined to seg2.p1 by the next loop iteration.
                return [seg1.p2];
            }
        }

        /**
         * Calculates the points for a round joint (external convex corner).
         * @returns {Array<object>} An array containing the tessellated points for the arc.
         */
        _createRoundJoint(originalCorner, v1_vec, v2_vec, normalDirection, offsetDist, distance) {
            // Get normals
            const len1 = Math.hypot(v1_vec.x, v1_vec.y);
            const len2 = Math.hypot(v2_vec.x, v2_vec.y);

            if (len1 < this.options.precision || len2 < this.options.precision) {
                return []; // Degenerate segment, add no arc points
            }

            const n1 = { x: normalDirection * (-v1_vec.y / len1), y: normalDirection * (v1_vec.x / len1) };
            const n2 = { x: normalDirection * (-v2_vec.y / len2), y: normalDirection * (v2_vec.x / len2) };

            const angle1 = Math.atan2(n1.y, n1.x);
            const angle2 = Math.atan2(n2.y, n2.x);
            let angleDiff = angle2 - angle1;

            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

            const jointIsClockwise = angleDiff < 0;

            const jointCurveId = window.globalCurveRegistry.register({
                type: 'arc', center: { x: originalCorner.x, y: originalCorner.y }, radius: offsetDist,
                startAngle: angle1, endAngle: angle2, clockwise: jointIsClockwise,
                source: 'offset_joint', isOffsetDerived: true, offsetDistance: distance
            });
            
            const fullCircleSegments = GeometryUtils.getOptimalSegments(offsetDist, 'circle');
            const proportionalSegments = fullCircleSegments * (Math.abs(angleDiff) / (2 * Math.PI));
            const minSegments = geomConfig.offsetting?.minRoundJointSegments || 2;
            const arcSegments = Math.max(minSegments, Math.ceil(proportionalSegments));
            
            const arcPoints = [];
            
            // Generate arc points, skipping the first (which is seg1.p2)
            for (let j = 1; j <= arcSegments; j++) {
                const t = j / arcSegments;
                const angle = angle1 + angleDiff * t;
                const point = {
                    x: originalCorner.x + offsetDist * Math.cos(angle), 
                    y: originalCorner.y + offsetDist * Math.sin(angle),
                    curveId: jointCurveId, 
                    segmentIndex: j, 
                    totalSegments: arcSegments + 1, 
                    t: t
                };
                arcPoints.push(point);
            }
            
            return arcPoints;
        }

        /**
         * Offset a path with arc segments analytically
         */
        offsetPathWithArcs(path, distance, options = {}) {
            const newPoints = [];
            const newArcSegments = [];
            const offsetDist = Math.abs(distance);
            const isInternal = distance < 0;
            
            // Read from contours structure
            const sourceArcSegments = (path.contours && path.contours[0]?.arcSegments) || 
                                    path.arcSegments || [];
            const sourcePoints = (path.contours && path.contours[0]?.points) || 
                                path.points;
            
            if (!sourceArcSegments || sourceArcSegments.length === 0) {
                return this.offsetPath(path, distance, options);
            }
            
            const sortedArcs = sourceArcSegments.slice().sort((a, b) => a.startIndex - b.startIndex);

            this.debug(`Input: ${sortedArcs.length} arcs, ${sourcePoints.length} points`);
            sortedArcs.forEach((arc, i) => {
                this.debug(`  Arc ${i}: [${arc.startIndex}->${arc.endIndex}], r=${arc.radius.toFixed(3)}, ${arc.clockwise ? 'CW' : 'CCW'}`);
            });

            let currentIdx = 0;
            
            for (const arcSeg of sortedArcs) {
                // Process line segments before arc
                while (currentIdx < arcSeg.startIndex) {
                    const p1 = sourcePoints[currentIdx];
                    const p2 = sourcePoints[currentIdx + 1];
                    if (p2 && Math.hypot(p2.x - p1.x, p2.y - p1.y) > this.options.precision) {
                        const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy);
                        const nx = -dy / len, ny = dx / len;
                        const sign = isInternal ? -1 : 1;
                        if (currentIdx === 0) {
                            newPoints.push({
                                x: p1.x + nx * offsetDist * sign,
                                y: p1.y + ny * offsetDist * sign
                            });
                        }
                    }
                    currentIdx++;
                }
                
                // Offset the arc analytically
                const newRadius = isInternal ? arcSeg.radius - offsetDist : arcSeg.radius + offsetDist;
                
                if (newRadius > this.options.precision) {
                    const offsetClockwise = arcSeg.clockwise;

                    const offsetCurveId = window.globalCurveRegistry?.register({
                        type: 'arc',
                        center: { ...arcSeg.center },
                        radius: newRadius,
                        startAngle: arcSeg.startAngle,
                        endAngle: arcSeg.endAngle,
                        clockwise: offsetClockwise,
                        isOffsetDerived: true,
                        offsetDistance: distance,
                        source: 'analytic_offset'
                    });
                    
                    const startPtIdx = newPoints.length;
                    
                    newPoints.push({
                        x: arcSeg.center.x + newRadius * Math.cos(arcSeg.startAngle),
                        y: arcSeg.center.y + newRadius * Math.sin(arcSeg.startAngle),
                        curveId: offsetCurveId,
                        segmentIndex: 0
                    });
                    newPoints.push({
                        x: arcSeg.center.x + newRadius * Math.cos(arcSeg.endAngle),
                        y: arcSeg.center.y + newRadius * Math.sin(arcSeg.endAngle),
                        curveId: offsetCurveId,
                        segmentIndex: 1
                    });

                    let sweepAngle = arcSeg.endAngle - arcSeg.startAngle;
                    
                    // Normalize to smallest absolute angle
                    while (sweepAngle > Math.PI) sweepAngle -= 2 * Math.PI;
                    while (sweepAngle < -Math.PI) sweepAngle += 2 * Math.PI;
                    
                    // Apply direction: CCW = positive, CW = negative
                    if (!offsetClockwise && sweepAngle < 0) {
                        sweepAngle += 2 * Math.PI;
                    } else if (offsetClockwise && sweepAngle > 0) {
                        sweepAngle -= 2 * Math.PI;
                    }
                    
                    newArcSegments.push({
                        startIndex: startPtIdx,
                        endIndex: startPtIdx + 1,
                        center: { ...arcSeg.center },
                        radius: newRadius,
                        startAngle: arcSeg.startAngle,
                        endAngle: arcSeg.endAngle,
                        clockwise: offsetClockwise,
                        curveId: offsetCurveId,
                        sweepAngle: sweepAngle
                    });
                }
                currentIdx = arcSeg.endIndex;
            }

            this.debug(`Output: ${newArcSegments.length} arcs, ${newPoints.length} points`);
            newArcSegments.forEach((arc, i) => {
                this.debug(`  Arc ${i}: [${arc.startIndex}->${arc.endIndex}], r=${arc.radius.toFixed(3)}`);
            });
            
            // Check if last arc wrapped to start (closes path)
            const pathClosedByArc = (currentIdx === 0 && sortedArcs.length > 0);
            
            // Remaining line segments (skip if path closed by arc)
            if (!pathClosedByArc) {
                while (currentIdx < sourcePoints.length - 1) {
                    const p1 = sourcePoints[currentIdx];
                    const p2 = sourcePoints[currentIdx + 1];
                    if (p2 && Math.hypot(p2.x - p1.x, p2.y - p1.y) > this.options.precision) {
                        const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy);
                        const nx = -dy / len, ny = dx / len;
                        const sign = isInternal ? -1 : 1;
                        newPoints.push({
                            x: p1.x + nx * offsetDist * sign,
                            y: p1.y + ny * offsetDist * sign
                        });
                    }
                    currentIdx++;
                }
            }
            
            // Close path
            if (newPoints.length > 2) {
                const first = newPoints[0], last = newPoints[newPoints.length - 1];
                if (Math.hypot(first.x - last.x, first.y - last.y) > this.options.precision) {
                    newPoints.push({ ...first });
                }
            }
            
            // Store in contour structure
            const offsetContour = {
                points: newPoints,
                isHole: false,
                nestingLevel: 0,
                parentId: null,
                curveIds: newArcSegments.map(s => s.curveId).filter(Boolean),
                arcSegments: newArcSegments
            };
            
            return new PathPrimitive(newPoints, {
                ...path.properties,
                closed: true,
                fill: true,
                isOffset: true,
                offsetDistance: distance,
                offsetType: isInternal ? 'internal' : 'external',
                arcSegments: newArcSegments,
                contours: [offsetContour]
            });
        }
        
        offsetRectangle(rectangle, distance, options = {}) {
            const { x, y } = rectangle.position;
            const w = rectangle.width || 0;
            const h = rectangle.height || 0;

            // Convert the rectangle into a standard closed Counter-Clockwise (CCW) path.
            const rectAsPath = new PathPrimitive(
                [
                    { x: x,     y: y },         // top-left
                    { x: x,     y: y + h },     // bottom-left
                    { x: x + w, y: y + h },     // bottom-right
                    { x: x + w, y: y },         // top-right
                    { x: x,     y: y }          // Explicitly close path
                ],
                {
                    ...rectangle.properties,
                    fill: true,
                    closed: true
                }
            );

            // Delegate the actual offsetting work to the more robust offsetPath function.
            return this.offsetPath(rectAsPath, distance, options);
        }
        
        offsetArc(arc, distance) {
            const newRadius = arc.radius + distance;
            
            const isInternal = distance < 0;
            
            const offsetArc = {
                type: 'arc',
                center: { ...arc.center },
                radius: newRadius,
                startAngle: arc.startAngle,
                endAngle: arc.endAngle,
                clockwise: arc.clockwise,
                properties: {
                    ...arc.properties,
                    isOffset: true,
                    offsetDistance: distance,
                    offsetType: isInternal ? 'internal' : 'external',
                    expectedWinding: isInternal ? 'ccw' : 'cw'
                },
                getBounds: function() {
                    return {
                        minX: this.center.x - this.radius,
                        minY: this.center.y - this.radius,
                        maxX: this.center.x + this.radius,
                        maxY: this.center.y + this.radius
                    };
                }
            };
            
                return new ArcPrimitive(
                    arc.center, newRadius,
                    arc.startAngle, arc.endAngle,
                    arc.clockwise, offsetArc.properties
                );

        }
        
        offsetObround(obround, distance) {
            this.debug(`Offsetting obround by ${distance.toFixed(3)}mm.`);

            // 1. Determine if the offset is internal (shrinking) or external (growing).
            const isInternal = distance < 0;

            // 2. Calculate the dimensions and position of the new, offset obround.
            // The offset is applied to all sides, so width/height change by 2*distance.
            // The position is shifted by -distance on both axes to keep the shape centered.
            const newWidth = obround.width + (distance * 2);
            const newHeight = obround.height + (distance * 2);
            const newPosition = {
                x: obround.position.x - distance,
                y: obround.position.y - distance
            };

            // 3. Handle degenerate cases where an internal offset collapses the shape.
            if (newWidth < this.options.precision || newHeight < this.options.precision) {
                if (debugConfig.enabled) {
                    const w = newWidth.toFixed(3);
                    const h = newHeight.toFixed(3);
                    console.warn(`Obround offset resulted in a degenerate shape (w=${w}, h=${h}). Returning null.`);
                }
                return null;
            }

            // 4. Create a new ObroundPrimitive using the calculated offset geometry.
            const offsetObroundPrimitive = new ObroundPrimitive(newPosition, newWidth, newHeight, {
                ...obround.properties
            });

            // 5. Convert this new analytic primitive into a polygon for the next processing stage.
            const offsetPath = GeometryUtils.primitiveToPath(offsetObroundPrimitive);
            
            // If polygon creation failed, return null.
            if (!offsetPath || !offsetPath.points || offsetPath.points.length < 3) {
                return null;
            }

            // 6. Add the required offset metadata to the final PathPrimitive.
            offsetPath.properties = {
                ...offsetPath.properties,
                isOffset: true,
                offsetDistance: distance,
                offsetType: isInternal ? 'internal' : 'external',
                sourcePrimitiveId: obround.id,
            };
            
            // 7. Post-process the newly registered curve IDs to mark them as offset-derived.
            if (window.globalCurveRegistry && offsetPath.curveIds) {
                offsetPath.curveIds.forEach(id => {
                    const curve = window.globalCurveRegistry.getCurve(id);
                    if (curve) {
                        curve.isOffsetDerived = true;
                        curve.offsetDistance = distance;
                        // Associate it with the original obround's curves if possible
                        curve.sourceCurveId = obround.curveIds ? obround.curveIds[0] : null; 
                    }
                });
            }

            if (debugConfig.enabled) {
                const pointCount = offsetPath.points.length;
                const curveCount = offsetPath.curveIds?.length || 0;
                console.log(`Successfully created offset obround path with ${pointCount} points and ${curveCount} registered curves.`);
            }

            return offsetPath;
        }

        /**
         * Calculates the squared perpendicular distance from a point to a line segment.
         */
        _getSqDistToSegment(p, p1, p2) {
            let x = p1.x, y = p1.y;
            let dx = p2.x - x, dy = p2.y - y;

            if (dx !== 0 || dy !== 0) {
                const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
                if (t > 1) {
                    x = p2.x; y = p2.y;
                } else if (t > 0) {
                    x += dx * t; y += dy * t;
                }
            }

            dx = p.x - x;
            dy = p.y - y;
            return dx * dx + dy * dy;
        }

        /**
         * Simplifies a path using a non-recursive Douglas-Peucker algorithm.
         * @param {Array<object>} points - The array of points to simplify.
         * @param {number} sqTolerance - The squared simplification tolerance.
         * @returns {Array<object>} The simplified array of points.
         */
        _simplifyDouglasPeucker(points, sqTolerance) {
            if (points.length < 3) {
                return points;
            }

            const len = points.length;
            const markers = new Uint8Array(len); // Array to mark points to keep
            markers[0] = 1;      // Always keep the first point
            markers[len - 1] = 1; // Always keep the last point

            const stack = [];
            stack.push(0, len - 1); // Push the first and last indices

            while (stack.length > 0) {
                const last = stack.pop();
                const first = stack.pop();

                let maxSqDist = 0;
                let index = first;

                // Find the point farthest from the line segment (first, last)
                for (let i = first + 1; i < last; i++) {
                    const sqDist = this._getSqDistToSegment(points[i], points[first], points[last]);
                    if (sqDist > maxSqDist) {
                        index = i;
                        maxSqDist = sqDist;
                    }
                }

                // If the max distance is greater than our tolerance, we need to keep this point
                if (maxSqDist > sqTolerance) {
                    markers[index] = 1; // Mark the point
                    // Push the two new sub-segments onto the stack
                    if (index - first > 1) stack.push(first, index);
                    if (last - index > 1) stack.push(index, last);
                }
            }

            // Build the new simplified path
            const newPoints = [];
            for (let i = 0; i < len; i++) {
                if (markers[i]) {
                    newPoints.push(points[i]);
                }
            }

            return newPoints;
        }
    }

    window.GeometryOffsetter = GeometryOffsetter;

})();