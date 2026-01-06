/**
 * @file        renderer/renderer-layer.js
 * @description Manages canvas layers
 * @author      Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

/*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2026 Eltryus
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

            // Apply object rotation
            if (this.core.currentRotation !== 0 && this.core.rotationCenter) {
                this.ctx.translate(this.core.rotationCenter.x, this.core.rotationCenter.y);
                this.ctx.rotate((this.core.currentRotation * Math.PI) / 180);
                this.ctx.translate(-this.core.rotationCenter.x, -this.core.rotationCenter.y);
            }

            // Render geometry using hybrid approach
            if (this.options.showWireframe) {
                this._renderWireframeMode();
            } else {
                this._renderVisibleLayers();
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

            // Debug overlay
            if ((this.options.debugPoints || this.options.debugArcs) && 
                this.debugPrimitives.length > 0) {
                this._buildDebugScreenData();
                this._renderDebugOverlay();
            }

            this.core.endRender(startTime);
        }

        // ========================================================================
        // Hybrid Rendering Pipeline
        // ========================================================================

        _renderVisibleLayers() {
            const orderedLayers = this._getOrderedLayers();

            for (const layer of orderedLayers) {
                if (!layer.visible) continue;

                // Dispatch to appropriate renderer based on layer type
                if (layer.isOffset || layer.type === 'offset') {
                    this._renderOffsetLayerImmediate(layer);
                } else if (layer.isPreview || layer.type === 'preview') {
                    this._renderPreviewLayerImmediate(layer);
                } else {
                    this._renderSourceLayerImmediate(layer);
                }
            }
        }

        _getOrderedLayers() {
            const buckets = { 
                cutout: [], 
                otherSource: [], 
                drill: [],
                fused: [], 
                offset: [], 
                preview: [] 
            };

            this.layers.forEach((layer) => {
                if (!layer.visible) return;
                switch (layer.type) {
                    case 'cutout':  buckets.cutout.push(layer); break;
                    case 'drill':   buckets.drill.push(layer); break;
                    case 'offset':  buckets.offset.push(layer); break;
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
                ...buckets.offset,
                ...buckets.preview
            ];
        }

        // ========================================================================
        // OFFSET: Immediate Mode
        // ========================================================================

        _renderOffsetLayerImmediate(layer) {
            const viewBounds = this.core.frameCache.viewBounds;
            const isRotated = this.core.currentRotation !== 0;

            // Layer-level bounds check
            const displayBounds = isRotated ? this._getRotatedLayerBounds(layer) : layer.bounds;
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
        }

        // ========================================================================
        // PREVIEW: Immediate Mode
        // ========================================================================


        _renderPreviewLayerImmediate(layer) {
            const viewBounds = this.core.frameCache.viewBounds;
            const isRotated = this.core.currentRotation !== 0;

            const displayBounds = isRotated ? this._getRotatedLayerBounds(layer) : layer.bounds;
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
            const isRotated = this.core.currentRotation !== 0;

            // 1. Layer-Level Bounds Check
            const displayBounds = isRotated ? this._getRotatedLayerBounds(layer) : layer.bounds;
            if (displayBounds && !this.core.boundsIntersect(displayBounds, viewBounds)) {
                this.core.renderStats.primitives += layer.primitives.length;
                this.core.renderStats.skippedPrimitives += layer.primitives.length;
                return;
            }

            // 2. Determine Base Color
            let layerColor = this.core.getLayerColorSettings(layer);
            if (this.options.blackAndWhite) {
                layerColor = layer.type === 'cutout' ? this.core.colors.bw.black : this.core.colors.bw.white;
            }

            // 3. Set Base Context State
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

                // 4. Culling
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

                // 5. Debug Collection
                if (this._shouldCollectDebug(prim)) {
                    this.debugPrimitives.push(prim);
                }

                // 6. Draw Logic
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
            const isRotated = this.core.currentRotation !== 0;

            // Set Wireframe State Once
            this.ctx.strokeStyle = this.core.colors.debug.wireframe;
            this.ctx.lineWidth = this.core.getWireframeStrokeWidth();
            this.ctx.fillStyle = 'transparent';
            this.ctx.setLineDash([]);

            this.layers.forEach(layer => {
                if (!layer.visible) return;

                const displayBounds = isRotated ? this._getRotatedLayerBounds(layer) : layer.bounds;
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

        _buildDebugScreenData() {
            this.debugPrimitivesScreen = this.debugPrimitives.map(prim => {
                const screenData = {
                    type: prim.type,
                    properties: prim.properties,
                    center: prim.center,
                    radius: prim.radius,
                    startAngle: prim.startAngle,
                    endAngle: prim.endAngle,
                    clockwise: prim.clockwise
                };

                if (prim.points) {
                    screenData.screenPoints = prim.points.map(p => {
                        const s = this.core.worldToScreen(p.x, p.y);
                        return { ...s, ...p };
                    });
                }

                if (prim.contours) {
                    screenData.contours = prim.contours.map(c => ({
                        ...c,
                        screenPoints: c.points.map(p => this.core.worldToScreen(p.x, p.y)),
                        arcSegments: c.arcSegments ? c.arcSegments.map(seg => ({
                            ...seg,
                            centerScreen: this.core.worldToScreen(seg.center.x, seg.center.y),
                            radiusScreen: seg.radius * this.core.viewScale
                        })) : []
                    }));
                }
                return screenData;
            });
        }

        _renderDebugOverlay() {
            if (!this.debugPrimitivesScreen || this.debugPrimitivesScreen.length === 0) return;

            this.ctx.save();
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);

            const pointColor = this.core.colors.debug.points;
            const arcColor = this.core.colors.debug.arcs;
            const pointSize = 3;
            const arcStrokeWidth = 2;

            if (this.options.debugPoints) {
                this.ctx.fillStyle = pointColor;
                this.ctx.beginPath();

                for (const prim of this.debugPrimitivesScreen) {
                    if (prim.type === 'circle' && prim.center) {
                        const sc = this.core.worldToScreen(prim.center.x, prim.center.y);
                        this.ctx.moveTo(sc.x + pointSize, sc.y);
                        this.ctx.arc(sc.x, sc.y, pointSize, 0, Math.PI * 2);
                    }

                    if (prim.contours) {
                        for (const contour of prim.contours) {
                            if (contour.screenPoints) {
                                for (const p of contour.screenPoints) {
                                    this.ctx.moveTo(p.x + pointSize, p.y);
                                    this.ctx.arc(p.x, p.y, pointSize, 0, Math.PI * 2);
                                }
                            }
                            if (contour.arcSegments) {
                                for (const arc of contour.arcSegments) {
                                    if (arc.centerScreen) {
                                        this.ctx.moveTo(arc.centerScreen.x + pointSize, arc.centerScreen.y);
                                        this.ctx.arc(arc.centerScreen.x, arc.centerScreen.y, pointSize, 0, Math.PI * 2);
                                    }
                                }
                            }
                        }
                    }
                }
                this.ctx.fill();
            }

            if (this.options.debugArcs) {
                this.ctx.strokeStyle = arcColor;
                this.ctx.lineWidth = arcStrokeWidth;
                this.ctx.beginPath();

                for (const prim of this.debugPrimitivesScreen) {
                    if (!prim.contours) continue;
                    for (const contour of prim.contours) {
                        if (!contour.arcSegments) continue;
                        for (const arc of contour.arcSegments) {
                            if (!arc.centerScreen) continue;
                            this.ctx.moveTo(
                                arc.centerScreen.x + arc.radiusScreen * Math.cos(arc.startAngle),
                                arc.centerScreen.y - arc.radiusScreen * Math.sin(arc.startAngle)
                            );
                            this.ctx.arc(
                                arc.centerScreen.x, arc.centerScreen.y, arc.radiusScreen,
                                -arc.startAngle, -arc.endAngle, arc.clockwise
                            );
                        }
                    }
                }
                this.ctx.stroke();

                // Reconstructed full circles
                this.ctx.beginPath();
                for (const prim of this.debugPrimitivesScreen) {
                    if (prim.type === 'circle' && prim.properties?.reconstructed) {
                        const sc = this.core.worldToScreen(prim.center.x, prim.center.y);
                        const sr = prim.radius * this.core.viewScale;
                        this.ctx.moveTo(sc.x + sr, sc.y);
                        this.ctx.arc(sc.x, sc.y, sr, 0, Math.PI * 2);
                    }
                }
                this.ctx.stroke();
            }

            this.ctx.restore();
        }

        // ========================================================================
        // Rotation Bounds Helper
        // ========================================================================

        _getRotatedLayerBounds(layer) {
            const bounds = layer.bounds;
            if (!bounds || this.core.currentRotation === 0) {
                return bounds;
            }

            const corners = [
                { x: bounds.minX, y: bounds.minY },
                { x: bounds.maxX, y: bounds.minY },
                { x: bounds.maxX, y: bounds.maxY },
                { x: bounds.minX, y: bounds.maxY }
            ];

            const rotationCenter = this.core.rotationCenter || { x: 0, y: 0 };
            const angle = (this.core.currentRotation * Math.PI) / 180;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            const rotatedCorners = corners.map(corner => {
                const dx = corner.x - rotationCenter.x;
                const dy = corner.y - rotationCenter.y;
                return {
                    x: rotationCenter.x + (dx * cos - dy * sin),
                    y: rotationCenter.y + (dx * sin + dy * cos)
                };
            });

            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;

            rotatedCorners.forEach(corner => {
                minX = Math.min(minX, corner.x);
                minY = Math.min(minY, corner.y);
                maxX = Math.max(maxX, corner.x);
                maxY = Math.max(maxY, corner.y);
            });

            return { minX, minY, maxX, maxY };
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