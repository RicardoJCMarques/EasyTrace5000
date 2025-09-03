// plotter/gerber-plotter.js
// Simplified Gerber plotter for Clipper2 pipeline
// Creates basic primitives without hole preservation - Clipper2 handles it
// FIXED: Proper region plotting and debug output

class GerberPlotter {
    constructor(options = {}) {
        this.options = {
            debug: options.debug || false,
            ...options
        };
        
        this.primitives = [];
        this.bounds = null;
        
        this.creationStats = {
            regionsCreated: 0,
            tracesCreated: 0,
            flashesCreated: 0,
            drillsCreated: 0,
            primitivesCreated: 0,
            regionPointCounts: [],
            traceLengths: []
        };
    }
    
    plot(gerberData) {
        if (!gerberData || !gerberData.layers) {
            return {
                success: false,
                error: 'Invalid Gerber data',
                primitives: []
            };
        }
        
        this.debug('Starting simplified Gerber plotting for Clipper2...');
        
        // Reset
        this.primitives = [];
        this.bounds = null;
        this.creationStats = {
            regionsCreated: 0,
            tracesCreated: 0,
            flashesCreated: 0,
            drillsCreated: 0,
            primitivesCreated: 0,
            regionPointCounts: [],
            traceLengths: []
        };
        
        // Store apertures for reference
        this.apertures = new Map();
        if (gerberData.layers.apertures) {
            gerberData.layers.apertures.forEach(aperture => {
                this.apertures.set(aperture.code, aperture);
            });
        }
        
        this.debug(`Input: ${gerberData.layers.objects.length} objects`);
        
        // Count object types for debugging
        const objectTypes = {};
        gerberData.layers.objects.forEach(obj => {
            objectTypes[obj.type] = (objectTypes[obj.type] || 0) + 1;
        });
        this.debug('Object types in input:', objectTypes);
        
        // Process each object
        gerberData.layers.objects.forEach((obj, index) => {
            try {
                const primitive = this.plotObject(obj);
                if (primitive) {
                    const primArray = Array.isArray(primitive) ? primitive : [primitive];
                    
                    primArray.forEach(prim => {
                        if (this.validatePrimitive(prim)) {
                            this.primitives.push(prim);
                            this.creationStats.primitivesCreated++;
                        } else {
                            this.debug(`WARNING: Invalid primitive from object ${index} (${obj.type})`);
                        }
                    });
                }
            } catch (error) {
                console.error(`Error plotting object ${index} (${obj.type}):`, error);
                this.debug(`ERROR: Failed to plot object ${index}: ${error.message}`);
            }
        });
        
        // Calculate overall bounds
        this.calculateBounds();
        
        this.debug('Plotting Statistics:');
        this.debug(`  Regions: ${this.creationStats.regionsCreated}`);
        if (this.creationStats.regionPointCounts.length > 0) {
            const avgPoints = this.creationStats.regionPointCounts.reduce((a, b) => a + b, 0) / this.creationStats.regionPointCounts.length;
            this.debug(`    Average points per region: ${avgPoints.toFixed(1)}`);
            this.debug(`    Min/Max points: ${Math.min(...this.creationStats.regionPointCounts)}/${Math.max(...this.creationStats.regionPointCounts)}`);
        }
        this.debug(`  Traces: ${this.creationStats.tracesCreated}`);
        if (this.creationStats.traceLengths.length > 0) {
            const avgLength = this.creationStats.traceLengths.reduce((a, b) => a + b, 0) / this.creationStats.traceLengths.length;
            this.debug(`    Average trace length: ${avgLength.toFixed(3)}mm`);
        }
        this.debug(`  Flashes: ${this.creationStats.flashesCreated}`);
        this.debug(`  Total primitives: ${this.creationStats.primitivesCreated}`);
        
        return {
            success: true,
            primitives: this.primitives,
            bounds: this.bounds,
            units: gerberData.layers.units,
            creationStats: this.creationStats
        };
    }
    
    plotObject(obj) {
        switch (obj.type) {
            case 'region':
                return this.plotRegion(obj);
            
            case 'trace':
                return this.plotTrace(obj);
            
            case 'flash':
                return this.plotFlash(obj);
            
            case 'draw': // Legacy support
                return this.plotDraw(obj);
            
            default:
                this.debug(`Unknown object type: ${obj.type}`);
                return null;
        }
    }
    
