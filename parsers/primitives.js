// parsers/primitives.js
// Enhanced primitives with geometric context preservation for efficient processing

class RenderPrimitive {
    constructor(type, properties = {}) {
        this.type = type;
        this.properties = properties;
        this.bounds = null;
        
        // NEW: Preserve original geometric context
        this.geometricContext = {
            originalType: type, // 'circle', 'arc', 'rectangle', etc.
            isAnalytic: false,  // True for circles/arcs that can be offset analytically
            metadata: {}       // Store original parameters
        };
        
        this.creationInfo = {
            timestamp: Date.now(),
            source: 'primitive-factory'
        };
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
    
    getCenter() {
        const bounds = this.getBounds();
        return {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2
        };
    }
    
    // NEW: Check if this primitive can be offset analytically
    canOffsetAnalytically() {
        return this.geometricContext.isAnalytic;
    }
    
    // NEW: Get geometric metadata for reconstruction
    getGeometricMetadata() {
        return this.geometricContext;
    }
}

// Enhanced PathPrimitive with arc segment tracking
class PathPrimitive extends RenderPrimitive {
    constructor(points, properties = {}) {
        super('path', properties);
        
        this.points = points;
        this.closed = properties.closed !== false;
        
        // NEW: Track arc segments within the path
        this.arcSegments = properties.arcSegments || [];
        this.holes = properties.holes || [];
        
        // Update geometric context if this path contains arcs
        if (this.arcSegments.length > 0) {
            this.geometricContext.containsArcs = true;
            this.geometricContext.arcData = this.arcSegments;
        }
    }
    
    calculateBounds() {
        if (!this.points || this.points.length === 0) {
            this.bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
            return;
        }
        
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        // Calculate bounds from points
        this.points.forEach(point => {
            if (point !== null && point !== undefined) {
                minX = Math.min(minX, point.x);
                minY = Math.min(minY, point.y);
                maxX = Math.max(maxX, point.x);
                maxY = Math.max(maxY, point.y);
            }
        });
        
        // Include holes in bounds
        if (this.holes && this.holes.length > 0) {
            this.holes.forEach(hole => {
                if (Array.isArray(hole)) {
                    hole.forEach(point => {
                        if (point !== null && point !== undefined) {
                            minX = Math.min(minX, point.x);
                            minY = Math.min(minY, point.y);
                            maxX = Math.max(maxX, point.x);
                            maxY = Math.max(maxY, point.y);
                        }
                    });
                }
            });
        }
        
        // Expand bounds by stroke width if stroked
        if (this.properties.stroke && this.properties.strokeWidth) {
            const halfStroke = this.properties.strokeWidth / 2;
            minX -= halfStroke;
            minY -= halfStroke;
            maxX += halfStroke;
            maxY += halfStroke;
        }
        
        this.bounds = { minX, minY, maxX, maxY };
    }
    
    // NEW: Add arc segment to path
    addArcSegment(startIndex, endIndex, center, radius, startAngle, endAngle, clockwise) {
        this.arcSegments.push({
            startIndex,
            endIndex,
            center,
            radius,
            startAngle,
            endAngle,
            clockwise
        });
        this.geometricContext.containsArcs = true;
    }
}

// Enhanced CirclePrimitive with analytic offset capability
class CirclePrimitive extends RenderPrimitive {
    constructor(center, radius, properties = {}) {
        super('circle', properties);
        this.center = center;
        this.radius = radius;
        
        // Mark as analytically offsettable
        this.geometricContext.isAnalytic = true;
        this.geometricContext.metadata = {
            center: { ...center },
            radius: radius
        };
    }
    
    calculateBounds() {
        let effectiveRadius = this.radius;
        if (this.properties.strokeWidth && this.properties.stroke) {
            effectiveRadius += this.properties.strokeWidth / 2;
        }
        
        this.bounds = {
            minX: this.center.x - effectiveRadius,
            minY: this.center.y - effectiveRadius,
            maxX: this.center.x + effectiveRadius,
            maxY: this.center.y + effectiveRadius
        };
    }
    
