// Gerber Plotter - FIXED: Enhanced region perimeter detection and deduplication
// plotter/gerber-plotter.js

class GerberPlotter {
    constructor(options = {}) {
        this.options = {
            debug: options.debug || false,
            ...options
        };
        
        this.primitives = [];
        this.bounds = null;
        
        // FIXED: Enhanced tracking for deduplication
        this.creationStats = {
            regionsFromRegionObjects: 0,
            drawsFromDrawObjects: 0,
            flashesFromFlashObjects: 0,
            skippedDrawsInRegions: 0,
            duplicatePerimetersRemoved: 0
        };
        
        // Track regions for perimeter detection
        this.regionData = [];
    }
    
    plot(gerberData) {
        if (!gerberData || !gerberData.layers) {
            return {
                success: false,
                error: 'Invalid Gerber data',
                primitives: []
            };
        }
        
        this.debug('FIXED: Starting Gerber plotting with enhanced deduplication...');
        
        // Reset
        this.primitives = [];
        this.bounds = null;
        this.regionData = [];
        this.creationStats = {
            regionsFromRegionObjects: 0,
            drawsFromDrawObjects: 0,
            flashesFromFlashObjects: 0,
            skippedDrawsInRegions: 0,
            duplicatePerimetersRemoved: 0
        };
        
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
        this.debug('Object types from parser:', objectTypes);
        
        // First pass: collect all regions with detailed data
        gerberData.layers.objects.forEach((obj, index) => {
            if (obj.type === 'region') {
                const regionInfo = this.extractRegionInfo(obj, index);
                if (regionInfo) {
                    this.regionData.push(regionInfo);
                }
            }
        });
        
        this.debug(`Found ${this.regionData.length} regions for perimeter analysis`);
        
        // Process each object
        gerberData.layers.objects.forEach((obj, index) => {
            try {
                this.debug(`Processing object ${index + 1}/${gerberData.layers.objects.length}: ${obj.type}`);
                
                // VALIDATION: Check coordinate validity before plotting
                if (!this.validateObjectCoordinates(obj)) {
                    console.warn(`[GerberPlotter-FIXED] Invalid coordinates in object ${index}:`, obj);
                    return;
                }
                
                // FIXED: Enhanced perimeter detection
                if (obj.type === 'draw' && this.regionData.length > 0) {
                    if (this.isDrawPartOfRegionPerimeter(obj)) {
                        this.creationStats.skippedDrawsInRegions++;
                        this.debug(`FIXED: Skipping draw ${index} - matches region perimeter`);
                        return;
                    }
                }
                
                const primitive = this.plotObject(obj);
                if (primitive) {
                    // VALIDATION: Check primitive coordinates after creation
                    const bounds = primitive.getBounds();
                    if (!isFinite(bounds.minX) || !isFinite(bounds.minY) || 
                        !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                        console.warn(`[GerberPlotter-FIXED] Primitive ${index} has invalid bounds:`, bounds);
                        return;
                    }
                    
                    this.primitives.push(primitive);
                    this.debug(`FIXED: Created ${primitive.type} primitive`);
                } else {
                    this.debug(`No primitive created for object ${index}`);
                }
            } catch (error) {
                console.error(`Error plotting object ${index}:`, error);
            }
        });
        
        // FIXED: Post-process to remove any remaining duplicate perimeters
        this.deduplicateRegionPerimeters();
        
        // Calculate overall bounds
        this.calculateBounds();
        
        // Report statistics
        this.debug('FIXED: Plotting Statistics:');
        this.debug(`  Regions created: ${this.creationStats.regionsFromRegionObjects}`);
        this.debug(`  Draws created: ${this.creationStats.drawsFromDrawObjects}`);
        this.debug(`  Flashes created: ${this.creationStats.flashesFromFlashObjects}`);
        this.debug(`  Draws skipped (region perimeters): ${this.creationStats.skippedDrawsInRegions}`);
        this.debug(`  Duplicate perimeters removed: ${this.creationStats.duplicatePerimetersRemoved}`);
        
        this.debug(`FIXED: Plotting complete: ${this.primitives.length} primitives created`);
        
        return {
            success: true,
            primitives: this.primitives,
            bounds: this.bounds,
            units: gerberData.layers.units,
            creationStats: this.creationStats
        };
    }
    
