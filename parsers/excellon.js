// Robust Excellon Drill File Parser
// Handles various EDA tool outputs with proper tool definitions

class ExcellonPolygonParser {
    constructor(options = {}) {
        this.options = {
            debug: options.debug || false,
            units: 'mm', // Will be detected from file
            coordinateFormat: { x: [2, 4], y: [2, 4] }, // [integer, decimal] digits
            defaultToolDiameter: 1.0, // Fallback diameter in mm
            ...options
        };
        
        // Parser state
        this.tools = new Map(); // T01 -> {diameter, units}
        this.currentTool = null;
        this.inHeader = false;
        this.headerEnded = false;
        
        // Results
        this.holes = [];
        this.polygons = []; // For visualization
        this.errors = [];
        this.stats = {
            tools: 0,
            holes: 0,
            uniqueHoles: 0
        };
        
        this.debug('ExcellonParser initialized');
    }
    
    parse(content) {
        try {
            this.debug('Starting Excellon parsing...');
            
            // Reset state
            this.tools.clear();
            this.holes = [];
            this.polygons = [];
            this.errors = [];
            this.currentTool = null;
            this.inHeader = false;
            this.headerEnded = false;
            
            // Split into lines and process
            const lines = content
                .replace(/\r\n/g, '\n')
                .replace(/\r/g, '\n')
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);
            
            // Parse each line
            for (let i = 0; i < lines.length; i++) {
                this.parseLine(lines[i], i + 1);
            }
            
            // Validate and create polygons
            this.validateTools();
            this.createHolePolygons();
            this.calculateStats();
            
            this.debug(`Parsing complete: ${this.holes.length} holes, ${this.tools.size} tools`);
            this.debug(`Stats:`, this.stats);
            
            return {
                holes: this.holes,
                polygons: this.polygons,
                tools: Array.from(this.tools.entries()),
                errors: this.errors,
                stats: this.stats
            };
            
        } catch (error) {
            this.errors.push(`Parse error: ${error.message}`);
            console.error('Excellon parsing failed:', error);
            return {
                holes: this.holes,
                polygons: this.polygons,
                errors: this.errors,
                stats: this.stats
            };
        }
    }
    
    parseLine(line, lineNumber) {
        if (!line) return;
        
        // Only debug important lines, not every single one
        const isImportant = line === 'M48' || line === 'M95' || line === '%' || 
                           line.includes('METRIC') || line.includes('INCH') ||
                           line.match(/^T\d+C/) || line.match(/^T\d+$/) ||
                           line.match(/[XY]/);
        
        if (isImportant) {
            this.debug(`Line ${lineNumber}: ${line}`);
        }
        
        // Header start
        if (line === 'M48' || line.startsWith('%')) {
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
        
        // Units specification
        if (line === 'METRIC' || line === 'M71') {
            this.options.units = 'mm';
            this.debug('Units set to metric (mm)');
            return;
        }
        
        if (line === 'INCH' || line === 'M72') {
            this.options.units = 'inch';
            this.debug('Units set to imperial (inch)');
            return;
        }
        
        // Coordinate format
        if (line.startsWith('FMAT')) {
            this.parseFormatSpec(line);
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
        
        // Coordinate with hole drilling
        if (line.match(/[XY]/)) {
            this.parseHolePosition(line, lineNumber);
            return;
        }
        
        // Comments and other commands
        if (line.startsWith(';') || line.startsWith('G') || line.startsWith('M')) {
            this.debug(`Ignored: ${line}`);
            return;
        }
        
        this.debug(`Unhandled line: ${line}`);
    }
    
    parseFormatSpec(line) {
        // Parse format: FMAT,2  or similar
        const match = line.match(/FMAT,?(\d)/);
        if (match) {
            const format = parseInt(match[1]);
            if (format === 1) {
                this.options.coordinateFormat = { x: [2, 3], y: [2, 3] };
            } else if (format === 2) {
                this.options.coordinateFormat = { x: [2, 4], y: [2, 4] };
            }
            this.debug(`Coordinate format: ${format} (${this.options.coordinateFormat.x.join('.')})`);
        }
    }
    
    parseToolDefinition(line) {
        // Parse tool: T01C0.8000 or T1C0.8
        const match = line.match(/^T(\d+)C([0-9.]+)/);
        if (!match) {
            this.errors.push(`Invalid tool definition: ${line}`);
            return;
        }
        
        const toolNumber = `T${match[1].padStart(2, '0')}`; // Normalize to T01 format
        let diameter = parseFloat(match[2]);
        
        // Convert to mm if needed
        if (this.options.units === 'inch') {
            diameter *= 25.4;
        }
        
        this.tools.set(toolNumber, {
            diameter: diameter,
            units: this.options.units,
            originalSpec: line
        });
        
        this.stats.tools++;
        this.debug(`Tool ${toolNumber}: ⌀${diameter.toFixed(3)}mm`);
    }
    
    selectTool(toolCode) {
        // Normalize tool code (T1 -> T01)
        const normalized = toolCode.replace(/T(\d)$/, 'T0$1');
        
        if (this.tools.has(normalized)) {
            this.currentTool = normalized;
            this.debug(`Selected tool: ${normalized}`);
        } else if (this.tools.has(toolCode)) {
            this.currentTool = toolCode;
            this.debug(`Selected tool: ${toolCode}`);
        } else {
            // Create a default tool if not defined
            this.tools.set(toolCode, {
                diameter: this.options.defaultToolDiameter,
                units: this.options.units,
                originalSpec: `${toolCode} (default)`
            });
            this.currentTool = toolCode;
            this.errors.push(`Tool ${toolCode} not defined, using default diameter ${this.options.defaultToolDiameter}mm`);
            this.debug(`Created default tool: ${toolCode}`);
        }
    }
    
    parseHolePosition(line, lineNumber) {
        if (!this.currentTool) {
            // Try to find a default tool or create one
            if (this.tools.size > 0) {
                this.currentTool = this.tools.keys().next().value;
                this.debug(`Using first available tool: ${this.currentTool}`);
            } else {
                this.tools.set('T01', {
                    diameter: this.options.defaultToolDiameter,
                    units: this.options.units,
                    originalSpec: 'T01 (auto-created)'
                });
                this.currentTool = 'T01';
                this.errors.push(`No tool selected at line ${lineNumber}, created default T01`);
            }
        }
        
        const position = this.parseCoordinates(line);
        if (!position) {
            this.errors.push(`Invalid coordinate format at line ${lineNumber}: ${line}`);
            return;
        }
        
        const tool = this.tools.get(this.currentTool);
        const hole = {
            position: position,
            diameter: tool.diameter,
            tool: this.currentTool,
            line: lineNumber
        };
        
        this.holes.push(hole);
        this.debug(`Hole: ${position.x.toFixed(3)}, ${position.y.toFixed(3)} ⌀${tool.diameter.toFixed(3)}mm`);
    }
    
    parseCoordinates(line) {
        // Extract X and Y coordinates
        const xMatch = line.match(/X([+-]?\d+\.?\d*)/);
        const yMatch = line.match(/Y([+-]?\d+\.?\d*)/);
        
        if (!xMatch && !yMatch) {
            return null;
        }
        
        let x = 0, y = 0;
        
        if (xMatch) {
            x = this.parseCoordinateValue(xMatch[1], 'x');
        }
        
        if (yMatch) {
            y = this.parseCoordinateValue(yMatch[1], 'y');
        }
        
        return { x, y };
    }
    
    parseCoordinateValue(value, axis) {
        // Handle different coordinate formats
        let coordinate = parseFloat(value);
        
        // If the value doesn't contain a decimal point, apply format
        if (!value.includes('.')) {
            const format = this.options.coordinateFormat[axis];
            const totalDigits = format[0] + format[1];
            const decimalDigits = format[1];
            
            // Pad with zeros if needed
            const paddedValue = value.padStart(totalDigits, '0');
            const integerPart = paddedValue.slice(0, -decimalDigits);
            const decimalPart = paddedValue.slice(-decimalDigits);
            
            coordinate = parseFloat(`${integerPart}.${decimalPart}`);
        }
        
        // Convert inches to mm if needed
        if (this.options.units === 'inch') {
            coordinate *= 25.4;
        }
        
        return coordinate;
    }
    
    validateTools() {
        if (this.tools.size === 0) {
            this.errors.push('No tools defined in file');
            // Create a default tool
            this.tools.set('T01', {
                diameter: this.options.defaultToolDiameter,
                units: this.options.units,
                originalSpec: 'T01 (auto-created - no tools found)'
            });
        }
        
        // Check for reasonable tool diameters
        for (const [toolCode, tool] of this.tools.entries()) {
            if (tool.diameter <= 0 || tool.diameter > 25) {
                this.errors.push(`Suspicious tool diameter: ${toolCode} = ${tool.diameter}mm`);
            }
        }
    }
    
    createHolePolygons() {
        // Create minimal circle polygons for visualization only
        // These represent the drill holes for preview, not the copper
        for (const hole of this.holes) {
            const polygon = PolygonFactory.createCircle(
                hole.position.x,
                hole.position.y,
                hole.diameter / 2,
                8 // Use fewer segments for drill holes - they're just for visualization
            );
            
            polygon.properties = {
                source: 'drill_hole',
                tool: hole.tool,
                diameter: hole.diameter,
                type: 'hole', // Mark as hole for special rendering
                position: hole.position
            };
            
            this.polygons.push(polygon);
        }
    }
    
    calculateStats() {
        this.stats.holes = this.holes.length;
        this.stats.tools = this.tools.size;
        
        // Count unique hole positions
        const uniquePositions = new Set();
        for (const hole of this.holes) {
            const key = `${hole.position.x.toFixed(3)},${hole.position.y.toFixed(3)}`;
            uniquePositions.add(key);
        }
        this.stats.uniqueHoles = uniquePositions.size;
        
        // Group by tool
        const toolUsage = new Map();
        for (const hole of this.holes) {
            const count = toolUsage.get(hole.tool) || 0;
            toolUsage.set(hole.tool, count + 1);
        }
        
        this.debug('Tool usage:');
        for (const [tool, count] of toolUsage.entries()) {
            const toolInfo = this.tools.get(tool);
            this.debug(`  ${tool}: ${count} holes, ⌀${toolInfo.diameter.toFixed(3)}mm`);
        }
    }
    
    debug(message, data = null) {
        if (this.options.debug) {
            // Only log important messages, not every line
            if (message.includes('Line ') && !message.includes('Header') && !message.includes('Hole:') && !message.includes('Tool')) {
                return; // Skip line-by-line spam
            }
            if (data) {
                console.log(`[Excellon] ${message}`, data);
            } else {
                console.log(`[Excellon] ${message}`);
            }
        }
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExcellonPolygonParser;
} else {
    window.ExcellonPolygonParser = ExcellonPolygonParser;
}