/**
 * Clipper2 Rendering Module
 * Unified rendering pipeline using coordinate arrays
 * Version 5.2 - Fixed minkowski visualization
 */

class Clipper2Rendering {
    constructor(core) {
        this.core = core;
        this.geometry = null; // Will be set by tests module
        this.defaults = null; // Will be set during initialization
        this.renderStats = {
            totalPaths: 0,
            totalPoints: 0,
            lastRenderTime: 0
        };
        this.cssVarsCache = new Map(); // Cache for CSS variables
    }

    /**
     * Initialize with defaults reference
     */
    initialize(defaults) {
        this.defaults = defaults;
        // Pre-cache commonly used CSS variables
        this.updateCSSCache();
    }

    /**
     * Set geometry module reference
     */
    setGeometryModule(geometry) {
        this.geometry = geometry;
    }

    /**
     * Update CSS variable cache
     */
    updateCSSCache() {
        const root = document.documentElement;
        const computedStyle = getComputedStyle(root);
        
        // Cache all CSS variables we use
        const vars = [
            '--canvas-bg', '--grid-color',
            '--shape-fill', '--shape-stroke', '--hole-stroke',
            '--input-fill', '--input-stroke',
            '--output-fill', '--output-stroke',
            '--subject-fill', '--subject-stroke',
            '--clip-fill', '--clip-stroke',
            '--pcb-fill', '--pcb-stroke',
            '--pip-inside', '--pip-outside', '--pip-edge',
            '--text', '--text-secondary'
        ];
        
        vars.forEach(varName => {
            this.cssVarsCache.set(varName, computedStyle.getPropertyValue(varName).trim());
        });
    }

    /**
     * Get CSS variable value (with caching)
     */
    getCSSVar(varName) {
        if (!this.cssVarsCache.has(varName)) {
            const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
            this.cssVarsCache.set(varName, value);
        }
        return this.cssVarsCache.get(varName);
    }

