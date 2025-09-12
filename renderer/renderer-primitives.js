// renderer/renderer-primitives.js
// Handles drawing all primitive types

(function() {
    'use strict';
    
    const config = window.PCBCAMConfig || {};
    const debugConfig = config.debug || {};
    
    class PrimitiveRenderer {
        constructor(core) {
            this.core = core;
            this.ctx = core.ctx;
        }
        
        renderPrimitive(primitive, fillColor, strokeColor, isPreprocessed = false) {
            this.ctx.save();
            
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
        
        renderArcNormal(primitive, props, strokeColor) {
            const radius = Math.sqrt(
                Math.pow(primitive.start.x - primitive.center.x, 2) +
                Math.pow(primitive.start.y - primitive.center.y, 2)
            );
            
            const startAngle = Math.atan2(
                primitive.start.y - primitive.center.y,
                primitive.start.x - primitive.center.x
            );
            const endAngle = Math.atan2(
                primitive.end.y - primitive.center.y,
                primitive.end.x - primitive.center.x
            );
            
            this.ctx.beginPath();
            this.ctx.arc(
                primitive.center.x,
                primitive.center.y,
                radius,
                startAngle,
                endAngle,
                !primitive.clockwise
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
        
        renderArcWireframe(primitive) {
            const radius = Math.sqrt(
                Math.pow(primitive.start.x - primitive.center.x, 2) +
                Math.pow(primitive.start.y - primitive.center.y, 2)
            );
            
            const startAngle = Math.atan2(
                primitive.start.y - primitive.center.y,
                primitive.start.x - primitive.center.x
            );
            const endAngle = Math.atan2(
                primitive.end.y - primitive.center.y,
                primitive.end.x - primitive.center.x
            );
            
            this.ctx.beginPath();
            this.ctx.arc(
                primitive.center.x,
                primitive.center.y,
                radius,
                startAngle,
                endAngle,
                !primitive.clockwise
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
    }
    
    // Export
    window.PrimitiveRenderer = PrimitiveRenderer;
    
})();