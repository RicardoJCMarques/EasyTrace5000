/**
 * @file        parser/parser-excellon.js
 * @description Excellon parsing module -
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
    const formatConfig = config.formats?.excellon || {};
    
    class ExcellonParser extends ParserCore {
        constructor(options = {}) {
            super({
                units: 'mm',
                format: { integer: 2, decimal: 4 },
                ...options
            });
            
            this.tools = new Map();
            this.currentTool = null;
            this.inHeader = false;
            this.headerEnded = false;
            
            this.drillData = {
                units: 'mm',
                format: this.options.format,
                tools: [],
                holes: [],
                bounds: null,
                stats: {}
            };
        }
        
        parse(content) {
            try {
                this.debug('Excellon parse (strict)');
                this.reset();
                
                const lines = content
                    .replace(/\r\n/g, '\n')
                    .replace(/\r/g, '\n')
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => {
                        if (line.length === 0) return false;
                        // Keep FILE_FORMAT comments (EasyEDA)
                        if (line.match(/^;FILE_FORMAT=/i)) return true;
                        // Skip other comments
                        if (line.match(/^;/)) return false;
                        return true;
                    });
                
                this.debug(`Processing ${lines.length} lines`);
                
                lines.forEach((line, index) => {
                    this.processLine(line, index + 1);
                    this.stats.linesProcessed++;
                });
                
                this.finalizeParse();
                
                this.debug(`Complete: ${this.drillData.holes.length} holes, ${this.tools.size} tools`);
                this.logStatistics();
                
                return {
                    success: this.errors.length === 0,
                    drillData: this.drillData,
                    errors: this.errors,
                    warnings: this.warnings,
                    coordinateValidation: this.coordinateValidation
                };
                
            } catch (error) {
                this.errors.push(`Fatal: ${error.message}`);
                console.error('[Excellon] Parse error:', error);
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
            
            this.drillData = {
                units: 'mm',
                format: this.options.format,
                tools: [],
                holes: [],
                bounds: null,
                stats: {}
            };
        }
        
        processLine(line, lineNumber) {
            this.stats.commandsProcessed++;
            
            if (line.match(/^;FILE_FORMAT=/i)) {
                const match = line.match(/FILE_FORMAT[=\s]+(\d+):(\d+)/i);
                if (match) {
                    const intDigits = parseInt(match[1]);
                    const decDigits = parseInt(match[2]);
                    this.options.format = { integer: intDigits, decimal: decDigits };
                    this.drillData.format = this.options.format;
                    this.debug(`Format: ${intDigits}.${decDigits} (from FILE_FORMAT comment)`);
                }
                return;
            }
            
            if (line === 'M48') {
                this.inHeader = true;
                this.debug('Header start');
                return;
            }
            
            if (line === '%') {
                if (!this.headerEnded) {
                    this.inHeader = !this.inHeader;
                    if (!this.inHeader) this.headerEnded = true;
                    this.debug(`Header ${this.headerEnded ? 'end' : 'start'}`);
                }
                return;
            }
            
            if (line === 'M30' || line === 'M00') {
                this.debug('EOF');
                return;
            }
            
            if (line === 'METRIC' || line === 'M71') {
                this.options.units = 'mm';
                this.drillData.units = 'mm';
                this.debug('Units: mm');
                return;
            }
            
            if (line === 'INCH' || line === 'M72') {
                this.options.units = 'inch';
                this.drillData.units = 'inch';
                this.debug('Units: inch');
                return;
            }
            
            if (line.startsWith('FMAT')) {
                this.parseFormat(line, lineNumber);
                return;
            }
            
            if (line.match(/^T\d+C/)) {
                this.parseToolDefinition(line, lineNumber);
                return;
            }
            
            if (line.match(/^T\d+$/) && this.headerEnded) {
                this.selectTool(line, lineNumber);
                return;
            }
            
            if (line.match(/[XY]/) && this.headerEnded) {
                this.parseDrillOperation(line, lineNumber);
                return;
            }
            
            if (line.match(/^G\d+/)) {
                return;
            }
        }
        
        parseFormat(line, lineNumber) {
            const match = line.match(/FMAT,?(\d)/);
            if (match) {
                const code = parseInt(match[1]);
                if (code === 1) {
                    this.options.format = { integer: 2, decimal: 3 };
                } else if (code === 2) {
                    this.options.format = { integer: 2, decimal: 4 };
                } else {
                    this.warnings.push(`Line ${lineNumber}: Unknown FMAT ${code}`);
                }
                this.drillData.format = this.options.format;
                this.debug(`Format: ${this.options.format.integer}.${this.options.format.decimal}`);
            }
        }
        
        parseToolDefinition(line, lineNumber) {
            const match = line.match(/^T(\d+)C([0-9.]+)/);
            if (!match) {
                this.errors.push(`Line ${lineNumber}: Invalid tool syntax "${line}"`);
                return;
            }
            
            const number = parseInt(match[1]);
            const toolKey = `T${number.toString().padStart(2, '0')}`;
            let diameter = parseFloat(match[2]);
            
            if (!isFinite(diameter) || diameter <= 0) {
                this.errors.push(`Line ${lineNumber}: Invalid diameter "${match[2]}"`);
                return;
            }
            
            const originalUnits = this.options.units;
            const displayDiameter = originalUnits === 'inch' ? diameter * 25.4 : diameter;
            
            const tool = {
                number: number,
                key: toolKey,
                diameter: displayDiameter,
                originalDiameter: diameter,
                originalUnits: originalUnits
            };
            
            this.tools.set(toolKey, tool);
            this.drillData.tools.push(tool);
            this.debug(`Tool ${toolKey}: ⌀${displayDiameter.toFixed(3)}mm`);
        }
        
        selectTool(line, lineNumber) {
            const match = line.match(/^T(\d+)$/);
            if (!match) return;
            
            const number = parseInt(match[1]);
            
            if (number === 0) {
                this.debug('T0: Deselect');
                this.currentTool = null;
                return;
            }
            
            const toolKey = `T${number.toString().padStart(2, '0')}`;
            
            if (!this.tools.has(toolKey)) {
                this.errors.push(`Line ${lineNumber}: Tool ${toolKey} undefined`);
                this.currentTool = null;
                return;
            }
            
            this.currentTool = toolKey;
            const tool = this.tools.get(toolKey);
            this.debug(`Select ${toolKey}: ⌀${tool.diameter.toFixed(3)}mm`);
        }
        
        parseDrillOperation(line, lineNumber) {
            if (!this.currentTool) {
                this.errors.push(`Line ${lineNumber}: No tool selected`);
                return;
            }
        
            const tool = this.tools.get(this.currentTool);
        
            if (line.includes('G85')) {
                const slotMatch = line.match(/X([+-]?\d+\.?\d*)\s*Y([+-]?\d+\.?\d*)\s*G85\s*X([+-]?\d+\.?\d*)\s*Y([+-]?\d+\.?\d*)/);
        
                if (slotMatch) {
                    try {
                        const startCoords = {
                            x: this.parseCoordinateValue(slotMatch[1], this.options.format, this.options.units),
                            y: this.parseCoordinateValue(slotMatch[2], this.options.format, this.options.units)
                        };
                        const endCoords = {
                            x: this.parseCoordinateValue(slotMatch[3], this.options.format, this.options.units),
                            y: this.parseCoordinateValue(slotMatch[4], this.options.format, this.options.units)
                        };
            
                        if (!this.validateCoordinates(startCoords, lineNumber) || !this.validateCoordinates(endCoords, lineNumber)) {
                            return;
                        }
            
                        this.updateCoordinateRange(startCoords);
                        this.updateCoordinateRange(endCoords);
            
                        this.drillData.holes.push({
                            type: 'slot',
                            start: startCoords,
                            end: endCoords,
                            tool: this.currentTool,
                            diameter: tool.diameter,
                            plated: true
                        });
            
                        this.stats.objectsCreated++;
                        this.stats.coordinatesParsed += 4;
            
                    } catch (error) {
                        this.errors.push(`Line ${lineNumber}: Error parsing slot coordinates - ${error.message}`);
                    }
                } else {
                    this.errors.push(`Line ${lineNumber}: Malformed G85 slot command: "${line}"`);
                }
            } else {
                // This is a standard drill hit.
                const coordinates = this.parseCoordinates(line, lineNumber);
                if (!coordinates) {
                    // parseCoordinates will have already pushed an error if necessary.
                    return;
                }
        
                this.drillData.holes.push({
                    type: 'hole',
                    position: coordinates,
                    tool: this.currentTool,
                    diameter: tool.diameter,
                    plated: true
                });
        
                this.stats.objectsCreated++;
            }
        }

        
        parseCoordinates(line, lineNumber) {
            const xMatch = line.match(/X([+-]?\d+\.?\d*)/);
            const yMatch = line.match(/Y([+-]?\d+\.?\d*)/);
            
            if (!xMatch && !yMatch) {
                this.errors.push(`Line ${lineNumber}: No coordinates in "${line}"`);
                return null;
            }
            
            try {
                const coordinates = { x: 0, y: 0 };
                
                if (xMatch) {
                    coordinates.x = this.parseCoordinateValue(xMatch[1], this.options.format, this.options.units);
                    this.stats.coordinatesParsed++;
                }
                
                if (yMatch) {
                    coordinates.y = this.parseCoordinateValue(yMatch[1], this.options.format, this.options.units);
                    this.stats.coordinatesParsed++;
                }
                
                if (!this.validateCoordinates(coordinates, lineNumber)) {
                    return null;
                }
                
                this.coordinateValidation.validCoordinates++;
                this.updateCoordinateRange(coordinates);
                
                return coordinates;
                
            } catch (error) {
                this.coordinateValidation.invalidCoordinates++;
                this.stats.invalidCoordinates++;
                this.errors.push(`Line ${lineNumber}: ${error.message}`);
                return null;
            }
        }
        
        finalizeParse() {
            if (this.tools.size === 0 && this.drillData.holes.length > 0) {
                this.errors.push('Holes found but no tools defined');
            }
            
            this.calculateDrillBounds();
            this.validateCoordinateConsistency();
            this.generateDrillStats();
            
            this.drillData.units = 'mm';
        }
        
        calculateDrillBounds() {
            if (this.drillData.holes.length === 0) {
                this.drillData.bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
                return;
            }
        
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
        
            this.drillData.holes.forEach(item => {
                const radius = item.diameter / 2;
        
                switch (item.type) {
                    case 'hole':
                        // Handle standard circular holes which have a 'position' property
                        if (item.position) {
                            minX = Math.min(minX, item.position.x - radius);
                            minY = Math.min(minY, item.position.y - radius);
                            maxX = Math.max(maxX, item.position.x + radius);
                            maxY = Math.max(maxY, item.position.y + radius);
                        }
                        break;
        
                    case 'slot':
                        // Handle slots which have 'start' and 'end' properties
                        if (item.start && item.end) {
                            minX = Math.min(minX, item.start.x - radius, item.end.x - radius);
                            minY = Math.min(minY, item.start.y - radius, item.end.y - radius);
                            maxX = Math.max(maxX, item.start.x + radius, item.end.x + radius);
                            maxY = Math.max(maxY, item.start.y + radius, item.end.y + radius);
                        }
                        break;
                }
            });
            
            if (!isFinite(minX)) {
                this.drillData.bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
            } else {
                this.drillData.bounds = { minX, minY, maxX, maxY };
            }
        }
        
        validateCoordinateConsistency() {
            if (this.drillData.holes.length === 0) return;
            
            const range = this.coordinateValidation.coordinateRange;
            const width = range.maxX - range.minX;
            const height = range.maxY - range.minY;
            
            if (width > 1000 || height > 1000) {
                this.warnings.push(`Large board: ${width.toFixed(1)}×${height.toFixed(1)}mm`);
            }
        }
        
        generateDrillStats() {
            const toolUsage = new Map();
            this.drillData.holes.forEach(hole => {
                toolUsage.set(hole.tool, (toolUsage.get(hole.tool) || 0) + 1);
            });
            
            this.drillData.stats = {
                totalHoles: this.drillData.holes.length,
                toolCount: this.tools.size,
                toolUsage: Object.fromEntries(toolUsage)
            };
        }
    }
    
    window.ExcellonParser = ExcellonParser;
})();