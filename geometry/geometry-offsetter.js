/*!
 * @file        geometry/geometry-offsetter.js
 * @description Handles geometry offsetting
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
    const geomConfig = config.geometry;
    const debugConfig = config.debug;

    class GeometryOffsetter {
        constructor(options = {}) {
            this.options = {
                precision: config.precision.coordinate,
                miterLimit: options.miterLimit
            };
            this.initialized = true;
            this.geometryProcessor = null;

            // --- BOOLEAN OFFSET TOGGLE ---
            // Bypasses analytic offsetting completely and uses stroke width + Clipper2 booleans instead of polylineToPolygon
            this.USE_BOOLEAN_OFFSETTING = true;
        }

        debug(message, data = null) {
            if (debugConfig.enabled) {
                if (data) {
                    console.log(`[Offsetter] ${message}`, data);
                } else {
                    console.log(`[Offsetter] ${message}`);
                }
            }
        }

        setGeometryProcessor(processor) {
            this.geometryProcessor = processor;
        }

        /**
         * Main entry point. Handles:
         * 1. Analytic strokes (arc traces, path traces) — width expansion
         * 2. Analytic fills (Circle, Rectangle, Obround) — geometric offset
         * 3. Path primitives (polygon and hybrid arc+polygon) — contour offset
         */
        async offsetPrimitive(primitive, distance) {
            if (debugConfig.enabled) {
                console.log('[Offsetter] offsetPrimitive:', {
                    type: primitive?.type,
                    id: primitive?.id,
                    distance: distance,
                    isCutout: primitive?.properties?.isCutout,
                    stroke: primitive?.properties?.stroke,
                    fill: primitive?.properties?.fill,
                    isTrace: primitive?.properties?.isTrace,
                    closed: primitive?.properties?.closed
                });
            }

            if (!primitive || !primitive.type) return null;
            if (Math.abs(distance) < this.options.precision) return primitive;

            const props = primitive.properties || {};
            const isCutout = props.isCutout || props.layerType === 'cutout';
            const isStroke = !isCutout && ((props.stroke && !props.fill) || props.isTrace);

            // Stroke expansion
            if (isStroke) {
                this.debug(`Handling primitive ${primitive.id} as STROKE`);
                return this._offsetStroke(primitive, distance, props);
            }

            // Normalize non-path analytic types that aren't handled below
            if (primitive.type === 'arc' ||
                primitive.type === 'elliptical_arc' ||
                primitive.type === 'bezier') {

                const converted = GeometryUtils.primitiveToPath(primitive);
                if (!converted) {
                    console.warn(`[Offsetter] Failed to convert ${primitive.type} to path`);
                    return null;
                }
                if (!converted.properties) converted.properties = {};
                converted.properties.originalType = primitive.type;
                converted.properties.wasConverted = true;
                primitive = converted;
            }

            // Filled shape dispatch
            switch (primitive.type) {
                case 'circle':
                    return this.offsetCircle(primitive, distance);
                case 'rectangle':
                    return this.offsetRectangle(primitive, distance);
                case 'obround':
                    return this.offsetObround(primitive, distance);
                case 'path':
                    return this.offsetPath(primitive, distance);
                default:
                    this.debug(`Unhandled primitive type: ${primitive.type}`);
                    return null;
            }
        }

        /**
         * Handles stroke primitives: expands the stroke width by 2*distance, producing a filled polygon.
         */
        _offsetStroke(primitive, distance, props) {
            const originalWidth = props.strokeWidth;
            const totalWidth = originalWidth + (distance * 2);

            if (totalWidth < this.options.precision) {
                this.debug(`Stroke collapsed: ${totalWidth.toFixed(4)}mm`);
                return null;
            }

            // Handle ARC strokes
            if (primitive.type === 'arc') {
                this.debug(`Polygonizing ArcStroke ${primitive.id} with total width ${totalWidth}`);
                // arcToPolygon returns a complete PathPrimitive with registered curves
                const pathPrimitive = GeometryUtils.arcToPolygon(primitive, totalWidth);
                if (!pathPrimitive) {
                    this.debug(`Polygonization of arc stroke ${primitive.id} failed.`);
                    return null;
                }

                // Add offset-specific properties
                Object.assign(pathPrimitive.properties, {
                    ...props,
                    fill: true,
                    stroke: false,
                    isOffset: true,
                    offsetDistance: distance,
                    offsetType: distance < 0 ? 'internal' : 'external',
                    polygonized: true
                });
                
                // Scrub stroke properties so the renderer doesn't outline it
                delete pathPrimitive.properties.stroke;
                delete pathPrimitive.properties.strokeWidth;
                delete pathPrimitive.properties.isTrace;

                return pathPrimitive;

            // Handle path strokes (linear polylines)
            } else if (primitive.type === 'path' && primitive.contours?.[0]?.points) {
                const points = primitive.contours[0].points;
                
                // Generates overlapping circles and rectangles representing the expanded trace
                const strokes = GeometryUtils.traceToPolygon(points, totalWidth, props);
                if (!strokes || strokes.length === 0) return null;

                // Scrub the properties so the renderer treats them as pure filled areas
                strokes.forEach(stroke => {
                    Object.assign(stroke.properties, {
                        ...props,
                        fill: true, stroke: false, strokeWidth: 0, isTrace: false,
                        isOffset: true, offsetDistance: distance,
                        offsetType: distance < 0 ? 'internal' : 'external',
                        polygonized: true
                    });
                    
                    // Double tap delete for safety
                    delete stroke.properties.stroke;
                    delete stroke.properties.strokeWidth;
                    delete stroke.properties.isTrace;
                });

                return strokes;

                /* --- OLD METHOD (Commented out for development tracking) ---
                // Create array for curve IDs, pass to polylineToPolygon for mutation
                const polygonCurveIds = [];
                const polygonPoints = GeometryUtils.polylineToPolygon(points, totalWidth, polygonCurveIds);

                if (!polygonPoints || polygonPoints.length < 3) {
                    if (debugConfig.enabled) console.warn(`Polygonization of path stroke ${primitive.id} failed.`);
                    return null;
                }

                const isInternal = distance < 0;

                // Build contour with the mutated curve IDs
                const contour = {
                    points: polygonPoints,
                    isHole: false,
                    nestingLevel: 0,
                    parentId: null,
                    arcSegments: [],
                    curveIds: polygonCurveIds
                };

                return new PathPrimitive([contour], {
                    ...props,
                    fill: true,
                    stroke: false,
                    isOffset: true,
                    offsetDistance: distance,
                    offsetType: distance < 0 ? 'internal' : 'external',
                    polygonized: true
                });
                ----------------------------------------------------------- */

            // Handle other unhandled stroke types
            } else {
                if (debugConfig.enabled) console.warn(`[Offsetter] Unhandled stroke type: ${primitive.type}`);
                return null;
            }
        }

        /**
         * Offsets a PathPrimitive. Routes to boolean pipeline or analytic fallback.
         */
        async offsetPath(path, distance) {
            if (!path.contours || path.contours.length === 0) {
                this.debug('offsetPath: no contours');
                return null;
            }

            // Handle centerline paths (open paths, e.g. drill slot center) before any pipeline
            if (path.properties?.isCenterlinePath) {
                return new PathPrimitive(path.contours, {
                    ...path.properties,
                    isOffset: true,
                    offsetDistance: distance,
                    offsetType: 'on',
                    closed: false
                });
            }

            // --- BOOLEAN PIPELINE CROSSROADS ---
            if (this.USE_BOOLEAN_OFFSETTING) {
                return await this._offsetPathViaBoolean(path, distance);
            }
            // -----------------------------------

            // Multi-contour decomposition
            if (path.contours.length > 1) {
                this.debug(`Decomposing compound path with ${path.contours.length} contours for offset`);
                const results = [];

                for (const contour of path.contours) {
                    if (!contour.points || contour.points.length < 2) continue;
                    const contourDistance = contour.isHole ? -distance : distance;

                    const offsetResult = this._offsetSingleContour(contour, contourDistance, path.properties);
                    if (offsetResult) {
                        if (Array.isArray(offsetResult)) {
                            results.push(...offsetResult);
                        } else {
                            results.push(offsetResult);
                        }
                    }
                }
                return results.length > 0 ? results : null;
            }

            // Single contour
            const contour = path.contours[0];
            if (!contour.points || contour.points.length < 2) return null;

            return this._offsetSingleContour(contour, distance, path.properties);
        }

        /**
         * Simplifies a contour for boolean offset input using Douglas-Peucker.
         * Arc segment endpoints AND all intermediate registered curve points are protected from removal.

        _simplifyContourForOffset(contour, sqTolerance) {
            const points = contour.points;
            if (!points || points.length < 6) return contour;

            // Build protected index set
            const protectedIndices = new Set();
            if (contour.arcSegments) {
                for (const arc of contour.arcSegments) {
                    if (arc.startIndex >= 0 && arc.startIndex < points.length) {
                        protectedIndices.add(arc.startIndex);
                    }
                    if (arc.endIndex >= 0 && arc.endIndex < points.length) {
                        protectedIndices.add(arc.endIndex);
                    }
                }
            }

            // Protect ALL points that belong to a registered curve
            for (let i = 0; i < points.length; i++) {
                if (points[i].curveId && points[i].curveId > 0) {
                    protectedIndices.add(i);
                }
            }

            const { points: newPoints, indexMap } = GeometryUtils.simplifyDouglasPeucker(
                points, sqTolerance, protectedIndices
            );

            // Skip if reduction is negligible (< 20%)
            if (newPoints.length > points.length * 0.8) return contour;

            // Remap arc segment indices
            const newArcSegments = (contour.arcSegments || []).map(arc => {
                const newStart = indexMap[arc.startIndex];
                const newEnd = indexMap[arc.endIndex];
                if (newStart >= 0 && newEnd >= 0) {
                    return { ...arc, startIndex: newStart, endIndex: newEnd };
                }
                return null;
            }).filter(Boolean);

            this.debug(`Input simplification: ${points.length} → ${newPoints.length} points (${contour.arcSegments?.length || 0} → ${newArcSegments.length} arcs)`);

            return {
                points: newPoints,
                isHole: contour.isHole,
                nestingLevel: contour.nestingLevel,
                parentId: contour.parentId,
                arcSegments: newArcSegments,
                curveIds: newArcSegments.map(a => a.curveId).filter(Boolean)
            };
        }
         */

        /**
         * Returns a corrected copy of an arc segment with sweep direction derived from geometry (tangent-chord alignment) instead of the stored clockwise flag, which may be in screen (Y-down) convention rather than math (atan2) convention.
         */
        _correctArcDirection(arc, contourPoints) {
            const startPt = contourPoints[arc.startIndex];
            const endIdx = arc.endIndex < contourPoints.length ? arc.endIndex : 0;
            const endPt = contourPoints[endIdx];

            // Chord from start to end
            const chordX = endPt.x - startPt.x;
            const chordY = endPt.y - startPt.y;

            // CCW tangent at startAngle: perpendicular to radius, counterclockwise
            const tanX = -Math.sin(arc.startAngle);
            const tanY = Math.cos(arc.startAngle);

            // If CCW tangent aligns with chord, traversal is CCW (positive sweep)
            const shouldBeCCW = (tanX * chordX + tanY * chordY) > 0;

            // Get sweep magnitude from stored value or compute from angles
            let absSweep;
            if (arc.sweepAngle !== undefined) {
                absSweep = Math.abs(arc.sweepAngle);
            } else {
                let raw = arc.endAngle - arc.startAngle;
                // Normalize to [0, 2π)
                raw = ((raw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
                // Pick minor or major arc based on stored clockwise hint (magnitude is usually correct even if sign is wrong)
                absSweep = arc.clockwise ? (2 * Math.PI - raw) : raw;
                if (absSweep < 1e-9) absSweep = 2 * Math.PI - absSweep;
            }

            const correctedSweep = shouldBeCCW ? absSweep : -absSweep;
            const correctedClockwise = correctedSweep < 0;

            return {
                ...arc,
                sweepAngle: correctedSweep,
                clockwise: correctedClockwise
            };
        }

        /**
         * Boolean offset: builds a stroke-width boundary ring using optimized overlapping shapes (rectangles + joint circles + arc annular sectors), then extracts the outer contour (external offset) or hole contour (internal offset) from the ring.
         * The solid interior shape is NOT constructed, avoiding arc tessellation direction issues with stitched geometry. The ring topology provides both offset boundaries.
         */
        async _offsetPathViaBoolean(path, distance) {
            if (!this.geometryProcessor) {
                console.warn('[Offsetter] GeometryProcessor required for boolean offsetting');
                return null;
            }

            const offsetDist = Math.abs(distance);
            const strokeWidth = offsetDist * 2;
            const isInternal = distance < 0;

            // Correct arc directions for boundary stroke generation.
            // The tangent-chord test resolves screen vs math convention mismatches.
            // Even if imperfect, overlapping circles/rectangles compensate in the union.
            const contoursForStrokes = path.contours.map(c => {
                if (c.arcSegments && c.arcSegments.length > 0) {
                    const correctedArcs = c.arcSegments.map(arc =>
                        this._correctArcDirection(arc, c.points)
                    );
                    return {
                        points: c.points,
                        isHole: c.isHole,
                        nestingLevel: c.nestingLevel,
                        parentId: c.parentId,
                        arcSegments: correctedArcs,
                        curveIds: c.curveIds || []
                    };
                }
                return c;
            });

            // Generate boundary strokes from contours
            const boundaryStrokes = [];

            for (const contour of contoursForStrokes) {
                const strokes = GeometryUtils.closedContourToStrokePolygons(contour, strokeWidth);
                if (strokes && strokes.length > 0) {
                    boundaryStrokes.push(...strokes);
                }
            }

            if (boundaryStrokes.length === 0) return null;

            // Union all strokes into a ring (donut shape):
            // outer boundary = external offset
            // hole boundary = internal offset
            const ring = await this.geometryProcessor.unionGeometry(boundaryStrokes);
            if (!ring || ring.length === 0) return null;

            // Extract the appropriate contours from the ring topology.
            // generateOffsetGeometry Phase 1 guarantees single-contour input, so the ring has exactly one outer and one hole.
            let resultPrimitives;

            if (isInternal) {
                // Internal offset = hole contours promoted to outer contours
                resultPrimitives = [];
                for (const prim of ring) {
                    if (!prim.contours) continue;
                    for (const contour of prim.contours) {
                        if (contour.isHole) {
                            resultPrimitives.push(new PathPrimitive([{
                                points: contour.points,
                                isHole: false,
                                nestingLevel: 0,
                                parentId: null,
                                arcSegments: contour.arcSegments || [],
                                curveIds: contour.curveIds || []
                            }], {
                                ...path.properties,
                                polarity: 'dark'
                            }));
                        }
                    }
                }
            } else {
                // External offset = outer contours only (drop holes)
                resultPrimitives = [];
                for (const prim of ring) {
                    if (!prim.contours) continue;
                    const outerContours = prim.contours.filter(c => !c.isHole);
                    if (outerContours.length > 0) {
                        resultPrimitives.push(new PathPrimitive(outerContours, {
                            ...path.properties,
                            polarity: 'dark'
                        }));
                    }
                }
            }

            // Post-process (remove slivers)
            if (!resultPrimitives || resultPrimitives.length === 0) return null;

            resultPrimitives = this._postProcessBooleanResult(resultPrimitives, offsetDist);

            if (!resultPrimitives || resultPrimitives.length === 0) {
                this.debug('All results rejected by post-processing');
                return null;
            }

            // Tag results with offset metadata
            resultPrimitives.forEach(p => {
                if (!p.properties) p.properties = {};
                p.properties.isOffset = true;
                p.properties.offsetDistance = distance;
                p.properties.offsetType = isInternal ? 'internal' : 'external';
            });

            this.debug(`Boolean offset result: ${resultPrimitives.length} primitive(s) (${isInternal ? 'internal' : 'external'})`);
            return resultPrimitives;
        }

        /**
         * Post-processes boolean offset results with an Area filter to reject reject slivers
         */
        _postProcessBooleanResult(primitives, offsetDist) {
            if (!primitives || primitives.length === 0) return primitives;

            // Minimum area filter: capped to avoid deleting intended tiny features
            const minArea = Math.min(offsetDist * offsetDist * 0.01, 0.0001);
            const cleaned = [];

            for (const prim of primitives) {
                if (!prim.contours || prim.contours.length === 0) continue;

                // Area filter rejects primitives whose outer contour is too small
                const outerContour = prim.contours.find(c => !c.isHole) || prim.contours[0];
                if (outerContour.points && outerContour.points.length >= 3) {
                    const area = Math.abs(GeometryUtils.calculateWinding(outerContour.points));
                    if (area < minArea) {
                        this.debug(`Post-process: rejected sliver (area ${area.toExponential(2)} < ${minArea.toExponential(2)})`);
                        continue;
                    }
                }

                // If it passed the area check, keep it exactly as Clipper output it
                cleaned.push(prim);
            }

            return cleaned;
        }

        /**
         * Simplifies reconstructed offset geometry using Douglas-Peucker.
         * Called AFTER arc reconstruction so arc segment endpoints can be protected by index. Replaces the old in-line DP that ran too early.
         */
        simplifyOffsetResult(primitives, offsetDist) {
            if (!primitives || primitives.length === 0) return primitives;

            const simpTolerance = offsetDist * 0.005;
            const sqTolerance = simpTolerance * simpTolerance;

            for (const prim of primitives) {
                if (!prim.contours) continue;

                for (const contour of prim.contours) {
                    if (!contour.points || contour.points.length <= 8) continue;

                    // Protect arc segment endpoints from removal
                    const protectedIndices = new Set();
                    if (contour.arcSegments) {
                        for (const arc of contour.arcSegments) {
                            if (arc.startIndex >= 0) protectedIndices.add(arc.startIndex);
                            if (arc.endIndex >= 0) protectedIndices.add(arc.endIndex);
                        }
                    }

                    const { points: simplified, indexMap } = GeometryUtils.simplifyDouglasPeucker(
                        contour.points, sqTolerance,
                        protectedIndices.size > 0 ? protectedIndices : null
                    );

                    // Only apply if meaningful reduction (>20%)
                    if (simplified.length >= 3 && simplified.length < contour.points.length * 0.8) {
                        const remappedArcs = (contour.arcSegments || []).map(arc => {
                            const newStart = indexMap[arc.startIndex];
                            const newEnd = indexMap[arc.endIndex];
                            if (newStart >= 0 && newEnd >= 0 && newStart !== newEnd) {
                                return { ...arc, startIndex: newStart, endIndex: newEnd };
                            }
                            return null;
                        }).filter(Boolean);

                        contour.points = simplified;
                        contour.arcSegments = remappedArcs;
                        contour.curveIds = remappedArcs.map(a => a.curveId).filter(Boolean);
                    }
                }
            }

            return primitives;
        }

        /**
         * Offsets a single contour. Routes to hybrid (arc-aware) or polygon path.
         */
        _offsetSingleContour(contour, distance, pathProperties) {
            const hasArcs = contour.arcSegments && contour.arcSegments.length > 0;

            this.debug(`Contour: ${contour.points.length} pts, ${contour.arcSegments?.length || 0} arcs, hasArcs=${hasArcs}`);

            if (hasArcs) {
                // If the analytic math throws a collapse error, catch it and let the code fall through to the polygon offsetter below.
                try {
                    const offsetResult = this._offsetHybridContour(contour, distance);
                    if (offsetResult) {
                        // Hybrid can return one contour object; wrap into PathPrimitive(s)
                        const makeProps = (polarity) => ({
                            ...pathProperties,
                            closed: true,
                            fill: true,
                            isOffset: true,
                            offsetDistance: distance,
                            offsetType: distance < 0 ? 'internal' : 'external',
                            polarity: polarity
                        });

                        return new PathPrimitive([{
                            points: offsetResult.points,
                            isHole: contour.isHole || false,
                            nestingLevel: 0,
                            parentId: null,
                            arcSegments: offsetResult.arcSegments,
                            curveIds: offsetResult.curveIds
                        }], makeProps(contour.isHole ? 'clear' : 'dark'));
                    }
                } catch (e) {
                    // CAUGHT AN ERROR: Log it and let the execution continue past this if block instead of returning null.
                    this.debug(`Hybrid offset failed (${e.message}), falling back to polygon offsetter.`);
                }
            }

            // FALLBACK / POLYGON PATH: 
            // If hasArcs was false, OR if the try block failed and threw an error, the code arrives here and runs the robust polygon offsetter.
            const offsetPoints = this._offsetContourPoints(contour.points, distance);
            if (!offsetPoints || offsetPoints.length < 3) return null;

            // Collect curve IDs from rounded joints
            const collectedCurveIds = Array.from(
                new Set(offsetPoints.filter(p => p.curveId > 0).map(p => p.curveId))
            );

            return new PathPrimitive([{
                points: offsetPoints,
                isHole: false,
                nestingLevel: 0,
                parentId: null,
                arcSegments: [],
                curveIds: collectedCurveIds
            }], {
                ...pathProperties,
                closed: true,
                fill: true,
                isOffset: true,
                offsetDistance: distance,
                offsetType: distance < 0 ? 'internal' : 'external',
                polarity: contour.isHole ? 'clear' : 'dark'
            });
        }

        // POLYGON-ONLY CONTOUR OFFSET
        _offsetContourPoints(points, distance) {
            const isInternal = distance < 0;
            const offsetDist = Math.abs(distance);

            // Work directly with sparse points - NO flattening
            let polygonPoints = points.slice();

            // Remove closing duplicate
            const first = polygonPoints[0];
            const last = polygonPoints[polygonPoints.length - 1];
            if (Math.hypot(first.x - last.x, first.y - last.y) < this.options.precision) {
                polygonPoints.pop();
            }

            // Simplification for internal offsets only
            const simplificationConfig = config.geometry?.simplification;
            if (isInternal && simplificationConfig?.enabled && polygonPoints.length > 10) {
                const tolerance = simplificationConfig.tolerance || 0.001;
                const sqTolerance = tolerance * tolerance;
                
                // Protect curve points during internal simplification fallback
                const protectedIndices = new Set();
                for (let i = 0; i < polygonPoints.length; i++) {
                    if (polygonPoints[i].curveId && polygonPoints[i].curveId > 0) {
                        protectedIndices.add(i);
                    }
                }

                const before = polygonPoints.length;
                const { points: simplified } = GeometryUtils.simplifyDouglasPeucker(
                    polygonPoints, 
                    sqTolerance,
                    protectedIndices.size > 0 ? protectedIndices : null
                );
                
                if (simplified.length >= 3) {
                    polygonPoints = simplified;
                }
                if (before > polygonPoints.length) {
                    this.debug(`Simplified: ${before} → ${polygonPoints.length} points`);
                }
            }

            const n = polygonPoints.length;
            if (n < 3) return null;

            // Determine winding and normal direction
            const isPathClockwise = GeometryUtils.isClockwise(polygonPoints);
            let normalDirection = isInternal ? 1 : -1;
            if (isPathClockwise) normalDirection *= -1;

            // Build offset segments
            const offsetSegments = [];
            for (let i = 0; i < n; i++) {
                const p1 = polygonPoints[i];
                const p2 = polygonPoints[(i + 1) % n];

                const v = { x: p2.x - p1.x, y: p2.y - p1.y };
                const len = Math.hypot(v.x, v.y);
                if (len < this.options.precision) continue;

                const nx = normalDirection * (-v.y / len);
                const ny = normalDirection * (v.x / len);

                offsetSegments.push({
                    p1: { x: p1.x + nx * offsetDist, y: p1.y + ny * offsetDist },
                    p2: { x: p2.x + nx * offsetDist, y: p2.y + ny * offsetDist }
                });
            }

            // Process joints
            const finalPoints = [];
            const numSegs = offsetSegments.length;
            if (numSegs < 2) return null;

            const miterLimit = (this.options.miterLimit || 2.0) * offsetDist;

            let gapCount = 0;
            let miterCount = 0;
            let roundCount = 0;
            let collinearCount = 0;
            let bevelCount = 0;

            for (let i = 0; i < numSegs; i++) {
                const seg1 = offsetSegments[i];
                const seg2 = offsetSegments[(i + 1) % numSegs];

                const curr = polygonPoints[(i + 1) % n];
                const prev = polygonPoints[i];
                const next = polygonPoints[(i + 2) % n];

                const v1_vec = { x: curr.x - prev.x, y: curr.y - prev.y };
                const v2_vec = { x: next.x - curr.x, y: next.y - curr.y };

                const crossProduct = (v1_vec.x * v2_vec.y) - (v1_vec.y * v2_vec.x);

                const len1 = Math.hypot(v1_vec.x, v1_vec.y);
                const len2 = Math.hypot(v2_vec.x, v2_vec.y);
                let dot = 0;

                if (len1 > this.options.precision && len2 > this.options.precision) {
                    dot = (v1_vec.x * v2_vec.x + v1_vec.y * v2_vec.y) / (len1 * len2);
                }

                const collinearThreshold = geomConfig.offsetting?.collinearDotThreshold || 0.995;
                const isCollinear = (dot > collinearThreshold) || (len1 < this.options.precision) || (len2 < this.options.precision);

                // UNIVERSAL JOINT CLASSIFIER
                let isMiterJoint = (crossProduct * normalDirection >= 0);
                if (isCollinear) isMiterJoint = true;

                if (isCollinear) collinearCount++;

                if (isMiterJoint) {
                    const jointPoints = this._createMiterBevelJoint(seg1, seg2, miterLimit);

                    if (jointPoints.length === 2) {
                        // Bevel — check gap distance
                        const gapDist = Math.hypot(jointPoints[0].x - jointPoints[1].x, jointPoints[0].y - jointPoints[1].y);
                        bevelCount++;
                        if (gapDist > offsetDist * 0.1) {
                            gapCount++;
                            console.warn(`[OFFSET-JOINT] GAP at vertex ${(i+1) % n}: bevel gap=${gapDist.toFixed(4)}mm, seg lengths=${len1.toFixed(4)}/${len2.toFixed(4)}, dot=${dot.toFixed(6)}, cross=${crossProduct.toFixed(6)}, collinear=${isCollinear}`);
                        }
                    } else {
                        miterCount++;
                    }

                    finalPoints.push(...jointPoints);
                } else {
                    // For round joints (external), add the segment's end, then the arc
                    if (finalPoints.length === 0) {
                        // Must include the start point from the first segment
                        finalPoints.push(seg1.p1);
                    }
                    finalPoints.push(seg1.p2);
                    const arcPoints = this._createRoundJoint(curr, v1_vec, v2_vec, normalDirection, offsetDist, distance);
                    roundCount++;

                    if (arcPoints.length === 0) {
                        console.warn(`[OFFSET-JOINT] EMPTY round joint at vertex ${(i+1) % n}: seg lengths=${len1.toFixed(4)}/${len2.toFixed(4)}`);
                    }

                    finalPoints.push(...arcPoints);
                }
            }

            if (finalPoints.length < 3) return null;

            // Close path
            const firstFinal = finalPoints[0];
            const lastFinal = finalPoints[finalPoints.length - 1];
            if (Math.hypot(firstFinal.x - lastFinal.x, firstFinal.y - lastFinal.y) > this.options.precision) {
                finalPoints.push({ ...firstFinal });
            }

            return finalPoints;
        }

        // HYBRID (ARC-AWARE) CONTOUR OFFSET
        _offsetHybridContour(contour, distance) {
            const isInternal = distance < 0;
            const offsetDist = Math.abs(distance);

            const points = contour.points;
            const arcSegments = contour.arcSegments || [];

            if (points.length < 2) return null;

            // Build arc lookup by startIndex
            const arcMap = new Map();
            arcSegments.forEach(arc => {
                arcMap.set(arc.startIndex, arc);
            });

            // Calculate normal direction for lines
            const pathWinding = GeometryUtils.calculateWinding(points);
            const pathIsCCW = pathWinding > 0;
            let normalDirection = isInternal ? 1 : -1;
            if (!pathIsCCW) normalDirection *= -1;

            // PHASE 1: Build offset entities
            const entities = [];
            const n = points.length;

            for (let i = 0; i < n; i++) {
                const startIndex = i;
                const endIndex = (i + 1) % n;
                const arc = arcMap.get(startIndex);

                // Check if an arc starts here and ends at the next point
                if (arc && arc.endIndex === endIndex) {
                    // Arc segment
                    const newRadius = arc.radius + (normalDirection * offsetDist);

                    if (newRadius < this.options.precision) {
                        // Arc collapsed — skip entirely, neighbors will extend to meet.
                        // Mark a gap so Phase 2 knows to bridge the adjacent entities.
                        entities.push({
                            type: 'collapsed',
                            originalVertex: points[endIndex]
                        });
                        this.debug(`Arc collapsed at index ${i} (r=${newRadius.toFixed(4)})`);
                        continue;
                    }

                    // Register offset curve
                    let curveId = null;
                    if (window.globalCurveRegistry) {
                        curveId = window.globalCurveRegistry.register({
                            type: 'arc',
                            center: arc.center,
                            radius: newRadius,
                            startAngle: arc.startAngle,
                            endAngle: arc.endAngle,
                            clockwise: arc.clockwise,
                            isOffsetDerived: true,
                            offsetDistance: distance,
                            sourceCurveId: arc.curveId,
                            source: 'hybrid_offset'
                        });
                    }

                    entities.push({
                        type: 'arc',
                        center: arc.center,
                        radius: newRadius,
                        startAngle: arc.startAngle,
                        endAngle: arc.endAngle,
                        clockwise: arc.clockwise,
                        curveId: curveId,
                        sweepAngle: arc.sweepAngle,
                        naturalStart: {
                            x: arc.center.x + newRadius * Math.cos(arc.startAngle),
                            y: arc.center.y + newRadius * Math.sin(arc.startAngle),
                            curveId: curveId
                        },
                        naturalEnd: {
                            x: arc.center.x + newRadius * Math.cos(arc.endAngle),
                            y: arc.center.y + newRadius * Math.sin(arc.endAngle),
                            curveId: curveId
                        },
                        trimmedStart: null,
                        trimmedEnd: null,
                        originalVertex: points[endIndex]
                    });

                } else {
                    // Line segment
                    const p1 = points[startIndex];
                    const p2 = points[endIndex];

                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    const len = Math.hypot(dx, dy);

                    if (len < this.options.precision) continue;

                    const nx = normalDirection * (-dy / len);
                    const ny = normalDirection * (dx / len);

                    entities.push({
                        type: 'line',
                        p1: { x: p1.x + nx * offsetDist, y: p1.y + ny * offsetDist },
                        p2: { x: p2.x + nx * offsetDist, y: p2.y + ny * offsetDist },
                        naturalStart: { x: p1.x + nx * offsetDist, y: p1.y + ny * offsetDist },
                        naturalEnd: { x: p2.x + nx * offsetDist, y: p2.y + ny * offsetDist },
                        trimmedStart: null,
                        trimmedEnd: null,
                        originalVertex: points[endIndex]
                    });
                }
            }

            // Filter out collapsed entities — they leave gaps that Phase 2 bridges
            const liveEntities = entities.filter(e => e.type !== 'collapsed');

            if (liveEntities.length < 2) return null;

            // PHASE 2: Compute joints between adjacent live entities
            const numEntities = liveEntities.length;
            const joints = [];
            const miterLimit = (this.options.miterLimit || 2.0) * offsetDist;

            for (let i = 0; i < numEntities; i++) {
                const ent1 = liveEntities[i];
                const ent2 = liveEntities[(i + 1) % numEntities];

                //  Classify corner convexity 
                const v1End = this._entityEndTangent(ent1);
                const v2Start = this._entityStartTangent(ent2);
                const crossProduct = v1End.x * v2Start.y - v1End.y * v2Start.x;
                
                // Collinearity check
                const len1 = Math.hypot(v1End.x, v1End.y);
                const len2 = Math.hypot(v2Start.x, v2Start.y);
                let dot = 0;
                if (len1 > this.options.precision && len2 > this.options.precision) {
                    dot = (v1End.x * v2Start.x + v1End.y * v2Start.y) / (len1 * len2);
                }
                const collinearThreshold = geomConfig.offsetting?.collinearDotThreshold || 0.995;
                const isCollinear = dot > collinearThreshold;

                // UNIVERSAL JOINT CLASSIFIER: Bypasses winding/polarity confusion.
                // If the cross product and normal direction have the same sign, the offset  lines crash into each other (Trim). If opposite, they pull apart (Fillet).
                let needsTrim = (crossProduct * normalDirection >= 0);
                if (isCollinear) needsTrim = true;

                if (needsTrim) {
                    const trimPoint = this._computeTrimJoint(ent1, ent2, ent1.originalVertex, miterLimit);

                    if (trimPoint) {
                        ent1.trimmedEnd = { ...trimPoint, curveId: ent1.curveId || null };
                        ent2.trimmedStart = { ...trimPoint, curveId: ent2.curveId || null };
                        joints.push({ type: 'trim', point: trimPoint });
                    } else {
                        ent1.trimmedEnd = ent1.naturalEnd;
                        ent2.trimmedStart = ent2.naturalStart;
                        joints.push({ type: 'bevel' });
                    }
                } else {
                    ent1.trimmedEnd = ent1.naturalEnd;
                    ent2.trimmedStart = ent2.naturalStart;

                    const arcPoints = this._createRoundJoint(
                        ent1.originalVertex,
                        v1End, v2Start,
                        normalDirection, offsetDist, distance
                    );

                    joints.push({ type: 'fillet', points: arcPoints });
                }
            }

            // Fill any remaining null trims
            for (const ent of liveEntities) {
                if (!ent.trimmedStart) ent.trimmedStart = ent.naturalStart;
                if (!ent.trimmedEnd) ent.trimmedEnd = ent.naturalEnd;
            }

            // PHASE 3: Assemble contour with DENSE ARC TESSELLATION
            const finalPoints = [];
            const finalArcSegments = [];

            for (let i = 0; i < numEntities; i++) {
                const ent = liveEntities[i];
                const joint = joints[i];

                //  Entity start point 
                const startIdx = finalPoints.length;
                finalPoints.push(ent.trimmedStart);

                //  Entity body 
                if (ent.type === 'arc') {
                    // Compute actual angles from trimmed endpoints
                    const actualStartAngle = Math.atan2(
                        ent.trimmedStart.y - ent.center.y,
                        ent.trimmedStart.x - ent.center.x
                    );
                    const actualEndAngle = Math.atan2(
                        ent.trimmedEnd.y - ent.center.y,
                        ent.trimmedEnd.x - ent.center.x
                    );

                    // Compute sweep maintaining original arc direction
                    let sweep = actualEndAngle - actualStartAngle;
                    if (ent.clockwise) {
                        if (sweep > 0) sweep -= 2 * Math.PI;
                    } else {
                        if (sweep < 0) sweep += 2 * Math.PI;
                    }

                    // Prevent crossover pac-man loops
                    const originalAbsSweep = Math.abs(ent.sweepAngle);
                    const newAbsSweep = Math.abs(sweep);
                    
                    // If the sweep angle suddenly became larger than the original + 180deg, the endpoints crossed over each other. The arc was swallowed.
                    if (newAbsSweep > originalAbsSweep + Math.PI) {
                        this.debug(`Arc inversion detected! Sweep went from ${(originalAbsSweep*180/Math.PI).toFixed(1)}° to ${(newAbsSweep*180/Math.PI).toFixed(1)}°. Clamping to 0.`);
                        sweep = 0; // Don't generate a massive loop. Just connect start to end.
                    }

                    // Tessellate: generate dense intermediate points
                    const fullCircleSegs = GeometryUtils.getOptimalSegments(ent.radius, 'arc');
                    const arcSegs = Math.max(2, Math.ceil(fullCircleSegs * Math.abs(sweep) / (2 * Math.PI)));

                    for (let j = 1; j < arcSegs; j++) {
                        const t = j / arcSegs;
                        const angle = actualStartAngle + sweep * t;
                        finalPoints.push({
                            x: ent.center.x + ent.radius * Math.cos(angle),
                            y: ent.center.y + ent.radius * Math.sin(angle),
                            curveId: ent.curveId,
                            segmentIndex: j,
                            totalSegments: arcSegs + 1,
                            t: t
                        });
                    }

                    // End point
                    const endIdx = finalPoints.length;
                    finalPoints.push({
                        ...ent.trimmedEnd,
                        curveId: ent.curveId
                    });

                    // Arc metadata spanning the full tessellated range
                    finalArcSegments.push({
                        startIndex: startIdx,
                        endIndex: endIdx,
                        center: ent.center,
                        radius: ent.radius,
                        startAngle: actualStartAngle,
                        endAngle: actualEndAngle,
                        clockwise: ent.clockwise,
                        sweepAngle: sweep,
                        curveId: ent.curveId
                    });

                } else {
                    // Line: just add end point
                    finalPoints.push(ent.trimmedEnd);
                }

                //  Joint geometry 
                if (joint.type === 'fillet' && joint.points && joint.points.length > 0) {
                    for (const fp of joint.points) {
                        finalPoints.push(fp);
                    }
                }
                // 'trim': shared point already present as trimmedEnd/trimmedStart
                // 'bevel': natural endpoints form the bevel edge
            }

            // PHASE 4: Deduplicate and close
            if (finalPoints.length < 3) return null;

            // Close: merge first/last if coincident
            if (finalPoints.length > 1) {
                const f = finalPoints[0];
                const l = finalPoints[finalPoints.length - 1];
                const dx = f.x - l.x;
                const dy = f.y - l.y;

                // Use squared precision
                if ((dx * dx + dy * dy) < (this.options.precision * this.options.precision)) {
                    const oldEndIdx = finalPoints.length - 1;
                    // Merge metadata before removing
                    if (l.curveId && !f.curveId) {
                        f.curveId = l.curveId;
                    }
                    finalPoints.pop();

                    // Fix any arc segment indices that pointed to the deleted point
                    finalArcSegments.forEach(seg => {
                        if (seg.startIndex === oldEndIdx) seg.startIndex = 0;
                        if (seg.endIndex === oldEndIdx) seg.endIndex = 0;
                    });
                }
            }

            // Adjacent-duplicate pass
            const dedupedPoints = [finalPoints[0]];
            const indexRemap = [0];

            for (let j = 1; j < finalPoints.length; j++) {
                const prev = dedupedPoints[dedupedPoints.length - 1];
                const curr = finalPoints[j];
                const dx = prev.x - curr.x;
                const dy = prev.y - curr.y;

                if ((dx * dx + dy * dy) > (this.options.precision * this.options.precision)) {
                    indexRemap.push(dedupedPoints.length);
                    dedupedPoints.push(curr);
                } else {
                    indexRemap.push(dedupedPoints.length - 1);
                    if (curr.curveId && !prev.curveId) prev.curveId = curr.curveId;
                }
            }

            // Remap arc segment indices
            const remappedArcs = [];
            for (const seg of finalArcSegments) {
                const newStart = indexRemap[seg.startIndex];
                const newEnd = indexRemap[seg.endIndex];
                if (newStart !== newEnd) {
                    remappedArcs.push({ ...seg, startIndex: newStart, endIndex: newEnd });
                }
            }

            this.debug(`Hybrid offset: ${points.length}pts/${arcSegments.length}arcs → ${dedupedPoints.length}pts/${remappedArcs.length}arcs`);

            return {
                points: dedupedPoints,
                isHole: contour.isHole || false,
                nestingLevel: 0,
                parentId: null,
                arcSegments: remappedArcs,
                curveIds: remappedArcs.map(s => s.curveId).filter(Boolean)
            };
        }

        // JOINT COMPUTATION

        _createMiterBevelJoint(seg1, seg2, miterLimit) {
            const intersection = this.lineLineIntersection(
                seg1.p1, seg1.p2,
                seg2.p1, seg2.p2
            );

            if (intersection) {
                const miterLength = Math.hypot(intersection.x - seg1.p2.x, intersection.y - seg1.p2.y);

                if (miterLength > miterLimit) {
                    console.log(`[MITER] Limit exceeded: ${miterLength.toFixed(4)} > ${miterLimit.toFixed(4)} → bevel`);
                    return [seg1.p2, seg2.p1];
                } else {
                    return [intersection];
                }
            } else {
                // Parallel — this is fine for nearly-collinear segments
                return [seg1.p2];
            }
        }

        _createRoundJoint(originalCorner, v1_vec, v2_vec, normalDirection, offsetDist, distance) {
            const len1 = Math.hypot(v1_vec.x, v1_vec.y);
            const len2 = Math.hypot(v2_vec.x, v2_vec.y);

            if (len1 < this.options.precision || len2 < this.options.precision) return [];

            const n1 = { x: normalDirection * (-v1_vec.y / len1), y: normalDirection * (v1_vec.x / len1) };
            const n2 = { x: normalDirection * (-v2_vec.y / len2), y: normalDirection * (v2_vec.x / len2) };

            const angle1 = Math.atan2(n1.y, n1.x);
            const angle2 = Math.atan2(n2.y, n2.x);
            let angleDiff = angle2 - angle1;

            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

            const jointIsClockwise = angleDiff < 0;

            const jointCurveId = window.globalCurveRegistry?.register({
                type: 'arc',
                center: { x: originalCorner.x, y: originalCorner.y },
                radius: offsetDist,
                startAngle: angle1,
                endAngle: angle2,
                clockwise: jointIsClockwise,
                source: 'offset_joint',
                isOffsetDerived: true,
                offsetDistance: distance
            });

            const fullCircleSegments = GeometryUtils.getOptimalSegments(offsetDist, 'circle');
            const proportionalSegments = fullCircleSegments * (Math.abs(angleDiff) / (2 * Math.PI));
            const minSegments = geomConfig.offsetting?.minRoundJointSegments || 2;
            const arcSegments = Math.max(minSegments, Math.ceil(proportionalSegments));

            const arcPoints = [];
            for (let j = 1; j <= arcSegments; j++) {
                const t = j / arcSegments;
                const angle = angle1 + angleDiff * t;
                arcPoints.push({
                    x: originalCorner.x + offsetDist * Math.cos(angle),
                    y: originalCorner.y + offsetDist * Math.sin(angle),
                    curveId: jointCurveId,
                    segmentIndex: j,
                    totalSegments: arcSegments + 1,
                    t: t
                });
            }

            return arcPoints;
        }

        /**
         * Computes the trim point where two adjacent offset entities meet.
         */
        _computeTrimJoint(ent1, ent2, originalVertex, miterLimit) {
            let candidates;

            //  Line-Line 
            if (ent1.type === 'line' && ent2.type === 'line') {
                const ix = this.lineLineIntersection(ent1.p1, ent1.p2, ent2.p1, ent2.p2);
                if (!ix) return null; // Parallel lines, fallback to bevel is fine

                // Miter limit only applies to line-line joints
                const miterDist = Math.hypot(ix.x - ent1.naturalEnd.x, ix.y - ent1.naturalEnd.y);
                if (miterDist > miterLimit) return null; 
                
                return ix;
            }

            //  Line-Arc 
            if (ent1.type === 'line' && ent2.type === 'arc') {
                candidates = this.lineCircleIntersect(ent1.p1, ent1.p2, ent2.center, ent2.radius);
            }
            //  Arc-Line 
            else if (ent1.type === 'arc' && ent2.type === 'line') {
                candidates = this.lineCircleIntersect(ent2.p1, ent2.p2, ent1.center, ent1.radius);
            }
            //  Arc-Arc 
            else if (ent1.type === 'arc' && ent2.type === 'arc') {
                candidates = this.circleCircleIntersect(ent1.center, ent1.radius, ent2.center, ent2.radius);
            }
            else {
                return null;
            }

            // If no intersection, the topology has collapsed.
            // Do not bevel the void. Throw an error to trigger polygon fallback.
            if (!candidates || candidates.length === 0) {
                throw new Error("Analytic topology collapse: entities missed each other");
            }

            const picked = this._pickNearestIntersection(candidates, originalVertex);
            if (!picked) {
                throw new Error("Analytic topology collapse: no valid nearest intersection");
            }

            // Notice: DO NOT check miterLimit for arcs. The circle naturally bounds the math.
            return picked;
        }

        // TANGENT HELPERS
        _entityEndTangent(entity) {
            if (entity.type === 'line') {
                return {
                    x: entity.p2.x - entity.p1.x,
                    y: entity.p2.y - entity.p1.y
                };
            }
            const angle = entity.endAngle;
            if (entity.clockwise) {
                return { x: Math.sin(angle), y: -Math.cos(angle) };
            } else {
                return { x: -Math.sin(angle), y: Math.cos(angle) };
            }
        }

        _entityStartTangent(entity) {
            if (entity.type === 'line') {
                return {
                    x: entity.p2.x - entity.p1.x,
                    y: entity.p2.y - entity.p1.y
                };
            }
            const angle = entity.startAngle;
            if (entity.clockwise) {
                return { x: Math.sin(angle), y: -Math.cos(angle) };
            } else {
                return { x: -Math.sin(angle), y: Math.cos(angle) };
            }
        }

        /**
         * Picks the intersection candidate closest to the original un-offset vertex.
         * This mathematically guarantees the correct physical corner is selected for both expanding (external) and shrinking (internal) offsets, regardless of how far the angles have drifted.
         */
        _pickNearestIntersection(candidates, originalVertex) {
            if (!candidates || candidates.length === 0) return null;
            
            // If only one intersection exists (e.g., tangent), it's the right one
            if (candidates.length === 1) {
                return candidates[0].point || candidates[0];
            }

            let best = null;
            let bestDist = Infinity;

            for (const c of candidates) {
                const pt = c.point || c;
                // Distance from the original polygon corner to the new intersection
                const dist = Math.hypot(pt.x - originalVertex.x, pt.y - originalVertex.y);
                
                if (dist < bestDist) {
                    bestDist = dist;
                    best = pt;
                }
            }

            return best;
        }

        // INTERSECTION MATH
        lineLineIntersection(p1, p2, p3, p4) {
            const den = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
            const epsilon = geomConfig.offsetting?.epsilon || 1e-9;
            if (Math.abs(den) < epsilon) return null;

            const t_num = (p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x);
            const t = t_num / den;

            return {
                x: p1.x + t * (p2.x - p1.x),
                y: p1.y + t * (p2.y - p1.y)
            };
        }

        lineCircleIntersect(p1, p2, center, radius) {
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const fx = p1.x - center.x;
            const fy = p1.y - center.y;

            const a = dx * dx + dy * dy;
            if (a < this.options.precision * this.options.precision) return [];

            const b = 2 * (fx * dx + fy * dy);
            const c = fx * fx + fy * fy - radius * radius;
            let discriminant = b * b - 4 * a * c;

            if (discriminant < -(this.options.precision * 10)) {
                // Topology has collapsed (line missed circle). 
                // Snap to the closest point on the line to the circle's center to force a joint.
                const tClosest = -b / (2 * a);
                const px = p1.x + tClosest * dx;
                const py = p1.y + tClosest * dy;
                
                return [{
                    point: { x: px, y: py },
                    tLine: tClosest,
                    angle: Math.atan2(py - center.y, px - center.x)
                }];
            }

            if (discriminant < 0) discriminant = 0;

            const sqrtDisc = Math.sqrt(discriminant);
            const results = [];

            const addResult = (t) => {
                const px = p1.x + t * dx;
                const py = p1.y + t * dy;
                results.push({
                    point: { x: px, y: py },
                    tLine: t,
                    angle: Math.atan2(py - center.y, px - center.x)
                });
            };

            const t1 = (-b - sqrtDisc) / (2 * a);
            const t2 = (-b + sqrtDisc) / (2 * a);

            addResult(t1);
            if (Math.abs(t2 - t1) > 1e-9) addResult(t2);

            return results;
        }

        circleCircleIntersect(c1, r1, c2, r2) {
            const dx = c2.x - c1.x;
            const dy = c2.y - c1.y;
            const d = Math.hypot(dx, dy);

            const eps = this.options.precision * 10;

            if (d > r1 + r2 + eps) return [];
            if (d < Math.abs(r1 - r2) - eps) return [];
            if (d < this.options.precision) return [];

            const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
            let hSq = r1 * r1 - a * a;

            if (hSq < 0 && hSq > -(eps * eps)) {
                hSq = 0;
            } else if (hSq < 0) {
                return [];
            }

            const h = Math.sqrt(hSq);
            const mx = c1.x + a * dx / d;
            const my = c1.y + a * dy / d;

            const px = h * dy / d;
            const py = h * dx / d;

            const p1 = { x: mx + px, y: my - py };
            const p2 = { x: mx - px, y: my + py };

            if (h < this.options.precision) return [p1];

            return [p1, p2];
        }

        // ANALYTIC SHAPE OFFSETTERS
        offsetCircle(circle, distance) {
            const newRadius = circle.radius + distance;
            const isInternal = distance < 0;

            if (newRadius < this.options.precision) {
                this.debug(`Circle collapsed: r=${newRadius.toFixed(4)}`);
                return null;
            }

            const offsetCirclePrimitive = new CirclePrimitive(circle.center, newRadius, { ...circle.properties });
            const offsetPath = GeometryUtils.primitiveToPath(offsetCirclePrimitive);

            if (!offsetPath || !offsetPath.contours || offsetPath.contours.length === 0) return null;

            offsetPath.properties = {
                ...offsetPath.properties,
                isOffset: true,
                offsetDistance: distance,
                offsetType: isInternal ? 'internal' : 'external',
                sourcePrimitiveId: circle.id,
            };

            const contour = offsetPath.contours[0];
            if (window.globalCurveRegistry && contour.curveIds) {
                contour.curveIds.forEach(id => {
                    const curve = window.globalCurveRegistry.getCurve(id);
                    if (curve) {
                        curve.isOffsetDerived = true;
                        curve.offsetDistance = distance;
                        curve.sourceCurveId = circle.properties?.originalCurveId || (circle.curveIds ? circle.curveIds[0] : null);
                    }
                });
            }

            return offsetPath;
        }

        offsetRectangle(rectangle, distance) {
            const { x, y } = rectangle.position;
            const w = rectangle.width;
            const h = rectangle.height;

            // Convert the rectangle into a standard closed Counter-Clockwise (CCW) path.
            const rectPoints = [
                { x: x,     y: y },
                { x: x + w, y: y },
                { x: x + w, y: y + h },
                { x: x,     y: y + h },
                { x: x,     y: y } // Explicitly close path
            ];

            const rectAsPath = new PathPrimitive([{
                points: rectPoints,
                isHole: false,
                nestingLevel: 0,
                parentId: null,
                arcSegments: [],
                curveIds: []
            }], {
                ...rectangle.properties,
                fill: true,
                closed: true
            });
            return this.offsetPath(rectAsPath, distance);
        }

        async offsetArc(arc, distance) {
            // Convert to path primitive
            const pathPrimitive = GeometryUtils.primitiveToPath(arc);
            if (!pathPrimitive) return null;

            return this.offsetPath(pathPrimitive, distance);
        }

        offsetObround(obround, distance) {
            this.debug(`Offsetting obround by ${distance.toFixed(3)}mm.`);

            // Determine if the offset is internal (shrinking) or external (growing).
            const isInternal = distance < 0;

            // Calculate the dimensions and position of the new offset obround.
            const newWidth = obround.width + (distance * 2);
            const newHeight = obround.height + (distance * 2);
            const newPosition = {
                x: obround.position.x - distance,
                y: obround.position.y - distance
            };

            // Handle degenerate cases
            if (newWidth < this.options.precision || newHeight < this.options.precision) {
                this.debug(`Obround collapsed: ${newWidth.toFixed(3)}×${newHeight.toFixed(3)}`);
                return null;
            }

            // Create a new ObroundPrimitive
            const offsetObroundPrimitive = new ObroundPrimitive(newPosition, newWidth, newHeight, {
                ...obround.properties
            });

            // Convert this new analytic primitive into a PathPrimitive
            const offsetPath = GeometryUtils.primitiveToPath(offsetObroundPrimitive);
            if (!offsetPath || !offsetPath.contours || offsetPath.contours.length === 0) {
                return null;
            }

            // Add the required offset metadata to the final PathPrimitive.
            offsetPath.properties = {
                ...offsetPath.properties,
                isOffset: true,
                offsetDistance: distance,
                offsetType: isInternal ? 'internal' : 'external',
                sourcePrimitiveId: obround.id,
            };

            // Post-process the newly registered curve IDs to mark them as offset-derived.
            const contour = offsetPath.contours[0];
            if (window.globalCurveRegistry && contour.curveIds) {
                contour.curveIds.forEach(id => {
                    const curve = window.globalCurveRegistry.getCurve(id);
                    if (curve) {
                        curve.isOffsetDerived = true;
                        curve.offsetDistance = distance;
                        curve.sourceCurveId = obround.curveIds ? obround.curveIds[0] : null;
                    }
                });
            }

            if (debugConfig.enabled) {
                const pointCount = contour.points.length;
                const curveCount = contour.curveIds?.length || 0;
                console.log(`Successfully created offset obround path with ${pointCount} points and ${curveCount} registered curves.`);
            }

            return offsetPath;
        }

    }

    window.GeometryOffsetter = GeometryOffsetter;
})();