    getCenter() {
        return { x: this.center.x, y: this.center.y };
    }
    
    // NEW: Analytic offset for circles
    getOffsetGeometry(offsetDistance) {
        return new CirclePrimitive(
            this.center,
            Math.max(0, this.radius + offsetDistance),
            { ...this.properties }
        );
    }
    
    // NEW: Convert to polygon with adaptive segmentation
    toPolygon(minSegments = 16, maxSegments = 128) {
        // Adaptive segmentation based on radius
        // More segments for larger circles, fewer for tiny ones
        const circumference = 2 * Math.PI * this.radius;
        const segmentLength = 0.1; // Target segment length in mm
        const desiredSegments = Math.ceil(circumference / segmentLength);
        const segments = Math.max(minSegments, Math.min(maxSegments, desiredSegments));
        
        const points = [];
        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * 2 * Math.PI;
            points.push({
                x: this.center.x + this.radius * Math.cos(angle),
                y: this.center.y + this.radius * Math.sin(angle)
            });
        }
        
        return new PathPrimitive(points, {
            ...this.properties,
            closed: true,
            originalCircle: {
                center: { ...this.center },
                radius: this.radius
            }
        });
    }
}

class RectanglePrimitive extends RenderPrimitive {
    constructor(position, width, height, properties = {}) {
        super('rectangle', properties);
        this.position = position;
        this.width = width;
        this.height = height;
        
        // Rectangles can be offset analytically
        this.geometricContext.isAnalytic = true;
        this.geometricContext.metadata = {
            position: { ...position },
            width: width,
            height: height
        };
    }
    
    calculateBounds() {
        let minX = this.position.x;
        let minY = this.position.y;
        let maxX = this.position.x + this.width;
        let maxY = this.position.y + this.height;
        
        if (this.properties.strokeWidth && this.properties.stroke) {
            const halfStroke = this.properties.strokeWidth / 2;
            minX -= halfStroke;
            minY -= halfStroke;
            maxX += halfStroke;
            maxY += halfStroke;
        }
        
        this.bounds = { minX, minY, maxX, maxY };
    }
    
    toPolygon() {
        const points = [
            { x: this.position.x, y: this.position.y },
            { x: this.position.x + this.width, y: this.position.y },
            { x: this.position.x + this.width, y: this.position.y + this.height },
            { x: this.position.x, y: this.position.y + this.height }
        ];
        
        return new PathPrimitive(points, {
            ...this.properties,
            closed: true,
            originalRectangle: {
                position: { ...this.position },
                width: this.width,
                height: this.height
            }
        });
    }
}

// Enhanced ObroundPrimitive with arc preservation
class ObroundPrimitive extends RenderPrimitive {
    constructor(position, width, height, properties = {}) {
        super('obround', properties);
        this.position = position;
        this.width = width;
        this.height = height;
        
        // Obrounds have analytical properties (straight sides + semicircular ends)
        this.geometricContext.isAnalytic = true;
        this.geometricContext.metadata = {
            position: { ...position },
            width: width,
            height: height,
            cornerRadius: Math.min(width, height) / 2
        };
    }
    
    calculateBounds() {
        let minX = this.position.x;
        let minY = this.position.y;
        let maxX = this.position.x + this.width;
        let maxY = this.position.y + this.height;
        
        if (this.properties.strokeWidth && this.properties.stroke) {
            const halfStroke = this.properties.strokeWidth / 2;
            minX -= halfStroke;
            minY -= halfStroke;
            maxX += halfStroke;
            maxY += halfStroke;
        }
        
        this.bounds = { minX, minY, maxX, maxY };
    }
    
