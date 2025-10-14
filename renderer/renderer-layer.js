/**
 * @file        renderer/renderer-layer.js
 * @description Manages layers
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
    
    const config = window.PCBCAMConfig || {};
    const debugConfig = config.debug || {};
    
    class LayerRenderer {
        constructor(canvasId, core) {
            this.canvas = document.getElementById(canvasId);
            if (!this.canvas) {
                throw new Error(`Canvas element '${canvasId}' not found`);
            }
            
            this.core = new RendererCore(this.canvas);
            this.pcbCore = core;
            this.camCore = core; // Alias for compatibility
            
            this.primitiveRenderer = new PrimitiveRenderer(this.core);
            this.overlayRenderer = new OverlayRenderer(this.core);
            this.interactionHandler = new InteractionHandler(this.core, this);
            
            this.debugPrimitives = [];
            this._renderQueued = false;
            this._renderHandle = null;
            
            this.core.resizeCanvas();
            this.interactionHandler.init();
        }
        
        // Property accessors for compatibility
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
        
        // ==================== OPTIMIZED RENDERING ====================
        
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
            
            // Background elements & Overlays (These are fine)
            if (this.options.showGrid) { this.overlayRenderer.renderGrid(); }
            if (this.options.showBounds) { this.overlayRenderer.renderBounds(); }
            if (this.options.showOrigin) { this.overlayRenderer.renderOrigin(); }
            if (this.options.showRulers) { this.overlayRenderer.renderRulers(); }
            this.overlayRenderer.renderScaleIndicator();
            if (this.options.showStats) { this.overlayRenderer.renderStats(); }

            // Main geometry rendering logic
            if (this.options.showWireframe) {
                this.layers.forEach(layer => {
                    if (layer.visible) {
                        // You will need to implement this function as we discussed
                        this.renderWireframeLayer(layer); 
                    }
                });
            } else {
                // This is the missing call to the normal rendering pipeline
                this.renderVisibleLayers();
            }
            
            // CRITICAL: Reset the transform AFTER all world-space drawing is done,
            // regardless of which rendering mode was used.
            this.core.resetTransform();

            // Pre-transform debug primitives to screen space
            if ((this.options.debugPoints || this.options.debugPaths) && 
                this.debugPrimitives.length > 0) {
                
                this.debugPrimitivesScreen = this.debugPrimitives.map(prim => {
                    const screenData = {
                        type: prim.type,
                        properties: prim.properties
                    };
                    
                    // Transform points if they exist
                    if (prim.points) {
                        screenData.screenPoints = prim.points.map(p => {
                            const s = this.core.worldToScreen(p.x, p.y);
                            return {
                                x: s.x,
                                y: s.y,
                                curveId: p.curveId,
                                segmentIndex: p.segmentIndex,
                                totalSegments: p.totalSegments,
                                t: p.t,
                                angle: p.angle
                            };
                        });
                    }
                    
                    // Transform arc segments if they exist
                    if (prim.arcSegments) {
                        screenData.arcSegments = prim.arcSegments.map(seg => {
                            const centerScreen = this.core.worldToScreen(seg.center.x, seg.center.y);
                            return {
                                ...seg,
                                centerScreen: centerScreen,
                                radiusScreen: seg.radius * this.core.viewScale
                            };
                        });
                    }
                    
                    // Transform contours if they exist
                    if (prim.contours) {
                        screenData.contours = prim.contours.map(c => ({
                            ...c,
                            screenPoints: c.points.map(p => this.core.worldToScreen(p.x, p.y))
                        }));
                    }
                    
                    return screenData;
                });
                
                this.renderDebugOverlay();
            }
            
            this.core.endRender(startTime);
        }
        
        // ==================== LAYER RENDERING WITH PROPER CONTEXT ====================
        
        renderVisibleLayers() {
            // Separate layers by type for proper rendering order
            const sourceLayers = [];
            const fusedLayers = [];
            const offsetLayers = [];
            const previewLayers = [];
            const toolpathLayers = [];
            
            this.layers.forEach((layer, name) => {
                if (!layer.visible) return;
                
                if (name.startsWith('offset_')) {
                    offsetLayers.push({ name, layer });
                } else if (name.startsWith('preview_')) {
                    previewLayers.push({ name, layer });
                } else if (name.startsWith('toolpath_')) {
                    toolpathLayers.push({ name, layer });
                } else if (name.startsWith('fused_')) {
                    fusedLayers.push({ name, layer });
                } else {
                    sourceLayers.push({ name, layer });
                }
            });
            
            // Render cutouts first (bottom), then others, then offsets (top)
            const cutoutLayers = sourceLayers.filter(({ layer }) => layer.type === 'cutout');
            const nonCutoutLayers = sourceLayers.filter(({ layer }) => layer.type !== 'cutout');

            cutoutLayers.forEach(({ layer }) => this.renderLayer(layer));
            nonCutoutLayers.forEach(({ layer }) => this.renderLayer(layer));
            fusedLayers.forEach(({ layer }) => this.renderLayer(layer));
            offsetLayers.forEach(({ layer }) => this.renderOffsetLayer(layer));
            previewLayers.forEach(({ layer }) => this.renderPreviewLayer(layer));
            toolpathLayers.forEach(({ layer }) => this.renderLayer(layer));
        }
        
        // ==================== LAYER RENDERING WITH CULLING AND CONTEXT ====================
        
        renderLayer(layer) {
            const theme = this.core.colors[this.options.theme] || this.core.colors.dark;
            let fillColor = this.core.getLayerColorSettings(layer, theme);
            
            if (this.options.blackAndWhite) {
                fillColor = theme.canvas.background === '#0f0f0f' ? '#ffffff' : '#000000';
            }

            const viewBounds = this.core.getViewBounds();
            this.renderLayerPrimitives(layer, viewBounds, fillColor); // Correctly delegates
        }
        
        renderLayerPrimitives(layer, viewBounds, fillColor, strokeColor = null) {
            const vb = viewBounds || this.core.getViewBounds();
            
            // Set common layer state ONCE
            this.ctx.fillStyle = fillColor;
            if (strokeColor) this.ctx.strokeStyle = strokeColor;
            
            let simpleFlashBatch = null;

            const flushFlashBatch = () => {
                if (simpleFlashBatch) {
                    this.ctx.fill(simpleFlashBatch, 'nonzero');
                    this.core.renderStats.drawCalls++;
                    simpleFlashBatch = null;
                }
            };

            layer.primitives.forEach((primitive) => {
                this.core.renderStats.primitives++;
                
                const primBounds = primitive.getBounds();
                if (!this.core.boundsIntersect(primBounds, vb) || !this.core.shouldRenderPrimitive(primitive, layer.type)) {
                    this.core.renderStats.skippedPrimitives++;
                    return;
                }
                
                if (this.shouldCollectDebugPoints(primitive)) {
                    this.debugPrimitives.push(primitive);
                }
                
                this.core.renderStats.renderedPrimitives++;
                
                // Drills need different state (outline + center marks)
                if (primitive.properties?.isDrillHole) {
                    flushFlashBatch();
                    this.ctx.save();
                    this.primitiveRenderer.renderDrillHole(primitive, fillColor, strokeColor);
                    this.ctx.restore();
                    this.core.renderStats.drawCalls++;
                    return;
                }
                
                // Paths can't be batched (winding complexity)
                if (primitive.type === 'path') {
                    flushFlashBatch();
                    this.primitiveRenderer.renderPrimitiveNormal(primitive, fillColor, strokeColor, layer.isPreprocessed);
                    this.core.renderStats.drawCalls++;
                    return;
                }
                
                // Batch simple shapes (circle, rectangle, obround)
                if (primitive.type === 'circle' || primitive.type === 'rectangle' || primitive.type === 'obround') {
                    if (!simpleFlashBatch) {
                        simpleFlashBatch = new Path2D();
                    }
                    this.primitiveRenderer.addPrimitiveToPath2D(primitive, simpleFlashBatch);
                } else {
                    // Unknown type, render individually
                    flushFlashBatch();
                    this.primitiveRenderer.renderPrimitiveNormal(primitive, fillColor, strokeColor, layer.isPreprocessed);
                    this.core.renderStats.drawCalls++;
                }
            });
            
            flushFlashBatch();
        }

        
        // ==================== SPECIALIZED LAYER RENDERERS (WITH BATCHING) ====================

        renderOffsetLayer(layer) {
            const viewBounds = this.core.getViewBounds();
            const offsetColor = layer.color || '#ff0000';
            
            // Create a single Path2D object for the entire layer.
            const layerBatch = new Path2D();

            layer.primitives.forEach((primitive) => {
                this.core.renderStats.primitives++;
                
                const primBounds = primitive.getBounds();
                if (!this.core.boundsIntersect(primBounds, viewBounds) || !this.core.shouldRenderPrimitive(primitive, 'offset')) {
                    this.core.renderStats.skippedPrimitives++;
                    return;
                }
                
                if (this.shouldCollectDebugPoints(primitive)) {
                    this.debugPrimitives.push(primitive);
                }
                
                this.core.renderStats.renderedPrimitives++;
                
                this.primitiveRenderer.addPrimitiveToPath2D(primitive, layerBatch);
            });

            // Perform a SINGLE stroke operation for the entire layer. This is a huge optimization.
            this.ctx.strokeStyle = offsetColor;
            this.ctx.lineWidth = 2 / this.core.viewScale;
            this.ctx.setLineDash([]);
            this.ctx.stroke(layerBatch);
            this.core.renderStats.drawCalls++;
        }

        renderPreviewLayer(layer) {
            const viewBounds = this.core.getViewBounds();
            const previewColor = layer.color || '#0080ff';
            
            // Use a Map to group primitives by tool diameter (our batching key).
            const batchesByTool = new Map();

            layer.primitives.forEach((primitive) => {
                this.core.renderStats.primitives++;
                
                const primBounds = primitive.getBounds();
                if (!this.core.boundsIntersect(primBounds, viewBounds) || !this.core.shouldRenderPrimitive(primitive, 'preview')) {
                    this.core.renderStats.skippedPrimitives++;
                    return;
                }
                
                if (this.shouldCollectDebugPoints(primitive)) {
                    this.debugPrimitives.push(primitive);
                }
                
                this.core.renderStats.renderedPrimitives++;
                
                const toolDiameter = layer.metadata?.toolDiameter || 
                                    primitive.properties?.toolDiameter ||
                                    this.getToolDiameterForPrimitive(primitive) || 
                                    0.2;
                
                if (!batchesByTool.has(toolDiameter)) {
                    batchesByTool.set(toolDiameter, new Path2D());
                }
                const batch = batchesByTool.get(toolDiameter);

                this.primitiveRenderer.addPrimitiveToPath2D(primitive, batch);
            });

            // Iterate through the map and render each batch with its correct tool width.
            this.ctx.strokeStyle = previewColor;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
            
            batchesByTool.forEach((batch, toolDiameter) => {
                this.ctx.lineWidth = toolDiameter;
                this.ctx.stroke(batch);
                this.core.renderStats.drawCalls++;
            });
        }

        renderWireframeLayer(layer) {
            const theme = this.core.colors[this.options.theme] || this.core.colors.dark;
            const viewBounds = this.core.getViewBounds();
            const wireframeBatch = new Path2D();

            layer.primitives.forEach((primitive) => {
                this.core.renderStats.primitives++;
                const primBounds = primitive.getBounds();
                if (!this.core.boundsIntersect(primBounds, viewBounds)) {
                    this.core.renderStats.skippedPrimitives++;
                    return;
                }
                this.core.renderStats.renderedPrimitives++;
                // Use the existing logic to add any primitive type to the batch
                this.primitiveRenderer.addPrimitiveToPath2D(primitive, wireframeBatch);
            });

            // Perform a single stroke operation for the entire layer
            this.ctx.strokeStyle = theme.debug?.wireframe || '#00ff00';
            this.ctx.lineWidth = this.core.getWireframeStrokeWidth();
            this.ctx.fillStyle = 'transparent'; // Ensure no fill
            this.ctx.setLineDash([]);
            this.ctx.stroke(wireframeBatch);
            this.core.renderStats.drawCalls++;
        }

        
        // ==================== HELPER METHODS ====================
        
        getToolDiameterForPrimitive(primitive) {
            const opId = primitive.properties?.operationId;
            
            if (!opId || !this.camCore || !this.camCore.operations) {
                return null;
            }
            
            const operation = this.camCore.operations.find(op => op.id === opId);
            const diameterStr = operation?.settings?.toolDiameter;
            
            if (diameterStr !== undefined) {
                const diameter = parseFloat(diameterStr);
                return isNaN(diameter) ? null : diameter;
            }
            
            return null;
        }
        
        shouldCollectDebugPoints(primitive) {
            const anyDebugEnabled = this.options.debugPoints || this.options.debugPaths;
            if (!anyDebugEnabled) return false;
            
            // Collect paths with points or contours
            if (primitive.type === 'path') {
                if ((primitive.points && primitive.points.length > 0) || 
                    (primitive.contours && primitive.contours.length > 0)) {
                    return true;
                }
            }
            
            // Collect circles/arcs for property display
            if (primitive.type === 'circle' || primitive.type === 'arc') {
                return true;
            }
            
            return false;
        }
        
        // ==================== DEBUG OVERLAY ====================
        
        renderDebugOverlay() {
            if (!this.debugPrimitivesScreen || this.debugPrimitivesScreen.length === 0) return;
            
            this.ctx.save();
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            
            this.debugPrimitivesScreen.forEach(primitive => {
                this.primitiveRenderer.renderDebugInfo(primitive, this.options);
            });
            
            this.ctx.restore();
        }
        
        // ==================== PUBLIC API ====================
        
        zoomFit(padding) {
            this.core.calculateOverallBounds();
            this.core.zoomFit(padding);
            this.render();
        }
        
        zoomIn() {
            this.core.zoomIn();
            this.render();
        }
        
        zoomOut() {
            this.core.zoomOut();
            this.render();
        }
        
        zoomToPoint(worldX, worldY, factor) {
            this.core.zoomToPoint(worldX, worldY, factor);
            this.render();
        }
        
        pan(dx, dy) {
            this.core.pan(dx, dy);
            this.render();
        }
        
        resizeCanvas() {
            this.core.resizeCanvas();
            this.render();
        }
        
        worldToCanvasX(worldX) {
            return this.core.worldToCanvasX(worldX);
        }
        
        worldToCanvasY(worldY) {
            return this.core.worldToCanvasY(worldY);
        }
        
        canvasToWorld(canvasX, canvasY) {
            return this.core.canvasToWorld(canvasX, canvasY);
        }
        
        worldToScreen(worldX, worldY) {
            return this.core.worldToScreen(worldX, worldY);
        }
        
        screenToWorld(screenX, screenY) {
            return this.core.screenToWorld(screenX, screenY);
        }
        
        getViewBounds() {
            return this.core.getViewBounds();
        }
        
        getWireframeStrokeWidth() {
            return this.core.getWireframeStrokeWidth();
        }
        
        calculateOverallBounds() {
            return this.core.calculateOverallBounds();
        }
        
        // Coordinate system integration
        setOriginPosition(x, y) {
            this.core.setOriginPosition(x, y);
            this.render();
        }
        
        setRotation(angle, center) {
            this.core.setRotation(angle, center);
            this.render();
        }
        
        getOriginPosition() {
            return { x: this.core.originPosition?.x || 0, y: this.core.originPosition?.y || 0 };
        }
        
        getViewState() {
            return this.core.getViewState?.() || {
                offset: { ...this.viewOffset },
                scale: this.viewScale,
                bounds: this.bounds,
                rotation: this.core.rotation?.angle || 0
            };
        }
        
        setViewState(state) {
            if (this.core.setViewState) {
                this.core.setViewState(state);
            } else {
                if (state.offset) this.core.viewOffset = { ...state.offset };
                if (state.scale !== undefined) this.core.viewScale = state.scale;
            }
            this.render();
        }
        
        getBackgroundColor() {
            return this.core.getBackgroundColor?.() || '#0f0f0f';
        }
        
        destroy() {
            if (this.interactionHandler) {
                this.interactionHandler.destroy();
            }
        }
    }
    
    window.LayerRenderer = LayerRenderer;
})();