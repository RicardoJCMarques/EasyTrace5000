// Semantic Excellon Parser - Preserves all Excellon semantics without interpretation
// parsers/excellon-semantic.js

class ExcellonSemanticParser {
    constructor(options = {}) {
        this.options = {
            units: 'mm',
            format: { integer: 2, decimal: 4 },
            debug: options.debug || false,
            ...options
        };
        
        // Parser state
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
        
        this.errors = [];
        this.warnings = [];
    }
    
    parse(content) {
        try {
            this.debug('Starting semantic Excellon parse...');
            
            // Reset state
            this.reset();
            
            // Split into lines
            const lines = content
                .replace(/\r\n/g, '\n')
                .replace(/\r/g, '\n')
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);
            
            // Process each line
            lines.forEach((line, index) => {
                this.processLine(line, index + 1);
            });
            
            // Finalize
            this.finalizeParse();
            
            this.debug(`Parse complete: ${this.drillData.holes.length} holes, ${this.tools.size} tools`);
            
            return {
                success: true,
                drillData: this.drillData,
                errors: this.errors,
                warnings: this.warnings
            };
            
        } catch (error) {
            this.errors.push(`Parse error: ${error.message}`);
            return {
                success: false,
                drillData: this.drillData,
                errors: this.errors,
                warnings: this.warnings
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
        
        // Store original units with the tool
        const tool = {
            number: toolNumber,
            diameter: diameter,
            originalUnits: this.options.units,
            displayDiameter: diameter // Will be converted if needed
        };
        
        // Convert to mm for internal storage
        if (this.options.units === 'inch') {
            tool.displayDiameter = diameter * 25.4;
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
            const defaultTool = {
                number: toolNumber,
                diameter: 1.0,
                originalUnits: 'mm',
                displayDiameter: 1.0,
                isDefault: true
            };
            
            this.tools.set(toolCode, defaultTool);
            this.drillData.tools.push(defaultTool);
            this.currentTool = toolCode;
            
            this.warnings.push(`Tool ${toolCode} not defined, using default 1.0mm`);
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
                const defaultTool = {
                    number: 1,
                    diameter: 1.0,
                    originalUnits: 'mm',
                    displayDiameter: 1.0,
                    isDefault: true
                };
                
                this.tools.set('T01', defaultTool);
                this.drillData.tools.push(defaultTool);
                this.currentTool = 'T01';
                
                this.errors.push(`No tool defined at line ${lineNumber}, created default T01`);
            }
        }
        
        const coordinates = this.parseCoordinates(line);
        if (!coordinates) {
            this.errors.push(`Invalid coordinates at line ${lineNumber}: ${line}`);
            return;
        }
        
        const tool = this.tools.get(this.currentTool);
        
        const hole = {
            type: 'hole',
            position: coordinates,
            tool: this.currentTool,
            diameter: tool.displayDiameter,
            plated: true // Assume plated unless specified otherwise
        };
        
        this.drillData.holes.push(hole);
        
        this.debug(`Hole at (${coordinates.x.toFixed(3)}, ${coordinates.y.toFixed(3)}) with ${this.currentTool}`);
    }
    
    parseCoordinates(line) {
        const xMatch = line.match(/X([+-]?\d+\.?\d*)/);
        const yMatch = line.match(/Y([+-]?\d+\.?\d*)/);
        
        if (!xMatch && !yMatch) return null;
        
        const coordinates = { x: 0, y: 0 };
        
        if (xMatch) {
            coordinates.x = this.parseCoordinateValue(xMatch[1]);
        }
        
        if (yMatch) {
            coordinates.y = this.parseCoordinateValue(yMatch[1]);
        }
        
        return coordinates;
    }
    
    parseCoordinateValue(value) {
        // Handle decimal coordinates
        if (value.includes('.')) {
            let coordinate = parseFloat(value);
            
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
        
        // Pad with zeros
        const totalDigits = format.integer + format.decimal;
        const padded = absValue.padStart(totalDigits, '0');
        
        // Split into integer and decimal
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
        this.calculateBounds();
        
        // Generate statistics
        this.generateStats();
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
        
        this.drillData.bounds = { minX, minY, maxX, maxY };
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
            console.log('[ExcellonSemantic] Tool usage:');
            toolUsage.forEach((count, tool) => {
                const toolInfo = this.tools.get(tool);
                console.log(`  ${tool}: ${count} holes, ⌀${toolInfo.displayDiameter.toFixed(3)}mm`);
            });
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
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExcellonSemanticParser;
} else {
    window.ExcellonSemanticParser = ExcellonSemanticParser;
}