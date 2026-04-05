/*!
 * @file        geometry/geometry-offsetter-analytic.js
 * @description Analytic offsetting code
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
    // WARNING - NOT FULLY UPDATED TO NEW CONFIG STRUCTURE YET
    'use strict';

    const C = window.PCBCAMConfig.constants;
    const D = window.PCBCAMConfig.defaults;
    const PRECISION = C.precision.coordinate;
    const debugState = D.debug;

    /**
     * Analytic contour offsetter for mixed line + arc geometry.
     *
     * Algorithm (4-phase):
     *   Phase 1 — Build offset entities: each contour edge becomes a parallel
     *             line (shifted by the normal) or a concentric arc (radius ±
     *             offset). Collapsed arcs (radius < PRECISION) are removed.
     *   Phase 2 — Compute joints: adjacent entity pairs are classified as
     *             trim (converging) or fillet (diverging). Trim joints use
     *             analytic line–line, line–circle, or circle–circle
     *             intersection. Fillet joints generate round arcs.
     *   Phase 3 — Assemble the final contour with dense arc tessellation so
     *             downstream consumers (Clipper2, renderers) see smooth curves.
     *   Phase 4 — Deduplicate adjacent coincident points and close the path.
     *
     * Dependencies:
     *   - GeometryMath   (intersection routines, round-joint generation)
     *   - GeometryUtils   (getOptimalSegments, calculateWinding)
     *   - globalCurveRegistry (optional, for offset-arc registration)
     *
     * Error contract:
     *   offsetContour() THROWS Error on topology collapse (entities that miss
     *   each other after offset). The caller (GeometryOffsetter._offsetSingleContour)
     *   catches the throw and falls through to the polygon-only fallback.
     */
    class GeometryAnalyticOffsetter {
        constructor(options = {}) {
            this.options = {
                miterLimit: options.miterLimit || geomConfig.offsetting?.miterLimit || 2.0
            };
        }

        /**
         * Main entry point.
         * Offsets a single closed contour that may contain arc segments.
         *
         * @param {Object} contour  - { points, arcSegments, isHole, ... }
         * @param {number} distance - Signed offset distance (positive = external, negative = internal).
         * @returns {Object|null} { points, arcSegments, curveIds } or null if collapsed.
         * @throws {Error} On topology collapse (entities missed each other).
         */
        offsetContour(contour, distance) {
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

            // Determine normal direction from winding
            const pathWinding = GeometryUtils.calculateWinding(points);
            const pathIsCCW = pathWinding > 0;
            let normalDirection = isInternal ? 1 : -1;
            if (!pathIsCCW) normalDirection *= -1;

            // ──────────────────────────────────────────────
            // PHASE 1: Build offset entities
            // ──────────────────────────────────────────────
            const entities = [];
            const n = points.length;

            for (let i = 0; i < n; i++) {
                const startIndex = i;
                const endIndex = (i + 1) % n;
                const arc = arcMap.get(startIndex);

                // Arc segment: offset concentrically
                if (arc && arc.endIndex === endIndex) {
                    const newRadius = arc.radius + (normalDirection * offsetDist);

                    if (newRadius < PRECISION) {
                        // Arc collapsed — mark gap, neighbors will extend to meet
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
                            source: 'analytic_offset'
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
                    // Line segment: shift by normal
                    const p1 = points[startIndex];
                    const p2 = points[endIndex];

                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    const len = Math.hypot(dx, dy);

                    if (len < PRECISION) continue;

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

            // Filter collapsed entities
            const liveEntities = entities.filter(e => e.type !== 'collapsed');
            if (liveEntities.length < 2) return null;

            // ──────────────────────────────────────────────
            // PHASE 2: Compute joints between adjacent entities
            // ──────────────────────────────────────────────
            const numEntities = liveEntities.length;
            const joints = [];
            const miterLimit = this.options.miterLimit * offsetDist;

            for (let i = 0; i < numEntities; i++) {
                const ent1 = liveEntities[i];
                const ent2 = liveEntities[(i + 1) % numEntities];

                // Classify corner convexity via tangent cross product
                const v1End = this._entityEndTangent(ent1);
                const v2Start = this._entityStartTangent(ent2);
                const crossProduct = v1End.x * v2Start.y - v1End.y * v2Start.x;

                // Collinearity check
                const len1 = Math.hypot(v1End.x, v1End.y);
                const len2 = Math.hypot(v2Start.x, v2Start.y);
                let dot = 0;
                if (len1 > PRECISION && len2 > PRECISION) {
                    dot = (v1End.x * v2Start.x + v1End.y * v2Start.y) / (len1 * len2);
                }
                const isCollinear = dot > C.precision.collinearDot;

                // Joint classifier: same-sign cross×normal → trim, opposite → fillet
                let needsTrim = (crossProduct * normalDirection >= 0);
                if (isCollinear) needsTrim = true;

                if (needsTrim) {
                    // Trim: find intersection point where entities meet
                    const trimPoint = this._computeTrimJoint(ent1, ent2, ent1.originalVertex, miterLimit);

                    if (trimPoint) {
                        ent1.trimmedEnd = { ...trimPoint, curveId: ent1.curveId || null };
                        ent2.trimmedStart = { ...trimPoint, curveId: ent2.curveId || null };
                        joints.push({ type: 'trim', point: trimPoint });
                    } else {
                        // Miter limit exceeded on line–line → bevel
                        ent1.trimmedEnd = ent1.naturalEnd;
                        ent2.trimmedStart = ent2.naturalStart;
                        joints.push({ type: 'bevel' });
                    }
                } else {
                    // Fillet: entities diverge, fill with round arc
                    ent1.trimmedEnd = ent1.naturalEnd;
                    ent2.trimmedStart = ent2.naturalStart;

                    const arcPoints = GeometryMath.createRoundJoint(
                        ent1.originalVertex,
                        v1End, v2Start,
                        normalDirection, offsetDist, distance, PRECISION
                    );

                    joints.push({ type: 'fillet', points: arcPoints });
                }
            }

            // Fill remaining null trims with natural endpoints
            for (const ent of liveEntities) {
                if (!ent.trimmedStart) ent.trimmedStart = ent.naturalStart;
                if (!ent.trimmedEnd) ent.trimmedEnd = ent.naturalEnd;
            }

            // ──────────────────────────────────────────────
            // PHASE 3: Assemble contour with dense arc tessellation
            // ──────────────────────────────────────────────
            const finalPoints = [];
            const finalArcSegments = [];

            for (let i = 0; i < numEntities; i++) {
                const ent = liveEntities[i];
                const joint = joints[i];

                // Entity start point
                const startIdx = finalPoints.length;
                finalPoints.push(ent.trimmedStart);

                // Entity body
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

                    // Detect inversion: if the sweep suddenly grew by more than 180° beyond the original, the trim endpoints crossed over each other.
                    const originalAbsSweep = Math.abs(ent.sweepAngle);
                    const newAbsSweep = Math.abs(sweep);

                    if (newAbsSweep > originalAbsSweep + Math.PI) {
                        this.debug(`Arc inversion detected! Sweep ${(originalAbsSweep*180/Math.PI).toFixed(1)}° → ${(newAbsSweep*180/Math.PI).toFixed(1)}°. Clamping to 0.`);
                        sweep = 0;
                    }

                    // Dense tessellation
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

                // Joint geometry
                if (joint.type === 'fillet' && joint.points && joint.points.length > 0) {
                    for (const fp of joint.points) {
                        finalPoints.push(fp);
                    }
                }
                // 'trim': shared point already present as trimmedEnd/trimmedStart
                // 'bevel': natural endpoints form the bevel edge
            }

            // ──────────────────────────────────────────────
            // PHASE 4: Deduplicate and close
            // ──────────────────────────────────────────────
            if (finalPoints.length < 3) return null;

            // Close: merge first/last if coincident
            if (finalPoints.length > 1) {
                const f = finalPoints[0];
                const l = finalPoints[finalPoints.length - 1];
                const dx = f.x - l.x;
                const dy = f.y - l.y;

                if ((dx * dx + dy * dy) < (PRECISION * PRECISION)) {
                    const oldEndIdx = finalPoints.length - 1;
                    if (l.curveId && !f.curveId) {
                        f.curveId = l.curveId;
                    }
                    finalPoints.pop();

                    finalArcSegments.forEach(seg => {
                        if (seg.startIndex === oldEndIdx) seg.startIndex = 0;
                        if (seg.endIndex === oldEndIdx) seg.endIndex = 0;
                    });
                }
            }

            // Adjacent-duplicate removal
            const dedupedPoints = [finalPoints[0]];
            const indexRemap = [0];

            for (let j = 1; j < finalPoints.length; j++) {
                const prev = dedupedPoints[dedupedPoints.length - 1];
                const curr = finalPoints[j];
                const dx = prev.x - curr.x;
                const dy = prev.y - curr.y;

                if ((dx * dx + dy * dy) > (PRECISION * PRECISION)) {
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

            this.debug(`Analytic offset: ${points.length}pts/${arcSegments.length}arcs → ${dedupedPoints.length}pts/${remappedArcs.length}arcs`);

            return {
                points: dedupedPoints,
                arcSegments: remappedArcs,
                curveIds: remappedArcs.map(s => s.curveId).filter(Boolean)
            };
        }

        // ==========================================
        // TRIM JOINT COMPUTATION
        // ==========================================

        /**
         * Computes the trim point where two adjacent offset entities meet.
         * Dispatches to the appropriate intersection routine in GeometryMath.
         *
         * @throws {Error} If entities miss each other (topology collapse).
         */
        _computeTrimJoint(ent1, ent2, originalVertex, miterLimit) {
            let candidates;

            // Line–Line
            if (ent1.type === 'line' && ent2.type === 'line') {
                const ix = GeometryMath.lineLineIntersection(ent1.p1, ent1.p2, ent2.p1, ent2.p2);
                if (!ix) return null; // Parallel — bevel is fine

                const miterDist = Math.hypot(ix.x - ent1.naturalEnd.x, ix.y - ent1.naturalEnd.y);
                if (miterDist > miterLimit) return null; // Miter limit exceeded → bevel

                return ix;
            }

            // Line–Arc
            if (ent1.type === 'line' && ent2.type === 'arc') {
                candidates = GeometryMath.lineCircleIntersect(ent1.p1, ent1.p2, ent2.center, ent2.radius, PRECISION);
            }
            // Arc–Line
            else if (ent1.type === 'arc' && ent2.type === 'line') {
                candidates = GeometryMath.lineCircleIntersect(ent2.p1, ent2.p2, ent1.center, ent1.radius, PRECISION);
            }
            // Arc–Arc
            else if (ent1.type === 'arc' && ent2.type === 'arc') {
                candidates = GeometryMath.circleCircleIntersect(ent1.center, ent1.radius, ent2.center, ent2.radius, PRECISION);
            }
            else {
                return null;
            }

            // No intersection means the topology has collapsed.
            // Throw so the orchestrator can fall back to the polygon path.
            if (!candidates || candidates.length === 0) {
                throw new Error("Analytic topology collapse: entities missed each other");
            }

            const picked = GeometryMath.pickNearestIntersection(candidates, originalVertex);
            if (!picked) {
                throw new Error("Analytic topology collapse: no valid nearest intersection");
            }

            return picked;
        }

        // ==========================================
        // TANGENT HELPERS
        // ==========================================

        /**
         * Returns the direction vector at the END of an entity.
         * For lines: the line direction itself.
         * For arcs: the tangent at the end angle.
         */
        _entityEndTangent(entity) {
            if (entity.type === 'line') {
                return {
                    x: entity.p2.x - entity.p1.x,
                    y: entity.p2.y - entity.p1.y
                };
            }
            // Arc tangent at endAngle
            const angle = entity.endAngle;
            if (entity.clockwise) {
                return { x: Math.sin(angle), y: -Math.cos(angle) };
            } else {
                return { x: -Math.sin(angle), y: Math.cos(angle) };
            }
        }

        /**
         * Returns the direction vector at the START of an entity.
         * For lines: the line direction itself.
         * For arcs: the tangent at the start angle.
         */
        _entityStartTangent(entity) {
            if (entity.type === 'line') {
                return {
                    x: entity.p2.x - entity.p1.x,
                    y: entity.p2.y - entity.p1.y
                };
            }
            // Arc tangent at startAngle
            const angle = entity.startAngle;
            if (entity.clockwise) {
                return { x: Math.sin(angle), y: -Math.cos(angle) };
            } else {
                return { x: -Math.sin(angle), y: Math.cos(angle) };
            }
        }

        // ==========================================
        // DEBUG
        // ==========================================

        debug(message, data = null) {
            if (debugState.enabled) {
                if (data) {
                    console.log(`[AnalyticOffsetter] ${message}`, data);
                } else {
                    console.log(`[AnalyticOffsetter] ${message}`);
                }
            }
        }
    }

    window.GeometryAnalyticOffsetter = GeometryAnalyticOffsetter;
})();