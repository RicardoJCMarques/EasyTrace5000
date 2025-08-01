// Layer Renderer - FIXED: Mobile touch, wireframe mode, canvas positioning
// File Location: renderer/layer-renderer.js
// FIXES: Mobile pan/zoom, fill as wireframe toggle, proper canvas lifecycle

class LayerRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            throw new Error(`Canvas element with id '${canvasId}' not found`);
        }
        
        this.ctx = this.canvas.getContext('2d');
        if (!this.ctx) {
            throw new Error('Could not get 2D context from canvas');
        }
        
        // View state
        this.viewOffset = { x: 0, y: 0 };
        this.viewScale = 1;
        this.bounds = null;
        
        // Coordinate system integration
        this.coordinateSystem = null;
        
        // FIXED: Simplified render options with wireframe toggle
        this.options = {
            showFill: true,              // FIXED: When false, shows all geometry as perimeters
            showPads: true,
            blackAndWhite: false,
            showGrid: true,
            showOrigin: true,
            showBounds: false,
            showRulers: true,
            // Geometry type controls
            showRegions: true,
            showTraces: true,
            showDrills: true,
            showCutouts: true,
            theme: 'dark',
            debug: false
        };
        
        // Track origin position for coordinate system display
        this.originPosition = { x: 0, y: 0 };
        
        // Enhanced color schemes
        this.colors = {
            dark: {
                background: '#1a1a1a',
                isolation: '#ff8844',    // Orange for isolation routing
                clear: '#44ff88',        // Green for copper clearing  
                drill: '#4488ff',        // Blue for drilling
                cutout: '#ff00ff',       // Magenta for board cutout
                copper: '#ff8844',       // Fallback copper color
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
        
        // Rendering validation and debugging
        this.validationResults = new Map();
        this.renderingIssues = [];
        
        // Stats
        this.renderStats = {
            primitives: 0,
            renderTime: 0,
            coordinateIssues: 0
        };
        
        // Zoom constraints
        this.minZoom = 0.01;
        this.maxZoom = 1000;
        
        // FIXED: Improved interaction state for mobile
        this.interactionState = {
            isPanning: false,
            lastPointer: { x: 0, y: 0 },
            pointerCount: 0,
            initialDistance: 0,
            initialScale: 1
        };
        
        this.setupEventListeners();
        this.resizeCanvas();
        
        console.log('FIXED: LayerRenderer initialized with mobile touch support and wireframe mode');
    }
    
    setOptions(options) {
        Object.assign(this.options, options);
        this.render();
    }
    
    addLayer(name, primitives, options = {}) {
        // Validate primitives before adding to layer
        const validationResult = this.validateLayerPrimitives(primitives);
        this.validationResults.set(name, validationResult);
        
        if (validationResult.criticalIssues > 0) {
            console.warn(`[LayerRenderer-FIXED] Layer '${name}' has ${validationResult.criticalIssues} critical coordinate issues`);
        }
        
        this.layers.set(name, {
            name: name,
            primitives: primitives,
            visible: options.visible !== false,
            type: options.type || 'copper',
            bounds: options.bounds || this.calculateLayerBounds(primitives),
            color: options.color || null,
            validation: validationResult
        });
        
        this.calculateOverallBounds();
        this.render();
    }
    
    validateLayerPrimitives(primitives) {
        if (!primitives || primitives.length === 0) {
            return {
                valid: true,
                primitiveCount: 0,
                criticalIssues: 0,
                warnings: 0,
                coordinateRanges: null
            };
        }
        
        let criticalIssues = 0;
        let warnings = 0;
        
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        const issues = [];
        
        primitives.forEach((primitive, index) => {
            const bounds = primitive.getBounds();
            if (!isFinite(bounds.minX) || !isFinite(bounds.minY) || 
                !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                criticalIssues++;
                issues.push({
                    type: 'invalid_bounds',
                    index: index,
                    message: `Primitive ${index} has invalid bounds`,
                    primitive: primitive
                });
                return;
            }
            
            minX = Math.min(minX, bounds.minX);
            minY = Math.min(minY, bounds.minY);
            maxX = Math.max(maxX, bounds.maxX);
            maxY = Math.max(maxY, bounds.maxY);
            
            const maxCoord = 1000; // mm
            if (Math.abs(bounds.minX) > maxCoord || Math.abs(bounds.minY) > maxCoord ||
                Math.abs(bounds.maxX) > maxCoord || Math.abs(bounds.maxY) > maxCoord) {
                warnings++;
                issues.push({
                    type: 'large_coordinates',
                    index: index,
                    message: `Primitive ${index} has suspiciously large coordinates`,
                    bounds: bounds,
                    primitive: primitive
                });
            }
        });
        
        const result = {
            valid: criticalIssues === 0,
            primitiveCount: primitives.length,
            criticalIssues,
            warnings,
            coordinateRanges: isFinite(minX) ? { minX, minY, maxX, maxY } : null,
            issues: issues
        };
        
        return result;
    }
    
    clearLayers() {
        this.layers.clear();
        this.validationResults.clear();
        this.renderingIssues = [];
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
    
    // FIXED: Improved bounds calculation with validation
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
            
            console.log('FIXED: Calculated overall bounds:', this.bounds);
        } else {
            this.bounds = null;
            console.log('FIXED: No valid bounds available');
        }
    }
    
    render() {
        const startTime = performance.now();
        this.renderStats.primitives = 0;
        this.renderStats.coordinateIssues = 0;
        this.renderingIssues = [];
        
        // Clear canvas
        const colors = this.colors[this.options.theme];
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = colors.background;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.ctx.save();
        
        // Apply view transformation
        this.ctx.translate(this.viewOffset.x, this.viewOffset.y);
        this.ctx.scale(this.viewScale, -this.viewScale); // Flip Y for PCB coordinates
        
        // Render background elements
        if (this.options.showGrid) this.renderGrid();
        if (this.options.showBounds && this.bounds) this.renderBounds();
        
        // Render layers in order with proper colors
        const renderOrder = ['cutout', 'clear', 'isolation', 'drill'];
        
        renderOrder.forEach(type => {
            this.layers.forEach(layer => {
                if (layer.visible && layer.type === type) {
                    this.renderLayer(layer);
                }
            });
        });
        
        // Render origin marker ALWAYS ON TOP
        if (this.options.showOrigin) this.renderOrigin();
        
        this.ctx.restore();
        
        // Render screen-space elements
        if (this.options.showRulers) this.renderRulers();
        this.renderScaleIndicator();
        
        const endTime = performance.now();
        this.renderStats.renderTime = endTime - startTime;
        
        if (this.options.debug) {
            this.renderDebugInfo();
        }
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
        
        layer.primitives.forEach(primitive => {
            this.renderStats.primitives++;
            
            // Geometry type filtering
            if (!this.shouldRenderPrimitive(primitive, layer.type)) {
                return;
            }
            
            // Skip primitives with invalid bounds
            const bounds = primitive.getBounds();
            if (!isFinite(bounds.minX) || !isFinite(bounds.minY) || 
                !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                this.renderStats.coordinateIssues++;
                this.renderingIssues.push({
                    type: 'invalid_bounds',
                    primitive: primitive,
                    layer: layer.name
                });
                return;
            }
            
            let fillColor = layerColor;
            let strokeColor = layerColor;
            
            if (primitive.properties.isNonConductor) {
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
        // Cutout layer filtering
        if (layerType === 'cutout') {
            if (!this.options.showCutouts) {
                return false;
            }
            
            // Show closed paths (board outlines)
            if (primitive.type === 'path' && primitive.closed) {
                const bounds = primitive.getBounds();
                const perimeter = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
                if (perimeter > 5) {
                    return true;
                }
            }
            
            // Show circles and rectangles that could be cutouts
            if (primitive.type === 'circle' || primitive.type === 'rectangle' || primitive.type === 'obround') {
                const bounds = primitive.getBounds();
                const size = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
                if (size > 1) {
                    return true;
                }
            }
            
            // Don't show obvious non-cutout features
            if (primitive.properties.isText || 
                primitive.properties.function === 'Legend' ||
                primitive.properties.isStroke) {
                return false;
            }
            
            return true;
        }
        
        // For non-cutout layers, apply normal filtering
        
        // Drill holes
        if (primitive.properties.isDrillHole || layerType === 'drill') {
            return this.options.showDrills;
        }
        
        // Traces (strokes)
        if (primitive.properties.isStroke) {
            return this.options.showTraces;
        }
        
        // Pads/Flashes
        if (primitive.properties.isFlash || primitive.type === 'circle' || 
            primitive.type === 'rectangle' || primitive.type === 'obround') {
            return this.options.showPads;
        }
        
        // Regions (filled polygons)
        if (primitive.properties.isRegion || 
            (primitive.type === 'path' && primitive.closed && !primitive.properties.isStroke)) {
            return this.options.showRegions;
        }
        
        // Open paths that aren't strokes
        if (primitive.type === 'path' && !primitive.closed) {
            return this.options.showTraces;
        }
        
        return true;
    }
    
    // FIXED: Simplified wireframe mode - show all geometry perimeters when fill is off
    renderPrimitive(primitive, fillColor, strokeColor) {
        this.ctx.save();
        
        this.ctx.fillStyle = fillColor;
        this.ctx.strokeStyle = strokeColor;
        
        // FIXED: Simple wireframe toggle logic
        const isWireframeMode = !this.options.showFill;
        
        if (isWireframeMode) {
            // WIREFRAME MODE: Show all geometry as perimeters with appropriate widths
            this.ctx.lineWidth = this.getWireframeWidth(primitive);
            this.ctx.fillStyle = 'transparent'; // Don't fill in wireframe mode
        } else {
            // FILL MODE: Show geometry as filled shapes
            this.ctx.lineWidth = 0; // No strokes in fill mode
        }
        
        switch (primitive.type) {
            case 'path':
                this.renderPath(primitive, isWireframeMode);
                break;
            case 'circle':
                this.renderCircle(primitive, isWireframeMode);
                break;
            case 'rectangle':
                this.renderRectangle(primitive, isWireframeMode);
                break;
            case 'obround':
                this.renderObround(primitive, isWireframeMode);
                break;
            case 'arc':
                this.renderArc(primitive, isWireframeMode);
                break;
            case 'composite':
                primitive.primitives.forEach(p => this.renderPrimitive(p, fillColor, strokeColor));
                break;
        }
        
        this.ctx.restore();
    }
    
    // FIXED: Get appropriate wireframe width for different primitive types
    getWireframeWidth(primitive) {
        if (primitive.properties.isStroke && primitive.properties.originalWidth) {
            // For strokes, use original aperture width for dimensional accuracy
            return primitive.properties.originalWidth / this.viewScale;
        } else if (primitive.properties.isDrillHole) {
            // Drill holes get medium outline
            return 0.1 / this.viewScale;
        } else if (primitive.properties.isRegion) {
            // Regions get thin outline
            return 0.03 / this.viewScale;
        } else {
            // Default thin outline
            return 0.05 / this.viewScale;
        }
    }
    
    // FIXED: Simplified path rendering with wireframe mode
    renderPath(primitive, isWireframeMode) {
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
        
        if (isWireframeMode) {
            // Wireframe: always stroke, never fill
            if (this.ctx.lineWidth > 0) {
                this.ctx.stroke();
            }
        } else {
            // Fill mode: always fill if possible
            if (primitive.closed || primitive.properties.isStroke) {
                if (primitive.properties.fillRule) {
                    this.ctx.fill(primitive.properties.fillRule);
                } else {
                    this.ctx.fill();
                }
            }
        }
    }
    
    // FIXED: Simplified circle rendering
    renderCircle(primitive, isWireframeMode) {
        this.ctx.beginPath();
        this.ctx.arc(
            primitive.center.x,
            primitive.center.y,
            primitive.radius,
            0,
            2 * Math.PI
        );
        
        if (isWireframeMode) {
            if (this.ctx.lineWidth > 0) {
                this.ctx.stroke();
            }
        } else {
            this.ctx.fill();
        }
    }
    
    // FIXED: Simplified rectangle rendering
    renderRectangle(primitive, isWireframeMode) {
        if (isWireframeMode) {
            if (this.ctx.lineWidth > 0) {
                this.ctx.strokeRect(
                    primitive.position.x,
                    primitive.position.y,
                    primitive.width,
                    primitive.height
                );
            }
        } else {
            this.ctx.fillRect(
                primitive.position.x,
                primitive.position.y,
                primitive.width,
                primitive.height
            );
        }
    }
    
    // FIXED: Simplified obround rendering
    renderObround(primitive, isWireframeMode) {
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
        
        if (isWireframeMode) {
            if (this.ctx.lineWidth > 0) {
                this.ctx.stroke();
            }
        } else {
            this.ctx.fill();
        }
    }
    
    renderArc(primitive, isWireframeMode) {
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
        
        if (isWireframeMode) {
            if (this.ctx.lineWidth > 0) {
                this.ctx.stroke();
            }
        } else {
            // Arcs typically don't fill in PCB context
            if (this.ctx.lineWidth > 0) {
                this.ctx.stroke();
            }
        }
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
    
    renderDebugInfo() {
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        
        const colors = this.colors[this.options.theme];
        this.ctx.fillStyle = colors.rulerText;
        this.ctx.font = '12px monospace';
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'top';
        
        const info = [
            `Primitives: ${this.renderStats.primitives}`,
            `Render: ${this.renderStats.renderTime.toFixed(1)}ms`,
            `Scale: ${this.viewScale.toFixed(2)}×`,
            `Offset: (${this.viewOffset.x.toFixed(0)}, ${this.viewOffset.y.toFixed(0)})`,
            `Layers: ${this.layers.size}`,
            `Coord Issues: ${this.renderStats.coordinateIssues}`,
            `Mode: ${this.options.showFill ? 'FILL' : 'WIREFRAME'}`,
            `Origin: (${this.originPosition.x.toFixed(1)}, ${this.originPosition.y.toFixed(1)})`
        ];
        
        const x = 30;
        let y = this.canvas.height - 140;
        
        info.forEach(line => {
            this.ctx.fillText(line, x, y);
            y += 15;
        });
        
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
    setCoordinateSystem(coordinateSystem) {
        this.coordinateSystem = coordinateSystem;
        console.log('FIXED: Coordinate system linked to renderer');
    }
    
    setOriginPosition(x, y) {
        this.originPosition.x = x;
        this.originPosition.y = y;
        this.render();
    }
    
    getOriginPosition() {
        return { ...this.originPosition };
    }
    
    getCoordinateSystem() {
        return this.coordinateSystem;
    }
    
    zoomIn(cursorX = null, cursorY = null) {
        this.setZoom(this.viewScale * 1.2, cursorX, cursorY);
    }
    
    zoomOut(cursorX = null, cursorY = null) {
        this.setZoom(this.viewScale / 1.2, cursorX, cursorY);
    }
    
    setZoom(newScale, centerX = null, centerY = null) {
        const oldScale = this.viewScale;
        this.viewScale = Math.max(this.minZoom, Math.min(this.maxZoom, newScale));
        
        if (centerX === null) centerX = this.canvas.width / 2;
        if (centerY === null) centerY = this.canvas.height / 2;
        
        const worldCenterX = (centerX - this.viewOffset.x) / oldScale;
        const worldCenterY = -(centerY - this.viewOffset.y) / oldScale;
        
        const scaleFactor = this.viewScale / oldScale;
        this.viewOffset.x = this.viewOffset.x * scaleFactor;
        this.viewOffset.y = this.viewOffset.y * scaleFactor;
        
        const newCanvasX = this.viewOffset.x + worldCenterX * this.viewScale;
        const newCanvasY = this.viewOffset.y - worldCenterY * this.viewScale;
        
        this.viewOffset.x += centerX - newCanvasX;
        this.viewOffset.y += centerY - newCanvasY;
        
        this.render();
    }
    
    pan(dx, dy) {
        this.viewOffset.x += dx;
        this.viewOffset.y += dy;
        this.render();
    }
    
    // FIXED: Better zoom fit with proper bounds validation
    zoomFit() {
        console.log('FIXED: zoomFit called with bounds:', this.bounds);
        
        this.calculateOverallBounds();
        
        if (!this.bounds || !isFinite(this.bounds.width) || !isFinite(this.bounds.height)) {
            console.log('FIXED: No valid bounds - centering on origin');
            // No content - center on origin with reasonable zoom
            this.viewScale = 10;
            this.viewOffset = { 
                x: this.canvas.width / 2, 
                y: this.canvas.height / 2 
            };
            this.render();
            return;
        }
        
        const padding = 0.1; // 10% padding
        const desiredWidth = this.bounds.width * (1 + padding * 2);
        const desiredHeight = this.bounds.height * (1 + padding * 2);
        
        // Ensure minimum zoom for small boards
        const minZoom = 1;
        const scaleX = Math.max(minZoom, this.canvas.width / desiredWidth);
        const scaleY = Math.max(minZoom, this.canvas.height / desiredHeight);
        this.viewScale = Math.min(scaleX, scaleY);
        
        // Center the board bounds in the canvas
        this.viewOffset.x = this.canvas.width / 2 - this.bounds.centerX * this.viewScale;
        this.viewOffset.y = this.canvas.height / 2 + this.bounds.centerY * this.viewScale;
        
        console.log('FIXED: zoomFit applied - scale:', this.viewScale, 'offset:', this.viewOffset);
        
        this.render();
    }
    
    // FIXED: Enhanced mobile touch handling
    setupEventListeners() {
        // Prevent image dragging and context menu
        this.canvas.style.cursor = 'grab';
        this.canvas.style.userSelect = 'none';
        this.canvas.style.webkitUserSelect = 'none';
        this.canvas.style.mozUserSelect = 'none';
        this.canvas.style.msUserSelect = 'none';
        this.canvas.style.touchAction = 'none'; // FIXED: Prevent default touch behaviors
        
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
        
        this.canvas.addEventListener('dragstart', (e) => {
            e.preventDefault();
        });
        
        // FIXED: Mouse events (desktop)
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                e.preventDefault();
                this.startInteraction(e.clientX, e.clientY, 'mouse');
            }
        });
        
        this.canvas.addEventListener('mousemove', (e) => {
            if (this.interactionState.isPanning && this.interactionState.pointerCount === 1) {
                e.preventDefault();
                this.updateInteraction(e.clientX, e.clientY);
            }
        });
        
        document.addEventListener('mouseup', (e) => {
            if (this.interactionState.isPanning) {
                this.endInteraction();
            }
        });
        
        // FIXED: Touch events (mobile/tablet)
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            
            if (e.touches.length === 1) {
                // Single touch - start panning
                const touch = e.touches[0];
                this.startInteraction(touch.clientX, touch.clientY, 'touch');
            } else if (e.touches.length === 2) {
                // Two finger touch - start pinch zoom
                const touch1 = e.touches[0];
                const touch2 = e.touches[1];
                
                const distance = Math.sqrt(
                    Math.pow(touch2.clientX - touch1.clientX, 2) +
                    Math.pow(touch2.clientY - touch1.clientY, 2)
                );
                
                this.interactionState.pointerCount = 2;
                this.interactionState.initialDistance = distance;
                this.interactionState.initialScale = this.viewScale;
                
                // Center point for zoom
                const centerX = (touch1.clientX + touch2.clientX) / 2;
                const centerY = (touch1.clientY + touch2.clientY) / 2;
                this.interactionState.lastPointer = { x: centerX, y: centerY };
            }
        }, { passive: false });
        
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            
            if (e.touches.length === 1 && this.interactionState.isPanning) {
                // Single touch panning
                const touch = e.touches[0];
                this.updateInteraction(touch.clientX, touch.clientY);
            } else if (e.touches.length === 2 && this.interactionState.pointerCount === 2) {
                // Two finger pinch zoom
                const touch1 = e.touches[0];
                const touch2 = e.touches[1];
                
                const distance = Math.sqrt(
                    Math.pow(touch2.clientX - touch1.clientX, 2) +
                    Math.pow(touch2.clientY - touch1.clientY, 2)
                );
                
                const scaleChange = distance / this.interactionState.initialDistance;
                const newScale = this.interactionState.initialScale * scaleChange;
                
                // Center point for zoom
                const centerX = (touch1.clientX + touch2.clientX) / 2;
                const centerY = (touch1.clientY + touch2.clientY) / 2;
                
                // Get canvas relative coordinates
                const rect = this.canvas.getBoundingClientRect();
                const canvasCenterX = centerX - rect.left;
                const canvasCenterY = centerY - rect.top;
                
                this.setZoom(newScale, canvasCenterX, canvasCenterY);
            }
        }, { passive: false });
        
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            
            if (e.touches.length === 0) {
                // All touches ended
                this.endInteraction();
            } else if (e.touches.length === 1 && this.interactionState.pointerCount === 2) {
                // From pinch to single touch - restart panning
                const touch = e.touches[0];
                this.startInteraction(touch.clientX, touch.clientY, 'touch');
            }
        }, { passive: false });
        
        // Mouse wheel zoom (desktop)
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            const rect = this.canvas.getBoundingClientRect();
            const cursorX = e.clientX - rect.left;
            const cursorY = e.clientY - rect.top;
            
            const scaleAmount = 1.1;
            
            if (e.deltaY < 0) {
                this.setZoom(this.viewScale * scaleAmount, cursorX, cursorY);
            } else {
                this.setZoom(this.viewScale / scaleAmount, cursorX, cursorY);
            }
        }, { passive: false });
        
        // Double-click/tap to fit
        this.canvas.addEventListener('dblclick', (e) => {
            e.preventDefault();
            this.zoomFit();
        });
        
        // Handle resize
        this.resizeObserver = new ResizeObserver(() => {
            this.resizeCanvas();
        });
        this.resizeObserver.observe(this.canvas);
    }
    
    // FIXED: Unified interaction handling for mouse and touch
    startInteraction(x, y, type) {
        this.interactionState.isPanning = true;
        this.interactionState.pointerCount = 1;
        this.interactionState.lastPointer = { x, y };
        this.canvas.style.cursor = 'grabbing';
    }
    
    updateInteraction(x, y) {
        if (this.interactionState.isPanning && this.interactionState.pointerCount === 1) {
            const dx = x - this.interactionState.lastPointer.x;
            const dy = y - this.interactionState.lastPointer.y;
            this.pan(dx, dy);
            this.interactionState.lastPointer = { x, y };
        }
    }
    
    endInteraction() {
        this.interactionState.isPanning = false;
        this.interactionState.pointerCount = 0;
        this.canvas.style.cursor = 'grab';
    }
    
    // FIXED: Improved canvas resizing
    resizeCanvas() {
        const parent = this.canvas.parentElement;
        if (parent) {
            const rect = parent.getBoundingClientRect();
            this.canvas.width = rect.width;
            this.canvas.height = rect.height;
            this.render();
            console.log('FIXED: Canvas resized to', rect.width, 'x', rect.height);
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LayerRenderer;
} else {
    window.LayerRenderer = LayerRenderer;
}