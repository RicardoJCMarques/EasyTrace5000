/*!
 * @file        export/laser-image-exporter.js
 * @description Laser image processor
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

    /**
     * Generates SVG or PNG files from laser pipeline geometry.
     *
     * Expected layer structure:
     * {
     *   operationId, operationType, layerName,
     *   baseColor: '#ff0000',       // user-chosen color from export modal
     *   strokeWidth: 0.05,          // laser spot size in mm (used for PNG min-width only)
     *   passes: [{
     *     passIndex: 1,
     *     type: 'offset' | 'filled' | 'hatch' | 'drill',
     *     primitives: PathPrimitive[] | CirclePrimitive[],
     *     metadata: { isHatch, angle, strategy, ... }
     *   }]
     * }
     */
    class LaserImageExporter {
        constructor() {
            this.PRECISION = 4;
            this.HAIRLINE_STROKE = 0.01; // mm — standard laser hairline
            this.MAX_CANVAS_DIM = 16000;
            this.FUSION_TOLERANCE = 0.001;
        }

        async generate(layers, options) {
            // Fuse colinear hatch segments across layers before export
            this._fuseColinearSegments(layers);

            // Build user-transform matrix (rotation, mirror, origin — no bounds shift or Y-flip)
            const userMat = this._buildUserTransformMatrix(options.transforms);

            // Apply userMat to all geometry to find the TRUE output bounds.
            // This prevents the white-PNG / clipped-SVG bug where rotated or mirrored geometry extends beyond the raw board bounds used for the viewBox.
            const trueBounds = this._computeTransformedBounds(layers, userMat);

            // Build full output matrix (userMat + bounds-shift + Y-flip) using true bounds
            const padding = options.padding || 0;
            const output = this._buildOutputMatrix(userMat, trueBounds, padding);

            // Package pre-computed values for the generators
            const renderCtx = {
                mat: output.mat,
                widthMm: output.widthMm,
                heightMm: output.heightMm,
                padding: padding
            };

            if (options.format === 'png') {
                return this._generatePNG(layers, options, renderCtx);
            }
            return this._generateSVG(layers, options, renderCtx);
        }

        /**
         * Builds ONLY the user-space transform: rotation → mirror → origin.
         * No bounds-shift or Y-flip — those depend on the true post-transform bounds.
         */
        _buildUserTransformMatrix(transforms) {
            let m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

            if (!transforms) return m;

            // Rotation around rotation center
            if (transforms.rotation && transforms.rotation !== 0) {
                const rad = transforms.rotation * Math.PI / 180;
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);
                const cx = transforms.rotationCenter?.x || 0;
                const cy = transforms.rotationCenter?.y || 0;
                m = this._matMul(m, {
                    a: cos, b: sin, c: -sin, d: cos,
                    e: cx * (1 - cos) + cy * sin,
                    f: cy * (1 - cos) - cx * sin
                });
            }

            // Mirror around board center
            if (transforms.mirrorX || transforms.mirrorY) {
                const cx = transforms.mirrorCenter?.x || 0;
                const cy = transforms.mirrorCenter?.y || 0;
                const sx = transforms.mirrorX ? -1 : 1;
                const sy = transforms.mirrorY ? -1 : 1;
                m = this._matMul(m, {
                    a: sx, b: 0, c: 0, d: sy,
                    e: cx * (1 - sx),
                    f: cy * (1 - sy)
                });
            }

            // Origin offset
            if (transforms.origin && (transforms.origin.x !== 0 || transforms.origin.y !== 0)) {
                m = this._matMul(m, {
                    a: 1, b: 0, c: 0, d: 1,
                    e: transforms.origin.x,
                    f: transforms.origin.y
                });
            }

            return m;
        }

        /**
         * Scans all geometry through the user-transform matrix to find the true bounding box of the output.
         */
        _computeTransformedBounds(layers, userMat) {
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;

            const expand = (x, y) => {
                const p = this._tx(x, y, userMat);
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
            };

            for (const layer of layers) {
                for (const pass of layer.passes) {
                    if (!pass.primitives) continue;
                    for (const prim of pass.primitives) {
                        // Circles: expand by center ± radius (rotation/mirror preserve distances)
                        if (prim.type === 'circle' && prim.center && prim.radius) {
                            const r = prim.radius;
                            expand(prim.center.x - r, prim.center.y - r);
                            expand(prim.center.x + r, prim.center.y + r);
                            expand(prim.center.x - r, prim.center.y + r);
                            expand(prim.center.x + r, prim.center.y - r);
                        }
                        // Paths: expand by every vertex
                        if (prim.contours) {
                            for (const c of prim.contours) {
                                if (!c.points) continue;
                                for (const pt of c.points) {
                                    expand(pt.x, pt.y);
                                }
                            }
                        }
                    }
                }
            }

            if (!isFinite(minX)) {
                return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
            }
            return { minX, minY, maxX, maxY };
        }

        /**
         * Builds the final output matrix by composing: boundsShift (using TRUE post-transform bounds) → Y-flip on top of the pre-built user-transform matrix.
         */
        _buildOutputMatrix(userMat, trueBounds, padding) {
            const widthMm  = (trueBounds.maxX - trueBounds.minX) + (padding * 2);
            const heightMm = (trueBounds.maxY - trueBounds.minY) + (padding * 2);

            // Start from the user matrix
            let m = userMat;

            // Bounds shift using TRUE bounds → geometry min lands at (padding, padding)
            m = this._matMul({
                a: 1, b: 0, c: 0, d: 1,
                e: -trueBounds.minX + padding,
                f: -trueBounds.minY + padding
            }, m);

            // Y-flip: SVG/Canvas Y-down, CAM Y-up → y' = heightMm - y
            m = this._matMul({
                a: 1, b: 0, c: 0, d: -1,
                e: 0, f: heightMm
            }, m);

            return { mat: m, widthMm, heightMm };
        }

        /**
         * Multiplies two affine matrices: result = m1 ∘ m2 (m1 applied after m2 to a point)
         */
        _matMul(m1, m2) {
            return {
                a: m1.a * m2.a + m1.c * m2.b,
                b: m1.b * m2.a + m1.d * m2.b,
                c: m1.a * m2.c + m1.c * m2.d,
                d: m1.b * m2.c + m1.d * m2.d,
                e: m1.a * m2.e + m1.c * m2.f + m1.e,
                f: m1.b * m2.e + m1.d * m2.f + m1.f
            };
        }

        /** Applies pre-computed affine matrix to a point. */
        _tx(x, y, m) {
            return {
                x: m.a * x + m.c * y + m.e,
                y: m.b * x + m.d * y + m.f
            };
        }

        /**
         * Builds a lookup map from point index → arc segment for a contour.
         * Falls back to primitive-level arcSegments for single-contour paths.
         */
        _buildArcMap(contour, primArcSegments) {
            const map = new Map();
            const arcs = (contour.arcSegments && contour.arcSegments.length > 0)
                ? contour.arcSegments
                : (primArcSegments || []);
            for (const arc of arcs) {
                if (arc.startIndex != null && arc.endIndex != null &&
                    arc.center && typeof arc.radius === 'number' && arc.radius > 0) {
                    map.set(arc.startIndex, arc);
                }
            }
            return map;
        }

        // ────────────────────────────────────────────────────────────
        // SVG Generation
        // ────────────────────────────────────────────────────────────

        async _generateSVG(layers, options, renderCtx) {
            const { mat, widthMm, heightMm } = renderCtx;
            const p = this.PRECISION;

            const lines = [];
            lines.push(`<?xml version="1.0" encoding="UTF-8" standalone="no"?>`);
            lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm.toFixed(p)}mm" height="${heightMm.toFixed(p)}mm" viewBox="0 0 ${widthMm.toFixed(p)} ${heightMm.toFixed(p)}" version="1.1">`);

            // Hairline enforcement for browser display.
            // Laser software (LightBurn, RDWorks) reads XML attributes directly and ignores CSS, so the physical kerf value is preserved.
            lines.push(`<style>path,circle,line{vector-effect:non-scaling-stroke;stroke-width:1px;-inkscape-stroke:hairline}</style>`);

            // Flatten hierarchy when single layer
            const useFlatHierarchy = layers.length === 1;

            if (!useFlatHierarchy) {
                lines.push(`<g id="EasyTrace_Export">`);
            }

            for (const layer of layers) {
                const layerGroupId = useFlatHierarchy ? 'EasyTrace_Export' : `Layer_${this._sanitizeId(layer.layerName)}`;
                const layerAttrs = `id="${layerGroupId}" stroke-linecap="round" stroke-linejoin="round"`;

                if (useFlatHierarchy) {
                    lines.push(`<g ${layerAttrs}>`);
                } else {
                    lines.push(`  <g ${layerAttrs}>`);
                }

                const indent = useFlatHierarchy ? '  ' : '    ';
                const innerIndent = useFlatHierarchy ? '    ' : '      ';

                for (let i = 0; i < layer.passes.length; i++) {
                    const pass = layer.passes[i];
                    if (!pass.primitives || pass.primitives.length === 0) continue;

                    const isFilled = pass.type === 'filled';
                    const color = layer.baseColor;
                    const passId = this._buildPassId(layer.layerName, pass, i);

                    if (isFilled) {
                        lines.push(`${indent}<g id="${passId}" fill="${color}" stroke="none">`);
                    } else {
                        lines.push(`${indent}<g id="${passId}" fill="none" stroke="${color}" stroke-width="${this.HAIRLINE_STROKE}">`);
                    }

                    // Batch path data with pre-transformed coordinates
                    const pathData = this._buildTransformedPathData(pass.primitives, mat);
                    if (pathData) {
                        const fillRule = isFilled ? ' fill-rule="evenodd"' : '';
                        lines.push(`${innerIndent}<path d="${pathData}"${fillRule}/>`);
                    }

                    // Circle primitives
                    this._appendTransformedCircles(lines, pass.primitives, mat, innerIndent);

                    lines.push(`${indent}</g>`);
                }

                if (useFlatHierarchy) {
                    lines.push(`</g>`);
                } else {
                    lines.push(`  </g>`);
                }
            }

            if (!useFlatHierarchy) {
                lines.push(`</g>`);
            }

            lines.push(`</svg>`);

            const blob = new Blob([lines.join('\n')], { type: 'image/svg+xml;charset=utf-8' });
            return { blob };
        }

        // ────────────────────────────────────────────────────────────
        // PNG Generation
        // ────────────────────────────────────────────────────────────

        async _generatePNG(layers, options, renderCtx) {
            const { mat, widthMm, heightMm } = renderCtx;
            const dpi = options.dpi || 1000;

            const pxPerMm = dpi / 25.4;

            let pxW = Math.ceil(widthMm * pxPerMm);
            let pxH = Math.ceil(heightMm * pxPerMm);

            // Safety clamp
            if (pxW > this.MAX_CANVAS_DIM || pxH > this.MAX_CANVAS_DIM) {
                const s = Math.min(this.MAX_CANVAS_DIM / pxW, this.MAX_CANVAS_DIM / pxH);
                pxW = Math.floor(pxW * s);
                pxH = Math.floor(pxH * s);
                console.warn(`[LaserImageExporter] Canvas clamped to ${pxW}x${pxH}. Effective DPI reduced.`);
            }

            const scaleX = pxW / widthMm;
            const scaleY = pxH / heightMm;

            const canvas = document.createElement('canvas');
            canvas.width = pxW;
            canvas.height = pxH;
            const ctx = canvas.getContext('2d');

            // White background
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, pxW, pxH);

            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            // Minimum line width: 1px in device space (sub-pixel protection)
            const minLineWidthMm = 1 / Math.min(scaleX, scaleY);

            for (const layer of layers) {
                // Use spot size for PNG raster strokes, but at least 1px
                const lineWidthMm = Math.max(layer.strokeWidth, minLineWidthMm);

                for (let i = 0; i < layer.passes.length; i++) {
                    const pass = layer.passes[i];
                    if (!pass.primitives || pass.primitives.length === 0) continue;

                    const isFilled = pass.type === 'filled';
                    const color = layer.baseColor;

                    ctx.beginPath();
                    this._traceTransformedPrimitives(ctx, pass.primitives, mat, scaleX, scaleY);

                    if (isFilled) {
                        ctx.fillStyle = color;
                        ctx.fill('evenodd');
                    } else {
                        ctx.lineWidth = lineWidthMm * Math.min(scaleX, scaleY);
                        ctx.strokeStyle = color;
                        ctx.stroke();
                    }
                }
            }

            return new Promise((resolve, reject) => {
                canvas.toBlob(blob => {
                    // Force cleanup
                    ctx.clearRect(0, 0, pxW, pxH);
                    canvas.width = 0;
                    canvas.height = 0;

                    if (blob) resolve({ blob });
                    else reject(new Error('Canvas toBlob returned null'));
                }, 'image/png');
            });
        }

        // ────────────────────────────────────────────────────────────
        // Pre-transformed primitive rendering
        // ────────────────────────────────────────────────────────────

        /**
         * Builds SVG path 'd' attribute with all coordinates pre-transformed.
         */
        _buildTransformedPathData(primitives, mat) {
            const chunks = [];
            const p = this.PRECISION;

            // Determinant < 0 means the transform includes a reflection (Y-flip, mirror), which reverses the perceived arc sweep direction.
            const det = mat.a * mat.d - mat.b * mat.c;
            const scaleFactor = Math.sqrt(mat.a * mat.a + mat.b * mat.b);

            for (const prim of primitives) {
                if (prim.type === 'circle') continue;
                if (!prim.contours || prim.contours.length === 0) continue;

                for (const contour of prim.contours) {
                    const pts = contour.points;
                    if (!pts || pts.length < 2) continue;

                    const arcMap = this._buildArcMap(contour, prim.arcSegments);

                    const p0 = this._tx(pts[0].x, pts[0].y, mat);
                    chunks.push(`M${p0.x.toFixed(p)},${p0.y.toFixed(p)}`);

                    let i = 1;
                    while (i < pts.length) {
                        const arc = arcMap.get(i - 1);

                        if (arc && arc.endIndex < pts.length && arc.endIndex > i - 1) {
                            const r = arc.radius * scaleFactor;
                            const endIdx = arc.endIndex;
                            const endPt = this._tx(pts[endIdx].x, pts[endIdx].y, mat);

                            // Use sweepAngle if available (avoids wrap-around ballooning)
                            let span = arc.sweepAngle;
                            if (span === undefined || span === null) {
                                span = arc.endAngle - arc.startAngle;
                                if (arc.clockwise && span > 0) span -= 2 * Math.PI;
                                if (!arc.clockwise && span < 0) span += 2 * Math.PI;
                            }

                            const largeArc = Math.abs(span) > Math.PI ? 1 : 0;

                            // SVG sweep=1 is clockwise in screen coords (Y-down).
                            // A negative determinant (reflection) flips perceived direction.
                            let sweep = arc.clockwise ? 1 : 0;
                            if (det < 0) sweep = 1 - sweep;

                            // Full circle check based on angular span, NOT distance.
                            // Distance checks falsely trigger on extremely short arcs.
                            if (Math.abs(span) >= Math.PI * 1.99) {
                                const tc = this._tx(arc.center.x, arc.center.y, mat);
                                const startPt = this._tx(pts[i - 1].x, pts[i - 1].y, mat);
                                const mx = 2 * tc.x - startPt.x;
                                const my = 2 * tc.y - startPt.y;
                                chunks.push(`A${r.toFixed(p)},${r.toFixed(p)} 0 0 ${sweep} ${mx.toFixed(p)},${my.toFixed(p)}`);
                                chunks.push(`A${r.toFixed(p)},${r.toFixed(p)} 0 0 ${sweep} ${endPt.x.toFixed(p)},${endPt.y.toFixed(p)}`);
                            } else {
                                chunks.push(`A${r.toFixed(p)},${r.toFixed(p)} 0 ${largeArc} ${sweep} ${endPt.x.toFixed(p)},${endPt.y.toFixed(p)}`);
                            }

                            i = endIdx + 1;
                        } else {
                            const pt = this._tx(pts[i].x, pts[i].y, mat);
                            chunks.push(`L${pt.x.toFixed(p)},${pt.y.toFixed(p)}`);
                            i++;
                        }
                    }

                    const isClosed = prim.properties?.closed !== false && pts.length > 2;
                    if (isClosed) chunks.push('Z');
                }
            }

            return chunks.length > 0 ? chunks.join(' ') : null;
        }

        /**
         * Appends pre-transformed <circle> elements.
         * Note: affine transforms can turn circles into ellipses (under non-uniform scale/mirror).
         * For uniform scale + rotation + translation, radius is preserved.
         * If mirror is active on one axis only, output an ellipse check.
         */
        _appendTransformedCircles(lines, primitives, mat, indent) {
            const p = this.PRECISION;

            // Detect if transform includes non-uniform scaling (mirror on one axis) by checking if the scale factors differ
            const sx = Math.sqrt(mat.a * mat.a + mat.b * mat.b);
            const sy = Math.sqrt(mat.c * mat.c + mat.d * mat.d);
            const isUniform = Math.abs(sx - sy) < 0.0001;

            for (const prim of primitives) {
                if (prim.type !== 'circle' || !prim.center || !prim.radius) continue;

                const c = this._tx(prim.center.x, prim.center.y, mat);

                if (isUniform) {
                    const r = prim.radius * sx;
                    lines.push(`${indent}<circle cx="${c.x.toFixed(p)}" cy="${c.y.toFixed(p)}" r="${r.toFixed(p)}"/>`);
                } else {
                    // Non-uniform: output as circle with average scale (acceptable for laser)
                    const r = prim.radius * ((sx + sy) / 2);
                    lines.push(`${indent}<circle cx="${c.x.toFixed(p)}" cy="${c.y.toFixed(p)}" r="${r.toFixed(p)}"/>`);
                }
            }
        }

        /**
         * Traces pre-transformed primitives into a Canvas path.
         */
        _traceTransformedPrimitives(ctx, primitives, mat, scaleX, scaleY) {
            const det = mat.a * mat.d - mat.b * mat.c;
            const scaleFactor = Math.sqrt(mat.a * mat.a + mat.b * mat.b);
            const rScale = Math.min(scaleX, scaleY);

            for (const prim of primitives) {
                if (prim.type === 'circle' && prim.center && prim.radius) {
                    const c = this._tx(prim.center.x, prim.center.y, mat);
                    const rPx = prim.radius * scaleFactor * rScale;
                    const cx = c.x * scaleX;
                    const cy = c.y * scaleY;
                    ctx.moveTo(cx + rPx, cy);
                    ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
                    continue;
                }

                if (!prim.contours || prim.contours.length === 0) continue;

                for (const contour of prim.contours) {
                    const pts = contour.points;
                    if (!pts || pts.length < 2) continue;

                    const arcMap = this._buildArcMap(contour, prim.arcSegments);

                    const p0 = this._tx(pts[0].x, pts[0].y, mat);
                    ctx.moveTo(p0.x * scaleX, p0.y * scaleY);

                    let i = 1;
                    while (i < pts.length) {
                        const arc = arcMap.get(i - 1);

                        if (arc && arc.endIndex < pts.length && arc.endIndex > i - 1) {
                            // Transform center and compute pixel-space values
                            const tc = this._tx(arc.center.x, arc.center.y, mat);
                            const rPx = arc.radius * scaleFactor * rScale;
                            const tcx = tc.x * scaleX;
                            const tcy = tc.y * scaleY;

                            // Compute angles in transformed space from actual points
                            const tStart = this._tx(pts[i - 1].x, pts[i - 1].y, mat);
                            const tEnd = this._tx(pts[arc.endIndex].x, pts[arc.endIndex].y, mat);
                            const sa = Math.atan2(tStart.y * scaleY - tcy, tStart.x * scaleX - tcx);
                            const ea = Math.atan2(tEnd.y * scaleY - tcy, tEnd.x * scaleX - tcx);

                            // Canvas arc: counterclockwise param
                            // Original CW → ccw=false. Reflection flips.
                            let ccw = !arc.clockwise;
                            if (det < 0) ccw = !ccw;

                            // Use sweepAngle if available (avoids wrap-around ballooning)
                            let span = arc.sweepAngle;
                            if (span === undefined || span === null) {
                                span = arc.endAngle - arc.startAngle;
                                if (arc.clockwise && span > 0) span -= 2 * Math.PI;
                                if (!arc.clockwise && span < 0) span += 2 * Math.PI;
                            }

                            // Full circle check based on angular span
                            if (Math.abs(span) >= Math.PI * 1.99) {
                                ctx.arc(tcx, tcy, rPx, sa, sa + 2 * Math.PI, ccw);
                            } else {
                                ctx.arc(tcx, tcy, rPx, sa, ea, ccw);
                            }

                            i = arc.endIndex + 1;
                        } else {
                            const pt = this._tx(pts[i].x, pts[i].y, mat);
                            ctx.lineTo(pt.x * scaleX, pt.y * scaleY);
                            i++;
                        }
                    }

                    if (prim.properties?.closed !== false && pts.length > 2) {
                        ctx.closePath();
                    }
                }
            }
        }

        // ────────────────────────────────────────────────────────────
        // Colinear Hatch Segment Fusion
        // ────────────────────────────────────────────────────────────

        /**
         * Merges colinear/overlapping hatch line segments across all layers.
         * Only operates on hatch passes. Modifies passes in-place.
         */
        _fuseColinearSegments(layers) {
            const tol = this.FUSION_TOLERANCE;
            const scanLines = new Map();

            for (let li = 0; li < layers.length; li++) {
                const layer = layers[li];
                for (let pi = 0; pi < layer.passes.length; pi++) {
                    const pass = layer.passes[pi];
                    if (!pass.metadata?.isHatch) continue;
                    if (!pass.primitives || pass.primitives.length === 0) continue;

                    const angle = pass.metadata.angle || 0;
                    const rad = -angle * Math.PI / 180;
                    const cosA = Math.cos(rad);
                    const sinA = Math.sin(rad);

                    for (let si = 0; si < pass.primitives.length; si++) {
                        const prim = pass.primitives[si];
                        if (!prim.contours || prim.contours.length === 0) continue;

                        const pts = prim.contours[0].points;
                        if (!pts || pts.length !== 2) continue;

                        const p0 = { x: pts[0].x * cosA - pts[0].y * sinA, y: pts[0].x * sinA + pts[0].y * cosA };
                        const p1 = { x: pts[1].x * cosA - pts[1].y * sinA, y: pts[1].x * sinA + pts[1].y * cosA };

                        const perpDist = Math.round(p0.y / tol) * tol;
                        const key = `${angle}_${perpDist.toFixed(4)}`;

                        const xMin = Math.min(p0.x, p1.x);
                        const xMax = Math.max(p0.x, p1.x);

                        if (!scanLines.has(key)) scanLines.set(key, []);
                        scanLines.get(key).push({
                            xMin, xMax, perpDist,
                            angle, cosA, sinA,
                            layerIdx: li, passIdx: pi, primIdx: si
                        });
                    }
                }
            }

            const fusedByPass = new Map();
            const newPrimitivesByPass = new Map();

            for (const [key, segments] of scanLines) {
                if (segments.length < 2) continue;

                segments.sort((a, b) => a.xMin - b.xMin);

                const merged = [];
                let current = { xMin: segments[0].xMin, xMax: segments[0].xMax };
                const consumed = [segments[0]];

                for (let i = 1; i < segments.length; i++) {
                    const seg = segments[i];
                    if (seg.xMin <= current.xMax + tol) {
                        current.xMax = Math.max(current.xMax, seg.xMax);
                        consumed.push(seg);
                    } else {
                        if (consumed.length > 1) {
                            merged.push({ interval: { ...current }, sources: [...consumed] });
                        }
                        current = { xMin: seg.xMin, xMax: seg.xMax };
                        consumed.length = 0;
                        consumed.push(seg);
                    }
                }
                if (consumed.length > 1) {
                    merged.push({ interval: { ...current }, sources: [...consumed] });
                }

                for (const merge of merged) {
                    const ref = merge.sources[0];
                    const cosR = Math.cos(ref.angle * Math.PI / 180);
                    const sinR = Math.sin(ref.angle * Math.PI / 180);

                    const rotX0 = merge.interval.xMin;
                    const rotX1 = merge.interval.xMax;
                    const rotY = ref.perpDist;

                    const worldP0 = { x: rotX0 * cosR - rotY * sinR, y: rotX0 * sinR + rotY * cosR };
                    const worldP1 = { x: rotX1 * cosR - rotY * sinR, y: rotX1 * sinR + rotY * cosR };

                    const targetKey = `${ref.layerIdx}_${ref.passIdx}`;

                    for (const src of merge.sources) {
                        const srcKey = `${src.layerIdx}_${src.passIdx}`;
                        if (!fusedByPass.has(srcKey)) fusedByPass.set(srcKey, new Set());
                        fusedByPass.get(srcKey).add(src.primIdx);
                    }

                    if (!newPrimitivesByPass.has(targetKey)) newPrimitivesByPass.set(targetKey, []);
                    newPrimitivesByPass.get(targetKey).push(this._createLinePrimitive(worldP0, worldP1, {
                        isHatch: true, isFused: true,
                        fusedCount: merge.sources.length,
                        angle: ref.angle, closed: false
                    }));
                }
            }

            if (fusedByPass.size === 0) return;

            let totalRemoved = 0, totalAdded = 0;

            for (const [passKey, removeSet] of fusedByPass) {
                const [li, pi] = passKey.split('_').map(Number);
                const pass = layers[li].passes[pi];

                const originalCount = pass.primitives.length;
                pass.primitives = pass.primitives.filter((_, idx) => !removeSet.has(idx));
                totalRemoved += originalCount - pass.primitives.length;

                const newPrims = newPrimitivesByPass.get(passKey);
                if (newPrims) {
                    pass.primitives.push(...newPrims);
                    totalAdded += newPrims.length;
                }
            }

            if (totalRemoved > 0) {
                console.log(`[LaserImageExporter] Hatch fusion: removed ${totalRemoved}, added ${totalAdded} (saved ${totalRemoved - totalAdded} elements)`);
            }
        }

        _createLinePrimitive(p0, p1, properties) {
            if (typeof PathPrimitive !== 'undefined') {
                return new PathPrimitive([{
                    points: [p0, p1], isHole: false,
                    nestingLevel: 0, parentId: null,
                    arcSegments: [], curveIds: []
                }], properties);
            }
            return {
                type: 'path',
                contours: [{ points: [p0, p1], isHole: false }],
                properties: properties
            };
        }

        // ────────────────────────────────────────────────────────────
        // Naming helpers
        // ────────────────────────────────────────────────────────────

        _buildPassId(layerName, pass, index) {
            const safe = this._sanitizeId(layerName);
            if (pass.metadata?.isHatch && pass.metadata?.angle !== undefined) {
                return `${safe}_Hatch_${pass.metadata.angle}deg`;
            }
            if (pass.type === 'filled') return `${safe}_Filled`;
            return `${safe}_Pass_${index + 1}`;
        }

        _sanitizeId(str) {
            return (str || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
        }
    }

    window.LaserImageExporter = LaserImageExporter;
})();