// Semantic Gerber Parser - Preserves all Gerber semantics without interpretation
// parsers/gerber-semantic.js

class GerberSemanticParser {
    constructor(options = {}) {
        this.options = {
            units: 'mm',
            format: { integer: 3, decimal: 3 },
            debug: options.debug || false,
            ...options
        };
        
        // Parser state
        this.commands = [];
        this.apertures = new Map();
        this.currentAperture = null;
        this.currentPoint = { x: 0, y: 0 };
        this.interpolationMode = 'G01'; // Linear
        this.regionMode = false;
        this.polarity = 'dark'; // D = dark, C = clear
        this.apertureFunction = null;
        
        // Results
        this.layers = {
            polarity: 'positive',
            units: this.options.units,
            bounds: null,
            apertures: [],
            objects: []
        };
        
        this.errors = [];
        this.warnings = [];
    }
    
    parse(content) {
        try {
            this.debug('Starting semantic Gerber parse...');
            
            // Split into commands
            const blocks = this.splitIntoBlocks(content);
            
            // Process each block
            blocks.forEach((block, index) => {
                this.processBlock(block, index);
            });
            
            // Finalize
            this.finalizeParse();
            
            this.debug(`Parse complete: ${this.layers.objects.length} objects`);
            
            return {
                success: true,
                layers: this.layers,
                errors: this.errors,
                warnings: this.warnings
            };
            
        } catch (error) {
            this.errors.push(`Parse error: ${error.message}`);
            return {
                success: false,
                layers: this.layers,
                errors: this.errors,
                warnings: this.warnings
            };
        }
    }
    
    splitIntoBlocks(content) {
        // Split by % for extended commands and * for standard commands
        const blocks = [];
        let currentBlock = '';
        let inExtended = false;
        
        for (let i = 0; i < content.length; i++) {
            const char = content[i];
            
            if (char === '%') {
                if (inExtended && currentBlock) {
                    blocks.push({ type: 'extended', content: currentBlock.trim() });
                    currentBlock = '';
                }
                inExtended = !inExtended;
            } else if (char === '*' && !inExtended) {
                if (currentBlock.trim()) {
                    blocks.push({ type: 'standard', content: currentBlock.trim() });
                }
                currentBlock = '';
            } else if (char !== '\r' && char !== '\n') {
                currentBlock += char;
            }
        }
        
        return blocks;
    }
    
    processBlock(block, index) {
        if (block.type === 'extended') {
            this.processExtendedCommand(block.content);
        } else {
            this.processStandardCommand(block.content);
        }
    }
    
    processExtendedCommand(command) {
        // Format specification
        if (command.startsWith('FSLAX') || command.startsWith('FSLAY')) {
            this.parseFormatSpec(command);
        }
        // Mode commands
        else if (command === 'MOMM') {
            this.options.units = 'mm';
            this.layers.units = 'mm';
        }
        else if (command === 'MOIN') {
            this.options.units = 'inch';
            this.layers.units = 'inch';
        }
        // Aperture definition
        else if (command.startsWith('AD')) {
            this.parseApertureDefinition(command);
        }
        // Aperture macro (store but don't process yet)
        else if (command.startsWith('AM')) {
            this.parseApertureMacro(command);
        }
        // Layer polarity
        else if (command === 'LPD') {
            this.polarity = 'dark';
        }
        else if (command === 'LPC') {
            this.polarity = 'clear';
        }
        // Aperture attributes
        else if (command.startsWith('TA.AperFunction')) {
            this.apertureFunction = command.substring(16);
        }
        else if (command.startsWith('TD')) {
            this.apertureFunction = null;
        }
    }
    
