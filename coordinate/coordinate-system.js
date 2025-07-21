// Simplified Coordinate System Manager for PCB CAM

class CoordinateSystemManager {
    constructor(options = {}) {
        this.options = {
            debug: options.debug || false,
            ...options
        };
        
        this.currentOrigin = { x: 0, y: 0 };
        this.boardBounds = null;
        
        this.debug('Simplified CoordinateSystemManager initialized');
    }
    
    /**
     * Simple analysis of operations to detect board boundaries
     */
    analyzeCoordinateSystem(operations) {
        const analysis = {
            timestamp: Date.now(),
            boardBounds: null,
            currentOrigin: { ...this.currentOrigin },
            hasData: false,
            totalElements: 0
        };
        
        try {
            // Collect all geometry for bounds calculation
            const allPoints = [];
            let totalPolygons = 0;
            let totalHoles = 0;
            
            operations.forEach(operation => {
                if (operation.polygons && operation.polygons.length > 0) {
                    operation.polygons.forEach(polygon => {
                        if (polygon && polygon.points && Array.isArray(polygon.points)) {
                            polygon.points.forEach(point => {
                                if (point && typeof point.x === 'number' && typeof point.y === 'number') {
                                    allPoints.push(point);
                                }
                            });
                            totalPolygons++;
                        }
                    });
                }
                
                if (operation.holes && operation.holes.length > 0) {
                    operation.holes.forEach(hole => {
                        if (hole && hole.position) {
                            const radius = (hole.diameter || 1) / 2;
                            allPoints.push(
                                { x: hole.position.x - radius, y: hole.position.y - radius },
                                { x: hole.position.x + radius, y: hole.position.y + radius }
                            );
                            totalHoles++;
                        }
                    });
                }
            });
            
            analysis.totalElements = totalPolygons + totalHoles;
            
            // Calculate board bounds from all points
            if (allPoints.length > 0) {
                analysis.boardBounds = this.calculateBoundsFromPoints(allPoints);
                this.boardBounds = analysis.boardBounds;
                analysis.hasData = true;
            }
            
            this.debug('Simple coordinate analysis complete:', {
                bounds: analysis.boardBounds,
                elements: analysis.totalElements
            });
            
        } catch (error) {
            analysis.error = error.message;
            this.debug(`Coordinate analysis error: ${error.message}`);
        }
        
        return analysis;
    }
    
    /**
     * Calculate bounds from a list of points
     */
    calculateBoundsFromPoints(points) {
        if (!points || points.length === 0) {
            return null;
        }
        
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        points.forEach(point => {
            if (point && typeof point.x === 'number' && typeof point.y === 'number') {
                minX = Math.min(minX, point.x);
                minY = Math.min(minY, point.y);
                maxX = Math.max(maxX, point.x);
                maxY = Math.max(maxY, point.y);
            }
        });
        
        if (!isFinite(minX)) {
            return null;
        }
        
        return {
            minX: minX,
            minY: minY,
            maxX: maxX,
            maxY: maxY,
            width: maxX - minX,
            height: maxY - minY,
            centerX: (minX + maxX) / 2,
            centerY: (minY + maxY) / 2
        };
    }
    
    /**
     * Set new origin (simple transformation)
     */
    setOrigin(operations, newOrigin, options = {}) {
        const previousOrigin = { ...this.currentOrigin };
        
        try {
            // Calculate transformation offset
            const offset = {
                x: previousOrigin.x - newOrigin.x,
                y: previousOrigin.y - newOrigin.y
            };
            
            this.debug(`Setting origin from (${previousOrigin.x.toFixed(3)}, ${previousOrigin.y.toFixed(3)}) to (${newOrigin.x.toFixed(3)}, ${newOrigin.y.toFixed(3)})`);
            
            // Update current origin
            this.currentOrigin = { ...newOrigin };
            
            // Update cached bounds if they exist
            if (this.boardBounds) {
                this.boardBounds.minX += offset.x;
                this.boardBounds.minY += offset.y;
                this.boardBounds.maxX += offset.x;
                this.boardBounds.maxY += offset.y;
                this.boardBounds.centerX += offset.x;
                this.boardBounds.centerY += offset.y;
            }
            
            this.debug(`Origin transform complete`);
            
            return {
                success: true,
                previousOrigin: previousOrigin,
                newOrigin: newOrigin,
                offset: offset
            };
            
        } catch (error) {
            this.debug(`Origin transform failed: ${error.message}`);
            return {
                success: false,
                error: error.message,
                previousOrigin: previousOrigin
            };
        }
    }
    
