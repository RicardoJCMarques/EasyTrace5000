// renderer/layer-renderer.js
// Simplified orchestrator that combines core, primitive, overlay, and interaction components

(function() {
    'use strict';
    
    const config = window.PCBCAMConfig || {};
    const debugConfig = config.debug || {};
    const opsConfig = config.operations || {};
    
    class LayerRenderer {
        constructor(canvasId) {
            const canvas = document.getElementById(canvasId);
            if (!canvas) {
                throw new Error(`Canvas element with id '${canvasId}' not found`);
            }
            
            this.canvas = canvas;
            
            // Initialize components
            this.core = new RendererCore(canvas);
            this.primitiveRenderer = new PrimitiveRenderer(this.core);
            this.overlayRenderer = new OverlayRenderer(this.core);
            this.interaction = new InteractionHandler(this);
            
            // Coordinate system reference
            this.coordinateSystem = null;
            
            // Create property accessors for compatibility
            this._createPropertyAccessors();
            
            if (debugConfig.enabled) {
                console.log('LayerRenderer initialized with modular architecture');
            }
        }
        
        _createPropertyAccessors() {
            // Create accessors for backward compatibility
            const properties = [
                'viewOffset', 'viewScale', 'bounds', 'options', 'colors', 
                'layers', 'renderStats', 'originPosition', 'currentRotation', 
                'rotationCenter'
            ];
            
            properties.forEach(prop => {
                Object.defineProperty(this, prop, {
                    get: () => this.core[prop],
                    set: (value) => { this.core[prop] = value; }
                });
            });
        }
        
        render() {
            const startTime = this.core.beginRender();
            
            this.core.setupTransform();
            
            // Render grid if enabled
            if (this.options.showGrid) {
                this.overlayRenderer.renderGrid();
            }
            
            // Render bounds if enabled
            if (this.options.showBounds && this.bounds) {
                this.overlayRenderer.renderBounds();
            }
            
            // Render layers
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
            
            // Render UI overlays
            if (this.options.showRulers) {
                this.overlayRenderer.renderRulers();
            }
            
            this.overlayRenderer.renderScaleIndicator();
            this.overlayRenderer.renderStats();
            
            this.core.endRender(startTime);
        }
        
        renderLayers() {
            const fusedLayers = [];
            const preprocessedLayers = [];
            const regularLayers = [];
            
            this.layers.forEach((layer, name) => {
                if (layer.isFused) {
                    fusedLayers.push(layer);
                } else if (layer.isPreprocessed) {
                    preprocessedLayers.push(layer);
                } else {
                    regularLayers.push(layer);
                }
            });
            
            // Render fused layers first
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
            
            // Render regular layers by type
            const renderOrder = ['cutout', 'clear', 'isolation', 'drill'];
            renderOrder.forEach(type => {
                regularLayers.forEach(layer => {
                    if (layer.visible && layer.type === type) {
                        this.renderLayer(layer);
                    }
                });
            });
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
                
                this.primitiveRenderer.renderPrimitive(primitive, fillColor, strokeColor, isPreprocessed);
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
                
                this.primitiveRenderer.renderPrimitive(primitive, fillColor, strokeColor, false);
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
                this.primitiveRenderer.renderPrimitive(primitive, 'transparent', color, false);
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