    processStandardCommand(command) {
        // Select aperture
        if (command.match(/^D\d+$/)) {
            const code = parseInt(command.substring(1));
            if (code >= 10) {
                this.currentAperture = command;
            }
            return;
        }
        
        // Interpolation mode
        if (command === 'G01') {
            this.interpolationMode = 'G01'; // Linear
        } else if (command === 'G02') {
            this.interpolationMode = 'G02'; // Clockwise arc
        } else if (command === 'G03') {
            this.interpolationMode = 'G03'; // Counter-clockwise arc
        }
        
        // Region mode
        else if (command === 'G36') {
            this.regionMode = true;
            this.startRegion();
        } else if (command === 'G37') {
            this.endRegion();
            this.regionMode = false;
        }
        
        // Coordinate data
        else if (command.match(/[XY]/)) {
            this.processCoordinate(command);
        }
        
        // End of file
        else if (command === 'M02') {
            this.debug('End of file');
        }
    }
    
    parseFormatSpec(command) {
        const match = command.match(/FS([LT])([AI])X(\d)(\d)Y(\d)(\d)/);
        if (match) {
            this.options.format = {
                integer: parseInt(match[3]),
                decimal: parseInt(match[4])
            };
            this.debug(`Format: ${match[3]}.${match[4]}`);
        }
    }
    
    parseApertureDefinition(command) {
        const match = command.match(/ADD(\d+)([CROP]),(.+)/);
        if (!match) return;
        
        const code = `D${match[1]}`;
        const type = match[2];
        const params = match[3].split('X').map(p => parseFloat(p));
        
        const aperture = {
            code: code,
            type: this.getApertureTypeName(type),
            parameters: params,
            function: this.apertureFunction
        };
        
        // Store aperture definition
        this.apertures.set(code, aperture);
        this.layers.apertures.push(aperture);
        
        this.debug(`Aperture ${code}: ${aperture.type} [${params.join(', ')}]`);
    }
    
    parseApertureMacro(command) {
        // For now, just store the macro definition
        const name = command.substring(2, command.indexOf('*'));
        this.debug(`Aperture macro: ${name} (stored for future use)`);
    }
    
    getApertureTypeName(code) {
        switch (code) {
            case 'C': return 'circle';
            case 'R': return 'rectangle';
            case 'O': return 'obround';
            case 'P': return 'polygon';
            default: return 'unknown';
        }
    }
    
    startRegion() {
        this.currentRegion = {
            type: 'region',
            polarity: this.polarity,
            points: [],
            function: this.apertureFunction
        };
        
        // Add starting point
        if (this.currentPoint) {
            this.currentRegion.points.push({ ...this.currentPoint });
        }
    }
    
    endRegion() {
        if (this.currentRegion && this.currentRegion.points.length >= 3) {
            // Ensure closed
            const first = this.currentRegion.points[0];
            const last = this.currentRegion.points[this.currentRegion.points.length - 1];
            
            if (first.x !== last.x || first.y !== last.y) {
                this.currentRegion.points.push({ ...first });
            }
            
            this.layers.objects.push(this.currentRegion);
        }
        
        this.currentRegion = null;
    }
    
    processCoordinate(command) {
        const newPoint = this.parseCoordinates(command);
        const operation = this.parseOperation(command);
        
        if (this.regionMode && this.currentRegion) {
            // Add point to current region
            this.currentRegion.points.push(newPoint);
        } else {
            // Create appropriate object based on operation
            switch (operation) {
                case 'D01': // Draw
                    this.createDraw(this.currentPoint, newPoint);
                    break;
                case 'D02': // Move
                    // Just update position
                    break;
                case 'D03': // Flash
                    this.createFlash(newPoint);
                    break;
            }
        }
        
        this.currentPoint = newPoint;
    }
    
    parseCoordinates(command) {
        const point = { ...this.currentPoint };
        
        // Extract X coordinate
        const xMatch = command.match(/X([+-]?\d+)/);
        if (xMatch) {
            point.x = this.parseCoordinateValue(xMatch[1]);
        }
        
        // Extract Y coordinate
        const yMatch = command.match(/Y([+-]?\d+)/);
        if (yMatch) {
            point.y = this.parseCoordinateValue(yMatch[1]);
        }
        
        // Extract I coordinate (arc center X offset)
        const iMatch = command.match(/I([+-]?\d+)/);
        if (iMatch) {
            point.i = this.parseCoordinateValue(iMatch[1]);
        }
        
        // Extract J coordinate (arc center Y offset)
        const jMatch = command.match(/J([+-]?\d+)/);
        if (jMatch) {
            point.j = this.parseCoordinateValue(jMatch[1]);
        }
        
        return point;
    }
    
