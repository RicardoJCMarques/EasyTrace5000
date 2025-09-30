// geometry/geometry-line-intersections.js

class LineIntersections {
    constructor(options = {}) {
        this.EPSILON = options.precision || 0.001;
    }

    // Calculate intersection point of two infinite lines
    lineLineIntersection(p1, p2, p3, p4) {
        const denom = (p1.x - p2.x) * (p3.y - p4.y) - 
                    (p1.y - p2.y) * (p3.x - p4.x);
        
        if (Math.abs(denom) < this.EPSILON) {
            return null; // Parallel lines
        }
        
        const t = ((p1.x - p3.x) * (p3.y - p4.y) - 
                (p1.y - p3.y) * (p3.x - p4.x)) / denom;
        
        return {
            x: p1.x + t * (p2.x - p1.x),
            y: p1.y + t * (p2.y - p1.y),
            t: t  // Parameter for segment bounds checking
        };
    }
    
    // Line-circle intersection (returns 0, 1, or 2 points)
    lineCircleIntersection(lineStart, lineEnd, center, radius) {
        // Vector from center to line start
        const d = {
            x: lineStart.x - center.x,
            y: lineStart.y - center.y
        };
        
        // Line direction vector
        const f = {
            x: lineEnd.x - lineStart.x,
            y: lineEnd.y - lineStart.y
        };
        
        // Quadratic coefficients
        const a = f.x * f.x + f.y * f.y;
        const b = 2 * (f.x * d.x + f.y * d.y);
        const c = d.x * d.x + d.y * d.y - radius * radius;
        
        const discriminant = b * b - 4 * a * c;
        
        if (discriminant < 0) return [];
        
        const sqrtDisc = Math.sqrt(discriminant);
        const t1 = (-b - sqrtDisc) / (2 * a);
        const t2 = (-b + sqrtDisc) / (2 * a);
        
        const points = [];
        for (const t of [t1, t2]) {
            if (t >= 0 && t <= 1) {  // Within segment bounds
                points.push({
                    x: lineStart.x + t * f.x,
                    y: lineStart.y + t * f.y,
                    t: t
                });
            }
        }
        
        return points;
    }
    
    // Point-to-segment distance
    pointToSegmentDistance(point, segStart, segEnd) {
        const dx = segEnd.x - segStart.x;
        const dy = segEnd.y - segStart.y;
        const lengthSquared = dx * dx + dy * dy;
        
        if (lengthSquared === 0) {
            // Degenerate segment
            return Math.sqrt(
                Math.pow(point.x - segStart.x, 2) + 
                Math.pow(point.y - segStart.y, 2)
            );
        }
        
        // Project point onto line
        const t = Math.max(0, Math.min(1,
            ((point.x - segStart.x) * dx + (point.y - segStart.y) * dy) / lengthSquared
        ));
        
        const projX = segStart.x + t * dx;
        const projY = segStart.y + t * dy;
        
        return Math.sqrt(
            Math.pow(point.x - projX, 2) + 
            Math.pow(point.y - projY, 2)
        );
    }

    // Check if two LINE SEGMENTS intersect (bounded, not infinite lines)
    lineLineSegmentIntersection(seg1, seg2) {
        const intersection = this.lineLineIntersection(
            seg1.start, seg1.end,
            seg2.start, seg2.end
        );
        
        if (!intersection) return null;
        
        // Check if intersection is within both segment bounds
        const t1 = intersection.t;
        
        // Calculate t2 for second segment
        const dx = seg2.end.x - seg2.start.x;
        const dy = seg2.end.y - seg2.start.y;
        const t2 = Math.abs(dx) > Math.abs(dy) ?
            (intersection.x - seg2.start.x) / dx :
            (intersection.y - seg2.start.y) / dy;
        
        if (t1 >= 0 && t1 <= 1 && t2 >= 0 && t2 <= 1) {
            return intersection;
        }
        
        return null;
    }
    
    // Line segment to arc intersection
    lineArcSegmentIntersection(lineSeg, arcSeg) {
        const points = this.lineCircleIntersection(
            lineSeg.start,
            lineSeg.end,
            arcSeg.center,
            arcSeg.radius
        );
        
        // Filter to points actually on the arc
        return points.find(p => this.isPointOnArc(p, arcSeg)) || null;
    }
    
    // Arc to arc intersection
    arcArcSegmentIntersection(arc1, arc2) {
        const points = this.circleCircleIntersection(
            arc1.center, arc1.radius,
            arc2.center, arc2.radius
        );
        
        // Find first point on both arcs
        return points.find(p => 
            this.isPointOnArc(p, arc1) && this.isPointOnArc(p, arc2)
        ) || null;
    }
    
    // Circle-circle intersection
    circleCircleIntersection(center1, radius1, center2, radius2) {
        const dx = center2.x - center1.x;
        const dy = center2.y - center1.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        
        // No intersection cases
        if (d > radius1 + radius2 || 
            d < Math.abs(radius1 - radius2) ||
            d < this.EPSILON) {
            return [];
        }
        
        const a = (radius1 * radius1 - radius2 * radius2 + d * d) / (2 * d);
        const h = Math.sqrt(radius1 * radius1 - a * a);
        
        const px = center1.x + a * dx / d;
        const py = center1.y + a * dy / d;
        
        return [
            {
                x: px + h * dy / d,
                y: py - h * dx / d
            },
            {
                x: px - h * dy / d,
                y: py + h * dx / d
            }
        ];
    }
    
    // Check if point is on arc sweep
    isPointOnArc(point, arc) {
        const angle = Math.atan2(
            point.y - arc.center.y,
            point.x - arc.center.x
        );
        
        let startAngle = arc.startAngle;
        let endAngle = arc.endAngle;
        let testAngle = angle;
        
        // Normalize to [0, 2π]
        while (startAngle < 0) startAngle += 2 * Math.PI;
        while (endAngle < 0) endAngle += 2 * Math.PI;
        while (testAngle < 0) testAngle += 2 * Math.PI;
        while (startAngle >= 2 * Math.PI) startAngle -= 2 * Math.PI;
        while (endAngle >= 2 * Math.PI) endAngle -= 2 * Math.PI;
        while (testAngle >= 2 * Math.PI) testAngle -= 2 * Math.PI;
        
        if (arc.clockwise) {
            if (startAngle > endAngle) {
                return testAngle <= endAngle || testAngle >= startAngle;
            } else {
                return testAngle >= endAngle && testAngle <= startAngle;
            }
        } else {
            if (startAngle < endAngle) {
                return testAngle >= startAngle && testAngle <= endAngle;
            } else {
                return testAngle >= startAngle || testAngle <= endAngle;
            }
        }
    }
}

// Export
window.LineIntersections = LineIntersections;