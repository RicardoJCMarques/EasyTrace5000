// Gerber Plotter - FIXED: Strict region/trace separation, no stroke on regions
// plotter/gerber-plotter.js

class GerberPlotter {
    constructor(options = {}) {
        this.options = {
            debug: options.debug || false,
            ...options
        };
        
        this.primitives = [];
        this.bounds = null;
        
        this.creationStats = {
            regionsFromRegionObjects: 0,
            drawsFromDrawObjects: 0,
            flashesFromFlashObjects: 0,
            connectedPathsProcessed: 0,
            branchingNetworksProcessed: 0,
            branchSegmentsCreated: 0,
            primitivesCreated: 0
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
        
        this.debug('Starting Gerber plotting with strict region/trace separation...');
        
        // Reset
        this.primitives = [];
        this.bounds = null;
        this.creationStats = {
            regionsFromRegionObjects: 0,
            drawsFromDrawObjects: 0,
            flashesFromFlashObjects: 0,
            connectedPathsProcessed: 0,
            branchingNetworksProcessed: 0,
            branchSegmentsCreated: 0,
            primitivesCreated: 0
        };
        
        // Store apertures for reference
        this.apertures = new Map();
        gerberData.layers.apertures.forEach(aperture => {
            this.apertures.set(aperture.code, aperture);
        });
        
        this.debug(`Input gerber data: ${gerberData.layers.objects.length} objects, ${gerberData.layers.apertures.length} apertures`);
        
        // Process objects
        gerberData.layers.objects.forEach((obj, index) => {
            try {
                if (!this.validateObjectCoordinates(obj)) {
                    console.warn(`Invalid coordinates in object ${index}:`, obj);
                    return;
                }
                
                const primitives = this.plotObject(obj);
                if (primitives) {
                    const primArray = Array.isArray(primitives) ? primitives : [primitives];
                    
                    primArray.forEach(primitive => {
                        const bounds = primitive.getBounds();
                        if (!isFinite(bounds.minX) || !isFinite(bounds.minY) || 
                            !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                            console.warn(`Primitive has invalid bounds:`, bounds);
                            return;
                        }
                        
                        this.primitives.push(primitive);
                        this.creationStats.primitivesCreated++;
                    });
                }
            } catch (error) {
                console.error(`Error plotting object ${index}:`, error);
            }
        });
        
        // Calculate overall bounds
        this.calculateBounds();
        
        this.debug('Plotting Statistics:');
        this.debug(`  Regions: ${this.creationStats.regionsFromRegionObjects}`);
        this.debug(`  Draws: ${this.creationStats.drawsFromDrawObjects}`);
        this.debug(`  Total primitives: ${this.creationStats.primitivesCreated}`);
        
        return {
            success: true,
            primitives: this.primitives,
            bounds: this.bounds,
            units: gerberData.layers.units,
            creationStats: this.creationStats
        };
    }
    
    validateObjectCoordinates(obj) {
        const type = obj.subtype || obj.type;
        
        switch (type) {
            case 'region':
                if (!obj.points || !Array.isArray(obj.points)) return false;
                return obj.points.every(point => 
                    point && typeof point.x === 'number' && typeof point.y === 'number' &&
                    isFinite(point.x) && isFinite(point.y)
                );
                
            case 'connected_path':
                if (!obj.points || !Array.isArray(obj.points)) return false;
                return obj.points.every(point => 
                    point && typeof point.x === 'number' && typeof point.y === 'number' &&
                    isFinite(point.x) && isFinite(point.y)
                );
                
            case 'branching_network':
                if (!obj.segments || !Array.isArray(obj.segments)) return false;
                return obj.segments.every(segment => 
                    segment.start && segment.end &&
                    isFinite(segment.start.x) && isFinite(segment.start.y) &&
                    isFinite(segment.end.x) && isFinite(segment.end.y)
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
                return true;
        }
    }
    
    plotObject(obj) {
        const type = obj.subtype || obj.type;
        
        switch (type) {
            case 'region':
                this.creationStats.regionsFromRegionObjects++;
                return this.plotRegion(obj);
                
            case 'connected_path':
                this.creationStats.connectedPathsProcessed++;
                return this.plotConnectedPath(obj);
                
            case 'branching_network':
                this.creationStats.branchingNetworksProcessed++;
                return this.plotBranchingNetwork(obj);
                
            case 'draw':
                this.creationStats.drawsFromDrawObjects++;
                return this.plotDraw(obj);
                
            case 'flash':
                this.creationStats.flashesFromFlashObjects++;
                return this.plotFlash(obj);
                
            default:
                this.debug(`Unknown object type: ${type}`);
                return null;
        }
    }
    
    /**
     * CRITICAL FIX: Plot region with ABSOLUTELY NO STROKE
     */
    plotRegion(region) {
        this.debug(`Plotting region with ${region.points.length} points (FILL ONLY - NO STROKE EVER)`);
        
        if (!region.points || region.points.length < 3) {
            console.warn('Region has too few points:', region);
            return null;
        }
        
        // CRITICAL: Regions are ALWAYS and ONLY fill, NEVER stroke
        const properties = {
            // Region identification
            isRegion: true,
            regionType: 'filled_area',
            
            // CRITICAL: Fill properties
            fill: true,
            fillRule: 'nonzero', // Use nonzero for proper hole handling
            
            // CRITICAL: NO STROKE EVER
            stroke: false,
            strokeWidth: 0,
            noStroke: true, // Extra flag to ensure no stroke
            
            // Other properties
            polarity: region.polarity || 'dark',
            function: region.function,
            closed: true
        };
        
        // Check if this might be text with holes
        if (region.function === 'Legend' || this.mightBeTextWithHoles(region)) {
            properties.fillRule = 'evenodd'; // Use evenodd for text with holes
            properties.mightHaveHoles = true;
            this.debug('Region might be text with holes, using evenodd fill rule');
        }
        
        const primitive = new PathPrimitive(region.points, properties);
        
        this.debug(`Created region primitive (fill-only, no stroke)`);
        
        return primitive;
    }
    
    /**
     * Check if a region might be text with holes (like B or a)
     */
    mightBeTextWithHoles(region) {
        // Small regions near other small regions might be text
        const bounds = this.calculatePointsBounds(region.points);
        const area = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
        
        // Text regions are typically small
        return area < 10; // Less than 10mm²
    }
    
    /**
     * Plot branching network as multiple trace primitives
     */
    plotBranchingNetwork(network) {
        const aperture = this.apertures.get(network.aperture);
        if (!aperture) {
            this.debug(`Missing aperture: ${network.aperture}`);
            return null;
        }
        
        this.debug(`Plotting branching network with ${network.segments.length} segments`);
        
        const apertureSize = aperture.parameters[0];
        const primitives = [];
        
        // Create a trace for each segment
        network.segments.forEach((segment, index) => {
            this.creationStats.branchSegmentsCreated++;
            
            const properties = {
                // Trace identification
                isTrace: true,
                isBranchSegment: true,
                
                // TRACES: No fill, only stroke
                fill: false,
                stroke: true,
                strokeWidth: apertureSize,
                
                // Other properties
                polarity: network.polarity,
                function: network.function,
                aperture: network.aperture,
                branchIndex: index,
                interpolation: segment.interpolation || 'G01',
                closed: false
            };
            
            const pathPrimitive = new PathPrimitive(
                [segment.start, segment.end], 
                properties
            );
            
            primitives.push(pathPrimitive);
        });
        
        this.debug(`Created ${primitives.length} trace primitives for branching network`);
        return primitives;
    }
    
    /**
     * Plot connected path as trace
     */
    plotConnectedPath(path) {
        const aperture = this.apertures.get(path.aperture);
        if (!aperture) {
            this.debug(`Missing aperture: ${path.aperture}`);
            return null;
        }
        
        this.debug(`Plotting connected path with ${path.points.length} points`);
        
        const apertureSize = aperture.parameters[0];
        
        // TRACES: Always stroke, never fill
        const properties = {
            // Trace identification
            isTrace: true,
            isConnectedPath: true,
            
            // TRACES: No fill, only stroke
            fill: false,
            stroke: true,
            strokeWidth: apertureSize,
            
            // Other properties
            polarity: path.polarity,
            function: path.function,
            aperture: path.aperture,
            isBranching: false,
            segmentCount: path.segmentCount || (path.points.length - 1),
            closed: false
        };
        
        return new PathPrimitive(path.points, properties);
    }
    
    plotDraw(draw) {
        const aperture = this.apertures.get(draw.aperture);
        if (!aperture) {
            this.debug(`Missing aperture: ${draw.aperture}`);
            return null;
        }
        
        this.debug(`Plotting draw from (${draw.start.x.toFixed(3)}, ${draw.start.y.toFixed(3)}) to (${draw.end.x.toFixed(3)}, ${draw.end.y.toFixed(3)})`);
        
        const apertureSize = aperture.parameters[0];
        
        // DRAWS/TRACES: Always stroke, never fill
        const properties = {
            // Trace identification
            isTrace: true,
            isDraw: true,
            
            // TRACES: No fill, only stroke
            fill: false,
            stroke: true,
            strokeWidth: apertureSize,
            
            // Other properties
            polarity: draw.polarity,
            function: draw.function || aperture.function,
            aperture: draw.aperture,
            interpolation: draw.interpolation,
            closed: false
        };
        
        if (draw.interpolation === 'G01') {
            // Simple line
            return new PathPrimitive([draw.start, draw.end], properties);
        } else if (draw.interpolation === 'G02' || draw.interpolation === 'G03') {
            // Arc - create arc path points
            if (!draw.center) {
                // Fallback to line if no center
                return new PathPrimitive([draw.start, draw.end], properties);
            }
            
            const arcPoints = this.createArcPoints(
                draw.start,
                draw.end,
                draw.center,
                draw.interpolation === 'G02'
            );
            
            return new PathPrimitive(arcPoints, properties);
        }
        
        return null;
    }
    
    plotFlash(flash) {
        const aperture = this.apertures.get(flash.aperture);
        if (!aperture) {
            this.debug(`Missing aperture: ${flash.aperture}`);
            return null;
        }
        
        this.debug(`Plotting flash at (${flash.position.x.toFixed(3)}, ${flash.position.y.toFixed(3)})`);
        
        // FLASHES/PADS: Always fill, no stroke
        const properties = {
            // Flash identification
            isFlash: true,
            isPad: true,
            
            // FLASHES: Fill only, no stroke
            fill: true,
            stroke: false,
            strokeWidth: 0,
            
            // Other properties
            polarity: flash.polarity,
            function: flash.function || aperture.function,
            aperture: flash.aperture
        };
        
        switch (aperture.type) {
            case 'circle':
                const radius = aperture.parameters[0] / 2;
                return new CirclePrimitive(
                    flash.position,
                    radius,
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
                return this.createPolygonFlash(
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
    
    createArcPoints(start, end, center, clockwise) {
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
    
    calculatePointsBounds(points) {
        if (points.length === 0) return null;
        
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        points.forEach(point => {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        });
        
        return { minX, minY, maxX, maxY };
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
            
            if (!isFinite(bounds.minX) || !isFinite(bounds.minY) || 
                !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                console.warn(`Primitive ${index} has invalid bounds:`, bounds);
                return;
            }
            
            minX = Math.min(minX, bounds.minX);
            minY = Math.min(minY, bounds.minY);
            maxX = Math.max(maxX, bounds.maxX);
            maxY = Math.max(maxY, bounds.maxY);
        });
        
        this.bounds = { minX, minY, maxX, maxY };
        this.debug('Calculated plotter bounds:', this.bounds);
    }
    
    /**
     * Plot drill data - drill holes are always fill-only
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
        
        drillData.drillData.holes.forEach((hole, index) => {
            if (!hole.position || typeof hole.position.x !== 'number' || typeof hole.position.y !== 'number' ||
                !isFinite(hole.position.x) || !isFinite(hole.position.y)) {
                console.warn(`Invalid drill hole ${index}:`, hole);
                return;
            }
            
            // DRILL HOLES: Always fill, no stroke
            const primitive = new CirclePrimitive(
                hole.position,
                hole.diameter / 2,
                {
                    // Drill identification
                    isDrillHole: true,
                    
                    // DRILLS: Fill only, no stroke
                    fill: true,
                    stroke: false,
                    strokeWidth: 0,
                    
                    // Other properties
                    type: 'drill',
                    tool: hole.tool,
                    plated: hole.plated,
                    diameter: hole.diameter
                }
            );
            
            drillPrimitives.push(primitive);
        });
        
        this.debug(`Plotted ${drillPrimitives.length} drill holes`);
        
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