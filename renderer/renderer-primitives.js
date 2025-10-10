/**
 * @file        renderer/renderer-primitives.js
 * @description Dedicated geometry object renderer
 * @comment     Fixed: Preview check BEFORE offset check, dedicated preview rendere
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
            
            this.debugStats = {
                totalPoints: 0,
                taggedPoints: 0,
                curvePoints: new Map()
            };
        }
        
        renderPrimitive(primitive, fillColor, strokeColor, isPreprocessed = false, context = {}) {
            this.ctx.save();

            // FIX: Prioritize the context flag from the layer renderer. This ensures that
            // even if a primitive is tagged `isOffset`, if it's being rendered as part
            // of a preview layer, it correctly uses the preview renderer.
            if (context.isPreviewRender) {
                this.renderPreviewPrimitive(primitive, strokeColor, context); 
                this.ctx.restore();
                return;
            }

            // Check preview FIRST before offset (This is now a fallback)
            const isPreview = primitive.properties?.isPreview === true;
            if (isPreview) {
                this.renderPreviewPrimitive(primitive, strokeColor, context); 
                this.ctx.restore();
                return;
            }
            
            // Then check offset
            const isOffset = primitive.properties?.isOffset === true;
            if (isOffset) {
                if (debugConfig.enabled && debugConfig.logging?.renderOperations) {
                    console.log('[Renderer] Rendering offset primitive:', primitive.type, primitive.properties);
                }
                this.renderOffsetPrimitive(primitive, fillColor, strokeColor);
                this.ctx.restore();
                return;
            }
            
            // Check reconstructed
            const isReconstructed = primitive.properties?.reconstructed === true;
            if (isReconstructed) {
                this.renderReconstructedPrimitive(primitive, fillColor, strokeColor);
                this.ctx.restore();
                return;
            }
            
            // Normal rendering
            this.ctx.fillStyle = fillColor;
            this.ctx.strokeStyle = strokeColor;
            
            if (this.core.options.showWireframe) {
                this.ctx.lineWidth = this.core.getWireframeStrokeWidth();
                this.renderPrimitiveWireframe(primitive);
            } else {
                this.renderPrimitiveNormal(primitive, fillColor, strokeColor, isPreprocessed);
            }
            
            this.ctx.restore();
        }
        
        // Dedicated preview renderer using tool diameter
        renderPreviewPrimitive(primitive, strokeColor, context = {}) {
            const toolDiameter = context.toolDiameter;
            
            if (typeof toolDiameter === 'undefined' || toolDiameter <= 0) {
                console.warn(`[Renderer] Preview rendering skipped: Invalid tool diameter (${toolDiameter})`);
                return;
            }

            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
            
            if (primitive.properties?.isDrillPreview) {
                this.ctx.fillStyle = strokeColor;
                this.ctx.strokeStyle = 'transparent';
                this.ctx.beginPath();
                this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, 2 * Math.PI);
                this.ctx.fill();
            } else {
                this.ctx.fillStyle = 'transparent';
                this.ctx.strokeStyle = strokeColor;
                this.ctx.lineWidth = toolDiameter;

                if (primitive.type === 'path') {
                    if (primitive.contours && primitive.contours.length > 0) {
                        primitive.contours.forEach(contour => {
                            if (!contour.points || contour.points.length < 2) return;
                            
                            this.ctx.beginPath();
                            contour.points.forEach((p, i) => {
                                if (i === 0) this.ctx.moveTo(p.x, p.y);
                                else this.ctx.lineTo(p.x, p.y);
                            });
                            // All paths from boolean operations are closed polygons.
                            this.ctx.closePath();
                            this.ctx.stroke();
                        });
                    }
                    
                } else if (primitive.type === 'circle') {
                    this.ctx.beginPath();
                    this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, 2 * Math.PI);
                    this.ctx.stroke();
                } else if (primitive.type === 'arc') {
                    this.ctx.beginPath();
                    this.ctx.arc(
                        primitive.center.x, primitive.center.y, primitive.radius,
                        primitive.startAngle, primitive.endAngle, primitive.clockwise
                    );
                    this.ctx.stroke();
                }
            }
        }

        
        // Offset rendering with correct stroke width
        renderOffsetPrimitive(primitive, fillColor, strokeColor) {
            this.ctx.save();
            
            this.ctx.lineWidth = 2 / this.core.viewScale;
            const offsetDistance = primitive.properties?.offsetDistance || 0;
            const isInternal = offsetDistance < 0;
            this.ctx.strokeStyle = isInternal ? '#00aa00ff' : strokeColor;
            this.ctx.fillStyle = 'transparent';
            
            if (primitive.type === 'path' && primitive.contours && primitive.contours.length > 0) {
                // --- FIX: Iterate through all contours (outers and holes) and stroke them ---
                primitive.contours.forEach(contour => {
                    if (!contour.points || contour.points.length < 2) return;
                    
                    // Note: We don't need to check for arcSegments here because offsets are polygonized.
                    this.ctx.beginPath();
                    contour.points.forEach((p, i) => {
                        if (i === 0) this.ctx.moveTo(p.x, p.y);
                        else this.ctx.lineTo(p.x, p.y);
                    });
                    this.ctx.closePath();
                    this.ctx.stroke();
                });
            } else if (primitive.type === 'circle') {
                this.ctx.beginPath();
                this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, 2 * Math.PI);
                this.ctx.stroke();
            } else if (primitive.type === 'arc') {
                this.ctx.beginPath();
                this.ctx.arc(
                    primitive.center.x, primitive.center.y, primitive.radius,
                    primitive.startAngle, primitive.endAngle, primitive.clockwise
                );
                this.ctx.stroke();
            }
            
            this.ctx.restore();
        }

        
        // Hybrid path rendering - ensure complete arc coverage
        renderHybridPath(primitive, fillColor, strokeColor) {
            const path2d = new Path2D();
            const points = primitive.points;
            
            if (!points || points.length === 0) return;
            
            const segments = (primitive.arcSegments || []).slice().sort((a, b) => a.startIndex - b.startIndex);
            
            let currentIndex = 0;
            path2d.moveTo(points[0].x, points[0].y);
            currentIndex = 1;
            
            for (const arc of segments) {
                // FIXED: Only render lines up to arc start (not including it)
                for (let i = currentIndex; i < arc.startIndex; i++) {
                    if (points[i]) path2d.lineTo(points[i].x, points[i].y);
                }
                
                // Move to arc start if not already there
                if (currentIndex <= arc.startIndex && points[arc.startIndex]) {
                    path2d.lineTo(points[arc.startIndex].x, points[arc.startIndex].y);
                }
                
                // Render arc
                path2d.arc(
                    arc.center.x, arc.center.y, arc.radius,
                    arc.startAngle, arc.endAngle, arc.clockwise
                );
                
                // Skip all interpolated points covered by arc
                currentIndex = arc.endIndex + 1;
            }
            
            // Render remaining lines after last arc
            for (let i = currentIndex; i < points.length; i++) {
                if (points[i]) path2d.lineTo(points[i].x, points[i].y);
            }
            
            if (primitive.contours && primitive.contours.length > 0) {
                primitive.contours.forEach(hole => {
                    if (hole.length > 0) {
                        path2d.moveTo(hole[0].x, hole[0].y);
                        for (let i = 1; i < hole.length; i++) {
                            path2d.lineTo(hole[i].x, hole[i].y);
                        }
                        path2d.closePath();
                    }
                });
            }
            
            if (primitive.closed !== false) {
                path2d.closePath();
            }
            
            if (primitive.properties?.fill !== false) {
                this.ctx.fillStyle = fillColor;
                this.ctx.fill(path2d, 'nonzero');
            }
            
            if (primitive.properties?.stroke) {
                this.ctx.strokeStyle = strokeColor;
                this.ctx.lineWidth = primitive.properties.strokeWidth || 0.1;
                this.ctx.stroke(path2d);
            }
        }
        
        renderHybridPathStrokeOnly(primitive, strokeColor) {
            const path2d = new Path2D();
            const points = primitive.points;
            
            if (!points || points.length === 0) return;
            
            const segments = (primitive.arcSegments || []).slice().sort((a, b) => a.startIndex - b.startIndex);
            
            let currentIndex = 0;
            path2d.moveTo(points[0].x, points[0].y);
            currentIndex = 1;
            
            for (const arc of segments) {
                // Only render lines up to arc start
                for (let i = currentIndex; i < arc.startIndex; i++) {
                    if (points[i]) path2d.lineTo(points[i].x, points[i].y);
                }
                
                if (currentIndex <= arc.startIndex && points[arc.startIndex]) {
                    path2d.lineTo(points[arc.startIndex].x, points[arc.startIndex].y);
                }
                
                path2d.arc(
                    arc.center.x, arc.center.y, arc.radius,
                    arc.startAngle, arc.endAngle, arc.clockwise
                );
                
                currentIndex = arc.endIndex + 1;
            }
            
            for (let i = currentIndex; i < points.length; i++) {
                if (points[i]) path2d.lineTo(points[i].x, points[i].y);
            }
            
            if (primitive.closed !== false) {
                path2d.closePath();
            }
            
            this.ctx.strokeStyle = strokeColor;
            this.ctx.stroke(path2d);
        }
        
        renderCurveMetadataDebug(primitive) {
            if (!primitive) return;

            // --- DATA NORMALIZATION (FIX for Traces and simple paths) ---
            // Ensure that ANY path primitive has a contours array to iterate over.
            // This handles simple 2-point traces that don't auto-generate contours.
            if (primitive.type === 'path' && (!primitive.contours || primitive.contours.length === 0) && primitive.points?.length > 0) {
                primitive.contours = [{
                    points: primitive.points,
                    isHole: false,
                    nestingLevel: 0
                }];
            }

            // --- UTILITY FUNCTIONS (Self-contained for portability) ---

            const calculateSignedArea = (points) => {
                if (!points || points.length < 3) return 0;
                let area = 0;
                for (let i = 0; i < points.length; i++) {
                    const j = (i + 1) % points.length;
                    area += points[i].x * points[j].y;
                    area -= points[j].x * points[i].y;
                }
                return area / 2;
            };

            const drawPointAndLabel = (cx, cy, label, styles) => {
                // Point
                this.ctx.fillStyle = styles.color;
                this.ctx.beginPath();
                this.ctx.arc(cx, cy, styles.radius, 0, 2 * Math.PI);
                this.ctx.fill();
                if (styles.stroke) {
                    this.ctx.strokeStyle = styles.stroke;
                    this.ctx.lineWidth = 1;
                    this.ctx.stroke();
                }

                // Label
                if (label) {
                    this.ctx.fillStyle = '#FFFFFF';
                    this.ctx.strokeStyle = '#000000';
                    this.ctx.lineWidth = 2;
                    this.ctx.font = styles.font;
                    this.ctx.strokeText(label, cx + styles.offset, cy - styles.offset);
                    this.ctx.fillText(label, cx + styles.offset, cy - styles.offset);
                }
            };

            // --- RENDERER SETUP ---
            this.ctx.save();
            this.ctx.setTransform(1, 0, 0, 1, 0, 0); // Work in screen space

            const stats = {
                primitiveId: primitive.id,
                type: primitive.type,
                contours: 0,
                totalPoints: 0,
                area: 0,
                winding: 'N/A'
            };

            const pointStyles = {
                default: { radius: 3, font: '10px monospace', offset: 6, color: 'rgba(200, 200, 200, 0.8)', stroke: '#000000' },
                start:   { radius: 5, font: 'bold 12px monospace', offset: 8, color: '#00FF00', stroke: '#FFFFFF' },
                center:  { radius: 4, font: 'bold 12px monospace', offset: 8, color: '#FF00FF', stroke: '#FFFFFF' },
                curve:   { radius: 4, font: '11px monospace', offset: 8, stroke: '#000000' } // color is dynamic
            };

            const windingColors = {
                ccw: 'rgba(0, 255, 0, 0.7)',  // Green for Counter-Clockwise (typically solid)
                cw:  'rgba(255, 0, 0, 0.7)',  // Red for Clockwise (typically hole)
                open: 'rgba(255, 255, 0, 0.7)' // Yellow for open paths
            };


            // --- RENDERING PIPELINE ---

            // 1. Render Path Winding and Analytic Shape Guides
            this.ctx.lineWidth = 2;
            if (primitive.type === 'path' && primitive.contours) {
                stats.contours = primitive.contours.length;
                primitive.contours.forEach((contour, contourIdx) => {
                    if (!contour.points || contour.points.length < 2) return;

                    const area = calculateSignedArea(contour.points);
                    // A path is closed unless explicitly false. Traces are open.
                    const isClosed = primitive.closed !== false && !primitive.properties?.isTrace;
                    
                    if (contourIdx === 0) { // Store stats for the main contour
                        stats.area = Math.abs(area);
                        stats.winding = isClosed ? (area > 0 ? 'CW' : 'CCW') : 'Open';
                    }

                    this.ctx.strokeStyle = isClosed ? (area > 0 ? windingColors.cw : windingColors.ccw) : windingColors.open;
                    this.ctx.setLineDash(contour.isHole ? [5, 5] : []);

                    this.ctx.beginPath();
                    contour.points.forEach((p, i) => {
                        const cx = this.core.worldToCanvasX(p.x);
                        const cy = this.core.worldToCanvasY(p.y);
                        if (i === 0) this.ctx.moveTo(cx, cy);
                        else this.ctx.lineTo(cx, cy);
                    });

                    if (isClosed) this.ctx.closePath();
                    this.ctx.stroke();
                });
            } else { // Guides for non-path primitives
                this.ctx.strokeStyle = 'rgba(100, 100, 255, 0.5)';
                this.ctx.setLineDash([3, 3]);
                this.ctx.beginPath();
                switch(primitive.type) {
                    case 'circle': {
                        const cx = this.core.worldToCanvasX(primitive.center.x);
                        const cy = this.core.worldToCanvasY(primitive.center.y);
                        const r = primitive.radius * this.core.viewScale;
                        this.ctx.arc(cx, cy, r, 0, 2 * Math.PI);
                        break;
                    }
                    case 'arc': {
                        const cx = this.core.worldToCanvasX(primitive.center.x);
                        const cy = this.core.worldToCanvasY(primitive.center.y);
                        const r = primitive.radius * this.core.viewScale;
                        this.ctx.arc(cx, cy, r, -primitive.startAngle, -primitive.endAngle, !primitive.clockwise);
                        break;
                    }
                    case 'rectangle': {
                        const cx = this.core.worldToCanvasX(primitive.position.x);
                        const cy = this.core.worldToCanvasY(primitive.position.y);
                        const cw = primitive.width * this.core.viewScale;
                        const ch = -primitive.height * this.core.viewScale; // Y is inverted
                        this.ctx.rect(cx, cy, cw, ch);
                        break;
                    }
                }
                this.ctx.stroke();
            }
            this.ctx.setLineDash([]);


            // 2. Render Detected Arc Segments (if any)
            if (primitive.arcSegments && primitive.arcSegments.length > 0) {
                this.renderDetectedArcSegments(primitive);
            }


            // 3. Collect and Render ALL Defining Points
            const allPoints = [];
            if (primitive.type === 'path' && primitive.contours) {
                primitive.contours.forEach(contour => {
                    stats.totalPoints += contour.points.length;
                    contour.points.forEach((p, i) => {
                        allPoints.push({ point: p, index: i, contour: contour });
                    });
                });
            } else if (primitive.type === 'circle') {
                stats.totalPoints = 1;
                allPoints.push({ point: primitive.center, type: 'center' });
            } else if (primitive.type === 'arc') {
                stats.totalPoints = 3;
                allPoints.push({ point: primitive.center, type: 'center' });
                allPoints.push({ point: primitive.startPoint, type: 'start' });
                allPoints.push({ point: primitive.endPoint, type: 'end' });
            } else if (primitive.type === 'rectangle') {
                stats.totalPoints = 4;
                const p = primitive.position;
                const w = primitive.width;
                const h = primitive.height;
                allPoints.push({ point: { x: p.x, y: p.y }, index: 0 });
                allPoints.push({ point: { x: p.x + w, y: p.y }, index: 1 });
                allPoints.push({ point: { x: p.x + w, y: p.y + h }, index: 2 });
                allPoints.push({ point: { x: p.x, y: p.y + h }, index: 3 });
            } else if (primitive.type === 'obround') {
                const p = primitive.position;
                const w = primitive.width;
                const h = primitive.height;
                const r = Math.min(w, h) / 2;
                if (primitive.isCircular) {
                    stats.totalPoints = 1;
                    const center = { x: p.x + w/2, y: p.y + h/2 };
                    allPoints.push({ point: center, type: 'center' });
                } else {
                    stats.totalPoints = 2; // Obrounds are defined by two centers
                    if (w > h) { // Horizontal
                        allPoints.push({ point: { x: p.x + r, y: p.y + r }, type: 'center' });
                        allPoints.push({ point: { x: p.x + w - r, y: p.y + r }, type: 'center' });
                    } else { // Vertical
                        allPoints.push({ point: { x: p.x + r, y: p.y + r }, type: 'center' });
                        allPoints.push({ point: { x: p.x + r, y: p.y + h - r }, type: 'center' });
                    }
                }
            }

            allPoints.forEach(item => {
                const { point, index, contour, type } = item;
                const canvasX = this.core.worldToCanvasX(point.x);
                const canvasY = this.core.worldToCanvasY(point.y);
                let label = '';
                let style = { ...pointStyles.default };

                if (point.curveId !== undefined && point.curveId > 0) {
                    const hue = (point.curveId * 137) % 360;
                    style = { ...pointStyles.curve, color: `hsl(${hue}, 100%, 50%)` };
                    label = `C${point.curveId}:${point.segmentIndex}`;
                } else if (type === 'center') {
                    style = { ...pointStyles.center };
                    label = 'C';
                } else if (index === 0 && contour) {
                    style = { ...pointStyles.start };
                    label = `S (L${contour.nestingLevel})`;
                } else {
                    label = `${index}`;
                }
                
                drawPointAndLabel(canvasX, canvasY, label, style);
            });


            this.ctx.restore();
        }
        
        renderDetectedArcSegments(primitive) {
            if (!primitive.arcSegments || primitive.arcSegments.length === 0) return;
            
            this.ctx.save();
            
            primitive.arcSegments.forEach((segment, idx) => {
                const centerX = this.core.worldToCanvasX(segment.center.x);
                const centerY = this.core.worldToCanvasY(segment.center.y);
                const radiusCanvas = segment.radius * this.core.viewScale;
                
                const hue = ((idx * 137) + 60) % 360;
                const color = `hsl(${hue}, 100%, 50%)`;
                
                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = 5;
                this.ctx.setLineDash([]);
                this.ctx.globalAlpha = 0.8;
                
                this.ctx.beginPath();
                const startAngle = -segment.startAngle;
                const endAngle = -segment.endAngle;
                this.ctx.arc(centerX, centerY, radiusCanvas, endAngle, startAngle, segment.clockwise);
                this.ctx.stroke();
                
                this.ctx.fillStyle = color;
                this.ctx.globalAlpha = 1.0;
                this.ctx.beginPath();
                this.ctx.arc(centerX, centerY, 4, 0, 2 * Math.PI);
                this.ctx.fill();
                
                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = 2;
                this.ctx.setLineDash([4, 4]);
                this.ctx.globalAlpha = 0.6;
                
                const startX = centerX + radiusCanvas * Math.cos(-segment.startAngle);
                const startY = centerY + radiusCanvas * Math.sin(-segment.startAngle);
                this.ctx.beginPath();
                this.ctx.moveTo(centerX, centerY);
                this.ctx.lineTo(startX, startY);
                this.ctx.stroke();
                
                this.ctx.fillStyle = '#00FF00';
                this.ctx.globalAlpha = 1.0;
                this.ctx.beginPath();
                this.ctx.arc(startX, startY, 5, 0, 2 * Math.PI);
                this.ctx.fill();
                
                const endX = centerX + radiusCanvas * Math.cos(-segment.endAngle);
                const endY = centerY + radiusCanvas * Math.sin(-segment.endAngle);
                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = 2;
                this.ctx.setLineDash([4, 4]);
                this.ctx.globalAlpha = 0.6;
                this.ctx.beginPath();
                this.ctx.moveTo(centerX, centerY);
                this.ctx.lineTo(endX, endY);
                this.ctx.stroke();
                
                this.ctx.fillStyle = '#FF0000';
                this.ctx.globalAlpha = 1.0;
                this.ctx.beginPath();
                this.ctx.arc(endX, endY, 5, 0, 2 * Math.PI);
                this.ctx.fill();
                
                this.ctx.fillStyle = '#FFFFFF';
                this.ctx.strokeStyle = '#000000';
                this.ctx.lineWidth = 3;
                this.ctx.font = 'bold 12px monospace';
                this.ctx.globalAlpha = 1.0;
                this.ctx.setLineDash([]);
                
                const sweepAngle = segment.sweepAngle || (segment.endAngle - segment.startAngle);
                const angleDeg = Math.abs(sweepAngle) * 180 / Math.PI;
                const dirLabel = segment.clockwise ? 'CW' : 'CCW';
                const label = `Arc ${idx + 1}: r=${segment.radius.toFixed(2)}, ${angleDeg.toFixed(1)}° ${dirLabel}, ${segment.pointCount} pts`;
                
                const labelX = centerX + 10;
                const labelY = centerY - 10 - (idx * 15);
                this.ctx.strokeText(label, labelX, labelY);
                this.ctx.fillText(label, labelX, labelY);
                
                if (primitive.points[segment.startIndex]) {
                    const p = primitive.points[segment.startIndex];
                    const px = this.core.worldToCanvasX(p.x);
                    const py = this.core.worldToCanvasY(p.y);
                    
                    this.ctx.fillStyle = '#00FF00';
                    this.ctx.font = 'bold 10px monospace';
                    this.ctx.strokeText(`S[${segment.startIndex}]`, px + 8, py - 8);
                    this.ctx.fillText(`S[${segment.startIndex}]`, px + 8, py - 8);
                }
                
                if (primitive.points[segment.endIndex]) {
                    const p = primitive.points[segment.endIndex];
                    const px = this.core.worldToCanvasX(p.x);
                    const py = this.core.worldToCanvasY(p.y);
                    
                    this.ctx.fillStyle = '#FF0000';
                    this.ctx.font = 'bold 10px monospace';
                    this.ctx.strokeText(`E[${segment.endIndex}]`, px + 8, py - 8);
                    this.ctx.fillText(`E[${segment.endIndex}]`, px + 8, py - 8);
                }
            });
            
            this.ctx.restore();
        }
        
        renderReconstructedPrimitive(primitive, fillColor, strokeColor) {
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            
            const accentColor = '#00ffff';
            const glowColor = '#00ff00';
            
            this.ctx.save();
            
            this.ctx.shadowColor = glowColor;
            this.ctx.shadowBlur = 10 / this.core.viewScale;
            
            if (primitive.type === 'circle') {
                this.ctx.strokeStyle = accentColor;
                this.ctx.lineWidth = 2 / this.core.viewScale;
                this.ctx.fillStyle = fillColor + '40';
                
                this.ctx.beginPath();
                this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, 2 * Math.PI);
                this.ctx.fill();
                this.ctx.stroke();
                
                this.ctx.fillStyle = accentColor;
                this.ctx.beginPath();
                this.ctx.arc(primitive.center.x, primitive.center.y, 2 / this.core.viewScale, 0, 2 * Math.PI);
                this.ctx.fill();
            } else if (primitive.type === 'arc') {
                this.ctx.strokeStyle = accentColor;
                this.ctx.lineWidth = 2 / this.core.viewScale;
                
                this.ctx.beginPath();
                this.ctx.arc(
                    primitive.center.x,
                    primitive.center.y,
                    primitive.radius,
                    primitive.startAngle,
                    primitive.endAngle,
                    primitive.clockwise
                );
                this.ctx.stroke();
                
                this.ctx.fillStyle = accentColor;
                
                const startX = primitive.center.x + primitive.radius * Math.cos(primitive.startAngle);
                const startY = primitive.center.y + primitive.radius * Math.sin(primitive.startAngle);
                this.ctx.beginPath();
                this.ctx.arc(startX, startY, 3 / this.core.viewScale, 0, 2 * Math.PI);
                this.ctx.fill();
                
                const endX = primitive.center.x + primitive.radius * Math.cos(primitive.endAngle);
                const endY = primitive.center.y + primitive.radius * Math.sin(primitive.endAngle);
                this.ctx.beginPath();
                this.ctx.arc(endX, endY, 3 / this.core.viewScale, 0, 2 * Math.PI);
                this.ctx.fill();
            } else if (primitive.type === 'path' && primitive.properties?.wasPartial) {
                this.ctx.strokeStyle = '#ffff00';
                this.ctx.lineWidth = 2 / this.core.viewScale;
                this.ctx.setLineDash([5 / this.core.viewScale, 5 / this.core.viewScale]);
                
                this.renderPathNormal(primitive, primitive.properties, fillColor + '40', '#ffff00', false);
            }
            
            this.ctx.restore();
            
            if (debugConfig.enabled && primitive.properties?.originalCurveId) {
                this.ctx.save();
                this.ctx.setTransform(1, 0, 0, 1, 0, 0);
                this.ctx.fillStyle = accentColor;
                this.ctx.font = '10px monospace';
                
                let labelPos;
                if (primitive.type === 'circle') {
                    labelPos = this.core.worldToCanvasX(primitive.center.x);
                    const y = this.core.worldToCanvasY(primitive.center.y);
                    this.ctx.fillText(`C${primitive.properties.originalCurveId}`, labelPos, y);
                } else if (primitive.type === 'arc') {
                    const midAngle = (primitive.startAngle + primitive.endAngle) / 2;
                    const midX = primitive.center.x + primitive.radius * Math.cos(midAngle);
                    const midY = primitive.center.y + primitive.radius * Math.sin(midAngle);
                    labelPos = this.core.worldToCanvasX(midX);
                    const y = this.core.worldToCanvasY(midY);
                    this.ctx.fillText(`A${primitive.properties.originalCurveId}`, labelPos, y);
                }
                
                this.ctx.restore();
            }
        }
        
        renderPrimitiveNormal(primitive, fillColor, strokeColor, isPreprocessed = false) {
            const props = primitive.properties || {};
            
            switch (primitive.type) {
                case 'path':
                    this.renderPathNormal(primitive, props, fillColor, strokeColor, isPreprocessed);
                    break;
                case 'circle':
                    this.renderCircleNormal(primitive, props, fillColor, strokeColor);
                    break;
                case 'rectangle':
                    this.renderRectangleNormal(primitive, props, fillColor, strokeColor);
                    break;
                case 'obround':
                    this.renderObroundNormal(primitive, props, fillColor, strokeColor);
                    break;
                case 'arc':
                    this.renderArcNormal(primitive, props, strokeColor);
                    break;
            }
        }
        
        renderPathNormal(primitive, props, fillColor, strokeColor, isPreprocessed = false) {
            if (props.hasReconstructedArcs && primitive.arcSegments?.length > 0) {
                this.renderHybridPath(primitive, fillColor, strokeColor);
                return;
            }
            
            if (isPreprocessed) {
                this.renderSimplePath(primitive, props, fillColor);
                return;
            }

            // UNIFIED CONTOURS CHECK
            const hasNested = primitive.contours && primitive.contours.length > 1;
            
            if (hasNested) {
                this.renderCompoundPath(primitive, props, fillColor, strokeColor);
            } else if (props.isRegion) {
                this.renderRegion(primitive, props, fillColor);
            } else if (props.isTrace || props.isBranchSegment || props.isConnectedPath || 
                    (props.stroke && props.strokeWidth && !props.fill)) {
                this.renderTrace(primitive, props, strokeColor);
            } else if (props.fill !== false) {
                this.renderSimplePath(primitive, props, fillColor);
            }

            // Debug: Render individual contours if enabled
            if (this.core.options.debugCurvePoints && props.contours && Array.isArray(props.contours)) {
                this.ctx.save();
                this.ctx.lineWidth = 2 / this.core.viewScale;
                
                props.contours.forEach((contour, idx) => {
                    // Color based on nesting level
                    const colors = ['#00ff00', '#ff0000', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
                    this.ctx.strokeStyle = colors[contour.nestingLevel % colors.length];
                    
                    this.ctx.beginPath();
                    contour.points.forEach((p, i) => {
                        if (i === 0) this.ctx.moveTo(p.x, p.y);
                        else this.ctx.lineTo(p.x, p.y);
                    });
                    this.ctx.closePath();
                    this.ctx.stroke();
                    
                    // Label the contour
                    if (contour.points.length > 0) {
                        const labelPos = contour.points[0];
                        this.ctx.fillStyle = '#ffffff';
                        this.ctx.font = '12px monospace';
                        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
                        const canvasX = this.core.worldToCanvasX(labelPos.x);
                        const canvasY = this.core.worldToCanvasY(labelPos.y);
                        const label = `L${contour.nestingLevel}${contour.isHole ? 'H' : ''}`;
                        this.ctx.fillText(label, canvasX + 5, canvasY - 5);
                    }
                });
                
                this.ctx.restore();
            }
        }
        
        renderCompoundPath(primitive, props, fillColor, strokeColor) {
            const path2d = new Path2D();
            
            // Render all contours
            primitive.contours.forEach(contour => {
                const pts = contour.points;
                if (!pts || pts.length < 3) return;
                
                pts.forEach((p, i) => {
                    if (i === 0) path2d.moveTo(p.x, p.y);
                    else path2d.lineTo(p.x, p.y);
                });
                path2d.closePath();
            });
            
            this.ctx.fillStyle = fillColor;
            this.ctx.fill(path2d, 'nonzero');
            
            // Debug visualization if enabled
            if (this.core.options.debugCurvePoints && primitive.contours.length > 1) {
                this.renderContourDebug(primitive);
            }
            
            this.core.renderStats.holesRendered += (primitive.contours.length - 1);
        }

        renderContourDebug(primitive) {
            this.ctx.save();
            this.ctx.lineWidth = 2 / this.core.viewScale;
            
            const colors = ['#00ff00', '#ff0000', '#0000ff', '#ffff00', '#ff00ff'];
            
            primitive.contours.forEach(contour => {
                const color = colors[contour.nestingLevel % colors.length];
                this.ctx.strokeStyle = color;
                
                this.ctx.beginPath();
                contour.points.forEach((p, i) => {
                    if (i === 0) this.ctx.moveTo(p.x, p.y);
                    else this.ctx.lineTo(p.x, p.y);
                });
                this.ctx.closePath();
                this.ctx.stroke();
                
                // Label
                if (contour.points.length > 0) {
                    const labelPos = contour.points[0];
                    this.ctx.fillStyle = '#ffffff';
                    this.ctx.font = '12px monospace';
                    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
                    const canvasX = this.core.worldToCanvasX(labelPos.x);
                    const canvasY = this.core.worldToCanvasY(labelPos.y);
                    const label = `L${contour.nestingLevel}${contour.isHole ? 'H' : ''}`;
                    this.ctx.fillText(label, canvasX + 5, canvasY - 5);
                }
            });
            
            this.ctx.restore();
        }
        
        renderRegion(primitive, props, fillColor) {
            this.ctx.fillStyle = fillColor;
            this.ctx.beginPath();
            
            primitive.points.forEach((point, index) => {
                if (index === 0) {
                    this.ctx.moveTo(point.x, point.y);
                } else {
                    this.ctx.lineTo(point.x, point.y);
                }
            });
            
            if (primitive.closed) {
                this.ctx.closePath();
            }
            
            const fillRule = props.fillRule || 'nonzero';
            this.ctx.fill(fillRule);
        }
        
        renderTrace(primitive, props, strokeColor) {
            this.ctx.strokeStyle = strokeColor;
            this.ctx.lineWidth = props.strokeWidth || 0.1;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
            
            this.ctx.beginPath();
            primitive.points.forEach((point, index) => {
                if (index === 0) {
                    this.ctx.moveTo(point.x, point.y);
                } else {
                    this.ctx.lineTo(point.x, point.y);
                }
            });
            
            if (primitive.closed) {
                this.ctx.closePath();
            }
            
            this.ctx.stroke();
        }
        
        renderSimplePath(primitive, props, fillColor) {
            this.ctx.fillStyle = fillColor;
            this.ctx.beginPath();
            
            primitive.points.forEach((point, index) => {
                if (index === 0) {
                    this.ctx.moveTo(point.x, point.y);
                } else {
                    this.ctx.lineTo(point.x, point.y);
                }
            });
            
            if (primitive.closed !== false) {
                this.ctx.closePath();
            }
            
            this.ctx.fill();
        }
        
        // Drill rendering using diameter property
        renderCircleNormal(primitive, props, fillColor, strokeColor) {
            this.ctx.beginPath();
            
            // Special rendering for drill holes
            if (props.isDrillHole) {
                // Use the primitive's actual radius - it was already calculated correctly
                const displayRadius = primitive.radius;
                
                // Draw outline
                this.ctx.arc(primitive.center.x, primitive.center.y, displayRadius, 0, 2 * Math.PI);
                this.ctx.strokeStyle = strokeColor;
                this.ctx.lineWidth = this.core.getWireframeStrokeWidth();
                this.ctx.stroke();
                
                // Draw center mark
                const markSize = Math.min(0.2, displayRadius * 0.4);
                this.ctx.beginPath();
                this.ctx.moveTo(primitive.center.x - markSize, primitive.center.y);
                this.ctx.lineTo(primitive.center.x + markSize, primitive.center.y);
                this.ctx.moveTo(primitive.center.x, primitive.center.y - markSize);
                this.ctx.lineTo(primitive.center.x, primitive.center.y + markSize);
                this.ctx.stroke();
                return;
            }
            
            // Normal circle rendering continues...
            this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, 2 * Math.PI);
            
            if (props.isBranchJunction || props.isFlash || props.fill !== false) {
                this.ctx.fillStyle = fillColor;
                this.ctx.fill();
            }
            
            if (props.stroke) {
                this.ctx.lineWidth = props.strokeWidth || 0.1;
                this.ctx.strokeStyle = strokeColor;
                this.ctx.stroke();
            }
        }
        
        renderRectangleNormal(primitive, props, fillColor, strokeColor) {
            if (props.fill !== false) {
                this.ctx.fillStyle = fillColor;
                this.ctx.fillRect(primitive.position.x, primitive.position.y, primitive.width, primitive.height);
            }
            
            if (props.stroke) {
                this.ctx.lineWidth = props.strokeWidth || 0.1;
                this.ctx.strokeStyle = strokeColor;
                this.ctx.strokeRect(primitive.position.x, primitive.position.y, primitive.width, primitive.height);
            }
        }
        
        renderObroundNormal(primitive, props, fillColor, strokeColor) {
            const x = primitive.position.x;
            const y = primitive.position.y;
            const w = primitive.width;
            const h = primitive.height;
            const r = Math.min(w, h) / 2;
            
            this.ctx.beginPath();
            
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
            
            this.ctx.closePath();
            
            if (props.fill !== false) {
                this.ctx.fillStyle = fillColor;
                this.ctx.fill();
            }
            
            if (props.stroke) {
                this.ctx.lineWidth = props.strokeWidth || 0.1;
                this.ctx.strokeStyle = strokeColor;
                this.ctx.stroke();
            }
        }
        
        renderArcNormal(primitive, props, strokeColor) {
            let radius, startAngle, endAngle;
            
            if (primitive.radius !== undefined) {
                radius = primitive.radius;
                startAngle = primitive.startAngle;
                endAngle = primitive.endAngle;
            } else if (primitive.startPoint && primitive.endPoint && primitive.center) {
                radius = Math.sqrt(
                    Math.pow(primitive.startPoint.x - primitive.center.x, 2) +
                    Math.pow(primitive.startPoint.y - primitive.center.y, 2)
                );
                
                startAngle = Math.atan2(
                    primitive.startPoint.y - primitive.center.y,
                    primitive.startPoint.x - primitive.center.x
                );
                endAngle = Math.atan2(
                    primitive.endPoint.y - primitive.center.y,
                    primitive.endPoint.x - primitive.center.x
                );
            } else {
                console.warn('Arc primitive missing required properties');
                return;
            }
            
            this.ctx.beginPath();
            this.ctx.arc(
                primitive.center.x,
                primitive.center.y,
                radius,
                startAngle,
                endAngle,
                primitive.clockwise
            );
            
            this.ctx.lineWidth = props.strokeWidth || 0.1;
            this.ctx.strokeStyle = strokeColor;
            this.ctx.stroke();
        }
        
        renderPrimitiveWireframe(primitive) {
            switch (primitive.type) {
                case 'path':
                    this.renderPathWireframe(primitive);
                    break;
                case 'circle':
                    this.ctx.beginPath();
                    this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, 2 * Math.PI);
                    this.ctx.stroke();
                    break;
                case 'rectangle':
                    this.ctx.strokeRect(primitive.position.x, primitive.position.y, primitive.width, primitive.height);
                    break;
                case 'obround':
                    this.renderObroundWireframe(primitive);
                    break;
                case 'arc':
                    this.renderArcWireframe(primitive);
                    break;
            }
        }
        
        renderPathWireframe(primitive) {
            if (primitive.points.length < 2) return;
            
            this.ctx.beginPath();
            primitive.points.forEach((point, index) => {
                if (point !== null) {
                    if (index === 0) {
                        this.ctx.moveTo(point.x, point.y);
                    } else {
                        this.ctx.lineTo(point.x, point.y);
                    }
                }
            });
            
            if (primitive.closed) {
                this.ctx.closePath();
            }
            
            this.ctx.stroke();
            
            if (primitive.contours && primitive.contours.length > 0) {
                const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
                const colors = theme.debug || theme.canvas;
                
                this.ctx.save();
                this.ctx.strokeStyle = colors.holeDebug || colors.bounds;
                this.ctx.setLineDash([2 / this.core.viewScale, 2 / this.core.viewScale]);
                
                primitive.contours.forEach(hole => {
                    this.ctx.beginPath();
                    hole.forEach((point, index) => {
                        if (index === 0) {
                            this.ctx.moveTo(point.x, point.y);
                        } else {
                            this.ctx.lineTo(point.x, point.y);
                        }
                    });
                    this.ctx.closePath();
                    this.ctx.stroke();
                });
                
                this.ctx.restore();
            }
        }
        
        renderObroundWireframe(primitive) {
            const x = primitive.position.x;
            const y = primitive.position.y;
            const w = primitive.width;
            const h = primitive.height;
            const r = Math.min(w, h) / 2;
            
            this.ctx.beginPath();
            
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
            
            this.ctx.closePath();
            this.ctx.stroke();
        }
        
        renderArcWireframe(primitive) {
            let radius = primitive.radius;
            let startAngle = primitive.startAngle;
            let endAngle = primitive.endAngle;
            
            if (radius === undefined && primitive.start && primitive.center) {
                radius = Math.sqrt(
                    Math.pow(primitive.start.x - primitive.center.x, 2) +
                    Math.pow(primitive.start.y - primitive.center.y, 2)
                );
                
                startAngle = Math.atan2(
                    primitive.start.y - primitive.center.y,
                    primitive.start.x - primitive.center.x
                );
                endAngle = Math.atan2(
                    primitive.end.y - primitive.center.y,
                    primitive.end.x - primitive.center.x
                );
            }
            
            this.ctx.beginPath();
            this.ctx.arc(
                primitive.center.x,
                primitive.center.y,
                radius,
                startAngle,
                endAngle,
                primitive.clockwise
            );
            this.ctx.stroke();
        }
        
        renderHoleDebug(primitive) {
            if (!primitive.contours || primitive.contours.length === 0) return;
            
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const colors = theme.debug || theme.canvas;
            
            this.ctx.save();
            this.ctx.strokeStyle = colors.holeDebug;
            this.ctx.lineWidth = 2 / this.core.viewScale;
            this.ctx.setLineDash([4 / this.core.viewScale, 4 / this.core.viewScale]);
            
            primitive.contours.forEach(hole => {
                this.ctx.beginPath();
                
                for (let i = 0; i < hole.length; i++) {
                    const point = hole[i];
                    const nextPoint = hole[(i + 1) % hole.length];
                    
                    if (i === 0) {
                        this.ctx.moveTo(point.x, point.y);
                    }
                    this.ctx.lineTo(nextPoint.x, nextPoint.y);
                    
                    if (i % Math.ceil(hole.length / 4) === 0) {
                        const midX = (point.x + nextPoint.x) / 2;
                        const midY = (point.y + nextPoint.y) / 2;
                        const angle = Math.atan2(nextPoint.y - point.y, nextPoint.x - point.x);
                        
                        const arrowSize = 5 / this.core.viewScale;
                        
                        this.ctx.save();
                        this.ctx.translate(midX, midY);
                        this.ctx.rotate(angle);
                        
                        this.ctx.moveTo(0, 0);
                        this.ctx.lineTo(-arrowSize, -arrowSize/2);
                        this.ctx.moveTo(0, 0);
                        this.ctx.lineTo(-arrowSize, arrowSize/2);
                        
                        this.ctx.restore();
                    }
                }
                
                this.ctx.closePath();
                this.ctx.stroke();
            });
            
            this.ctx.restore();
        }
        
        highlightPotentialIssues(primitive) {
            if (!primitive.points || primitive.points.length < 3) return;
            
            this.ctx.save();
            
            let lastCurveId = null;
            let gapStart = null;
            const gaps = [];
            
            primitive.points.forEach((p, index) => {
                const curveId = p.curveId > 0 ? p.curveId : null;
                
                if (lastCurveId !== null && curveId !== lastCurveId) {
                    if (gapStart !== null && curveId === gapStart.curveId) {
                        gaps.push({
                            startIndex: gapStart.index,
                            endIndex: index,
                            curveId: curveId
                        });
                    }
                    gapStart = { index, curveId: lastCurveId };
                }
                lastCurveId = curveId;
            });
            
            this.ctx.strokeStyle = '#FF0000';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 5]);
            
            gaps.forEach(gap => {
                const startPoint = primitive.points[gap.startIndex];
                const endPoint = primitive.points[gap.endIndex];
                
                const startX = this.core.worldToCanvasX(startPoint.x);
                const startY = this.core.worldToCanvasY(startPoint.y);
                const endX = this.core.worldToCanvasX(endPoint.x);
                const endY = this.core.worldToCanvasY(endPoint.y);
                
                this.ctx.beginPath();
                this.ctx.moveTo(startX, startY);
                this.ctx.lineTo(endX, endY);
                this.ctx.stroke();
                
                this.ctx.fillStyle = '#FF0000';
                this.ctx.font = '16px sans-serif';
                const midX = (startX + endX) / 2;
                const midY = (startY + endY) / 2;
                this.ctx.fillText('⚠', midX - 8, midY + 5);
            });
            
            this.ctx.restore();
        }
    }
    
    window.PrimitiveRenderer = PrimitiveRenderer;
    
})();