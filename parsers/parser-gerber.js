/**
 * @file        parser/parser-gerber.js
 * @description Gerber parsing module (RS-274X)
 * @author      Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

/*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2025 Eltryus
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

(function() {
    'use strict';
    
    const config = window.PCBCAMConfig || {};
    const formatConfig = config.formats?.gerber || {};
    
    class GerberParser extends ParserCore {
        constructor(options = {}) {
            super({
                units: formatConfig.defaultUnits || 'mm',
                format: formatConfig.defaultFormat || { integer: 3, decimal: 3 },
                ...options
            });
            
            // Gerber-specific state
            this.state = {
                position: { x: 0, y: 0 },
                aperture: null,
                apertures: new Map(),
                macros: new Map(),
                interpolation: 'linear',
                polarity: 'dark',
                inRegion: false,
                regionPoints: [],
                units: this.options.units,
                format: { ...this.options.format }
            };
            
            // Results
            this.layers = {
                polarity: 'positive',
                units: this.options.units,
                bounds: null,
                apertures: [],
                objects: []
            };
        }
        
        parse(content) {
            try {
                this.debug('Starting Gerber parse');
                
                // Reset state
                this.reset();
                
                // Phase 1: Tokenize into commands
                const commands = this.tokenize(content);
                this.debug(`Tokenized ${commands.length} commands`);
                
                // Phase 2: Execute commands sequentially
                this.executeCommands(commands);
                
                // Phase 3: Finalize
                this.finalizeParse();
                
                this.debug(`Parse complete: ${this.layers.objects.length} objects created`);
                this.logStatistics();
                
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
        
        reset() {
            this.state = {
                position: { x: 0, y: 0 },
                aperture: null,
                apertures: new Map(),
                macros: new Map(),
                interpolation: 'linear',
                polarity: 'dark',
                inRegion: false,
                regionPoints: [],
                units: this.options.units,
                format: { ...this.options.format }
            };
            
            this.layers = {
                polarity: 'positive',
                units: this.options.units,
                bounds: null,
                apertures: [],
                objects: []
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
        }
        
        tokenize(content) {
            const commands = [];
            let currentBlock = '';
            let inExtended = false;
            let lineNumber = 1;
            
            for (let i = 0; i < content.length; i++) {
                const char = content[i];
                
                if (char === '\n') {
                    lineNumber++;
                    this.stats.linesProcessed++;
                }
                
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
            // Aperture Macro Definition (e.g., %AMMACRO1*...%)
            if (block.startsWith('AM')) {
                const match = block.match(/AM([^*]+)\*(.*)/);
                if (match) {
                    const macroName = match[1];
                    const macroContent = match[2];
                    this.state.macros.set(macroName, { name: macroName, content: macroContent });
                    this.debug(`Defined Macro: ${macroName}`);
                    // We don't need a command, just storing the definition is enough for now.
                    return { type: 'MACRO_DEF', params: { name: macroName }, line: lineNumber };
                }
            }

            // Aperture Definition (e.g., %ADD13R,...% or %ADD11MACRO1,...%)
            if (block.startsWith('AD')) {
                // Regex for standard shapes (Circle, Rectangle, Obround, Polygon)
                const stdMatch = block.match(/^ADD(\d+)([CROP]),(.*)/);
                if (stdMatch) {
                    return {
                        type: 'DEFINE_APERTURE',
                        params: {
                            code: `D${stdMatch[1]}`,
                            shape: this.getApertureShape(stdMatch[2]),
                            parameters: stdMatch[3].split('X').map(p => parseFloat(p))
                        },
                        line: lineNumber
                    };
                }

                // Regex for macro shapes (e.g., ADD11MACRO1,2X2X90.0000)
                const macroMatch = block.match(/^ADD(\d+)(\w+),(.*)/);
                if (macroMatch && this.state.macros.has(macroMatch[2])) {
                    return {
                        type: 'DEFINE_APERTURE',
                        params: {
                            code: `D${macroMatch[1]}`,
                            shape: 'macro',
                            macroName: macroMatch[2],
                            variables: macroMatch[3].split('X').map(p => parseFloat(p))
                        },
                        line: lineNumber
                    };
                }
            }

            // --- Keep your existing handlers for other commands ---
            if (block.startsWith('FS')) {
                const match = block.match(/FS[LT][AI]X(\d)(\d)Y(\d)(\d)/);
                if (match) {
                    return { type: 'SET_FORMAT', params: { xInteger: parseInt(match[1]), xDecimal: parseInt(match[2]), yInteger: parseInt(match[3]), yDecimal: parseInt(match[4]) }, line: lineNumber };
                }
            }
            if (block.startsWith('MO')) {
                return { type: 'SET_UNITS', params: { units: block.includes('MM') ? 'mm' : 'inch' }, line: lineNumber };
            }
            if (block.startsWith('LP')) {
                return { type: 'SET_POLARITY', params: { polarity: block.includes('D') ? 'dark' : 'clear' }, line: lineNumber };
            }
            
            return { type: 'UNKNOWN', params: { content: block }, line: lineNumber };
        }
        
        parseStandardCommand(block, lineNumber) {
            const commands = [];
            let remaining = block;
            
            // Extract G-codes
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
                }
            }
            
            // Create operation command
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
                    commands.push({
                        type: 'DRAW',
                        params: coords,
                        line: lineNumber
                    });
                }
            }
            
            // Handle M-codes
            if (remaining.startsWith('M02') || remaining.startsWith('M00') || remaining.startsWith('M30')) {
                commands.push({ type: 'EOF', params: {}, line: lineNumber });
            }
            
            return commands;
        }
        
        extractCoordinates(text) {
            const coords = {};
            
            const xMatch = text.match(/X([+-]?\d+)/);
            if (xMatch) coords.x = xMatch[1];
            
            const yMatch = text.match(/Y([+-]?\d+)/);
            if (yMatch) coords.y = yMatch[1];
            
            const iMatch = text.match(/I([+-]?\d+)/);
            if (iMatch) coords.i = iMatch[1];
            
            const jMatch = text.match(/J([+-]?\d+)/);
            if (jMatch) coords.j = jMatch[1];
            
            return Object.keys(coords).length > 0 ? coords : null;
        }
        
        executeCommands(commands) {
            for (const command of commands) {
                this.executeCommand(command);
                this.stats.commandsProcessed++;
            }
            
            // Handle unclosed region
            if (this.state.inRegion && this.state.regionPoints.length > 0) {
                this.warnings.push('File ended with unclosed region');
                this.finalizeRegion();
            }
        }
        
        executeCommand(command) {
            switch (command.type) {
                case 'SET_FORMAT':
                    this.state.format.integer = command.params.xInteger;
                    this.state.format.decimal = command.params.xDecimal;
                    this.debug(`Format set to ${this.state.format.integer}.${this.state.format.decimal}`);
                    break;
                    
                case 'SET_UNITS':
                    this.state.units = command.params.units;
                    this.layers.units = this.state.units;
                    this.debug(`Units set to ${this.state.units}`);
                    break;
                    
                case 'SET_POLARITY':
                    this.state.polarity = command.params.polarity;
                    this.debug(`Polarity set to ${this.state.polarity}`);
                    break;
                    
                case 'SET_INTERPOLATION':
                    this.state.interpolation = command.params.mode;
                    break;
                    
                case 'DEFINE_APERTURE':
                    this.state.apertures.set(command.params.code, command.params);
                    break;
                    
                case 'SELECT_APERTURE':
                    this.state.aperture = command.params.aperture;
                    break;
                    
                case 'START_REGION':
                    if (!this.state.inRegion) {
                        this.state.inRegion = true;
                        this.state.regionPoints = [];
                    }
                    break;
                    
                case 'END_REGION':
                    if (this.state.inRegion) {
                        this.finalizeRegion();
                        this.state.inRegion = false;
                        this.state.regionPoints = [];
                    }
                    break;
                    
                case 'MOVE':
                    const movePos = this.parsePosition(command.params);
                    if (this.state.inRegion && this.state.regionPoints.length === 0) {
                        this.state.regionPoints.push(movePos);
                    }
                    this.state.position = movePos;
                    break;
                    
                case 'DRAW':
                    const drawPos = this.parsePosition(command.params);
                    
                    // Check for a zero-length draw, which indicates a "painted" pad.
                    // If start and end positions are the same, treat it as a flash.
                    const precision = 0.0001; // A small tolerance for floating point comparison
                    const isZeroLengthDraw = Math.abs(this.state.position.x - drawPos.x) < precision &&
                                             Math.abs(this.state.position.y - drawPos.y) < precision;

                    if (isZeroLengthDraw) {
                        // This is effectively a flash, not a trace.
                        this.debug(`Detected zero-length draw at (${drawPos.x}, ${drawPos.y}). Treating as a flash.`);
                        this.createFlash(drawPos);
                        this.state.position = drawPos;
                        break; // Exit the case here
                    }

                    // Parse arc offsets if present
                    let arcData = null;
                    if (command.params.i !== undefined || command.params.j !== undefined) {
                        arcData = {};
                        if (command.params.i !== undefined) {
                            arcData.i = this.parseCoordinateValue(command.params.i, this.state.format, this.state.units);
                            this.stats.coordinatesParsed++;
                        }
                        if (command.params.j !== undefined) {
                            arcData.j = this.parseCoordinateValue(command.params.j, this.state.format, this.state.units);
                            this.stats.coordinatesParsed++;
                        }
                    }
                    
                    if (this.state.inRegion) {
                        if (this.state.regionPoints.length === 0) {
                            this.state.regionPoints.push({ ...this.state.position });
                        }
                        this.state.regionPoints.push(drawPos);
                    } else {
                        // Pass arc data to createTrace
                        this.createTrace(this.state.position, drawPos, arcData);
                    }
                    this.state.position = drawPos;
                    break;
                    
                case 'FLASH':
                    const flashPos = this.parsePosition(command.params);
                    this.createFlash(flashPos);
                    this.state.position = flashPos;
                    break;
                    
                case 'EOF':
                    this.debug('End of file');
                    break;
            }
        }
        
        parsePosition(params) {
            const newPos = { ...this.state.position };
            
            if (params.x !== undefined) {
                newPos.x = this.parseCoordinateValue(params.x, this.state.format, this.state.units);
                this.stats.coordinatesParsed++;
            }
            
            if (params.y !== undefined) {
                newPos.y = this.parseCoordinateValue(params.y, this.state.format, this.state.units);
                this.stats.coordinatesParsed++;
            }
            
            if (this.validateCoordinates(newPos)) {
                this.updateCoordinateRange(newPos);
                this.coordinateValidation.validCoordinates++;
            }
            
            return newPos;
        }

        finalizeRegion() {
            if (this.state.regionPoints.length < 3) {
                this.warnings.push(`Region with only ${this.state.regionPoints.length} points discarded`);
                return;
            }
            
            // Close region if needed
            const first = this.state.regionPoints[0];
            const last = this.state.regionPoints[this.state.regionPoints.length - 1];
            const precision = config.geometry?.coordinatePrecision || 0.001;
            
            if (Math.abs(first.x - last.x) > precision || Math.abs(first.y - last.y) > precision) {
                this.state.regionPoints.push({ ...first });
            }
            
            // Create contours structure (matching SVG parser format)
            const contours = [{
                points: [...this.state.regionPoints],
                nestingLevel: 0,
                isHole: false,
                parentId: null
            }];
            
            const region = {
                type: 'region',
                points: [...this.state.regionPoints],
                polarity: this.state.polarity,
                contours: contours  // Use contours, not holes
            };
            
            this.layers.objects.push(region);
            this.stats.objectsCreated++;
            this.debug(`Created region with ${region.points.length} points`);
        }
        
        createTrace(start, end, arcData = null) {
            if (!this.state.aperture) {
                this.warnings.push(`Draw operation without aperture at (${end.x}, ${end.y})`);
                return;
            }
            
            const aperture = this.state.apertures.get(this.state.aperture);
            if (!aperture) {
                this.warnings.push(`Undefined aperture ${this.state.aperture}`);
                return;
            }
            
            const trace = {
                type: 'trace',
                start: { ...start },
                end: { ...end },
                width: aperture.parameters[0] || formatConfig.defaultAperture || 0.1,
                aperture: this.state.aperture,
                polarity: this.state.polarity,
                interpolation: this.state.interpolation
            };
            
            // Add arc data if present
            if (arcData && (this.state.interpolation === 'cw_arc' || this.state.interpolation === 'ccw_arc')) {
                trace.arc = arcData;
                trace.clockwise = this.state.interpolation === 'cw_arc';
                this.debug(`Created arc trace with offsets i=${arcData.i}, j=${arcData.j}`);
            }
            
            this.layers.objects.push(trace);
            this.stats.objectsCreated++;
        }
        
        createFlash(position) {
            if (!this.state.aperture) {
                this.warnings.push(`Flash operation without aperture at (${position.x}, ${position.y})`);
                return;
            }
            
            const aperture = this.state.apertures.get(this.state.aperture);
            if (!aperture) {
                this.warnings.push(`Undefined aperture ${this.state.aperture}`);
                return;
            }

            const flash = {
                type: 'flash',
                position: { ...position },
                aperture: this.state.aperture,
                polarity: this.state.polarity,
                shape: aperture.shape // Use the 'shape' property from the aperture definition
            };
            
            switch (aperture.shape) {
                case 'circle':
                    flash.radius = (aperture.parameters[0] || 0) / 2;
                    flash.parameters = aperture.parameters;
                    break;

                case 'rectangle':
                    flash.width = aperture.parameters[0];
                    flash.height = aperture.parameters[1] || aperture.parameters[0];
                    flash.parameters = aperture.parameters;
                    break;
                
                case 'obround':
                    flash.width = aperture.parameters[0];
                    flash.height = aperture.parameters[1] || aperture.parameters[0];
                    flash.parameters = aperture.parameters;
                    break;

                case 'macro':
                    if (aperture.macroName === 'MACRO1') {
                        flash.shape = 'polygon'; // The plotter receives a polygon
                        const [width, height, rotation] = aperture.variables;
                        
                        const half_w = width / 2;
                        const half_h = height / 2;
                        const angleRad = rotation * Math.PI / 180;
                        const cosA = Math.cos(angleRad);
                        const sinA = Math.sin(angleRad);

                        const corners = [
                            { x: -half_w, y: -half_h }, // Top-left
                            { x: -half_w, y:  half_h }, // Bottom-left
                            { x:  half_w, y:  half_h }, // Bottom-right
                            { x:  half_w, y: -half_h }  // Top-right
                        ];

                        flash.points = corners.map(p => ({
                            x: position.x + (p.x * cosA - p.y * sinA),
                            y: position.y + (p.x * sinA + p.y * cosA)
                        }));
                    } else {
                        this.warnings.push(`Unsupported macro flash: ${aperture.macroName}`);
                        return; 
                    }
                    break;

                default:
                     this.warnings.push(`Unsupported flash shape: ${aperture.shape}`);
                     return;
            }
            
            this.layers.objects.push(flash);
            this.stats.objectsCreated++;
        }
        
        finalizeParse() {
            // Remove duplicate traces
            this.layers.objects = this.removeDuplicateTraces(this.layers.objects);
            
            // Export apertures
            const apertureMap = new Map();
            this.layers.objects.forEach(obj => {
                if (obj.aperture) {
                    const aperture = this.state.apertures.get(obj.aperture);
                    if (aperture) {
                        apertureMap.set(aperture.code, aperture);
                    }
                }
            });
            
            this.layers.apertures = Array.from(apertureMap.values());
            
            // Calculate bounds
            this.layers.bounds = this.calculateBounds(this.layers.objects);
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
    }
    
    window.GerberParser = GerberParser;
    
})();