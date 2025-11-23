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

    const config = window.PCBCAMConfig;
    const renderConfig = config.rendering;
    const defaultconfig = renderConfig.defaultOptions;
    const canvasConfig = renderConfig.canvas;
    const debugConfig = config.debug;

    class RendererCore {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d', { 
                alpha: config.renderer.context.alpha,
                desynchronized: config.renderer.context?.desynchronized
            });

            if (!this.ctx) {
                throw new Error('Could not get 2D context from canvas');
            }

            // View state
            this.viewOffset = { x: 0, y: 0 };
            this.viewScale = canvasConfig.defaultZoom;
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
                showWireframe: defaultconfig.showWireframe,
                showGrid: defaultconfig.showGrid,
                showOrigin: defaultconfig.showOrigin,
                showBounds: defaultconfig.showBounds,
                showRulers: defaultconfig.showRulers,
                showPads: defaultconfig.showPads,
                showRegions: defaultconfig.showRegions,
                showTraces: defaultconfig.showTraces,
                showDrills: defaultconfig.showDrills,
                showCutouts: defaultconfig.showCutouts,
                fuseGeometry: defaultconfig.fuseGeometry,
                showPreprocessed: false,
                blackAndWhite: defaultconfig.blackAndWhite,
                debugPoints: defaultconfig.debugPoints,
                debugPaths: defaultconfig.debugPaths,
                theme: defaultconfig.theme,
                showStats: defaultconfig.showStats,
                showToolPreview: false
            };

            // Color schemes
            this.colors = {}; // Initialize empty
            this._updateThemeColors(); // Populate from CSS

            // Listen for theme changes from theme-loader.js
            window.addEventListener('themechange', () => {
                this._updateThemeColors();
                // Set a flag for external render() method
                this.renderStats.lastSignificantChange = 'theme-changed';
                // When main LayerRenderer calls render() it'll check this variable for changes
            });

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

            // Track mouse position for zoom center
            this.lastMouseCanvasPos = { x: 0, y: 0 }; 
        }

        // Layer Management

        addLayer(name, primitives, options = {}) {
            this.layers.set(name, {
                name: name,
                primitives: primitives,
                type: options.type,
                visible: options.visible,
                color: options.color,
                isFused: options.isFused,
                isPreprocessed: options.isPreprocessed,
                isOffset: options.type === 'offset',
                isPreview: options.type === 'preview',
                operationId: options.operationId,
                operationType: options.operationType,
                offsetType: options.offsetType,
                distance: options.distance,
                metadata: options.metadata,
                bounds: this.calculateLayerBounds(primitives)
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

            // Find the Axis Adjusted Bounding Box that encloses those 4 world points
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

            const role = primitive.properties?.role;
            if (role === 'drill_slot' || role === 'drill_milling_path' || role === 'peck_mark') {
                return true;
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

            const lodThreshold = config.renderer.lodThreshold;
            if (screenWidth < lodThreshold && screenHeight < lodThreshold) {
                return false;
            }

            return true;
        }

        // Coordinate Transforms

        setupTransform() {
            this.ctx.save();
            this.ctx.translate(this.viewOffset.x, this.viewOffset.y);
            this.ctx.scale(this.viewScale, -this.viewScale);  // Y-FLIP: Canvas Y-down → World Y-up

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
                        if (debugConfig.enabled) {
                            console.warn(`[RendererCore] Primitive ${index} missing getBounds()`);
                        }
                        return;
                    }

                    const bounds = primitive.getBounds();

                    if (!bounds || !isFinite(bounds.minX) || !isFinite(bounds.minY) ||
                        !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                        if (debugConfig.enabled) {
                            console.warn(`[RendererCore] Primitive ${index} invalid bounds:`, bounds);
                        }
                        return;
                    }

                    minX = Math.min(minX, bounds.minX);
                    minY = Math.min(minY, bounds.minY);
                    maxX = Math.max(maxX, bounds.maxX);
                    maxY = Math.max(maxY, bounds.maxY);
                    validCount++;

                } catch (error) {
                    if (debugConfig.enabled) {
                        console.warn(`[RendererCore] Primitive ${index} bounds calculation failed:`, error);
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
                this.bounds = this.overallBounds; // Alias for compatibility // Review - Check if alias is still necessary
            } else {
                this.overallBounds = null;
                this.bounds = null;
            }
        }

        // Zoom & Pan

        zoomFit() {
            const fitPadding = config.renderer.zoom.fitPadding;

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
                scale = this.canvas.width / (bounds.width * fitPadding);
            } else {
                scale = this.canvas.height / (bounds.height * fitPadding);
            }

            this.viewScale = Math.max(0.1, scale);
            this.viewOffset = {
                x: this.canvas.width / 2 - bounds.centerX * this.viewScale,
                y: this.canvas.height / 2 + bounds.centerY * this.viewScale
            };
        }

        zoomIn(factor = (config.renderer.zoom.factor)) {
            const centerX = this.canvas.width / 2;
            const centerY = this.canvas.height / 2;
            this.zoomToPoint(centerX, centerY, factor);
        }

        zoomOut(factor = (config.renderer.zoom.factor)) {
            const centerX = this.canvas.width / 2;
            const centerY = this.canvas.height / 2;
            this.zoomToPoint(centerX, centerY, 1 / factor);
        }

        zoomToPoint(canvasX, canvasY, factor) {
            // Get world position at point before zoom
            const worldBefore = this.canvasToWorld(canvasX, canvasY);

            // Apply zoom
            this.viewScale *= factor;

            const minZoom = config.renderer.zoom.min;
            const maxZoom = config.renderer.zoom.max;
            this.viewScale = Math.max(minZoom, Math.min(maxZoom, this.viewScale));

            // Set offset so the same world point stays under the canvas point
            this.viewOffset.x = canvasX - worldBefore.x * this.viewScale;
            this.viewOffset.y = canvasY + worldBefore.y * this.viewScale;
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
            const dpr = window.devicePixelRatio;

            const logicalWidth = rect.width;
            const logicalHeight = rect.height;

            // Set the drawing buffer size to the physical pixel count
            this.canvas.width = logicalWidth * dpr;
            this.canvas.height = logicalHeight * dpr;

            // Set the element's display size in CSS logical pixels
            this.canvas.style.width = logicalWidth + 'px';
            this.canvas.style.height = logicalHeight + 'px';

            // Clear canvas immediately
            this.ctx.fillStyle = this.colors.canvas.background;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        clearCanvas() {
            const backgroundColor = this.colors.canvas.background;

            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.fillStyle = backgroundColor;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        // Rendering Utilities

        getWireframeStrokeWidth() {
            const baseWidth = canvasConfig.wireframe.baseThickness;
            const minWidth = canvasConfig.wireframe.minThickness;
            const maxWidth = canvasConfig.wireframe.maxThickness;
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

        // Color & Them

        _updateThemeColors() {
            const rootStyle = getComputedStyle(document.documentElement);
            // Helper to read CSS variables
            const read = (varName) => rootStyle.getPropertyValue(varName).trim();

            this.colors = {
                operations: {
                    isolation: read('--color-operation-isolation'),
                    drill: read('--color-operation-drill'),
                    clearing: read('--color-operation-clearing'),
                    cutout: read('--color-operation-cutout'),
                    toolpath: read('--color-operation-toolpath')
                },
                canvas: {
                    background: read('--color-canvas-bg'),
                    grid: read('--color-canvas-grid'),
                    origin: read('--color-canvas-origin'),
                    originOutline: read('--color-canvas-origin-outline'),
                    bounds: read('--color-canvas-bounds'),
                    ruler: read('--color-canvas-ruler'),
                    rulerText: read('--color-canvas-ruler-text')
                },
                geometry: {
                    offset: {
                        external: read('--color-geometry-offset-external'),
                        internal: read('--color-geometry-offset-internal'),
                        on: read('--color-geometry-offset-on')
                    },
                    preview: read('--color-geometry-preview')
                },
                primitives: {
                    offsetInternal: read('--color-primitive-offset-internal'),
                    offsetExternal: read('--color-primitive-offset-external'),
                    peckMarkGood: read('--color-primitive-peck-good'),
                    peckMarkWarn: read('--color-primitive-peck-warn'),
                    peckMarkError: read('--color-primitive-peck-error'),
                    peckMarkSlow: read('--color-primitive-peck-slow'),
                    reconstructed: read('--color-primitive-reconstructed'),
                    reconstructedPath: read('--color-primitive-reconstructed-path'),
                    debugLabel: read('--color-primitive-debug-label'),
                    debugLabelStroke: read('--color-primitive-debug-label-stroke')
                },
                debug: {
                    wireframe: read('--color-debug-wireframe'),
                    bounds: read('--color-debug-bounds'),
                    hole: read('--color-debug-hole')
                }
            };

            // Maintain 'layers' alias for backward compatibility // Review - Check if alias is still necessary
            this.colors.layers = this.colors.operations;
            // Add a fused alias // Review - Check if alias is still necessary
            this.colors.layers.fused = this.colors.operations.isolation;
        }

        getLayerColorSettings(layer) {
            // Use this.colors which is loaded from live CSS variables.
            const colors = this.colors;

            // 'layers' is an alias for 'operations'
            const opColors = colors.layers; 

            switch (layer.type) {
                case 'isolation': return opColors.isolation;
                case 'clearing':  return opColors.clearing;
                case 'drill':     return opColors.drill;
                case 'cutout':    return opColors.cutout;
                case 'toolpath':  return opColors.toolpath;
                case 'fused':     return opColors.fused || opColors.isolation;

                case 'offset':
                    if (colors.geometry && colors.geometry.offset) {
                        switch (layer.offsetType) { 
                            case 'external': return colors.geometry.offset.external;
                            case 'internal': return colors.geometry.offset.internal;
                            case 'on':       return colors.geometry.offset.on;
                        }
                    }
                    return '#FF0000';
                    
                case 'preview':
                    return (colors.geometry && colors.geometry.preview) ? colors.geometry.preview : '#00FFFF';
                
                default: 
                    return opColors.copper || opColors.isolation;
            }
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
                console.log(`[RendererCore] Rendered ${this.renderStats.renderedPrimitives} primitives in ${this.renderStats.renderTime.toFixed(1)}ms (${this.renderStats.lastSignificantChange})`);
                this.renderStats.lastSignificantChange = null;
            }
        }
    }

    window.RendererCore = RendererCore;
})();