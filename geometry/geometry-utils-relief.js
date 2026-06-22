/*!
 * @file        geometry/geometry-utils-relief.js
 * @description Relief / 2.5D-mold toolpath generator. Converts a
 *              Heightmap into 3D path primitives (per-point Z) in the
 *              SAME output format as the V-Carve generator:
 *              PathPrimitives with properties.is3DContour = true.
 *              Everything downstream (translate3DContour, optimizer
 *              guards, MachineProcessor 3D macro, post-processors)
 *              is shared with V-Carve and needs no relief-specific code.
 *
 *              Stages:
 *                1. Depth mapping   — model height → cut Z (invertible)
 *                2. Compensation    — ball-nose / flat tool-tip surface
 *                                     (gouge protection)
 *                3. Roughing        — constant-stepdown layers, clamped
 *                                     surface-follow, span trimming
 *                4. Finishing       — serpentine raster (+optional 90°
 *                                     cross pass)
 *                5. Simplification  — 3D Douglas-Peucker per scan segment
 *                                     (the pipeline's 2D simplifier is
 *                                     gated off for 3D plans, so output
 *                                     density is controlled HERE)
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 *
 * SPDX-FileCopyrightText: 2025-2026 Eltryus - Ricardo Marques
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Not Wired
(function() {
    'use strict';

    const D = window.CAMConfig.defaults;
    const debugState = D.debug;
    const Z_EPS = 1e-4; // mm — "removes material" threshold for roughing spans

    const ReliefGenerator = {

        /**
         * Main entry.
         *
         * @param {HeightmapPrimitive|Heightmap} source
         * @param {Object} o - options
         * @param {number}  o.toolDiameter              - mm
         * @param {string} [o.toolShape='ball']         - 'ball' | 'flat'
         * @param {number}  o.reliefDepth               - total carve depth (mm, positive)
         * @param {number} [o.startDepth=0]             - surface offset below Z0 (mm, positive)
         * @param {boolean}[o.invert=false]             - true → mold (high model = deep cut)
         * @param {boolean}[o.roughing=true]            - emit roughing layers
         * @param {number} [o.roughStepdown=1.5]        - mm per roughing layer
         * @param {number} [o.roughStepover]            - mm between roughing scanlines
         * @param {number} [o.roughStock=0.3]           - mm left for finishing
         * @param {number} [o.finishStepover]           - mm between finishing scanlines
         * @param {boolean}[o.crossFinish=false]        - add 90° second finishing pass
         * @param {string} [o.rasterAxis='x']           - 'x' (rows) | 'y' (columns)
         * @param {number} [o.simplifyTolerance=0.01]   - 3D DP tolerance (mm). 0 = off
         * @param {number} [o.minSegmentLength=0.2]     - drop roughing slivers shorter than this (mm)
         * @returns {Array<PathPrimitive>} 3D path primitives (is3DContour)
         */
        generateReliefPaths(source, o) {
            const hm = source.heightmap || source;
            const t0 = performance.now();

            const toolRadius = (o.toolDiameter || 3) / 2;
            const toolShape = o.toolShape || 'ball';
            const reliefDepth = Math.abs(o.reliefDepth || 3);
            const startDepth = Math.max(0, o.startDepth || 0);
            const simplifyTol = o.simplifyTolerance ?? 0.01;
            const minSegLen = o.minSegmentLength ?? 0.2;
            const axis = o.rasterAxis === 'y' ? 'y' : 'x';

            // Stage 1: depth mapping
            // cut[i] ∈ [-(startDepth+reliefDepth), -startDepth]
            const cut = this.mapDepths(hm, reliefDepth, startDepth, !!o.invert);

            // Stage 2: tool-tip compensation
            const comp = this.compensate(cut, hm.cols, hm.rows, hm.cellSize, toolRadius, toolShape);
            this.debug(`Compensation done (${toolShape}, r=${toolRadius}mm)`);

            const primitives = [];

            // Stage 3: roughing
            if (o.roughing !== false && reliefDepth > Z_EPS) {
                const layers = this.compensate(startDepth, reliefDepth, o.roughStepdown || 1.5);
                const stepover = o.roughStepover || toolRadius; // 50% of diameter
                let chainCount = 0;
                for (let li = 0; li < layers.length; li++) {
                    const chains = this.rasterRoughLayer(
                        comp, hm, axis, stepover,
                        layers[li],
                        li === 0 ? -startDepth : layers[li - 1],
                        o.roughStock ?? 0.3,
                        minSegLen
                    );
                    for (const chain of chains) {
                        const pts = simplifyTol > 0 ? this.simplify3D(chain, simplifyTol) : chain;
                        if (pts.length >= 2) {
                            primitives.push(this.toPrimitive(pts, 'roughing'));
                            chainCount++;
                        }
                    }
                }
                this.debug(`Roughing: ${layers.length} layer(s) → ${chainCount} chain(s)`);
            }

            // Stage 4: finishing
            const finishStepover = o.finishStepover || toolRadius * 0.2; // 10% of diameter
            const finishChain = this.rasterFinish(comp, hm, axis, finishStepover, simplifyTol);
            if (finishChain.length >= 2) primitives.push(this.toPrimitive(finishChain, 'finishing'));

            if (o.crossFinish) {
                const crossAxis = axis === 'x' ? 'y' : 'x';
                const crossChain = this.rasterFinish(comp, hm, crossAxis, finishStepover, simplifyTol);
                if (crossChain.length >= 2) primitives.push(this.toPrimitive(crossChain, 'finishing'));
            }

            this.debug(`Relief generation complete: ${primitives.length} primitive(s) in ` +
                `${(performance.now() - t0).toFixed(0)}ms`);
            return primitives;
        },

        // ════════════════════════════════════════════════════════
        // Stage 1 — model heights → cut depths
        // ════════════════════════════════════════════════════════
        mapDepths(hm, reliefDepth, startDepth, invert) {
            const n = hm.cols * hm.rows;
            const cut = new Float32Array(n);
            const maxH = hm.maxH > 1e-9 ? hm.maxH : 1;
            const src = hm.data;
            for (let i = 0; i < n; i++) {
                let hNorm = src[i] / maxH;           // 0..1
                if (invert) hNorm = 1 - hNorm;       // mold mode
                // highest model points → -startDepth, lowest → -(startDepth+reliefDepth)
                cut[i] = -(startDepth + reliefDepth * (1 - hNorm));
            }
            return cut;
        },

        // ════════════════════════════════════════════════════════
        // Stage 2 — tool-tip surface (gouge protection)
        //
        // Ball-nose, radius r, tip at (x, y, zt), sphere center at zt + r.
        // Sphere height at horizontal distance d from the axis:
        //   zt + r − sqrt(r² − d²)
        // To avoid gouging: that height must clear the surface at every
        // (x', y') within r, so:
        //   zt = max over kernel of ( cut(x', y') + sqrt(r² − d²) − r )
        // Flat endmill: adj = 0 over the whole footprint (max filter).
        //
        // TODO(perf): O(cells × kernel). Fine for ≤1024² grids with small
        // tools; a separable/EDT-based pass is the upgrade path for
        // big maps + big tools.
        // ════════════════════════════════════════════════════════
        compensate(cut, cols, rows, cellSize, radius, shape) {
            const rCells = Math.ceil(radius / cellSize);
            if (rCells <= 0) return cut;

            // Precompute kernel offsets + z adjustment
            const offs = [];
            const r2 = radius * radius;
            for (let dy = -rCells; dy <= rCells; dy++) {
                for (let dx = -rCells; dx <= rCells; dx++) {
                    const d = Math.hypot(dx, dy) * cellSize;
                    if (d > radius) continue;
                    const adj = (shape === 'ball') ? Math.sqrt(Math.max(0, r2 - d * d)) - radius : 0;
                    offs.push(dx, dy, adj);
                }
            }

            const comp = new Float32Array(cols * rows);
            for (let iy = 0; iy < rows; iy++) {
                for (let ix = 0; ix < cols; ix++) {
                    let best = -Infinity;
                    for (let k = 0; k < offs.length; k += 3) {
                        let nx = ix + offs[k];
                        let ny = iy + offs[k + 1];
                        // Edge-replicate clamp
                        if (nx < 0) nx = 0; else if (nx >= cols) nx = cols - 1;
                        if (ny < 0) ny = 0; else if (ny >= rows) ny = rows - 1;
                        const z = cut[ny * cols + nx] + offs[k + 2];
                        if (z > best) best = z;
                    }
                    comp[iy * cols + ix] = best;
                }
            }
            return comp;
        },

        // ════════════════════════════════════════════════════════
        // Stage 3 — roughing
        // ════════════════════════════════════════════════════════
        compensate(startDepth, reliefDepth, stepdown) {
            const floor = -(startDepth + reliefDepth);
            const step = Math.abs(stepdown) || 1.5;
            const layers = [];
            let z = -startDepth;
            while (z - step > floor + Z_EPS) {
                z -= step;
                layers.push(z);
            }
            layers.push(floor);
            return layers;
        },

        /**
         * One roughing layer: scanlines along the chosen axis. At each
         * sample the target Z is max(comp + stock, layerZ) — clamped
         * surface-follow, which roughs AND semi-finishes in one motion
         * (no stair-steps left on slopes).
         *
         * Span trimming: a sample only belongs to this layer if material
         * remains after the PREVIOUS layer, i.e. comp + stock < prevLayerZ.
         * Contiguous qualifying samples form independent chains (each
         * gets its own plunge/retract from the 3D macro).
         */
        rasterRoughLayer(comp, hm, axis, stepover, layerZ, prevLayerZ, stock, minSegLen) {
            const chains = [];
            const stepCells = Math.max(1, Math.round(stepover / hm.cellSize));
            const alongX = axis === 'x';
            const lineCount = alongX ? hm.rows : hm.cols;
            const sampleCount = alongX ? hm.cols : hm.rows;
            let flip = false;

            for (let li = 0; li < lineCount; li += stepCells) {
                let chain = null;
                const flush = () => {
                    if (chain && chain.length >= 2 && this.chainLength(chain) >= minSegLen) {
                        chains.push(chain);
                    }
                    chain = null;
                };

                for (let s = 0; s < sampleCount; s++) {
                    const si = flip ? (sampleCount - 1 - s) : s;
                    const ix = alongX ? si : li;
                    const iy = alongX ? li : si;
                    const surface = comp[iy * hm.cols + ix] + stock;

                    if (surface < prevLayerZ - Z_EPS) {
                        // Material remains here after the previous layer
                        const z = Math.max(surface, layerZ);
                        if (!chain) chain = [];
                        chain.push({ x: hm.cellX(ix), y: hm.cellY(iy), z });
                    } else {
                        flush();
                    }
                }
                flush();
                flip = !flip; // serpentine line order for shorter rapids
            }
            return chains;
        },

        // ════════════════════════════════════════════════════════
        // Stage 4 — finishing: one continuous serpentine chain.
        // Row→row connectors are cut along the compensated surface
        // (legitimate in-material moves), so the whole pass is a single
        // plunge + single retract.
        // ════════════════════════════════════════════════════════
        rasterFinish(comp, hm, axis, stepover, simplifyTol) {
            const stepCells = Math.max(1, Math.round(stepover / hm.cellSize));
            const alongX = axis === 'x';
            const lineCount = alongX ? hm.rows : hm.cols;
            const sampleCount = alongX ? hm.cols : hm.rows;

            const sampleZ = (ix, iy) => comp[iy * hm.cols + ix];
            const pointAt = (ix, iy) => ({ x: hm.cellX(ix), y: hm.cellY(iy), z: sampleZ(ix, iy) });

            const out = [];
            let flip = false;
            let prevLine = -1;

            for (let li = 0; li < lineCount; li += stepCells) {
                // Connector from previous line end to this line start,
                // following the surface along the fixed axis.
                if (prevLine >= 0) {
                    const fixedSample = flip ? sampleCount - 1 : 0;
                    for (let c = prevLine + 1; c <= li; c++) {
                        out.push(alongX ? pointAt(fixedSample, c) : pointAt(c, fixedSample));
                    }
                }

                // Scanline (simplified individually to keep DP recursion shallow)
                const line = [];
                for (let s = 0; s < sampleCount; s++) {
                    const si = flip ? (sampleCount - 1 - s) : s;
                    line.push(alongX ? pointAt(si, li) : pointAt(li, si));
                }
                const simplified = simplifyTol > 0 ? this.simplify3D(line, simplifyTol) : line;

                // Avoid duplicating the connector's landing point
                const start = (prevLine >= 0) ? 1 : 0;
                for (let i = start; i < simplified.length; i++) out.push(simplified[i]);

                prevLine = li;
                flip = !flip;
            }
            return out;
        },

        // ════════════════════════════════════════════════════════
        // Stage 5 — 3D Douglas-Peucker (point-to-segment distance in XYZ)
        // ════════════════════════════════════════════════════════
        simplify3D(points, tolerance) {
            if (points.length <= 2) return points;
            const keep = new Uint8Array(points.length);
            keep[0] = 1;
            keep[points.length - 1] = 1;

            // Iterative stack — scanlines can be long
            const stack = [[0, points.length - 1]];
            while (stack.length) {
                const [a, b] = stack.pop();
                if (b - a < 2) continue;

                const pa = points[a], pb = points[b];
                const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
                const segLen2 = dx * dx + dy * dy + dz * dz;

                let maxDist2 = -1, maxIdx = -1;
                for (let i = a + 1; i < b; i++) {
                    const p = points[i];
                    let d2;
                    if (segLen2 < 1e-18) {
                        const ex = p.x - pa.x, ey = p.y - pa.y, ez = p.z - pa.z;
                        d2 = ex * ex + ey * ey + ez * ez;
                    } else {
                        let t = ((p.x - pa.x) * dx + (p.y - pa.y) * dy + (p.z - pa.z) * dz) / segLen2;
                        if (t < 0) t = 0; else if (t > 1) t = 1;
                        const ex = p.x - (pa.x + t * dx);
                        const ey = p.y - (pa.y + t * dy);
                        const ez = p.z - (pa.z + t * dz);
                        d2 = ex * ex + ey * ey + ez * ez;
                    }
                    if (d2 > maxDist2) { maxDist2 = d2; maxIdx = i; }
                }

                if (maxDist2 > tolerance * tolerance) {
                    keep[maxIdx] = 1;
                    stack.push([a, maxIdx], [maxIdx, b]);
                }
            }

            const out = [];
            for (let i = 0; i < points.length; i++) {
                if (keep[i]) out.push(points[i]);
            }
            return out;
        },

        // ════════════════════════════════════════════════════════
        // Output — identical contract to VCarveGenerator output
        // ════════════════════════════════════════════════════════
        toPrimitive(points, passLabel) {
            const contour = {
                points,
                closed: false,
                isHole: false,
                nestingLevel: 0,
                parentId: null,
                arcSegments: [],
                curveIds: []
            };
            const properties = {
                isRelief: true,
                is3DContour: true,
                role: 'relief_path',
                reliefPass: passLabel, // 'roughing' | 'finishing'
                stroke: true,
                fill: false,
                strokeWidth: 0
            };
            return typeof PathPrimitive !== 'undefined'
                ? new PathPrimitive([contour], properties)
                : { type: 'path', contours: [contour], properties };
        },

        chainLength(points) {
            let l = 0;
            for (let i = 1; i < points.length; i++) {
                l += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
            }
            return l;
        },

        debug(message, data = null) {
            if (!debugState.enabled) return;
            data ? console.log(`[ReliefGenerator] ${message}`, data)
                 : console.log(`[ReliefGenerator] ${message}`);
        }
    };

    window.ReliefGenerator = ReliefGenerator;
})();
