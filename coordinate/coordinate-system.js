/**
 * @file        coordinate/coordinate-system.js
 * @description Manages coordinate translations / rotations
 * @author      Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

/*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2025 Eltryus
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

(function() {
    'use strict';
    
    // Get config reference
    const config = window.PCBCAMConfig || {};
    const debugConfig = config.debug || {};
    const geomConfig = config.geometry || {};
    
    class CoordinateSystemManager {
        constructor(options = {}) {
            this.options = {
                debug: options.debug !== undefined ? options.debug : debugConfig.enabled,
                ...options
            };
            
            // Simplified coordinate tracking - only one saved origin
            this.fileOrigin = { x: 0, y: 0 }; // Original file coordinates (0,0)
            this.savedOrigin = { x: 0, y: 0 }; // User's saved origin position
            this.previewOrigin = { x: 0, y: 0 }; // Current preview position (for display)
            
            // Rotation tracking
            this.currentRotation = 0; // Current rotation angle in degrees
            this.fileRotation = 0; // Original file rotation (always 0)
            this.rotationCenter = null; // Center point for rotation (board center)
            
            this.boardBounds = null; // Board bounds in file coordinates
            this.initialized = false;
            
            // Communication with renderer
            this.renderer = null;
            
            this.debug('CoordinateSystemManager initialized with config integration');
        }
        
        setRenderer(renderer) {
            this.renderer = renderer;
            this.debug('Renderer linked to coordinate system');
        }

        initializeEmpty() {
            // Initialize with default empty bounds for empty canvas
            if (!this.initialized) {
                this.boardBounds = {
                    minX: 0,
                    minY: 0,
                    maxX: 100,
                    maxY: 100,
                    width: 100,
                    height: 100,
                    centerX: 50,
                    centerY: 50
                };
                
                this.rotationCenter = {
                    x: 50,
                    y: 50
                };
                
                this.fileOrigin = { x: 0, y: 0 };
                this.savedOrigin = { x: 0, y: 0 };
                this.previewOrigin = { x: 0, y: 0 };
                this.currentRotation = 0;
                this.fileRotation = 0;
                this.initialized = true;
                
                this.syncToRenderer();
                this.debug('Initialized with empty canvas bounds');
            }
            
            return this.getStatus();
        }
        
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
                
                // Set rotation center to board center

                if (this.currentRotation === 0 || !this.initialized) {
                    this.rotationCenter = {
                        x: bounds.centerX,
                        y: bounds.centerY
                    };
                    this.debug('Board bounds and rotation center calculated:', this.boardBounds);
                } else {
                    this.debug('Board bounds recalculated (rotation center preserved):', this.boardBounds);
                }
                
                // Initialize origins if not already initialized
                if (!this.initialized) {
                    this.fileOrigin = { x: 0, y: 0 };
                    this.savedOrigin = { x: 0, y: 0 };
                    this.previewOrigin = { x: 0, y: 0 };
                    this.currentRotation = 0;
                    this.fileRotation = 0;
                    this.initialized = true;
                    
                    // Sync preview to renderer
                    this.syncToRenderer();
                    
                    this.debug('Initialized with file origin (0, 0)');
                }
            } else {
                this.debug('No board data found for bounds calculation');
            }

            return this.getStatus();
        }

        syncToRenderer() {
            if (this.renderer) {
                this.renderer.setOriginPosition(this.previewOrigin.x, this.previewOrigin.y);
                this.renderer.setRotation(this.currentRotation, this.rotationCenter);
                
                if (debugConfig.logging?.coordinateConversion) {
                    this.debug(`Synced preview to renderer: (${this.previewOrigin.x.toFixed(3)}, ${this.previewOrigin.y.toFixed(3)}), rotation: ${this.currentRotation}°`);
                }
            }
        }

        previewCenterOrigin() {
            if (!this.boardBounds) {
                return { success: false, error: 'No board bounds available' };
            }
            
            // Calculate rotated center position
            const rotatedBounds = this.getRotatedBoardBounds();
            
            this.previewOrigin.x = rotatedBounds.centerX;
            this.previewOrigin.y = rotatedBounds.centerY;
            
            // Sync preview to renderer
            this.syncToRenderer();
            
            this.debug(`Preview origin at center: (${this.previewOrigin.x.toFixed(3)}, ${this.previewOrigin.y.toFixed(3)})`);
            return { 
                success: true,
                position: { ...this.previewOrigin }
            };
        }
        
        previewBottomLeftOrigin() {
            if (!this.boardBounds) {
                return { success: false, error: 'No board bounds available' };
            }
            
            // Calculate rotated bottom-left position
            const rotatedBounds = this.getRotatedBoardBounds();
            
            this.previewOrigin.x = rotatedBounds.minX;
            this.previewOrigin.y = rotatedBounds.minY;
            
            // Sync preview to renderer
            this.syncToRenderer();
            
            this.debug(`Preview origin at bottom-left: (${this.previewOrigin.x.toFixed(3)}, ${this.previewOrigin.y.toFixed(3)})`);
            return { 
                success: true,
                position: { ...this.previewOrigin }
            };
        }

        updatePreviewByOffset(offsetX, offsetY) {
            if (!this.initialized) {
                return { success: false, error: 'Coordinate system not initialized' };
            }
            
            // Preview position is saved position plus offset
            this.previewOrigin.x = this.savedOrigin.x + offsetX;
            this.previewOrigin.y = this.savedOrigin.y + offsetY;
            
            // Sync preview to renderer
            this.syncToRenderer();
            
            this.debug(`Preview updated by offset (${offsetX}, ${offsetY}) to: (${this.previewOrigin.x.toFixed(3)}, ${this.previewOrigin.y.toFixed(3)})`);
            return { success: true };
        }

        saveCurrentOrigin() {
            if (!this.initialized) {
                return { success: false, error: 'Coordinate system not initialized' };
            }
            
            // Save preview position as the new saved origin
            this.savedOrigin.x = this.previewOrigin.x;
            this.savedOrigin.y = this.previewOrigin.y;
            
            this.debug(`Saved origin: (${this.savedOrigin.x.toFixed(3)}, ${this.savedOrigin.y.toFixed(3)})`);
            return { success: true };
        }

        resetToSavedOrigin() {
            if (!this.initialized) {
                return { success: false, error: 'Coordinate system not initialized' };
            }
            
            // Reset preview to saved position
            this.previewOrigin.x = this.savedOrigin.x;
            this.previewOrigin.y = this.savedOrigin.y;
            
            // Sync to renderer
            this.syncToRenderer();
            
            this.debug(`Reset preview to saved origin: (${this.previewOrigin.x.toFixed(3)}, ${this.previewOrigin.y.toFixed(3)})`);
            return { success: true };
        }

        getOffsetFromSaved() {
            if (!this.initialized) {
                return { x: 0, y: 0 };
            }
            
            return {
                x: this.previewOrigin.x - this.savedOrigin.x,
                y: this.previewOrigin.y - this.savedOrigin.y
            };
        }

        getRotatedBoardBounds() {
            if (!this.boardBounds || this.currentRotation === 0) {
                return this.boardBounds;
            }

            // Get the four corners of the original board bounds
            const corners = [
                { x: this.boardBounds.minX, y: this.boardBounds.minY }, // bottom-left
                { x: this.boardBounds.maxX, y: this.boardBounds.minY }, // bottom-right
                { x: this.boardBounds.maxX, y: this.boardBounds.maxY }, // top-right
                { x: this.boardBounds.minX, y: this.boardBounds.maxY }  // top-left
            ];

            // Rotate each corner around the rotation center
            const rotationCenter = this.rotationCenter || { x: this.boardBounds.centerX, y: this.boardBounds.centerY };
            const angle = (this.currentRotation * Math.PI) / 180;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            const rotatedCorners = corners.map(corner => {
                const dx = corner.x - rotationCenter.x;
                const dy = corner.y - rotationCenter.y;
                
                return {
                    x: rotationCenter.x + (dx * cos - dy * sin),
                    y: rotationCenter.y + (dx * sin + dy * cos)
                };
            });

            // Find the new bounds
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;

            rotatedCorners.forEach(corner => {
                minX = Math.min(minX, corner.x);
                minY = Math.min(minY, corner.y);
                maxX = Math.max(maxX, corner.x);
                maxY = Math.max(maxY, corner.y);
            });

            return {
                minX, minY, maxX, maxY,
                width: maxX - minX,
                height: maxY - minY,
                centerX: (minX + maxX) / 2,
                centerY: (minY + maxY) / 2
            };
        }

        rotateBoardBy(angle) {
            if (!this.initialized) {
                return { success: false, error: 'Coordinate system not initialized' };
            }
            
            if (!this.boardBounds) {
                return { success: false, error: 'No board bounds available for rotation' };
            }
            
            // Normalize angle to 0-360 range
            const normalizedAngle = ((angle % 360) + 360) % 360;
            
            // Apply rotation
            this.currentRotation = (this.currentRotation + normalizedAngle) % 360;
            
            // Sync rotation to renderer
            this.syncToRenderer();
            
            this.debug(`Board rotated by ${normalizedAngle}°, total rotation: ${this.currentRotation}°`);
            
            return { 
                success: true,
                appliedRotation: normalizedAngle,
                totalRotation: this.currentRotation,
                rotationCenter: { ...this.rotationCenter }
            };
        }

        resetRotationOnly() {
            if (!this.initialized) {
                return { success: false, error: 'Coordinate system not initialized' };
            }
            
            const previousRotation = this.currentRotation;
            
            // Reset rotation to file orientation only
            this.currentRotation = this.fileRotation; // Should be 0
            
            // Sync to renderer
            this.syncToRenderer();
            
            this.debug(`Board rotation reset: ${previousRotation}° → ${this.currentRotation}°`);
            
            return { 
                success: true,
                previousRotation: previousRotation,
                currentRotation: this.currentRotation
            };
        }

        getGeometryTransform() {
            if (this.currentRotation === 0) {
                return null; // No transformation needed
            }
            
            return {
                type: 'rotation',
                angle: this.currentRotation,
                center: this.rotationCenter ? { ...this.rotationCenter } : { x: 0, y: 0 },
                matrix: this.getRotationMatrix()
            };
        }

        getStatus() {
            const rotatedBounds = this.getRotatedBoardBounds() || this.boardBounds;
            const boardSize = rotatedBounds ? {
                width: rotatedBounds.width,
                height: rotatedBounds.height
            } : { width: 0, height: 0 };
            
            const currentPosition = { ...this.previewOrigin };
            const savedPosition = { ...this.savedOrigin };
            const offset = this.getOffsetFromSaved();
            
            // Use config precision for comparison
            const precision = geomConfig.coordinatePrecision || 0.01;
            
            // Origin description based on preview position
            let originDescription = 'File Origin';
            if (this.boardBounds) {
                const atSaved = Math.abs(offset.x) < precision && Math.abs(offset.y) < precision;
                
                if (atSaved && savedPosition.x === 0 && savedPosition.y === 0) {
                    originDescription = 'File Origin';
                } else if (atSaved) {
                    // At saved position (not file origin)
                    const atCenter = Math.abs(savedPosition.x - this.boardBounds.centerX) < precision &&
                                    Math.abs(savedPosition.y - this.boardBounds.centerY) < precision;
                    const atBottomLeft = Math.abs(savedPosition.x - this.boardBounds.minX) < precision &&
                                        Math.abs(savedPosition.y - this.boardBounds.minY) < precision;
                    
                    if (atCenter) {
                        originDescription = 'Board Center (saved)';
                    } else if (atBottomLeft) {
                        originDescription = 'Bottom-Left (saved)';
                    } else {
                        originDescription = `Custom (${savedPosition.x.toFixed(1)}, ${savedPosition.y.toFixed(1)})mm`;
                    }
                } else {
                    // Preview position with offset
                    originDescription = `Preview: +${offset.x.toFixed(1)}, +${offset.y.toFixed(1)}mm`;
                }
            }
            
            // Add rotation info if rotated
            if (this.currentRotation !== 0) {
                originDescription += ` • ${this.currentRotation}°`;
            }
            
            return {
                boardSize: boardSize,
                currentPosition: currentPosition,
                savedPosition: savedPosition,
                offset: offset,
                originDescription: originDescription,
                currentRotation: this.currentRotation,
                rotationCenter: this.rotationCenter ? { ...this.rotationCenter } : null,
                initialized: this.initialized,
                boardBounds: this.boardBounds ? { ...this.boardBounds } : null,
                hasUnsavedChanges: Math.abs(offset.x) > precision || Math.abs(offset.y) > precision
            };
        }

        getOriginPosition() {
            return { ...this.previewOrigin };
        }

        getCoordinateTransform() {
            return {
                offsetX: -this.savedOrigin.x,
                offsetY: -this.savedOrigin.y,
                rotation: this.currentRotation,
                rotationCenter: this.rotationCenter ? { ...this.rotationCenter } : null
            };
        }
        
        getRotationMatrix() {
            const radians = (this.currentRotation * Math.PI) / 180;
            const cos = Math.cos(radians);
            const sin = Math.sin(radians);
            
            return {
                a: cos,  // scale X
                b: sin,  // skew Y
                c: -sin, // skew X
                d: cos,  // scale Y
                e: 0,    // translate X
                f: 0     // translate Y
            };
        }
        
        getRotationState() {
            return {
                angle: this.currentRotation,
                center: this.rotationCenter ? { ...this.rotationCenter } : null,
                hasRotation: this.currentRotation !== 0
            };
        }
        
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
    
    // Export
    window.CoordinateSystemManager = CoordinateSystemManager;
    
})();