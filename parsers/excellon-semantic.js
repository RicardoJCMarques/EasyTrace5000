// parsers/excellon-semantic.js - Refactored with config integration
// Semantic Excellon Parser - Enhanced with coordinate validation and consistency

(function() {
    'use strict';
    
    // Get config reference
    const config = window.PCBCAMConfig || {};
    const formatConfig = config.formats?.excellon || {};
    const geomConfig = config.geometry || {};
    const debugConfig = config.debug || {};
    const validationConfig = debugConfig.validation || {};
    
    class ExcellonSemanticParser {
        constructor(options = {}) {
            // Merge options with config defaults
            this.options = {
                units: options.units || formatConfig.defaultUnits || 'mm',
                format: options.format || formatConfig.defaultFormat || { integer: 2, decimal: 4 },
                debug: options.debug !== undefined ? options.debug : debugConfig.enabled,
                ...options
            };
            
            // Parser state
            this.tools = new Map();
            this.currentTool = null;
            this.inHeader = false;
            this.headerEnded = false;
            
            // Coordinate validation tracking
            this.coordinateValidation = {
                validCoordinates: 0,
                invalidCoordinates: 0,
                coordinateRange: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
                suspiciousCoordinates: []
            };
            
            // Results
            this.drillData = {
                units: this.options.units,
                format: this.options.format,
                tools: [],
                holes: [],
                bounds: null
            };
            
            this.errors = [];
            this.warnings = [];
        }
        
        parse(content) {
            try {
                this.debug('Starting semantic Excellon parse with enhanced coordinate validation...');
                
                // Reset state
                this.reset();
                
                // Split into lines
                const lines = content
                    .replace(/\r\n/g, '\n')
                    .replace(/\r/g, '\n')
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0);
                
                this.debug(`Processing ${lines.length} lines`);
                
                // Process each line
                lines.forEach((line, index) => {
                    this.processLine(line, index + 1);
                });
                
                // Finalize
                this.finalizeParse();
                
                this.debug(`Parse complete: ${this.drillData.holes.length} holes, ${this.tools.size} tools`);
                
                if (debugConfig.logging?.parseOperations) {
                    this.debug(`Coordinate validation: ${this.coordinateValidation.validCoordinates} valid, ${this.coordinateValidation.invalidCoordinates} invalid`);
                }
                
                return {
                    success: true,
                    drillData: this.drillData,
                    errors: this.errors,
                    warnings: this.warnings,
                    coordinateValidation: this.coordinateValidation
                };
                
            } catch (error) {
                this.errors.push(`Parse error: ${error.message}`);
                return {
                    success: false,
                    drillData: this.drillData,
                    errors: this.errors,
                    warnings: this.warnings,
                    coordinateValidation: this.coordinateValidation
                };
            }
        }
        
        reset() {
            this.tools.clear();
            this.currentTool = null;
            this.inHeader = false;
            this.headerEnded = false;
            this.coordinateValidation = {
                validCoordinates: 0,
                invalidCoordinates: 0,
                coordinateRange: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
                suspiciousCoordinates: []
            };
            this.drillData = {
                units: this.options.units,
                format: this.options.format,
                tools: [],
                holes: [],
                bounds: null
            };
            this.errors = [];
            this.warnings = [];
        }
        
        processLine(line, lineNumber) {
            // Header start
            if (line === 'M48' || line === '%') {
                this.inHeader = true;
                this.debug('Header started');
                return;
            }
            
            // Header end
            if ((line === 'M95' || line === '%') && this.inHeader) {
                this.inHeader = false;
                this.headerEnded = true;
                this.debug('Header ended');
                return;
            }
            
            // End of file
            if (line === 'M30' || line === 'M00') {
                this.debug('End of file');
                return;
            }
            
            // Units
            if (line === 'METRIC' || line === 'M71') {
                this.options.units = 'mm';
                this.drillData.units = 'mm';
                this.debug('Units: metric');
                return;
            }
            
            if (line === 'INCH' || line === 'M72') {
                this.options.units = 'inch';
                this.drillData.units = 'inch';
                this.debug('Units: imperial');
                return;
            }
            
            // Format specification
            if (line.startsWith('FMAT')) {
                this.parseFormat(line);
                return;
            }
            
            // Tool definition
            if (line.match(/^T\d+C/)) {
                this.parseToolDefinition(line);
                return;
            }
            
            // Tool selection
            if (line.match(/^T\d+$/) && !this.inHeader) {
                this.selectTool(line);
                return;
            }
            
            // Drill operation (coordinates)
            if (line.match(/[XY]/)) {
                this.parseDrillOperation(line, lineNumber);
                return;
            }
            
            // Routing commands (G00, G01, etc.)
            if (line.match(/^G\d+/)) {
                this.parseGCode(line);
                return;
            }
        }
        
        parseFormat(line) {
            const match = line.match(/FMAT,?(\d)/);
            if (match) {
                const format = parseInt(match[1]);
                if (format === 1) {
                    this.options.format = { integer: 2, decimal: 3 };
                } else if (format === 2) {
                    this.options.format = { integer: 2, decimal: 4 };
                }
                this.drillData.format = this.options.format;
                this.debug(`Format: ${this.options.format.integer}.${this.options.format.decimal}`);
            }
        }
        
        parseToolDefinition(line) {
            const match = line.match(/^T(\d+)C([0-9.]+)/);
            if (!match) {
                this.errors.push(`Invalid tool definition: ${line}`);
                return;
            }
            
            const toolNumber = parseInt(match[1]);
            let diameter = parseFloat(match[2]);
            
            // Validate tool diameter using config
            if (!isFinite(diameter) || diameter <= 0) {
                this.errors.push(`Invalid tool diameter: ${diameter} in line: ${line}`);
                return;
            }
            
            // Store original units with the tool
            const tool = {
                number: toolNumber,
                diameter: diameter,
                originalUnits: this.options.units,
                displayDiameter: diameter // Will be converted to mm if needed
            };
            
            // Convert to mm for internal storage with validation
            if (this.options.units === 'inch') {
                tool.displayDiameter = diameter * 25.4;
                
                // Validate reasonable drill sizes using config
                if (validationConfig.validateGeometry && 
                    tool.displayDiameter > formatConfig.maxToolDiameter) {
                    this.warnings.push(`Unusually large drill diameter: ${tool.displayDiameter.toFixed(3)}mm for tool T${toolNumber}`);
                }
            } else {
                if (validationConfig.validateGeometry && 
                    diameter > formatConfig.maxToolDiameter) {
                    this.warnings.push(`Unusually large drill diameter: ${diameter}mm for tool T${toolNumber}`);
                }
            }
            
            // Check minimum diameter
            if (validationConfig.validateGeometry && 
                tool.displayDiameter < formatConfig.minToolDiameter) {
                this.warnings.push(`Very small drill diameter: ${tool.displayDiameter.toFixed(3)}mm for tool T${toolNumber}`);
            }
            
            this.tools.set(`T${toolNumber.toString().padStart(2, '0')}`, tool);
            this.drillData.tools.push(tool);
            
            this.debug(`Tool T${toolNumber}: ${tool.displayDiameter.toFixed(3)}mm`);
        }
        
        selectTool(line) {
            const match = line.match(/^T(\d+)$/);
            if (!match) return;
            
            const toolNumber = parseInt(match[1]);
            const toolCode = `T${toolNumber.toString().padStart(2, '0')}`;
            
            if (this.tools.has(toolCode)) {
                this.currentTool = toolCode;
                this.debug(`Selected tool: ${toolCode}`);
            } else {
                // Create default tool if not defined using config default
                const defaultDiameter = formatConfig.defaultToolDiameter || 1.0;
                const defaultTool = {
                    number: toolNumber,
                    diameter: defaultDiameter,
                    originalUnits: 'mm',
                    displayDiameter: defaultDiameter,
                    isDefault: true
                };
                
                this.tools.set(toolCode, defaultTool);
                this.drillData.tools.push(defaultTool);
                this.currentTool = toolCode;
                
                this.warnings.push(`Tool ${toolCode} not defined, using default ${defaultDiameter}mm`);
            }
        }
        
        parseDrillOperation(line, lineNumber) {
            if (!this.currentTool) {
                // Auto-select first tool or create default
                if (this.tools.size > 0) {
                    this.currentTool = Array.from(this.tools.keys())[0];
                    this.warnings.push(`No tool selected at line ${lineNumber}, using ${this.currentTool}`);
                } else {
                    // Create default T01 using config
                    const defaultDiameter = formatConfig.defaultToolDiameter || 1.0;
                    const defaultTool = {
                        number: 1,
                        diameter: defaultDiameter,
                        originalUnits: 'mm',
                        displayDiameter: defaultDiameter,
                        isDefault: true
                    };
                    
                    this.tools.set('T01', defaultTool);
                    this.drillData.tools.push(defaultTool);
                    this.currentTool = 'T01';
                    
                    this.errors.push(`No tool defined at line ${lineNumber}, created default T01`);
                }
            }
            
            const coordinates = this.parseCoordinates(line, lineNumber);
            if (!coordinates) {
                this.errors.push(`Invalid coordinates at line ${lineNumber}: ${line}`);
                return;
            }
            
            const tool = this.tools.get(this.currentTool);
            
            const hole = {
                type: 'hole',
                position: coordinates,
                tool: this.currentTool,
                diameter: tool.displayDiameter, // This is always in mm
                plated: true // Assume plated unless specified otherwise
            };
            
            this.drillData.holes.push(hole);
            
            this.debug(`Hole at (${coordinates.x.toFixed(3)}, ${coordinates.y.toFixed(3)}) with ${this.currentTool}`);
        }
        
        parseCoordinates(line, lineNumber = 0) {
            const xMatch = line.match(/X([+-]?\d+\.?\d*)/);
            const yMatch = line.match(/Y([+-]?\d+\.?\d*)/);
            
            if (!xMatch && !yMatch) return null;
            
            const coordinates = { x: 0, y: 0 };
            
            try {
                if (xMatch) {
                    coordinates.x = this.parseCoordinateValue(xMatch[1]);
                }
                
                if (yMatch) {
                    coordinates.y = this.parseCoordinateValue(yMatch[1]);
                }
                
                // Validate parsed coordinates
                if (!this.validateCoordinates(coordinates, lineNumber)) {
                    return null;
                }
                
                // Update coordinate tracking
                this.coordinateValidation.validCoordinates++;
                this.updateCoordinateRange(coordinates);
                
                return coordinates;
                
            } catch (error) {
                this.coordinateValidation.invalidCoordinates++;
                this.errors.push(`Coordinate parsing error at line ${lineNumber}: ${error.message}`);
                return null;
            }
        }
        
        validateCoordinates(coordinates, lineNumber) {
            // Check for finite values
            if (!isFinite(coordinates.x) || !isFinite(coordinates.y)) {
                this.errors.push(`Non-finite coordinates at line ${lineNumber}: (${coordinates.x}, ${coordinates.y})`);
                this.coordinateValidation.invalidCoordinates++;
                return false;
            }
            
            // Check for reasonable coordinate ranges using config
            const maxCoordinate = geomConfig.maxCoordinate || 1000;
            if (validationConfig.validateCoordinates && 
                (Math.abs(coordinates.x) > maxCoordinate || Math.abs(coordinates.y) > maxCoordinate)) {
                this.coordinateValidation.suspiciousCoordinates.push({
                    line: lineNumber,
                    coordinates: { ...coordinates },
                    reason: 'coordinates_too_large'
                });
                this.warnings.push(`Suspiciously large coordinates at line ${lineNumber}: (${coordinates.x.toFixed(3)}, ${coordinates.y.toFixed(3)})`);
            }
            
            // Check for precision issues using config
            const precision = geomConfig.coordinatePrecision || 0.001;
            const xRounded = Math.round(coordinates.x / precision) * precision;
            const yRounded = Math.round(coordinates.y / precision) * precision;
            
            if (Math.abs(coordinates.x - xRounded) > precision * 0.1 || 
                Math.abs(coordinates.y - yRounded) > precision * 0.1) {
                this.debug(`High precision coordinates at line ${lineNumber}: (${coordinates.x}, ${coordinates.y})`);
            }
            
            return true;
        }
        
        updateCoordinateRange(coordinates) {
            const range = this.coordinateValidation.coordinateRange;
            range.minX = Math.min(range.minX, coordinates.x);
            range.minY = Math.min(range.minY, coordinates.y);
            range.maxX = Math.max(range.maxX, coordinates.x);
            range.maxY = Math.max(range.maxY, coordinates.y);
        }
        
        parseCoordinateValue(value) {
            // Handle decimal coordinates
            if (value.includes('.')) {
                let coordinate = parseFloat(value);
                
                if (!isFinite(coordinate)) {
                    throw new Error(`Invalid decimal coordinate: ${value}`);
                }
                
                // Convert to mm if needed
                if (this.options.units === 'inch') {
                    coordinate *= 25.4;
                }
                
                return coordinate;
            }
            
            // Handle integer format coordinates
            const format = this.options.format;
            const negative = value.startsWith('-');
            const absValue = value.replace(/^[+-]/, '');
            
            // Validate format
            if (absValue.length > format.integer + format.decimal) {
                if (validationConfig.warnOnInvalidData) {
                    this.warnings.push(`Coordinate value "${value}" exceeds format specification ${format.integer}.${format.decimal}`);
                }
            }
            
            // Pad with zeros
            const totalDigits = format.integer + format.decimal;
            const padded = absValue.padStart(totalDigits, '0');
            
            // Split into integer and decimal
            const integerPart = padded.slice(0, format.integer);
            const decimalPart = padded.slice(format.integer);
            
            let coordinate = parseFloat(`${integerPart}.${decimalPart}`);
            
            if (!isFinite(coordinate)) {
                throw new Error(`Invalid formatted coordinate: ${value} -> ${integerPart}.${decimalPart}`);
            }
            
            if (negative) coordinate = -coordinate;
            
            // Convert to mm if needed
            if (this.options.units === 'inch') {
                coordinate *= 25.4;
            }
            
            return coordinate;
        }
        
        parseGCode(line) {
            // Store routing commands for future slot/routing support
            this.debug(`G-code command: ${line} (routing not yet implemented)`);
        }
        
        finalizeParse() {
            // Validate tools
            if (this.tools.size === 0) {
                this.errors.push('No tools defined in file');
            }
            
            // Calculate bounds with validation
            this.calculateBounds();
            
            // Validate coordinate consistency
            this.validateCoordinateConsistency();
            
            // Generate statistics
            this.generateStats();

            // Enforce 'mm' units for output consistency
            this.drillData.units = 'mm';
            this.debug(`Final output units normalized to: ${this.drillData.units}`);
        }
        
        validateCoordinateConsistency() {
            if (this.drillData.holes.length === 0) return;
            
            const range = this.coordinateValidation.coordinateRange;
            
            // Check if coordinate range is reasonable
            const width = range.maxX - range.minX;
            const height = range.maxY - range.minY;
            
            // Use config for max board size
            const maxDimension = geomConfig.maxCoordinate || 500;
            
            if (validationConfig.validateCoordinates) {
                if (width > maxDimension || height > maxDimension) {
                    this.warnings.push(`Board dimensions are unusually large: ${width.toFixed(1)} × ${height.toFixed(1)} mm`);
                }
                
                if (width < 1 && height < 1) { // 1mm is very small
                    this.warnings.push(`Board dimensions are unusually small: ${width.toFixed(3)} × ${height.toFixed(3)} mm`);
                }
            }
            
            // Check for coordinate clustering (most holes should be in similar range)
            const centerX = (range.minX + range.maxX) / 2;
            const centerY = (range.minY + range.maxY) / 2;
            
            let outliers = 0;
            const outlierThreshold = Math.max(width, height) * 0.75; // 75% of board size
            
            this.drillData.holes.forEach(hole => {
                const distanceFromCenter = Math.sqrt(
                    Math.pow(hole.position.x - centerX, 2) + 
                    Math.pow(hole.position.y - centerY, 2)
                );
                
                if (distanceFromCenter > outlierThreshold) {
                    outliers++;
                }
            });
            
            if (validationConfig.validateGeometry && outliers > this.drillData.holes.length * 0.1) {
                this.warnings.push(`${outliers} holes appear to be outliers (far from board center)`);
            }
            
            this.debug(`Coordinate consistency check: ${width.toFixed(1)} × ${height.toFixed(1)} mm, ${outliers} outliers`);
        }
        
        calculateBounds() {
            if (this.drillData.holes.length === 0) return;
            
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            
            this.drillData.holes.forEach(hole => {
                const radius = hole.diameter / 2;
                minX = Math.min(minX, hole.position.x - radius);
                minY = Math.min(minY, hole.position.y - radius);
                maxX = Math.max(maxX, hole.position.x + radius);
                maxY = Math.max(maxY, hole.position.y + radius);
            });
            
            // Validate calculated bounds
            if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
                this.errors.push('Unable to calculate valid bounds from drill data');
                return;
            }
            
            this.drillData.bounds = { minX, minY, maxX, maxY };
            
            this.debug(`Calculated bounds: (${minX.toFixed(3)}, ${minY.toFixed(3)}) to (${maxX.toFixed(3)}, ${maxY.toFixed(3)})`);
        }
        
        generateStats() {
            const toolUsage = new Map();
            
            this.drillData.holes.forEach(hole => {
                const count = toolUsage.get(hole.tool) || 0;
                toolUsage.set(hole.tool, count + 1);
            });
            
            this.drillData.stats = {
                totalHoles: this.drillData.holes.length,
                toolCount: this.tools.size,
                toolUsage: Object.fromEntries(toolUsage)
            };
            
            if (this.options.debug) {
                this.debug('Tool usage:');
                toolUsage.forEach((count, tool) => {
                    const toolInfo = this.tools.get(tool);
                    this.debug(`  ${tool}: ${count} holes, ⌀${toolInfo.displayDiameter.toFixed(3)}mm`);
                });
                
                if (debugConfig.logging?.parseOperations) {
                    this.debug('Coordinate validation summary:');
                    this.debug(`  Valid coordinates: ${this.coordinateValidation.validCoordinates}`);
                    this.debug(`  Invalid coordinates: ${this.coordinateValidation.invalidCoordinates}`);
                    this.debug(`  Suspicious coordinates: ${this.coordinateValidation.suspiciousCoordinates.length}`);
                    
                    const range = this.coordinateValidation.coordinateRange;
                    if (isFinite(range.minX)) {
                        this.debug(`  Coordinate range: (${range.minX.toFixed(3)}, ${range.minY.toFixed(3)}) to (${range.maxX.toFixed(3)}, ${range.maxY.toFixed(3)})`);
                    }
                }
            }
        }
        
        debug(message, data = null) {
            if (this.options.debug) {
                if (data) {
                    console.log(`[ExcellonSemantic] ${message}`, data);
                } else {
                    console.log(`[ExcellonSemantic] ${message}`);
                }
            }
        }
    }
    
    // Export
    window.ExcellonSemanticParser = ExcellonSemanticParser;
    
})();