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
            this.ctx = canvas.getContext('2d');
            if (!this.ctx) {
                throw new Error('Could not get 2D context from canvas');
            }
            
            // View state
            this.viewOffset = { x: 0, y: 0 };
            this.viewScale = canvasConfig.defaultZoom || 10;
            this.bounds = null;
            
            // Transform state
            this.originPosition = { x: 0, y: 0 };
            this.currentRotation = 0;
            this.rotationCenter = { x: 0, y: 0 };
            
            // Layers storage
            this.layers = new Map();
            
            // Render options
            this.options = { ...renderConfig.defaultOptions };
            
            // Color schemes
            this.colors = themeConfig;
            
            // Statistics
            this.renderStats = {
                primitives: 0,
                renderTime: 0,
                skippedPrimitives: 0,
                renderedPrimitives: 0,
                holesRendered: 0,
                lastSignificantChange: null
            };
        }
        
        // Options management
        setOptions(options) {
            const oldOptions = { ...this.options };
            Object.assign(this.options, options);
            
            const changed = Object.keys(options).some(key => oldOptions[key] !== options[key]);
            if (changed) {
                if (debugConfig.enabled) {
                    console.log('Renderer options updated:', options);
                }
                this.renderStats.lastSignificantChange = 'options';
            }
        }
        
        // Layer management
        addLayer(name, primitives, options = {}) {
            if (debugConfig.enabled) {
                console.log(`Adding layer "${name}" with ${primitives.length} primitives`);
            }
            
            let holesCount = 0;
            primitives.forEach(p => {
                if (p.holes && p.holes.length > 0) {
                    holesCount += p.holes.length;
                }
            });
            
            this.layers.set(name, {
                name: name,
                primitives: primitives,
                visible: options.visible !== false,
                type: options.type || 'copper',
                bounds: options.bounds || this.calculateLayerBounds(primitives),
                color: options.color || null,
                isFused: options.isFused || false,
                isPreprocessed: options.isPreprocessed || false,
                totalHoles: holesCount,
                metadata: options.metadata || null
            });
            
            this.calculateOverallBounds();
            this.renderStats.lastSignificantChange = 'layer-added';
        }
        
        clearLayers() {
            const layerCount = this.layers.size;
            if (layerCount > 0 && debugConfig.enabled) {
                console.log(`Clearing ${layerCount} layers`);
                this.renderStats.lastSignificantChange = 'layers-cleared';
            }
            this.layers.clear();
            this.bounds = null;
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
        
        // Bounds calculation
        calculateLayerBounds(primitives) {
            if (!primitives || primitives.length === 0) {
                return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
            }
            
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            let validCount = 0;
            let errorCount = 0;
            
            primitives.forEach((primitive, index) => {
                try {
                    // Check for getBounds method
                    if (typeof primitive.getBounds !== 'function') {
                        console.error(`[RendererCore] Primitive ${index} missing getBounds() method`);
                        console.error(`  Type: ${primitive.type || 'unknown'}`);
                        console.error(`  Available methods:`, Object.keys(primitive).filter(k => typeof primitive[k] === 'function'));
                        errorCount++;
                        
                        // Attempt fallback based on primitive type
                        const fallbackBounds = this.getFallbackBounds(primitive);
                        if (fallbackBounds) {
                            minX = Math.min(minX, fallbackBounds.minX);
                            minY = Math.min(minY, fallbackBounds.minY);
                            maxX = Math.max(maxX, fallbackBounds.maxX);
                            maxY = Math.max(maxY, fallbackBounds.maxY);
                            validCount++;
                        }
                        return;
                    }
                    
                    const bounds = primitive.getBounds();
                    
                    // Validate bounds values
                    if (!bounds || 
                        !isFinite(bounds.minX) || !isFinite(bounds.minY) ||
                        !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                        console.error(`[RendererCore] Primitive ${index} returned invalid bounds:`, bounds);
                        errorCount++;
                        return;
                    }
                    
                    minX = Math.min(minX, bounds.minX);
                    minY = Math.min(minY, bounds.minY);
                    maxX = Math.max(maxX, bounds.maxX);
                    maxY = Math.max(maxY, bounds.maxY);
                    validCount++;
                    
                } catch (error) {
                    console.error(`[RendererCore] Error calculating bounds for primitive ${index}:`, error.message);
                    errorCount++;
                }
            });
            
            if (validCount === 0) {
                console.error(`[RendererCore] No valid bounds calculated from ${primitives.length} primitives`);
                // Return safe default bounds
                return { minX: -10, minY: -10, maxX: 10, maxY: 10 };
            }
            
            if (errorCount > 0) {
                console.warn(`[RendererCore] Bounds calculated from ${validCount}/${primitives.length} primitives (${errorCount} errors)`);
            }
            
            return { minX, minY, maxX, maxY };
        }

        // NEW: Fallback bounds calculation for primitives without getBounds
        getFallbackBounds(primitive) {
            if (!primitive || !primitive.type) {
                return null;
            }
            
            try {
                switch (primitive.type) {
                    case 'circle':
                        if (primitive.center && primitive.radius !== undefined) {
                            return {
                                minX: primitive.center.x - primitive.radius,
                                minY: primitive.center.y - primitive.radius,
                                maxX: primitive.center.x + primitive.radius,
                                maxY: primitive.center.y + primitive.radius
                            };
                        }
                        break;
                        
                    case 'path':
                        if (primitive.points && primitive.points.length > 0) {
                            let minX = Infinity, minY = Infinity;
                            let maxX = -Infinity, maxY = -Infinity;
                            
                            primitive.points.forEach(p => {
                                if (p && isFinite(p.x) && isFinite(p.y)) {
                                    minX = Math.min(minX, p.x);
                                    minY = Math.min(minY, p.y);
                                    maxX = Math.max(maxX, p.x);
                                    maxY = Math.max(maxY, p.y);
                                }
                            });
                            
                            if (isFinite(minX)) {
                                return { minX, minY, maxX, maxY };
                            }
                        }
                        break;
                        
                    case 'rectangle':
                        if (primitive.position && primitive.width !== undefined && primitive.height !== undefined) {
                            return {
                                minX: primitive.position.x,
                                minY: primitive.position.y,
                                maxX: primitive.position.x + primitive.width,
                                maxY: primitive.position.y + primitive.height
                            };
                        }
                        break;
                        
                    case 'arc':
                        if (primitive.center && primitive.radius !== undefined) {
                            // Conservative bounds (could be tighter with angle analysis)
                            return {
                                minX: primitive.center.x - primitive.radius,
                                minY: primitive.center.y - primitive.radius,
                                maxX: primitive.center.x + primitive.radius,
                                maxY: primitive.center.y + primitive.radius
                            };
                        }
                        break;
                }
            } catch (error) {
                console.error(`[RendererCore] Fallback bounds failed for ${primitive.type}:`, error.message);
            }
            
            return null;
        }
        
        calculateOverallBounds() {
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            let hasData = false;
            
            this.layers.forEach(layer => {
                if (layer.visible && layer.bounds) {
                    minX = Math.min(minX, layer.bounds.minX);
                    minY = Math.min(minY, layer.bounds.minY);
                    maxX = Math.max(maxX, layer.bounds.maxX);
                    maxY = Math.max(maxY, layer.bounds.maxY);
                    hasData = true;
                }
            });
            
            if (hasData && isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY)) {
                this.bounds = {
                    minX, minY, maxX, maxY,
                    width: maxX - minX,
                    height: maxY - minY,
                    centerX: (minX + maxX) / 2,
                    centerY: (minY + maxY) / 2
                };
            } else {
                this.bounds = null;
            }
        }
        
        // Transform management
        setupTransform() {
            this.ctx.save();
            this.ctx.translate(this.viewOffset.x, this.viewOffset.y);
            this.ctx.scale(this.viewScale, -this.viewScale);
            
            if (this.currentRotation !== 0) {
                this.ctx.translate(this.rotationCenter.x, this.rotationCenter.y);
                this.ctx.rotate((this.currentRotation * Math.PI) / 180);
                this.ctx.translate(-this.rotationCenter.x, -this.rotationCenter.y);
            }
            
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
        }
        
        resetTransform() {
            this.ctx.restore();
        }
        
        // Coordinate conversion
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
        
        getViewBounds() {
            const topLeft = this.canvasToWorld(0, 0);
            const bottomRight = this.canvasToWorld(this.canvas.width, this.canvas.height);
            
            return {
                minX: Math.min(topLeft.x, bottomRight.x),
                maxX: Math.max(topLeft.x, bottomRight.x),
                minY: Math.min(topLeft.y, bottomRight.y),
                maxY: Math.max(topLeft.y, bottomRight.y)
            };
        }
        
        // Origin and rotation
        setOriginPosition(x, y) {
            this.originPosition.x = x;
            this.originPosition.y = y;
        }
        
        setRotation(angle, center) {
            this.currentRotation = angle;
            if (center) {
                this.rotationCenter.x = center.x;
                this.rotationCenter.y = center.y;
            }
        }
        
        getOriginPosition() {
            return { ...this.originPosition };
        }
        
        // View state
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
        
        // Canvas management
        resizeCanvas() {
            const parent = this.canvas.parentElement;
            if (parent) {
                const rect = parent.getBoundingClientRect();
                this.canvas.width = rect.width;
                this.canvas.height = rect.height;
            }
        }
        
        clearCanvas() {
            const theme = this.colors[this.options.theme] || this.colors.dark;
            const colors = theme.canvas;
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.fillStyle = colors.background;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
        
        // Rendering utilities
        getWireframeStrokeWidth() {
            const wireframeCfg = canvasConfig.wireframe || {};
            const baseThickness = wireframeCfg.baseThickness || 0.08;
            const scaleFactor = 1.0 / this.viewScale;
            const minThickness = wireframeCfg.minThickness || 0.02;
            const maxThickness = wireframeCfg.maxThickness || 0.2;
            
            return Math.max(minThickness, Math.min(maxThickness, baseThickness * scaleFactor));
        }
        
        shouldRenderPrimitive(primitive, layerType) {
            if (primitive.properties?.isFused) {
                return true;
            }
            
            if (primitive.properties?.isDrillHole || layerType === 'drill') {
                return this.options.showDrills;
            }
            
            if (primitive.properties?.isTrace || primitive.properties?.isBranchSegment) {
                return this.options.showTraces;
            }
            
            if (primitive.properties?.isFlash || 
                primitive.properties?.isBranchJunction ||
                (primitive.type === 'circle' && !primitive.properties?.isTrace) || 
                (primitive.type === 'rectangle' && !primitive.properties?.isTrace) || 
                primitive.type === 'obround') {
                return this.options.showPads;
            }
            
            if (primitive.properties?.isRegion || 
                (primitive.type === 'path' && primitive.closed && primitive.properties?.fill)) {
                return this.options.showRegions;
            }
            
            if (primitive.type === 'path' && !primitive.closed) {
                return this.options.showTraces;
            }
            
            return true;
        }
        
        getLayerColorSettings(layer, theme) {
            const colors = theme.layers;
            let layerColor;
            
            if (layer.color) {
                layerColor = layer.color;
            } else {
                switch (layer.type) {
                    case 'isolation': layerColor = colors.isolation; break;
                    case 'clear': layerColor = colors.clear; break;
                    case 'drill': layerColor = colors.drill; break;
                    case 'cutout': layerColor = colors.cutout; break;
                    default: layerColor = colors.copper; break;
                }
            }
            
            return layerColor;
        }
        
        getBackgroundColor() {
            const theme = this.colors[this.options.theme] || this.colors.dark;
            return theme.canvas.background;
        }
        
        // Render cycle management
        beginRender() {
            const startTime = performance.now();
            this.renderStats.primitives = 0;
            this.renderStats.skippedPrimitives = 0;
            this.renderStats.renderedPrimitives = 0;
            this.renderStats.holesRendered = 0;
            
            this.clearCanvas();
            return startTime;
        }
        
        endRender(startTime) {
            const endTime = performance.now();
            this.renderStats.renderTime = endTime - startTime;
            
            if (this.renderStats.lastSignificantChange && debugConfig.enabled) {
                console.log(`Rendered ${this.renderStats.renderedPrimitives} primitives with ${this.renderStats.holesRendered} holes (${this.renderStats.lastSignificantChange})`);
                this.renderStats.lastSignificantChange = null;
            }
        }
    }
    
    // Export
    window.RendererCore = RendererCore;
    
})();