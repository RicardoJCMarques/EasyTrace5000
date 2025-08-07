// renderer/canvas-interaction.js - Mouse, touch, and keyboard interaction
// Handles all user interaction with the canvas

class CanvasInteraction {
    constructor(renderer) {
        this.renderer = renderer;
        this.canvas = renderer.canvas;
        
        // Interaction state
        this.isPanning = false;
        this.lastPointer = { x: 0, y: 0 };
        this.pointerCount = 0;
        this.initialDistance = 0;
        this.initialScale = 1;
        
        // Zoom constraints
        this.minZoom = 0.01;
        this.maxZoom = 1000;
        
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Prevent default behaviors
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
        
        // Mouse events (desktop)
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        document.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        
        // Touch events (mobile/tablet)
        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });
        
        // Wheel zoom
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
        
        // Double click to fit
        this.canvas.addEventListener('dblclick', (e) => {
            e.preventDefault();
            this.zoomFit();
        });
        
        // Handle resize
        this.resizeObserver = new ResizeObserver(() => {
            this.renderer.resizeCanvas();
        });
        this.resizeObserver.observe(this.canvas);
    }
    
    // Mouse event handlers
    handleMouseDown(e) {
        if (e.button === 0) { // Left button only
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
    
    // Touch event handlers
    handleTouchStart(e) {
        e.preventDefault();
        
        if (e.touches.length === 1) {
            // Single touch - start panning
            const touch = e.touches[0];
            this.startPanning(touch.clientX, touch.clientY);
        } else if (e.touches.length === 2) {
            // Two finger touch - start pinch zoom
            const touch1 = e.touches[0];
            const touch2 = e.touches[1];
            
            const distance = Math.sqrt(
                Math.pow(touch2.clientX - touch1.clientX, 2) +
                Math.pow(touch2.clientY - touch1.clientY, 2)
            );
            
            this.pointerCount = 2;
            this.initialDistance = distance;
            this.initialScale = this.renderer.viewScale;
            
            // Center point for zoom
            const centerX = (touch1.clientX + touch2.clientX) / 2;
            const centerY = (touch1.clientY + touch2.clientY) / 2;
            this.lastPointer = { x: centerX, y: centerY };
        }
    }
    
    handleTouchMove(e) {
        e.preventDefault();
        
        if (e.touches.length === 1 && this.isPanning) {
            // Single touch panning
            const touch = e.touches[0];
            this.updatePanning(touch.clientX, touch.clientY);
        } else if (e.touches.length === 2 && this.pointerCount === 2) {
            // Two finger pinch zoom
            const touch1 = e.touches[0];
            const touch2 = e.touches[1];
            
            const distance = Math.sqrt(
                Math.pow(touch2.clientX - touch1.clientX, 2) +
                Math.pow(touch2.clientY - touch1.clientY, 2)
            );
            
            const scaleChange = distance / this.initialDistance;
            const newScale = this.initialScale * scaleChange;
            
            // Center point for zoom
            const centerX = (touch1.clientX + touch2.clientX) / 2;
            const centerY = (touch1.clientY + touch2.clientY) / 2;
            
            // Get canvas relative coordinates
            const rect = this.canvas.getBoundingClientRect();
            const canvasCenterX = centerX - rect.left;
            const canvasCenterY = centerY - rect.top;
            
            this.setZoom(newScale, canvasCenterX, canvasCenterY);
        }
    }
    
    handleTouchEnd(e) {
        e.preventDefault();
        
        if (e.touches.length === 0) {
            // All touches ended
            this.endPanning();
        } else if (e.touches.length === 1 && this.pointerCount === 2) {
            // From pinch to single touch - restart panning
            const touch = e.touches[0];
            this.startPanning(touch.clientX, touch.clientY);
        }
    }
    
    // Wheel zoom handler
    handleWheel(e) {
        e.preventDefault();
        
        const rect = this.canvas.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;
        
        const scaleAmount = 1.1;
        
        if (e.deltaY < 0) {
            this.setZoom(this.renderer.viewScale * scaleAmount, cursorX, cursorY);
        } else {
            this.setZoom(this.renderer.viewScale / scaleAmount, cursorX, cursorY);
        }
    }
    
    // Panning methods
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
    
    // View manipulation methods
    pan(dx, dy) {
        this.renderer.viewOffset.x += dx;
        this.renderer.viewOffset.y += dy;
        this.renderer.render();
    }
    
    setZoom(newScale, centerX, centerY) {
        const oldScale = this.renderer.viewScale;
        newScale = Math.max(this.minZoom, Math.min(this.maxZoom, newScale));
        
        if (centerX === null || centerX === undefined) centerX = this.canvas.width / 2;
        if (centerY === null || centerY === undefined) centerY = this.canvas.height / 2;
        
        // Calculate world coordinates at zoom center
        const worldCenterX = (centerX - this.renderer.viewOffset.x) / oldScale;
        const worldCenterY = -(centerY - this.renderer.viewOffset.y) / oldScale;
        
        // Update scale
        this.renderer.viewScale = newScale;
        
        // Calculate new offset to keep world point at same screen position
        const newCanvasX = this.renderer.viewOffset.x + worldCenterX * newScale;
        const newCanvasY = this.renderer.viewOffset.y - worldCenterY * newScale;
        
        this.renderer.viewOffset.x += centerX - newCanvasX;
        this.renderer.viewOffset.y += centerY - newCanvasY;
        
        this.renderer.render();
    }
    
    zoom(scale, centerX, centerY) {
        this.setZoom(scale, centerX, centerY);
    }
    
    zoomIn(centerX, centerY) {
        this.setZoom(this.renderer.viewScale * 1.2, centerX, centerY);
    }
    
    zoomOut(centerX, centerY) {
        this.setZoom(this.renderer.viewScale / 1.2, centerX, centerY);
    }
    
    zoomFit() {
        this.renderer.calculateOverallBounds();
        const bounds = this.renderer.bounds;
        
        if (!bounds || !isFinite(bounds.width) || !isFinite(bounds.height)) {
            console.log('No valid bounds - centering on origin');
            // No content - center on origin with reasonable zoom
            this.renderer.viewScale = 10;
            this.renderer.viewOffset = { 
                x: this.canvas.width / 2, 
                y: this.canvas.height / 2 
            };
            this.renderer.render();
            return;
        }
        
        const padding = 0.1; // 10% padding
        const desiredWidth = bounds.width * (1 + padding * 2);
        const desiredHeight = bounds.height * (1 + padding * 2);
        
        // Ensure minimum zoom for small boards
        const minZoom = 1;
        const scaleX = Math.max(minZoom, this.canvas.width / desiredWidth);
        const scaleY = Math.max(minZoom, this.canvas.height / desiredHeight);
        this.renderer.viewScale = Math.min(scaleX, scaleY);
        
        // Center the board bounds in the canvas
        this.renderer.viewOffset.x = this.canvas.width / 2 - bounds.centerX * this.renderer.viewScale;
        this.renderer.viewOffset.y = this.canvas.height / 2 + bounds.centerY * this.renderer.viewScale;
        
        console.log('zoomFit applied - scale:', this.renderer.viewScale, 'offset:', this.renderer.viewOffset);
        
        this.renderer.render();
    }
    
    // Cleanup
    destroy() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
    }
}

