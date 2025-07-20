// Robust Gerber to Polygon Parser
// Converts Gerber commands directly to CopperPolygon objects

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
        
        // Results
        this.polygons = [];
        this.errors = [];
        this.stats = {
            apertures: 0,
            flashes: 0,
            traces: 0,
            regions: 0,
            arcs: 0
        };
        
        this.debug('GerberPolygonParser initialized');
    }
    
    parse(content) {
        try {
            this.debug('Starting Gerber parsing...');
            
            // Reset state
            this.apertures.clear();
            this.polygons = [];
            this.errors = [];
            this.currentPos = { x: 0, y: 0 };
            this.regionMode = false;
            
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
            
            this.debug(`Parsing complete: ${this.polygons.length} polygons created`);
            this.debug(`Stats:`, this.stats);
            
            return {
                polygons: this.polygons,
                errors: this.errors,
                stats: this.stats,
                bounds: PolygonUtils.calculateBounds(this.polygons)
            };
            
        } catch (error) {
            this.errors.push(`Parse error: ${error.message}`);
            console.error('Gerber parsing failed:', error);
            return {
                polygons: this.polygons,
                errors: this.errors,
                stats: this.stats
            };
        }
    }
    
    preprocessContent(content) {
        // Normalize line endings and split into commands
        return content
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .split(/[*%]/) // Split on command terminators
            .map(cmd => cmd.trim())
            .filter(cmd => cmd.length > 0);
    }
    
    parseCommand(command) {
        if (!command) return;
        
        // Only debug important commands, not every single one
        const isImportant = command.startsWith('FS') || command.startsWith('MO') || 
                           command.startsWith('ADD') || command.match(/^D\d+$/) ||
                           command === 'G36' || command === 'G37';
        
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
        // Region commands
        else if (command === 'G36') {
            this.startRegion();
        }
        else if (command === 'G37') {
            this.endRegion();
        }
        // Ignore other commands
        else {
            this.debug(`Ignored command: ${command}`);
        }
    }
    
    parseFormatSpec(command) {
        // Parse coordinate format: FSLAX34Y34
        const match = command.match(/FSLAX(\d)(\d)Y(\d)(\d)/);
        if (match) {
            this.options.coordinateFormat = {
                x: [parseInt(match[1]), parseInt(match[2])],
                y: [parseInt(match[3]), parseInt(match[4])]
            };
            this.debug(`Coordinate format: X${match[1]}.${match[2]} Y${match[3]}.${match[4]}`);
        }
    }
    
    parseApertureDefinition(command) {
        // Parse aperture: ADD10C,0.152000 or ADD15O,1.700000X1.700000 or ADD13R,2.000000X1.700000
        const match = command.match(/ADD(\d+)([CRO]),([0-9.]+)(?:[X]([0-9.]+))?/);
        if (!match) {
            this.errors.push(`Invalid aperture definition: ${command}`);
            return;
        }
        
        const dCode = `D${match[1]}`;
        const shape = match[2];
        const diameter = parseFloat(match[3]);
        const width = match[4] ? parseFloat(match[4]) : diameter;
        
        let aperture;
        if (shape === 'C') {
            // Circle
            aperture = { type: 'circle', diameter: diameter };
        } else if (shape === 'R') {
            // Rectangle
            aperture = { type: 'rectangle', width: diameter, height: width };
        } else if (shape === 'O') {
            // Obround (oval) - treat as rectangle with rounded corners
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
            this.errors.push(`Unknown tool: ${dCode}`);
        }
    }
    
    parseGCode(command) {
        if (command === 'G01') {
            this.interpolationMode = 'linear';
        } else if (command === 'G02') {
            this.interpolationMode = 'cw_arc';
        } else if (command === 'G03') {
            this.interpolationMode = 'ccw_arc';
        } else if (command === 'G04') {
            // Comment - ignore
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
                // Just update position, no drawing
                break;
                
            case 'D03': // Flash
                this.createFlashPolygon(newPos);
                break;
        }
        
        this.currentPos = newPos;
    }
    
    parseCoordinateValues(command) {
        const pos = { ...this.currentPos };
        
        // Extract X coordinate
        const xMatch = command.match(/X([+-]?\d+)/);
        if (xMatch) {
            pos.x = this.parseCoordinateValue(xMatch[1], 'x');
        }
        
        // Extract Y coordinate
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
        
        // Handle negative values
        const isNegative = value.startsWith('-');
        const absValue = isNegative ? value.substring(1) : value;
        
        // For format like 4.6, we expect total digits = 10 (4 integer + 6 decimal)
        // But the input might not have leading zeros, so we need to pad
        const totalDigits = integerDigits + decimalDigits;
        const paddedValue = absValue.padStart(totalDigits, '0');
        
        const integerPart = paddedValue.slice(0, integerDigits);
        const decimalPart = paddedValue.slice(integerDigits);
        
        let coordinate = parseFloat(`${integerPart}.${decimalPart}`);
        
        if (isNegative) {
            coordinate = -coordinate;
        }
        
        // Convert inches to mm if needed
        if (this.options.units === 'inch') {
            coordinate *= 25.4;
        }
        
        return coordinate;
    }
    
    getOperation(command) {
        if (command.includes('D01')) return 'D01';
        if (command.includes('D02')) return 'D02';
        if (command.includes('D03')) return 'D03';
        return 'D01'; // Default to draw
    }
    
    createFlashPolygon(position) {
        if (!this.currentTool || !this.apertures.has(this.currentTool)) {
            this.errors.push(`Flash without valid tool at ${position.x}, ${position.y}`);
            return;
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
            polygon.properties.source = 'flash';
            polygon.properties.aperture = this.currentTool;
            polygon.properties.type = 'pad';
            this.polygons.push(polygon);
            this.stats.flashes++;
            this.debug(`Flash created: ${aperture.type} at (${position.x.toFixed(3)}, ${position.y.toFixed(3)})`);
        } else {
            this.errors.push(`Failed to create flash polygon at ${position.x}, ${position.y}`);
        }
    }
    
    createTracePolygon(startPos, endPos) {
        if (!this.currentTool || !this.apertures.has(this.currentTool)) {
            this.errors.push(`Trace without valid tool from ${startPos.x},${startPos.y} to ${endPos.x},${endPos.y}`);
            return;
        }
        
        // Skip zero-length traces
        const dx = endPos.x - startPos.x;
        const dy = endPos.y - startPos.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length < 0.001) {
            return; // Skip very short traces
        }
        
        const aperture = this.apertures.get(this.currentTool);
        let width = aperture.diameter || aperture.width || 0.1;
        
        let polygon;
        
        if (this.interpolationMode === 'linear') {
            polygon = PolygonFactory.createStroke(startPos, endPos, width);
            this.stats.traces++;
        } else if (this.interpolationMode === 'cw_arc' || this.interpolationMode === 'ccw_arc') {
            // For now, approximate arcs as linear segments
            // TODO: Implement proper arc tessellation
            polygon = PolygonFactory.createStroke(startPos, endPos, width);
            this.stats.arcs++;
            this.debug('Arc approximated as linear segment');
        }
        
        if (polygon && polygon.isValid()) {
            polygon.properties.source = 'trace';
            polygon.properties.aperture = this.currentTool;
            polygon.properties.interpolation = this.interpolationMode;
            polygon.properties.type = 'trace';
            this.polygons.push(polygon);
            this.debug(`Trace created: ${length.toFixed(3)}mm from (${startPos.x.toFixed(3)}, ${startPos.y.toFixed(3)}) to (${endPos.x.toFixed(3)}, ${endPos.y.toFixed(3)})`);
        } else {
            this.errors.push(`Failed to create trace polygon from ${startPos.x},${startPos.y} to ${endPos.x},${endPos.y}`);
        }
    }
    
    startRegion() {
        this.regionMode = true;
        this.regionPoints = [];
        this.debug('Started region');
    }
    
    endRegion() {
        this.finalizeRegion();
        this.regionMode = false;
        this.debug('Ended region');
    }
    
    addRegionPoint(point) {
        this.regionPoints.push({ ...point });
    }
    
    finalizeRegion() {
        if (this.regionPoints.length >= 3) {
            const polygon = new CopperPolygon(this.regionPoints, {
                source: 'region',
                type: 'region'
            });
            
            if (polygon.isValid()) {
                polygon.ensureClosed();
                this.polygons.push(polygon);
                this.stats.regions++;
                this.debug(`Created region with ${this.regionPoints.length} points`);
            } else {
                this.errors.push(`Invalid region with ${this.regionPoints.length} points`);
            }
        }
        
        this.regionPoints = [];
    }
    
    debug(message, data = null) {
        if (this.options.debug) {
            // Only log important messages, not every command
            if (message.includes('Command:') || message.includes('Ignored command:')) {
                return; // Skip command-level spam
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