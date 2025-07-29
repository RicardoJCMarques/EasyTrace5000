// Gerber Plotter - Fixed stroke width handling and primitive creation
// plotter/gerber-plotter.js

class GerberPlotter {
    constructor(options = {}) {
        this.options = {
            debug: options.debug || false,
            ...options
        };
        
        this.primitives = [];
        this.bounds = null;
    }
    
    plot(gerberData) {
        if (!gerberData || !gerberData.layers) {
            return {
                success: false,
                error: 'Invalid Gerber data',
                primitives: []
            };
        }
        
        this.debug('Starting Gerber plotting...');
        
        // Reset
        this.primitives = [];
        this.bounds = null;
        
        // Store apertures for reference
        this.apertures = new Map();
        gerberData.layers.apertures.forEach(aperture => {
            this.apertures.set(aperture.code, aperture);
        });
        
        // Process each object
        gerberData.layers.objects.forEach((obj, index) => {
            try {
                const primitive = this.plotObject(obj);
                if (primitive) {
                    this.primitives.push(primitive);
                }
            } catch (error) {
                console.error(`Error plotting object ${index}:`, error);
            }
        });
        
        // Calculate overall bounds
        this.calculateBounds();
        
        this.debug(`Plotting complete: ${this.primitives.length} primitives`);
        
        return {
            success: true,
            primitives: this.primitives,
            bounds: this.bounds,
            units: gerberData.layers.units
        };
    }
    
    plotObject(obj) {
        switch (obj.type) {
            case 'region':
                return this.plotRegion(obj);
            case 'draw':
                return this.plotDraw(obj);
            case 'flash':
                return this.plotFlash(obj);
            default:
                this.debug(`Unknown object type: ${obj.type}`);
                return null;
        }
    }
    
    plotRegion(region) {
        // Regions are always filled polygons
        const properties = {
            fill: true,
            stroke: false,
            polarity: region.polarity,
            function: region.function,
            fillRule: 'nonzero', // Important for proper fill behavior
            isRegion: true // Mark as region for proper rendering
        };
        
        // Check if this is a non-conductor region
        if (region.function === 'NonConductor' || region.function === 'Keepout') {
            properties.isNonConductor = true;
        }
        
        return new PathPrimitive(region.points, properties);
    }
    
    plotDraw(draw) {
        const aperture = this.apertures.get(draw.aperture);
        if (!aperture) {
            this.debug(`Missing aperture: ${draw.aperture}`);
            return null;
        }
        
        // FIXED: Better logic for determining trace vs text
        const apertureSize = aperture.parameters[0];
        const isText = draw.function === 'Legend' || 
                      draw.function === 'NonConductor' ||
                      apertureSize < 0.15; // Very thin traces are likely text
        
        const properties = {
            fill: true, // Always fill stroke primitives - width is baked into geometry
            stroke: false, // Don't add additional stroke width
            polarity: draw.polarity,
            function: draw.function || aperture.function,
            aperture: draw.aperture,
            isStroke: true, // Mark this as a stroke primitive
            originalWidth: apertureSize, // Store original aperture width for reference
            isText: isText // Mark text for special handling if needed
        };
        
        if (draw.interpolation === 'G01') {
            // Linear interpolation - create stroke with width baked into geometry
            return PrimitiveFactory.createStroke(
                draw.start,
                draw.end,
                apertureSize,
                properties
            );
        } else if (draw.interpolation === 'G02' || draw.interpolation === 'G03') {
            // Arc interpolation
            if (!draw.center) {
                // Fallback to line if no center
                return PrimitiveFactory.createStroke(
                    draw.start,
                    draw.end,
                    apertureSize,
                    properties
                );
            }
            
            // FIXED: Create proper stroked arc
            return this.createStrokedArc(
                draw.start,
                draw.end,
                draw.center,
                draw.interpolation === 'G02', // G02 is clockwise
                apertureSize,
                properties
            );
        }
        
        return null;
    }
    
