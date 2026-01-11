/**
 * @file        parser/parser-svg.js
 * @description SVG parsing module
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
    const geomConfig = config.geometry;

    class SVGParser extends ParserCore {
        constructor(options = {}) {
            super(options);
            this.reset();
        }

        parse(content) {
            try {
                this.debug('Starting SVG parse (Analytic-based)');
                this.reset();

                const parser = new DOMParser();
                const doc = parser.parseFromString(content, 'image/svg+xml');
                const svgNode = doc.documentElement;

                if (svgNode.tagName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
                    throw new Error(doc.querySelector('parsererror')?.textContent || 'Invalid SVG file');
                }

                // Parse document dimensions and set up unit converter
                this._parseDocumentDimensions(svgNode);

                // Check for unsupported features
                this._checkUnsupportedFeatures(svgNode);

                // Build root transform: scale to mm + Y-flip
                const s = this.unitScale;
                const h = this.documentHeight;
                // Matrix: scale by unitScale, flip Y, translate so Y=0 is at bottom
                const rootTransform = [s, 0, 0, -s, 0, h];
                this._traverseNode(svgNode, rootTransform);

                this.layers.bounds = this.calculateBounds(this.layers.objects);
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
                return { success: false, layers: null, errors: this.errors, warnings: this.warnings };
            }
        }

        reset() {
            this.errors = [];
            this.warnings = [];
            this.layers = { polarity: 'positive', units: 'mm', bounds: null, apertures: [], objects: [] };
            this.stats = { objectsCreated: 0 };
            this.documentWidth = 0;
            this.documentHeight = 0;
            this.viewBox = null;
            this.unitScale = 1; // Scale factor to convert to mm
        }

        /**
         * Parse SVG document dimensions and set up unit conversion
         */
        _parseDocumentDimensions(svgNode) {
            const widthAttr = svgNode.getAttribute('width');
            const heightAttr = svgNode.getAttribute('height');
            const viewBoxAttr = svgNode.getAttribute('viewBox');

            // Parse viewBox
            if (viewBoxAttr) {
                const parts = viewBoxAttr.split(/[\s,]+/).map(parseFloat);
                if (parts.length === 4) {
                    this.viewBox = {
                        x: parts[0],
                        y: parts[1],
                        width: parts[2],
                        height: parts[3]
                    };
                }
            }

            // Parse width/height with units
            const parseWithUnit = (attrValue) => {
                if (!attrValue) return null;
                const match = attrValue.match(/^(-?[\d.]+(?:e[+-]?\d+)?)\s*([a-z%]*)$/i);
                if (!match) return { value: parseFloat(attrValue), unit: 'px' };
                return { value: parseFloat(match[1]), unit: match[2] || 'px' };
            };

            const widthParsed = parseWithUnit(widthAttr);
            const heightParsed = parseWithUnit(heightAttr);

            // Convert to mm using unit converter if available
            const toMM = (parsed) => {
                if (!parsed) return 0;
                if (window.unitConverter) {
                    return window.unitConverter.toMM(parsed.value, parsed.unit);
                }
                // Fallback conversions
                const factors = { mm: 1, cm: 10, in: 25.4, pt: 25.4/72, px: 25.4/96 };
                return parsed.value * (factors[parsed.unit] || 1);
            };

            if (widthParsed) this.documentWidth = toMM(widthParsed);
            if (heightParsed) this.documentHeight = toMM(heightParsed);

            // Calculate scale from viewBox to mm
            if (this.viewBox && this.viewBox.width > 0) {
                this.unitScale = this.documentWidth / this.viewBox.width;
                
                // Check for non-uniform scaling
                if (this.viewBox.height > 0) {
                    const yScale = this.documentHeight / this.viewBox.height;
                    if (Math.abs(this.unitScale - yScale) > 0.001) {
                        this.warnings.push('SVG has non-uniform viewBox scaling. Geometry may be distorted.');
                    }
                }
            } else if (this.documentWidth > 0) {
                // No viewBox, use document dimensions directly (already in mm)
                this.unitScale = 1;
            }

            // Set up unit converter viewBox mapping if available
            if (window.unitConverter && this.viewBox && widthParsed) {
                window.unitConverter.setViewBoxMapping(this.viewBox, {
                    width: widthParsed.value,
                    height: heightParsed?.value || widthParsed.value,
                    widthUnit: widthParsed.unit,
                    heightUnit: heightParsed?.unit || widthParsed.unit
                });
            }

            // Fallback: if we have viewBox but no explicit dimensions, assume 1:1 mm
            if (this.viewBox && !this.documentHeight) {
                this.documentHeight = this.viewBox.height;
                this.documentWidth = this.viewBox.width;
                this.unitScale = 1;
                this.warnings.push('SVG has no explicit dimensions. Assuming viewBox units are mm.');
            }

            // Final fallback if still no scale
            if (!this.unitScale || this.unitScale <= 0) {
                this.unitScale = 1;
            }

            this.debug(`Document: ${this.documentWidth.toFixed(2)} x ${this.documentHeight.toFixed(2)} mm, scale: ${this.unitScale.toFixed(4)}`);
        }

        /**
         * Check for unsupported SVG features and warn user
         */
        _checkUnsupportedFeatures(svgNode) {
            // Check for text elements
            const textElements = svgNode.querySelectorAll('text, tspan, textPath');
            if (textElements.length > 0) {
                this.warnings.push(`Found ${textElements.length} text element(s). Convert text to paths in your editor for proper rendering.`);
            }

            // Check for fill-rule usage
            const fillRuleElements = svgNode.querySelectorAll('[fill-rule]');
            const styleWithFillRule = svgNode.querySelectorAll('[style*="fill-rule"]');
            const fillRuleCount = fillRuleElements.length + styleWithFillRule.length;
            
            if (fillRuleCount > 0) {
                this.warnings.push(`Found fill-rule attribute on ${fillRuleCount} element(s). Overlapping geometries may render differently than expected.`);
            }

            // Check for CSS stylesheets
            const styleElements = svgNode.querySelectorAll('style');
            if (styleElements.length > 0) {
                this.warnings.push('SVG contains embedded stylesheets. Class-based styles are not fully supported.');
            }

            // Check for use/symbol (cloning)
            const useElements = svgNode.querySelectorAll('use');
            if (useElements.length > 0) {
                this.warnings.push(`Found ${useElements.length} <use> element(s). Symbol cloning is not yet supported.`);
            }

            // Check for clipPath/mask
            const clipMask = svgNode.querySelectorAll('clipPath, mask');
            if (clipMask.length > 0) {
                this.warnings.push('SVG contains clip paths or masks which are not supported.');
            }
        }

        _traverseNode(node, parentTransform) {
            if (node.nodeType !== 1) return;

            const styles = this._getStyles(node);
            if (styles.display === 'none' || styles.visibility === 'hidden') return;

            const nodeTransform = this._parseTransform(node.getAttribute('transform') || '');
            const currentTransform = this._multiplyMatrix(parentTransform, nodeTransform);
            const tagName = node.tagName.toLowerCase();

            switch (tagName) {
                case 'g': case 'svg': case 'defs': case 'symbol':
                    // Skip processing children of defs/symbol (they're referenced, not rendered directly)
                    if (tagName !== 'defs' && tagName !== 'symbol') {
                        Array.from(node.children).forEach(child => this._traverseNode(child, currentTransform));
                    }
                    break;
                case 'text': case 'tspan': case 'textPath':
                    // Already warned, skip silently
                    break;
                case 'path': case 'rect': case 'circle': case 'ellipse': case 'polygon': case 'polyline': case 'line':
                    const geometry = this._parseShape(node);
                    if (!geometry) break;

                    if (styles.fill && styles.fill !== 'none' && styles.fillOpacity > 0) {
                        this._processFilledShape(geometry, currentTransform);
                    }

                    if (styles.stroke && styles.stroke !== 'none' && styles.strokeWidth > 0 && styles.strokeOpacity > 0) {
                        this._processStrokedShape(geometry, currentTransform, styles.strokeWidth);
                    }
                    break;
            }
        }

        _processFilledShape(geometry, transform) {
            const transformed = this._applyTransformToGeometry(geometry, transform);

            if (transformed.type === 'circle' || transformed.type === 'rectangle' || 
                transformed.type === 'obround' || transformed.type === 'ellipse') {
                this._createFlash(transformed);
            } else if (transformed.type === 'path') {
                const subpaths = Array.isArray(transformed.subpaths) ? transformed.subpaths : [transformed.points];
                this._createPolarityRegions(subpaths);
            }
        }

        /**
         * Process stroked shapes - passes analytic shapes with stroke properties
         * Downstream systems (plotter, offsetter) handle stroke expansion when needed
         */
        _processStrokedShape(geometry, transform, strokeWidth) {
            const transformed = this._applyTransformToGeometry(geometry, transform);

            // Analytic shapes: create flash with stroke properties
            // Plotter creates the primitive, geometry systems handle expansion
            if (transformed.type === 'rectangle' || transformed.type === 'circle' || 
                transformed.type === 'ellipse' || transformed.type === 'obround') {
                const flash = this._createFlashObject(transformed);
                flash.stroke = true;
                flash.strokeWidth = strokeWidth;
                flash.fill = false;
                this.layers.objects.push(flash);
                this.stats.objectsCreated++;
                return;
            }

            // Path-based geometry - pass through with stroke properties
            const subpaths = transformed.subpaths || [];
            const points = transformed.points;

            // Simple point arrays (polygon/polyline) - open paths become traces
            if (subpaths.length === 0 && points?.length > 0) {
                this.layers.objects.push({
                    type: 'trace',
                    interpolation: 'linear_path',
                    points,
                    width: strokeWidth,
                    polarity: 'dark'
                });
                this.stats.objectsCreated++;
                return;
            }

            // Complex paths - region with stroke properties
            if (subpaths.length > 0) {
                this.layers.objects.push({
                    type: 'region',
                    analyticSubpaths: subpaths,
                    polarity: 'dark',
                    stroke: true,
                    strokeWidth: strokeWidth,
                    fill: false
                });
                this.stats.objectsCreated++;
            }
        }

        /**
         * Create flash object from geometry (shared between fill and stroke paths)
         */
        _createFlashObject(geom) {
            const flash = { type: 'flash', polarity: 'dark', parameters: [] };
            switch(geom.type) {
                case 'circle':
                    flash.shape = 'circle';
                    flash.position = geom.center;
                    flash.radius = geom.radius;
                    flash.parameters.push(geom.radius * 2);
                    break;
                case 'rectangle':
                    flash.shape = 'rectangle';
                    flash.position = { x: geom.x + geom.width / 2, y: geom.y + geom.height / 2 };
                    flash.width = geom.width;
                    flash.height = geom.height;
                    flash.parameters.push(geom.width, geom.height);
                    break;
                case 'ellipse':
                    flash.shape = 'ellipse';
                    flash.position = geom.center;
                    flash.rx = geom.rx;
                    flash.ry = geom.ry;
                    flash.parameters.push(geom.rx, geom.ry);
                    break;
                case 'obround':
                    flash.shape = 'obround';
                    flash.position = { x: geom.x + geom.width / 2, y: geom.y + geom.height / 2 };
                    flash.width = geom.width;
                    flash.height = geom.height;
                    flash.parameters.push(geom.width, geom.height);
                    break;
            }
            return flash;
        }
        
        _createFlash(geom) {
            const flash = this._createFlashObject(geom);
            flash.fill = true;
            flash.stroke = false;
            this.layers.objects.push(flash);
            this.stats.objectsCreated++;
        }

        _createPolarityRegions(subpaths) {
            const validSubpaths = subpaths.filter(segments => segments && segments.length > 0);

            this.debug(`Received ${subpaths.length} subpaths. Found ${validSubpaths.length} valid subpaths to plot.`);

            if (validSubpaths.length === 0) return;

            this.layers.objects.push({
                type: 'region',
                polarity: 'dark',
                analyticSubpaths: validSubpaths
            });

            this.stats.objectsCreated++;
        }

        _parseShape(node) {
            const tagName = node.tagName.toLowerCase();
            switch (tagName) {
                case 'rect': return this._parseRect(node);
                case 'circle': return this._parseCircle(node);
                case 'ellipse': return this._parseEllipse(node);
                case 'polygon': return { type: 'path', points: this._parsePoly(node), subpaths: [] };
                case 'polyline': return { type: 'path', points: this._parsePoly(node), subpaths: [] };
                case 'path':
                    const subpathsOfSegments = new PathDataParser(node.getAttribute('d')).getSubPaths();
                    return { type: 'path', subpaths: subpathsOfSegments };
                case 'line':
                    const p = this._parseLine(node);
                    return p ? { type: 'path', points: p, subpaths: [] } : null;
            }
            return null;
        }

        /**
         * Parse rectangle with optional corner radius (rx/ry)
         */
        _parseRect(node) {
            const x = parseFloat(node.getAttribute('x') || 0);
            const y = parseFloat(node.getAttribute('y') || 0);
            const width = parseFloat(node.getAttribute('width') || 0);
            const height = parseFloat(node.getAttribute('height') || 0);

            if (width <= 0 || height <= 0) return null;

            // Check for rounded corners
            let rx = parseFloat(node.getAttribute('rx') || 0);
            let ry = parseFloat(node.getAttribute('ry') || 0);

            // SVG spec: if only one is specified, use it for both
            if (rx > 0 && ry === 0) ry = rx;
            if (ry > 0 && rx === 0) rx = ry;

            // Clamp to half of dimensions
            rx = Math.min(rx, width / 2);
            ry = Math.min(ry, height / 2);

            // No rounding
            if (rx <= 0 && ry <= 0) {
                return { type: 'rectangle', x, y, width, height };
            }

            // Check if it's an obround (corner radius equals half the smaller dimension)
            const tolerance = geomConfig.coordinatePrecision || 0.001;
            const minDim = Math.min(width, height);
            const isObround = Math.abs(rx - minDim / 2) < tolerance && Math.abs(ry - minDim / 2) < tolerance;

            if (isObround) {
                return { type: 'obround', x, y, width, height };
            }

            // General rounded rectangle - convert to path with arcs
            return this._roundedRectToPath(x, y, width, height, rx, ry);
        }

        /**
         * Convert rounded rectangle to path geometry with analytic arcs
         */
        _roundedRectToPath(x, y, width, height, rx, ry) {
            const segments = [];

            // Start at top-left, after the corner arc
            const startPoint = { x: x + rx, y: y };
            segments.push({ type: 'move', p: startPoint });

            // Top edge
            segments.push({ 
                type: 'line', 
                p0: { x: x + rx, y: y }, 
                p1: { x: x + width - rx, y: y } 
            });

            // Top-right corner arc
            if (rx > 0 && ry > 0) {
                const cornerCenter = { x: x + width - rx, y: y + ry };
                segments.push({
                    type: 'arc',
                    p0: { x: x + width - rx, y: y },
                    p1: { x: x + width, y: y + ry },
                    center: cornerCenter,
                    rx: rx, ry: ry, phi: 0, fA: 0, fS: 1,
                    clockwise: true,
                    startAngle: -Math.PI / 2,
                    endAngle: 0
                });
            }

            // Right edge
            segments.push({ 
                type: 'line', 
                p0: { x: x + width, y: y + ry }, 
                p1: { x: x + width, y: y + height - ry } 
            });

            // Bottom-right corner arc
            if (rx > 0 && ry > 0) {
                const cornerCenter = { x: x + width - rx, y: y + height - ry };
                segments.push({
                    type: 'arc',
                    p0: { x: x + width, y: y + height - ry },
                    p1: { x: x + width - rx, y: y + height },
                    center: cornerCenter,
                    rx: rx, ry: ry, phi: 0, fA: 0, fS: 1,
                    clockwise: true,
                    startAngle: 0,
                    endAngle: Math.PI / 2
                });
            }

            // Bottom edge
            segments.push({ 
                type: 'line', 
                p0: { x: x + width - rx, y: y + height }, 
                p1: { x: x + rx, y: y + height } 
            });

            // Bottom-left corner arc
            if (rx > 0 && ry > 0) {
                const cornerCenter = { x: x + rx, y: y + height - ry };
                segments.push({
                    type: 'arc',
                    p0: { x: x + rx, y: y + height },
                    p1: { x: x, y: y + height - ry },
                    center: cornerCenter,
                    rx: rx, ry: ry, phi: 0, fA: 0, fS: 1,
                    clockwise: true,
                    startAngle: Math.PI / 2,
                    endAngle: Math.PI
                });
            }

            // Left edge
            segments.push({ 
                type: 'line', 
                p0: { x: x, y: y + height - ry }, 
                p1: { x: x, y: y + ry } 
            });

            // Top-left corner arc
            if (rx > 0 && ry > 0) {
                const cornerCenter = { x: x + rx, y: y + ry };
                segments.push({
                    type: 'arc',
                    p0: { x: x, y: y + ry },
                    p1: { x: x + rx, y: y },
                    center: cornerCenter,
                    rx: rx, ry: ry, phi: 0, fA: 0, fS: 1,
                    clockwise: true,
                    startAngle: Math.PI,
                    endAngle: -Math.PI / 2
                });
            }

            return { type: 'path', subpaths: [segments] };
        }

        _parseCircle(node) {
            const r = parseFloat(node.getAttribute('r') || 0);
            return r > 0 ? {
                type: 'circle',
                center: {
                    x: parseFloat(node.getAttribute('cx') || 0),
                    y: parseFloat(node.getAttribute('cy') || 0)
                },
                radius: r
            } : null;
        }

        _parseEllipse(node) {
            const rx = parseFloat(node.getAttribute('rx') || 0);
            const ry = parseFloat(node.getAttribute('ry') || 0);
            return (rx > 0 && ry > 0) ? {
                type: 'ellipse', 
                center: {
                    x: parseFloat(node.getAttribute('cx') || 0),
                    y: parseFloat(node.getAttribute('cy') || 0)
                },
                rx, ry
            } : null;
        }

        _parseLine(node) {
            return [{
                x: parseFloat(node.getAttribute('x1') || 0),
                y: parseFloat(node.getAttribute('y1') || 0)
            }, {
                x: parseFloat(node.getAttribute('x2') || 0),
                y: parseFloat(node.getAttribute('y2') || 0)
            }];
        }

        _parsePoly(node) {
            const pointsStr = (node.getAttribute('points') || '').trim();
            if (!pointsStr) return [];
            const pairs = pointsStr.split(/\s*,\s*|\s+/);
            const points = [];
            for (let i = 0; i < pairs.length; i += 2) {
                points.push({
                    x: parseFloat(pairs[i]),
                    y: parseFloat(pairs[i + 1])
                });
            }
            return points;
        }

        _applyTransformToGeometry(geom, m) {
            const determinant = m[0] * m[3] - m[1] * m[2];
            const isReflection = determinant < 0;
            const scale = Math.sqrt(Math.abs(determinant));

            // Check for uniform scaling (no rotation/skew)
            const isAxisAligned = Math.abs(m[1]) < 1e-10 && Math.abs(m[2]) < 1e-10;

            if (geom.type === 'circle') {
                return {
                    type: 'circle',
                    center: this._applyTransformToPoint(geom.center, m),
                    radius: geom.radius * scale
                };
            }

            if (geom.type === 'ellipse') {
                if (isAxisAligned) {
                    return {
                        type: 'ellipse',
                        center: this._applyTransformToPoint(geom.center, m),
                        rx: geom.rx * Math.abs(m[0]),
                        ry: geom.ry * Math.abs(m[3])
                    };
                }
                // Non-axis-aligned ellipse - convert to path
                return this._ellipseToPath(geom, m);
            }

            if (geom.type === 'rectangle' && isAxisAligned) {
                const p1 = this._applyTransformToPoint({ x: geom.x, y: geom.y }, m);
                const p2 = this._applyTransformToPoint({ x: geom.x + geom.width, y: geom.y + geom.height }, m);
                return {
                    type: 'rectangle',
                    x: Math.min(p1.x, p2.x),
                    y: Math.min(p1.y, p2.y),
                    width: Math.abs(p1.x - p2.x),
                    height: Math.abs(p1.y - p2.y)
                };
            }

            if (geom.type === 'obround' && isAxisAligned) {
                const p1 = this._applyTransformToPoint({ x: geom.x, y: geom.y }, m);
                const p2 = this._applyTransformToPoint({ x: geom.x + geom.width, y: geom.y + geom.height }, m);
                return {
                    type: 'obround',
                    x: Math.min(p1.x, p2.x),
                    y: Math.min(p1.y, p2.y),
                    width: Math.abs(p1.x - p2.x),
                    height: Math.abs(p1.y - p2.y)
                };
            }

            // Non-axis-aligned rectangle/obround - convert to path
            if (geom.type === 'rectangle' || geom.type === 'obround') {
                return this._shapeToPath(geom, m);
            }

            if (geom.type === 'path') {
                return this._transformPath(geom, m, isReflection);
            }

            // Fallback for geometry with points
            if (geom.points && geom.points.length > 0) {
                return {
                    type: 'path',
                    points: this._applyTransformToPoints(geom.points, m),
                    subpaths: []
                };
            }

            return geom;
        }

        /**
         * Transform path geometry, handling arc direction for reflections
         */
        _transformPath(geom, m, isReflection) {
            const transformedSubpaths = geom.subpaths.map(segments => {
                // Point arrays (polygon/polyline)
                if (segments.length > 0 && segments[0].x !== undefined) {
                    return this._applyTransformToPoints(segments, m);
                }

                return segments.map(seg => {
                    if (seg.type === 'move') {
                        return { ...seg, p: this._applyTransformToPoint(seg.p, m) };
                    }
                    if (seg.type === 'line') {
                        return { 
                            ...seg,
                            p0: this._applyTransformToPoint(seg.p0, m), 
                            p1: this._applyTransformToPoint(seg.p1, m) 
                        };
                    }
                    if (seg.type === 'arc') {
                        // Transform arc analytically
                        return this._transformArc(seg, m, isReflection);
                    }
                    if (seg.type === 'cubic') {
                        return {
                            ...seg,
                            p0: this._applyTransformToPoint(seg.p0, m),
                            p1: this._applyTransformToPoint(seg.p1, m),
                            p2: this._applyTransformToPoint(seg.p2, m),
                            p3: this._applyTransformToPoint(seg.p3, m)
                        };
                    }
                    if (seg.type === 'quad') {
                        return {
                            ...seg,
                            p0: this._applyTransformToPoint(seg.p0, m),
                            p1: this._applyTransformToPoint(seg.p1, m),
                            p2: this._applyTransformToPoint(seg.p2, m)
                        };
                    }
                    return seg;
                });
            });

            // Re-group if needed
            const finalSubpaths = [];
            let currentSubpath = [];
            for (const item of transformedSubpaths.flat()) {
                if (Array.isArray(item)) {
                    if (currentSubpath.length > 0) finalSubpaths.push(currentSubpath);
                    finalSubpaths.push(item);
                    currentSubpath = [];
                } else if (item.type === 'move') {
                    if (currentSubpath.length > 0) finalSubpaths.push(currentSubpath);
                    currentSubpath = [item];
                } else {
                    currentSubpath.push(item);
                }
            }
            if (currentSubpath.length > 0) finalSubpaths.push(currentSubpath);

            return { type: 'path', subpaths: finalSubpaths };
        }

        /**
         * Transform an arc segment, preserving analytic data
         */
        _transformArc(seg, m, isReflection) {
            const p0 = this._applyTransformToPoint(seg.p0, m);
            const p1 = this._applyTransformToPoint(seg.p1, m);
            const center = seg.center ? this._applyTransformToPoint(seg.center, m) : null;

            // Calculate scale factors
            const scaleX = Math.sqrt(m[0] * m[0] + m[1] * m[1]);
            const scaleY = Math.sqrt(m[2] * m[2] + m[3] * m[3]);

            // Calculate rotation angle from transform
            const rotation = Math.atan2(m[1], m[0]);

            // Transform radii and phi
            const newRx = seg.rx * scaleX;
            const newRy = seg.ry * scaleY;
            const newPhi = seg.phi + (rotation * 180 / Math.PI);

            // Reflection flips arc direction
            let clockwise = seg.clockwise;
            if (isReflection) {
                clockwise = !clockwise;
            }

            const result = {
                type: 'arc',
                p0: p0,
                p1: p1,
                rx: newRx,
                ry: newRy,
                phi: newPhi,
                fA: seg.fA,
                fS: isReflection ? (1 - seg.fS) : seg.fS,
                clockwise: clockwise
            };

            // Preserve center if available
            if (center) {
                result.center = center;
                // Recalculate angles based on transformed geometry
                result.startAngle = Math.atan2(p0.y - center.y, p0.x - center.x);
                result.endAngle = Math.atan2(p1.y - center.y, p1.x - center.x);
            }

            return result;
        }

        /**
         * Convert ellipse to path for non-axis-aligned transforms
         */
        _ellipseToPath(ellipse, m) {
            const { center, rx, ry } = ellipse;
            const p0 = { x: center.x + rx, y: center.y };
            
            const segments = [
                { type: 'move', p: p0 },
                {
                    type: 'arc', p0: p0, p1: p0,
                    center: center, rx: rx, ry: ry, phi: 0,
                    fA: 1, fS: 1, clockwise: true,
                    startAngle: 0, endAngle: 2 * Math.PI
                }
            ];

            return this._transformPath({ type: 'path', subpaths: [segments] }, m, m[0] * m[3] - m[1] * m[2] < 0);
        }

        /**
         * Convert rectangle/obround to path for non-axis-aligned transforms
         */
        _shapeToPath(geom, m) {
            const { x, y, width, height } = geom;
            let segments;

            if (geom.type === 'rectangle') {
                const p0 = { x: x, y: y };
                const p1 = { x: x + width, y: y };
                const p2 = { x: x + width, y: y + height };
                const p3 = { x: x, y: y + height };
                segments = [
                    { type: 'move', p: p0 },
                    { type: 'line', p0: p0, p1: p1 },
                    { type: 'line', p0: p1, p1: p2 },
                    { type: 'line', p0: p2, p1: p3 },
                    { type: 'line', p0: p3, p1: p0 }
                ];
            } else {
                // Obround
                const r = Math.min(width, height) / 2;
                segments = this._buildObroundSegments(x, y, width, height, r);
            }

            return this._transformPath({ type: 'path', subpaths: [segments] }, m, m[0] * m[3] - m[1] * m[2] < 0);
        }

        _buildObroundSegments(x, y, width, height, r) {
            const segments = [];
            
            if (width > height) {
                // Horizontal
                const c1 = { x: x + r, y: y + r };
                const c2 = { x: x + width - r, y: y + r };
                segments.push(
                    { type: 'move', p: { x: x + r, y: y } },
                    { type: 'line', p0: { x: x + r, y: y }, p1: { x: x + width - r, y: y } },
                    { type: 'arc', p0: { x: x + width - r, y: y }, p1: { x: x + width - r, y: y + height },
                      center: c2, rx: r, ry: r, phi: 0, fA: 0, fS: 1, clockwise: true,
                      startAngle: -Math.PI/2, endAngle: Math.PI/2 },
                    { type: 'line', p0: { x: x + width - r, y: y + height }, p1: { x: x + r, y: y + height } },
                    { type: 'arc', p0: { x: x + r, y: y + height }, p1: { x: x + r, y: y },
                      center: c1, rx: r, ry: r, phi: 0, fA: 0, fS: 1, clockwise: true,
                      startAngle: Math.PI/2, endAngle: -Math.PI/2 }
                );
            } else {
                // Vertical
                const c1 = { x: x + r, y: y + r };
                const c2 = { x: x + r, y: y + height - r };
                segments.push(
                    { type: 'move', p: { x: x, y: y + r } },
                    { type: 'line', p0: { x: x, y: y + r }, p1: { x: x, y: y + height - r } },
                    { type: 'arc', p0: { x: x, y: y + height - r }, p1: { x: x + width, y: y + height - r },
                      center: c2, rx: r, ry: r, phi: 0, fA: 0, fS: 1, clockwise: true,
                      startAngle: Math.PI, endAngle: 0 },
                    { type: 'line', p0: { x: x + width, y: y + height - r }, p1: { x: x + width, y: y + r } },
                    { type: 'arc', p0: { x: x + width, y: y + r }, p1: { x: x, y: y + r },
                      center: c1, rx: r, ry: r, phi: 0, fA: 0, fS: 1, clockwise: true,
                      startAngle: 0, endAngle: Math.PI }
                );
            }
            return segments;
        }

        _getStyles(node) {
            const styles = {
                fill: 'black', fillOpacity: 1.0,
                stroke: 'none', strokeWidth: 1.0, strokeOpacity: 1.0,
                display: 'inline', visibility: 'visible'
            };

            // Direct attributes
            if (node.getAttribute('fill')) styles.fill = node.getAttribute('fill');
            if (node.getAttribute('fill-opacity')) styles.fillOpacity = parseFloat(node.getAttribute('fill-opacity'));
            if (node.getAttribute('stroke')) styles.stroke = node.getAttribute('stroke');
            if (node.getAttribute('stroke-width')) styles.strokeWidth = parseFloat(node.getAttribute('stroke-width'));
            if (node.getAttribute('stroke-opacity')) styles.strokeOpacity = parseFloat(node.getAttribute('stroke-opacity'));
            if (node.getAttribute('display')) styles.display = node.getAttribute('display');
            if (node.getAttribute('visibility')) styles.visibility = node.getAttribute('visibility');

            // Style attribute (overrides)
            const styleAttr = node.getAttribute('style');
            if (styleAttr) {
                styleAttr.split(';').forEach(s => {
                    const [key, value] = s.split(':').map(p => p.trim());
                    if (key === 'fill') styles.fill = value;
                    else if (key === 'fill-opacity') styles.fillOpacity = parseFloat(value);
                    else if (key === 'stroke') styles.stroke = value;
                    else if (key === 'stroke-width') styles.strokeWidth = parseFloat(value);
                    else if (key === 'stroke-opacity') styles.strokeOpacity = parseFloat(value);
                    else if (key === 'display') styles.display = value;
                    else if (key === 'visibility') styles.visibility = value;
                });
            }

            return styles;
        }

        _applyTransformToPoint(p, m) {
            return {
                x: m[0] * p.x + m[2] * p.y + m[4],
                y: m[1] * p.x + m[3] * p.y + m[5]
            };
        }

        _applyTransformToPoints(points, m) {
            return points.map(p => this._applyTransformToPoint(p, m));
        }

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
                } else if (type === 'translate') {
                    transform[4] = values[0] || 0;
                    transform[5] = values[1] || 0;
                } else if (type === 'scale') {
                    transform[0] = values[0] || 1;
                    transform[3] = values[1] !== undefined ? values[1] : values[0];
                } else if (type === 'rotate') {
                    const angle = (values[0] || 0) * Math.PI / 180;
                    const cos = Math.cos(angle), sin = Math.sin(angle);
                    if (values.length === 3) {
                        const [cx, cy] = [values[1], values[2]];
                        transform = this._multiplyMatrix([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]);
                        transform = this._multiplyMatrix(transform, [1, 0, 0, 1, -cx, -cy]);
                    } else {
                        transform = [cos, sin, -sin, cos, 0, 0];
                    }
                } else if (type === 'skewx') {
                    transform[2] = Math.tan((values[0] || 0) * Math.PI / 180);
                } else if (type === 'skewy') {
                    transform[1] = Math.tan((values[0] || 0) * Math.PI / 180);
                }
                matrix = this._multiplyMatrix(matrix, transform);
            }
            return matrix;
        }
    }

    /**
     * PathDataParser - parses SVG path 'd' attribute
     */
    class PathDataParser {
        constructor(d) {
            this.d = d || '';
            this.subPaths = [];
            this.currentSubPath = null;
        }

        getSubPaths() {
            this._parse();
            return this.subPaths.map(sp => sp.segments);
        }

        _parse() {
            let lastCmd, currentPoint = { x: 0, y: 0 }, controlPoint = { x: 0, y: 0 }, startPoint = { x: 0, y: 0 };
            const commands = (this.d.match(/[a-df-z][^a-df-z]*/ig) || []);

            commands.forEach(cmdStr => {
                let cmdChar = cmdStr[0];
                let args = (cmdStr.slice(1).match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(parseFloat);

                if ("m" !== cmdChar.toLowerCase() && !this.currentSubPath) {
                    this.currentSubPath = { segments: [], closed: false };
                    this.subPaths.push(this.currentSubPath);
                    startPoint = {...currentPoint};
                }

                const argsPerCmd = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
                const cmdType = cmdChar.toLowerCase();
                let splitArgs = [];
                let innerLastCmd = cmdChar;

                if (cmdType in argsPerCmd && argsPerCmd[cmdType] > 0 && args.length > argsPerCmd[cmdType]) {
                    splitArgs.push(args.splice(0, argsPerCmd[cmdType]));
                    innerLastCmd = "m" === cmdType ? "l" : "M" === cmdType ? "L" : cmdChar;
                    while (args.length >= argsPerCmd[innerLastCmd.toLowerCase()]) {
                        splitArgs.push(args.splice(0, argsPerCmd[innerLastCmd.toLowerCase()]));
                    }
                } else {
                    splitArgs.push(args);
                }

                let isFirst = true;
                splitArgs.forEach(argSet => {
                    const effectiveCmd = isFirst ? cmdChar : innerLastCmd;
                    [currentPoint, controlPoint, startPoint] = this._executeCommand(
                        effectiveCmd, argSet, currentPoint, controlPoint, startPoint, lastCmd
                    );
                    lastCmd = effectiveCmd;
                    isFirst = false;
                });
            });
        }

        _executeCommand(cmd, args, currentPoint, controlPoint, startPoint, lastCmd) {
            const isRelative = cmd === cmd.toLowerCase();
            const cmdLower = cmd.toLowerCase();
            let p0 = {...currentPoint};

            switch (cmdLower) {
                case 'm': {
                    const p = {
                        x: isRelative ? p0.x + args[0] : args[0],
                        y: isRelative ? p0.y + args[1] : args[1]
                    };
                    currentPoint = p;
                    this.currentSubPath = { segments: [{ type: 'move', p: {...currentPoint} }], closed: false };
                    this.subPaths.push(this.currentSubPath);
                    startPoint = {...currentPoint};
                    break;
                }
                case 'l': {
                    const p1 = { x: isRelative ? p0.x + args[0] : args[0], y: isRelative ? p0.y + args[1] : args[1] };
                    this.currentSubPath.segments.push({ type: 'line', p0: {...p0}, p1 });
                    currentPoint = p1;
                    break;
                }
                case 'h': {
                    const p1 = { x: isRelative ? p0.x + args[0] : args[0], y: p0.y };
                    this.currentSubPath.segments.push({ type: 'line', p0: {...p0}, p1 });
                    currentPoint = p1;
                    break;
                }
                case 'v': {
                    const p1 = { x: p0.x, y: isRelative ? p0.y + args[0] : args[0] };
                    this.currentSubPath.segments.push({ type: 'line', p0: {...p0}, p1 });
                    currentPoint = p1;
                    break;
                }
                case 'z':
                    if (this.currentSubPath) {
                        this.currentSubPath.closed = true;
                        this.currentSubPath.segments.push({ type: 'line', p0: {...currentPoint}, p1: {...startPoint} });
                        currentPoint = {...startPoint};
                    }
                    break;
                case 'c': {
                    const p1 = { x: isRelative ? p0.x + args[0] : args[0], y: isRelative ? p0.y + args[1] : args[1] };
                    const p2 = { x: isRelative ? p0.x + args[2] : args[2], y: isRelative ? p0.y + args[3] : args[3] };
                    const p3 = { x: isRelative ? p0.x + args[4] : args[4], y: isRelative ? p0.y + args[5] : args[5] };
                    this.currentSubPath.segments.push({ type: 'cubic', p0: {...p0}, p1, p2, p3 });
                    currentPoint = p3; controlPoint = p2;
                    break;
                }
                case 's': {
                    let p1 = ['s','c'].includes(lastCmd?.toLowerCase()) 
                        ? { x: 2*p0.x - controlPoint.x, y: 2*p0.y - controlPoint.y } : {...p0};
                    const p2 = { x: isRelative ? p0.x + args[0] : args[0], y: isRelative ? p0.y + args[1] : args[1] };
                    const p3 = { x: isRelative ? p0.x + args[2] : args[2], y: isRelative ? p0.y + args[3] : args[3] };
                    this.currentSubPath.segments.push({ type: 'cubic', p0: {...p0}, p1, p2, p3 });
                    currentPoint = p3; controlPoint = p2;
                    break;
                }
                case 'q': {
                    const p1 = { x: isRelative ? p0.x + args[0] : args[0], y: isRelative ? p0.y + args[1] : args[1] };
                    const p2 = { x: isRelative ? p0.x + args[2] : args[2], y: isRelative ? p0.y + args[3] : args[3] };
                    this.currentSubPath.segments.push({ type: 'quad', p0: {...p0}, p1, p2 });
                    currentPoint = p2; controlPoint = p1;
                    break;
                }
                case 't': {
                    let p1 = ['t','q'].includes(lastCmd?.toLowerCase())
                        ? { x: 2*p0.x - controlPoint.x, y: 2*p0.y - controlPoint.y } : {...p0};
                    const p2 = { x: isRelative ? p0.x + args[0] : args[0], y: isRelative ? p0.y + args[1] : args[1] };
                    this.currentSubPath.segments.push({ type: 'quad', p0: {...p0}, p1, p2 });
                    currentPoint = p2; controlPoint = p1;
                    break;
                }
                case 'a': {
                    const p2 = { x: isRelative ? p0.x + args[5] : args[5], y: isRelative ? p0.y + args[6] : args[6] };
                    const arcParams = this._calculateArcParams(p0, args[0], args[1], args[2], args[3], args[4], p2);
                    if (arcParams) {
                        this.currentSubPath.segments.push({
                            type: 'arc', p0: {...p0}, p1: {...p2},
                            center: arcParams.center, rx: arcParams.rx, ry: arcParams.ry, phi: arcParams.phi,
                            fA: args[3], fS: args[4], clockwise: arcParams.clockwise,
                            startAngle: arcParams.startAngle, endAngle: arcParams.endAngle
                        });
                    } else {
                        this.currentSubPath.segments.push({ type: 'line', p0: {...p0}, p1: {...p2} });
                    }
                    currentPoint = p2;
                    break;
                }
            }

            if (!['s','c','t','q'].includes(cmdLower)) {
                controlPoint = {...currentPoint};
            }
            return [currentPoint, controlPoint, startPoint];
        }

        _calculateArcParams(p1, rx, ry, phi, fA, fS, p2) {
            const phiRad = phi * Math.PI / 180;
            const sinPhi = Math.sin(phiRad), cosPhi = Math.cos(phiRad);
            const dx = (p1.x - p2.x) / 2, dy = (p1.y - p2.y) / 2;
            const x1p = cosPhi * dx + sinPhi * dy;
            const y1p = -sinPhi * dx + cosPhi * dy;

            rx = Math.abs(rx); ry = Math.abs(ry);
            let lambda = (x1p*x1p)/(rx*rx) + (y1p*y1p)/(ry*ry);
            if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }

            const rxSq = rx*rx, rySq = ry*ry, x1pSq = x1p*x1p, y1pSq = y1p*y1p;
            let sq = Math.max(0, (rxSq*rySq - rxSq*y1pSq - rySq*x1pSq) / (rxSq*y1pSq + rySq*x1pSq));
            const coef = (fA === fS ? -1 : 1) * Math.sqrt(sq);
            const cxp = coef * (rx*y1p/ry), cyp = coef * (-ry*x1p/rx);
            const cx = cosPhi*cxp - sinPhi*cyp + (p1.x+p2.x)/2;
            const cy = sinPhi*cxp + cosPhi*cyp + (p1.y+p2.y)/2;

            const angle = (ux, uy, vx, vy) => {
                const sign = (ux*vy - uy*vx < 0) ? -1 : 1;
                const dot = ux*vx + uy*vy;
                const len = Math.sqrt(ux*ux+uy*uy) * Math.sqrt(vx*vx+vy*vy);
                return sign * Math.acos(Math.max(-1, Math.min(1, dot/len)));
            };

            const theta1 = angle(1, 0, (x1p-cxp)/rx, (y1p-cyp)/ry);
            let dtheta = angle((x1p-cxp)/rx, (y1p-cyp)/ry, (-x1p-cxp)/rx, (-y1p-cyp)/ry);
            if (fS === 0 && dtheta > 0) dtheta -= 2*Math.PI;
            if (fS === 1 && dtheta < 0) dtheta += 2*Math.PI;

            return {
                center: { x: cx, y: cy }, rx, ry, phi,
                startAngle: theta1, endAngle: theta1 + dtheta,
                clockwise: fS === 1
            };
        }
    }

    window.SVGParser = SVGParser;
})();