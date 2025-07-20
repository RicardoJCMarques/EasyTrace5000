// Polygon-Based Canvas Preview Renderer

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
        this.bounds = null;
        this.dataOffset = { x: 0, y: 0 };
        
        // Rendering settings
        this.colors = {
            isolation: '#00ff00',
            clear: '#ff6600', 
            drill: '#4488ff',
            cutout: '#ff00ff',
            grid: '#333333',
            background: '#1a1a1a',
            origin: '#ffffff',
            bounds: '#888888'
        };
        
        // Debug controls
        this.debugMode = false;
        this.showGrid = true;
        this.showOrigin = true;
        this.showBounds = false;
        
        // Data storage
        this.data = null;
        this.layerPolygons = new Map(); // operationType -> CopperPolygon[]
        
        // Statistics
        this.renderStats = {
            totalPolygons: 0,
            visiblePolygons: 0,
            renderTime: 0
        };
        
        // Mouse handling
        this.isPanning = false;
        this.lastMouse = { x: 0, y: 0 };
        
        this.setupCanvas();
        this.setupEventListeners();
        this.setupDebugUI();
        
        console.log('PreviewRenderer initialized with polygon-based rendering');
    }
    
    setupCanvas() {
        this.canvas.style.display = 'block';
        this.canvas.style.cursor = 'grab';
        
        this.resizeCanvas();
    }
    
    resizeCanvas() {
        try {
            const rect = this.canvas.parentElement.getBoundingClientRect();
            const width = Math.max(rect.width, 400);
            const height = Math.max(rect.height, 300);
            
            this.canvas.width = width;
            this.canvas.height = height;
            
            this.render();
        } catch (error) {
            console.error('Error resizing canvas:', error);
        }
    }
    
    setupEventListeners() {
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                this.isPanning = true;
                this.lastMouse = { x: e.clientX, y: e.clientY };
                this.canvas.style.cursor = 'grabbing';
                e.preventDefault();
            }
        });
        
        window.addEventListener('mousemove', (e) => {
            if (this.isPanning) {
                const dx = e.clientX - this.lastMouse.x;
                const dy = e.clientY - this.lastMouse.y;
                
                this.viewOffset.x += dx;
                this.viewOffset.y -= dy;
                
                this.lastMouse = { x: e.clientX, y: e.clientY };
                this.render();
                e.preventDefault();
            }
        });
        
        window.addEventListener('mouseup', (e) => {
            if (this.isPanning) {
                this.isPanning = false;
                this.canvas.style.cursor = 'grab';
            }
        });
        
        // Wheel zoom
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
            const mouseX = e.offsetX;
            const mouseY = e.offsetY;
            
            this.viewOffset.x = mouseX - (mouseX - this.viewOffset.x) * scaleFactor;
            this.viewOffset.y = mouseY - (mouseY - this.viewOffset.y) * scaleFactor;
            this.viewScale *= scaleFactor;
            
            this.render();
        });
        
        // Window resize
        window.addEventListener('resize', () => this.resizeCanvas());
    }
    
    setupDebugUI() {
        // Create debug control panel
        const debugPanel = document.createElement('div');
        debugPanel.id = 'debug-panel';
        debugPanel.style.cssText = `
            position: fixed;
            top: 120px;
            right: 20px;
            z-index: 1001;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 10px;
            border-radius: 4px;
            font-family: monospace;
            font-size: 12px;
            display: none;
            min-width: 200px;
        `;
        
        debugPanel.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 8px;">Debug Controls</div>
            <label><input type="checkbox" id="show-grid" checked> Show Grid</label><br>
            <label><input type="checkbox" id="show-origin" checked> Show Origin</label><br>
            <label><input type="checkbox" id="show-bounds"> Show Bounds</label><br>
            <label><input type="checkbox" id="show-polygon-outlines"> Show Polygon Outlines</label><br>
            <label><input type="checkbox" id="show-polygon-points"> Show Polygon Points</label><br>
            <hr style="margin: 8px 0;">
            <div style="font-weight: bold; margin-bottom: 4px;">Render Stats</div>
            <div id="render-stats">No data</div>
            <hr style="margin: 8px 0;">
            <button onclick="window.cam.renderer.downloadDebugSVG()" style="width: 100%; margin-top: 4px;">Export SVG</button>
        `;
        
        document.body.appendChild(debugPanel);
        
        // Add debug toggle button
        const debugToggle = document.createElement('button');
        debugToggle.id = 'debug-toggle-btn';
        debugToggle.textContent = 'Debug';
        debugToggle.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            z-index: 1000;
            padding: 8px 12px;
            background: #333;
            color: white;
            border: none;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            font-family: monospace;
        `;
        
        debugToggle.addEventListener('click', () => {
            const panel = document.getElementById('debug-panel');
            const isVisible = panel.style.display !== 'none';
            panel.style.display = isVisible ? 'none' : 'block';
            debugToggle.style.background = isVisible ? '#333' : '#666';
        });
        
        document.body.appendChild(debugToggle);
        
        this.setupDebugControlHandlers();
    }
    
    setupDebugControlHandlers() {
        const controls = [
            'show-grid', 'show-origin', 'show-bounds', 
            'show-polygon-outlines', 'show-polygon-points'
        ];
        
        controls.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => {
                    this.updateDebugControls();
                    this.render();
                });
            }
        });
    }
    
    updateDebugControls() {
        this.showGrid = document.getElementById('show-grid')?.checked !== false;
        this.showOrigin = document.getElementById('show-origin')?.checked !== false;
        this.showBounds = document.getElementById('show-bounds')?.checked || false;
        this.showPolygonOutlines = document.getElementById('show-polygon-outlines')?.checked || false;
        this.showPolygonPoints = document.getElementById('show-polygon-points')?.checked || false;
    }
    
    // Main data setter
    setData(data) {
        if (!data || typeof data !== 'object') {
            console.warn('PreviewRenderer.setData: Invalid data provided');
            this.data = null;
            this.layerPolygons.clear();
            this.render();
            return;
        }
        
        console.log('🎨 PreviewRenderer: Processing polygon data');
        
        this.data = data;
        this.processPolygonData();
        this.calculateBounds();
        this.zoomFit();
    }
    
    processPolygonData() {
        this.layerPolygons.clear();
        this.renderStats.totalPolygons = 0;
        
        if (!this.data) return;
        
        // Process each operation type
        ['isolation', 'clear', 'drill', 'cutout'].forEach(operationType => {
            const files = this.data[operationType] || [];
            const allPolygons = [];
            
            files.forEach(file => {
                if (file && file.polygons && Array.isArray(file.polygons)) {
                    allPolygons.push(...file.polygons);
                    this.renderStats.totalPolygons += file.polygons.length;
                }
            });
            
            if (allPolygons.length > 0) {
                this.layerPolygons.set(operationType, allPolygons);
                console.log(`${operationType}: ${allPolygons.length} polygons`);
            }
        });
        
        console.log(`📊 Total polygons: ${this.renderStats.totalPolygons}`);
    }
    
    calculateBounds() {
        const allPolygons = [];
        
        for (const polygons of this.layerPolygons.values()) {
            allPolygons.push(...polygons);
        }
        
        if (allPolygons.length > 0) {
            this.bounds = PolygonUtils.calculateBounds(allPolygons);
            console.log(`Bounds: ${this.bounds.minX.toFixed(3)}, ${this.bounds.minY.toFixed(3)} to ${this.bounds.maxX.toFixed(3)}, ${this.bounds.maxY.toFixed(3)}`);
        } else {
            this.bounds = { minX: -50, minY: -50, maxX: 50, maxY: 50 };
        }
    }
    
    zoomFit() {
        if (!this.bounds) return;
        
        const width = this.bounds.maxX - this.bounds.minX;
        const height = this.bounds.maxY - this.bounds.minY;
        
        if (width <= 0 || height <= 0) return;
        
        const margin = 40;
        const scaleX = (this.canvas.width - margin * 2) / width;
        const scaleY = (this.canvas.height - margin * 2) / height;
        this.viewScale = Math.min(scaleX, scaleY, 20);
        
        this.viewOffset.x = (this.canvas.width - width * this.viewScale) / 2 - this.bounds.minX * this.viewScale;
        this.viewOffset.y = (this.canvas.height - height * this.viewScale) / 2 - this.bounds.minY * this.viewScale;
        
        this.render();
    }
    
    zoomIn() {
        this.viewScale *= 1.2;
        this.render();
    }
    
    zoomOut() {
        this.viewScale *= 0.8;
        this.render();
    }
    
    // Main render method
    render() {
        const startTime = performance.now();
        
        try {
            this.updateDebugControls();
            
            // Clear canvas
            this.ctx.fillStyle = this.colors.background;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            
            // Draw grid and origin
            if (this.showGrid) {
                this.drawGrid();
            }
            if (this.showOrigin) {
                this.drawOrigin();
            }
            if (this.showBounds && this.bounds) {
                this.drawBounds();
            }
            
            if (this.layerPolygons.size === 0) {
                this.drawNoDataMessage();
                return;
            }
            
            // Render polygons
            this.renderPolygons();
            
            this.renderStats.renderTime = performance.now() - startTime;
            this.updateRenderStats();
            
        } catch (error) {
            console.error('💥 Render error:', error);
            this.drawErrorMessage(error.message);
        }
    }
    
    renderPolygons() {
        const renderOrder = ['cutout', 'clear', 'isolation', 'drill'];
        this.renderStats.visiblePolygons = 0;
        
        renderOrder.forEach(operationType => {
            const polygons = this.layerPolygons.get(operationType);
            if (polygons && polygons.length > 0) {
                this.renderPolygonLayer(polygons, operationType);
            }
        });
    }
    
    renderPolygonLayer(polygons, operationType) {
        const color = this.colors[operationType] || '#ffffff';
        
        this.ctx.save();
        this.ctx.fillStyle = color + '80'; // Semi-transparent fill
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = this.showPolygonOutlines ? 1 : 0;
        
        for (const polygon of polygons) {
            if (polygon && polygon.isValid && polygon.isValid()) {
                this.renderPolygon(polygon);
                this.renderStats.visiblePolygons++;
            }
        }
        
        this.ctx.restore();
    }
    
    renderPolygon(polygon) {
        const points = polygon.points;
        if (!points || points.length < 3) return;
        
        try {
            this.ctx.beginPath();
            
            // Move to first point
            const firstPoint = this.worldToScreen(points[0]);
            this.ctx.moveTo(firstPoint.x, firstPoint.y);
            
            // Line to all other points
            for (let i = 1; i < points.length; i++) {
                const point = this.worldToScreen(points[i]);
                this.ctx.lineTo(point.x, point.y);
            }
            
            this.ctx.closePath();
            
            // Fill the polygon
            this.ctx.fill();
            
            // Stroke outline if enabled
            if (this.showPolygonOutlines) {
                this.ctx.stroke();
            }
            
            // Show polygon points if enabled
            if (this.showPolygonPoints) {
                this.drawPolygonPoints(points);
            }
            
        } catch (error) {
            console.warn('Error rendering polygon:', error);
        }
    }
    
    drawPolygonPoints(points) {
        this.ctx.save();
        this.ctx.fillStyle = '#ff0000';
        
        for (const point of points) {
            const screenPoint = this.worldToScreen(point);
            this.ctx.beginPath();
            this.ctx.arc(screenPoint.x, screenPoint.y, 2, 0, 2 * Math.PI);
            this.ctx.fill();
        }
        
        this.ctx.restore();
    }
    
    // Coordinate transformation
    worldToScreen(point) {
        if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') {
            return { x: 0, y: 0 };
        }
        
        const offsetX = point.x + (this.dataOffset ? this.dataOffset.x : 0);
        const offsetY = point.y + (this.dataOffset ? this.dataOffset.y : 0);
        
        return {
            x: offsetX * this.viewScale + this.viewOffset.x,
            y: this.canvas.height - (offsetY * this.viewScale + this.viewOffset.y)
        };
    }
    
    screenToWorld(point) {
        if (!point || !isFinite(point.x) || !isFinite(point.y)) {
            return { x: 0, y: 0 };
        }
        
        const worldX = (point.x - this.viewOffset.x) / this.viewScale;
        const worldY = (this.canvas.height - point.y - this.viewOffset.y) / this.viewScale;
        
        return {
            x: worldX - (this.dataOffset ? this.dataOffset.x : 0),
            y: worldY - (this.dataOffset ? this.dataOffset.y : 0)
        };
    }
    
    drawGrid() {
        if (this.viewScale < 2) return;
        
        try {
            this.ctx.strokeStyle = this.colors.grid;
            this.ctx.lineWidth = 0.5;
            this.ctx.globalAlpha = 0.3;
            
            const gridSpacing = this.getGridSpacing();
            const bounds = this.getViewBounds();
            
            // Vertical lines
            for (let x = Math.floor(bounds.minX / gridSpacing) * gridSpacing; x <= bounds.maxX; x += gridSpacing) {
                const screenX = x * this.viewScale + this.viewOffset.x;
                this.ctx.beginPath();
                this.ctx.moveTo(screenX, 0);
                this.ctx.lineTo(screenX, this.canvas.height);
                this.ctx.stroke();
            }
            
            // Horizontal lines
            for (let y = Math.floor(bounds.minY / gridSpacing) * gridSpacing; y <= bounds.maxY; y += gridSpacing) {
                const screenY = this.canvas.height - (y * this.viewScale + this.viewOffset.y);
                this.ctx.beginPath();
                this.ctx.moveTo(0, screenY);
                this.ctx.lineTo(this.canvas.width, screenY);
                this.ctx.stroke();
            }
            
            this.ctx.globalAlpha = 1;
        } catch (error) {
            this.ctx.globalAlpha = 1;
        }
    }
    
    getGridSpacing() {
        const pixelsPerUnit = this.viewScale;
        if (pixelsPerUnit > 50) return 0.5;
        if (pixelsPerUnit > 20) return 1;
        if (pixelsPerUnit > 5) return 5;
        if (pixelsPerUnit > 2) return 10;
        if (pixelsPerUnit > 0.5) return 50;
        return 100;
    }
    
    getViewBounds() {
        return {
            minX: -this.viewOffset.x / this.viewScale,
            minY: -(this.viewOffset.y - this.canvas.height) / this.viewScale,
            maxX: (this.canvas.width - this.viewOffset.x) / this.viewScale,
            maxY: -this.viewOffset.y / this.viewScale
        };
    }
    
    drawOrigin() {
        try {
            const origin = this.worldToScreen({ x: 0, y: 0 });
            
            if (!isFinite(origin.x) || !isFinite(origin.y)) return;
            
            this.ctx.strokeStyle = this.colors.origin;
            this.ctx.lineWidth = 2;
            
            // X axis
            this.ctx.beginPath();
            this.ctx.moveTo(origin.x - 20, origin.y);
            this.ctx.lineTo(origin.x + 20, origin.y);
            this.ctx.stroke();
            
            // Y axis
            this.ctx.beginPath();
            this.ctx.moveTo(origin.x, origin.y - 20);
            this.ctx.lineTo(origin.x, origin.y + 20);
            this.ctx.stroke();
            
            // Origin label
            if (this.viewScale > 5) {
                this.ctx.fillStyle = this.colors.origin;
                this.ctx.font = '12px monospace';
                this.ctx.fillText('(0,0)', origin.x + 5, origin.y - 5);
            }
        } catch (error) {
            console.error('Error drawing origin:', error);
        }
    }
    
    drawBounds() {
        if (!this.bounds) return;
        
        try {
            const topLeft = this.worldToScreen({ x: this.bounds.minX, y: this.bounds.maxY });
            const bottomRight = this.worldToScreen({ x: this.bounds.maxX, y: this.bounds.minY });
            
            this.ctx.strokeStyle = this.colors.bounds;
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([5, 5]);
            this.ctx.globalAlpha = 0.5;
            
            this.ctx.beginPath();
            this.ctx.rect(
                topLeft.x, 
                topLeft.y, 
                bottomRight.x - topLeft.x, 
                bottomRight.y - topLeft.y
            );
            this.ctx.stroke();
            
            this.ctx.setLineDash([]);
            this.ctx.globalAlpha = 1;
        } catch (error) {
            this.ctx.setLineDash([]);
            this.ctx.globalAlpha = 1;
        }
    }
    
    drawNoDataMessage() {
        this.ctx.fillStyle = '#666666';
        this.ctx.font = '16px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('No PCB data to display - Upload files to begin', this.canvas.width / 2, this.canvas.height / 2);
    }
    
    drawErrorMessage(message) {
        this.ctx.fillStyle = '#ff4444';
        this.ctx.font = '14px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(`Render Error: ${message}`, this.canvas.width / 2, this.canvas.height / 2);
        this.ctx.fillText('Check console for details', this.canvas.width / 2, this.canvas.height / 2 + 20);
    }
    
    updateRenderStats() {
        const statsElement = document.getElementById('render-stats');
        if (statsElement) {
            const polygonCount = this.renderStats.visiblePolygons;
            const renderTime = this.renderStats.renderTime.toFixed(1);
            const layerCount = this.layerPolygons.size;
            
            statsElement.innerHTML = `
                Layers: ${layerCount}<br>
                Polygons: ${polygonCount}<br>
                Render: ${renderTime}ms<br>
                Scale: ${this.viewScale.toFixed(2)}x
            `;
        }
    }
    
    updateOffset(offsetX, offsetY) {
        this.dataOffset = { 
            x: isFinite(offsetX) ? offsetX : 0, 
            y: isFinite(offsetY) ? offsetY : 0 
        };
        this.render();
    }
    
    setDebugMode(enabled) {
        this.debugMode = enabled;
        const debugToggle = document.getElementById('debug-toggle-btn');
        if (debugToggle) {
            debugToggle.style.background = enabled ? '#666' : '#333';
        }
        this.render();
    }
    
    getViewInfo() {
        return {
            scale: this.viewScale,
            offset: this.viewOffset,
            dataOffset: this.dataOffset,
            bounds: this.bounds,
            stats: this.renderStats,
            layerCount: this.layerPolygons.size,
            debugMode: this.debugMode
        };
    }
    
    // SVG export delegation
    exportDebugSVG() {
        if (this.svgExporter) {
            return this.svgExporter.exportSVG();
        }
        console.error('SVG exporter not initialized');
        return '';
    }

    downloadDebugSVG() {
        if (this.svgExporter) {
            this.svgExporter.download();
        } else {
            console.error('SVG exporter not initialized - check if debug/svg-exporter.js is loaded');
        }
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PreviewRenderer;
} else {
    window.PreviewRenderer = PreviewRenderer;
}