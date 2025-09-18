// parser/parser-svg.js
// SVG parsing module for PCB CAM Tool

(function() {
    'use strict';

    const config = window.PCBCAMConfig || {};
    const geomConfig = config.geometry || {};
    const segmentConfig = geomConfig.segments || {};

    class SVGParser extends ParserCore {
        constructor(options = {}) {
            super(options);
            this.svgData = {
                objects: [],
                bounds: null,
                units: 'mm' // Default assumption for PCB context
            };
        }

        parse(content) {
            try {
                this.debug('Starting SVG parse');
                this.reset();

                const parser = new DOMParser();
                const doc = parser.parseFromString(content, 'image/svg+xml');
                const svgNode = doc.documentElement;

                if (svgNode.tagName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
                    const errorMsg = doc.querySelector('parsererror')?.textContent || 'Invalid SVG file';
                    throw new Error(errorMsg);
                }

                // Initial transform is identity
                const initialTransform = [1, 0, 0, 1, 0, 0];
                this._traverseNode(svgNode, initialTransform);

                this.svgData.bounds = this.calculateBounds(this.svgData.objects);

                this.debug(`Parse complete: ${this.svgData.objects.length} objects created`);

                return {
                    success: true,
                    svgData: this.svgData,
                    errors: this.errors,
                    warnings: this.warnings
                };

            } catch (error) {
                this.errors.push(`SVG Parse error: ${error.message}`);
                return {
                    success: false,
                    svgData: null,
                    errors: this.errors,
                    warnings: this.warnings
                };
            }
        }

        reset() {
            super.reset(); // Resets errors, warnings, stats from ParserCore
            this.svgData = {
                objects: [],
                bounds: null,
                units: 'mm'
            };
        }

        /**
         * Recursively traverses the SVG DOM tree, accumulating transformations.
         * @param {Element} node - The current DOM node.
         * @param {Array<number>} parentTransform - The transformation matrix from the parent.
         */
        _traverseNode(node, parentTransform) {
            if (node.nodeType !== 1) return; // Only process element nodes

            const nodeTransformStr = node.getAttribute('transform');
            const nodeTransform = this._parseTransform(nodeTransformStr || '');
            const currentTransform = this._multiplyMatrix(parentTransform, nodeTransform);

            const tagName = node.tagName.toLowerCase();
            let parsedObject = null;

            switch (tagName) {
                case 'g':
                    // For groups, just traverse children
                    Array.from(node.children).forEach(child => this._traverseNode(child, currentTransform));
                    break;
                case 'rect':
                    parsedObject = this._parseRect(node);
                    break;
                case 'circle':
                    parsedObject = this._parseCircle(node);
                    break;
                case 'ellipse':
                    parsedObject = this._parseEllipse(node);
                    break;
                case 'line':
                    parsedObject = this._parseLine(node);
                    break;
                case 'polyline':
                case 'polygon':
                    parsedObject = this._parsePoly(node);
                    break;
                case 'path':
                    parsedObject = this._parsePath(node);
                    break;
            }

            if (parsedObject) {
                if (!Array.isArray(parsedObject)) {
                    parsedObject = [parsedObject];
                }

                parsedObject.forEach(obj => {
                    // Apply node styles and final transform
                    const styles = this._getStyles(node);
                    obj.properties = { ...styles, ...obj.properties };
                    obj.transform = currentTransform;

                    // Do not add objects that are invisible
                    if (obj.properties.fill !== 'none' || obj.properties.stroke !== 'none') {
                        this.svgData.objects.push(obj);
                        this.stats.objectsCreated++;
                    }
                });
            }
        }

        _parseRect(node) {
            const x = parseFloat(node.getAttribute('x') || 0);
            const y = parseFloat(node.getAttribute('y') || 0);
            const width = parseFloat(node.getAttribute('width') || 0);
            const height = parseFloat(node.getAttribute('height') || 0);

            if (width === 0 || height === 0) return null;

            // Rects are converted to closed paths
            const points = [
                { x, y },
                { x: x + width, y },
                { x: x + width, y: y + height },
                { x, y: y + height },
                { x, y } // Close path
            ];

            return { type: 'path', points, properties: { closed: true } };
        }

        _parseCircle(node) {
            const cx = parseFloat(node.getAttribute('cx') || 0);
            const cy = parseFloat(node.getAttribute('cy') || 0);
            const r = parseFloat(node.getAttribute('r') || 0);

            if (r === 0) return null;
            
            // Circles are passed as their analytic form for the plotter to handle
            return { type: 'circle', center: { x: cx, y: cy }, radius: r, properties: {} };
        }
        
        _parseEllipse(node) {
            const cx = parseFloat(node.getAttribute('cx') || 0);
            const cy = parseFloat(node.getAttribute('cy') || 0);
            const rx = parseFloat(node.getAttribute('rx') || 0);
            const ry = parseFloat(node.getAttribute('ry') || 0);

            if (rx === 0 || ry === 0) return null;
            
            // Ellipses are tessellated into paths
            const segments = segmentConfig.maxCircle || 128;
            const points = [];
            for (let i = 0; i <= segments; i++) {
                const angle = (i / segments) * 2 * Math.PI;
                points.push({
                    x: cx + rx * Math.cos(angle),
                    y: cy + ry * Math.sin(angle)
                });
            }

            return { type: 'path', points, properties: { closed: true } };
        }
        
        _parseLine(node) {
            const x1 = parseFloat(node.getAttribute('x1') || 0);
            const y1 = parseFloat(node.getAttribute('y1') || 0);
            const x2 = parseFloat(node.getAttribute('x2') || 0);
            const y2 = parseFloat(node.getAttribute('y2') || 0);

            const points = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
            return { type: 'path', points, properties: { closed: false } };
        }

        _parsePoly(node) {
            const pointsStr = (node.getAttribute('points') || '').trim();
            if (!pointsStr) return null;

            const pairs = pointsStr.split(/\s*,\s*|\s+/);
            const points = [];
            for (let i = 0; i < pairs.length; i += 2) {
                points.push({
                    x: parseFloat(pairs[i]),
                    y: parseFloat(pairs[i+1])
                });
            }

            const closed = node.tagName.toLowerCase() === 'polygon';
            if (closed && points.length > 0) {
                 points.push({ ...points[0] });
            }

            return { type: 'path', points, properties: { closed } };
        }

        _parsePath(node) {
             const d = node.getAttribute('d');
             if (!d) return null;

             const pathParser = new PathDataParser(d, {
                 debug: this.options.debug
             });
             const subPaths = pathParser.getSubPaths();

             return subPaths.map(subPath => ({
                 type: 'path',
                 points: subPath.points,
                 properties: { closed: subPath.closed }
             }));
        }

        _getStyles(node) {
            const style = {
                fill: node.getAttribute('fill') || 'black',
                stroke: node.getAttribute('stroke') || 'none',
                strokeWidth: parseFloat(node.getAttribute('stroke-width') || '1'),
            };

            // Simplified style attribute parsing
            const styleAttr = node.getAttribute('style');
            if (styleAttr) {
                styleAttr.split(';').forEach(declaration => {
                    const [prop, val] = declaration.split(':');
                    if (prop && val) {
                        const propName = prop.trim();
                        if (propName === 'fill') style.fill = val.trim();
                        if (propName === 'stroke') style.stroke = val.trim();
                        if (propName === 'stroke-width') style.strokeWidth = parseFloat(val.trim());
                    }
                });
            }

            // For CAM, if there is a fill, it's a filled region.
            // If there is a stroke, it's a stroked path.
            style.fill = style.fill !== 'none';
            style.stroke = style.stroke !== 'none';

            return style;
        }

        // --- Matrix Math ---
        _identityMatrix() { return [1, 0, 0, 1, 0, 0]; }
        _multiplyMatrix(m1, m2) {
            return [
                m1[0] * m2[0] + m1[2] * m2[1],
                m1[1] * m2[0] + m1[3] * m2[1],
                m1[0] * m2[2] + m1[2] * m2[3],
                m1[1] * m2[2] + m1[3] * m2[3],
                m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
                m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
            ];
        }
        
        _parseTransform(transformString) {
            let matrix = this._identityMatrix();
            if (!transformString) return matrix;

            const regex = /(\w+)\s*\(([^)]+)\)/g;
            let match;
            while ((match = regex.exec(transformString)) !== null) {
                const type = match[1].toLowerCase();
                const values = match[2].trim().split(/[\s,]+/).map(parseFloat);
                let transform = this._identityMatrix();

                if (type === 'matrix' && values.length === 6) {
                    transform = values;
                } else if (type === 'translate' && values.length >= 1) {
                    transform[4] = values[0];
                    transform[5] = values[1] || 0;
                } else if (type === 'scale' && values.length >= 1) {
                    const sy = values[1] === undefined ? values[0] : values[1];
                    transform[0] = values[0];
                    transform[3] = sy;
                } else if (type === 'rotate' && values.length >= 1) {
                    const angle = values[0] * Math.PI / 180;
                    const cos = Math.cos(angle);
                    const sin = Math.sin(angle);
                    let tx = 0, ty = 0;
                    if (values.length === 3) {
                       [tx, ty] = [values[1], values[2]];
                       matrix = this._multiplyMatrix(matrix, [1, 0, 0, 1, tx, ty]);
                    }
                    transform = [cos, sin, -sin, cos, 0, 0];
                    if (values.length === 3) {
                       transform = this._multiplyMatrix(transform, [1, 0, 0, 1, -tx, -ty]);
                    }
                }
                matrix = this._multiplyMatrix(matrix, transform);
            }
            return matrix;
        }

        getObjectBounds(obj) {
            const m = obj.transform;
            const transformPoint = (p, mat) => ({
                x: mat[0] * p.x + mat[2] * p.y + mat[4],
                y: mat[1] * p.x + mat[3] * p.y + mat[5]
            });

            let points = [];
            if (obj.type === 'path') {
                points = obj.points;
            } else if (obj.type === 'circle') {
                // Get bounds of transformed circle (now possibly an ellipse)
                for(let i=0; i<32; i++) {
                    const angle = i/32 * 2 * Math.PI;
                    points.push({
                        x: obj.center.x + obj.radius * Math.cos(angle),
                        y: obj.center.y + obj.radius * Math.sin(angle)
                    });
                }
            }

            if (points.length === 0) return null;

            const tPoints = points.map(p => transformPoint(p, m));
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            tPoints.forEach(p => {
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x);
                maxY = Math.max(maxY, p.y);
            });
            return { minX, minY, maxX, maxY };
        }
    }
    
    /**
     * A robust parser for SVG <path> data (the 'd' attribute).
     * Handles commands, relative/absolute coordinates, and tessellation of curves.
     */
    class PathDataParser {
         constructor(d, options = {}) {
            this.d = d;
            this.options = options;
            this.index = 0;
            this.subPaths = [];
            this.currentSubPath = null;
         }

         getSubPaths() {
             this._parse();
             return this.subPaths;
         }

        _parse() {
            let cmd, lastCmd;
            let currentPoint = { x: 0, y: 0 };
            let controlPoint = { x: 0, y: 0 }; // For S/s, T/t commands

            const tokens = this.d.match(/[a-df-z][^a-df-z]*/ig) || [];

            tokens.forEach(token => {
                cmd = token[0];
                const args = (token.slice(1).match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(parseFloat);
                
                if (cmd === 'm' || cmd === 'l' || cmd === 't') { // These can have implicit commands
                     if (args.length > 2) {
                        lastCmd = cmd;
                        let firstArgSet = args.splice(0, 2);
                        this._executeCommand(cmd, firstArgSet, currentPoint, controlPoint);
                        while (args.length > 0) {
                            let nextArgSet = args.splice(0, 2);
                            this._executeCommand(lastCmd, nextArgSet, currentPoint, controlPoint);
                        }
                        return;
                    }
                } else if (cmd === 'c' || cmd === 's' ) {
                    if (args.length > 6) { // 'c' has 6 args
                        lastCmd = cmd;
                        let firstArgSet = args.splice(0, 6);
                        this._executeCommand(cmd, firstArgSet, currentPoint, controlPoint);
                         while (args.length > 0) {
                            let nextArgSet = args.splice(0, cmd === 'c' ? 6 : 4);
                            this._executeCommand(lastCmd, nextArgSet, currentPoint, controlPoint);
                        }
                        return;
                    }
                } else if (cmd === 'q') {
                     if (args.length > 4) {
                         lastCmd = cmd;
                         let firstArgSet = args.splice(0, 4);
                         this._executeCommand(cmd, firstArgSet, currentPoint, controlPoint);
                          while (args.length > 0) {
                             let nextArgSet = args.splice(0, 4);
                             this._executeCommand(lastCmd, nextArgSet, currentPoint, controlPoint);
                         }
                         return;
                     }
                }

                this._executeCommand(cmd, args, currentPoint, controlPoint);
            });
        }
        
        _executeCommand(cmd, args, currentPoint, controlPoint) {
            const isRelative = cmd === cmd.toLowerCase();
            cmd = cmd.toLowerCase();

            let p0 = { ...currentPoint };
            let p1, p2, p3;

            switch (cmd) {
                case 'm': // moveto
                    if (isRelative) {
                        currentPoint.x += args[0];
                        currentPoint.y += args[1];
                    } else {
                        currentPoint.x = args[0];
                        currentPoint.y = args[1];
                    }
                    this.currentSubPath = { points: [ { ...currentPoint } ], closed: false };
                    this.subPaths.push(this.currentSubPath);
                    break;

                case 'l': // lineto
                case 'h': // horizontal lineto
                case 'v': // vertical lineto
                     if (cmd === 'h') args[1] = isRelative ? 0 : currentPoint.y;
                     if (cmd === 'v') args[1] = args[0]; args[0] = isRelative ? 0 : currentPoint.x;
                     if (cmd === 'h' && isRelative) args[0] += currentPoint.x;
                     if (cmd === 'v' && !isRelative) args[0] = currentPoint.x;

                    if (isRelative && cmd !== 'h' && cmd !== 'v') {
                        currentPoint.x += args[0];
                        currentPoint.y += args[1];
                    } else {
                        currentPoint.x = args[0];
                        currentPoint.y = args[1];
                    }
                    this.currentSubPath.points.push({ ...currentPoint });
                    break;
                    
                case 'z': // closepath
                    if (this.currentSubPath) {
                       this.currentSubPath.closed = true;
                       if (this.currentSubPath.points.length > 0) {
                            currentPoint.x = this.currentSubPath.points[0].x;
                            currentPoint.y = this.currentSubPath.points[0].y;
                       }
                    }
                    break;
                
                case 'c': // cubic bezier
                    p1 = { x: isRelative ? p0.x + args[0] : args[0], y: isRelative ? p0.y + args[1] : args[1] };
                    p2 = { x: isRelative ? p0.x + args[2] : args[2], y: isRelative ? p0.y + args[3] : args[3] };
                    p3 = { x: isRelative ? p0.x + args[4] : args[4], y: isRelative ? p0.y + args[5] : args[5] };
                    this.currentSubPath.points.push(...this._tessellateCubic(p0, p1, p2, p3));
                    currentPoint = p3;
                    controlPoint = p2;
                    break;

                case 's': // smooth cubic bezier
                    p1 = { x: 2 * p0.x - controlPoint.x, y: 2 * p0.y - controlPoint.y };
                    p2 = { x: isRelative ? p0.x + args[0] : args[0], y: isRelative ? p0.y + args[1] : args[1] };
                    p3 = { x: isRelative ? p0.x + args[2] : args[2], y: isRelative ? p0.y + args[3] : args[3] };
                    this.currentSubPath.points.push(...this._tessellateCubic(p0, p1, p2, p3));
                    currentPoint = p3;
                    controlPoint = p2;
                    break;
                    
                case 'q': // quadratic bezier
                    p1 = { x: isRelative ? p0.x + args[0] : args[0], y: isRelative ? p0.y + args[1] : args[1] };
                    p2 = { x: isRelative ? p0.x + args[2] : args[2], y: isRelative ? p0.y + args[3] : args[3] };
                    this.currentSubPath.points.push(...this._tessellateQuadratic(p0, p1, p2));
                    currentPoint = p2;
                    controlPoint = p1;
                    break;
                    
                case 't': // smooth quadratic bezier
                    p1 = { x: 2 * p0.x - controlPoint.x, y: 2 * p0.y - controlPoint.y };
                    p2 = { x: isRelative ? p0.x + args[0] : args[0], y: isRelative ? p0.y + args[1] : args[1] };
                    this.currentSubPath.points.push(...this._tessellateQuadratic(p0, p1, p2));
                    currentPoint = p2;
                    controlPoint = p1;
                    break;
                
                case 'a': // elliptical arc
                    let p2_arc = { x: isRelative ? p0.x + args[5] : args[5], y: isRelative ? p0.y + args[6] : args[6] };
                    this.currentSubPath.points.push(...this._tessellateArc(p0, args[0], args[1], args[2], args[3], args[4], p2_arc));
                    currentPoint = p2_arc;
                    break;
            }
         }

         _tessellateCubic(p0, p1, p2, p3) {
             const points = [];
             const segments = 32; // Fixed for simplicity
             for (let i = 1; i <= segments; i++) {
                 const t = i / segments;
                 const it = 1 - t;
                 const x = it*it*it*p0.x + 3*it*it*t*p1.x + 3*it*t*t*p2.x + t*t*t*p3.x;
                 const y = it*it*it*p0.y + 3*it*it*t*p1.y + 3*it*t*t*p2.y + t*t*t*p3.y;
                 points.push({x, y});
             }
             return points;
         }

         _tessellateQuadratic(p0, p1, p2) {
             const points = [];
             const segments = 24; // Fixed for simplicity
             for (let i = 1; i <= segments; i++) {
                 const t = i / segments;
                 const it = 1 - t;
                 const x = it*it*p0.x + 2*it*t*p1.x + t*t*p2.x;
                 const y = it*it*p0.y + 2*it*t*p1.y + t*t*p2.y;
                 points.push({x, y});
             }
             return points;
         }
         
        // https://www.w3.org/TR/SVG/implnote.html#ArcImplementationNotes
        _tessellateArc(p1, rx, ry, phi, fA, fS, p2) {
            const sin_phi = Math.sin(phi * Math.PI / 180);
            const cos_phi = Math.cos(phi * Math.PI / 180);

            const x1_ =  cos_phi * (p1.x - p2.x) / 2 + sin_phi * (p1.y - p2.y) / 2;
            const y1_ = -sin_phi * (p1.x - p2.x) / 2 + cos_phi * (p1.y - p2.y) / 2;

            rx = Math.abs(rx);
            ry = Math.abs(ry);
            
            const L = x1_ * x1_ / (rx * rx) + y1_ * y1_ / (ry * ry);
            if (L > 1) {
                rx *= Math.sqrt(L);
                ry *= Math.sqrt(L);
            }

            const M = (rx*rx*ry*ry - rx*rx*y1_*y1_ - ry*ry*x1_*x1_) / (rx*rx*y1_*y1_ + ry*ry*x1_*x1_);
            const coef = (fA === fS ? -1 : 1) * Math.sqrt(Math.max(0, M));
            const cx_ = coef * (rx * y1_ / ry);
            const cy_ = coef * (-ry * x1_ / rx);

            const cx = cos_phi * cx_ - sin_phi * cy_ + (p1.x + p2.x) / 2;
            const cy = sin_phi * cx_ + cos_phi * cy_ + (p1.y + p2.y) / 2;

            const angle = (u, v) => {
                const sign = (u[0] * v[1] - u[1] * v[0] < 0) ? -1 : 1;
                return sign * Math.acos((u[0]*v[0] + u[1]*v[1]) / (Math.sqrt(u[0]*u[0]+u[1]*u[1]) * Math.sqrt(v[0]*v[0]+v[1]*v[1])));
            };

            const theta1 = angle([1, 0], [(x1_ - cx_)/rx, (y1_ - cy_)/ry]);
            let delta_theta = angle([(x1_ - cx_)/rx, (y1_ - cy_)/ry], [(-x1_ - cx_)/rx, (-y1_ - cy_)/ry]);
            
            if (fS === 0 && delta_theta > 0) delta_theta -= 2 * Math.PI;
            if (fS === 1 && delta_theta < 0) delta_theta += 2 * Math.PI;

            const segments = Math.ceil(Math.abs(delta_theta) / (Math.PI/18));
            const points = [];
            for (let i = 1; i <= segments; i++) {
                const theta = theta1 + delta_theta * i / segments;
                const x = cx + rx * Math.cos(theta) * cos_phi - ry * Math.sin(theta) * sin_phi;
                const y = cy + rx * Math.cos(theta) * sin_phi + ry * Math.sin(theta) * cos_phi;
                points.push({ x, y });
            }
            return points;
        }

    }
    window.SVGParser = SVGParser;

})();