    /**
     * Plot region - simplified without hole detection
     * FIXED: Better validation and debug output
     */
    plotRegion(region) {
        if (!region.points || !Array.isArray(region.points)) {
            console.warn('Region has no points array:', region);
            return null;
        }
        
        if (region.points.length < 3) {
            console.warn(`Region has only ${region.points.length} points (need at least 3):`, region);
            return null;
        }
        
        this.debug(`Plotting region with ${region.points.length} points, polarity: ${region.polarity || 'dark'}`);
        
        // Check if region is closed
        const first = region.points[0];
        const last = region.points[region.points.length - 1];
        const isClosed = Math.abs(first.x - last.x) < 0.001 && Math.abs(first.y - last.y) < 0.001;
        
        if (!isClosed) {
            this.debug('  WARNING: Region is not closed, will be closed automatically');
        }
        
        // Create simple filled path primitive
        const properties = {
            // Region identification
            isRegion: true,
            regionType: 'filled_area',
            
            // Fill properties
            fill: true,
            fillRule: 'nonzero', // Let Clipper2 handle winding
            
            // No stroke for regions
            stroke: false,
            strokeWidth: 0,
            
            // Other properties
            polarity: region.polarity || 'dark',
            closed: true,
            
            // Debug info
            originalPointCount: region.points.length
        };
        
        // Create primitive - no holes needed, Clipper2 will detect them
        const primitive = new PathPrimitive(region.points, properties);
        
        this.creationStats.regionsCreated++;
        this.creationStats.regionPointCounts.push(region.points.length);
        
        // Calculate region area for debug
        const area = this.calculateArea(region.points);
        this.debug(`  Region area: ${Math.abs(area).toFixed(3)} mm²`);
        this.debug(`  Region winding: ${area > 0 ? 'CCW' : 'CW'}`);
        
        return primitive;
    }
    
    /**
     * Plot trace - simple stroked path
     * FIXED: Better debug output
     */
    plotTrace(trace) {
        if (!trace.start || !trace.end) {
            console.warn('Invalid trace (missing start/end):', trace);
            return null;
        }
        
        const length = Math.sqrt(
            Math.pow(trace.end.x - trace.start.x, 2) + 
            Math.pow(trace.end.y - trace.start.y, 2)
        );
        
        this.debug(`Plotting trace: (${trace.start.x.toFixed(3)}, ${trace.start.y.toFixed(3)}) to (${trace.end.x.toFixed(3)}, ${trace.end.y.toFixed(3)}), length: ${length.toFixed(3)}mm`);
        
        const width = trace.width || 0.1;
        
        // Create trace as stroked path
        const properties = {
            // Trace identification
            isTrace: true,
            
            // No fill, only stroke
            fill: false,
            stroke: true,
            strokeWidth: width,
            
            // Other properties
            polarity: trace.polarity || 'dark',
            aperture: trace.aperture,
            interpolation: trace.interpolation || 'G01',
            closed: false,
            
            // Debug info
            traceLength: length
        };
        
        let points;
        
        // Handle arc traces
        if (trace.arc && (trace.interpolation === 'G02' || trace.interpolation === 'G03')) {
            points = this.createArcPoints(
                trace.start,
                trace.end,
                trace.arc,
                trace.clockwise !== false
            );
            this.debug(`  Arc trace with ${points.length} interpolated points`);
        } else {
            // Simple line
            points = [trace.start, trace.end];
        }
        
        const primitive = new PathPrimitive(points, properties);
        
        this.creationStats.tracesCreated++;
        this.creationStats.traceLengths.push(length);
        
        return primitive;
    }
    