    plotFlash(flash) {
        const aperture = this.apertures.get(flash.aperture);
        if (!aperture) {
            this.debug(`Missing aperture: ${flash.aperture}`);
            return null;
        }
        
        const properties = {
            fill: true, // Flashes are always filled
            stroke: false,
            polarity: flash.polarity,
            function: flash.function || aperture.function,
            aperture: flash.aperture,
            isFlash: true // Mark as flash for proper rendering
        };
        
        switch (aperture.type) {
            case 'circle':
                return new CirclePrimitive(
                    flash.position,
                    aperture.parameters[0] / 2,
                    properties
                );
                
            case 'rectangle':
                const width = aperture.parameters[0];
                const height = aperture.parameters[1] || width;
                return new RectanglePrimitive(
                    {
                        x: flash.position.x - width / 2,
                        y: flash.position.y - height / 2
                    },
                    width,
                    height,
                    properties
                );
                
            case 'obround':
                const oWidth = aperture.parameters[0];
                const oHeight = aperture.parameters[1] || oWidth;
                return new ObroundPrimitive(
                    {
                        x: flash.position.x - oWidth / 2,
                        y: flash.position.y - oHeight / 2
                    },
                    oWidth,
                    oHeight,
                    properties
                );
                
            case 'polygon':
                const sides = aperture.parameters[1] || 3;
                const rotation = aperture.parameters[2] || 0;
                return PrimitiveFactory.createPolygonAperture(
                    flash.position,
                    aperture.parameters[0],
                    sides,
                    rotation,
                    properties
                );
                
            default:
                this.debug(`Unknown aperture type: ${aperture.type}`);
                return null;
        }
    }
    
    // FIXED: Improved stroked arc creation
    createStrokedArc(start, end, center, clockwise, strokeWidth, properties) {
        const radius = Math.sqrt(
            Math.pow(start.x - center.x, 2) +
            Math.pow(start.y - center.y, 2)
        );
        
        const halfWidth = strokeWidth / 2;
        const innerRadius = Math.max(0, radius - halfWidth);
        const outerRadius = radius + halfWidth;
        
        // Calculate angles
        const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
        const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
        
        // Generate points for stroked arc
        const points = [];
        const segments = Math.max(8, Math.floor(Math.abs(this.calculateAngleSpan(startAngle, endAngle, clockwise)) * 16 / Math.PI));
        
        // Calculate angle step
        let totalAngle = endAngle - startAngle;
        if (clockwise) {
            if (totalAngle > 0) totalAngle -= 2 * Math.PI;
        } else {
            if (totalAngle < 0) totalAngle += 2 * Math.PI;
        }
        const angleStep = totalAngle / segments;
        
        // Outer arc
        for (let i = 0; i <= segments; i++) {
            const angle = startAngle + angleStep * i;
            points.push({
                x: center.x + outerRadius * Math.cos(angle),
                y: center.y + outerRadius * Math.sin(angle)
            });
        }
        
        // End cap (if we have inner radius)
        if (innerRadius > 0) {
            const endCapSegments = Math.max(4, Math.floor(halfWidth * 2));
            for (let i = 0; i <= endCapSegments; i++) {
                const t = i / endCapSegments;
                const capAngle = endAngle + (clockwise ? -Math.PI : Math.PI) * t;
                const r = outerRadius - (outerRadius - innerRadius) * t;
                points.push({
                    x: center.x + r * Math.cos(capAngle),
                    y: center.y + r * Math.sin(capAngle)
                });
            }
            
            // Inner arc (reverse direction)
            for (let i = segments; i >= 0; i--) {
                const angle = startAngle + angleStep * i;
                points.push({
                    x: center.x + innerRadius * Math.cos(angle),
                    y: center.y + innerRadius * Math.sin(angle)
                });
            }
            
            // Start cap
            const startCapSegments = Math.max(4, Math.floor(halfWidth * 2));
            for (let i = 0; i <= startCapSegments; i++) {
                const t = i / startCapSegments;
                const capAngle = startAngle + (clockwise ? Math.PI : -Math.PI) * t;
                const r = innerRadius + (outerRadius - innerRadius) * t;
                points.push({
                    x: center.x + r * Math.cos(capAngle),
                    y: center.y + r * Math.sin(capAngle)
                });
            }
        } else {
            // For very thin strokes, just close at center
            points.push({ x: center.x, y: center.y });
        }
        
        return new PathPrimitive(points, { ...properties, closed: true });
    }
    
    calculateAngleSpan(startAngle, endAngle, clockwise) {
        let span = endAngle - startAngle;
        if (clockwise) {
            if (span > 0) span -= 2 * Math.PI;
        } else {
            if (span < 0) span += 2 * Math.PI;
        }
        return span;
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
        
        drillData.drillData.holes.forEach(hole => {
            // FIXED: Drill holes should be filled circles to show drilled area
            const primitive = new CirclePrimitive(
                hole.position,
                hole.diameter / 2,
                {
                    fill: true, // Fill holes to show drilled area clearly
                    stroke: true, // Also show outline for definition
                    strokeWidth: 0.05, // Very thin outline
                    type: 'drill',
                    tool: hole.tool,
                    plated: hole.plated,
                    isDrillHole: true, // Mark as drill hole for renderer
                    diameter: hole.diameter,
                    renderOnTop: true // Ensure holes render above other geometry
                }
            );
            
            drillPrimitives.push(primitive);
        });
        
        this.debug(`Plotted ${drillPrimitives.length} drill holes`);
        
        // Calculate bounds for drill data
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
            units: drillData.drillData.units
        };
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