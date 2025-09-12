// renderer/renderer-overlay.js
// Handles grid, rulers, origin, scale indicator, and other UI overlays

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
        
        renderGrid() {
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const colors = theme.canvas;
            const gridSpacing = this.calculateGridSpacing();
            const viewBounds = this.core.getViewBounds();
            
            this.ctx.strokeStyle = colors.grid;
            this.ctx.lineWidth = 0.1 / this.core.viewScale;
            this.ctx.setLineDash([]);
            
            this.ctx.beginPath();
            
            const originX = this.core.originPosition.x;
            const originY = this.core.originPosition.y;
            
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
        
        renderOrigin() {
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const colors = theme.canvas;
            
            const markerSize = canvasConfig.originMarkerSize / this.core.viewScale || 10 / this.core.viewScale;
            const circleSize = canvasConfig.originCircleSize / this.core.viewScale || 3 / this.core.viewScale;
            const strokeWidth = 3 / this.core.viewScale;
            
            const originX = this.core.originPosition.x;
            const originY = this.core.originPosition.y;
            
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
        
        renderBounds() {
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const colors = theme.canvas;
            const bounds = this.core.bounds;
            
            if (!bounds) return;
            
            this.ctx.strokeStyle = colors.bounds;
            this.ctx.lineWidth = 1 / this.core.viewScale;
            this.ctx.setLineDash([2 / this.core.viewScale, 2 / this.core.viewScale]);
            this.ctx.strokeRect(
                bounds.minX,
                bounds.minY,
                bounds.width,
                bounds.height
            );
            
            const markerSize = 5 / this.core.viewScale;
            this.ctx.setLineDash([]);
            this.ctx.lineWidth = 2 / this.core.viewScale;
            
            // Corner markers
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
        
        renderRulers() {
            this.ctx.save();
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const colors = theme.canvas;
            this.ctx.strokeStyle = colors.ruler;
            this.ctx.fillStyle = colors.rulerText;
            this.ctx.lineWidth = 1;
            this.ctx.font = '12px Arial';
            this.ctx.textBaseline = 'top';
            this.ctx.textAlign = 'left';
            
            const rulerSize = canvasConfig.rulerSize || 20;
            const tickLength = canvasConfig.rulerTickLength || 5;
            const majorStep = this.calculateRulerStep();
            const viewBounds = this.core.getViewBounds();
            
            // Horizontal ruler
            this.ctx.beginPath();
            this.ctx.moveTo(rulerSize, rulerSize);
            this.ctx.lineTo(this.canvas.width, rulerSize);
            this.ctx.stroke();
            
            this.ctx.textAlign = 'center';
            
            const originX = this.core.originPosition.x;
            const originY = this.core.originPosition.y;
            
            const startXWorld = Math.floor((viewBounds.minX - originX) / majorStep) * majorStep + originX;
            const endXWorld = Math.ceil((viewBounds.maxX - originX) / majorStep) * majorStep + originX;
            
            for (let xWorld = startXWorld; xWorld <= endXWorld; xWorld += majorStep) {
                const xCanvas = this.core.worldToCanvasX(xWorld);
                if (xCanvas >= rulerSize && xCanvas <= this.canvas.width) {
                    this.ctx.moveTo(xCanvas, rulerSize);
                    this.ctx.lineTo(xCanvas, rulerSize - tickLength);
                    
                    const relativeX = xWorld - originX;
                    let label;
                    if (majorStep < 0.1) {
                        label = `${(relativeX * 1000).toFixed(0)}μm`;
                    } else {
                        const precision = majorStep < 0.1 ? 3 : majorStep < 1 ? 2 : 1;
                        label = relativeX.toFixed(precision);
                    }
                    this.ctx.fillText(label, xCanvas, 0);
                }
            }
            this.ctx.stroke();
            
            // Vertical ruler
            this.ctx.beginPath();
            this.ctx.moveTo(rulerSize, 0);
            this.ctx.lineTo(rulerSize, this.canvas.height);
            this.ctx.stroke();
            
            this.ctx.textAlign = 'left';
            this.ctx.textBaseline = 'middle';
            
            const startYWorld = Math.floor((viewBounds.minY - originY) / majorStep) * majorStep + originY;
            const endYWorld = Math.ceil((viewBounds.maxY - originY) / majorStep) * majorStep + originY;
            
            for (let yWorld = startYWorld; yWorld <= endYWorld; yWorld += majorStep) {
                const yCanvas = this.core.worldToCanvasY(yWorld);
                if (yCanvas >= 0 && yCanvas <= this.canvas.height) {
                    this.ctx.moveTo(rulerSize, yCanvas);
                    this.ctx.lineTo(rulerSize - tickLength, yCanvas);
                    
                    const relativeY = yWorld - originY;
                    let label;
                    if (majorStep < 0.1) {
                        label = `${(relativeY * 1000).toFixed(0)}μm`;
                    } else {
                        const precision = majorStep < 0.1 ? 3 : majorStep < 1 ? 2 : 1;
                        label = relativeY.toFixed(precision);
                    }
                    this.ctx.fillText(label, tickLength + 2, yCanvas);
                }
            }
            this.ctx.stroke();
            
            // Corner box
            this.ctx.fillStyle = colors.background;
            this.ctx.fillRect(0, 0, rulerSize, rulerSize);
            this.ctx.strokeRect(0, 0, rulerSize, rulerSize);
            
            this.ctx.restore();
        }
        
        renderScaleIndicator() {
            this.ctx.save();
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const colors = theme.canvas;
            const padding = 10;
            const barHeight = 4;
            const y = this.canvas.height - padding - 20;
            
            const targetPixels = 100;
            const worldLength = targetPixels / this.core.viewScale;
            
            const possibleLengths = gridConfig.steps || [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
            const niceLength = possibleLengths.find(len => len * this.core.viewScale >= 50) || 1;
            const barWidth = niceLength * this.core.viewScale;
            
            const x = this.canvas.width - padding - barWidth;
            
            // Background
            this.ctx.fillStyle = colors.background;
            this.ctx.globalAlpha = 0.8;
            this.ctx.fillRect(x - 5, y - 20, barWidth + 10, 30);
            this.ctx.globalAlpha = 1;
            
            // Scale bar
            this.ctx.fillStyle = colors.rulerText;
            this.ctx.fillRect(x, y, barWidth, barHeight);
            
            // End caps
            this.ctx.fillRect(x, y - 2, 1, barHeight + 4);
            this.ctx.fillRect(x + barWidth - 1, y - 2, 1, barHeight + 4);
            
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
        
        renderStats() {
            if (!this.core.options.showStats) return;
            
            this.ctx.save();
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const colors = theme.canvas;
            const stats = this.core.renderStats;
            
            const x = 10;
            let y = 50;
            const lineHeight = 16;
            
            // Background
            this.ctx.fillStyle = colors.background;
            this.ctx.globalAlpha = 0.8;
            this.ctx.fillRect(x - 5, y - 15, 200, 100);
            this.ctx.globalAlpha = 1;
            
            // Text
            this.ctx.fillStyle = colors.rulerText;
            this.ctx.font = '12px monospace';
            this.ctx.textAlign = 'left';
            this.ctx.textBaseline = 'top';
            
            this.ctx.fillText(`Primitives: ${stats.renderedPrimitives}/${stats.primitives}`, x, y);
            y += lineHeight;
            
            if (stats.holesRendered > 0) {
                this.ctx.fillText(`Holes: ${stats.holesRendered}`, x, y);
                y += lineHeight;
            }
            
            this.ctx.fillText(`Render: ${stats.renderTime.toFixed(1)}ms`, x, y);
            y += lineHeight;
            
            this.ctx.fillText(`Zoom: ${this.core.viewScale.toFixed(2)}x`, x, y);
            
            this.ctx.restore();
        }
        
        calculateGridSpacing() {
            const minPixelSize = gridConfig.minPixelSpacing || 40;
            const possibleSteps = gridConfig.steps || [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
            return possibleSteps.find(step => step * this.core.viewScale >= minPixelSize) || 100;
        }
        
        calculateRulerStep() {
            const minPixelDistance = 50;
            const possibleSteps = gridConfig.steps || [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
            return possibleSteps.find(step => step * this.core.viewScale >= minPixelDistance) || 100;
        }
    }
    
    // Export
    window.OverlayRenderer = OverlayRenderer;
    
})();