    // FIXED: Extract detailed region information for perimeter matching
    extractRegionInfo(region, index) {
        if (!region.points || region.points.length < 3) return null;
        
        const segments = [];
        for (let i = 0; i < region.points.length - 1; i++) {
            segments.push({
                start: { ...region.points[i] },
                end: { ...region.points[i + 1] }
            });
        }
        
        // Add closing segment if not already closed
        const first = region.points[0];
        const last = region.points[region.points.length - 1];
        if (Math.abs(first.x - last.x) > 0.001 || Math.abs(first.y - last.y) > 0.001) {
            segments.push({
                start: { ...last },
                end: { ...first }
            });
        }
        
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        region.points.forEach(point => {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        });
        
        return {
            index: index,
            bounds: { minX, minY, maxX, maxY },
            segments: segments,
            points: region.points.map(p => ({...p})), // FIXED: Include points for vertex checking
            pointCount: region.points.length
        };
    }
    
    // FIXED: More aggressive check if a draw is part of any region perimeter
    isDrawPartOfRegionPerimeter(draw) {
        const tolerance = 0.05; // 50 micron tolerance - more aggressive
        
        for (const regionInfo of this.regionData) {
            // Quick bounds check first
            const drawMinX = Math.min(draw.start.x, draw.end.x);
            const drawMaxX = Math.max(draw.start.x, draw.end.x);
            const drawMinY = Math.min(draw.start.y, draw.end.y);
            const drawMaxY = Math.max(draw.start.y, draw.end.y);
            
            // If draw is completely outside region bounds (with tolerance), skip
            if (drawMaxX < regionInfo.bounds.minX - tolerance ||
                drawMinX > regionInfo.bounds.maxX + tolerance ||
                drawMaxY < regionInfo.bounds.minY - tolerance ||
                drawMinY > regionInfo.bounds.maxY + tolerance) {
                continue;
            }
            
            // Check if draw matches any segment of this region
            for (const segment of regionInfo.segments) {
                // Check exact match
                if (this.segmentsMatch(draw.start, draw.end, segment.start, segment.end, tolerance)) {
                    this.debug(`Draw matches region ${regionInfo.index} segment exactly`);
                    return true;
                }
                
                // Check if draw is a subsegment of a region edge (partial perimeter)
                if (this.isDrawOnSegment(draw.start, draw.end, segment.start, segment.end, tolerance)) {
                    this.debug(`Draw is on region ${regionInfo.index} segment`);
                    return true;
                }
                
                // FIXED: Also check if draw endpoints are very close to region vertices
                for (const point of regionInfo.points || []) {
                    const distStart = Math.sqrt(
                        Math.pow(draw.start.x - point.x, 2) + 
                        Math.pow(draw.start.y - point.y, 2)
                    );
                    const distEnd = Math.sqrt(
                        Math.pow(draw.end.x - point.x, 2) + 
                        Math.pow(draw.end.y - point.y, 2)
                    );
                    
                    // If both endpoints are near region vertices, likely a perimeter
                    if (distStart < tolerance && distEnd < tolerance * 10) {
                        this.debug(`Draw endpoints near region vertices`);
                        return true;
                    }
                }
            }
        }
        
        return false;
    }
    
    // Check if two segments match (considering both directions)
    segmentsMatch(p1Start, p1End, p2Start, p2End, tolerance) {
        // Forward direction
        const forwardMatch = 
            Math.abs(p1Start.x - p2Start.x) < tolerance &&
            Math.abs(p1Start.y - p2Start.y) < tolerance &&
            Math.abs(p1End.x - p2End.x) < tolerance &&
            Math.abs(p1End.y - p2End.y) < tolerance;
            
        // Reverse direction
        const reverseMatch = 
            Math.abs(p1Start.x - p2End.x) < tolerance &&
            Math.abs(p1Start.y - p2End.y) < tolerance &&
            Math.abs(p1End.x - p2Start.x) < tolerance &&
            Math.abs(p1End.y - p2Start.y) < tolerance;
            
        return forwardMatch || reverseMatch;
    }
    
