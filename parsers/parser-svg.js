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

    // This parser adopts the "Polarity Primitive" strategy to be compatible with the GeometryProcessor pipeline.
    // It creates separate 'dark' (solid) and 'clear' (hole) primitives, mimicking the Gerber parser's output.

    class SVGParser extends ParserCore {
        constructor(options = {}) {
            super(options);
            // Re-initialize all state
            this.reset();
        }

        parse(content) {
            try {
                this.debug('Starting SVG parse (Polarity-based)');
                this.reset();

                const parser = new DOMParser();
                const doc = parser.parseFromString(content, 'image/svg+xml');
                const svgNode = doc.documentElement;

                if (svgNode.tagName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
                    throw new Error(doc.querySelector('parsererror')?.textContent || 'Invalid SVG file');
                }
                
                // The Y-flip transform is crucial for converting from SVG's Y-down to the application's internal Y-up system.
                let height = 0;
                const viewBox = svgNode.getAttribute('viewBox');
                if (viewBox) {
                    height = parseFloat(viewBox.split(' ')[3]);
                } else {
                    height = parseFloat(svgNode.getAttribute('height'));
                }
                if (!isFinite(height)) height = 0;
                
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
                    } else if (styles.stroke && styles.stroke !== 'none' && styles.strokeWidth > 0 && styles.strokeOpacity > 0) {
                        this._processStrokedShape(geometry, currentTransform, styles.strokeWidth);
                    }
                    break;
            }
        }
        
        // Processes a filled shape, creating 'flash' or 'region' objects.
        _processFilledShape(geometry, transform) {
            const transformed = this._applyTransformToGeometry(geometry, transform);

            if (transformed.type === 'circle' || transformed.type === 'rectangle' || transformed.type === 'obround') {
                this._createFlash(transformed);
            } else if (transformed.type === 'path') {
                const subpaths = Array.isArray(transformed.subpaths) ? transformed.subpaths : [transformed.points];
                this._createPolarityRegions(subpaths);
            }
        }

        // Processes a stroked shape, creating 'trace' objects.
        _processStrokedShape(geometry, transform, strokeWidth) {
            const transformed = this._applyTransformToGeometry(geometry, transform);
            const subpaths = Array.isArray(transformed.subpaths) ? transformed.subpaths : [transformed.points];
            
            subpaths.forEach(points => {
                if (points.length >= 2) {
                    for (let i = 0; i < points.length - 1; i++) {
                        const p1 = points[i];
                        const p2 = points[i + 1];
                        if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 1e-6) continue;
                        this.layers.objects.push({ type: 'trace', start: p1, end: p2, width: strokeWidth, polarity: 'dark' });
                        this.stats.objectsCreated++;
                    }
                }
            });
        }

        // Creates 'flash' objects compatible with the ParserPlotter.
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
                case 'obround':
                    flash.shape = 'obround';
                    flash.position = geom.center;
                    flash.width = geom.rx * 2;
                    flash.height = geom.ry * 2;
                    flash.parameters.push(geom.rx * 2, geom.ry * 2);
                    break;
            }
            this.layers.objects.push(flash);
            this.stats.objectsCreated++;
        }

        // Identifies solids and holes, nests holes within parent regions
        _createPolarityRegions(subpaths) {
            const tolerance = 1e-9;
            const paths = subpaths.map((points, index) => {
                if (points.length > 2) {
                    const first = points[0];
                    const last = points[points.length - 1];
                    if (Math.hypot(first.x - last.x, first.y - last.y) > tolerance) {
                        points.push({ ...first });
                    }
                }
                return { 
                    id: index, 
                    points, 
                    area: this._calculateSignedArea(points), 
                    parent: null, 
                    nestingLevel: 0, 
                    children: [] 
                };
            }).filter(p => p.points.length > 2 && Math.abs(p.area) > tolerance);

            if (paths.length === 0) return;

            const pathMap = new Map(paths.map(p => [p.id, p]));
            
            // Build parent-child hierarchy
            paths.forEach(p1 => {
                let bestParent = null;
                paths.forEach(p2 => {
                    if (p1.id === p2.id) return;
                    if (Math.abs(p2.area) > Math.abs(p1.area) && this._isPointInPolygon(p1.points[0], p2.points)) {
                        if (!bestParent || Math.abs(p2.area) < Math.abs(bestParent.area)) bestParent = p2;
                    }
                });
                if (bestParent) {
                    p1.parent = bestParent.id;
                    bestParent.children.push(p1.id);
                }
            });

            // Calculate nesting levels and enforce winding
            paths.forEach(path => {
                let level = 0, current = path;
                while (current && current.parent !== null) { 
                    level++; 
                    current = pathMap.get(current.parent); 
                }
                path.nestingLevel = level;

                const isSolid = path.nestingLevel % 2 === 0;
                const isCCW = path.area > 0;

                // Enforce winding: Solids CCW, Holes CW
                if ((isSolid && !isCCW) || (!isSolid && isCCW)) {
                    path.points.reverse();
                }
            });

            // Create ONE region per root with all child contours attached
            const rootPaths = paths.filter(p => p.parent === null);
            
            rootPaths.forEach(rootPath => {
                // Collect ALL descendant contours (holes, islands, etc.)
                const allContours = [];
                
                const collectContours = (pathId) => {
                    const path = pathMap.get(pathId);
                    if (!path) return;
                    
                    allContours.push({
                        points: path.points,
                        nestingLevel: path.nestingLevel,
                        isHole: path.nestingLevel % 2 === 1,
                        parentId: path.parent
                    });
                    
                    // Recursively collect children
                    path.children.forEach(childId => collectContours(childId));
                };
                
                // Start with root (level 0)
                collectContours(rootPath.id);
                
                this.layers.objects.push({
                    type: 'region',
                    points: rootPath.points,
                    contours: allContours,  // Array of all contours with metadata
                    polarity: 'dark'
                });
                if (this.debug) {
                    console.log(`[SVG Parser] Created region with ${allContours.length} contours (${allContours.filter(c => c.isHole).length} holes)`);
                }
                this.stats.objectsCreated++;
            });
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
                    const subpaths = new PathDataParser(node.getAttribute('d')).getSubPaths();
                    return { type: 'path', subpaths: subpaths.map(s => s.points) };
                case 'line':
                    const p = this._parseLine(node);
                    return p ? { type: 'path', points: p } : null;
            }
            return null;
        }
        _applyTransformToGeometry(geom, m) {
            if (geom.type === 'circle') { return { type: 'circle', center: this._applyTransformToPoint(geom.center, m), radius: geom.radius * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) }; }
            if (geom.type === 'rectangle' && m[1] === 0 && m[2] === 0) { const p1 = this._applyTransformToPoint({ x: geom.x, y: geom.y }, m), p2 = this._applyTransformToPoint({ x: geom.x + geom.width, y: geom.y + geom.height }, m); return { type: 'rectangle', x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), width: Math.abs(p1.x - p2.x), height: Math.abs(p1.y - p2.y) }; }
            if (geom.type === 'obround' && m[1] === 0 && m[2] === 0) { return { type: 'obround', center: this._applyTransformToPoint(geom.center, m), rx: geom.rx * Math.abs(m[0]), ry: geom.ry * Math.abs(m[3]) }; }
            let points = [];
            if (geom.type === 'rectangle') points = [{ x: geom.x, y: geom.y }, { x: geom.x + geom.width, y: geom.y }, { x: geom.x + geom.width, y: geom.y + geom.height }, { x: geom.x, y: geom.y + geom.height }];
            else if (geom.type === 'obround') points = this._ellipseToPoints(geom);
            else if (geom.type === 'path') return { type: 'path', subpaths: geom.subpaths.map(s => this._applyTransformToPoints(s, m)) };
            else if (geom.points) points = geom.points;
            return { type: 'path', points: this._applyTransformToPoints(points, m) };
        }
        _parseRect(node) { const x = parseFloat(node.getAttribute('x') || 0), y = parseFloat(node.getAttribute('y') || 0), width = parseFloat(node.getAttribute('width') || 0), height = parseFloat(node.getAttribute('height') || 0); return (width > 0 && height > 0) ? { type: 'rectangle', x, y, width, height } : null; }
        _parseCircle(node) { const r = parseFloat(node.getAttribute('r') || 0); return r > 0 ? { type: 'circle', center: { x: parseFloat(node.getAttribute('cx') || 0), y: parseFloat(node.getAttribute('cy') || 0) }, radius: r } : null; }
        _parseEllipse(node) { const rx = parseFloat(node.getAttribute('rx') || 0), ry = parseFloat(node.getAttribute('ry') || 0); return (rx > 0 && ry > 0) ? { type: 'obround', center: { x: parseFloat(node.getAttribute('cx') || 0), y: parseFloat(node.getAttribute('cy') || 0) }, rx, ry } : null; }
        _ellipseToPoints(geom) { const points = []; const segments = 64; for (let i = 0; i < segments; i++) { const angle = (i / segments) * 2 * Math.PI; points.push({ x: geom.center.x + geom.rx * Math.cos(angle), y: geom.center.y + geom.ry * Math.sin(angle) }); } return points; }
        _parseLine(node) { return [{ x: parseFloat(node.getAttribute('x1') || 0), y: parseFloat(node.getAttribute('y1') || 0) }, { x: parseFloat(node.getAttribute('x2') || 0), y: parseFloat(node.getAttribute('y2') || 0) }]; }
        _parsePoly(node) { const pointsStr = (node.getAttribute('points') || '').trim(); if (!pointsStr) return []; const pairs = pointsStr.split(/\s*,\s*|\s+/); const points = []; for (let i = 0; i < pairs.length; i += 2) { points.push({ x: parseFloat(pairs[i]), y: parseFloat(pairs[i + 1]) }); } return points; }
        _getStyles(node) { const styles = { fill: 'black', fillOpacity: 1.0, stroke: 'none', strokeWidth: 1.0, strokeOpacity: 1.0, display: 'inline', visibility: 'visible' }; const styleAttr = node.getAttribute('style'); if (styleAttr) { styleAttr.split(';').forEach(s => { const [key, value] = s.split(':').map(p => p.trim()); if (key === 'fill') styles.fill = value; else if (key === 'fill-opacity') styles.fillOpacity = parseFloat(value); else if (key === 'stroke') styles.stroke = value; else if (key === 'stroke-width') styles.strokeWidth = parseFloat(value); else if (key === 'stroke-opacity') styles.strokeOpacity = parseFloat(value); else if (key === 'display') styles.display = value; else if (key === 'visibility') styles.visibility = value; }); } styles.fill = node.getAttribute('fill') || styles.fill; styles.fillOpacity = parseFloat(node.getAttribute('fill-opacity')) || styles.fillOpacity; styles.stroke = node.getAttribute('stroke') || styles.stroke; styles.strokeWidth = parseFloat(node.getAttribute('stroke-width')) || styles.strokeWidth; styles.strokeOpacity = parseFloat(node.getAttribute('stroke-opacity')) || styles.strokeOpacity; return styles; }
        _calculateSignedArea(points) { let a=0; for(let i=0,j=points.length-1;i<points.length;j=i++)a+=(points[j].x+points[i].x)*(points[j].y-points[i].y); return a/2; }
        _isPointInPolygon(p, poly) { let i=!1; if (!p || !poly || poly.length === 0) return false; for(let t=0,n=poly.length-1;t<poly.length;n=t++) (poly[t].y>p.y)!==(poly[n].y>p.y)&&p.x<(poly[n].x-poly[t].x)*(p.y-poly[t].y)/(poly[n].y-poly[t].y)+poly[t].x&&(i=!i); return i; }
        _applyTransformToPoint(p, m) { return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }; }
        _applyTransformToPoints(points, m) { return points.map(p => this._applyTransformToPoint(p, m)); }
        _identityMatrix() { return [1, 0, 0, 1, 0, 0]; }
        _multiplyMatrix(m1, m2) { return [ m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1], m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3], m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5] ]; }
        _parseTransform(transformString) { let matrix = this._identityMatrix(); if (!transformString) return matrix; const regex = /(\w+)\s*\(([^)]+)\)/g; let match; while ((match = regex.exec(transformString)) !== null) { const type = match[1].toLowerCase(); const values = match[2].trim().split(/[\s,]+/).map(parseFloat); let transform = this._identityMatrix(); if (type === 'matrix' && values.length === 6) { transform = [values[0], values[1], values[2], values[3], values[4], values[5]]; } else if (type === 'translate' && values.length >= 1) { transform[4] = values[0]; transform[5] = values[1] || 0; } else if (type === 'scale' && values.length >= 1) { transform[0] = values[0]; transform[3] = values[1] === undefined ? values[0] : values[1]; } else if (type === 'rotate' && values.length >= 1) { const angle = values[0] * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle); if (values.length === 3) { const [cx, cy] = [values[1], values[2]]; transform = this._multiplyMatrix([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]); transform = this._multiplyMatrix(transform, [1, 0, 0, 1, -cx, -cy]); } else { transform = [cos, sin, -sin, cos, 0, 0]; } } matrix = this._multiplyMatrix(matrix, transform); } return matrix; }
    }

    // PathDataParser can remain the same minified version as it is self-contained and correct.
    class PathDataParser { constructor(d, options = {}) { this.d = d; this.options = options; this.subPaths = []; this.currentSubPath = null; } getSubPaths() { this._parse(); return this.subPaths; } _parse() { let l,c={x:0,y:0},p={x:0,y:0},s={x:0,y:0};const t=(this.d.match(/[a-df-z][^a-df-z]*/ig)||[]);t.forEach(t=>{let e=t[0],a=(t.slice(1).match(/-?[\d.]+(?:e-?\d+)?/g)||[]).map(parseFloat);if("m"!==e.toLowerCase()&&!this.currentSubPath){this.currentSubPath={points:[{...c}],closed:!1};this.subPaths.push(this.currentSubPath);s={...c}}let i=[];const n={m:2,l:2,h:1,v:1,c:6,s:4,q:4,t:2,a:7,z:0},o=e.toLowerCase();if(a.length>n[o]){i.push(a.splice(0,n[o]));l="m"===o?"l":"M"===o?"L":e;for(;a.length>0;)i.push(a.splice(0,n[l.toLowerCase()]))}else i.push(a);let r=!0;i.forEach(t=>{const i=r?e:l;[c,p,s]=this._executeCommand(i,t,c,p,s);r=!1});l=e}) } _executeCommand(cmd, args, currentPoint, controlPoint, startPoint) { const isRelative = cmd === cmd.toLowerCase(); const cmdLower = cmd.toLowerCase(); let p0 = { ...currentPoint }; switch (cmdLower) { case 'm': currentPoint.x = isRelative ? p0.x + args[0] : args[0]; currentPoint.y = isRelative ? p0.y + args[1] : args[1]; this.currentSubPath = { points: [{ ...currentPoint }], closed: false }; this.subPaths.push(this.currentSubPath); startPoint = { ...currentPoint }; break; case 'l': currentPoint.x = isRelative ? p0.x + args[0] : args[0]; currentPoint.y = isRelative ? p0.y + args[1] : args[1]; this.currentSubPath.points.push({ ...currentPoint }); break; case 'h': currentPoint.x = isRelative ? p0.x + args[0] : args[0]; this.currentSubPath.points.push({ ...currentPoint }); break; case 'v': currentPoint.y = isRelative ? p0.y + args[0] : args[0]; this.currentSubPath.points.push({ ...currentPoint }); break; case 'z': if (this.currentSubPath) { this.currentSubPath.closed = true; currentPoint = { ...startPoint }; } break; case 'c': { const p1 = { x: isRelative ? p0.x + args[0] : args[0], y: isRelative ? p0.y + args[1] : args[1] }; const p2 = { x: isRelative ? p0.x + args[2] : args[2], y: isRelative ? p0.y + args[3] : args[3] }; const p3 = { x: isRelative ? p0.x + args[4] : args[4], y: isRelative ? p0.y + args[5] : args[5] }; this.currentSubPath.points.push(...this._tessellateCubic(p0, p1, p2, p3)); currentPoint = p3; controlPoint = p2; break; } case 's': { const p1 = { x: 2 * p0.x - controlPoint.x, y: 2 * p0.y - controlPoint.y }; const p2 = { x: isRelative ? p0.x + args[0] : args[0], y: isRelative ? p0.y + args[1] : args[1] }; const p3 = { x: isRelative ? p0.x + args[2] : args[2], y: isRelative ? p0.y + args[3] : args[3] }; this.currentSubPath.points.push(...this._tessellateCubic(p0, p1, p2, p3)); currentPoint = p3; controlPoint = p2; break; } case 'q': { const p1 = { x: isRelative ? p0.x + args[0] : args[0], y: isRelative ? p0.y + args[1] : args[1] }; const p2 = { x: isRelative ? p0.x + args[2] : args[2], y: isRelative ? p0.y + args[3] : args[3] }; this.currentSubPath.points.push(...this._tessellateQuadratic(p0, p1, p2)); currentPoint = p2; controlPoint = p1; break; } case 't': { const p1 = { x: 2 * p0.x - controlPoint.x, y: 2 * p0.y - controlPoint.y }; const p2 = { x: isRelative ? p0.x + args[0] : args[0], y: isRelative ? p0.y + args[1] : args[1] }; this.currentSubPath.points.push(...this._tessellateQuadratic(p0, p1, p2)); currentPoint = p2; controlPoint = p1; break; } case 'a': { const p2_arc = { x: isRelative ? p0.x + args[5] : args[5], y: isRelative ? p0.y + args[6] : args[6] }; this.currentSubPath.points.push(...this._tessellateArc(p0, args[0], args[1], args[2], args[3], args[4], p2_arc)); currentPoint = p2_arc; break; } } if (['s', 'c', 't', 'q'].indexOf(cmdLower) === -1) { controlPoint = { ...currentPoint }; } return [currentPoint, controlPoint, startPoint]; } _tessellateCubic(p0,p1,p2,p3){const a=[],t=32;for(let s=1;s<=t;s++){const e=s/t,o=1-e;a.push({x:o*o*o*p0.x+3*o*o*e*p1.x+3*o*e*e*p2.x+e*e*e*p3.x,y:o*o*o*p0.y+3*o*o*e*p1.y+3*o*e*e*p2.y+e*e*e*p3.y})}return a} _tessellateQuadratic(p0,p1,p2){const a=[],t=32;for(let s=1;s<=t;s++){const e=s/t,o=1-e;a.push({x:o*o*p0.x+2*o*e*p1.x+e*e*p2.x,y:o*o*p0.y+2*o*e*p1.y+e*e*p2.y})}return a} _tessellateArc(p1,rx,ry,phi,fA,fS,p2){const a=Math.sin(phi*Math.PI/180),s=Math.cos(phi*Math.PI/180),e=(p1.x-p2.x)/2,o=(p1.y-p2.y)/2,r=s*e+a*o,h=-a*e+s*o;rx=Math.abs(rx);ry=Math.abs(ry);let c=r*r/(rx*rx)+h*h/(ry*ry);if(c>1){rx*=Math.sqrt(c);ry*=Math.sqrt(c)}const l=(rx*rx*ry*ry-rx*rx*h*h-ry*ry*r*r)/(rx*rx*h*h+ry*ry*r*r),d=(fA===fS?-1:1)*Math.sqrt(Math.max(0,l)),M=d*(rx*h/ry),g=d*(-ry*r/rx),x=s*M-a*g+(p1.x+p2.x)/2,y=a*M+s*g+(p1.y+p2.y)/2,I=(t,p)=>{const i=t[0]*p[1]-t[1]*p[0]<0?-1:1;return i*Math.acos((t[0]*p[0]+t[1]*p[1])/(Math.sqrt(t[0]*t[0]+t[1]*t[1])*Math.sqrt(p[0]*p[0]+p[1]*p[1])))},u=I([1,0],[(r-M)/rx,(h-g)/ry]);let m=I([(r-M)/rx,(h-g)/ry],[(-r-M)/rx,(-h-g)/ry]);0===fS&&m>0?m-=2*Math.PI:1===fS&&m<0&&(m+=2*Math.PI);const k=Math.max(8,Math.ceil(Math.abs(m)/(Math.PI/18))),P=[];for(let t=1;t<=k;t++){const i=u+m*t/k,e=s*Math.cos(i),o=a*Math.sin(i);P.push({x:x+rx*e-ry*o,y:y+rx*a*Math.cos(i)+ry*s*Math.sin(i)})}return P} }

    window.SVGParser = SVGParser;

})();