// Coordinate System Manager - Fixed communication with renderer
// coordinate/coordinate-system.js

class CoordinateSystemManager {
    constructor(options = {}) {
        this.options = {
            debug: options.debug || false,
            ...options
        };
        
        // SIMPLIFIED coordinate system state
        this.workingOrigin = { x: 0, y: 0 }; // Current working origin in board coordinates
        this.boardBounds = null;
        
        // Communication with renderer
        this.renderer = null;
        this._updating = false; // Prevent circular updates
        
        this.debug('CoordinateSystemManager initialized with simplified state');
    }
    
    /**
     * Set renderer for proper communication
     */
    setRenderer(renderer) {
        this.renderer = renderer;
        this.debug('Renderer linked to coordinate system');
        // Initial sync without triggering updates
        this._updating = true;
        if (this.renderer && this.renderer.setOriginPosition) {
            this.renderer.setOriginPosition(this.workingOrigin.x, this.workingOrigin.y);
        }
        this._updating = false;
    }
    
    /**
     * Analyze coordinate system from operations
     */
    analyzeCoordinateSystem(operations) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let hasData = false;

        operations.forEach(op => {
            // Handle all primitive-based operations (Gerber files)
            if (op.primitives && op.primitives.length > 0) {
                op.primitives.forEach(primitive => {
                    const bounds = primitive.getBounds();
                    if (bounds) {
                        minX = Math.min(minX, bounds.minX);
                        minY = Math.min(minY, bounds.minY);
                        maxX = Math.max(maxX, bounds.maxX);
                        maxY = Math.max(maxY, bounds.maxY);
                        hasData = true;
                    }
                });
            }
            
            // FIXED: Handle drill holes from parsed data structure
            if (op.type === 'drill' && op.parsed && op.parsed.drillData && op.parsed.drillData.holes) {
                op.parsed.drillData.holes.forEach(hole => {
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
            
            // Also check operation bounds if available
            if (op.bounds) {
                minX = Math.min(minX, op.bounds.minX);
                minY = Math.min(minY, op.bounds.minY);
                maxX = Math.max(maxX, op.bounds.maxX);
                maxY = Math.max(maxY, op.bounds.maxY);
                hasData = true;
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
            this.debug('Board bounds calculated:', this.boardBounds);
        } else {
            this.boardBounds = null;
            this.debug('No board data found for bounds calculation');
        }

        return this.getStatus();
    }

    /**
     * Set the working origin to a specific absolute board coordinate
     */
    setWorkingOrigin(x, y) {
        // Prevent circular updates from renderer
        if (this._updating) {
            this.debug('Skipping setWorkingOrigin - circular update prevention');
            return { success: true };
        }
        
        this.workingOrigin = { x, y };
        this.debug(`Working origin set to: (${x.toFixed(3)}, ${y.toFixed(3)})`);
        
        // Update renderer if available
        if (this.renderer && this.renderer.setOriginPosition) {
            this.debug('Updating renderer origin position...');
            this._updating = true;
            this.renderer.setOriginPosition(x, y);
            this._updating = false;
            this.debug('Renderer origin position updated');
        } else {
            this.debug('No renderer available to update');
        }
        
        return { success: true };
    }

    /**
     * Apply manual offset to working origin
     */
    applyManualOffset(deltaX, deltaY) {
        const newX = this.workingOrigin.x + deltaX;
        const newY = this.workingOrigin.y + deltaY;
        
        this.setWorkingOrigin(newX, newY);
        
        this.debug(`Applied manual offset (${deltaX}, ${deltaY}). New working origin: (${newX.toFixed(3)}, ${newY.toFixed(3)})`);
        
        return { 
            success: true,
            newOrigin: { x: newX, y: newY }
        };
    }

    /**
     * Set origin to board center
     */
    centerOrigin() {
        if (!this.boardBounds) {
            this.debug('Cannot center origin: No board bounds available');
            return { success: false, error: 'No board bounds available' };
        }
        
        const result = this.setWorkingOrigin(this.boardBounds.centerX, this.boardBounds.centerY);
        this.debug(`Centered origin to (${this.boardBounds.centerX.toFixed(3)}, ${this.boardBounds.centerY.toFixed(3)})`);
        return result;
    }
    
    /**
     * Set origin to board bottom-left
     */
    bottomLeftOrigin() {
        if (!this.boardBounds) {
            this.debug('Cannot set bottom-left origin: No board bounds available');
            return { success: false, error: 'No board bounds available' };
        }
        
        const result = this.setWorkingOrigin(this.boardBounds.minX, this.boardBounds.minY);
        this.debug(`Set origin to bottom-left (${this.boardBounds.minX.toFixed(3)}, ${this.boardBounds.minY.toFixed(3)})`);
        return result;
    }
    
    /**
     * Set origin to board bottom-right
     */
    bottomRightOrigin() {
        if (!this.boardBounds) {
            return { success: false, error: 'No board bounds available' };
        }
        
        return this.setWorkingOrigin(this.boardBounds.maxX, this.boardBounds.minY);
    }
    
    /**
     * Set origin to board top-left
     */
    topLeftOrigin() {
        if (!this.boardBounds) {
            return { success: false, error: 'No board bounds available' };
        }
        
        return this.setWorkingOrigin(this.boardBounds.minX, this.boardBounds.maxY);
    }
    
    /**
     * Set origin to board top-right
     */
    topRightOrigin() {
        if (!this.boardBounds) {
            return { success: false, error: 'No board bounds available' };
        }
        
        return this.setWorkingOrigin(this.boardBounds.maxX, this.boardBounds.maxY);
    }

    /**
     * Get current system state
     */
    getStatus() {
        return {
            workingOrigin: { ...this.workingOrigin },
            boardBounds: this.boardBounds ? { ...this.boardBounds } : null,
            hasValidBounds: this.boardBounds !== null,
            suggestedOrigins: this.getSuggestedOrigins(),
            displayCoordinates: {
                x: 0, // In the new simplified system, display is always relative to working origin
                y: 0
            }
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
        this.workingOrigin = { x: 0, y: 0 };
        this.debug('Coordinate system reset');
        
        // Update renderer
        if (this.renderer && this.renderer.setOriginPosition) {
            this._updating = true;
            this.renderer.setOriginPosition(0, 0);
            this._updating = false;
        }
        
        return { success: true };
    }

    /**
     * Convert board coordinate to working coordinate system
     */
    boardToWorking(boardCoords) {
        return {
            x: boardCoords.x - this.workingOrigin.x,
            y: boardCoords.y - this.workingOrigin.y
        };
    }

    /**
     * Convert working coordinate to board coordinate system  
     */
    workingToBoard(workingCoords) {
        return {
            x: workingCoords.x + this.workingOrigin.x,
            y: workingCoords.y + this.workingOrigin.y
        };
    }

    /**
     * Get absolute coordinates (board system) from working coordinates
     */
    getAbsoluteCoordinates(workingCoords) {
        return this.workingToBoard(workingCoords);
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