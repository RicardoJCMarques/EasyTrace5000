// Core Polygon System for PCB Geometry

class CopperPolygon {
    constructor(points, properties = {}) {
        this.points = this.cleanPoints(points);
        this.holes = []; // Array of hole polygons
        this.properties = {
            layer: properties.layer || 'copper',
            source: properties.source || 'unknown',
            aperture: properties.aperture || null,
            ...properties
        };
        this.bounds = null;
    }
    
    cleanPoints(points) {
        if (!Array.isArray(points)) return [];
        
        // Remove invalid points and duplicates
        const cleaned = points.filter(p => 
            p && typeof p.x === 'number' && typeof p.y === 'number' &&
            isFinite(p.x) && isFinite(p.y)
        );
        
        // Remove consecutive duplicate points
        const deduplicated = [];
        for (let i = 0; i < cleaned.length; i++) {
            const current = cleaned[i];
            const prev = deduplicated[deduplicated.length - 1];
            
            if (!prev || !this.pointsEqual(current, prev)) {
                deduplicated.push(current);
            }
        }
        
        return deduplicated;
    }
    
    pointsEqual(p1, p2, tolerance = 1e-6) {
        return Math.abs(p1.x - p2.x) < tolerance && Math.abs(p1.y - p2.y) < tolerance;
    }
    
    isValid() {
        return this.points.length >= 3;
    }
    
    isClosed() {
        if (this.points.length < 3) return false;
        return this.pointsEqual(this.points[0], this.points[this.points.length - 1]);
    }
    
    ensureClosed() {
        if (!this.isClosed() && this.points.length >= 3) {
            this.points.push({ ...this.points[0] });
        }
        return this;
    }
    