    // NEW: Convert to polygon with arc segment tracking
    toPolygon(segmentsPerArc = 16) {
        const points = [];
        const arcSegments = [];
        const r = Math.min(this.width, this.height) / 2;
        
        if (this.width > this.height) {
            // Horizontal obround
            const leftCenter = { x: this.position.x + r, y: this.position.y + r };
            const rightCenter = { x: this.position.x + this.width - r, y: this.position.y + r };
            
            // Right semicircle
            const rightStartIdx = points.length;
            for (let i = 0; i <= segmentsPerArc / 2; i++) {
                const angle = -Math.PI / 2 + (i / (segmentsPerArc / 2)) * Math.PI;
                points.push({
                    x: rightCenter.x + r * Math.cos(angle),
                    y: rightCenter.y + r * Math.sin(angle)
                });
            }
            arcSegments.push({
                startIndex: rightStartIdx,
                endIndex: points.length - 1,
                center: rightCenter,
                radius: r,
                startAngle: -Math.PI / 2,
                endAngle: Math.PI / 2,
                clockwise: true
            });
            
            // Left semicircle
            const leftStartIdx = points.length;
            for (let i = 0; i <= segmentsPerArc / 2; i++) {
                const angle = Math.PI / 2 + (i / (segmentsPerArc / 2)) * Math.PI;
                points.push({
                    x: leftCenter.x + r * Math.cos(angle),
                    y: leftCenter.y + r * Math.sin(angle)
                });
            }
            arcSegments.push({
                startIndex: leftStartIdx,
                endIndex: points.length - 1,
                center: leftCenter,
                radius: r,
                startAngle: Math.PI / 2,
                endAngle: 3 * Math.PI / 2,
                clockwise: true
            });
        } else {
            // Vertical obround - similar logic
            const topCenter = { x: this.position.x + r, y: this.position.y + this.height - r };
            const bottomCenter = { x: this.position.x + r, y: this.position.y + r };
            
            // Top semicircle
            const topStartIdx = points.length;
            for (let i = 0; i <= segmentsPerArc / 2; i++) {
                const angle = (i / (segmentsPerArc / 2)) * Math.PI;
                points.push({
                    x: topCenter.x + r * Math.cos(angle),
                    y: topCenter.y + r * Math.sin(angle)
                });
            }
            arcSegments.push({
                startIndex: topStartIdx,
                endIndex: points.length - 1,
                center: topCenter,
                radius: r,
                startAngle: 0,
                endAngle: Math.PI,
                clockwise: true
            });
            
            // Bottom semicircle
            const bottomStartIdx = points.length;
            for (let i = 0; i <= segmentsPerArc / 2; i++) {
                const angle = Math.PI + (i / (segmentsPerArc / 2)) * Math.PI;
                points.push({
                    x: bottomCenter.x + r * Math.cos(angle),
                    y: bottomCenter.y + r * Math.sin(angle)
                });
            }
            arcSegments.push({
                startIndex: bottomStartIdx,
                endIndex: points.length - 1,
                center: bottomCenter,
                radius: r,
                startAngle: Math.PI,
                endAngle: 2 * Math.PI,
                clockwise: true
            });
        }
        
        return new PathPrimitive(points, {
            ...this.properties,
            closed: true,
            arcSegments: arcSegments,
            originalObround: {
                position: { ...this.position },
                width: this.width,
                height: this.height
            }
        });
    }
}

// NEW: Enhanced ArcPrimitive for better arc handling
class ArcPrimitive extends RenderPrimitive {
    constructor(center, radius, startAngle, endAngle, clockwise, properties = {}) {
        super('arc', properties);
        this.center = center;
        this.radius = radius;
        this.startAngle = startAngle;
        this.endAngle = endAngle;
        this.clockwise = clockwise;
        
        // Arcs can be offset analytically
        this.geometricContext.isAnalytic = true;
        this.geometricContext.metadata = {
            center: { ...center },
            radius: radius,
            startAngle: startAngle,
            endAngle: endAngle,
            clockwise: clockwise
        };
        
        // Calculate start and end points
        this.startPoint = {
            x: center.x + radius * Math.cos(startAngle),
            y: center.y + radius * Math.sin(startAngle)
        };
        this.endPoint = {
            x: center.x + radius * Math.cos(endAngle),
            y: center.y + radius * Math.sin(endAngle)
        };
    }
    
