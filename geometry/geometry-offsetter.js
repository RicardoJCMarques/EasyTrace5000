/*!
 * @file        geometry/geometry-offsetter.js
 * @description Geometry offsetting orchestrator
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

    class GeometryOffsetter {
        constructor(options = {}) {
            this.options = {
                miterLimit: options.miterLimit
            };
            this.initialized = true;
            this.geometryProcessor = null;

            // --- BOOLEAN OFFSET TOGGLE ---
            // When true:  all path offsetting routes through Clipper2 boolean operations.
            // When false: arc-containing contours try the analytic offsetter first, then fall back to the polygon-only offsetter. NOTICE: All related code is commented out.
            this.USE_BOOLEAN_OFFSETTING = true;

            // Analytic strategy (loads gracefully if module is present)
            this.analyticOffsetter = null;
            if (typeof GeometryAnalyticOffsetter !== 'undefined') {
                this.analyticOffsetter = new GeometryAnalyticOffsetter({
                    miterLimit: options.miterLimit
                });
                this.debug('Analytic offsetter module linked');
            }
        }

        debug(message, data = null) {
            if (debugState.enabled) {
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
            if (debugState.enabled) {
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
            if (Math.abs(distance) < PRECISION) return primitive;

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

            if (totalWidth < PRECISION) {
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
            } else if (primitive.type === 'path' && primitive.contours?.[0]) {
                
                // Pass the entire contour to traceToPolygon so arcSegments are preserved, instead of passing just primitive.contours[0].points.
                const contour = primitive.contours[0];
                const strokes = GeometryUtils.traceToPolygon(contour, totalWidth, props);
                
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

            } else {
                if (debugState.enabled) console.warn(`[Offsetter] Unhandled stroke type: ${primitive.type}`);
                return null;
            }
        }

        /**
         * Checks if a path primitive contains any analytic arc segments.
         */
        _hasAnalyticArcs(pathPrimitive) {
            if (!pathPrimitive.contours || pathPrimitive.contours.length === 0) {
                return false;
            }
            return pathPrimitive.contours.some(contour => 
                contour.arcSegments && contour.arcSegments.length > 0
            );
        }

        /**
         * Offsets a PathPrimitive. Routes to boolean pipeline or legacy fallback.
         */
        async offsetPath(path, distance) {
            if (!path.contours || path.contours.length === 0) {
                this.debug('offsetPath: no contours');
                return null;
            }

            // Centerline paths bypass standard offsetting
            if (path.properties?.isCenterlinePath) {
                return new PathPrimitive(path.contours, {
                    ...path.properties,
                    isOffset: true,
                    offsetDistance: distance,
                    offsetType: 'on',
                    closed: false
                });
            }

            // The Safeguard: Check for complex arc geometry
            const containsArcs = this._hasAnalyticArcs(path);

            // Route to Boolean Inflating if: It has arcs, globally force boolean, or the analytic offset module is missing
            if (containsArcs || this.USE_BOOLEAN_OFFSETTING || !this.analyticOffsetter) {
                this.debug(`Routing path ${path.id} to Boolean Inflated Offsetter (containsArcs: ${containsArcs})`);
                return await this._offsetPathViaBoolean(path, distance);
            }

            /**
            // Fall-through to Analytic Offsetter (For pure straight-segment polygons)
            this.debug(`Routing path ${path.id} to Analytic Offsetter (Straight segments only)`);

            if (this.analyticOffsetter) {
                return await this.analyticOffsetter.offsetPath(path, distance);
            }

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
             */
        }

        /**
         * Boolean offset: builds a stroke-width boundary ring using optimized overlapping shapes, then extracts the outer contour (external offset) or hole contour (internal offset) from the ring.
         */
        async _offsetPathViaBoolean(path, distance) {
            if (!this.geometryProcessor) {
                console.warn('[Offsetter] GeometryProcessor required for boolean offsetting');
                return null;
            }

            const offsetDist = Math.abs(distance);
            const strokeWidth = offsetDist * 2;
            const isInternal = distance < 0;

            // Generate boundary strokes from contours
            const boundaryStrokes = [];

            for (const contour of path.contours) {
                // Pass the raw contour directly to the stroke generator.
                const strokes = GeometryUtils.closedContourToStrokePolygons(contour, strokeWidth);
                if (strokes && strokes.length > 0) {
                    boundaryStrokes.push(...strokes);
                }
            }

            if (boundaryStrokes.length === 0) return null;

            const opId = path.properties?.operationId;
            if (opId && window.pcbcam?.core) {
                const op = window.pcbcam.core.operations.find(o => o.id === opId);
                if (op) {
                    if (!op._debugStrokes) op._debugStrokes = [];
                    op._debugStrokes.push(...boundaryStrokes);
                }
            }

            // Union all strokes into a thick offset ring
            const ring = await this.geometryProcessor.unionGeometry(boundaryStrokes);
            if (!ring || ring.length === 0) return null;

            // Boolean masking: use the original polygon as a mask.
            // Internal: Original MINUS Ring → shrinks polygon, drops false pockets.
            // External: Original UNION Ring → expands polygon outward.
            // Tessellate arc segments for Clipper2 (works with polygons only).
            const maskContours = path.contours.map(c => {
                const tessellated = GeometryUtils.contourArcsToPath(c);
                let points = tessellated.points;

                // Normalize to CCW — Clipper2 needs positive winding for subject polygons.
                // The isHole flag is already stripped, but CW-wound hole contours that were extracted into standalone primitives retain their original point order, causing winding cancellation during union.
                if (GeometryUtils.isClockwise(points)) {
                    points = points.slice().reverse();
                }

                return {
                    points: points,
                    isHole: false,
                    nestingLevel: 0,
                    parentId: null,
                    arcSegments: [],
                    curveIds: c.curveIds || []
                };
            });

            const originalMask = new PathPrimitive(maskContours, {
                ...path.properties,
                polarity: 'dark'
            });

            let resultPrimitives;

            if (isInternal) {
                resultPrimitives = await this.geometryProcessor.difference([originalMask], ring);
            } else {
                resultPrimitives = await this.geometryProcessor.unionGeometry([originalMask, ...ring]);
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
                // Smuggle the raw polygonized strokes out for the renderer for visual debugging
                p.properties._preprocessedStrokes = boundaryStrokes;
            });

            this.debug(`Boolean offset result: ${resultPrimitives.length} primitive(s) (${isInternal ? 'internal' : 'external'})`);
            return resultPrimitives;
        }

        /**
         * Post-processes boolean offset results with an area filter to reject slivers.
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
         * Called AFTER arc reconstruction so arc segment endpoints can be protected by index.
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
         * Offsets a single contour. Tries analytic (arc-aware) first if arcs are present and the analytic module is loaded, then falls back to the polygon-only path.
         */
        /**
        _offsetSingleContour(contour, distance, pathProperties) {
            const hasArcs = contour.arcSegments && contour.arcSegments.length > 0;

            this.debug(`Contour: ${contour.points.length} pts, ${contour.arcSegments?.length || 0} arcs, hasArcs=${hasArcs}`);

            // Try analytic offsetter first for arc-containing geometry
            if (hasArcs && this.analyticOffsetter) {
                try {
                    const offsetResult = this.analyticOffsetter.offsetContour(contour, distance);
                    if (offsetResult) {
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
                            points: offsetPoints,
                            isHole: contour.isHole || false,
                            nestingLevel: contour.nestingLevel || 0,
                            parentId: contour.parentId || null,
                            arcSegments: [],
                            curveIds: collectedCurveIds
                        }], makeProps(contour.isHole ? 'clear' : 'dark'));
                    }
                } catch (e) {
                    this.debug(`Analytic offset failed (${e.message}), falling back to polygon offsetter.`);
                }
            }

            // FALLBACK: Polygon-only offset (no arc awareness)
            // If hasArcs was false, OR if the try block failed and threw an error, the code arrives here and runs the robust polygon offsetter.
            const offsetPoints = this._offsetContourPoints(contour.points, distance);
            if (!offsetPoints || offsetPoints.length < 3) return null;

            // Collect curve IDs from rounded joints
            const collectedCurveIds = Array.from(
                new Set(offsetPoints.filter(p => p.curveId > 0).map(p => p.curveId))
            );

            return new PathPrimitive([{
                points: offsetPoints,
                isHole: contour.isHole || false,
                nestingLevel: contour.nestingLevel || 0,
                parentId: contour.parentId || null,
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
         */

        /*
         * POLYGON-ONLY CONTOUR OFFSET
         */
        /**
        _offsetContourPoints(points, distance) {
            const isInternal = distance < 0;
            const offsetDist = Math.abs(distance);

            let polygonPoints = points.slice();

            // Remove closing duplicate
            const first = polygonPoints[0];
            const last = polygonPoints[polygonPoints.length - 1];
            if (Math.hypot(first.x - last.x, first.y - last.y) < PRECISION) {
                polygonPoints.pop();
            }

            // Simplification for internal offsets only
            const simplificationConfig = D.geometry.simplification;
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
                const p2 = polygonPoints[i === n - 1 ? 0 : i + 1]; // Optimized wrapping

                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const len = Math.sqrt(dx * dx + dy * dy); // ~4x faster than Math.hypot
                if (len < PRECISION) continue;

                const nx = normalDirection * (-dy / len);
                const ny = normalDirection * (dx / len);

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

                if (len1 > PRECISION && len2 > PRECISION) {
                    dot = (v1_vec.x * v2_vec.x + v1_vec.y * v2_vec.y) / (len1 * len2);
                }

                const isCollinear = (dot > C.precision.collinearDot) || (len1 < PRECISION) || (len2 < PRECISION);

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

                    const arcPoints = GeometryMath.createRoundJoint(
                        curr, v1_vec, v2_vec,
                        normalDirection, offsetDist, distance, PRECISION
                    );
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
            if (Math.hypot(firstFinal.x - lastFinal.x, firstFinal.y - lastFinal.y) > PRECISION) {
                finalPoints.push({ ...firstFinal });
            }

            return finalPoints;
        }
         */

        /*
         * POLYGON JOINT HELPERS
         */
        /**
        _createMiterBevelJoint(seg1, seg2, miterLimit) {
            const intersection = GeometryMath.lineLineIntersection(
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
         */

        /*
         * ANALYTIC SHAPE OFFSETTERS
         */

        offsetCircle(circle, distance) {
            const newRadius = circle.radius + distance;
            const isInternal = distance < 0;

            if (newRadius < PRECISION) {
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
            if (newWidth < PRECISION || newHeight < PRECISION) {
                this.debug(`Obround collapsed: ${newWidth.toFixed(3)}x${newHeight.toFixed(3)}`);
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

            if (debugState.enabled) {
                const pointCount = contour.points.length;
                const curveCount = contour.curveIds?.length || 0;
                console.log(`Successfully created offset obround path with ${pointCount} points and ${curveCount} registered curves.`);
            }

            return offsetPath;
        }

    }

    window.GeometryOffsetter = GeometryOffsetter;
})();