/**
 * @file        renderer/renderer-interaction.js
 * @description Manages canvas user interactions
 * @author      Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

/*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2026 Eltryus
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
    const canvasConfig = config.rendering.canvas;
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
            const dpr = this.core.devicePixelRatio;

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

            const dpr = this.core.devicePixelRatio;

            // Use offsetX/Y to avoid synchronous layout reflows
            const canvasX = e.offsetX * dpr;
            const canvasY = e.offsetY * dpr;

            const wheelSpeed = canvasConfig.wheelZoomSpeed;

            const zoomDelta = e.deltaY * wheelSpeed;
            const zoomFactor = Math.exp(-zoomDelta);

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
            // Conversion to canvas pixels happens during 'move' (delta calculation)
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                this.lastMousePos = {
                    x: touch.clientX, 
                    y: touch.clientY
                };
                this.touchState.active = true;
            } 
            else if (e.touches.length === 2) {
                const t1 = e.touches[0];
                const t2 = e.touches[1];

                // Calculate initial distance (CSS pixels) for zoom ratio
                const dx = t2.clientX - t1.clientX;
                const dy = t2.clientY - t1.clientY;
                const distance = Math.sqrt(dx * dx + dy * dy);

                this.touchState.startDistance = distance;
                this.touchState.lastDistance = distance;
                this.touchState.startScale = this.core.viewScale;
                this.touchState.active = true;

                // Store initial center (CSS pixels) for pan delta
                this.touchState.lastTouchPos = {
                    x: (t1.clientX + t2.clientX) / 2,
                    y: (t1.clientY + t2.clientY) / 2
                };
            }
        }

        _handleTouchMove(e) {
            e.preventDefault();
            if (!this.touchState.active) return;

            const dpr = this.core.devicePixelRatio;

            if (e.touches.length === 1) {
                // 1. Single Finger Pan
                const touch = e.touches[0];

                if (this.lastMousePos) {
                    const dx = (touch.clientX - this.lastMousePos.x) * dpr;
                    const dy = (touch.clientY - this.lastMousePos.y) * dpr;

                    this.core.pan(dx, dy);
                    this.renderer.render();
                }
                this.lastMousePos = { x: touch.clientX, y: touch.clientY };

            } else if (e.touches.length === 2) {
                // 2. Two Finger Pinch/Pan
                const t1 = e.touches[0];
                const t2 = e.touches[1];

                // Current Center (CSS pixels)
                const currentCenterX = (t1.clientX + t2.clientX) / 2;
                const currentCenterY = (t1.clientY + t2.clientY) / 2;

                // Current Distance
                const dx = t2.clientX - t1.clientX;
                const dy = t2.clientY - t1.clientY;
                const currentDistance = Math.sqrt(dx * dx + dy * dy);

                // A. Handle Pan (Movement of center)
                if (this.touchState.lastTouchPos) {
                    const panDx = (currentCenterX - this.touchState.lastTouchPos.x) * dpr;
                    const panDy = (currentCenterY - this.touchState.lastTouchPos.y) * dpr;

                    // Jitter filter
                    if (Math.abs(panDx) > 1 || Math.abs(panDy) > 1) {
                        this.core.pan(panDx, panDy);
                    }
                }

                // B. Handle Zoom (Change in distance)
                if (this.touchState.lastDistance > 0) {
                    const zoomFactor = currentDistance / this.touchState.lastDistance;

                    if (Math.abs(1 - zoomFactor) > 0.005) {
                        const rect = this.canvas.getBoundingClientRect();
                        const canvasX = (currentCenterX - rect.left) * dpr;
                        const canvasY = (currentCenterY - rect.top) * dpr;

                        this.core.zoomToPoint(canvasX, canvasY, zoomFactor);
                    }
                }

                // Update State
                this.touchState.lastDistance = currentDistance;
                this.touchState.lastTouchPos = { x: currentCenterX, y: currentCenterY };

                this.renderer.render();
                this.updateZoomDisplay();
            }
        }

        _handleTouchEnd(e) {
            e.preventDefault();

            if (e.touches.length === 0) {
                // All fingers lifted - Reset everything
                this.touchState.active = false;
                this.lastMousePos = null;
                this.touchState.lastTouchPos = null;
                this.touchState.lastDistance = 0;
            } 
            else if (e.touches.length === 1) {
                // Transition from 2 fingers (Zoom/Pan) to 1 finger (Pan)
                // Re-sync the last position to prevent a "jump"
                const touch = e.touches[0];
                this.lastMousePos = {
                    x: touch.clientX,
                    y: touch.clientY
                };
                // Note: touchState.active remains true
            }
        }

        // UI Updates

        updateCoordinateDisplay() {
            const coordX = document.getElementById('coord-x');
            const coordY = document.getElementById('coord-y');

            if (!coordX || !coordY) return;

            // 1. Get Raw World Position (Canvas View Space)
            // This handles Pan/Zoom/Y-Flip
            let worldPos = this.core.canvasToWorld(this.lastScreenPos.x, this.lastScreenPos.y);

            // 2. Apply Coordinate System Transforms (Inverse)
            // Map "Mouse Point" -> "File Coordinate" by reversing rotation/translation

            // A. Inverse Rotation (Un-rotate mouse point around rotation center)
            if (this.core.currentRotation !== 0 && this.core.rotationCenter) {
                const c = this.core.rotationCenter;
                const angle = this.core.currentRotation;
                const rad = (angle * Math.PI) / 180;

                // Inverse rotation = -angle
                const cos = Math.cos(-rad);
                const sin = Math.sin(-rad);

                const dx = worldPos.x - c.x;
                const dy = worldPos.y - c.y;

                worldPos = {
                    x: c.x + (dx * cos - dy * sin),
                    y: c.y + (dx * sin + dy * cos)
                };
            }

            // B. Inverse Translation (Subtract User Origin)
            const origin = this.core.getOriginPosition();
            const userX = worldPos.x - origin.x;
            const userY = worldPos.y - origin.y;

            // 3. Display
            const precision = 2;
            coordX.textContent = userX.toFixed(precision);
            coordY.textContent = userY.toFixed(precision);
        }

        updateZoomDisplay() {
            const zoomLevel = document.getElementById('zoom-level');
            if (zoomLevel) {
                const precision = interactionConfig.zoomPrecision;
                // This logic from index.html (100%) vs (10x) is confusing. // Review - These comments are confusing? What does this mean?
                // Let's use the 100% logic from index.html // Review - These comments are confusing? What does this mean?
                const zoomPercent = (this.core.viewScale * 10).toFixed(precision);
                zoomLevel.textContent = zoomPercent + '%';
            }
        }
    }

    window.InteractionHandler = InteractionHandler;
})();