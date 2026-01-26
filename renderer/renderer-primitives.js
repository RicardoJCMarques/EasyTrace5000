/*!
 * @file        renderer/renderer-primitives.js
 * @description Dedicated geometry object definitions
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

/*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2025-2026 Eltryus
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

            // Cache config values
            const pc = primitivesConfig;
            this.cfg = {
                stroke: {
                    offset: pc.offsetStrokeWidth,
                    centerMark: pc.centerMarkStrokeWidth,
                    sourceDrill: pc.sourceDrillStrokeWidth,
                    peckMark: pc.peckMarkStrokeWidth,
                    reconstructed: pc.reconstructedStrokeWidth,
                    debugArc: pc.debugArcStrokeWidth,
                    debugContour: pc.debugContourStrokeWidth,
                    debugLabel: pc.debugLabelLineWidth2
                },
                mark: {
                    drillSize: pc.sourceDrillMarkSize,
                    drillRatio: pc.sourceDrillMarkRatio,
                    peckSize: pc.peckMarkMarkSize,
                    peckRatio: pc.peckMarkMarkRatio
                },
                peck: {
                    dash: pc.peckMarkDash,
                    ringFactor: pc.peckMarkRingFactor
                },
                reconstructed: {
                    centerSize: pc.reconstructedCenterSize,
                    pathDash: pc.reconstructedPathDash
                },
                debug: {
                    pointSize: pc.debugPointSize,
                    font: pc.debugFont,
                    arcCenterSize: pc.debugArcCenterSize,
                    contourDash: pc.debugContourDash
                }
            };

            this.debugStats = {
                totalPoints: 0,
                taggedPoints: 0,
                curvePoints: new Map()
            };
        }

        // ========================================================================
        // Main Dispatcher
        // ========================================================================

        renderPrimitive(primitive, fillColor, strokeColor, isPreprocessed = false, context = {}) {
            const role = primitive.properties?.role;

            if (role) {
                switch (role) {
                    case 'drill_hole':
                    case 'drill_slot':
                        this.renderSourceDrill(primitive, strokeColor);
                        return;
                    case 'peck_mark':
                        this.renderPeckMark(primitive, context);
                        return;
                    case 'drill_milling_path':
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

            if (primitive.properties?.reconstructed) {
                this.renderReconstructedPrimitive(primitive, fillColor);
                return;
            }

            if (this.core.options.showWireframe) {
                this.renderWireframe(primitive);
                return;
            }

            this.renderPrimitiveNormal(primitive, fillColor, strokeColor, isPreprocessed);
        }

        /**
         * Main offset renderer - uses immediate mode for speed.
         * Uses pre-calculated frame cache for scale values.
         */
        renderOffsetPrimitive(primitive, color, context) {
            if (primitive.properties?.isToolPeckMark || primitive.properties?.role === 'peck_mark') {
                this.renderPeckMark(primitive, context);
                return;
            }

            // Use pre-calculated values from frame cache
            const fc = this.core.frameCache;
            const lineWidth = Math.max(this.cfg.stroke.offset * fc.invScale, fc.minWorldWidth);
            const markSize = this.cfg.mark.drillSize;

            // Centerline Slot Path
            if (primitive.properties?.isCenterlinePath) {
                const pts = primitive.contours[0].points;
                const start = pts[0];
                const end = pts[pts.length - 1];
                const toolDiameter = context.toolDiameter || primitive.properties.toolDiameter;
                const radius = toolDiameter / 2;

                const toolRelation = primitive.properties.toolRelation || 'exact';
                const lineColor = this._getStatusColor(toolRelation, color);

                this.ctx.strokeStyle = lineColor;
                this.ctx.lineWidth = lineWidth;
                this.ctx.setLineDash([]);

                // Draw perimeter
                this.ctx.beginPath();
                const dx = end.x - start.x;
                const dy = end.y - start.y;
                const angle = Math.atan2(dy, dx);
                this.ctx.arc(end.x, end.y, radius, angle - Math.PI/2, angle + Math.PI/2, false);
                this.ctx.arc(start.x, start.y, radius, angle + Math.PI/2, angle - Math.PI/2, false);
                this.ctx.closePath();
                this.ctx.stroke();

                // Center line
                this.ctx.beginPath();
                this.ctx.moveTo(start.x, start.y);
                this.ctx.lineTo(end.x, end.y);
                this.ctx.stroke();

                // Crosshairs
                this._renderCenterMarks(start, markSize, lineColor);
                this._renderCenterMarks(end, markSize, lineColor);
                return;
            }

            // Undersized Milling Path
            if (primitive.properties?.role === 'drill_milling_path') {
                const toolRelation = primitive.properties.toolRelation || 'exact';
                const statusColor = this._getStatusColor(toolRelation, color);

                this.ctx.strokeStyle = statusColor;
                this.ctx.lineWidth = lineWidth;
                this.ctx.lineCap = 'round';
                this.ctx.lineJoin = 'round';
                this.ctx.setLineDash([]);

                this._drawPrimitivePath(primitive);
                this.ctx.stroke();

                if (primitive.properties?.originalSlot) {
                    const slot = primitive.properties.originalSlot;
                    this._renderCenterMarks(slot.start, markSize, statusColor);
                    this._renderCenterMarks(slot.end, markSize, statusColor);
                } else if (primitive.center) {
                    this._renderCenterMarks(primitive.center, markSize, statusColor);
                }
                return;
            }

            // Standard Offsets
            const offsetDistance = context.distance || primitive.properties?.offsetDistance || 0;
            const isInternal = offsetDistance < 0;
            const primColors = this.core.colors.primitives;

            const strokeColor = isInternal ? primColors.offsetInternal : (color || primColors.offsetExternal);

            this.ctx.strokeStyle = strokeColor;
            this.ctx.lineWidth = lineWidth;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
            this.ctx.setLineDash([]);

            this._drawPrimitivePath(primitive);
            this.ctx.stroke();

            if (primitive.properties?.originalSlot) {
                const slot = primitive.properties.originalSlot;
                this._renderCenterMarks(slot.start, markSize, strokeColor);
                this._renderCenterMarks(slot.end, markSize, strokeColor);
            }
        }

        renderToolPreview(primitive, color, context) {
            this.ctx.save();

            if (primitive.properties?.role === 'peck_mark') {
                this.renderPeckMark(primitive, context);
                this.ctx.restore();
                return;
            }

            if (primitive.properties?.isCenterlinePath) {
                this.renderCenterlineSlot(primitive, context);
                this.ctx.restore();
                return;
            }

            const toolDiameter = context.toolDiameter || 
                                context.layer?.metadata?.toolDiameter || 
                                primitive.properties?.toolDiameter;

            const fc = this.core.frameCache;
            const lineWidth = Math.max(toolDiameter, fc.minWorldWidth);

            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = lineWidth;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
            this.ctx.setLineDash([]);

            this._drawPrimitivePath(primitive);
            this.ctx.stroke();

            // Yellow center marks for undersized drill ops
            if (primitive.properties?.toolRelation === 'undersized') {
                const warnColor = this.core.colors.primitives.peckMarkWarn;
                const markSize = this.cfg.mark.drillSize;

                if (primitive.properties?.originalSlot) {
                    const slot = primitive.properties.originalSlot;
                    this._renderCenterMarks(slot.start, markSize, warnColor);
                    this._renderCenterMarks(slot.end, markSize, warnColor);
                } else if (primitive.center) {
                    this._renderCenterMarks(primitive.center, markSize, warnColor);
                }
            }

            this.ctx.restore();
        }

        renderSourceDrill(primitive, color) {
            const fc = this.core.frameCache;
            const strokeWidth = Math.max(this.cfg.stroke.sourceDrill * fc.invScale, fc.minWorldWidth);

            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = strokeWidth;

            if (primitive.properties.role === 'drill_hole') {
                const r = primitive.radius;
                this.ctx.beginPath();
                this.ctx.arc(primitive.center.x, primitive.center.y, r, 0, Math.PI * 2);
                this.ctx.stroke();

                const markRatio = this.cfg.mark.drillRatio;
                const maxMarkSize = this.cfg.mark.drillSize;
                const markSize = Math.min(maxMarkSize, r * markRatio);
                this._renderCenterMarks(primitive.center, markSize, color);

            } else if (primitive.properties.role === 'drill_slot') {
                const slot = primitive.properties.originalSlot;
                if (!slot) return;

                const diameter = primitive.properties.diameter;
                const radius = diameter / 2;

                const dx = slot.end.x - slot.start.x;
                const dy = slot.end.y - slot.start.y;
                const angle = Math.atan2(dy, dx);

                this.ctx.beginPath();
                this.ctx.arc(slot.end.x, slot.end.y, radius, angle - Math.PI/2, angle + Math.PI/2, false);
                this.ctx.arc(slot.start.x, slot.start.y, radius, angle + Math.PI/2, angle - Math.PI/2, false);
                this.ctx.closePath();
                this.ctx.stroke();

                const markRatio = this.cfg.mark.drillRatio;
                const maxMarkSize = this.cfg.mark.drillSize;
                const markSize = Math.min(maxMarkSize, radius * markRatio);
                this._renderCenterMarks(slot.start, markSize, color);
                this._renderCenterMarks(slot.end, markSize, color);
            }
        }

        renderPeckMark(primitive, context) {
            const center = primitive.center;
            const radius = primitive.radius;
            const toolRelation = primitive.properties?.toolRelation || 'exact';
            const reducedPlunge = primitive.properties?.reducedPlunge;
            const isPreview = context.layer?.isPreview;

            const baseColor = this._getStatusColor(toolRelation, this.core.colors.primitives.peckMarkGood);
            const fc = this.core.frameCache;
            const strokeWidth = Math.max(this.cfg.stroke.peckMark * fc.invScale, fc.minWorldWidth);

            if (isPreview) {
                this.ctx.save();
                this.ctx.globalAlpha = 1.0;

                this.ctx.fillStyle = baseColor;
                this.ctx.beginPath();
                this.ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
                this.ctx.fill();

                this.ctx.strokeStyle = baseColor;
                this.ctx.lineWidth = strokeWidth;
                this.ctx.stroke();

                const markSize = Math.min(0.5, radius * 0.4);
                this._renderCenterMarks(center, markSize, '#FFFFFF');

                if (reducedPlunge) {
                    this.ctx.strokeStyle = this.core.colors.primitives.peckMarkSlow;
                    this.ctx.lineWidth = strokeWidth;
                    this.ctx.setLineDash(this.cfg.peck.dash);
                    this.ctx.beginPath();
                    this.ctx.arc(center.x, center.y, radius * this.cfg.peck.ringFactor, 0, Math.PI * 2);
                    this.ctx.stroke();
                }
                this.ctx.restore();
                return;
            }

            // Offset/Wireframe mode
            this.ctx.save();
            this.ctx.strokeStyle = baseColor;
            this.ctx.lineWidth = strokeWidth;

            this.ctx.beginPath();
            this.ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
            this.ctx.stroke();

            const markRatio = this.cfg.mark.peckRatio;
            const maxMarkSize = this.cfg.mark.peckSize;
            const markSize = Math.min(maxMarkSize, radius * markRatio);
            this._renderCenterMarks(center, markSize, baseColor);

            if (reducedPlunge) {
                this.ctx.strokeStyle = this.core.colors.primitives.peckMarkSlow;
                this.ctx.setLineDash(this.cfg.peck.dash);
                this.ctx.beginPath();
                this.ctx.arc(center.x, center.y, radius * this.cfg.peck.ringFactor, 0, Math.PI * 2);
                this.ctx.stroke();
            }
            this.ctx.restore();
        }

        renderCenterlineSlot(primitive, context) {
            const pts = primitive.contours[0].points;
            const p1 = pts[0];
            const p2 = pts[1];
            const toolDiameter = context.toolDiameter || primitive.properties.toolDiameter;
            const radius = toolDiameter / 2;

            const toolRelation = primitive.properties.toolRelation || 'exact';
            const baseColor = this._getStatusColor(toolRelation, this.core.colors.primitives.peckMarkGood);

            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const angle = Math.atan2(dy, dx);

            this.ctx.beginPath();
            this.ctx.arc(p2.x, p2.y, radius, angle - Math.PI/2, angle + Math.PI/2, false);
            this.ctx.arc(p1.x, p1.y, radius, angle + Math.PI/2, angle - Math.PI/2, false);
            this.ctx.closePath();

            this.ctx.save();
            this.ctx.globalAlpha = 1.0;
            this.ctx.fillStyle = baseColor;
            this.ctx.fill();

            const fc = this.core.frameCache;
            const strokeWidth = Math.max(this.cfg.stroke.peckMark * fc.invScale, fc.minWorldWidth);
            this.ctx.lineWidth = strokeWidth;
            this.ctx.strokeStyle = baseColor;
            this.ctx.stroke();

            const markSize = Math.min(0.5, radius * 0.5);
            this._renderCenterMarks(p1, markSize, '#FFFFFF');
            this._renderCenterMarks(p2, markSize, '#FFFFFF');

            this.ctx.beginPath();
            this.ctx.moveTo(p1.x, p1.y);
            this.ctx.lineTo(p2.x, p2.y);
            this.ctx.strokeStyle = '#FFFFFF';
            this.ctx.lineWidth = strokeWidth;
            this.ctx.stroke();

            this.ctx.restore();
        }

        // ========================================================================
        // Helper Methods
        // ========================================================================

        _getStatusColor(toolRelation, defaultColor) {
            const primColors = this.core.colors.primitives;
            switch (toolRelation) {
                case 'oversized': return primColors.peckMarkError;
                case 'undersized': return primColors.peckMarkWarn;
                case 'exact': return primColors.peckMarkGood;
                default: return defaultColor;
            }
        }

        _renderCenterMarks(center, markSize, color) {
            const fc = this.core.frameCache;
            const lineWidth = Math.max(this.cfg.stroke.centerMark * fc.invScale, fc.minWorldWidth);

            this.ctx.save();
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = lineWidth;
            this.ctx.beginPath();
            this.ctx.moveTo(center.x - markSize, center.y);
            this.ctx.lineTo(center.x + markSize, center.y);
            this.ctx.moveTo(center.x, center.y - markSize);
            this.ctx.lineTo(center.x, center.y + markSize);
            this.ctx.stroke();
            this.ctx.restore();
        }

        _drawPrimitivePath(primitive) {
            this.ctx.beginPath();
            
            if (primitive.type === 'path') {
                if (primitive.contours && primitive.contours.length > 0) {
                    for (const contour of primitive.contours) {
                        if (!contour.points || contour.points.length === 0) continue;

                        if (contour.arcSegments && contour.arcSegments.length > 0) {
                            const sortedArcs = contour.arcSegments.slice().sort((a, b) => a.startIndex - b.startIndex);
                            let currentIndex = 0;
                            this.ctx.moveTo(contour.points[0].x, contour.points[0].y);

                            for (const arc of sortedArcs) {
                                for (let i = currentIndex + 1; i <= arc.startIndex; i++) {
                                    this.ctx.lineTo(contour.points[i].x, contour.points[i].y);
                                }
                                this.ctx.arc(arc.center.x, arc.center.y, arc.radius,
                                    arc.startAngle, arc.endAngle, !arc.clockwise);
                                currentIndex = arc.endIndex;
                            }

                            if (currentIndex !== 0 || sortedArcs.length === 0) {
                                for (let i = currentIndex + 1; i < contour.points.length; i++) {
                                    this.ctx.lineTo(contour.points[i].x, contour.points[i].y);
                                }
                            }
                        } else {
                            contour.points.forEach((p, i) => {
                                if (i === 0) this.ctx.moveTo(p.x, p.y);
                                else this.ctx.lineTo(p.x, p.y);
                            });
                        }

                        if (primitive.closed !== false) this.ctx.closePath();
                    }
                }
            } else if (primitive.type === 'circle') {
                this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, Math.PI * 2);
                this.ctx.closePath();
            } else if (primitive.type === 'rectangle') {
                this.ctx.rect(primitive.position.x, primitive.position.y, primitive.width, primitive.height);
            } else if (primitive.type === 'arc') {
                this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius,
                    primitive.startAngle, primitive.endAngle, !primitive.clockwise);
            } else if (primitive.type === 'obround') {
                let x = primitive.position.x;
                let y = primitive.position.y;
                const w = primitive.width;
                const h = primitive.height;
                const r = Math.min(w, h) / 2;

                if (primitive.properties?.rotation) {
                    const cx = x + w / 2;
                    const cy = y + h / 2;
                    this.ctx.save();
                    this.ctx.translate(cx, cy);
                    this.ctx.rotate(primitive.properties.rotation * Math.PI / 180);
                    x = -w / 2;
                    y = -h / 2;
                }

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

                if (primitive.properties?.rotation) {
                    this.ctx.restore();
                }
                this.ctx.closePath();
            }
        }

        // ========================================================================
        // Normal Rendering
        // ========================================================================

        renderPrimitiveNormal(primitive, fillColor, strokeColor, isPreprocessed) {
            if (primitive.type !== 'path') {
                switch (primitive.type) {
                    case 'circle':
                        this._renderCircle(primitive, fillColor, strokeColor);
                        break;
                    case 'rectangle':
                        this._renderRectangle(primitive, fillColor, strokeColor);
                        break;
                    case 'arc':
                        this._renderArc(primitive, fillColor, strokeColor);
                        break;
                    case 'obround':
                        this._renderObround(primitive, fillColor, strokeColor);
                        break;
                }
                return;
            }

            this._renderPath(primitive, fillColor, strokeColor, isPreprocessed);
        }

        _renderPath(primitive, fillColor, strokeColor, isPreprocessed) {
            const shouldFill = (primitive.properties?.fill !== false && !primitive.properties?.stroke) || isPreprocessed;
            const shouldStroke = primitive.properties?.stroke === true && !isPreprocessed;

            if (!primitive.contours || primitive.contours.length === 0) return;

            this.ctx.beginPath();

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
                        this.ctx.arc(arc.center.x, arc.center.y, arc.radius,
                            arc.startAngle, arc.endAngle, !arc.clockwise);
                        currentIndex = arc.endIndex;
                    }

                    if (currentIndex !== 0 || sortedArcs.length === 0) {
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

            if (shouldFill) {
                if (isPreprocessed && primitive.properties?.polarity === 'clear') {
                    this.ctx.fillStyle = this.core.colors.canvas?.background;
                } else {
                    this.ctx.fillStyle = fillColor;
                }
                this.ctx.fill('evenodd');
            }

            if (shouldStroke) {
                this.ctx.strokeStyle = strokeColor;
                this.ctx.lineWidth = primitive.properties.strokeWidth;
                this.ctx.lineCap = 'round';
                this.ctx.lineJoin = 'round';
                this.ctx.stroke();
            }
        }

        _renderCircle(primitive, fillColor, strokeColor) {
            this.ctx.beginPath();
            this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, Math.PI * 2);

            if (primitive.properties?.fill !== false) {
                this.ctx.fillStyle = fillColor;
                this.ctx.fill();
            }

            if (primitive.properties?.stroke) {
                this.ctx.strokeStyle = strokeColor;
                this.ctx.lineWidth = primitive.properties.strokeWidth;
                this.ctx.stroke();
            }
        }

        _renderRectangle(primitive, fillColor, strokeColor) {
            if (primitive.properties?.fill !== false) {
                this.ctx.fillStyle = fillColor;
                this.ctx.fillRect(primitive.position.x, primitive.position.y, primitive.width, primitive.height);
            }

            if (primitive.properties?.stroke) {
                this.ctx.strokeStyle = strokeColor;
                this.ctx.lineWidth = primitive.properties.strokeWidth;
                this.ctx.strokeRect(primitive.position.x, primitive.position.y, primitive.width, primitive.height);
            }
        }

        _renderArc(primitive, fillColor, strokeColor) {
            this.ctx.beginPath();
            this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius,
                primitive.startAngle, primitive.endAngle, !primitive.clockwise);

            if (primitive.properties?.fill) {
                this.ctx.closePath();
                this.ctx.fillStyle = fillColor;
                this.ctx.fill();
            }

            this.ctx.strokeStyle = strokeColor;
            this.ctx.lineWidth = primitive.properties.strokeWidth;
            this.ctx.stroke();
        }

        _renderObround(primitive, fillColor, strokeColor) {
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

            if (primitive.properties?.stroke) {
                this.ctx.strokeStyle = strokeColor;
                this.ctx.lineWidth = primitive.properties.strokeWidth;
                this.ctx.stroke();
            }
        }

        // ========================================================================
        // Debug/Reconstructed Rendering
        // ========================================================================

        renderReconstructedPrimitive(primitive, fillColor) {
            const primColors = this.core.colors.primitives || {};
            const accentColor = primColors.reconstructed;
            const fc = this.core.frameCache;

            this.ctx.save();

            if (primitive.type === 'circle') {
                this.ctx.strokeStyle = accentColor;
                this.ctx.lineWidth = this.cfg.stroke.reconstructed * fc.invScale;
                this.ctx.fillStyle = fillColor;

                this.ctx.beginPath();
                this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, 2 * Math.PI);
                this.ctx.fill();
                this.ctx.stroke();

                this.ctx.fillStyle = accentColor;
                this.ctx.beginPath();
                this.ctx.arc(primitive.center.x, primitive.center.y, 
                    this.cfg.reconstructed.centerSize * fc.invScale, 0, 2 * Math.PI);
                this.ctx.fill();
            } else if (primitive.type === 'arc') {
                this.ctx.strokeStyle = accentColor;
                this.ctx.lineWidth = this.cfg.stroke.reconstructed * fc.invScale;

                this.ctx.beginPath();
                this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius,
                    primitive.startAngle, primitive.endAngle, !primitive.clockwise);
                this.ctx.stroke();
            } else if (primitive.type === 'path') {
                this.ctx.strokeStyle = primColors.reconstructedPath;
                this.ctx.lineWidth = this.cfg.stroke.reconstructed * fc.invScale;
                const dash = this.cfg.reconstructed.pathDash;
                this.ctx.setLineDash([dash[0] * fc.invScale, dash[1] * fc.invScale]);

                this.renderPrimitiveNormal(primitive, fillColor, primColors.reconstructedPath);
            }

            this.ctx.restore();
        }

        renderWireframe(primitive) {
            const debugColors = this.core.colors.debug;
            const strokeWidth = this.core.getWireframeStrokeWidth();

            this.ctx.strokeStyle = debugColors.wireframe;
            this.ctx.lineWidth = strokeWidth;
            this.ctx.fillStyle = 'transparent'; // Ensure no fill interferes
            this.ctx.setLineDash([]);

            // The helper calls beginPath() internally
            this._drawPrimitivePath(primitive);

            this.ctx.stroke();
        }

        debug(message, data = null) {
            if (debugConfig.enabled) {
                if (data) console.log(`[Primitives] ${message}`, data);
                else console.log(`[Primitives] ${message}`);
            }
        }
    }

    window.PrimitiveRenderer = PrimitiveRenderer;
})();