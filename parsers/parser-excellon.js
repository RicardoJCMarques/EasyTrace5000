// parser/parser-excellon.js
// Excellon-specific syntax module

(function() {
    'use strict';
    
    const config = window.PCBCAMConfig || {};
    const formatConfig = config.formats?.excellon || {};
    
    class ExcellonParser extends ParserCore {
        constructor(options = {}) {
            super({
                units: formatConfig.defaultUnits || 'mm',
                format: formatConfig.defaultFormat || { integer: 2, decimal: 4 },
                ...options
            });
            
            // Excellon-specific state
            this.tools = new Map();
            this.currentTool = null;
            this.inHeader = false;
            this.headerEnded = false;
            
            // Results
            this.drillData = {
                units: this.options.units,
                format: this.options.format,
                tools: [],
                holes: [],
                bounds: null
            };
        }
        
        parse(content) {
            try {
                this.debug('Starting Excellon parse');
                
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
                    this.stats.linesProcessed++;
                });
                
                // Finalize
                this.finalizeParse();
                
                this.debug(`Parse complete: ${this.drillData.holes.length} holes, ${this.tools.size} tools`);
                this.logStatistics();
                
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
            
            this.drillData = {
                units: this.options.units,
                format: this.options.format,
                tools: [],
                holes: [],
                bounds: null
            };
            
            this.errors = [];
            this.warnings = [];
            this.stats = {
                linesProcessed: 0,
                objectsCreated: 0,
                coordinatesParsed: 0,
                invalidCoordinates: 0,
                commandsProcessed: 0
            };
            
            this.coordinateValidation = {
                validCoordinates: 0,
                invalidCoordinates: 0,
                coordinateRange: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
                suspiciousCoordinates: []
            };
        }
        
        processLine(line, lineNumber) {
            this.stats.commandsProcessed++;
            
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
            
            // Validate tool diameter
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
            
            // Convert to mm for internal storage
            if (this.options.units === 'inch') {
                tool.displayDiameter = diameter * 25.4;
                
                // Validate reasonable drill sizes
                if (tool.displayDiameter > formatConfig.maxToolDiameter) {
                    this.warnings.push(`Large drill diameter: ${tool.displayDiameter.toFixed(3)}mm for tool T${toolNumber}`);
                }
            } else {
                if (diameter > formatConfig.maxToolDiameter) {
                    this.warnings.push(`Large drill diameter: ${diameter}mm for tool T${toolNumber}`);
                }
            }
            
            // Check minimum diameter
            if (tool.displayDiameter < formatConfig.minToolDiameter) {
                this.warnings.push(`Small drill diameter: ${tool.displayDiameter.toFixed(3)}mm for tool T${toolNumber}`);
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
                // Create default tool if not defined
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
                    // Create default T01
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
                diameter: tool.displayDiameter, // Always in mm
                plated: true // Assume plated unless specified otherwise
            };
            
            this.drillData.holes.push(hole);
            this.stats.objectsCreated++;
            
            this.debug(`Hole at (${coordinates.x.toFixed(3)}, ${coordinates.y.toFixed(3)}) with ${this.currentTool}`);
        }
        
        parseCoordinates(line, lineNumber = 0) {
            const xMatch = line.match(/X([+-]?\d+\.?\d*)/);
            const yMatch = line.match(/Y([+-]?\d+\.?\d*)/);
            
            if (!xMatch && !yMatch) return null;
            
            const coordinates = { x: 0, y: 0 };
            
            try {
                if (xMatch) {
                    coordinates.x = this.parseCoordinateValue(xMatch[1], this.options.format, this.options.units);
                    this.stats.coordinatesParsed++;
                }
                
                if (yMatch) {
                    coordinates.y = this.parseCoordinateValue(yMatch[1], this.options.format, this.options.units);
                    this.stats.coordinatesParsed++;
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
                this.stats.invalidCoordinates++;
                this.errors.push(`Coordinate parsing error at line ${lineNumber}: ${error.message}`);
                return null;
            }
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
            
            // Calculate bounds
            this.calculateDrillBounds();
            
            // Validate coordinate consistency
            this.validateCoordinateConsistency();
            
            // Generate statistics
            this.generateDrillStats();

            // Enforce 'mm' units for output consistency
            this.drillData.units = 'mm';
            this.debug(`Final output units normalized to: ${this.drillData.units}`);
        }
        
        calculateDrillBounds() {
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
        
        validateCoordinateConsistency() {
            if (this.drillData.holes.length === 0) return;
            
            const range = this.coordinateValidation.coordinateRange;
            
            // Check if coordinate range is reasonable
            const width = range.maxX - range.minX;
            const height = range.maxY - range.minY;
            
            const maxDimension = config.geometry?.maxCoordinate || 500;
            
            if (width > maxDimension || height > maxDimension) {
                this.warnings.push(`Board dimensions are large: ${width.toFixed(1)} × ${height.toFixed(1)} mm`);
            }
            
            if (width < 1 && height < 1) {
                this.warnings.push(`Board dimensions are small: ${width.toFixed(3)} × ${height.toFixed(3)} mm`);
            }
            
            // Check for coordinate clustering
            const centerX = (range.minX + range.maxX) / 2;
            const centerY = (range.minY + range.maxY) / 2;
            
            let outliers = 0;
            const outlierThreshold = Math.max(width, height) * 0.75;
            
            this.drillData.holes.forEach(hole => {
                const distanceFromCenter = Math.sqrt(
                    Math.pow(hole.position.x - centerX, 2) + 
                    Math.pow(hole.position.y - centerY, 2)
                );
                
                if (distanceFromCenter > outlierThreshold) {
                    outliers++;
                }
            });
            
            if (outliers > this.drillData.holes.length * 0.1) {
                this.warnings.push(`${outliers} holes appear to be outliers`);
            }
        }
        
        generateDrillStats() {
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
            }
        }
    }
    
    // Export with backward compatibility
    window.ExcellonParser = ExcellonParser;
    window.ExcellonSemanticParser = ExcellonParser;  // Alias for compatibility
    
})();