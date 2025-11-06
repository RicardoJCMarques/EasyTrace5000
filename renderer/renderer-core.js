/**
 * @file        renderer/renderer-core.js
 * @description Coordinates canvas, view and layer states
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
    const renderConfig = config.rendering || {};
    const themeConfig = renderConfig.themes || {};
    const canvasConfig = renderConfig.canvas || {};
    const debugConfig = config.debug || {};
    
    class RendererCore {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d', { 
                alpha: false,
                desynchronized: true
            });
            
            if (!this.ctx) {
                throw new Error('Could not get 2D context from canvas');
            }
            
            // View state
            this.viewOffset = { x: 0, y: 0 };
            this.viewScale = canvasConfig.defaultZoom || 10;
            this.isDragging = false;
            this.lastMousePos = null;
            
            // Origin and rotation state
            this.originPosition = { x: 0, y: 0 };
            this.currentRotation = 0;
            this.rotationCenter = { x: 0, y: 0 };
            this.rotation = {
                angle: 0,
                center: { x: 0, y: 0 }
            };
            
            // Bounds
            this.bounds = null;
            this.overallBounds = null;
            
            // Layers storage
            this.layers = new Map();
            
            // Render options
            this.options = {
                showWireframe: renderConfig.defaultOptions?.showWireframe || false,
                showGrid: renderConfig.defaultOptions?.showGrid !== false,
                showOrigin: renderConfig.defaultOptions?.showOrigin !== false,
                showBounds: renderConfig.defaultOptions?.showBounds || false,
                showRulers: renderConfig.defaultOptions?.showRulers !== false,
                showPads: renderConfig.defaultOptions?.showPads !== false,
                showRegions: renderConfig.defaultOptions?.showRegions !== false,
                showTraces: renderConfig.defaultOptions?.showTraces !== false,
                showDrills: renderConfig.defaultOptions?.showDrills !== false,
                showCutouts: renderConfig.defaultOptions?.showCutouts !== false,
                fuseGeometry: renderConfig.defaultOptions?.fuseGeometry || false,
                showPreprocessed: false,
                blackAndWhite: renderConfig.defaultOptions?.blackAndWhite || false,
                debugPoints: renderConfig.defaultOptions?.debugPoints || false,
                debugPaths: renderConfig.defaultOptions?.debugPaths || false,
                theme: renderConfig.defaultOptions?.theme,
                showStats: renderConfig.defaultOptions?.showStats || false,
                showToolPreview: false
            };
            
            // Color schemes
            this.colors = themeConfig;
            
            // Statistics
            this.renderStats = {
                lastRenderTime: 0,
                renderTime: 0,
                primitives: 0,
                renderedPrimitives: 0,
                skippedPrimitives: 0,
                drawCalls: 0,
                lastSignificantChange: null
            };
            
            // Coordinate system reference
            this.coordinateSystem = null;
            this.rendererType = 'canvas2d';
        }
        
        // Layer Management
        
        addLayer(name, primitives, options = {}) {
            this.layers.set(name, {
                name: name,
                primitives: primitives,
                type: options.type || 'source',
                visible: options.visible !== false,
                color: options.color,
                isFused: options.isFused || false,
                isPreprocessed: options.isPreprocessed || false,
                isOffset: options.type === 'offset',
                isPreview: options.type === 'preview' || options.isPreview,
                operationId: options.operationId,
                operationType: options.operationType,
                offsetType: options.offsetType,
                distance: options.distance,
                metadata: options.metadata || {},
                bounds: options.bounds || this.calculateLayerBounds(primitives)
            });
            
            this.calculateOverallBounds();
            this.renderStats.lastSignificantChange = 'layer-added';
        }
        
        removeLayer(name) {
            this.layers.delete(name);
            this.calculateOverallBounds();
            this.renderStats.lastSignificantChange = 'layer-removed';
        }
        
        clearLayers() {
            this.layers.clear();
            this.overallBounds = null;
            this.bounds = null;
            this.renderStats.lastSignificantChange = 'layers-cleared';
        }
        
        getVisibleLayers() {
            const visible = new Map();
            this.layers.forEach((layer, name) => {
                if (layer.visible) {
                    visible.set(name, layer);
                }
            });
            return visible;
        }
        
        // View bounds & Culling
        
        getViewBounds() {
            // Get the 4 corners of the canvas in world space
            const corners = [
                this.canvasToWorld(0, 0),                       // Top-left
                this.canvasToWorld(this.canvas.width, 0),       // Top-right
                this.canvasToWorld(this.canvas.width, this.canvas.height), // Bottom-right
                this.canvasToWorld(0, this.canvas.height)        // Bottom-left
            ];

            // Find the AABB that encloses those 4 world points
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;

            corners.forEach(corner => {
                minX = Math.min(minX, corner.x);
                minY = Math.min(minY, corner.y);
                maxX = Math.max(maxX, corner.x);
                maxY = Math.max(maxY, corner.y);
            });
            
            return { minX, minY, maxX, maxY };
        }
        
        boundsIntersect(b1, b2) {
            return !(b2.minX > b1.maxX || 
                     b2.maxX < b1.minX || 
                     b2.minY > b1.maxY || 
                     b2.maxY < b1.minY);
        }
        
        // Level Of Detail & Visibility
        
        shouldRenderPrimitive(primitive, layerType) {
            if (primitive.properties?.isFused) {
                return true;
            }
            
            if (primitive.properties?.isDrillHole || layerType === 'drill') {
                return this.options.showDrills;
            }
            
            if (primitive.properties?.isCutout || layerType === 'cutout') {
                return this.options.showCutouts;
            }
            
            if (primitive.properties?.isRegion) {
                return this.options.showRegions;
            }
            
            if (primitive.properties?.isPad || primitive.properties?.isFlash) {
                return this.options.showPads;
            }
            
            if (primitive.properties?.isTrace || primitive.properties?.stroke) {
                return this.options.showTraces;
            }
            
            // LOD check - skip sub-pixel primitives
            const bounds = primitive.getBounds();
            const screenWidth = (bounds.maxX - bounds.minX) * this.viewScale;
            const screenHeight = (bounds.maxY - bounds.minY) * this.viewScale;
            
            if (screenWidth < 0.5 && screenHeight < 0.5) {
                return false;
            }
            
            return true;
        }
        
        // Coordinate Transforms
        
        setupTransform() {
            this.ctx.save();
            this.ctx.translate(this.viewOffset.x, this.viewOffset.y);
            this.ctx.scale(this.viewScale, -this.viewScale);
            
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
        }
        
        resetTransform() {
            this.ctx.restore();
        }
        
        // World to canvas coordinate conversion
        worldToCanvasX(worldX) {
            return this.viewOffset.x + worldX * this.viewScale;
        }
        
        worldToCanvasY(worldY) {
            return this.viewOffset.y - worldY * this.viewScale;
        }
        
        // Canvas to world coordinate conversion
        canvasToWorld(canvasX, canvasY) {
            return {
                x: (canvasX - this.viewOffset.x) / this.viewScale,
                y: -(canvasY - this.viewOffset.y) / this.viewScale
            };
        }
        
        // World to screen coordinate conversion (for debug overlays)
        worldToScreen(worldX, worldY) {
            return {
                x: this.worldToCanvasX(worldX),
                y: this.worldToCanvasY(worldY)
            };
        }
        
        // Screen to world coordinate conversion
        screenToWorld(screenX, screenY) {
            return this.canvasToWorld(screenX, screenY);
        }
        
        // Bounds Calculations
        
        calculateLayerBounds(primitives) {
            if (!primitives || primitives.length === 0) {
                return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
            }
            
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            let validCount = 0;
            
            primitives.forEach((primitive, index) => {
                try {
                    if (typeof primitive.getBounds !== 'function') {
                        if (debugConfig.validation?.warnOnInvalidData) {
                            console.warn(`Primitive ${index} missing getBounds()`);
                        }
                        return;
                    }
                    
                    const bounds = primitive.getBounds();
                    
                    if (!bounds || !isFinite(bounds.minX) || !isFinite(bounds.minY) ||
                        !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                        if (debugConfig.validation?.warnOnInvalidData) {
                            console.warn(`Primitive ${index} invalid bounds:`, bounds);
                        }
                        return;
                    }
                    
                    minX = Math.min(minX, bounds.minX);
                    minY = Math.min(minY, bounds.minY);
                    maxX = Math.max(maxX, bounds.maxX);
                    maxY = Math.max(maxY, bounds.maxY);
                    validCount++;
                    
                } catch (error) {
                    if (debugConfig.validation?.warnOnInvalidData) {
                        console.warn(`Primitive ${index} bounds calculation failed:`, error);
                    }
                }
            });
            
            if (validCount === 0) {
                return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
            }
            
            return { minX, minY, maxX, maxY };
        }
        
        calculateOverallBounds() {
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            let hasContent = false;
            
            this.layers.forEach((layer) => {
                if (!layer.primitives || layer.primitives.length === 0) return;
                if (!layer.visible) return;
                
                if (layer.bounds) {
                    minX = Math.min(minX, layer.bounds.minX);
                    minY = Math.min(minY, layer.bounds.minY);
                    maxX = Math.max(maxX, layer.bounds.maxX);
                    maxY = Math.max(maxY, layer.bounds.maxY);
                    hasContent = true;
                } else {
                    // Calculate bounds if not cached
                    layer.primitives.forEach((primitive) => {
                        const bounds = primitive.getBounds();
                        minX = Math.min(minX, bounds.minX);
                        minY = Math.min(minY, bounds.minY);
                        maxX = Math.max(maxX, bounds.maxX);
                        maxY = Math.max(maxY, bounds.maxY);
                        hasContent = true;
                    });
                }
            });
            
            if (hasContent && isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY)) {
                this.overallBounds = {
                    minX, minY, maxX, maxY,
                    width: maxX - minX,
                    height: maxY - minY,
                    centerX: (minX + maxX) / 2,
                    centerY: (minY + maxY) / 2
                };
                this.bounds = this.overallBounds; // Alias for compatibility
            } else {
                this.overallBounds = null;
                this.bounds = null;
            }
        }
        
        // Zoom & Pan
        
        zoomFit(padding = 1.1) {
            if (!this.overallBounds) {
                this.viewScale = 10;
                this.viewOffset = { x: this.canvas.width / 2, y: this.canvas.height / 2 };
                return;
            }
            
            const bounds = this.overallBounds;
            const canvasAspect = this.canvas.width / this.canvas.height;
            const boundsAspect = bounds.width / bounds.height;
            
            let scale;
            if (boundsAspect > canvasAspect) {
                scale = this.canvas.width / (bounds.width * padding);
            } else {
                scale = this.canvas.height / (bounds.height * padding);
            }
            
            this.viewScale = Math.max(0.1, scale);
            this.viewOffset = {
                x: this.canvas.width / 2 - bounds.centerX * this.viewScale,
                y: this.canvas.height / 2 + bounds.centerY * this.viewScale
            };
        }
        
        zoomIn(factor = 1.2) {
            const centerX = this.canvas.width / 2;
            const centerY = this.canvas.height / 2;
            this.zoomToPoint(centerX, centerY, factor);
        }
        
        zoomOut(factor = 1.2) {
            const centerX = this.canvas.width / 2;
            const centerY = this.canvas.height / 2;
            this.zoomToPoint(centerX, centerY, 1 / factor);
        }
        
        zoomToPoint(canvasX, canvasY, factor) {
            // Get world position at cursor before zoom
            const worldBefore = this.canvasToWorld(canvasX, canvasY);
            
            // Apply zoom
            this.viewScale *= factor;
            this.viewScale = Math.max(0.01, Math.min(1000, this.viewScale));
            
            // Get world position at cursor after zoom
            const worldAfter = this.canvasToWorld(canvasX, canvasY);
            
            // Adjust offset to keep the same world point under cursor
            this.viewOffset.x += (worldAfter.x - worldBefore.x) * this.viewScale;
            this.viewOffset.y -= (worldAfter.y - worldBefore.y) * this.viewScale;
        }
        
        pan(dx, dy) {
            this.viewOffset.x += dx;
            this.viewOffset.y += dy;
        }
        
        // Canvas Management
        
        resizeCanvas() {
            const container = this.canvas.parentElement;
            if (!container) return;
            
            const rect = container.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            
            const logicalWidth = rect.width;
            const logicalHeight = rect.height;

            // Set the drawing buffer size to the physical pixel count
            this.canvas.width = logicalWidth * dpr;
            this.canvas.height = logicalHeight * dpr;
            
            // Set the element's display size in CSS logical pixels
            this.canvas.style.width = logicalWidth + 'px';
            this.canvas.style.height = logicalHeight + 'px';
            
            // Clear canvas immediately
            const theme = this.colors[this.options.theme];
            this.ctx.fillStyle = theme.canvas?.background || '#0f0f0f';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        clearCanvas() {
            const theme = this.colors[this.options.theme];
            const backgroundColor = theme.canvas?.background || '#0f0f0f';
            
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.fillStyle = backgroundColor;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
        
        // Rendering Utilities
        
        getWireframeStrokeWidth() {
            const baseWidth = canvasConfig.wireframe?.baseThickness || 0.08;
            const minWidth = canvasConfig.wireframe?.minThickness || 0.02;
            const maxWidth = canvasConfig.wireframe?.maxThickness || 0.2;
            
            const scaledWidth = baseWidth / this.viewScale;
            return Math.max(minWidth, Math.min(maxWidth, scaledWidth));
        }
        
        setOptions(options) {
            const oldOptions = { ...this.options };
            Object.assign(this.options, options);
            
            const changed = Object.keys(options).some(key => oldOptions[key] !== options[key]);
            if (changed) {
                if (options.theme) {
                    this.renderStats.lastSignificantChange = 'theme-changed';
                } else {
                    this.renderStats.lastSignificantChange = 'options-changed';
                }
            }
        }
        
        setCoordinateSystem(coordinateSystem) {
            this.coordinateSystem = coordinateSystem;
        }
        
        // Origin & Rotation
        
        setOriginPosition(x, y) {
            this.originPosition.x = x;
            this.originPosition.y = y;
        }
        
        getOriginPosition() {
            return { ...this.originPosition };
        }
        
        setRotation(angle, center) {
            this.currentRotation = angle || 0;
            this.rotation = {
                angle: angle || 0,
                center: center || { x: 0, y: 0 }
            };
            if (center) {
                this.rotationCenter.x = center.x;
                this.rotationCenter.y = center.y;
            }
        }
        
        applyRotationTransform() {
            if (!this.rotation || this.rotation.angle === 0) return;
            
            const center = this.rotation.center;
            const radians = (this.rotation.angle * Math.PI) / 180;
            
            this.ctx.translate(center.x, center.y);
            this.ctx.rotate(radians);
            this.ctx.translate(-center.x, -center.y);
        }
        
        // Color & Theme
        
        getLayerColorSettings(layer, theme) {
            if (layer.color) {
                return layer.color;
            }
            
            const colors = theme.layers || {};
            switch (layer.type) {
                case 'isolation': return colors.isolation;
                case 'clear': return colors.clear;
                case 'drill': return colors.drill;
                case 'cutout': return colors.cutout;
                case 'offset': return '#ff0000';
                case 'preview': return '#00ffff';
                case 'toolpath': return colors.toolpath;
                case 'fused': return colors.fused;
                default: return colors.copper;
            }
        }
        
        getBackgroundColor() {
            const theme = this.colors[this.options.theme];
            return theme.canvas?.background || '#0f0f0f';
        }
        
        // View State
        
        getViewState() {
            return {
                offset: { ...this.viewOffset },
                scale: this.viewScale,
                bounds: this.bounds ? { ...this.bounds } : null,
                rotation: this.currentRotation,
                transform: this.getTransformMatrix()
            };
        }
        
        setViewState(state) {
            if (state.offset) {
                this.viewOffset = { ...state.offset };
            }
            if (state.scale !== undefined) {
                this.viewScale = state.scale;
            }
            if (state.rotation !== undefined) {
                this.currentRotation = state.rotation;
            }
        }
        
        getTransformMatrix() {
            if (this.currentRotation === 0 && this.originPosition.x === 0 && this.originPosition.y === 0) {
                return null;
            }
            
            return {
                originOffset: { ...this.originPosition },
                rotation: this.currentRotation,
                rotationCenter: { ...this.rotationCenter }
            };
        }
        
        // Rendering Timing
        
        beginRender() {
            this.renderStats.primitives = 0;
            this.renderStats.renderedPrimitives = 0;
            this.renderStats.skippedPrimitives = 0;
            this.renderStats.drawCalls = 0;
            this.clearCanvas();
            return performance.now();
        }
        
        endRender(startTime) {
            const endTime = performance.now();
            this.renderStats.renderTime = endTime - startTime;
            this.renderStats.lastRenderTime = Date.now();
            
            if (this.renderStats.lastSignificantChange && debugConfig.enabled) {
                console.log(`Rendered ${this.renderStats.renderedPrimitives} primitives in ${this.renderStats.renderTime.toFixed(1)}ms (${this.renderStats.lastSignificantChange})`);
                this.renderStats.lastSignificantChange = null;
            }
        }
    }
    
    window.RendererCore = RendererCore;
})();