/**
 * @file        renderer/renderer-overlay.js
 * @description Handles grid, rulers, origin, scale indicator, and other UI overlays
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
    const gridConfig = config.rendering.grid;
    const overlayConfig = config.renderer.overlay;
    const debugConfig = config.debug;

    class OverlayRenderer {
        constructor(core) {
            this.core = core;
            this.ctx = core.ctx;
            this.canvas = core.canvas;
        }

        // Grid

        renderGrid() {
            if (!this.core.options.showGrid) return;

            const colors = this.core.colors.canvas;
            if (!colors) return;

            // Use cached scale for calculations
            const fc = this.core.frameCache;
            const step = this._calculateStepSize();
            if (step <= 0) return;

            const view = this.core.getViewBounds();
            const origin = this.core.getOriginPosition();

            this.ctx.save();

            this.ctx.strokeStyle = colors.grid;

            this.ctx.lineWidth = fc.invScale; 

            this.ctx.setLineDash([]);

            this.ctx.globalAlpha = 0.20;

            this.ctx.beginPath();

            const startX = Math.floor((view.minX - origin.x) / step) * step + origin.x;
            for (let x = startX; x <= view.maxX; x += step) {
                this.ctx.moveTo(x, view.minY);
                this.ctx.lineTo(x, view.maxY);
            }

            const startY = Math.floor((view.minY - origin.y) / step) * step + origin.y;
            for (let y = startY; y <= view.maxY; y += step) {
                this.ctx.moveTo(view.minX, y);
                this.ctx.lineTo(view.maxX, y);
            }

            this.ctx.stroke();
            this.ctx.restore();
        }

        // Origin

        renderOrigin() {
            if (!this.core.options.showOrigin) return;

            const colors = this.core.colors.canvas;
            if (!colors) return;

            const fc = this.core.frameCache; // Use Cache

            // Scale sizes by inverse scale
            const markerSize = (config.rendering.canvas.originMarkerSize) * fc.invScale;
            const circleSize = (config.rendering.canvas.originCircleSize) * fc.invScale;
            const strokeWidth = (config.renderer.overlay.originStrokeWidth) * fc.invScale;

            // Outline is fixed width + stroke width
            const outlineWidth = (config.renderer.overlay.originOutlineWidth) * fc.invScale;

            const originX = this.core.originPosition?.x || 0;
            const originY = this.core.originPosition?.y || 0;

            // Draw Outline (Contrast)
            this.ctx.strokeStyle = colors.originOutline;
            this.ctx.lineWidth = strokeWidth + outlineWidth;

            this.ctx.beginPath();
            this.ctx.moveTo(originX - markerSize, originY);
            this.ctx.lineTo(originX + markerSize, originY);
            this.ctx.moveTo(originX, originY - markerSize);
            this.ctx.lineTo(originX, originY + markerSize);
            this.ctx.stroke();

            this.ctx.beginPath();
            this.ctx.arc(originX, originY, circleSize, 0, 2 * Math.PI);
            this.ctx.stroke();

            // Draw Main Marker
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

        // Bounds

        renderBounds() {
            if (!this.core.options.showBounds || !this.core.overallBounds) return;

            const colors = this.core.colors.canvas;
            if (!colors) return;

            const bounds = this.core.overallBounds;
            const fc = this.core.frameCache; 

            this.ctx.strokeStyle = colors.bounds;
            this.ctx.lineWidth = overlayConfig.boundsLineWidth * fc.invScale;

            const dash = overlayConfig.boundsDash;
            this.ctx.setLineDash([dash[0] * fc.invScale, dash[1] * fc.invScale]);

            this.ctx.strokeRect(
                bounds.minX,
                bounds.minY,
                bounds.width,
                bounds.height
            );

            // Corner markers
            const markerSize = overlayConfig.boundsMarkerSize * fc.invScale;
            this.ctx.setLineDash([]);
            this.ctx.lineWidth = overlayConfig.boundsMarkerWidth * fc.invScale;

            this.ctx.beginPath();
            // Top-Left
            this.ctx.moveTo(bounds.minX, bounds.minY + markerSize);
            this.ctx.lineTo(bounds.minX, bounds.minY);
            this.ctx.lineTo(bounds.minX + markerSize, bounds.minY);
            this.ctx.stroke();

            // Bottom-Right
            this.ctx.beginPath();
            this.ctx.moveTo(bounds.maxX - markerSize, bounds.maxY);
            this.ctx.lineTo(bounds.maxX, bounds.maxY);
            this.ctx.lineTo(bounds.maxX, bounds.maxY - markerSize);
            this.ctx.stroke();
        }

        // Rulers

        renderRulers() {
            if (!this.core.options.showRulers) return;

            // Use Core to reset transform (Screen Space)
            this.core.resetTransform();

            const colors = this.core.colors.canvas;
            if (!colors) return;

            // Config & Setup
            const conf = this.core.options; // Just access core options directly if needed, or keep config closure
            // Re-accessing config via global scope is fine if 'overlayConfig' is available in closure

            this.ctx.lineWidth = 1; // Standard hairline
            this.ctx.font = '10px sans-serif'; // Or config.rulerFont
            this.ctx.textBaseline = 'top';
            this.ctx.textAlign = 'center';

            const rulerSize = 20; // Or config.rulerSize
            const tickLen = 5;

            // Draw Backgrounds (Fast fill)
            const rulerAlpha = 'CC'; // Hex alpha (80%)
            this.ctx.fillStyle = colors.background + rulerAlpha;
            this.ctx.fillRect(0, 0, this.canvas.width, rulerSize);
            this.ctx.fillRect(0, 0, rulerSize, this.canvas.height);

            // Setup Lines
            this.ctx.strokeStyle = colors.ruler;
            this.ctx.fillStyle = colors.rulerText;
            this.ctx.beginPath();
            this.ctx.moveTo(rulerSize, rulerSize);
            this.ctx.lineTo(this.canvas.width, rulerSize); // Horizontal Line
            this.ctx.moveTo(rulerSize, rulerSize);
            this.ctx.lineTo(rulerSize, this.canvas.height); // Vertical Line
            this.ctx.stroke();

            // Draw Ticks - Horizontal
            // Calculate step based on ViewScale to ensure readable density
            const stepWorld = this._calculateStepSize(); // Reuses existing helper
            const view = this.core.getViewBounds();
            const origin = this.core.getOriginPosition();

            // Snap start to nearest step
            const startX = Math.floor(view.minX / stepWorld) * stepWorld;

            this.ctx.beginPath(); // Batch ticks

            // Safety break to prevent infinite loops if step is 0
            if (stepWorld <= 0) return;

            for (let wx = startX; wx < view.maxX; wx += stepWorld) {
                const cx = this.core.worldToCanvasX(wx);

                // Cull off-screen ticks
                if (cx < rulerSize || cx > this.canvas.width) continue;

                this.ctx.moveTo(cx, rulerSize);
                this.ctx.lineTo(cx, rulerSize - tickLen);

                // Draw Text (Immediate)
                const labelVal = wx - origin.x;
                // Format text only if visible
                const label = Math.abs(labelVal) < 0.001 ? "0" : 
                            (stepWorld < 1 ? labelVal.toFixed(2) : labelVal.toFixed(0));

                this.ctx.fillText(label, cx, 2);
            }
            this.ctx.stroke();

            // Draw Ticks - Vertical
            const startY = Math.floor(view.minY / stepWorld) * stepWorld;

            this.ctx.beginPath();

            // Vertical Text Setup
            this.ctx.textAlign = 'right';
            this.ctx.textBaseline = 'middle';

            for (let wy = startY; wy < view.maxY; wy += stepWorld) {
                const cy = this.core.worldToCanvasY(wy);

                if (cy < rulerSize || cy > this.canvas.height) continue;

                this.ctx.moveTo(rulerSize, cy);
                this.ctx.lineTo(rulerSize - tickLen, cy);

                const labelVal = wy - origin.y;
                const label = Math.abs(labelVal) < 0.001 ? "0" : 
                            (stepWorld < 1 ? labelVal.toFixed(2) : labelVal.toFixed(0));

                // Draw text immediately (no rotation for speed, simple right-align)
                this.ctx.fillText(label, rulerSize - tickLen - 2, cy);
            }
            this.ctx.stroke();

            // 5. Corner Box
            this.ctx.fillStyle = colors.background;
            this.ctx.fillRect(0, 0, rulerSize, rulerSize);
            this.ctx.strokeRect(0, 0, rulerSize, rulerSize);

            // Unit Label
            this.ctx.fillStyle = colors.rulerText;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText("mm", rulerSize/2, rulerSize/2);
        }

        // Scale Indicator

        renderScaleIndicator() {
            if (!this.core.options.showRulers) return;

            this.ctx.save();
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);

            const colors = this.core.colors.canvas;
            if (!colors) {
                this.ctx.restore();
                return;
            }

            const padding = overlayConfig.scaleIndicatorPadding;
            const barHeight = overlayConfig.scaleIndicatorBarHeight;
            const y = this.canvas.height - padding - overlayConfig.scaleIndicatorYOffset;

            const possibleLengths = gridConfig.steps;
            const minPixels = overlayConfig.scaleIndicatorMinPixels;
            const niceLength = possibleLengths.find(len => len * this.core.viewScale >= minPixels);
            const barWidth = niceLength * this.core.viewScale;

            const x = this.canvas.width - padding - barWidth;

            // Background
            this.ctx.fillStyle = colors.background;
            this.ctx.fillRect(x - 5, y - 15, barWidth + 10, 35);

            // Scale bar
            this.ctx.fillStyle = colors.rulerText;
            this.ctx.fillRect(x, y, barWidth, barHeight);

            // End caps
            const capWidth = overlayConfig.scaleIndicatorEndCapWidth;
            const capHeight = overlayConfig.scaleIndicatorEndCapHeight;
            this.ctx.fillRect(x, y - (capHeight/2), capWidth, barHeight + capHeight);
            this.ctx.fillRect(x + barWidth - capWidth, y - (capHeight/2), capWidth, barHeight + capHeight);

            // Label
            this.ctx.font = overlayConfig.scaleIndicatorFont;
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

        // Statistics

        renderStats() {
            if (!this.core.options.showStats || !this.core.renderStats) return;

            this.ctx.save();
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);

            const colors = this.core.colors.canvas;
            if (!colors) {
                this.ctx.restore();
                return;
            }

            const stats = this.core.renderStats;

            const x = overlayConfig.statsX;
            let y = overlayConfig.statsY;
            const lineHeight = overlayConfig.statsLineHeight;

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
            this.ctx.fillRect(x - 5, y - 15, overlayConfig.statsBGWidth, bgHeight);

            // Text
            this.ctx.fillStyle = colors.rulerText;
            this.ctx.font = overlayConfig.statsFont || '12px monospace';
            this.ctx.textAlign = 'left';
            this.ctx.textBaseline = 'top';

            lines.forEach(line => {
                this.ctx.fillText(line, x, y);
                y += lineHeight;
            });

            this.ctx.restore();
        }

        // Helper Methods

        _calculateStepSize() {
            const minPixelSize = gridConfig.minPixelSpacing;
            const possibleSteps = gridConfig.steps;

            for (const step of possibleSteps) {
                if (step * this.core.viewScale >= minPixelSize) {
                    return step;
                }
            }
            return possibleSteps[possibleSteps.length - 1];
        }

        debug(message, data = null) {
            if (debugConfig.enabled) {
                if (data) {
                    console.log(`[Primitives] ${message}`, data);
                } else {
                    console.log(`[Primitives] ${message}`);
                }
            }
        }
    }

    window.OverlayRenderer = OverlayRenderer;
})();