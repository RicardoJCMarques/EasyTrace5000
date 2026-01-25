/*!
 * @file        parser/parser-gerber.js
 * @description Gerber parsing module (RS-274X)
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

/*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2025-2026 Eltryus
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

    const config = window.PCBCAMConfig;
    const formatConfig = config.formats.gerber;

    class GerberParser extends ParserCore {
        constructor(options = {}) {
            super({
                units: formatConfig.defaultUnits,
                format: formatConfig.defaultFormat,
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
            // Aperture Macro Definition
            // Handles both single-line (EasyEDA) and multi-line (KiCad) formats
            if (block.startsWith('AM')) {
                // Use [\s\S]* to match across newlines
                const match = block.match(/^AM([A-Za-z_][A-Za-z0-9_]*)\*([\s\S]*)/);
                if (match) {
                    const macroName = match[1];
                    // Clean up content: remove trailing asterisks and whitespace
                    let macroContent = match[2].trim();
                    // Remove trailing * if present (common in single-line macros)
                    if (macroContent.endsWith('*')) {
                        macroContent = macroContent.slice(0, -1);
                    }
                    
                    this.state.macros.set(macroName, { 
                        name: macroName, 
                        content: macroContent 
                    });
                    this.debug(`Defined Macro: ${macroName} (${macroContent.length} chars)`);
                    return { type: 'MACRO_DEF', params: { name: macroName }, line: lineNumber };
                }
            }

            // Aperture Definition - check macro shapes before standard shapes to prevent partial matches (e.g., 'R' from 'RoundRect')
            if (block.startsWith('AD')) {
                const dCode = block.match(/^ADD(\d+)/);
                if (!dCode) {
                    this.warnings.push(`Line ${lineNumber}: Invalid aperture definition: ${block}`);
                    return { type: 'UNKNOWN', params: { content: block }, line: lineNumber };
                }

                const code = `D${dCode[1]}`;
                const afterDCode = block.slice(dCode[0].length);

                // Try to match standard shapes first (single letter followed by comma)
                const stdMatch = afterDCode.match(/^([CROP]),(.*)$/);
                if (stdMatch) {
                    const shapeChar = stdMatch[1];
                    const paramStr = stdMatch[2].replace(/\*$/, ''); // Remove trailing *
                    return {
                        type: 'DEFINE_APERTURE',
                        params: {
                            code: code,
                            shape: this.getApertureShape(shapeChar),
                            parameters: this._parseApertureParameters(paramStr)
                        },
                        line: lineNumber
                    };
                }

                // Try macro shapes (word followed by comma)
                const macroMatch = afterDCode.match(/^([A-Za-z_][A-Za-z0-9_]*),(.*)$/);
                if (macroMatch) {
                    const macroName = macroMatch[1];
                    const paramStr = macroMatch[2].replace(/\*$/, ''); // Remove trailing *

                    if (this.state.macros.has(macroName)) {
                        return {
                            type: 'DEFINE_APERTURE',
                            params: {
                                code: code,
                                shape: 'macro',
                                macroName: macroName,
                                variables: this._parseApertureParameters(paramStr)
                            },
                            line: lineNumber
                        };
                    } else {
                        this.warnings.push(`Line ${lineNumber}: Undefined macro '${macroName}' in aperture ${code}`);
                    }
                }

                // Handle apertures without parameters (e.g., %ADD10C*%)
                const noParamMatch = afterDCode.match(/^([CROP])\*?$/);
                if (noParamMatch) {
                    return {
                        type: 'DEFINE_APERTURE',
                        params: {
                            code: code,
                            shape: this.getApertureShape(noParamMatch[1]),
                            parameters: []
                        },
                        line: lineNumber
                    };
                }

                this.warnings.push(`Line ${lineNumber}: Could not parse aperture definition: ${block}`);
            }

            if (block.startsWith('FS')) {
                const match = block.match(/FS([LT])([AI])X(\d)(\d)Y(\d)(\d)/);
                if (match) {
                    return { 
                        type: 'SET_FORMAT', 
                        params: { 
                            leadingZeros: match[1] === 'L' ? 'omit' : 'keep',
                            coordinates: match[2] === 'A' ? 'absolute' : 'incremental',
                            xInteger: parseInt(match[3]), 
                            xDecimal: parseInt(match[4]), 
                            yInteger: parseInt(match[5]), 
                            yDecimal: parseInt(match[6]) 
                        }, 
                        line: lineNumber 
                    };
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

        _parseApertureParameters(paramStr) {
            if (!paramStr || paramStr.trim() === '') return [];
            return paramStr.split('X').map(p => {
                const val = parseFloat(p);
                return isNaN(val) ? 0 : val;
            });
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

        /**
         * Parses aperture macro content into executable primitive list
         */
        parseMacroContent(content) {
            const primitives = [];
            if (!content || content.trim() === '') return primitives;

            // Split by '*' to get individual statements
            // Handle both formats: newline-separated and single-line
            const statements = content
                .split('*')
                .map(s => s.trim())
                .filter(s => {
                    if (!s) return false;
                    // Filter out comments (lines starting with 0 followed by space)
                    if (/^0\s/.test(s)) return false;
                    // Filter out empty lines and pure whitespace
                    if (/^\s*$/.test(s)) return false;
                    return true;
                });

            for (const statement of statements) {
                // Handle variable assignments ($N=expression)
                if (statement.includes('=') && statement.startsWith('$')) {
                    // Variable assignment - store for later use
                    // (Currently not fully implemented, but don't crash)
                    continue;
                }

                // Parse primitive: code,params...
                const parts = statement.split(',');
                const code = parseInt(parts[0]);

                if (isNaN(code)) {
                    this.debug(`Skipping non-numeric macro statement: ${statement}`);
                    continue;
                }

                primitives.push({
                    code: code,
                    params: parts.slice(1).map(p => p.trim())
                });
            }

            return primitives;
        }

        /**
         * Evaluates a macro parameter expression, substituting variables
         */
        evaluateMacroParam(param, variables) {
            if (typeof param === 'number') return param;
            
            let expr = String(param);

            // Substitute $N variables
            expr = expr.replace(/\$(\d+)/g, (match, num) => {
                const idx = parseInt(num) - 1;
                return variables[idx] !== undefined ? variables[idx] : 0;
            });

            // Handle simple arithmetic: +, -, *, /
            // Use Function for safe evaluation of numeric expressions
            try {
                // Only allow numbers, operators, parentheses, and whitespace
                if (!/^[\d\s.+\-*/()]+$/.test(expr)) {
                    return parseFloat(expr) || 0;
                }
                return Function('"use strict"; return (' + expr + ')')();
            } catch (e) {
                return parseFloat(expr) || 0;
            }
        }

        /**
         * Executes macro primitives and returns polygon points
         */
        executeMacro(macro, variables, position) {
            const primitives = this.parseMacroContent(macro.content);
            const shapes = [];

            if (primitives.length === 0) {
                this.warnings.push(`Macro ${macro.name} has no valid primitives`);
                return shapes;
            }

            for (const prim of primitives) {
                const params = prim.params.map(p => this.evaluateMacroParam(p, variables));

                switch (prim.code) {
                    case 1: // Circle: exposure, diameter, centerX, centerY [, rotation]
                        if (params[0] === 1) {
                            const diameter = params[1];
                            const cx = params[2] || 0;
                            const cy = params[3] || 0;
                            shapes.push({
                                type: 'circle',
                                x: position.x + cx,
                                y: position.y + cy,
                                radius: diameter / 2
                            });
                        }
                        break;

                    case 4: // Outline: exposure, numVertices, x0,y0, x1,y1, ..., rotation
                        if (params[0] === 1) {
                            const numVertices = Math.floor(params[1]);
                            const points = [];
                            for (let i = 0; i <= numVertices; i++) {
                                const px = params[2 + i * 2];
                                const py = params[3 + i * 2];
                                if (px !== undefined && py !== undefined) {
                                    points.push({
                                        x: position.x + px,
                                        y: position.y + py
                                    });
                                }
                            }
                            if (points.length >= 3) {
                                // Close the polygon if not already closed
                                const first = points[0];
                                const last = points[points.length - 1];
                                if (Math.abs(first.x - last.x) > 0.0001 || Math.abs(first.y - last.y) > 0.0001) {
                                    points.push({ ...first });
                                }
                                shapes.push({ type: 'polygon', points: points });
                            }
                        }
                        break;

                    case 5: // Polygon: exposure, numVertices, centerX, centerY, diameter, rotation
                        if (params[0] === 1) {
                            const numVertices = Math.floor(params[1]);
                            const cx = position.x + (params[2] || 0);
                            const cy = position.y + (params[3] || 0);
                            const diameter = params[4] || 0;
                            const rotation = (params[5] || 0) * Math.PI / 180;
                            const radius = diameter / 2;
                            const points = [];
                            
                            for (let i = 0; i < numVertices; i++) {
                                const angle = rotation + (2 * Math.PI * i / numVertices);
                                points.push({
                                    x: cx + radius * Math.cos(angle),
                                    y: cy + radius * Math.sin(angle)
                                });
                            }
                            points.push({ ...points[0] }); // Close
                            shapes.push({ type: 'polygon', points: points });
                        }
                        break;

                    case 20: // Vector Line: exposure, width, startX, startY, endX, endY, rotation
                        if (params[0] === 1) {
                            const width = params[1];
                            const x1 = position.x + (params[2] || 0);
                            const y1 = position.y + (params[3] || 0);
                            const x2 = position.x + (params[4] || 0);
                            const y2 = position.y + (params[5] || 0);
                            shapes.push({
                                type: 'line',
                                start: { x: x1, y: y1 },
                                end: { x: x2, y: y2 },
                                width: width
                            });
                        }
                        break;

                    case 21: // Center Line (rectangle): exposure, width, height, centerX, centerY, rotation
                        if (params[0] === 1) {
                            const w = params[1] || 0;
                            const h = params[2] || 0;
                            const cx = position.x + (params[3] || 0);
                            const cy = position.y + (params[4] || 0);
                            const rotation = params[5] || 0;

                            if (rotation !== 0) {
                                // Create rotated rectangle as polygon
                                const rad = rotation * Math.PI / 180;
                                const cos = Math.cos(rad);
                                const sin = Math.sin(rad);
                                const hw = w / 2, hh = h / 2;
                                const corners = [
                                    { x: -hw, y: -hh },
                                    { x: hw, y: -hh },
                                    { x: hw, y: hh },
                                    { x: -hw, y: hh }
                                ];
                                const points = corners.map(c => ({
                                    x: cx + c.x * cos - c.y * sin,
                                    y: cy + c.x * sin + c.y * cos
                                }));
                                points.push({ ...points[0] });
                                shapes.push({ type: 'polygon', points: points });
                            } else {
                                shapes.push({
                                    type: 'rectangle',
                                    x: cx - w / 2,
                                    y: cy - h / 2,
                                    width: w,
                                    height: h
                                });
                            }
                        }
                        break;

                    case 22: // Lower-Left Line (rectangle): exposure, width, height, lowerLeftX, lowerLeftY, rotation
                        if (params[0] === 1) {
                            const w = params[1] || 0;
                            const h = params[2] || 0;
                            const llx = position.x + (params[3] || 0);
                            const lly = position.y + (params[4] || 0);
                            shapes.push({
                                type: 'rectangle',
                                x: llx,
                                y: lly,
                                width: w,
                                height: h
                            });
                        }
                        break;

                    default:
                        this.debug(`Unhandled macro primitive code: ${prim.code}`);
                }
            }

            return shapes;
        }

        /**
         * Converts macro shapes to flash polygon points
         */
        macroShapesToPolygon(shapes, position) {
            // For RoundRect-style macros, tessellate circles and combine
            const allPoints = [];
            const tolerance = config.precision.coordinate || 0.001;

            // If it's a simple case (circles at corners + lines), build rounded rect directly
            const circles = shapes.filter(s => s.type === 'circle');
            const lines = shapes.filter(s => s.type === 'line');
            const polygons = shapes.filter(s => s.type === 'polygon');

            // RoundRect pattern: 4 circles + 4 lines (or polygon outline)
            if (circles.length === 4 && (lines.length === 4 || polygons.length === 1)) {
                // Sort circles by angle from center to get corner order
                const cx = circles.reduce((sum, c) => sum + c.x, 0) / 4;
                const cy = circles.reduce((sum, c) => sum + c.y, 0) / 4;

                const sortedCircles = circles.slice().sort((a, b) => {
                    const angleA = Math.atan2(a.y - cy, a.x - cx);
                    const angleB = Math.atan2(b.y - cy, b.x - cx);
                    return angleA - angleB;
                });

                const radius = circles[0].radius;
                const segments = 8; // Per quarter circle
                const points = [];

                // Build rounded rectangle by going around corners
                for (let cornerIdx = 0; cornerIdx < 4; cornerIdx++) {
                    const circle = sortedCircles[cornerIdx];
                    const nextCircle = sortedCircles[(cornerIdx + 1) % 4];

                    // Determine which quadrant arc to draw
                    const dx = circle.x - cx;
                    const dy = circle.y - cy;

                    // Arc from edge coming in to edge going out
                    let startAngle, endAngle;
                    if (dx > 0 && dy > 0) { // Top-right
                        startAngle = 0;
                        endAngle = Math.PI / 2;
                    } else if (dx < 0 && dy > 0) { // Top-left
                        startAngle = Math.PI / 2;
                        endAngle = Math.PI;
                    } else if (dx < 0 && dy < 0) { // Bottom-left
                        startAngle = Math.PI;
                        endAngle = 3 * Math.PI / 2;
                    } else { // Bottom-right
                        startAngle = 3 * Math.PI / 2;
                        endAngle = 2 * Math.PI;
                    }

                    // Add arc points
                    for (let i = 0; i <= segments; i++) {
                        const t = i / segments;
                        const angle = startAngle + t * (endAngle - startAngle);
                        points.push({
                            x: circle.x + radius * Math.cos(angle),
                            y: circle.y + radius * Math.sin(angle)
                        });
                    }
                }
                
                return points;
            }

            // Fallback: just use polygon outline if available
            if (polygons.length > 0) {
                return polygons[0].points;
            }

            // Ultimate fallback: create bounding box
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const shape of shapes) {
                if (shape.type === 'circle') {
                    minX = Math.min(minX, shape.x - shape.radius);
                    minY = Math.min(minY, shape.y - shape.radius);
                    maxX = Math.max(maxX, shape.x + shape.radius);
                    maxY = Math.max(maxY, shape.y + shape.radius);
                }
            }

            if (isFinite(minX)) {
                return [
                    { x: minX, y: minY },
                    { x: maxX, y: minY },
                    { x: maxX, y: maxY },
                    { x: minX, y: maxY }
                ];
            }

            return null;
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

                    // Check for a zero-length draw.
                    const precision = config.precision.zeroLength;
                    const isZeroLengthDraw = Math.abs(this.state.position.x - drawPos.x) < precision &&
                                             Math.abs(this.state.position.y - drawPos.y) < precision;

                    // If start and end positions are the same treat it as a flash.
                    if (isZeroLengthDraw) {
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
            const precision = config.precision.coordinate;

            if (Math.abs(first.x - last.x) > precision || Math.abs(first.y - last.y) > precision) {
                this.state.regionPoints.push({ ...first });
            }

            // Create contours structure
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
                contours: contours
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
                    // Execute the macro with provided variables
                    const macro = this.state.macros.get(aperture.macroName);
                    if (!macro) {
                        this.warnings.push(`Undefined macro: ${aperture.macroName}`);
                        return;
                    }

                    const macroShapes = this.executeMacro(macro, aperture.variables || [], position);

                    if (macroShapes.length === 0) {
                        this.warnings.push(`Macro ${aperture.macroName} produced no geometry`);
                        return;
                    }

                    // Convert to polygon points
                    const polyPoints = this.macroShapesToPolygon(macroShapes, position);

                    if (polyPoints && polyPoints.length >= 3) {
                        flash.shape = 'polygon';
                        flash.points = polyPoints;
                    } else {
                        // Fallback to circles if polygon conversion failed
                        const circles = macroShapes.filter(s => s.type === 'circle');
                        if (circles.length > 0) {
                            // Use first circle as approximation
                            flash.shape = 'circle';
                            flash.position = { x: circles[0].x, y: circles[0].y };
                            flash.radius = circles[0].radius;
                        } else {
                            this.warnings.push(`Could not convert macro ${aperture.macroName} to geometry`);
                            return;
                        }
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