// geometry/geometry-utils.js
// Pure geometric utility functions with curve metadata support
// FIXED: End-cap curves registered with explicit clockwise=false

(function() {
    'use strict';
    
    const GeometryUtils = {
        // Coordinate precision threshold
        PRECISION: 0.001,
        
        // Optimal segment calculation
        getOptimalSegments(radius, minSegments = 8, maxSegments = 128, targetLength = 0.1) {
            if (radius <= 0) return minSegments;
            const circumference = 2 * Math.PI * radius;
            const desiredSegments = Math.ceil(circumference / targetLength);
            return Math.max(minSegments, Math.min(maxSegments, desiredSegments));
        },
        
        // Calculate segment count for radius
        getSegmentCount(radius, type = 'circle', config = {}) {
            const circumference = 2 * Math.PI * radius;
            const targetLength = config.targetLength || 0.1;
            const calculated = Math.ceil(circumference / targetLength);
            
            const typeKey = type.charAt(0).toUpperCase() + type.slice(1);
            const min = config[`min${typeKey}`] || (type === 'circle' ? 16 : 8);
            const max = config[`max${typeKey}`] || (type === 'circle' ? 128 : 64);
            
            return Math.max(min, Math.min(max, calculated));
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
                const arcLength = Math.abs(angleSpan) * radius;
                segments = this.getSegmentCount(radius, 'arc');
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
            
            // FIXED: Register end-caps with explicit clockwise=false
            const startCapId = window.globalCurveRegistry?.register({
                type: 'arc',
                center: { x: points[0].x, y: points[0].y },
                radius: halfWidth,
                startAngle: 0,
                endAngle: Math.PI * 2,
                clockwise: false,  // CRITICAL: End-caps always CCW
                source: 'end_cap'
            });
            
            const endCapId = window.globalCurveRegistry?.register({
                type: 'arc',
                center: { x: points[points.length - 1].x, y: points[points.length - 1].y },
                radius: halfWidth,
                startAngle: 0,
                endAngle: Math.PI * 2,
                clockwise: false,  // CRITICAL: End-caps always CCW
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
                // FIXED: Register circle end-cap with clockwise=false
                const curveId = window.globalCurveRegistry?.register({
                    type: 'circle',
                    center: { x: from.x, y: from.y },
                    radius: halfWidth,
                    clockwise: false,  // CRITICAL: Always CCW
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
            const capSegments = Math.max(16, Math.min(64, this.getOptimalSegments(halfWidth, 16, 64)));
            const halfSegments = Math.floor(capSegments / 2);
            
            // FIXED: Register end-caps with explicit clockwise=false
            const startCapId = window.globalCurveRegistry?.register({
                type: 'arc',
                center: { x: from.x, y: from.y },
                radius: halfWidth,
                startAngle: 0,
                endAngle: Math.PI * 2,
                clockwise: false,  // CRITICAL: End-caps always CCW
                source: 'end_cap'
            });
            
            const endCapId = window.globalCurveRegistry?.register({
                type: 'arc',
                center: { x: to.x, y: to.y },
                radius: halfWidth,
                startAngle: 0,
                endAngle: Math.PI * 2,
                clockwise: false,  // CRITICAL: End-caps always CCW
                source: 'end_cap'
            });
            
            // Left side of start
            points.push({ x: from.x + nx, y: from.y + ny });
            
            // Start cap with COMPLETE metadata - ALL points including first and last
            const startAngle = Math.atan2(ny, nx);
            for (let i = 0; i <= halfSegments; i++) {
                const t = i / halfSegments;
                const angle = startAngle + Math.PI * t;
                const point = {
                    x: from.x + halfWidth * Math.cos(angle),
                    y: from.y + halfWidth * Math.sin(angle),
                    curveId: startCapId,
                    segmentIndex: i,
                    totalSegments: halfSegments + 1,
                    t: t,
                    isConnectionPoint: (i === 0 || i === halfSegments)  // Mark both boundaries
                };
                
                // Skip duplicate points but ensure end points are tagged
                if (i === 0 && points.length > 0) {
                    const lastPoint = points[points.length - 1];
                    if (Math.abs(point.x - lastPoint.x) < this.PRECISION &&
                        Math.abs(point.y - lastPoint.y) < this.PRECISION) {
                        // Transfer metadata to existing point
                        lastPoint.curveId = point.curveId;
                        lastPoint.segmentIndex = point.segmentIndex;
                        lastPoint.totalSegments = point.totalSegments;
                        lastPoint.t = point.t;
                        lastPoint.isConnectionPoint = true;
                        continue;
                    }
                }
                points.push(point);
            }
            
            // Right side
            points.push({ x: from.x - nx, y: from.y - ny });
            points.push({ x: to.x - nx, y: to.y - ny });
            
            // End cap with COMPLETE metadata - ALL points including first and last
            const endAngle = Math.atan2(-ny, -nx);
            for (let i = 0; i <= halfSegments; i++) {
                const t = i / halfSegments;
                const angle = endAngle + Math.PI * t;
                const point = {
                    x: to.x + halfWidth * Math.cos(angle),
                    y: to.y + halfWidth * Math.sin(angle),
                    curveId: endCapId,
                    segmentIndex: i,
                    totalSegments: halfSegments + 1,
                    t: t,
                    isConnectionPoint: (i === 0 || i === halfSegments)  // Mark both boundaries
                };
                
                // Skip duplicate points but ensure end points are tagged
                if (i === 0 && points.length > 0) {
                    const lastPoint = points[points.length - 1];
                    if (Math.abs(point.x - lastPoint.x) < this.PRECISION &&
                        Math.abs(point.y - lastPoint.y) < this.PRECISION) {
                        // Transfer metadata to existing point
                        lastPoint.curveId = point.curveId;
                        lastPoint.segmentIndex = point.segmentIndex;
                        lastPoint.totalSegments = point.totalSegments;
                        lastPoint.t = point.t;
                        lastPoint.isConnectionPoint = true;
                        continue;
                    }
                }
                points.push(point);
            }
            
            // Left side of end
            points.push({ x: to.x + nx, y: to.y + ny });
            
            return points;
        },
        
        // Convert arc to polygon with metadata for end-caps
        arcToPolygon(center, radius, startDeg, endDeg, width) {
            const points = [];
            const halfWidth = width / 2;
            const innerR = radius - halfWidth;
            const outerR = radius + halfWidth;
            
            // Fallback to filled circle if inner radius is negative
            if (innerR < 0) {
                const circleSegments = 48;
                // FIXED: Register circle with clockwise=false
                const curveId = window.globalCurveRegistry?.register({
                    type: 'circle',
                    center: { x: center.x, y: center.y },
                    radius: outerR,
                    clockwise: false,  // CRITICAL: Circles always CCW
                    source: 'arc_fallback'
                });
                
                for (let i = 0; i < circleSegments; i++) {
                    const angle = (i / circleSegments) * 2 * Math.PI;
                    const point = {
                        x: center.x + outerR * Math.cos(angle),
                        y: center.y + outerR * Math.sin(angle),
                        curveId: curveId,
                        segmentIndex: i,
                        totalSegments: circleSegments,
                        t: i / circleSegments
                    };
                    points.push(point);
                }
                return points;
            }
            
            const startRad = startDeg * Math.PI / 180;
            const endRad = endDeg * Math.PI / 180;
            
            const startCapCenter = {
                x: center.x + radius * Math.cos(startRad),
                y: center.y + radius * Math.sin(startRad)
            };
            const endCapCenter = {
                x: center.x + radius * Math.cos(endRad),
                y: center.y + radius * Math.sin(endRad)
            };
            
            // FIXED: Register end-caps with explicit clockwise=false
            const startCapId = window.globalCurveRegistry?.register({
                type: 'arc',
                center: startCapCenter,
                radius: halfWidth,
                startAngle: 0,
                endAngle: Math.PI * 2,
                clockwise: false,  // CRITICAL: End-caps always CCW
                source: 'arc_end_cap'
            });
            
            const endCapId = window.globalCurveRegistry?.register({
                type: 'arc',
                center: endCapCenter,
                radius: halfWidth,
                startAngle: 0,
                endAngle: Math.PI * 2,
                clockwise: false,  // CRITICAL: End-caps always CCW
                source: 'arc_end_cap'
            });
            
            const segments = 48;
            const capSegments = Math.max(8, Math.min(16, this.getOptimalSegments(halfWidth, 8, 16)));
            
            // Outer arc
            for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                const angle = startRad + (endRad - startRad) * t;
                points.push({
                    x: center.x + outerR * Math.cos(angle),
                    y: center.y + outerR * Math.sin(angle)
                });
            }
            
            // End cap with complete metadata
            for (let i = 0; i <= capSegments; i++) {  // FIXED: Start at 0
                const t = i / capSegments;
                const angle = endRad + (Math.PI * t);
                const point = {
                    x: endCapCenter.x + halfWidth * Math.cos(angle),
                    y: endCapCenter.y + halfWidth * Math.sin(angle),
                    curveId: endCapId,
                    segmentIndex: i,
                    totalSegments: capSegments + 1,
                    t: t,
                    isConnectionPoint: (i === 0 || i === capSegments)
                };
                points.push(point);
            }
            
            // Inner arc (reversed)
            for (let i = segments; i >= 0; i--) {
                const t = i / segments;
                const angle = startRad + (endRad - startRad) * t;
                points.push({
                    x: center.x + innerR * Math.cos(angle),
                    y: center.y + innerR * Math.sin(angle)
                });
            }
            
            // Start cap with complete metadata
            for (let i = 0; i <= capSegments; i++) {  // FIXED: Start at 0
                const t = i / capSegments;
                const angle = (startRad + Math.PI) + (Math.PI * t);
                const point = {
                    x: startCapCenter.x + halfWidth * Math.cos(angle),
                    y: startCapCenter.y + halfWidth * Math.sin(angle),
                    curveId: startCapId,
                    segmentIndex: i,
                    totalSegments: capSegments + 1,
                    t: t,
                    isConnectionPoint: (i === 0 || i === capSegments)
                };
                points.push(point);
            }
            
            return points;
        },
        
        // Generate complete rounded cap with all boundary points tagged - END-CAPS ARE ALWAYS CCW
        generateCompleteRoundedCap(center, dirX, dirY, radius, isStart, curveId) {
            const points = [];
            // Use same segmentation rules as circles for consistency
            const segments = Math.max(16, Math.min(64, this.getOptimalSegments(radius, 16, 64)));
            const halfSegments = Math.floor(segments / 2);
            
            const baseAngle = Math.atan2(dirY, dirX);
            const startAngle = isStart ? baseAngle - Math.PI/2 : baseAngle + Math.PI/2;
            
            // End-caps are always generated CCW (positive angle progression)
            for (let i = 0; i <= halfSegments; i++) {  // Half circle for end-cap
                const angle = startAngle + (Math.PI * i / halfSegments);
                const t = i / halfSegments;
                const point = {
                    x: center.x + radius * Math.cos(angle),
                    y: center.y + radius * Math.sin(angle),
                    curveId: curveId,
                    segmentIndex: i,
                    totalSegments: halfSegments + 1,
                    t: t,
                    isConnectionPoint: (i === 0 || i === halfSegments)  // Mark both ends
                };
                points.push(point);
            }
            
            return points;
        },
        
        // Backward compatibility wrapper
        generateRoundedCap(center, dirX, dirY, radius, isStart, curveId) {
            return this.generateCompleteRoundedCap(center, dirX, dirY, radius, isStart, curveId);
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