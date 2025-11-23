/**
 * @file        geometry/geometry-utils.js
 * @description Contains general auxiliary functions
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

    const GeometryUtils = {
        PRECISION: geomConfig.coordinatePrecision,

        _calculateSegments(radius, targetLength, minSegments, maxSegments) {
            // For zero/negative radius, return the minimum valid count.
            if (radius <= 0) {
                const minSeg = geomConfig.segments.defaultMinSegments;
                return Math.max(minSeg, Math.ceil(minSegments / minSeg) * minSeg);
            }

            // Adjust boundaries to be multiples of 8, ensuring a valid range.
            const minSeg = geomConfig.segments.defaultMinSegments;
            const min = Math.max(minSeg, Math.ceil(minSegments / minSeg) * minSeg);
            const max = Math.floor(maxSegments / minSeg) * minSeg;

            // If adjusted boundaries are invalid (e.g., min > max), return the minimum.
            if (min > max) {
                return min;
            }

            const circumference = 2 * Math.PI * radius;
            const desiredSegments = circumference / targetLength;

            // Round the ideal segment count to the nearest multiple of 8.
            let calculatedSegments = Math.round(desiredSegments / minSeg) * minSeg;

            // Clamp the result within the adjusted boundaries. The final value will always be a multiple of 8 within the valid range.
            const finalSegments = Math.max(min, Math.min(max, calculatedSegments));

            return finalSegments;
        },

        // Tessellation helpers
        tessellateCubicBezier(p0, p1, p2, p3) {
            const a = [], t = geomConfig.tessellation?.bezierSegments || 32; // 't' is segment count
            // This loop starts at 0, so it *includes* the start point
            for (let s = 0; s <= t; s++) {
                const e = s / t, o = 1 - e;
                a.push({
                    x: o * o * o * p0.x + 3 * o * o * e * p1.x + 3 * o * e * e * p2.x + e * e * e * p3.x,
                    y: o * o * o * p0.y + 3 * o * o * e * p1.y + 3 * o * e * e * p2.y + e * e * e * p3.y
                })
            }
            return a;
        },

        tessellateQuadraticBezier(p0, p1, p2) {
            const a = [], t = geomConfig.tessellation?.bezierSegments || 32
            // This loop starts at 0, so it *includes* the start point
            for (let s = 0; s <= t; s++) {
                const e = s / t, o = 1 - e;
                a.push({
                    x: o * o * p0.x + 2 * o * e * p1.x + e * e * p2.x,
                    y: o * o * p0.y + 2 * o * e * p1.y + e * e * p2.y
                })
            }
            return a;
        },

        tessellateEllipticalArc(p1, p2, rx, ry, phi, fA, fS) {
            // SVG arc-to-centerpoint conversion logic
            const a = Math.sin(phi * Math.PI / 180), s = Math.cos(phi * Math.PI / 180), e = (p1.x - p2.x) / 2, o = (p1.y - p2.y) / 2, r = s * e + a * o, h = -a * e + s * o;
            rx = Math.abs(rx); ry = Math.abs(ry);
            let c = r * r / (rx * rx) + h * h / (ry * ry);
            if (c > 1) { rx *= Math.sqrt(c); ry *= Math.sqrt(c) }
            const l = (rx * rx * ry * ry - rx * rx * h * h - ry * ry * r * r) / (rx * rx * h * h + ry * ry * r * r), d = (fA === fS ? -1 : 1) * Math.sqrt(Math.max(0, l)), M = d * (rx * h / ry), g = d * (-ry * r / rx), x = s * M - a * g + (p1.x + p2.x) / 2, y = a * M + s * g + (p1.y + p2.y) / 2;
            const I = (t, p) => { const i = t[0] * p[1] - t[1] * p[0] < 0 ? -1 : 1; return i * Math.acos((t[0] * p[0] + t[1] * p[1]) / (Math.sqrt(t[0] * t[0] + t[1] * t[1]) * Math.sqrt(p[0] * p[0] + p[1] * p[1]))) };
            const u = I([1, 0], [(r - M) / rx, (h - g) / ry]);
            let m = I([(r - M) / rx, (h - g) / ry], [(-r - M) / rx, (-h - g) / ry]);
            0 === fS && m > 0 ? m -= 2 * Math.PI : 1 === fS && m < 0 && (m += 2 * Math.PI);

            const targetLength = window.PCBCAMConfig?.geometry?.segments?.targetLength || 0.1;
            const approxArcLength = Math.abs(m) * ((rx + ry) / 2);
            const minSegs = geomConfig.tessellation?.minEllipticalSegments || 8;
            const k = Math.max(minSegs, Math.ceil(approxArcLength / targetLength));

            const P = [];
            // This loop starts at 0, so it *includes* the start point
            for (let t = 0; t <= k; t++) { 
                const i = u + m * t / k, e_cos = Math.cos(i), o_sin = Math.sin(i);
                P.push({
                    x: x + rx * (s * e_cos - a * o_sin),
                    y: y + ry * (a * e_cos + s * o_sin)
                })
            }
            return P;
        },

        // Primitive-to-Points Converters
        circleToPoints(primitive, curveIds = []) {
            const segments = this.getOptimalSegments(primitive.radius, 'circle');
            const polygonPoints = [];

            // A filled circle primitive should have one curveId
            let curveId = curveIds.length > 0 ? curveIds[0] : null;

            if (!curveId && window.globalCurveRegistry) {
                // If this is an analytic primitive (e.g., flash), it won't have an ID yet so register it now.
                curveId = window.globalCurveRegistry.register({
                    type: 'circle',
                    center: primitive.center,
                    radius: primitive.radius,
                    clockwise: false, // Circles are always CCW by convention
                    source: 'circle_primitive'
                });

                // Ensure the primitive's own list is updated
                if (curveIds.length === 0) {
                    curveIds.push(curveId);
                }
            }

            // Generate CCW for Y-Up
            for (let i = 0; i < segments; i++) {
                const angle = (i / segments) * 2 * Math.PI;
                const point = {
                    x: primitive.center.x + primitive.radius * Math.cos(angle),
                    y: primitive.center.y + primitive.radius * Math.sin(angle)
                };

                if (curveId) {
                    point.curveId = curveId;
                    point.segmentIndex = i;
                    point.totalSegments = segments;
                    point.t = i / segments;
                }

                polygonPoints.push(point);
            }
            return polygonPoints;
        },

        rectangleToPoints(primitive) {
            const { x, y } = primitive.position, w = primitive.width, h = primitive.height;
            // CCW winding for Y-Up
            const allPoints = [
                { x: x, y: y },         // Bottom-left
                { x: x + w, y: y },     // Bottom-right
                { x: x + w, y: y + h }, // Top-right
                { x: x, y: y + h },     // Top-left
            ];
            return allPoints;
        },

        arcToPoints(primitive) {
            const start = primitive.startPoint;
            const end = primitive.endPoint;
            const center = primitive.center;
            const clockwise = primitive.clockwise;
            
            const radius = Math.sqrt(
                Math.pow(start.x - center.x, 2) +
                Math.pow(start.y - center.y, 2)
            );
            
            const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
            const endAngle = Math.atan2(end.y - center.y, end.x - center.x);

            let angleSpan = endAngle - startAngle;
            if (clockwise) {
                if (angleSpan > 0) angleSpan -= 2 * Math.PI;
            } else {
                if (angleSpan < 0) angleSpan += 2 * Math.PI;
            }

            const segments = this.getOptimalSegments(radius, 'arc');

            const points = [];
            for (let i = 0; i <= segments; i++) {
                const angle = startAngle + angleSpan * (i / segments);
                points.push({
                    x: center.x + radius * Math.cos(angle),
                    y: center.y + radius * Math.sin(angle)
                });
            }

            return points;
        },

        bezierToPoints(primitive) {
            if (primitive.points.length === 4) {
                return this.tessellateCubicBezier(...primitive.points);
            } else if (primitive.points.length === 3) {
                return this.tessellateQuadraticBezier(...primitive.points);
            }
            return [];
        },

        ellipticalArcToPoints(primitive) {
            return this.tessellateEllipticalArc(
                primitive.startPoint,
                primitive.endPoint,
                primitive.rx,
                primitive.ry,
                primitive.phi,
                primitive.fA,
                primitive.fS
            );
        },

        getOptimalSegments(radius, type) {
            const config = window.PCBCAMConfig.geometry.segments;
            const finalTargetLength = config.targetLength;

            let finalMin, finalMax;

            if (type === 'circle') {
                finalMin = config.minCircle;
                finalMax = config.maxCircle;
            } else if (type === 'arc') {
                finalMin = config.minArc;
                finalMax = config.maxArc;
            } else if (type === 'end_cap') {
                finalMin = config.minEndCap;
                finalMax = config.maxEndCap;
            } else {
                // Default fallback
                finalMin = config.defaultFallbackSegments.min;
                finalMax = config.defaultFallbackSegments.max;
            }

            return this._calculateSegments(
                radius, 
                finalTargetLength, 
                finalMin,
                finalMax
            );
        },

        // Validate Clipper scale factor
        validateScale(scale, min, max) {
            const minScale = min ?? geomConfig.clipper.minScale;
            const maxScale = max ?? geomConfig.clipper.maxScale;
            const defaultScale = geomConfig.clipperScale;
            return Math.max(minScale, Math.min(maxScale, scale || defaultScale));
        },

        // Calculate winding (signed area)
        calculateWinding(points) {
            if (!points || points.length < 3) return 0;

            let area = 0;
            for (let i = 0; i < points.length; i++) {
                const j = (i + 1) % points.length;
                area += points[i].x * points[j].y;
                area -= points[j].x * points[i].y;
            }

            return area / 2;
        },

        // Check if points are clockwise
        isClockwise(points) {
            return this.calculateWinding(points) < 0;
        },

        // Convert obround to points
        obroundToPoints(obround, curveIds = []) {
            const { x, y } = obround.position;
            const w = obround.width;
            const h = obround.height;
            const r = Math.min(w, h) / 2;

            if (r <= 0) return [];

            const isHorizontal = w > h;
            const strokeWidth = Math.min(w, h); // This is the diameter of the end-caps

            let start, end;
            if (isHorizontal) {
                const centerY = y + h / 2;
                start = { x: x + r, y: centerY };
                end = { x: x + w - r, y: centerY };
            } else {
                const centerX = x + w / 2;
                start = { x: centerX, y: y + r };
                end = { x: centerX, y: y + h - r };
            }

            const points = this.lineToPolygon(start, end, strokeWidth, curveIds); // Delegate to lineToPolygon
            return points;
        },

        // Convert polyline to polygon with metadata for end-caps
        polylineToPolygon(points, width, curveIds = []) {
            if (!points || points.length < 2) return [];

            const halfWidth = width / 2;

            // Single segment - use specialized function
            if (points.length === 2) {
                return this.lineToPolygon(
                    {x: points[0].x, y: points[0].y},
                    {x: points[1].x, y: points[1].y},
                    width,
                    curveIds
                );
            }

            // Multi-segment with proper end-cap metadata
            const leftSide = [];
            const rightSide = [];

            // Register end-caps with explicit clockwise=false
            const startCapId = window.globalCurveRegistry?.register({
                type: 'arc',
                center: { x: points[0].x, y: points[0].y },
                radius: halfWidth,
                startAngle: 0,
                endAngle: Math.PI * 2,
                clockwise: false,  // End-caps always CCW
                source: 'end_cap'
            });
            if (startCapId) curveIds.push(startCapId);

            const endCapId = window.globalCurveRegistry?.register({
                type: 'arc',
                center: { x: points[points.length - 1].x, y: points[points.length - 1].y },
                radius: halfWidth,
                startAngle: 0,
                endAngle: Math.PI * 2,
                clockwise: false,  // End-caps always CCW
                source: 'end_cap'
            });
            if (endCapId) curveIds.push(endCapId);

            for (let i = 0; i < points.length - 1; i++) {
                const p0 = i > 0 ? points[i - 1] : null;
                const p1 = points[i];
                const p2 = points[i + 1];

                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const len = Math.sqrt(dx * dx + dy * dy);

                if (len < this.PRECISION) continue;

                const ux = dx / len;
                const uy = dy / len;
                const nx = -uy * halfWidth;
                const ny = ux * halfWidth;

                if (i === 0) {
                    // Start cap with complete metadata
                    const capPoints = this.generateCompleteRoundedCap(
                        p1, -ux, -uy, halfWidth, true, startCapId
                    );
                    leftSide.push(...capPoints);
                    rightSide.push({ x: p1.x - nx, y: p1.y - ny });
                } else {
                    // Join
                    const joinPoints = this.generateJoin(p0, p1, p2, halfWidth);
                    leftSide.push(joinPoints.left);
                    rightSide.push(joinPoints.right);
                }

                if (i === points.length - 2) {
                    // End cap with complete metadata
                    leftSide.push({ x: p2.x + nx, y: p2.y + ny });
                    const capPoints = this.generateCompleteRoundedCap(
                        p2, ux, uy, halfWidth, false, endCapId
                    );
                    rightSide.push(...capPoints);
                }
            }

            return [...leftSide, ...rightSide.reverse()];
        },

        /**
         * Converts a line to a polygon, returning a flat point array.
         * It registers end-caps and tags points with curveId.
         */
        lineToPolygon(from, to, width, curveIds = []) {
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            const halfWidth = width / 2;

            // Zero-length line becomes circle with metadata
            if (len < this.PRECISION) {
                const segments = this.getOptimalSegments(halfWidth, 'circle');
                const points = [];
                // Register circle end-cap with clockwise=false
                const curveId = window.globalCurveRegistry?.register({
                    type: 'circle',
                    center: { x: from.x, y: from.y },
                    radius: halfWidth,
                    clockwise: false,  // Always CCW
                    source: 'end_cap'
                });

                for (let i = 0; i < segments; i++) {
                    const angle = (i / segments) * 2 * Math.PI;
                    const point = {
                        x: from.x + halfWidth * Math.cos(angle),
                        y: from.y + halfWidth * Math.sin(angle),
                        curveId: curveId,
                        segmentIndex: i,
                        totalSegments: segments,
                        t: i / segments
                    };
                    points.push(point);
                }
                return points;
            }

            const ux = dx / len;
            const uy = dy / len;
            const nx = -uy * halfWidth;
            const ny = ux * halfWidth;

            const points = [];

            // Register end-caps with explicit clockwise=false
            const startCapId = window.globalCurveRegistry?.register({
                type: 'arc',
                center: { x: from.x, y: from.y },
                radius: halfWidth,
                startAngle: 0,
                endAngle: Math.PI * 2,
                clockwise: false,  // Always CCW
                source: 'end_cap'
            });
            if (startCapId) curveIds.push(startCapId);

            const endCapId = window.globalCurveRegistry?.register({
                type: 'arc',
                center: { x: to.x, y: to.y },
                radius: halfWidth,
                startAngle: 0,
                endAngle: Math.PI * 2,
                clockwise: false,  // Always CCW
                source: 'end_cap'
            });
            if (endCapId) curveIds.push(endCapId);

            // Left side of start
            points.push({ x: from.x + nx, y: from.y + ny });

            // Start cap - perpendicular direction is the "radial" for line end caps
            const perpAngle = Math.atan2(ny, nx);
            const startCapPoints = this.generateCompleteRoundedCap(
                from,           // cap center
                perpAngle,      // "radial" direction (perpendicular to line)
                halfWidth,      // cap radius
                false,          // no arc direction for straight lines
                startCapId
            );

            // Add cap points, handling duplicates at connection
            startCapPoints.forEach((point, i) => {
                if (i === 0 && points.length > 0) {
                    const lastPoint = points[points.length - 1];
                    if (Math.abs(point.x - lastPoint.x) < this.PRECISION &&
                        Math.abs(point.y - lastPoint.y) < this.PRECISION) {
                        Object.assign(lastPoint, {
                            curveId: point.curveId,
                            segmentIndex: point.segmentIndex,
                            totalSegments: point.totalSegments,
                            t: point.t,
                            isConnectionPoint: true
                        });
                        return;
                    }
                }
                points.push(point);
            });

            // Right side
            points.push({ x: from.x - nx, y: from.y - ny });
            points.push({ x: to.x - nx, y: to.y - ny });

            // End cap with complete metadata - ALL points including first and last
            const endPerpAngle = Math.atan2(-ny, -nx);
            const endCapPoints = this.generateCompleteRoundedCap(
                to,             // cap center
                endPerpAngle,   // "radial" direction (perpendicular to line)
                halfWidth,      // cap radius
                false,          // no arc direction for straight lines
                endCapId
            );

            // Add cap points, handling duplicates at connection
            endCapPoints.forEach((point, i) => {
                if (i === 0 && points.length > 0) {
                    const lastPoint = points[points.length - 1];
                    if (Math.abs(point.x - lastPoint.x) < this.PRECISION &&
                        Math.abs(point.y - lastPoint.y) < this.PRECISION) {
                        Object.assign(lastPoint, {
                            curveId: point.curveId,
                            segmentIndex: point.segmentIndex,
                            totalSegments: point.totalSegments,
                            t: point.t,
                            isConnectionPoint: true
                        });
                        return;
                    }
                }
                points.push(point);
            });

            // Left side of end
            points.push({ x: to.x + nx, y: to.y + ny });
            return points;
        },

        /**
         * Converts an arc to a polygon, returning a structured object containing points, arcSegments, and curveIds.
         */
        arcToPolygon(arc, width) {
            this.debug(`[GeoUtils] arcToPolygon called for Arc ${arc.id}, r=${arc.radius.toFixed(3)}, width=${width.toFixed(3)}`);
            const points = [];
            const halfWidth = width / 2;
            const innerR = arc.radius - halfWidth;
            const outerR = arc.radius + halfWidth;
            const center = arc.center;
            const clockwise = arc.clockwise;
            const startRad = arc.startAngle;
            const endRad = arc.endAngle;
            const startCapCenter = arc.startPoint;
            const endCapCenter = arc.endPoint;

            // Handle filled circle
            if (innerR < this.PRECISION) {
                const circleSegments = this.getOptimalSegments(outerR, 'circle');
                const curveId = window.globalCurveRegistry?.register({
                    type: 'circle', center: { x: center.x, y: center.y }, radius: outerR,
                    clockwise: false, source: 'arc_fallback'
                });
                for (let i = 0; i < circleSegments; i++) {
                    const t = i / circleSegments; const angle = t * 2 * Math.PI;
                    points.push({
                        x: center.x + outerR * Math.cos(angle), y: center.y + outerR * Math.sin(angle),
                        curveId: curveId, segmentIndex: i, totalSegments: circleSegments, t: t
                    });
                }

                this.debug(`[GeoUtils] arcToPolygon fallback to circle. Points: ${points.length}, ID: ${curveId}`);
                // Return structured object
                const contour = {
                    points: points,
                    isHole: false,
                    nestingLevel: 0,
                    parentId: null,
                    arcSegments: [], // It's a full circle
                    curveIds: [curveId].filter(Boolean)
                };
                const properties = {
                    ...arc.properties,
                    wasStroke: true,
                    fill: true,
                    stroke: false,
                    closed: true
                };
                return new PathPrimitive([contour], properties);
            }

            // Register all 4 curves
            const outerArcId = window.globalCurveRegistry?.register({
                type: 'arc', center: center, radius: outerR, startAngle: startRad, endAngle: endRad,
                clockwise: clockwise, isOffsetDerived: true, source: 'arc_outer'
            });
            const innerArcId = window.globalCurveRegistry?.register({
                type: 'arc', center: center, radius: innerR, startAngle: startRad, endAngle: endRad,
                clockwise: clockwise, isOffsetDerived: true, source: 'arc_inner'
            });
            const startCapId = window.globalCurveRegistry?.register({
                type: 'arc', center: startCapCenter, radius: halfWidth, startAngle: 0, endAngle: 2*Math.PI,
                clockwise: false, source: 'arc_end_cap'
            });
            const endCapId = window.globalCurveRegistry?.register({
                type: 'arc', center: endCapCenter, radius: halfWidth, startAngle: 0, endAngle: 2*Math.PI,
                clockwise: false, source: 'arc_end_cap'
            });

            // Generate points and tag them
            const arcSegments = this.getOptimalSegments(arc.radius, 'arc');

            // Calculate angle span correctly based on clockwise flag
            let angleSpan = endRad - startRad;
            if (clockwise) { if (angleSpan > 0) angleSpan -= 2 * Math.PI; }
            else { if (angleSpan < 0) angleSpan += 2 * Math.PI; }

            // A. Generate Outer arc points (tag with outerArcId)
            const outerPoints = [];
            for (let i = 0; i <= arcSegments; i++) {
                const t = i / arcSegments; const angle = startRad + angleSpan * t;
                outerPoints.push({
                    x: center.x + outerR * Math.cos(angle), y: center.y + outerR * Math.sin(angle),
                    curveId: outerArcId, segmentIndex: i, totalSegments: arcSegments + 1, t: t
                });
            }

            // B. Generate End Cap points
            const endCapPoints = this.generateCompleteRoundedCap(
                endCapCenter,    // cap center
                endRad,          // radial angle at arc end
                halfWidth,       // cap radius
                clockwise,       // arc direction (not used in current impl, for future)
                endCapId         // curve registry ID
            );

            // C. Generate Inner arc points (reversed, tag with innerArcId)
            const innerPointsReversed = [];
            for (let i = arcSegments; i >= 0; i--) {
                const t = i / arcSegments; const angle = startRad + angleSpan * t;
                innerPointsReversed.push({
                    x: center.x + innerR * Math.cos(angle), y: center.y + innerR * Math.sin(angle),
                    curveId: innerArcId, segmentIndex: i, totalSegments: arcSegments + 1, t: t
                });
            }

            // D. Generate Start Cap points
            const startCapPoints = this.generateCompleteRoundedCap(
                startCapCenter,      // cap center
                startRad + Math.PI,  // start at inner side (radial + 180°)
                halfWidth,           // cap radius
                clockwise,           // arc direction (not used in current impl, for future)
                startCapId           // curve registry ID
            );

            // E. Assemble final points array
            points.push(...outerPoints);
            points.push(...endCapPoints.slice(1)); // Skip first point (matches last outer)
            points.push(...innerPointsReversed.slice(1)); // Skip first point (matches last end cap)
            points.push(...startCapPoints.slice(1)); // Skip first point (matches last inner)

            // Final check for duplicate closing point
            const first = points[0];
            const last = points[points.length - 1];
            if (Math.hypot(first.x - last.x, first.y - last.y) < this.PRECISION) {
                points.pop();
                this.debug("arcToPolygon removed duplicate closing point.");
            } else {
                console.warn("[GeoUtils] arcToPolygon closing points didn't match:", first, last);
                points.push({...points[0]});
                console.warn("[GeoUtils] Force-closed polygon.");
            }

            // Create arcSegments metadata for offset pipeline
            const arcSegmentsMetadata = [];

            // Outer arc segment
            arcSegmentsMetadata.push({
                startIndex: 0,
                endIndex: outerPoints.length - 1,
                center: center,
                radius: outerR,
                startAngle: startRad,
                endAngle: endRad,
                clockwise: clockwise,
                curveId: outerArcId
            });

            // End cap (semicircle)
            const endCapStart = outerPoints.length;
            const endCapEnd = endCapStart + endCapPoints.length - 2;
            arcSegmentsMetadata.push({
                startIndex: endCapStart,
                endIndex: endCapEnd,
                center: endCapCenter,
                radius: halfWidth,
                startAngle: endRad,
                endAngle: endRad + (clockwise ? -Math.PI : Math.PI),
                clockwise: clockwise,
                curveId: endCapId
            });

            // Inner arc (reversed)
            const innerStart = endCapEnd + 1;
            const innerEnd = innerStart + innerPointsReversed.length - 2;
            arcSegmentsMetadata.push({
                startIndex: innerStart,
                endIndex: innerEnd,
                center: center,
                radius: innerR,
                startAngle: endRad,
                endAngle: startRad,
                clockwise: !clockwise, // Reversed direction
                curveId: innerArcId
            });

            // Start cap (semicircle)
            const startCapStart = innerEnd + 1;
            const startCapEnd = startCapStart + startCapPoints.length - 2;
            arcSegmentsMetadata.push({
                startIndex: startCapStart,
                endIndex: startCapEnd,
                center: startCapCenter,
                radius: halfWidth,
                startAngle: startRad + Math.PI,
                endAngle: startRad + Math.PI + (clockwise ? -Math.PI : Math.PI),
                clockwise: clockwise,
                curveId: startCapId
            });

            // Return structured object
            const curveIds = [outerArcId, innerArcId, startCapId, endCapId].filter(Boolean);
            this.debug(`arcToPolygon finished. Points: ${points.length}, Registered curve IDs:`, curveIds);

            const contour = {
                points: points,
                isHole: false,
                nestingLevel: 0,
                parentId: null,
                arcSegments: arcSegmentsMetadata,
                curveIds: curveIds
            };
            const properties = {
                ...arc.properties,
                wasStroke: true,
                fill: true,
                stroke: false,
                closed: true
            };
            return new PathPrimitive([contour], properties);
        },

        // Generate complete rounded cap with all boundary points tagged (end-caps are always ccw)
        generateCompleteRoundedCap(center, radialAngle, radius, clockwiseArc, curveId) {
            const points = [];
            const segments = this.getOptimalSegments(radius, 'end_cap');
            const halfSegments = Math.floor(segments / 2);
            const capStartAngle = radialAngle;

            // Sweep in the same direction as the parent arc
            const angleIncrement = clockwiseArc ? -Math.PI : Math.PI;

            for (let i = 0; i <= halfSegments; i++) {
                const t = i / halfSegments;
                const angle = capStartAngle + (angleIncrement * t);
                const point = {
                    x: center.x + radius * Math.cos(angle),
                    y: center.y + radius * Math.sin(angle),
                    curveId: curveId,
                    segmentIndex: i,
                    totalSegments: halfSegments + 1,
                    t: t,
                    isConnectionPoint: (i === 0 || i === halfSegments)
                };
                points.push(point);
            }

            return points;
        },

        // Generate join between segments
        generateJoin(p0, p1, p2, halfWidth) {
            const dx1 = p1.x - p0.x;
            const dy1 = p1.y - p0.y;
            const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);

            const dx2 = p2.x - p1.x;
            const dy2 = p2.y - p1.y;
            const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

            if (len1 < this.PRECISION || len2 < this.PRECISION) {
                return {
                    left: { x: p1.x - halfWidth, y: p1.y },
                    right: { x: p1.x + halfWidth, y: p1.y }
                };
            }

            const u1x = dx1 / len1;
            const u1y = dy1 / len1;
            const u2x = dx2 / len2;
            const u2y = dy2 / len2;

            const n1x = -u1y * halfWidth;
            const n1y = u1x * halfWidth;
            const n2x = -u2y * halfWidth;
            const n2y = u2x * halfWidth;

            // Miter join
            const miterX = (n1x + n2x) / 2;
            const miterY = (n1y + n2y) / 2;

            const miterLen = Math.sqrt(miterX * miterX + miterY * miterY);
            const miterLimit = geomConfig.offsetting?.miterLimit || 2.0;
            const maxMiter = halfWidth * miterLimit;

            if (miterLen > maxMiter) {
                const scale = maxMiter / miterLen;
                return {
                    left: { x: p1.x + miterX * scale, y: p1.y + miterY * scale },
                    right: { x: p1.x - miterX * scale, y: p1.y - miterY * scale }
                };
            }

            return {
                left: { x: p1.x + miterX, y: p1.y + miterY },
                right: { x: p1.x - miterX, y: p1.y - miterY }
            };
        },

        /**
         * This is the central tessellation point for the GeometryProcessor.
         * @param {RenderPrimitive} primitive - The analytic primitive.
         * @returns {PathPrimitive} A PathPrimitive with tessellated points.
         */
        primitiveToPath(primitive, curveIds = []) {
            if (primitive.type === 'path' && !primitive.properties?.isStroke) {
                return primitive;
            }

            let points = [];
            let arcSegments = [];
            let generatedCurveIds = curveIds || [];

            // Handle strokes as capsule shapes (obrounds)
            const props = primitive.properties || {};
            const isStroke = (props.stroke && !props.fill) || props.isTrace;

            if (isStroke && props.strokeWidth > 0) {
                if (primitive.type === 'arc') {
                    return this.arcToPolygon(primitive, props.strokeWidth);
                } else if (primitive.type === 'path' && primitive.contours?.[0]?.points) {
                    points = this.polylineToPolygon(
                        primitive.contours[0].points, 
                        props.strokeWidth,
                        generatedCurveIds
                    );
                }

                if (points.length < 3) return null;

                const contour = {
                    points: points,
                    isHole: false,
                    nestingLevel: 0,
                    parentId: null,
                    arcSegments: [],
                    curveIds: generatedCurveIds
                };

                return new PathPrimitive([contour], {
                    ...props,
                    wasStroke: true,
                    fill: true,
                    stroke: false,
                    closed: true
                });
            }

            // Standard tessellation for non-strokes
            switch (primitive.type) {
                case 'circle':
                    points = this.circleToPoints(primitive, curveIds);
                    generatedCurveIds = curveIds;
                    break;
                case 'rectangle':
                    points = this.rectangleToPoints(primitive);
                    break;
                case 'obround':
                    points = this.obroundToPoints(primitive, generatedCurveIds);
                    break;
                case 'arc':
                    points = this.arcToPoints(primitive);
                    break;
                case 'elliptical_arc':
                    points = this.ellipticalArcToPoints(primitive);
                    break;
                case 'bezier':
                    points = this.bezierToPoints(primitive);
                    break;
                default:
                    console.warn(`[GeoUtils] primitiveToPath: Unknown primitive type ${primitive.type}`);
                    return null;
            }

            if (points.length === 0) return null;

            const contour = {
                points: points,
                isHole: false,
                nestingLevel: 0,
                parentId: null,
                arcSegments: arcSegments,
                curveIds: generatedCurveIds
            };

            return new PathPrimitive([contour], {
                ...primitive.properties,
                originalType: primitive.type
            });
        },

        /**
         * Merges open segments into a single closed PathPrimitive.
         */
        mergeSegmentsIntoClosedPath(segments) {
            if (!segments || segments.length < 2) return null;

            this.debug('Merge input:', segments.map((s, i) => 
                    `[${i}] ${s.type} ${s.startPoint ? `(${s.startPoint.x.toFixed(1)},${s.startPoint.y.toFixed(1)})→(${s.endPoint.x.toFixed(1)},${s.endPoint.y.toFixed(1)})` : ''}`
                ).join(', '));

            const precision = geomConfig.coordinatePrecision || 0.001;

            // 1: Build adjacency graph
            const graph = this.buildSegmentGraph(segments);

            // 2: Find Eulerian path (if exists)
            const orderedSegments = this.findClosedPath(graph, segments);

            if (!orderedSegments || orderedSegments.length !== segments.length) {
                console.warn('[GeoUtils] Failed to create closed path from segments');
                return null;
            }

            // 3: Build final PathPrimitive with correct arc indices
            return this.assembleClosedPath(orderedSegments, precision);
        },

        /**
         * Helper for mergeSegmentsIntoClosedPath.
         */
        buildSegmentGraph(segments) {
            const getEndpoints = (prim) => {
                if (prim.type === 'arc') {
                    return { start: prim.startPoint, end: prim.endPoint };
                }
                if (prim.type === 'path' && prim.contours && prim.contours[0]?.points?.length >= 2) {
                    const points = prim.contours[0].points;
                    return { 
                        start: points[0], 
                        end: points[points.length - 1] 
                    };
                }
                return null;
            };

            const keyPrecision = geomConfig.edgeKeyPrecision || 3;
            const pointKey = (p) => {
                return `${p.x.toFixed(keyPrecision)},${p.y.toFixed(keyPrecision)}`;
            };

            const graph = new Map();

            segments.forEach((seg, idx) => {
                const endpoints = getEndpoints(seg);
                if (!endpoints) return;

                const startKey = pointKey(endpoints.start);
                const endKey = pointKey(endpoints.end);

                // Add forward connection
                if (!graph.has(startKey)) graph.set(startKey, []);
                graph.get(startKey).push({
                    segmentIndex: idx,
                    direction: 'forward',
                    nextPoint: endpoints.end
                });

                // Add reverse connection
                if (!graph.has(endKey)) graph.set(endKey, []);
                graph.get(endKey).push({
                    segmentIndex: idx,
                    direction: 'reverse',
                    nextPoint: endpoints.start
                });
            });

            return graph;
        },

        /**
         * Helper for mergeSegmentsIntoClosedPath.
         */
        findClosedPath(graph, segments) {
            const keyPrecision = geomConfig.edgeKeyPrecision || 3;
            const pointKey = (p) => `${p.x.toFixed(keyPrecision)},${p.y.toFixed(keyPrecision)}`;

            // Find starting point
            let startKey = null;
            for (const [key, connections] of graph.entries()) {
                if (connections.length > 0) {
                    startKey = key;
                    break;
                }
            }

            if (!startKey) return null;

            const used = new Set();
            const path = [];
            let currentKey = startKey;

            while (path.length < segments.length) {
                const connections = graph.get(currentKey);
                if (!connections) break;

                // Find unused connection
                let found = false;
                for (const conn of connections) {
                    if (!used.has(conn.segmentIndex)) {
                        used.add(conn.segmentIndex);

                        // Store segment with direction info
                        path.push({
                            segment: segments[conn.segmentIndex],
                            direction: conn.direction,
                            originalIndex: conn.segmentIndex
                        });

                        currentKey = pointKey(conn.nextPoint);
                        found = true;
                        break;
                    }
                }

                if (!found) break;
            }

            // Verify closed loop
            if (path.length === segments.length) {
                const firstStart = this.getSegmentStart(path[0].segment, path[0].direction);
                const lastEnd = this.getSegmentEnd(path[path.length - 1].segment, path[path.length - 1].direction);
                
                const precision = geomConfig.coordinatePrecision || 0.001;
                if (Math.hypot(firstStart.x - lastEnd.x, firstStart.y - lastEnd.y) < precision) {
                    return path;
                }
            }

            return null;
        },

        /**
         * Helper for mergeSegmentsIntoClosedPath.
         */
        getSegmentStart(segment, direction) {
            if (segment.type === 'arc') {
                return direction === 'forward' ? segment.startPoint : segment.endPoint;
            }
            if (segment.type === 'path') {
                const points = segment.contours?.[0]?.points;
                if (!points || points.length === 0) return null;
                return direction === 'forward' ? points[0] : points[points.length - 1];
            }
            return null;
        },

        /**
         * Helper for mergeSegmentsIntoClosedPath.
         */
        getSegmentEnd(segment, direction) {
            if (segment.type === 'arc') {
                return direction === 'forward' ? segment.endPoint : segment.startPoint;
            }
            if (segment.type === 'path') {
                const points = segment.contours?.[0]?.points;
                if (!points || points.length === 0) return null;
                return direction === 'forward' ? 
                    points[points.length - 1] : 
                    points[0];
            }
            return null;
        },

        /**
         * Helper for mergeSegmentsIntoClosedPath.
         */
        assembleClosedPath(orderedSegments, precision) {
            this.debug('Stitched order:', orderedSegments.map((seg, i) => 
                `[${i}] orig[${seg.originalIndex}] ${seg.segment.type} ${seg.direction}`
            ).join(', '));

            const finalPoints = [];
            const finalArcSegments = [];

            const firstSeg = orderedSegments[0];
            const firstStart = this.getSegmentStart(firstSeg.segment, firstSeg.direction);
            finalPoints.push(firstStart);

            const tempPoints = orderedSegments.map(seg => 
                this.getSegmentStart(seg.segment, seg.direction)
            );
            const pathWinding = GeometryUtils.calculateWinding(tempPoints);
            const pathIsCCW = pathWinding > 0;

            this.debug(`Path winding: ${pathIsCCW ? 'CCW' : 'CW'} (preserving arc directions)`);

            for (let idx = 0; idx < orderedSegments.length; idx++) {
                const {segment, direction} = orderedSegments[idx];
                const currentPointIndex = finalPoints.length - 1;

                if (segment.type === 'arc') {
                    const arc = segment;
                    const nextPointIndex = currentPointIndex + 1;

                    let arcClockwise = arc.clockwise;
                    let arcStartAngle = arc.startAngle;
                    let arcEndAngle = arc.endAngle;
                    let arcEndPoint = arc.endPoint;

                    if (direction === 'reverse') {
                        arcStartAngle = arc.endAngle;
                        arcEndAngle = arc.startAngle;
                        arcClockwise = !arc.clockwise;
                        arcEndPoint = arc.startPoint;
                    }

                    this.debug(`  Arc ${idx}: ${arcClockwise ? 'CW' : 'CCW'} (direction=${direction})`);

                    finalPoints.push(arcEndPoint);

                    if (isFinite(arc.radius) && arc.radius > 0) {
                        let sweepAngle = arcEndAngle - arcStartAngle;

                        if (arcClockwise) {
                            if (sweepAngle > precision) {
                                sweepAngle -= 2 * Math.PI;
                            }
                        } else {
                            if (sweepAngle < -precision) {
                                sweepAngle += 2 * Math.PI;
                            }
                        }

                        if (Math.abs(sweepAngle) < precision && 
                            Math.hypot(arc.startPoint.x - arc.endPoint.x, arc.startPoint.y - arc.endPoint.y) < precision) {
                            sweepAngle = arcClockwise ? -2 * Math.PI : 2 * Math.PI;
                        }

                        let curveId = null;
                        if (window.globalCurveRegistry) {
                            curveId = window.globalCurveRegistry.register({
                                type: 'arc',
                                center: arc.center,
                                radius: arc.radius,
                                startAngle: arcStartAngle,
                                endAngle: arcEndAngle,
                                clockwise: arcClockwise,
                                source: 'stitched_cutout'
                            });
                        }

                        finalArcSegments.push({
                            startIndex: currentPointIndex,
                            endIndex: nextPointIndex,
                            center: arc.center,
                            radius: arc.radius,
                            startAngle: arcStartAngle,
                            endAngle: arcEndAngle,
                            clockwise: arcClockwise,
                            sweepAngle: sweepAngle,
                            curveId: curveId
                        });

                        this.debug(`Arc ${finalArcSegments.length - 1}: ${currentPointIndex}->${nextPointIndex}, r=${arc.radius.toFixed(3)}, sweep=${(sweepAngle * 180 / Math.PI).toFixed(1)}°, ${arcClockwise ? 'CW' : 'CCW'}`);
                    }

                } else if (segment.type === 'path') {
                    const points = segment.contours?.[0]?.points;
                    if (!points || points.length === 0) continue;

                    this.debug(`Path segment orig[${orderedSegments[idx].originalIndex}]: ${points.length} points, ${direction}`);
                    const pathPoints = direction === 'forward' ? 
                        points.slice(1) : 
                        points.slice(0, -1).reverse();
                    finalPoints.push(...pathPoints);
                }
            }

            const originalEndPointIndex = finalPoints.length - 1;
            if (originalEndPointIndex > 0 && 
                Math.hypot(finalPoints[0].x - finalPoints[originalEndPointIndex].x,
                        finalPoints[0].y - finalPoints[originalEndPointIndex].y) < precision) {
                finalPoints.pop();

                finalArcSegments.forEach(seg => {
                    if (seg.endIndex === originalEndPointIndex) seg.endIndex = 0;
                    if (seg.startIndex === originalEndPointIndex) seg.startIndex = 0;
                });
            }

            this.debug(`Final path: ${finalPoints.length} points, ${finalArcSegments.length} arcs`);

            const contour = {
                points: finalPoints,
                isHole: false,
                nestingLevel: 0,
                parentId: null,
                arcSegments: finalArcSegments,
                curveIds: finalArcSegments.map(s => s.curveId).filter(Boolean)
            };

            return new PathPrimitive([contour], {
                isCutout: true,
                fill: true,
                stroke: false,
                closed: true,
                mergedFromSegments: orderedSegments.length,
                polarity: 'dark'
            });
        },

        debug(message, data = null) {
            if (debugConfig.enabled) {
                if (data) {
                    console.log(`[GeoUtils] ${message}`, data);
                } else {
                    console.log(`[GeoUtils] ${message}`);
                }
            }
        },
    };

    window.GeometryUtils = GeometryUtils;
})();