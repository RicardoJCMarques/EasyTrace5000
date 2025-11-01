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
    
    const GeometryUtils = {
        // Coordinate precision threshold
        PRECISION: 0.001,
        
        _calculateSegments(radius, targetLength, minSegments, maxSegments) {
            // For zero/negative radius, return the minimum valid count.
            if (radius <= 0) {
                // Ensure the minimum is at least 8 and a multiple of 8.
                return Math.max(8, Math.ceil(minSegments / 8) * 8);
            }

            // Adjust boundaries to be multiples of 8, ensuring a valid range.
            const min = Math.max(8, Math.ceil(minSegments / 8) * 8);
            const max = Math.floor(maxSegments / 8) * 8;

            // If adjusted boundaries are invalid (e.g., min > max), return the minimum.
            if (min > max) {
                return min;
            }

            const circumference = 2 * Math.PI * radius;
            const desiredSegments = circumference / targetLength;

            // Round the ideal segment count to the NEAREST multiple of 8.
            let calculatedSegments = Math.round(desiredSegments / 8) * 8;

            // Clamp the result within the adjusted boundaries. The final value
            // will always be a multiple of 8 within the valid range.
            const finalSegments = Math.max(min, Math.min(max, calculatedSegments));

            return finalSegments;
        },
        
        // Optimal segment calculation
        getOptimalSegments(radius, minSegments = 24, maxSegments = 256, targetLength = 0.05) {
            // This function now uses the centralized logic with higher-resolution defaults.
            const config = window.PCBCAMConfig?.geometry?.segments || {};
            return this._calculateSegments(
                radius, 
                config.targetLength || targetLength, 
                minSegments, 
                maxSegments
            );
        },
        
        // Calculate segment count for radius
        getSegmentCount(radius, type = 'circle', config = {}) {
            // This function now also produces multiples of 8 by using the centralized logic.
            const targetLength = config.targetLength || 0.1;
            const typeKey = type.charAt(0).toUpperCase() + type.slice(1);
            const min = config[`min${typeKey}`] || (type === 'circle' ? 16 : 8);
            const max = config[`max${typeKey}`] || (type === 'circle' ? 128 : 64);

            return this._calculateSegments(radius, targetLength, min, max);
        },
        
        // Validate Clipper scale factor
        validateScale(scale, min = 1000, max = 1000000) {
            return Math.max(min, Math.min(max, scale || 10000));
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
        
        // Interpolate arc points
        interpolateArc(start, end, center, clockwise, segments = null) {
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
            
            if (!segments) {
                const config = window.PCBCAMConfig?.geometry?.segments || {};
                segments = this.getSegmentCount(radius, 'arc', config);
            }
            
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
        
        // Convert obround to points
        obroundToPoints(obround, segmentsPerArc = 16) {
            const points = [];
            const { x, y } = obround.position;
            const w = obround.width || 0;
            const h = obround.height || 0;
            const r = Math.min(w, h) / 2;
            
            if (r <= 0) return [];
            
            // CLEANUP: Directly call getOptimalSegments. Redundant clamping is removed.
            const segments = this.getOptimalSegments(r, 8, 32);
            const halfSegments = Math.ceil(segments / 2);
            
            if (w > h) { // Horizontal
                const c1x = x + r;
                const c2x = x + w - r;
                const cy = y + r;
                
                for (let i = 0; i <= halfSegments; i++) {
                    const angle = Math.PI / 2 + (i / halfSegments) * Math.PI;
                    points.push({ x: c1x + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
                }
                for (let i = 0; i <= halfSegments; i++) {
                    const angle = -Math.PI / 2 + (i / halfSegments) * Math.PI;
                    points.push({ x: c2x + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
                }
            } else { // Vertical
                const cx = x + r;
                const c1y = y + r;
                const c2y = y + h - r;
                
                for (let i = 0; i <= halfSegments; i++) {
                    const angle = Math.PI + (i / halfSegments) * Math.PI;
                    points.push({ x: cx + r * Math.cos(angle), y: c1y + r * Math.sin(angle) });
                }
                for (let i = 0; i <= halfSegments; i++) {
                    const angle = (i / halfSegments) * Math.PI;
                    points.push({ x: cx + r * Math.cos(angle), y: c2y + r * Math.sin(angle) });
                }
            }
            
            return points;
        },
        
        // Convert polyline to polygon with metadata for end-caps
        polylineToPolygon(points, width) {
            if (!points || points.length < 2) return [];
            
            const halfWidth = width / 2;
            
            // Single segment - use specialized function
            if (points.length === 2) {
                return this.lineToPolygon(
                    {x: points[0].x, y: points[0].y},
                    {x: points[1].x, y: points[1].y},
                    width
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
            
            const endCapId = window.globalCurveRegistry?.register({
                type: 'arc',
                center: { x: points[points.length - 1].x, y: points[points.length - 1].y },
                radius: halfWidth,
                startAngle: 0,
                endAngle: Math.PI * 2,
                clockwise: false,  // End-caps always CCW
                source: 'end_cap'
            });
            
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
        
        // Convert line to polygon with complete metadata for rounded caps
        lineToPolygon(from, to, width) {
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            const halfWidth = width / 2;
            
            // Zero-length line becomes circle with metadata
            if (len < this.PRECISION) {
                const segments = 24;
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
            
            // Use consistent segment count based on radius - match circle segmentation
            const capSegments = this.getOptimalSegments(halfWidth, 16, 64);
            const halfSegments = Math.floor(capSegments / 2);
            
            // Register end-caps with explicit clockwise=false
            const startCapId = window.globalCurveRegistry?.register({
                type: 'arc',
                center: { x: from.x, y: from.y },
                radius: halfWidth,
                startAngle: 0,
                endAngle: Math.PI * 2,
                clockwise: false,  // End-caps always CCW
                source: 'end_cap'
            });
            
            const endCapId = window.globalCurveRegistry?.register({
                type: 'arc',
                center: { x: to.x, y: to.y },
                radius: halfWidth,
                startAngle: 0,
                endAngle: Math.PI * 2,
                clockwise: false,  // End-caps always CCW
                source: 'end_cap'
            });
            
            // Left side of start
            points.push({ x: from.x + nx, y: from.y + ny });
            
            // Start cap - perpendicular direction is the "radial" for line end caps
            const perpAngle = Math.atan2(ny, nx);
            const startCapPoints = this.generateCompleteRoundedCap(
                from,           // cap center
                perpAngle,      // "radial" direction (perpendicular to line)
                halfWidth,      // cap radius
                false,          // no arc direction for straight lines
                true,           // isStart
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
            
            // End cap with COMPLETE metadata - ALL points including first and last
            const endPerpAngle = Math.atan2(-ny, -nx);
            const endCapPoints = this.generateCompleteRoundedCap(
                to,             // cap center
                endPerpAngle,   // "radial" direction (perpendicular to line)
                halfWidth,      // cap radius
                false,          // no arc direction for straight lines
                false,          // isStart = false for end cap
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
        
        // Convert arc to polygon with metadata for end-caps
        arcToPolygon(arc, width) {
            console.log(`[GeoUtils] arcToPolygon called for Arc ${arc.id}, r=${arc.radius.toFixed(3)}, width=${width.toFixed(3)}`);
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

            // Fallback to filled circle
            if (innerR < this.PRECISION) {
                const circleSegments = this.getOptimalSegments(outerR, 16, 64);
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
                points.curveIds = [curveId].filter(Boolean);
                console.log(`[GeoUtils] arcToPolygon fallback to circle. Points: ${points.length}, ID: ${curveId}`);
                return points;
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
            const arcSegments = this.getOptimalSegments(arc.radius, 16, 128);

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
            // Cap starts at radial angle (pointing to outer arc), sweeps 180° CCW to inner arc
            const endCapPoints = this.generateCompleteRoundedCap(
                endCapCenter,    // cap center
                endRad,          // radial angle at arc end
                halfWidth,       // cap radius
                clockwise,       // arc direction (not used in current impl, for future)
                false,           // isStart = false for end cap
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
            // Start cap connects from inner back to outer
            // Start at radial + π (inner side), sweep 180° CCW to radial (outer side)
            const startCapPoints = this.generateCompleteRoundedCap(
                startCapCenter,      // cap center
                startRad + Math.PI,  // start at inner side (radial + 180°)
                halfWidth,           // cap radius
                clockwise,           // arc direction (not used in current impl, for future)
                true,                // isStart = true for start cap
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
            if (Math.hypot(first.x - last.x, first.y - last.y) < this.PRECISION * 0.1) {
                points.pop();
                console.log("[GeoUtils] arcToPolygon removed duplicate closing point.");
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

            points.arcSegments = arcSegmentsMetadata;

            points.curveIds = [outerArcId, innerArcId, startCapId, endCapId].filter(Boolean);
            points.arcSegments = arcSegmentsMetadata;
            console.log(`[GeoUtils] arcToPolygon finished. Points: ${points.length}, Registered curve IDs:`, points.curveIds);
            return points;
        },
        
        // Generate complete rounded cap with all boundary points tagged - END-CAPS ARE ALWAYS CCW
        generateCompleteRoundedCap(center, radialAngle, radius, clockwiseArc, isStart, curveId) {
            const points = [];
            const segments = this.getOptimalSegments(radius, 16, 64);
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
            const maxMiter = halfWidth * 2;
            
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
        }
    };
    
    // Export
    window.GeometryUtils = GeometryUtils;
    
})();