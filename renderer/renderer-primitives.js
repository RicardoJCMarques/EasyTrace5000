/**
 * @file        renderer/renderer-primitives.js
 * @description Dedicated geometry object definitions
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

            const layer = context.layer || {};

            if (layer.isPreview) {
                this.renderToolPreview(primitive, fillColor || strokeColor, context);
                return;
            }

            if (layer.isOffset) {
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
                    path2d.arc(
                        primitive.center.x,
                        primitive.center.y,
                        primitive.radius,
                        primitive.startAngle,
                        primitive.endAngle,
                        !primitive.clockwise // Path2D API expects 'anticlockwise'
                    );
                    break;
            }
        }

        addPathToPath2D(primitive, path2d) {
            if (!primitive.contours || primitive.contours.length === 0) {
                return;
            }

            for (const contour of primitive.contours) {
                const points = contour.points;
                const arcSegments = contour.arcSegments || [];

                if (!points || points.length === 0) continue;

                if (arcSegments.length > 0) {
                    const sortedArcs = arcSegments.slice().sort((a, b) => a.startIndex - b.startIndex);
                    let currentIndex = 0;

                    path2d.moveTo(points[0].x, points[0].y);

                    for (const arc of sortedArcs) {
                        for (let i = currentIndex + 1; i <= arc.startIndex; i++) {
                            path2d.lineTo(points[i].x, points[i].y);
                        }

                        path2d.arc(
                            arc.center.x, arc.center.y, arc.radius,
                            arc.startAngle, arc.endAngle, 
                            !arc.clockwise
                        );

                        currentIndex = arc.endIndex;
                    }

                    const pathClosedByArc = (currentIndex === 0 && sortedArcs.length > 0);
                    if (!pathClosedByArc) {
                        for (let i = currentIndex + 1; i < points.length; i++) {
                            path2d.lineTo(points[i].x, points[i].y);
                        }
                    }

                } else {
                    path2d.moveTo(points[0].x, points[0].y);
                    for (let i = 1; i < points.length; i++) {
                        path2d.lineTo(points[i].x, points[i].y);
                    }
                }

                path2d.closePath();
            }
        }

        addObroundToBatch(primitive, path2d) {
            const x = primitive.position.x;
            const y = primitive.position.y;
            const w = primitive.width;
            const h = primitive.height;

            // Calculate Center and Radius
            const cx = x + w / 2;
            const cy = y + h / 2;
            const r = Math.min(w, h) / 2;

            // Get Rotation in Radians (default to 0)
            const rotDeg = primitive.properties.rotation || 0;
            const rad = (rotDeg * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);

            // Helper to rotate a point around the center (cx, cy)
            const rot = (px, py) => {
                // 1. Translate to origin (0,0)
                const dx = px; 
                const dy = py;
                // 2. Rotate
                const rx = dx * cos - dy * sin;
                const ry = dx * sin + dy * cos;
                // 3. Translate back
                return { x: cx + rx, y: cy + ry };
            };

            //Define the unrotated key points relative to the center, rotate them, and then draw.
            if (w > h) {
                // Horizontal Capsule (before rotation)
                // Inner width from center to arc center
                const iw = (w / 2) - r;

                // Calculate Rotated Arc Centers
                const cRight = rot(iw, 0);  // Right arc center
                const cLeft = rot(-iw, 0);  // Left arc center

                // Calculate Corner Points for LineTo (Visual reference)
                // Top-Right: (iw, -r) -> Rotated
                const pTR = rot(iw, -r); 
                // Top-Left: (-iw, -r) -> Rotated
                const pTL = rot(-iw, -r);

                // Note: Explicit lineTo is safer for clean shapes than relying on corner points in arcs. // Review - What now? What does this even mean?

                // 1. Move to Top-Left of the straight part
                path2d.moveTo(pTL.x, pTL.y);

                // 2. Line to Top-Right
                path2d.lineTo(pTR.x, pTR.y);

                // 3. Right Cap (Center cRight, start -PI/2, end PI/2)
                // Add rotation to angles
                path2d.arc(cRight.x, cRight.y, r, -Math.PI/2 + rad, Math.PI/2 + rad);

                // 4. Bottom Line is drawn automatically by connecting to next arc start? 
                // Standard arc() connects previous point to start point but be explicit for the Bottom-Left corner.
                const pBL = rot(-iw, r);
                path2d.lineTo(pBL.x, pBL.y);

                // 5. Left Cap (Center cLeft, start PI/2, end 3PI/2)
                path2d.arc(cLeft.x, cLeft.y, r, Math.PI/2 + rad, -Math.PI/2 + rad);

            } else {
                // Vertical Capsule (before rotation)
                const ih = (h / 2) - r;
                
                const cTop = rot(0, -ih);

                const cBottom = rot(0, ih);

                const pTR = rot(r, -ih);
                const pBR = rot(r, ih);

                // Start Top-Right
                path2d.moveTo(pTR.x, pTR.y);

                // Line to Bottom-Right
                path2d.lineTo(pBR.x, pBR.y);

                // Bottom Cap (0 to PI)
                path2d.arc(cBottom.x, cBottom.y, r, 0 + rad, Math.PI + rad);

                // Line automatically goes to Left side
                const pTL = rot(-r, -ih);
                path2d.lineTo(pTL.x, pTL.y); // Connect to Top-Left

                // Top Cap (PI to 2PI)
                path2d.arc(cTop.x, cTop.y, r, Math.PI + rad, 0 + rad);
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

            // A. Handle Strategy Layer Peck Marks
            if (primitive.properties?.role === 'peck_mark') {
                this.renderPeckMark(primitive, context);
                this.ctx.restore();
                return;
            }

            // B. Special Case: Centerline Slot Path (New Accessory Method)
            if (primitive.properties?.isCenterlinePath) {
                this.renderCenterlineSlot(primitive, context);
                this.ctx.restore();
                return;
            }

            // C. Standard Tool Preview
            const toolDiameter = context.toolDiameter || 
                                context.layer?.metadata?.toolDiameter || 
                                primitive.properties?.toolDiameter; 

            this._setStrokeState(color, toolDiameter);
            this._drawPrimitivePath(primitive);
            this.ctx.stroke();

            this.ctx.restore();
        }

        // Main Offset Renderer (The Geometry Lines)
        renderOffsetPrimitive(primitive, color, context) {
            // A. Handle Strategy Layer Peck Marks
            if (primitive.properties?.isToolPeckMark || primitive.properties?.role === 'peck_mark') {
                this.renderPeckMark(primitive, context);
                return;
            }

            const markSize = (window.PCBCAMConfig.renderer.primitives.sourceDrillMarkSize || 0.5);
            const lineWidth = (window.PCBCAMConfig.renderer.primitives.offsetStrokeWidth || 2) / this.core.viewScale;

            // B. Special Case: Centerline Slot Path (Wireframe View)
            if (primitive.properties?.isCenterlinePath) {
                const pts = primitive.contours[0].points;
                const start = pts[0];
                const end = pts[pts.length - 1];

                // Calculate Tool Radius for the perimeter
                const toolDiameter = context.toolDiameter || primitive.properties.toolDiameter;
                const radius = toolDiameter / 2;

                this.ctx.save();

                const toolRelation = primitive.properties.toolRelation || 'exact';
                const lineColor = this._getStatusColor(toolRelation, color);

                this.ctx.strokeStyle = lineColor;
                this.ctx.globalAlpha = 1.0;
                this.ctx.lineWidth = lineWidth;
                this.ctx.setLineDash([]);

                // Draw the Perimeter instead of just the line
                this.ctx.beginPath();
                const dx = end.x - start.x;
                const dy = end.y - start.y;
                const angle = Math.atan2(dy, dx);

                // Draw capsule
                this.ctx.arc(end.x, end.y, radius, angle - Math.PI/2, angle + Math.PI/2, false);
                this.ctx.arc(start.x, start.y, radius, angle + Math.PI/2, angle - Math.PI/2, false);
                this.ctx.closePath();
                this.ctx.stroke();

                // Draw Center Line
                this.ctx.beginPath();
                this.ctx.moveTo(start.x, start.y);
                this.ctx.lineTo(end.x, end.y);
                this.ctx.lineWidth = lineWidth;
                this.ctx.stroke();

                // Draw crosshairs
                this.ctx.lineWidth = lineWidth;
                this._renderCenterMarks(start, markSize, lineColor);
                this._renderCenterMarks(end, markSize, lineColor);

                this.ctx.restore();
                return;
            }

            // C. Special Case: Undersized Milling Path (Internal Yellow Offset)
            if (primitive.properties?.role === 'drill_milling_path') {
                const toolRelation = primitive.properties.toolRelation || 'exact';
                const statusColor = this._getStatusColor(toolRelation, color);

                this._setStrokeState(statusColor, lineWidth);
                this.ctx.setLineDash([]);

                // Draw the path (Circle or Obround)
                this._drawPrimitivePath(primitive); 
                this.ctx.stroke();

                // Add center marks for both Slots and Holes
                if (primitive.properties?.originalSlot) {
                    const slot = primitive.properties.originalSlot;
                    this._renderCenterMarks(slot.start, markSize, statusColor);
                    this._renderCenterMarks(slot.end, markSize, statusColor);
                } 
                // Handle simple Drill Holes (Circles)
                else if (primitive.center) {
                    this._renderCenterMarks(primitive.center, markSize, statusColor);
                }

                return;
            }

            // D. Standard Offsets (Default Logic)
            const offsetDistance = context.distance || primitive.properties?.offsetDistance || 0;
            const isInternal = offsetDistance < 0;
            const primColors = this.core.colors.primitives;

            const strokeColor = isInternal ? 
                (primColors.offsetInternal) : 
                (color || primColors.offsetExternal);

            this._setStrokeState(strokeColor, lineWidth);
            this.ctx.setLineDash([]);
            this._drawPrimitivePath(primitive);
            this.ctx.stroke();

            if (primitive.properties?.originalSlot) {
                const slot = primitive.properties.originalSlot;
                this._renderCenterMarks(slot.start, markSize, strokeColor);
                this._renderCenterMarks(slot.end, markSize, strokeColor);
            }
        }

        // Tool Preview Renderer
        renderToolPreview(primitive, color, context) {
        this.ctx.save();

        // A. Handle Strategy Layer Peck Marks
        if (primitive.properties?.role === 'peck_mark') {
            this.renderPeckMark(primitive, context);
            this.ctx.restore();
            return;
        }

        // B. Special Case: Centerline Slot Path Preview
        if (primitive.properties?.isCenterlinePath) {
            this.renderCenterlineSlot(primitive, context);
            this.ctx.restore();
            return;
        }

        // C. Standard Tool Preview (Generic Milling/Cutout/Undersized Drill)
        const toolDiameter = context.toolDiameter || 
                            context.layer?.metadata?.toolDiameter || 
                            primitive.properties?.toolDiameter; 

        // 1. Draw the Blue Preview Stroke
        this._setStrokeState(color, toolDiameter);
        this._drawPrimitivePath(primitive);
        this.ctx.stroke();

        // 2. Draw Yellow Center Marks for Undersized Drill Ops (Integrated)
        if (primitive.properties?.toolRelation === 'undersized') {
            const warnColor = this.core.colors.primitives.peckMarkWarn;
            const markSize = (window.PCBCAMConfig.renderer.primitives.sourceDrillMarkSize || 0.5);
            const lineWidth = (window.PCBCAMConfig.renderer.primitives.centerMarkStrokeWidth || 2) / this.core.viewScale;

            // Override stroke state for marks
            this.ctx.strokeStyle = warnColor;
            this.ctx.lineWidth = lineWidth;
            this.ctx.lineCap = 'round';

            // Handle Slot (Two Centers)
            if (primitive.properties?.originalSlot) {
                const slot = primitive.properties.originalSlot;
                this._renderCenterMarks(slot.start, markSize, warnColor);
                this._renderCenterMarks(slot.end, markSize, warnColor);
            } 
            // Handle Hole (One Center)
            else if (primitive.center || (primitive.type === 'circle' && primitive.center)) {
                // Use primitive.center if available
                this._renderCenterMarks(primitive.center, markSize, warnColor);
            }
        }

        this.ctx.restore();
    }

        // Helper: Consolidated Path Drawing Logic (Does not stroke/fill, just defines path)
        _drawPrimitivePath(primitive) {
            this.ctx.beginPath();
            
            if (primitive.type === 'path') {
                if (primitive.contours && primitive.contours.length > 0) {
                    for (const contour of primitive.contours) {
                        if (!contour.points || contour.points.length === 0) continue;

                        // Optimized Arc Rendering path
                        if (contour.arcSegments && contour.arcSegments.length > 0) {
                            const sortedArcs = contour.arcSegments.slice().sort((a, b) => a.startIndex - b.startIndex);
                            let currentIndex = 0;
                            this.ctx.moveTo(contour.points[0].x, contour.points[0].y);

                            for (const arc of sortedArcs) {
                                // Draw lines up to the start of the arc
                                for (let i = currentIndex + 1; i <= arc.startIndex; i++) {
                                    this.ctx.lineTo(contour.points[i].x, contour.points[i].y);
                                }
                                // Draw the arc
                                this.ctx.arc(
                                    arc.center.x, arc.center.y, arc.radius,
                                    arc.startAngle, arc.endAngle, 
                                    !arc.clockwise
                                );
                                currentIndex = arc.endIndex;
                            }
                            // Draw remaining lines after last arc
                            const pathClosedByArc = (currentIndex === 0 && sortedArcs.length > 0);
                            if (!pathClosedByArc) {
                                for (let i = currentIndex + 1; i < contour.points.length; i++) {
                                    this.ctx.lineTo(contour.points[i].x, contour.points[i].y);
                                }
                            }
                        } else {
                            // Simple Polyline
                            contour.points.forEach((p, i) => {
                                if (i === 0) this.ctx.moveTo(p.x, p.y);
                                else this.ctx.lineTo(p.x, p.y);
                            });
                        }
                        // Only close if strictly required (Offsets usually are, Centerlines are not)
                        if (primitive.closed !== false) this.ctx.closePath();
                    }
                }

            } else if (primitive.type === 'circle') {
                this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, Math.PI * 2);
                this.ctx.closePath();

            } else if (primitive.type === 'arc') {
                this.ctx.arc(
                    primitive.center.x, primitive.center.y, primitive.radius,
                    primitive.startAngle, primitive.endAngle, 
                    !primitive.clockwise
                );

            } else if (primitive.type === 'obround') {
                let x = primitive.position.x;
                let y = primitive.position.y;
                const w = primitive.width;
                const h = primitive.height;
                const r = Math.min(w, h) / 2;

                // Handle Rotation if present
                if (primitive.properties.rotation) {
                    // 1. Calculate Center
                    const cx = x + w / 2;
                    const cy = y + h / 2;
                    
                    // 2. Apply Transform
                    this.ctx.save();
                    this.ctx.translate(cx, cy);
                    this.ctx.rotate(primitive.properties.rotation * Math.PI / 180);
                    
                    // 3. Reset drawing coordinates to be relative to center (0,0)
                    // Top-left becomes (-w/2, -h/2)
                    x = -w / 2;
                    y = -h / 2;
                }

                // Draw Capsule
                if (w > h) {
                    this.ctx.moveTo(x + r, y);
                    this.ctx.lineTo(x + w - r, y);
                    this.ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
                    this.ctx.lineTo(x + r, y + h);
                    this.ctx.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
                } else {
                    this.ctx.moveTo(x + w, y + r);
                    this.ctx.lineTo(x + w, y + h - r);
                    this.ctx.arc(x + r, y + h - r, r, 0, Math.PI);
                    this.ctx.lineTo(x, y + r);
                    this.ctx.arc(x + r, y + r, r, Math.PI, 0);
                }

                if (primitive.properties.rotation) {
                    this.ctx.restore();
                }
                this.ctx.closePath();
            }
        }

        _renderCenterMarks(center, markSize, color) {
            this.ctx.save(); // Safety save
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = (primitivesConfig.centerMarkStrokeWidth || 1.5) / this.core.viewScale;
            this.ctx.beginPath();
            this.ctx.moveTo(center.x - markSize, center.y);
            this.ctx.lineTo(center.x + markSize, center.y);
            this.ctx.moveTo(center.x, center.y - markSize);
            this.ctx.lineTo(center.x, center.y + markSize);
            this.ctx.stroke();
            this.ctx.restore();
        }

        /**
         * Renders source drill geometry (holes and slots from parser)
         */
        renderSourceDrill(primitive, color) {
            // Scale stroke width by view scale
            const strokeWidth = (window.PCBCAMConfig.renderer.primitives.sourceDrillStrokeWidth || 3) / this.core.viewScale;
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = strokeWidth;

            if (primitive.properties.role === 'drill_hole') {
                const r = primitive.radius;
                this.ctx.beginPath();
                this.ctx.arc(primitive.center.x, primitive.center.y, r, 0, Math.PI * 2);
                this.ctx.stroke();

                const markRatio = window.PCBCAMConfig.renderer.primitives.sourceDrillMarkRatio;
                const maxMarkSize = window.PCBCAMConfig.renderer.primitives.sourceDrillMarkSize;
                const markSize = Math.min(maxMarkSize, r * markRatio);
                this._renderCenterMarks(primitive.center, markSize, color);

            } else if (primitive.properties.role === 'drill_slot') {
                const slot = primitive.properties.originalSlot;
                if (!slot) return; // Safety check

                const diameter = primitive.properties.diameter;
                const radius = diameter / 2;

                const dx = slot.end.x - slot.start.x;
                const dy = slot.end.y - slot.start.y;
                const angle = Math.atan2(dy, dx);

                this.ctx.beginPath();
                // Draw using vector math (Start -> End) instead of Bounding Box (x,y,w,h)
                this.ctx.arc(slot.end.x, slot.end.y, radius, angle - Math.PI/2, angle + Math.PI/2, false);
                this.ctx.arc(slot.start.x, slot.start.y, radius, angle + Math.PI/2, angle - Math.PI/2, false);
                this.ctx.closePath();
                this.ctx.stroke();

                // Draw crosshairs at both ends
                const markRatio = window.PCBCAMConfig.renderer.primitives.sourceDrillMarkRatio || 0.4;
                const maxMarkSize = window.PCBCAMConfig.renderer.primitives.sourceDrillMarkSize || 0.2;
                const markSize = Math.min(maxMarkSize, radius * markRatio);

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
            const toolRelation = primitive.properties.toolRelation || 'exact';
            const reducedPlunge = primitive.properties.reducedPlunge;
            const isPreview = context.layer.isPreview;

            // 1. Determine Color based on Relation
            const baseColor = this._getStatusColor(toolRelation, this.core.colors.primitives.peckMarkGood);

            // Preview Mode (solid filled)
            if (isPreview) {
                this.ctx.save();
                this.ctx.globalAlpha = 1.0; // Force solid
                
                this.ctx.fillStyle = baseColor;
                this.ctx.beginPath();
                this.ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
                this.ctx.fill();

                // Stroke to match fill for clean edges
                this.ctx.strokeStyle = baseColor;
                this.ctx.lineWidth = (config.renderer.primitives.peckMarkStrokeWidth) / this.core.viewScale;
                this.ctx.stroke();

                // Contrast Center Mark
                const markSize = Math.min(0.5, radius * 0.4);
                this._renderCenterMarks(center, markSize, '#FFFFFF'); 

                // Dashed ring for slow plunge
                if (reducedPlunge) {
                    const dash = config.renderer.primitives.peckMarkDash;
                    const ringFactor = config.renderer.primitives.peckMarkRingFactor;
                    this.ctx.save();
                    this.ctx.strokeStyle = this.core.colors.primitives.peckMarkSlow;
                    this.ctx.lineWidth = (config.renderer.primitives.peckMarkStrokeWidth) / this.core.viewScale;
                    this.ctx.setLineDash(dash); // Scale dash if needed
                    this.ctx.beginPath();
                    this.ctx.arc(center.x, center.y, radius * ringFactor, 0, Math.PI * 2);
                    this.ctx.stroke();
                    this.ctx.restore();
                }
                this.ctx.restore();
                return;
            }

            // Offset/Wireframe mode (stroked outline)
            this.ctx.save();
            this.ctx.strokeStyle = baseColor; // Use the status color!
            this.ctx.lineWidth = (config.renderer.primitives.peckMarkStrokeWidth) / this.core.viewScale;

            this.ctx.beginPath();
            this.ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
            this.ctx.stroke();

            // Center Mark matches status color in wireframe
            const markRatio = config.renderer.primitives.peckMarkMarkRatio;
            const maxMarkSize = config.renderer.primitives.peckMarkMarkSize;
            const markSize = Math.min(maxMarkSize, radius * markRatio);
            this._renderCenterMarks(center, markSize, baseColor);

            if (reducedPlunge) {
                const dash = config.renderer.primitives.peckMarkDash;
                const ringFactor = config.renderer.primitives.peckMarkRingFactor;
                const slowColor = this.core.colors.primitives.peckMarkSlow;
                
                this.ctx.save();
                this.ctx.strokeStyle = slowColor;
                this.ctx.setLineDash(dash);
                this.ctx.beginPath();
                this.ctx.arc(center.x, center.y, radius * ringFactor, 0, Math.PI * 2);
                this.ctx.stroke();
                this.ctx.restore();
            }
            this.ctx.restore();
        }

        // Helper to get color from relation
        _getStatusColor(toolRelation, defaultColor) {
            const primColors = this.core.colors.primitives;
            switch (toolRelation) {
                case 'oversized': return primColors.peckMarkError; // Red
                case 'undersized': return primColors.peckMarkWarn; // Yellow
                case 'exact': return primColors.peckMarkGood;      // Green
                default: return defaultColor;
            }
        }

        /**
         * Renders a solid obround for centerline slots, matching peck mark style.
         */
        renderCenterlineSlot(primitive, context) {
            const pts = primitive.contours[0].points;
            const p1 = pts[0];
            const p2 = pts[1];
            const toolDiameter = context.toolDiameter || primitive.properties.toolDiameter;
            const radius = toolDiameter / 2;

            // 1. Get Color based on Relation
            const toolRelation = primitive.properties.toolRelation || 'exact';
            const baseColor = this._getStatusColor(toolRelation, this.core.colors.primitives.peckMarkGood);

            // 2. Draw Path
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const angle = Math.atan2(dy, dx);

            this.ctx.beginPath();
            this.ctx.arc(p2.x, p2.y, radius, angle - Math.PI/2, angle + Math.PI/2, false);
            this.ctx.arc(p1.x, p1.y, radius, angle + Math.PI/2, angle - Math.PI/2, false);
            this.ctx.closePath();

            // 3. Fill
            this.ctx.save();
            this.ctx.globalAlpha = 1.0; 
            this.ctx.fillStyle = baseColor;
            this.ctx.fill();

            // 4. Stroke
            const strokeWidth = (config.renderer.primitives.peckMarkStrokeWidth || 2) / this.core.viewScale;
            this.ctx.lineWidth = strokeWidth;
            this.ctx.strokeStyle = baseColor; 
            this.ctx.stroke();

            // 5. Center Marks (Point Marks)
            const markSize = Math.min(0.5, radius * 0.5);
            this._renderCenterMarks(p1, markSize, '#FFFFFF');
            this._renderCenterMarks(p2, markSize, '#FFFFFF');

            // 6. Connect Centers (Line)
            this.ctx.beginPath();
            this.ctx.moveTo(p1.x, p1.y);
            this.ctx.lineTo(p2.x, p2.y);
            this.ctx.strokeStyle = '#FFFFFF';
            this.ctx.lineWidth = strokeWidth;
            this.ctx.stroke();

            this.ctx.restore();
        }

        // Debug special rendering mode
        renderReconstructedPrimitive(primitive, fillColor) {
            const primColors = this.core.colors.primitives || {};
            const accentColor = primColors.reconstructed;

            this.ctx.save();

            if (primitive.type === 'circle') {
                this.ctx.strokeStyle = accentColor;
                this.ctx.lineWidth = (primitivesConfig.reconstructedStrokeWidth) / this.core.viewScale;
                this.ctx.fillStyle = fillColor + '40';

                this.ctx.beginPath();
                this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, 2 * Math.PI);
                this.ctx.fill();
                this.ctx.stroke();

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
                    !primitive.clockwise // Canvas API
                );
                this.ctx.stroke();
            } else if (primitive.type === 'path') {
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
            // Analytic primitives
            if (primitive.type !== 'path') {
                switch (primitive.type) {
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
                return;
            }

            // PathPrimitive - has contours
            this.renderPath(primitive, fillColor, strokeColor, isPreprocessed);
        }

        renderPath(primitive, fillColor, strokeColor, isPreprocessed) {
            const shouldFill = (primitive.properties?.fill !== false && !primitive.properties?.stroke) || isPreprocessed;
            const shouldStroke = (primitive.properties.stroke === true) && !isPreprocessed;

            // 1. Check for contours array
            if (!primitive.contours || primitive.contours.length === 0) {
                // This primitive has no geometry to render.
                return;
            }

            this.ctx.beginPath();

            // 2. Iterate over all contours in the primitive
            for (const contour of primitive.contours) {
                const points = contour.points;
                const arcSegments = contour.arcSegments || [];

                if (!points || points.length === 0) continue;

                // 3. Use arc/line logic
                if (arcSegments.length > 0) {
                    const sortedArcs = arcSegments.slice().sort((a, b) => a.startIndex - b.startIndex);
                    let currentIndex = 0;

                    this.ctx.moveTo(points[0].x, points[0].y);

                    for (const arc of sortedArcs) {
                        for (let i = currentIndex + 1; i <= arc.startIndex; i++) {
                            this.ctx.lineTo(points[i].x, points[i].y);
                        }
                        // Canvas API uses (anticlockwise: boolean)
                        this.ctx.arc(
                            arc.center.x, arc.center.y, arc.radius,
                            arc.startAngle, arc.endAngle, 
                            !arc.clockwise
                        );
                        currentIndex = arc.endIndex;
                    }

                    const pathClosedByArc = (currentIndex === 0 && sortedArcs.length > 0);
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

                // 4. Close each contour
                this.ctx.closePath();
            }

            // 5. Fill and Stroke (after all contours are on the path)
            if (shouldFill) {
                // Use 'evenodd' to automatically render holes
                const fillRule = 'evenodd';

                if (isPreprocessed) {
                    const polarity = primitive.properties?.polarity;
                    if (polarity === 'clear') {
                        this.ctx.fillStyle = this.core.colors.canvas?.background;
                    } else {
                        this.ctx.fillStyle = fillColor;
                    }
                } else {
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
                !primitive.clockwise // Canvas API
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
                    if (!primitive.contours || primitive.contours.length === 0) {
                        break;
                    }

                    for (const contour of primitive.contours) {
                        const points = contour.points;
                        const arcSegments = contour.arcSegments || [];

                        if (!points || points.length === 0) continue;

                        if (arcSegments.length > 0) {
                            const sortedArcs = arcSegments.slice().sort((a, b) => a.startIndex - b.startIndex);
                            let currentIndex = 0;

                            this.ctx.moveTo(points[0].x, points[0].y);

                            for (const arc of sortedArcs) {
                                for (let i = currentIndex + 1; i <= arc.startIndex; i++) {
                                    this.ctx.lineTo(points[i].x, points[i].y);
                                }
                                this.ctx.arc(
                                    arc.center.x, arc.center.y, arc.radius,
                                    arc.startAngle, arc.endAngle, 
                                    !arc.clockwise // Canvas API
                                );
                                currentIndex = arc.endIndex;
                            }

                            const pathClosedByArc = (currentIndex === 0 && sortedArcs.length > 0);
                            if (!pathClosedByArc) {
                                for (let i = currentIndex + 1; i < points.length; i++) {
                                    this.ctx.lineTo(points[i].x, points[i].y);
                                }
                            }
                        } else {
                            points.forEach((p, i) => {
                                if (i === 0) this.ctx.moveTo(p.x, p.y);
                                else this.ctx.lineTo(p.x, p.y);
                            });
                        }
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
                        !primitive.clockwise // Canvas API
                    );
                    break;
                case 'obround':
                    this.addObroundToBatch(primitive, this.ctx); // Path2D API is compatible with ctx
                    break;
            }

            this.ctx.stroke();
        }

        // Debug Rendering
        renderDebugInfo(primitive, options) {
            if (!primitive) return;

            // Read from contours
            if (options.debugPaths && primitive.contours) {
                for (const contour of primitive.contours) {
                    this.renderArcSegmentDebug(contour);
                }
            }

            if (options.debugPoints && primitive.screenPoints) {
                this.renderCurveDebugPoints(primitive);
            }

            if (options.debugPaths && primitive.contours) {
                this.renderContourDebug(primitive);
            }
        }

        renderCurveDebugPoints(primitive) { // primitive is screen-space data
            if (!primitive.screenPoints) return;

            const pointSize = primitivesConfig.debugPointSize;
            this.ctx.font = primitivesConfig.debugFont;

            this.debugStats.totalPoints = 0;
            this.debugStats.taggedPoints = 0;

            primitive.screenPoints.forEach((p, index) => {
                if (p.curveId === undefined || p.curveId <= 0) return;

                const color = this.getCurveDebugColor(p.curveId);

                this.ctx.fillStyle = color;
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, pointSize, 0, Math.PI * 2);
                this.ctx.fill();

                this.ctx.fillStyle = this.core.colors.primitives.debugLabel;
                this.ctx.strokeStyle = this.core.colors.primitives.debugLabelStroke;
                this.ctx.lineWidth = primitivesConfig.debugLabelLineWidth;
                const segIdx = p.segmentIndex !== undefined ? p.segmentIndex : index;
                const label = `C${p.curveId}:${segIdx}`;
                this.ctx.strokeText(label, p.x + 6, p.y - 6);
                this.ctx.fillText(label, p.x + 6, p.y - 6);

                this.debugStats.taggedPoints++;
            });

            this.debugStats.totalPoints += primitive.screenPoints.length;
        }
        
        // Signature changed to accept a contour
        renderArcSegmentDebug(contour) {
            // Use screen-space arcSegments from the contour
            if (!contour.arcSegments || contour.arcSegments.length === 0) return;

            contour.arcSegments.forEach((segment, idx) => {
                const centerScreen = segment.centerScreen;
                const radiusScreen = segment.radiusScreen;

                if (!centerScreen || radiusScreen === undefined) {
                    console.warn("[RendererPrimitives] Missing screen coords for arc debug", segment);
                    return;
                }

                const hue = ((idx * 137) + 60) % 360;
                const color = `hsl(${hue}, 100%, 50%)`;

                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = primitivesConfig.debugArcStrokeWidth;
                this.ctx.beginPath();

                const startAngle = segment.startAngle;
                const endAngle = segment.endAngle;
                const anticlockwise = !segment.clockwise; // Canvas API

                this.ctx.arc(centerScreen.x, centerScreen.y, radiusScreen,
                            startAngle, endAngle, anticlockwise);
                this.ctx.stroke();

                this.ctx.fillStyle = color;
                this.ctx.beginPath();
                this.ctx.arc(centerScreen.x, centerScreen.y, primitivesConfig.debugArcCenterSize);
                this.ctx.fill();

                this.ctx.fillStyle = this.core.colors.primitives.debugLabel;
                this.ctx.strokeStyle = this.core.colors.primitives.debugLabelStroke;
                this.ctx.lineWidth = primitivesConfig.debugLabelLineWidth;
                this.ctx.font = primitivesConfig.debugFont;

                const angleDeg = Math.abs(segment.sweepAngle) * 180 / Math.PI;
                const label = `Arc ${idx}: r=${segment.radius.toFixed(2)}, ${angleDeg.toFixed(1)}°`;
                this.ctx.strokeText(label, centerScreen.x + 10, centerScreen.y - 10);
                this.ctx.fillText(label, centerScreen.x + 10, centerScreen.y - 10);
            });
        }
        
        renderContourDebug(primitive) { // primitive is screen-space data
            if (!primitive.contours || primitive.contours.length <= 1) return;

            const colors = primitivesConfig.debugContourColors || ['#00ff00', '#ff0000', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];

            primitive.contours.forEach((contour, idx) => {
                if (!contour.screenPoints || contour.screenPoints.length === 0) return;

                const color = colors[contour.nestingLevel % colors.length];
                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = primitivesConfig.debugContourStrokeWidth;
                this.ctx.setLineDash(contour.isHole ? (primitivesConfig.debugContourDash) : []);

                this.ctx.beginPath();
                contour.screenPoints.forEach((p, i) => {
                    if (i === 0) this.ctx.moveTo(p.x, p.y);
                    else this.ctx.lineTo(p.x, p.y);
                });
                this.ctx.closePath();
                this.ctx.stroke();

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