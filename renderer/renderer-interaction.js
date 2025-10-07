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
    const debugConfig = config.debug || {};
    
    class InteractionHandler {
        constructor(renderer) {
            this.renderer = renderer;
            this.canvas = renderer.canvas;
            this.core = renderer.core;
            
            // Interaction state
            this.isPanning = false;
            this.lastPointer = { x: 0, y: 0 };
            this.pointerCount = 0;
            this.initialDistance = 0;
            this.initialScale = 1;
            
            // Zoom configuration
            this.minZoom = canvasConfig.minZoom || 0.01;
            this.maxZoom = canvasConfig.maxZoom || 1000;
            this.zoomStep = canvasConfig.zoomStep || 1.2;
            
            this.setupEventListeners();
        }
        
        setupEventListeners() {
            // Set canvas styles
            this.canvas.style.cursor = 'grab';
            this.canvas.style.userSelect = 'none';
            this.canvas.style.webkitUserSelect = 'none';
            this.canvas.style.mozUserSelect = 'none';
            this.canvas.style.msUserSelect = 'none';
            this.canvas.style.touchAction = 'none';
            
            // Prevent context menu
            this.canvas.addEventListener('contextmenu', (e) => {
                e.preventDefault();
            });
            
            this.canvas.addEventListener('dragstart', (e) => {
                e.preventDefault();
            });
            
            // Mouse events
            this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
            this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
            document.addEventListener('mouseup', (e) => this.handleMouseUp(e));
            
            // Touch events
            this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
            this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
            this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });
            
            // Wheel event
            this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
            
            // Double click for zoom fit
            this.canvas.addEventListener('dblclick', (e) => {
                e.preventDefault();
                this.zoomFit();
            });
            
            // Resize observer
            this.resizeObserver = new ResizeObserver(() => {
                this.renderer.resizeCanvas();
            });
            this.resizeObserver.observe(this.canvas);
        }
        
        handleMouseDown(e) {
            if (e.button === 0) {
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
        
        handleTouchStart(e) {
            e.preventDefault();
            
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                this.startPanning(touch.clientX, touch.clientY);
            } else if (e.touches.length === 2) {
                const touch1 = e.touches[0];
                const touch2 = e.touches[1];
                
                const distance = Math.sqrt(
                    Math.pow(touch2.clientX - touch1.clientX, 2) +
                    Math.pow(touch2.clientY - touch1.clientY, 2)
                );
                
                this.pointerCount = 2;
                this.initialDistance = distance;
                this.initialScale = this.core.viewScale;
                
                const centerX = (touch1.clientX + touch2.clientX) / 2;
                const centerY = (touch1.clientY + touch2.clientY) / 2;
                this.lastPointer = { x: centerX, y: centerY };
            }
        }
        
        handleTouchMove(e) {
            e.preventDefault();
            
            if (e.touches.length === 1 && this.isPanning) {
                const touch = e.touches[0];
                this.updatePanning(touch.clientX, touch.clientY);
            } else if (e.touches.length === 2 && this.pointerCount === 2) {
                const touch1 = e.touches[0];
                const touch2 = e.touches[1];
                
                const distance = Math.sqrt(
                    Math.pow(touch2.clientX - touch1.clientX, 2) +
                    Math.pow(touch2.clientY - touch1.clientY, 2)
                );
                
                const scaleChange = distance / this.initialDistance;
                const newScale = this.initialScale * scaleChange;
                
                const centerX = (touch1.clientX + touch2.clientX) / 2;
                const centerY = (touch1.clientY + touch2.clientY) / 2;
                
                const rect = this.canvas.getBoundingClientRect();
                const canvasCenterX = centerX - rect.left;
                const canvasCenterY = centerY - rect.top;
                
                this.setZoom(newScale, canvasCenterX, canvasCenterY);
            }
        }
        
        handleTouchEnd(e) {
            e.preventDefault();
            
            if (e.touches.length === 0) {
                this.endPanning();
            } else if (e.touches.length === 1 && this.pointerCount === 2) {
                const touch = e.touches[0];
                this.startPanning(touch.clientX, touch.clientY);
            }
        }
        
        handleWheel(e) {
            e.preventDefault();
            
            const rect = this.canvas.getBoundingClientRect();
            const cursorX = e.clientX - rect.left;
            const cursorY = e.clientY - rect.top;
            
            const currentScale = this.core.viewScale;
            
            if (e.deltaY < 0) {
                this.setZoom(currentScale * this.zoomStep, cursorX, cursorY);
            } else {
                this.setZoom(currentScale / this.zoomStep, cursorX, cursorY);
            }
        }
        
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
        
        pan(dx, dy) {
            const offset = this.core.viewOffset;
            offset.x += dx;
            offset.y += dy;
            this.renderer.render();
        }
        
        setZoom(newScale, centerX, centerY) {
            const oldScale = this.core.viewScale;
            newScale = Math.max(this.minZoom, Math.min(this.maxZoom, newScale));
            
            if (centerX === null || centerX === undefined) centerX = this.canvas.width / 2;
            if (centerY === null || centerY === undefined) centerY = this.canvas.height / 2;
            
            const offset = this.core.viewOffset;
            
            const worldCenterX = (centerX - offset.x) / oldScale;
            const worldCenterY = -(centerY - offset.y) / oldScale;
            
            this.core.viewScale = newScale;
            
            const newCanvasX = offset.x + worldCenterX * newScale;
            const newCanvasY = offset.y - worldCenterY * newScale;
            
            offset.x += centerX - newCanvasX;
            offset.y += centerY - newCanvasY;
            
            this.renderer.render();
        }
        
        zoom(scale, centerX, centerY) {
            this.setZoom(scale, centerX, centerY);
        }
        
        zoomIn(centerX, centerY) {
            const currentScale = this.core.viewScale;
            this.setZoom(currentScale * this.zoomStep, centerX, centerY);
        }
        
        zoomOut(centerX, centerY) {
            const currentScale = this.core.viewScale;
            this.setZoom(currentScale / this.zoomStep, centerX, centerY);
        }
        
        zoomFit() {
            this.core.calculateOverallBounds();
            
            const bounds = this.core.bounds;
            
            if (!bounds || !isFinite(bounds.width) || !isFinite(bounds.height) || 
                bounds.width === 0 || bounds.height === 0) {
                if (debugConfig.enabled) {
                    console.log('No valid bounds for zoom fit, using defaults');
                }
                this.core.viewScale = canvasConfig.defaultZoom || 10;
                this.core.viewOffset = { 
                    x: this.canvas.width / 2, 
                    y: this.canvas.height / 2 
                };
                this.renderer.render();
                return;
            }
            
            const padding = 0.1;
            const desiredWidth = bounds.width * (1 + padding * 2);
            const desiredHeight = bounds.height * (1 + padding * 2);
            
            const scaleX = this.canvas.width / desiredWidth;
            const scaleY = this.canvas.height / desiredHeight;
            const newScale = Math.min(scaleX, scaleY);
            
            const finalScale = Math.max(0.1, newScale);
            
            this.core.viewScale = finalScale;
            
            const centerX = bounds.minX + bounds.width / 2;
            const centerY = bounds.minY + bounds.height / 2;
            
            this.core.viewOffset = {
                x: this.canvas.width / 2 - centerX * finalScale,
                y: this.canvas.height / 2 + centerY * finalScale
            };
            
            if (debugConfig.enabled) {
                console.log(`Zoom fit applied: scale=${finalScale.toFixed(2)}, center=(${centerX.toFixed(2)}, ${centerY.toFixed(2)})`);
            }
            
            this.renderer.render();
        }
        
        destroy() {
            if (this.resizeObserver) {
                this.resizeObserver.disconnect();
            }
        }
    }
    
    // Export
    window.InteractionHandler = InteractionHandler;
    
})();