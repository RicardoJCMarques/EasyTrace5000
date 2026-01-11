/**
 * @file        utils/svg-exporter.js
 * @description Logic for exporting canvas contents as optimized SVG
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

(function() {
    'use strict';

    const config = window.PCBCAMConfig;
    const geomConfig = config.geometry;
    const debugConfig = config.debug;

    class SVGExporter {
        constructor(renderer) {
            this.renderer = renderer;
            this.core = renderer.core;
            this.svgNS = 'http://www.w3.org/2000/svg';

            this.options = {
                precision: 3, 
                padding: 5,
                preserveArcs: geomConfig.preserveArcs !== false,
                includeMetadata: true,
                useViewBox: true,
                embedStyles: true
            };
        }

        exportSVG(options = {}) {
            const exportConfig = { ...this.options, ...options };
            const filename = exportConfig.filename || 'pcb-export.svg';

            this.core.calculateOverallBounds();
            const bounds = this.core.bounds;

            if (!bounds || !isFinite(bounds.width)) {
                if (window.pcbcam?.ui) window.pcbcam.ui.updateStatus('No content to export', 'warning');
                return null;
            }

            const svg = this._createSVGRoot(bounds, exportConfig);

            if (exportConfig.includeMetadata) svg.appendChild(this._createExportComment());
            if (exportConfig.embedStyles) svg.appendChild(this._createDefs(exportConfig));

            const mainGroup = this._createMainGroup(exportConfig);
            svg.appendChild(mainGroup);

            return this._serializeAndDownload(svg, filename);
        }

        _createExportComment() {
            const vo = this.core.options;
            return document.createComment(`
EasyTrace5000 | ${new Date().toISOString()}
Mode: ${vo.showWireframe ? 'Wireframe' : 'Solid'} | Geometry: ${vo.fuseGeometry ? 'Fused' : 'Source'}
`);
        }

        _createSVGRoot(bounds, config) {
            const svg = document.createElementNS(this.svgNS, 'svg');
            const p = config.padding;
            const w = bounds.width + p * 2;
            const h = bounds.height + p * 2;
            const fmt = (n) => this._formatNumber(n, config.precision);

            svg.setAttribute('xmlns', this.svgNS);
            svg.setAttribute('width', `${fmt(w)}mm`);
            svg.setAttribute('height', `${fmt(h)}mm`);

            if (config.useViewBox) {
                const viewY = -(bounds.maxY + p);
                svg.setAttribute('viewBox', `${fmt(bounds.minX - p)} ${fmt(viewY)} ${fmt(w)} ${fmt(h)}`);
            }
            return svg;
        }

        _createDefs() {
            const defs = document.createElementNS(this.svgNS, 'defs');
            const style = document.createElementNS(this.svgNS, 'style');

            const src = this.core.colors.source;
            const geo = this.core.colors.geometry;
            const prim = this.core.colors.primitives;
            const isBW = this.core.options.blackAndWhite;

            let css = `.lg { stroke-linecap: round; stroke-linejoin: round; }\n`;

            if (isBW) {
                const w = this.core.colors.bw.white;
                const b = this.core.colors.bw.black;
                css += `svg { background: ${b}; }\n`;
                css += `.fill { fill: ${w}; stroke: none; fill-rule: evenodd; }\n`;
                css += `.str { fill: none; stroke: ${w}; }\n`;
                css += `.mk { stroke: ${w} !important; stroke-width: 0.025; fill: none; }\n`;
            } else {
                // Layer fills
                css += `.iso { fill: ${src.isolation}; }\n`;
                css += `.drl { fill: ${src.drill}; }\n`;
                css += `.clr { fill: ${src.clearing}; }\n`;
                css += `.cut { fill: ${src.cutout}; }\n`;
                css += `.fus { fill: ${src.fused}; fill-rule: evenodd; }\n`;

                // Stroke-only layers
                css += `.trc { fill: none; stroke: ${src.isolation}; }\n`;
                css += `.off-e { fill: none; stroke: ${geo.offset.external}; }\n`;
                css += `.off-i { fill: none; stroke: ${geo.offset.internal}; }\n`;
                css += `.prv { fill: none; stroke: ${geo.preview}; }\n`;

                // Drill source geometry
                css += `.d-hole { fill: none !important; stroke: ${src.drill} !important; stroke-width: 0.05; }\n`;
                css += `.d-slot { fill: none !important; stroke: ${src.drill} !important; stroke-width: 0.05; }\n`;

                // Drill strategy geometry
                css += `.d-mill { fill: none !important; stroke-width: 0.025; }\n`;
                css += `.d-peck { stroke-width: 0.025; }\n`;
                css += `.d-peck-fill { stroke-width: 0.025; }\n`;

                // Center marks
                css += `.mk { fill: none !important; stroke-width: 0.025; }\n`;
                css += `.mk-ok { stroke: ${prim.peckMarkGood} !important; }\n`;
                css += `.mk-warn { stroke: ${prim.peckMarkWarn} !important; }\n`;
                css += `.mk-err { stroke: ${prim.peckMarkError} !important; }\n`;
                css += `.mk-src { stroke: ${src.drill} !important; }\n`;
                css += `.mk-white { stroke: #FFFFFF !important; }\n`;

                // Status colors
                css += `.status-ok { stroke: ${prim.peckMarkGood} !important; }\n`;
                css += `.status-warn { stroke: ${prim.peckMarkWarn} !important; }\n`;
                css += `.status-err { stroke: ${prim.peckMarkError} !important; }\n`;
            }

            style.textContent = css;
            defs.appendChild(style);
            return defs;
        }

        _createMainGroup(config) {
            const mainGroup = document.createElementNS(this.svgNS, 'g');
            mainGroup.setAttribute('id', 'pcb-layers');

            const viewState = this.core.getViewState();
            const fmt = (n) => this._formatNumber(n, config.precision);
            let transform = 'scale(1,-1)';

            if (viewState.rotation !== 0) {
                const c = this.core.rotationCenter;
                transform += ` rotate(${viewState.rotation} ${fmt(c.x)} ${fmt(c.y)})`;
            }

            mainGroup.setAttribute('transform', transform);
            this._exportVisibleLayers(mainGroup, config);
            return mainGroup;
        }

        _exportVisibleLayers(parentGroup, config) {
            const visibleLayers = this.core.getVisibleLayers();
            const order = ['cutout', 'source', 'fused', 'preprocessed', 'clearing', 'isolation', 'drill', 'offset', 'preview'];

            const sortedLayers = Array.from(visibleLayers.entries()).sort((a, b) => {
                const getScore = (l) => {
                    if (l.isPreview) return 100;
                    if (l.isOffset) return 90;
                    if (l.isFused) return 20;
                    return order.indexOf(l.type);
                };
                return getScore(a[1]) - getScore(b[1]);
            });

            for (const [name, layer] of sortedLayers) {
                const layerGroup = document.createElementNS(this.svgNS, 'g');
                layerGroup.setAttribute('id', name);
                layerGroup.classList.add('lg');

                // Check if layer has drill geometry that needs individual styling
                const hasDrillGeometry = layer.primitives?.some(p => {
                    const role = p.properties?.role;
                    return role === 'peck_mark' || role === 'drill_milling_path' || 
                           role === 'drill_hole' || role === 'drill_slot' ||
                           p.properties?.isCenterlinePath;
                });

                // Apply group class (may be skipped for mixed drill layers)
                this._applyGroupClass(layerGroup, layer, hasDrillGeometry);

                // Get tool diameter for this layer
                const groupToolDia = layer.metadata?.toolDiameter;

                // Only set group stroke-width for pure preview layers (no drill geometry)
                if (groupToolDia && (layer.isPreview || layer.type === 'preview') && !hasDrillGeometry) {
                    layerGroup.setAttribute('stroke-width', this._formatNumber(groupToolDia, config.precision));
                }

                const geometryElements = [];
                const decorationElements = [];

                layer.primitives.forEach(primitive => {
                    const el = this._primitiveToSVG(primitive, layer, config, hasDrillGeometry, groupToolDia);
                    if (el) geometryElements.push(el);

                    const marks = this._createDecorations(primitive, layer, config);
                    if (marks.length > 0) decorationElements.push(...marks);
                });

                geometryElements.forEach(el => layerGroup.appendChild(el));
                decorationElements.forEach(el => layerGroup.appendChild(el));

                if (layerGroup.hasChildNodes()) parentGroup.appendChild(layerGroup);
            }
        }

        _applyGroupClass(group, layer, hasDrillGeometry) {
            if (this.core.options.showWireframe) return;

            if (layer.isPreview) {
                // Only apply .prv class if NO drill geometry (pure preview layer)
                // Mixed layers get individual inline styling
                if (!hasDrillGeometry) {
                    group.classList.add('prv');
                }
            } else if (layer.isOffset) {
                if (!hasDrillGeometry) {
                    group.classList.add(layer.offsetType === 'internal' ? 'off-i' : 'off-e');
                }
            } else if (layer.isFused) {
                group.classList.add('fus');
            } else {
                const map = { isolation: 'iso', drill: 'drl', clearing: 'clr', cutout: 'cut' };
                if (map[layer.type]) group.classList.add(map[layer.type]);
            }
        }

        //Main primitive to SVG element converter (handles all geometry types with proper styling)
        _primitiveToSVG(primitive, layer, config, hasDrillGeometry, groupToolDia) {
            const prec = config.precision;
            const props = primitive.properties || {};
            const role = props.role;
            const fmt = (n) => this._formatNumber(n, prec);

            // Drill geometry
            // Peck marks - circle with status-colored fill/stroke
            if (role === 'peck_mark' || props.isToolPeckMark) {
                return this._createPeckMarkCircle(primitive, layer, config);
            }

            // Source drill holes and slots
            if (role === 'drill_hole' || role === 'drill_slot') {
                return this._createSourceDrillElement(primitive, config);
            }

            // Drill milling paths (undersized holes, centerlines)
            if (role === 'drill_milling_path' || props.isCenterlinePath) {
                return this._createDrillMillingElement(primitive, config);
            }

            // Standard geometry
            let el = null;
            switch (primitive.type) {
                case 'circle':
                    el = document.createElementNS(this.svgNS, 'circle');
                    el.setAttribute('cx', fmt(primitive.center.x));
                    el.setAttribute('cy', fmt(primitive.center.y));
                    el.setAttribute('r', fmt(primitive.radius));
                    break;
                case 'rectangle':
                    el = document.createElementNS(this.svgNS, 'rect');
                    el.setAttribute('x', fmt(primitive.position.x));
                    el.setAttribute('y', fmt(primitive.position.y));
                    el.setAttribute('width', fmt(primitive.width));
                    el.setAttribute('height', fmt(primitive.height));
                    break;
                case 'path':
                case 'obround':
                case 'arc':
                    el = document.createElementNS(this.svgNS, 'path');
                    el.setAttribute('d', this._buildPathData(primitive, prec, config));
                    if (primitive.contours?.some(c => c.isHole)) {
                        el.setAttribute('fill-rule', 'evenodd');
                    }
                    break;
                default: 
                    return null;
            }

            if (!el) return null;

            // Apply styling
            if (!this.core.options.showWireframe) {
                const isPreviewLayer = layer.isPreview || layer.type === 'preview';
                const isOffsetLayer = layer.isOffset || layer.type === 'offset';

                // For preview/offset layers with drill geometry, apply inline styles since the group class was skipped
                if (hasDrillGeometry && (isPreviewLayer || isOffsetLayer)) {
                    this._applyInlineStyles(el, primitive, layer, config, groupToolDia);
                } 
                // For standard traces (stroked paths), set stroke-width
                else if ((props.isTrace || props.stroke === true) && !isOffsetLayer && !isPreviewLayer) {
                    el.classList.add('trc');
                    if (props.strokeWidth) {
                        el.setAttribute('stroke-width', fmt(props.strokeWidth));
                    }
                }
                // For preview layers without drill geometry, tool diameter comes from group but individual elements may override
                else if (isPreviewLayer && !hasDrillGeometry) {
                    const objectWidth = props.toolDiameter || props.strokeWidth;
                    if (objectWidth && (!groupToolDia || Math.abs(objectWidth - groupToolDia) > 0.0001)) {
                        el.setAttribute('stroke-width', fmt(objectWidth));
                    }
                }
            }

            return el;
        }

        //Apply inline styles to elements in mixed-geometry layers (layers where group class was skipped due to drill geometry)
        _applyInlineStyles(el, primitive, layer, config, groupToolDia) {
            const fmt = (n) => this._formatNumber(n, config.precision);
            const props = primitive.properties || {};
            const geo = this.core.colors.geometry;

            const isPreviewLayer = layer.isPreview || layer.type === 'preview';
            const isOffsetLayer = layer.isOffset || layer.type === 'offset';

            // Determine stroke color
            let strokeColor;
            if (isPreviewLayer) {
                strokeColor = geo.preview;
            } else if (isOffsetLayer) {
                strokeColor = layer.offsetType === 'internal' ? geo.offset.internal : geo.offset.external;
            }

            if (strokeColor) {
                el.setAttribute('fill', 'none');
                el.setAttribute('stroke', strokeColor);
            }

            // Determine stroke width
            const toolDia = props.toolDiameter || groupToolDia || props.strokeWidth;
            if (toolDia) {
                el.setAttribute('stroke-width', fmt(toolDia));
            }
        }

        // Create peck mark circle with status-colored styling
        _createPeckMarkCircle(primitive, layer, config) {
            const prec = config.precision;
            const props = primitive.properties || {};
            const fmt = (n) => this._formatNumber(n, prec);

            if (!primitive.center || !primitive.radius) return null;

            const toolRelation = props.toolRelation || 'exact';
            const isPreview = layer.isPreview || layer.type === 'preview';
            const color = this._getStatusColor(toolRelation);

            const circle = document.createElementNS(this.svgNS, 'circle');
            circle.setAttribute('cx', fmt(primitive.center.x));
            circle.setAttribute('cy', fmt(primitive.center.y));
            circle.setAttribute('r', fmt(primitive.radius));

            // All styling inline to override any group inheritance
            if (isPreview) {
                // Filled circle for preview mode
                circle.setAttribute('fill', color);
                circle.setAttribute('stroke', color);
                circle.setAttribute('stroke-width', fmt(0.025));
            } else {
                // Stroked outline for offset mode
                circle.setAttribute('fill', 'none');
                circle.setAttribute('stroke', color);
                circle.setAttribute('stroke-width', fmt(0.025));
            }
            
            return circle;
        }

        // Create source drill geometry (holes and slots from drill file)
        _createSourceDrillElement(primitive, config) {
            const prec = config.precision;
            const props = primitive.properties || {};
            const fmt = (n) => this._formatNumber(n, prec);
            const drillColor = this.core.colors.source.drill;

            let el = document.createElementNS(this.svgNS, 'path');

            if (props.role === 'drill_hole') {
                const cx = primitive.center.x;
                const cy = primitive.center.y;
                const r = primitive.radius;
                el.setAttribute('d', `M${fmt(cx + r)} ${fmt(cy)}A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx - r)} ${fmt(cy)}A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx + r)} ${fmt(cy)}`);
            } else if (props.role === 'drill_slot') {
                el.setAttribute('d', this._buildPathData(primitive, prec, config));
            }

            // Inline styling - source drills are always stroked outlines
            el.setAttribute('fill', 'none');
            el.setAttribute('stroke', drillColor);
            el.setAttribute('stroke-width', fmt(0.05));

            return el;
        }

        //Create drill milling path geometry (undersized holes, centerline slots)
        _createDrillMillingElement(primitive, config) {
            const prec = config.precision;
            const props = primitive.properties || {};
            const fmt = (n) => this._formatNumber(n, prec);

            const toolRelation = props.toolRelation || 'exact';
            const color = this._getStatusColor(toolRelation);

            let el = document.createElementNS(this.svgNS, 'path');
            el.setAttribute('d', this._buildPathData(primitive, prec, config));

            // Inline styling
            el.setAttribute('fill', 'none');
            el.setAttribute('stroke', color);
            el.setAttribute('stroke-width', fmt(0.025));
            el.setAttribute('stroke-linecap', 'round');
            el.setAttribute('stroke-linejoin', 'round');
            
            return el;
        }

        // Create decoration elements (crosshairs, center marks)
        _createDecorations(primitive, layer, config) {
            const decos = [];
            const props = primitive.properties || {};
            const role = props.role;
            const prec = config.precision;

            const toolRelation = props.toolRelation || 'exact';
            const isPreview = layer.isPreview || layer.type === 'preview';
            const isSourceDrill = layer.type === 'drill' && !layer.isOffset && !layer.isPreview;

            // Determine crosshair color
            let markColor;
            if (isSourceDrill) {
                markColor = this.core.colors.source.drill;
            } else if (isPreview) {
                markColor = '#FFFFFF';
            } else {
                markColor = this._getStatusColor(toolRelation);
            }

            const baseMarkSize = 0.5;

            // Peck marks - crosshair only (circle created in _primitiveToSVG)
            if (role === 'peck_mark' || props.isToolPeckMark) {
                if (primitive.center) {
                    const markSize = Math.min(baseMarkSize, primitive.radius * 0.4);
                    decos.push(this._createCrosshair(primitive.center, markSize, prec, markColor));
                }
                return decos;
            }

            // Source drill holes
            if (role === 'drill_hole' && primitive.center) {
                const markSize = Math.min(baseMarkSize, primitive.radius * 0.6);
                decos.push(this._createCrosshair(primitive.center, markSize, prec, markColor));
            }

            // Source drill slots
            if (role === 'drill_slot' && props.originalSlot) {
                const markSize = Math.min(baseMarkSize, (props.diameter || 1) * 0.3);
                decos.push(this._createCrosshair(props.originalSlot.start, markSize, prec, markColor));
                decos.push(this._createCrosshair(props.originalSlot.end, markSize, prec, markColor));
            }

            // Milling paths
            if (role === 'drill_milling_path' || props.isCenterlinePath) {
                if (props.originalSlot) {
                    decos.push(this._createCrosshair(props.originalSlot.start, baseMarkSize, prec, markColor));
                    decos.push(this._createCrosshair(props.originalSlot.end, baseMarkSize, prec, markColor));
                } else if (primitive.center) {
                    decos.push(this._createCrosshair(primitive.center, baseMarkSize, prec, markColor));
                } else if (primitive.contours?.[0]?.points?.length > 0) {
                    const pts = primitive.contours[0].points;
                    decos.push(this._createCrosshair(pts[0], baseMarkSize, prec, markColor));
                    decos.push(this._createCrosshair(pts[pts.length - 1], baseMarkSize, prec, markColor));
                }
            }

            return decos;
        }

        //Create a crosshair marker at a point
        _createCrosshair(pt, size, prec, color) {
            const path = document.createElementNS(this.svgNS, 'path');
            const fmt = (n) => this._formatNumber(n, prec);
            const x = pt.x, y = pt.y;

            path.setAttribute('d', `M${fmt(x - size)} ${fmt(y)}L${fmt(x + size)} ${fmt(y)}M${fmt(x)} ${fmt(y - size)}L${fmt(x)} ${fmt(y + size)}`);

            // All inline - no CSS classes
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', color);
            path.setAttribute('stroke-width', fmt(0.025));
            
            return path;
        }

        // Get status color based on tool relation
        _getStatusColor(toolRelation) {
            const prim = this.core.colors.primitives;
            switch (toolRelation) {
                case 'oversized': return prim.peckMarkError;
                case 'undersized': return prim.peckMarkWarn;
                case 'exact':
                default: return prim.peckMarkGood;
            }
        }

        // Path Data Building
        _buildPathData(prim, prec, config) {
            if (prim.type === 'obround' && config.preserveArcs) return this._obroundToD(prim, prec);
            if (prim.type === 'arc' && config.preserveArcs) return this._arcToD(prim, prec);
            if (!prim.contours?.length) return '';

            return prim.contours.map(c => {
                if (config.preserveArcs && c.arcSegments?.length) return this._contourArcsToD(c, prec);
                return this._contourPointsToD(c.points, prec);
            }).join('');
        }

        _contourPointsToD(points, prec) {
            if (!points || points.length < 2) return '';

            // Collinear filter
            const optimized = [points[0]];
            for (let i = 1; i < points.length - 1; i++) {
                const prev = optimized[optimized.length - 1];
                const curr = points[i];
                const next = points[i + 1];
                const val = (curr.y - prev.y) * (next.x - curr.x) - (next.y - curr.y) * (curr.x - prev.x);
                if (Math.abs(val) > 1e-9) optimized.push(curr);
            }
            optimized.push(points[points.length - 1]);

            let cx = optimized[0].x;
            let cy = optimized[0].y;
            let d = `M${this._formatNumber(cx, prec)} ${this._formatNumber(cy, prec)}`;

            for (let i = 1; i < optimized.length; i++) {
                const px = optimized[i].x;
                const py = optimized[i].y;
                const dx = px - cx;
                const dy = py - cy;

                const sDx = this._formatNumber(dx, prec);
                const sDy = this._formatNumber(dy, prec);
                const sep = (sDy.startsWith('-')) ? '' : ' ';
                d += `l${sDx}${sep}${sDy}`;

                cx = px; cy = py;
            }
            return d + 'Z';
        }

        _contourArcsToD(contour, prec) {
            const pts = contour.points;
            const arcs = contour.arcSegments || [];
            if (!pts?.length) return '';

            let cx = pts[0].x;
            let cy = pts[0].y;
            let d = `M${this._formatNumber(cx, prec)} ${this._formatNumber(cy, prec)}`;

            const sortedArcs = [...arcs].sort((a, b) => a.startIndex - b.startIndex);
            let currentIdx = 0;

            const appendRelLine = (tx, ty) => {
                const dx = tx - cx;
                const dy = ty - cy;
                const sDx = this._formatNumber(dx, prec);
                const sDy = this._formatNumber(dy, prec);
                const sep = sDy.startsWith('-') ? '' : ' ';
                d += `l${sDx}${sep}${sDy}`;
                cx = tx; cy = ty;
            };

            for (const arc of sortedArcs) {
                for (let i = currentIdx + 1; i <= arc.startIndex; i++) {
                    appendRelLine(pts[i].x, pts[i].y);
                }

                const end = pts[arc.endIndex];
                let span = arc.sweepAngle;
                if (span === undefined) {
                    span = arc.endAngle - arc.startAngle;
                    if (arc.clockwise && span > 0) span -= 2 * Math.PI;
                    if (!arc.clockwise && span < 0) span += 2 * Math.PI;
                }
                const large = Math.abs(span) > Math.PI ? 1 : 0;
                const sweep = arc.clockwise ? 1 : 0;

                const rx = this._formatNumber(arc.radius, prec);
                const ex = this._formatNumber(end.x, prec);
                const ey = this._formatNumber(end.y, prec);

                d += `A${rx} ${rx} 0 ${large} ${sweep} ${ex} ${ey}`;

                cx = end.x; cy = end.y;
                currentIdx = arc.endIndex;
            }

            const lastArc = sortedArcs[sortedArcs.length - 1];
            if (!(lastArc && lastArc.endIndex === 0 && lastArc.startIndex > 0)) {
                for (let i = currentIdx + 1; i < pts.length; i++) {
                    appendRelLine(pts[i].x, pts[i].y);
                }
            }

            return d + 'Z';
        }

        _arcToD(prim, prec) {
            const fmt = (n) => this._formatNumber(n, prec);
            const sx = prim.center.x + prim.radius * Math.cos(prim.startAngle);
            const sy = prim.center.y + prim.radius * Math.sin(prim.startAngle);
            const ex = prim.center.x + prim.radius * Math.cos(prim.endAngle);
            const ey = prim.center.y + prim.radius * Math.sin(prim.endAngle);
            let span = prim.endAngle - prim.startAngle;
            if (prim.clockwise && span > 0) span -= 2 * Math.PI;
            if (!prim.clockwise && span < 0) span += 2 * Math.PI;
            const large = Math.abs(span) > Math.PI ? 1 : 0;
            const sweep = !prim.clockwise ? 1 : 0;
            return `M${fmt(sx)} ${fmt(sy)}A${fmt(prim.radius)} ${fmt(prim.radius)} 0 ${large} ${sweep} ${fmt(ex)} ${fmt(ey)}`;
        }

        _obroundToD(prim, prec) {
            const fmt = (n) => this._formatNumber(n, prec);
            const r = Math.min(prim.width, prim.height) / 2;
            const { x, y } = prim.position;
            const w = prim.width, h = prim.height;
            if (w > h) return `M${fmt(x+r)} ${fmt(y)}L${fmt(x+w-r)} ${fmt(y)}A${fmt(r)} ${fmt(r)} 0 0 0 ${fmt(x+w-r)} ${fmt(y+h)}L${fmt(x+r)} ${fmt(y+h)}A${fmt(r)} ${fmt(r)} 0 0 0 ${fmt(x+r)} ${fmt(y)}Z`;
            else return `M${fmt(x+w)} ${fmt(y+r)}L${fmt(x+w)} ${fmt(y+h-r)}A${fmt(r)} ${fmt(r)} 0 0 0 ${fmt(x)} ${fmt(y+h-r)}L${fmt(x)} ${fmt(y+r)}A${fmt(r)} ${fmt(r)} 0 0 0 ${fmt(x+w)} ${fmt(y+r)}Z`;
        }

        // Utilities

        _serializeAndDownload(svg, filename) {
            const serializer = new XMLSerializer();
            const svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' + serializer.serializeToString(svg);
            this.downloadSVG(svgString, filename);
            return svgString;
        }

        _formatNumber(value, precision) {
            const s = parseFloat(value.toFixed(precision)).toString();
            return s.startsWith('0.') ? s.substring(1) : (s.startsWith('-0.') ? '-' + s.substring(2) : s);
        }

        downloadSVG(svgString, filename) {
            const blob = new Blob([svgString], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 100);
        }

        debug(message) {
            if (debugConfig.enabled) console.log(`[SVGExporter] ${message}`);
        }
    }

    window.SVGExporter = SVGExporter;
})();