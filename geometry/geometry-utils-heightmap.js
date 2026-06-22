/*!
 * @file        geometry/geometry-utils-heightmap.js
 * @description Heightmap grid container + on-demand builders (mesh
 *              rasterization, grayscale image) + HeightmapPrimitive
 *              wrapper for the operation pipeline.
 *
 *              The mesh is sliced HERE, at generation time, not at parse
 *              time — resolution and orientation are operation parameters
 *              the user can change between generations.
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

    // ════════════════════════════════════════════════════════════════
    // Heightmap — uniform grid of model heights (mm), normalized so
    // the lowest stored value is 0. (originX, originY) is the WORLD
    // coordinate of cell [0,0]'s center. Heights are model heights,
    // not cut depths — depth mapping is the ReliefGenerator's job.
    // ════════════════════════════════════════════════════════════════
    class Heightmap {
        constructor(cols, rows, cellSize, originX, originY) {
            this.cols = cols;
            this.rows = rows;
            this.cellSize = cellSize;
            this.originX = originX;
            this.originY = originY;
            this.data = new Float32Array(cols * rows);
            this.maxH = 0;
        }

        index(ix, iy) { return iy * this.cols + ix; }

        /** Clamped integer-cell read. */
        get(ix, iy) {
            if (ix < 0) ix = 0; else if (ix >= this.cols) ix = this.cols - 1;
            if (iy < 0) iy = 0; else if (iy >= this.rows) iy = this.rows - 1;
            return this.data[iy * this.cols + ix];
        }

        /** Bilinear world-coordinate sample (clamped at edges). */
        sample(x, y) {
            const fx = (x - this.originX) / this.cellSize;
            const fy = (y - this.originY) / this.cellSize;
            const ix = Math.floor(fx), iy = Math.floor(fy);
            const tx = fx - ix, ty = fy - iy;
            const h00 = this.get(ix, iy),     h10 = this.get(ix + 1, iy);
            const h01 = this.get(ix, iy + 1), h11 = this.get(ix + 1, iy + 1);
            return (h00 * (1 - tx) + h10 * tx) * (1 - ty)
                 + (h01 * (1 - tx) + h11 * tx) * ty;
        }

        cellX(ix) { return this.originX + ix * this.cellSize; }
        cellY(iy) { return this.originY + iy * this.cellSize; }

        worldBounds() {
            return {
                minX: this.originX - this.cellSize / 2,
                minY: this.originY - this.cellSize / 2,
                maxX: this.originX + (this.cols - 0.5) * this.cellSize,
                maxY: this.originY + (this.rows - 0.5) * this.cellSize
            };
        }

        /** Shift heights so min = 0 and refresh maxH. */
        normalize() {
            let min = Infinity, max = -Infinity;
            const d = this.data;
            for (let i = 0; i < d.length; i++) {
                if (d[i] < min) min = d[i];
                if (d[i] > max) max = d[i];
            }
            if (!Number.isFinite(min)) { min = 0; max = 0; }
            if (min !== 0) {
                for (let i = 0; i < d.length; i++) d[i] -= min;
            }
            this.maxH = max - min;
            return this;
        }
    }

    // ════════════════════════════════════════════════════════════════
    // HeightmapBuilder — slices source data into a Heightmap on demand
    // ════════════════════════════════════════════════════════════════
    const HeightmapBuilder = {

        /**
         * Rasterizes a triangle soup (top surface, max-Z per cell) into
         * a heightmap. Triangle orientation/normals are irrelevant —
         * the highest surface above each cell wins, which is exactly
         * what a 3-axis tool can reach.
         *
         * @param {Float32Array} triangles - 9 floats per triangle
         * @param {Object} options
         * @param {number} [options.cellSize]   - mm per cell. If omitted,
         *        derived from gridMaxDim.
         * @param {number} [options.gridMaxDim=1024] - cap on the longer
         *        grid axis when cellSize is auto-derived.
         * @returns {Heightmap}
         */
        fromMesh(triangles, options = {}) {
            const t0 = performance.now();
            const gridMaxDim = options.gridMaxDim || 1024;

            // Bounds
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let i = 0; i < triangles.length; i += 3) {
                const x = triangles[i], y = triangles[i + 1];
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
            const extX = maxX - minX, extY = maxY - minY;
            if (!(extX > 0) || !(extY > 0)) {
                throw new Error('Mesh has degenerate XY extent');
            }

            const cellSize = Math.max(
                options.cellSize || Math.max(extX, extY) / gridMaxDim,
                0.005
            );
            const cols = Math.max(2, Math.ceil(extX / cellSize) + 1);
            const rows = Math.max(2, Math.ceil(extY / cellSize) + 1);

            const hm = new Heightmap(cols, rows, cellSize, minX, minY);
            hm.data.fill(-Infinity);
            const data = hm.data;

            // Rasterize each triangle: barycentric coverage of cell centers,
            // interpolated Z, keep max per cell.
            for (let t = 0; t < triangles.length; t += 9) {
                const ax = triangles[t],     ay = triangles[t + 1], az = triangles[t + 2];
                const bx = triangles[t + 3], by = triangles[t + 4], bz = triangles[t + 5];
                const cx = triangles[t + 6], cy = triangles[t + 7], cz = triangles[t + 8];

                const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
                if (Math.abs(denom) < 1e-12) continue; // degenerate in XY (vertical wall)

                const txMin = Math.min(ax, bx, cx), txMax = Math.max(ax, bx, cx);
                const tyMin = Math.min(ay, by, cy), tyMax = Math.max(ay, by, cy);

                const ix0 = Math.max(0, Math.floor((txMin - minX) / cellSize));
                const ix1 = Math.min(cols - 1, Math.ceil((txMax - minX) / cellSize));
                const iy0 = Math.max(0, Math.floor((tyMin - minY) / cellSize));
                const iy1 = Math.min(rows - 1, Math.ceil((tyMax - minY) / cellSize));

                const invDenom = 1 / denom;
                const EPS = -1e-6; // slight tolerance so shared edges have no seam gaps

                for (let iy = iy0; iy <= iy1; iy++) {
                    const py = minY + iy * cellSize;
                    const rowBase = iy * cols;
                    for (let ix = ix0; ix <= ix1; ix++) {
                        const px = minX + ix * cellSize;
                        const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) * invDenom;
                        if (w0 < EPS) continue;
                        const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) * invDenom;
                        if (w1 < EPS) continue;
                        const w2 = 1 - w0 - w1;
                        if (w2 < EPS) continue;
                        const z = w0 * az + w1 * bz + w2 * cz;
                        const idx = rowBase + ix;
                        if (z > data[idx]) data[idx] = z;
                    }
                }
            }

            // Uncovered cells (outside the model footprint) → base plane.
            // First find the real minimum among covered cells.
            let coveredMin = Infinity;
            for (let i = 0; i < data.length; i++) {
                if (data[i] !== -Infinity && data[i] < coveredMin) coveredMin = data[i];
            }
            if (!Number.isFinite(coveredMin)) coveredMin = 0;
            let uncovered = 0;
            for (let i = 0; i < data.length; i++) {
                if (data[i] === -Infinity) { data[i] = coveredMin; uncovered++; }
            }

            hm.normalize();

            if (debugState.enabled) {
                console.log(`[HeightmapBuilder] Mesh → ${cols}×${rows} grid @ ${cellSize.toFixed(3)}mm ` +
                    `(${uncovered} base cells, maxH=${hm.maxH.toFixed(3)}mm) in ` +
                    `${(performance.now() - t0).toFixed(0)}ms`);
            }
            return hm;
        },

        /**
         * Builds a heightmap from a grayscale image (canvas ImageData).
         * White = high, black = low by convention (invert in the
         * ReliefGenerator options, not here).
         *
         * @param {ImageData} imageData
         * @param {Object} options
         * @param {number} options.widthMM      - physical width to map onto
         * @param {number} [options.heightScale=1] - model height (mm) at pure white
         * @param {boolean} [options.flipY=true]   - image rows are top-down;
         *        world Y is bottom-up
         * @returns {Heightmap}
         */
        fromImageData(imageData, options = {}) {
            const { widthMM, heightScale = 1, flipY = true } = options;
            if (!(widthMM > 0)) throw new Error('fromImageData requires widthMM > 0');

            const cols = imageData.width;
            const rows = imageData.height;
            const cellSize = widthMM / cols;
            const hm = new Heightmap(cols, rows, cellSize, 0, 0);
            const px = imageData.data;

            for (let iy = 0; iy < rows; iy++) {
                const srcRow = flipY ? (rows - 1 - iy) : iy;
                for (let ix = 0; ix < cols; ix++) {
                    const p = (srcRow * cols + ix) * 4;
                    // Rec.601 luminance
                    const lum = (0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2]) / 255;
                    hm.data[iy * cols + ix] = lum * heightScale;
                }
            }
            hm.normalize();

            if (debugState.enabled) {
                console.log(`[HeightmapBuilder] Image → ${cols}×${rows} grid @ ${cellSize.toFixed(3)}mm`);
            }
            return hm;
        }
    };

    // ════════════════════════════════════════════════════════════════
    // HeightmapPrimitive — operation-pipeline wrapper. Gives the
    // heightmap a getBounds() so validateAndOptimizePrimitives,
    // operation.bounds, and zoom-fit work. Rendering support is a
    // separate (renderer) concern — until added, the renderer should
    // skip type 'heightmap' primitives gracefully.
    // ════════════════════════════════════════════════════════════════
    const Base = (typeof RenderPrimitive !== 'undefined') ? RenderPrimitive : class {
        constructor(type, properties = {}) {
            this.type = type;
            this.properties = properties;
            this.bounds = null;
            this.id = `prim_hm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
            this.geometricContext = { originalType: type, isAnalytic: false, metadata: {} };
        }
        getBounds() { if (!this.bounds) this.calculateBounds(); return this.bounds; }
        getCenter() {
            const b = this.getBounds();
            return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
        }
        canOffsetAnalytically() { return false; }
        getGeometricMetadata() { return this.geometricContext; }
    };

    class HeightmapPrimitive extends Base {
        constructor(heightmap, properties = {}) {
            super('heightmap', {
                role: 'relief_heightmap',
                fill: false,
                stroke: true,
                strokeWidth: 0,
                ...properties
            });
            this.heightmap = heightmap;
        }

        calculateBounds() {
            this.bounds = this.heightmap.worldBounds();
        }
    }

    window.Heightmap = Heightmap;
    window.HeightmapBuilder = HeightmapBuilder;
    window.HeightmapPrimitive = HeightmapPrimitive;
})();
