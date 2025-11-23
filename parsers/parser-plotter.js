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

    const config = window.PCBCAMConfig;
    const debugConfig = config.debug;
    const geomConfig = config.geometry;

    /**
     * Smart translator from parser analytic objects to primitives.
     * Tessellates only unsupported curve types.
     */
    class ParserPlotter {
        constructor(options = {}) {
            this.options = {
                debug: options.debug,
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
                drillData.holes.forEach((item, index) => {
                    let primitive = null;
                    const properties = { 
                        tool: item.tool, 
                        plated: item.plated, 
                        polarity: 'dark',
                        diameter: item.diameter
                    };
                    
                    if (!item.start || !item.end) {
                         // Handle hole type which may only have 'position' if old parser version was used
                         item.start = item.position || { x: 0, y: 0 };
                         item.end = item.position || { x: 0, y: 0 };
                    }

                    // Calculate distance between start and end
                    const dx = item.end.x - item.start.x;
                    const dy = item.end.y - item.start.y;
                    const length = Math.sqrt(dx * dx + dy * dy);
                    const radius = item.diameter / 2;

                    // Tolerance for floating point zero checks
                    const slotTolerance = 0.005; // 5 microns // Review - epsilon values in the config

                    this.debug(`Plotter Input [${index}]: type=${item.type}, start=(${item.start.x.toFixed(3)}, ${item.start.y.toFixed(3)}), end=(${item.end.x.toFixed(3)}, ${item.end.y.toFixed(3)}), diameter=${item.diameter.toFixed(3)}, calculated length=${length.toFixed(5)}`);

                    if (length < slotTolerance) {
                        // It's a hole
                        properties.role = 'drill_hole';
                        primitive = new CirclePrimitive(
                            item.start, 
                            radius,
                            properties
                        );
                        this.debug(`Plotter Output [${index}]: Creating drill_hole (length < ${slotTolerance}mm)`);
                    } else {
                        // It's a slot
                        properties.role = 'drill_slot';
                        properties.originalSlot = { start: item.start, end: item.end };

                        // Calculate Bounding Box for Obround Primitive
                        const minX = Math.min(item.start.x, item.end.x) - radius;
                        const minY = Math.min(item.start.y, item.end.y) - radius;
                        const maxX = Math.max(item.start.x, item.end.x) + radius;
                        const maxY = Math.max(item.start.y, item.end.y) + radius;

                        primitive = new ObroundPrimitive(
                            { x: minX, y: minY }, // Position (bottom-left)
                            maxX - minX,          // Width
                            maxY - minY,          // Height
                            properties
                        );
                        this.debug(`Plotter Output [${index}]: Creating drill_slot (length >= ${slotTolerance}mm)`);
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
         * Creates a single PathPrimitive with a full hierarchical contour list.
         * Winding determines polarity.
         */
        plotRegion(region) {
            const analyticSubpaths = region.analyticSubpaths;

            this.debug(`Received region with ${analyticSubpaths ? analyticSubpaths.length : 0} analytic subpaths.`);

            // Fallback for simple Gerber regions (no analytic data)
            if (!analyticSubpaths || analyticSubpaths.length === 0) {
                if (region.points && region.points.length > 0) {

                    // Winding normalization for Gerber fallbacks
                    const isCW = GeometryUtils.isClockwise(region.points);
                    if (!isCW) {
                        region.points.reverse();
                        this.debug(`Normalized Gerber fallback region to CW.`);
                    }

                    const contour = {
                        points: region.points,
                        nestingLevel: 0,
                        isHole: false,
                        parentId: null,
                        arcSegments: [],
                        curveIds: []
                    };

                    const primitive = new PathPrimitive([contour], {
                        isRegion: true,
                        fill: true,
                        polarity: region.polarity || 'dark',
                        closed: true
                    });

                    this.creationStats.regionsCreated++;
                    return primitive;
                }
                this.debug('Region object has no points or analytic subpaths', region);
                return null;
            }

            // Main Analytic Subpath Processing
            const tolerance = geomConfig.coordinatePrecision;
            const contours = []; // This will be the final list of contours

            // Process each analytic subpath (contour)
            analyticSubpaths.forEach((segments, subpathIndex) => {

                const points = [];
                const arcSegments = [];

                // Handle simple point arrays (from polygon/polyline)
                if (segments.length > 0 && segments[0].x !== undefined) {
                    // This is a simple point array, treat as one contour
                    const isCW = GeometryUtils.isClockwise(segments);
                    const isHole = (analyticSubpaths.length > 1) ? !isCW : false;
                    const finalPolarity = (analyticSubpaths.length > 1) ? (isCW ? 'dark' : 'clear') : 'dark';

                    if ((finalPolarity === 'dark' && !isCW) || (finalPolarity === 'clear' && isCW)) {
                        segments.reverse(); // Normalize winding
                    }

                    contours.push({
                        points: segments,
                        isHole: isHole,
                        nestingLevel: isHole ? 1 : 0, // Simple nesting
                        parentId: isHole ? 0 : null,
                        arcSegments: [],
                        curveIds: []
                    });
                    return; // Done with this subpath
                }

                if (segments.length === 0) return;

                // Stitch analytic segments (line, arc, bezier)
                segments.forEach((seg, segIndex) => {
                    if (seg.type === 'move') {
                        if (points.length > 0) {
                            // This case should ideally not happen in a single subpath
                            console.warn("[Plotter] Found 'move' inside a subpath, data may be lost.");
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
                                // This is a circular arc
                                arcSegments.push({
                                    startIndex: points.length - 1,
                                    center: seg.center, radius: seg.rx,
                                    startAngle: seg.startAngle, endAngle: seg.endAngle,
                                    clockwise: seg.clockwise
                                });
                                points.push(seg.p1);
                            } else {
                                // This is an elliptical arc, tessellate it
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

                if (points.length > 0) {

                    let isCW = GeometryUtils.isClockwise(points);
                    let finalPolarity;
                    let isHole;

                    if (analyticSubpaths.length > 1) {
                        // Compound path (e.g., an "O"): Trust the winding
                        isHole = !isCW;
                        finalPolarity = isCW ? 'dark' : 'clear';
                    } else {
                        // Single path (e.g., a "C"): Is always an outer perimeter.
                        isHole = false;
                        finalPolarity = 'dark';
                    }

                    // Normalization step - enforce winding
                    if (finalPolarity === 'dark' && !isCW) {
                        points.reverse();
                        isCW = true;
                        this.debug(`Normalizing standalone path to CW (dark).`);
                    } else if (finalPolarity === 'clear' && isCW) {
                        points.reverse();
                        isCW = false;
                        this.debug(`Normalizing hole path to CCW (clear).`);
                    }

                    this.debug(`Processed subpath #${subpathIndex} (of ${analyticSubpaths.length}): ${points.length} pts. Winding: ${isCW ? 'CW' : 'CCW'}. Polarity set to: ${finalPolarity}. Set as: ${isHole ? 'HOLE' : 'OUTER'}`);

                    // Add finished subpath as a contour
                    contours.push({
                        points: points,
                        isHole: isHole,
                        nestingLevel: isHole ? 1 : 0, // Simple nesting // Review - data structure can handle more, but better to limit hierarchy levels?
                        parentId: isHole ? 0 : null,  // Assume nested in first contour
                        arcSegments: arcSegments,
                        curveIds: []
                    });
                }
            }); 

            if (contours.length === 0) {
                return null; // No valid contours found
            }

            // Sort contours: outer (isHole: false) first
            contours.sort((a, b) => a.isHole - b.isHole);

            // Create a single PathPrimitive with the full contours list
            const finalPrimitive = new PathPrimitive(contours, { // Pass null for points
                isRegion: true,
                fill: true,
                polarity: 'dark', // The primitive itself is dark
                closed: true,
            });

            this.creationStats.regionsCreated++;
            // Return the single, complex primitive
            return finalPrimitive; 
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

                    // Gerber uses Y-up coordinates, renderer expects Y-down after transform
                    // The scale(1, -1) in renderer-core.js flips Y, which inverts arc direction
                    // This pre-inversion ensures arcs render correctly after Y-flip
                    const gerberClockwise = trace.interpolation === 'cw_arc' || 
                                             trace.clockwise === true;
                    
                    const clockwise = !gerberClockwise;

                    this.creationStats.arcTraces++;
                    return new ArcPrimitive(
                        center, radius, startAngle, endAngle, clockwise, properties
                    );
                } catch (error) {
                    console.error('[Plotter] Failed to create ArcPrimitive:', error);
                    const contour = {
                        points: [trace.start, trace.end],
                        isHole: false,
                        nestingLevel: 0,
                        parentId: null,
                        arcSegments: [],
                        curveIds: []
                    };
                    return new PathPrimitive([contour], properties);
                }

            } else if (interp === 'linear_path') {
                // From polygon/polyline stroke
                this.creationStats.tracesCreated++;
                const contour = {
                    points: trace.points,
                    isHole: false,
                    nestingLevel: 0,
                    parentId: null,
                    arcSegments: [],
                    curveIds: []
                };
                return new PathPrimitive([contour], properties);
            } else {
                // Default: linear trace
                this.creationStats.tracesCreated++;
                const contour = {
                    points: [trace.start, trace.end],
                    isHole: false,
                    nestingLevel: 0,
                    parentId: null,
                    arcSegments: [],
                    curveIds: []
                };
                return new PathPrimitive([contour], properties);
            }
        }

        /**
         * Creates analytic primitives for flashes
         */
        plotFlash(flash) {
            const properties = {
                isFlash: true,
                isPad: true,
                fill: true,
                stroke: false,
                polarity: flash.polarity,
                aperture: flash.aperture,
                shape: flash.shape
            };

            switch (flash.shape) {
                case 'circle':
                    this.creationStats.flashesCreated++;
                    return new CirclePrimitive(flash.position, flash.radius, properties);

                case 'rectangle':
                    this.creationStats.flashesCreated++;
                    return new RectanglePrimitive(
                        { x: flash.position.x - flash.width / 2, y: flash.position.y - flash.height / 2 },
                        flash.width, flash.height, properties
                    );

                case 'obround':
                    const tolerance = geomConfig.coordinatePrecision || 0.001;
                    if (Math.abs(flash.width - flash.height) < tolerance) {
                        this.creationStats.circularObrounds++;
                        this.creationStats.flashesCreated++;
                        return new CirclePrimitive(flash.position, flash.width / 2, properties);
                    }
                    this.creationStats.strokedObrounds++;
                    this.creationStats.flashesCreated++;
                    return new ObroundPrimitive(
                        { x: flash.position.x - flash.width / 2, y: flash.position.y - flash.height / 2 },
                        flash.width, flash.height, properties
                    );

                case 'polygon':
                    const contour = {
                        points: flash.points,
                        isHole: false,
                        nestingLevel: 0,
                        parentId: null,
                        arcSegments: [],
                        curveIds: []
                    };
                    this.creationStats.flashesCreated++;
                    return new PathPrimitive([contour], { ...properties, closed: true });

                default:
                    console.warn(`Unknown flash shape: ${flash.shape}`);
                    this.creationStats.flashesCreated++;
                    return new CirclePrimitive(flash.position, 0.1, properties);
            }
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

                if (primitive.type === 'path') {
                    // A path is invalid if:
                    // 1. The contours array itself is missing or empty.
                    if (!primitive.contours || primitive.contours.length === 0) {
                        return false;
                    }

                    // 2. Not a *single* contour in the array has any points.
                    const hasAnyPoints = primitive.contours.some(
                        c => c.points && c.points.length > 0
                    );
                    if (!hasAnyPoints) {
                        return false;
                    }
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