/**
 * @file        parser/parser-plotter.js
 * @description Converts parser objects into geometric primitives
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
    
    /**
     * Smart translator from parser analytic objects to primitives.
     * Tessellates only when necessary for unsupported curve types.
     */
    class ParserPlotter {
        constructor(options = {}) {
            this.options = {
                debug: options.debug || false,
                markStrokes: options.markStrokes || false,
                ...options
            };
            this.reset();
        }
        
        plot(parserData) {
            if (parserData.layers) {
                return this.plotGerberData(parserData);
            } else if (parserData.drillData) {
                return this.plotExcellonData(parserData);
            }
            return { success: false, error: 'Invalid parser data format', primitives: [] };
        }
        
        plotGerberData(gerberData) {
            this.debug('Starting Gerber plotting')
            this.reset();
            
            this.apertures = new Map();
            if (gerberData.layers.apertures) {
                gerberData.layers.apertures.forEach(ap => this.apertures.set(ap.code, ap));
            }
            
            gerberData.layers.objects.forEach((obj, index) => {
                try {
                    const primitiveOrPrimitives = this.plotObject(obj);
                    if (primitiveOrPrimitives) {
                        const primArray = Array.isArray(primitiveOrPrimitives) ? 
                            primitiveOrPrimitives : [primitiveOrPrimitives];
                        primArray.forEach(prim => {
                            if (this.validatePrimitive(prim)) {
                                this.primitives.push(prim);
                                this.creationStats.primitivesCreated++;
                            }
                        });
                    }
                } catch (error) {
                    console.error(`Error plotting object ${index} (${obj.type}):`, error);
                }
            });
            
            this.calculateBounds();
            this.logStatistics();
            
            return {
                success: true,
                primitives: this.primitives,
                bounds: this.bounds,
                units: gerberData.layers.units,
                creationStats: this.creationStats
            };
        }
        
        plotExcellonData(excellonData) {
            this.debug('Starting Excellon plotting');
            this.reset();
            
            const drillData = excellonData.drillData;
            if (drillData.holes) {
                drillData.holes.forEach(item => {
                    let primitive = null;
                    const properties = { 
                        tool: item.tool, 
                        plated: item.plated, 
                        polarity: 'dark' 
                    };
                    const tolerance = geomConfig.coordinatePrecision || 0.001;

                    if (item.type === 'slot') {
                        const slotLength = Math.hypot(
                            item.end.x - item.start.x, 
                            item.end.y - item.start.y
                        );
                        if (slotLength < tolerance) {
                            primitive = new CirclePrimitive(
                                item.start, 
                                item.diameter / 2,
                                { ...properties, role: 'drill_hole', diameter: item.diameter }
                            );
                        } else {
                            const halfD = item.diameter / 2;
                            const minX = Math.min(item.start.x, item.end.x) - halfD;
                            const minY = Math.min(item.start.y, item.end.y) - halfD;
                            const maxX = Math.max(item.start.x, item.end.x) + halfD;
                            const maxY = Math.max(item.start.y, item.end.y) + halfD;
                            primitive = new ObroundPrimitive(
                                { x: minX, y: minY }, 
                                maxX - minX, 
                                maxY - minY,
                                { 
                                    ...properties, 
                                    role: 'drill_slot', 
                                    diameter: item.diameter, 
                                    originalSlot: { start: item.start, end: item.end }
                                }
                            );
                        }
                    } else {
                        primitive = new CirclePrimitive(
                            item.position, 
                            item.diameter / 2,
                            { ...properties, role: 'drill_hole', diameter: item.diameter }
                        );
                    }
                    
                    if (primitive) {
                        this.primitives.push(primitive);
                        this.creationStats.primitivesCreated++;
                        this.creationStats.drillsCreated++;
                    }
                });
            }
            
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
                case 'draw':
                    return this.plotDraw(obj);
                default:
                    this.debug(`Unknown object type: ${obj.type}`);
                    return null;
            }
        }

        /**
         * Polarity is determined by winding ONLY for compound paths (regions with >1 subpath).
         * Single subpaths are ALWAYS 'dark', regardless of winding.
         * Winding is normalized: 'dark' primitives are forced CW, 'clear' are forced CCW.
         */
        plotRegion(region) {
            const analyticSubpaths = region.analyticSubpaths;

            // This log is critical. If you see "1" for a shape that should be an outer, the logic inside will handle it. If you see "2" for an "O", it will also handle it.
            this.debug(`Received region with ${analyticSubpaths ? analyticSubpaths.length : 0} analytic subpaths.`);

            // Fallback for simple Gerber regions (no analytic data)
            if (!analyticSubpaths || analyticSubpaths.length === 0) {
                if (region.points && region.points.length > 0) {
                    const contours = region.contours || [{
                        points: region.points,
                        nestingLevel: 0,
                        isHole: false,
                        parentId: null
                    }];
                    
                    // Winding normalization for Gerber fallbacks
                    const isCW = GeometryUtils.isClockwise(region.points);
                    if (!isCW) { // Gerbers regions should be dark (outer) = CW
                        region.points.reverse();
                        this.debug(`Normalized Gerber fallback region to CW.`);
                    }

                    const primitive = new PathPrimitive(region.points, {
                        isRegion: true,
                        fill: true,
                        polarity: region.polarity || 'dark',
                        closed: true,
                        contours: contours
                    });
                    this.creationStats.regionsCreated++;
                    return primitive; // Return single primitive
                }
                this.debug('Region object has no points or analytic subpaths', region);
                return null;
            }

            const tolerance = geomConfig.coordinatePrecision || 1e-9;
            const primitives = []; 

            // Process each analytic subpath (contour)
            analyticSubpaths.forEach((segments, subpathIndex) => {

                const points = [];
                const arcSegments = [];

                // Handle simple point arrays (from polygon/polyline or transformed arcs)
                if (segments.length > 0 && segments[0].x !== undefined) {
                    primitives.push(new PathPrimitive(segments, {
                        isRegion: true,
                        fill: true,
                        polarity: 'dark', // Simple point arrays are always dark
                        closed: true
                    }));
                    return;
                }

                if (segments.length === 0) return;

                // Process analytic segments (Stitching logic)
                segments.forEach((seg, segIndex) => {
                    if (seg.type === 'move') {
                        if (points.length > 0) {
                            primitives.push(new PathPrimitive(points, {
                                isRegion: true, fill: true, polarity: 'dark',
                                closed: false, arcSegments: [...arcSegments]
                            }));
                            points.length = 0;
                            arcSegments.length = 0;
                        }
                        points.push(seg.p);
                        return;
                    }
                    if (seg.type === 'point_array') {
                        if (seg.points && seg.points.length > 0) {
                            if (points.length > 0) {
                                points.push(...seg.points.slice(1));
                            } else {
                                points.push(...seg.points);
                            }
                        }
                        return;
                    }
                    const p0 = points.length > 0 ? points[points.length - 1] : seg.p0;
                    if (points.length === 0) {
                        points.push(p0);
                    }
                    switch (seg.type) {
                        case 'line':
                            points.push(seg.p1);
                            break;
                        case 'arc':
                            if (Math.abs(seg.rx - seg.ry) < tolerance && Math.abs(seg.phi) < tolerance) {
                                arcSegments.push({
                                    startIndex: points.length - 1,
                                    endIndex: points.length,
                                    center: seg.center, radius: seg.rx,
                                    startAngle: seg.startAngle, endAngle: seg.endAngle,
                                    clockwise: seg.clockwise
                                });
                                points.push(seg.p1);
                            } else {
                                const tessellated = GeometryUtils.tessellateEllipticalArc(
                                    p0, seg.p1, seg.rx, seg.ry,
                                    seg.phi, seg.fA, seg.fS
                                );
                                points.push(...tessellated.slice(1));
                            }
                            break;
                        case 'cubic':
                            const tessCubic = GeometryUtils.tessellateCubicBezier(
                                p0, seg.p1, seg.p2, seg.p3
                            );
                            points.push(...tessCubic.slice(1));
                            break;
                        case 'quad':
                            const tessQuad = GeometryUtils.tessellateQuadraticBezier(
                                p0, seg.p1, seg.p2
                            );
                            points.push(...tessQuad.slice(1));
                            break;
                    }
                });

                // Polarity and Normalization logic
                if (points.length > 0) {
                    
                    let isCW = GeometryUtils.isClockwise(points);
                    let finalPolarity;
                    let isHole; // For logging
                    
                    // Check if this subpath is part of a compound path.
                    if (analyticSubpaths.length > 1) {
                        // COMPOUND PATH (e.g., an "O"): Trust the winding
                        // Y-flip means CW is OUTER ('dark') and CCW is HOLE ('clear')
                        isHole = !isCW;
                        finalPolarity = isCW ? 'dark' : 'clear';
                    } else {
                        // SINGLE PATH (e.g., a "C"): It is *always* an OUTER.
                        isHole = false;
                        finalPolarity = 'dark';
                    }

                    // Normalization step - enforce winding
                    if (finalPolarity === 'dark' && !isCW) {
                        // If it's supposed to be dark (outer), but it's CCW. Fix it.
                        points.reverse();
                        isCW = true; // Update state
                        this.debug(`Normalizing standalone path to CW (dark).`);
                    } else if (finalPolarity === 'clear' && isCW) {
                        // If it's supposed to be clear (hole), but it's CW. Fix it.
                        points.reverse();
                        isCW = false; // Update state
                        this.debug(`Normalizing hole path to CCW (clear).`);
                    }

                    this.debug(`Processed subpath #${subpathIndex} (of ${analyticSubpaths.length}): ${points.length} pts. Winding: ${isCW ? 'CW' : 'CCW'}. Polarity set to: ${finalPolarity}. Set as: ${isHole ? 'HOLE' : 'OUTER'}`);

                    // Create a new primitive for THIS subpath
                    primitives.push(new PathPrimitive(points, {
                        isRegion: true,
                        fill: true,
                        polarity: finalPolarity, // Use the new conditional polarity
                        closed: true, // Assume closed for filled regions
                        arcSegments: arcSegments
                    }));
                }

            }); 
            
            this.creationStats.regionsCreated += primitives.length;
            // Return the flat array of primitives, as expected by the fusion engine
            return primitives; 
        }
        
        /**
         * Creates analytic primitives for traces
         */
        plotTrace(trace) {
            const width = trace.width || config.formats?.gerber?.defaultAperture;
            const properties = {
                isTrace: true,
                fill: false,
                stroke: true,
                strokeWidth: width,
                polarity: trace.polarity || 'dark',
                aperture: trace.aperture,
                interpolation: trace.interpolation || 'linear',
                closed: false
            };
            
            if (this.options.markStrokes && width > 0) {
                properties.isStroke = true;
            }
            
            const interp = trace.interpolation;

            if (interp === 'bezier_cubic') {
                this.debug('Creating BezierPrimitive (Cubic)');
                this.creationStats.tracesCreated++;
                return new BezierPrimitive(trace.points, properties);

            } else if (interp === 'bezier_quad') {
                this.debug('Creating BezierPrimitive (Quad)');
                this.creationStats.tracesCreated++;
                return new BezierPrimitive(trace.points, properties);

            } else if (interp === 'elliptical_arc') {
                this.debug('Creating EllipticalArcPrimitive');
                this.creationStats.tracesCreated++;
                this.creationStats.arcTraces++;
                return new EllipticalArcPrimitive(
                    trace.start, trace.end, trace.params, properties
                );
                
            } else if (interp === 'cw_arc' || interp === 'ccw_arc') {
                try {
                    const center = {
                        x: trace.start.x + trace.arc.i,
                        y: trace.start.y + trace.arc.j
                    };
                    const radius = Math.hypot(trace.arc.i, trace.arc.j);
                    const startAngle = Math.atan2(
                        trace.start.y - center.y,
                        trace.start.x - center.x
                    );
                    const endAngle = Math.atan2(
                        trace.end.y - center.y,
                        trace.end.x - center.x
                    );
                    const clockwise = trace.interpolation === 'cw_arc' || 
                                     trace.clockwise === true;
                    
                    this.creationStats.arcTraces++;
                    return new ArcPrimitive(
                        center, radius, startAngle, endAngle, clockwise, properties
                    );
                } catch (error) {
                    console.error('[Plotter] Failed to create ArcPrimitive:', error);
                    return new PathPrimitive([trace.start, trace.end], properties);
                }
                
            } else if (interp === 'linear_path') {
                // From polygon/polyline stroke
                this.creationStats.tracesCreated++;
                return new PathPrimitive(trace.points, properties);
                
            } else {
                // Default: linear trace
                this.creationStats.tracesCreated++;
                return new PathPrimitive([trace.start, trace.end], properties);
            }
        }
        
        plotFlash(flash) {
            const properties = {
                isFlash: true,
                isPad: true,
                fill: true,
                stroke: false,
                polarity: flash.polarity || 'dark',
                aperture: flash.aperture,
                shape: flash.shape
            };
            
            let primitive = null;
            
            switch (flash.shape) {
                case 'circle':
                    primitive = new CirclePrimitive(
                        flash.position, flash.radius, properties
                    );
                    break;
                    
                case 'rectangle':
                    primitive = new RectanglePrimitive(
                        { 
                            x: flash.position.x - flash.width / 2,
                            y: flash.position.y - flash.height / 2
                        },
                        flash.width, flash.height, properties
                    );
                    break;
                    
                case 'obround':
                    // Check if the obround is actually a circle
                    const tolerance = geomConfig.coordinatePrecision || 0.001;
                    if (Math.abs(flash.width - flash.height) < tolerance) {
                        // It's a circle. Create a CirclePrimitive instead.
                        this.debug(`Converted round obround (aperture ${flash.aperture}) to CirclePrimitive.`);
                        // Update shape property for clarity downstream
                        properties.shape = 'circle'; 
                        primitive = new CirclePrimitive(
                            flash.position, // Use center position directly
                            flash.width / 2,  // Use width/2 as radius
                            properties
                        );
                        this.creationStats.circularObrounds++; // Optional: for stats
                    } else {
                        // It's a true obround. Create an ObroundPrimitive.
                        primitive = new ObroundPrimitive(
                            { 
                                x: flash.position.x - flash.width / 2,
                                y: flash.position.y - flash.height / 2
                            },
                            flash.width, flash.height, properties
                        );
                        this.creationStats.strokedObrounds++; // Optional: for stats
                    }
                    break;
                    
                case 'polygon':
                    primitive = new PathPrimitive(flash.points, {
                        ...properties,
                        closed: true,
                        isPolygon: true
                    });
                    break;
                    
                default:
                    console.warn(`Unknown flash shape: ${flash.shape}, using circle`);
                    primitive = new CirclePrimitive(flash.position, 0.1, properties);
            }
            
            if (primitive) {
                this.creationStats.flashesCreated++;
            }
            return primitive;
        }
        
        plotDraw(draw) {
            if (!draw.aperture) return null;
            const aperture = this.apertures.get(draw.aperture);
            if (!aperture) return null;
            
            const trace = {
                type: 'trace',
                start: draw.start,
                end: draw.end,
                width: aperture.parameters[0] || 0.1,
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
        
        validatePrimitive(primitive) {
            if (!debugConfig.validation?.validateGeometry) return true;
            
            try {
                if (typeof primitive.getBounds !== 'function') return false;
                const bounds = primitive.getBounds();
                if (!isFinite(bounds.minX) || !isFinite(bounds.minY) ||
                    !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                    return false;
                }
                
                if (primitive.type === 'path' && 
                    (!primitive.points || primitive.points.length === 0)) {
                    return false;
                }
                
                if (primitive.type === 'circle' && 
                    (!primitive.center || !isFinite(primitive.radius) || 
                     primitive.radius <= 0)) {
                    return false;
                }
                
                return true;
            } catch (error) {
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
            
            this.primitives.forEach(primitive => {
                const bounds = primitive.getBounds();
                if (!isFinite(bounds.minX)) return;
                
                minX = Math.min(minX, bounds.minX);
                minY = Math.min(minY, bounds.minY);
                maxX = Math.max(maxX, bounds.maxX);
                maxY = Math.max(maxY, bounds.maxY);
            });
            
            this.bounds = { minX, minY, maxX, maxY };
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
            if (!this.debug) return;
            
            this.debug('Plotting Statistics:');
            this.debug(`  Regions: ${this.creationStats.regionsCreated}`);
            this.debug(`  Traces: ${this.creationStats.tracesCreated}`);
            this.debug(`    Arc traces: ${this.creationStats.arcTraces}`);
            this.debug(`  Flashes: ${this.creationStats.flashesCreated}`);
            this.debug(`  Drills: ${this.creationStats.drillsCreated}`);
            this.debug(`  Total primitives: ${this.creationStats.primitivesCreated}`);
        }
        
        debug(message, data = null) {
            if (debugConfig.enabled) {
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