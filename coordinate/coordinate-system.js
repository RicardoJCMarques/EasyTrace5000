// Coordinate System Manager - PROFESSIONAL: Simplified professional CAM workflow
// coordinate/coordinate-system.js

class CoordinateSystemManager {
    constructor(options = {}) {
        this.options = {
            debug: options.debug || false,
            ...options
        };
        
        // PROFESSIONAL: Simplified coordinate tracking like professional CAM tools
        this.fileOrigin = { x: 0, y: 0 }; // Where the original file coordinates are (never changes)
        this.workingOrigin = { x: 0, y: 0 }; // Current working origin (user's chosen reference point)
        this.storedOrigin = { x: 0, y: 0 }; // Last stored origin (for reset functionality)
        
        this.boardBounds = null; // Board bounds in file coordinates
        this.initialized = false;
        this.hasCustomOrigin = false; // Track if user has set a custom origin
        
        // Communication with renderer
        this.renderer = null;
        
        this.debug('PROFESSIONAL: CoordinateSystemManager initialized with stored origin tracking');
    }
    
    /**
     * Set renderer for coordinate system display
     */
    setRenderer(renderer) {
        this.renderer = renderer;
        this.debug('Renderer linked to coordinate system');
    }
    
    /**
     * PROFESSIONAL: Analyze coordinate system from operations and set initial state
     */
    analyzeCoordinateSystem(operations) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let hasData = false;

        operations.forEach(op => {
            if (op.bounds) {
                minX = Math.min(minX, op.bounds.minX);
                minY = Math.min(minY, op.bounds.minY);
                maxX = Math.max(maxX, op.bounds.maxX);
                maxY = Math.max(maxY, op.bounds.maxY);
                hasData = true;
            }
        });

        if (hasData) {
            const bounds = {
                minX, minY, maxX, maxY,
                width: maxX - minX,
                height: maxY - minY,
                centerX: (minX + maxX) / 2,
                centerY: (minY + maxY) / 2
            };
            
            this.boardBounds = { ...bounds };
            this.debug('Board bounds calculated:', this.boardBounds);
            
            // PROFESSIONAL: Initialize to file origin if not already initialized
            if (!this.initialized) {
                this.fileOrigin.x = 0;
                this.fileOrigin.y = 0;
                this.workingOrigin.x = 0;
                this.workingOrigin.y = 0;
                this.storedOrigin.x = 0; // Initialize stored origin to file origin
                this.storedOrigin.y = 0;
                this.initialized = true;
                
                // Update renderer to show initial origin position
                if (this.renderer) {
                    this.renderer.setOriginPosition(this.workingOrigin.x, this.workingOrigin.y);
                }
                
                this.debug(`PROFESSIONAL: Initialized - Working Origin at file origin (0, 0)`);
            }
        } else {
            this.debug('No board data found for bounds calculation');
        }

