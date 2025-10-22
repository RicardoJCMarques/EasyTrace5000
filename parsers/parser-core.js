/**
 * @file        parsers/parser-core.js
 * @description Shared parsing infrastructure for all file formats
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
    const formatConfig = config.formats || {};
    const geomConfig = config.geometry || {};
    const debugConfig = config.debug || {};
    const validationConfig = debugConfig.validation || {};
    
    class ParserCore {
        constructor(options = {}) {
            this.options = {
                debug: options.debug !== undefined ? options.debug : debugConfig.enabled,
                units: 'mm',
                format: { integer: 3, decimal: 3 },
                ...options
            };
            
            // Common state
            this.errors = [];
            this.warnings = [];
            this.bounds = null;
            
            // Statistics
            this.stats = {
                linesProcessed: 0,
                objectsCreated: 0,
                coordinatesParsed: 0,
                invalidCoordinates: 0,
                commandsProcessed: 0
            };
            
            // Coordinate validation
            this.coordinateValidation = {
                validCoordinates: 0,
                invalidCoordinates: 0,
                coordinateRange: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
                suspiciousCoordinates: []
            };
        }
        
        // Common parsing utilities
        parseCoordinateValue(value, format, units) {
            if (typeof value === 'number') {
                return units === 'inch' ? value * 25.4 : value;
            }
            
            const valueStr = String(value);
            
            // Handle decimal notation
            if (valueStr.includes('.')) {
                let coord = parseFloat(valueStr);
                if (!isFinite(coord)) {
                    throw new Error(`Invalid decimal coordinate: ${value}`);
                }
                if (units === 'inch') coord *= 25.4;
                return coord;
            }
            
            // Handle integer notation
            const negative = valueStr.startsWith('-');
            const absValue = valueStr.replace(/^[+-]/, '');
            
            const totalDigits = format.integer + format.decimal;
            const padded = absValue.padStart(totalDigits, '0');
            
            const integerPart = padded.slice(0, format.integer);
            const decimalPart = padded.slice(format.integer);
            
            let coord = parseFloat(`${integerPart}.${decimalPart}`);
            
            if (!isFinite(coord)) {
                throw new Error(`Invalid formatted coordinate: ${value}`);
            }
            
            if (negative) coord = -coord;
            if (units === 'inch') coord *= 25.4;
            
            return coord;
        }
        
        validateCoordinates(coordinates, lineNumber = 0) {
            // Check for finite values
            if (!isFinite(coordinates.x) || !isFinite(coordinates.y)) {
                this.errors.push(`Non-finite coordinates at line ${lineNumber}: (${coordinates.x}, ${coordinates.y})`);
                this.coordinateValidation.invalidCoordinates++;
                return false;
            }
            
            // Check for reasonable coordinate ranges
            const maxCoordinate = geomConfig.maxCoordinate || 1000;
            if (validationConfig.validateCoordinates && 
                (Math.abs(coordinates.x) > maxCoordinate || Math.abs(coordinates.y) > maxCoordinate)) {
                this.coordinateValidation.suspiciousCoordinates.push({
                    line: lineNumber,
                    coordinates: { ...coordinates },
                    reason: 'coordinates_too_large'
                });
                this.warnings.push(`Large coordinates at line ${lineNumber}: (${coordinates.x.toFixed(3)}, ${coordinates.y.toFixed(3)})`);
            }
            
            // Check precision
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
        
        calculateBounds(objects) {
            if (!objects || objects.length === 0) {
                return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
            }
            
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            
            objects.forEach(obj => {
                const bounds = this.getObjectBounds(obj);
                if (bounds) {
                    minX = Math.min(minX, bounds.minX);
                    minY = Math.min(minY, bounds.minY);
                    maxX = Math.max(maxX, bounds.maxX);
                    maxY = Math.max(maxY, bounds.maxY);
                }
            });
            
            if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
                return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
            }
            
            return { minX, minY, maxX, maxY };
        }
        
        getObjectBounds(obj) {
            switch (obj.type) {
                case 'region':
                    return this.getRegionBounds(obj);
                case 'trace':
                    return this.getTraceBounds(obj);
                case 'flash':
                    return this.getFlashBounds(obj);
                case 'hole':
                case 'drill':
                    return this.getDrillBounds(obj);
                default:
                    return null;
            }
        }
        
        getRegionBounds(region) {
            if (!region.points || region.points.length === 0) return null;
            
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            
            region.points.forEach(p => {
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x);
                maxY = Math.max(maxY, p.y);
            });
            
            return { minX, minY, maxX, maxY };
        }
        
        getTraceBounds(trace) {
            const halfWidth = (trace.width || 0) / 2;
            return {
                minX: Math.min(trace.start.x, trace.end.x) - halfWidth,
                minY: Math.min(trace.start.y, trace.end.y) - halfWidth,
                maxX: Math.max(trace.start.x, trace.end.x) + halfWidth,
                maxY: Math.max(trace.start.y, trace.end.y) + halfWidth
            };
        }
        
        getFlashBounds(flash) {
            const radius = flash.radius || 
                         (Math.max(flash.width || 0, flash.height || 0) / 2) ||
                         ((flash.parameters && flash.parameters[0]) ? flash.parameters[0] / 2 : 0.5);
            
            return {
                minX: flash.position.x - radius,
                minY: flash.position.y - radius,
                maxX: flash.position.x + radius,
                maxY: flash.position.y + radius
            };
        }
        
        getDrillBounds(drill) {
            const radius = drill.diameter ? drill.diameter / 2 : 0.5;
            return {
                minX: drill.position.x - radius,
                minY: drill.position.y - radius,
                maxX: drill.position.x + radius,
                maxY: drill.position.y + radius
            };
        }
        
        // Delegate to GeometryUtils for winding
        calculateWinding(points) {
            if (typeof GeometryUtils !== 'undefined') {
                return GeometryUtils.calculateWinding(points);
            }
        }
        
        isClockwise(points) {
            if (typeof GeometryUtils !== 'undefined') {
                return GeometryUtils.isClockwise(points);
            }
        }
        
        // Edge deduplication utilities
        createEdgeKey(p1, p2, precision = 3) {
            const x1 = p1.x.toFixed(precision);
            const y1 = p1.y.toFixed(precision);
            const x2 = p2.x.toFixed(precision);
            const y2 = p2.y.toFixed(precision);
            return `${x1},${y1}-${x2},${y2}`;
        }
        
        buildEdgeMap(regions) {
            const edgeMap = new Map();
            
            regions.forEach((region, idx) => {
                if (!region.points || region.points.length < 2) return;
                
                for (let i = 0; i < region.points.length - 1; i++) {
                    const p1 = region.points[i];
                    const p2 = region.points[i + 1];
                    const edgeKey = this.createEdgeKey(p1, p2);
                    edgeMap.set(edgeKey, `region${idx}_edge${i}`);
                    
                    // Store reverse edge for bidirectional matching
                    const reverseKey = this.createEdgeKey(p2, p1);
                    edgeMap.set(reverseKey, `region${idx}_edge${i}_reverse`);
                }
            });
            
            return edgeMap;
        }
        
        removeDuplicateTraces(objects) {
            const regions = objects.filter(obj => obj.type === 'region');
            if (regions.length === 0) return objects;
            
            const edgeMap = this.buildEdgeMap(regions);
            const kept = [];
            let removedCount = 0;
            
            objects.forEach(obj => {
                if (obj.type !== 'trace') {
                    kept.push(obj);
                    return;
                }
                
                const edgeKey = this.createEdgeKey(obj.start, obj.end);
                const reverseKey = this.createEdgeKey(obj.end, obj.start);
                
                if (edgeMap.has(edgeKey) || edgeMap.has(reverseKey)) {
                    removedCount++;
                    this.debug(`Removed duplicate trace: (${obj.start.x.toFixed(3)}, ${obj.start.y.toFixed(3)}) to (${obj.end.x.toFixed(3)}, ${obj.end.y.toFixed(3)})`);
                } else {
                    kept.push(obj);
                }
            });
            
            if (removedCount > 0) {
                this.debug(`Removed ${removedCount} duplicate traces`);
            }
            
            return kept;
        }
        
        // Delegate to GeometryUtils for arc interpolation
        interpolateArc(start, end, center, clockwise, segments = null) {
            if (typeof GeometryUtils !== 'undefined') {
                return GeometryUtils.interpolateArc(start, end, center, clockwise, segments);
            }

        }
        
        // Logging utilities
        debug(message, data = null) {
            if (this.options.debug) {
                if (data) {
                    console.log(`[Parser] ${message}`, data);
                } else {
                    console.log(`[Parser] ${message}`);
                }
            }
        }
        
        logStatistics() {
            if (!this.options.debug) return;
            
            this.debug('Parse Statistics:');
            this.debug(`  Lines processed: ${this.stats.linesProcessed}`);
            this.debug(`  Objects created: ${this.stats.objectsCreated}`);
            this.debug(`  Commands processed: ${this.stats.commandsProcessed}`);
            this.debug(`  Coordinates parsed: ${this.stats.coordinatesParsed}`);
            this.debug(`  Invalid coordinates: ${this.stats.invalidCoordinates}`);
            
            if (this.coordinateValidation.validCoordinates > 0) {
                const range = this.coordinateValidation.coordinateRange;
                this.debug(`  Coordinate range: (${range.minX.toFixed(3)}, ${range.minY.toFixed(3)}) to (${range.maxX.toFixed(3)}, ${range.maxY.toFixed(3)})`);
            }
        }
    }
    
    // Export
    window.ParserCore = ParserCore;
    
})();