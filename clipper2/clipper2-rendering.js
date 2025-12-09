/**
 * @file        clipper2-renderings.js
 * @description Rendering for Paths64, PolyTree, and JS coordinate arrays
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

class Clipper2Rendering {
    constructor(core) {
        this.core = core;
        this.geometry = null;
        this.defaults = null;
        this.renderStats = { totalPaths: 0, totalPoints: 0, lastRenderTime: 0 };
        this.cssVarsCache = new Map();
        this.devicePixelRatio = window.devicePixelRatio || 1;
        this.svgExporter = null;

        window.addEventListener('resize', () => this.resizeAllCanvases());
    }

    initialize(defaults) {
        this.defaults = defaults;
        if (typeof Clipper2SVGExporter !== 'undefined') {
            this.svgExporter = new Clipper2SVGExporter(defaults);
        }
        this.updateCSSCache();
        this.resizeAllCanvases();
    }

    setGeometryModule(geometry) {
        this.geometry = geometry;
    }

    /**
     * Main Render Entry Point
     */

    render(input, canvasOrId, options = {}) {
        const startTime = performance.now();
        const canvas = this._getCanvas(canvasOrId);
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const opts = this._resolveOptions(options);

        this._ensureCanvasScaling(canvas, ctx);
        if (opts.clear !== false) this.clearCanvas(canvas);

        this.renderStats.totalPaths = 0;
        this.renderStats.totalPoints = 0;

        if (!input) return;

        // Dispatch based on input type
        if (this._isStructuredPolyTree(input)) {
            this._renderStructuredPolyTree(ctx, input, opts);
        } else if (this._isClipper2Paths(input)) {
            this._renderClipperPaths(ctx, input, opts);
        } else if (this._isClipper2Path(input)) {
            this._renderClipperPathSingle(ctx, input, opts);
        } else if (Array.isArray(input)) {
            this._renderJsCoordinates(ctx, input, opts);
        }

        this.renderStats.lastRenderTime = performance.now() - startTime;
    }

    renderPolyTree(data, canvasOrId, options = {}) {
        this.render(data, canvasOrId, options);
    }

    /**
     * Structured PolyTree Rendering
     */

    _renderStructuredPolyTree(ctx, data, opts) {
        ctx.lineWidth = opts.strokeWidth || 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const polygons = data.polygons || [];

        const renderPolygonNode = (node) => {
            if (!node || !node.outer) return;

            // Fill: Outer + all holes in single path for evenodd
            if (opts.fillOuter && opts.fillOuter !== 'none') {
                ctx.fillStyle = opts.fillOuter;
                ctx.beginPath();

                // Outer contour
                if (node.outer.points) {
                    this._tracePoints(ctx, node.outer.points);
                }

                // Hole contours (punch through)
                if (node.holes) {
                    node.holes.forEach(hole => {
                        if (hole.points) this._tracePoints(ctx, hole.points);
                    });
                }

                ctx.fill('evenodd');
            }

            // Stroke outer
            if (opts.strokeOuter && opts.strokeOuter !== 'none') {
                ctx.strokeStyle = opts.strokeOuter;
                ctx.beginPath();
                if (node.outer.points) {
                    this._tracePoints(ctx, node.outer.points);
                }
                ctx.stroke();
            }

            // Stroke holes with dashed line
            if (node.holes && node.holes.length > 0) {
                const holeStroke = opts.strokeHole || opts.strokeOuter;
                if (holeStroke && holeStroke !== 'none') {
                    ctx.strokeStyle = holeStroke;
                    ctx.setLineDash([5, 5]);
                    ctx.beginPath();
                    node.holes.forEach(hole => {
                        if (hole.points) this._tracePoints(ctx, hole.points);
                    });
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
            }

            // Recurse into islands (nested outers inside holes)
            if (node.islands) {
                node.islands.forEach(island => renderPolygonNode(island));
            }
        };

        polygons.forEach(poly => renderPolygonNode(poly));
        this.renderStats.totalPaths = polygons.length;
    }

    /**
     * Clipper2 WASM Paths64 Rendering
     */

    _renderClipperPaths(ctx, paths, opts) {
        const count = paths.size();
        const scale = this.core.config.scale;

        this.renderStats.totalPaths = count;

        ctx.lineWidth = opts.strokeWidth || 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Batch fill
        if (opts.fillOuter && opts.fillOuter !== 'none') {
            ctx.fillStyle = opts.fillOuter;
            ctx.beginPath();
            for (let i = 0; i < count; i++) {
                this._tracePath64(ctx, paths.get(i), scale);
            }
            ctx.fill('evenodd');
        }

        // Batch stroke
        if (opts.strokeOuter && opts.strokeOuter !== 'none') {
            ctx.strokeStyle = opts.strokeOuter;
            ctx.beginPath();
            for (let i = 0; i < count; i++) {
                const path = paths.get(i);
                this._tracePath64(ctx, path, scale);
                this.renderStats.totalPoints += path.size();
            }
            ctx.stroke();
        }
    }

    _renderClipperPathSingle(ctx, path, opts) {
        const scale = this.core.config.scale;
        this.renderStats.totalPaths = 1;
        this.renderStats.totalPoints = path.size();

        ctx.lineWidth = opts.strokeWidth || 2;
        ctx.beginPath();
        this._tracePath64(ctx, path, scale);

        if (opts.fillOuter && opts.fillOuter !== 'none') {
            ctx.fillStyle = opts.fillOuter;
            ctx.fill('evenodd');
        }
        if (opts.strokeOuter && opts.strokeOuter !== 'none') {
            ctx.strokeStyle = opts.strokeOuter;
            ctx.stroke();
        }
    }

    /**
     * JS Coordinate Array Rendering
     */

    _renderJsCoordinates(ctx, input, opts) {
        // Normalize to array of path objects
        let paths = [];
        if (input.length > 0) {
            const first = input[0];
            // Check if it's a single path [[x,y], ...] vs multiple [[[x,y],...], ...]
            if (Array.isArray(first) && typeof first[0] === 'number') {
                paths = [{ coords: input }];
            } else if (first.coords) {
                paths = input;
            } else if (Array.isArray(first)) {
                paths = input.map(c => ({ coords: c }));
            }
        }

        this.renderStats.totalPaths = paths.length;

        ctx.lineWidth = opts.strokeWidth || 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (opts.fillOuter && opts.fillOuter !== 'none') {
            ctx.fillStyle = opts.fillOuter;
            ctx.beginPath();
            paths.forEach(p => this._tracePoints(ctx, p.coords || p));
            ctx.fill('evenodd');
        }

        if (opts.strokeOuter && opts.strokeOuter !== 'none') {
            ctx.strokeStyle = opts.strokeOuter;
            ctx.beginPath();
            paths.forEach(p => {
                const pts = p.coords || p;
                this._tracePoints(ctx, pts);
                this.renderStats.totalPoints += pts.length;
            });
            ctx.stroke();
        }
    }

    /**
     * Path Tracing Helpers
     */

    _tracePath64(ctx, path, scale) {
        const len = path.size();
        if (len < 2) return;

        let p = path.get(0);
        ctx.moveTo(Number(p.x) / scale, Number(p.y) / scale);

        for (let j = 1; j < len; j++) {
            p = path.get(j);
            ctx.lineTo(Number(p.x) / scale, Number(p.y) / scale);
        }
        ctx.closePath();
    }

    _tracePoints(ctx, points) {
        if (!points || points.length < 2) return;

        const getXY = (pt) => {
            if (Array.isArray(pt)) return { x: pt[0], y: pt[1] };
            return { x: pt.x, y: pt.y };
        };

        const start = getXY(points[0]);
        ctx.moveTo(start.x, start.y);

        for (let i = 1; i < points.length; i++) {
            const pt = getXY(points[i]);
            ctx.lineTo(pt.x, pt.y);
        }
        ctx.closePath();
    }

    /**
     * Specialized Drawing Methods
     */

    drawSimplePaths(coords, canvasOrId, options = {}) {
        this.render(coords, canvasOrId, options);
    }

    drawShapePreview(shapes, canvasOrId) {
        const canvas = this._getCanvas(canvasOrId);
        if (!canvas) return;

        this.clearCanvas(canvas);
        const ctx = canvas.getContext('2d');
        ctx.save();

        const shapeList = Array.isArray(shapes) ? shapes : Object.values(shapes);

        shapeList.forEach(shape => {
            if (!shape) return;

            // Resolve color - handle both CSS vars and direct hex/rgb
            let strokeColor = shape.color || '#3b82f6';
            if (strokeColor.startsWith('var(')) {
                strokeColor = this.resolveStyleValue(strokeColor) || '#3b82f6';
            }

            ctx.beginPath();

            if (shape.type === 'rect') {
                ctx.rect(shape.x, shape.y, shape.width, shape.height);
            } else if (shape.type === 'circle') {
                ctx.arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2);
            } else if (shape.type === 'polygon' && shape.coords) {
                this._tracePoints(ctx, shape.coords);
            }

            // Fill with transparency
            ctx.fillStyle = strokeColor;
            ctx.globalAlpha = 0.25;
            ctx.fill();

            // Stroke solid
            ctx.globalAlpha = 1.0;
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 2;
            ctx.stroke();
        });

        ctx.restore();
    }

    drawStrokes(definition, canvasOrId, options = {}) {
        const canvas = this._getCanvas(canvasOrId);
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        this._ensureCanvasScaling(canvas, ctx);

        if (options.clear !== false) this.clearCanvas(canvas);

        const style = options.style || this.defaults.styles.default;
        const fill = this.resolveStyleValue(style.fillOuter) || 'rgba(59, 130, 246, 0.25)';
        const stroke = this.resolveStyleValue(style.strokeOuter) || '#3b82f6';

        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;

        const polygons = [];

        if (definition.type === 'strokes') {
            definition.data.forEach(s => {
                polygons.push(this.defaults.generators.strokeToPolygon(s, definition.strokeWidth));
            });
        } else if (definition.type === 'pcb') {
            definition.traces?.forEach(t => {
                polygons.push(this.defaults.generators.lineToPolygon(t.from, t.to, definition.traceWidth));
            });
            definition.pads?.forEach(p => {
                polygons.push(this.defaults.generators.circle(p.center[0], p.center[1], p.radius, 32));
            });
        }

        polygons.forEach(poly => {
            ctx.beginPath();
            this._tracePoints(ctx, poly);
            if (fill !== 'none') ctx.fill();
            if (stroke !== 'none') ctx.stroke();
        });
    }

    drawOffsetPaths(offsetPaths, canvasOrId, type, originalPaths) {
        const canvas = this._getCanvas(canvasOrId);
        if (!canvas) return;

        this.clearCanvas(canvas);

        const drawOriginal = () => {
            if (!originalPaths) return;

            // Erase area under original shape
            const ctx = canvas.getContext('2d');
            ctx.save();
            ctx.fillStyle = this.getCSSVar('--canvas-bg') || '#ffffff';
            ctx.beginPath();

            if (this._isClipper2Paths(originalPaths)) {
                for (let i = 0; i < originalPaths.size(); i++) {
                    this._tracePath64(ctx, originalPaths.get(i), this.core.config.scale);
                }
            }
            ctx.fill('evenodd');
            ctx.restore();

            // Draw original shape
            this.render(originalPaths, canvas, {
                fillOuter: this.resolveStyleValue('var(--shape-fill)'),
                strokeOuter: this.resolveStyleValue('var(--shape-stroke)'),
                strokeWidth: 2,
                clear: false
            });
        };

        if (type === 'internal') drawOriginal();

        const count = offsetPaths.length;
        const isExternal = type === 'external';

        for (let i = isExternal ? count - 1 : 0; 
             isExternal ? i >= 0 : i < count; 
             isExternal ? i-- : i++) {
            const t = (i + 1) / count;
            const hue = 120 - (t * (isExternal ? 60 : 120));

            this.render(offsetPaths[i], canvas, {
                fillOuter: `hsla(${hue}, 70%, 50%, ${0.3 + t * 0.3})`,
                strokeOuter: `hsl(${hue}, 70%, 40%)`,
                strokeWidth: 1,
                clear: false
            });
        }

        if (type === 'external') drawOriginal();
    }

    drawGrid(canvasOrId, gridSize) {
        const canvas = this._getCanvas(canvasOrId);
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        gridSize = gridSize || this.defaults.config.gridSize;

        const width = canvas.width / this.devicePixelRatio;
        const height = canvas.height / this.devicePixelRatio;

        ctx.strokeStyle = this.getCSSVar('--grid-color') || '#e5e7eb';
        ctx.lineWidth = 0.5;
        ctx.beginPath();

        for (let x = 0; x <= width; x += gridSize) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
        }
        for (let y = 0; y <= height; y += gridSize) {
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
        }
        ctx.stroke();
    }

    drawDefaultPIP() {
        const pipDef = this.defaults.geometries.pip;
        this.render([pipDef.data], 'pip-canvas', this.defaults.styles.default);

        const canvas = this._getCanvas('pip-canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.font = '12px Arial';
            ctx.fillStyle = '#6b7280';
            ctx.fillText('Click to add test points', 10, 20);
        }
    }

    /**
     * Canvas & Style Management
     */

    clearCanvas(canvasOrId) {
        const canvas = this._getCanvas(canvasOrId);
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const w = canvas.width / this.devicePixelRatio;
        const h = canvas.height / this.devicePixelRatio;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = this.getCSSVar('--canvas-bg') || '#ffffff';
        ctx.fillRect(0, 0, w, h);
    }

    _ensureCanvasScaling(canvas, ctx) {
        const rect = canvas.getBoundingClientRect();
        const targetW = Math.round(rect.width * this.devicePixelRatio);
        const targetH = Math.round(rect.height * this.devicePixelRatio);

        if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(this.devicePixelRatio, this.devicePixelRatio);
            return true;
        }
        return false;
    }

    resizeAllCanvases() {
        document.querySelectorAll('canvas').forEach(canvas => {
            const ctx = canvas.getContext('2d');
            this._ensureCanvasScaling(canvas, ctx);
        });
    }

    _getCanvas(canvasOrId) {
        return typeof canvasOrId === 'string' 
            ? document.getElementById(canvasOrId) 
            : canvasOrId;
    }

    _resolveOptions(options) {
        const base = this.defaults?.styles?.default || {};
        const opts = { clear: true, strokeWidth: 2, ...base, ...options };

        // Resolve CSS variables in style properties
        ['fillOuter', 'strokeOuter', 'fillHole', 'strokeHole'].forEach(key => {
            if (opts[key]) {
                opts[key] = this.resolveStyleValue(opts[key]);
            }
        });

        return opts;
    }

    resolveStyleValue(value) {
        if (!value) return undefined;
        if (typeof value !== 'string') return value;

        if (value.startsWith('var(')) {
            const match = value.match(/var\((--[^)]+)\)/);
            if (match) {
                return this.getCSSVar(match[1]) || undefined;
            }
        }
        return value;
    }

    getCSSVar(varName) {
        if (!this.cssVarsCache.has(varName)) {
            this.updateCSSCache();
        }
        return this.cssVarsCache.get(varName);
    }

    updateCSSCache() {
        const style = getComputedStyle(document.documentElement);
        const vars = [
            '--canvas-bg', '--grid-color', '--shape-fill', '--shape-stroke',
            '--hole-stroke', '--input-fill', '--input-stroke', '--output-fill',
            '--output-stroke', '--subject-fill', '--subject-stroke',
            '--clip-fill', '--clip-stroke', '--pcb-fill', '--pcb-stroke',
            '--pip-inside', '--pip-outside', '--pip-edge'
        ];
        vars.forEach(v => {
            const val = style.getPropertyValue(v).trim();
            if (val) this.cssVarsCache.set(v, val);
        });
    }

    /**
     * Type Detection
     */

    _isClipper2Paths(input) {
        return input && typeof input.size === 'function' && typeof input.get === 'function';
    }

    _isClipper2Path(input) {
        return input && typeof input.size === 'function' && 
               typeof input.push_back === 'function' && 
               !this._isClipper2Paths(input);
    }

    _isStructuredPolyTree(input) {
        return input && typeof input === 'object' && 
               (Array.isArray(input.polygons) || input.outer !== undefined);
    }

    /**
     * SVG Export
     */

    exportSVG(input, width, height) {
        if (this.svgExporter) {
            return this.svgExporter.exportSVG(input, width, height);
        }
        return '';
    }
}