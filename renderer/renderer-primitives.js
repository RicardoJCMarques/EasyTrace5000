// renderer/renderer-primitives.js
// Handles drawing all primitive types
// FIXED: Arc direction for Y-flipped coordinates

(function() {
    'use strict';
    
    const config = window.PCBCAMConfig || {};
    const debugConfig = config.debug || {};
    
    class PrimitiveRenderer {
        constructor(core) {
            this.core = core;
            this.ctx = core.ctx;
            
            // Track debug statistics
            this.debugStats = {
                totalPoints: 0,
                taggedPoints: 0,
                curvePoints: new Map() // curveId -> point count
            };
        }
        
        renderPrimitive(primitive, fillColor, strokeColor, isPreprocessed = false) {
            this.ctx.save();
            
            // Check if this is a reconstructed arc/circle
            const isReconstructed = primitive.properties?.reconstructed === true;
            
            if (isReconstructed) {
                // Special styling for reconstructed arcs
                this.renderReconstructedPrimitive(primitive, fillColor, strokeColor);
            } else {
                // Normal rendering
                this.ctx.fillStyle = fillColor;
                this.ctx.strokeStyle = strokeColor;
                
                if (this.core.options.showWireframe) {
                    this.ctx.lineWidth = this.core.getWireframeStrokeWidth();
                    this.renderPrimitiveWireframe(primitive);
                } else {
                    this.renderPrimitiveNormal(primitive, fillColor, strokeColor, isPreprocessed);
                }
            }
            
            // Debug visualization of curve metadata for all paths
            if (this.core.options.debugCurvePoints && primitive.type === 'path') {
                this.renderCurveMetadataDebug(primitive);
            }
            
            this.ctx.restore();
        }
        
        // FIXED: Hybrid path rendering with correct arc direction
        renderHybridPath(primitive, fillColor, strokeColor) {
            const path2d = new Path2D();
            const points = primitive.points;
            
            if (!points || points.length === 0) return;
            
            // Sort segments by start index
            const segments = (primitive.arcSegments || []).slice().sort((a, b) => a.startIndex - b.startIndex);
            
            let currentIndex = 0;
            
            // Start path
            path2d.moveTo(points[0].x, points[0].y);
            currentIndex = 1;
            
            // Process each arc segment
            for (const arc of segments) {
                // Draw straight lines up to arc start
                for (let i = currentIndex; i < arc.startIndex; i++) {
                    if (points[i]) path2d.lineTo(points[i].x, points[i].y);
                }
                
                // Ensure we're at the arc start point
                if (points[arc.startIndex]) {
                    path2d.lineTo(points[arc.startIndex].x, points[arc.startIndex].y);
                }
                
                // FIXED: For Y-flipped coordinates, use clockwise directly
                // When Y is flipped: Canvas interprets anticlockwise in the flipped space
                // To maintain visual direction, we use the geometric clockwise value directly
                path2d.arc(
                    arc.center.x,
                    arc.center.y,
                    arc.radius,
                    arc.startAngle,
                    arc.endAngle,
                    arc.clockwise  // FIXED: Use directly, no inversion!
                );
                
                // Skip interpolated points
                currentIndex = arc.endIndex + 1;
            }
            
            // Draw remaining straight segments
            for (let i = currentIndex; i < points.length; i++) {
                if (points[i]) path2d.lineTo(points[i].x, points[i].y);
            }
            
            // Handle holes if present
            if (primitive.holes && primitive.holes.length > 0) {
                primitive.holes.forEach(hole => {
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
            
            // Render the optimized path
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
        
        // Debug visualization for curve metadata survival
        renderCurveMetadataDebug(primitive) {
            if (!primitive.points || primitive.points.length === 0) return;
            
            // Reset stats for this primitive
            this.debugStats.totalPoints = 0;
            this.debugStats.taggedPoints = 0;
            this.debugStats.curvePoints.clear();
            
            this.ctx.save();
            
            // Use screen space for consistent visualization
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            
            const pointRadius = 4;
            const fontSize = 10;
            const labelOffset = 8;
            
            // === PHASE 1: Render detected arc segments ===
            if (primitive.arcSegments && primitive.arcSegments.length > 0) {
                this.renderDetectedArcSegments(primitive);
            }
            
            // === PHASE 2: Draw connecting lines to show point order ===
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([2, 2]);
            this.ctx.beginPath();
            
            primitive.points.forEach((p, index) => {
                const canvasX = this.core.worldToCanvasX(p.x);
                const canvasY = this.core.worldToCanvasY(p.y);
                
                if (index === 0) {
                    this.ctx.moveTo(canvasX, canvasY);
                } else {
                    this.ctx.lineTo(canvasX, canvasY);
                }
            });
            
            // Show if polygon is closed
            if (primitive.closed !== false) {
                this.ctx.closePath();
                this.ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
            }
            this.ctx.stroke();
            
            // === PHASE 3: Draw points with metadata visualization ===
            primitive.points.forEach((p, index) => {
                const canvasX = this.core.worldToCanvasX(p.x);
                const canvasY = this.core.worldToCanvasY(p.y);
                
                this.debugStats.totalPoints++;
                
                if (p.curveId !== undefined && p.curveId > 0) {
                    // Point has curve metadata
                    this.debugStats.taggedPoints++;
                    const count = this.debugStats.curvePoints.get(p.curveId) || 0;
                    this.debugStats.curvePoints.set(p.curveId, count + 1);
                    
                    // Use different colors for different curve IDs
                    const hue = (p.curveId * 137) % 360; // Golden angle for color distribution
                    this.ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
                    
                    // Draw larger point for curve points
                    this.ctx.beginPath();
                    this.ctx.arc(canvasX, canvasY, pointRadius, 0, 2 * Math.PI);
                    this.ctx.fill();
                    
                    // Draw black outline
                    this.ctx.strokeStyle = '#000000';
                    this.ctx.lineWidth = 1;
                    this.ctx.setLineDash([]);
                    this.ctx.stroke();
                    
                    // Draw metadata label
                    this.ctx.fillStyle = '#FFFFFF';
                    this.ctx.strokeStyle = '#000000';
                    this.ctx.lineWidth = 3;
                    this.ctx.font = `${fontSize}px monospace`;
                    
                    const label = `C${p.curveId}`;
                    const segLabel = p.segmentIndex !== undefined ? `:${p.segmentIndex}` : '';
                    const fullLabel = label + segLabel;
                    
                    // Draw text with outline for visibility
                    this.ctx.strokeText(fullLabel, canvasX + labelOffset, canvasY - labelOffset);
                    this.ctx.fillText(fullLabel, canvasX + labelOffset, canvasY - labelOffset);
                    
                    // Show additional metadata on hover (stored for potential interaction)
                    if (p.segmentIndex !== undefined) {
                        // Draw small index number below point
                        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                        this.ctx.font = `${fontSize - 2}px monospace`;
                        this.ctx.fillText(`[${index}]`, canvasX - 10, canvasY + labelOffset + 10);
                    }
                    
                } else {
                    // Point has no curve metadata - straight segment point
                    this.ctx.fillStyle = 'rgba(128, 128, 128, 0.5)';
                    
                    // Draw smaller point for straight segments
                    this.ctx.beginPath();
                    this.ctx.arc(canvasX, canvasY, pointRadius - 1, 0, 2 * Math.PI);
                    this.ctx.fill();
                    
                    // Draw index for first and last points
                    if (index === 0 || index === primitive.points.length - 1) {
                        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
                        this.ctx.font = `${fontSize - 2}px monospace`;
                        const label = index === 0 ? 'START' : 'END';
                        this.ctx.fillText(label, canvasX + labelOffset, canvasY);
                    }
                }
            });
            
            // Draw statistics overlay
            this.renderDebugStatistics(primitive);
            
            // Highlight potential issues
            this.highlightPotentialIssues(primitive);
            
            this.ctx.restore();
        }
        
        // Render detected arc segments as overlay curves
        renderDetectedArcSegments(primitive) {
            if (!primitive.arcSegments || primitive.arcSegments.length === 0) return;
            
            this.ctx.save();
            
            // Draw each detected arc segment with unique colors
            primitive.arcSegments.forEach((segment, idx) => {
                // Transform arc center to canvas coordinates
                const centerX = this.core.worldToCanvasX(segment.center.x);
                const centerY = this.core.worldToCanvasY(segment.center.y);
                const radiusCanvas = segment.radius * this.core.viewScale;
                
                // Use unique color for EACH arc segment
                const hue = ((idx * 137) + 60) % 360;
                const color = `hsl(${hue}, 100%, 50%)`;
                
                // Draw arc curve with thicker stroke
                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = 5;
                this.ctx.setLineDash([]);
                this.ctx.globalAlpha = 0.8;
                
                this.ctx.beginPath();
                // FIXED: With Y-flip, use clockwise directly for visual consistency
                const startAngle = -segment.startAngle;  // Negate for Y-flip
                const endAngle = -segment.endAngle;      // Negate for Y-flip
                this.ctx.arc(centerX, centerY, radiusCanvas, endAngle, startAngle, segment.clockwise);
                this.ctx.stroke();
                
                // Draw center marker
                this.ctx.fillStyle = color;
                this.ctx.globalAlpha = 1.0;
                this.ctx.beginPath();
                this.ctx.arc(centerX, centerY, 4, 0, 2 * Math.PI);
                this.ctx.fill();
                
                // Draw radius lines to endpoints with thicker dashed lines
                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = 2;
                this.ctx.setLineDash([4, 4]);
                this.ctx.globalAlpha = 0.6;
                
                // Start point radius line
                const startX = centerX + radiusCanvas * Math.cos(-segment.startAngle);
                const startY = centerY + radiusCanvas * Math.sin(-segment.startAngle);
                this.ctx.beginPath();
                this.ctx.moveTo(centerX, centerY);
                this.ctx.lineTo(startX, startY);
                this.ctx.stroke();
                
                // Draw start point marker
                this.ctx.fillStyle = '#00FF00';
                this.ctx.globalAlpha = 1.0;
                this.ctx.beginPath();
                this.ctx.arc(startX, startY, 5, 0, 2 * Math.PI);
                this.ctx.fill();
                
                // End point radius line
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
                
                // Draw end point marker
                this.ctx.fillStyle = '#FF0000';
                this.ctx.globalAlpha = 1.0;
                this.ctx.beginPath();
                this.ctx.arc(endX, endY, 5, 0, 2 * Math.PI);
                this.ctx.fill();
                
                // Draw arc info label
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
                
                // Draw actual point indices at start/end
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
            // Highlight reconstructed arcs with special styling
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            
            // Use a bright accent color for reconstructed arcs
            const accentColor = '#00ffff'; // Cyan for reconstructed arcs
            const glowColor = '#00ff00';   // Green glow
            
            this.ctx.save();
            
            // Add glow effect for visibility
            this.ctx.shadowColor = glowColor;
            this.ctx.shadowBlur = 10 / this.core.viewScale;
            
            // Render based on type
            if (primitive.type === 'circle') {
                // Reconstructed circle
                this.ctx.strokeStyle = accentColor;
                this.ctx.lineWidth = 2 / this.core.viewScale;
                this.ctx.fillStyle = fillColor + '40'; // Semi-transparent fill
                
                this.ctx.beginPath();
                this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, 2 * Math.PI);
                this.ctx.fill();
                this.ctx.stroke();
                
                // Add center marker
                this.ctx.fillStyle = accentColor;
                this.ctx.beginPath();
                this.ctx.arc(primitive.center.x, primitive.center.y, 2 / this.core.viewScale, 0, 2 * Math.PI);
                this.ctx.fill();
            } else if (primitive.type === 'arc') {
                // Reconstructed arc
                this.ctx.strokeStyle = accentColor;
                this.ctx.lineWidth = 2 / this.core.viewScale;
                
                this.ctx.beginPath();
                this.ctx.arc(
                    primitive.center.x,
                    primitive.center.y,
                    primitive.radius,
                    primitive.startAngle,
                    primitive.endAngle,
                    primitive.clockwise  // FIXED: Use directly for Y-flipped coordinates
                );
                this.ctx.stroke();
                
                // Add endpoint markers
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
                // Partially reconstructed arc as path
                this.ctx.strokeStyle = '#ffff00'; // Yellow for partial
                this.ctx.lineWidth = 2 / this.core.viewScale;
                this.ctx.setLineDash([5 / this.core.viewScale, 5 / this.core.viewScale]);
                
                this.renderPathNormal(primitive, primitive.properties, fillColor + '40', '#ffff00', false);
            }
            
            this.ctx.restore();
            
            // Add label if debug enabled
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
            // Use hybrid rendering for paths with reconstructed arcs
            if (props.hasReconstructedArcs && primitive.arcSegments?.length > 0) {
                this.renderHybridPath(primitive, fillColor, strokeColor);
                return;
            }
            
            // Check if this is preprocessed geometry
            if (isPreprocessed) {
                // Preprocessed geometry should always be filled, never stroked
                this.renderSimplePath(primitive, props, fillColor);
                return;
            }
            
            // Regular rendering logic for non-preprocessed primitives
            if ((props.hasHoles || primitive.holes) && primitive.holes && primitive.holes.length > 0) {
                this.renderCompoundPath(primitive, props, fillColor, strokeColor);
            } else if (props.isCompound) {
                this.renderLegacyCompoundPath(primitive, props, fillColor);
            } else if (props.isRegion) {
                this.renderRegion(primitive, props, fillColor);
            } else if (props.isTrace || props.isBranchSegment || props.isConnectedPath || 
                    (props.stroke && props.strokeWidth && !props.fill)) {
                this.renderTrace(primitive, props, strokeColor);
            } else if (props.fill !== false) {
                this.renderSimplePath(primitive, props, fillColor);
            }
        }
        
        renderCompoundPath(primitive, props, fillColor, strokeColor) {
            const path2d = new Path2D();
            
            primitive.points.forEach((point, index) => {
                if (index === 0) {
                    path2d.moveTo(point.x, point.y);
                } else {
                    path2d.lineTo(point.x, point.y);
                }
            });
            if (primitive.closed) {
                path2d.closePath();
            }
            
            primitive.holes.forEach(hole => {
                if (hole.length > 0) {
                    path2d.moveTo(hole[0].x, hole[0].y);
                    for (let i = 1; i < hole.length; i++) {
                        path2d.lineTo(hole[i].x, hole[i].y);
                    }
                    path2d.closePath();
                }
            });
            
            this.ctx.fillStyle = fillColor;
            this.ctx.fill(path2d, 'nonzero');
            
            if (this.core.options.debugHoleWinding) {
                this.renderHoleDebug(primitive);
            }
            
            this.core.renderStats.holesRendered += primitive.holes.length;
        }
        
        renderLegacyCompoundPath(primitive, props, fillColor) {
            this.ctx.fillStyle = fillColor;
            this.ctx.beginPath();
            
            let isNewSegment = true;
            primitive.points.forEach(point => {
                if (point === null) {
                    isNewSegment = true;
                } else {
                    if (isNewSegment) {
                        this.ctx.moveTo(point.x, point.y);
                        isNewSegment = false;
                    } else {
                        this.ctx.lineTo(point.x, point.y);
                    }
                }
            });
            
            this.ctx.fill('evenodd');
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
        
        renderCircleNormal(primitive, props, fillColor, strokeColor) {
            this.ctx.beginPath();
            this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, 2 * Math.PI);
            
            if (props.isDrillHole || props.isBranchJunction || props.isFlash || props.fill !== false) {
                this.ctx.fillStyle = fillColor;
                this.ctx.fill();
            }
            
            if (props.stroke && !props.isDrillHole) {
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
        
        // FIXED: Arc rendering with correct direction
        renderArcNormal(primitive, props, strokeColor) {
            let radius, startAngle, endAngle;
            
            if (primitive.radius !== undefined) {
                // New ArcPrimitive structure with direct properties
                radius = primitive.radius;
                startAngle = primitive.startAngle;
                endAngle = primitive.endAngle;
            } else if (primitive.startPoint && primitive.endPoint && primitive.center) {
                // Fallback for calculated properties
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
                // Legacy fallback
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
                primitive.clockwise  // FIXED: Use directly for Y-flipped coordinates
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
            
            if (primitive.holes && primitive.holes.length > 0) {
                const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
                const colors = theme.debug || theme.canvas;
                
                this.ctx.save();
                this.ctx.strokeStyle = colors.holeDebug || colors.bounds;
                this.ctx.setLineDash([2 / this.core.viewScale, 2 / this.core.viewScale]);
                
                primitive.holes.forEach(hole => {
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
        
        // FIXED: Wireframe arc rendering
        renderArcWireframe(primitive) {
            // Use stored properties if available
            let radius = primitive.radius;
            let startAngle = primitive.startAngle;
            let endAngle = primitive.endAngle;
            
            // Fallback calculation
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
                primitive.clockwise  // FIXED: Use directly
            );
            this.ctx.stroke();
        }
        
        renderHoleDebug(primitive) {
            if (!primitive.holes || primitive.holes.length === 0) return;
            
            const theme = this.core.colors[this.core.options.theme] || this.core.colors.dark;
            const colors = theme.debug || theme.canvas;
            
            this.ctx.save();
            this.ctx.strokeStyle = colors.holeDebug;
            this.ctx.lineWidth = 2 / this.core.viewScale;
            this.ctx.setLineDash([4 / this.core.viewScale, 4 / this.core.viewScale]);
            
            primitive.holes.forEach(hole => {
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
        
        // Show debug statistics overlay
        renderDebugStatistics(primitive) {
            const stats = this.debugStats;
            if (stats.totalPoints === 0) return;
            
            this.ctx.save();
            
            // Position in top-left corner
            const x = 10;
            const y = 60;
            const lineHeight = 16;
            
            // Background
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            const width = 250;
            let height = (3 + stats.curvePoints.size) * lineHeight + 10;
            
            // Add space for arc segments if present
            if (primitive && primitive.arcSegments && primitive.arcSegments.length > 0) {
                height += (primitive.arcSegments.length + 2) * lineHeight;
            }
            
            this.ctx.fillRect(x, y, width, height);
            
            // Text
            this.ctx.fillStyle = '#FFFFFF';
            this.ctx.font = '12px monospace';
            
            let currentY = y + lineHeight;
            this.ctx.fillText(`Total points: ${stats.totalPoints}`, x + 5, currentY);
            
            currentY += lineHeight;
            const percentage = ((stats.taggedPoints / stats.totalPoints) * 100).toFixed(1);
            this.ctx.fillText(`Tagged points: ${stats.taggedPoints} (${percentage}%)`, x + 5, currentY);
            
            if (stats.curvePoints.size > 0) {
                currentY += lineHeight;
                this.ctx.fillText('Curves detected:', x + 5, currentY);
                
                stats.curvePoints.forEach((count, curveId) => {
                    currentY += lineHeight;
                    const hue = (curveId * 137) % 360;
                    this.ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
                    this.ctx.fillText(`  Curve ${curveId}: ${count} points`, x + 5, currentY);
                });
            }
            
            // Arc segments summary
            if (primitive && primitive.arcSegments && primitive.arcSegments.length > 0) {
                currentY += lineHeight;
                this.ctx.fillStyle = '#00FFFF';
                this.ctx.fillText(`Arc Segments: ${primitive.arcSegments.length}`, x + 5, currentY);
                
                primitive.arcSegments.forEach((seg, idx) => {
                    currentY += lineHeight;
                    const sweepAngle = seg.sweepAngle || Math.abs(seg.endAngle - seg.startAngle);
                    const angleDeg = Math.abs(sweepAngle) * 180 / Math.PI;
                    this.ctx.fillStyle = '#FFFFFF';
                    this.ctx.fillText(`  ${idx + 1}: ${angleDeg.toFixed(1)}° (${seg.pointCount} pts)`, x + 5, currentY);
                });
            }
            
            this.ctx.restore();
        }
        
        // Highlight potential reconstruction issues
        highlightPotentialIssues(primitive) {
            if (!primitive.points || primitive.points.length < 3) return;
            
            this.ctx.save();
            
            // Check for gaps in curve sequences
            let lastCurveId = null;
            let gapStart = null;
            const gaps = [];
            
            primitive.points.forEach((p, index) => {
                const curveId = p.curveId > 0 ? p.curveId : null;
                
                if (lastCurveId !== null && curveId !== lastCurveId) {
                    // Found a transition
                    if (gapStart !== null && curveId === gapStart.curveId) {
                        // Same curve ID appearing again - potential split
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
            
            // Highlight gaps with warning indicators
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
                
                // Draw warning icon
                this.ctx.fillStyle = '#FF0000';
                this.ctx.font = '16px sans-serif';
                const midX = (startX + endX) / 2;
                const midY = (startY + endY) / 2;
                this.ctx.fillText('⚠', midX - 8, midY + 5);
            });
            
            this.ctx.restore();
        }
    }
    
    // Export
    window.PrimitiveRenderer = PrimitiveRenderer;
    
})();