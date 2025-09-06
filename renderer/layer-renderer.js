// renderer/layer-renderer.js - Refactored with config integration
// Consolidated rendering module for PCB CAM
// Combines all rendering functionality into a single, encapsulated module

(function() {
    'use strict';
    
    // Get config reference
    const config = window.PCBCAMConfig || {};
    const renderConfig = config.rendering || {};
    const themeConfig = renderConfig.themes || {};
    const canvasConfig = renderConfig.canvas || {};
    const gridConfig = renderConfig.grid || {};
    const debugConfig = config.debug || {};
    const uiConfig = config.ui || {};
    
    // ============================================================================
    // INTERNAL: Renderer Core - Manages canvas, view state, and layers
    // ============================================================================
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
            
            // Track origin position and rotation
            this.originPosition = { x: 0, y: 0 };
            this.currentRotation = 0;
            this.rotationCenter = { x: 0, y: 0 };
            
            // Layers storage
            this.layers = new Map();
            
            // Render options - use config defaults
            this.options = { ...renderConfig.defaultOptions };
            
            // Color schemes from config
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
            
            if (holesCount > 0 && debugConfig.enabled) {
                console.log(`  Layer contains ${holesCount} holes`);
            }
            
            this.layers.set(name, {
                name: name,
                primitives: primitives,
                visible: options.visible !== false,
                type: options.type || 'copper',
                bounds: options.bounds || this.calculateLayerBounds(primitives),
                color: options.color || null,
                isFused: options.isFused || false,
                totalHoles: holesCount
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
        
        calculateLayerBounds(primitives) {
            if (!primitives || primitives.length === 0) {
                return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
            }
            
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            
            primitives.forEach(primitive => {
                const bounds = primitive.getBounds();
                minX = Math.min(minX, bounds.minX);
                minY = Math.min(minY, bounds.minY);
                maxX = Math.max(maxX, bounds.maxX);
                maxY = Math.max(maxY, bounds.maxY);
            });
            
            return { minX, minY, maxX, maxY };
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
        
        getBackgroundColor() {
            const theme = this.colors[this.options.theme] || this.colors.dark;
            return theme.canvas.background;
        }
        
        getViewState() {
            return {
                offset: { ...this.viewOffset },
                scale: this.viewScale,
                bounds: this.bounds ? { ...this.bounds } : null,
                rotation: this.currentRotation,
                transform: this.getTransformMatrix()
            };
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
        
        getVisibleLayers() {
            const visible = new Map();
            this.layers.forEach((layer, name) => {
                if (layer.visible) {
                    visible.set(name, layer);
                }
            });
            return visible;
        }
        
        resizeCanvas() {
            const parent = this.canvas.parentElement;
            if (parent) {
                const rect = parent.getBoundingClientRect();
                this.canvas.width = rect.width;
                this.canvas.height = rect.height;
            }
        }
        
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
    }
    
    // ============================================================================
    // INTERNAL: Primitive Renderer - Handles drawing all primitive types
    // ============================================================================
    class PrimitiveRenderer {
        constructor(core) {
            this.core = core;
            this.ctx = core.ctx;
        }
        
        renderPrimitive(primitive, fillColor, strokeColor) {
            this.ctx.save();
            
            this.ctx.fillStyle = fillColor;
            this.ctx.strokeStyle = strokeColor;
            
            if (this.core.options.showWireframe) {
                this.ctx.lineWidth = this.core.getWireframeStrokeWidth();
                this.renderPrimitiveWireframe(primitive);
            } else {
                this.renderPrimitiveNormal(primitive, fillColor, strokeColor);
            }
            
            this.ctx.restore();
        }
        
        renderPrimitiveNormal(primitive, fillColor, strokeColor) {
            const props = primitive.properties || {};
            
            switch (primitive.type) {
                case 'path':
                    this.renderPathNormal(primitive, props, fillColor, strokeColor);
                    break;
                case 'circle':
                    this.renderCircleNormal(primitive, props, fillColor, strokeColor);
                    break;
                case 'rectangle':
                    this.renderRectangleNormal(primitive, props, fillColor, strokeColor);
                    break;
                case 'obround':
                    this.renderObroundNormal(primitive, props, fillColor, strokeColor);
                    break;
                case 'arc':
                    this.renderArcNormal(primitive, props, strokeColor);
                    break;
            }
        }
        
        renderPathNormal(primitive, props, fillColor, strokeColor) {
            if ((props.hasHoles || primitive.holes) && primitive.holes && primitive.holes.length > 0) {
                this.renderCompoundPath(primitive, props, fillColor, strokeColor);
            } else if (props.isCompound) {
                this.renderLegacyCompoundPath(primitive, props, fillColor);
            } else if (props.isRegion) {
                this.renderRegion(primitive, props, fillColor);
            } else if (props.isTrace || props.isBranchSegment || props.isConnectedPath || 
                    (props.stroke && props.strokeWidth && !props.fill)) {
                this.renderTrace(primitive, props, strokeColor);
            } else if (props.fill !== false) {
                this.renderSimplePath(primitive, props, fillColor);
            }
        }
        
        renderCompoundPath(primitive, props, fillColor, strokeColor) {
            const path2d = new Path2D();
            
            primitive.points.forEach((point, index) => {
                if (index === 0) {
                    path2d.moveTo(point.x, point.y);
                } else {
                    path2d.lineTo(point.x, point.y);
                }
            });
            if (primitive.closed) {
                path2d.closePath();
            }
            
            primitive.holes.forEach(hole => {
                if (hole.length > 0) {
                    path2d.moveTo(hole[0].x, hole[0].y);
                    for (let i = 1; i < hole.length; i++) {
                        path2d.lineTo(hole[i].x, hole[i].y);
                    }
                    path2d.closePath();
                }
            });
            
            this.ctx.fillStyle = fillColor;
            this.ctx.fill(path2d, 'nonzero');
            
            if (this.core.options.debugHoleWinding) {
                this.renderHoleDebug(primitive);
            }
            
            this.core.renderStats.holesRendered += primitive.holes.length;
        }
        
        renderLegacyCompoundPath(primitive, props, fillColor) {
            this.ctx.fillStyle = fillColor;
            this.ctx.beginPath();
            
            let isNewSegment = true;
            primitive.points.forEach(point => {
                if (point === null) {
                    isNewSegment = true;
                } else {
                    if (isNewSegment) {
                        this.ctx.moveTo(point.x, point.y);
                        isNewSegment = false;
                    } else {
                        this.ctx.lineTo(point.x, point.y);
                    }
                }
            });
            
            this.ctx.fill('evenodd');
        }
        
        renderRegion(primitive, props, fillColor) {
            this.ctx.fillStyle = fillColor;
            this.ctx.beginPath();
            
            primitive.points.forEach((point, index) => {
                if (index === 0) {
                    this.ctx.moveTo(point.x, point.y);
                } else {
                    this.ctx.lineTo(point.x, point.y);
                }
            });
            
            if (primitive.closed) {
                this.ctx.closePath();
            }
            
            const fillRule = props.fillRule || 'nonzero';
            this.ctx.fill(fillRule);
        }
        
        renderTrace(primitive, props, strokeColor) {
            this.ctx.strokeStyle = strokeColor;
            this.ctx.lineWidth = props.strokeWidth || 0.1;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
            
            this.ctx.beginPath();
            primitive.points.forEach((point, index) => {
                if (index === 0) {
                    this.ctx.moveTo(point.x, point.y);
                } else {
                    this.ctx.lineTo(point.x, point.y);
                }
            });
            
            if (primitive.closed) {
                this.ctx.closePath();
            }
            
            this.ctx.stroke();
        }
        
        renderSimplePath(primitive, props, fillColor) {
            this.ctx.fillStyle = fillColor;
            this.ctx.beginPath();
            
            primitive.points.forEach((point, index) => {
                if (index === 0) {
                    this.ctx.moveTo(point.x, point.y);
                } else {
                    this.ctx.lineTo(point.x, point.y);
                }
            });
            
            if (primitive.closed) {
                this.ctx.closePath();
            }
            
            this.ctx.fill();
        }
        
        renderCircleNormal(primitive, props, fillColor, strokeColor) {
            this.ctx.beginPath();
            this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, 2 * Math.PI);
            
            if (props.isDrillHole || props.isBranchJunction || props.isFlash || props.fill !== false) {
                this.ctx.fillStyle = fillColor;
                this.ctx.fill();
            }
            
            if (props.stroke && !props.isDrillHole) {
                this.ctx.lineWidth = props.strokeWidth || 0.1;
                this.ctx.strokeStyle = strokeColor;
                this.ctx.stroke();
            }
        }
        
        renderRectangleNormal(primitive, props, fillColor, strokeColor) {
            if (props.fill !== false) {
                this.ctx.fillStyle = fillColor;
                this.ctx.fillRect(primitive.position.x, primitive.position.y, primitive.width, primitive.height);
            }
            
            if (props.stroke) {
                this.ctx.lineWidth = props.strokeWidth || 0.1;
                this.ctx.strokeStyle = strokeColor;
                this.ctx.strokeRect(primitive.position.x, primitive.position.y, primitive.width, primitive.height);
            }
        }
        
        renderObroundNormal(primitive, props, fillColor, strokeColor) {
            const x = primitive.position.x;
            const y = primitive.position.y;
            const w = primitive.width;
            const h = primitive.height;
            const r = Math.min(w, h) / 2;
            
            this.ctx.beginPath();
            
            if (w > h) {
                this.ctx.moveTo(x + r, y);
                this.ctx.lineTo(x + w - r, y);
                this.ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
                this.ctx.lineTo(x + r, y + h);
                this.ctx.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
            } else {
                this.ctx.moveTo(x + w, y + r);
                this.ctx.lineTo(x + w, y + h - r);
                this.ctx.arc(x + r, y + h - r, r, 0, Math.PI);
                this.ctx.lineTo(x, y + r);
                this.ctx.arc(x + r, y + r, r, Math.PI, 0);
            }
            
            this.ctx.closePath();
            
            if (props.fill !== false) {
                this.ctx.fillStyle = fillColor;
                this.ctx.fill();
            }
            
            if (props.stroke) {
                this.ctx.lineWidth = props.strokeWidth || 0.1;
                this.ctx.strokeStyle = strokeColor;
                this.ctx.stroke();
            }
        }
        
        renderArcNormal(primitive, props, strokeColor) {
            const radius = Math.sqrt(
                Math.pow(primitive.start.x - primitive.center.x, 2) +
                Math.pow(primitive.start.y - primitive.center.y, 2)
            );
            
            const startAngle = Math.atan2(
                primitive.start.y - primitive.center.y,
                primitive.start.x - primitive.center.x
            );
            const endAngle = Math.atan2(
                primitive.end.y - primitive.center.y,
                primitive.end.x - primitive.center.x
            );
            
            this.ctx.beginPath();
            this.ctx.arc(
                primitive.center.x,
                primitive.center.y,
                radius,
                startAngle,
                endAngle,
                !primitive.clockwise
            );
            
            this.ctx.lineWidth = props.strokeWidth || 0.1;
            this.ctx.strokeStyle = strokeColor;
            this.ctx.stroke();
        }
        
        renderPrimitiveWireframe(primitive) {
            switch (primitive.type) {
                case 'path':
                    this.renderPathWireframe(primitive);
                    break;
                case 'circle':
                    this.ctx.beginPath();
                    this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, 2 * Math.PI);
                    this.ctx.stroke();
                    break;
                case 'rectangle':
                    this.ctx.strokeRect(primitive.position.x, primitive.position.y, primitive.width, primitive.height);
                    break;
                case 'obround':
                    this.renderObroundWireframe(primitive);
                    break;
                case 'arc':
                    this.renderArcWireframe(primitive);
                    break;
            }
        }
        
        renderPathWireframe(primitive) {
            if (primitive.points.length < 2) return;
            
            this.ctx.beginPath();
            primitive.points.forEach((point, index) => {
                if (point !== null) {
                    if (index === 0) {
                        this.ctx.moveTo(point.x, point.y);
                    } else {
                        this.ctx.lineTo(point.x, point.y);
                    }
                }
            });
            
            if (primitive.closed) {
                this.ctx.closePath();
            }
            
            this.ctx.stroke();
            
            if (primitive.holes && primitive.holes.length > 0) {
                const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
                const colors = theme.debug || theme.canvas;
                
                this.ctx.save();
                this.ctx.strokeStyle = colors.holeDebug || colors.bounds;
                this.ctx.setLineDash([2 / this.core.viewScale, 2 / this.core.viewScale]);
                
                primitive.holes.forEach(hole => {
                    this.ctx.beginPath();
                    hole.forEach((point, index) => {
                        if (index === 0) {
                            this.ctx.moveTo(point.x, point.y);
                        } else {
                            this.ctx.lineTo(point.x, point.y);
                        }
                    });
                    this.ctx.closePath();
                    this.ctx.stroke();
                });
                
                this.ctx.restore();
            }
        }
        
        renderObroundWireframe(primitive) {
            const x = primitive.position.x;
            const y = primitive.position.y;
            const w = primitive.width;
            const h = primitive.height;
            const r = Math.min(w, h) / 2;
            
            this.ctx.beginPath();
            
            if (w > h) {
                this.ctx.moveTo(x + r, y);
                this.ctx.lineTo(x + w - r, y);
                this.ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
                this.ctx.lineTo(x + r, y + h);
                this.ctx.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
            } else {
                this.ctx.moveTo(x + w, y + r);
                this.ctx.lineTo(x + w, y + h - r);
                this.ctx.arc(x + r, y + h - r, r, 0, Math.PI);
                this.ctx.lineTo(x, y + r);
                this.ctx.arc(x + r, y + r, r, Math.PI, 0);
            }
            
            this.ctx.closePath();
            this.ctx.stroke();
        }
        
        renderArcWireframe(primitive) {
            const radius = Math.sqrt(
                Math.pow(primitive.start.x - primitive.center.x, 2) +
                Math.pow(primitive.start.y - primitive.center.y, 2)
            );
            
            const startAngle = Math.atan2(
                primitive.start.y - primitive.center.y,
                primitive.start.x - primitive.center.x
            );
            const endAngle = Math.atan2(
                primitive.end.y - primitive.center.y,
                primitive.end.x - primitive.center.x
            );
            
            this.ctx.beginPath();
            this.ctx.arc(
                primitive.center.x,
                primitive.center.y,
                radius,
                startAngle,
                endAngle,
                !primitive.clockwise
            );
            this.ctx.stroke();
        }
        
        renderHoleDebug(primitive) {
            if (!primitive.holes || primitive.holes.length === 0) return;
            
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const colors = theme.debug || theme.canvas;
            
            this.ctx.save();
            this.ctx.strokeStyle = colors.holeDebug;
            this.ctx.lineWidth = 2 / this.core.viewScale;
            this.ctx.setLineDash([4 / this.core.viewScale, 4 / this.core.viewScale]);
            
            primitive.holes.forEach(hole => {
                this.ctx.beginPath();
                
                for (let i = 0; i < hole.length; i++) {
                    const point = hole[i];
                    const nextPoint = hole[(i + 1) % hole.length];
                    
                    if (i === 0) {
                        this.ctx.moveTo(point.x, point.y);
                    }
                    this.ctx.lineTo(nextPoint.x, nextPoint.y);
                    
                    if (i % Math.ceil(hole.length / 4) === 0) {
                        const midX = (point.x + nextPoint.x) / 2;
                        const midY = (point.y + nextPoint.y) / 2;
                        const angle = Math.atan2(nextPoint.y - point.y, nextPoint.x - point.x);
                        
                        const arrowSize = 5 / this.core.viewScale;
                        
                        this.ctx.save();
                        this.ctx.translate(midX, midY);
                        this.ctx.rotate(angle);
                        
                        this.ctx.moveTo(0, 0);
                        this.ctx.lineTo(-arrowSize, -arrowSize/2);
                        this.ctx.moveTo(0, 0);
                        this.ctx.lineTo(-arrowSize, arrowSize/2);
                        
                        this.ctx.restore();
                    }
                }
                
                this.ctx.closePath();
                this.ctx.stroke();
            });
            
            this.ctx.restore();
        }
    }
    
    // ============================================================================
    // INTERNAL: UI Renderer - Handles grid, rulers, origin, scale indicator
    // ============================================================================
    class UIRenderer {
        constructor(core) {
            this.core = core;
            this.ctx = core.ctx;
            this.canvas = core.canvas;
        }
        
        renderGrid() {
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const colors = theme.canvas;
            const gridSpacing = this.calculateGridSpacing();
            const viewBounds = this.core.getViewBounds();
            
            this.ctx.strokeStyle = colors.grid;
            this.ctx.lineWidth = 0.1 / this.core.viewScale;
            this.ctx.setLineDash([]);
            
            this.ctx.beginPath();
            
            const originX = this.core.originPosition.x;
            const originY = this.core.originPosition.y;
            
            const startX = Math.floor((viewBounds.minX - originX) / gridSpacing) * gridSpacing + originX;
            const endX = Math.ceil((viewBounds.maxX - originX) / gridSpacing) * gridSpacing + originX;
            
            for (let x = startX; x <= endX; x += gridSpacing) {
                this.ctx.moveTo(x, viewBounds.minY);
                this.ctx.lineTo(x, viewBounds.maxY);
            }
            
            const startY = Math.floor((viewBounds.minY - originY) / gridSpacing) * gridSpacing + originY;
            const endY = Math.ceil((viewBounds.maxY - originY) / gridSpacing) * gridSpacing + originY;
            
            for (let y = startY; y <= endY; y += gridSpacing) {
                this.ctx.moveTo(viewBounds.minX, y);
                this.ctx.lineTo(viewBounds.maxX, y);
            }
            
            this.ctx.stroke();
        }
        
        renderOrigin() {
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const colors = theme.canvas;
            
            const markerSize = canvasConfig.originMarkerSize / this.core.viewScale || 10 / this.core.viewScale;
            const circleSize = canvasConfig.originCircleSize / this.core.viewScale || 3 / this.core.viewScale;
            const strokeWidth = 3 / this.core.viewScale;
            
            const originX = this.core.originPosition.x;
            const originY = this.core.originPosition.y;
            
            this.ctx.strokeStyle = colors.originOutline;
            this.ctx.lineWidth = strokeWidth + (1 / this.core.viewScale);
            
            this.ctx.beginPath();
            this.ctx.moveTo(originX - markerSize, originY);
            this.ctx.lineTo(originX + markerSize, originY);
            this.ctx.moveTo(originX, originY - markerSize);
            this.ctx.lineTo(originX, originY + markerSize);
            this.ctx.stroke();
            
            this.ctx.beginPath();
            this.ctx.arc(originX, originY, circleSize, 0, 2 * Math.PI);
            this.ctx.stroke();
            
            this.ctx.strokeStyle = colors.origin;
            this.ctx.lineWidth = strokeWidth;
            
            this.ctx.beginPath();
            this.ctx.moveTo(originX - markerSize, originY);
            this.ctx.lineTo(originX + markerSize, originY);
            this.ctx.moveTo(originX, originY - markerSize);
            this.ctx.lineTo(originX, originY + markerSize);
            this.ctx.stroke();
            
            this.ctx.beginPath();
            this.ctx.arc(originX, originY, circleSize, 0, 2 * Math.PI);
            this.ctx.stroke();
            
            this.ctx.fillStyle = colors.origin;
            this.ctx.fill();
        }
        
        renderBounds() {
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const colors = theme.canvas;
            const bounds = this.core.bounds;
            
            if (!bounds) return;
            
            this.ctx.strokeStyle = colors.bounds;
            this.ctx.lineWidth = 1 / this.core.viewScale;
            this.ctx.setLineDash([2 / this.core.viewScale, 2 / this.core.viewScale]);
            this.ctx.strokeRect(
                bounds.minX,
                bounds.minY,
                bounds.width,
                bounds.height
            );
            
            const markerSize = 5 / this.core.viewScale;
            this.ctx.setLineDash([]);
            this.ctx.lineWidth = 2 / this.core.viewScale;
            
            this.ctx.beginPath();
            this.ctx.moveTo(bounds.minX, bounds.minY + markerSize);
            this.ctx.lineTo(bounds.minX, bounds.minY);
            this.ctx.lineTo(bounds.minX + markerSize, bounds.minY);
            this.ctx.stroke();
            
            this.ctx.beginPath();
            this.ctx.moveTo(bounds.maxX - markerSize, bounds.maxY);
            this.ctx.lineTo(bounds.maxX, bounds.maxY);
            this.ctx.lineTo(bounds.maxX, bounds.maxY - markerSize);
            this.ctx.stroke();
        }
        
        renderRulers() {
            this.ctx.save();
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const colors = theme.canvas;
            this.ctx.strokeStyle = colors.ruler;
            this.ctx.fillStyle = colors.rulerText;
            this.ctx.lineWidth = 1;
            this.ctx.font = '12px Arial';
            this.ctx.textBaseline = 'top';
            this.ctx.textAlign = 'left';
            
            const rulerSize = canvasConfig.rulerSize || 20;
            const tickLength = canvasConfig.rulerTickLength || 5;
            const majorStep = this.calculateRulerStep();
            const viewBounds = this.core.getViewBounds();
            
            this.ctx.beginPath();
            this.ctx.moveTo(rulerSize, rulerSize);
            this.ctx.lineTo(this.canvas.width, rulerSize);
            this.ctx.stroke();
            
            this.ctx.textAlign = 'center';
            
            const originX = this.core.originPosition.x;
            const originY = this.core.originPosition.y;
            
            const startXWorld = Math.floor((viewBounds.minX - originX) / majorStep) * majorStep + originX;
            const endXWorld = Math.ceil((viewBounds.maxX - originX) / majorStep) * majorStep + originX;
            
            for (let xWorld = startXWorld; xWorld <= endXWorld; xWorld += majorStep) {
                const xCanvas = this.core.worldToCanvasX(xWorld);
                if (xCanvas >= rulerSize && xCanvas <= this.canvas.width) {
                    this.ctx.moveTo(xCanvas, rulerSize);
                    this.ctx.lineTo(xCanvas, rulerSize - tickLength);
                    
                    const relativeX = xWorld - originX;
                    let label;
                    if (majorStep < 0.1) {
                        label = `${(relativeX * 1000).toFixed(0)}μm`;
                    } else {
                        const precision = majorStep < 0.1 ? 3 : majorStep < 1 ? 2 : 1;
                        label = relativeX.toFixed(precision);
                    }
                    this.ctx.fillText(label, xCanvas, 0);
                }
            }
            this.ctx.stroke();
            
            this.ctx.beginPath();
            this.ctx.moveTo(rulerSize, 0);
            this.ctx.lineTo(rulerSize, this.canvas.height);
            this.ctx.stroke();
            
            this.ctx.textAlign = 'left';
            this.ctx.textBaseline = 'middle';
            
            const startYWorld = Math.floor((viewBounds.minY - originY) / majorStep) * majorStep + originY;
            const endYWorld = Math.ceil((viewBounds.maxY - originY) / majorStep) * majorStep + originY;
            
            for (let yWorld = startYWorld; yWorld <= endYWorld; yWorld += majorStep) {
                const yCanvas = this.core.worldToCanvasY(yWorld);
                if (yCanvas >= 0 && yCanvas <= this.canvas.height) {
                    this.ctx.moveTo(rulerSize, yCanvas);
                    this.ctx.lineTo(rulerSize - tickLength, yCanvas);
                    
                    const relativeY = yWorld - originY;
                    let label;
                    if (majorStep < 0.1) {
                        label = `${(relativeY * 1000).toFixed(0)}μm`;
                    } else {
                        const precision = majorStep < 0.1 ? 3 : majorStep < 1 ? 2 : 1;
                        label = relativeY.toFixed(precision);
                    }
                    this.ctx.fillText(label, tickLength + 2, yCanvas);
                }
            }
            this.ctx.stroke();
            
            this.ctx.fillStyle = colors.background;
            this.ctx.fillRect(0, 0, rulerSize, rulerSize);
            this.ctx.strokeRect(0, 0, rulerSize, rulerSize);
            
            this.ctx.restore();
        }
        
        renderScaleIndicator() {
            this.ctx.save();
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const colors = theme.canvas;
            const padding = 10;
            const barHeight = 4;
            const y = this.canvas.height - padding - 20;
            
            const targetPixels = 100;
            const worldLength = targetPixels / this.core.viewScale;
            
            const possibleLengths = gridConfig.steps || [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
            const niceLength = possibleLengths.find(len => len * this.core.viewScale >= 50) || 1;
            const barWidth = niceLength * this.core.viewScale;
            
            const x = this.canvas.width - padding - barWidth;
            
            this.ctx.fillStyle = colors.background;
            this.ctx.globalAlpha = 0.8;
            this.ctx.fillRect(x - 5, y - 20, barWidth + 10, 30);
            this.ctx.globalAlpha = 1;
            
            this.ctx.fillStyle = colors.rulerText;
            this.ctx.fillRect(x, y, barWidth, barHeight);
            
            this.ctx.fillRect(x, y - 2, 1, barHeight + 4);
            this.ctx.fillRect(x + barWidth - 1, y - 2, 1, barHeight + 4);
            
            this.ctx.font = '11px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'bottom';
            let label;
            if (niceLength < 0.01) {
                label = `${(niceLength * 1000).toFixed(0)}μm`;
            } else if (niceLength < 1) {
                label = `${niceLength.toFixed(2)}mm`;
            } else {
                label = `${niceLength}mm`;
            }
            this.ctx.fillText(label, x + barWidth / 2, y - 2);
            
            this.ctx.restore();
        }
        
        renderStats() {
            if (!this.core.options.showStats) return;
            
            this.ctx.save();
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const colors = theme.canvas;
            const stats = this.core.renderStats;
            
            const x = 10;
            let y = 50;
            const lineHeight = 16;
            
            this.ctx.fillStyle = colors.background;
            this.ctx.globalAlpha = 0.8;
            this.ctx.fillRect(x - 5, y - 15, 200, 100);
            this.ctx.globalAlpha = 1;
            
            this.ctx.fillStyle = colors.rulerText;
            this.ctx.font = '12px monospace';
            this.ctx.textAlign = 'left';
            this.ctx.textBaseline = 'top';
            
            this.ctx.fillText(`Primitives: ${stats.renderedPrimitives}/${stats.primitives}`, x, y);
            y += lineHeight;
            
            if (stats.holesRendered > 0) {
                this.ctx.fillText(`Holes: ${stats.holesRendered}`, x, y);
                y += lineHeight;
            }
            
            this.ctx.fillText(`Render: ${stats.renderTime.toFixed(1)}ms`, x, y);
            y += lineHeight;
            
            this.ctx.fillText(`Zoom: ${this.core.viewScale.toFixed(2)}x`, x, y);
            
            this.ctx.restore();
        }
        
        calculateGridSpacing() {
            const minPixelSize = gridConfig.minPixelSpacing || 40;
            const possibleSteps = gridConfig.steps || [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
            return possibleSteps.find(step => step * this.core.viewScale >= minPixelSize) || 100;
        }
        
        calculateRulerStep() {
            const minPixelDistance = 50;
            const possibleSteps = gridConfig.steps || [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
            return possibleSteps.find(step => step * this.core.viewScale >= minPixelDistance) || 100;
        }
    }
    
    // ============================================================================
    // INTERNAL: Interaction Handler - Mouse, touch, keyboard interaction
    // ============================================================================
    class InteractionHandler {
        constructor(renderer) {
            this.renderer = renderer;
            this.canvas = renderer.canvas;
            
            this.isPanning = false;
            this.lastPointer = { x: 0, y: 0 };
            this.pointerCount = 0;
            this.initialDistance = 0;
            this.initialScale = 1;
            
            this.minZoom = canvasConfig.minZoom || 0.01;
            this.maxZoom = canvasConfig.maxZoom || 1000;
            this.zoomStep = canvasConfig.zoomStep || 1.2;
            
            this.setupEventListeners();
        }
        
        setupEventListeners() {
            this.canvas.style.cursor = 'grab';
            this.canvas.style.userSelect = 'none';
            this.canvas.style.webkitUserSelect = 'none';
            this.canvas.style.mozUserSelect = 'none';
            this.canvas.style.msUserSelect = 'none';
            this.canvas.style.touchAction = 'none';
            
            this.canvas.addEventListener('contextmenu', (e) => {
                e.preventDefault();
            });
            
            this.canvas.addEventListener('dragstart', (e) => {
                e.preventDefault();
            });
            
            this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
            this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
            document.addEventListener('mouseup', (e) => this.handleMouseUp(e));
            
            this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
            this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
            this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });
            
            this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
            
            this.canvas.addEventListener('dblclick', (e) => {
                e.preventDefault();
                this.zoomFit();
            });
            
            this.resizeObserver = new ResizeObserver(() => {
                this.renderer.resizeCanvas();
            });
            this.resizeObserver.observe(this.canvas);
        }
        
        handleMouseDown(e) {
            if (e.button === 0) {
                e.preventDefault();
                this.startPanning(e.clientX, e.clientY);
            }
        }
        
        handleMouseMove(e) {
            if (this.isPanning && this.pointerCount === 1) {
                e.preventDefault();
                this.updatePanning(e.clientX, e.clientY);
            }
        }
        
        handleMouseUp(e) {
            if (this.isPanning) {
                this.endPanning();
            }
        }
        
        handleTouchStart(e) {
            e.preventDefault();
            
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                this.startPanning(touch.clientX, touch.clientY);
            } else if (e.touches.length === 2) {
                const touch1 = e.touches[0];
                const touch2 = e.touches[1];
                
                const distance = Math.sqrt(
                    Math.pow(touch2.clientX - touch1.clientX, 2) +
                    Math.pow(touch2.clientY - touch1.clientY, 2)
                );
                
                this.pointerCount = 2;
                this.initialDistance = distance;
                this.initialScale = this.getViewScale();
                
                const centerX = (touch1.clientX + touch2.clientX) / 2;
                const centerY = (touch1.clientY + touch2.clientY) / 2;
                this.lastPointer = { x: centerX, y: centerY };
            }
        }
        
        handleTouchMove(e) {
            e.preventDefault();
            
            if (e.touches.length === 1 && this.isPanning) {
                const touch = e.touches[0];
                this.updatePanning(touch.clientX, touch.clientY);
            } else if (e.touches.length === 2 && this.pointerCount === 2) {
                const touch1 = e.touches[0];
                const touch2 = e.touches[1];
                
                const distance = Math.sqrt(
                    Math.pow(touch2.clientX - touch1.clientX, 2) +
                    Math.pow(touch2.clientY - touch1.clientY, 2)
                );
                
                const scaleChange = distance / this.initialDistance;
                const newScale = this.initialScale * scaleChange;
                
                const centerX = (touch1.clientX + touch2.clientX) / 2;
                const centerY = (touch1.clientY + touch2.clientY) / 2;
                
                const rect = this.canvas.getBoundingClientRect();
                const canvasCenterX = centerX - rect.left;
                const canvasCenterY = centerY - rect.top;
                
                this.setZoom(newScale, canvasCenterX, canvasCenterY);
            }
        }
        
        handleTouchEnd(e) {
            e.preventDefault();
            
            if (e.touches.length === 0) {
                this.endPanning();
            } else if (e.touches.length === 1 && this.pointerCount === 2) {
                const touch = e.touches[0];
                this.startPanning(touch.clientX, touch.clientY);
            }
        }
        
        handleWheel(e) {
            e.preventDefault();
            
            const rect = this.canvas.getBoundingClientRect();
            const cursorX = e.clientX - rect.left;
            const cursorY = e.clientY - rect.top;
            
            const currentScale = this.getViewScale();
            
            if (e.deltaY < 0) {
                this.setZoom(currentScale * this.zoomStep, cursorX, cursorY);
            } else {
                this.setZoom(currentScale / this.zoomStep, cursorX, cursorY);
            }
        }
        
        startPanning(x, y) {
            this.isPanning = true;
            this.pointerCount = 1;
            this.lastPointer = { x, y };
            this.canvas.style.cursor = 'grabbing';
        }
        
        updatePanning(x, y) {
            if (this.isPanning && this.pointerCount === 1) {
                const dx = x - this.lastPointer.x;
                const dy = y - this.lastPointer.y;
                this.pan(dx, dy);
                this.lastPointer = { x, y };
            }
        }
        
        endPanning() {
            this.isPanning = false;
            this.pointerCount = 0;
            this.canvas.style.cursor = 'grab';
        }
        
        getViewScale() {
            return this.renderer.core.viewScale;
        }
        
        setViewScale(scale) {
            this.renderer.core.viewScale = scale;
        }
        
        getViewOffset() {
            return this.renderer.core.viewOffset;
        }
        
        setViewOffset(offset) {
            this.renderer.core.viewOffset = offset;
        }
        
        pan(dx, dy) {
            const offset = this.getViewOffset();
            offset.x += dx;
            offset.y += dy;
            this.setViewOffset(offset);
            this.renderer.render();
        }
        
        setZoom(newScale, centerX, centerY) {
            const oldScale = this.getViewScale();
            newScale = Math.max(this.minZoom, Math.min(this.maxZoom, newScale));
            
            if (centerX === null || centerX === undefined) centerX = this.canvas.width / 2;
            if (centerY === null || centerY === undefined) centerY = this.canvas.height / 2;
            
            const offset = this.getViewOffset();
            
            const worldCenterX = (centerX - offset.x) / oldScale;
            const worldCenterY = -(centerY - offset.y) / oldScale;
            
            this.setViewScale(newScale);
            
            const newCanvasX = offset.x + worldCenterX * newScale;
            const newCanvasY = offset.y - worldCenterY * newScale;
            
            offset.x += centerX - newCanvasX;
            offset.y += centerY - newCanvasY;
            
            this.setViewOffset(offset);
            this.renderer.render();
        }
        
        zoom(scale, centerX, centerY) {
            this.setZoom(scale, centerX, centerY);
        }
        
        zoomIn(centerX, centerY) {
            const currentScale = this.getViewScale();
            this.setZoom(currentScale * this.zoomStep, centerX, centerY);
        }
        
        zoomOut(centerX, centerY) {
            const currentScale = this.getViewScale();
            this.setZoom(currentScale / this.zoomStep, centerX, centerY);
        }
        
        zoomFit() {
            this.renderer.calculateOverallBounds();
            
            const bounds = this.renderer.core.bounds;
            
            if (!bounds || !isFinite(bounds.width) || !isFinite(bounds.height) || 
                bounds.width === 0 || bounds.height === 0) {
                if (debugConfig.enabled) {
                    console.log('No valid bounds for zoom fit, using defaults');
                }
                this.setViewScale(canvasConfig.defaultZoom || 10);
                this.setViewOffset({ 
                    x: this.canvas.width / 2, 
                    y: this.canvas.height / 2 
                });
                this.renderer.render();
                return;
            }
            
            if (debugConfig.enabled) {
                console.log('Zoom fit bounds:', bounds);
            }
            
            const padding = 0.1;
            const desiredWidth = bounds.width * (1 + padding * 2);
            const desiredHeight = bounds.height * (1 + padding * 2);
            
            const scaleX = this.canvas.width / desiredWidth;
            const scaleY = this.canvas.height / desiredHeight;
            const newScale = Math.min(scaleX, scaleY);
            
            const finalScale = Math.max(0.1, newScale);
            
            this.setViewScale(finalScale);
            
            const centerX = bounds.minX + bounds.width / 2;
            const centerY = bounds.minY + bounds.height / 2;
            
            this.setViewOffset({
                x: this.canvas.width / 2 - centerX * finalScale,
                y: this.canvas.height / 2 + centerY * finalScale
            });
            
            if (debugConfig.enabled) {
                console.log(`Zoom fit applied: scale=${finalScale.toFixed(2)}, center=(${centerX.toFixed(2)}, ${centerY.toFixed(2)})`);
            }
            
            this.renderer.render();
        }
        
        destroy() {
            if (this.resizeObserver) {
                this.resizeObserver.disconnect();
            }
        }
    }
    
    // ============================================================================
    // INTERNAL: Base Renderer - Orchestrates core, primitives, and UI rendering
    // ============================================================================
    class BaseRenderer {
        constructor(canvas) {
            this.core = new RendererCore(canvas);
            this.primitiveRenderer = new PrimitiveRenderer(this.core);
            this.uiRenderer = new UIRenderer(this.core);
            
            this.canvas = this.core.canvas;
            this.ctx = this.core.ctx;
            
            this.resizeCanvas();
        }
        
        render() {
            const startTime = performance.now();
            this.core.renderStats.primitives = 0;
            this.core.renderStats.skippedPrimitives = 0;
            this.core.renderStats.renderedPrimitives = 0;
            this.core.renderStats.holesRendered = 0;
            
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const colors = theme.canvas;
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.fillStyle = colors.background;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            
            this.core.setupTransform();
            
            if (this.core.options.showGrid) {
                this.uiRenderer.renderGrid();
            }
            
            if (this.core.options.showBounds && this.core.bounds) {
                this.uiRenderer.renderBounds();
            }
            
            this.renderLayers();
            
            this.core.resetTransform();
            
            this.ctx.save();
            this.ctx.translate(this.core.viewOffset.x, this.core.viewOffset.y);
            this.ctx.scale(this.core.viewScale, -this.core.viewScale);
            if (this.core.options.showOrigin) {
                this.uiRenderer.renderOrigin();
            }
            this.ctx.restore();
            
            if (this.core.options.showRulers) {
                this.uiRenderer.renderRulers();
            }
            
            this.uiRenderer.renderScaleIndicator();
            this.uiRenderer.renderStats();
            
            const endTime = performance.now();
            this.core.renderStats.renderTime = endTime - startTime;
            
            if (this.core.renderStats.lastSignificantChange && debugConfig.enabled) {
                console.log(`Rendered ${this.core.renderStats.renderedPrimitives} primitives with ${this.core.renderStats.holesRendered} holes (${this.core.renderStats.lastSignificantChange})`);
                this.core.renderStats.lastSignificantChange = null;
            }
        }
        
        renderLayers() {
            const fusedLayers = [];
            const regularLayers = [];
            
            this.core.layers.forEach((layer, name) => {
                if (layer.isFused) {
                    fusedLayers.push(layer);
                } else {
                    regularLayers.push(layer);
                }
            });
            
            if (fusedLayers.length > 0 && this.core.renderStats.lastSignificantChange && debugConfig.enabled) {
                let totalHoles = 0;
                fusedLayers.forEach(layer => {
                    totalHoles += layer.totalHoles || 0;
                });
                console.log(`Rendering ${fusedLayers.length} fused layer(s) with ${totalHoles} total holes`);
            }
            
            fusedLayers.forEach(layer => {
                if (layer.visible) {
                    this.renderLayerDirect(layer);
                }
            });
            
            const renderOrder = ['cutout', 'clear', 'isolation', 'drill'];
            
            renderOrder.forEach(type => {
                regularLayers.forEach(layer => {
                    if (layer.visible && layer.type === type) {
                        this.renderLayer(layer);
                    }
                });
            });
        }
        
        renderLayerDirect(layer) {
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const colors = theme.layers;
            const layerColor = layer.color || colors.fused;
            
            layer.primitives.forEach((primitive, index) => {
                this.core.renderStats.primitives++;
                this.core.renderStats.renderedPrimitives++;
                
                let fillColor = layerColor;
                let strokeColor = layerColor;
                
                if (this.core.options.blackAndWhite) {
                    const bwColor = this.core.options.theme === 'dark' ? '#ffffff' : '#000000';
                    fillColor = bwColor;
                    strokeColor = bwColor;
                }
                
                this.primitiveRenderer.renderPrimitive(primitive, fillColor, strokeColor);
            });
        }
        
        renderLayer(layer) {
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
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
            
            layer.primitives.forEach((primitive, index) => {
                this.core.renderStats.primitives++;
                
                if (primitive.properties?.operationType && primitive.properties.operationType !== layer.type) {
                    this.core.renderStats.skippedPrimitives++;
                    return;
                }
                
                if (layer.type === 'cutout') {
                    if (!this.core.options.showCutouts) {
                        this.core.renderStats.skippedPrimitives++;
                        return;
                    }
                    
                    this.renderCutoutPrimitive(primitive, layerColor);
                    return;
                }
                
                if (!this.core.shouldRenderPrimitive(primitive, layer.type)) {
                    this.core.renderStats.skippedPrimitives++;
                    return;
                }
                
                this.core.renderStats.renderedPrimitives++;
                
                let fillColor = layerColor;
                let strokeColor = layerColor;
                
                if (primitive.properties?.isNonConductor) {
                    fillColor = colors.nonConductor;
                    strokeColor = colors.nonConductor;
                }
                
                if (this.core.options.blackAndWhite) {
                    const bwColor = this.core.options.theme === 'dark' ? '#ffffff' : '#000000';
                    fillColor = bwColor;
                    strokeColor = bwColor;
                }
                
                this.primitiveRenderer.renderPrimitive(primitive, fillColor, strokeColor);
            });
        }
        
        renderCutoutPrimitive(primitive, color) {
            this.core.renderStats.renderedPrimitives++;
            
            let fillColor = 'transparent';
            let strokeColor = color;
            
            this.ctx.save();
            this.ctx.fillStyle = fillColor;
            this.ctx.strokeStyle = strokeColor;
            
            this.ctx.lineWidth = this.core.options.showWireframe ? 
                this.core.getWireframeStrokeWidth() : 
                this.core.getWireframeStrokeWidth();
            
            if (primitive.type === 'path' && primitive.points) {
                this.ctx.beginPath();
                primitive.points.forEach((point, i) => {
                    if (i === 0) {
                        this.ctx.moveTo(point.x, point.y);
                    } else {
                        this.ctx.lineTo(point.x, point.y);
                    }
                });
                if (primitive.closed) {
                    this.ctx.closePath();
                }
                this.ctx.stroke();
            } else {
                this.primitiveRenderer.renderPrimitive(primitive, fillColor, strokeColor);
            }
            
            this.ctx.restore();
        }
        
        // Public API methods
        setOptions(options) {
            this.core.setOptions(options);
            this.options = this.core.options;
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
            if (state.offset) {
                this.core.viewOffset = { ...state.offset };
            }
            if (state.scale !== undefined) {
                this.core.viewScale = state.scale;
            }
            if (state.rotation !== undefined) {
                this.core.currentRotation = state.rotation;
            }
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
    }
    
    // ============================================================================
    // EXPORTED: LayerRenderer - Public API with interaction support
    // ============================================================================
    class LayerRenderer extends BaseRenderer {
        constructor(canvasId) {
            const canvas = document.getElementById(canvasId);
            if (!canvas) {
                throw new Error(`Canvas element with id '${canvasId}' not found`);
            }
            
            super(canvas);
            
            this.interaction = new InteractionHandler(this);
            this.coordinateSystem = null;
            
            // Create property accessors for compatibility
            Object.defineProperty(this, 'viewOffset', {
                get: () => this.core.viewOffset,
                set: (value) => { this.core.viewOffset = value; }
            });
            
            Object.defineProperty(this, 'viewScale', {
                get: () => this.core.viewScale,
                set: (value) => { this.core.viewScale = value; }
            });
            
            Object.defineProperty(this, 'bounds', {
                get: () => this.core.bounds,
                set: (value) => { this.core.bounds = value; }
            });
            
            Object.defineProperty(this, 'options', {
                get: () => this.core.options,
                set: (value) => { this.core.options = value; }
            });
            
            Object.defineProperty(this, 'colors', {
                get: () => this.core.colors
            });
            
            Object.defineProperty(this, 'layers', {
                get: () => this.core.layers
            });
            
            Object.defineProperty(this, 'renderStats', {
                get: () => this.core.renderStats
            });
            
            Object.defineProperty(this, 'originPosition', {
                get: () => this.core.originPosition
            });
            
            Object.defineProperty(this, 'currentRotation', {
                get: () => this.core.currentRotation
            });
            
            Object.defineProperty(this, 'rotationCenter', {
                get: () => this.core.rotationCenter
            });
            
            if (debugConfig.enabled) {
                console.log('LayerRenderer initialized with interaction support');
            }
        }
        
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
        
        // Override resizeCanvas to work properly
        resizeCanvas() {
            const parent = this.canvas.parentElement;
            if (parent) {
                const rect = parent.getBoundingClientRect();
                this.canvas.width = rect.width;
                this.canvas.height = rect.height;
                this.render();
            }
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