// Extend the CanvasRenderer to create LayerRenderer with interaction
class LayerRenderer extends CanvasRenderer {
    constructor(canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) {
            throw new Error(`Canvas element with id '${canvasId}' not found`);
        }
        
        super(canvas);
        
        // Add interaction handling
        this.interaction = new CanvasInteraction(this);
        
        // Additional layer renderer specific features
        this.coordinateSystem = null;
        
        console.log('LayerRenderer initialized with interaction support');
    }
    
    // Coordinate system integration
    setCoordinateSystem(coordinateSystem) {
        this.coordinateSystem = coordinateSystem;
        console.log('Coordinate system linked to renderer');
    }
    
    getCoordinateSystem() {
        return this.coordinateSystem;
    }
    
    // Public API methods that delegate to interaction
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
    
    // Get current view state
    getViewState() {
        return {
            offset: { ...this.viewOffset },
            scale: this.viewScale,
            bounds: this.bounds ? { ...this.bounds } : null,
            rotation: this.currentRotation
        };
    }
    
    // Set view state
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
        this.render();
    }
    
    // Destroy and cleanup
    destroy() {
        if (this.interaction) {
            this.interaction.destroy();
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CanvasInteraction, LayerRenderer };
} else {
    window.CanvasInteraction = CanvasInteraction;
    window.LayerRenderer = LayerRenderer;  // ← CRITICAL: Must be exported
}