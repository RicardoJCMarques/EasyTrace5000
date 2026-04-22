/*!
 * @file        renderer/renderer-layer.js
 * @description Manages canvas layers
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

    class LayerRenderer {
        constructor(canvasId, core) {
            this.canvas = document.getElementById(canvasId);
            if (!this.canvas) {
                throw new Error(`Canvas element '${canvasId}' not found`);
            }

            this.core = new RendererCore(this.canvas);
            this.pcbCore = core;

            this.primitiveRenderer = new PrimitiveRenderer(this.core);
            this.overlayRenderer = new OverlayRenderer(this.core);
            this.interactionHandler = new InteractionHandler(this.core, this);

            this.debugPrimitives = [];
            this.debugPrimitivesScreen = [];
            this._renderQueued = false;
            this._renderHandle = null;

            this.core.resizeCanvas();
            this.core.zoomFit(); // Enforce default origin placement in canvas
            this.interactionHandler.init();
        }

        // Property accessors
        get layers() { return this.core.layers; }
        get options() { return this.core.options; }
        get viewScale() { return this.core.viewScale; }
        get viewOffset() { return this.core.viewOffset; }
        get ctx() { return this.core.ctx; }
        get bounds() { return this.core.bounds; }
        get renderStats() { return this.core.renderStats; }

        setOptions(options) {
            this.core.setOptions(options);
            this.render();
        }

        setCoordinateSystem(coordinateSystem) {
            this.core.setCoordinateSystem(coordinateSystem);
        }

        addLayer(name, primitives, options = {}) {
            this.core.addLayer(name, primitives, options);
        }

        removeLayer(name) {
            this.core.removeLayer(name);
        }

        clearLayers() {
            this.core.clearLayers();
        }

        // ========================================================================
        // Main Render Entry Point
        // ========================================================================

        render() {
            if (this._renderQueued) return;
            this._renderQueued = true;
            this._renderHandle = requestAnimationFrame(() => {
                this._renderQueued = false;
                this._actualRender();
            });
        }

        _actualRender() {
            const startTime = this.core.beginRender();
            this.core.clearCanvas();
            this.debugPrimitives = [];
            this.core.setupTransform();
            this.ctx.save();

            // Apply transforms in order: Mirror → Rotation
            const hasMirror = this.core.mirrorX || this.core.mirrorY;
            const hasRotation = this.core.currentRotation !== 0 && this.core.rotationCenter;

            if (hasMirror) {
                const mc = this.core.mirrorCenter;
                this.ctx.translate(mc.x, mc.y);
                this.ctx.scale(
                    this.core.mirrorX ? -1 : 1,
                    this.core.mirrorY ? -1 : 1
                );
                this.ctx.translate(-mc.x, -mc.y);
            }

            if (hasRotation) {
                const isMirrored = (this.core.mirrorX ? 1 : 0) ^ (this.core.mirrorY ? 1 : 0);
                const effectiveAngle = isMirrored ? -this.core.currentRotation : this.core.currentRotation;

                this.ctx.translate(this.core.rotationCenter.x, this.core.rotationCenter.y);
                this.ctx.rotate((effectiveAngle * Math.PI) / 180);
                this.ctx.translate(-this.core.rotationCenter.x, -this.core.rotationCenter.y);
            }

            // Render geometry using hybrid approach
            if (this.options.showWireframe) {
                this._renderWireframeMode();
            } else {
                this._renderVisibleLayers();
            }

            // Debug overlay
            if ((this.options.debugPoints || this.options.debugArcs) && 
                this.debugPrimitives.length > 0) {
                this._renderDebugOverlayWorld();
            }

            if (this.options.showPreprocessed && this.pcbCore?.operations) {
                this.ctx.save();
                this.ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
                const fc = this.core.frameCache;
                const uiScale = this.core.devicePixelRatio || 1;
                this.ctx.lineWidth = Math.max(1.0 * fc.invScale, fc.minWorldWidth) * uiScale;

                for (const op of this.pcbCore.operations) {
                    if (op._debugStrokes) {
                        for (const stroke of op._debugStrokes) {
                            this.primitiveRenderer._drawPrimitivePath(stroke);
                            this.ctx.stroke();
                        }
                    }
                }
                this.ctx.restore();
            }

            this.ctx.restore();

            // World-space overlays
            if (this.options.showGrid) this.overlayRenderer.renderGrid();
            if (this.options.showBounds) this.overlayRenderer.renderBounds();
            if (this.options.showOrigin) this.overlayRenderer.renderOrigin();

            // Screen-space overlays
            this.core.resetTransform();
            if (this.options.showRulers) this.overlayRenderer.renderRulers();
            this.overlayRenderer.renderScaleIndicator();
            if (this.options.showStats) this.overlayRenderer.renderStats();

            this.core.endRender(startTime);
        }

        // ========================================================================
        // Hybrid Rendering Pipeline
        // ========================================================================

        _renderVisibleLayers() {
            const orderedLayers = this._getOrderedLayers();

            // Per-type copper source layer counts for multi-file transparency
            const copperSourceCounts = { isolation: 0, clearing: 0 };
            for (const layer of orderedLayers) {
                if (!layer.visible) continue;
                const isSource = !layer.isOffset && !layer.isPreview && layer.type !== 'offset' && layer.type !== 'preview' && layer.type !== 'fused';
                if (isSource && copperSourceCounts.hasOwnProperty(layer.type)) {
                    copperSourceCounts[layer.type]++;
                }
            }

            for (const layer of orderedLayers) {
                if (!layer.visible) continue;

                const isStencil = layer.type === 'stencil' || layer.operationType === 'stencil';
                const isStencilSource = isStencil && !layer.isOffset && !layer.isPreview && layer.type !== 'offset' && layer.type !== 'preview';
                const isStencilGenerated = isStencil && !isStencilSource;

                // Determine layer transparency
                let layerAlpha = 1.0;
                if (isStencilSource) {
                    layerAlpha = 0.25;
                } else if (isStencilGenerated) {
                    layerAlpha = 0.35;
                } else if (copperSourceCounts[layer.type] > 1) {
                    layerAlpha = 0.70;
                }

                if (layerAlpha < 1.0) {
                    this.ctx.save();
                    this.ctx.globalAlpha = layerAlpha;
                }

                // Dispatch to renderer
                if (layer.isHatch) {
                    this._renderHatchLayerBatched(layer);
                } else if (isStencilSource) {
                    this._renderStencilSourceImmediate(layer);
                } else if (isStencilGenerated) {
                    this._renderStencilGeneratedImmediate(layer);
                } else if (layer.metadata?.strategy === 'filled') {
                    this._renderFilledLayerImmediate(layer);
                } else if (layer.isOffset || layer.type === 'offset') {
                    this._renderOffsetLayerImmediate(layer);
                } else if (layer.isPreview || layer.type === 'preview') {
                    this._renderPreviewLayerImmediate(layer);
                } else {
                    this._renderSourceLayerImmediate(layer);
                }

                if (layerAlpha < 1.0) {
                    this.ctx.restore();
                }
            }
        }

        _getOrderedLayers() {
            const buckets = { 
                cutout: [], 
                otherSource: [], 
                drill: [],
                fused: [],
                laserFill: [],
                offset: [],
                stencil: [],
                preview: [] 
            };

            this.layers.forEach((layer) => {
                if (!layer.visible) return;
                const strategy = layer.metadata?.strategy;

                // Route all stencil geometry (source + offset) into a dedicated top-layer bucket
                if (layer.type === 'stencil' || layer.operationType === 'stencil') {
                    buckets.stencil.push(layer);
                    return;
                }

                switch (layer.type) {
                    case 'cutout':  buckets.cutout.push(layer); break;
                    case 'drill':   buckets.drill.push(layer); break;
                    case 'offset':
                        if (layer.isHatch || strategy === 'filled') {
                            buckets.laserFill.push(layer);
                        } else {
                            buckets.offset.push(layer);
                        }
                        break;
                    case 'preview': buckets.preview.push(layer); break;
                    case 'fused':   buckets.fused.push(layer); break;
                    default:        buckets.otherSource.push(layer); break;
                }
            });

            // Sort drills to render last within processed layers
            const sortDrillsLast = (a, b) => {
                const drillA = a.operationType === 'drill' || a.type === 'drill';
                const drillB = b.operationType === 'drill' || b.type === 'drill';
                return drillA === drillB ? 0 : (drillA ? 1 : -1);
            };
            buckets.offset.sort(sortDrillsLast);
            buckets.preview.sort(sortDrillsLast);

            return [
                ...buckets.cutout,
                ...buckets.otherSource,
                ...buckets.drill,
                ...buckets.fused,
                ...buckets.laserFill,
                ...buckets.offset,
                ...buckets.stencil,
                ...buckets.preview
            ];
        }

        // ========================================================================
        // OFFSET: Immediate Mode
        // ========================================================================

        _renderOffsetLayerImmediate(layer) {
            const viewBounds = this.core.frameCache.viewBounds;
            const displayBounds = layer.bounds;

            // Layer-Level Bounds Check
            if (displayBounds && !this.core.boundsIntersect(displayBounds, viewBounds)) {
                this.core.renderStats.primitives += layer.primitives.length;
                this.core.renderStats.skippedPrimitives += layer.primitives.length;
                return;
            }

            const offsetColor = this.core.getLayerColorSettings(layer);

            // Buckets for z-ordering
            const standardGeometry = [];
            const drillMillingPaths = [];
            const peckMarks = [];

            // Use cache entries if available, otherwise use primitives directly
            const entries = layer.renderCache?.entries || 
                layer.primitives.map(p => ({ primitive: p, bounds: p.getBounds(), screenSize: 1 }));

            for (const entry of entries) {
                this.core.renderStats.primitives++;

                // Viewport culling
                if (!this.core.boundsIntersect(entry.bounds, viewBounds)) {
                    this.core.renderStats.skippedPrimitives++;
                    this.core.renderStats.culledViewport++;
                    continue;
                }

                // LOD culling
                if (!this.core.passesLODCull(entry.screenSize, this.core.viewScale, this.core.lodThreshold)) {
                    this.core.renderStats.skippedPrimitives++;
                    this.core.renderStats.culledLOD++;
                    continue;
                }

                const prim = entry.primitive;
                if (!this.core.shouldRenderPrimitive(prim, layer.type)) {
                    this.core.renderStats.skippedPrimitives++;
                    continue;
                }

                this.core.renderStats.renderedPrimitives++;

                // Collect debug primitives
                if (this._shouldCollectDebug(prim)) {
                    this.debugPrimitives.push(prim);
                }

                // Categorize for z-ordering
                const role = prim.properties?.role;
                if (role === 'peck_mark' || prim.properties?.isToolPeckMark) {
                    peckMarks.push(prim);
                } else if (role === 'drill_milling_path' || prim.properties?.isCenterlinePath) {
                    drillMillingPaths.push(prim);
                } else {
                    standardGeometry.push(prim);
                }
            }

            // Render in z-order using IMMEDIATE MODE (fast)
            // Standard offsets
            for (const prim of standardGeometry) {
                this.primitiveRenderer.renderOffsetPrimitive(prim, offsetColor, { layer });
                this.core.renderStats.drawCalls++;
            }

            // Drill milling paths
            for (const prim of drillMillingPaths) {
                this.primitiveRenderer.renderOffsetPrimitive(prim, offsetColor, { layer });
                this.core.renderStats.drawCalls++;
            }

            // Peck marks
            for (const prim of peckMarks) {
                this.primitiveRenderer.renderPeckMark(prim, { layer });
                this.core.renderStats.drawCalls++;
            }

            // Hijack the "showPreprocessed" toggle to render the smuggled strokes
            if (this.core.options.showPreprocessed) {
                this.ctx.save();
                // Use a bright cyan wireframe to stand out against standard geometry
                this.ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)'; 
                this.ctx.fillStyle = 'rgba(0, 255, 255, 0.15)';   

                const fc = this.core.frameCache;
                this.ctx.lineWidth = Math.max(1.0 * fc.invScale, fc.minWorldWidth);

                // Use a Set to avoid drawing the same strokes thousands of times
                const drawnStrokes = new Set();

                for (const entry of entries) {
                    const debugStrokes = entry.primitive.properties?._preprocessedStrokes;
                    if (debugStrokes) {
                        for (const stroke of debugStrokes) {
                            if (!drawnStrokes.has(stroke)) {
                                drawnStrokes.add(stroke);
                                // Bypass normal rendering to force wireframe-style drawing
                                this.primitiveRenderer._drawPrimitivePath(stroke);
                                this.ctx.fill('evenodd');
                                this.ctx.stroke();
                            }
                        }
                    }
                }
                this.ctx.restore();
            }
        }

        // ========================================================================
        // STENCIL SOURCE: Ghost fill overlay (no strokes)
        // ========================================================================

        _renderStencilSourceImmediate(layer) {
            const viewBounds = this.core.frameCache.viewBounds;
            const displayBounds = layer.bounds;

            // Layer-Level Bounds Check
            if (displayBounds && !this.core.boundsIntersect(displayBounds, viewBounds)) {
                this.core.renderStats.primitives += layer.primitives.length;
                this.core.renderStats.skippedPrimitives += layer.primitives.length;
                return;
            }

            const stencilColor = this.core.getLayerColorSettings(layer);
            this.ctx.fillStyle = stencilColor;

            const entries = layer.renderCache?.entries || 
                layer.primitives.map(p => ({ primitive: p, bounds: p.getBounds(), screenSize: 1 }));

            for (const entry of entries) {
                this.core.renderStats.primitives++;

                if (!this.core.boundsIntersect(entry.bounds, viewBounds)) {
                    this.core.renderStats.skippedPrimitives++;
                    this.core.renderStats.culledViewport++;
                    continue;
                }

                if (!this.core.passesLODCull(entry.screenSize, this.core.viewScale, this.core.lodThreshold)) {
                    this.core.renderStats.skippedPrimitives++;
                    this.core.renderStats.culledLOD++;
                    continue;
                }

                this.core.renderStats.renderedPrimitives++;

                if (this._shouldCollectDebug(entry.primitive)) {
                    this.debugPrimitives.push(entry.primitive);
                }

                // Fill only — pure ghost overlay, no outlines
                this.primitiveRenderer._drawPrimitivePath(entry.primitive);
                this.ctx.fill('evenodd');

                this.core.renderStats.drawCalls++;
            }
        }

        // ========================================================================
        // STENCIL GENERATED: Fill + stroke outlines (aperture cutouts)
        // ========================================================================

        _renderStencilGeneratedImmediate(layer) {
            const viewBounds = this.core.frameCache.viewBounds;
            const displayBounds = layer.bounds;

            // Layer-Level Bounds Check
            if (displayBounds && !this.core.boundsIntersect(displayBounds, viewBounds)) {
                this.core.renderStats.primitives += layer.primitives.length;
                this.core.renderStats.skippedPrimitives += layer.primitives.length;
                return;
            }

            const stencilColor = this.core.getLayerColorSettings(layer);
            const fc = this.core.frameCache;
            const strokeWidth = Math.max(2.0 * fc.invScale, fc.minWorldWidth);

            this.ctx.fillStyle = stencilColor;
            this.ctx.strokeStyle = stencilColor;
            this.ctx.lineWidth = strokeWidth;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
            this.ctx.setLineDash([]);

            const entries = layer.renderCache?.entries ||
                layer.primitives.map(p => ({ primitive: p, bounds: p.getBounds(), screenSize: 1 }));

            for (const entry of entries) {
                this.core.renderStats.primitives++;

                if (!this.core.boundsIntersect(entry.bounds, viewBounds)) {
                    this.core.renderStats.skippedPrimitives++;
                    this.core.renderStats.culledViewport++;
                    continue;
                }

                if (!this.core.passesLODCull(entry.screenSize, this.core.viewScale, this.core.lodThreshold)) {
                    this.core.renderStats.skippedPrimitives++;
                    this.core.renderStats.culledLOD++;
                    continue;
                }

                this.core.renderStats.renderedPrimitives++;

                if (this._shouldCollectDebug(entry.primitive)) {
                    this.debugPrimitives.push(entry.primitive);
                }

                // Fill + stroke: shows aperture area with crisp boundary
                this.primitiveRenderer._drawPrimitivePath(entry.primitive);
                this.ctx.fill('evenodd');
                this.ctx.stroke();

                this.core.renderStats.drawCalls += 2;
            }
        }

        // ========================================================================
        // FILLED (Laser): Immediate Mode
        // ========================================================================

        _renderFilledLayerImmediate(layer) {
            const viewBounds = this.core.frameCache.viewBounds;
            const displayBounds = layer.bounds;

            // Layer-Level Bounds Check
            if (displayBounds && !this.core.boundsIntersect(displayBounds, viewBounds)) {
                this.core.renderStats.primitives += layer.primitives.length;
                this.core.renderStats.skippedPrimitives += layer.primitives.length;
                return;
            }

            // Resolve colors from theme with fallback
            const fillColor = this.core.colors.geometry?.laser?.filled || this.core.colors.geometry.preview;
            const minWidth = this.core.frameCache.minWorldWidth;
            const outlineWidth = Math.max(1.0 * this.core.frameCache.invScale, minWidth);

            const entries = layer.renderCache?.entries || 
                layer.primitives.map(p => ({ primitive: p, bounds: p.getBounds(), screenSize: 1 }));

            for (const entry of entries) {
                this.core.renderStats.primitives++;

                // Viewport culling
                if (!this.core.boundsIntersect(entry.bounds, viewBounds)) {
                    this.core.renderStats.skippedPrimitives++;
                    this.core.renderStats.culledViewport++;
                    continue;
                }

                // LOD culling
                if (!this.core.passesLODCull(entry.screenSize, this.core.viewScale, this.core.lodThreshold)) {
                    this.core.renderStats.skippedPrimitives++;
                    this.core.renderStats.culledLOD++;
                    continue;
                }

                const prim = entry.primitive;
                if (!this.core.shouldRenderPrimitive(prim, layer.type)) {
                    this.core.renderStats.skippedPrimitives++;
                    continue;
                }

                this.core.renderStats.renderedPrimitives++;

                // Build the path once — _drawPrimitivePath calls beginPath() internally.
                // Multi-contour paths with holes render correctly via evenodd fill rule since outer and hole contours have opposite winding from Clipper output.
                this.primitiveRenderer._drawPrimitivePath(prim);

                // Solid fill to show ablation zone
                this.ctx.save();
                this.ctx.fillStyle = fillColor;
                this.ctx.fill('evenodd');
                this.ctx.restore();

                // Debug collection
                if (this._shouldCollectDebug(prim)) {
                    this.debugPrimitives.push(prim);
                }

                this.core.renderStats.drawCalls += 2;
            }
        }

        // ========================================================================
        // HATCH (Laser): Batched Immediate Mode
        // ========================================================================

        /**
         * Renders laser hatch lines using a single batched draw call.
         */
        _renderHatchLayerBatched(layer) {
            const viewBounds = this.core.frameCache.viewBounds;
            const displayBounds = layer.bounds;

            // Layer-Level Bounds Check
            if (displayBounds && !this.core.boundsIntersect(displayBounds, viewBounds)) {
                this.core.renderStats.primitives += layer.primitives.length;
                this.core.renderStats.skippedPrimitives += layer.primitives.length;
                return;
            }

            // REVIEW THIS LOGIC - IF THE HATCH PATTERN LINES ALL HAVE THE SAME SIZE THEY WILL NEVER, REALISTICALLY, GO SUB-PIXEL
            // Layer-level LOD: if the entire hatch region is sub-pixel, skip it.
            // Individual line LOD is pointless since all lines have the same size.
            /*if (displayBounds) {
                const layerScreenWidth = Math.max(
                    displayBounds.maxX - displayBounds.minX,
                    displayBounds.maxY - displayBounds.minY
                ) * this.core.viewScale;
                const dpr = this.core.devicePixelRatio || 1;
                if (layerScreenWidth / dpr < this.core.lodThreshold) {
                    this.core.renderStats.primitives += layer.primitives.length;
                    this.core.renderStats.skippedPrimitives += layer.primitives.length;
                    return;
                }
            }*/

            // Resolve color through the standard path (currently 'on' -> yellow)
            const hatchColor = this.core.getLayerColorSettings(layer);

            // Use the same screen-pixel-based stroke width as standard offsets.
            // Hatch metadata carries toolDiameter for future export use, but rendering uses a zoom-invariant stroke like all other offset geometry.
            const fc = this.core.frameCache;
            const lineWidth = Math.max(this.primitiveRenderer.cfg.stroke.offset * fc.invScale, fc.minWorldWidth);

            this.ctx.save();
            this.ctx.strokeStyle = hatchColor;
            this.ctx.lineWidth = lineWidth;
            this.ctx.lineCap = 'butt';
            this.ctx.lineJoin = 'miter';
            this.ctx.setLineDash([]);

            // Single batched path for all hatch lines
            this.ctx.beginPath();

            const entries = layer.renderCache?.entries || 
                layer.primitives.map(p => ({ primitive: p, bounds: p.getBounds(), screenSize: 1 }));

            let batchedCount = 0;

            for (const entry of entries) {
                this.core.renderStats.primitives++;

                // Viewport culling still applies per-primitive — lines off-screen are cheap to skip and the check is just 4 comparisons.
                if (!this.core.boundsIntersect(entry.bounds, viewBounds)) {
                    this.core.renderStats.skippedPrimitives++;
                    this.core.renderStats.culledViewport++;
                    continue;
                }

                const prim = entry.primitive;
                this.core.renderStats.renderedPrimitives++;

                // Accumulate into the batch path.
                // Hatch primitives are always 2-point open paths from HatchGenerator.
                if (prim.contours && prim.contours[0] && prim.contours[0].points.length >= 2) {
                    const pts = prim.contours[0].points;
                    this.ctx.moveTo(pts[0].x, pts[0].y);
                    for (let i = 1; i < pts.length; i++) {
                        this.ctx.lineTo(pts[i].x, pts[i].y);
                    }
                    batchedCount++;
                }
            }

            // Single draw call for the entire layer
            if (batchedCount > 0) {
                this.ctx.stroke();
                this.core.renderStats.drawCalls++;
            }

            this.ctx.restore();
        }

        // ========================================================================
        // PREVIEW: Immediate Mode
        // ========================================================================


        _renderPreviewLayerImmediate(layer) {
            const viewBounds = this.core.frameCache.viewBounds;
            const displayBounds = layer.bounds;

            // Layer-Level Bounds Check
            if (displayBounds && !this.core.boundsIntersect(displayBounds, viewBounds)) {
                this.core.renderStats.primitives += layer.primitives.length;
                this.core.renderStats.skippedPrimitives += layer.primitives.length;
                return;
            }

            const previewColor = this.core.getLayerColorSettings(layer);
            const minWidth = this.core.frameCache.minWorldWidth;

            // Set Base State
            this.ctx.strokeStyle = previewColor;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
            this.ctx.setLineDash([]);

            let currentDiameter = -1;

            const entries = layer.renderCache?.entries || 
                layer.primitives.map(p => ({ primitive: p, bounds: p.getBounds(), screenSize: 1 }));

            for (const entry of entries) {
                this.core.renderStats.primitives++;

                // Culling
                if (!this.core.boundsIntersect(entry.bounds, viewBounds)) {
                    this.core.renderStats.skippedPrimitives++;
                    this.core.renderStats.culledViewport++;
                    continue;
                }

                if (!this.core.passesLODCull(entry.screenSize, this.core.viewScale, this.core.lodThreshold)) {
                    this.core.renderStats.skippedPrimitives++;
                    this.core.renderStats.culledLOD++;
                    continue;
                }

                const prim = entry.primitive;
                if (!this.core.shouldRenderPrimitive(prim, layer.type)) {
                    this.core.renderStats.skippedPrimitives++;
                    continue;
                }

                this.core.renderStats.renderedPrimitives++;

                if (this._shouldCollectDebug(prim)) {
                    this.debugPrimitives.push(prim);
                }

                // Determine Geometry Type
                const role = prim.properties?.role;
                const isComplex = role === 'peck_mark' || 
                                prim.properties?.isCenterlinePath || 
                                (prim.properties?.toolRelation && prim.properties?.toolRelation !== 'exact') ||
                                role === 'drill_milling_path';

                if (isComplex) {
                    this.ctx.save();
                    // Let the dedicated renderer handle color changes / fills for complex items
                    const toolDia = prim.properties?.toolDiameter || layer.metadata?.toolDiameter;

                    if (role === 'peck_mark') {
                        this.primitiveRenderer.renderPeckMark(prim, { layer });
                    } else if (prim.properties?.isCenterlinePath) {
                        this.primitiveRenderer.renderCenterlineSlot(prim, { layer, toolDiameter: toolDia });
                    } else {
                        this.primitiveRenderer.renderToolPreview(prim, previewColor, { layer, toolDiameter: toolDia });
                    }

                    this.ctx.restore();
                    // Reset state tracker
                    currentDiameter = -1;
                } else {
                    // Standard Stroke (Fast Path)
                    const toolDia = layer.metadata?.toolDiameter || 
                                    prim.properties?.toolDiameter || 
                                    this._getToolDiameterForPrimitive(prim);

                    if (toolDia !== currentDiameter) {
                        this.ctx.lineWidth = Math.max(toolDia, minWidth);
                        currentDiameter = toolDia;
                    }

                    this.primitiveRenderer._drawPrimitivePath(prim);
                    this.ctx.stroke();
                }

                this.core.renderStats.drawCalls++;
            }
        }

        // ========================================================================
        // SOURCE: Immediate Mode
        // ========================================================================

        _renderSourceLayerImmediate(layer) {
            const viewBounds = this.core.frameCache.viewBounds;
            const displayBounds = layer.bounds;

            // Layer-Level Bounds Check
            if (displayBounds && !this.core.boundsIntersect(displayBounds, viewBounds)) {
                this.core.renderStats.primitives += layer.primitives.length;
                this.core.renderStats.skippedPrimitives += layer.primitives.length;
                return;
            }

            // Determine Base Color
            let layerColor = this.core.getLayerColorSettings(layer);
            if (this.options.blackAndWhite) {
                layerColor = layer.type === 'cutout' ? this.core.colors.bw.black : this.core.colors.bw.white;
            }

            // Set Base Context State
            this.ctx.fillStyle = layerColor;
            this.ctx.strokeStyle = layerColor;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';

            const minWidth = this.core.frameCache.minWorldWidth;
            let currentLineWidth = -1;

            // Use cached entries if available to avoid re-mapping
            const entries = layer.renderCache?.entries || 
                layer.primitives.map(p => ({ primitive: p, bounds: p.getBounds(), screenSize: 1 }));

            for (const entry of entries) {
                this.core.renderStats.primitives++;

                // Culling
                if (!this.core.boundsIntersect(entry.bounds, viewBounds)) {
                    this.core.renderStats.skippedPrimitives++;
                    this.core.renderStats.culledViewport++;
                    continue;
                }

                if (!this.core.passesLODCull(entry.screenSize, this.core.viewScale, this.core.lodThreshold)) {
                    this.core.renderStats.skippedPrimitives++;
                    this.core.renderStats.culledLOD++;
                    continue;
                }

                const prim = entry.primitive;
                if (!this.core.shouldRenderPrimitive(prim, layer.type)) {
                    this.core.renderStats.skippedPrimitives++;
                    continue;
                }

                this.core.renderStats.renderedPrimitives++;

                // Debug Collection
                if (this._shouldCollectDebug(prim)) {
                    this.debugPrimitives.push(prim);
                }

                // Draw Logic
                // Determine if it needs stroke or fill
                const isStroke = (prim.properties?.stroke && !prim.properties?.fill) || prim.properties?.isTrace;
                const width = prim.properties?.strokeWidth || 0;

                // Lazy Line Width Switching
                if (isStroke && width !== currentLineWidth) {
                    this.ctx.lineWidth = Math.max(width, minWidth);
                    currentLineWidth = width;
                }

                // --- DRAW ---
                // Use the primitive renderer's direct draw path helper. 
                // Note: This bypasses 'renderPrimitiveNormal' to avoid excessive function calls and context save/restores for simple shapes.

                // Special case: Complex shapes that need specific winding (Drills/Slots/Complex Paths)
                const role = prim.properties?.role;
                if (role === 'drill_hole' || role === 'drill_slot' || role === 'peck_mark') {
                    this.primitiveRenderer.renderPrimitive(prim, layerColor, layerColor, layer.isPreprocessed, { layer });
                    // Reset state after external call
                    this.ctx.fillStyle = layerColor;
                    this.ctx.strokeStyle = layerColor;
                    currentLineWidth = -1; 
                } 
                else {
                    // Standard Geometry
                    this.primitiveRenderer._drawPrimitivePath(prim);

                    if (isStroke) {
                        this.ctx.stroke();
                    } else {
                        // Default to fill
                        if (layer.isPreprocessed && prim.properties?.polarity === 'clear') {
                            this.ctx.fillStyle = this.core.colors.canvas?.background;
                            this.ctx.fill('evenodd');
                            this.ctx.fillStyle = layerColor; // Restore
                        } else {
                            this.ctx.fill('evenodd');
                        }
                    }
                }
                
                this.core.renderStats.drawCalls++;
            }
        }

        // ========================================================================
        // Wireframe: Immediate Mode
        // ========================================================================

        _renderWireframeMode() {
            const viewBounds = this.core.frameCache.viewBounds;

            // Set Wireframe State Once
            this.ctx.strokeStyle = this.core.colors.debug.wireframe;
            this.ctx.lineWidth = this.core.getWireframeStrokeWidth();
            this.ctx.fillStyle = 'transparent';
            this.ctx.setLineDash([]);

            this.layers.forEach(layer => {
                if (!layer.visible) return;

                const displayBounds = layer.bounds;

                // Layer-Level Bounds Check
                if (displayBounds && !this.core.boundsIntersect(displayBounds, viewBounds)) {
                    this.core.renderStats.primitives += layer.primitives.length;
                    this.core.renderStats.skippedPrimitives += layer.primitives.length;
                    return;
                }

                const entries = layer.renderCache?.entries || 
                    layer.primitives.map(p => ({ primitive: p, bounds: p.getBounds(), screenSize: 1 }));

                for (const entry of entries) {
                    this.core.renderStats.primitives++;

                    if (!this.core.boundsIntersect(entry.bounds, viewBounds)) {
                        this.core.renderStats.skippedPrimitives++;
                        continue;
                    }

                    const prim = entry.primitive;
                    if (!this.core.shouldRenderPrimitive(prim, layer.type)) {
                        this.core.renderStats.skippedPrimitives++;
                        continue;
                    }

                    this.core.renderStats.renderedPrimitives++;

                    // Direct Immediate Draw
                    this.primitiveRenderer._drawPrimitivePath(prim);
                    this.ctx.stroke();

                    if (this._shouldCollectDebug(prim)) {
                        this.debugPrimitives.push(prim);
                    }
                    this.core.renderStats.drawCalls++;
                }
            });
        }

        // ========================================================================
        // Debug Overlay
        // ========================================================================

        _shouldCollectDebug(primitive) {
            if (!this.options.debugPoints && !this.options.debugArcs) return false;
            if (primitive.type === 'circle') return true;
            if (primitive.type === 'arc') return true;
            if (primitive.type === 'path' && primitive.contours?.length > 0) return true;
            return false;
        }

        // ========================================================================
        // Debug Overlay — World Space (same transform as geometry)
        // ========================================================================

        /**
         * Renders debug points and arcs in world space (same transform as geometry).
         *
         * Toggle cascade:
         *   debugPoints ─── shows all vertex dots (source + offset geometry)
         *     └─ enableArcReconstruction ON → hides points replaced by arcSegments/circles
         *   debugArcs ──── requires enableArcReconstruction ON
         *     └─ draws reconstructed arcSegments + full circles + arc center dots
         *
         * Batching: single beginPath/fill for all points, single beginPath/stroke for arcs.
         * Viewport culling: individual regenerated points are skipped if outside view bounds.
         */
        _renderDebugOverlayWorld() {
            const fc = this.core.frameCache;
            const uiScale = this.core.devicePixelRatio || 1;
            const arcStrokeWidth = 2 * fc.invScale * uiScale;
            const hasReconstruction = this.options.enableArcReconstruction;
            const vb = fc.viewBounds;

            // POINTS
            if (this.options.debugPoints) {
                this.ctx.fillStyle = this.core.colors.debug.points;

                // Calculate scaling constants once per frame
                const pointRadius = 1.5 * fc.invScale * uiScale; 

                this.ctx.beginPath();

                for (const prim of this.debugPrimitives) {

                    // Handle Standalone Circles
                    if (prim.type === 'circle' && prim.center) {
                        if (hasReconstruction && prim.properties?.reconstructed) continue;

                        if (!hasReconstruction && prim.properties?.reconstructed) {
                            const segments = GeometryUtils.getOptimalSegments(prim.radius, 'circle');
                            const step = (2 * Math.PI) / segments;
                            for (let s = 0; s < segments; s++) {
                                const angle = s * step;
                                const px = prim.center.x + prim.radius * Math.cos(angle);
                                const py = prim.center.y + prim.radius * Math.sin(angle);

                                if (px < vb.minX || px > vb.maxX || py < vb.minY || py > vb.maxY) continue;

                                // Draw perfectly round dot
                                this.ctx.moveTo(px + pointRadius, py);
                                this.ctx.arc(px, py, pointRadius, 0, Math.PI * 2);
                            }
                            continue;
                        }

                        if (prim.center.x >= vb.minX && prim.center.x <= vb.maxX && 
                            prim.center.y >= vb.minY && prim.center.y <= vb.maxY) {
                            this.ctx.moveTo(prim.center.x + pointRadius, prim.center.y);
                            this.ctx.arc(prim.center.x, prim.center.y, pointRadius, 0, Math.PI * 2);
                        }
                        continue;
                    }

                    // Handle Paths and Offset Geometry
                    if (!prim.contours) continue;

                    for (const contour of prim.contours) {
                        if (!contour.points) continue;

                        const arcs = contour.arcSegments || [];
                        const hasArcs = arcs.length > 0;

                        // Draw existing points in memory
                        for (let i = 0; i < contour.points.length; i++) {
                            const p = contour.points[i];
                            if (p.x < vb.minX || p.x > vb.maxX || p.y < vb.minY || p.y > vb.maxY) continue;

                            this.ctx.moveTo(p.x + pointRadius, p.y);
                            this.ctx.arc(p.x, p.y, pointRadius, 0, Math.PI * 2);
                        }

                        // Regenerate missing points
                        if (!hasReconstruction && hasArcs) {
                            for (const arc of arcs) {
                                if (!arc.center || !arc.radius) continue;

                                let sweep = arc.sweepAngle;
                                if (sweep === undefined) {
                                    sweep = arc.endAngle - arc.startAngle;
                                    if (arc.clockwise && sweep > 0) sweep -= 2 * Math.PI;
                                    else if (!arc.clockwise && sweep < 0) sweep += 2 * Math.PI;
                                }

                                const fullCircleSegs = GeometryUtils.getOptimalSegments(arc.radius, 'arc');
                                const arcSegs = Math.max(2, Math.ceil(fullCircleSegs * Math.abs(sweep) / (2 * Math.PI)));

                                for (let s = 1; s < arcSegs; s++) {
                                    const t = s / arcSegs;
                                    const angle = arc.startAngle + sweep * t;
                                    const px = arc.center.x + arc.radius * Math.cos(angle);
                                    const py = arc.center.y + arc.radius * Math.sin(angle);

                                    if (px < vb.minX || px > vb.maxX || py < vb.minY || py > vb.maxY) continue;

                                    this.ctx.moveTo(px + pointRadius, py);
                                    this.ctx.arc(px, py, pointRadius, 0, Math.PI * 2);
                                }
                            }
                        }
                    }
                }
                
                // Send all points to GPU in a single call
                this.ctx.fill(); 
            }

            // ARCS
            if (this.options.debugArcs && hasReconstruction) {
                const arcColor = this.core.colors.debug.arcs;
                this.ctx.strokeStyle = arcColor;
                this.ctx.lineWidth = arcStrokeWidth;
                this.ctx.setLineDash([]);

                this.ctx.beginPath();
                for (const prim of this.debugPrimitives) {
                    if (!prim.contours) continue;
                    for (const contour of prim.contours) {
                        if (!contour.arcSegments) continue;
                        for (const arc of contour.arcSegments) {
                            if (!arc.center) continue;
                            this.ctx.moveTo(
                                arc.center.x + arc.radius * Math.cos(arc.startAngle),
                                arc.center.y + arc.radius * Math.sin(arc.startAngle)
                            );
                            if (arc.sweepAngle !== undefined) {
                                this.ctx.arc(
                                    arc.center.x, arc.center.y, arc.radius,
                                    arc.startAngle, arc.startAngle + arc.sweepAngle,
                                    arc.sweepAngle < 0
                                );
                            } else {
                                this.ctx.arc(
                                    arc.center.x, arc.center.y, arc.radius,
                                    arc.startAngle, arc.endAngle, arc.clockwise
                                );
                            }
                        }
                    }
                }
                this.ctx.stroke();

                // Full reconstructed circles
                this.ctx.beginPath();
                for (const prim of this.debugPrimitives) {
                    if (prim.type === 'circle' && prim.properties?.reconstructed) {
                        this.ctx.moveTo(prim.center.x + prim.radius, prim.center.y);
                        this.ctx.arc(prim.center.x, prim.center.y, prim.radius, 0, Math.PI * 2);
                    }
                }
                this.ctx.stroke();

                // Arc center dots
                this.ctx.fillStyle = arcColor;
                this.ctx.beginPath(); // Start batch for arc centers

                // Use the exact same radius calculation as the debug points
                const arcCenterRadius = 1.5 * fc.invScale * uiScale;

                for (const prim of this.debugPrimitives) {
                    if (!prim.contours) continue;
                    for (const contour of prim.contours) {
                        if (!contour.arcSegments) continue;
                        for (const arc of contour.arcSegments) {
                            if (!arc.center) continue;

                            // Draw perfectly round dot
                            this.ctx.moveTo(arc.center.x + arcCenterRadius, arc.center.y);
                            this.ctx.arc(arc.center.x, arc.center.y, arcCenterRadius, 0, Math.PI * 2);
                        }
                    }
                }

                this.ctx.fill();
            }
        }

        // ========================================================================
        // Utility Methods
        // ========================================================================

        _getToolDiameterForPrimitive(primitive) {
            const opId = primitive.properties?.operationId;
            if (!opId || !this.pcbCore?.operations) return null;
            const operation = this.pcbCore.operations.find(op => op.id === opId);
            const diameterStr = operation?.settings?.toolDiameter;
            if (diameterStr !== undefined) {
                const diameter = parseFloat(diameterStr);
                return isNaN(diameter) ? null : diameter;
            }
            return null;
        }

        destroy() {
            if (this.interactionHandler) {
                this.interactionHandler.destroy();
            }
            if (this._renderHandle) {
                cancelAnimationFrame(this._renderHandle);
            }
        }
    }

    window.LayerRenderer = LayerRenderer;
})();