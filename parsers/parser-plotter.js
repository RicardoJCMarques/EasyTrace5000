/**
 * @file        parser/parser-plotter.js
 * @description Converts parsed data into geometric primitives
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
    const debugConfig = config.debug || {};
    const geomConfig = config.geometry || {};
    const segmentConfig = geomConfig.segments || {};
    
    class ParserPlotter {
        constructor(options = {}) {
            this.options = {
                debug: options.debug !== undefined ? options.debug : debugConfig.enabled,
                markStrokes: options.markStrokes || false,
                ...options
            };
            
            this.primitives = [];
            this.bounds = null;
            
            this.creationStats = {
                regionsCreated: 0,
                tracesCreated: 0,
                flashesCreated: 0,
                drillsCreated: 0,
                primitivesCreated: 0,
                regionPointCounts: [],
                traceLengths: [],
                circularObrounds: 0,
                strokedObrounds: 0,
                arcTraces: 0
            };
        }
        
        plot(parserData) {
            // Handle both Gerber and Excellon parser outputs
            if (parserData.layers) {
                return this.plotGerberData(parserData);
            } else if (parserData.drillData) {
                return this.plotExcellonData(parserData);
            } else {
                return {
                    success: false,
                    error: 'Invalid parser data format',
                    primitives: []
                };
            }
        }
        
        plotGerberData(gerberData) {
            if (!gerberData || !gerberData.layers) {
                return {
                    success: false,
                    error: 'Invalid Gerber data',
                    primitives: []
                };
            }
            
            this.debug('Starting Gerber plotting');
            
            // Reset
            this.reset();
            
            // Store apertures for reference
            this.apertures = new Map();
            if (gerberData.layers.apertures) {
                gerberData.layers.apertures.forEach(aperture => {
                    this.apertures.set(aperture.code, aperture);
                });
            }
            
            this.debug(`Input: ${gerberData.layers.objects.length} objects`);
            
            // Process each object
            gerberData.layers.objects.forEach((obj, index) => {
                try {
                    const primitive = this.plotObject(obj);
                    if (primitive) {
                        const primArray = Array.isArray(primitive) ? primitive : [primitive];
                        
                        primArray.forEach(prim => {
                            if (this.validatePrimitive(prim)) {
                                this.primitives.push(prim);
                                this.creationStats.primitivesCreated++;
                            } else {
                                this.debug(`Invalid primitive from object ${index} (${obj.type})`);
                            }
                        });
                    }
                } catch (error) {
                    console.error(`Error plotting object ${index} (${obj.type}):`, error);
                }
            });
            
            // Calculate overall bounds
            this.calculateBounds();
            
            if (this.options.debug && debugConfig.logging?.parseOperations) {
                this.logStatistics();
            }
            
            return {
                success: true,
                primitives: this.primitives,
                bounds: this.bounds,
                units: gerberData.layers.units,
                creationStats: this.creationStats
            };
        }
        
        plotExcellonData(excellonData) {
            if (!excellonData || !excellonData.drillData) {
                return {
                    success: false,
                    error: 'Invalid drill data',
                    primitives: []
                };
            }
            
            this.debug('Starting Excellon plotting');
            
            // Reset
            this.reset();
            
            const drillData = excellonData.drillData;
            
            if (drillData.holes) {
                this.debug(`Processing ${drillData.holes.length} drill holes`);
                
                drillData.holes.forEach((item, index) => {
                    let primitive = null;
                    const properties = {
                        tool: item.tool,
                        plated: item.plated,
                        polarity: 'dark'
                    };

                    if (item.type === 'slot') {
                        const { start, end, diameter } = item;
                        const tolerance = geomConfig.coordinatePrecision || 0.001;
                        const slotLength = Math.hypot(end.x - start.x, end.y - start.y);

                        if (slotLength < tolerance) {
                            // Zero-length slot = circular hole
                            primitive = new CirclePrimitive(
                                start,
                                diameter / 2,
                                {
                                    ...properties,
                                    role: 'drill_hole',
                                    diameter: diameter
                                }
                            );
                        } else {
                            // True slot
                            const halfDiameter = diameter / 2;
                            const minX = Math.min(start.x, end.x) - halfDiameter;
                            const minY = Math.min(start.y, end.y) - halfDiameter;
                            const maxX = Math.max(start.x, end.x) + halfDiameter;
                            const maxY = Math.max(start.y, end.y) + halfDiameter;
                            
                            primitive = new ObroundPrimitive(
                                { x: minX, y: minY },
                                maxX - minX,
                                maxY - minY,
                                {
                                    ...properties,
                                    role: 'drill_slot',
                                    diameter: diameter,
                                    originalSlot: { start: item.start, end: item.end }
                                }
                            );
                        }
                    } else {
                        // Standard hole
                        primitive = new CirclePrimitive(
                            item.position,
                            item.diameter / 2,
                            {
                                ...properties,
                                role: 'drill_hole',
                                diameter: item.diameter
                            }
                        );
                    }
                    
                    if (primitive) {
                        this.primitives.push(primitive);
                        this.creationStats.primitivesCreated++;
                        this.creationStats.drillsCreated++;
                    }
                });
            }
            
            this.debug(`Plotted ${this.primitives.length} drill holes`);
            
            // Calculate bounds
            this.calculateBounds();
            
            return {
                success: true,
                primitives: this.primitives,
                bounds: this.bounds,
                units: drillData.units,
                creationStats: { drillHolesCreated: this.primitives.length }
            };
        }
        
        plotObject(obj) {
            switch (obj.type) {
                case 'region':
                    return this.plotRegion(obj);
                case 'trace':
                    return this.plotTrace(obj);
                case 'flash':
                    return this.plotFlash(obj);
                case 'draw': // Legacy support
                    return this.plotDraw(obj);
                default:
                    this.debug(`Unknown object type: ${obj.type}`);
                    return null;
            }
        }

        plotRegion(region) {
            if (!region.points || !Array.isArray(region.points) || region.points.length < 3) {
                console.warn('Invalid region:', region);
                return null;
            }
            
            this.debug(`Plotting region with ${region.points.length} points`);

            // Close region if needed
            const first = region.points[0];
            const last = region.points[region.points.length - 1];
            const precision = geomConfig.coordinatePrecision || 0.001;
            
            if (Math.abs(first.x - last.x) > precision || Math.abs(first.y - last.y) > precision) {
                region.points.push({ ...first });
            }
            
            // Build contours - SINGLE SOURCE OF TRUTH
            let contours;
            
            if (region.contours && Array.isArray(region.contours)) {
                // SVG format - use directly
                contours = region.contours;
                this.debug(`  ${contours.length} contours from SVG`);
            } else {
                // Simple region (Gerber) - create basic contour
                contours = [{
                    points: region.points,
                    nestingLevel: 0,
                    isHole: false,
                    parentId: null
                }];
            }
            
            // Create primitive with contours at TOP LEVEL
            const primitive = new PathPrimitive(region.points, {
                isRegion: true,
                fill: true,
                fillRule: 'nonzero',
                polarity: region.polarity || 'dark',
                closed: true,
                contours: contours  // ← Stored here, not in properties
            });
            
            this.creationStats.regionsCreated++;
            // if (this.debug) {
                if (primitive.contours && primitive.contours.length > 1) {
                    console.log(`[Plotter] Primitive has ${primitive.contours.length} contours (${primitive.contours.filter(c => c.isHole).length} holes)`);
                }
            // }
                
            return primitive;
        }
        
        
        plotTrace(trace) {
            if (!trace.start || !trace.end) {
                console.warn('Invalid trace (missing start/end):', trace);
                return null;
            }
            
            const length = Math.sqrt(
                Math.pow(trace.end.x - trace.start.x, 2) + 
                Math.pow(trace.end.y - trace.start.y, 2)
            );
            
            this.debug(`Plotting trace: (${trace.start.x.toFixed(3)}, ${trace.start.y.toFixed(3)}) to (${trace.end.x.toFixed(3)}, ${trace.end.y.toFixed(3)}), length: ${length.toFixed(3)}mm`);
            
            // Log interpolation info
            if (trace.interpolation) {
                this.debug(`  Interpolation: "${trace.interpolation}"${trace.arc ? ', has arc data' : ''}`);
            }
            
            const width = trace.width || config.formats?.gerber?.defaultAperture;
            
            const properties = {
                isTrace: true,
                fill: false,
                stroke: true,
                strokeWidth: width,
                polarity: trace.polarity || 'dark',
                aperture: trace.aperture,
                interpolation: trace.interpolation || 'linear',
                closed: false,
                traceLength: length
            };
            
            // Mark strokes if requested
            if (this.options.markStrokes && width > 0) {
                properties.isStroke = true;
                properties.originalStroke = {
                    start: { ...trace.start },
                    end: { ...trace.end },
                    width: width
                };
            }
            
            let points;
            let arcSegments = [];
            
            // Broader arc detection - check multiple conditions
            const isArc = (trace.arc && (trace.arc.i !== 0 || trace.arc.j !== 0)) ||
                         trace.interpolation === 'cw_arc' || trace.interpolation === 'ccw_arc';

            if (isArc) {
                try {
                    const center = {
                        x: trace.start.x + trace.arc.i,
                        y: trace.start.y + trace.arc.j
                    };

                    const radius = Math.hypot(trace.arc.i, trace.arc.j);

                    // Validate radius consistency
                    const endRadius = Math.hypot(trace.end.x - center.x, trace.end.y - center.y);
                    if (Math.abs(radius - endRadius) > (geomConfig.coordinatePrecision || 0.001) * 10) {
                        console.warn(`[Plotter] Inconsistent arc radii. Start=${radius.toFixed(4)}, End=${endRadius.toFixed(4)}`);
                    }

                    const startAngle = Math.atan2(trace.start.y - center.y, trace.start.x - center.x);
                    const endAngle = Math.atan2(trace.end.y - center.y, trace.end.x - center.x);

                    const clockwise = trace.interpolation === 'cw_arc' || trace.clockwise === true;

                    this.creationStats.arcTraces++;
                    
                    // Create proper ArcPrimitive with complete metadata
                    const arcPrimitive = new ArcPrimitive(
                        center, radius, startAngle, endAngle, clockwise, {
                            ...properties,
                            // Store original trace data for debugging
                            originalTrace: {
                                start: trace.start,
                                end: trace.end,
                                i: trace.arc.i,
                                j: trace.arc.j
                            }
                        }
                    );
                    
                    console.log(`[Plotter] Created ArcPrimitive: center=(${center.x.toFixed(3)}, ${center.y.toFixed(3)}), r=${radius.toFixed(3)}, ${clockwise ? 'CW' : 'CCW'}`);
                    
                    return arcPrimitive;

                } catch (error) {
                    console.error('[Plotter] Failed to create ArcPrimitive, falling back to line:', error);
                    return new PathPrimitive([trace.start, trace.end], properties);
                }
            } else {
                // Simple line segment
                const primitive = new PathPrimitive([trace.start, trace.end], properties);
                this.creationStats.tracesCreated++;
                this.creationStats.traceLengths.push(length);
                return primitive;
            }
        }
        
        plotFlash(flash) {
            if (!flash.position) {
                console.warn('Invalid flash (missing position):', flash);
                return null;
            }
            
            this.debug(`Plotting flash at (${flash.position.x.toFixed(3)}, ${flash.position.y.toFixed(3)}), shape: ${flash.shape}`);
            
            const properties = {
                isFlash: true,
                isPad: true,
                fill: true,
                stroke: false,
                strokeWidth: 0,
                polarity: flash.polarity || 'dark',
                aperture: flash.aperture,
                shape: flash.shape
            };
            
            let primitive = null;
            
            switch (flash.shape) {
                case 'circle':
                    const radius = flash.radius || (flash.parameters?.[0] / 2) || 0.5;
                    this.debug(`  Circle flash, radius: ${radius.toFixed(3)}mm`);
                    primitive = new CirclePrimitive(flash.position, radius, properties);
                    break;
                
                case 'rectangle':
                    const width = flash.width || flash.parameters?.[0] || 1.0;
                    const height = flash.height || flash.parameters?.[1] || width;
                    this.debug(`  Rectangle flash, size: ${width.toFixed(3)} x ${height.toFixed(3)}mm`);
                    primitive = new RectanglePrimitive(
                        {
                            x: flash.position.x - width / 2,
                            y: flash.position.y - height / 2
                        },
                        width,
                        height,
                        properties
                    );
                    break;
                
                case 'obround':
                    const oWidth = flash.width || flash.parameters?.[0] || 1.0;
                    const oHeight = flash.height || flash.parameters?.[1] || oWidth;
                    
                    this.debug(`  Obround flash, size: ${oWidth.toFixed(3)} x ${oHeight.toFixed(3)}mm`);

                    // A flash's position is its center, but ObroundPrimitive's position is its top-left corner. We must adjust for this.
                    const obroundPosition = {
                        x: flash.position.x - oWidth / 2,
                        y: flash.position.y - oHeight / 2
                    };

                    // Create the proper analytic ObroundPrimitive.
                    // Its constructor correctly handles the circular case and registers the initial curves.
                    primitive = new ObroundPrimitive(obroundPosition, oWidth, oHeight, properties);
                    
                    // Update statistics based on what the constructor determined.
                    if (primitive.isCircular) {
                        this.creationStats.circularObrounds++;
                    } else {
                        // The stat name is a bit misleading now, but we'll keep it for consistency.
                        this.creationStats.strokedObrounds++;
                    }
                    break;
                
                case 'polygon':
                    const diameter = flash.diameter || flash.parameters?.[0] || 1.0;
                    const vertices = flash.vertices || flash.parameters?.[1] || 3;
                    const rotation = flash.rotation || flash.parameters?.[2] || 0;
                    
                    // Check if the parser already provided points (for a macro flash)
                    if (flash.points && flash.points.length > 0) {
                        this.debug(`  Polygon flash from pre-calculated points (${flash.points.length} vertices)`);
                        // Use the points directly from the parser's macro expansion
                        primitive = new PathPrimitive(flash.points, { ...properties, closed: true, isPolygon: true });
                    } else {
                        // Original logic for standard polygon apertures
                        this.debug(`  Polygon flash, diameter: ${diameter.toFixed(3)}mm, vertices: ${vertices}`);
                        primitive = this.createPolygonFlash(flash.position, diameter, vertices, rotation, properties);
                    }
                    break;

                
                default:
                    console.warn(`Unknown flash shape: ${flash.shape}, using circle`);
                    const defaultRadius = (flash.parameters?.[0] / 2) || 0.5;
                    primitive = new CirclePrimitive(flash.position, defaultRadius, properties);
            }
            
            if (primitive) {
                this.creationStats.flashesCreated++;
            }
            
            return primitive;
        }
        
        createStrokedObround(flash, width, height, properties) {
            // Treat obround as a stroked line with semicircular end-caps
            const isHorizontal = width > height;
            const strokeWidth = Math.min(width, height);
            const strokeLength = Math.abs(width - height);
            
            if (strokeLength < 0.001) {
                // Degenerate case - should have been caught earlier
                return new CirclePrimitive(flash.position, strokeWidth / 2, properties);
            }
            
            // Create endpoints for the virtual stroke
            let start, end;
            if (isHorizontal) {
                const halfLength = strokeLength / 2;
                start = { x: flash.position.x - halfLength, y: flash.position.y };
                end = { x: flash.position.x + halfLength, y: flash.position.y };
            } else {
                const halfLength = strokeLength / 2;
                start = { x: flash.position.x, y: flash.position.y - halfLength };
                end = { x: flash.position.x, y: flash.position.y + halfLength };
            }
            
            // Use the same pipeline as traces - this ensures consistent curve registration
            const points = GeometryUtils.lineToPolygon(start, end, strokeWidth);
            
            // Create path primitive with metadata
            return new PathPrimitive(points, {
                ...properties,
                originalObround: { 
                    width: width, 
                    height: height, 
                    position: flash.position 
                },
                isConvertedObround: true,
                closed: true
            });
        }
        
        plotDraw(draw) {
            // Legacy format support - convert to trace
            if (!draw.aperture) {
                console.warn('Draw without aperture:', draw);
                return null;
            }
            
            const aperture = this.apertures.get(draw.aperture);
            if (!aperture) {
                console.warn(`Missing aperture: ${draw.aperture}`);
                return null;
            }
            
            const trace = {
                type: 'trace',
                start: draw.start,
                end: draw.end,
                width: aperture.parameters[0] || config.formats?.gerber?.defaultAperture || 0.1,
                aperture: draw.aperture,
                polarity: draw.polarity,
                interpolation: draw.interpolation
            };
            
            if (draw.center) {
                trace.arc = {
                    i: draw.center.x - draw.start.x,
                    j: draw.center.y - draw.start.y
                };
                trace.clockwise = draw.interpolation === 'G02';
            }
            
            return this.plotTrace(trace);
        }
        
        createPolygonFlash(center, diameter, sides, rotation, properties) {
            const points = [];
            const radius = diameter / 2;
            
            for (let i = 0; i <= sides; i++) {
                const angle = (i / sides) * 2 * Math.PI + rotation;
                points.push({
                    x: center.x + radius * Math.cos(angle),
                    y: center.y + radius * Math.sin(angle)
                });
            }
            
            return new PathPrimitive(points, {
                ...properties,
                closed: true,
                isPolygon: true
            });
        }
        
        calculateArea(points) {
            let area = 0;
            for (let i = 0; i < points.length; i++) {
                const j = (i + 1) % points.length;
                area += points[i].x * points[j].y;
                area -= points[j].x * points[i].y;
            }
            return area / 2;
        }
        
        validatePrimitive(primitive) {
            if (!debugConfig.validation?.validateGeometry) {
                return true;
            }
            
            try {
                if (typeof primitive.getBounds !== 'function') {
                    console.warn('Primitive missing getBounds method:', primitive);
                    return false;
                }
                
                const bounds = primitive.getBounds();
                if (!isFinite(bounds.minX) || !isFinite(bounds.minY) || 
                    !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                    console.warn('Primitive has invalid bounds:', bounds, primitive);
                    return false;
                }
                
                if (primitive.type === 'path') {
                    if (!primitive.points || !Array.isArray(primitive.points) || primitive.points.length === 0) {
                        console.warn('Path primitive has invalid points:', primitive);
                        return false;
                    }
                } else if (primitive.type === 'circle') {
                    if (!primitive.center || !isFinite(primitive.radius) || primitive.radius <= 0) {
                        console.warn('Circle primitive has invalid geometry:', primitive);
                        return false;
                    }
                }
                
                return true;
            } catch (error) {
                console.warn('Primitive validation failed:', error, primitive);
                return false;
            }
        }
        
        calculateBounds() {
            if (this.primitives.length === 0) {
                this.bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
                return;
            }
            
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            let validPrimitives = 0;
            
            this.primitives.forEach((primitive, index) => {
                const bounds = primitive.getBounds();
                
                if (!isFinite(bounds.minX) || !isFinite(bounds.minY) || 
                    !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                    console.warn(`Primitive ${index} has invalid bounds:`, bounds);
                    return;
                }
                
                minX = Math.min(minX, bounds.minX);
                minY = Math.min(minY, bounds.minY);
                maxX = Math.max(maxX, bounds.maxX);
                maxY = Math.max(maxY, bounds.maxY);
                validPrimitives++;
            });
            
            this.bounds = { minX, minY, maxX, maxY };
            this.debug(`Calculated bounds from ${validPrimitives}/${this.primitives.length} valid primitives:`, this.bounds);
        }
        
        reset() {
            this.primitives = [];
            this.bounds = null;
            this.creationStats = {
                regionsCreated: 0,
                tracesCreated: 0,
                flashesCreated: 0,
                drillsCreated: 0,
                primitivesCreated: 0,
                regionPointCounts: [],
                traceLengths: [],
                circularObrounds: 0,
                strokedObrounds: 0,
                arcTraces: 0
            };
        }
        
        logStatistics() {
            this.debug('Plotting Statistics:');
            this.debug(`  Regions: ${this.creationStats.regionsCreated}`);
            if (this.creationStats.regionPointCounts.length > 0) {
                const avgPoints = this.creationStats.regionPointCounts.reduce((a, b) => a + b, 0) / this.creationStats.regionPointCounts.length;
                this.debug(`    Average points per region: ${avgPoints.toFixed(1)}`);
                this.debug(`    Min/Max points: ${Math.min(...this.creationStats.regionPointCounts)}/${Math.max(...this.creationStats.regionPointCounts)}`);
            }
            this.debug(`  Traces: ${this.creationStats.tracesCreated}`);
            if (this.creationStats.traceLengths.length > 0) {
                const avgLength = this.creationStats.traceLengths.reduce((a, b) => a + b, 0) / this.creationStats.traceLengths.length;
                this.debug(`    Average trace length: ${avgLength.toFixed(3)}mm`);
            }
            this.debug(`    Arc traces: ${this.creationStats.arcTraces}`);
            this.debug(`  Flashes: ${this.creationStats.flashesCreated}`);
            this.debug(`    Circular obrounds detected: ${this.creationStats.circularObrounds}`);
            this.debug(`    Stroked obrounds created: ${this.creationStats.strokedObrounds}`);
            this.debug(`  Drills: ${this.creationStats.drillsCreated}`);
            this.debug(`  Total primitives: ${this.creationStats.primitivesCreated}`);
        }
        
        debug(message, data = null) {
            if (this.options.debug) {
                if (data) {
                    console.log(`[Plotter] ${message}`, data);
                } else {
                    console.log(`[Plotter] ${message}`);
                }
            }
        }
    }
    
    window.ParserPlotter = ParserPlotter;
    
})();