// Preview Renderer with Proper Origin Marker

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
        
        // Origin position (separate from geometry transform)
        this.originPosition = { x: 0, y: 0 };
        
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
        
        // Light theme colors
        this.lightColors = {
            isolation: '#00aa00',
            clear: '#cc4400', 
            drill: '#0066cc',
            cutout: '#cc00cc',
            grid: '#cccccc',
            background: '#ffffff',
            origin: '#000000',
            bounds: '#666666'
        };
        
        // Debug controls
        this.debugMode = false;
        this.showGrid = true;
        this.showOrigin = true;
        this.showBounds = false;
        this.showOutlines = true;
        this.showFilled = true;
        this.blackAndWhite = false;
        
        // Data storage
        this.data = null;
        this.layerPolygons = new Map();
        this.layerHoles = new Map();
        
        // SVG exporter reference
        this.svgExporter = null;
        
        // Statistics
        this.renderStats = {
            totalPolygons: 0,
            totalHoles: 0,
            visiblePolygons: 0,
            renderTime: 0
        };
        
        // Mouse handling
        this.isPanning = false;
        this.lastMouse = { x: 0, y: 0 };
        
        this.setupCanvas();
        this.setupEventListeners();
        this.setupDebugPanel();
        
        console.log('Balanced PreviewRenderer initialized with origin marker support');
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
    
    setupDebugPanel() {
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
            padding: 12px;
            border-radius: 6px;
            font-family: monospace;
            font-size: 12px;
            display: none;
            min-width: 200px;
            backdrop-filter: blur(4px);
        `;
        
        debugPanel.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 8px; color: #4fc3f7;">🔧 Debug Controls</div>
            
            <div style="margin-bottom: 8px;">
                <label><input type="checkbox" id="show-grid" checked> Show Grid</label><br>
                <label><input type="checkbox" id="show-origin" checked> Show Origin</label><br>
                <label><input type="checkbox" id="show-bounds"> Show Bounds</label>
            </div>
            
            <div style="margin-bottom: 8px; border-top: 1px solid #444; padding-top: 8px;">
                <label><input type="checkbox" id="show-outlines" checked> Show Outlines</label><br>
                <label><input type="checkbox" id="show-filled" checked> Show Fill</label><br>
                <label><input type="checkbox" id="black-and-white"> Black & White</label>
            </div>
            
            <div style="border-top: 1px solid #444; padding-top: 8px; margin-bottom: 8px;">
                <div style="font-weight: bold; margin-bottom: 4px; color: #81c784;">📊 Render Stats</div>
                <div id="render-stats" style="font-size: 11px; color: #bbb;">No data</div>
            </div>
            
            <button onclick="window.cam?.renderer?.downloadDebugSVG()" 
                    style="width: 100%; padding: 6px; background: #333; color: white; border: 1px solid #555; border-radius: 4px; cursor: pointer; font-size: 11px;">
                📁 Export Debug SVG
            </button>
        `;
        
        document.body.appendChild(debugPanel);
        
        // Add debug toggle button to preview tools
        const previewTools = document.querySelector('.preview-tools');
        if (previewTools) {
            const debugToggle = document.createElement('button');
            debugToggle.id = 'debug-toggle-btn';
            debugToggle.textContent = 'Debug';
            debugToggle.style.cssText = `
                padding: 0.375rem 0.75rem;
                background: var(--bg-alt);
                border: 1px solid var(--border);
                border-radius: var(--radius);
                font-size: 0.8125rem;
                cursor: pointer;
                transition: all 0.15s ease;
                color: var(--text);
            `;
            
            debugToggle.addEventListener('click', () => {
                const panel = document.getElementById('debug-panel');
                const isVisible = panel.style.display !== 'none';
                panel.style.display = isVisible ? 'none' : 'block';
                debugToggle.style.background = isVisible ? 'var(--bg-alt)' : 'var(--accent)';
                debugToggle.style.color = isVisible ? 'var(--text)' : 'white';
            });
            
            previewTools.appendChild(debugToggle);
        }
        
        this.setupDebugControlHandlers();
    }
    
    setupDebugControlHandlers() {
        const controls = [
            'show-grid', 'show-origin', 'show-bounds', 
            'show-outlines', 'show-filled', 'black-and-white'
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
        this.showOutlines = document.getElementById('show-outlines')?.checked !== false;
        this.showFilled = document.getElementById('show-filled')?.checked !== false;
        this.blackAndWhite = document.getElementById('black-and-white')?.checked || false;
    }
    
    // Get current color scheme based on theme and debug settings
    getCurrentColors() {
        const theme = document.documentElement.getAttribute('data-theme');
        const baseColors = theme === 'light' ? this.lightColors : this.colors;
        
        if (this.blackAndWhite) {
            const bwColor = theme === 'light' ? '#000000' : '#ffffff';
            return {
                ...baseColors,
                isolation: bwColor,
                clear: bwColor,
                drill: bwColor,
                cutout: bwColor
            };
        }
        
        return baseColors;
    }
    
    // Set origin position (visual marker only)
    setOriginPosition(x, y) {
        this.originPosition = { x, y };
        this.render();
        console.log(`Origin marker moved to (${x.toFixed(3)}, ${y.toFixed(3)})`);
    }
    
    // Main data setter
    setData(data) {
        if (!data || typeof data !== 'object') {
            console.warn('PreviewRenderer.setData: Invalid data provided');
            this.data = null;
            this.layerPolygons.clear();
            this.layerHoles.clear();
            this.render();
            return;
        }
        
        console.log('🎨 PreviewRenderer: Processing data for', Object.keys(data));
        
        this.data = data;
        this.processData();
        this.calculateBounds();
        this.zoomFit();
    }
    
    processData() {
        this.layerPolygons.clear();
        this.layerHoles.clear();
        this.renderStats.totalPolygons = 0;
        this.renderStats.totalHoles = 0;
        
        if (!this.data) return;
        
        // Process each operation type
        ['isolation', 'clear', 'drill', 'cutout'].forEach(operationType => {
            const files = this.data[operationType] || [];
            const allPolygons = [];
            const allHoles = [];
            
            files.forEach(file => {
                if (file && file.polygons && Array.isArray(file.polygons)) {
                    // Handle all types of polygons, including filled regions
                    file.polygons.forEach(polygon => {
                        if (polygon && polygon.points && polygon.points.length >= 3) {
                            allPolygons.push(polygon);
                            this.renderStats.totalPolygons++;
                        }
                    });
                }
                
                if (file && file.holes && Array.isArray(file.holes)) {
                    allHoles.push(...file.holes);
                    this.renderStats.totalHoles += file.holes.length;
                }
            });
            
            if (allPolygons.length > 0) {
                this.layerPolygons.set(operationType, allPolygons);
                console.log(`${operationType}: ${allPolygons.length} polygons`);
            }
            
            if (allHoles.length > 0) {
                this.layerHoles.set(operationType, allHoles);
                console.log(`${operationType}: ${allHoles.length} holes`);
            }
        });
        
        console.log(`📊 Total: ${this.renderStats.totalPolygons} polygons, ${this.renderStats.totalHoles} holes`);
    }
    
    calculateBounds() {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        // Include polygon bounds
        for (const polygons of this.layerPolygons.values()) {
            for (const polygon of polygons) {
                if (polygon && polygon.points) {
                    for (const point of polygon.points) {
                        if (point && typeof point.x === 'number' && typeof point.y === 'number') {
                            minX = Math.min(minX, point.x);
                            minY = Math.min(minY, point.y);
                            maxX = Math.max(maxX, point.x);
                            maxY = Math.max(maxY, point.y);
                        }
                    }
                }
            }
        }
        
        // Include hole positions
        for (const holes of this.layerHoles.values()) {
            for (const hole of holes) {
                if (hole && hole.position) {
                    const pos = hole.position;
                    const radius = (hole.diameter || 1) / 2;
                    minX = Math.min(minX, pos.x - radius);
                    minY = Math.min(minY, pos.y - radius);
                    maxX = Math.max(maxX, pos.x + radius);
                    maxY = Math.max(maxY, pos.y + radius);
                }
            }
        }
        
        if (isFinite(minX)) {
            this.bounds = { minX, minY, maxX, maxY };
            console.log(`Bounds: ${minX.toFixed(3)}, ${minY.toFixed(3)} to ${maxX.toFixed(3)}, ${maxY.toFixed(3)}`);
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
        this.viewScale = Math.min(scaleX, scaleY, 50); // Limit max zoom
        
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
        const colors = this.getCurrentColors();
        
        try {
            // Clear canvas
            this.ctx.fillStyle = colors.background;
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
            
            if (this.layerPolygons.size === 0 && this.layerHoles.size === 0) {
                this.drawNoDataMessage();
                return;
            }
            
            // Render all layers
            this.renderAllLayers();
            
            this.renderStats.renderTime = performance.now() - startTime;
            this.updateRenderStats();
            
        } catch (error) {
            console.error('💥 Render error:', error);
            this.drawErrorMessage(error.message);
        }
    }
    
    renderAllLayers() {
        const renderOrder = ['cutout', 'clear', 'isolation', 'drill'];
        this.renderStats.visiblePolygons = 0;
        
        renderOrder.forEach(operationType => {
            // Render polygons
            const polygons = this.layerPolygons.get(operationType);
            if (polygons && polygons.length > 0) {
                this.renderPolygonLayer(polygons, operationType);
            }
            
            // Render holes
            const holes = this.layerHoles.get(operationType);
            if (holes && holes.length > 0) {
                this.renderHoleLayer(holes, operationType);
            }
        });
    }
    
    renderPolygonLayer(polygons, operationType) {
        const colors = this.getCurrentColors();
        const color = colors[operationType] || '#ffffff';
        
        this.ctx.save();
        
        // Set fill and stroke styles - SAME COLOR for consistency
        if (this.showFilled) {
            this.ctx.fillStyle = color + '60'; // Semi-transparent fill
        }
        if (this.showOutlines) {
            this.ctx.strokeStyle = color; // Same color as fill
            this.ctx.lineWidth = Math.max(0.5, 1 / this.viewScale);
        }
        
        for (const polygon of polygons) {
            if (this.isPolygonValid(polygon)) {
                this.renderPolygon(polygon);
                this.renderStats.visiblePolygons++;
            }
        }
        
        this.ctx.restore();
    }
    
    renderHoleLayer(holes, operationType) {
        const colors = this.getCurrentColors();
        const color = colors[operationType] || '#ffffff';
        
        this.ctx.save();
        this.ctx.fillStyle = color + '80';
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = Math.max(0.5, 1 / this.viewScale);
        
        for (const hole of holes) {
            if (hole && hole.position && hole.diameter) {
                this.renderHole(hole);
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
            if (!this.isScreenPointValid(firstPoint)) return;
            
            this.ctx.moveTo(firstPoint.x, firstPoint.y);
            
            // Line to all other points
            for (let i = 1; i < points.length; i++) {
                const point = this.worldToScreen(points[i]);
                if (this.isScreenPointValid(point)) {
                    this.ctx.lineTo(point.x, point.y);
                }
            }
            
            this.ctx.closePath();
            
            // Fill and/or stroke based on settings
            if (this.showFilled) {
                this.ctx.fill();
            }
            if (this.showOutlines) {
                this.ctx.stroke();
            }
            
        } catch (error) {
            console.warn('Error rendering polygon:', error);
        }
    }
    
    renderHole(hole) {
        try {
            const center = this.worldToScreen(hole.position);
            if (!this.isScreenPointValid(center)) return;
            
            const radius = (hole.diameter / 2) * this.viewScale;
            
            if (radius > 0.5) { // Only render if visible
                this.ctx.beginPath();
                this.ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI);
                
                if (this.showFilled) {
                    this.ctx.fill();
                }
                if (this.showOutlines) {
                    this.ctx.stroke();
                }
            }
        } catch (error) {
            console.warn('Error rendering hole:', error);
        }
    }
    
    // Validation helpers
    isPolygonValid(polygon) {
        return polygon && 
               polygon.points && 
               Array.isArray(polygon.points) && 
               polygon.points.length >= 3 &&
               polygon.points.every(p => p && typeof p.x === 'number' && typeof p.y === 'number');
    }
    
    isScreenPointValid(point) {
        return point && 
               typeof point.x === 'number' && 
               typeof point.y === 'number' && 
               isFinite(point.x) && 
               isFinite(point.y);
    }
    
    // Coordinate transformation (geometry stays fixed, only screen projection)
    worldToScreen(point) {
        if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') {
            return { x: 0, y: 0 };
        }
        
        return {
            x: point.x * this.viewScale + this.viewOffset.x,
            y: this.canvas.height - (point.y * this.viewScale + this.viewOffset.y)
        };
    }
    
    screenToWorld(point) {
        if (!point || !isFinite(point.x) || !isFinite(point.y)) {
            return { x: 0, y: 0 };
        }
        
        const worldX = (point.x - this.viewOffset.x) / this.viewScale;
        const worldY = (this.canvas.height - point.y - this.viewOffset.y) / this.viewScale;
        
        return { x: worldX, y: worldY };
    }
    
    drawGrid() {
        if (this.viewScale < 2) return;
        
        const colors = this.getCurrentColors();
        
        try {
            this.ctx.strokeStyle = colors.grid;
            this.ctx.lineWidth = 0.5;
            this.ctx.globalAlpha = 0.3;
            
            const gridSpacing = this.getGridSpacing();
            const bounds = this.getViewBounds();
            
            // Grid is relative to origin position
            const originOffset = this.originPosition;
            
            // Vertical lines
            for (let x = Math.floor((bounds.minX - originOffset.x) / gridSpacing) * gridSpacing + originOffset.x; 
                 x <= bounds.maxX; x += gridSpacing) {
                const screenX = x * this.viewScale + this.viewOffset.x;
                if (screenX >= 0 && screenX <= this.canvas.width) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(screenX, 0);
                    this.ctx.lineTo(screenX, this.canvas.height);
                    this.ctx.stroke();
                }
            }
            
            // Horizontal lines
            for (let y = Math.floor((bounds.minY - originOffset.y) / gridSpacing) * gridSpacing + originOffset.y; 
                 y <= bounds.maxY; y += gridSpacing) {
                const screenY = this.canvas.height - (y * this.viewScale + this.viewOffset.y);
                if (screenY >= 0 && screenY <= this.canvas.height) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(0, screenY);
                    this.ctx.lineTo(this.canvas.width, screenY);
                    this.ctx.stroke();
                }
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
        const colors = this.getCurrentColors();
        
        try {
            // Draw origin at current origin position (visual marker)
            const origin = this.worldToScreen(this.originPosition);
            
            if (!this.isScreenPointValid(origin)) return;
            
            this.ctx.strokeStyle = colors.origin;
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
            
            // Origin circle
            this.ctx.beginPath();
            this.ctx.arc(origin.x, origin.y, 4, 0, 2 * Math.PI);
            this.ctx.stroke();
            
            // Origin label
            if (this.viewScale > 5) {
                this.ctx.fillStyle = colors.origin;
                this.ctx.font = '12px monospace';
                this.ctx.fillText(
                    `(${this.originPosition.x.toFixed(1)}, ${this.originPosition.y.toFixed(1)})`, 
                    origin.x + 8, 
                    origin.y - 8
                );
            }
        } catch (error) {
            console.error('Error drawing origin:', error);
        }
    }
    
    drawBounds() {
        if (!this.bounds) return;
        
        const colors = this.getCurrentColors();
        
        try {
            const topLeft = this.worldToScreen({ x: this.bounds.minX, y: this.bounds.maxY });
            const bottomRight = this.worldToScreen({ x: this.bounds.maxX, y: this.bounds.minY });
            
            this.ctx.strokeStyle = colors.bounds;
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
        const colors = this.getCurrentColors();
        this.ctx.fillStyle = colors.grid;
        this.ctx.font = '16px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('No PCB data to display - Upload files to begin', this.canvas.width / 2, this.canvas.height / 2);
        this.ctx.textAlign = 'left';
    }
    
    updateRenderStats() {
        const statsElement = document.getElementById('render-stats');
        if (statsElement) {
            const polygonCount = this.renderStats.visiblePolygons;
            const holeCount = this.renderStats.totalHoles;
            const renderTime = this.renderStats.renderTime.toFixed(1);
            const layerCount = this.layerPolygons.size + this.layerHoles.size;
            
            statsElement.innerHTML = `
                Layers: ${layerCount}<br>
                Polygons: ${polygonCount}<br>
                Holes: ${holeCount}<br>
                Render: ${renderTime}ms<br>
                Scale: ${this.viewScale.toFixed(2)}x<br>
                Origin: (${this.originPosition.x.toFixed(1)}, ${this.originPosition.y.toFixed(1)})
            `;
        }
    }
    
    drawErrorMessage(message) {
        this.ctx.fillStyle = '#ff4444';
        this.ctx.font = '14px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(`Render Error: ${message}`, this.canvas.width / 2, this.canvas.height / 2);
        this.ctx.fillText('Check console for details', this.canvas.width / 2, this.canvas.height / 2 + 20);
        this.ctx.textAlign = 'left';
    }
    
    // Legacy method for compatibility - don't use for origin changes
    updateOffset(offsetX, offsetY) {
        console.warn('updateOffset is deprecated - use setOriginPosition for origin changes');
        // This shouldn't be used for origin changes - geometry should stay fixed
    }
    
    setDebugMode(enabled) {
        this.debugMode = enabled;
        this.render();
    }
    
    toggleOutlines() {
        this.showOutlines = !this.showOutlines;
        this.render();
    }
    
    toggleFilled() {
        this.showFilled = !this.showFilled;
        this.render();
    }
    
    getViewInfo() {
        return {
            scale: this.viewScale,
            offset: this.viewOffset,
            originPosition: this.originPosition,
            bounds: this.bounds,
            stats: this.renderStats,
            layerCount: this.layerPolygons.size + this.layerHoles.size,
            debugMode: this.debugMode
        };
    }
    
    // SVG export support
    exportDebugSVG() {
        if (this.svgExporter) {
            return this.svgExporter.exportSVG();
        }
        console.error('SVG exporter not available');
        return '';
    }

    downloadDebugSVG() {
        if (this.svgExporter) {
            this.svgExporter.download();
        } else {
            console.error('SVG exporter not available - check if debug/svg-exporter.js is loaded');
        }
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PreviewRenderer;
} else {
    window.PreviewRenderer = PreviewRenderer;
}