    getBounds() {
        if (!this.bounds && this.points.length > 0) {
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            
            for (const point of this.points) {
                minX = Math.min(minX, point.x);
                minY = Math.min(minY, point.y);
                maxX = Math.max(maxX, point.x);
                maxY = Math.max(maxY, point.y);
            }
            
            this.bounds = { minX, minY, maxX, maxY };
        }
        
        return this.bounds || { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
    
    getArea() {
        if (this.points.length < 3) return 0;
        
        let area = 0;
        for (let i = 0; i < this.points.length - 1; i++) {
            const p1 = this.points[i];
            const p2 = this.points[i + 1];
            area += (p1.x * p2.y - p2.x * p1.y);
        }
        
        return Math.abs(area) / 2;
    }
    
    isClockwise() {
        if (this.points.length < 3) return false;
        
        let sum = 0;
        for (let i = 0; i < this.points.length - 1; i++) {
            const p1 = this.points[i];
            const p2 = this.points[i + 1];
            sum += (p2.x - p1.x) * (p2.y + p1.y);
        }
        
        return sum > 0;
    }
    
    reverse() {
        this.points.reverse();
        this.bounds = null;
        return this;
    }
    
    transform(matrix) {
        this.points = this.points.map(point => ({
            x: point.x * matrix.a + point.y * matrix.c + matrix.e,
            y: point.x * matrix.b + point.y * matrix.d + matrix.f
        }));
        this.bounds = null;
        return this;
    }
    
    // Convert to Clipper.js format
    toClipperPath() {
        return this.points.map(p => ({
            X: Math.round(p.x * 1000000), // Convert to integer (micrometers)
            Y: Math.round(p.y * 1000000)
        }));
    }
    
    // Create from Clipper.js format
    static fromClipperPath(clipperPath, properties = {}) {
        const points = clipperPath.map(p => ({
            x: p.X / 1000000, // Convert back to mm
            y: p.Y / 1000000
        }));
        
        return new CopperPolygon(points, properties);
    }
    
    clone() {
        const cloned = new CopperPolygon([...this.points], { ...this.properties });
        cloned.holes = this.holes.map(hole => hole.clone());
        return cloned;
    }
}

// Factory functions for creating common polygon shapes
class PolygonFactory {
    static createCircle(centerX, centerY, radius, segments = 32) {
        const points = [];
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * 2 * Math.PI;
            points.push({
                x: centerX + radius * Math.cos(angle),
                y: centerY + radius * Math.sin(angle)
            });
        }
        
        return new CopperPolygon(points, { shape: 'circle', radius });
    }
    
    static createRectangle(x, y, width, height) {
        const points = [
            { x, y },
            { x: x + width, y },
            { x: x + width, y: y + height },
            { x, y: y + height },
            { x, y } // Close the polygon
        ];
        
        return new CopperPolygon(points, { shape: 'rectangle', width, height });
    }
    
    static createObround(x, y, width, height) {
        const points = [];
        const radius = Math.min(width, height) / 2;
        const rectWidth = width - 2 * radius;
        const rectHeight = height - 2 * radius;
        
        // If it's essentially a circle
        if (rectWidth <= 0 && rectHeight <= 0) {
            return this.createCircle(x + width/2, y + height/2, radius);
        }
        
        // Create obround as rectangle with rounded ends
        const segments = 16;
        
        if (width > height) {
            // Horizontal obround
            const centerY = y + height / 2;
            
            // Left semicircle
            for (let i = segments/2; i <= segments; i++) {
                const angle = (i / segments) * 2 * Math.PI;
                points.push({
                    x: x + radius + radius * Math.cos(angle),
                    y: centerY + radius * Math.sin(angle)
                });
            }
            
            // Right semicircle
            for (let i = 0; i <= segments/2; i++) {
                const angle = (i / segments) * 2 * Math.PI;
                points.push({
                    x: x + width - radius + radius * Math.cos(angle),
                    y: centerY + radius * Math.sin(angle)
                });
            }
        } else {
            // Vertical obround
            const centerX = x + width / 2;
            
            // Top semicircle
            for (let i = 0; i <= segments/2; i++) {
                const angle = (i / segments) * 2 * Math.PI;
                points.push({
                    x: centerX + radius * Math.cos(angle),
                    y: y + height - radius + radius * Math.sin(angle)
                });
            }
            
            // Bottom semicircle
            for (let i = segments/2; i <= segments; i++) {
                const angle = (i / segments) * 2 * Math.PI;
                points.push({
                    x: centerX + radius * Math.cos(angle),
                    y: y + radius + radius * Math.sin(angle)
                });
            }
        }
        
        return new CopperPolygon(points, { shape: 'obround', width, height });
    }
    
    // Create a stroke polygon (rectangle with rounded caps)
    static createStroke(startPoint, endPoint, width) {
        const dx = endPoint.x - startPoint.x;
        const dy = endPoint.y - startPoint.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        
        if (length < 1e-10) {
            // Zero-length stroke becomes a circle
            return this.createCircle(startPoint.x, startPoint.y, width / 2);
        }
        
        // Unit vector along the stroke
        const ux = dx / length;
        const uy = dy / length;
        
        // Perpendicular unit vector
        const vx = -uy;
        const vy = ux;
        
        const halfWidth = width / 2;
        
        // Create rounded rectangle
        const points = [];
        const segments = 8; // Segments for each rounded end
        
        // Start cap (semicircle)
        for (let i = segments/2; i <= segments; i++) {
            const angle = (i / segments) * 2 * Math.PI;
            const cx = Math.cos(angle);
            const cy = Math.sin(angle);
            
            points.push({
                x: startPoint.x + halfWidth * (vx * cx + ux * cy),
                y: startPoint.y + halfWidth * (vy * cx + uy * cy)
            });
        }
        
        // End cap (semicircle)
        for (let i = 0; i <= segments/2; i++) {
            const angle = (i / segments) * 2 * Math.PI;
            const cx = Math.cos(angle);
            const cy = Math.sin(angle);
            
            points.push({
                x: endPoint.x + halfWidth * (vx * cx + ux * cy),
                y: endPoint.y + halfWidth * (vy * cx + uy * cy)
            });
        }
        
        return new CopperPolygon(points, { 
            shape: 'stroke', 
            width, 
            length,
            startPoint: { ...startPoint },
            endPoint: { ...endPoint }
        });
    }
}

// Polygon utilities
class PolygonUtils {
    static calculateBounds(polygons) {
        if (!Array.isArray(polygons) || polygons.length === 0) {
            return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        }
        
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        for (const polygon of polygons) {
            if (polygon && polygon.getBounds) {
                const bounds = polygon.getBounds();
                minX = Math.min(minX, bounds.minX);
                minY = Math.min(minY, bounds.minY);
                maxX = Math.max(maxX, bounds.maxX);
                maxY = Math.max(maxY, bounds.maxY);
            }
        }
        
        return isFinite(minX) ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
    
    static pointInPolygon(point, polygon) {
        if (!polygon || !polygon.points || polygon.points.length < 3) {
            return false;
        }
        
        let inside = false;
        const points = polygon.points;
        
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const xi = points[i].x;
            const yi = points[i].y;
            const xj = points[j].x;
            const yj = points[j].y;
            
            if (((yi > point.y) !== (yj > point.y)) && 
                (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        
        return inside;
    }
    
    // Simplify polygon using Douglas-Peucker algorithm
    static simplify(polygon, tolerance = 0.01) {
        if (!polygon.isValid() || polygon.points.length <= 3) {
            return polygon;
        }
        
        const simplified = this.douglasPeucker(polygon.points, tolerance);
        return new CopperPolygon(simplified, polygon.properties);
    }
    
    static douglasPeucker(points, tolerance) {
        if (points.length <= 2) return points;
        
        let maxDistance = 0;
        let maxIndex = 0;
        const first = points[0];
        const last = points[points.length - 1];
        
        for (let i = 1; i < points.length - 1; i++) {
            const distance = this.pointToLineDistance(points[i], first, last);
            if (distance > maxDistance) {
                maxDistance = distance;
                maxIndex = i;
            }
        }
        
        if (maxDistance > tolerance) {
            const left = this.douglasPeucker(points.slice(0, maxIndex + 1), tolerance);
            const right = this.douglasPeucker(points.slice(maxIndex), tolerance);
            return left.slice(0, -1).concat(right);
        } else {
            return [first, last];
        }
    }
    
    static pointToLineDistance(point, lineStart, lineEnd) {
        const A = point.x - lineStart.x;
        const B = point.y - lineStart.y;
        const C = lineEnd.x - lineStart.x;
        const D = lineEnd.y - lineStart.y;
        
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        
        if (lenSq === 0) return Math.sqrt(A * A + B * B);
        
        const param = dot / lenSq;
        
        let xx, yy;
        if (param < 0) {
            xx = lineStart.x;
            yy = lineStart.y;
        } else if (param > 1) {
            xx = lineEnd.x;
            yy = lineEnd.y;
        } else {
            xx = lineStart.x + param * C;
            yy = lineStart.y + param * D;
        }
        
        const dx = point.x - xx;
        const dy = point.y - yy;
        return Math.sqrt(dx * dx + dy * dy);
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CopperPolygon, PolygonFactory, PolygonUtils };
} else {
    window.CopperPolygon = CopperPolygon;
    window.PolygonFactory = PolygonFactory;
    window.PolygonUtils = PolygonUtils;
}