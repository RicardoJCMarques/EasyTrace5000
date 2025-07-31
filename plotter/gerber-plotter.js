// Gerber Plotter - SIMPLIFIED: Back to basics without complex geometry classification
// plotter/gerber-plotter.js

class GerberPlotter {
    constructor(options = {}) {
        this.options = {
            debug: options.debug || false,
            ...options
        };
        
        this.primitives = [];
        this.bounds = null;
        
        // SIMPLIFIED: Remove complex geometry classifier
    }
    
    plot(gerberData) {
        if (!gerberData || !gerberData.layers) {
            return {
                success: false,
                error: 'Invalid Gerber data',
                primitives: []
            };
        }
        
        this.debug('SIMPLIFIED: Starting Gerber plotting - back to basics...');
        
        // Reset
        this.primitives = [];
        this.bounds = null;
        
        // Store apertures for reference
        this.apertures = new Map();
        gerberData.layers.apertures.forEach(aperture => {
            this.apertures.set(aperture.code, aperture);
        });
        
        // DEBUG: Log gerber data structure
        this.debug(`Input gerber data: ${gerberData.layers.objects.length} objects, ${gerberData.layers.apertures.length} apertures`);
        
        // Count objects by type for debugging
        const objectTypes = {};
        gerberData.layers.objects.forEach(obj => {
            objectTypes[obj.type] = (objectTypes[obj.type] || 0) + 1;
        });
        this.debug('Object types:', objectTypes);
        
        // SIMPLIFIED: Process each object directly (no classification)
        gerberData.layers.objects.forEach((obj, index) => {
            try {
                this.debug(`Processing object ${index + 1}/${gerberData.layers.objects.length}: ${obj.type}`);
                
                // VALIDATION: Check coordinate validity before plotting
                if (!this.validateObjectCoordinates(obj)) {
                    console.warn(`[GerberPlotter-SIMPLIFIED] Invalid coordinates in object ${index}:`, obj);
                    return;
                }
                
                const primitive = this.plotObject(obj);
                if (primitive) {
                    // VALIDATION: Check primitive coordinates after creation
                    const bounds = primitive.getBounds();
                    if (!isFinite(bounds.minX) || !isFinite(bounds.minY) || 
                        !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                        console.warn(`[GerberPlotter-SIMPLIFIED] Primitive ${index} has invalid bounds:`, bounds);
                        return;
                    }
                    
                    this.primitives.push(primitive);
                    this.debug(`SIMPLIFIED: Created ${primitive.type} primitive with bounds:`, bounds);
                } else {
                    this.debug(`No primitive created for object ${index}`);
                }
            } catch (error) {
                console.error(`Error plotting object ${index}:`, error);
            }
        });
        
        // Calculate overall bounds
        this.calculateBounds();
        
        this.debug(`SIMPLIFIED: Plotting complete: ${this.primitives.length} primitives created`);
        this.debug('Final plotter bounds:', this.bounds);
        
        return {
            success: true,
            primitives: this.primitives,
            bounds: this.bounds,
            units: gerberData.layers.units
        };
    }
    
    // ... (rest of the existing methods remain the same)
    
    // Validate object coordinates for consistency
    validateObjectCoordinates(obj) {
        switch (obj.type) {
            case 'region':
                if (!obj.points || !Array.isArray(obj.points)) return false;
                return obj.points.every(point => 
                    point && typeof point.x === 'number' && typeof point.y === 'number' &&
                    isFinite(point.x) && isFinite(point.y)
                );
                
            case 'draw':
                if (!obj.start || !obj.end) return false;
                return typeof obj.start.x === 'number' && typeof obj.start.y === 'number' &&
                       typeof obj.end.x === 'number' && typeof obj.end.y === 'number' &&
                       isFinite(obj.start.x) && isFinite(obj.start.y) &&
                       isFinite(obj.end.x) && isFinite(obj.end.y);
                
            case 'flash':
                if (!obj.position) return false;
                return typeof obj.position.x === 'number' && typeof obj.position.y === 'number' &&
                       isFinite(obj.position.x) && isFinite(obj.position.y);
                
            default:
                return true; // Unknown types pass validation
        }
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
        this.debug(`REDESIGNED: Plotting region with ${region.points.length} points (${region.geometryClass})`);
        
        // ENHANCED: Validate and log region coordinates
        if (!region.points || region.points.length < 3) {
            console.warn('[GerberPlotter-REDESIGNED] Region has too few points:', region);
            return null;
        }
        
        // Log sample coordinates for debugging
        const firstPoint = region.points[0];
        const lastPoint = region.points[region.points.length - 1];
        this.debug(`REDESIGNED: Region coordinates - first: (${firstPoint.x.toFixed(3)}, ${firstPoint.y.toFixed(3)}), last: (${lastPoint.x.toFixed(3)}, ${lastPoint.y.toFixed(3)})`);
        
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
            this.debug('REDESIGNED: Region marked as non-conductor');
        }
        
