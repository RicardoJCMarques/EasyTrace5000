// Fixed Gerber Parser - Proper Region and Fill Area Handling
// parsers/gerber.js

class GerberPolygonParser {
    constructor(options = {}) {
        this.options = {
            debug: options.debug || false,
            units: 'mm', // Will be overridden by file
            coordinateFormat: { x: [2, 4], y: [2, 4] }, // [integer, decimal] digits
            ...options
        };
        
        // Parser state
        this.apertures = new Map(); // D-code -> aperture definition
        this.currentTool = null;
        this.currentPos = { x: 0, y: 0 };
        this.regionMode = false;
        this.regionPoints = [];
        this.interpolationMode = 'linear'; // linear, cw_arc, ccw_arc
        
        // FIXED: Enhanced state tracking for regions and fills
        this.regionDepth = 0; // Track nested regions
        this.currentRegionType = 'copper_fill'; // copper_fill, void_area
        this.layerPolarity = 'positive'; // positive (copper), negative (void)
        
        // Results with enhanced classification
        this.polygons = [];
        this.regionPolygons = []; // FIXED: Separate tracking for regions
        this.tracePolygons = []; // FIXED: Separate tracking for traces
        this.errors = [];
        this.warnings = []; 
        this.stats = {
            apertures: 0,
            flashes: 0,
            traces: 0,
            regions: 0,
            copperFills: 0,
            voidAreas: 0,
            arcs: 0
        };
        
        this.debug('Fixed GerberPolygonParser initialized - Enhanced region handling');
    }
    
    parse(content) {
        try {
            this.debug('Starting Gerber parsing with enhanced region detection...');
            
            // Reset state
            this.apertures.clear();
            this.polygons = [];
            this.regionPolygons = [];
            this.tracePolygons = [];
            this.errors = [];
            this.warnings = [];
            this.currentPos = { x: 0, y: 0 };
            this.regionMode = false;
            this.regionDepth = 0;
            this.layerPolarity = 'positive';
            
            // Split into commands
            const commands = this.preprocessContent(content);
            
            // Parse each command
            for (const command of commands) {
                this.parseCommand(command.trim());
            }
            
            // Finalize any open region
            if (this.regionMode && this.regionPoints.length > 0) {
                this.finalizeRegion();
            }
            
            // FIXED: Analyze and classify all polygons
            this.classifyPolygonTypes();
            this.detectEmptyAreas();
            
            this.debug(`Parsing complete: ${this.polygons.length} total polygons`);
            this.debug(`  - ${this.stats.regions} regions (${this.stats.copperFills} fills, ${this.stats.voidAreas} voids)`);
            this.debug(`  - ${this.stats.traces} traces, ${this.stats.flashes} flashes`);
            
            // Return enhanced results
            return {
                polygons: this.polygons,
                regionPolygons: this.regionPolygons, // FIXED: Separate region collection
                tracePolygons: this.tracePolygons, // FIXED: Separate trace collection
                errors: this.errors.filter(this.isCriticalError),
                warnings: this.warnings,
                stats: this.stats,
                bounds: PolygonUtils.calculateBounds(this.polygons)
            };
            
        } catch (error) {
            this.errors.push(`Parse error: ${error.message}`);
            console.error('Gerber parsing failed:', error);
            return {
                polygons: this.polygons,
                regionPolygons: this.regionPolygons,
                tracePolygons: this.tracePolygons,
                errors: this.errors,
                warnings: this.warnings,
                stats: this.stats
            };
        }
    }
    
