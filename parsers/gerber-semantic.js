// parsers/gerber-semantic.js - Refactored with config integration
// Ensures sequential execution and prevents geometry duplication

(function() {
    'use strict';
    
    // Get config reference
    const config = window.PCBCAMConfig || {};
    const formatConfig = config.formats?.gerber || {};
    const debugConfig = config.debug || {};
    const validationConfig = debugConfig.validation || {};
    
    class GerberSemanticParser {
        constructor(options = {}) {
            // Merge options with config defaults
            this.options = {
                units: options.units || formatConfig.defaultUnits || 'mm',
                format: options.format || formatConfig.defaultFormat || { integer: 3, decimal: 3 },
                debug: options.debug !== undefined ? options.debug : debugConfig.enabled,
                ...options
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
            
            this.debugStats = {
                regionsCreated: 0,
                tracesCreated: 0,
                flashesCreated: 0,
                totalObjects: 0,
                commandsProcessed: 0
            };
        }
        
        parse(content) {
            try {
                this.debug('Starting Gerber parse with command queue architecture');
                
                // Phase 1: Tokenize into commands
                const commands = this.tokenize(content);
                this.debug(`Tokenized ${commands.length} commands`);
                
                // Phase 2: Execute commands sequentially
                this.executeCommands(commands);
                
                // Phase 3: Finalize
                this.finalizeParse();
                
                this.debug(`Parse complete: ${this.layers.objects.length} objects created`);
                
                return {
                    success: true,
                    layers: this.layers,
                    errors: this.errors,
                    warnings: this.warnings,
                    debugStats: this.debugStats
                };
                
            } catch (error) {
                this.errors.push(`Parse error: ${error.message}`);
                return {
                    success: false,
                    layers: this.layers,
                    errors: this.errors,
                    warnings: this.warnings,
                    debugStats: this.debugStats
                };
            }
        }
        
        tokenize(content) {
            const commands = [];
            let currentBlock = '';
            let inExtended = false;
            let lineNumber = 1;
            
            for (let i = 0; i < content.length; i++) {
                const char = content[i];
                
                if (char === '\n') lineNumber++;
                
                if (char === '%') {
                    if (inExtended && currentBlock.trim()) {
                        commands.push(this.parseExtendedCommand(currentBlock.trim(), lineNumber));
                        currentBlock = '';
                    }
                    inExtended = !inExtended;
                } else if (char === '*' && !inExtended) {
                    if (currentBlock.trim()) {
                        const cmds = this.parseStandardCommand(currentBlock.trim(), lineNumber);
                        commands.push(...cmds);
                    }
                    currentBlock = '';
                } else if (char !== '\r' && char !== '\n') {
                    currentBlock += char;
                }
            }
            
            return commands;
        }
        
        parseExtendedCommand(block, lineNumber) {
            // Format specification
            if (block.startsWith('FS')) {
                const match = block.match(/FS[LT][AI]X(\d)(\d)Y(\d)(\d)/);
                if (match) {
                    return {
                        type: 'SET_FORMAT',
                        params: {
                            xInteger: parseInt(match[1]),
                            xDecimal: parseInt(match[2]),
                            yInteger: parseInt(match[3]),
                            yDecimal: parseInt(match[4])
                        },
                        line: lineNumber
                    };
                }
            }
            
            // Mode (units)
            if (block.startsWith('MO')) {
                return {
                    type: 'SET_UNITS',
                    params: { units: block.includes('MM') ? 'mm' : 'inch' },
                    line: lineNumber
                };
            }
            
            // Aperture definition
            if (block.startsWith('AD')) {
                const match = block.match(/ADD(\d+)([CROP]),(.+)/);
                if (match) {
                    const params = match[3].split('X').map(p => parseFloat(p));
                    
                    // Validate aperture parameters
                    if (validationConfig.validateGeometry) {
                        params.forEach((param, index) => {
                            if (param < formatConfig.minAperture || param > formatConfig.maxAperture) {
                                this.warnings.push(`Aperture D${match[1]} parameter ${index} out of range: ${param}`);
                            }
                        });
                    }
                    
                    return {
                        type: 'DEFINE_APERTURE',
                        params: {
                            code: `D${match[1]}`,
                            shape: this.getApertureShape(match[2]),
                            parameters: params
                        },
                        line: lineNumber
                    };
                }
            }
            
            // Polarity
            if (block.startsWith('LP')) {
                return {
                    type: 'SET_POLARITY',
                    params: { polarity: block.includes('D') ? 'dark' : 'clear' },
                    line: lineNumber
                };
            }
            
            // Unknown extended command
            return { type: 'UNKNOWN', params: { content: block }, line: lineNumber };
        }
        
        parseStandardCommand(block, lineNumber) {
            const commands = [];
            let remaining = block;
            
            // Extract G-codes first (these change state)
            if (remaining.includes('G36')) {
                commands.push({ type: 'START_REGION', params: {}, line: lineNumber });
                remaining = remaining.replace('G36', '').trim();
            }
            
            if (remaining.includes('G37')) {
                commands.push({ type: 'END_REGION', params: {}, line: lineNumber });
                remaining = remaining.replace('G37', '').trim();
            }
            
            if (remaining.includes('G01')) {
                commands.push({ type: 'SET_INTERPOLATION', params: { mode: 'linear' }, line: lineNumber });
                remaining = remaining.replace('G01', '').trim();
            }
            
            if (remaining.includes('G02')) {
                commands.push({ type: 'SET_INTERPOLATION', params: { mode: 'cw_arc' }, line: lineNumber });
                remaining = remaining.replace('G02', '').trim();
            }
            
            if (remaining.includes('G03')) {
                commands.push({ type: 'SET_INTERPOLATION', params: { mode: 'ccw_arc' }, line: lineNumber });
                remaining = remaining.replace('G03', '').trim();
            }
            
            // Extract coordinates
            const coords = this.extractCoordinates(remaining);
            
            // Extract D-code operation
            let operation = null;
            if (remaining.includes('D01')) {
                operation = 'DRAW';
            } else if (remaining.includes('D02')) {
                operation = 'MOVE';
            } else if (remaining.includes('D03')) {
                operation = 'FLASH';
            } else if (remaining.match(/D(\d{2,})/)) {
                const match = remaining.match(/D(\d{2,})/);
                const dCode = parseInt(match[1]);
                if (dCode >= 10) {
                    commands.push({
                        type: 'SELECT_APERTURE',
                        params: { aperture: `D${match[1]}` },
                        line: lineNumber
                    });
                    // Remove the D-code from remaining
                    remaining = remaining.replace(match[0], '').trim();
                }
            }
            
            // If we have coordinates or an operation, create appropriate command
            if (coords || operation) {
                if (operation === 'FLASH') {
                    commands.push({
                        type: 'FLASH',
                        params: coords || {},
                        line: lineNumber
                    });
                } else if (operation === 'DRAW') {
                    commands.push({
                        type: 'DRAW',
                        params: coords || {},
                        line: lineNumber
                    });
                } else if (operation === 'MOVE') {
                    commands.push({
                        type: 'MOVE',
                        params: coords || {},
                        line: lineNumber
                    });
                } else if (coords) {
                    // Coordinates without explicit D-code default to D01 (draw)
                    commands.push({
                        type: 'DRAW',
                        params: coords,
                        line: lineNumber
                    });
                }
            }
            
            // Handle M-codes (end of file)
            if (remaining.startsWith('M02') || remaining.startsWith('M00') || remaining.startsWith('M30')) {
                commands.push({ type: 'EOF', params: {}, line: lineNumber });
            }
            
            return commands;
        }
        
        extractCoordinates(text) {
            const coords = {};
            
            const xMatch = text.match(/X([+-]?\d+)/);
            if (xMatch) {
                coords.x = xMatch[1];
            }
            
            const yMatch = text.match(/Y([+-]?\d+)/);
            if (yMatch) {
                coords.y = yMatch[1];
            }
            
            // Arc offsets
            const iMatch = text.match(/I([+-]?\d+)/);
            if (iMatch) {
                coords.i = iMatch[1];
            }
            
            const jMatch = text.match(/J([+-]?\d+)/);
            if (jMatch) {
                coords.j = jMatch[1];
            }
            
            return Object.keys(coords).length > 0 ? coords : null;
        }
        
        executeCommands(commands) {
            // Initialize clean state
            const state = {
                position: { x: 0, y: 0 },
                aperture: null,
                apertures: new Map(),
                interpolation: 'linear',
                polarity: 'dark',
                inRegion: false,
                regionPoints: [],
                units: this.options.units,
                format: { ...this.options.format }
            };
            
            // Execute each command in sequence
            for (const command of commands) {
                this.executeCommand(command, state);
                this.debugStats.commandsProcessed++;
            }
            
            // Handle unclosed region
            if (state.inRegion && state.regionPoints.length > 0) {
                this.warnings.push('File ended with unclosed region');
                this.finalizeRegion(state);
            }
        }
        
        executeCommand(command, state) {
            switch (command.type) {
                case 'SET_FORMAT':
                    state.format.integer = command.params.xInteger;
                    state.format.decimal = command.params.xDecimal;
                    this.options.format = { ...state.format };
                    this.debug(`Format set to ${state.format.integer}.${state.format.decimal}`);
                    break;
                    
                case 'SET_UNITS':
                    state.units = command.params.units;
                    this.options.units = state.units;
                    this.layers.units = state.units;
                    this.debug(`Units set to ${state.units}`);
                    break;
                    
                case 'SET_POLARITY':
                    state.polarity = command.params.polarity;
                    this.debug(`Polarity set to ${state.polarity}`);
                    break;
                    
                case 'SET_INTERPOLATION':
                    state.interpolation = command.params.mode;
                    this.debug(`Interpolation set to ${state.interpolation}`);
                    break;
                    
                case 'DEFINE_APERTURE':
                    state.apertures.set(command.params.code, {
                        code: command.params.code,
                        type: command.params.shape,
                        parameters: command.params.parameters
                    });
                    this.debug(`Defined aperture ${command.params.code}`);
                    break;
                    
                case 'SELECT_APERTURE':
                    state.aperture = command.params.aperture;
                    this.debug(`Selected aperture ${state.aperture}`);
                    break;
                    
                case 'START_REGION':
                    if (!state.inRegion) {
                        state.inRegion = true;
                        state.regionPoints = [];
                        this.debug('Started region');
                    }
                    break;
                    
                case 'END_REGION':
                    if (state.inRegion) {
                        this.finalizeRegion(state);
                        state.inRegion = false;
                        state.regionPoints = [];
                        this.debug('Ended region');
                    }
                    break;
                    
                case 'MOVE':
                    const movePos = this.parsePosition(command.params, state);
                    if (state.inRegion && state.regionPoints.length === 0) {
                        // First move in region sets the start point
                        state.regionPoints.push(movePos);
                        this.debug(`Region started at (${movePos.x.toFixed(3)}, ${movePos.y.toFixed(3)})`);
                    }
                    state.position = movePos;
                    this.debug(`Moved to (${movePos.x.toFixed(3)}, ${movePos.y.toFixed(3)})`);
                    break;
                    
                case 'DRAW':
                    const drawPos = this.parsePosition(command.params, state);
                    if (state.inRegion) {
                        // Add point to region
                        if (state.regionPoints.length === 0) {
                            // If no start point, use current position
                            state.regionPoints.push({ ...state.position });
                        }
                        state.regionPoints.push(drawPos);
                        this.debug(`Added region point (${drawPos.x.toFixed(3)}, ${drawPos.y.toFixed(3)})`);
                    } else {
                        // Create trace
                        this.createTrace(state.position, drawPos, state);
                    }
                    state.position = drawPos;
                    break;
                    
                case 'FLASH':
                    const flashPos = this.parsePosition(command.params, state);
                    this.createFlash(flashPos, state);
                    state.position = flashPos;
                    break;
                    
                case 'EOF':
                    this.debug('End of file');
                    break;
                    
                default:
                    // Ignore unknown commands
                    break;
            }
        }
        
        parsePosition(params, state) {
            const newPos = { ...state.position };
            
            if (params.x !== undefined) {
                newPos.x = this.parseCoordinateValue(params.x, state.format, state.units);
            }
            
            if (params.y !== undefined) {
                newPos.y = this.parseCoordinateValue(params.y, state.format, state.units);
            }
            
            // Validate coordinates if config requires
            if (validationConfig.validateCoordinates) {
                const maxCoord = config.geometry?.maxCoordinate || 1000;
                if (Math.abs(newPos.x) > maxCoord || Math.abs(newPos.y) > maxCoord) {
                    this.warnings.push(`Coordinate out of range: (${newPos.x}, ${newPos.y})`);
                }
            }
            
            return newPos;
        }
        
        parseCoordinateValue(value, format, units) {
            const negative = value.startsWith('-');
            const absValue = value.replace(/^[+-]/, '');
            
            // Handle decimal notation
            if (absValue.includes('.')) {
                let coord = parseFloat(value);
                if (units === 'inch') coord *= 25.4;
                return coord;
            }
            
            // Handle integer notation
            const totalDigits = format.integer + format.decimal;
            const padded = absValue.padStart(totalDigits, '0');
            
            const integerPart = padded.slice(0, format.integer);
            const decimalPart = padded.slice(format.integer);
            
            let coord = parseFloat(`${integerPart}.${decimalPart}`);
            if (negative) coord = -coord;
            if (units === 'inch') coord *= 25.4;
            
            return coord;
        }
        
        finalizeRegion(state) {
            if (state.regionPoints.length < 3) {
                this.warnings.push(`Region with only ${state.regionPoints.length} points discarded`);
                return;
            }
            
            // Close region if needed
            const first = state.regionPoints[0];
            const last = state.regionPoints[state.regionPoints.length - 1];
            const precision = config.geometry?.coordinatePrecision || 0.001;
            
            if (Math.abs(first.x - last.x) > precision || Math.abs(first.y - last.y) > precision) {
                state.regionPoints.push({ ...first });
            }
            
            const region = {
                type: 'region',
                points: [...state.regionPoints],
                polarity: state.polarity
            };
            
            this.layers.objects.push(region);
            this.debugStats.regionsCreated++;
            this.debugStats.totalObjects++;
            this.debug(`Created region with ${region.points.length} points`);
        }
        
        createTrace(start, end, state) {
            if (!state.aperture) {
                this.warnings.push(`Draw operation without aperture at (${end.x}, ${end.y})`);
                return;
            }
            
            const aperture = state.apertures.get(state.aperture);
            if (!aperture) {
                this.warnings.push(`Undefined aperture ${state.aperture}`);
                return;
            }
            
            const trace = {
                type: 'trace',
                start: { ...start },
                end: { ...end },
                width: aperture.parameters[0] || formatConfig.defaultAperture || 0.1,
                aperture: state.aperture,
                polarity: state.polarity,
                interpolation: state.interpolation
            };
            
            this.layers.objects.push(trace);
            this.debugStats.tracesCreated++;
            this.debugStats.totalObjects++;
            this.debug(`Created trace from (${start.x.toFixed(3)}, ${start.y.toFixed(3)}) to (${end.x.toFixed(3)}, ${end.y.toFixed(3)})`);
        }
        
        createFlash(position, state) {
            if (!state.aperture) {
                this.warnings.push(`Flash operation without aperture at (${position.x}, ${position.y})`);
                return;
            }
            
            const aperture = state.apertures.get(state.aperture);
            if (!aperture) {
                this.warnings.push(`Undefined aperture ${state.aperture}`);
                return;
            }
            
            const flash = {
                type: 'flash',
                position: { ...position },
                shape: aperture.type,
                parameters: [...aperture.parameters],
                aperture: state.aperture,
                polarity: state.polarity
            };
            
            // Add convenience properties
            if (aperture.type === 'circle') {
                flash.radius = aperture.parameters[0] / 2;
            } else if (aperture.type === 'rectangle') {
                flash.width = aperture.parameters[0];
                flash.height = aperture.parameters[1] || aperture.parameters[0];
            } else if (aperture.type === 'obround') {
                flash.width = aperture.parameters[0];
                flash.height = aperture.parameters[1] || aperture.parameters[0];
            }
            
            this.layers.objects.push(flash);
            this.debugStats.flashesCreated++;
            this.debugStats.totalObjects++;
            this.debug(`Created flash at (${position.x.toFixed(3)}, ${position.y.toFixed(3)})`);
        }
        
        finalizeParse() {
            // Remove duplicate traces that match region boundaries
            this.removeDuplicateTraces();
            
            // Export apertures
            const apertureMap = new Map();
            this.layers.objects.forEach(obj => {
                if (obj.aperture) {
                    // Find aperture definition from executed commands
                    const aperture = this.findApertureDefinition(obj.aperture);
                    if (aperture) {
                        apertureMap.set(aperture.code, aperture);
                    }
                }
            });
            
            this.layers.apertures = Array.from(apertureMap.values());
            
            // Calculate bounds
            this.calculateBounds();
        }
        
        removeDuplicateTraces() {
            const regions = this.layers.objects.filter(obj => obj.type === 'region');
            if (regions.length === 0) return;
            
            this.debug(`Checking ${regions.length} regions for duplicate traces`);
            
            // Build comprehensive edge map from all regions
            const regionEdges = new Map();
            regions.forEach((region, idx) => {
                if (!region.points || region.points.length < 2) return;
                
                for (let i = 0; i < region.points.length - 1; i++) {
                    const p1 = region.points[i];
                    const p2 = region.points[i + 1];
                    const edgeKey = this.createEdgeKey(p1, p2);
                    regionEdges.set(edgeKey, `region${idx}_edge${i}`);
                    
                    // Also store reverse edge for bidirectional matching
                    const reverseKey = this.createEdgeKey(p2, p1);
                    regionEdges.set(reverseKey, `region${idx}_edge${i}_reverse`);
                }
            });
            
            this.debug(`Built edge map with ${regionEdges.size} edges (including reverses)`);
            
            // Remove traces that match region edges
            const originalObjects = [...this.layers.objects];
            const kept = [];
            let removedCount = 0;
            
            originalObjects.forEach(obj => {
                if (obj.type !== 'trace') {
                    kept.push(obj);
                    return;
                }
                
                // Check both directions
                const edgeKey = this.createEdgeKey(obj.start, obj.end);
                const reverseKey = this.createEdgeKey(obj.end, obj.start);
                
                if (regionEdges.has(edgeKey) || regionEdges.has(reverseKey)) {
                    removedCount++;
                    this.debugStats.tracesCreated--;
                    this.debugStats.totalObjects--;
                    this.debug(`Removed duplicate trace: (${obj.start.x.toFixed(3)}, ${obj.start.y.toFixed(3)}) to (${obj.end.x.toFixed(3)}, ${obj.end.y.toFixed(3)})`);
                } else {
                    kept.push(obj);
                }
            });
            
            this.layers.objects = kept;
            
            if (removedCount > 0) {
                this.debug(`DEDUPLICATION: Removed ${removedCount} duplicate traces matching region boundaries`);
            }
        }
        
        createEdgeKey(p1, p2) {
            // Use fixed precision to avoid floating point comparison issues
            const precision = config.gcode?.precision?.coordinates || 3;
            const x1 = p1.x.toFixed(precision);
            const y1 = p1.y.toFixed(precision);
            const x2 = p2.x.toFixed(precision);
            const y2 = p2.y.toFixed(precision);
            return `${x1},${y1}-${x2},${y2}`;
        }
        
        findApertureDefinition(code) {
            // Search through objects for aperture info
            for (const obj of this.layers.objects) {
                if (obj.aperture === code && obj.shape) {
                    return {
                        code: code,
                        type: obj.shape,
                        parameters: obj.parameters || []
                    };
                }
            }
            return null;
        }
        
        calculateBounds() {
            if (this.layers.objects.length === 0) return;
            
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            
            this.layers.objects.forEach(obj => {
                if (obj.type === 'region' && obj.points) {
                    obj.points.forEach(p => {
                        minX = Math.min(minX, p.x);
                        minY = Math.min(minY, p.y);
                        maxX = Math.max(maxX, p.x);
                        maxY = Math.max(maxY, p.y);
                    });
                } else if (obj.type === 'trace') {
                    const halfWidth = (obj.width || 0) / 2;
                    minX = Math.min(minX, obj.start.x - halfWidth, obj.end.x - halfWidth);
                    minY = Math.min(minY, obj.start.y - halfWidth, obj.end.y - halfWidth);
                    maxX = Math.max(maxX, obj.start.x + halfWidth, obj.end.x + halfWidth);
                    maxY = Math.max(maxY, obj.start.y + halfWidth, obj.end.y + halfWidth);
                } else if (obj.type === 'flash') {
                    const radius = obj.radius || (Math.max(obj.width || 0, obj.height || 0) / 2);
                    minX = Math.min(minX, obj.position.x - radius);
                    minY = Math.min(minY, obj.position.y - radius);
                    maxX = Math.max(maxX, obj.position.x + radius);
                    maxY = Math.max(maxY, obj.position.y + radius);
                }
            });
            
            this.layers.bounds = {
                minX, minY, maxX, maxY,
                width: maxX - minX,
                height: maxY - minY
            };
        }
        
        getApertureShape(char) {
            switch (char) {
                case 'C': return 'circle';
                case 'R': return 'rectangle';
                case 'O': return 'obround';
                case 'P': return 'polygon';
                default: return 'unknown';
            }
        }
        
        debug(message) {
            if (this.options.debug) {
                console.log(`[GerberSemantic] ${message}`);
            }
        }
    }
    
    // Export
    window.GerberSemanticParser = GerberSemanticParser;
    
})();