    /**
     * Resolve style value - returns CSS variable or direct value
     */
    resolveStyleValue(value) {
        if (typeof value === 'string' && value.startsWith('var(')) {
            // Extract variable name and get its value
            const match = value.match(/var\((--[^)]+)\)/);
            if (match) {
                return this.getCSSVar(match[1]);
            }
        }
        return value;
    }

    /**
     * Main rendering function - accepts either Clipper2 paths or coordinates
     */
    render(input, canvasOrId, options = {}) {
        const startTime = performance.now();
        
        // Get canvas element
        const canvas = typeof canvasOrId === 'string' ? 
            document.getElementById(canvasOrId) : canvasOrId;
        
        if (!canvas) {
            console.warn('[RENDER] Canvas not found');
            return;
        }
        
        // Convert input to coordinate arrays
        let pathData;
        if (this.isClipper2Paths(input)) {
            pathData = this.geometry.paths64ToCoordinates(input);
        } else if (this.isClipper2Path(input)) {
            // Single path - wrap in array
            pathData = [{
                coords: this.geometry.path64ToCoordinates(input),
                area: this.geometry.calculateArea(input),
                orientation: null
            }];
        } else {
            // Already coordinates
            pathData = this.normalizeCoordinates(input);
        }
        
        // Determine orientations
        pathData.forEach(item => {
            if (item.orientation === null || item.orientation === undefined) {
                item.orientation = item.area > 0 ? 'outer' : 'hole';
            }
        });
        
        // Apply default options and resolve CSS variables
        const opts = {
            ...this.defaults.styles.default,
            clear: true,
            fillRule: 'evenodd',
            showPoints: false,
            showLabels: false,
            ...options
        };
        
        // Resolve all style values
        Object.keys(opts).forEach(key => {
            if (key.includes('fill') || key.includes('stroke') || key.includes('color')) {
                opts[key] = this.resolveStyleValue(opts[key]);
            }
        });
        
        // Render paths
        this.renderPaths(pathData, canvas, opts);
        
        // Update stats
        this.renderStats.totalPaths = pathData.length;
        this.renderStats.totalPoints = pathData.reduce((sum, p) => sum + p.coords.length, 0);
        this.renderStats.lastRenderTime = performance.now() - startTime;
        
        if (this.core.config.debugMode) {
            console.log(`[RENDER] ${this.renderStats.totalPaths} paths, ${this.renderStats.totalPoints} points, ${this.renderStats.lastRenderTime.toFixed(2)}ms`);
        }
    }

    /**
     * Core rendering function for coordinate arrays
     */
    renderPaths(pathData, canvas, options) {
        const ctx = canvas.getContext('2d');
        
        // Clear canvas if requested
        if (options.clear) {
            this.clearCanvas(canvas);
        }
        
        // Group paths by type
        const outers = pathData.filter(p => p.orientation === 'outer');
        const holes = pathData.filter(p => p.orientation === 'hole');
        
        // Draw fill (all paths at once for proper holes with even-odd rule)
        if (options.fillOuter && options.fillOuter !== 'none') {
            ctx.fillStyle = options.fillOuter;
            ctx.beginPath();
            
            // Add all paths to the same context
            pathData.forEach(item => {
                this.addPathToContext(ctx, item.coords);
            });
            
            // Use evenodd fill rule to properly render holes
            ctx.fill('evenodd');
        }
        
        // Draw strokes
        ctx.lineWidth = options.strokeWidth;
        
        // Draw outer strokes
        if (outers.length > 0 && options.strokeOuter && options.strokeOuter !== 'none') {
            ctx.strokeStyle = options.strokeOuter;
            outers.forEach(item => {
                ctx.beginPath();
                this.addPathToContext(ctx, item.coords);
                ctx.stroke();
                
                if (options.showPoints) {
                    this.drawPoints(ctx, item.coords, options.strokeOuter);
                }
            });
        }
        
        // Draw hole strokes with different style
        if (holes.length > 0 && options.strokeHole) {
            ctx.strokeStyle = options.strokeHole || options.strokeOuter;
            ctx.setLineDash([5, 5]);
            
            holes.forEach(item => {
                ctx.beginPath();
                this.addPathToContext(ctx, item.coords);
                ctx.stroke();
                
                if (options.showPoints) {
                    this.drawPoints(ctx, item.coords, options.strokeHole);
                }
            });
            
            ctx.setLineDash([]);
        }
        
        // Draw labels if requested
        if (options.showLabels) {
            this.drawLabels(ctx, pathData);
        }
    }

    /**
     * Draw simple paths (for defaults/previews)
     */
    drawSimplePaths(coords, canvasOrId, options = {}) {
        const canvas = typeof canvasOrId === 'string' ? 
            document.getElementById(canvasOrId) : canvasOrId;
        
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        
        // Apply default options and resolve CSS variables
        const opts = {
            ...this.defaults.styles.default,
            clear: true,
            ...options
        };
        
        // Resolve style values
        Object.keys(opts).forEach(key => {
            if (key.includes('fill') || key.includes('stroke') || key.includes('color')) {
                opts[key] = this.resolveStyleValue(opts[key]);
            }
        });
        
        if (opts.clear) {
            this.clearCanvas(canvas);
        }
        
        ctx.fillStyle = opts.fillOuter;
        ctx.strokeStyle = opts.strokeOuter;
        ctx.lineWidth = opts.strokeWidth;
        
        // Handle array of paths or single path
        const paths = Array.isArray(coords[0]) && !Array.isArray(coords[0][0]) ? [coords] : coords;
        
        paths.forEach(path => {
            ctx.beginPath();
            this.addPathToContext(ctx, path);
            if (opts.fillOuter && opts.fillOuter !== 'none') {
                ctx.fill();
            }
            if (opts.strokeOuter && opts.strokeOuter !== 'none') {
                ctx.stroke();
            }
        });
    }

    /**
     * Draw strokes - FIXED to use polygon generation (WYSIWYG)
     * This ensures visual representation matches processing
     */
    drawStrokes(definition, canvasOrId, options = {}) {
        const canvas = typeof canvasOrId === 'string' ? 
            document.getElementById(canvasOrId) : canvasOrId;
        
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        
        if (options.clear !== false) {
            this.clearCanvas(canvas);
        }
        
        const style = options.style || this.defaults.styles.default;
        
        if (definition.type === 'strokes') {
            // Convert strokes to polygons using the SAME generator used for processing
            const polygons = [];
            
            definition.data.forEach(stroke => {
                const polygon = this.defaults.generators.strokeToPolygon(
                    stroke, 
                    definition.strokeWidth
                );
                polygons.push(polygon);
            });
            
            // Now render the polygons
            ctx.fillStyle = this.resolveStyleValue(style.fillOuter);
            ctx.strokeStyle = this.resolveStyleValue(style.strokeOuter);
            ctx.lineWidth = 1; // Polygon outline
            
            polygons.forEach(polygon => {
                ctx.beginPath();
                this.addPathToContext(ctx, polygon);
                
                if (style.fillOuter && style.fillOuter !== 'none') {
                    ctx.fill();
                }
                if (style.strokeOuter && style.strokeOuter !== 'none') {
                    ctx.stroke();
                }
            });
            
            // Optional: Add debug mode to show polygon vertices
            if (options.showVertices) {
                ctx.fillStyle = '#ff0000';
                polygons.forEach(polygon => {
                    polygon.forEach(point => {
                        ctx.beginPath();
                        ctx.arc(point[0], point[1], 2, 0, Math.PI * 2);
                        ctx.fill();
                    });
                });
            }
            
        } else if (definition.type === 'pcb') {
            // Convert PCB traces to polygons
            const polygons = [];
            
            // Convert traces
            definition.traces?.forEach(trace => {
                const polygon = this.defaults.generators.lineToPolygon(
                    trace.from, 
                    trace.to, 
                    definition.traceWidth
                );
                polygons.push(polygon);
            });
            
            // Convert pads  
            definition.pads?.forEach(pad => {
                const circle = this.defaults.generators.circle(
                    pad.center[0], 
                    pad.center[1], 
                    pad.radius,
                    32 // Use fewer segments for visualization
                );
                polygons.push(circle);
            });
            
            // Render all polygons
            ctx.fillStyle = this.resolveStyleValue(style.fillOuter);
            ctx.strokeStyle = this.resolveStyleValue(style.strokeOuter);
            ctx.lineWidth = 1;
            
            polygons.forEach(polygon => {
                ctx.beginPath();
                this.addPathToContext(ctx, polygon);
                
                if (style.fillOuter && style.fillOuter !== 'none') {
                    ctx.fill();
                }
                if (style.strokeOuter && style.strokeOuter !== 'none') {
                    ctx.stroke();
                }
            });
            
            // Optional: Add debug mode to show polygon vertices
            if (options.showVertices) {
                ctx.fillStyle = '#ff0000';
                polygons.forEach(polygon => {
                    polygon.forEach((point, idx) => {
                        ctx.beginPath();
                        ctx.arc(point[0], point[1], 2, 0, Math.PI * 2);
                        ctx.fill();
                        
                        // Label first few points for debugging
                        if (idx < 3) {
                            ctx.font = '10px Arial';
                            ctx.fillStyle = '#000';
                            ctx.fillText(idx.toString(), point[0] + 5, point[1]);
                        }
                    });
                });
            }
        }
    }

    /**
     * Draw shape preview for draggable tests
     */
    drawShapePreview(shapes, canvasOrId, options = {}) {
        const canvas = typeof canvasOrId === 'string' ? 
            document.getElementById(canvasOrId) : canvasOrId;
        
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        this.clearCanvas(canvas);
        
        // Process both objects and arrays
        const shapeList = Array.isArray(shapes) ? shapes : Object.values(shapes);
        
        shapeList.forEach(shape => {
            if (!shape || typeof shape !== 'object') return;
            
            // Resolve colors from CSS variables if needed
            const fillColor = shape.color ? 
                this.resolveStyleValue(shape.color + '40') : 
                this.resolveStyleValue('var(--shape-fill)');
            const strokeColor = shape.color ? 
                this.resolveStyleValue(shape.color) : 
                this.resolveStyleValue('var(--shape-stroke)');
            
            ctx.fillStyle = fillColor;
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 2;
            
            if (shape.type === 'rect') {
                ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
                ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
            } else if (shape.type === 'circle') {
                ctx.beginPath();
                ctx.arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            } else if (shape.type === 'polygon' && shape.coords) {
                ctx.beginPath();
                this.addPathToContext(ctx, shape.coords);
                ctx.fill();
                ctx.stroke();
            }
        });
    }

    /**
     * Clear canvas
     */
    clearCanvas(canvasOrId) {
        const canvas = typeof canvasOrId === 'string' ? 
            document.getElementById(canvasOrId) : canvasOrId;
        
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = this.getCSSVar('--canvas-bg');
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    /**
     * Add path to canvas context
     */
    addPathToContext(ctx, coords) {
        if (!coords || coords.length === 0) return;
        
        coords.forEach((point, i) => {
            const x = Array.isArray(point) ? point[0] : point.x;
            const y = Array.isArray(point) ? point[1] : point.y;
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        
        ctx.closePath();
    }

    /**
     * Draw individual points
     */
    drawPoints(ctx, coords, color) {
        ctx.fillStyle = this.resolveStyleValue(color);
        coords.forEach(point => {
            const x = Array.isArray(point) ? point[0] : point.x;
            const y = Array.isArray(point) ? point[1] : point.y;
            
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    /**
     * Draw path labels
     */
    drawLabels(ctx, pathData) {
        ctx.font = '12px Arial';
        ctx.fillStyle = this.getCSSVar('--text-secondary');
        
        pathData.forEach((item, i) => {
            if (item.coords.length > 0) {
                const center = this.getPathCenter(item.coords);
                ctx.fillText(`P${i}`, center.x, center.y);
            }
        });
    }

    /**
     * Get center point of a path
     */
    getPathCenter(coords) {
        const bounds = this.getPathBounds(coords);
        return {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2
        };
    }

    /**
     * Get bounding box of a path
     */
    getPathBounds(coords) {
        if (coords.length === 0) {
            return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        }
        
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        coords.forEach(point => {
            const x = Array.isArray(point) ? point[0] : point.x;
            const y = Array.isArray(point) ? point[1] : point.y;
            
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        });
        
        return { minX, minY, maxX, maxY };
    }

    /**
     * Draw comparison view
     */
    drawComparison(input, output, canvasOrId) {
        const canvas = typeof canvasOrId === 'string' ? 
            document.getElementById(canvasOrId) : canvasOrId;
        
        if (!canvas) return;
        
        // Clear and draw input
        this.render(input, canvas, {
            ...this.defaults.styles.input,
            clear: true
        });
        
        // Draw output on top
        this.render(output, canvas, {
            ...this.defaults.styles.output,
            clear: false
        });
        
        // Add legend
        const ctx = canvas.getContext('2d');
        ctx.font = '12px Arial';
        ctx.fillStyle = this.getCSSVar('--input-stroke');
        ctx.fillText('Input', 10, 20);
        ctx.fillStyle = this.getCSSVar('--output-stroke');
        ctx.fillText('Output', 10, 35);
    }

    /**
     * Draw multiple offset paths
     */
    drawOffsetPaths(offsetPaths, canvasOrId) {
        const canvas = typeof canvasOrId === 'string' ? 
            document.getElementById(canvasOrId) : canvasOrId;
        
        if (!canvas) return;
        
        this.clearCanvas(canvas);
        
        // Draw from largest to smallest
        offsetPaths.reverse().forEach((paths, i) => {
            const hue = (i / offsetPaths.length) * 120;
            const alpha = 0.3 + (i / offsetPaths.length) * 0.3;
            
            this.render(paths, canvas, {
                fillOuter: `hsla(${hue}, 70%, 50%, ${alpha})`,
                strokeOuter: `hsl(${hue}, 70%, 40%)`,
                clear: false
            });
        });
    }

    /**
     * Draw grid
     */
    drawGrid(canvasOrId, gridSize = null) {
        const canvas = typeof canvasOrId === 'string' ? 
            document.getElementById(canvasOrId) : canvasOrId;
        
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        gridSize = gridSize || this.defaults.config.gridSize;
        
        ctx.strokeStyle = this.getCSSVar('--grid-color');
        ctx.lineWidth = 1;
        
        for (let i = 0; i <= canvas.width; i += gridSize) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, canvas.height);
            ctx.stroke();
        }
        
        for (let i = 0; i <= canvas.height; i += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(canvas.width, i);
            ctx.stroke();
        }
    }

    /**
     * Export paths as SVG
     */
    exportSVG(input, width = null, height = null) {
        width = width || this.defaults.config.canvasWidth;
        height = height || this.defaults.config.canvasHeight;
        
        // Convert to coordinates if needed
        let pathData;
        if (this.isClipper2Paths(input)) {
            pathData = this.geometry.paths64ToCoordinates(input);
        } else if (this.isClipper2Path(input)) {
            pathData = [{
                coords: this.geometry.path64ToCoordinates(input),
                area: this.geometry.calculateArea(input),
                orientation: 'outer'
            }];
        } else {
            pathData = this.normalizeCoordinates(input);
        }
        
        // Build SVG with proper colors
        const fillColor = this.getCSSVar('--shape-fill');
        const strokeColor = this.getCSSVar('--shape-stroke');
        
        let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" 
     xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="white"/>
  <g fill="${fillColor}" stroke="${strokeColor}" stroke-width="2" fill-rule="evenodd">
`;
        
        // Create path data
        let pathD = '';
        pathData.forEach(item => {
            pathD += 'M ';
            item.coords.forEach((point, i) => {
                const x = Array.isArray(point) ? point[0] : point.x;
                const y = Array.isArray(point) ? point[1] : point.y;
                
                if (i === 0) {
                    pathD += `${x} ${y} `;
                } else {
                    pathD += `L ${x} ${y} `;
                }
            });
            pathD += 'Z ';
        });
        
        svg += `    <path d="${pathD}"/>\n`;
        svg += '  </g>\n</svg>';
        
        return svg;
    }

    /**
     * Check if input is Clipper2 Paths64
     */
    isClipper2Paths(input) {
        return input && typeof input.size === 'function' && typeof input.get === 'function';
    }

    /**
     * Check if input is Clipper2 Path64
     */
    isClipper2Path(input) {
        return input && typeof input.size === 'function' && !input.get(0)?.size;
    }

    /**
     * Normalize coordinate input to standard format
     */
    normalizeCoordinates(input) {
        if (!input) return [];
        
        // If already in path data format
        if (input[0] && input[0].coords) {
            return input;
        }
        
        // Convert simple coordinate arrays
        const paths = Array.isArray(input[0]) && !Array.isArray(input[0][0]) ? [input] : input;
        
        return paths.map(coords => ({
            coords: coords,
            area: this.calculateAreaFromCoords(coords),
            orientation: null
        }));
    }

    /**
     * Calculate area from coordinate array
     */
    calculateAreaFromCoords(coords) {
        let area = 0;
        const n = coords.length;
        
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const pi = coords[i];
            const pj = coords[j];
            const xi = Array.isArray(pi) ? pi[0] : pi.x;
            const yi = Array.isArray(pi) ? pi[1] : pi.y;
            const xj = Array.isArray(pj) ? pj[0] : pj.x;
            const yj = Array.isArray(pj) ? pj[1] : pj.y;
            
            area += xi * yj - xj * yi;
        }
        
        return area / 2;
    }

    // Compatibility methods
    drawPaths(paths, canvasId, options = {}) {
        this.render(paths, canvasId, options);
    }
    
    drawPath(path, canvasId, options = {}) {
        this.render(path, canvasId, options);
    }
}