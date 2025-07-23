// Fixed Coordinate System Manager - Proper Renderer Communication
// coordinate/coordinate-system.js

class CoordinateSystemManager {
    constructor(options = {}) {
        this.options = {
            debug: options.debug || false,
            ...options
        };
        
        // Coordinate system state
        this.gerberOrigin = { x: 0, y: 0 }; // Original Gerber coordinate system origin
        this.workingOrigin = { x: 0, y: 0 }; // Current working origin (what user set as 0,0)
        this.tareOffset = { x: 0, y: 0 }; // Accumulated tare offset from user operations
        
        this.boardBounds = null;
        
        // Communication with renderer
        this.renderer = null;
        
        this.debug('CoordinateSystemManager initialized');
    }
    
    /**
     * Set renderer for proper communication
     */
    setRenderer(renderer) {
        this.renderer = renderer;
        this.debug('Renderer linked to coordinate system');
        this.notifyRendererUpdate();
    }
    
    /**
     * Set Gerber origin
     */
    setGerberOrigin(x, y) {
        this.gerberOrigin = { x, y };
        this.debug(`Gerber origin set to (${x}, ${y})`);
    }
    
    /**
     * Analyze coordinate system from operations
     */
    analyzeCoordinateSystem(operations) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let hasData = false;

        operations.forEach(op => {
            if (op.polygons) {
                op.polygons.forEach(polygon => {
                    const b = polygon.getBounds ? polygon.getBounds() : null;
                    if (b) {
                        minX = Math.min(minX, b.minX);
                        minY = Math.min(minY, b.minY);
                        maxX = Math.max(maxX, b.maxX);
                        maxY = Math.max(maxY, b.maxY);
                        hasData = true;
                    }
                });
            }
            
            if (op.holes) {
                op.holes.forEach(hole => {
                    if (hole.position && typeof hole.diameter === 'number') {
                        const r = hole.diameter / 2;
                        minX = Math.min(minX, hole.position.x - r);
                        minY = Math.min(minY, hole.position.y - r);
                        maxX = Math.max(maxX, hole.position.x + r);
                        maxY = Math.max(maxY, hole.position.y + r);
                        hasData = true;
                    }
                });
            }
        });

        if (hasData) {
            this.boardBounds = {
                minX, minY, maxX, maxY,
                width: maxX - minX,
                height: maxY - minY,
                centerX: (minX + maxX) / 2,
                centerY: (minY + maxY) / 2
            };
            this.debug('Board bounds:', this.boardBounds);
        } else {
            this.boardBounds = null;
        }

        this.notifyRendererUpdate();
        
