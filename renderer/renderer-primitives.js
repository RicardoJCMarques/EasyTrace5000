/**
 * @file        renderer/renderer-primitives.js
 * @description Dedicated geometry object renderer
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
    const debugConfig = config.debug || {};
    
    class PrimitiveRenderer {
        constructor(core) {
            this.core = core;
            this.ctx = core.ctx;

            // Debug statistics
            this.debugStats = {
                totalPoints: 0,
                taggedPoints: 0,
                curvePoints: new Map()
            };
        }

        
        // ==================== MAIN DISPATCHER ====================
        
        renderPrimitive(primitive, fillColor, strokeColor, isPreprocessed = false, context = {}) {
            const role = primitive.properties?.role;

            // === ROLE-BASED DISPATCH ===
            if (role) {
                switch (role) {
                    case 'drill_hole':
                    case 'drill_slot':
                        // Source drill geometry
                        this.renderSourceDrill(primitive, fillColor, strokeColor);
                        return;
                        
                    case 'peck_mark':
                        // Strategy layer peck marks
                        this.renderPeckMark(primitive, fillColor, strokeColor, context);
                        return;
                        
                    case 'drill_milling_path':
                        // Strategy layer milling paths (reuse offset renderer)
                        this.renderOffsetPrimitive(primitive, strokeColor || fillColor, context);
                        return;
                }
            }
            
            if (context.isPreview || primitive.properties?.isPreview) {
                this.renderToolPreview(primitive, fillColor || strokeColor, context);
                return;
            }
            
            if (context.isOffset || primitive.properties?.isOffset) {
                this.renderOffsetPrimitive(primitive, strokeColor || fillColor, context);
                return;
            }
            
            if (primitive.properties?.reconstructed) {
                this.renderReconstructedPrimitive(primitive, fillColor, strokeColor);
                return;
            }
            
            if (this.core.options.showWireframe) {
                this.renderWireframe(primitive);
                return;
            }
            
            this.renderPrimitiveNormal(primitive, fillColor, strokeColor, isPreprocessed);
        }
        
        // ==================== BATCHED RENDERING ====================
        
        addPrimitiveToPath2D(primitive, path2d) {
            switch (primitive.type) {
                case 'path':
                    // This now handles simple paths AND complex paths with analytic arcs.
                    this.addPathToPath2D(primitive, path2d);
                    break;
                    
                case 'circle':
                    // Path2D.arc needs a starting point.
                    path2d.moveTo(primitive.center.x + primitive.radius, primitive.center.y);
                    path2d.arc(
                        primitive.center.x, 
                        primitive.center.y, 
                        primitive.radius, 
                        0, 
                        Math.PI * 2
                    );
                    break;
                    
                case 'rectangle':
                    path2d.rect(
                        primitive.position.x,
                        primitive.position.y,
                        primitive.width,
                        primitive.height
                    );
                    break;
                    
                case 'obround':
                    this.addObroundToBatch(primitive, path2d);
                    break;
                    
                case 'arc':
                    // Note: A standalone ArcPrimitive is rare in offset layers, but we handle it.
                    path2d.arc(
                        primitive.center.x,
                        primitive.center.y,
                        primitive.radius,
                        primitive.startAngle,
                        primitive.endAngle,
                        !primitive.clockwise // API expects 'anticlockwise'
                    );
                    break;
            }
        }

        addPathToPath2D(primitive, path2d) {
            // If the primitive has no points, there's nothing to do.
            const points = primitive.points;
            if (!points || points.length === 0) return;

            // If there are no arc segments do a simple, fast line loop.
            if (!primitive.arcSegments || primitive.arcSegments.length === 0) {
                path2d.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) {
                    path2d.lineTo(points[i].x, points[i].y);
                }
                if (primitive.closed !== false) {
                    path2d.closePath();
                }
                return;
            }

            // --- HYBRID PATH LOGIC ---
            // If we are here, it's a path with analytic arc data.
            const segments = primitive.arcSegments.slice().sort((a, b) => a.startIndex - b.startIndex);
            let currentIndex = 0;

            path2d.moveTo(points[0].x, points[0].y);
            
            // Process segments in order
            for (const arc of segments) {
                // Draw straight lines up to the start of this arc segment.
                for (let i = currentIndex; i < arc.startIndex; i++) {
                    if (points[i+1]) { // Ensure the next point exists
                        path2d.lineTo(points[i+1].x, points[i+1].y);
                    }
                }
                
                // Add the analytic arc to the Path2D object.
                path2d.arc(
                    arc.center.x, arc.center.y, arc.radius,
                    arc.startAngle, arc.endAngle, arc.clockwise
                );
                
                // Jump our current position past all the interpolated points that the arc replaced.
                currentIndex = arc.endIndex;
            }
            
            // Draw any remaining straight line segments after the last arc.
            for (let i = currentIndex; i < points.length - 1; i++) {
                path2d.lineTo(points[i+1].x, points[i+1].y);
            }

            if (primitive.closed !== false) {
                path2d.closePath();
            }
        }

        
        addObroundToBatch(primitive, path2d) {
            const x = primitive.position.x;
            const y = primitive.position.y;
            const w = primitive.width;
            const h = primitive.height;
            const r = Math.min(w, h) / 2;
            
            if (w > h) {
                path2d.moveTo(x + r, y);
                path2d.lineTo(x + w - r, y);
                path2d.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
                path2d.lineTo(x + r, y + h);
                path2d.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
            } else {
                path2d.moveTo(x + w, y + r);
                path2d.lineTo(x + w, y + h - r);
                path2d.arc(x + r, y + h - r, r, 0, Math.PI);
                path2d.lineTo(x, y + r);
                path2d.arc(x + r, y + r, r, Math.PI, 0);
            }
            path2d.closePath();
        }
        
        // ==================== SPECIALIZED RENDERERS ====================

        _setStrokeState(color, width) {
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = width;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
            this.ctx.setLineDash([]);
        }

        
        renderToolPreview(primitive, color, context) {
            this.ctx.save();
            
            // Drill previews are filled, not stroked
            if (primitive.properties?.role === 'peck_mark') {
                this.renderPeckMark(primitive, color, color, context);
                this.ctx.restore();
                return;
            }
            
            // Milling previews use tool diameter stroke
            const toolDiameter = context.toolDiameter || 
                                context.layer?.metadata?.toolDiameter || 
                                primitive.properties?.toolDiameter || 0.2;
            
            this._setStrokeState(color, toolDiameter);
            
            if (primitive.type === 'path') {
                this.ctx.beginPath();
                if (primitive.points) {
                    primitive.points.forEach((p, i) => {
                        if (i === 0) this.ctx.moveTo(p.x, p.y);
                        else this.ctx.lineTo(p.x, p.y);
                    });
                    if (primitive.closed !== false) this.ctx.closePath();
                }
                this.ctx.stroke();
            } else if (primitive.type === 'circle') {
                this.ctx.beginPath();
                this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, Math.PI * 2);
                this.ctx.stroke();
            }
            
            this.ctx.restore();
        }
        
        renderOffsetPrimitive(primitive, color, context) {
            // Check if this is a drill peck mark
            if (primitive.properties?.isToolPeckMark) {
                this.renderDrillPeckMark(primitive, color, color, context);
                return;
            }
            
            const offsetDistance = context.distance || primitive.properties?.offsetDistance || 0;
            const isInternal = offsetDistance < 0;
            this._setStrokeState(isInternal ? '#00aa00' : color || '#ff0000', 2 / this.core.viewScale);
            this.ctx.setLineDash([]);
            
            if (primitive.type === 'path') {
                this.ctx.beginPath();
                if (primitive.contours && primitive.contours.length > 0) {
                    primitive.contours.forEach(contour => {
                        if (!contour.points || contour.points.length < 2) return;
                        contour.points.forEach((p, i) => {
                            if (i === 0) this.ctx.moveTo(p.x, p.y);
                            else this.ctx.lineTo(p.x, p.y);
                        });
                        this.ctx.closePath();
                    });
                } else if (primitive.points) {
                    primitive.points.forEach((p, i) => {
                        if (i === 0) this.ctx.moveTo(p.x, p.y);
                        else this.ctx.lineTo(p.x, p.y);
                    });
                    if (primitive.closed !== false) this.ctx.closePath();
                }
                this.ctx.stroke();
            } else if (primitive.type === 'circle') {
                this.ctx.beginPath();
                this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, Math.PI * 2);
                this.ctx.stroke();
            } else if (primitive.type === 'arc') {
                this.ctx.beginPath();
                this.ctx.arc(
                    primitive.center.x, primitive.center.y, primitive.radius,
                    primitive.startAngle, primitive.endAngle, 
                    primitive.counterclockwise || primitive.clockwise
                );
                this.ctx.stroke();
            }
            
            this.ctx.restore();
        }

        _renderCenterMarks(center, markSize, color) {
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 3 / this.core.viewScale;
            this.ctx.beginPath();
            this.ctx.moveTo(center.x - markSize, center.y);
            this.ctx.lineTo(center.x + markSize, center.y);
            this.ctx.moveTo(center.x, center.y - markSize);
            this.ctx.lineTo(center.x, center.y + markSize);
            this.ctx.stroke();
        }
        
        /**
         * Renders source drill geometry (holes and slots from parser)
         */
        renderSourceDrill(primitive, fillColor, strokeColor) {
            const color = strokeColor || fillColor || '#4488ff';
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 3 / this.core.viewScale;
            
            if (primitive.properties.role === 'drill_hole') {
                const r = primitive.radius;
                
                // Draw circle outline
                this.ctx.beginPath();
                this.ctx.arc(primitive.center.x, primitive.center.y, r, 0, Math.PI * 2);
                this.ctx.stroke();
                
                // Draw center crosshair
                const markSize = Math.min(0.2, r * 0.4);
                this._renderCenterMarks(primitive.center, markSize, color);
                
            } else if (primitive.properties.role === 'drill_slot') {
                const slot = primitive.properties.originalSlot;
                const r = primitive.properties.diameter / 2;
                
                // Draw slot outline (obround shape)
                const x = primitive.position.x;
                const y = primitive.position.y;
                const w = primitive.width;
                const h = primitive.height;
                
                this.ctx.beginPath();
                if (w > h) {
                    // Horizontal slot
                    this.ctx.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2, false);
                    this.ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2, false);
                } else {
                    // Vertical slot
                    this.ctx.arc(x + r, y + r, r, Math.PI, 0, false);
                    this.ctx.arc(x + r, y + h - r, r, 0, Math.PI, false);
                }
                this.ctx.closePath();
                this.ctx.stroke();
                
                // Draw crosshairs at both ends
                const markSize = Math.min(0.2, r * 0.4);
                this._renderCenterMarks(slot.start, markSize, color);
                this._renderCenterMarks(slot.end, markSize, color);
            }
        }

        /**
         * Renders peck mark previews (strategy layer)
         */
        renderPeckMark(primitive, fillColor, strokeColor, context) {
            const center = primitive.center;
            const radius = primitive.radius;
            const oversized = primitive.properties?.oversized || false;
            const undersized = primitive.properties?.undersized || false;
            const reducedPlunge = primitive.properties?.reducedPlunge || false;
            const isPreview = context?.isPreview || primitive.properties?.isPreview || false;
            
            // Color priority: oversized > undersized > reducedPlunge > perfect fit
            let markColor = '#16d329ff'; // Green means tool diameter = drill hole size
            if (oversized) markColor = '#ff0000';  // Red oversized warning (should be overwrite all others)
            else if (undersized) markColor = '#d2cb00ff';  // Yellow undersized warning
            else if (reducedPlunge) markColor = '#ff5e00ff';  // Dark orange reduced plunge rate warning
            
            // === OFFSET STAGE: Outline + center (like source drill) ===
            if (!isPreview) {
                // Just outline
                this.ctx.strokeStyle = markColor;
                this.ctx.lineWidth = 3 / this.core.viewScale;
                this.ctx.beginPath();
                this.ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
                this.ctx.stroke();
                
                // Center crosshair
                const markSize = Math.min(0.2, radius * 0.4);
                this._renderCenterMarks(center, markSize, markColor);
                
                // Reduced plunge indicator (dashed ring AROUND the mark)
                if (reducedPlunge) {
                    this.ctx.save();
                    this.ctx.strokeStyle = '#ff5e00ff';
                    this.ctx.lineWidth = 3 / this.core.viewScale;
                    this.ctx.setLineDash([0.15, 0.15]);
                    this.ctx.beginPath();
                    this.ctx.arc(center.x, center.y, radius * 1.3, 0, Math.PI * 2);
                    this.ctx.stroke();
                    this.ctx.restore();
                }
                
                return;
            }
            
            // === PREVIEW STAGE: Filled circles ===
            // Semi-transparent fill
            this.ctx.fillStyle = markColor;
            this.ctx.beginPath();
            this.ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Solid outline
            this.ctx.strokeStyle = markColor;
            this.ctx.lineWidth = 3 / this.core.viewScale;
            this.ctx.stroke();
            
            // Center crosshair
            const markSize = Math.min(0.2, radius * 0.4);
            this._renderCenterMarks(center, markSize, markColor);
            
            // Warning indicators (only in preview)
            if (oversized) {
                this.ctx.save();
                this.ctx.font = `${Math.max(0.3, radius * 0.5)}px monospace`;
                this.ctx.fillStyle = '#ff0000';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText('!', center.x, center.y + radius + 0.3);
                this.ctx.restore();
            }
            
            if (reducedPlunge) {
                this.ctx.save();
                this.ctx.strokeStyle = '#ff5e00ff';
                this.ctx.lineWidth = 3 / this.core.viewScale;
                this.ctx.setLineDash([0.15, 0.15]);
                this.ctx.beginPath();
                this.ctx.arc(center.x, center.y, radius * 1.3, 0, Math.PI * 2);
                this.ctx.stroke();
                this.ctx.restore();
            }
        }

        
        renderReconstructedPrimitive(primitive, fillColor, strokeColor) {
            // Reconstructed primitives get a special highlight color
            const accentColor = '#00ffff';
            
            this.ctx.save();
            
            if (primitive.type === 'circle') {
                this.ctx.strokeStyle = accentColor;
                this.ctx.lineWidth = 2 / this.core.viewScale;
                this.ctx.fillStyle = fillColor + '40'; // Semi-transparent fill
                
                this.ctx.beginPath();
                this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, 2 * Math.PI);
                this.ctx.fill();
                this.ctx.stroke();
                
                // Center dot
                this.ctx.fillStyle = accentColor;
                this.ctx.beginPath();
                this.ctx.arc(primitive.center.x, primitive.center.y, 2 / this.core.viewScale, 0, 2 * Math.PI);
                this.ctx.fill();
            } else if (primitive.type === 'arc') {
                this.ctx.strokeStyle = accentColor;
                this.ctx.lineWidth = 2 / this.core.viewScale;
                
                this.ctx.beginPath();
                this.ctx.arc(
                    primitive.center.x, primitive.center.y, primitive.radius,
                    primitive.startAngle, primitive.endAngle,
                    primitive.counterclockwise || primitive.clockwise
                );
                this.ctx.stroke();
            } else if (primitive.type === 'path') {
                // Partially reconstructed path
                this.ctx.strokeStyle = '#ffff00';
                this.ctx.lineWidth = 2 / this.core.viewScale;
                this.ctx.setLineDash([5 / this.core.viewScale, 5 / this.core.viewScale]);
                
                this.renderPrimitiveNormal(primitive, fillColor + '40', '#ffff00', false);
            }
            
            this.ctx.restore();
        }
        
        // ==================== NORMAL RENDERING ====================
        
        renderPrimitiveNormal(primitive, fillColor, strokeColor, isPreprocessed) {
            const props = primitive.properties || {};
            
            switch (primitive.type) {
                case 'path':
                    this.renderPath(primitive, fillColor, strokeColor, isPreprocessed);
                    break;
                    
                case 'circle':
                    this.renderCircle(primitive, fillColor, strokeColor);
                    break;
                    
                case 'rectangle':
                    this.renderRectangle(primitive, fillColor, strokeColor);
                    break;
                    
                case 'arc':
                    this.renderArc(primitive, fillColor, strokeColor);
                    break;
                    
                case 'obround':
                    this.renderObround(primitive, fillColor, strokeColor);
                    break;
                    
                default:
                    console.warn(`Unknown primitive type: ${primitive.type}`);
                    break;
            }
        }
        
        renderPath(primitive, fillColor, strokeColor, isPreprocessed) {
            const shouldFill = primitive.properties?.fill !== false && !primitive.properties?.stroke;
            const shouldStroke = primitive.properties?.stroke === true || primitive.properties?.isTrace;
            
            this.ctx.beginPath();
            
            if (primitive.contours && primitive.contours.length > 0) {
                primitive.contours.forEach(contour => {
                    if (!contour.points || contour.points.length === 0) return;
                    
                    contour.points.forEach((p, i) => {
                        if (i === 0) this.ctx.moveTo(p.x, p.y);
                        else this.ctx.lineTo(p.x, p.y);
                    });
                    
                    this.ctx.closePath();
                });
                
                if (shouldFill) {
                    this.ctx.fillStyle = fillColor;
                    this.ctx.fill('nonzero');
                }
            } else if (primitive.points && primitive.points.length > 0) {
                primitive.points.forEach((p, i) => {
                    if (i === 0) this.ctx.moveTo(p.x, p.y);
                    else this.ctx.lineTo(p.x, p.y);
                });
                
                if (primitive.closed !== false) {
                    this.ctx.closePath();
                }
                
                if (shouldFill) {
                    this.ctx.fillStyle = fillColor;
                    this.ctx.fill();
                }
            }
            
            if (shouldStroke) {
                this.ctx.strokeStyle = strokeColor || fillColor;
                this.ctx.lineWidth = primitive.properties?.strokeWidth || 0.1;
                this.ctx.lineCap = 'round';
                this.ctx.lineJoin = 'round';
                this.ctx.stroke();
            }
        }
        
        renderCircle(primitive, fillColor, strokeColor) {
            this.ctx.beginPath();
            this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, Math.PI * 2);
            
            if (primitive.properties?.fill !== false) {
                this.ctx.fillStyle = fillColor;
                this.ctx.fill();
            }
            
            if (primitive.properties?.stroke || strokeColor) {
                this.ctx.strokeStyle = strokeColor || fillColor;
                this.ctx.lineWidth = primitive.properties?.strokeWidth || this.core.getWireframeStrokeWidth();
                this.ctx.stroke();
            }
        }
        
        renderRectangle(primitive, fillColor, strokeColor) {
            if (primitive.properties?.fill !== false) {
                this.ctx.fillStyle = fillColor;
                this.ctx.fillRect(primitive.position.x, primitive.position.y, primitive.width, primitive.height);
            }
            
            if (primitive.properties?.stroke || strokeColor) {
                this.ctx.strokeStyle = strokeColor || fillColor;
                this.ctx.lineWidth = primitive.properties?.strokeWidth || this.core.getWireframeStrokeWidth();
                this.ctx.strokeRect(primitive.position.x, primitive.position.y, primitive.width, primitive.height);
            }
        }
        
        renderArc(primitive, fillColor, strokeColor) {
            this.ctx.beginPath();
            this.ctx.arc(
                primitive.center.x,
                primitive.center.y,
                primitive.radius,
                primitive.startAngle,
                primitive.endAngle,
                primitive.counterclockwise || primitive.clockwise
            );
            
            if (primitive.properties?.fill) {
                this.ctx.closePath();
                this.ctx.fillStyle = fillColor;
                this.ctx.fill();
            }
            
            this.ctx.strokeStyle = strokeColor || fillColor;
            this.ctx.lineWidth = primitive.properties?.strokeWidth || 0.1;
            this.ctx.stroke();
        }
        
        renderObround(primitive, fillColor, strokeColor) {
            const x = primitive.position.x;
            const y = primitive.position.y;
            const w = primitive.width;
            const h = primitive.height;
            const r = Math.min(w, h) / 2;
            
            this.ctx.beginPath();
            
            if (w > h) {
                this.ctx.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2, false);
                this.ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2, false);
            } else {
                this.ctx.arc(x + r, y + r, r, Math.PI, 0, false);
                this.ctx.arc(x + r, y + h - r, r, 0, Math.PI, false);
            }
            
            this.ctx.closePath();
            
            if (primitive.properties?.fill !== false) {
                this.ctx.fillStyle = fillColor;
                this.ctx.fill();
            }
            
            if (primitive.properties?.stroke || strokeColor) {
                this.ctx.strokeStyle = strokeColor || fillColor;
                this.ctx.lineWidth = primitive.properties?.strokeWidth || this.core.getWireframeStrokeWidth();
                this.ctx.stroke();
            }
        }
        
        // ==================== WIREFRAME RENDERING ====================
        
        renderWireframe(primitive) {
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const strokeWidth = this.core.getWireframeStrokeWidth();
            
            this.ctx.strokeStyle = theme.debug?.wireframe || '#00ff00';
            this.ctx.lineWidth = strokeWidth;
            this.ctx.fillStyle = 'none';
            
            this.ctx.beginPath();
            
            switch (primitive.type) {
                case 'path':
                    if (primitive.contours && primitive.contours.length > 0) {
                        primitive.contours.forEach(contour => {
                            if (!contour.points || contour.points.length === 0) return;
                            contour.points.forEach((p, i) => {
                                if (i === 0) this.ctx.moveTo(p.x, p.y);
                                else this.ctx.lineTo(p.x, p.y);
                            });
                            this.ctx.closePath();
                        });
                    } else if (primitive.points) {
                        primitive.points.forEach((p, i) => {
                            if (i === 0) this.ctx.moveTo(p.x, p.y);
                            else this.ctx.lineTo(p.x, p.y);
                        });
                        if (primitive.closed !== false) this.ctx.closePath();
                    }
                    break;
                    
                case 'circle':
                    this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, Math.PI * 2);
                    break;
                    
                case 'rectangle':
                    this.ctx.rect(primitive.position.x, primitive.position.y, primitive.width, primitive.height);
                    break;
                    
                case 'arc':
                    this.ctx.arc(
                        primitive.center.x, primitive.center.y, primitive.radius,
                        primitive.startAngle, primitive.endAngle,
                        primitive.counterclockwise || primitive.clockwise
                    );
                    break;
            }
            
            this.ctx.stroke();
        }
        
        // ==================== DEBUG RENDERING ====================
        
        renderDebugInfo(primitive, options) {
            if (!primitive) return;
            
            // This is called after resetTransform, so we're in screen space
            
            if (options.debugPaths && primitive.arcSegments) {
                this.renderArcSegmentDebug(primitive);
            }
            
            if (options.debugPoints && primitive.points) {
                this.renderCurveDebugPoints(primitive);
            }
            
            if (options.debugPaths && primitive.contours) {
                this.renderContourDebug(primitive);
            }
        }
        
        renderCurveDebugPoints(primitive) {
            if (!primitive.screenPoints) return; // Changed from primitive.points
            
            const pointSize = 4;
            this.ctx.font = '10px monospace';
            
            primitive.screenPoints.forEach((p, index) => {
                if (p.curveId === undefined) return;
                
                const color = this.getCurveDebugColor(p.curveId);
                
                // p.x and p.y are ALREADY in screen space
                this.ctx.fillStyle = color;
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, pointSize, 0, Math.PI * 2);
                this.ctx.fill();
                
                // Labels
                this.ctx.fillStyle = '#FFFFFF';
                this.ctx.strokeStyle = '#000000';
                this.ctx.lineWidth = 2;
                const label = `C${p.curveId}:${p.segmentIndex || index}`;
                this.ctx.strokeText(label, p.x + 6, p.y - 6);
                this.ctx.fillText(label, p.x + 6, p.y - 6);
                
                this.debugStats.taggedPoints++;
            });
            
            this.debugStats.totalPoints += primitive.screenPoints.length;
        }
        
        renderArcSegmentDebug(primitive) {
            if (!primitive.arcSegments || primitive.arcSegments.length === 0) return;
            
            primitive.arcSegments.forEach((segment, idx) => {
                // Use pre-transformed values
                const centerScreen = segment.centerScreen;
                const radiusScreen = segment.radiusScreen;
                
                const hue = ((idx * 137) + 60) % 360;
                const color = `hsl(${hue}, 100%, 50%)`;
                
                // Draw arc - centerScreen and radiusScreen already in screen coords
                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = 3;
                this.ctx.beginPath();
                const startAngle = -segment.startAngle;
                const endAngle = -segment.endAngle;
                this.ctx.arc(centerScreen.x, centerScreen.y, radiusScreen, 
                            endAngle, startAngle, segment.clockwise);
                this.ctx.stroke();
                
                // Draw center point
                this.ctx.fillStyle = color;
                this.ctx.beginPath();
                this.ctx.arc(centerScreen.x, centerScreen.y, 4, 0, 2 * Math.PI);
                this.ctx.fill();
                
                // Draw label
                this.ctx.fillStyle = '#FFFFFF';
                this.ctx.strokeStyle = '#000000';
                this.ctx.lineWidth = 2;
                this.ctx.font = 'bold 12px monospace';
                
                const angleDeg = Math.abs(segment.sweepAngle || (segment.endAngle - segment.startAngle)) * 180 / Math.PI;
                const label = `Arc ${idx + 1}: r=${segment.radius.toFixed(2)}, ${angleDeg.toFixed(1)}°`;
                this.ctx.strokeText(label, centerScreen.x + 10, centerScreen.y - 10);
                this.ctx.fillText(label, centerScreen.x + 10, centerScreen.y - 10);
            });
        }
        
        renderContourDebug(primitive) {
            if (!primitive.contours || primitive.contours.length <= 1) return;
            
            const colors = ['#00ff00', '#ff0000', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
            
            primitive.contours.forEach((contour, idx) => {
                if (!contour.points || contour.points.length === 0) return;
                
                const color = colors[contour.nestingLevel % colors.length];
                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = 2;
                this.ctx.setLineDash(contour.isHole ? [5, 5] : []);
                
                this.ctx.beginPath();
                contour.points.forEach((p, i) => {
                    const screenPos = this.core.worldToScreen(p.x, p.y);
                    if (i === 0) this.ctx.moveTo(screenPos.x, screenPos.y);
                    else this.ctx.lineTo(screenPos.x, screenPos.y);
                });
                this.ctx.closePath();
                this.ctx.stroke();
                
                // Label
                if (contour.points.length > 0) {
                    const firstPoint = this.core.worldToScreen(contour.points[0].x, contour.points[0].y);
                    this.ctx.fillStyle = '#FFFFFF';
                    this.ctx.font = '12px monospace';
                    const label = `L${contour.nestingLevel}${contour.isHole ? 'H' : ''}`;
                    this.ctx.fillText(label, firstPoint.x + 5, firstPoint.y - 5);
                }
            });
            
            this.ctx.setLineDash([]);
        }
        
        getCurveDebugColor(curveId) {
            const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
            return colors[curveId % colors.length];
        }
    }
    
    window.PrimitiveRenderer = PrimitiveRenderer;
})();