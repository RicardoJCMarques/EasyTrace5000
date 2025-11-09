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
    
    const config = window.PCBCAMConfig || {};
    const canvasConfig = config.rendering?.canvas || {};
    const interactionConfig = config.renderer?.interaction || {};
    
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
                lastTouchPos: null
            };

            this.lastScreenPos = { x: 0, y: 0 };
            
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
                this.lastMousePos = { x: e.clientX, y: e.clientY };
                this.canvas.style.cursor = interactionConfig.cursorGrabbing || 'grabbing';
            } else if (e.button === 2) {
                this.isRightDragging = true;
                this.lastMousePos = { x: e.clientX, y: e.clientY };
            }
            
            e.preventDefault();
        }
        
        _handleMouseMove(e) {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const worldPos = this.core.screenToWorld(x, y);
            
            this.lastScreenPos = { x: x, y: y };
            this.updateCoordinateDisplay();
            
            if (this.isDragging || this.isRightDragging) {
                if (this.lastMousePos) {
                    const dx = e.clientX - this.lastMousePos.x;
                    const dy = e.clientY - this.lastMousePos.y;
                    
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
            this.canvas.style.cursor = interactionConfig.cursorGrab || 'grab';
        }
        
        _handleWheel(e) {
            e.preventDefault();
            
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            const worldPos = this.core.screenToWorld(mouseX, mouseY);
            
            const wheelSpeed = canvasConfig.wheelZoomSpeed || 0.002;
            const zoomDelta = e.deltaY * wheelSpeed;
            const zoomFactor = Math.exp(-zoomDelta);
            
            this.core.zoomToPoint(mouseX, mouseY, zoomFactor);
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
            
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                this.lastMousePos = {
                    x: touch.clientX,
                    y: touch.clientY
                };
                this.touchState.active = true;
            } else if (e.touches.length === 2) {
                const touch1 = e.touches[0];
                const touch2 = e.touches[1];
                
                const dx = touch2.clientX - touch1.clientX;
                const dy = touch2.clientY - touch1.clientY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                this.touchState.startDistance = distance;
                this.touchState.lastDistance = distance;
                this.touchState.startScale = this.core.viewScale;
                this.touchState.active = true;
                
                this.touchState.lastTouchPos = {
                    x: (touch1.clientX + touch2.clientX) / 2,
                    y: (touch1.clientY + touch2.clientY) / 2
                };
            }
        }
        
        _handleTouchMove(e) {
            e.preventDefault();
            
            if (!this.touchState.active) return;
            
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                
                if (this.lastMousePos) {
                    const dx = touch.clientX - this.lastMousePos.x;
                    const dy = touch.clientY - this.lastMousePos.y;
                    
                    this.core.pan(dx, dy);
                    this.renderer.render();
                }
                
                this.lastMousePos = {
                    x: touch.clientX,
                    y: touch.clientY
                };
            } else if (e.touches.length === 2) {
                const touch1 = e.touches[0];
                const touch2 = e.touches[1];
                
                const dx = touch2.clientX - touch1.clientX;
                const dy = touch2.clientY - touch1.clientY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                const centerX = (touch1.clientX + touch2.clientX) / 2;
                const centerY = (touch1.clientY + touch2.clientY) / 2;
                
                if (this.touchState.lastTouchPos) {
                    const panDx = centerX - this.touchState.lastTouchPos.x;
                    const panDy = centerY - this.touchState.lastTouchPos.y;
                    this.core.pan(panDx, panDy);
                }
                
                const rect = this.canvas.getBoundingClientRect();
                const worldPos = this.core.screenToWorld(centerX - rect.left, centerY - rect.top);
                
                const zoomFactor = distance / this.touchState.lastDistance;
                this.core.zoomToPoint(worldPos.x, worldPos.y, zoomFactor);
                
                this.touchState.lastDistance = distance;
                this.touchState.lastTouchPos = { x: centerX, y: centerY };
                
                this.renderer.render();
                this.updateZoomDisplay();
            }
        }
        
        _handleTouchEnd(e) {
            e.preventDefault();
            
            if (e.touches.length === 0) {
                this.touchState.active = false;
                this.lastMousePos = null;
            } else if (e.touches.length === 1) {
                const touch = e.touches[0];
                this.lastMousePos = {
                    x: touch.clientX,
                    y: touch.clientY
                };
            }
        }
        
        // UI Updates
        
        updateCoordinateDisplay() {
            const coordX = document.getElementById('coord-x');
            const coordY = document.getElementById('coord-y');

            // Re-calculate world position from stored screen position
            const worldPos = this.core.screenToWorld(this.lastScreenPos.x, this.lastScreenPos.y);
            
            const precision = interactionConfig.coordPrecision || 2;
            if (coordX) coordX.textContent = worldPos.x.toFixed(precision);
            if (coordY) coordY.textContent = worldPos.y.toFixed(precision);
        }
        
        updateZoomDisplay() {
            const zoomLevel = document.getElementById('zoom-level');
            if (zoomLevel) {
                const precision = interactionConfig.zoomPrecision || 0;
                const zoomPercent = (this.core.viewScale * 10).toFixed(precision);
                zoomLevel.textContent = zoomPercent + '%';
            }
        }
    }
    
    window.InteractionHandler = InteractionHandler;
})();