// Render Primitives - Enhanced for new stroke system and debug options
// plotter/render-primitives.js

class RenderPrimitive {
    constructor(type, properties = {}) {
        this.type = type;
        this.properties = properties;
        this.bounds = null;
    }
    
    getBounds() {
        if (!this.bounds) {
            this.calculateBounds();
        }
        return this.bounds;
    }
    
    calculateBounds() {
        // Override in subclasses
        this.bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
}

class PathPrimitive extends RenderPrimitive {
    constructor(points, properties = {}) {
        super('path', properties);
        this.points = points;
        this.closed = properties.closed !== false;
    }
    
    calculateBounds() {
        if (this.points.length === 0) {
            this.bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
            return;
        }
        
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        this.points.forEach(point => {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        });
        
        // For stroke primitives, bounds already include the stroke width
        // For other primitives, add stroke width if present
        if (!this.properties.isStroke && this.properties.strokeWidth) {
            const halfStroke = this.properties.strokeWidth / 2;
            minX -= halfStroke;
            minY -= halfStroke;
            maxX += halfStroke;
            maxY += halfStroke;
        }
        
        this.bounds = { minX, minY, maxX, maxY };
    }
}

class CirclePrimitive extends RenderPrimitive {
    constructor(center, radius, properties = {}) {
        super('circle', properties);
        this.center = center;
        this.radius = radius;
    }
    
    calculateBounds() {
        // For drill holes, add stroke width to bounds
        let effectiveRadius = this.radius;
        if (this.properties.isDrillHole && this.properties.strokeWidth) {
            effectiveRadius += this.properties.strokeWidth / 2;
        }
        
        this.bounds = {
            minX: this.center.x - effectiveRadius,
            minY: this.center.y - effectiveRadius,
            maxX: this.center.x + effectiveRadius,
            maxY: this.center.y + effectiveRadius
        };
    }
}

class RectanglePrimitive extends RenderPrimitive {
    constructor(position, width, height, properties = {}) {
        super('rectangle', properties);
        this.position = position; // Bottom-left corner
        this.width = width;
        this.height = height;
    }
    
    calculateBounds() {
        let minX = this.position.x;
        let minY = this.position.y;
        let maxX = this.position.x + this.width;
        let maxY = this.position.y + this.height;
        
        // Add stroke width if present
        if (this.properties.strokeWidth && this.properties.stroke) {
            const halfStroke = this.properties.strokeWidth / 2;
            minX -= halfStroke;
            minY -= halfStroke;
            maxX += halfStroke;
            maxY += halfStroke;
        }
        
        this.bounds = { minX, minY, maxX, maxY };
    }
}

class ObroundPrimitive extends RenderPrimitive {
    constructor(position, width, height, properties = {}) {
        super('obround', properties);
        this.position = position; // Bottom-left corner
        this.width = width;
        this.height = height;
    }
    
    calculateBounds() {
        let minX = this.position.x;
        let minY = this.position.y;
        let maxX = this.position.x + this.width;
        let maxY = this.position.y + this.height;
        
        // Add stroke width if present
        if (this.properties.strokeWidth && this.properties.stroke) {
            const halfStroke = this.properties.strokeWidth / 2;
            minX -= halfStroke;
            minY -= halfStroke;
            maxX += halfStroke;
            maxY += halfStroke;
        }
        
        this.bounds = { minX, minY, maxX, maxY };
    }
}

class ArcPrimitive extends RenderPrimitive {
    constructor(start, end, center, clockwise, properties = {}) {
        super('arc', properties);
        this.start = start;
        this.end = end;
        this.center = center;
        this.clockwise = clockwise;
    }
    
    calculateBounds() {
        // Calculate radius
        const radius = Math.sqrt(
            Math.pow(this.start.x - this.center.x, 2) +
            Math.pow(this.start.y - this.center.y, 2)
        );
        
        // Add stroke width if applicable
        let effectiveRadius = radius;
        if (this.properties.strokeWidth && this.properties.stroke) {
            effectiveRadius += this.properties.strokeWidth / 2;
        }
        
        // Start with endpoints
        let minX = Math.min(this.start.x, this.end.x);
        let minY = Math.min(this.start.y, this.end.y);
        let maxX = Math.max(this.start.x, this.end.x);
        let maxY = Math.max(this.start.y, this.end.y);
        
        // Calculate start and end angles
        const startAngle = Math.atan2(
            this.start.y - this.center.y,
            this.start.x - this.center.x
        );
        const endAngle = Math.atan2(
            this.end.y - this.center.y,
            this.end.x - this.center.x
        );
        
        // Check if arc crosses cardinal directions
        const crosses = this.getCardinalCrossings(startAngle, endAngle, this.clockwise);
        
        // Include extrema if crossed
        if (crosses.right) maxX = Math.max(maxX, this.center.x + effectiveRadius);
        if (crosses.top) maxY = Math.max(maxY, this.center.y + effectiveRadius);
        if (crosses.left) minX = Math.min(minX, this.center.x - effectiveRadius);
        if (crosses.bottom) minY = Math.min(minY, this.center.y - effectiveRadius);
        
        this.bounds = { minX, minY, maxX, maxY };
    }
    