    /**
     * Plot flash (pad) - create appropriate shape
     * FIXED: Better debug output
     */
    plotFlash(flash) {
        if (!flash.position) {
            console.warn('Invalid flash (missing position):', flash);
            return null;
        }
        
        this.debug(`Plotting flash at (${flash.position.x.toFixed(3)}, ${flash.position.y.toFixed(3)}), shape: ${flash.shape}`);
        
        // Flash/pad properties - always filled, no stroke
        const properties = {
            // Flash identification
            isFlash: true,
            isPad: true,
            
            // Fill only, no stroke
            fill: true,
            stroke: false,
            strokeWidth: 0,
            
            // Other properties
            polarity: flash.polarity || 'dark',
            aperture: flash.aperture,
            shape: flash.shape
        };
        
        // Create appropriate primitive based on shape
        let primitive = null;
        
        switch (flash.shape) {
            case 'circle':
                const radius = flash.radius || (flash.parameters?.[0] / 2) || 0.5;
                this.debug(`  Circle flash, radius: ${radius.toFixed(3)}mm`);
                primitive = new CirclePrimitive(
                    flash.position,
                    radius,
                    properties
                );
                break;
            
            case 'rectangle':
                const width = flash.width || flash.parameters?.[0] || 1.0;
                const height = flash.height || flash.parameters?.[1] || width;
                this.debug(`  Rectangle flash, size: ${width.toFixed(3)} x ${height.toFixed(3)}mm`);
                primitive = new RectanglePrimitive(
                    {
                        x: flash.position.x - width / 2,
                        y: flash.position.y - height / 2
                    },
                    width,
                    height,
                    properties
                );
                break;
            
            case 'obround':
                const oWidth = flash.width || flash.parameters?.[0] || 1.0;
                const oHeight = flash.height || flash.parameters?.[1] || oWidth;
                this.debug(`  Obround flash, size: ${oWidth.toFixed(3)} x ${oHeight.toFixed(3)}mm`);
                primitive = new ObroundPrimitive(
                    {
                        x: flash.position.x - oWidth / 2,
                        y: flash.position.y - oHeight / 2
                    },
                    oWidth,
                    oHeight,
                    properties
                );
                break;
            
            case 'polygon':
                const diameter = flash.diameter || flash.parameters?.[0] || 1.0;
                const vertices = flash.vertices || flash.parameters?.[1] || 3;
                const rotation = flash.rotation || flash.parameters?.[2] || 0;
                this.debug(`  Polygon flash, diameter: ${diameter.toFixed(3)}mm, vertices: ${vertices}`);
                primitive = this.createPolygonFlash(
                    flash.position,
                    diameter,
                    vertices,
                    rotation,
                    properties
                );
                break;
            
            default:
                // Fallback to circle
                console.warn(`Unknown flash shape: ${flash.shape}, using circle`);
                const defaultRadius = (flash.parameters?.[0] / 2) || 0.5;
                primitive = new CirclePrimitive(
                    flash.position,
                    defaultRadius,
                    properties
                );
        }
        
        if (primitive) {
            this.creationStats.flashesCreated++;
        }
        
        return primitive;
    }
    
    /**
     * Legacy support for draw commands
     */
    plotDraw(draw) {
        if (!draw.aperture) {
            console.warn('Draw without aperture:', draw);
            return null;
        }
        
        const aperture = this.apertures.get(draw.aperture);
        if (!aperture) {
            console.warn(`Missing aperture: ${draw.aperture}`);
            return null;
        }
        
        // Convert to trace format
        const trace = {
            type: 'trace',
            start: draw.start,
            end: draw.end,
            width: aperture.parameters[0] || 0.1,
            aperture: draw.aperture,
            polarity: draw.polarity,
            interpolation: draw.interpolation
        };
        
        if (draw.center) {
            trace.arc = {
                i: draw.center.x - draw.start.x,
                j: draw.center.y - draw.start.y
            };
            trace.clockwise = draw.interpolation === 'G02';
        }
        
        return this.plotTrace(trace);
    }
    
