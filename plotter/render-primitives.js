// Render Primitives - FIXED: Simplified coordinate handling, no automatic transformation
// plotter/render-primitives.js

class RenderPrimitive {
    constructor(type, properties = {}) {
        this.type = type;
        this.properties = properties;
        this.bounds = null;
        
        // SIMPLIFIED: Remove complex coordinate system tracking
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
    
    /**
     * Get the center point of this primitive
     */
    getCenter() {
        const bounds = this.getBounds();
        return {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2
        };
    }
    
    /**
     * FIXED: Simplified transformation tracking - always return false since no auto-transform
     */
    wasTransformedDuringCreation() {
        return false; // FIXED: Primitives are never transformed during creation
    }
    
    /**
     * Get debug information about this primitive
     */
    getDebugInfo() {
        return {
            type: this.type,
            bounds: this.getBounds(),
            center: this.getCenter(),
            creationInfo: this.creationInfo,
            transformedDuringCreation: false, // FIXED: Always false
            properties: Object.keys(this.properties)
        };
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
    
    /**
     * Get center point for path primitives
     */
    getCenter() {
        if (this.points.length === 0) {
            return { x: 0, y: 0 };
        }
        
        // For paths, calculate centroid
        let totalX = 0, totalY = 0;
        this.points.forEach(point => {
            totalX += point.x;
            totalY += point.y;
        });
        
        return {
            x: totalX / this.points.length,
            y: totalY / this.points.length
        };
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
    
    /**
     * Get center point for circle primitives
     */
    getCenter() {
        return { x: this.center.x, y: this.center.y };
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
    
    /**
     * Get center point for rectangle primitives
     */
    getCenter() {
        return {
            x: this.position.x + this.width / 2,
            y: this.position.y + this.height / 2
        };
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
    
    /**
     * Get center point for obround primitives
     */
    getCenter() {
        return {
            x: this.position.x + this.width / 2,
            y: this.position.y + this.height / 2
        };
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
    
    /**
     * Get center point for arc primitives
     */
    getCenter() {
        return { x: this.center.x, y: this.center.y };
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
    
    /**
     * Get center point for composite primitives
     */
    getCenter() {
        const bounds = this.getBounds();
        return {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2
        };
    }
}

// FIXED: Factory for creating primitives without coordinate system transformation
class PrimitiveFactory {
    /**
     * FIXED: Create stroke with original coordinates only
     */
    static createStroke(start, end, width, properties = {}) {
        // FIXED: Enhanced logging for debugging coordinate issues - but no transformation
        if (window.cam?.debugMode) {
            console.log(`[PrimitiveFactory-FIXED] Creating stroke from (${start.x.toFixed(3)}, ${start.y.toFixed(3)}) to (${end.x.toFixed(3)}, ${end.y.toFixed(3)}) width=${width.toFixed(3)} - ORIGINAL coordinates`);
        }
        
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
        
        const primitive = new PathPrimitive(points, { 
            ...properties, 
            closed: true,
            isStroke: true,
            originalWidth: width
        });
        
        if (window.cam?.debugMode) {
            const bounds = primitive.getBounds();
            console.log(`[PrimitiveFactory-FIXED] Created stroke primitive with ORIGINAL bounds: (${bounds.minX.toFixed(3)}, ${bounds.minY.toFixed(3)}) to (${bounds.maxX.toFixed(3)}, ${bounds.maxY.toFixed(3)})`);
        }
        
        return primitive;
    }
    
    /**
     * FIXED: Create polygon aperture with original coordinates only
     */
    static createPolygonAperture(center, diameter, sides, rotation = 0, properties = {}) {
        if (window.cam?.debugMode) {
            console.log(`[PrimitiveFactory-FIXED] Creating polygon aperture at (${center.x.toFixed(3)}, ${center.y.toFixed(3)}) ⌀${diameter.toFixed(3)} ${sides} sides - ORIGINAL coordinates`);
        }
        
        const points = [];
        const radius = diameter / 2;
        
        for (let i = 0; i <= sides; i++) {
            const angle = (i / sides) * 2 * Math.PI + rotation;
            points.push({
                x: center.x + radius * Math.cos(angle),
                y: center.y + radius * Math.sin(angle)
            });
        }
        
        const primitive = new PathPrimitive(points, { 
            ...properties, 
            closed: true,
            isPolygon: true
        });
        
        if (window.cam?.debugMode) {
            const bounds = primitive.getBounds();
            console.log(`[PrimitiveFactory-FIXED] Created polygon primitive with ORIGINAL bounds: (${bounds.minX.toFixed(3)}, ${bounds.minY.toFixed(3)}) to (${bounds.maxX.toFixed(3)}, ${bounds.maxY.toFixed(3)})`);
        }
        
        return primitive;
    }
    
    /**
     * FIXED: Helper method to create outline version of a stroke primitive
     */
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
    
    /**
     * FIXED: Create primitive with original coordinates - NO transformation
     */
    static createWithOriginalCoordinates(primitiveType, ...args) {
        // Create primitive based on type - all with original coordinates
        switch (primitiveType) {
            case 'stroke':
                return this.createStroke(...args);
            case 'polygon':
                return this.createPolygonAperture(...args);
            case 'circle':
                return new CirclePrimitive(...args);
            case 'rectangle':
                return new RectanglePrimitive(...args);
            case 'obround':
                return new ObroundPrimitive(...args);
            case 'path':
                return new PathPrimitive(...args);
            default:
                console.warn(`[PrimitiveFactory-FIXED] Unknown primitive type: ${primitiveType}`);
                return null;
        }
    }
}

/**
 * FIXED: Coordinate validation utilities - no transformation, just validation
 */
class PrimitiveValidator {
    /**
     * Validate primitive coordinates against expected ranges
     */
    static validateCoordinates(primitive, expectedBounds = null) {
        const bounds = primitive.getBounds();
        const center = primitive.getCenter();
        
        const validation = {
            valid: true,
            warnings: [],
            errors: [],
            info: {
                type: primitive.type,
                bounds: bounds,
                center: center,
                transformed: false // FIXED: Always false since no auto-transformation
            }
        };
        
        // Check for invalid coordinates
        if (!isFinite(bounds.minX) || !isFinite(bounds.minY) || 
            !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
            validation.valid = false;
            validation.errors.push('Invalid bounds - contains non-finite values');
        }
        
        // Check for extremely large coordinates (indicates untransformed)
        const maxCoord = 1000; // mm - reasonable PCB size limit
        if (Math.abs(bounds.minX) > maxCoord || Math.abs(bounds.minY) > maxCoord ||
            Math.abs(bounds.maxX) > maxCoord || Math.abs(bounds.maxY) > maxCoord) {
            validation.warnings.push(`Large coordinates detected - coordinates exceed ±${maxCoord}mm (bounds: ${bounds.minX.toFixed(1)}, ${bounds.minY.toFixed(1)} to ${bounds.maxX.toFixed(1)}, ${bounds.maxY.toFixed(1)})`);
        }
        
        // Check against expected bounds if provided
        if (expectedBounds) {
            const margin = Math.max(expectedBounds.width, expectedBounds.height) * 0.1;
            
            if (bounds.maxX < expectedBounds.minX - margin || 
                bounds.minX > expectedBounds.maxX + margin ||
                bounds.maxY < expectedBounds.minY - margin || 
                bounds.minY > expectedBounds.maxY + margin) {
                validation.warnings.push('Primitive appears to be outside expected board area');
            }
        }
        
        return validation;
    }
    
    /**
     * Analyze a collection of primitives for coordinate consistency
     */
    static analyzePrimitiveCollection(primitives) {
        const analysis = {
            totalPrimitives: primitives.length,
            byType: {},
            coordinateRanges: {},
            transformationStatus: {
                transformed: 0,
                untransformed: primitives.length, // FIXED: All are untransformed
                unknown: 0
            },
            potentialIssues: []
        };
        
        primitives.forEach(primitive => {
            const type = primitive.type;
            const bounds = primitive.getBounds();
            
            // Count by type
            analysis.byType[type] = (analysis.byType[type] || 0) + 1;
            
            // Track coordinate ranges by type
            if (!analysis.coordinateRanges[type]) {
                analysis.coordinateRanges[type] = {
                    minX: bounds.minX, minY: bounds.minY,
                    maxX: bounds.maxX, maxY: bounds.maxY,
                    count: 0
                };
            } else {
                const range = analysis.coordinateRanges[type];
                range.minX = Math.min(range.minX, bounds.minX);
                range.minY = Math.min(range.minY, bounds.minY);
                range.maxX = Math.max(range.maxX, bounds.maxX);
                range.maxY = Math.max(range.maxY, bounds.maxY);
            }
            analysis.coordinateRanges[type].count++;
        });
        
        // FIXED: Since no auto-transformation, check for coordinate alignment issues
        const typeRanges = Object.entries(analysis.coordinateRanges);
        for (let i = 0; i < typeRanges.length; i++) {
            for (let j = i + 1; j < typeRanges.length; j++) {
                const [type1, range1] = typeRanges[i];
                const [type2, range2] = typeRanges[j];
                
                // Check if ranges are suspiciously far apart
                const distance = Math.sqrt(
                    Math.pow((range1.minX + range1.maxX) / 2 - (range2.minX + range2.maxX) / 2, 2) +
                    Math.pow((range1.minY + range1.maxY) / 2 - (range2.minY + range2.maxY) / 2, 2)
                );
                
                if (distance > 100) { // 100mm separation indicates potential issue
                    analysis.potentialIssues.push({
                        type: 'coordinate_separation',
                        message: `${type1} and ${type2} primitives appear to be in different coordinate systems (${distance.toFixed(1)}mm apart)`,
                        types: [type1, type2],
                        distance: distance
                    });
                }
            }
        }
        
        return analysis;
    }
}

/**
 * FIXED: Debug utilities for primitive analysis - no transformation
 */
window.analyzePrimitiveCoordinates = function() {
    if (!window.cam?.operations) {
        console.log('❌ No operations loaded');
        return;
    }
    
    console.log('🔍 FIXED: PRIMITIVE COORDINATE ANALYSIS - NO AUTO-TRANSFORMATION');
    console.log('==================================================================');
    
    const allPrimitives = [];
    
    window.cam.operations.forEach((operation, opIndex) => {
        if (!operation.primitives) return;
        
        console.log(`\n📄 Operation ${opIndex + 1}: ${operation.type.toUpperCase()} - ${operation.file.name}`);
        
        const analysis = PrimitiveValidator.analyzePrimitiveCollection(operation.primitives);
        console.log(`   📊 ${analysis.totalPrimitives} primitives:`, analysis.byType);
        console.log(`   🔄 Transformation status: ALL ORIGINAL (no auto-transformation)`);
        
        if (analysis.potentialIssues.length > 0) {
            console.log(`   ⚠️  Potential issues:`);
            analysis.potentialIssues.forEach(issue => {
                console.log(`     • ${issue.message}`);
            });
        }
        
        // Show coordinate ranges
        Object.entries(analysis.coordinateRanges).forEach(([type, range]) => {
            console.log(`   📍 ${type}: (${range.minX.toFixed(1)}, ${range.minY.toFixed(1)}) to (${range.maxX.toFixed(1)}, ${range.maxY.toFixed(1)})`);
        });
        
        allPrimitives.push(...operation.primitives);
    });
    
    // Global analysis
    console.log(`\n🌍 GLOBAL ANALYSIS`);
    const globalAnalysis = PrimitiveValidator.analyzePrimitiveCollection(allPrimitives);
    console.log(`Total primitives: ${globalAnalysis.totalPrimitives}`);
    console.log(`By type:`, globalAnalysis.byType);
    console.log(`Transformation status: ALL ORIGINAL - NO AUTO-TRANSFORMATION`);
    
    if (globalAnalysis.potentialIssues.length > 0) {
        console.log(`\n❌ COORDINATE ALIGNMENT ISSUES DETECTED:`);
        globalAnalysis.potentialIssues.forEach(issue => {
            console.log(`• ${issue.message}`);
        });
    } else {
        console.log(`\n✅ No coordinate alignment issues detected`);
    }
    
    console.log(`\n💡 FIXED: All primitives now use original file coordinates`);
    console.log(`💡 FIXED: Transformation only happens when user explicitly sets origin`);
    
    return globalAnalysis;
};

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
        PrimitiveFactory,
        PrimitiveValidator
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
    window.PrimitiveValidator = PrimitiveValidator;
}