    /**
     * Get suggested origin positions based on board bounds
     */
    getSuggestedOrigins() {
        if (!this.boardBounds) {
            return {
                bottomLeft: { x: 0, y: 0, name: 'Bottom Left (Default)' },
                center: { x: 0, y: 0, name: 'Center (Default)' }
            };
        }
        
        const bounds = this.boardBounds;
        
        return {
            bottomLeft: {
                x: bounds.minX,
                y: bounds.minY,
                name: 'Bottom Left',
                description: `(${bounds.minX.toFixed(2)}, ${bounds.minY.toFixed(2)})`
            },
            center: {
                x: bounds.centerX,
                y: bounds.centerY,
                name: 'Center',
                description: `(${bounds.centerX.toFixed(2)}, ${bounds.centerY.toFixed(2)})`
            },
            bottomCenter: {
                x: bounds.centerX,
                y: bounds.minY,
                name: 'Bottom Center',
                description: `(${bounds.centerX.toFixed(2)}, ${bounds.minY.toFixed(2)})`
            },
            topLeft: {
                x: bounds.minX,
                y: bounds.maxY,
                name: 'Top Left',
                description: `(${bounds.minX.toFixed(2)}, ${bounds.maxY.toFixed(2)})`
            }
        };
    }
    
    /**
     * Calculate G-code coordinate bounds for machine validation
     */
    calculateGCodeBounds(operations, machineSettings = {}) {
        if (!this.boardBounds) {
            return {
                minX: 0, minY: 0, maxX: 0, maxY: 0,
                width: 0, height: 0,
                valid: false
            };
        }
        
        // Simple approach: use board bounds with small tool compensation
        const toolCompensation = 0.5; // 0.5mm safety margin
        
        const gcodeRounds = {
            minX: this.boardBounds.minX - toolCompensation,
            minY: this.boardBounds.minY - toolCompensation,
            maxX: this.boardBounds.maxX + toolCompensation,
            maxY: this.boardBounds.maxY + toolCompensation,
            width: this.boardBounds.width + (2 * toolCompensation),
            height: this.boardBounds.height + (2 * toolCompensation),
            valid: true
        };
        
        // Check against machine limits
        if (machineSettings.maxX !== undefined) {
            gcodeRounds.exceedsMaxX = gcodeRounds.maxX > machineSettings.maxX;
        }
        if (machineSettings.maxY !== undefined) {
            gcodeRounds.exceedsMaxY = gcodeRounds.maxY > machineSettings.maxY;
        }
        if (machineSettings.minX !== undefined) {
            gcodeRounds.exceedsMinX = gcodeRounds.minX < machineSettings.minX;
        }
        if (machineSettings.minY !== undefined) {
            gcodeRounds.exceedsMinY = gcodeRounds.minY < machineSettings.minY;
        }
        
        return gcodeRounds;
    }
    
    /**
     * Get current coordinate system status
     */
    getCoordinateSystemStatus() {
        return {
            currentOrigin: { ...this.currentOrigin },
            boardBounds: this.boardBounds ? { ...this.boardBounds } : null,
            hasValidBounds: this.boardBounds !== null,
            suggestedOrigins: this.getSuggestedOrigins()
        };
    }
    
    /**
     * Reset coordinate system to default
     */
    reset() {
        this.currentOrigin = { x: 0, y: 0 };
        this.boardBounds = null;
        this.debug('Coordinate system reset');
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