    // Check if a draw lies on a segment (for partial perimeter detection)
    isDrawOnSegment(drawStart, drawEnd, segStart, segEnd, tolerance) {
        // Check if both draw points are on the line defined by the segment
        const crossProduct = (p1, p2, p3) => {
            return (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
        };
        
        // Check if drawStart is on the line
        const cp1 = Math.abs(crossProduct(segStart, segEnd, drawStart));
        if (cp1 > tolerance) return false;
        
        // Check if drawEnd is on the line
        const cp2 = Math.abs(crossProduct(segStart, segEnd, drawEnd));
        if (cp2 > tolerance) return false;
        
        // Check if draw points are within segment bounds
        const minX = Math.min(segStart.x, segEnd.x) - tolerance;
        const maxX = Math.max(segStart.x, segEnd.x) + tolerance;
        const minY = Math.min(segStart.y, segEnd.y) - tolerance;
        const maxY = Math.max(segStart.y, segEnd.y) + tolerance;
        
        return drawStart.x >= minX && drawStart.x <= maxX &&
               drawStart.y >= minY && drawStart.y <= maxY &&
               drawEnd.x >= minX && drawEnd.x <= maxX &&
               drawEnd.y >= minY && drawEnd.y <= maxY;
    }
    
    // FIXED: Post-processing to remove any duplicate perimeters that slipped through
    deduplicateRegionPerimeters() {
        const regions = this.primitives.filter(p => p.properties?.isRegion);
        const strokes = this.primitives.filter(p => p.properties?.isStroke);
        
        if (regions.length === 0 || strokes.length === 0) {
            return; // Nothing to deduplicate
        }
        
        const indicesToRemove = new Set();
        
        regions.forEach(region => {
            if (region.type !== 'path' || !region.points) return;
            
            // Create segments from region
            const regionSegments = [];
            for (let i = 0; i < region.points.length - 1; i++) {
                regionSegments.push({
                    start: region.points[i],
                    end: region.points[i + 1]
                });
            }
            
            strokes.forEach((stroke, strokeIndex) => {
                if (stroke.type === 'path' && stroke.points && stroke.points.length >= 2) {
                    // Check if stroke path matches any part of region perimeter
                    for (let i = 0; i < stroke.points.length - 1; i++) {
                        const strokeSeg = {
                            start: stroke.points[i],
                            end: stroke.points[i + 1]
                        };
                        
                        for (const regionSeg of regionSegments) {
                            if (this.segmentsMatch(strokeSeg.start, strokeSeg.end, 
                                                  regionSeg.start, regionSeg.end, 0.01)) {
                                indicesToRemove.add(strokeIndex);
                                break;
                            }
                        }
                    }
                }
            });
        });
        
        if (indicesToRemove.size > 0) {
            // Filter out duplicate strokes
            const originalCount = this.primitives.length;
            this.primitives = this.primitives.filter((p, i) => {
                if (indicesToRemove.has(i)) {
                    this.creationStats.duplicatePerimetersRemoved++;
                    return false;
                }
                return true;
            });
            
            this.debug(`FIXED: Removed ${indicesToRemove.size} duplicate perimeter strokes in post-processing`);
        }
    }
    
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
                this.creationStats.regionsFromRegionObjects++;
                return this.plotRegion(obj);
            case 'draw':
                this.creationStats.drawsFromDrawObjects++;
                return this.plotDraw(obj);
            case 'flash':
                this.creationStats.flashesFromFlashObjects++;
                return this.plotFlash(obj);
            default:
                this.debug(`Unknown object type: ${obj.type}`);
                return null;
        }
    }
    
    plotRegion(region) {
        this.debug(`FIXED: Plotting region with ${region.points.length} points`);
        
        // Validate region
        if (!region.points || region.points.length < 3) {
            console.warn('[GerberPlotter-FIXED] Region has too few points:', region);
            return null;
        }
        
        // FIXED: Regions are ONLY filled polygons with NO stroke
        const properties = {
            fill: true,
            stroke: false,  // CRITICAL: No stroke for regions
            polarity: region.polarity,
            function: region.function,
            fillRule: 'nonzero',
            isRegion: true,
            isStroke: false,
            noPerimeterStroke: true
        };
        
        // Check if this is a non-conductor region
        if (region.function === 'NonConductor' || region.function === 'Keepout') {
            properties.isNonConductor = true;
            this.debug('Region marked as non-conductor');
        }
        
        // Create primitive with original coordinates
        const primitive = new PathPrimitive(region.points, properties);
        
        this.debug(`FIXED: Successfully created region primitive (fill-only, no stroke)`);
        
        return primitive;
    }
    
    plotDraw(draw) {
        const aperture = this.apertures.get(draw.aperture);
        if (!aperture) {
            this.debug(`Missing aperture: ${draw.aperture}`);
            return null;
        }
        
        this.debug(`FIXED: Plotting draw from (${draw.start.x.toFixed(3)}, ${draw.start.y.toFixed(3)}) to (${draw.end.x.toFixed(3)}, ${draw.end.y.toFixed(3)})`);
        
        // Determine if this is text or a regular trace
        const apertureSize = aperture.parameters[0];
        const isText = draw.function === 'Legend' || 
                      draw.function === 'NonConductor' ||
                      draw.geometryClass === 'text' ||
                      draw.geometryClass === 'legend' ||
                      apertureSize < 0.15; // Very thin traces are likely text
        
        const properties = {
            fill: true, // Always fill stroke primitives
            stroke: false, // Don't add additional stroke
            polarity: draw.polarity,
            function: draw.function || aperture.function,
            aperture: draw.aperture,
            isStroke: true,
            originalWidth: apertureSize,
            isText: isText
        };
        
        if (draw.interpolation === 'G01') {
            // Linear interpolation
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
            
            this.debug(`FIXED: Plotting arc with center (${draw.center.x.toFixed(3)}, ${draw.center.y.toFixed(3)})`);
            
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
        
        this.debug(`FIXED: Plotting flash at (${flash.position.x.toFixed(3)}, ${flash.position.y.toFixed(3)})`);
        
        const properties = {
            fill: true,
            stroke: false, // FIXED: No stroke for flashes
            polarity: flash.polarity,
            function: flash.function || aperture.function,
            aperture: flash.aperture,
            isFlash: true
        };
        
        switch (aperture.type) {
            case 'circle':
                const radius = aperture.parameters[0] / 2;
                this.debug(`FIXED: Creating circle flash with radius ${radius.toFixed(3)}`);
                return new CirclePrimitive(
                    flash.position,
                    radius,
                    properties
                );
                
            case 'rectangle':
                const width = aperture.parameters[0];
                const height = aperture.parameters[1] || width;
                this.debug(`FIXED: Creating rectangle flash ${width.toFixed(3)} × ${height.toFixed(3)}`);
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
                this.debug(`FIXED: Creating obround flash ${oWidth.toFixed(3)} × ${oHeight.toFixed(3)}`);
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
                this.debug(`FIXED: Creating polygon flash with ${sides} sides`);
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
    
    // Create stroked arc
    createStrokedArc(start, end, center, clockwise, strokeWidth, properties) {
        this.debug(`FIXED: Creating stroked arc`);
        
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
        
        // End cap
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
        
        // FIXED: Ensure arc is filled, not stroked
        return new PathPrimitive(points, { 
            ...properties, 
            closed: true,
            fill: true,
            stroke: false 
        });
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
                console.warn(`[GerberPlotter-FIXED] Primitive ${index} has invalid bounds:`, bounds);
                return;
            }
            
            minX = Math.min(minX, bounds.minX);
            minY = Math.min(minY, bounds.minY);
            maxX = Math.max(maxX, bounds.maxX);
            maxY = Math.max(maxY, bounds.maxY);
        });
        
        this.bounds = { minX, minY, maxX, maxY };
        this.debug('FIXED: Calculated plotter bounds:', this.bounds);
    }
    
    plotDrillData(drillData) {
        if (!drillData || !drillData.drillData) {
            return {
                success: false,
                error: 'Invalid drill data',
                primitives: []
            };
        }
        
        this.debug('FIXED: Plotting drill data...');
        
        const drillPrimitives = [];
        
        drillData.drillData.holes.forEach((hole, index) => {
            // VALIDATION: Check hole data
            if (!hole.position || typeof hole.position.x !== 'number' || typeof hole.position.y !== 'number' ||
                !isFinite(hole.position.x) || !isFinite(hole.position.y)) {
                console.warn(`[GerberPlotter-FIXED] Invalid drill hole ${index}:`, hole);
                return;
            }
            
            this.debug(`FIXED: Plotting drill hole ${index + 1} at (${hole.position.x.toFixed(3)}, ${hole.position.y.toFixed(3)})`);
            
            // Drill holes should be filled circles
            const primitive = new CirclePrimitive(
                hole.position,
                hole.diameter / 2,
                {
                    fill: true,
                    stroke: true, // Keep stroke for drill visualization
                    strokeWidth: 0.05, // Very thin outline
                    type: 'drill',
                    tool: hole.tool,
                    plated: hole.plated,
                    isDrillHole: true,
                    diameter: hole.diameter,
                    renderOnTop: true
                }
            );
            
            drillPrimitives.push(primitive);
        });
        
        this.debug(`FIXED: Plotted ${drillPrimitives.length} drill holes`);
        
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
        
        this.debug('FIXED: Drill bounds:', bounds);
        
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
                console.log(`[GerberPlotter-FIXED] ${message}`, data);
            } else {
                console.log(`[GerberPlotter-FIXED] ${message}`);
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