    // FIXED: Enhanced command parsing with region awareness
    parseCommand(command) {
        if (!command) return;
        
        // Track important commands for debugging
        const isImportant = command.startsWith('FS') || command.startsWith('MO') || 
                           command.startsWith('ADD') || command.match(/^D\d+$/) ||
                           command === 'G36' || command === 'G37' ||
                           command.startsWith('LP') || command.startsWith('LN');
        
        if (isImportant) {
            this.debug(`Command: ${command}`);
        }
        
        // Format specification commands
        if (command.startsWith('FS')) {
            this.parseFormatSpec(command);
        }
        // Units specification
        else if (command === 'MOMM') {
            this.options.units = 'mm';
            this.debug('Units set to mm');
        }
        else if (command === 'MOIN') {
            this.options.units = 'inch';
            this.debug('Units set to inch');
        }
        // FIXED: Layer polarity (positive=copper, negative=void)
        else if (command.startsWith('LP')) {
            this.parseLayerPolarity(command);
        }
        // Layer name (can help identify layer purpose)
        else if (command.startsWith('LN')) {
            this.parseLayerName(command);
        }
        // Aperture definition
        else if (command.startsWith('ADD')) {
            this.parseApertureDefinition(command);
        }
        // Tool selection
        else if (command.match(/^D\d+$/)) {
            this.selectTool(command);
        }
        // G-codes (graphics commands)
        else if (command.startsWith('G')) {
            this.parseGCode(command);
        }
        // Coordinate commands
        else if (command.match(/[XY]/)) {
            this.parseCoordinate(command);
        }
        // FIXED: Enhanced region commands
        else if (command === 'G36') {
            this.startRegion();
        }
        else if (command === 'G37') {
            this.endRegion();
        }
        // Handle known safe commands
        else if (this.isKnownSafeCommand(command)) {
            this.debug(`Safe command ignored: ${command}`);
        }
        // Only report truly unknown commands
        else if (command.length > 2) {
            this.warnings.push(`Unknown command: ${command}`);
            this.debug(`Unknown command: ${command}`);
        }
    }
    
    // FIXED: Parse layer polarity
    parseLayerPolarity(command) {
        if (command === 'LPD') {
            this.layerPolarity = 'positive'; // Dark/positive = copper
            this.debug('Layer polarity: positive (copper)');
        } else if (command === 'LPC') {
            this.layerPolarity = 'negative'; // Clear/negative = void
            this.debug('Layer polarity: negative (void)');
        }
    }
    
    // Parse layer name for context
    parseLayerName(command) {
        const name = command.substring(2);
        this.debug(`Layer name: ${name}`);
        
        // Use layer name to infer content type
        const lowerName = name.toLowerCase();
        if (lowerName.includes('copper') || lowerName.includes('signal')) {
            this.layerPolarity = 'positive';
        }
    }
    
    // FIXED: Enhanced region handling
    startRegion() {
        this.regionMode = true;
        this.regionPoints = [];
        this.regionDepth++;
        
        // Determine region type based on polarity and context
        if (this.layerPolarity === 'negative') {
            this.currentRegionType = 'void_area';
        } else {
            this.currentRegionType = 'copper_fill';
        }
        
        this.debug(`Started region (depth ${this.regionDepth}, type: ${this.currentRegionType})`);
    }
    
    // FIXED: Enhanced region finalization
    endRegion() {
        this.finalizeRegion();
        this.regionMode = false;
        this.regionDepth = Math.max(0, this.regionDepth - 1);
        this.debug(`Ended region (depth now ${this.regionDepth})`);
    }
    
    // FIXED: Enhanced region finalization with proper classification
    finalizeRegion() {
        if (this.regionPoints.length >= 3) {
            const polygon = new CopperPolygon(this.regionPoints, {
                source: 'region',
                type: this.currentRegionType, // FIXED: Proper type classification
                regionType: this.currentRegionType,
                polarity: this.layerPolarity,
                isRegion: true, // FIXED: Mark as region
                isFill: this.currentRegionType === 'copper_fill', // FIXED: Mark fills
                isVoid: this.currentRegionType === 'void_area' // FIXED: Mark voids
            });
            
            if (polygon.isValid()) {
                polygon.ensureClosed();
                this.polygons.push(polygon);
                this.regionPolygons.push(polygon); // FIXED: Add to region collection
                
                this.stats.regions++;
                if (this.currentRegionType === 'copper_fill') {
                    this.stats.copperFills++;
                } else {
                    this.stats.voidAreas++;
                }
                
                this.debug(`Created ${this.currentRegionType} region with ${this.regionPoints.length} points`);
            } else {
                this.errors.push(`Invalid region with ${this.regionPoints.length} points`);
            }
        } else if (this.regionPoints.length > 0) {
            this.warnings.push(`Region has only ${this.regionPoints.length} points, skipping`);
        }
        
        this.regionPoints = [];
    }
    