        return this.getStatus();
    }

    /**
     * PROFESSIONAL: Move origin to board center immediately and return applied offset
     */
    moveToCenter() {
        if (!this.boardBounds) {
            return { success: false, error: 'No board bounds available' };
        }
        
        // Calculate offset
        const targetX = this.boardBounds.centerX;
        const targetY = this.boardBounds.centerY;
        const offsetX = targetX - this.workingOrigin.x;
        const offsetY = targetY - this.workingOrigin.y;
        
        // Store current position before moving
        this.storedOrigin.x = this.workingOrigin.x;
        this.storedOrigin.y = this.workingOrigin.y;
        
        // Move to center
        this.workingOrigin.x = targetX;
        this.workingOrigin.y = targetY;
        this.hasCustomOrigin = true;
        
        // Update renderer to show new origin position
        if (this.renderer) {
            this.renderer.setOriginPosition(this.workingOrigin.x, this.workingOrigin.y);
        }
        
        this.debug(`PROFESSIONAL: Moved origin to center: (${this.workingOrigin.x.toFixed(3)}, ${this.workingOrigin.y.toFixed(3)}), applied offset: (${offsetX.toFixed(3)}, ${offsetY.toFixed(3)})`);
        return { 
            success: true,
            appliedOffset: { x: offsetX, y: offsetY },
            newPosition: { x: this.workingOrigin.x, y: this.workingOrigin.y }
        };
    }
    
    /**
     * PROFESSIONAL: Move origin to board bottom-left immediately and return applied offset
     */
    moveToBottomLeft() {
        if (!this.boardBounds) {
            return { success: false, error: 'No board bounds available' };
        }
        
        // Calculate offset
        const targetX = this.boardBounds.minX;
        const targetY = this.boardBounds.minY;
        const offsetX = targetX - this.workingOrigin.x;
        const offsetY = targetY - this.workingOrigin.y;
        
        // Store current position before moving
        this.storedOrigin.x = this.workingOrigin.x;
        this.storedOrigin.y = this.workingOrigin.y;
        
        // Move to bottom-left
        this.workingOrigin.x = targetX;
        this.workingOrigin.y = targetY;
        this.hasCustomOrigin = true;
        
        // Update renderer to show new origin position
        if (this.renderer) {
            this.renderer.setOriginPosition(this.workingOrigin.x, this.workingOrigin.y);
        }
        
        this.debug(`PROFESSIONAL: Moved origin to bottom-left: (${this.workingOrigin.x.toFixed(3)}, ${this.workingOrigin.y.toFixed(3)}), applied offset: (${offsetX.toFixed(3)}, ${offsetY.toFixed(3)})`);
        return { 
            success: true,
            appliedOffset: { x: offsetX, y: offsetY },
            newPosition: { x: this.workingOrigin.x, y: this.workingOrigin.y }
        };
    }

    /**
     * PROFESSIONAL: Move origin by offset from current position and store previous position
     */
    moveOriginByOffset(offsetX, offsetY) {
        if (!this.initialized) {
            return { success: false, error: 'Coordinate system not initialized' };
        }
        
        // Store current position before moving
        this.storedOrigin.x = this.workingOrigin.x;
        this.storedOrigin.y = this.workingOrigin.y;
        
        // Move working origin by the specified offset
        this.workingOrigin.x += offsetX;
        this.workingOrigin.y += offsetY;
        this.hasCustomOrigin = true;
        
        // Update renderer to show new origin position
        if (this.renderer) {
            this.renderer.setOriginPosition(this.workingOrigin.x, this.workingOrigin.y);
        }
        
        this.debug(`PROFESSIONAL: Working origin moved by (${offsetX}, ${offsetY}) to: (${this.workingOrigin.x.toFixed(3)}, ${this.workingOrigin.y.toFixed(3)}), stored previous: (${this.storedOrigin.x.toFixed(3)}, ${this.storedOrigin.y.toFixed(3)})`);
        return { success: true };
    }

    /**
     * PROFESSIONAL: Reset to stored origin (previous position)
     */
    resetToStoredOrigin() {
        if (!this.initialized) {
            return { success: false, error: 'Coordinate system not initialized' };
        }
        
        // Reset working origin to stored position
        this.workingOrigin.x = this.storedOrigin.x;
        this.workingOrigin.y = this.storedOrigin.y;
        
        // If stored origin is file origin, mark as not custom
        if (this.storedOrigin.x === this.fileOrigin.x && this.storedOrigin.y === this.fileOrigin.y) {
            this.hasCustomOrigin = false;
        }
        
        // Update renderer to show new origin position
        if (this.renderer) {
            this.renderer.setOriginPosition(this.workingOrigin.x, this.workingOrigin.y);
        }
        
        this.debug(`PROFESSIONAL: Working origin reset to stored position: (${this.workingOrigin.x.toFixed(3)}, ${this.workingOrigin.y.toFixed(3)})`);
        return { success: true };
    }

    /**
     * PROFESSIONAL: Get current system status for UI display
     */
    getStatus() {
        const boardSize = this.boardBounds ? {
            width: this.boardBounds.width,
            height: this.boardBounds.height
        } : { width: 0, height: 0 };
        
        const currentPosition = { ...this.workingOrigin };
        
        // Generate professional origin description
        let originDescription = 'File Origin';
        if (this.hasCustomOrigin && this.boardBounds) {
            // Check if at board center
            const atCenter = Math.abs(this.workingOrigin.x - this.boardBounds.centerX) < 0.01 &&
                            Math.abs(this.workingOrigin.y - this.boardBounds.centerY) < 0.01;
            
            // Check if at board bottom-left
            const atBottomLeft = Math.abs(this.workingOrigin.x - this.boardBounds.minX) < 0.01 &&
                               Math.abs(this.workingOrigin.y - this.boardBounds.minY) < 0.01;
            
            if (atCenter) {
                originDescription = 'Board Center';
            } else if (atBottomLeft) {
                originDescription = 'Board Bottom-Left';
            } else {
                // Show offset from file origin
                const offsetX = this.workingOrigin.x - this.fileOrigin.x;
                const offsetY = this.workingOrigin.y - this.fileOrigin.y;
                originDescription = `Custom (${offsetX.toFixed(1)}, ${offsetY.toFixed(1)})mm`;
            }
        }
        
        return {
            boardSize: boardSize,
            currentPosition: currentPosition,
            originDescription: originDescription,
            hasCustomOrigin: this.hasCustomOrigin,
            initialized: this.initialized,
            
            // For backward compatibility with existing code
            currentOrigin: { ...this.workingOrigin },
            workingOrigin: { ...this.workingOrigin },
            storedOrigin: { ...this.storedOrigin },
            fileOrigin: { ...this.fileOrigin },
            boardBounds: this.boardBounds ? { ...this.boardBounds } : null,
            originalBounds: this.boardBounds ? { ...this.boardBounds } : null,
            hasValidBounds: this.boardBounds !== null,
            userHasSetOrigin: this.hasCustomOrigin,
            isAtWorking: true, // Always at working position in simplified model
            displayInfo: {
                boardSize: boardSize,
                currentOffset: { x: 0, y: 0 }, // Always 0 since offset inputs represent "move from current"
                originDescription: originDescription
            }
        };
    }

    /**
     * Get origin position for rendering
     */
    getOriginPosition() {
        return { ...this.workingOrigin };
    }

    /**
     * Get coordinate transformation for G-code generation
     */
    getCoordinateTransform() {
        return {
            offsetX: -this.workingOrigin.x,
            offsetY: -this.workingOrigin.y
        };
    }
    
    /**
     * Debug logging
     */
    debug(message, data = null) {
        if (this.options.debug) {
            if (data) {
                console.log(`[CoordinateSystem-PROFESSIONAL] ${message}`, data);
            } else {
                console.log(`[CoordinateSystem-PROFESSIONAL] ${message}`);
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