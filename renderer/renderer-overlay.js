/**
 * @file        renderer/renderer-overlay.js
 * @description Handles grid, rulers, origin, scale indicator, and other UI overlays
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
    const gridConfig = config.rendering?.grid || {};
    const debugConfig = config.debug || {};
    
    class OverlayRenderer {
        constructor(core) {
            this.core = core;
            this.ctx = core.ctx;
            this.canvas = core.canvas;
        }
        
        // ==================== GRID ====================
        
        renderGrid() {
            if (!this.core.options.showGrid) return;
            
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const colors = theme.canvas;
            const gridSpacing = this.calculateGridSpacing();
            const viewBounds = this.core.getViewBounds();
            
            this.ctx.strokeStyle = colors.grid;
            this.ctx.lineWidth = 0.1 / this.core.viewScale;
            this.ctx.setLineDash([]);
            
            this.ctx.beginPath();
            
            const originX = this.core.originPosition?.x || 0;
            const originY = this.core.originPosition?.y || 0;
            
            const startX = Math.floor((viewBounds.minX - originX) / gridSpacing) * gridSpacing + originX;
            const endX = Math.ceil((viewBounds.maxX - originX) / gridSpacing) * gridSpacing + originX;
            
            for (let x = startX; x <= endX; x += gridSpacing) {
                this.ctx.moveTo(x, viewBounds.minY);
                this.ctx.lineTo(x, viewBounds.maxY);
            }
            
            const startY = Math.floor((viewBounds.minY - originY) / gridSpacing) * gridSpacing + originY;
            const endY = Math.ceil((viewBounds.maxY - originY) / gridSpacing) * gridSpacing + originY;
            
            for (let y = startY; y <= endY; y += gridSpacing) {
                this.ctx.moveTo(viewBounds.minX, y);
                this.ctx.lineTo(viewBounds.maxX, y);
            }
            
            this.ctx.stroke();
        }
        
        // ==================== ORIGIN ====================
        
        renderOrigin() {
            if (!this.core.options.showOrigin) return;
            
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const colors = theme.canvas;
            
            const markerSize = canvasConfig.originMarkerSize / this.core.viewScale || 10 / this.core.viewScale;
            const circleSize = canvasConfig.originCircleSize / this.core.viewScale || 3 / this.core.viewScale;
            const strokeWidth = 3 / this.core.viewScale;
            
            const originX = this.core.originPosition?.x || 0;
            const originY = this.core.originPosition?.y || 0;
            
            // Draw outline
            this.ctx.strokeStyle = colors.originOutline;
            this.ctx.lineWidth = strokeWidth + (1 / this.core.viewScale);
            
            this.ctx.beginPath();
            this.ctx.moveTo(originX - markerSize, originY);
            this.ctx.lineTo(originX + markerSize, originY);
            this.ctx.moveTo(originX, originY - markerSize);
            this.ctx.lineTo(originX, originY + markerSize);
            this.ctx.stroke();
            
            this.ctx.beginPath();
            this.ctx.arc(originX, originY, circleSize, 0, 2 * Math.PI);
            this.ctx.stroke();
            
            // Draw main origin
            this.ctx.strokeStyle = colors.origin;
            this.ctx.lineWidth = strokeWidth;
            
            this.ctx.beginPath();
            this.ctx.moveTo(originX - markerSize, originY);
            this.ctx.lineTo(originX + markerSize, originY);
            this.ctx.moveTo(originX, originY - markerSize);
            this.ctx.lineTo(originX, originY + markerSize);
            this.ctx.stroke();
            
            this.ctx.beginPath();
            this.ctx.arc(originX, originY, circleSize, 0, 2 * Math.PI);
            this.ctx.stroke();
            
            this.ctx.fillStyle = colors.origin;
            this.ctx.fill();
        }
        
        // ==================== BOUNDS ====================
        
        renderBounds() {
            if (!this.core.options.showBounds || !this.core.overallBounds) return;
            
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const colors = theme.canvas;
            const bounds = this.core.overallBounds;
            
            this.ctx.strokeStyle = colors.bounds;
            this.ctx.lineWidth = 1 / this.core.viewScale;
            this.ctx.setLineDash([2 / this.core.viewScale, 2 / this.core.viewScale]);
            
            this.ctx.strokeRect(
                bounds.minX,
                bounds.minY,
                bounds.width,
                bounds.height
            );
            
            // Corner markers
            const markerSize = 5 / this.core.viewScale;
            this.ctx.setLineDash([]);
            this.ctx.lineWidth = 2 / this.core.viewScale;
            
            this.ctx.beginPath();
            this.ctx.moveTo(bounds.minX, bounds.minY + markerSize);
            this.ctx.lineTo(bounds.minX, bounds.minY);
            this.ctx.lineTo(bounds.minX + markerSize, bounds.minY);
            this.ctx.stroke();
            
            this.ctx.beginPath();
            this.ctx.moveTo(bounds.maxX - markerSize, bounds.maxY);
            this.ctx.lineTo(bounds.maxX, bounds.maxY);
            this.ctx.lineTo(bounds.maxX, bounds.maxY - markerSize);
            this.ctx.stroke();
        }
        
        // ==================== RULERS ====================
        
        renderRulers() {
            if (!this.core.options.showRulers) return;
            
            this.ctx.save();
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const colors = theme.canvas;
            
            this.ctx.strokeStyle = colors.ruler;
            this.ctx.fillStyle = colors.rulerText;
            this.ctx.lineWidth = 1;
            this.ctx.font = '11px Arial';
            this.ctx.textBaseline = 'top';
            this.ctx.textAlign = 'center';
            
            const rulerSize = canvasConfig.rulerSize || 20;
            const tickLength = canvasConfig.rulerTickLength || 5;
            const majorStep = this.calculateRulerStep();
            const viewBounds = this.core.getViewBounds();
            
            // Ruler backgrounds
            const bgColorWithAlpha = colors.background + '99'; 
            this.ctx.fillStyle = bgColorWithAlpha; // Apply semi-transparent background
            this.ctx.fillRect(0, 0, this.canvas.width, rulerSize); // Horizontal background
            this.ctx.fillRect(0, 0, rulerSize, this.canvas.height); // Vertical background
            this.ctx.strokeStyle = colors.ruler;
            this.ctx.fillStyle = colors.rulerText;
            
            // Horizontal ruler
            this.ctx.beginPath();
            this.ctx.moveTo(rulerSize, rulerSize);
            this.ctx.lineTo(this.canvas.width, rulerSize);
            
            const originX = this.core.originPosition?.x || 0;
            const originY = this.core.originPosition?.y || 0;
            
            const startXWorld = Math.floor((viewBounds.minX - originX) / majorStep) * majorStep + originX;
            const endXWorld = Math.ceil((viewBounds.maxX - originX) / majorStep) * majorStep + originX;
            
            for (let xWorld = startXWorld; xWorld <= endXWorld; xWorld += majorStep) {
                const xCanvas = this.core.worldToCanvasX ? this.core.worldToCanvasX(xWorld) : 
                               (xWorld * this.core.viewScale + this.canvas.width / 2);
                
                if (xCanvas >= rulerSize && xCanvas <= this.canvas.width) {
                    this.ctx.moveTo(xCanvas, rulerSize);
                    this.ctx.lineTo(xCanvas, rulerSize - tickLength);
                    
                    const relativeX = xWorld - originX;
                    let label;
                    if (majorStep < 0.01) {
                        label = `${(relativeX * 1000).toFixed(0)}μm`;
                    } else if (majorStep < 1) {
                        label = relativeX.toFixed(2);
                    } else {
                        label = relativeX.toFixed(1);
                    }
                    this.ctx.fillText(label, xCanvas, 2);
                }
            }
            this.ctx.stroke();
            
            // Vertical ruler
            this.ctx.beginPath();
            this.ctx.moveTo(rulerSize, rulerSize);
            this.ctx.lineTo(rulerSize, this.canvas.height);
            
            this.ctx.textAlign = 'left';
            this.ctx.textBaseline = 'middle';
            
            const startYWorld = Math.floor((viewBounds.minY - originY) / majorStep) * majorStep + originY;
            const endYWorld = Math.ceil((viewBounds.maxY - originY) / majorStep) * majorStep + originY;
            
            for (let yWorld = startYWorld; yWorld <= endYWorld; yWorld += majorStep) {
                const yCanvas = this.core.worldToCanvasY ? this.core.worldToCanvasY(yWorld) :
                               (this.canvas.height / 2 - yWorld * this.core.viewScale);
                
                if (yCanvas >= rulerSize && yCanvas <= this.canvas.height) {
                    this.ctx.moveTo(rulerSize, yCanvas);
                    this.ctx.lineTo(rulerSize - tickLength, yCanvas);
                    
                    const relativeY = yWorld - originY;
                    let label;
                    if (majorStep < 0.01) {
                        label = `${(relativeY * 1000).toFixed(0)}μm`;
                    } else if (majorStep < 1) {
                        label = relativeY.toFixed(2);
                    } else {
                        label = relativeY.toFixed(1);
                    }
                    
                    // Rotate text for vertical ruler
                    this.ctx.save();
                    this.ctx.translate(rulerSize / 2, yCanvas);
                    this.ctx.rotate(-Math.PI / 2);
                    this.ctx.textAlign = 'center';
                    this.ctx.textBaseline = 'middle';
                    this.ctx.fillText(label, 0, 0);
                    this.ctx.restore();
                }
            }
            this.ctx.stroke();
            
            // Corner stat box
            this.ctx.fillStyle = bgColorWithAlpha; 
            this.ctx.fillRect(0, 0, rulerSize, rulerSize);
            this.ctx.strokeRect(0, 0, rulerSize, rulerSize);
            
            // Units indicator in corner
            this.ctx.fillStyle = colors.rulerText;
            this.ctx.font = '9px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText('mm', rulerSize / 2, rulerSize / 2);
            
            this.ctx.restore();
        }
        
        // ==================== SCALE INDICATOR ====================
        
        renderScaleIndicator() {
            if (!this.core.options.showRulers) return;
            
            this.ctx.save();
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const colors = theme.canvas;
            const padding = 10;
            const barHeight = 4;
            const y = this.canvas.height - padding - 20;
            
            // Calculate nice scale bar length
            const targetPixels = 100;
            const worldLength = targetPixels / this.core.viewScale;
            
            const possibleLengths = gridConfig.steps || [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
            const niceLength = possibleLengths.find(len => len * this.core.viewScale >= 50) || 1;
            const barWidth = niceLength * this.core.viewScale;
            
            const x = this.canvas.width - padding - barWidth;
            
            // Background
            this.ctx.fillStyle = colors.background;
            this.ctx.fillRect(x - 5, y - 15, barWidth + 10, 35)
            
            // Scale bar
            this.ctx.fillStyle = colors.rulerText;
            this.ctx.fillRect(x, y, barWidth, barHeight);
            
            // End caps
            this.ctx.fillRect(x, y - 2, 2, barHeight + 4);
            this.ctx.fillRect(x + barWidth - 2, y - 2, 2, barHeight + 4);
            
            // Label
            this.ctx.font = '11px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'bottom';
            
            let label;
            if (niceLength < 0.01) {
                label = `${(niceLength * 1000).toFixed(0)}μm`;
            } else if (niceLength < 1) {
                label = `${niceLength.toFixed(2)}mm`;
            } else {
                label = `${niceLength}mm`;
            }
            
            this.ctx.fillText(label, x + barWidth / 2, y - 2);
            
            this.ctx.restore();
        }
        
        // ==================== STATISTICS ====================
        
        renderStats() {
            if (!this.core.options.showStats || !this.core.renderStats) return;
            
            this.ctx.save();
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const colors = theme.canvas;
            const stats = this.core.renderStats;
            
            const x = 10;
            let y = 50;
            const lineHeight = 16;
            
            // Calculate background size
            const lines = [];
            lines.push(`Primitives: ${stats.renderedPrimitives}/${stats.primitives}`);
            if (stats.skippedPrimitives > 0) {
                lines.push(`Culled: ${stats.skippedPrimitives}`);
            }
            if (stats.drawCalls !== undefined && stats.drawCalls > 0) {
                lines.push(`Draw calls: ${stats.drawCalls}`);
            }
            lines.push(`Render: ${stats.renderTime.toFixed(1)}ms`);
            lines.push(`Zoom: ${this.core.viewScale.toFixed(2)}x`);
            
            const bgHeight = lines.length * lineHeight + 10;
            
            // Background
            this.ctx.fillStyle = colors.background;
            this.ctx.fillRect(x - 5, y - 15, 200, bgHeight);
            
            // Text
            this.ctx.fillStyle = colors.rulerText;
            this.ctx.font = '12px monospace';
            this.ctx.textAlign = 'left';
            this.ctx.textBaseline = 'top';
            
            lines.forEach(line => {
                this.ctx.fillText(line, x, y);
                y += lineHeight;
            });
            
            this.ctx.restore();
        }
        
        // ==================== HELPER METHODS ====================
        
        calculateGridSpacing() {
            const minPixelSize = gridConfig.minPixelSpacing || 40;
            const possibleSteps = gridConfig.steps || [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
            
            for (const step of possibleSteps) {
                if (step * this.core.viewScale >= minPixelSize) {
                    return step;
                }
            }
            return possibleSteps[possibleSteps.length - 1];
        }
        
        calculateRulerStep() {
            const minPixelDistance = 50;
            const possibleSteps = gridConfig.steps || [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
            
            for (const step of possibleSteps) {
                if (step * this.core.viewScale >= minPixelDistance) {
                    return step;
                }
            }
            return possibleSteps[possibleSteps.length - 1];
        }
    }
    
    // Export
    window.OverlayRenderer = OverlayRenderer;
})();