    getCardinalCrossings(startAngle, endAngle, clockwise) {
        // Normalize angles to 0-2π
        const normalize = angle => {
            while (angle < 0) angle += 2 * Math.PI;
            while (angle > 2 * Math.PI) angle -= 2 * Math.PI;
            return angle;
        };
        
        const start = normalize(startAngle);
        const end = normalize(endAngle);
        
        // Cardinal direction angles
        const cardinals = {
            right: 0,
            top: Math.PI / 2,
            left: Math.PI,
            bottom: 3 * Math.PI / 2
        };
        
        const crosses = {
            right: false,
            top: false,
            left: false,
            bottom: false
        };
        
        // Check each cardinal
        for (const [dir, angle] of Object.entries(cardinals)) {
            if (clockwise) {
                if (start > end) {
                    crosses[dir] = angle >= start || angle <= end;
                } else {
                    crosses[dir] = angle >= start && angle <= end;
                }
            } else {
                if (start < end) {
                    crosses[dir] = angle <= start || angle >= end;
                } else {
                    crosses[dir] = angle <= start && angle >= end;
                }
            }
        }
        
        return crosses;
    }
}

class CompositePrimitive extends RenderPrimitive {
    constructor(primitives, properties = {}) {
        super('composite', properties);
        this.primitives = primitives;
    }
    
    calculateBounds() {
        if (this.primitives.length === 0) {
            this.bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
            return;
        }
        
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        this.primitives.forEach(primitive => {
            const bounds = primitive.getBounds();
            minX = Math.min(minX, bounds.minX);
            minY = Math.min(minY, bounds.minY);
            maxX = Math.max(maxX, bounds.maxX);
            maxY = Math.max(maxY, bounds.maxY);
        });
        
        this.bounds = { minX, minY, maxX, maxY };
    }
}

// Factory for creating primitives
class PrimitiveFactory {
    static createStroke(start, end, width, properties = {}) {
        // Create a stroke as a path with proper end caps
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        
        if (length < 0.001) {
            // Zero-length stroke becomes a circle
            return new CirclePrimitive(start, width / 2, {
                ...properties,
                isStroke: true,
                originalWidth: width
            });
        }
        
        // Unit vectors
        const ux = dx / length;
        const uy = dy / length;
        const vx = -uy;
        const vy = ux;
        
        const halfWidth = width / 2;
        const points = [];
        
        // Create rounded rectangle path with proper geometry
        const segments = Math.max(6, Math.floor(width * 4)); // More segments for wider traces
        
        // Start cap (semicircle)
        for (let i = segments / 2; i <= segments; i++) {
            const angle = (i / segments) * 2 * Math.PI;
            const cx = Math.cos(angle);
            const cy = Math.sin(angle);
            points.push({
                x: start.x + halfWidth * (vx * cx + ux * cy),
                y: start.y + halfWidth * (vy * cx + uy * cy)
            });
        }
        
        // End cap (semicircle)
        for (let i = 0; i <= segments / 2; i++) {
            const angle = (i / segments) * 2 * Math.PI;
            const cx = Math.cos(angle);
            const cy = Math.sin(angle);
            points.push({
                x: end.x + halfWidth * (vx * cx + ux * cy),
                y: end.y + halfWidth * (vy * cx + uy * cy)
            });
        }
        
        return new PathPrimitive(points, { 
            ...properties, 
            closed: true,
            isStroke: true,
            originalWidth: width
        });
    }
    
    static createPolygonAperture(center, diameter, sides, rotation = 0, properties = {}) {
        const points = [];
        const radius = diameter / 2;
        
        for (let i = 0; i <= sides; i++) {
            const angle = (i / sides) * 2 * Math.PI + rotation;
            points.push({
                x: center.x + radius * Math.cos(angle),
                y: center.y + radius * Math.sin(angle)
            });
        }
        
        return new PathPrimitive(points, { 
            ...properties, 
            closed: true,
            isPolygon: true
        });
    }
    
    // Helper method to create outline version of a stroke primitive
    static createStrokeOutline(start, end, width, properties = {}) {
        // Create a thin outline that follows the centerline of the original stroke
        const outlineProperties = {
            ...properties,
            fill: false,
            stroke: true,
            strokeWidth: Math.max(0.05, width * 0.1), // Thin outline, minimum 0.05mm
            isStrokeOutline: true,
            originalWidth: width
        };
        
        // Simple line for outline
        return new PathPrimitive([start, end], {
            ...outlineProperties,
            closed: false
        });
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        RenderPrimitive,
        PathPrimitive,
        CirclePrimitive,
        RectanglePrimitive,
        ObroundPrimitive,
        ArcPrimitive,
        CompositePrimitive,
        PrimitiveFactory
    };
} else {
    window.RenderPrimitive = RenderPrimitive;
    window.PathPrimitive = PathPrimitive;
    window.CirclePrimitive = CirclePrimitive;
    window.RectanglePrimitive = RectanglePrimitive;
    window.ObroundPrimitive = ObroundPrimitive;
    window.ArcPrimitive = ArcPrimitive;
    window.CompositePrimitive = CompositePrimitive;
    window.PrimitiveFactory = PrimitiveFactory;
}