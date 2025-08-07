// renderer/canvas-renderer.js - Canvas rendering engine - FIXED: Fusion and cutout rendering
// Handles pure rendering operations without interaction logic

class CanvasRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        if (!this.ctx) {
            throw new Error('Could not get 2D context from canvas');
        }
        
        // View state
        this.viewOffset = { x: 0, y: 0 };
        this.viewScale = 1;
        this.bounds = null;
        
        // Track origin position and rotation
        this.originPosition = { x: 0, y: 0 };
        this.currentRotation = 0;
        this.rotationCenter = { x: 0, y: 0 };
        
        // Enhanced color schemes
        this.colors = {
            dark: {
                background: '#1a1a1a',
                isolation: '#ff8844',    // Orange for isolation routing
                clear: '#44ff88',        // Green for copper clearing  
                drill: '#4488ff',        // Blue for drilling
                cutout: '#ff00ff',       // Magenta for board cutout
                copper: '#ff8844',       // Fallback copper color
                fused: '#00ff00',        // Green for fused geometry
                nonConductor: '#666666',
                grid: '#333333',
                origin: '#ffffff',
                originOutline: '#000000',
                bounds: '#ff0000',
                ruler: '#888888',
                rulerText: '#cccccc'
            },
            light: {
                background: '#ffffff',
                isolation: '#cc6600',    // Dark orange for isolation
                clear: '#008844',        // Dark green for clearing
                drill: '#0066cc',        // Dark blue for drilling  
                cutout: '#cc00cc',       // Dark magenta for cutout
                copper: '#cc6600',       // Fallback copper color
                fused: '#00aa00',        // Dark green for fused geometry
                nonConductor: '#999999',
                grid: '#cccccc',
                origin: '#000000',
                originOutline: '#ffffff',
                bounds: '#ff0000',
                ruler: '#666666',
                rulerText: '#333333'
            }
        };
        
        // Layers storage
        this.layers = new Map();
        
        // Render options
        this.options = {
            showWireframe: false,
            showPads: true,
            blackAndWhite: false,
            showGrid: true,
            showOrigin: true,
            showBounds: false,
            showRulers: true,
            fuseGeometry: false,
            // Geometry type controls
            showRegions: true,
            showTraces: true,
            showDrills: true,
            showCutouts: true,
            theme: 'dark'
        };
        
        // Stats
        this.renderStats = {
            primitives: 0,
            renderTime: 0,
            skippedPrimitives: 0,
            renderedPrimitives: 0
        };
        
        this.resizeCanvas();
    }
    
    setOptions(options) {
        Object.assign(this.options, options);
        this.render();
    }
    
    addLayer(name, primitives, options = {}) {
        console.log(`FIXED: Adding layer "${name}" with ${primitives.length} primitives`);
        
        this.layers.set(name, {
            name: name,
            primitives: primitives,
            visible: options.visible !== false,
            type: options.type || 'copper',
            bounds: options.bounds || this.calculateLayerBounds(primitives),
            color: options.color || null,
            isFused: options.isFused || false
        });
        
        this.calculateOverallBounds();
        this.render();
    }
    
    clearLayers() {
        console.log(`FIXED: Clearing ${this.layers.size} layers`);
        this.layers.clear();
        this.bounds = null;
        this.render();
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
    
    render() {
        const startTime = performance.now();
        this.renderStats.primitives = 0;
        this.renderStats.skippedPrimitives = 0;
        this.renderStats.renderedPrimitives = 0;
        
        // Clear canvas
        const colors = this.colors[this.options.theme];
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = colors.background;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.ctx.save();
        
        // Apply view transformation
        this.ctx.translate(this.viewOffset.x, this.viewOffset.y);
        this.ctx.scale(this.viewScale, -this.viewScale); // Flip Y for PCB coordinates
        
        // Apply board rotation around rotation center
        if (this.currentRotation !== 0) {
            this.ctx.translate(this.rotationCenter.x, this.rotationCenter.y);
            this.ctx.rotate((this.currentRotation * Math.PI) / 180);
            this.ctx.translate(-this.rotationCenter.x, -this.rotationCenter.y);
        }
        
        // Render background elements
        if (this.options.showGrid) this.renderGrid();
        if (this.options.showBounds && this.bounds) this.renderBounds();
        
        // FIXED: Special handling for fused layers
        const fusedLayers = [];
        const regularLayers = [];
        
        this.layers.forEach((layer, name) => {
            if (layer.isFused) {
                fusedLayers.push(layer);
            } else {
                regularLayers.push(layer);
            }
        });
        
        if (fusedLayers.length > 0) {
            // Render fused layers
            console.log(`FIXED: Rendering ${fusedLayers.length} fused layer(s)`);
            fusedLayers.forEach(layer => {
                if (layer.visible) {
                    this.renderLayerDirect(layer);
                }
            });
        }
        
        if (regularLayers.length > 0) {
            // Render regular layers in proper order
            const renderOrder = ['cutout', 'clear', 'isolation', 'drill'];
            
            renderOrder.forEach(type => {
                regularLayers.forEach(layer => {
                    if (layer.visible && layer.type === type) {
                        this.renderLayer(layer);
                    }
                });
            });
        }
        
        this.ctx.restore();
        
        // Render origin marker AFTER rotation (always screen-aligned)
        this.ctx.save();
        this.ctx.translate(this.viewOffset.x, this.viewOffset.y);
        this.ctx.scale(this.viewScale, -this.viewScale);
        if (this.options.showOrigin) this.renderOrigin();
        this.ctx.restore();
        
        // Render screen-space elements
        if (this.options.showRulers) this.renderRulers();
        this.renderScaleIndicator();
        
        const endTime = performance.now();
        this.renderStats.renderTime = endTime - startTime;
        
        console.log(`FIXED: Rendered ${this.renderStats.renderedPrimitives} primitives, skipped ${this.renderStats.skippedPrimitives}`);
    }
    
    // FIXED: Direct rendering for fused layers without filtering
    renderLayerDirect(layer) {
        const colors = this.colors[this.options.theme];
        
        // Use the layer's specified color or default to fused color
        const layerColor = layer.color || colors.fused;
        
        console.log(`FIXED: Direct rendering fused layer with color ${layerColor}`);
        
        layer.primitives.forEach((primitive, index) => {
            this.renderStats.primitives++;
            this.renderStats.renderedPrimitives++;
            
            let fillColor = layerColor;
            let strokeColor = layerColor;
            
            if (this.options.blackAndWhite) {
                const bwColor = this.options.theme === 'dark' ? '#ffffff' : '#000000';
                fillColor = bwColor;
                strokeColor = bwColor;
            }
            
            // Render primitive directly without filtering
            this.renderPrimitive(primitive, fillColor, strokeColor);
        });
    }
    
    renderLayer(layer) {
        const colors = this.colors[this.options.theme];
        
        // Determine layer color
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
        
        console.log(`FIXED: Rendering layer ${layer.name} (type: ${layer.type}): ${layer.primitives.length} primitives`);
        
        layer.primitives.forEach((primitive, index) => {
            this.renderStats.primitives++;
            
            // FIXED: Strict layer isolation - only render primitives that belong to this layer
            if (primitive.properties?.operationType && primitive.properties.operationType !== layer.type) {
                console.log(`Skipping primitive from wrong operation: ${primitive.properties.operationType} in ${layer.type} layer`);
                this.renderStats.skippedPrimitives++;
                return;
            }
            
            // FIXED: Special handling for cutout layers - always render cutout primitives
            if (layer.type === 'cutout') {
                this.renderStats.renderedPrimitives++;
                
                let fillColor = 'transparent'; // Cutouts should not be filled
                let strokeColor = layerColor;
                
                // All cutout paths should be stroked outlines
                this.ctx.save();
                this.ctx.fillStyle = fillColor;
                this.ctx.strokeStyle = strokeColor;
                this.ctx.lineWidth = 0.15 / this.viewScale; // Visible line for cutout
                
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
                    // Render other cutout primitives normally
                    this.renderPrimitive(primitive, fillColor, strokeColor);
                }
                
                this.ctx.restore();
                return;
            }
            
            // Regular geometry type filtering for non-cutout layers
            if (!this.shouldRenderPrimitive(primitive, layer.type)) {
                this.renderStats.skippedPrimitives++;
                return;
            }
            
            this.renderStats.renderedPrimitives++;
            
            let fillColor = layerColor;
            let strokeColor = layerColor;
            
            if (primitive.properties?.isNonConductor) {
                fillColor = colors.nonConductor;
                strokeColor = colors.nonConductor;
            }
            
            if (this.options.blackAndWhite) {
                const bwColor = this.options.theme === 'dark' ? '#ffffff' : '#000000';
                fillColor = bwColor;
                strokeColor = bwColor;
            }
            
            // Render primitive with current coordinates
            this.renderPrimitive(primitive, fillColor, strokeColor);
        });
    }
    
    shouldRenderPrimitive(primitive, layerType) {
        // FIXED: Always render fused primitives
        if (primitive.properties?.isFused) {
            return true;
        }
        
        // FIXED: Always render cutout primitives
        if (layerType === 'cutout') {
            return true;
        }
        
        // Drill holes
        if (primitive.properties?.isDrillHole || layerType === 'drill') {
            return this.options.showDrills;
        }
        
        // Traces (strokes)
        if (primitive.properties?.isStroke) {
            return this.options.showTraces;
        }
        
        // Pads/Flashes
        if (primitive.properties?.isFlash || primitive.type === 'circle' || 
            primitive.type === 'rectangle' || primitive.type === 'obround') {
            return this.options.showPads;
        }
        
        // Regions (filled polygons)
        if (primitive.properties?.isRegion || 
            (primitive.type === 'path' && primitive.closed && !primitive.properties?.isStroke)) {
            return this.options.showRegions;
        }
        
        // Open paths that aren't strokes
        if (primitive.type === 'path' && !primitive.closed) {
            return this.options.showTraces;
        }
        
        return true;
    }
    
    renderPrimitive(primitive, fillColor, strokeColor) {
        this.ctx.save();
        
        this.ctx.fillStyle = fillColor;
        this.ctx.strokeStyle = strokeColor;
        
        if (this.options.showWireframe) {
            // WIREFRAME MODE: Show all geometry as outlines only
            this.ctx.lineWidth = this.getWireframeStrokeWidth();
            this.renderPrimitiveWireframe(primitive);
        } else {
            // FILL MODE: Show geometry as filled shapes WITHOUT stroke
            this.ctx.lineWidth = 0;
            this.renderPrimitiveFilled(primitive);
        }
        
        this.ctx.restore();
    }
    
    getWireframeStrokeWidth() {
        const baseThickness = 0.08;
        const scaleFactor = 1.0 / this.viewScale;
        const minThickness = 0.02;
        const maxThickness = 0.2;
        
        return Math.max(minThickness, Math.min(maxThickness, baseThickness * scaleFactor));
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
    
    renderPrimitiveFilled(primitive) {
        switch (primitive.type) {
            case 'path':
                this.renderPathFilled(primitive);
                break;
            case 'circle':
                this.ctx.beginPath();
                this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, 2 * Math.PI);
                this.ctx.fill();
                break;
            case 'rectangle':
                this.ctx.fillRect(primitive.position.x, primitive.position.y, primitive.width, primitive.height);
                break;
            case 'obround':
                this.renderObroundFilled(primitive);
                break;
            case 'arc':
                this.renderArcWireframe(primitive); // Arcs are always stroked
                break;
        }
    }
    
    renderPathWireframe(primitive) {
        if (primitive.points.length < 2) return;
        
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
    
    renderPathFilled(primitive) {
        if (primitive.points.length < 2) return;
        
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
            if (primitive.properties?.fillRule) {
                this.ctx.fill(primitive.properties.fillRule);
            } else {
                this.ctx.fill();
            }
        } else if (primitive.properties?.isStroke) {
            // For open paths that are strokes, we still fill them (stroke geometry is baked in)
            this.ctx.fill();
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
            // Horizontal obround
            this.ctx.moveTo(x + r, y);
            this.ctx.lineTo(x + w - r, y);
            this.ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
            this.ctx.lineTo(x + r, y + h);
            this.ctx.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
        } else {
            // Vertical obround
            this.ctx.moveTo(x + w, y + r);
            this.ctx.lineTo(x + w, y + h - r);
            this.ctx.arc(x + r, y + h - r, r, 0, Math.PI);
            this.ctx.lineTo(x, y + r);
            this.ctx.arc(x + r, y + r, r, Math.PI, 0);
        }
        
        this.ctx.closePath();
        this.ctx.stroke();
    }
    
    renderObroundFilled(primitive) {
        const x = primitive.position.x;
        const y = primitive.position.y;
        const w = primitive.width;
        const h = primitive.height;
        const r = Math.min(w, h) / 2;
        
        this.ctx.beginPath();
        
        if (w > h) {
            // Horizontal obround
            this.ctx.moveTo(x + r, y);
            this.ctx.lineTo(x + w - r, y);
            this.ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
            this.ctx.lineTo(x + r, y + h);
            this.ctx.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
        } else {
            // Vertical obround
            this.ctx.moveTo(x + w, y + r);
            this.ctx.lineTo(x + w, y + h - r);
            this.ctx.arc(x + r, y + h - r, r, 0, Math.PI);
            this.ctx.lineTo(x, y + r);
            this.ctx.arc(x + r, y + r, r, Math.PI, 0);
        }
        
        this.ctx.closePath();
        this.ctx.fill();
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
    
    renderGrid() {
        const colors = this.colors[this.options.theme];
        const gridSpacing = this.calculateGridSpacing();
        const viewBounds = this.getViewBounds();
        
        this.ctx.strokeStyle = colors.grid;
        this.ctx.lineWidth = 0.1 / this.viewScale;
        this.ctx.setLineDash([]);
        
        this.ctx.beginPath();
        
        // Grid aligned to current origin position
        const originX = this.originPosition.x;
        const originY = this.originPosition.y;
        
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
        const colors = this.colors[this.options.theme];
        
        const markerSize = 10 / this.viewScale;
        const circleSize = 3 / this.viewScale;
        const strokeWidth = 3 / this.viewScale;
        
        const originX = this.originPosition.x;
        const originY = this.originPosition.y;
        
        // Draw outline for better visibility
        this.ctx.strokeStyle = colors.originOutline;
        this.ctx.lineWidth = strokeWidth + (1 / this.viewScale);
        
        this.ctx.beginPath();
        this.ctx.moveTo(originX - markerSize, originY);
        this.ctx.lineTo(originX + markerSize, originY);
        this.ctx.moveTo(originX, originY - markerSize);
        this.ctx.lineTo(originX, originY + markerSize);
        this.ctx.stroke();
        
        this.ctx.beginPath();
        this.ctx.arc(originX, originY, circleSize, 0, 2 * Math.PI);
        this.ctx.stroke();
        
        // Draw main crosshair
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
        const colors = this.colors[this.options.theme];
        this.ctx.strokeStyle = colors.bounds;
        this.ctx.lineWidth = 1 / this.viewScale;
        this.ctx.setLineDash([2 / this.viewScale, 2 / this.viewScale]);
        this.ctx.strokeRect(
            this.bounds.minX,
            this.bounds.minY,
            this.bounds.width,
            this.bounds.height
        );
        
        const markerSize = 5 / this.viewScale;
        this.ctx.setLineDash([]);
        this.ctx.lineWidth = 2 / this.viewScale;
        
        // Bottom-left corner
        this.ctx.beginPath();
        this.ctx.moveTo(this.bounds.minX, this.bounds.minY + markerSize);
        this.ctx.lineTo(this.bounds.minX, this.bounds.minY);
        this.ctx.lineTo(this.bounds.minX + markerSize, this.bounds.minY);
        this.ctx.stroke();
        
        // Top-right corner
        this.ctx.beginPath();
        this.ctx.moveTo(this.bounds.maxX - markerSize, this.bounds.maxY);
        this.ctx.lineTo(this.bounds.maxX, this.bounds.maxY);
        this.ctx.lineTo(this.bounds.maxX, this.bounds.maxY - markerSize);
        this.ctx.stroke();
    }
    
    renderRulers() {
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        
        const colors = this.colors[this.options.theme];
        this.ctx.strokeStyle = colors.ruler;
        this.ctx.fillStyle = colors.rulerText;
        this.ctx.lineWidth = 1;
        this.ctx.font = '12px Arial';
        this.ctx.textBaseline = 'top';
        this.ctx.textAlign = 'left';
        
        const rulerSize = 20;
        const tickLength = 5;
        const majorStep = this.calculateRulerStep();
        const viewBounds = this.getViewBounds();
        
        // X-axis ruler (top)
        this.ctx.beginPath();
        this.ctx.moveTo(rulerSize, rulerSize);
        this.ctx.lineTo(this.canvas.width, rulerSize);
        this.ctx.stroke();
        
        this.ctx.textAlign = 'center';
        
        const originX = this.originPosition.x;
        const originY = this.originPosition.y;
        
        const startXWorld = Math.floor((viewBounds.minX - originX) / majorStep) * majorStep + originX;
        const endXWorld = Math.ceil((viewBounds.maxX - originX) / majorStep) * majorStep + originX;
        
        for (let xWorld = startXWorld; xWorld <= endXWorld; xWorld += majorStep) {
            const xCanvas = this.worldToCanvasX(xWorld);
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
        
        // Y-axis ruler (left)
        this.ctx.beginPath();
        this.ctx.moveTo(rulerSize, 0);
        this.ctx.lineTo(rulerSize, this.canvas.height);
        this.ctx.stroke();
        
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'middle';
        
        const startYWorld = Math.floor((viewBounds.minY - originY) / majorStep) * majorStep + originY;
        const endYWorld = Math.ceil((viewBounds.maxY - originY) / majorStep) * majorStep + originY;
        
        for (let yWorld = startYWorld; yWorld <= endYWorld; yWorld += majorStep) {
            const yCanvas = this.worldToCanvasY(yWorld);
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
        
        // Corner square
        this.ctx.fillStyle = colors.background;
        this.ctx.fillRect(0, 0, rulerSize, rulerSize);
        this.ctx.strokeRect(0, 0, rulerSize, rulerSize);
        
        this.ctx.restore();
    }
    
    renderScaleIndicator() {
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        
        const colors = this.colors[this.options.theme];
        const padding = 10;
        const barHeight = 4;
        const y = this.canvas.height - padding - 20;
        
        const targetPixels = 100;
        const worldLength = targetPixels / this.viewScale;
        
        const possibleLengths = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
        const niceLength = possibleLengths.find(len => len * this.viewScale >= 50) || 1;
        const barWidth = niceLength * this.viewScale;
        
        const x = this.canvas.width - padding - barWidth;
        
        // Background for contrast
        this.ctx.fillStyle = colors.background;
        this.ctx.globalAlpha = 0.8;
        this.ctx.fillRect(x - 5, y - 20, barWidth + 10, 30);
        this.ctx.globalAlpha = 1;
        
        // Draw scale bar
        this.ctx.fillStyle = colors.rulerText;
        this.ctx.fillRect(x, y, barWidth, barHeight);
        
        // Draw end caps
        this.ctx.fillRect(x, y - 2, 1, barHeight + 4);
        this.ctx.fillRect(x + barWidth - 1, y - 2, 1, barHeight + 4);
        
        // Draw label
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
    
    // Coordinate conversion methods
    calculateGridSpacing() {
        const minPixelSize = 40;
        const possibleSteps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
        return possibleSteps.find(step => step * this.viewScale >= minPixelSize) || 100;
    }
    
    calculateRulerStep() {
        const minPixelDistance = 50;
        const possibleSteps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
        return possibleSteps.find(step => step * this.viewScale >= minPixelDistance) || 100;
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
    
    // Coordinate system interface
    setOriginPosition(x, y) {
        this.originPosition.x = x;
        this.originPosition.y = y;
        this.render();
    }
    
    setRotation(angle, center) {
        this.currentRotation = angle;
        if (center) {
            this.rotationCenter.x = center.x;
            this.rotationCenter.y = center.y;
        }
        this.render();
    }
    
    getOriginPosition() {
        return { ...this.originPosition };
    }
    
    getBackgroundColor() {
        return this.colors[this.options.theme].background;
    }
    
    resizeCanvas() {
        const parent = this.canvas.parentElement;
        if (parent) {
            const rect = parent.getBoundingClientRect();
            this.canvas.width = rect.width;
            this.canvas.height = rect.height;
            this.render();
        }
    }
    
    // SVG Export functionality
    exportSVG(options = {}) {
        if (this.layers.size === 0) {
            console.warn('No layers to export');
            return null;
        }
        
        const rotateBackground = options.rotateBackground !== false;
        
        // Calculate export bounds
        this.calculateOverallBounds();
        const bounds = this.bounds;
        
        if (!bounds) {
            console.warn('No valid bounds for SVG export');
            return null;
        }
        
        // Add some padding
        const padding = Math.max(bounds.width, bounds.height) * 0.05;
        const exportBounds = {
            minX: bounds.minX - padding,
            minY: bounds.minY - padding,
            maxX: bounds.maxX + padding,
            maxY: bounds.maxY + padding,
            width: bounds.width + padding * 2,
            height: bounds.height + padding * 2
        };
        
        // Create SVG document
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        
        svg.setAttribute('width', `${exportBounds.width}mm`);
        svg.setAttribute('height', `${exportBounds.height}mm`);
        svg.setAttribute('viewBox', `${exportBounds.minX} ${-exportBounds.maxY} ${exportBounds.width} ${exportBounds.height}`);
        svg.setAttribute('xmlns', svgNS);
        
        // Add background
        const background = document.createElementNS(svgNS, 'rect');
        const colors = this.colors[this.options.theme];
        background.setAttribute('x', exportBounds.minX);
        background.setAttribute('y', -exportBounds.maxY);
        background.setAttribute('width', exportBounds.width);
        background.setAttribute('height', exportBounds.height);
        background.setAttribute('fill', colors.background);
        svg.appendChild(background);
        
        // Apply rotation if needed
        let contentGroup = svg;
        if (this.currentRotation !== 0) {
            contentGroup = document.createElementNS(svgNS, 'g');
            contentGroup.setAttribute('transform', 
                `rotate(${-this.currentRotation} ${this.rotationCenter.x} ${-this.rotationCenter.y})`);
            svg.appendChild(contentGroup);
        }
        
        // Add layers
        const renderOrder = ['cutout', 'clear', 'isolation', 'drill'];
        
        renderOrder.forEach(type => {
            this.layers.forEach(layer => {
                if (layer.visible && layer.type === type) {
                    const layerGroup = this.createSVGLayerGroup(layer, exportBounds);
                    if (layerGroup) {
                        contentGroup.appendChild(layerGroup);
                    }
                }
            });
        });
        
        // Convert to string and download
        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(svg);
        
        // Create download
        const blob = new Blob([svgString], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = url;
        const timestamp = Date.now();
        const rotationSuffix = this.currentRotation !== 0 ? `-rot${this.currentRotation}deg` : '';
        link.download = `pcb-export${rotationSuffix}-${timestamp}.svg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        return svgString;
    }
    
    createSVGLayerGroup(layer, bounds) {
        const svgNS = 'http://www.w3.org/2000/svg';
        const group = document.createElementNS(svgNS, 'g');
        group.setAttribute('id', `layer-${layer.name}`);
        group.setAttribute('data-type', layer.type);
        
        // Determine layer color
        const colors = this.colors[this.options.theme];
        let layerColor = layer.color || colors[layer.type] || colors.copper;
        
        if (this.options.blackAndWhite) {
            layerColor = this.options.theme === 'dark' ? '#ffffff' : '#000000';
        }
        
        layer.primitives.forEach((primitive, index) => {
            if (!this.shouldRenderPrimitive(primitive, layer.type)) {
                return;
            }
            
            const svgElement = this.convertPrimitiveToSVG(primitive, layerColor);
            if (svgElement) {
                group.appendChild(svgElement);
            }
        });
        
        return group.hasChildNodes() ? group : null;
    }
    
    convertPrimitiveToSVG(primitive, color) {
        const svgNS = 'http://www.w3.org/2000/svg';
        const isWireframeMode = this.options.showWireframe;
        
        switch (primitive.type) {
            case 'path':
                return this.createSVGPath(primitive, color, isWireframeMode);
            case 'circle':
                return this.createSVGCircle(primitive, color, isWireframeMode);
            case 'rectangle':
                return this.createSVGRectangle(primitive, color, isWireframeMode);
            case 'obround':
                return this.createSVGObround(primitive, color, isWireframeMode);
            default:
                return null;
        }
    }
    
    createSVGPath(primitive, color, isWireframeMode) {
        const svgNS = 'http://www.w3.org/2000/svg';
        const path = document.createElementNS(svgNS, 'path');
        
        if (primitive.points.length < 2) return null;
        
        let pathData = `M ${primitive.points[0].x} ${-primitive.points[0].y}`;
        for (let i = 1; i < primitive.points.length; i++) {
            pathData += ` L ${primitive.points[i].x} ${-primitive.points[i].y}`;
        }
        
        if (primitive.closed) {
            pathData += ' Z';
        }
        
        path.setAttribute('d', pathData);
        
        if (isWireframeMode) {
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', color);
            path.setAttribute('stroke-width', '0.08');
        } else {
            path.setAttribute('fill', color);
            path.setAttribute('stroke', 'none');
        }
        
        return path;
    }
    
    createSVGCircle(primitive, color, isWireframeMode) {
        const svgNS = 'http://www.w3.org/2000/svg';
        const circle = document.createElementNS(svgNS, 'circle');
        
        circle.setAttribute('cx', primitive.center.x);
        circle.setAttribute('cy', -primitive.center.y);
        circle.setAttribute('r', primitive.radius);
        
        if (isWireframeMode) {
            circle.setAttribute('fill', 'none');
            circle.setAttribute('stroke', color);
            circle.setAttribute('stroke-width', '0.08');
        } else {
            circle.setAttribute('fill', color);
            circle.setAttribute('stroke', 'none');
        }
        
        return circle;
    }
    
    createSVGRectangle(primitive, color, isWireframeMode) {
        const svgNS = 'http://www.w3.org/2000/svg';
        const rect = document.createElementNS(svgNS, 'rect');
        
        rect.setAttribute('x', primitive.position.x);
        rect.setAttribute('y', -primitive.position.y - primitive.height);
        rect.setAttribute('width', primitive.width);
        rect.setAttribute('height', primitive.height);
        
        if (isWireframeMode) {
            rect.setAttribute('fill', 'none');
            rect.setAttribute('stroke', color);
            rect.setAttribute('stroke-width', '0.08');
        } else {
            rect.setAttribute('fill', color);
            rect.setAttribute('stroke', 'none');
        }
        
        return rect;
    }
    
    createSVGObround(primitive, color, isWireframeMode) {
        const svgNS = 'http://www.w3.org/2000/svg';
        const path = document.createElementNS(svgNS, 'path');
        
        const x = primitive.position.x;
        const y = -primitive.position.y - primitive.height;
        const w = primitive.width;
        const h = primitive.height;
        const r = Math.min(w, h) / 2;
        
        let pathData;
        if (w > h) {
            pathData = `M ${x + r} ${y} L ${x + w - r} ${y} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} L ${x + r} ${y + h} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
        } else {
            pathData = `M ${x + w} ${y + r} L ${x + w} ${y + h - r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} L ${x} ${y + r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} Z`;
        }
        
        path.setAttribute('d', pathData);
        
        if (isWireframeMode) {
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', color);
            path.setAttribute('stroke-width', '0.08');
        } else {
            path.setAttribute('fill', color);
            path.setAttribute('stroke', 'none');
        }
        
        return path;
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CanvasRenderer;
} else {
    window.CanvasRenderer = CanvasRenderer;
}