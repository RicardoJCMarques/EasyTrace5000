/**
 * @file        parser/parser-svg.js
 * @description SVG parsing module
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
    const segmentConfig = config.geometry?.segments || {};

    class SVGParser extends ParserCore {
        constructor(options = {}) {
            super(options);
            this.layers = {
                polarity: 'positive',
                units: 'mm',
                bounds: null,
                apertures: [],
                objects: []
            };
            // Temporary storage for post-processing
            this.collectedFills = [];
        }

        parse(content) {
            try {
                this.debug('Starting SVG parse');
                this.reset();

                const parser = new DOMParser();
                const doc = parser.parseFromString(content, 'image/svg+xml');
                const svgNode = doc.documentElement;

                if (svgNode.tagName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
                    throw new Error(doc.querySelector('parsererror')?.textContent || 'Invalid SVG file');
                }

                let height = 0;
                const viewBox = svgNode.getAttribute('viewBox');
                if (viewBox) {
                    height = parseFloat(viewBox.split(' ')[3]);
                } else {
                    height = parseFloat(svgNode.getAttribute('height'));
                }

                if (!isFinite(height)) {
                    this.warnings.push('SVG height or viewBox not found for Y-flip. Geometry may be inverted.');
                    height = 0;
                }
                
                // This matrix first scales Y by -1, then translates by the SVG height.
                const yFlipTransform = [1, 0, 0, -1, 0, height];
                this._traverseNode(svgNode, yFlipTransform);

                // Post-processing step to resolve all collected fill paths into solids and holes
                this._resolveAndCreateRegions();

                this.layers.bounds = this.calculateBounds(this.layers.objects);
                this.debug(`Parse complete: ${this.layers.objects.length} objects created`);
                this.logStatistics();

                return {
                    success: true,
                    layers: this.layers,
                    errors: this.errors,
                    warnings: this.warnings
                };

            } catch (error) {
                this.errors.push(`SVG Parse error: ${error.message}`);
                console.error("SVG Parse error:", error);
                return {
                    success: false,
                    layers: null,
                    errors: this.errors,
                    warnings: this.warnings
                };
            }
        }

        reset() {
            this.errors = [];
            this.warnings = [];
            this.bounds = null;
            this.stats = {
                linesProcessed: 0, objectsCreated: 0,
                coordinatesParsed: 0, invalidCoordinates: 0,
                commandsProcessed: 0
            };
            this.layers = {
                polarity: 'positive',
                units: 'mm',
                bounds: null,
                apertures: [],
                objects: []
            };
            this.collectedFills = [];
        }

        _traverseNode(node, parentTransform) {
            if (node.nodeType !== 1) return;

            const nodeTransformStr = node.getAttribute('transform');
            const nodeTransform = this._parseTransform(nodeTransformStr || '');
            const currentTransform = this._multiplyMatrix(parentTransform, nodeTransform);
            const styles = this._getStyles(node);

            if (styles.display === 'none' || styles.visibility === 'hidden') return;

            const tagName = node.tagName.toLowerCase();
            let geometry = null;

            switch (tagName) {
                case 'g':
                case 'svg':
                    Array.from(node.children).forEach(child => this._traverseNode(child, currentTransform));
                    break;
                case 'path':
                case 'rect':
                case 'circle':
                case 'ellipse':
                case 'polygon':
                case 'polyline':
                    geometry = this._parseShape(node);
                    break;
                case 'line':
                    geometry = this._parseLine(node);
                    break;
            }

            if (geometry) {
                const geometries = Array.isArray(geometry) ? geometry : [geometry];
                geometries.forEach(geom => {
                    if (styles.fill !== 'none') {
                        const transformedPoints = this._applyTransformToPoints(geom.points, currentTransform);
                        this.collectedFills.push(transformedPoints);
                    }
                    if (styles.stroke !== 'none' && styles.strokeWidth > 0) {
                        this._createStrokeObject(geom, currentTransform, styles);
                    }
                });
            }
        }

        _resolveAndCreateRegions() {
            if (this.collectedFills.length === 0) return;
            this.debug(`Resolving ${this.collectedFills.length} filled paths...`);

            const paths = this.collectedFills.map((points, index) => ({
                id: index,
                points: points,
                area: this._calculateSignedArea(points),
                parent: null,
                nestingLevel: 0,
            })).filter(p => Math.abs(p.area) > 1e-9);

            for (let i = 0; i < paths.length; i++) {
                let bestParent = null;
                for (let j = 0; j < paths.length; j++) {
                    if (i === j) continue;
                    if (Math.abs(paths[j].area) > Math.abs(paths[i].area) && this._isPointInPolygon(paths[i].points[0], paths[j].points)) {
                        if (!bestParent || Math.abs(paths[j].area) < Math.abs(bestParent.area)) {
                            bestParent = paths[j];
                        }
                    }
                }
                paths[i].parent = bestParent ? bestParent.id : null;
            }
            
            paths.forEach(path => {
                let level = 0;
                let current = path;
                while (current.parent !== null) {
                    level++;
                    current = paths[current.parent];
                }
                path.nestingLevel = level;
            });
            
            paths.forEach(path => {
                const isSolid = path.nestingLevel % 2 === 0;
                const isCCW = path.area > 0;
                if (isSolid && !isCCW) {
                    path.points.reverse();
                } else if (!isSolid && isCCW) {
                    path.points.reverse();
                }
            });

            const solids = paths.filter(p => p.nestingLevel % 2 === 0);
            const holes = paths.filter(p => p.nestingLevel % 2 !== 0);

            solids.forEach(solid => solid.holes = []);
            holes.forEach(hole => {
                if (hole.parent !== null) {
                    const parentSolid = paths.find(p => p.id === hole.parent);
                    if (parentSolid) {
                         parentSolid.holes.push(hole.points);
                    }
                }
            });

            solids.forEach(solid => {
                this.layers.objects.push({
                    type: 'region',
                    points: solid.points,
                    holes: solid.holes,
                    polarity: 'dark'
                });
                this.stats.objectsCreated++;
            });
        }
        
        _parseShape(node) {
            const tagName = node.tagName.toLowerCase();
            switch (tagName) {
                case 'rect':    return this._parseRect(node);
                case 'circle':  return this._parseCircle(node);
                case 'ellipse': return this._parseEllipse(node);
                case 'polygon':
                case 'polyline':return this._parsePoly(node);
                case 'path':    return this._parsePath(node);
            }
            return null;
        }

        _createStrokeObject(geometry, transform, styles) {
            const transformedPoints = this._applyTransformToPoints(geometry.points, transform);
            if (transformedPoints.length >= 2) {
                for (let i = 0; i < transformedPoints.length - 1; i++) {
                    const segmentLength = Math.hypot(transformedPoints[i+1].x - transformedPoints[i].x, transformedPoints[i+1].y - transformedPoints[i].y);
                    if (segmentLength < 1e-6) continue;
                    this.layers.objects.push({
                        type: 'trace',
                        start: transformedPoints[i],
                        end: transformedPoints[i + 1],
                        width: styles.strokeWidth,
                        polarity: 'dark'
                    });
                    this.stats.objectsCreated++;
                }
            }
        }
        
        _calculateSignedArea(points) {
            let area = 0;
            for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
                area += (points[j].x + points[i].x) * (points[j].y - points[i].y);
            }
            return area / 2;
        }

        _isPointInPolygon(point, polygon) {
            let inside = false;
            for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
                const xi = polygon[i].x, yi = polygon[i].y;
                const xj = polygon[j].x, yj = polygon[j].y;
                const intersect = ((yi > point.y) !== (yj > point.y))
                    && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
            return inside;
        }
        
        _parseRect(node) {
            const x = parseFloat(node.getAttribute('x') || 0);
            const y = parseFloat(node.getAttribute('y') || 0);
            const width = parseFloat(node.getAttribute('width') || 0);
            const height = parseFloat(node.getAttribute('height') || 0);
            if (width === 0 || height === 0) return null;
            const points = [ { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }, { x, y } ];
            return { type: 'path', points };
        }

        _parseCircle(node) {
            const cx = parseFloat(node.getAttribute('cx') || 0);
            const cy = parseFloat(node.getAttribute('cy') || 0);
            const r = parseFloat(node.getAttribute('r') || 0);
            if (r === 0) return null;
            const segments = segmentConfig.maxCircle || 64;
            const points = [];
            for (let i = 0; i <= segments; i++) {
                const angle = (i / segments) * 2 * Math.PI;
                points.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
            }
            return { type: 'path', points: points };
        }

        _parseEllipse(node) {
            const cx = parseFloat(node.getAttribute('cx') || 0);
            const cy = parseFloat(node.getAttribute('cy') || 0);
            const rx = parseFloat(node.getAttribute('rx') || 0);
            const ry = parseFloat(node.getAttribute('ry') || 0);
            if (rx === 0 || ry === 0) return null;
            const segments = segmentConfig.maxCircle || 64;
            const points = [];
            for (let i = 0; i <= segments; i++) {
                const angle = (i / segments) * 2 * Math.PI;
                points.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
            }
            return { type: 'path', points };
        }

        _parseLine(node) {
            const x1 = parseFloat(node.getAttribute('x1') || 0);
            const y1 = parseFloat(node.getAttribute('y1') || 0);
            const x2 = parseFloat(node.getAttribute('x2') || 0);
            const y2 = parseFloat(node.getAttribute('y2') || 0);
            return { type: 'path', points: [{ x: x1, y: y1 }, { x: x2, y: y2 }] };
        }

        _parsePoly(node) {
            const pointsStr = (node.getAttribute('points') || '').trim();
            if (!pointsStr) return null;
            const pairs = pointsStr.split(/\s*,\s*|\s+/);
            const points = [];
            for (let i = 0; i < pairs.length; i += 2) {
                points.push({ x: parseFloat(pairs[i]), y: parseFloat(pairs[i + 1]) });
            }
            if (node.tagName.toLowerCase() === 'polygon' && points.length > 0) {
                points.push({ ...points[0] });
            }
            return { type: 'path', points };
        }
        
        _parsePath(node) {
            const d = node.getAttribute('d');
            if (!d) return null;
            const pathParser = new PathDataParser(d, { debug: this.options.debug });
            const subPaths = pathParser.getSubPaths();
            return subPaths.map(subPath => ({ type: 'path', points: subPath.points }));
        }

        _getStyles(node) {
            const style = { fill: 'black', stroke: 'none', strokeWidth: 1.0, display: 'inline', visibility: 'visible' };
            const computedStyle = window.getComputedStyle(node);
            style.fill = computedStyle.getPropertyValue('fill') || style.fill;
            style.stroke = computedStyle.getPropertyValue('stroke') || style.stroke;
            style.strokeWidth = parseFloat(computedStyle.getPropertyValue('stroke-width')) || style.strokeWidth;
            style.display = computedStyle.getPropertyValue('display') || style.display;
            style.visibility = computedStyle.getPropertyValue('visibility') || style.visibility;
            return style;
        }

        _applyTransformToPoint(p, m) { return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }; }
        _applyTransformToPoints(points, m) { return points.map(p => this._applyTransformToPoint(p, m)); }
        _identityMatrix() { return [1, 0, 0, 1, 0, 0]; }
        _multiplyMatrix(m1, m2) { return [ m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1], m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3], m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5] ]; }

        _parseTransform(transformString) {
            let matrix = this._identityMatrix();
            if (!transformString) return matrix;
            const regex = /(\w+)\s*\(([^)]+)\)/g;
            let match;
            while ((match = regex.exec(transformString)) !== null) {
                const type = match[1].toLowerCase();
                const values = match[2].trim().split(/[\s,]+/).map(parseFloat);
                let transform = this._identityMatrix();
                if (type === 'matrix' && values.length === 6) { transform = [values[0], values[1], values[2], values[3], values[4], values[5]]; }
                else if (type === 'translate' && values.length >= 1) { transform[4] = values[0]; transform[5] = values[1] || 0; }
                else if (type === 'scale' && values.length >= 1) { transform[0] = values[0]; transform[3] = values[1] === undefined ? values[0] : values[1]; }
                else if (type === 'rotate' && values.length >= 1) {
                    const angle = values[0] * Math.PI / 180;
                    const cos = Math.cos(angle); const sin = Math.sin(angle);
                    if (values.length === 3) {
                        const [cx, cy] = [values[1], values[2]];
                        transform = this._multiplyMatrix([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]);
                        transform = this._multiplyMatrix(transform, [1, 0, 0, 1, -cx, -cy]);
                    } else { transform = [cos, sin, -sin, cos, 0, 0]; }
                }
                matrix = this._multiplyMatrix(matrix, transform);
            }
            return matrix;
        }
    }

    class PathDataParser {
        constructor(d, options = {}) { this.d = d; this.options = options; this.subPaths = []; this.currentSubPath = null; }
        getSubPaths() { this._parse(); return this.subPaths; }
        _parse() {
            let lastCmd; let currentPoint = { x: 0, y: 0 }; let controlPoint = { x: 0, y: 0 }; let startPoint = { x: 0, y: 0 };
            const tokens = this.d.match(/[a-df-z][^a-df-z]*/ig) || [];
            tokens.forEach(token => {
                let cmd = token[0]; const args = (token.slice(1).match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(parseFloat);
                if (cmd.toLowerCase() !== 'm' && !this.currentSubPath) { this.currentSubPath = { points: [{ ...currentPoint }], closed: false }; this.subPaths.push(this.currentSubPath); startPoint = { ...currentPoint }; }
                let commandSets = []; const argsPerSet = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7 }; const cmdLower = cmd.toLowerCase();
                if (args.length > argsPerSet[cmdLower]) {
                    commandSets.push(args.splice(0, argsPerSet[cmdLower]));
                    lastCmd = (cmdLower === 'm') ? 'l' : (cmdLower === 'M' ? 'L' : cmd);
                    while (args.length > 0) { commandSets.push(args.splice(0, argsPerSet[lastCmd.toLowerCase()])); }
                } else { commandSets.push(args); }
                let firstCommand = true;
                commandSets.forEach(argSet => { const effectiveCmd = firstCommand ? cmd : lastCmd;[currentPoint, controlPoint] = this._executeCommand(effectiveCmd, argSet, currentPoint, controlPoint, startPoint); firstCommand = false; });
                lastCmd = cmd;
            });
        }
        _executeCommand(cmd, args, currentPoint, controlPoint, startPoint) {
            const isRelative = cmd === cmd.toLowerCase(); const cmdLower = cmd.toLowerCase(); let p0 = { ...currentPoint };
            switch (cmdLower) {
                case 'm': currentPoint.x = isRelative ? p0.x + args[0] : args[0]; currentPoint.y = isRelative ? p0.y + args[1] : args[1]; this.currentSubPath = { points: [{ ...currentPoint }], closed: false }; this.subPaths.push(this.currentSubPath); startPoint.x = currentPoint.x; startPoint.y = currentPoint.y; break;
                case 'l': currentPoint.x = isRelative ? p0.x + args[0] : args[0]; currentPoint.y = isRelative ? p0.y + args[1] : args[1]; this.currentSubPath.points.push({ ...currentPoint }); break;
                case 'h': currentPoint.x = isRelative ? p0.x + args[0] : args[0]; this.currentSubPath.points.push({ ...currentPoint }); break;
                case 'v': currentPoint.y = isRelative ? p0.y + args[0] : args[0]; this.currentSubPath.points.push({ ...currentPoint }); break;
                case 'z': if (this.currentSubPath) { this.currentSubPath.closed = true; this.currentSubPath.points.push({ ...startPoint }); currentPoint = { ...startPoint }; } break;
                case 'c': { const p1 = { x: isRelative ? p0.x + args[0] : args[0], y: isRelative ? p0.y + args[1] : args[1] }; const p2 = { x: isRelative ? p0.x + args[2] : args[2], y: isRelative ? p0.y + args[3] : args[3] }; const p3 = { x: isRelative ? p0.x + args[4] : args[4], y: isRelative ? p0.y + args[5] : args[5] }; this.currentSubPath.points.push(...this._tessellateCubic(p0, p1, p2, p3)); currentPoint = p3; controlPoint = p2; break; }
                case 's': { const p1 = { x: 2 * p0.x - controlPoint.x, y: 2 * p0.y - controlPoint.y }; const p2 = { x: isRelative ? p0.x + args[0] : args[0], y: isRelative ? p0.y + args[1] : args[1] }; const p3 = { x: isRelative ? p0.x + args[2] : args[2], y: isRelative ? p0.y + args[3] : args[3] }; this.currentSubPath.points.push(...this._tessellateCubic(p0, p1, p2, p3)); currentPoint = p3; controlPoint = p2; break; }
                case 'q': { const p1 = { x: isRelative ? p0.x + args[0] : args[0], y: isRelative ? p0.y + args[1] : args[1] }; const p2 = { x: isRelative ? p0.x + args[2] : args[2], y: isRelative ? p0.y + args[3] : args[3] }; this.currentSubPath.points.push(...this._tessellateQuadratic(p0, p1, p2)); currentPoint = p2; controlPoint = p1; break; }
                case 't': { const p1 = { x: 2 * p0.x - controlPoint.x, y: 2 * p0.y - controlPoint.y }; const p2 = { x: isRelative ? p0.x + args[0] : args[0], y: isRelative ? p0.y + args[1] : args[1] }; this.currentSubPath.points.push(...this._tessellateQuadratic(p0, p1, p2)); currentPoint = p2; controlPoint = p1; break; }
                case 'a': { const p2_arc = { x: isRelative ? p0.x + args[5] : args[5], y: isRelative ? p0.y + args[6] : args[6] }; this.currentSubPath.points.push(...this._tessellateArc(p0, args[0], args[1], args[2], args[3], args[4], p2_arc)); currentPoint = p2_arc; break; }
            }
            if (['s', 'c', 't', 'q'].indexOf(cmdLower) === -1) { controlPoint = { ...currentPoint }; }
            return [currentPoint, controlPoint];
        }
        _tessellateCubic(p0, p1, p2, p3) { const points = []; const segments = 32; for (let i = 1; i <= segments; i++) { const t = i / segments, it = 1 - t; points.push({ x: it * it * it * p0.x + 3 * it * it * t * p1.x + 3 * it * t * t * p2.x + t * t * t * p3.x, y: it * it * it * p0.y + 3 * it * it * t * p1.y + 3 * it * t * t * p2.y + t * t * t * p3.y }); } return points; }
        _tessellateQuadratic(p0, p1, p2) { const points = []; const segments = 24; for (let i = 1; i <= segments; i++) { const t = i / segments, it = 1 - t; points.push({ x: it * it * p0.x + 2 * it * t * p1.x + t * t * p2.x, y: it * it * p0.y + 2 * it * t * p1.y + t * t * p2.y }); } return points; }
        _tessellateArc(p1, rx, ry, phi, fA, fS, p2) {
            const sin_phi = Math.sin(phi * Math.PI / 180), cos_phi = Math.cos(phi * Math.PI / 180);
            const x1_ = cos_phi * (p1.x - p2.x) / 2 + sin_phi * (p1.y - p2.y) / 2; const y1_ = -sin_phi * (p1.x - p2.x) / 2 + cos_phi * (p1.y - p2.y) / 2;
            rx = Math.abs(rx); ry = Math.abs(ry);
            const L = x1_ * x1_ / (rx * rx) + y1_ * y1_ / (ry * ry);
            if (L > 1) { rx *= Math.sqrt(L); ry *= Math.sqrt(L); }
            const M = (rx * rx * ry * ry - rx * rx * y1_ * y1_ - ry * ry * x1_ * x1_) / (rx * rx * y1_ * y1_ + ry * ry * x1_ * x1_);
            const coef = (fA === fS ? -1 : 1) * Math.sqrt(Math.max(0, M));
            const cx_ = coef * (rx * y1_ / ry), cy_ = coef * (-ry * x1_ / rx);
            const cx = cos_phi * cx_ - sin_phi * cy_ + (p1.x + p2.x) / 2; const cy = sin_phi * cx_ + cos_phi * cy_ + (p1.y + p2.y) / 2;
            const angle = (u, v) => { const sign = (u[0] * v[1] - u[1] * v[0] < 0) ? -1 : 1; return sign * Math.acos((u[0] * v[0] + u[1] * v[1]) / (Math.sqrt(u[0] * u[0] + u[1] * u[1]) * Math.sqrt(v[0] * v[0] + v[1] * v[1]))); };
            const theta1 = angle([1, 0], [(x1_ - cx_) / rx, (y1_ - cy_) / ry]);
            let delta_theta = angle([(x1_ - cx_) / rx, (y1_ - cy_) / ry], [(-x1_ - cx_) / rx, (-y1_ - cy_) / ry]);
            if (fS === 0 && delta_theta > 0) delta_theta -= 2 * Math.PI; if (fS === 1 && delta_theta < 0) delta_theta += 2 * Math.PI;
            const segments = Math.ceil(Math.abs(delta_theta) / (Math.PI / 18));
            const points = [];
            for (let i = 1; i <= segments; i++) {
                const theta = theta1 + delta_theta * i / segments;
                points.push({ x: cx + rx * Math.cos(theta) * cos_phi - ry * Math.sin(theta) * sin_phi, y: cy + rx * Math.cos(theta) * sin_phi + ry * Math.sin(theta) * cos_phi });
            }
            return points;
        }
    }

    window.SVGParser = SVGParser;

})();