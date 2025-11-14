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
    
    const config = window.PCBCAMConfig;
    const primitivesConfig = config.renderer.primitives;
    const debugConfig = config.debug;
    
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

        
        // Main Dispatcher
        
        renderPrimitive(primitive, fillColor, strokeColor, isPreprocessed = false, context = {}) {
            const role = primitive.properties?.role;

            // Role-based Dispatcher
            if (role) {
                switch (role) {
                    case 'drill_hole':
                    case 'drill_slot':
                        // Source drill geometry
                        this.renderSourceDrill(primitive, strokeColor);
                        return;
                        
                    case 'peck_mark':
                        // Strategy layer peck marks
                        this.renderPeckMark(primitive, context);
                        return;
                        
                    case 'drill_milling_path':
                        // Strategy layer milling paths (reuse offset renderer)
                        this.renderOffsetPrimitive(primitive, strokeColor || fillColor, context);
                        return;
                }
            }
            
            if (context.isPreview) {
                this.renderToolPreview(primitive, fillColor || strokeColor, context);
                return;
            }
            
            if (context.isOffset) {
                this.renderOffsetPrimitive(primitive, strokeColor || fillColor, context);
                return;
            }
            
            if (primitive.properties.reconstructed) {
                this.renderReconstructedPrimitive(primitive, fillColor);
                return;
            }
            
            if (this.core.options.showWireframe) {
                this.renderWireframe(primitive);
                return;
            }
            
            this.renderPrimitiveNormal(primitive, fillColor, strokeColor, isPreprocessed);
        }
        
        // Batched Rendering
        
        addPrimitiveToPath2D(primitive, path2d) {
            switch (primitive.type) {
                case 'path':
                    this.addPathToPath2D(primitive, path2d);
                    break;
                    
                case 'circle':
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
                    // Standalone ArcPrimitives are rare in offset layers, but this handles it.
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

            // If we are here, it's a path with analytic arc data.
            const segments = primitive.arcSegments;
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
        
        // Specialized Renderers

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
                this.renderPeckMark(primitive, context);
                this.ctx.restore();
                return;
            }
            
            // Milling previews use tool diameter stroke
            const toolDiameter = context.toolDiameter || 
                                context.layer?.metadata?.toolDiameter || 
                                primitive.properties?.toolDiameter;
            
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
            
            const primColors = this.core.colors.primitives;
            const strokeColor = isInternal ? 
                (primColors.offsetInternal) : 
                (color || primColors.offsetExternal);
            const strokeWidth = (primitivesConfig.offsetStrokeWidth) / this.core.viewScale;

            this._setStrokeState(strokeColor, strokeWidth);
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
            this.ctx.lineWidth = (primitivesConfig.centerMarkStrokeWidth) / this.core.viewScale;
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
        renderSourceDrill(primitive, color) {
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = (primitivesConfig.sourceDrillStrokeWidth || 3) / this.core.viewScale;
            
            if (primitive.properties.role === 'drill_hole') {
                const r = primitive.radius;
                
                // Draw circle outline
                this.ctx.beginPath();
                this.ctx.arc(primitive.center.x, primitive.center.y, r, 0, Math.PI * 2);
                this.ctx.stroke();
                
                // Draw center crosshair
                const markRatio = primitivesConfig.sourceDrillMarkRatio;
                const maxMarkSize = primitivesConfig.sourceDrillMarkSize;
                const markSize = Math.min(maxMarkSize, r * markRatio);
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
                const markRatio = primitivesConfig.sourceDrillMarkRatio || 0.4;
                const maxMarkSize = primitivesConfig.sourceDrillMarkSize || 0.2;
                const markSize = Math.min(maxMarkSize, r * markRatio);
                this._renderCenterMarks(slot.start, markSize, color);
                this._renderCenterMarks(slot.end, markSize, color);
            }
        }

        /**
         * Renders peck mark previews (strategy layer)
         */
        renderPeckMark(primitive, context) {
            const center = primitive.center;
            const radius = primitive.radius;
            const oversized = primitive.properties.oversized;
            const undersized = primitive.properties.undersized;
            const reducedPlunge = primitive.properties.reducedPlunge;
            const isPreview = context.layer.isPreview;
            
            // Color priority: oversized > undersized > reducedPlunge > perfect fit
            const primColors = this.core.colors.primitives;
            let markColor = primColors.peckMarkGood;
            if (oversized) markColor = primColors.peckMarkError;  // Oversized warning (should overwrite all others)
            else if (undersized) markColor = primColors.peckMarkWarn;  // Undersized warning
            else if (reducedPlunge) markColor = primColors.peckMarkSlow;  // Reduced splot plunge rate warning
            
            // Offset Stage: Outline + center (like source drill)

            if (!isPreview) {
                // Just outline
                this.ctx.strokeStyle = markColor;
                this.ctx.lineWidth = (primitivesConfig.peckMarkStrokeWidth) / this.core.viewScale;
                this.ctx.beginPath();
                this.ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
                this.ctx.stroke();
                
                // Center crosshair
                const markRatio = primitivesConfig.peckMarkMarkRatio;
                const maxMarkSize = primitivesConfig.peckMarkMarkSize;
                const markSize = Math.min(maxMarkSize, radius * markRatio);
                this._renderCenterMarks(center, markSize, markColor);
                
                // Reduced plunge indicator (dashed ring AROUND the mark)
                if (reducedPlunge) {
                    const dash = primitivesConfig.peckMarkDash;
                    const ringFactor = primitivesConfig.peckMarkRingFactor;

                    this.ctx.save();
                    this.ctx.strokeStyle = primColors.peckMarkSlow;
                    this.ctx.lineWidth = (primitivesConfig.peckMarkStrokeWidth) / this.core.viewScale;;
                    this.ctx.setLineDash(dash);
                    this.ctx.beginPath();
                    this.ctx.arc(center.x, center.y, radius * ringFactor, 0, Math.PI * 2);
                    this.ctx.stroke();
                    this.ctx.restore();
                }
                
                return;
            }
            
            // Preview Stage: Filled circles

            // Semi-transparent fill
            this.ctx.fillStyle = markColor;
            this.ctx.beginPath();
            this.ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Solid outline
            this.ctx.strokeStyle = markColor;
            this.ctx.lineWidth = (primitivesConfig.peckMarkStrokeWidth) / this.core.viewScale;
            this.ctx.stroke();
            
            // Center crosshair
            const markRatio = primitivesConfig.peckMarkMarkRatio;
            const maxMarkSize = primitivesConfig.peckMarkMarkSize;
            const markSize = Math.min(maxMarkSize, radius * markRatio);
            this._renderCenterMarks(center, markSize, markColor);
            
            // Warning indicators (only in preview)
            if (oversized) {
                const labelOffset = primitivesConfig.peckMarkLabelOffset;
                this.ctx.save();
                this.ctx.font = `${Math.max(0.3, radius * 0.5)}px monospace`;
                this.ctx.fillStyle = primColors.peckMarkError;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText('!', center.x, center.y + radius + labelOffset);
                this.ctx.restore();
            }
            
            if (reducedPlunge) {
                const dash = primitivesConfig.peckMarkDash;
                const ringFactor = primitivesConfig.peckMarkRingFactor;
                this.ctx.save();
                this.ctx.strokeStyle = primColors.peckMarkSlow ;
                this.ctx.lineWidth = (primitivesConfig.peckMarkStrokeWidth) / this.core.viewScale;
                this.ctx.setLineDash(dash);
                this.ctx.beginPath();
                this.ctx.arc(center.x, center.y, radius * ringFactor, 0, Math.PI * 2);
                this.ctx.stroke();
                this.ctx.restore();
            }
        }

        // Debug special rendering mode
        renderReconstructedPrimitive(primitive, fillColor) {
            // Reconstructed primitives get a special highlight color
            const primColors = this.core.colors.primitives || {};
            const accentColor = primColors.reconstructed;
            
            this.ctx.save();
            
            if (primitive.type === 'circle') {
                this.ctx.strokeStyle = accentColor;
                this.ctx.lineWidth = (primitivesConfig.reconstructedStrokeWidth) / this.core.viewScale;
                this.ctx.fillStyle = fillColor + '40'; // Semi-transparent fill
                
                this.ctx.beginPath();
                this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, 2 * Math.PI);
                this.ctx.fill();
                this.ctx.stroke();
                
                // Center dot
                this.ctx.fillStyle = accentColor;
                this.ctx.beginPath();
                this.ctx.arc(primitive.center.x, primitive.center.y, (primitivesConfig.reconstructedCenterSize) / this.core.viewScale, 0, 2 * Math.PI);
                this.ctx.fill();
            } else if (primitive.type === 'arc') {
                this.ctx.strokeStyle = accentColor;
                this.ctx.lineWidth = (primitivesConfig.reconstructedStrokeWidth) / this.core.viewScale;
                
                this.ctx.beginPath();
                this.ctx.arc(
                    primitive.center.x, primitive.center.y, primitive.radius,
                    primitive.startAngle, primitive.endAngle,
                    primitive.counterclockwise || primitive.clockwise
                );
                this.ctx.stroke();
            } else if (primitive.type === 'path') {
                // Partially reconstructed path
                this.ctx.strokeStyle = primColors.reconstructedPath;
                this.ctx.lineWidth = (primitivesConfig.reconstructedStrokeWidth) / this.core.viewScale;
                const dash = primitivesConfig.reconstructedPathDash;
                this.ctx.setLineDash([dash[0] / this.core.viewScale, dash[1] / this.core.viewScale]);
                
                this.renderPrimitiveNormal(primitive, fillColor + '40', primColors.reconstructedPath);
            }
            
            this.ctx.restore();
        }
        
        // Normal Rendering
        
        renderPrimitiveNormal(primitive, fillColor, strokeColor, isPreprocessed) {
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
                    console.warn(`[RendererPrimitives] Unknown primitive type: ${primitive.type}`);
                    break;
            }
        }
        
        renderPath(primitive, fillColor, strokeColor, isPreprocessed) {
            // If it's preprocessed, it should *always* fill.
            const shouldFill = (primitive.properties?.fill !== false && !primitive.properties?.stroke) || isPreprocessed;
            // If it's preprocessed, it should *never* stroke.
            const shouldStroke = (primitive.properties.stroke === true) && !isPreprocessed;
            const points = primitive.points;

            if (!points || points.length === 0) return;

            this.ctx.beginPath();

            // Handle paths with arcs
            if (primitive.arcSegments && primitive.arcSegments.length > 0) {
                const sortedArcs = primitive.arcSegments.slice().sort((a, b) => a.startIndex - b.startIndex);
                let currentIndex = 0;

                this.ctx.moveTo(points[0].x, points[0].y);

                for (const arc of sortedArcs) {
                    // Draw lines up to the arc start
                    for (let i = currentIndex + 1; i <= arc.startIndex; i++) {
                        this.ctx.lineTo(points[i].x, points[i].y);
                    }

                    // Draw the arc
                    this.ctx.arc(
                        arc.center.x, arc.center.y, arc.radius,
                        arc.startAngle, arc.endAngle, arc.clockwise
                    );

                    currentIndex = arc.endIndex;
                }

                // Check if last arc wrapped to start (closes path)
                const pathClosedByArc = (currentIndex === 0 && sortedArcs.length > 0);

                // Draw remaining lines only if path not closed by arc
                if (!pathClosedByArc) {
                    for (let i = currentIndex + 1; i < points.length; i++) {
                        this.ctx.lineTo(points[i].x, points[i].y);
                    }
                }

            } else {
                // Simple path logic
                points.forEach((p, i) => {
                    if (i === 0) this.ctx.moveTo(p.x, p.y);
                    else this.ctx.lineTo(p.x, p.y);
                });
            }

            // Closing, Filling, Stroking
            if (primitive.closed !== false) {
                this.ctx.closePath();
            }

            if (shouldFill) {
                // Handle fill rules for complex shapes (like fused geometry)
                const fillRule = (primitive.contours && primitive.contours.length > 1) ? 'evenodd' : 'nonzero';

                if (isPreprocessed) {
                    const polarity = primitive.properties?.polarity;
                    if (polarity === 'clear') {
                        // Draw "clear" primitives with the canvas background color
                        this.ctx.fillStyle = this.core.colors.canvas?.background;
                    } else {
                        // Draw "dark" primitives with the normal layer color
                        this.ctx.fillStyle = fillColor;
                    }
                } else {
                    // Normal behavior
                    this.ctx.fillStyle = fillColor;
                }

                this.ctx.fill(fillRule);
            }

            if (shouldStroke) {
                this.ctx.strokeStyle = strokeColor;
                this.ctx.lineWidth = primitive.properties.strokeWidth;
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
            
            if (primitive.properties.stroke) {
                this.ctx.strokeStyle = strokeColor;
                this.ctx.lineWidth = primitive.properties.strokeWidth;
                this.ctx.stroke();
            }
        }
        
        renderRectangle(primitive, fillColor, strokeColor) {
            if (primitive.properties?.fill !== false) {
                this.ctx.fillStyle = fillColor;
                this.ctx.fillRect(primitive.position.x, primitive.position.y, primitive.width, primitive.height);
            }
            
            if (primitive.properties.stroke) {
                this.ctx.strokeStyle = strokeColor;
                this.ctx.lineWidth = primitive.properties.strokeWidth;
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
                primitive.counterclockwise
            );
            
            if (primitive.properties?.fill) {
                this.ctx.closePath();
                this.ctx.fillStyle = fillColor;
                this.ctx.fill();
            }
            
            this.ctx.strokeStyle = strokeColor;
            this.ctx.lineWidth = primitive.properties.strokeWidth;
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
            
            if (primitive.properties.stroke) {
                this.ctx.strokeStyle = strokeColor;
                this.ctx.lineWidth = primitive.properties.strokeWidth;
                this.ctx.stroke();
            }
        }
        
        // Wireframe Rendering
        
        renderWireframe(primitive) {
            const debugColors = this.core.colors.debug;
            const strokeWidth = this.core.getWireframeStrokeWidth();
            
            this.ctx.strokeStyle = (debugColors && debugColors.wireframe) ? debugColors.wireframe : '#00ff00';
            this.ctx.lineWidth = strokeWidth;
            this.ctx.fillStyle = 'none';
            
            this.ctx.beginPath();
            
            switch (primitive.type) {
                case 'path':
                    const points = primitive.points;
                    if (!points || points.length === 0) break; // Skip if no points

                    // Handle paths with arcs in wireframe
                    if (primitive.arcSegments && primitive.arcSegments.length > 0) {
                        const sortedArcs = primitive.arcSegments.slice().sort((a, b) => a.startIndex - b.startIndex);
                        let currentIndex = 0;

                        this.ctx.moveTo(points[0].x, points[0].y);

                        for (const arc of sortedArcs) {
                            // Draw lines up to the arc start
                            for (let i = currentIndex + 1; i <= arc.startIndex; i++) {
                                this.ctx.lineTo(points[i].x, points[i].y);
                            }

                            // Draw the arc for wireframe
                            this.ctx.arc(
                                arc.center.x, arc.center.y, arc.radius,
                                arc.startAngle, arc.endAngle, !arc.clockwise
                            );

                            currentIndex = arc.endIndex;
                        }

                        // Check if last arc wrapped to start
                        const pathClosedByArc = (currentIndex === 0 && sortedArcs.length > 0);

                        // Draw remaining lines only if path not closed
                        if (!pathClosedByArc) {
                            for (let i = currentIndex + 1; i < points.length; i++) {
                                this.ctx.lineTo(points[i].x, points[i].y);
                            }
                        }

                    } else {
                        // Simple path logic for wireframe
                        points.forEach((p, i) => {
                            if (i === 0) this.ctx.moveTo(p.x, p.y);
                            else this.ctx.lineTo(p.x, p.y);
                        });
                    }

                    // Closing logic
                    if (primitive.closed !== false) {
                        this.ctx.closePath();
                    }
                    break; // End of case 'path'
                    
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
        
        // Debug Rendering - Needs revisiting
        
        renderDebugInfo(primitive, options) {
            if (!primitive) return;
            
            // This is called after resetTransform, so we're in screen space
            
            if (options.debugPaths && primitive.arcSegments) {
                this.renderArcSegmentDebug(primitive);
            }
            
            if (options.debugPoints && primitive.screenPoints) {
                this.renderCurveDebugPoints(primitive);
            }
            
            if (options.debugPaths && primitive.contours) {
                this.renderContourDebug(primitive);
            }
        }
        
        renderCurveDebugPoints(primitive) { // primitive is screen-space data
            if (!primitive.screenPoints) return; // Use screenPoints

            const pointSize = primitivesConfig.debugPointSize;
            this.ctx.font = primitivesConfig.debugFont;

            // Reset stats for this render pass
            this.debugStats.totalPoints = 0;
            this.debugStats.taggedPoints = 0;

            primitive.screenPoints.forEach((p, index) => { // Iterate screenPoints
                // Check for curveId on the screen point
                if (p.curveId === undefined || p.curveId <= 0) return;

                const color = this.getCurveDebugColor(p.curveId);

                // p.x and p.y are ALREADY in screen space
                this.ctx.fillStyle = color;
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, pointSize, 0, Math.PI * 2);
                this.ctx.fill();

                // Labels
                this.ctx.fillStyle = this.core.colors.primitives.debugLabel;
                this.ctx.strokeStyle = this.core.colors.primitives.debugLabelStroke;
                this.ctx.lineWidth = primitivesConfig.debugLabelLineWidth;
                // Use segmentIndex if available, otherwise fall back to array index
                const segIdx = p.segmentIndex !== undefined ? p.segmentIndex : index;
                const label = `C${p.curveId}:${segIdx}`;
                this.ctx.strokeText(label, p.x + 6, p.y - 6);
                this.ctx.fillText(label, p.x + 6, p.y - 6);

                this.debugStats.taggedPoints++;
            });

            this.debugStats.totalPoints += primitive.screenPoints.length;
        }
        
        renderArcSegmentDebug(primitive) { // primitive is screen-space data
            // Use screen-space arcSegments
            if (!primitive.arcSegments || primitive.arcSegments.length === 0) return;

            primitive.arcSegments.forEach((segment, idx) => {
                // Use pre-transformed screen values directly
                const centerScreen = segment.centerScreen;
                const radiusScreen = segment.radiusScreen;

                if (!centerScreen || radiusScreen === undefined) {
                    console.warn("[RendererPrimitives] Missing screen coords for arc debug", segment);
                    return; // Skip if screen coords weren't calculated
                }

                const hue = ((idx * 137) + 60) % 360;
                const color = `hsl(${hue}, 100%, 50%)`;

                // Draw arc - centerScreen and radiusScreen already in screen coords
                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = primitivesConfig.debugArcStrokeWidth;
                this.ctx.beginPath();

                // Angles are NOT transformed, they remain in world space radians
                const startAngle = segment.startAngle;
                const endAngle = segment.endAngle;
                // Use the correct anticlockwise flag based on the original segment data
                const anticlockwise = !segment.clockwise;

                // Draw arc in screen space using world angles
                this.ctx.arc(centerScreen.x, centerScreen.y, radiusScreen,
                            startAngle, endAngle, anticlockwise);
                this.ctx.stroke();

                // Draw center point
                this.ctx.fillStyle = color;
                this.ctx.beginPath();
                this.ctx.arc(centerScreen.x, centerScreen.y, primitivesConfig.debugArcCenterSize);
                this.ctx.fill();

                // Draw label
                this.ctx.fillStyle = this.core.colors.primitives.debugLabel;
                this.ctx.strokeStyle = this.core.colors.primitives.debugLabelStroke;
                this.ctx.lineWidth = primitivesConfig.debugLabelLineWidth;
                this.ctx.font = primitivesConfig.debugFont;

                const angleDeg = Math.abs(segment.sweepAngle) * 180 / Math.PI;
                // Display original world radius
                const label = `Arc ${idx}: r=${segment.radius.toFixed(2)}, ${angleDeg.toFixed(1)}°`;
                this.ctx.strokeText(label, centerScreen.x + 10, centerScreen.y - 10);
                this.ctx.fillText(label, centerScreen.x + 10, centerScreen.y - 10);
            });
        }
        
        renderContourDebug(primitive) { // primitive is screen-space data
            if (!primitive.contours || primitive.contours.length <= 1) return;

            const colors = primitivesConfig.debugContourColors || ['#00ff00', '#ff0000', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];

            primitive.contours.forEach((contour, idx) => {
                // Use screenPoints from the contour
                if (!contour.screenPoints || contour.screenPoints.length === 0) return;

                const color = colors[contour.nestingLevel % colors.length];
                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = primitivesConfig.debugContourStrokeWidth;
                this.ctx.setLineDash(contour.isHole ? (primitivesConfig.debugContourDash) : []);

                this.ctx.beginPath();
                // Iterate screenPoints
                contour.screenPoints.forEach((p, i) => {
                    if (i === 0) this.ctx.moveTo(p.x, p.y);
                    else this.ctx.lineTo(p.x, p.y);
                });
                this.ctx.closePath();
                this.ctx.stroke();

                // Label using the first screen point
                if (contour.screenPoints.length > 0) {
                    const firstPoint = contour.screenPoints[0];
                    this.ctx.fillStyle = this.core.colors.primitives.debugLabel;
                    this.ctx.font = primitivesConfig.debugFont;
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
    
    window.PrimitiveRenderer = PrimitiveRenderer;
})();