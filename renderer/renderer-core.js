/*!
 * @file        renderer/renderer-core.js
 * @description Coordinates canvas, view and layer states
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
            this.originIncludedInFit = false;

            // Origin and rotation state
            this.originPosition = { x: 0, y: 0 };
            this.currentRotation = 0;
            this.rotationCenter = { x: 0, y: 0 };
            this.rotation = { angle: 0, center: { x: 0, y: 0 } };

            // Mirror state
            this.mirrorX = false;
            this.mirrorY = false;
            this.mirrorCenter = { x: 0, y: 0 };

            // Bounds
            this.bounds = null;
            this.overallBounds = null;

            // Layers storage
            this.layers = new Map();

            // Device pixel ratio
            this.devicePixelRatio = 1;

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
                showOffsets: defaultconfig.showOffsets,
                showPreviews: defaultconfig.showPreviews,
                showPreprocessed: defaultconfig.showPreprocessed,
                enableArcReconstruction: defaultconfig.enableArcReconstruction,
                blackAndWhite: defaultconfig.blackAndWhite,
                debugPoints: defaultconfig.debugPoints,
                debugArcs: defaultconfig.debugArcs,
                showToolPreview: defaultconfig.showToolPreview,
                theme: defaultconfig.theme,
                showStats: defaultconfig.showStats
            };

            // LOD threshold (screen pixels)
            this.lodThreshold = config.renderer.lodThreshold || 0.5;

            // Color schemes
            this.colors = {};
            this._updateThemeColors();

            window.addEventListener('themechange', () => {
                this._updateThemeColors();
                this.renderStats.lastSignificantChange = 'theme-changed';
            });

            // Statistics
            this.renderStats = {
                lastRenderTime: 0,
                renderTime: 0,
                primitives: 0,
                renderedPrimitives: 0,
                skippedPrimitives: 0,
                culledViewport: 0,
                culledLOD: 0,
                drawCalls: 0,
                lastSignificantChange: null
            };

            // Frame cache for per-frame calculations
            this.frameCache = {
                invScale: 1,
                minWorldWidth: 1,
                viewBounds: null
            };

            this.coordinateSystem = null;
            this.rendererType = 'canvas2d';
            this.lastMouseCanvasPos = { x: 0, y: 0 };
        }

        // ========================================================================
        // Layer Management
        // ========================================================================

        addLayer(name, primitives, options = {}) {
            const layer = {
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
                bounds: this.calculateLayerBounds(primitives),
                // Lightweight cache
                renderCache: null
            };

            this.layers.set(name, layer);
            this._buildLayerBoundsCache(layer);
            this.calculateOverallBounds();
            this.renderStats.lastSignificantChange = 'layer-added';
        }

        /**
         * Builds lightweight bounds cache for culling
         * This is the key optimization: cache bounds for fast culling, but don't pay the Path2D allocation cost.
         */
        _buildLayerBoundsCache(layer) {
            if (!layer.primitives || layer.primitives.length === 0) {
                layer.renderCache = { entries: [], bounds: null, valid: true };
                return;
            }

            const entries = [];
            // Cache global layer tool diameter if available
            const layerToolDia = layer.metadata?.toolDiameter || 0;

            for (const prim of layer.primitives) {
                let bounds;
                try {
                    bounds = prim.getBounds();
                    if (!bounds || !isFinite(bounds.minX)) continue;
                } catch (e) { continue; }

                let width = bounds.maxX - bounds.minX;
                let height = bounds.maxY - bounds.minY;

                const props = prim.properties || {};
                let inflation = 0;

                // Peck Marks & Centerline Slots (Critical Operational Data)
                // These contain crosshairs or drill hits that must remain visible even if the geometry itself is a tiny dot.
                if (props.role === 'peck_mark' || 
                    props.isToolPeckMark || 
                    props.isCenterlinePath || 
                    props.role === 'drill_milling_path') {

                    // Set to Infinity to effectively disable LOD culling for these items.
                    // They will still be culled by Viewport (off-screen), but never by size.
                    inflation = Infinity; 
                }
                // Previews & Thick Traces
                // If it's a tool preview, the visual size is Geometry + ToolDiameter
                else if (layer.isPreview || layer.type === 'preview') {
                    inflation = props.toolDiameter || layerToolDia || 0;
                }
                // Stroked Primitives (Standard)
                else if (props.stroke && props.strokeWidth) {
                    inflation = props.strokeWidth;
                }

                // Apply Inflation - If Infinity, screenSize becomes Infinity (always passes LOD)
                const screenSize = (inflation === Infinity) 
                    ? Infinity 
                    : Math.max(width, height) + inflation;

                entries.push({
                    primitive: prim,
                    bounds: bounds, // Keep geometric bounds for Viewport Culling (accurate)
                    screenSize: screenSize // Use Inflated bounds for LOD Culling (visual)
                });
            }

            layer.renderCache = {
                entries: entries,
                bounds: layer.bounds,
                valid: true
            };
        }

        invalidateLayerCache(layerName) {
            const layer = this.layers.get(layerName);
            if (layer && layer.renderCache) {
                layer.renderCache.valid = false;
            }
        }

        rebuildLayerCache(layerName) {
            const layer = this.layers.get(layerName);
            if (layer) {
                this._buildLayerBoundsCache(layer);
            }
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
            this.originIncludedInFit = false;
            this.renderStats.lastSignificantChange = 'layers-cleared';
        }

        getVisibleLayers() {
            const visible = new Map();
            this.layers.forEach((layer, name) => {
                if (layer.visible) visible.set(name, layer);
            });
            return visible;
        }

        // ========================================================================
        // View Bounds & Culling Helpers
        // ========================================================================

        getViewBounds() {
            const corners = [
                this.canvasToWorld(0, 0),
                this.canvasToWorld(this.canvas.width, 0),
                this.canvasToWorld(this.canvas.width, this.canvas.height),
                this.canvasToWorld(0, this.canvas.height)
            ];

            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;

            corners.forEach(c => {
                minX = Math.min(minX, c.x);
                minY = Math.min(minY, c.y);
                maxX = Math.max(maxX, c.x);
                maxY = Math.max(maxY, c.y);
            });

            return { minX, minY, maxX, maxY };
        }

        boundsIntersect(b1, b2) {
            return !(b2.minX > b1.maxX || 
                     b2.maxX < b1.minX || 
                     b2.minY > b1.maxY || 
                     b2.maxY < b1.minY);
        }

        /**
         * LOD culling check - rejects sub-pixel primitives.
         */
        passesLODCull(screenSize, viewScale, threshold) {
            const dpr = this.devicePixelRatio || 1;
            const screenSizeCSS = (screenSize * viewScale) / dpr;
            return screenSizeCSS >= threshold;
        }

        /**
         * Visibility check based on primitive properties and render options.
         */
        shouldRenderPrimitive(primitive, layerType) {
            if (primitive.properties?.isFused) return true;

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

            return true;
        }

        // ========================================================================
        // Coordinate Transforms
        // ========================================================================

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

        worldToCanvasX(worldX) {
            return this.viewOffset.x + worldX * this.viewScale;
        }

        worldToCanvasY(worldY) {
            return this.viewOffset.y - worldY * this.viewScale;
        }

        canvasToWorld(canvasX, canvasY) {
            return {
                x: (canvasX - this.viewOffset.x) / this.viewScale,
                y: -(canvasY - this.viewOffset.y) / this.viewScale
            };
        }

        worldToScreen(worldX, worldY) {
            return {
                x: this.worldToCanvasX(worldX),
                y: this.worldToCanvasY(worldY)
            };
        }

        // ========================================================================
        // Bounds Calculations
        // ========================================================================

        calculateLayerBounds(primitives) {
            if (!primitives || primitives.length === 0) {
                return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
            }

            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            let validCount = 0;

            primitives.forEach((primitive, index) => {
                try {
                    if (typeof primitive.getBounds !== 'function') return;
                    const bounds = primitive.getBounds();
                    if (!bounds || !isFinite(bounds.minX)) return;

                    minX = Math.min(minX, bounds.minX);
                    minY = Math.min(minY, bounds.minY);
                    maxX = Math.max(maxX, bounds.maxX);
                    maxY = Math.max(maxY, bounds.maxY);
                    validCount++;
                } catch (error) {
                    if (debugConfig.validation?.warnOnInvalidData) {
                        console.warn(`[RendererCore] Primitive ${index} bounds failed:`, error);
                    }
                }
            });

            if (validCount === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
            return { minX, minY, maxX, maxY };
        }

        calculateOverallBounds() {
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            let hasContent = false;

            this.layers.forEach((layer) => {
                if (!layer.primitives || layer.primitives.length === 0) return;
                if (!layer.visible) return;

                const b = layer.bounds;
                if (b) {
                    minX = Math.min(minX, b.minX);
                    minY = Math.min(minY, b.minY);
                    maxX = Math.max(maxX, b.maxX);
                    maxY = Math.max(maxY, b.maxY);
                    hasContent = true;
                }
            });

            if (hasContent && isFinite(minX)) {
                this.overallBounds = {
                    minX, minY, maxX, maxY,
                    width: maxX - minX,
                    height: maxY - minY,
                    centerX: (minX + maxX) / 2,
                    centerY: (minY + maxY) / 2
                };
                this.bounds = this.overallBounds;
            } else {
                this.overallBounds = null;
                this.bounds = null;
            }
        }

        // ========================================================================
        // Zoom & Pan
        // ========================================================================

        zoomFit(includeOrigin = false) {
            if (!this.overallBounds) {
                const emptyConfig = config.renderer.emptyCanvas;
                this.viewScale = emptyConfig.defaultScale;
                const canvasX = this.canvas.width * emptyConfig.originMarginLeft;
                const canvasY = this.canvas.height * (1 - emptyConfig.originMarginBottom);
                this.viewOffset = { x: canvasX, y: canvasY };
                return;
            }

            // Use wider padding only if origin placement checked AND not fitted
            const useWidePadding = includeOrigin && !this.originIncludedInFit;
            const fitPadding = useWidePadding 
                ? config.renderer.zoom.fitPaddingWithOrigin 
                : config.renderer.zoom.fitPadding;

            let bounds = { ...this.overallBounds };

            // Transform bounds to visual space if mirrored
            if (this.mirrorX || this.mirrorY) {
                bounds = this._getVisualBounds(bounds);
            }

            if (includeOrigin) {
                const origin = this.originPosition || { x: 0, y: 0 };
                bounds = {
                    minX: Math.min(bounds.minX, origin.x),
                    minY: Math.min(bounds.minY, origin.y),
                    maxX: Math.max(bounds.maxX, origin.x),
                    maxY: Math.max(bounds.maxY, origin.y)
                };
                bounds.width = bounds.maxX - bounds.minX;
                bounds.height = bounds.maxY - bounds.minY;
                bounds.centerX = (bounds.minX + bounds.maxX) / 2;
                bounds.centerY = (bounds.minY + bounds.maxY) / 2;

                this.originIncludedInFit = true;
            }

            // Recalculate derived values if not already set
            if (bounds.width === undefined) {
                bounds.width = bounds.maxX - bounds.minX;
                bounds.height = bounds.maxY - bounds.minY;
                bounds.centerX = (bounds.minX + bounds.maxX) / 2;
                bounds.centerY = (bounds.minY + bounds.maxY) / 2;
            }

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

        /**
         * Returns bounds in visual space after mirror transform.
         */
        _getVisualBounds(bounds) {
            const cx = this.mirrorCenter.x;
            const cy = this.mirrorCenter.y;

            let { minX, maxX, minY, maxY } = bounds;

            if (this.mirrorX) {
                const newMinX = 2 * cx - maxX;
                const newMaxX = 2 * cx - minX;
                minX = newMinX;
                maxX = newMaxX;
            }

            if (this.mirrorY) {
                const newMinY = 2 * cy - maxY;
                const newMaxY = 2 * cy - minY;
                minY = newMinY;
                maxY = newMaxY;
            }

            return {
                minX, minY, maxX, maxY,
                width: maxX - minX,
                height: maxY - minY,
                centerX: (minX + maxX) / 2,
                centerY: (minY + maxY) / 2
            };
        }

        zoomIn(factor = config.renderer.zoom.factor) {
            const cx = this.canvas.width / 2;
            const cy = this.canvas.height / 2;
            this.zoomToPoint(cx, cy, factor);
        }

        zoomOut(factor = config.renderer.zoom.factor) {
            const cx = this.canvas.width / 2;
            const cy = this.canvas.height / 2;
            this.zoomToPoint(cx, cy, 1 / factor);
        }

        zoomToPoint(canvasX, canvasY, factor) {
            const worldBefore = this.canvasToWorld(canvasX, canvasY);
            this.viewScale *= factor;
            this.viewScale = Math.max(config.renderer.zoom.min, 
                             Math.min(config.renderer.zoom.max, this.viewScale));
            this.viewOffset.x = canvasX - worldBefore.x * this.viewScale;
            this.viewOffset.y = canvasY + worldBefore.y * this.viewScale;
        }

        pan(dx, dy) {
            this.viewOffset.x += dx;
            this.viewOffset.y += dy;
        }

        // ========================================================================
        // Canvas Management
        // ========================================================================

        resizeCanvas() {
            const container = this.canvas.parentElement;
            if (!container) return;

            const rect = container.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;

            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            this.canvas.style.width = rect.width + 'px';
            this.canvas.style.height = rect.height + 'px';

            this.devicePixelRatio = dpr;

            this.ctx.imageSmoothingEnabled = true;
            this.ctx.imageSmoothingQuality = 'high';

            this.ctx.fillStyle = this.colors.canvas?.background || '#1a1a2e';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        clearCanvas() {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.fillStyle = this.colors.canvas.background;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        // ========================================================================
        // Rendering Utilities
        // ========================================================================

        getWireframeStrokeWidth() {
            const base = canvasConfig.wireframe.baseThickness;
            const min = canvasConfig.wireframe.minThickness;
            const max = canvasConfig.wireframe.maxThickness;
            const scaled = base / this.viewScale;
            const dpr = this.devicePixelRatio || 1;
            const minVisible = dpr / this.viewScale;
            return Math.max(min, Math.min(max, Math.max(scaled, minVisible)));
        }

        setOptions(options) {
            const oldOptions = { ...this.options };
            Object.assign(this.options, options);
            const changed = Object.keys(options).some(k => oldOptions[k] !== options[k]);
            if (changed) {
                this.renderStats.lastSignificantChange = options.theme ? 'theme-changed' : 'options-changed';
            }
        }

        setCoordinateSystem(coordinateSystem) {
            this.coordinateSystem = coordinateSystem;
        }

        // ========================================================================
        // Origin, Rotation and Mirroring
        // ========================================================================

        setOriginPosition(x, y) {
            this.originPosition.x = x;
            this.originPosition.y = y;
        }

        getOriginPosition() {
            return { ...this.originPosition };
        }

        setRotation(angle, center) {
            this.currentRotation = angle || 0;
            this.rotation = { angle: angle || 0, center: center || { x: 0, y: 0 } };
            if (center) {
                this.rotationCenter.x = center.x;
                this.rotationCenter.y = center.y;
            }
        }

        applyRotationTransform() {
            if (!this.rotation || this.rotation.angle === 0) return;
            const c = this.rotation.center;
            const rad = (this.rotation.angle * Math.PI) / 180;
            this.ctx.translate(c.x, c.y);
            this.ctx.rotate(rad);
            this.ctx.translate(-c.x, -c.y);
        }

        setMirror(mirrorX, mirrorY, center) {
            this.mirrorX = mirrorX || false;
            this.mirrorY = mirrorY || false;
            if (center) {
                this.mirrorCenter.x = center.x;
                this.mirrorCenter.y = center.y;
            }
        }

        getMirrorState() {
            return {
                mirrorX: this.mirrorX,
                mirrorY: this.mirrorY,
                mirrorCenter: { ...this.mirrorCenter }
            };
        }

        // ========================================================================
        // Color & Theme
        // ========================================================================

        _updateThemeColors() {
            const rootStyle = getComputedStyle(document.documentElement);
            const read = (varName) => rootStyle.getPropertyValue(varName).trim();

            this.colors = {
                source: {
                    isolation: read('--color-geometry-source-isolation'),
                    drill: read('--color-geometry-source-drill'),
                    clearing: read('--color-geometry-source-clearing'),
                    cutout: read('--color-geometry-source-cutout'),
                    fused: read('--color-geometry-source-isolation')
                },
                operations: {
                    isolation: read('--color-operation-isolation'),
                    drill: read('--color-operation-drill'),
                    clearing: read('--color-operation-clearing'),
                    cutout: read('--color-operation-cutout'),
                },
                canvas: {
                    background: read('--color-canvas-background'),
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
                    peckMarkGood: read('--color-primitive-peck-mark-good'), 
                    peckMarkWarn: read('--color-primitive-peck-mark-warn'),
                    peckMarkError: read('--color-primitive-peck-mark-error'),
                    peckMarkSlow: read('--color-primitive-peck-mark-slow'),
                    reconstructed: read('--color-primitive-reconstructed'),
                    reconstructedPath: read('--color-primitive-reconstructed-path'),
                    debugLabel: read('--color-primitive-debug-label'),
                    debugLabelStroke: read('--color-primitive-debug-label-stroke')
                },
                debug: {
                    wireframe: read('--color-debug-wireframe'),
                    bounds: read('--color-debug-bounds'),
                    points: read('--color-debug-points'),
                    arcs: read('--color-debug-arcs')
                },
                bw: {
                    black: read('--color-bw-black'),
                    white: read('--color-bw-white')
                }
            };
        }

        getLayerColorSettings(layer) {
            const geo = this.colors.geometry;
            const src = this.colors.source;

            switch (layer.type) {
                case 'isolation': return src.isolation;
                case 'clearing':  return src.clearing;
                case 'drill':     return src.drill;
                case 'cutout':    return src.cutout;
                case 'fused':     return src.fused;
                case 'offset':
                    switch (layer.offsetType) { 
                        case 'external': return geo.offset.external;
                        case 'internal': return geo.offset.internal;
                        case 'on':       return geo.offset.on;
                    }
                    return '#FF0000';
                case 'preview':
                    return geo.preview;
                default: 
                    return src.isolation;
            }
        }

        // ========================================================================
        // View State
        // ========================================================================

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
            if (state.offset) this.viewOffset = { ...state.offset };
            if (state.scale !== undefined) this.viewScale = state.scale;
            if (state.rotation !== undefined) this.currentRotation = state.rotation;
        }

        getTransformMatrix() {
            if (this.currentRotation === 0 && 
                this.originPosition.x === 0 && 
                this.originPosition.y === 0) {
                return null;
            }
            return {
                originOffset: { ...this.originPosition },
                rotation: this.currentRotation,
                rotationCenter: { ...this.rotationCenter }
            };
        }

        // ========================================================================
        // Rendering Timing
        // ========================================================================

        beginRender() {
            this.renderStats.primitives = 0;
            this.renderStats.renderedPrimitives = 0;
            this.renderStats.skippedPrimitives = 0;
            this.renderStats.culledViewport = 0;
            this.renderStats.culledLOD = 0;
            this.renderStats.drawCalls = 0;

            // Pre-calculate frame constants ONCE
            const dpr = this.devicePixelRatio || 1;
            this.frameCache.invScale = 1 / this.viewScale;
            this.frameCache.minWorldWidth = dpr / this.viewScale;

            // Get view bounds in screen-world space
            let viewBounds = this.getViewBounds();

            // Transform view bounds to source-geometry space if mirrored
            // This makes culling work correctly without per-primitive transforms
            if (this.mirrorX || this.mirrorY) {
                viewBounds = this._transformBoundsForMirror(viewBounds);
            }

            this.frameCache.viewBounds = viewBounds;

            this.clearCanvas();
            return performance.now();
        }

        /**
         * Transforms view bounds into source-geometry space by applying inverse mirror.
         */
        _transformBoundsForMirror(bounds) {
            const cx = this.mirrorCenter.x;
            const cy = this.mirrorCenter.y;

            let { minX, maxX, minY, maxY } = bounds;

            if (this.mirrorX) {
                // Reflect across vertical line x = cx
                const newMinX = 2 * cx - maxX;
                const newMaxX = 2 * cx - minX;
                minX = newMinX;
                maxX = newMaxX;
            }

            if (this.mirrorY) {
                // Reflect across horizontal line y = cy
                const newMinY = 2 * cy - maxY;
                const newMaxY = 2 * cy - minY;
                minY = newMinY;
                maxY = newMaxY;
            }

            return { minX, minY, maxX, maxY };
        }

        endRender(startTime) {
            const endTime = performance.now();
            this.renderStats.renderTime = endTime - startTime;
            this.renderStats.lastRenderTime = Date.now();

            if (this.renderStats.lastSignificantChange && debugConfig.enabled) {
                console.log(`[RendererCore] Rendered ${this.renderStats.renderedPrimitives} prims, ` +
                    `${this.renderStats.drawCalls} draws, ${this.renderStats.renderTime.toFixed(1)}ms ` +
                    `(${this.renderStats.lastSignificantChange})`);
                this.renderStats.lastSignificantChange = null;
            }
        }
    }

    window.RendererCore = RendererCore;
})();