    // FIXED: Enhanced flash polygon creation with proper classification
    createFlashPolygon(position) {
        // Create default tool if needed
        if (!this.currentTool || !this.apertures.has(this.currentTool)) {
            if (!this.currentTool) {
                this.currentTool = 'D10';
                this.apertures.set(this.currentTool, {
                    type: 'circle',
                    diameter: 0.1
                });
                this.warnings.push(`Created default tool ${this.currentTool} for flash operation`);
            }
        }
        
        const aperture = this.apertures.get(this.currentTool);
        let polygon;
        
        if (aperture.type === 'circle') {
            polygon = PolygonFactory.createCircle(
                position.x, 
                position.y, 
                aperture.diameter / 2
            );
        } else if (aperture.type === 'rectangle') {
            polygon = PolygonFactory.createRectangle(
                position.x - aperture.width / 2,
                position.y - aperture.height / 2,
                aperture.width,
                aperture.height
            );
        } else if (aperture.type === 'obround') {
            polygon = PolygonFactory.createObround(
                position.x - aperture.width / 2,
                position.y - aperture.height / 2,
                aperture.width,
                aperture.height
            );
        }
        
        if (polygon && polygon.isValid()) {
            // FIXED: Enhanced classification for flashes
            polygon.properties.source = 'flash';
            polygon.properties.aperture = this.currentTool;
            polygon.properties.type = this.classifyFlashType(aperture, position);
            polygon.properties.polarity = this.layerPolarity;
            polygon.properties.isFlash = true;
            polygon.properties.isFill = true; // Flashes are solid fills
            
            this.polygons.push(polygon);
            this.stats.flashes++;
            this.debug(`Flash created: ${aperture.type} at (${position.x.toFixed(3)}, ${position.y.toFixed(3)})`);
        } else {
            this.errors.push(`Failed to create flash polygon at ${position.x}, ${position.y}`);
        }
    }
    
    // FIXED: Enhanced trace polygon creation
    createTracePolygon(startPos, endPos) {
        // Create default tool if needed
        if (!this.currentTool || !this.apertures.has(this.currentTool)) {
            if (!this.currentTool) {
                this.currentTool = 'D10';
                this.apertures.set(this.currentTool, {
                    type: 'circle',
                    diameter: 0.1
                });
                this.warnings.push(`Created default tool ${this.currentTool} for trace operation`);
            }
        }
        
        // Skip zero-length traces
        const dx = endPos.x - startPos.x;
        const dy = endPos.y - startPos.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length < 0.001) {
            return;
        }
        
        const aperture = this.apertures.get(this.currentTool);
        let width = aperture.diameter || aperture.width || 0.1;
        
        let polygon;
        
        if (this.interpolationMode === 'linear') {
            polygon = PolygonFactory.createStroke(startPos, endPos, width);
            this.stats.traces++;
        } else if (this.interpolationMode === 'cw_arc' || this.interpolationMode === 'ccw_arc') {
            // For now, approximate arcs as linear segments
            polygon = PolygonFactory.createStroke(startPos, endPos, width);
            this.stats.arcs++;
            this.debug('Arc approximated as linear segment');
        }
        
