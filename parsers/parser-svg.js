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

    const config = window.PCBCAMConfig;
    const geomConfig = config.geometry;

    class SVGParser extends ParserCore {
        constructor(options = {}) {
            super(options);
            // Re-initialize all state
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

                let height = 0;
                const viewBox = svgNode.getAttribute('viewBox');
                if (viewBox) {
                    height = parseFloat(viewBox.split(' ')[3]);
                } else {
                    height = parseFloat(svgNode.getAttribute('height'));
                }
                if (!isFinite(height)) height = 0;

                // This transform is applied to all geometry
                const yFlipTransform = [1, 0, 0, -1, 0, height];
                this._traverseNode(svgNode, yFlipTransform);

                this.layers.bounds = this.calculateBounds(this.layers.objects);
                this.logStatistics();

                return { success: true, layers: this.layers, errors: this.errors, warnings: this.warnings };
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
        }

        _traverseNode(node, parentTransform) {
            if (node.nodeType !== 1) return;

            const styles = this._getStyles(node);
            if (styles.display === 'none' || styles.visibility === 'hidden') return;

            const nodeTransform = this._parseTransform(node.getAttribute('transform') || '');
            const currentTransform = this._multiplyMatrix(parentTransform, nodeTransform);
            const tagName = node.tagName.toLowerCase();

            switch (tagName) {
                case 'g': case 'svg':
                    Array.from(node.children).forEach(child => this._traverseNode(child, currentTransform));
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

        // Processes a filled shape, creating flash or region objects.
        _processFilledShape(geometry, transform) {
            const transformed = this._applyTransformToGeometry(geometry, transform);

            if (transformed.type === 'circle' || transformed.type === 'rectangle' || transformed.type === 'obround') {
                this._createFlash(transformed);
            } else if (transformed.type === 'path') {
                const subpaths = Array.isArray(transformed.subpaths) ? transformed.subpaths : [transformed.points];
                this._createPolarityRegions(subpaths);
            }
        }

        /**
         * Processes a stroked shape
         */
        _processStrokedShape(geometry, transform, strokeWidth) {
            const transformed = this._applyTransformToGeometry(geometry, transform);
            // The 'subpaths' here are the transformed analytic segments
            const subpaths = Array.isArray(transformed.subpaths) ? transformed.subpaths : [];
            const tolerance = geomConfig.coordinatePrecision;

            subpaths.forEach(segments => {
                // Fallback for old point arrays (from polyline/polygon)
                if (segments.length > 0 && segments[0].x !== undefined) {
                    this.layers.objects.push({ 
                        type: 'trace', 
                        interpolation: 'linear_path',
                        points: segments, 
                        width: strokeWidth, 
                        polarity: 'dark'
                    });
                    this.stats.objectsCreated++;
                    return; // Move to next subpath
                }

                if (segments.length === 0) return;

                // This logic must be stateful to correctly build analytic traces
                for (const seg of segments) {

                    if (seg.type === 'move') {
                        // 'move' segments have no p0, just 'p'. Skip them for traces.
                        continue;
                    }

                    if (seg.type === 'line') {
                        // Check for zero-length
                        const zeroTolerance = geomConfig.svgZeroLengthTolerance || 1e-6;
                        if (Math.hypot(seg.p1.x - seg.p0.x, seg.p1.y - seg.p0.y) < zeroTolerance) continue;

                        this.layers.objects.push({
                            type: 'trace',
                            start: seg.p0,
                            end: seg.p1,
                            width: strokeWidth,
                            polarity: 'dark',
                            interpolation: 'linear'
                        });
                        // currentPoint = seg.p1; // No longer need to track state here
                        this.stats.objectsCreated++;

                    } else if (seg.type === 'arc') {
                        if (Math.abs(seg.rx - seg.ry) < tolerance && Math.abs(seg.phi) < tolerance) {
                            // It's circular. Create a Gerber-style arc trace.
                            this.layers.objects.push({
                                type: 'trace',
                                start: seg.p0,
                                end: seg.p1,
                                width: strokeWidth,
                                polarity: 'dark',
                                interpolation: seg.clockwise ? 'cw_arc' : 'ccw_arc',
                                clockwise: seg.clockwise,
                                arc: { 
                                    i: seg.center.x - seg.p0.x,
                                    j: seg.center.y - seg.p0.y
                                }
                            });

                        } else {
                            // It's elliptical. Create a new analytic trace type.
                            this.layers.objects.push({
                                type: 'trace',
                                start: seg.p0,
                                end: seg.p1,
                                width: strokeWidth,
                                polarity: 'dark',
                                interpolation: 'elliptical_arc',
                                params: { rx: seg.rx, ry: seg.ry, phi: seg.phi, fA: seg.fA, fS: seg.fS }
                            });
                        }
                        // currentPoint = seg.p1;
                        this.stats.objectsCreated++;

                    } else if (seg.type === 'cubic') {
                        // Create analytic cubic bezier trace
                        this.layers.objects.push({
                            type: 'trace',
                            start: seg.p0,
                            end: seg.p3, 
                            width: strokeWidth,
                            polarity: 'dark',
                            interpolation: 'bezier_cubic',
                            points: [seg.p0, seg.p1, seg.p2, seg.p3]
                        });
                        // currentPoint = seg.p3;
                        this.stats.objectsCreated++;

                    } else if (seg.type === 'quad') {
                        // Create analytic quadratic bezier trace
                        this.layers.objects.push({
                            type: 'trace',
                            start: seg.p0,
                            end: seg.p2,
                            width: strokeWidth,
                            polarity: 'dark',
                            interpolation: 'bezier_quad',
                            points: [seg.p0, seg.p1, seg.p2]
                        });
                        // currentPoint = seg.p2;
                        this.stats.objectsCreated++;
                    }
                }
            });
        }
        
        // Creates flash objects.
        _createFlash(geom) {
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
                    // Create an analytic ellipse flash. The plotter will be responsible for handling this shape.
                    flash.shape = 'ellipse';
                    flash.position = geom.center;
                    flash.rx = geom.rx;
                    flash.ry = geom.ry;
                    // Pass rx/ry as parameters for compatibility
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
            this.layers.objects.push(flash);
            this.stats.objectsCreated++;
        }

        _createPolarityRegions(subpaths) {

            const validSubpaths = subpaths.filter(segments => segments.length > 0);

            this.debug(`Received ${subpaths.length} subpaths. Found ${validSubpaths.length} valid subpaths to plot.`);

            if (validSubpaths.length === 0) {
                return;
            }

            if (this.debug) {
                this.debug(`Bundling ${validSubpaths.length} subpaths into one 'region' object.`);
                validSubpaths.forEach((subpath, index) => {
                    // A subpath is an array of segment objects (move, line, arc, etc.)
                    this.debug(`  - Subpath ${index}: ${subpath.length} segments.`);
                });
            }

            // Create a single 'region' object. The plotter will be responsible for tessellating, nesting, and splitting this into multiple primitives if needed.
            this.layers.objects.push({
                type: 'region',
                polarity: 'dark', // Plotter will determine final polarity based on nesting
                analyticSubpaths: validSubpaths // Pass the raw analytic data
            });

            this.debug(`Passing ${validSubpaths.length} analytic subpaths to plotter.`);
            this.stats.objectsCreated++;
        }

        _parseShape(node) {
            const tagName = node.tagName.toLowerCase();
            switch (tagName) {
                case 'rect': return this._parseRect(node);
                case 'circle': return this._parseCircle(node);
                case 'ellipse': return this._parseEllipse(node);
                case 'polygon': return { type: 'path', points: this._parsePoly(node) };
                case 'polyline': return { type: 'path', points: this._parsePoly(node) };
                case 'path':
                    // getSubPaths now returns segment arrays
                    const subpathsOfSegments = new PathDataParser(node.getAttribute('d')).getSubPaths();
                    return { type: 'path', subpaths: subpathsOfSegments };
                case 'line':
                    const p = this._parseLine(node);
                    return p ? { type: 'path', points: p } : null;
            }
            return null;
        }

        _applyTransformToGeometry(geom, m) {
            const determinant = m[0] * m[3] - m[1] * m[2];
            
            if (geom.type === 'circle') {
                return {
                    type: 'circle',
                    center: this._applyTransformToPoint(geom.center, m),
                    radius: geom.radius * Math.sqrt(Math.abs(determinant))
                };
            }

            if (geom.type === 'rectangle' && m[1] === 0 && m[2] === 0) {
                const p1 = this._applyTransformToPoint({ x: geom.x, y: geom.y }, m),
                      p2 = this._applyTransformToPoint({ x: geom.x + geom.width, y: geom.y + geom.height }, m);
                return {
                    type: 'rectangle',
                    x: Math.min(p1.x, p2.x),
                    y: Math.min(p1.y, p2.y),
                    width: Math.abs(p1.x - p2.x),
                    height: Math.abs(p1.y - p2.y)
                };
            }

            // Handle transformed ellipses as general paths
            if (geom.type === 'ellipse' || (geom.type === 'rectangle' && (m[1] !== 0 || m[2] !== 0))) {
                let subpath;
                if (geom.type === 'ellipse') {
                    // Convert ellipse to a full analytic arc segment for the plotter
                    const { center, rx, ry } = geom;
                    const p0 = { x: center.x + rx, y: center.y };
                    subpath = [{
                        type: 'arc', p0: p0, p1: p0,
                        center: center, rx: rx, ry: ry, phi: 0,
                        fA: 1, fS: 1, clockwise: true,
                        startAngle: 0, endAngle: 2 * Math.PI
                    }];
                 } else { // Rotated rectangle
                    const { x, y, width, height } = geom;
                    const p0 = { x: x, y: y };
                    const p1 = { x: x + width, y: y };
                    const p2 = { x: x + width, y: y + height };
                    const p3 = { x: x, y: y + height };
                    subpath = [
                        { type: 'move', p: p0 },
                        { type: 'line', p0: p0, p1: p1 },
                        { type: 'line', p0: p1, p1: p2 },
                        { type: 'line', p0: p2, p1: p3 },
                        { type: 'line', p0: p3, p1: p0 } // Close the path
                    ];
                }
                // Create a path geometry and recursively transform it
                const pathGeom = { type: 'path', subpaths: [subpath] };
                return this._applyTransformToGeometry(pathGeom, m);
            }

            // Handle transformed obrounds as general paths
            if (geom.type === 'obround') {
                    // Simple axis-aligned scale
                    if (m[1] === 0 && m[2] === 0) {
                        return {
                            type: 'obround',
                            x: m[0] * geom.x + m[4],
                            y: m[3] * geom.y + m[5],
                            width: geom.width * Math.abs(m[0]),
                            height: geom.height * Math.abs(m[3])
                        };
                    }

                    // Rotated/skewed obround becomes an analytic path // Review - Why do this so early in the pipeline? System should support rotated obrounds.
                    // Define the obround as two lines and two arcs
                    const { x, y, width, height } = geom;
                    const r = Math.min(width, height) / 2;
                    let p0, p1, p2, p3, c1, c2;
                    let subpath;

                    if (width > height) { // Horizontal
                        c1 = { x: x + r, y: y + r };
                        c2 = { x: x + width - r, y: y + r };
                        p0 = { x: x + r, y: y };         // Top-left point
                        p1 = { x: x + width - r, y: y }; // Top-right point
                        p2 = { x: x + width - r, y: y + height }; // Bottom-right point
                        p3 = { x: x + r, y: y + height }; // Bottom-left point

                        subpath = [
                            { type: 'move', p: p0 },
                            { type: 'line', p0: p0, p1: p1 },
                            { type: 'arc',  p0: p1, p1: p2, center: c2, rx: r, ry: r, phi: 0, fA: 0, fS: 1, clockwise: true, startAngle: -Math.PI/2, endAngle: Math.PI/2 },
                            { type: 'line', p0: p2, p1: p3 },
                            { type: 'arc',  p0: p3, p1: p0, center: c1, rx: r, ry: r, phi: 0, fA: 0, fS: 1, clockwise: true, startAngle: Math.PI/2, endAngle: 3*Math.PI/2 }
                        ];
                    } else { // Vertical or circular
                        c1 = { x: x + r, y: y + r };
                        c2 = { x: x + r, y: y + height - r };
                        p0 = { x: x, y: y + r };         // Left-top point
                        p1 = { x: x, y: y + height - r }; // Left-bottom point
                        p2 = { x: x + width, y: y + height - r }; // Right-bottom point
                        p3 = { x: x + width, y: y + r }; // Right-top point
                        
                        subpath = [
                            { type: 'move', p: p0 },
                            { type: 'line', p0: p0, p1: p1 },
                            { type: 'arc',  p0: p1, p1: p2, center: c2, rx: r, ry: r, phi: 0, fA: 0, fS: 1, clockwise: true, startAngle: Math.PI, endAngle: 0 },
                            { type: 'line', p0: p2, p1: p3 },
                            { type: 'arc',  p0: p3, p1: p0, center: c1, rx: r, ry: r, phi: 0, fA: 0, fS: 1, clockwise: true, startAngle: 0, endAngle: Math.PI }
                        ];
                    }

                 // Create a new geometry object of type path
                 const pathGeom = { type: 'path', subpaths: [subpath] };
                 // Recursively call this function to transform the new path
                 return this._applyTransformToGeometry(pathGeom, m);
            }

            if (geom.type === 'path') {
                const transformedSubpaths = geom.subpaths.map(segments => {
                    // Fallback for old point arrays (from polyline/polygon) // Review - Is this still necessary?
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
                            // Tessellate it, then transform the points as the geometry system doesn't handle elliptical arcs yet.
                            // Use GeometryUtils to tessellate the original arc segment - Note: Tessellation should be at the plotter level? Also why is this here? The system supports rounded arcs.
                            const tessellated = GeometryUtils.tessellateEllipticalArc(
                                seg.p0, seg.p1, seg.rx, seg.ry,
                                seg.phi, seg.fA, seg.fS
                            );
                            
                            // Now transform the new points.
                            const arcPoints = tessellated.map(p => this._applyTransformToPoint(p, m));

                            // Convert this back into a series of line segments for the plotter and return this as a "point_array" subpath.
                            return { type: 'point_array', points: arcPoints };
                        }

                        // Transform ALL control points
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

                        return seg; // Return unknown types as-is
                    });
                }).flat(); // Flatten in case arc produced a point_array

                // Re-group segments into subpaths
                const finalSubpaths = [];
                let currentSubpath = [];
                for (const seg of transformedSubpaths) {
                    if (seg.type === 'point_array') {
                        if (currentSubpath.length > 0) finalSubpaths.push(currentSubpath);
                        finalSubpaths.push(seg.points); // Add as a raw point array
                        currentSubpath = [];
                    } else {
                        if (seg.type === 'move') {
                            if (currentSubpath.length > 0) finalSubpaths.push(currentSubpath);
                            currentSubpath = [seg];
                        } else {
                            currentSubpath.push(seg);
                        }
                    }
                }
                if (currentSubpath.length > 0) finalSubpaths.push(currentSubpath);

                return { type: 'path', subpaths: finalSubpaths };
            }

            return {
                type: 'path',
                points: this._applyTransformToPoints(points, m)
            };
        }

        _parseRect(node) {
            const x = parseFloat(node.getAttribute('x') || 0),
                y = parseFloat(node.getAttribute('y') || 0),
                width = parseFloat(node.getAttribute('width') || 0),
                height = parseFloat(node.getAttribute('height') || 0);
            return (width > 0 && height > 0) ? {
                type: 'rectangle',
                x,
                y,
                width,
                height
            } : null;
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
            const rx = parseFloat(node.getAttribute('rx') || 0),
                ry = parseFloat(node.getAttribute('ry') || 0);
            return (rx > 0 && ry > 0) ? {
                type: 'ellipse', 
                center: {
                    x: parseFloat(node.getAttribute('cx') || 0),
                    y: parseFloat(node.getAttribute('cy') || 0)
                },
                rx,
                ry
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

        _getStyles(node) {
            // These are mostly ignored depending on which layer they end up in.
            const styles = {
                fill: 'black',
                fillOpacity: 1.0,
                stroke: 'none',
                strokeWidth: 1.0,
                strokeOpacity: 1.0,
                display: 'inline',
                visibility: 'visible'
            };

            // 1. Apply direct attributes first
            styles.fill = node.getAttribute('fill') || styles.fill;
            styles.fillOpacity = parseFloat(node.getAttribute('fill-opacity')) || styles.fillOpacity;
            styles.stroke = node.getAttribute('stroke') || styles.stroke;
            styles.strokeWidth = parseFloat(node.getAttribute('stroke-width')) || styles.strokeWidth;
            styles.strokeOpacity = parseFloat(node.getAttribute('stroke-opacity')) || styles.strokeOpacity;
            styles.display = node.getAttribute('display') || styles.display;
            styles.visibility = node.getAttribute('visibility') || styles.visibility;

            // 2. Apply style attribute last
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

        _pointsMatch(p1, p2, tolerance = 1e-2) {
            const matchTolerance = tolerance || geomConfig.svgPointMatchTolerance || 1e-2;
            if (!p1 || !p2) return false;
            return Math.abs(p1.x - p2.x) < matchTolerance && 
                Math.abs(p1.y - p2.y) < matchTolerance;
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

        _identityMatrix() {
            return [1, 0, 0, 1, 0, 0];
        }

        _multiplyMatrix(m1, m2) {
            return [m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1], m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3], m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]];
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
                    transform = [values[0], values[1], values[2], values[3], values[4], values[5]];
                } else if (type === 'translate' && values.length >= 1) {
                    transform[4] = values[0];
                    transform[5] = values[1] || 0;
                } else if (type === 'scale' && values.length >= 1) {
                    transform[0] = values[0];
                    transform[3] = values[1] === undefined ? values[0] : values[1];
                } else if (type === 'rotate' && values.length >= 1) {
                    const angle = values[0] * Math.PI / 180,
                        cos = Math.cos(angle),
                        sin = Math.sin(angle);
                    if (values.length === 3) {
                        const [cx, cy] = [values[1], values[2]];
                        transform = this._multiplyMatrix([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]);
                        transform = this._multiplyMatrix(transform, [1, 0, 0, 1, -cx, -cy]);
                    } else {
                        transform = [cos, sin, -sin, cos, 0, 0];
                    }
                }
                matrix = this._multiplyMatrix(matrix, transform);
            }
            return matrix;
        }
    }

    /**
     * This class is responsible for parsing the 'd' attribute of an SVG <path>
     * It correctly generates an array of analytic segment objects, each containing its correct start point (p0).
     */
    class PathDataParser {
        constructor(d, options = {}) {
            this.d = d;
            this.options = options;
            this.subPaths = [];
            this.currentSubPath = null;
        }

        getSubPaths() {
            this._parse();
            // Return the array of segment arrays
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
                    startPoint = {...currentPoint };
                }

                let splitArgs = [];
                const argsPerCmd = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
                const cmdType = cmdChar.toLowerCase();

                let innerLastCmd = cmdChar; 

                if (cmdType in argsPerCmd && argsPerCmd[cmdType] > 0 && args.length > argsPerCmd[cmdType]) {
                    splitArgs.push(args.splice(0, argsPerCmd[cmdType]));
                    innerLastCmd = "m" === cmdType ? "l" : "M" === cmdType ? "L" : cmdChar;
                    while (args.length > 0) {
                        const argCount = argsPerCmd[innerLastCmd.toLowerCase()];
                        if (argCount > 0 && args.length >= argCount) {
                            splitArgs.push(args.splice(0, argCount));
                        } else {
                            break; 
                        }
                    }
                } else {
                    splitArgs.push(args);
                }

                let isFirst = true;
                splitArgs.forEach(argSet => {
                    const effectiveCmd = isFirst ? cmdChar : innerLastCmd;

                    // `lastCmd` is passed from the previous iteration.
                    [currentPoint, controlPoint, startPoint] = this._executeCommand(
                        effectiveCmd, argSet, currentPoint, controlPoint, startPoint, lastCmd
                    );

                    // Update `lastCmd` *inside* this loop so the next implicit command gets the correct preceding command type.
                    lastCmd = effectiveCmd; 
                    isFirst = false;
                });
                
            });
        }

        _executeCommand(cmd, args, currentPoint, controlPoint, startPoint, lastCmd) {
            const isRelative = cmd === cmd.toLowerCase();
            const cmdLower = cmd.toLowerCase();
            // p0 is the state of currentPoint *before* the command
            let p0 = {...currentPoint};

            switch (cmdLower) {
                case 'm':
                    {
                        const p = {
                            x: isRelative ? p0.x + args[0] : args[0],
                            y: isRelative ? p0.y + args[1] : args[1]
                        };
                        currentPoint = p;
                        this.currentSubPath = {
                            segments: [{ type: 'move', p: { ...currentPoint } }],
                            closed: false
                        };
                        this.subPaths.push(this.currentSubPath);
                        startPoint = {...currentPoint};
                    }
                    break;

                case 'l':
                    {
                        const p1 = {
                            x: isRelative ? p0.x + args[0] : args[0],
                            y: isRelative ? p0.y + args[1] : args[1]
                        };
                        this.currentSubPath.segments.push({ type: 'line', p0: { ...p0 }, p1: p1 });
                        currentPoint = p1;
                    }
                    break;

                case 'h':
                    {
                        const p1 = {
                            x: isRelative ? p0.x + args[0] : args[0],
                            y: p0.y // Use p0.y, not currentPoint.y
                        };
                        this.currentSubPath.segments.push({ type: 'line', p0: { ...p0 }, p1: p1 });
                        currentPoint = p1;
                    }
                    break;

                case 'v':
                    {
                        const p1 = {
                            x: p0.x, // Use p0.x, not currentPoint.x
                            y: isRelative ? p0.y + args[0] : args[0]
                        };
                        this.currentSubPath.segments.push({ type: 'line', p0: { ...p0 }, p1: p1 });
                        currentPoint = p1;
                    }
                    break;

                case 'z':
                    if (this.currentSubPath) {
                        this.currentSubPath.closed = true;
                        this.currentSubPath.segments.push({ type: 'line', p0: { ...currentPoint }, p1: { ...startPoint } });
                        currentPoint = {...startPoint};
                    }
                    break;

                case 'c':
                    {
                        const p1 = { x: isRelative ? p0.x + args[0] : args[0], y: isRelative ? p0.y + args[1] : args[1] };
                        const p2 = { x: isRelative ? p0.x + args[2] : args[2], y: isRelative ? p0.y + args[3] : args[3] };
                        const p3 = { x: isRelative ? p0.x + args[4] : args[4], y: isRelative ? p0.y + args[5] : args[5] };
                        this.currentSubPath.segments.push({ type: 'cubic', p0: { ...p0 }, p1: p1, p2: p2, p3: p3 });
                        currentPoint = p3; controlPoint = p2;
                        break;
                    }

                case 's':
                    {
                        let p1;
                        if (['s', 'c'].includes(lastCmd?.toLowerCase())) {
                            p1 = { x: 2 * p0.x - controlPoint.x, y: 2 * p0.y - controlPoint.y };
                        } else {
                            p1 = { ...p0 };
                        }
                        const p2 = { x: isRelative ? p0.x + args[0] : args[0], y: isRelative ? p0.y + args[1] : args[1] };
                        const p3 = { x: isRelative ? p0.x + args[2] : args[2], y: isRelative ? p0.y + args[3] : args[3] };
                        this.currentSubPath.segments.push({ type: 'cubic', p0: { ...p0 }, p1: p1, p2: p2, p3: p3 });
                        currentPoint = p3; controlPoint = p2;
                        break;
                    }
                    
                case 'q':
                    {
                        const p1 = { x: isRelative ? p0.x + args[0] : args[0], y: isRelative ? p0.y + args[1] : args[1] };
                        const p2 = { x: isRelative ? p0.x + args[2] : args[2], y: isRelative ? p0.y + args[3] : args[3] };
                        this.currentSubPath.segments.push({ type: 'quad', p0: { ...p0 }, p1: p1, p2: p2 });
                        currentPoint = p2; controlPoint = p1;
                        break;
                    }

                case 't':
                    {
                        let p1;
                        if (['t', 'q'].includes(lastCmd?.toLowerCase())) {
                            p1 = { x: 2 * p0.x - controlPoint.x, y: 2 * p0.y - controlPoint.y };
                        } else {
                            p1 = { ...p0 };
                        }
                        const p2 = { x: isRelative ? p0.x + args[0] : args[0], y: isRelative ? p0.y + args[1] : args[1] };
                        this.currentSubPath.segments.push({ type: 'quad', p0: { ...p0 }, p1: p1, p2: p2});
                        currentPoint = p2; controlPoint = p1;
                        break;
                    }

                case 'a':
                    {
                        const p2_arc = { x: isRelative ? p0.x + args[5] : args[5], y: isRelative ? p0.y + args[6] : args[6] };
                        const arcParams = this._calculateArcParams(p0, args[0], args[1], args[2], args[3], args[4], p2_arc);
                        if (arcParams) {
                            this.currentSubPath.segments.push({
                                type: 'arc',
                                p0: { ...p0 },
                                p1: { ...p2_arc },
                                center: arcParams.center,
                                rx: arcParams.rx,
                                ry: arcParams.ry,
                                phi: arcParams.phi,
                                fA: args[3],
                                fS: args[4],
                                clockwise: arcParams.clockwise,
                                startAngle: arcParams.startAngle,
                                endAngle: arcParams.endAngle
                            });
                        } else {
                            this.currentSubPath.segments.push({ type: 'line', p0: { ...p0 }, p1: { ...p2_arc } });
                        }
                        currentPoint = p2_arc;
                        break;
                    }
            }
            if (['s', 'c', 't', 'q'].indexOf(cmdLower) === -1) {
                controlPoint = {...currentPoint };
            }
            return [currentPoint, controlPoint, startPoint];
        }

        _calculateArcParams(p1, rx, ry, phi, fA, fS, p2) {
            const a = Math.sin(phi * Math.PI / 180),
                s = Math.cos(phi * Math.PI / 180),
                e = (p1.x - p2.x) / 2,
                o = (p1.y - p2.y) / 2,
                r = s * e + a * o,
                h = -a * e + s * o;
            rx = Math.abs(rx);
            ry = Math.abs(ry);
            let c = r * r / (rx * rx) + h * h / (ry * ry);
            if (c > 1) {
                rx *= Math.sqrt(c);
                ry *= Math.sqrt(c)
            }

            const l = (rx * rx * ry * ry - rx * rx * h * h - ry * ry * r * r) / (rx * rx * h * h + ry * ry * r * r),
                d = (fA === fS ? -1 : 1) * Math.sqrt(Math.max(0, l)),
                M = d * (rx * h / ry),
                g = d * (-ry * r / rx),
                x = s * M - a * g + (p1.x + p2.x) / 2,
                y = a * M + s * g + (p1.y + p2.y) / 2,
                I = (t, p) => {
                    const i = t[0] * p[1] - t[1] * p[0] < 0 ? -1 : 1;
                    return i * Math.acos((t[0] * p[0] + t[1] * p[1]) / (Math.sqrt(t[0] * t[0] + t[1] * t[1]) * Math.sqrt(p[0] * p[0] + p[1] * p[1])))
                },
                u = I([1, 0], [(r - M) / rx, (h - g) / ry]);
            let m = I([(r - M) / rx, (h - g) / ry], [(-r - M) / rx, (-h - g) / ry]);
            0 === fS && m > 0 ? m -= 2 * Math.PI : 1 === fS && m < 0 && (m += 2 * Math.PI);

            return {
                center: { x: x, y: y },
                rx: rx, ry: ry, phi: phi,
                startAngle: u, endAngle: u + m,
                clockwise: fS === 1
            };
        }
    }

    window.SVGParser = SVGParser;
})();