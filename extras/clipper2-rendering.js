/**
 * Clipper2 Rendering Module
 * Handles canvas rendering, SVG export, and visualization
 * Version 3.3 - Updated for consistency with new system
 */

class Clipper2Rendering {
    constructor(core) {
        this.core = core;
        this.renderStats = {
            totalPaths: 0,
            totalPoints: 0,
            lastRenderTime: 0
        };
    }

    /**
     * Clear canvas
     */
    clearCanvas(canvasId) {
        const canvas = typeof canvasId === 'string' ? 
            document.getElementById(canvasId) : canvasId;
        
        if (!canvas) {
            console.warn(`[RENDER] Canvas not found: ${canvasId}`);
            return;
        }
        
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    /**
     * Draw paths on canvas with proper hole handling
     * Note: pathsToArray in core already handles descaling
     */
    drawPaths(paths, canvasId, options = {}) {
        const startTime = performance.now();
        
        const canvas = typeof canvasId === 'string' ? 
            document.getElementById(canvasId) : canvasId;
        
        if (!canvas || !paths) {
            console.warn('[RENDER] Invalid canvas or paths');
            return;
        }
        
        const ctx = canvas.getContext('2d');
        
        // Default options
        const opts = {
            fillOuter: '#3b82f640',
            strokeOuter: '#3b82f6',
            fillHole: 'white',
            strokeHole: '#ef4444',
            strokeWidth: 2,
            clear: options.clear !== false,
            fillRule: options.fillRule || 'evenodd',  // Support both evenodd and nonzero
            showPoints: false,
            showLabels: false
        };
        
        Object.assign(opts, options);
        
        if (opts.clear) {
            this.clearCanvas(canvas);
        }
        
        // Convert paths to array for analysis - already descaled by core
        const pathsArray = this.core.pathsToArray(paths);
        
        // Update stats
        this.renderStats.totalPaths = pathsArray.length;
        this.renderStats.totalPoints = pathsArray.reduce((sum, p) => sum + p.points.length, 0);
        
        // Group paths by outer/hole
        const outers = pathsArray.filter(p => p.orientation === 'outer');
        const holes = pathsArray.filter(p => p.orientation === 'hole');
        
        // Draw all paths in a single fill operation for proper holes
        if (opts.fillOuter !== 'none') {
            ctx.fillStyle = opts.fillOuter;
            ctx.beginPath();
            
            // Add all paths to the same path object
            pathsArray.forEach(pathInfo => {
                pathInfo.points.forEach((point, i) => {
                    if (i === 0) {
                        ctx.moveTo(point.x, point.y);
                    } else {
                        ctx.lineTo(point.x, point.y);
                    }
                });
                ctx.closePath();
            });
            
            // Fill using specified fill rule
            ctx.fill(opts.fillRule);
        }
        
        // Draw strokes separately
        ctx.lineWidth = opts.strokeWidth;
        
        // Draw outer strokes
        ctx.strokeStyle = opts.strokeOuter;
        outers.forEach(pathInfo => {
            ctx.beginPath();
            pathInfo.points.forEach((point, i) => {
                if (i === 0) {
                    ctx.moveTo(point.x, point.y);
                } else {
                    ctx.lineTo(point.x, point.y);
                }
            });
            ctx.closePath();
            ctx.stroke();
            
            // Draw points if requested
            if (opts.showPoints) {
                this.drawPoints(ctx, pathInfo.points, '#3b82f6');
            }
        });
        
        // Draw hole strokes with different style if specified
        if (holes.length > 0 && opts.strokeHole !== opts.strokeOuter) {
            ctx.strokeStyle = opts.strokeHole;
            ctx.setLineDash([5, 5]);
            
            holes.forEach(pathInfo => {
                ctx.beginPath();
                pathInfo.points.forEach((point, i) => {
                    if (i === 0) {
                        ctx.moveTo(point.x, point.y);
                    } else {
                        ctx.lineTo(point.x, point.y);
                    }
                });
                ctx.closePath();
                ctx.stroke();
                
                // Draw points if requested
                if (opts.showPoints) {
                    this.drawPoints(ctx, pathInfo.points, '#ef4444');
                }
            });
            
            ctx.setLineDash([]);
        }
        
        // Draw labels if requested
        if (opts.showLabels) {
            this.drawLabels(ctx, pathsArray);
        }
        
        // Update render time
        this.renderStats.lastRenderTime = performance.now() - startTime;
        
        this.core.debug(`Rendered ${this.renderStats.totalPaths} paths with ${this.renderStats.totalPoints} points in ${this.renderStats.lastRenderTime.toFixed(2)}ms`);
    }

    /**
     * Draw individual points
     */
    drawPoints(ctx, points, color) {
        ctx.fillStyle = color;
        points.forEach(point => {
            ctx.beginPath();
            ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    /**
     * Draw path labels
     */
    drawLabels(ctx, pathsArray) {
        ctx.font = '12px Arial';
        ctx.fillStyle = '#374151';
        
        pathsArray.forEach((pathInfo, i) => {
            if (pathInfo.points.length > 0) {
                const center = this.getPathCenter(pathInfo.points);
                ctx.fillText(`P${i}`, center.x, center.y);
            }
        });
    }

    /**
     * Get center point of a path
     */
    getPathCenter(points) {
        const bounds = this.getPathBounds(points);
        return {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2
        };
    }

    /**
     * Get bounding box of a path
     */
    getPathBounds(points) {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        points.forEach(point => {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        });
        
        return { minX, minY, maxX, maxY };
    }

    /**
     * Draw comparison of input and output
     */
    drawComparison(inputPaths, outputPaths, canvasId) {
        const canvas = typeof canvasId === 'string' ? 
            document.getElementById(canvasId) : canvasId;
        
        if (!canvas) return;
        
        this.clearCanvas(canvas);
        
        // Draw input in light gray
        this.drawPaths(inputPaths, canvas, {
            fillOuter: '#e5e7eb',
            strokeOuter: '#9ca3af',
            strokeWidth: 1,
            clear: false
        });
        
        // Draw output on top
        this.drawPaths(outputPaths, canvas, {
            fillOuter: '#10b98140',
            strokeOuter: '#10b981',
            strokeWidth: 2,
            clear: false
        });
        
        // Add legend
        const ctx = canvas.getContext('2d');
        ctx.font = '12px Arial';
        ctx.fillStyle = '#9ca3af';
        ctx.fillText('Input', 10, 20);
        ctx.fillStyle = '#10b981';
        ctx.fillText('Output', 10, 35);
    }

    /**
     * Draw multiple offset paths with gradient
     */
    drawOffsetPaths(offsetPaths, canvasId) {
        const canvas = typeof canvasId === 'string' ?
            document.getElementById(canvasId) : canvasId;
        
        if (!canvas) return;
        
        this.clearCanvas(canvas);
        
        // Draw from largest to smallest
        offsetPaths.reverse().forEach((paths, i) => {
            const hue = (i / offsetPaths.length) * 120;
            const alpha = 0.3 + (i / offsetPaths.length) * 0.3;
            
            this.drawPaths(paths, canvas, {
                fillOuter: `hsla(${hue}, 70%, 50%, ${alpha})`,
                strokeOuter: `hsl(${hue}, 70%, 40%)`,
                clear: false
            });
        });
    }

    /**
     * Export paths as SVG
     * Note: pathsToArray already handles descaling
     */
    exportSVG(paths, width = 400, height = 400) {
        if (!paths) return '';
        
        const pathsArray = this.core.pathsToArray(paths);
        
        let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" 
     xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="white"/>
  <g fill="#3b82f640" stroke="#3b82f6" stroke-width="2" fill-rule="evenodd">
`;
        
        // Create path data
        let pathData = '';
        pathsArray.forEach(pathInfo => {
            pathData += 'M ';
            pathInfo.points.forEach((point, i) => {
                if (i === 0) {
                    pathData += `${point.x} ${point.y} `;
                } else {
                    pathData += `L ${point.x} ${point.y} `;
                }
            });
            pathData += 'Z ';
        });
        
        svg += `    <path d="${pathData}"/>\n`;
        svg += '  </g>\n</svg>';
        
        return svg;
    }

    /**
     * Animate path drawing
     */
    animatePath(paths, canvasId, duration = 2000, options = {}) {
        const canvas = typeof canvasId === 'string' ?
            document.getElementById(canvasId) : canvasId;
        
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const pathsArray = this.core.pathsToArray(paths);
        
        let startTime = null;
        
        const animate = (timestamp) => {
            if (!startTime) startTime = timestamp;
            const progress = Math.min((timestamp - startTime) / duration, 1);
            
            this.clearCanvas(canvas);
            
            ctx.strokeStyle = options.strokeColor || '#3b82f6';
            ctx.lineWidth = options.strokeWidth || 2;
            
            pathsArray.forEach(pathInfo => {
                const pointCount = Math.floor(pathInfo.points.length * progress);
                
                if (pointCount > 0) {
                    ctx.beginPath();
                    for (let i = 0; i < pointCount; i++) {
                        const point = pathInfo.points[i];
                        if (i === 0) {
                            ctx.moveTo(point.x, point.y);
                        } else {
                            ctx.lineTo(point.x, point.y);
                        }
                    }
                    
                    if (progress === 1) {
                        ctx.closePath();
                        
                        // Fill on complete
                        if (options.fillColor) {
                            ctx.fillStyle = options.fillColor;
                            ctx.fill();
                        }
                    }
                    
                    ctx.stroke();
                }
            });
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else if (options.onComplete) {
                options.onComplete();
            }
        };
        
        requestAnimationFrame(animate);
    }

    /**
     * Highlight specific path
     */
    highlightPath(paths, index, canvasId) {
        const canvas = typeof canvasId === 'string' ? 
            document.getElementById(canvasId) : canvasId;
        
        if (!canvas) return;
        
        const pathsArray = this.core.pathsToArray(paths);
        
        // Draw all paths normally
        this.drawPaths(paths, canvas, {
            fillOuter: '#e5e7eb',
            strokeOuter: '#9ca3af'
        });
        
        // Highlight selected path
        if (index >= 0 && index < pathsArray.length) {
            const ctx = canvas.getContext('2d');
            const pathInfo = pathsArray[index];
            
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 3;
            ctx.fillStyle = '#ef444440';
            
            ctx.beginPath();
            pathInfo.points.forEach((point, i) => {
                if (i === 0) {
                    ctx.moveTo(point.x, point.y);
                } else {
                    ctx.lineTo(point.x, point.y);
                }
            });
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            
            // Draw direction arrow
            if (pathInfo.points.length > 1) {
                this.drawDirectionArrow(ctx, pathInfo.points);
            }
        }
    }

    /**
     * Draw direction arrow on path
     */
    drawDirectionArrow(ctx, points) {
        if (points.length < 2) return;
        
        // Find midpoint
        const midIndex = Math.floor(points.length / 2);
        const p1 = points[midIndex - 1];
        const p2 = points[midIndex];
        
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const angle = Math.atan2(dy, dx);
        
        const arrowLength = 10;
        const arrowAngle = Math.PI / 6;
        
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        
        // Draw arrow
        ctx.beginPath();
        ctx.moveTo(p2.x, p2.y);
        ctx.lineTo(
            p2.x - arrowLength * Math.cos(angle - arrowAngle),
            p2.y - arrowLength * Math.sin(angle - arrowAngle)
        );
        ctx.moveTo(p2.x, p2.y);
        ctx.lineTo(
            p2.x - arrowLength * Math.cos(angle + arrowAngle),
            p2.y - arrowLength * Math.sin(angle + arrowAngle)
        );
        ctx.stroke();
    }

    /**
     * Draw point in polygon visualization
     */
    drawPointInPolygon(polygon, testPoints, canvasId) {
        const canvas = typeof canvasId === 'string' ?
            document.getElementById(canvasId) : canvasId;
        
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        
        // Draw polygon
        const paths = new this.core.clipper2.Paths64();
        paths.push_back(polygon);
        this.drawPaths(paths, canvas, {
            fillOuter: '#3b82f640',
            strokeOuter: '#3b82f6'
        });
        
        // Draw test points
        testPoints.forEach(point => {
            ctx.beginPath();
            ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
            
            // Color based on position
            if (point.inside === true) {
                ctx.fillStyle = '#10b981';  // Green - inside
            } else if (point.inside === false) {
                ctx.fillStyle = '#ef4444';  // Red - outside
            } else {
                ctx.fillStyle = '#f59e0b';  // Orange - on edge
            }
            
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.stroke();
            
            // Label
            if (point.label) {
                ctx.fillStyle = '#000';
                ctx.font = '10px Arial';
                ctx.textAlign = 'left';
                ctx.fillText(point.label, point.x + 8, point.y + 3);
            }
        });
    }

    /**
     * Create gradient fill
     */
    createGradient(ctx, bounds, colors) {
        const gradient = ctx.createLinearGradient(
            bounds.minX, bounds.minY,
            bounds.maxX, bounds.maxY
        );
        
        colors.forEach((color, i) => {
            gradient.addColorStop(i / (colors.length - 1), color);
        });
        
        return gradient;
    }

    /**
     * Draw debug info
     */
    drawDebugInfo(paths, canvasId) {
        const canvas = typeof canvasId === 'string' ?
            document.getElementById(canvasId) : canvasId;
        
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const pathsArray = this.core.pathsToArray(paths);
        
        // Draw paths with debug info
        this.drawPaths(paths, canvas, {
            showPoints: true,
            showLabels: true
        });
        
        // Draw info panel
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillRect(10, canvas.height - 100, 200, 90);
        
        ctx.fillStyle = 'white';
        ctx.font = '12px monospace';
        ctx.fillText(`Paths: ${pathsArray.length}`, 20, canvas.height - 80);
        ctx.fillText(`Points: ${this.renderStats.totalPoints}`, 20, canvas.height - 65);
        ctx.fillText(`Render: ${this.renderStats.lastRenderTime.toFixed(2)}ms`, 20, canvas.height - 50);
        
        // Draw path types
        const outers = pathsArray.filter(p => p.orientation === 'outer').length;
        const holes = pathsArray.filter(p => p.orientation === 'hole').length;
        ctx.fillText(`Outers: ${outers}, Holes: ${holes}`, 20, canvas.height - 35);
        
        // Draw scale info
        ctx.fillText(`Scale: 1:${this.core.config.scale}`, 20, canvas.height - 20);
    }

    /**
     * Get render statistics
     */
    getRenderStats() {
        return { ...this.renderStats };
    }

    /**
     * Reset render statistics
     */
    resetStats() {
        this.renderStats = {
            totalPaths: 0,
            totalPoints: 0,
            lastRenderTime: 0
        };
    }
}