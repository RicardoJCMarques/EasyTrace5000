/**
 * @file        renderer/renderer-interaction.js
 * @description Manages canvas user interactions
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
    
    const config = window.PCBCAMConfig;
    // Note: config.rendering.canvas is undefined, but config.layout.canvas exists.
    // Using config.layout.canvas for wheel speed as a fallback.
    const canvasConfig = config.layout.canvas; 
    const interactionConfig = config.renderer.interaction;
    
    class InteractionHandler {
        constructor(core, renderer) {
            this.core = core;
            this.renderer = renderer;
            this.canvas = core.canvas;
            
            this.isDragging = false;
            this.lastMousePos = null;
            this.isRightDragging = false;
            
            this.touchState = {
                active: false,
                startDistance: 0,
                lastDistance: 0,
                startScale: 1,
                lastTouchPos: null // This will store CSS pixels for delta calculation
            };

            this.lastScreenPos = { x: 0, y: 0 }; // This stores physical canvas pixels
            
            this.handleMouseDown = this._handleMouseDown.bind(this);
            this.handleMouseMove = this._handleMouseMove.bind(this);
            this.handleMouseUp = this._handleMouseUp.bind(this);
            this.handleWheel = this._handleWheel.bind(this);
            this.handleContextMenu = this._handleContextMenu.bind(this);
            this.handleTouchStart = this._handleTouchStart.bind(this);
            this.handleTouchMove = this._handleTouchMove.bind(this);
            this.handleTouchEnd = this._handleTouchEnd.bind(this);
        }
        
        init() {
            this.canvas.addEventListener('mousedown', this.handleMouseDown);
            this.canvas.addEventListener('mousemove', this.handleMouseMove);
            this.canvas.addEventListener('mouseup', this.handleMouseUp);
            this.canvas.addEventListener('mouseleave', this.handleMouseUp);
            this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
            this.canvas.addEventListener('contextmenu', this.handleContextMenu);
            
            this.canvas.addEventListener('touchstart', this.handleTouchStart, { passive: false });
            this.canvas.addEventListener('touchmove', this.handleTouchMove, { passive: false });
            this.canvas.addEventListener('touchend', this.handleTouchEnd, { passive: false });
            this.canvas.addEventListener('touchcancel', this.handleTouchEnd, { passive: false });
        }
        
        destroy() {
            this.canvas.removeEventListener('mousedown', this.handleMouseDown);
            this.canvas.removeEventListener('mousemove', this.handleMouseMove);
            this.canvas.removeEventListener('mouseup', this.handleMouseUp);
            this.canvas.removeEventListener('mouseleave', this.handleMouseUp);
            this.canvas.removeEventListener('wheel', this.handleWheel);
            this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
            
            this.canvas.removeEventListener('touchstart', this.handleTouchStart);
            this.canvas.removeEventListener('touchmove', this.handleTouchMove);
            this.canvas.removeEventListener('touchend', this.handleTouchEnd);
            this.canvas.removeEventListener('touchcancel', this.handleTouchEnd);
        }
        
        // Mouse Events
        
        _handleMouseDown(e) {
            if (e.button === 0) {
                this.isDragging = true;
                this.lastMousePos = { x: e.clientX, y: e.clientY }; // Store CSS pixels for delta
                this.canvas.style.cursor = interactionConfig.cursorGrabbing || 'grabbing'; // Not in config? // irrelevant choice?
            } else if (e.button === 2) {
                this.isRightDragging = true;
                this.lastMousePos = { x: e.clientX, y: e.clientY }; // Store CSS pixels for delta
            }
            
            e.preventDefault();
        }
        
        _handleMouseMove(e) {
            const rect = this.canvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            
            // Convert CSS logical pixels to canvas physical pixels
            const x = (e.clientX - rect.left) * dpr;
            const y = (e.clientY - rect.top) * dpr;
            
            // This is correct. canvasToWorld expects physical pixels.
            this.lastScreenPos = { x: x, y: y };
            this.updateCoordinateDisplay();
            
            if (this.isDragging || this.isRightDragging) {
                if (this.lastMousePos) {
                    // Calculate delta in CSS pixels, then scale by DPR for pan
                    const dx = (e.clientX - this.lastMousePos.x) * dpr;
                    const dy = (e.clientY - this.lastMousePos.y) * dpr;
                    
                    // This is correct. pan() expects DPR-scaled delta.
                    this.core.pan(dx, dy);
                    this.renderer.render();
                    
                    this.lastMousePos = { x: e.clientX, y: e.clientY };
                }
            }
        }
        
        _handleMouseUp(e) {
            this.isDragging = false;
            this.isRightDragging = false;
            this.lastMousePos = null;
            this.canvas.style.cursor = interactionConfig.cursorGrab;
        }
        
        _handleWheel(e) {
            e.preventDefault();
            
            const rect = this.canvas.getBoundingClientRect();
            // Get DPR to convert CSS pixels to physical canvas pixels // DPR?
            const dpr = window.devicePixelRatio || 1;
            
            // Calculate physical canvas coordinates, not logical CSS coordinates
            const canvasX = (e.clientX - rect.left) * dpr;
            const canvasY = (e.clientY - rect.top) * dpr;
            
            // This config path was broken, fixed to use layout.canvas
            const wheelSpeed = canvasConfig.wheelZoomSpeed || 0.002;
            const zoomDelta = e.deltaY * wheelSpeed;
            const zoomFactor = Math.exp(-zoomDelta);
            
            // Pass the correct physical canvas coordinates to zoomToPoint
            this.core.zoomToPoint(canvasX, canvasY, zoomFactor);
            this.renderer.render();
            
            this.updateZoomDisplay();
        }
        
        _handleContextMenu(e) {
            e.preventDefault();
            return false;
        }
        
        // Touch Events
        
        _handleTouchStart(e) {
            e.preventDefault();
            const dpr = window.devicePixelRatio || 1;
            
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                this.lastMousePos = {
                    x: touch.clientX, // Store CSS pixels for delta
                    y: touch.clientY
                };
                this.touchState.active = true;
            } else if (e.touches.length === 2) {
                const touch1 = e.touches[0];
                const touch2 = e.touches[1];
                
                // Calculate distance in CSS pixels. This is fine for zoom factor.
                const dx = touch2.clientX - touch1.clientX;
                const dy = touch2.clientY - touch1.clientY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                this.touchState.startDistance = distance;
                this.touchState.lastDistance = distance;
                this.touchState.startScale = this.core.viewScale;
                this.touchState.active = true;
                
                // Store center in CSS pixels for delta calculation
                this.touchState.lastTouchPos = {
                    x: (touch1.clientX + touch2.clientX) / 2,
                    y: (touch1.clientY + touch2.clientY) / 2
                };
            }
        }
        
        _handleTouchMove(e) {
            e.preventDefault();
            
            if (!this.touchState.active) return;
            
            const dpr = window.devicePixelRatio || 1;
            
            if (e.touches.length === 1) {
                // 1-Finger Pan
                const touch = e.touches[0];
                
                if (this.lastMousePos) {
                    // Calculate delta in CSS pixels, then scale by DPR for pan
                    const dx = (touch.clientX - this.lastMousePos.x) * dpr;
                    const dy = (touch.clientY - this.lastMousePos.y) * dpr;
                    
                    this.core.pan(dx, dy);
                    this.renderer.render();
                }
                
                this.lastMousePos = {
                    x: touch.clientX, // Store new CSS position
                    y: touch.clientY
                };
            } else if (e.touches.length === 2) {
                // 2-Finger Pinch-Zoom
                const touch1 = e.touches[0];
                const touch2 = e.touches[1];
                
                // Handle Pan Component
                const centerX_css = (touch1.clientX + touch2.clientX) / 2;
                const centerY_css = (touch1.clientY + touch2.clientY) / 2;
                
                if (this.touchState.lastTouchPos) {
                    // Calculate pan delta in CSS pixels, then scale by DPR
                    const panDx = (centerX_css - this.touchState.lastTouchPos.x) * dpr;
                    const panDy = (centerY_css - this.touchState.lastTouchPos.y) * dpr;
                    this.core.pan(panDx, panDy);
                }

                // Handle Zoom Component
                const dx_css = touch2.clientX - touch1.clientX;
                const dy_css = touch2.clientY - touch1.clientY;
                const distance = Math.sqrt(dx_css * dx_css + dy_css * dy_css);
                
                const rect = this.canvas.getBoundingClientRect();
                
                // Calculate the zoom anchor point in *physical canvas pixels*
                const canvasX = (centerX_css - rect.left) * dpr;
                const canvasY = (centerY_css - rect.top) * dpr;
                
                // Calculate zoom factor
                const zoomFactor = distance / this.touchState.lastDistance;
                
                // Call zoomToPoint with physical canvas pixels
                this.core.zoomToPoint(canvasX, canvasY, zoomFactor);
                
                // Update State
                this.touchState.lastDistance = distance;
                this.touchState.lastTouchPos = { x: centerX_css, y: centerY_css };
                
                this.renderer.render();
                this.updateZoomDisplay();
            }
        }
        
        _handleTouchEnd(e) {
            e.preventDefault();
            
            if (e.touches.length === 0) {
                // Last finger lifted
                this.touchState.active = false;
                this.lastMousePos = null;
                this.touchState.lastTouchPos = null;
            } else if (e.touches.length === 1) {
                // Was 2 fingers, now 1 finger. Reset pan state.
                const touch = e.touches[0];
                this.lastMousePos = {
                    x: touch.clientX,
                    y: touch.clientY
                };
                // Keep touchState.active = true
            }
        }
        
        // UI Updates
        
        updateCoordinateDisplay() {
            const coordX = document.getElementById('coord-x');
            const coordY = document.getElementById('coord-y');

            // Re-calculate world position from stored *physical* screen position
            const worldPos = this.core.canvasToWorld(this.lastScreenPos.x, this.lastScreenPos.y);
            
            const precision = interactionConfig.coordPrecision;
            if (coordX) coordX.textContent = worldPos.x.toFixed(precision);
            if (coordY) coordY.textContent = worldPos.y.toFixed(precision);
        }
        
        updateZoomDisplay() {
            const zoomLevel = document.getElementById('zoom-level');
            if (zoomLevel) {
                const precision = interactionConfig.zoomPrecision;
                // This logic from index.html (100%) vs (10x) is confusing. // These comments are confusing? What does this mean?
                // Let's use the 100% logic from index.html // These comments are confusing? What does this mean?
                const zoomPercent = (this.core.viewScale * 10).toFixed(precision);
                zoomLevel.textContent = zoomPercent + '%';
            }
        }
    }
    
    window.InteractionHandler = InteractionHandler;
})();