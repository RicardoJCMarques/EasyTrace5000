// geometry/geometry-utils.js
// Pure geometric utility functions - no state, no side effects

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
        
        // Convert polyline to polygon with width
        polylineToPolygon(points, width) {
            if (!points || points.length < 2) return [];
            
            const halfWidth = width / 2;
            
            // Single segment
            if (points.length === 2) {
                return this.lineToPolygon(
                    [points[0].x, points[0].y],
                    [points[1].x, points[1].y],
                    width
                ).map(p => ({ x: p[0], y: p[1] }));
            }
            
            // Multi-segment
            const leftSide = [];
            const rightSide = [];
            
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
                    // Start cap
                    const capPoints = this.generateRoundedCap(p1, -ux, -uy, halfWidth, true);
                    leftSide.push(...capPoints);
                    rightSide.push({ x: p1.x - nx, y: p1.y - ny });
                } else {
                    // Join
                    const joinPoints = this.generateJoin(p0, p1, p2, halfWidth);
                    leftSide.push(joinPoints.left);
                    rightSide.push(joinPoints.right);
                }
                
                if (i === points.length - 2) {
                    // End cap
                    leftSide.push({ x: p2.x + nx, y: p2.y + ny });
                    const capPoints = this.generateRoundedCap(p2, ux, uy, halfWidth, false);
                    rightSide.push(...capPoints);
                }
            }
            
            return [...leftSide, ...rightSide.reverse()];
        },
        
        // Convert line to polygon with rounded caps
        lineToPolygon(from, to, width) {
            const dx = to[0] - from[0];
            const dy = to[1] - from[1];
            const len = Math.sqrt(dx * dx + dy * dy);
            const halfWidth = width / 2;
            
            // Zero-length line becomes circle
            if (len < this.PRECISION) {
                const segments = 24;
                const points = [];
                for (let i = 0; i < segments; i++) {
                    const angle = (i / segments) * 2 * Math.PI;
                    points.push([
                        from[0] + halfWidth * Math.cos(angle),
                        from[1] + halfWidth * Math.sin(angle)
                    ]);
                }
                return points;
            }
            
            const ux = dx / len;
            const uy = dy / len;
            const nx = -uy * halfWidth;
            const ny = ux * halfWidth;
            
            const points = [];
            const capSegments = 16;
            
            // Left side of start
            points.push([from[0] + nx, from[1] + ny]);
            
            // Start cap
            const startAngle = Math.atan2(ny, nx);
            for (let i = 1; i < capSegments; i++) {
                const t = i / capSegments;
                const angle = startAngle + Math.PI * t;
                points.push([
                    from[0] + halfWidth * Math.cos(angle),
                    from[1] + halfWidth * Math.sin(angle)
                ]);
            }
            
            // Right side
            points.push([from[0] - nx, from[1] - ny]);
            points.push([to[0] - nx, to[1] - ny]);
            
            // End cap
            const endAngle = Math.atan2(-ny, -nx);
            for (let i = 1; i < capSegments; i++) {
                const t = i / capSegments;
                const angle = endAngle + Math.PI * t;
                points.push([
                    to[0] + halfWidth * Math.cos(angle),
                    to[1] + halfWidth * Math.sin(angle)
                ]);
            }
            
            // Left side of end
            points.push([to[0] + nx, to[1] + ny]);
            
            return points;
        },
        
        // Convert arc to polygon with width
        arcToPolygon(center, radius, startDeg, endDeg, width) {
            const points = [];
            const segments = 48;
            const capSegments = 16;
            const halfWidth = width / 2;
            const innerR = radius - halfWidth;
            const outerR = radius + halfWidth;
            
            // Fallback to filled circle if inner radius is negative
            if (innerR < 0) {
                const circleSegments = 48;
                for (let i = 0; i < circleSegments; i++) {
                    const angle = (i / circleSegments) * 2 * Math.PI;
                    points.push([
                        center[0] + outerR * Math.cos(angle),
                        center[1] + outerR * Math.sin(angle)
                    ]);
                }
                return points;
            }
            
            const startRad = startDeg * Math.PI / 180;
            const endRad = endDeg * Math.PI / 180;
            
            const startCapCenter = [
                center[0] + radius * Math.cos(startRad),
                center[1] + radius * Math.sin(startRad)
            ];
            const endCapCenter = [
                center[0] + radius * Math.cos(endRad),
                center[1] + radius * Math.sin(endRad)
            ];
            
            // Outer arc
            for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                const angle = startRad + (endRad - startRad) * t;
                points.push([
                    center[0] + outerR * Math.cos(angle),
                    center[1] + outerR * Math.sin(angle)
                ]);
            }
            
            // End cap
            for (let i = 1; i <= capSegments; i++) {
                const t = i / capSegments;
                const angle = endRad + (Math.PI * t);
                points.push([
                    endCapCenter[0] + halfWidth * Math.cos(angle),
                    endCapCenter[1] + halfWidth * Math.sin(angle)
                ]);
            }
            
            // Inner arc (reversed)
            for (let i = segments; i >= 0; i--) {
                const t = i / segments;
                const angle = startRad + (endRad - startRad) * t;
                points.push([
                    center[0] + innerR * Math.cos(angle),
                    center[1] + innerR * Math.sin(angle)
                ]);
            }
            
            // Start cap
            for (let i = 1; i <= capSegments; i++) {
                const t = i / capSegments;
                const angle = (startRad + Math.PI) + (Math.PI * t);
                points.push([
                    startCapCenter[0] + halfWidth * Math.cos(angle),
                    startCapCenter[1] + halfWidth * Math.sin(angle)
                ]);
            }
            
            return points;
        },
        
        // Generate rounded cap
        generateRoundedCap(center, dirX, dirY, radius, isStart) {
            const points = [];
            const segments = 16;
            
            const baseAngle = Math.atan2(dirY, dirX);
            const startAngle = isStart ? baseAngle - Math.PI/2 : baseAngle + Math.PI/2;
            
            for (let i = 0; i <= segments; i++) {
                const angle = startAngle + (Math.PI * i / segments);
                points.push({
                    x: center.x + radius * Math.cos(angle),
                    y: center.y + radius * Math.sin(angle)
                });
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