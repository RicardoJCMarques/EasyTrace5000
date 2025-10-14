/**
 * @file        geometry/geometry-offsetter.js
 * @description Handles geometry offsetting
 * @comment     Fixed: End-cap curves registered with explicit clockwise=false
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

class GeometryOffsetter {
    constructor(options = {}) {
        this.precision = options.precision || 0.001;
        this.debug = options.debug || false;
        this.initialized = true;
        this.geometryProcessor = null;
    }
    
    setGeometryProcessor(processor) {
        this.geometryProcessor = processor;
    }
    
    async offsetPrimitive(primitive, distance, options = {}) {
        if (!primitive || !primitive.type) return null;
        if (Math.abs(distance) < this.precision) return primitive;
        
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
                if (this.debug) {
                    console.warn(`[Offsetter] Unknown type: ${primitive.type}`);
                }
                return null;
        }
    }
    
    offsetCircle(circle, distance) {
        const newRadius = circle.radius + distance;  // Positive distance = external (grow)
        if (this.debug) {
            console.log(`[Offsetter] Offsetting circle with ${circle.radius} radius`);
            console.log(`[Offsetter] Offsetting circle with ${newRadius} new radius`);
        }
        
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

        if (Math.abs(den) < 1e-9) {
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
    
    offsetPath(path, distance, options = {}) {
        if (!path.points || path.points.length < 2) {
            console.log('[Offsetter] Insufficient points');
            return null;
        }
        
        const isInternal = distance < 0;
        const offsetDist = Math.abs(distance);
        const props = path.properties || {};
        
        const miterLimit = options.miterLimit || 2.0;

        // Force cutouts into polygon offsetting regardless of fill/stroke
        const isCutout = props.isCutout || props.layerType === 'cutout';
        const isStroke = !isCutout && ((props.stroke && !props.fill) || props.isTrace);
        const isClosed = props.fill || (!props.stroke && path.closed) || isCutout;

        if (isStroke) {
            const originalWidth = props.strokeWidth || 0;
            const totalWidth = originalWidth + Math.abs(distance * 2);
            if (totalWidth < this.precision) {
                if (this.debug) console.log('[Offsetter] Stroke width too small');
                return null;
            }
            
            const segmentPrimitives = [];
            const numSegments = path.closed ? path.points.length - 1 : path.points.length - 1;
            
            for (let i = 0; i < numSegments; i++) {
                const p1 = path.points[i];
                const p2 = path.points[i + 1];
                if (!p2 || Math.hypot(p2.x-p1.x, p2.y-p1.y) < this.precision) continue;

                const segmentPolygon = GeometryUtils.lineToPolygon(p1, p2, totalWidth);
                if (!segmentPolygon || segmentPolygon.length < 3) continue;
                
                segmentPrimitives.push(new PathPrimitive(segmentPolygon, {
                    ...path.properties,
                    originalType: 'stroke_segment',
                    fill: true, stroke: false, isOffset: true,
                    offsetDistance: distance, polygonized: true
                }));
            }
            return segmentPrimitives.length > 0 ? segmentPrimitives : null;

        } else if (isClosed) {
            let polygonPoints = path.points.slice();
            
            const first = polygonPoints[0];
            const last = polygonPoints[polygonPoints.length - 1];
            if (Math.hypot(first.x - last.x, first.y - last.y) < this.precision) {
                polygonPoints.pop();
            }
            
            const n = polygonPoints.length;
            if (n < 3) return null;
            
            // 1. Determine the winding direction of the input polygon.
            const isPathClockwise = GeometryUtils.isClockwise(polygonPoints); //
            
            // 2. Determine the base normal direction from the signed distance.
            //    isInternal (distance < 0) means normals point inward (-1).
            //    isExternal (distance > 0) means normals point outward (+1).
            let normalDirection = isInternal ? 1 : -1;
            
            // 3. Invert the normal direction for clockwise paths.
            //    For a CCW path (outer), an external offset expands it (correct).
            //    For a CW path (hole), an external offset should SHRINK it. This requires
            //    inverting the normal direction to point "inward" relative to the hole's path.
            if (isPathClockwise) {
                normalDirection *= -1;
            }

            const offsetPoints = [];
            
            for (let i = 0; i < n; i++) {
                const prev = polygonPoints[(i - 1 + n) % n];
                const curr = polygonPoints[i];
                const next = polygonPoints[(i + 1) % n];
                
                const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
                const v2 = { x: next.x - curr.x, y: next.y - curr.y };
                
                const len1 = Math.hypot(v1.x, v1.y);
                const len2 = Math.hypot(v2.x, v2.y);
                
                if (len1 < this.precision || len2 < this.precision) continue;
                
                const n1 = { x: normalDirection * (-v1.y / len1), y: normalDirection * (v1.x / len1) };
                const n2 = { x: normalDirection * (-v2.y / len2), y: normalDirection * (v2.x / len2) };
                
                const cross = v1.x * v2.y - v1.y * v2.x;
                const dot = v1.x * v2.x + v1.y * v2.y;
                const turnAngle = Math.atan2(cross, dot);
                
                const needsRoundJoint = Math.abs(turnAngle) > 0.1 && 
                                    ((isInternal && turnAngle > 0) || (!isInternal && turnAngle < 0));
                
                if (needsRoundJoint) {
                    const angle1 = Math.atan2(n1.y, n1.x);
                    const angle2 = Math.atan2(n2.y, n2.x);
                    let angleDiff = angle2 - angle1;
                    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

                    const jointCurveId = window.globalCurveRegistry.register({
                        type: 'arc', center: { x: curr.x, y: curr.y }, radius: offsetDist,
                        startAngle: angle1, endAngle: angle2, clockwise: false,
                        source: 'offset_joint', isOffsetDerived: true, offsetDistance: distance
                    });
                    
                    const fullCircleSegments = GeometryUtils.getOptimalSegments(offsetDist);
                    const proportionalSegments = fullCircleSegments * (Math.abs(angleDiff) / (2 * Math.PI));
                    const arcSegments = Math.max(2, Math.ceil(proportionalSegments));
                    
                    for (let j = 0; j <= arcSegments; j++) {
                        const t = j / arcSegments;
                        const angle = angle1 + angleDiff * t;
                        offsetPoints.push({
                            x: curr.x + offsetDist * Math.cos(angle), y: curr.y + offsetDist * Math.sin(angle),
                            curveId: jointCurveId, segmentIndex: j, totalSegments: arcSegments + 1, t: t
                        });
                    }
                } else {
                    const l1p1 = { x: prev.x + n1.x * offsetDist, y: prev.y + n1.y * offsetDist };
                    const l1p2 = { x: curr.x + n1.x * offsetDist, y: curr.y + n1.y * offsetDist };
                    const l2p1 = { x: curr.x + n2.x * offsetDist, y: curr.y + n2.y * offsetDist };
                    const l2p2 = { x: next.x + n2.x * offsetDist, y: next.y + n2.y * offsetDist };
                    const intersection = this.lineLineIntersection(l1p1, l1p2, l2p1, l2p2);

                    if (intersection) {
                        const miterLength = Math.hypot(intersection.x - curr.x, intersection.y - curr.y);
                        if (miterLength > miterLimit * offsetDist) {
                             const limitedIntersection = {
                                x: curr.x + (intersection.x - curr.x) * (miterLimit * offsetDist) / miterLength,
                                y: curr.y + (intersection.y - curr.y) * (miterLimit * offsetDist) / miterLength,
                            };
                            offsetPoints.push(limitedIntersection);
                        } else {
                            offsetPoints.push(intersection);
                        }
                    } else {
                        offsetPoints.push({ x: curr.x + n1.x * offsetDist, y: curr.y + n1.y * offsetDist });
                    }
                }
            }
            
            if (offsetPoints.length < 3) {
                if (this.debug) console.log('[Offsetter] Insufficient offset points generated');
                return null;
            }
            
            // --- FIX START: Explicitly close the polygon path ---
            // By appending the first point to the end, we ensure the final segment
            // is explicitly defined, fixing potential connection issues at the seam.
            offsetPoints.push(offsetPoints[0]);
            // --- FIX END ---
            
            return new PathPrimitive(offsetPoints, {
                ...path.properties, originalType: 'filled_path', closed: true, fill: true, stroke: false,
                isOffset: true, offsetDistance: distance, offsetType: isInternal ? 'internal' : 'external',
                polygonized: true
            });
        }
        
        return null;
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
        if (this.debug) {
            console.log(`[Offsetter] Offsetting obround by ${distance.toFixed(3)}mm.`);
        }

        // 1. Determine if the offset is internal (shrinking) or external (growing).
        // A negative distance means the shape shrinks.
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
        if (newWidth < this.precision || newHeight < this.precision) {
            if (this.debug) {
                const w = newWidth.toFixed(3);
                const h = newHeight.toFixed(3);
                console.log(`[Offsetter] Obround offset resulted in a degenerate shape (w=${w}, h=${h}). Returning null.`);
            }
            return null;
        }

        // 4. Create a new ObroundPrimitive using the calculated offset geometry.
        // This leverages the existing robust logic for creating obround polygons and,
        // critically, for registering their end-cap curves in the global registry.
        const offsetObroundPrimitive = new ObroundPrimitive(newPosition, newWidth, newHeight, {
            ...obround.properties
        });

        // 5. Convert this new analytic primitive into a polygon for the next processing stage.
        const offsetPath = offsetObroundPrimitive.toPolygon();
        
        // If polygon creation failed, return null.
        if (!offsetPath || !offsetPath.points || offsetPath.points.length < 3) {
            return null;
        }

        // 6. Add the required offset metadata to the final PathPrimitive.
        // This ensures the rest of the pipeline knows this is an offset-generated shape.
        offsetPath.properties = {
            ...offsetPath.properties,
            isOffset: true,
            offsetDistance: distance,
            offsetType: isInternal ? 'internal' : 'external',
            sourcePrimitiveId: obround.id,
        };
        
        // 7. Post-process the newly registered curve IDs to mark them as offset-derived.
        // This provides metadata for the arc reconstruction step.
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

        if (this.debug) {
            const pointCount = offsetPath.points.length;
            const curveCount = offsetPath.curveIds?.length || 0;
            console.log(`[Offsetter] Successfully created offset obround path with ${pointCount} points and ${curveCount} registered curves.`);
        }

        return offsetPath;
    }
}

window.GeometryOffsetter = GeometryOffsetter;