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

    const config = window.PCBCAMConfig;
    const geomConfig = config.geometry;
    const debugConfig = config.debug;

    class GeometryOffsetter {
        constructor(options = {}) {
            this.options = {
                precision: options.precision || geomConfig.coordinatePrecision,
                miterLimit: options.miterLimit
            };
            this.initialized = true;
            this.geometryProcessor = null;
        }

        debug(message, data = null) {
            if (debugConfig.enabled) {
                if (data) {
                    console.log(`[Offsetter] ${message}`, data);
                } else {
                    console.log(`[Offsetter] ${message}`);
                }
            }
        }

        setGeometryProcessor(processor) {
            this.geometryProcessor = processor;
        }

        /**
         * This function now correctly handles both:
         * 1. Analytic Strokes (isStroke === true)
         * 2. Analytic Fills (Circle, Rectangle, etc.)
         * 3. Path Primitives (type === 'path')
         */
        async offsetPrimitive(primitive, distance) {
            if (debugConfig.enabled) {
                console.log('[Offsetter] Primitive properties:', {
                    isCutout: primitive.properties?.isCutout,
                    layerType: primitive.properties?.layerType,
                    stroke: primitive.properties?.stroke,
                    fill: primitive.properties?.fill,
                    isTrace: primitive.properties?.isTrace,
                    closed: primitive.properties?.closed
                });
            }

            if (!primitive || !primitive.type) return null;
            if (Math.abs(distance) < this.options.precision) return primitive;

            const props = primitive.properties || {};
            const isCutout = props.isCutout || props.layerType === 'cutout';
            const isStroke = !isCutout && ((props.stroke && !props.fill) || props.isTrace);

            if (isStroke) {
                this.debug(`Handling primitive ${primitive.id} as STROKE`);
                const originalWidth = props.strokeWidth;
                const totalWidth = originalWidth + (distance * 2);

                if (totalWidth < this.options.precision) {
                    this.debug(`Stroke width too small, skipping: ${totalWidth}`);
                    return null;
                }

                // Handle ARC strokes
                if (primitive.type === 'arc') {
                    this.debug(`Polygonizing ArcStroke ${primitive.id} with total width ${totalWidth}`);

                    // arcToPolygon returns a complete PathPrimitive with registered curves
                    const pathPrimitive = GeometryUtils.arcToPolygon(primitive, totalWidth);

                    if (!pathPrimitive) {
                        if (debugConfig.enabled) console.warn(`Polygonization of arc stroke ${primitive.id} failed.`);
                        return null;
                    }

                    // Add offset-specific properties
                    Object.assign(pathPrimitive.properties, {
                        ...props,
                        fill: true,
                        stroke: false,
                        isOffset: true,
                        offsetDistance: distance,
                        offsetType: distance < 0 ? 'internal' : 'external',
                        polygonized: true
                    });

                    return pathPrimitive;

                // Handle path strokes (linear polylines)
                } else if (primitive.type === 'path' && primitive.contours?.[0]?.points) {
                    const points = primitive.contours[0].points;
                    this.debug(`Polygonizing PathStroke ${primitive.id} with total width ${totalWidth}`);

                    // Create array for curve IDs, pass to polylineToPolygon for mutation
                    const polygonCurveIds = [];
                    const polygonPoints = GeometryUtils.polylineToPolygon(points, totalWidth, polygonCurveIds);

                    if (!polygonPoints || polygonPoints.length < 3) {
                        if (debugConfig.enabled) console.warn(`Polygonization of path stroke ${primitive.id} failed.`);
                        return null;
                    }

                    const isInternal = distance < 0;

                    // Build contour with the mutated curve IDs
                    const contour = {
                        points: polygonPoints,
                        isHole: false,
                        nestingLevel: 0,
                        parentId: null,
                        arcSegments: [],
                        curveIds: polygonCurveIds
                    };

                    return new PathPrimitive([contour], {
                        ...props,
                        fill: true,
                        stroke: false,
                        isOffset: true,
                        offsetDistance: distance,
                        offsetType: isInternal ? 'internal' : 'external',
                        polygonized: true
                    });

                // Handle other unhandled stroke types
                } else {
                    if (debugConfig.enabled) console.warn(`Unhandled stroke type: ${primitive.type}`);
                    return null;
                }
            }

            if (debugConfig.enabled) {
                console.log('[Offsetter] offsetPrimitive called', {
                    type: primitive.type,
                    hasContours: !!primitive.contours,
                    contourCount: primitive.contours?.length,
                    firstContourArcs: primitive.contours?.[0]?.arcSegments?.length
                });
            }

            // Normalize unsupported analytic primitives to PathPrimitive
            if (primitive.type === 'arc' || 
                primitive.type === 'elliptical_arc' || 
                primitive.type === 'bezier') {

                if (typeof GeometryUtils === 'undefined' || !GeometryUtils.primitiveToPath) {
                    console.error(`[GeometryOffsetter] Cannot convert ${primitive.type}: GeometryUtils.primitiveToPath not available`);
                    return null;
                }

                const convertedPrimitive = GeometryUtils.primitiveToPath(primitive);
                if (!convertedPrimitive) {
                    console.warn(`[GeometryOffsetter] Failed to convert ${primitive.type} to path`);
                    return null;
                }

                // Preserve original type info for debugging
                if (!convertedPrimitive.properties) convertedPrimitive.properties = {};
                convertedPrimitive.properties.originalType = primitive.type;
                convertedPrimitive.properties.wasConverted = true;

                primitive = convertedPrimitive;
            }

            // Filled shapes - use hybrid offsetting for paths with arcs
            switch (primitive.type) {
                case 'path':
                    try {
                    const hasArcs = primitive.contours?.some(c => 
                        c.arcSegments && c.arcSegments.length > 0
                    );

                    if (hasArcs) {
                        this.debug(`Using hybrid offset for path with ${primitive.contours[0].arcSegments.length} arcs`);
                    } else {
                        this.debug(`Using polygon offset for path (no arcs)`);
                    }
                    this.debug(`Calling offsetPath() (hasArcs=${hasArcs})`);
                    const result = this.offsetPath(primitive, distance);
                    this.debug('offsetPath returned:', result);
                    return result;

                } catch (error) {
                    console.error('[Offsetter] ERROR in path case:', error);
                    throw error;
                }

                case 'arc':
                    return this.offsetArc(primitive, distance);
                case 'circle':
                    return this.offsetCircle(primitive, distance);
                case 'rectangle':
                    return this.offsetRectangle(primitive, distance);
                case 'obround':
                    return this.offsetObround(primitive, distance);
                default:
                    // If it's not a known type or path with contours, it's invalid.
                    if (primitive.type === 'path' && primitive.contours && primitive.contours.length > 0) {
                        return this.offsetPath(primitive, distance);
                    }
                    this.debug(`An invalid primitive fell-through without a corresponding offset geometry.`);
                    return null;
            }
        }

        offsetCircle(circle, distance) {
            const newRadius = circle.radius + distance;  // Positive distance = external (grow)
            const isInternal = distance < 0;

            if (newRadius < this.options.precision) {
                this.debug(`Offsetting circle with ${circle.radius} radius resulted in degenerate radius ${newRadius}, skipping.`);
                return null; // Collapsed to nothing
            }

            this.debug(`Offsetting circle with ${circle.radius}r to new radius ${newRadius}r`);

            // Create a new, analytic CirclePrimitive for the offset
            const offsetCirclePrimitive = new CirclePrimitive(
                circle.center, 
                newRadius, 
                { ...circle.properties }
            );

            // Convert this new analytic primitive into a "One Rule" PathPrimitive
            const offsetPath = GeometryUtils.primitiveToPath(offsetCirclePrimitive);

            if (!offsetPath || !offsetPath.contours || offsetPath.contours.length === 0) {
                this.debug(`Tessellation of offset circle failed`);
                return null;
            }

            // Add the required offset metadata to the final PathPrimitive.
            offsetPath.properties = {
                ...offsetPath.properties,
                isOffset: true,
                offsetDistance: distance,
                offsetType: isInternal ? 'internal' : 'external',
                sourcePrimitiveId: circle.id,
            };

            // Post-process the newly registered curve IDs to mark them as offset-derived.
            const contour = offsetPath.contours[0];
            if (window.globalCurveRegistry && contour.curveIds) {
                contour.curveIds.forEach(id => {
                    const curve = window.globalCurveRegistry.getCurve(id);
                    if (curve) {
                        curve.isOffsetDerived = true;
                        curve.offsetDistance = distance;
                        // Try to find the original curve ID from the source circle
                        curve.sourceCurveId = circle.properties?.originalCurveId || (circle.curveIds ? circle.curveIds[0] : null); 
                    }
                });
            }

            this.debug(`Successfully created offset circle path with ${contour.points.length} points.`);

            return offsetPath;
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
            // const u_num = -((p1.x - p2.x) * (p1.y - p3.y) - (p1.y - p2.y) * (p1.x - p3.x));

            const t = t_num / den;

            return {
                x: p1.x + t * (p2.x - p1.x),
                y: p1.y + t * (p2.y - p1.y)
            };
        }

        /**
         * - Internal offsets (distance < 0) are trimmed (mitered/beveled). // Review - complex internal corners may need rounded joints?
         * - External offsets (distance > 0) are rounded at convex corners and trimmed at reflex (concave) corners.
         */
        async offsetPath(path, distance) {
            if (debugConfig.enabled) {
                console.log('[Offsetter] offsetPath ENTERED', {
                    hasContours: !!path.contours,
                    contourCount: path.contours?.length,
                    firstContourPoints: path.contours?.[0]?.points?.length,
                    firstContourArcs: path.contours?.[0]?.arcSegments?.length
                });
            }

            if (!path.contours || path.contours.length === 0) {
                this.debug('OffsetPath: Path has no contours, skipping.');
                return null;
            }

            if (path.contours.length > 1) {
                this.debug(`Decomposing compound path with ${path.contours.length} contours for offset`);
                const results = [];

                for (const contour of path.contours) {
                    if (!contour.points || contour.points.length < 2) continue;
                    const contourDistance = contour.isHole ? -distance : distance;
                    const hasArcs = contour.arcSegments && contour.arcSegments.length > 0;

                    if (hasArcs) {
                        const offsetResult = this._offsetHybridContour(contour, contourDistance);
                        if (offsetResult) {
                            results.push(new PathPrimitive([offsetResult], {
                                ...path.properties,
                                closed: true,
                                fill: true,
                                isOffset: true,
                                offsetDistance: contourDistance,
                                offsetType: contourDistance < 0 ? 'internal' : 'external',
                                polarity: contour.isHole ? 'clear' : 'dark'
                            }));
                        }
                    } else {
                        const offsetPoints = this._offsetContourPoints(contour.points, contourDistance);
                        if (offsetPoints && offsetPoints.length >= 3) {
                            results.push(new PathPrimitive([{
                                points: offsetPoints,
                                isHole: false,
                                nestingLevel: 0,
                                parentId: null,
                                arcSegments: [],
                                curveIds: []
                            }], {
                                ...path.properties,
                                closed: true,
                                fill: true,
                                isOffset: true,
                                offsetDistance: contourDistance,
                                offsetType: contourDistance < 0 ? 'internal' : 'external',
                                polarity: contour.isHole ? 'clear' : 'dark'
                            }));
                        }
                    }
                }
                return results.length > 0 ? results : null;
            }

            const contour = path.contours[0];
            if (!contour.points || contour.points.length < 2) return null;

            const hasArcs = contour.arcSegments && contour.arcSegments.length > 0;

            this.debug(`Processing contour: ${contour.points.length} points, ${contour.arcSegments?.length || 0} arcs, hasArcs=${hasArcs}`);

            // Handle centerline paths (open paths with zero offset)
            if (path.properties?.isCenterlinePath) {
                // For centerline, return as-is with offset metadata
                return new PathPrimitive(path.contours, {
                    ...path.properties,
                    isOffset: true,
                    offsetDistance: distance,
                    offsetType: 'on',
                    closed: false
                });
            }

            if (hasArcs) {
                const offsetResult = this._offsetHybridContour(contour, distance);

                if (!offsetResult) {
                    this.debug(`Hybrid offset returned null`);
                    return null;
                }

                this.debug(`Hybrid result: ${offsetResult.points.length} points, ${offsetResult.arcSegments.length} arcs`);

                const primitive = new PathPrimitive([offsetResult], {
                    ...path.properties,
                    closed: true,
                    fill: true,
                    isOffset: true,
                    offsetDistance: distance,
                    offsetType: distance < 0 ? 'internal' : 'external'
                });

                this.debug(`Final primitive has ${primitive.contours[0].arcSegments?.length || 0} arcs in contour[0]`);

                return primitive;
            } else {
                const offsetPoints = this._offsetContourPoints(contour.points, distance);
                if (!offsetPoints || offsetPoints.length < 3) return null;

                // Collect curve IDs from rounded joints
                const collectedCurveIds = Array.from(
                    new Set(offsetPoints.map(p => p.curveId).filter(Boolean))
                );

                return new PathPrimitive([{
                    points: offsetPoints,
                    isHole: false,
                    nestingLevel: 0,
                    parentId: null,
                    arcSegments: [],
                    curveIds: collectedCurveIds
                }], {
                    ...path.properties,
                    closed: true,
                    fill: true,
                    isOffset: true,
                    offsetDistance: distance,
                    offsetType: distance < 0 ? 'internal' : 'external'
                });
            }
        }

        /**
         * Calculates the points for a miter or bevel joint.
         * @returns {Array<object>} An array containing 1 point (miter) or 2 points (bevel).
         */
        _createMiterBevelJoint(seg1, seg2, miterLimit) {
            const intersection = this.lineLineIntersection(
                seg1.p1, seg1.p2, // Line 1
                seg2.p1, seg2.p2  // Line 2
            );

            if (intersection) {
                // Check miter length
                const miterLength = Math.hypot(intersection.x - seg1.p2.x, intersection.y - seg1.p2.y);

                if (miterLength > miterLimit) {
                    // Miter limit exceeded. BEVEL the joint.
                    return [seg1.p2, seg2.p1];
                } else {
                    // Miter is within limit. Return the single intersection point.
                    return [intersection];
                }
            } else {
                // Parallel lines (180 deg corner), just add the segment's end point.
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

        // Extract core offset logic
        _offsetContourPoints(points, distance) {
            const isInternal = distance < 0;
            const offsetDist = Math.abs(distance);
            
            // Work directly with sparse points - NO flattening
            let polygonPoints = points.slice();
            
            const first = polygonPoints[0];
            const last = polygonPoints[polygonPoints.length - 1];
            if (Math.hypot(first.x - last.x, first.y - last.y) < this.options.precision) {
                polygonPoints.pop();
            }

            // Simplification for internal offsets only
            const simplificationConfig = window.PCBCAMConfig?.geometry?.simplification;
            if (isInternal && simplificationConfig?.enabled && polygonPoints.length > 10) {
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

            // Determine winding and normal direction
            const isPathClockwise = GeometryUtils.isClockwise(polygonPoints);
            let normalDirection = isInternal ? 1 : -1;
            if (isPathClockwise) {
                normalDirection *= -1;
            }

            // Create offset segments
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

            // Process joints
            const finalPoints = [];
            const numSegs = offsetSegments.length;
            if (numSegs < 2) return null;

            const miterLimit = (this.options.miterLimit || 2.0) * offsetDist;

            for (let i = 0; i < numSegs; i++) {
                const seg1 = offsetSegments[i];
                const seg2 = offsetSegments[(i + 1) % numSegs];

                const curr = polygonPoints[(i + 1) % n];
                const prev = polygonPoints[i];
                const next = polygonPoints[(i + 2) % n];

                const v1_vec = { x: curr.x - prev.x, y: curr.y - prev.y };
                const v2_vec = { x: next.x - curr.x, y: next.y - curr.y };

                const crossProduct = (v1_vec.x * v2_vec.y) - (v1_vec.y * v2_vec.x);
                const isReflexCorner = isPathClockwise ? (crossProduct > 0) : (crossProduct < 0);

                const len1 = Math.hypot(v1_vec.x, v1_vec.y);
                const len2 = Math.hypot(v2_vec.x, v2_vec.y);
                let dot = 0;

                if (len1 > this.options.precision && len2 > this.options.precision) {
                    dot = (v1_vec.x * v2_vec.x + v1_vec.y * v2_vec.y) / (len1 * len2);
                }

                const collinearThreshold = geomConfig.offsetting?.collinearDotThreshold || 0.995;
                const isCollinear = (dot > collinearThreshold) || (len1 < this.options.precision) || (len2 < this.options.precision);

                const isMiterJoint = isInternal || isReflexCorner || isCollinear;

                if (isMiterJoint) {
                    // For miter joints (internal), only add the intersection point.
                    const jointPoints = this._createMiterBevelJoint(seg1, seg2, miterLimit);
                    finalPoints.push(...jointPoints);
                } else {
                    // For round joints (external), add the segment's end, then the arc
                    if (finalPoints.length === 0) {
                        // Must include the start point from the first segment
                        finalPoints.push(seg1.p1);
                    }
                    finalPoints.push(seg1.p2);
                    const arcPoints = this._createRoundJoint(curr, v1_vec, v2_vec, normalDirection, offsetDist, distance);
                    finalPoints.push(...arcPoints);
                }
            }

            if (finalPoints.length < 3) {
                return null;
            }

            // Close path
            const firstFinal = finalPoints[0];
            const lastFinal = finalPoints[finalPoints.length - 1];
            if (Math.hypot(firstFinal.x - lastFinal.x, firstFinal.y - lastFinal.y) > this.options.precision) {
                finalPoints.push(firstFinal);
            }

            return finalPoints;
        }

        _offsetHybridContour(contour, distance) {
            const isInternal = distance < 0;
            const offsetDist = Math.abs(distance);

            const points = contour.points;
            const arcSegments = contour.arcSegments || [];

            if (points.length < 2) return null;

            // Build arc lookup by startIndex
            const arcMap = new Map();
            arcSegments.forEach(arc => {
                arcMap.set(arc.startIndex, arc);
            });

            // Calculate normal direction for lines
            const pathWinding = GeometryUtils.calculateWinding(points);
            const pathIsCCW = pathWinding > 0;
            let normalDirection = isInternal ? 1 : -1;
            if (!pathIsCCW) normalDirection *= -1;

            // These arrays will hold the non-welded path
            const preWeldPoints = [];
            const preWeldArcSegments = [];

            // Iterate n times, processing one segment at a time (from point i to point i+1), checking if it's an arc or a line.
            const n = points.length;
            for (let i = 0; i < n; i++) {
                const startIndex = i;
                const endIndex = (i + 1) % n;

                const arc = arcMap.get(startIndex);

                // Check if an arc starts here and ends at the next point
                if (arc && arc.endIndex === endIndex) {
                    // Arc segment
                    const newRadius = arc.radius + (normalDirection * offsetDist);

                    if (newRadius < this.options.precision) {
                        this.debug(`Arc collapsed`);
                        continue;
                    }

                    // Register first
                    let curveId = null;
                    if (window.globalCurveRegistry) {
                        curveId = window.globalCurveRegistry.register({
                            type: 'arc',
                            center: arc.center,
                            radius: newRadius,
                            startAngle: arc.startAngle,
                            endAngle: arc.endAngle,
                            clockwise: arc.clockwise,
                            isOffsetDerived: true,
                            offsetDistance: distance,
                            sourceCurveId: arc.curveId,
                            source: 'hybrid_offset'
                        });
                    }

                    const newStartIndex = preWeldPoints.length;

                    preWeldPoints.push({
                        x: arc.center.x + newRadius * Math.cos(arc.startAngle),
                        y: arc.center.y + newRadius * Math.sin(arc.startAngle),
                        curveId: curveId
                    });

                    preWeldPoints.push({
                        x: arc.center.x + newRadius * Math.cos(arc.endAngle),
                        y: arc.center.y + newRadius * Math.sin(arc.endAngle),
                        curveId: curveId
                    });

                    const newEndIndex = preWeldPoints.length - 1;

                    preWeldArcSegments.push({
                        startIndex: newStartIndex,
                        endIndex: newEndIndex,
                        center: arc.center,
                        radius: newRadius,
                        startAngle: arc.startAngle,
                        endAngle: arc.endAngle,
                        sweepAngle: arc.sweepAngle,
                        clockwise: arc.clockwise,
                        curveId: curveId
                    });

                } else {
                    // Line segment
                    const p1 = points[startIndex];
                    const p2 = points[endIndex];

                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    const len = Math.hypot(dx, dy);

                    if (len > this.options.precision) {
                        const nx = normalDirection * (-dy / len);
                        const ny = normalDirection * (dx / len);

                        preWeldPoints.push({
                            x: p1.x + nx * offsetDist,
                            y: p1.y + ny * offsetDist
                        });
                        preWeldPoints.push({
                            x: p2.x + nx * offsetDist,
                            y: p2.y + ny * offsetDist
                        });
                    }
                }
            }

            if (preWeldPoints.length < 3) return null;

            // Welding logic
            const finalPoints = [];
            const finalArcSegments = [];

            // This map stores [preWeldIndex -> finalIndex]
            const indexMap = new Array(preWeldPoints.length);

            if (preWeldPoints.length > 0) {
                // Add the very first point
                finalPoints.push(preWeldPoints[0]);
                indexMap[0] = 0;

                // Weld subsequent points
                for (let j = 1; j < preWeldPoints.length; j++) {
                    const p1 = finalPoints[finalPoints.length - 1];
                    const p2 = preWeldPoints[j];
                    const dx = p1.x - p2.x;
                    const dy = p1.y - p2.y;

                    // Use squared precision for efficiency
                    if ((dx * dx + dy * dy) > (this.options.precision * this.options.precision)) {
                        // Not a duplicate, add new point
                        indexMap[j] = finalPoints.length;
                        finalPoints.push(p2);
                    } else {
                        // Is a duplicate - merge metadata
                        indexMap[j] = finalPoints.length - 1;
                        // If p2 has curveId but p1 doesn't, copy it over
                        if (p2.curveId && !p1.curveId) {
                            p1.curveId = p2.curveId;
                        }
                    }
                }
            }

            // Remap arc segments using the indexMap
            for (const seg of preWeldArcSegments) {
                const newStart = indexMap[seg.startIndex];
                const newEnd = indexMap[seg.endIndex];

                // Only add non-degenerate arcs
                if (newStart !== newEnd) {
                    finalArcSegments.push({
                        ...seg,
                        startIndex: newStart,
                        endIndex: newEnd
                    });
                }
            }

            // Check if the last point is a duplicate of the first
            if (finalPoints.length > 1) {
                const first = finalPoints[0];
                const last = finalPoints[finalPoints.length - 1];
                const dx = first.x - last.x;
                const dy = first.y - last.y;

                // Use squared precision
                if ((dx * dx + dy * dy) < (this.options.precision * this.options.precision)) {
                    const oldEndIdx = finalPoints.length - 1;
                    
                    // Merge metadata before removing
                    if (last.curveId && !first.curveId) {
                        first.curveId = last.curveId;
                    }
                    
                    finalPoints.pop();

                    // Fix any arc segment indices that pointed to the deleted point
                    finalArcSegments.forEach(seg => {
                        if (seg.startIndex === oldEndIdx) seg.startIndex = 0;
                        if (seg.endIndex === oldEndIdx) seg.endIndex = 0;
                    });
                }
            }

            this.debug(`Hybrid offset: ${points.length}pts/${arcSegments.length}arcs -> ${finalPoints.length}pts/${finalArcSegments.length}arcs`);

            return {
                points: finalPoints,
                isHole: contour.isHole || false,
                nestingLevel: 0,
                parentId: null,
                arcSegments: finalArcSegments,
                curveIds: finalArcSegments.map(s => s.curveId).filter(Boolean)
            };
        }

        offsetRectangle(rectangle, distance) {
            const { x, y } = rectangle.position;
            const w = rectangle.width;
            const h = rectangle.height;

            // Convert the rectangle into a standard closed Counter-Clockwise (CCW) path.
            const rectPoints = [
                { x: x,     y: y },
                { x: x + w, y: y },
                { x: x + w, y: y + h },
                { x: x,     y: y + h },
                { x: x,     y: y } // Explicitly close path
            ];

            const rectAsPath = new PathPrimitive([{
                points: rectPoints,
                isHole: false,
                nestingLevel: 0,
                parentId: null,
                arcSegments: [],
                curveIds: []
            }], {
                ...rectangle.properties,
                fill: true,
                closed: true
            });
            return this.offsetPath(rectAsPath, distance);
        }

        async offsetArc(arc, distance) {
            // Convert to path primitive
            const pathPrimitive = GeometryUtils.primitiveToPath(arc);
            if (!pathPrimitive) return null;

            return this.offsetPath(pathPrimitive, distance);
        }

        offsetObround(obround, distance) {
            this.debug(`Offsetting obround by ${distance.toFixed(3)}mm.`);

            // 1. Determine if the offset is internal (shrinking) or external (growing).
            const isInternal = distance < 0;

            // 2. Calculate the dimensions and position of the new offset obround.
            const newWidth = obround.width + (distance * 2);
            const newHeight = obround.height + (distance * 2);
            const newPosition = {
                x: obround.position.x - distance,
                y: obround.position.y - distance
            };

            // 3. Handle degenerate cases
            if (newWidth < this.options.precision || newHeight < this.options.precision) {
                if (debugConfig.enabled) {
                    const w = newWidth.toFixed(3);
                    const h = newHeight.toFixed(3);
                    console.warn(`Obround offset resulted in a degenerate shape (w=${w}, h=${h}). Returning null.`);
                }
                return null;
            }

            // 4. Create a new ObroundPrimitive
            const offsetObroundPrimitive = new ObroundPrimitive(newPosition, newWidth, newHeight, {
                ...obround.properties
            });

            // 5. Convert this new analytic primitive into a PathPrimitive
            const offsetPath = GeometryUtils.primitiveToPath(offsetObroundPrimitive);
            
            if (!offsetPath || !offsetPath.contours || offsetPath.contours.length === 0) {
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
            const contour = offsetPath.contours[0];
            if (window.globalCurveRegistry && contour.curveIds) {
                contour.curveIds.forEach(id => {
                    const curve = window.globalCurveRegistry.getCurve(id);
                    if (curve) {
                        curve.isOffsetDerived = true;
                        curve.offsetDistance = distance;
                        curve.sourceCurveId = obround.curveIds ? obround.curveIds[0] : null; 
                    }
                });
            }

            if (debugConfig.enabled) {
                const pointCount = contour.points.length;
                const curveCount = contour.curveIds?.length || 0;
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

                // If the max distance is greater than our tolerance, keep this point
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