        return {
            boardBounds: this.boardBounds,
            gerberOrigin: { ...this.gerberOrigin },
            workingOrigin: { ...this.workingOrigin },
            suggestedOrigins: this.getSuggestedOrigins()
        };
    }

    /**
     * Set the working origin to a specific absolute board coordinate
     */
    setWorkingOrigin(x, y) {
        this.workingOrigin = { x, y };
        this.tareOffset = { x: 0, y: 0 }; // Reset tare when setting new origin
        this.debug(`Working origin set to: (${x.toFixed(3)}, ${y.toFixed(3)})`);
        this.notifyRendererUpdate();
        return { success: true };
    }

    /**
     * Tare to current position (sets the current working origin as the new 0,0)
     */
    tareToCurrentPosition() {
        // The current absolute position of working origin becomes the tare point
        this.tareOffset = {
            x: this.workingOrigin.x,
            y: this.workingOrigin.y
        };
        this.debug(`Tared to current position. Tare offset: (${this.tareOffset.x.toFixed(3)}, ${this.tareOffset.y.toFixed(3)})`);
        this.notifyRendererUpdate();
        return { success: true };
    }

    /**
     * Apply manual offset
     */
    applyManualOffset(deltaX, deltaY) {
        this.workingOrigin.x += deltaX;
        this.workingOrigin.y += deltaY;
        this.debug(`Applied manual offset (${deltaX}, ${deltaY}). New working origin: (${this.workingOrigin.x.toFixed(3)}, ${this.workingOrigin.y.toFixed(3)})`);
        this.notifyRendererUpdate();
        return { 
            success: true,
            newOrigin: { ...this.workingOrigin }
        };
    }

    /**
     * Get current system state
     */
    getStatus() {
        const currentWorkingCoords = {
            x: this.workingOrigin.x + this.tareOffset.x,
            y: this.workingOrigin.y + this.tareOffset.y
        };
        
        return {
            gerberOrigin: { ...this.gerberOrigin },
            workingOrigin: { ...this.workingOrigin },
            tareOffset: { ...this.tareOffset },
            currentWorkingCoords: currentWorkingCoords,
            displayCoordinates: {
                x: -this.tareOffset.x,
                y: -this.tareOffset.y
            },
            boardBounds: this.boardBounds ? { ...this.boardBounds } : null,
            hasValidBounds: this.boardBounds !== null,
            suggestedOrigins: this.getSuggestedOrigins()
        };
    }
    
    /**
     * Alias for getStatus to match renderer expectations
     */
    getSystemState() {
        return this.getStatus();
    }
    
    /**
     * Get coordinate status (for display)
     */
    getCoordinateStatus() {
        return {
            displayCoordinates: {
                x: -this.tareOffset.x,
                y: -this.tareOffset.y
            },
            workingOrigin: { ...this.workingOrigin },
            tareOffset: { ...this.tareOffset }
        };
    }

    /**
     * Get suggested origin points
     */
    getSuggestedOrigins() {
        const origins = {};
        if (this.boardBounds) {
            const b = this.boardBounds;
            origins.bottomLeft = { x: b.minX, y: b.minY };
            origins.bottomRight = { x: b.maxX, y: b.minY };
            origins.topLeft = { x: b.minX, y: b.maxY };
            origins.topRight = { x: b.maxX, y: b.maxY };
            origins.center = { x: b.centerX, y: b.centerY };
        }
        return origins;
    }

    /**
     * Reset coordinate system to default
     */
    reset() {
        this.gerberOrigin = { x: 0, y: 0 };
        this.workingOrigin = { x: 0, y: 0 };
        this.tareOffset = { x: 0, y: 0 };
        this.debug('Coordinate system reset');
        this.notifyRendererUpdate();
    }
    
    /**
     * Notify the linked renderer to update its display
     */
    notifyRendererUpdate() {
        if (this.renderer && typeof this.renderer.updateCoordinateSystem === 'function') {
            this.renderer.updateCoordinateSystem();
        }
    }

    /**
     * Convert Gerber coordinate to current working coordinate system
     */
    gerberToWorking(gerberCoords) {
        return {
            x: gerberCoords.x - (this.workingOrigin.x + this.tareOffset.x),
            y: gerberCoords.y - (this.workingOrigin.y + this.tareOffset.y)
        };
    }

    /**
     * Convert working coordinate to Gerber coordinate system
     */
    workingToGerber(workingCoords) {
        return {
            x: workingCoords.x + (this.workingOrigin.x + this.tareOffset.x),
            y: workingCoords.y + (this.workingOrigin.y + this.tareOffset.y)
        };
    }

    /**
     * Get absolute coordinates (Gerber system) from working coordinates
     */
    getAbsoluteCoordinates(workingCoords) {
        return this.workingToGerber(workingCoords);
    }

    /**
     * Simple distance calculation
     */
    distance(p1, p2) {
        if (!p1 || !p2 || typeof p1.x !== 'number' || typeof p1.y !== 'number' ||
            typeof p2.x !== 'number' || typeof p2.y !== 'number') {
            return 0;
        }
        
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    /**
     * Debug logging
     */
    debug(message, data = null) {
        if (this.options.debug) {
            if (data) {
                console.log(`[CoordinateSystem] ${message}`, data);
            } else {
                console.log(`[CoordinateSystem] ${message}`);
            }
        }
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CoordinateSystemManager;
} else {
    window.CoordinateSystemManager = CoordinateSystemManager;
}