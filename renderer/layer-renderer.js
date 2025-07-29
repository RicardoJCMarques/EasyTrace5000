// Layer Renderer - Fixed coordinate system communication and colors
// renderer/layer-renderer.js

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
        
        // Coordinate system - SIMPLIFIED
        this.coordinateSystem = null;
        this.originPosition = { x: 0, y: 0 }; // Working origin in board coordinates
        
        // Render options
        this.options = {
            showFill: true,
            showOutlines: true,
            blackAndWhite: false,
            showGrid: true,
            showOrigin: true,
            showBounds: false,
            showRulers: true,
            showOriginal: true, // Control original geometry visibility
            theme: 'dark',
            debug: false
        };
        
        // Enhanced color schemes with unique colors per operation type
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
                bounds: '#ff0000',
                ruler: '#666666',
                rulerText: '#333333'
            }
        };
        
        // Layers storage
        this.layers = new Map();
        
        // Stats
        this.renderStats = {
            primitives: 0,
            renderTime: 0
        };
        
        this.setupEventListeners();
        this.resizeCanvas();
        
        console.log('LayerRenderer initialized with fixed coordinate system');
    }
    
    setOptions(options) {
        Object.assign(this.options, options);
        this.render();
    }
    
    addLayer(name, primitives, options = {}) {
        this.layers.set(name, {
            name: name,
            primitives: primitives,
            visible: options.visible !== false,
            type: options.type || 'copper',
            bounds: options.bounds || this.calculateLayerBounds(primitives),
            color: options.color || null // Allow custom colors per layer
        });
        
        this.calculateOverallBounds();
        this.render();
    }
    
    clearLayers() {
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
        
        if (hasData) {
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
        
        // Clear canvas
        const colors = this.colors[this.options.theme];
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = colors.background;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.ctx.save();
        
        // Apply view transformation
        this.ctx.translate(this.viewOffset.x, this.viewOffset.y);
        this.ctx.scale(this.viewScale, -this.viewScale); // Flip Y for PCB coordinates
        this.ctx.translate(-this.originPosition.x, -this.originPosition.y);
        
        // Render background elements
        if (this.options.showGrid) this.renderGrid();
        if (this.options.showBounds && this.bounds) this.renderBounds();
        if (this.options.showOrigin) this.renderOrigin();
        
        // Render layers in order with proper colors - FIXED: Drill holes on top
        const renderOrder = ['cutout', 'clear', 'isolation', 'drill'];
        
        renderOrder.forEach(type => {
            this.layers.forEach(layer => {
                if (layer.visible && layer.type === type) {
                    // Only render if showOriginal is enabled or layer is not original geometry
                    if (this.options.showOriginal || layer.isOffset) {
                        this.renderLayer(layer);
                    }
                }
            });
        });
        
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
        
        // Determine layer color with proper mapping
        let layerColor;
        if (layer.color) {
            // Custom color overrides everything
            layerColor = layer.color;
        } else {
            // Map operation types to distinct colors
            switch (layer.type) {
                case 'isolation':
                    layerColor = colors.isolation;
                    break;
                case 'clear':
                    layerColor = colors.clear;
                    break;
                case 'drill':
                    layerColor = colors.drill;
                    break;
                case 'cutout':
                    layerColor = colors.cutout;
                    break;
                default:
                    layerColor = colors.copper;
                    break;
            }
        }
        
        layer.primitives.forEach(primitive => {
            this.renderStats.primitives++;
            
            // Override primitive-specific colors with layer color for consistency
            let fillColor = layerColor;
            let strokeColor = layerColor;
            
            // Handle special cases
            if (primitive.properties.isNonConductor) {
                fillColor = colors.nonConductor;
                strokeColor = colors.nonConductor;
            }
            
            // Black and white mode
            if (this.options.blackAndWhite) {
                const bwColor = this.options.theme === 'dark' ? '#ffffff' : '#000000';
                fillColor = bwColor;
                strokeColor = bwColor;
            }
            
            // Render primitive with fixed stroke width handling
            this.renderPrimitive(primitive, fillColor, strokeColor);
        });
    }
    
    renderPrimitive(primitive, fillColor, strokeColor) {
        this.ctx.save();
        
        // Set styles
        this.ctx.fillStyle = fillColor;
        this.ctx.strokeStyle = strokeColor;
        
        // FIXED: Enhanced stroke width handling with debug support
        if (primitive.properties.isStroke) {
            // For stroke primitives, width is already baked into geometry
            if (this.options.showFill) {
                // Normal mode: minimal outline only
                this.ctx.lineWidth = 0.05 / this.viewScale;
            } else {
                // Debug mode: show centerline with original width for reference
                this.ctx.lineWidth = primitive.properties.originalWidth || (0.1 / this.viewScale);
            }
        } else if (primitive.properties.isDrillHole) {
            // Drill holes get consistent thin outline
            this.ctx.lineWidth = 0.1 / this.viewScale;
        } else {
            // Normal primitives use specified or default width
            this.ctx.lineWidth = primitive.properties.strokeWidth || (0.1 / this.viewScale);
        }
        
        switch (primitive.type) {
            case 'path':
                this.renderPath(primitive);
                break;
            case 'circle':
                this.renderCircle(primitive);
                break;
            case 'rectangle':
                this.renderRectangle(primitive);
                break;
            case 'obround':
                this.renderObround(primitive);
                break;
            case 'arc':
                this.renderArc(primitive);
                break;
            case 'composite':
                primitive.primitives.forEach(p => this.renderPrimitive(p, fillColor, strokeColor));
                break;
        }
        
        this.ctx.restore();
    }
    
    renderPath(primitive) {
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
        
        // ENHANCED: Stroke primitive rendering with debug support
        if (primitive.properties.isStroke) {
            if (this.options.showFill) {
                // Normal mode: fill the stroke geometry
                this.ctx.fill();
                
                // Optional outline if requested
                if (this.options.showOutlines) {
                    this.ctx.save();
                    this.ctx.lineWidth = 0.03 / this.viewScale; // Very thin outline
                    this.ctx.globalAlpha = 0.5;
                    this.ctx.stroke();
                    this.ctx.restore();
                }
            } else {
                // Debug mode: show centerline/outline only
                if (primitive.points.length === 2 && !primitive.closed) {
                    // Simple line - draw centerline
                    this.ctx.save();
                    this.ctx.setLineDash([0.3 / this.viewScale, 0.3 / this.viewScale]);
                    this.ctx.globalAlpha = 0.8;
                    this.ctx.stroke();
                    this.ctx.restore();
                } else {
                    // Complex stroke path - show outline
                    this.ctx.save();
                    this.ctx.lineWidth = 0.05 / this.viewScale;
                    this.ctx.globalAlpha = 0.7;
                    this.ctx.stroke();
                    this.ctx.restore();
                }
                
                // Show original width as reference in debug mode
                if (this.options.debug && primitive.properties.originalWidth) {
                    this.ctx.save();
                    this.ctx.globalAlpha = 0.2;
                    this.ctx.setLineDash([0.2 / this.viewScale, 0.4 / this.viewScale]);
                    this.ctx.lineWidth = primitive.properties.originalWidth;
                    this.ctx.stroke();
                    this.ctx.restore();
                }
            }
        } else {
            // Normal path rendering
            const shouldFill = this.options.showFill && 
                              primitive.properties.fill !== false &&
                              !primitive.properties.isText;
            
            const shouldStroke = this.options.showOutlines || 
                                primitive.properties.stroke === true ||
                                (!shouldFill && primitive.properties.fill === true);
            
            if (shouldFill) {
                if (primitive.properties.fillRule) {
                    this.ctx.fill(primitive.properties.fillRule);
                } else {
                    this.ctx.fill();
                }
            }
            
            if (shouldStroke) {
                this.ctx.stroke();
            }
        }
    }
    
    renderCircle(primitive) {
        this.ctx.beginPath();
        this.ctx.arc(
            primitive.center.x,
            primitive.center.y,
            primitive.radius,
            0,
            2 * Math.PI
        );
        
        // FIXED: Ensure drill holes are always visible
        const isDrillHole = primitive.properties.isDrillHole;
        
        const shouldFill = (this.options.showFill && primitive.properties.fill !== false) || 
                          (isDrillHole && this.options.showFill); // Always fill drill holes when fill is enabled
        
        const shouldStroke = this.options.showOutlines || 
                            primitive.properties.stroke === true || 
                            isDrillHole || // Always stroke drill holes for visibility
                            (!shouldFill && primitive.properties.fill !== false);
        
        if (shouldFill) {
            this.ctx.fill();
        }
        if (shouldStroke) {
            this.ctx.stroke();
        }
    }
    
    renderRectangle(primitive) {
        const shouldFill = this.options.showFill && primitive.properties.fill !== false;
        const shouldStroke = this.options.showOutlines || primitive.properties.stroke === true;
        
        if (shouldFill) {
            this.ctx.fillRect(
                primitive.position.x,
                primitive.position.y,
                primitive.width,
                primitive.height
            );
        }
        if (shouldStroke) {
            this.ctx.strokeRect(
                primitive.position.x,
                primitive.position.y,
                primitive.width,
                primitive.height
            );
        }
    }
    
    renderObround(primitive) {
        // Render as a path with rounded ends
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
        
        const shouldFill = this.options.showFill && primitive.properties.fill !== false;
        const shouldStroke = this.options.showOutlines || primitive.properties.stroke === true;
        
        if (shouldFill) {
            this.ctx.fill();
        }
        if (shouldStroke) {
            this.ctx.stroke();
        }
    }
    
    renderArc(primitive) {
        // Calculate radius and angles
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
        
        if (this.options.showOutlines || primitive.properties.stroke === true) {
            this.ctx.stroke();
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
        
        // Grid aligned to origin position
        const startX = Math.floor((viewBounds.minX) / gridSpacing) * gridSpacing;
        const endX = Math.ceil((viewBounds.maxX) / gridSpacing) * gridSpacing;
        
        for (let x = startX; x <= endX; x += gridSpacing) {
            this.ctx.moveTo(x, viewBounds.minY);
            this.ctx.lineTo(x, viewBounds.maxY);
        }
        
        const startY = Math.floor((viewBounds.minY) / gridSpacing) * gridSpacing;
        const endY = Math.ceil((viewBounds.maxY) / gridSpacing) * gridSpacing;
        
        for (let y = startY; y <= endY; y += gridSpacing) {
            this.ctx.moveTo(viewBounds.minX, y);
            this.ctx.lineTo(viewBounds.maxX, y);
        }
        
        this.ctx.stroke();
    }
    
    renderOrigin() {
        const colors = this.colors[this.options.theme];
        this.ctx.strokeStyle = colors.origin;
        this.ctx.lineWidth = 2 / this.viewScale;
        const markerSize = 5 / this.viewScale;
        
        // Draw crosshair at working origin (0,0 in current coordinate system)
        // This represents where the user has set their working origin
        this.ctx.beginPath();
        this.ctx.moveTo(-markerSize, 0);
        this.ctx.lineTo(markerSize, 0);
        this.ctx.moveTo(0, -markerSize);
        this.ctx.lineTo(0, markerSize);
        this.ctx.stroke();
        
        // Draw circle at origin for better visibility
        this.ctx.beginPath();
        this.ctx.arc(0, 0, markerSize * 0.4, 0, 2 * Math.PI);
        this.ctx.stroke();
        
        // Origin label
        this.ctx.save();
        this.ctx.scale(1, -1); // Flip Y for text
        this.ctx.font = `${12 / this.viewScale}px Arial`;
        this.ctx.fillStyle = colors.origin;
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'top';
        this.ctx.fillText('0,0', markerSize + (2 / this.viewScale), -(markerSize + (12 / this.viewScale)));
        this.ctx.restore();
        
        // ENHANCED: Show working origin coordinates in board space for debugging
        if (this.options.debug) {
            this.ctx.save();
            this.ctx.scale(1, -1);
            this.ctx.font = `${10 / this.viewScale}px Arial`;
            this.ctx.fillStyle = colors.origin;
            this.ctx.textAlign = 'left';
            this.ctx.textBaseline = 'bottom';
            this.ctx.fillText(
                `Board: (${this.originPosition.x.toFixed(1)}, ${this.originPosition.y.toFixed(1)})`, 
                markerSize + (2 / this.viewScale), 
                markerSize + (10 / this.viewScale)
            );
            this.ctx.restore();
        }
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
        
        // Add corner markers
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
        
        // X-axis ruler
        this.ctx.beginPath();
        this.ctx.moveTo(rulerSize, rulerSize);
        this.ctx.lineTo(this.canvas.width, rulerSize);
        this.ctx.stroke();
        
        this.ctx.textAlign = 'center';
        const startX = Math.floor((viewBounds.minX) / majorStep) * majorStep;
        const endX = Math.ceil((viewBounds.maxX) / majorStep) * majorStep;
        
        for (let xWorld = startX; xWorld <= endX; xWorld += majorStep) {
            const xCanvas = this.worldToCanvasX(xWorld);
            if (xCanvas >= rulerSize && xCanvas <= this.canvas.width) {
                this.ctx.moveTo(xCanvas, rulerSize);
                this.ctx.lineTo(xCanvas, rulerSize - tickLength);
                
                // Show coordinates relative to working origin
                const relativeX = xWorld - this.originPosition.x;
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
        
        // Y-axis ruler
        this.ctx.beginPath();
        this.ctx.moveTo(rulerSize, 0);
        this.ctx.lineTo(rulerSize, this.canvas.height);
        this.ctx.stroke();
        
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'middle';
        const startY = Math.floor((viewBounds.minY) / majorStep) * majorStep;
        const endY = Math.ceil((viewBounds.maxY) / majorStep) * majorStep;
        
        for (let yWorld = startY; yWorld <= endY; yWorld += majorStep) {
            const yCanvas = this.worldToCanvasY(yWorld);
            if (yCanvas >= 0 && yCanvas <= this.canvas.height) {
                this.ctx.moveTo(rulerSize, yCanvas);
                this.ctx.lineTo(rulerSize - tickLength, yCanvas);
                
                // Show coordinates relative to working origin
                const relativeY = yWorld - this.originPosition.y;
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
        
        // Determine scale bar length in world units
        const targetPixels = 100; // Target bar width in pixels
        const worldLength = targetPixels / this.viewScale;
        
        // Round to nice numbers
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
        
        const precision = this.viewScale > 10 ? 3 : this.viewScale > 1 ? 2 : 1;
        const info = [
            `Primitives: ${this.renderStats.primitives}`,
            `Render: ${this.renderStats.renderTime.toFixed(1)}ms`,
            `Scale: ${this.viewScale.toFixed(2)}×`,
            `Origin: (${this.originPosition.x.toFixed(precision)}, ${this.originPosition.y.toFixed(precision)})`,
            `Layers: ${this.layers.size}`
        ];
        
        const x = 30;
        let y = this.canvas.height - 80;
        
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
        return this.viewOffset.x + (worldX - this.originPosition.x) * this.viewScale;
    }
    
    worldToCanvasY(worldY) {
        return this.viewOffset.y - (worldY - this.originPosition.y) * this.viewScale;
    }
    
    canvasToWorld(canvasX, canvasY) {
        return {
            x: (canvasX - this.viewOffset.x) / this.viewScale + this.originPosition.x,
            y: -(canvasY - this.viewOffset.y) / this.viewScale + this.originPosition.y
        };
    }
    
    // FIXED: Simplified coordinate system interface
    setCoordinateSystem(coordinateSystem) {
        this.coordinateSystem = coordinateSystem;
        // Don't automatically sync here to avoid circular updates
        console.log('Coordinate system linked to renderer');
    }
    
    setOriginPosition(x, y) {
        console.log(`[LayerRenderer] Setting origin position to (${x.toFixed(3)}, ${y.toFixed(3)})`);
        this.originPosition = { x, y };
        
        // Notify coordinate system without triggering circular update
        if (this.coordinateSystem && this.coordinateSystem.setWorkingOrigin && !this.coordinateSystem._updating) {
            console.log('[LayerRenderer] Notifying coordinate system of origin change');
            // Call coordinate system update but prevent it from calling back
            this.coordinateSystem._updating = true;
            this.coordinateSystem.setWorkingOrigin(x, y);
            this.coordinateSystem._updating = false;
        }
        
        this.render();
        console.log(`[LayerRenderer] Origin position set and rendered`);
    }
    
    getOriginPosition() {
        return { ...this.originPosition };
    }
    
    getCoordinateSystem() {
        return this.coordinateSystem;
    }
    
    // View manipulation methods - FIXED: Zoom centered on viewport
    zoomIn() {
        this.setZoom(this.viewScale * 1.2);
    }
    
    zoomOut() {
        this.setZoom(this.viewScale / 1.2);
    }
    
    setZoom(newScale, centerX = null, centerY = null) {
        const oldScale = this.viewScale;
        this.viewScale = Math.max(0.1, Math.min(100, newScale));
        
        // FIXED: Always zoom from viewport center for predictable behavior
        centerX = this.canvas.width / 2;
        centerY = this.canvas.height / 2;
        
        // Calculate world point at the zoom center before scaling
        const worldCenter = this.canvasToWorld(centerX, centerY);
        
        // Apply scale factor to view offset
        const scaleFactor = this.viewScale / oldScale;
        this.viewOffset.x = this.viewOffset.x * scaleFactor;
        this.viewOffset.y = this.viewOffset.y * scaleFactor;
        
        // Calculate where the world center point is now in canvas coordinates
        const newCanvasX = this.worldToCanvasX(worldCenter.x);
        const newCanvasY = this.worldToCanvasY(worldCenter.y);
        
        // Adjust offset to keep the world center at the same canvas position
        this.viewOffset.x += centerX - newCanvasX;
        this.viewOffset.y += centerY - newCanvasY;
        
        this.render();
    }
    
    pan(dx, dy) {
        this.viewOffset.x += dx;
        this.viewOffset.y += dy;
        this.render();
    }
    
    zoomFit() {
        this.calculateOverallBounds();
        if (!this.bounds) {
            this.viewScale = 1;
            this.viewOffset = { x: this.canvas.width / 2, y: this.canvas.height / 2 };
            this.render();
            return;
        }
        
        const padding = 0.1;
        const desiredWidth = this.bounds.width * (1 + padding);
        const desiredHeight = this.bounds.height * (1 + padding);
        
        const scaleX = this.canvas.width / desiredWidth;
        const scaleY = this.canvas.height / desiredHeight;
        this.viewScale = Math.min(scaleX, scaleY);
        
        this.viewOffset.x = this.canvas.width / 2 - (this.bounds.centerX - this.originPosition.x) * this.viewScale;
        this.viewOffset.y = this.canvas.height / 2 + (this.bounds.centerY - this.originPosition.y) * this.viewScale;
        
        this.render();
    }
    
    // Event handling
    setupEventListeners() {
        let isPanning = false;
        let lastX, lastY;
        
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                isPanning = true;
                lastX = e.clientX;
                lastY = e.clientY;
                this.canvas.style.cursor = 'grabbing';
            }
        });
        
        this.canvas.addEventListener('mousemove', (e) => {
            if (isPanning) {
                const dx = e.clientX - lastX;
                const dy = e.clientY - lastY;
                this.pan(dx, dy);
                lastX = e.clientX;
                lastY = e.clientY;
            }
        });
        
        this.canvas.addEventListener('mouseup', () => {
            if (isPanning) {
                isPanning = false;
                this.canvas.style.cursor = 'grab';
            }
        });
        
        this.canvas.addEventListener('mouseleave', () => {
            if (isPanning) {
                isPanning = false;
                this.canvas.style.cursor = 'default';
            }
        });
        
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const scaleAmount = 1.1;
            
            // FIXED: Always zoom from viewport center for consistent behavior
            if (e.deltaY < 0) {
                this.setZoom(this.viewScale * scaleAmount);
            } else {
                this.setZoom(this.viewScale / scaleAmount);
            }
        });
        
        // Handle resize
        this.resizeObserver = new ResizeObserver(() => {
            this.resizeCanvas();
        });
        this.resizeObserver.observe(this.canvas);
    }
    
    resizeCanvas() {
        const parent = this.canvas.parentElement;
        if (parent) {
            this.canvas.width = parent.clientWidth;
            this.canvas.height = parent.clientHeight;
            this.render();
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LayerRenderer;
} else {
    window.LayerRenderer = LayerRenderer;
}