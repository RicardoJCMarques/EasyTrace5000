// Semantic Gerber Parser - Enhanced with coordinate validation and consistency
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
        
        // ENHANCED: Coordinate validation tracking
        this.coordinateValidation = {
            validCoordinates: 0,
            invalidCoordinates: 0,
            coordinateRange: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
            suspiciousCoordinates: [],
            objectCoordinates: [] // Track coordinates by object type
        };
        
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
            this.debug('Starting semantic Gerber parse with enhanced coordinate validation...');
            
            // Split into commands
            const blocks = this.splitIntoBlocks(content);
            this.debug(`Processing ${blocks.length} command blocks`);
            
            // Process each block
            blocks.forEach((block, index) => {
                this.processBlock(block, index);
            });
            
            // Finalize
            this.finalizeParse();
            
            this.debug(`Parse complete: ${this.layers.objects.length} objects`);
            this.debug(`Coordinate validation: ${this.coordinateValidation.validCoordinates} valid, ${this.coordinateValidation.invalidCoordinates} invalid`);
            
            return {
                success: true,
                layers: this.layers,
                errors: this.errors,
                warnings: this.warnings,
                coordinateValidation: this.coordinateValidation
            };
            
        } catch (error) {
            this.errors.push(`Parse error: ${error.message}`);
            return {
                success: false,
                layers: this.layers,
                errors: this.errors,
                warnings: this.warnings,
                coordinateValidation: this.coordinateValidation
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
            this.debug('Units set to metric');
        }
        else if (command === 'MOIN') {
            this.options.units = 'inch';
            this.layers.units = 'inch';
            this.debug('Units set to imperial');
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
    
    /**
     * ENHANCED: Parse aperture definition with validation
     */
    parseApertureDefinition(command) {
        const match = command.match(/ADD(\d+)([CROP]),(.+)/);
        if (!match) {
            this.errors.push(`Invalid aperture definition: ${command}`);
            return;
        }
        
        const code = `D${match[1]}`;
        const type = match[2];
        const paramString = match[3];
        
        // ENHANCED: Validate aperture parameters
        const params = paramString.split('X').map(p => {
            const value = parseFloat(p);
            if (!isFinite(value) || value <= 0) {
                this.warnings.push(`Invalid aperture parameter: ${p} in ${command}`);
                return 0.1; // Default fallback
            }
            return value;
        });
        
        const aperture = {
            code: code,
            type: this.getApertureTypeName(type),
            parameters: params,
            function: this.apertureFunction
        };
        
        // ENHANCED: Validate aperture size ranges
        const primarySize = params[0] || 0;
        if (primarySize > 25.4) { // > 1 inch
            this.warnings.push(`Unusually large aperture ${code}: ${primarySize}mm`);
        }
        if (primarySize < 0.01) { // < 10 microns
            this.warnings.push(`Unusually small aperture ${code}: ${primarySize}mm`);
        }
        
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
            // ENHANCED: Validate region points
            const validPoints = this.currentRegion.points.filter(point => 
                isFinite(point.x) && isFinite(point.y)
            );
            
            if (validPoints.length < 3) {
                this.errors.push(`Region has insufficient valid points: ${validPoints.length}`);
                this.currentRegion = null;
                return;
            }
            
            this.currentRegion.points = validPoints;
            
            // Ensure closed
            const first = this.currentRegion.points[0];
            const last = this.currentRegion.points[this.currentRegion.points.length - 1];
            
            if (Math.abs(first.x - last.x) > 0.001 || Math.abs(first.y - last.y) > 0.001) {
                this.currentRegion.points.push({ ...first });
            }
            
            // Track region coordinates
            this.coordinateValidation.objectCoordinates.push({
                type: 'region',
                pointCount: this.currentRegion.points.length,
                bounds: this.calculatePointsBounds(this.currentRegion.points)
            });
            
            this.layers.objects.push(this.currentRegion);
        }
        
        this.currentRegion = null;
    }
    
    /**
     * ENHANCED: Calculate bounds from points array
     */
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
    
    processCoordinate(command) {
        const newPoint = this.parseCoordinates(command);
        const operation = this.parseOperation(command);
        
        if (!newPoint) {
            this.debug(`Failed to parse coordinates from: ${command}`);
            return;
        }
        
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
    
    /**
     * ENHANCED: Parse coordinates with comprehensive validation
     */
    parseCoordinates(command) {
        const point = { ...this.currentPoint };
        
        try {
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
            
            // ENHANCED: Validate parsed coordinates
            if (!this.validateCoordinates(point)) {
                return null;
            }
            
            // Update coordinate tracking
            this.coordinateValidation.validCoordinates++;
            this.updateCoordinateRange(point);
            
            return point;
            
        } catch (error) {
            this.coordinateValidation.invalidCoordinates++;
            this.errors.push(`Coordinate parsing error: ${error.message} in command: ${command}`);
            return null;
        }
    }
    
    /**
     * ENHANCED: Validate coordinate values for consistency
     */
    validateCoordinates(point) {
        // Check for finite values
        if (!isFinite(point.x) || !isFinite(point.y)) {
            this.errors.push(`Non-finite coordinates: (${point.x}, ${point.y})`);
            this.coordinateValidation.invalidCoordinates++;
            return false;
        }
        
        // Check for reasonable coordinate ranges
        const maxCoordinate = 1000; // 1 meter in mm, very generous for PCB
        if (Math.abs(point.x) > maxCoordinate || Math.abs(point.y) > maxCoordinate) {
            this.coordinateValidation.suspiciousCoordinates.push({
                coordinates: { x: point.x, y: point.y },
                reason: 'coordinates_too_large'
            });
            this.warnings.push(`Suspiciously large coordinates: (${point.x.toFixed(3)}, ${point.y.toFixed(3)})`);
        }
        
        // Check for NaN in arc coordinates
        if (point.i !== undefined && !isFinite(point.i)) {
            this.warnings.push(`Invalid I coordinate: ${point.i}`);
        }
        if (point.j !== undefined && !isFinite(point.j)) {
            this.warnings.push(`Invalid J coordinate: ${point.j}`);
        }
        
        return true;
    }
    
    /**
     * ENHANCED: Update coordinate range tracking
     */
    updateCoordinateRange(point) {
        const range = this.coordinateValidation.coordinateRange;
        range.minX = Math.min(range.minX, point.x);
        range.minY = Math.min(range.minY, point.y);
        range.maxX = Math.max(range.maxX, point.x);
        range.maxY = Math.max(range.maxY, point.y);
    }
    
    /**
     * ENHANCED: Parse coordinate value with robust error handling
     */
    parseCoordinateValue(value) {
        const format = this.options.format;
        const negative = value.startsWith('-');
        const absValue = value.replace(/^[+-]/, '');
        
        // Validate input
        if (!/^\d+$/.test(absValue)) {
            throw new Error(`Invalid coordinate format: ${value}`);
        }
        
        // Check length against format specification
        const totalDigits = format.integer + format.decimal;
        if (absValue.length > totalDigits) {
            this.warnings.push(`Coordinate value "${value}" exceeds format specification ${format.integer}.${format.decimal}`);
        }
        
        // Pad with leading zeros
        const padded = absValue.padStart(totalDigits, '0');
        
        // Split into integer and decimal parts
        const integerPart = padded.slice(0, format.integer);
        const decimalPart = padded.slice(format.integer);
        
        let coordinate = parseFloat(`${integerPart}.${decimalPart}`);
        
        if (!isFinite(coordinate)) {
            throw new Error(`Invalid coordinate calculation: ${value} -> ${integerPart}.${decimalPart}`);
        }
        
        if (negative) coordinate = -coordinate;
        
        // Convert to mm if needed with validation
        if (this.options.units === 'inch') {
            coordinate *= 25.4;
            
            // Sanity check: inch coordinates should typically be reasonable
            if (Math.abs(coordinate) > 254) { // > 10 inches
                this.warnings.push(`Very large coordinate after inch conversion: ${coordinate.toFixed(3)}mm`);
            }
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
            
            // ENHANCED: Validate arc center
            if (!isFinite(draw.center.x) || !isFinite(draw.center.y)) {
                this.warnings.push(`Invalid arc center calculated: (${draw.center.x}, ${draw.center.y})`);
            }
        }
        
        // Track draw coordinates
        this.coordinateValidation.objectCoordinates.push({
            type: 'draw',
            aperture: this.currentAperture,
            bounds: {
                minX: Math.min(start.x, end.x),
                minY: Math.min(start.y, end.y),
                maxX: Math.max(start.x, end.x),
                maxY: Math.max(start.y, end.y)
            }
        });
        
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
        
        // Track flash coordinates
        const apertureSize = aperture.parameters[0] || 0;
        this.coordinateValidation.objectCoordinates.push({
            type: 'flash',
            aperture: this.currentAperture,
            bounds: {
                minX: position.x - apertureSize / 2,
                minY: position.y - apertureSize / 2,
                maxX: position.x + apertureSize / 2,
                maxY: position.y + apertureSize / 2
            }
        });
        
        this.layers.objects.push(flash);
    }
    
    finalizeParse() {
        // Calculate bounds with validation
        this.calculateBounds();
        
        // ENHANCED: Validate coordinate consistency across all objects
        this.validateCoordinateConsistency();
        
        // Sort objects by type for better rendering
        this.layers.objects.sort((a, b) => {
            const typeOrder = { region: 0, draw: 1, flash: 2 };
            return (typeOrder[a.type] || 3) - (typeOrder[b.type] || 3);
        });
    }
    
    /**
     * ENHANCED: Validate coordinate consistency across all objects
     */
    validateCoordinateConsistency() {
        if (this.coordinateValidation.objectCoordinates.length === 0) return;
        
        const range = this.coordinateValidation.coordinateRange;
        
        // Check if coordinate range is reasonable
        const width = range.maxX - range.minX;
        const height = range.maxY - range.minY;
        
        if (width > 500 || height > 500) { // 500mm is very large for a PCB
            this.warnings.push(`Layer dimensions are unusually large: ${width.toFixed(1)} × ${height.toFixed(1)} mm`);
        }
        
        if (width < 0.1 || height < 0.1) { // 0.1mm is very small
            this.warnings.push(`Layer dimensions are unusually small: ${width.toFixed(3)} × ${height.toFixed(3)} mm`);
        }
        
        // Check coordinate distribution by object type
        const coordinatesByType = {};
        this.coordinateValidation.objectCoordinates.forEach(obj => {
            if (!coordinatesByType[obj.type]) {
                coordinatesByType[obj.type] = [];
            }
            coordinatesByType[obj.type].push(obj.bounds);
        });
        
        // Validate each type has reasonable coordinate ranges
        Object.entries(coordinatesByType).forEach(([type, bounds]) => {
            let typeMinX = Infinity, typeMinY = Infinity;
            let typeMaxX = -Infinity, typeMaxY = -Infinity;
            
            bounds.forEach(bound => {
                typeMinX = Math.min(typeMinX, bound.minX);
                typeMinY = Math.min(typeMinY, bound.minY);
                typeMaxX = Math.max(typeMaxX, bound.maxX);
                typeMaxY = Math.max(typeMaxY, bound.maxY);
            });
            
            const typeWidth = typeMaxX - typeMinX;
            const typeHeight = typeMaxY - typeMinY;
            
            this.debug(`${type} coordinate range: ${typeWidth.toFixed(1)} × ${typeHeight.toFixed(1)} mm`);
            
            // Check if this type's coordinates are way off from the main range
            const centerDistance = Math.sqrt(
                Math.pow((typeMinX + typeMaxX) / 2 - (range.minX + range.maxX) / 2, 2) +
                Math.pow((typeMinY + typeMaxY) / 2 - (range.minY + range.maxY) / 2, 2)
            );
            
            if (centerDistance > Math.max(width, height) * 0.1) { // More than 10% offset
                this.warnings.push(`${type} objects appear offset from main coordinate system (${centerDistance.toFixed(1)}mm)`);
            }
        });
        
        this.debug(`Coordinate consistency check: ${width.toFixed(1)} × ${height.toFixed(1)} mm`);
    }
    
    calculateBounds() {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        let hasValidData = false;
        
        this.layers.objects.forEach(obj => {
            try {
                if (obj.type === 'region') {
                    obj.points.forEach(point => {
                        if (isFinite(point.x) && isFinite(point.y)) {
                            minX = Math.min(minX, point.x);
                            minY = Math.min(minY, point.y);
                            maxX = Math.max(maxX, point.x);
                            maxY = Math.max(maxY, point.y);
                            hasValidData = true;
                        }
                    });
                } else if (obj.type === 'draw') {
                    if (isFinite(obj.start.x) && isFinite(obj.start.y) &&
                        isFinite(obj.end.x) && isFinite(obj.end.y)) {
                        minX = Math.min(minX, obj.start.x, obj.end.x);
                        minY = Math.min(minY, obj.start.y, obj.end.y);
                        maxX = Math.max(maxX, obj.start.x, obj.end.x);
                        maxY = Math.max(maxY, obj.start.y, obj.end.y);
                        hasValidData = true;
                    }
                } else if (obj.type === 'flash') {
                    if (isFinite(obj.position.x) && isFinite(obj.position.y)) {
                        const aperture = this.apertures.get(obj.aperture);
                        if (aperture) {
                            const radius = aperture.parameters[0] / 2;
                            minX = Math.min(minX, obj.position.x - radius);
                            minY = Math.min(minY, obj.position.y - radius);
                            maxX = Math.max(maxX, obj.position.x + radius);
                            maxY = Math.max(maxY, obj.position.y + radius);
                            hasValidData = true;
                        }
                    }
                }
            } catch (error) {
                this.warnings.push(`Error calculating bounds for ${obj.type}: ${error.message}`);
            }
        });
        
        if (hasValidData && isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY)) {
            this.layers.bounds = { minX, minY, maxX, maxY };
            this.debug(`Calculated bounds: (${minX.toFixed(3)}, ${minY.toFixed(3)}) to (${maxX.toFixed(3)}, ${maxY.toFixed(3)})`);
        } else {
            this.warnings.push('Unable to calculate valid bounds from layer data');
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