    calculateBounds() {
        let minX = Math.min(this.startPoint.x, this.endPoint.x);
        let minY = Math.min(this.startPoint.y, this.endPoint.y);
        let maxX = Math.max(this.startPoint.x, this.endPoint.x);
        let maxY = Math.max(this.startPoint.y, this.endPoint.y);
        
        // Check if arc crosses cardinal directions
        const crosses = this.getCardinalCrossings();
        let effectiveRadius = this.radius;
        
        if (this.properties.strokeWidth && this.properties.stroke) {
            effectiveRadius += this.properties.strokeWidth / 2;
        }
        
        if (crosses.right) maxX = Math.max(maxX, this.center.x + effectiveRadius);
        if (crosses.top) maxY = Math.max(maxY, this.center.y + effectiveRadius);
        if (crosses.left) minX = Math.min(minX, this.center.x - effectiveRadius);
        if (crosses.bottom) minY = Math.min(minY, this.center.y - effectiveRadius);
        
        this.bounds = { minX, minY, maxX, maxY };
    }
    
    getCardinalCrossings() {
        const normalize = angle => {
            while (angle < 0) angle += 2 * Math.PI;
            while (angle > 2 * Math.PI) angle -= 2 * Math.PI;
            return angle;
        };
        
        const start = normalize(this.startAngle);
        const end = normalize(this.endAngle);
        
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
        
        for (const [dir, angle] of Object.entries(cardinals)) {
            if (this.clockwise) {
                if (start > end) {
                    crosses[dir] = angle >= start || angle <= end;
                } else {
                    crosses[dir] = angle >= start && angle <= end;
                }
            } else {
                if (start < end) {
                    crosses[dir] = angle >= start && angle <= end;
                } else {
                    crosses[dir] = angle <= start || angle >= end;
                }
            }
        }
        
        return crosses;
    }
    
    // NEW: Analytic offset for arcs
    getOffsetGeometry(offsetDistance) {
        return new ArcPrimitive(
            this.center,
            Math.max(0, this.radius + offsetDistance),
            this.startAngle,
            this.endAngle,
            this.clockwise,
            { ...this.properties }
        );
    }
    
    // Convert to points with adaptive segmentation
    toPolygon(minSegments = 8, maxSegments = 64) {
        let angleSpan = this.endAngle - this.startAngle;
        if (this.clockwise) {
            if (angleSpan > 0) angleSpan -= 2 * Math.PI;
        } else {
            if (angleSpan < 0) angleSpan += 2 * Math.PI;
        }
        
        const arcLength = Math.abs(angleSpan) * this.radius;
        const segmentLength = 0.1; // Target segment length in mm
        const desiredSegments = Math.ceil(arcLength / segmentLength);
        const segments = Math.max(minSegments, Math.min(maxSegments, desiredSegments));
        
        const points = [];
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const angle = this.startAngle + angleSpan * t;
            points.push({
                x: this.center.x + this.radius * Math.cos(angle),
                y: this.center.y + this.radius * Math.sin(angle)
            });
        }
        
        return new PathPrimitive(points, {
            ...this.properties,
            closed: false,
            arcSegments: [{
                startIndex: 0,
                endIndex: points.length - 1,
                center: this.center,
                radius: this.radius,
                startAngle: this.startAngle,
                endAngle: this.endAngle,
                clockwise: this.clockwise
            }]
        });
    }
}

// Enhanced Factory with geometric preservation
class PrimitiveFactory {
    /**
     * Create efficient circle with metadata
     */
    static createCircle(center, radius, properties = {}) {
        return new CirclePrimitive(center, radius, properties);
    }
    
