// Fixed Preview Renderer - Proper Data Handling and Auto-Fit
// preview/renderer.js

class PreviewRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            throw new Error(`Canvas element with id '${canvasId}' not found`);
        }
        
        this.ctx = this.canvas.getContext('2d');
        if (!this.ctx) {
            throw new Error('Could not get 2D context from canvas');
        }
        
        // View settings
        this.viewOffset = { x: 0, y: 0 };
        this.viewScale = 1;
        this.bounds = null; // Overall board bounds
        
        // Coordinate system integration
        this.coordinateSystem = null; // Will be linked from coordinate system manager
        this.gerberOrigin = { x: 0, y: 0 }; // Gerber coordinate origin
        this.originPosition = { x: 0, y: 0 }; // Current working origin
        
        // Rendering settings - ONE COLOR PER OPERATION
        this.colors = {
            isolation: '#00ff00',
            clear: '#ff6600', 
            drill: '#4488ff',
            cutout: '#ff00ff',
            grid: '#666666',
            gridText: '#888888',
            background: '#1a1a1a',
            bounds: '#ff0000',
            origin: '#ffffff',
            offsetOutline: '#ffff00',
            originalOutline: '#00ffff',
            ruler: '#ffffff',
            rulerText: '#cccccc'
        };

        this.lightColors = {
            isolation: '#00aa00',
            clear: '#cc4400',
            drill: '#0066cc',
            cutout: '#cc00cc',
            grid: '#cccccc',
            gridText: '#666666',
            background: '#ffffff',
            bounds: '#ff0000',
            origin: '#000000',
            offsetOutline: '#ccbb00',
            originalOutline: '#009999',
            ruler: '#000000',
            rulerText: '#333333'
        };
        
        this.currentColors = this.colors; // Default to dark theme
        this.theme = 'dark';

        // Layers to render
        this.operationLayers = new Map(); // operationType -> { polygons: [], holes: [], preservedFills: [] }
        this.offsetLayers = new Map(); // operationId -> offset polygons
        
        // Debug and render options
        this.showFilled = true;
        this.showOutlines = true;
        this.blackAndWhite = false;
        this.showGrid = true;
        this.showOrigin = true;
        this.showBounds = false;
        this.showOffsets = false; // Show offset polygons
        this.showOriginal = true; // Show original polygons
        this.offsetOnly = false; // Show only offset polygons, hide original
        this.showRulers = true;
        this.debugMode = false;

        // Stats
        this.renderStats = {
            drawCalls: 0,
            polygonsRendered: 0,
            renderTime: 0
        };

        // Initialize SVG Exporter
        this.svgExporter = null; // Will be linked from cam.js or main script

        this.setupEventListeners();
        this.resizeCanvas(); // Initial resize
    }

    setSVGExporter(exporter) {
        this.svgExporter = exporter;
    }

    // Set the coordinate system manager
    setCoordinateSystemManager(manager) {
        this.coordinateSystem = manager;
        this.updateCoordinateSystem(); // Initial update
    }

    // Update coordinate system display based on manager
    updateCoordinateSystem() {
        if (this.coordinateSystem) {
            const status = this.coordinateSystem.getStatus();
            // Update origin position for rendering
            this.originPosition = {
                x: status.workingOrigin.x + status.tareOffset.x,
                y: status.workingOrigin.y + status.tareOffset.y
            };
            this.render(); // Re-render to show updated origin
        }
    }

    // Set Gerber origin
    setGerberOrigin(x, y) {
        this.gerberOrigin = { x, y };
    }

    // Set working origin position
    setOriginPosition(x, y) {
        this.originPosition = { x, y };
        this.render();
    }

    // Set theme
    setTheme(theme) {
        this.theme = theme;
        this.currentColors = theme === 'dark' ? this.colors : this.lightColors;
        this.render();
    }

    // Set debug mode
    setDebugMode(mode) {
        this.debugMode = mode;
        this.render();
    }

    // FIXED: Set operations to render with proper data structure
    setOperations(operations) {
        this.operationLayers.clear();
        
        operations.forEach(op => {
            // Store by operation type
            this.operationLayers.set(op.type, {
                polygons: op.polygons || [],
                holes: op.holes || [],
                preservedFills: op.preservedFills || []
            });
        });
        
        // Recalculate bounds after setting new data
        this.calculateBounds();
        this.render();
    }

    // Set offset polygons to render
    setOffsetPolygons(operationId, polygons) {
        this.offsetLayers.set(operationId, polygons);
        this.render();
    }

    // Helper to clear specific offset layer
    clearOffsetPolygons(operationId) {
        this.offsetLayers.delete(operationId);
        this.render();
    }

    // Calculate bounds of all loaded polygons
    calculateBounds() {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        const allPolygons = [];
        this.operationLayers.forEach(data => {
            if (data.polygons) allPolygons.push(...data.polygons);
            if (data.holes) {
                // Convert holes to simple polygons for bounds calculation
                data.holes.forEach(hole => {
                    if (hole.position && typeof hole.diameter === 'number') {
                        const r = hole.diameter / 2;
                        // Approximate a square bounds for the circular hole
                        allPolygons.push({
                            getBounds: () => ({
                                minX: hole.position.x - r,
                                minY: hole.position.y - r,
                                maxX: hole.position.x + r,
                                maxY: hole.position.y + r
                            })
                        });
                    }
                });
            }
            if (data.preservedFills) allPolygons.push(...data.preservedFills);
        });
        this.offsetLayers.forEach(polygons => allPolygons.push(...polygons)); // Include offset layers for bounds

        if (allPolygons.length === 0) {
            this.bounds = null;
            return;
        }

        allPolygons.forEach(polygon => {
            // Ensure polygon has a getBounds method or is a simple object with min/max properties
            const b = polygon.getBounds ? polygon.getBounds() : polygon; 
            if (b && typeof b.minX === 'number' && typeof b.minY === 'number' &&
                    typeof b.maxX === 'number' && typeof b.maxY === 'number') {
                minX = Math.min(minX, b.minX);
                minY = Math.min(minY, b.minY);
                maxX = Math.max(maxX, b.maxX);
                maxY = Math.max(maxY, b.maxY);
            }
        });

        if (minX === Infinity) {
            this.bounds = null;
        } else {
            this.bounds = { 
                minX, minY, maxX, maxY,
                width: maxX - minX, 
                height: maxY - minY,
                centerX: (minX + maxX) / 2,
                centerY: (minY + maxY) / 2
            };
        }
    }

    // Zoom and pan operations
    zoomIn() {
        this.setZoom(this.viewScale * 1.2);
    }

    zoomOut() {
        this.setZoom(this.viewScale / 1.2);
    }

    setZoom(newScale) {
        const oldScale = this.viewScale;
        this.viewScale = Math.max(0.1, Math.min(100, newScale)); // Limit zoom
        
        // Adjust offset to keep center point the same
        const scaleFactor = this.viewScale / oldScale;
        this.viewOffset.x = this.viewOffset.x * scaleFactor;
        this.viewOffset.y = this.viewOffset.y * scaleFactor;
        this.render();
    }

    pan(dx, dy) {
        this.viewOffset.x += dx;
        this.viewOffset.y += dy;
        this.render();
    }

    zoomFit() {
        this.calculateBounds();
        if (!this.bounds) {
            this.viewScale = 1;
            this.viewOffset = { x: 0, y: 0 };
            this.render();
            return;
        }

        const padding = 0.1; // 10% padding
        const desiredWidth = this.bounds.width * (1 + padding);
        const desiredHeight = this.bounds.height * (1 + padding);

        const scaleX = this.canvas.width / desiredWidth;
        const scaleY = this.canvas.height / desiredHeight;
        this.viewScale = Math.min(scaleX, scaleY);
        
        // Center the view on the board
        const centerX_board = this.bounds.centerX;
        const centerY_board = this.bounds.centerY;
        
        // Calculate offset to center the board in the canvas
        this.viewOffset.x = this.canvas.width / 2 - centerX_board * this.viewScale;
        this.viewOffset.y = this.canvas.height / 2 + centerY_board * this.viewScale; // Y inverted
        
        this.render();
    }

    // Main render loop
    render() {
        const startTime = performance.now();
        this.renderStats.drawCalls = 0;
        this.renderStats.polygonsRendered = 0;

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = this.currentColors.background;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.save();
        
        // Apply transformations
        this.ctx.translate(this.viewOffset.x, this.viewOffset.y);
        this.ctx.scale(this.viewScale, -this.viewScale); // Y-axis inverted for standard Cartesian
        
        // Translate to origin position (coordinate system)
        this.ctx.translate(-this.originPosition.x, -this.originPosition.y);

        // Draw grid and rulers before geometry (background)
        if (this.showGrid) {
            this.drawGrid();
        }
        if (this.showRulers) { 
            this.drawRulers();
        }

        // Draw bounding box if enabled
        if (this.showBounds && this.bounds) {
            this.ctx.strokeStyle = this.currentColors.bounds;
            this.ctx.lineWidth = 1 / this.viewScale;
            this.ctx.strokeRect(this.bounds.minX, this.bounds.minY, this.bounds.width, this.bounds.height);
            this.renderStats.drawCalls++;
        }

        // Draw original layers
        if (this.showOriginal && !this.offsetOnly) {
            this.operationLayers.forEach((data, type) => {
                const color = this.currentColors[type] || this.currentColors.isolation;
                
                // Draw polygons (filled or outline based on type and properties)
                if (data.polygons && data.polygons.length > 0) {
                    data.polygons.forEach(polygon => {
                        // Determine if this specific polygon should be filled
                        let shouldFill = false;
                        
                        if (polygon.properties) {
                            // Check polygon properties
                            const props = polygon.properties;
                            shouldFill = (
                                props.type === 'region' ||
                                props.type === 'copper_fill' ||
                                props.type === 'pad' ||
                                props.type === 'flash' ||
                                props.type === 'large_pad' ||
                                props.type === 'connector_pad' ||
                                props.isFill === true ||
                                props.isRegion === true ||
                                props.source === 'region'
                            );
                        } else {
                            // Default behavior for polygons without properties
                            shouldFill = type !== 'isolation';
                        }
                        
                        // Draw individual polygon
                        this.drawPolygons([polygon], color, shouldFill);
                    });
                }
                
                // Draw preserved fills (cutouts)
                if (data.preservedFills && data.preservedFills.length > 0) {
                    this.drawPolygons(data.preservedFills, this.currentColors.background, true);
                }
                
                // Draw holes
                if (data.holes && data.holes.length > 0) {
                    this.drawHoles(data.holes, this.currentColors.drill);
                }
            });
        }

        // Draw offset layers
        if (this.showOffsets) {
            this.offsetLayers.forEach((polygons, opId) => {
                // Try to determine color from operation ID
                let color = this.currentColors.offsetOutline;
                
                // Extract operation type from ID (e.g., "op_1" -> check original operation)
                const opType = Array.from(this.operationLayers.keys()).find(type => 
                    opId.includes('isolation') ? type === 'isolation' :
                    opId.includes('clear') ? type === 'clear' :
                    opId.includes('cutout') ? type === 'cutout' : false
                );
                
                if (opType) {
                    color = this.currentColors[opType] || color;
                }
                
                this.drawPolygons(polygons, color, false); // No fill for offsets
            });
        }

        // Draw origin marker if enabled
        if (this.showOrigin) {
            this.drawOriginMarker();
        }
        
        this.ctx.restore();

        const endTime = performance.now();
        this.renderStats.renderTime = endTime - startTime;
    }

    drawPolygons(polygonsInput, color, fill = true) {
        const polygons = Array.isArray(polygonsInput) ? polygonsInput : [];
        if (polygons.length === 0) return;

        this.ctx.fillStyle = color;
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 0.5 / this.viewScale;

        polygons.forEach(polygon => {
            if (this.blackAndWhite) {
                this.ctx.fillStyle = fill ? '#FFFFFF' : '#000000';
                this.ctx.strokeStyle = '#000000';
            } else {
                this.ctx.fillStyle = color;
                this.ctx.strokeStyle = color;
            }

            this.ctx.beginPath();
            if (polygon.points && Array.isArray(polygon.points)) {
                polygon.points.forEach((p, i) => {
                    if (i === 0) {
                        this.ctx.moveTo(p.x, p.y);
                    } else {
                        this.ctx.lineTo(p.x, p.y);
                    }
                });
                this.ctx.closePath();

                if (this.showFilled && fill) {
                    this.ctx.fill();
                }
                if (this.showOutlines || !fill) {
                    this.ctx.stroke();
                }
            }

            // Draw holes for this polygon
            if (polygon.holes && Array.isArray(polygon.holes) && this.showFilled && fill) {
                polygon.holes.forEach(hole => {
                    if (hole.points && Array.isArray(hole.points)) {
                        this.ctx.save();
                        this.ctx.globalCompositeOperation = 'destination-out';
                        this.ctx.beginPath();
                        hole.points.forEach((p, i) => {
                            if (i === 0) {
                                this.ctx.moveTo(p.x, p.y);
                            } else {
                                this.ctx.lineTo(p.x, p.y);
                            }
                        });
                        this.ctx.closePath();
                        this.ctx.fill();
                        this.ctx.restore();
                    }
                });
            }
            this.renderStats.polygonsRendered++;
            this.renderStats.drawCalls++;
        });
    }

    drawHoles(holesInput, color) {
        const holes = Array.isArray(holesInput) ? holesInput : [];
        if (holes.length === 0) return;

        this.ctx.fillStyle = color;
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 0.5 / this.viewScale;

        holes.forEach(hole => {
            if (hole && hole.position && typeof hole.diameter === 'number') {
                const center = hole.position;
                const radius = hole.diameter / 2;

                this.ctx.beginPath();
                this.ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
                this.ctx.closePath();

                if (this.showFilled) {
                    this.ctx.fill();
                }
                if (this.showOutlines) {
                    this.ctx.stroke();
                }
                this.renderStats.drawCalls++;
            }
        });
    }

    drawGrid() {
        this.ctx.strokeStyle = this.currentColors.grid;
        this.ctx.lineWidth = 0.1 / this.viewScale;
        this.ctx.font = `${8 / this.viewScale}px Arial`;
        this.ctx.fillStyle = this.currentColors.gridText;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        // Determine grid step based on zoom
        const minGridPixelSize = 50;
        let gridStep = 10;
        
        const possibleSteps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
        gridStep = possibleSteps.find(step => step * this.viewScale >= minGridPixelSize) || possibleSteps[possibleSteps.length - 1];

        // Calculate visible area in world coordinates
        const viewBounds = this.getViewBounds();
        
        const startX = Math.floor(viewBounds.minX / gridStep) * gridStep;
        const endX = Math.ceil(viewBounds.maxX / gridStep) * gridStep;
        const startY = Math.floor(viewBounds.minY / gridStep) * gridStep;
        const endY = Math.ceil(viewBounds.maxY / gridStep) * gridStep;

        // Draw vertical lines
        for (let x = startX; x <= endX; x += gridStep) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, viewBounds.minY);
            this.ctx.lineTo(x, viewBounds.maxY);
            this.ctx.stroke();
            this.renderStats.drawCalls++;
        }

        // Draw horizontal lines
        for (let y = startY; y <= endY; y += gridStep) {
            this.ctx.beginPath();
            this.ctx.moveTo(viewBounds.minX, y);
            this.ctx.lineTo(viewBounds.maxX, y);
            this.ctx.stroke();
            this.renderStats.drawCalls++;
        }
    }

    drawRulers() {
        this.ctx.save();
        
        // Reset transformation for screen-space drawing
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        
        this.ctx.strokeStyle = this.currentColors.ruler;
        this.ctx.fillStyle = this.currentColors.rulerText;
        this.ctx.lineWidth = 1;
        this.ctx.font = '12px Arial';
        this.ctx.textBaseline = 'top';
        this.ctx.textAlign = 'left';

        const rulerSize = 20;
        const tickLength = 5;
        const minorTickLength = 3;

        // Determine ruler step
        const minPixelDistance = 50;
        let majorTickUnit = 10;
        
        const possibleMajorSteps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
        majorTickUnit = possibleMajorSteps.find(step => (step * this.viewScale) >= minPixelDistance) || possibleMajorSteps[possibleMajorSteps.length - 1];
        
        const viewBounds = this.getViewBounds();

        // Draw X-axis ruler (at the top)
        this.ctx.beginPath();
        this.ctx.moveTo(rulerSize, rulerSize);
        this.ctx.lineTo(this.canvas.width, rulerSize);
        this.ctx.stroke();
        
        this.ctx.textBaseline = 'top';
        this.ctx.textAlign = 'center';
        
        const startX = Math.floor(viewBounds.minX / majorTickUnit) * majorTickUnit;
        const endX = Math.ceil(viewBounds.maxX / majorTickUnit) * majorTickUnit;
        
        for (let xWorld = startX; xWorld <= endX; xWorld += majorTickUnit) {
            const xCanvas = this.worldToCanvasX(xWorld);
            if (xCanvas >= rulerSize && xCanvas <= this.canvas.width) {
                this.ctx.moveTo(xCanvas, rulerSize);
                this.ctx.lineTo(xCanvas, rulerSize - tickLength);
                this.ctx.fillText(xWorld.toFixed(1), xCanvas, 0);
            }
        }
        this.ctx.stroke();

        // Draw Y-axis ruler (at the left)
        this.ctx.beginPath();
        this.ctx.moveTo(rulerSize, 0);
        this.ctx.lineTo(rulerSize, this.canvas.height);
        this.ctx.stroke();
        
        this.ctx.textBaseline = 'middle';
        this.ctx.textAlign = 'left';
        
        const startY = Math.floor(viewBounds.minY / majorTickUnit) * majorTickUnit;
        const endY = Math.ceil(viewBounds.maxY / majorTickUnit) * majorTickUnit;
        
        for (let yWorld = startY; yWorld <= endY; yWorld += majorTickUnit) {
            const yCanvas = this.worldToCanvasY(yWorld);
            if (yCanvas >= 0 && yCanvas <= this.canvas.height) {
                this.ctx.moveTo(rulerSize, yCanvas);
                this.ctx.lineTo(rulerSize - tickLength, yCanvas);
                this.ctx.fillText(yWorld.toFixed(1), tickLength + 2, yCanvas);
            }
        }
        this.ctx.stroke();

        // Draw corner square
        this.ctx.fillStyle = this.currentColors.background;
        this.ctx.fillRect(0, 0, rulerSize, rulerSize);
        this.ctx.strokeStyle = this.currentColors.ruler;
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(0, 0, rulerSize, rulerSize);

        this.ctx.restore();
    }

    drawOriginMarker() {
        this.ctx.strokeStyle = this.currentColors.origin;
        this.ctx.lineWidth = 1.5 / this.viewScale;
        const markerSize = 5 / this.viewScale;

        // Draw at actual origin (0,0) in world space
        this.ctx.beginPath();
        // X-axis arm
        this.ctx.moveTo(-markerSize, 0);
        this.ctx.lineTo(markerSize, 0);
        // Y-axis arm
        this.ctx.moveTo(0, -markerSize);
        this.ctx.lineTo(0, markerSize);
        this.ctx.stroke();
        this.renderStats.drawCalls++;

        // Draw '0,0' text
        this.ctx.save();
        this.ctx.scale(1, -1); // Flip text right-side up
        this.ctx.font = `${10 / this.viewScale}px Arial`;
        this.ctx.fillStyle = this.currentColors.origin;
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'top';
        this.ctx.fillText('0,0', markerSize + (2 / this.viewScale), -(markerSize + (12 / this.viewScale)));
        this.ctx.restore();
    }

    // Get view bounds in world coordinates
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

    // Coordinate conversion helpers
    worldToCanvasX(worldX) {
        return this.viewOffset.x + (worldX - this.originPosition.x) * this.viewScale;
    }

    worldToCanvasY(worldY) {
        return this.viewOffset.y - (worldY - this.originPosition.y) * this.viewScale; // Y inverted
    }

    canvasToWorld(canvasX, canvasY) {
        return {
            x: (canvasX - this.viewOffset.x) / this.viewScale + this.originPosition.x,
            y: -(canvasY - this.viewOffset.y) / this.viewScale + this.originPosition.y // Y inverted
        };
    }

    setupEventListeners() {
        let isPanning = false;
        let lastX, lastY;

        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // Left click for pan
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
            isPanning = false;
            this.canvas.style.cursor = 'grab';
        });

        this.canvas.addEventListener('mouseleave', () => {
            isPanning = false;
            this.canvas.style.cursor = 'default';
        });

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const scaleAmount = 1.1;
            
            if (e.deltaY < 0) { // Zoom in
                this.setZoom(this.viewScale * scaleAmount);
            } else { // Zoom out
                this.setZoom(this.viewScale / scaleAmount);
            }
        });

        // Handle canvas resize
        this.resizeObserver = new ResizeObserver(() => {
            this.resizeCanvas();
        });
        this.resizeObserver.observe(this.canvas);
    }

    // Method to resize canvas to fit its parent
    resizeCanvas() {
        const parent = this.canvas.parentElement;
        if (parent) {
            this.canvas.width = parent.clientWidth;
            this.canvas.height = parent.clientHeight;
            this.render();
        }
    }

    getRenderState() {
        return {
            viewOffset: { ...this.viewOffset },
            viewScale: this.viewScale,
            bounds: this.bounds ? { ...this.bounds } : null,
            originPosition: { ...this.originPosition },
            showFilled: this.showFilled,
            showOutlines: this.showOutlines,
            blackAndWhite: this.blackAndWhite,
            showGrid: this.showGrid,
            showOrigin: this.showOrigin,
            showBounds: this.showBounds,
            showOffsets: this.showOffsets,
            showOriginal: this.showOriginal,
            offsetOnly: this.offsetOnly,
            showRulers: this.showRulers,
            theme: this.theme,
            canvasSize: { width: this.canvas.width, height: this.canvas.height },
            renderStats: this.renderStats,
            operationCount: this.operationLayers.size,
            offsetLayerCount: this.offsetLayers.size,
            debugMode: this.debugMode
        };
    }
    
    // Export canvas as SVG
    exportCanvasAsSVG() {
        if (this.svgExporter) {
            const renderState = this.getRenderState();
            this.svgExporter.exportCanvasState(renderState);
        } else {
            console.error('SVG exporter not available');
        }
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PreviewRenderer;
}