        if (polygon && polygon.isValid()) {
            // FIXED: Enhanced classification for traces
            polygon.properties.source = 'trace';
            polygon.properties.aperture = this.currentTool;
            polygon.properties.interpolation = this.interpolationMode;
            polygon.properties.type = this.classifyTraceType(width, length);
            polygon.properties.polarity = this.layerPolarity;
            polygon.properties.isTrace = true;
            polygon.properties.isFill = true; // Traces are solid fills
            polygon.properties.width = width;
            polygon.properties.length = length;
            
            this.polygons.push(polygon);
            this.tracePolygons.push(polygon); // FIXED: Add to trace collection
            this.debug(`Trace created: ${length.toFixed(3)}mm, width ${width.toFixed(3)}mm`);
        } else {
            this.errors.push(`Failed to create trace polygon from ${startPos.x},${startPos.y} to ${endPos.x},${endPos.y}`);
        }
    }
    
    // FIXED: Classify flash types for better handling
    classifyFlashType(aperture, position) {
        const size = aperture.diameter || Math.max(aperture.width || 0, aperture.height || 0);
        
        if (size <= 0.3) {
            return 'via'; // Small circular pads
        } else if (size <= 1.0) {
            return 'pad'; // Component pads
        } else if (aperture.type === 'rectangle' && (aperture.width > aperture.height * 2 || aperture.height > aperture.width * 2)) {
            return 'connector_pad'; // Elongated pads
        } else {
            return 'large_pad'; // Large pads or test points
        }
    }
    
    // FIXED: Classify trace types
    classifyTraceType(width, length) {
        if (width <= 0.15) {
            return 'signal_trace'; // Thin signal traces
        } else if (width <= 0.3) {
            return 'power_trace'; // Medium power traces
        } else if (width >= 0.5) {
            return 'thick_trace'; // Thick power traces
        } else if (length < width * 3) {
            return 'short_trace'; // Very short connections
        } else {
            return 'trace'; // Standard traces
        }
    }
    
    // FIXED: Post-processing to classify polygon relationships
    classifyPolygonTypes() {
        this.debug('Classifying polygon types and relationships...');
        
        // Group polygons by type
        const regions = this.polygons.filter(p => p.properties.isRegion);
        const traces = this.polygons.filter(p => p.properties.isTrace);
        const flashes = this.polygons.filter(p => p.properties.isFlash);
        
        // Mark large regions as fills
        regions.forEach(region => {
            const area = region.getArea();
            if (area > 1.0) { // Areas larger than 1mm²
                region.properties.isCopperFill = true;
                region.properties.fillArea = area;
            }
        });
        
        // Detect filled areas that might be intersected by traces
        this.detectFilledAreas();
        
        this.debug(`Classification complete: ${regions.length} regions, ${traces.length} traces, ${flashes.length} flashes`);
    }
    
    // FIXED: Detect filled areas and mark for preservation
    detectFilledAreas() {
        const regions = this.polygons.filter(p => p.properties.isRegion && p.properties.isFill);
        
        regions.forEach(region => {
            const area = region.getArea();
            const bounds = region.getBounds();
            const aspectRatio = bounds ? (Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 
                                         Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)) : 1;
            
            // Mark as important fill area to preserve through fusion
            if (area > 0.5 && aspectRatio < 10) {
                region.properties.preserveFill = true;
                region.properties.fillImportance = 'high';
            }
        });
    }
    
    // FIXED: Detect empty areas (holes cut out of copper)
    detectEmptyAreas() {
        this.debug('Detecting empty areas and cutouts...');
        
        // Look for negative polarity regions
        const voidRegions = this.polygons.filter(p => 
            p.properties.polarity === 'negative' || 
            p.properties.isVoid
        );
        
        voidRegions.forEach(voidRegion => {
            voidRegion.properties.isEmpty = true;
            voidRegion.properties.cutoutArea = voidRegion.getArea();
            this.debug(`Detected void area: ${voidRegion.properties.cutoutArea.toFixed(3)}mm²`);
        });
        
        // Look for enclosed areas that might be cutouts (like letters)
        this.detectEnclosedCutouts();
    }
    
    // FIXED: Detect areas enclosed by traces that should be treated as cutouts
    detectEnclosedCutouts() {
        // This is a simplified heuristic - in practice, this would need sophisticated analysis
        const traces = this.polygons.filter(p => p.properties.isTrace);
        
        // Group traces that might form closed shapes
        // For now, just mark thin trace regions as potential cutouts
        traces.forEach(trace => {
            if (trace.properties.width && trace.properties.width <= 0.2) {
                const area = trace.getArea();
                const perimeter = this.estimatePerimeter(trace);
                
                // If it's very thin relative to its perimeter, it might outline a cutout
                if (perimeter > 0 && area / perimeter < 0.1) {
                    trace.properties.possibleCutoutOutline = true;
                }
            }
        });
    }
    
    // Helper to estimate polygon perimeter
    estimatePerimeter(polygon) {
        if (!polygon.points || polygon.points.length < 2) return 0;
        
        let perimeter = 0;
        for (let i = 0; i < polygon.points.length - 1; i++) {
            const p1 = polygon.points[i];
            const p2 = polygon.points[i + 1];
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            perimeter += Math.sqrt(dx * dx + dy * dy);
        }
        return perimeter;
    }
    
    // Filter critical errors vs warnings
    isCriticalError(error) {
        return error.includes('Failed to') || 
               error.includes('Invalid') ||
               error.includes('Parse error');
    }
    
    // [Rest of the existing parsing methods remain the same - format spec, aperture def, etc.]
    
    preprocessContent(content) {
        return content
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .split(/[*%]/)
            .map(cmd => cmd.trim())
            .filter(cmd => cmd.length > 0);
    }
    
    isKnownSafeCommand(command) {
        const safePatterns = [
            /^G\d+$/, /^M\d+$/, /^G04/, /^LN/, /^LP/, /^LM/, /^LR/, /^LS/, 
            /^SR/, /^AB/, /^AM/, /^TA/, /^TO/, /^TF/, /^TD/, /^%/, ''
        ];
        
        return safePatterns.some(pattern => pattern.test(command));
    }
    
    parseFormatSpec(command) {
        const match = command.match(/FSLAX(\d)(\d)Y(\d)(\d)/);
        if (match) {
            this.options.coordinateFormat = {
                x: [parseInt(match[1]), parseInt(match[2])],
                y: [parseInt(match[3]), parseInt(match[4])]
            };
            this.debug(`Coordinate format: X${match[1]}.${match[2]} Y${match[3]}.${match[4]}`);
        } else {
            this.warnings.push(`Could not parse format specification: ${command}`);
        }
    }
    
    parseApertureDefinition(command) {
        const match = command.match(/ADD(\d+)([CRO]),([0-9.]+)(?:[X]([0-9.]+))?/);
        if (!match) {
            this.errors.push(`Invalid aperture definition: ${command}`);
            return;
        }
        
        const dCode = `D${match[1]}`;
        const shape = match[2];
        const diameter = parseFloat(match[3]);
        const width = match[4] ? parseFloat(match[4]) : diameter;
        
        if (diameter <= 0 || width <= 0) {
            this.errors.push(`Invalid aperture dimensions: ${command}`);
            return;
        }
        
        let aperture;
        if (shape === 'C') {
            aperture = { type: 'circle', diameter: diameter };
        } else if (shape === 'R') {
            aperture = { type: 'rectangle', width: diameter, height: width };
        } else if (shape === 'O') {
            aperture = { type: 'obround', width: diameter, height: width };
        }
        
        this.apertures.set(dCode, aperture);
        this.stats.apertures++;
        this.debug(`Aperture ${dCode}: ${shape} ${diameter}${width !== diameter ? 'x' + width : ''}`);
    }
    
    selectTool(dCode) {
        if (this.apertures.has(dCode)) {
            this.currentTool = dCode;
            this.debug(`Selected tool: ${dCode}`);
        } else {
            this.warnings.push(`Tool ${dCode} not defined (will create default if used)`);
        }
    }
    
    parseGCode(command) {
        if (command === 'G01') {
            this.interpolationMode = 'linear';
        } else if (command === 'G02') {
            this.interpolationMode = 'cw_arc';
        } else if (command === 'G03') {
            this.interpolationMode = 'ccw_arc';
        } else if (command.startsWith('G04')) {
            // Comment - ignore silently
        } else {
            this.debug(`Unhandled G-code: ${command}`);
        }
    }
    
    parseCoordinate(command) {
        const newPos = this.parseCoordinateValues(command);
        const operation = this.getOperation(command);
        
        switch (operation) {
            case 'D01': // Draw (interpolate)
                if (this.regionMode) {
                    this.addRegionPoint(newPos);
                } else {
                    this.createTracePolygon(this.currentPos, newPos);
                }
                break;
                
            case 'D02': // Move
                break;
                
            case 'D03': // Flash
                this.createFlashPolygon(newPos);
                break;
        }
        
        this.currentPos = newPos;
    }
    
    parseCoordinateValues(command) {
        const pos = { ...this.currentPos };
        
        const xMatch = command.match(/X([+-]?\d+)/);
        if (xMatch) {
            pos.x = this.parseCoordinateValue(xMatch[1], 'x');
        }
        
        const yMatch = command.match(/Y([+-]?\d+)/);
        if (yMatch) {
            pos.y = this.parseCoordinateValue(yMatch[1], 'y');
        }
        
        return pos;
    }
    
    parseCoordinateValue(value, axis) {
        const format = this.options.coordinateFormat[axis];
        const integerDigits = format[0];
        const decimalDigits = format[1];
        
        const isNegative = value.startsWith('-');
        const absValue = isNegative ? value.substring(1) : value;
        
        const totalDigits = integerDigits + decimalDigits;
        const paddedValue = absValue.padStart(totalDigits, '0');
        
        const integerPart = paddedValue.slice(0, integerDigits);
        const decimalPart = paddedValue.slice(integerDigits);
        
        let coordinate = parseFloat(`${integerPart}.${decimalPart}`);
        
        if (isNegative) {
            coordinate = -coordinate;
        }
        
        if (this.options.units === 'inch') {
            coordinate *= 25.4;
        }
        
        return coordinate;
    }
    
    getOperation(command) {
        if (command.includes('D01')) return 'D01';
        if (command.includes('D02')) return 'D02';
        if (command.includes('D03')) return 'D03';
        return 'D01';
    }
    
    addRegionPoint(point) {
        this.regionPoints.push({ ...point });
    }
    
    debug(message, data = null) {
        if (this.options.debug) {
            if (message.includes('Command:') || message.includes('Ignored command:')) {
                return;
            }
            if (data) {
                console.log(`[Gerber] ${message}`, data);
            } else {
                console.log(`[Gerber] ${message}`);
            }
        }
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GerberPolygonParser;
} else {
    window.GerberPolygonParser = GerberPolygonParser;
}