        // REDESIGNED: Create primitive with original coordinates and classification
        return new PathPrimitive(region.points, properties);
    }
    
    plotDraw(draw) {
        const aperture = this.apertures.get(draw.aperture);
        if (!aperture) {
            this.debug(`Missing aperture: ${draw.aperture}`);
            return null;
        }
        
        this.debug(`REDESIGNED: Plotting draw from (${draw.start.x.toFixed(3)}, ${draw.start.y.toFixed(3)}) to (${draw.end.x.toFixed(3)}, ${draw.end.y.toFixed(3)}) (${draw.geometryClass})`);
        
        // ENHANCED: Better logic for determining trace vs text
        const apertureSize = aperture.parameters[0];
        const isText = draw.function === 'Legend' || 
                      draw.function === 'NonConductor' ||
                      draw.geometryClass === 'text' ||
                      draw.geometryClass === 'legend' ||
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
            
            this.debug(`REDESIGNED: Plotting arc with center (${draw.center.x.toFixed(3)}, ${draw.center.y.toFixed(3)})`);
            
            // Create proper stroked arc
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
        
        this.debug(`REDESIGNED: Plotting flash at (${flash.position.x.toFixed(3)}, ${flash.position.y.toFixed(3)}) (${flash.geometryClass})`);
        
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
                const radius = aperture.parameters[0] / 2;
                this.debug(`REDESIGNED: Creating circle flash with radius ${radius.toFixed(3)}`);
                return new CirclePrimitive(
                    flash.position,
                    radius,
                    properties
                );
                
            case 'rectangle':
                const width = aperture.parameters[0];
                const height = aperture.parameters[1] || width;
                this.debug(`REDESIGNED: Creating rectangle flash ${width.toFixed(3)} × ${height.toFixed(3)}`);
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
                this.debug(`REDESIGNED: Creating obround flash ${oWidth.toFixed(3)} × ${oHeight.toFixed(3)}`);
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
                this.debug(`REDESIGNED: Creating polygon flash with ${sides} sides`);
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
    
    // Improved stroked arc creation with coordinate validation
    createStrokedArc(start, end, center, clockwise, strokeWidth, properties) {
        this.debug(`SIMPLIFIED: Creating stroked arc - start(${start.x.toFixed(3)}, ${start.y.toFixed(3)}), end(${end.x.toFixed(3)}, ${end.y.toFixed(3)}), center(${center.x.toFixed(3)}, ${center.y.toFixed(3)})`);
        
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
        
        this.primitives.forEach((primitive, index) => {
            const bounds = primitive.getBounds();
            
            // VALIDATION: Check for invalid bounds
            if (!isFinite(bounds.minX) || !isFinite(bounds.minY) || 
                !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                console.warn(`[GerberPlotter-SIMPLIFIED] Primitive ${index} has invalid bounds:`, bounds);
                return;
            }
            
            minX = Math.min(minX, bounds.minX);
            minY = Math.min(minY, bounds.minY);
            maxX = Math.max(maxX, bounds.maxX);
            maxY = Math.max(maxY, bounds.maxY);
        });
        
        this.bounds = { minX, minY, maxX, maxY };
        this.debug('SIMPLIFIED: Calculated plotter bounds:', this.bounds);
    }
    
    plotDrillData(drillData) {
        if (!drillData || !drillData.drillData) {
            return {
                success: false,
                error: 'Invalid drill data',
                primitives: []
            };
        }
        
        this.debug('SIMPLIFIED: Plotting drill data...');
        
        const drillPrimitives = [];
        
        drillData.drillData.holes.forEach((hole, index) => {
            // VALIDATION: Check hole data
            if (!hole.position || typeof hole.position.x !== 'number' || typeof hole.position.y !== 'number' ||
                !isFinite(hole.position.x) || !isFinite(hole.position.y)) {
                console.warn(`[GerberPlotter-SIMPLIFIED] Invalid drill hole ${index}:`, hole);
                return;
            }
            
            this.debug(`SIMPLIFIED: Plotting drill hole ${index + 1} at (${hole.position.x.toFixed(3)}, ${hole.position.y.toFixed(3)})`);
            
            // Drill holes should be filled circles to show drilled area
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
        
        this.debug(`SIMPLIFIED: Plotted ${drillPrimitives.length} drill holes`);
        
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
        
        this.debug('SIMPLIFIED: Drill bounds:', bounds);
        
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
                console.log(`[GerberPlotter-SIMPLIFIED] ${message}`, data);
            } else {
                console.log(`[GerberPlotter-SIMPLIFIED] ${message}`);
            }
        }
    }
}

// Export - SIMPLIFIED: Remove GeometryClassifier
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GerberPlotter;
} else {
    window.GerberPlotter = GerberPlotter;
}