    createPolygonFlash(center, diameter, sides, rotation, properties) {
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
    
    createArcPoints(start, end, arcData, clockwise) {
        // Calculate center from arc data
        const center = {
            x: start.x + arcData.i,
            y: start.y + arcData.j
        };
        
        const radius = Math.sqrt(
            Math.pow(start.x - center.x, 2) +
            Math.pow(start.y - center.y, 2)
        );
        
        const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
        const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
        
        // Calculate angle span
        let angleSpan = endAngle - startAngle;
        if (clockwise) {
            if (angleSpan > 0) angleSpan -= 2 * Math.PI;
        } else {
            if (angleSpan < 0) angleSpan += 2 * Math.PI;
        }
        
        // Generate arc points
        const segments = Math.max(8, Math.floor(Math.abs(angleSpan) * 16 / Math.PI));
        const angleStep = angleSpan / segments;
        const points = [];
        
        for (let i = 0; i <= segments; i++) {
            const angle = startAngle + angleStep * i;
            points.push({
                x: center.x + radius * Math.cos(angle),
                y: center.y + radius * Math.sin(angle)
            });
        }
        
        return points;
    }
    
    /**
     * Calculate area of a polygon (for debug)
     */
    calculateArea(points) {
        let area = 0;
        for (let i = 0; i < points.length; i++) {
            const j = (i + 1) % points.length;
            area += points[i].x * points[j].y;
            area -= points[j].x * points[i].y;
        }
        return area / 2;
    }
    
    /**
     * Plot drill data - simple circles
     */
    plotDrillData(drillData) {
        if (!drillData || !drillData.drillData) {
            return {
                success: false,
                error: 'Invalid drill data',
                primitives: []
            };
        }
        
        this.debug('Plotting drill data...');
        
        const drillPrimitives = [];
        
        if (drillData.drillData.holes) {
            this.debug(`Processing ${drillData.drillData.holes.length} drill holes`);
            
            drillData.drillData.holes.forEach((hole, index) => {
                if (!hole.position || !isFinite(hole.position.x) || !isFinite(hole.position.y)) {
                    console.warn(`Invalid drill hole ${index}:`, hole);
                    return;
                }
                
                // Drill holes are always filled, no stroke
                const primitive = new CirclePrimitive(
                    hole.position,
                    hole.diameter / 2,
                    {
                        // Drill identification
                        isDrillHole: true,
                        
                        // Fill only, no stroke
                        fill: true,
                        stroke: false,
                        strokeWidth: 0,
                        
                        // Other properties
                        type: 'drill',
                        tool: hole.tool,
                        plated: hole.plated,
                        diameter: hole.diameter,
                        polarity: 'dark' // Drill holes are always dark
                    }
                );
                
                drillPrimitives.push(primitive);
                this.creationStats.drillsCreated++;
            });
        }
        
        this.debug(`Plotted ${drillPrimitives.length} drill holes`);
        
        // Calculate bounds
        let bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        if (drillPrimitives.length > 0) {
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            
            drillPrimitives.forEach(primitive => {
                const primBounds = primitive.getBounds();
                minX = Math.min(minX, primBounds.minX);
                minY = Math.min(minY, primBounds.minY);
                maxX = Math.max(maxX, primBounds.maxX);
                maxY = Math.max(maxY, primBounds.maxY);
            });
            
            bounds = { minX, minY, maxX, maxY };
        }
        
        return {
            success: true,
            primitives: drillPrimitives,
            bounds: bounds,
            units: drillData.drillData.units,
            creationStats: { drillHolesCreated: drillPrimitives.length }
        };
    }
    
    validatePrimitive(primitive) {
        try {
            // Check if primitive has required methods
            if (typeof primitive.getBounds !== 'function') {
                console.warn('Primitive missing getBounds method:', primitive);
                return false;
            }
            
            // Check if bounds are valid
            const bounds = primitive.getBounds();
            if (!isFinite(bounds.minX) || !isFinite(bounds.minY) || 
                !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                console.warn('Primitive has invalid bounds:', bounds, primitive);
                return false;
            }
            
            // Check specific primitive types
            if (primitive.type === 'path') {
                if (!primitive.points || !Array.isArray(primitive.points) || primitive.points.length === 0) {
                    console.warn('Path primitive has invalid points:', primitive);
                    return false;
                }
            } else if (primitive.type === 'circle') {
                if (!primitive.center || !isFinite(primitive.radius) || primitive.radius <= 0) {
                    console.warn('Circle primitive has invalid geometry:', primitive);
                    return false;
                }
            }
            
            return true;
        } catch (error) {
            console.warn('Primitive validation failed:', error, primitive);
            return false;
        }
    }
    
    calculateBounds() {
        if (this.primitives.length === 0) {
            this.bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
            return;
        }
        
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        let validPrimitives = 0;
        
        this.primitives.forEach((primitive, index) => {
            const bounds = primitive.getBounds();
            
            if (!isFinite(bounds.minX) || !isFinite(bounds.minY) || 
                !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                console.warn(`Primitive ${index} has invalid bounds:`, bounds);
                return;
            }
            
            minX = Math.min(minX, bounds.minX);
            minY = Math.min(minY, bounds.minY);
            maxX = Math.max(maxX, bounds.maxX);
            maxY = Math.max(maxY, bounds.maxY);
            validPrimitives++;
        });
        
        this.bounds = { minX, minY, maxX, maxY };
        this.debug(`Calculated plotter bounds from ${validPrimitives}/${this.primitives.length} valid primitives:`, this.bounds);
    }
    
    debug(message, data = null) {
        if (this.options.debug) {
            if (data) {
                console.log(`[GerberPlotter] ${message}`, data);
            } else {
                console.log(`[GerberPlotter] ${message}`);
            }
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GerberPlotter;
} else {
    window.GerberPlotter = GerberPlotter;
}