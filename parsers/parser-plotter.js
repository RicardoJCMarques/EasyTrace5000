/*!
 * @file        parser/parser-plotter.js
 * @description Converts parsed objects into geometric primitives
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

    const C = window.PCBCAMConfig.constants;
    const D = window.PCBCAMConfig.defaults;
    const PRECISION = C.precision.coordinate;
    const debugState = D.debug;

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
                        item.start = { ...(item.position || { x: 0, y: 0 }) };
                        item.end = { ...(item.position || { x: 0, y: 0 }) };
                    }

                    // Calculate distance between start and end
                    const dx = item.end.x - item.start.x;
                    const dy = item.end.y - item.start.y;
                    const length = Math.sqrt(dx * dx + dy * dy);
                    const radius = item.diameter / 2;

                    this.debug(`Plotter Input [${index}]: type=${item.type}, start=(${item.start.x.toFixed(3)}, ${item.start.y.toFixed(3)}), end=(${item.end.x.toFixed(3)}, ${item.end.y.toFixed(3)}), diameter=${item.diameter.toFixed(3)}, calculated length=${length.toFixed(5)}`);

                    if (length < PRECISION) { // Change to 5 * PRECISION? That was the previous tollerance.
                        // It's a hole
                        properties.role = 'drill_hole';
                        primitive = new CirclePrimitive(
                            item.start, 
                            radius,
                            properties
                        );
                        this.debug(`Plotter Output [${index}]: Creating drill_hole (length < ${PRECISION}mm)`);
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
                        this.debug(`Plotter Output [${index}]: Creating drill_slot (length >= ${PRECISION}mm)`);
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

                    // Outer contours must be CCW (positive winding area)
                    const isCW = GeometryUtils.isClockwise(region.points);
                    if (isCW) {
                        region.points.reverse();
                        this.debug(`Normalized Gerber fallback region to CCW (outer).`);
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
                        netName: region.netName || null,
                        closed: true
                    });

                    this.creationStats.regionsCreated++;
                    return primitive;
                }
                this.debug('Region object has no points or analytic subpaths', region);
                return null;
            }

            // Main Analytic Subpath Processing
            const contours = []; // This will be the final list of contours

            // Process each analytic subpath (contour)
            analyticSubpaths.forEach((segments, subpathIndex) => {

                const points = [];
                const arcSegments = [];

                // Handle simple point arrays (from polygon/polyline)
                if (segments.length > 0 && segments[0].x !== undefined) {
                    // Determine hole status from winding: in Y-up, CCW = positive area = outer
                    const isCW = GeometryUtils.isClockwise(segments);
                    const isHole = (analyticSubpaths.length > 1) ? isCW : false;

                    // Enforce: outer=CCW, hole=CW
                    if (!isHole && isCW) {
                        segments.reverse();
                    } else if (isHole && !isCW) {
                        segments.reverse();
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
                            if (Math.abs(seg.rx - seg.ry) < PRECISION && Math.abs(seg.phi) < PRECISION) {
                                // This is a circular arc - register it
                                let curveId = null;
                                if (window.globalCurveRegistry) {
                                    curveId = window.globalCurveRegistry.register({
                                        type: 'arc',
                                        center: { x: seg.center.x, y: seg.center.y },
                                        radius: seg.rx,
                                        startAngle: seg.startAngle,
                                        endAngle: seg.endAngle,
                                        clockwise: seg.clockwise,
                                        source: 'svg_parser'
                                    });
                                }

                                // Capture start index before adding endpoint
                                const arcStartIndex = points.length - 1;

                                // Add the endpoint
                                points.push(seg.p1);

                                // Capture end index after adding endpoint
                                const arcEndIndex = points.length - 1;

                                // Create arc segment with both indices
                                arcSegments.push({
                                    startIndex: arcStartIndex,
                                    endIndex: arcEndIndex,
                                    center: seg.center, 
                                    radius: seg.rx,
                                    startAngle: seg.startAngle, 
                                    endAngle: seg.endAngle,
                                    clockwise: seg.clockwise,
                                    curveId: curveId
                                });
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

                if (debugState && points.length > 0) {
                    let maxCoord = 0;
                    let maxIdx = 0;
                    points.forEach((p, i) => {
                        const m = Math.max(Math.abs(p.x), Math.abs(p.y));
                        if (m > maxCoord) { maxCoord = m; maxIdx = i; }
                    });
                    if (maxCoord > 300) {
                        console.error(`[PARSER-PLOTTER] POSSIBLE CORRUPTION: ${points.length} pts, worst point[${maxIdx}]:`, 
                            points[maxIdx], 'neighbors:', points[maxIdx-1], points[maxIdx+1]);
                    } else {
                        console.log(`[PARSER-PLOTTER] OK: ${points.length} pts, max coord: ${maxCoord.toFixed(2)}`);
                    }
                }

                if (points.length > 0) {

                    let isCW = GeometryUtils.isClockwise(points);
                    let isHole;

                    if (analyticSubpaths.length > 1) {
                        // Compound path: CW = hole (negative area in Y-up)
                        isHole = isCW;
                    } else {
                        isHole = false;
                    }

                    // Enforce: outer=CCW, hole=CW
                    if (!isHole && isCW) {
                        points.reverse();
                        isCW = false;
                        this.debug(`Normalized outer contour to CCW.`);
                    } else if (isHole && !isCW) {
                        points.reverse();
                        isCW = true;
                        this.debug(`Normalized hole contour to CW.`);
                    }

                    this.debug(`Processed subpath #${subpathIndex} (of ${analyticSubpaths.length}): ${points.length} pts. Winding: ${isCW ? 'CW' : 'CCW'}. isHole: ${isHole}.`);

                    // Add finished subpath as a contour
                    contours.push({
                        points: points,
                        isHole: isHole,
                        nestingLevel: isHole ? 1 : 0,
                        parentId: isHole ? 0 : null,
                        arcSegments: arcSegments,
                        curveIds: arcSegments.map(a => a.curveId).filter(Boolean)
                    });
                }
            }); 

            if (contours.length === 0) {
                return null; // No valid contours found
            }

            // Sort contours: outer (isHole: false) first
            contours.sort((a, b) => a.isHole - b.isHole);

            // Create a single PathPrimitive with the full contours list
            const finalPrimitive = new PathPrimitive(contours, {
                isRegion: region.fill !== false,
                fill: region.fill !== false,
                stroke: region.stroke || false,
                strokeWidth: region.strokeWidth || 0,
                polarity: region.polarity || 'dark',
                netName: region.netName || null,
                closed: region.closed !== false,
            });

            this.creationStats.regionsCreated++;
            // Return the single, complex primitive
            return finalPrimitive; 
        }

        /**
         * Creates analytic primitives for traces
         */
        plotTrace(trace) {
            const width = trace.width || C.formats.gerber.defaultAperture;
            const properties = {
                isTrace: true,
                fill: false,
                stroke: true,
                strokeWidth: width,
                polarity: trace.polarity || 'dark',
                netName: trace.netName || null,
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

                    // Data model is strictly Y-Up (Mathematical Cartesian).
                    // Do NOT pre-invert here. The renderer's matrix handles visual flipping.
                    const clockwise = trace.interpolation === 'cw_arc' || trace.clockwise === true;

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
                fill: flash.fill !== false,
                stroke: flash.stroke || false,
                strokeWidth: flash.strokeWidth,
                polarity: flash.polarity,
                netName: flash.netName || null,
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
                    if (Math.abs(flash.width - flash.height) < PRECISION) {
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
            if (!debugState.validation?.validateGeometry) return true;

            try {
                if (typeof primitive.getBounds !== 'function') return false;
                const bounds = primitive.getBounds();
                if (!isFinite(bounds.minX) || !isFinite(bounds.minY) ||
                    !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                    return false;
                }

                if (primitive.type === 'path') {
                    // A path is invalid if:
                    // The contours array itself is missing or empty.
                    if (!primitive.contours || primitive.contours.length === 0) {
                        return false;
                    }

                    // Not a *single* contour in the array has any points.
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
            if (debugState.enabled) {
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