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
    const opsConfig = config.operations || {};
    
    class LayerRenderer {
        constructor(canvasId, camCore) {
            const canvas = document.getElementById(canvasId);
            if (!canvas) {
                throw new Error(`Canvas element with id '${canvasId}' not found`);
            }

            this.canvas = canvas;

            this.camCore = camCore;
            
            // Initialize components
            this.core = new RendererCore(canvas);
            this.primitiveRenderer = new PrimitiveRenderer(this.core);
            this.overlayRenderer = new OverlayRenderer(this.core);
            this.interaction = new InteractionHandler(this);
            
            // Coordinate system reference
            this.coordinateSystem = null;
            
            // Track debug primitives for overlay
            this.debugPrimitives = [];
            
            // Create property accessors for compatibility
            this._createPropertyAccessors();

            // Rendering refresh-rate limits
            this._renderQueued = false;
            this._renderTimeout = null;
            
            if (debugConfig.enabled) {
                console.log('LayerRenderer initialized with modular architecture');
            }
        }

        getToolDiameterForPrimitive(primitive) {
            const opId = primitive.properties?.operationId;
            
            // Check for core instance and operation ID
            if (!opId || !this.camCore || !this.camCore.operations) {
                return null;
            }
            
            // Find the operation object by ID
            const operation = this.camCore.operations.find(op => op.id === opId);
            
            // The value is read as a string from the settings object
            const diameterStr = operation?.settings?.toolDiameter;
            
            // FIX: Corrected variable name in the log message to avoid confusion.
            if (typeof diameterStr === 'undefined') {
                console.warn(`[Renderer] getToolDiameterForPrimitive - diameter setting not found for opId: ${opId}`);
            }
            
            if (diameterStr !== undefined) {
                const diameter = parseFloat(diameterStr);
                return isNaN(diameter) ? null : diameter;
            }
            
            return null; 
        }

        
        _createPropertyAccessors() {
            // Create accessors for backward compatibility
            const properties = [
                'viewOffset', 'viewScale', 'bounds', 'options', 'colors', 
                'layers', 'renderStats', 'originPosition', 'currentRotation', 
                'rotationCenter', 'ctx'
            ];
            
            properties.forEach(prop => {
                Object.defineProperty(this, prop, {
                    get: () => this.core[prop],
                    set: (value) => { this.core[prop] = value; }
                });
            });
        }

        render() {
            // Render refresh-rate limiter
            if (this._renderQueued) return;
            this._renderQueued = true;
            this._renderTimeout = setTimeout(() => {
                this._renderQueued = false;
                this._actualRender();
            }, 16); // ~60fps
        }
        
        _actualRender() {
            const startTime = this.core.beginRender();
            
            // Clear debug primitives tracking
            this.debugPrimitives = [];
            
            this.core.setupTransform();
            
            // Phase 1: Background elements
            if (this.options.showGrid) {
                this.overlayRenderer.renderGrid();
            }
            
            // Render bounds if enabled
            if (this.options.showBounds && this.bounds) {
                this.overlayRenderer.renderBounds();
            }
            
            // Phase 2: Main geometry - collect debug info but don't render debug visuals
            this.renderLayers();
            
            this.core.resetTransform();
            
            // Render origin marker with special transform
            this.canvas.getContext('2d').save();
            this.canvas.getContext('2d').translate(this.viewOffset.x, this.viewOffset.y);
            this.canvas.getContext('2d').scale(this.viewScale, -this.viewScale);
            if (this.options.showOrigin) {
                this.overlayRenderer.renderOrigin();
            }
            this.canvas.getContext('2d').restore();
            
            // Phase 3: UI overlays
            if (this.options.showRulers) {
                this.overlayRenderer.renderRulers();
            }
            
            this.overlayRenderer.renderScaleIndicator();
            this.overlayRenderer.renderStats();
            
            // Phase 4: Debug visualization overlay (always on top)
            if (this.options.debugCurvePoints) {
                this.renderDebugOverlay();
            }
            
            this.core.endRender(startTime);
        }
        
        renderDebugOverlay() {
            // Create a separate canvas context state for debug rendering
            const ctx = this.canvas.getContext('2d');
            ctx.save();
            
            // Set up for screen-space rendering
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            
            // Reset debug stats
            this.primitiveRenderer.debugStats = {
                totalPoints: 0,
                taggedPoints: 0,
                curvePoints: new Map()
            };
            
            // Render all debug information for collected primitives
            this.debugPrimitives.forEach(primitive => {
                if (primitive.type === 'path' && primitive.points) {
                    this.primitiveRenderer.renderCurveMetadataDebug(primitive);
                }
            });
            
            // Always show stats when debugging curve points
            if (this.primitiveRenderer.debugStats.totalPoints > 0) {
                this.primitiveRenderer.renderDebugStatistics();
            }
            
            ctx.restore();
        }
        
        renderLayers() {
            const fusedLayers = [];
            const preprocessedLayers = [];
            const offsetLayers = [];
            const previewLayers = [];
            const regularLayers = [];
            

            if (debugConfig.enabled && debugConfig.logging?.renderOperations) {
                console.log('[Renderer] renderLayers called, total layers:', this.layers.size);
           }

            this.layers.forEach((layer, name) => {
                if (layer.isFused) {
                    fusedLayers.push(layer);
                } else if (layer.isPreprocessed) {
                    preprocessedLayers.push(layer);
                } else if (layer.type === 'offset') {
                    offsetLayers.push(layer);
                } else if (layer.type === 'preview') {
                    previewLayers.push(layer);
                } else {
                    regularLayers.push(layer);
                }
            });

            // Render regular layers last
            const renderOrder = ['cutout', 'clear', 'isolation', 'drill'];
            renderOrder.forEach(type => {
                regularLayers.forEach(layer => {
                    if (layer.visible && layer.type === type) {
                        this.renderLayer(layer);
                    }
                });
            });
            
            // Render fused layers
            fusedLayers.forEach(layer => {
                if (layer.visible) {
                    this.renderLayerDirect(layer, false);
                }
            });
            
            // Render preprocessed layers
            preprocessedLayers.forEach(layer => {
                if (layer.visible) {
                    this.renderLayerDirect(layer, true);
                }
            });

            // Render offset layers
            offsetLayers.forEach(layer => {
                if (layer.visible) this.renderOffsetLayer(layer);
            });

            // Render preview layers
            previewLayers.forEach(layer => {
                if (layer.visible) this.renderPreviewLayer(layer);
            });
            
            if (debugConfig.enabled && debugConfig.logging?.renderOperations) {
                console.log('[Renderer] Offset layers found:', offsetLayers);
            }
        }
        
        renderLayerDirect(layer, isPreprocessed = false) {
            const theme = this.colors[this.options.theme] || this.colors.dark;
            const layerColor = layer.color || theme.layers.fused;
            
            layer.primitives.forEach((primitive) => {
                this.renderStats.primitives++;
                this.renderStats.renderedPrimitives++;
                
                let fillColor = layerColor;
                let strokeColor = layerColor;
                
                if (this.options.blackAndWhite) {
                    const bwColor = this.options.theme === 'dark' ? '#ffffff' : '#000000';
                    fillColor = bwColor;
                    strokeColor = bwColor;
                }
                
                // Collect primitives for debug overlay but don't render debug here
                if (this.options.debugCurvePoints && primitive.type === 'path') {
                    this.debugPrimitives.push(primitive);
                }

                let context = {};
                const isPreview = primitive.properties?.isPreview === true;

                if (isPreview) {
                    const toolDiameter = this.getToolDiameterForPrimitive(primitive);
                    context.toolDiameter = toolDiameter; // DATA INJECTION
                    console.warn(`[Renderer] renderLayerDirect - tool diameter: (${toolDiameter})`);
                }
                
                // Render primitive without inline debug
                const originalDebugState = this.options.debugCurvePoints;
                this.options.debugCurvePoints = false;
                this.primitiveRenderer.renderPrimitive(primitive, fillColor, strokeColor, isPreprocessed, context);
                this.options.debugCurvePoints = originalDebugState;
            });
        }
        
        renderLayer(layer) {
            const theme = this.colors[this.options.theme] || this.colors.dark;
            const layerColor = this.core.getLayerColorSettings(layer, theme);
            
            layer.primitives.forEach((primitive) => {
                this.renderStats.primitives++;
                
                if (primitive.properties?.operationType && primitive.properties.operationType !== layer.type) {
                    this.renderStats.skippedPrimitives++;
                    return;
                }
                
                if (layer.type === 'cutout') {
                    if (!this.options.showCutouts) {
                        this.renderStats.skippedPrimitives++;
                        return;
                    }
                    this.renderCutoutPrimitive(primitive, layerColor);
                    return;
                }
                
                if (!this.core.shouldRenderPrimitive(primitive, layer.type)) {
                    this.renderStats.skippedPrimitives++;
                    return;
                }
                
                this.renderStats.renderedPrimitives++;
                
                let fillColor = layerColor;
                let strokeColor = layerColor;
                
                if (primitive.properties?.isNonConductor) {
                    fillColor = theme.layers.nonConductor;
                    strokeColor = theme.layers.nonConductor;
                }
                
                if (this.options.blackAndWhite) {
                    const bwColor = this.options.theme === 'dark' ? '#ffffff' : '#000000';
                    fillColor = bwColor;
                    strokeColor = bwColor;
                }
                
                // Collect primitives for debug overlay but don't render debug here
                if (this.options.debugCurvePoints && primitive.type === 'path') {
                    this.debugPrimitives.push(primitive);
                }
                
                // Render primitive without inline debug
                const originalDebugState = this.options.debugCurvePoints;
                this.options.debugCurvePoints = false;
                this.primitiveRenderer.renderPrimitive(primitive, fillColor, strokeColor, false, {});
                this.options.debugCurvePoints = originalDebugState;
            });
        }

        renderOffsetLayer(layer) {
            if (debugConfig.enabled && debugConfig.logging?.renderOperations) {
                console.log(`[Renderer] Rendering offset layer: ${layer.primitives.length} primitives`);
            }
            
            const offsetColor = layer.color || '#a00000ff';
            
            layer.primitives.forEach(primitive => {
                this.renderStats.primitives++;
                this.renderStats.renderedPrimitives++;
                
                // Collect for debug overlay
                if (this.options.debugCurvePoints && primitive.type === 'path') {
                    this.debugPrimitives.push(primitive);
                }
                
                this.ctx.save();
                this.ctx.lineWidth = 1 / this.core.viewScale / 4;

                const originalDebugState = this.options.debugCurvePoints;
                this.options.debugCurvePoints = false;
                this.primitiveRenderer.renderPrimitive(
                    primitive,
                    'transparent',
                    offsetColor,
                    false,
                    {} 

                );
                this.options.debugCurvePoints = originalDebugState;
                
                this.ctx.restore();
            });
        }

        renderPreviewLayer(layer) {
            const toolDiameter = layer.metadata?.toolDiameter;
            
            layer.primitives.forEach(primitive => {
                this.renderStats.primitives++;
                this.renderStats.renderedPrimitives++;
                
                if (this.options.debugCurvePoints && primitive.type === 'path') {
                    this.debugPrimitives.push(primitive);
                }
                this.ctx.save();
                this.ctx.fillStyle = 'transparent';
                this.ctx.strokeStyle = layer.color;
                
                const originalDebugState = this.options.debugCurvePoints;
                this.options.debugCurvePoints = false;
                
                this.primitiveRenderer.renderPrimitive(
                    primitive, 
                    'transparent', 
                    layer.color, 
                    false, 
                    // FIX: Add a flag to tell the dispatcher this is a preview context.
                    { toolDiameter: toolDiameter, isPreviewRender: true }
                );

                if (typeof toolDiameter === 'undefined') {
                     console.warn(`[Renderer] renderPreviewLayer - tool diameter is undefined for layer: ${layer.name}`);
                }

                this.options.debugCurvePoints = originalDebugState;
                
                this.ctx.restore();
            });
        }
        
        renderCutoutPrimitive(primitive, color) {
            this.renderStats.renderedPrimitives++;
            
            const ctx = this.canvas.getContext('2d');
            ctx.save();
            ctx.fillStyle = 'transparent';
            ctx.strokeStyle = color;
            ctx.lineWidth = this.options.showWireframe ? 
                this.core.getWireframeStrokeWidth() : 
                this.core.getWireframeStrokeWidth();
            
            if (primitive.type === 'path' && primitive.points) {
                ctx.beginPath();
                primitive.points.forEach((point, i) => {
                    if (i === 0) {
                        ctx.moveTo(point.x, point.y);
                    } else {
                        ctx.lineTo(point.x, point.y);
                    }
                });
                if (primitive.closed) {
                    ctx.closePath();
                }
                ctx.stroke();
            } else {
                // Disable inline debug for cutouts too
                const originalDebugState = this.options.debugCurvePoints;
                this.options.debugCurvePoints = false;
                this.primitiveRenderer.renderPrimitive(primitive, 'transparent', color, false, {});
                this.options.debugCurvePoints = originalDebugState;
            }
            
            ctx.restore();
        }
        
        // Public API methods
        setOptions(options) {
            this.core.setOptions(options);
            this.render();
        }
        
        addLayer(name, primitives, options = {}) {
            this.core.addLayer(name, primitives, options);
            this.render();
        }
        
        clearLayers() {
            this.core.clearLayers();
            this.render();
        }
        
        calculateOverallBounds() {
            this.core.calculateOverallBounds();
        }
        
        setOriginPosition(x, y) {
            this.core.setOriginPosition(x, y);
            this.render();
        }
        
        setRotation(angle, center) {
            this.core.setRotation(angle, center);
            this.render();
        }
        
        getOriginPosition() {
            return this.core.getOriginPosition();
        }
        
        getBackgroundColor() {
            return this.core.getBackgroundColor();
        }
        
        getViewState() {
            return this.core.getViewState();
        }
        
        setViewState(state) {
            this.core.setViewState(state);
            this.render();
        }
        
        getTransformMatrix() {
            return this.core.getTransformMatrix();
        }
        
        getVisibleLayers() {
            return this.core.getVisibleLayers();
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
        
        getViewBounds() {
            return this.core.getViewBounds();
        }
        
        // Coordinate system integration
        setCoordinateSystem(coordinateSystem) {
            this.coordinateSystem = coordinateSystem;
            if (debugConfig.enabled) {
                console.log('Coordinate system linked to renderer');
            }
        }
        
        getCoordinateSystem() {
            return this.coordinateSystem;
        }
        
        // Public interaction methods
        zoomIn(centerX, centerY) {
            this.interaction.zoomIn(centerX, centerY);
        }
        
        zoomOut(centerX, centerY) {
            this.interaction.zoomOut(centerX, centerY);
        }
        
        zoomFit() {
            this.interaction.zoomFit();
        }
        
        pan(dx, dy) {
            this.interaction.pan(dx, dy);
        }
        
        setZoom(scale, centerX, centerY) {
            this.interaction.setZoom(scale, centerX, centerY);
        }
        
        destroy() {
            if (this.interaction) {
                this.interaction.destroy();
            }
        }
    }
    
    // Export
    window.LayerRenderer = LayerRenderer;
    
})();