    /**
     * Create arc with full geometric context
     */
    static createArc(center, radius, startAngle, endAngle, clockwise, properties = {}) {
        return new ArcPrimitive(center, radius, startAngle, endAngle, clockwise, properties);
    }
    
    /**
     * Create stroke as rounded rectangle with arc tracking
     */
    static createStroke(start, end, width, properties = {}) {
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
        
        // For strokes, create an obround-like shape with tracked arcs
        const angle = Math.atan2(dy, dx);
        const perpAngle = angle + Math.PI / 2;
        const halfWidth = width / 2;
        
        // Calculate obround position (bottom-left corner)
        const position = {
            x: start.x - halfWidth * Math.cos(perpAngle),
            y: start.y - halfWidth * Math.sin(perpAngle)
        };
        
        // Create as a specialized obround
        const obround = new ObroundPrimitive(
            position,
            length + width,
            width,
            {
                ...properties,
                isStroke: true,
                originalStroke: {
                    start: { ...start },
                    end: { ...end },
                    width: width
                },
                rotation: angle // Store rotation for proper reconstruction
            }
        );
        
        return obround;
    }
    
    /**
     * Create polygon with preserved vertices count
     */
    static createPolygon(center, diameter, sides, rotation = 0, properties = {}) {
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
            isPolygon: true,
            originalPolygon: {
                center: { ...center },
                diameter: diameter,
                sides: sides,
                rotation: rotation
            }
        });
    }
}

// NEW: Geometry optimization utilities
class GeometryOptimizer {
    /**
     * Adaptive segmentation based on size and precision requirements
     */
    static getOptimalSegments(radius, minSegments = 8, maxSegments = 128, targetSegmentLength = 0.1) {
        const circumference = 2 * Math.PI * radius;
        const desiredSegments = Math.ceil(circumference / targetSegmentLength);
        return Math.max(minSegments, Math.min(maxSegments, desiredSegments));
    }
    
    /**
     * Check if a primitive should be kept as analytic for offset
     */
    static shouldPreserveAnalytic(primitive, offsetDistance) {
        // Keep circles and arcs analytic if they remain valid after offset
        if (primitive.type === 'circle') {
            return (primitive.radius + offsetDistance) > 0;
        }
        if (primitive.type === 'arc') {
            return (primitive.radius + offsetDistance) > 0;
        }
        return false;
    }
    
    /**
     * Convert primitive to optimal polygon representation
     */
    static toOptimalPolygon(primitive) {
        if (primitive.type === 'circle') {
            const segments = this.getOptimalSegments(primitive.radius);
            return primitive.toPolygon(Math.min(16, segments), segments);
        }
        if (primitive.type === 'arc') {
            const arcLength = Math.abs(primitive.endAngle - primitive.startAngle) * primitive.radius;
            const segments = Math.ceil(arcLength / 0.1);
            return primitive.toPolygon(Math.min(8, segments), segments);
        }
        if (primitive.type === 'rectangle') {
            return primitive.toPolygon();
        }
        if (primitive.type === 'obround') {
            const r = Math.min(primitive.width, primitive.height) / 2;
            const segments = this.getOptimalSegments(r, 8, 32);
            return primitive.toPolygon(segments);
        }
        return primitive;
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
        PrimitiveFactory,
        GeometryOptimizer
    };
} else {
    window.RenderPrimitive = RenderPrimitive;
    window.PathPrimitive = PathPrimitive;
    window.CirclePrimitive = CirclePrimitive;
    window.RectanglePrimitive = RectanglePrimitive;
    window.ObroundPrimitive = ObroundPrimitive;
    window.ArcPrimitive = ArcPrimitive;
    window.PrimitiveFactory = PrimitiveFactory;
    window.GeometryOptimizer = GeometryOptimizer;
}