    parseCoordinateValue(value) {
        const format = this.options.format;
        const negative = value.startsWith('-');
        const absValue = value.replace(/^[+-]/, '');
        
        // Pad with leading zeros
        const totalDigits = format.integer + format.decimal;
        const padded = absValue.padStart(totalDigits, '0');
        
        // Split into integer and decimal parts
        const integerPart = padded.slice(0, format.integer);
        const decimalPart = padded.slice(format.integer);
        
        let coordinate = parseFloat(`${integerPart}.${decimalPart}`);
        if (negative) coordinate = -coordinate;
        
        // Convert to mm if needed
        if (this.options.units === 'inch') {
            coordinate *= 25.4;
        }
        
        return coordinate;
    }
    
    parseOperation(command) {
        if (command.includes('D01')) return 'D01';
        if (command.includes('D02')) return 'D02';
        if (command.includes('D03')) return 'D03';
        return 'D01'; // Default to draw
    }
    
    createDraw(start, end) {
        if (!this.currentAperture) return;
        
        const aperture = this.apertures.get(this.currentAperture);
        if (!aperture) return;
        
        const draw = {
            type: 'draw',
            start: { ...start },
            end: { ...end },
            aperture: this.currentAperture,
            interpolation: this.interpolationMode,
            polarity: this.polarity,
            function: this.apertureFunction || aperture.function
        };
        
        // Add arc center if present
        if (end.i !== undefined || end.j !== undefined) {
            draw.center = {
                x: start.x + (end.i || 0),
                y: start.y + (end.j || 0)
            };
        }
        
        this.layers.objects.push(draw);
    }
    
    createFlash(position) {
        if (!this.currentAperture) return;
        
        const aperture = this.apertures.get(this.currentAperture);
        if (!aperture) return;
        
        const flash = {
            type: 'flash',
            position: { ...position },
            aperture: this.currentAperture,
            polarity: this.polarity,
            function: this.apertureFunction || aperture.function
        };
        
        this.layers.objects.push(flash);
    }
    
    finalizeParse() {
        // Calculate bounds
        this.calculateBounds();
        
        // Sort objects by type for better rendering
        this.layers.objects.sort((a, b) => {
            const typeOrder = { region: 0, draw: 1, flash: 2 };
            return (typeOrder[a.type] || 3) - (typeOrder[b.type] || 3);
        });
    }
    
    calculateBounds() {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        this.layers.objects.forEach(obj => {
            if (obj.type === 'region') {
                obj.points.forEach(point => {
                    minX = Math.min(minX, point.x);
                    minY = Math.min(minY, point.y);
                    maxX = Math.max(maxX, point.x);
                    maxY = Math.max(maxY, point.y);
                });
            } else if (obj.type === 'draw') {
                minX = Math.min(minX, obj.start.x, obj.end.x);
                minY = Math.min(minY, obj.start.y, obj.end.y);
                maxX = Math.max(maxX, obj.start.x, obj.end.x);
                maxY = Math.max(maxY, obj.start.y, obj.end.y);
            } else if (obj.type === 'flash') {
                const aperture = this.apertures.get(obj.aperture);
                if (aperture) {
                    const radius = aperture.parameters[0] / 2;
                    minX = Math.min(minX, obj.position.x - radius);
                    minY = Math.min(minY, obj.position.y - radius);
                    maxX = Math.max(maxX, obj.position.x + radius);
                    maxY = Math.max(maxY, obj.position.y + radius);
                }
            }
        });
        
        if (isFinite(minX)) {
            this.layers.bounds = { minX, minY, maxX, maxY };
        }
    }
    
    debug(message, data = null) {
        if (this.options.debug) {
            if (data) {
                console.log(`[GerberSemantic] ${message}`, data);
            } else {
                console.log(`[GerberSemantic] ${message}`);
            }
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GerberSemanticParser;
} else {
    window.GerberSemanticParser = GerberSemanticParser;
}