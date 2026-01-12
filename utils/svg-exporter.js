/**
 * @file        utils/svg-exporter.js
 * @description Logic for exporting canvas contents as optimized SVG
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

        // Color System
        /**
         * Get all drill-related colors with fallbacks
         */
        _getColors() {
            const src = this.core.colors?.source || {};
            const geo = this.core.colors?.geometry || {};
            const prim = this.core.colors?.primitives || {};

            // Helper to strip 8-digit hex to 6-digit (remove alpha)
            const stripAlpha = (color) => {
                if (!color) return null;
                // Match #RRGGBBAA format
                if (/^#[0-9a-fA-F]{8}$/.test(color)) {
                    return color.slice(0, 7);
                }
                return color;
            };

            return {
                // Source geometry
                drillSource: stripAlpha(src.drill) || '#4488ff',

                // Preview/offset strokes
                preview: stripAlpha(geo.preview) || '#0060dd',
                offsetExternal: stripAlpha(geo.offset?.external) || '#a60000',
                offsetInternal: stripAlpha(geo.offset?.internal) || '#00a600',

                // Status colors (tool fit)
                statusGood: stripAlpha(prim.peckMarkGood) || '#22c55e',
                statusWarn: stripAlpha(prim.peckMarkWarn) || '#f59e0b',
                statusError: stripAlpha(prim.peckMarkError) || '#ef4444',

                // Fixed
                white: '#FFFFFF'
            };
        }

        /**
         * Get status color based on tool relation
         */
        _getStatusColor(toolRelation) {
            const colors = this._getColors();
            switch (toolRelation) {
                case 'oversized': return colors.statusError;
                case 'undersized': return colors.statusWarn;
                default: return colors.statusGood;
            }
        }

        /**
         * Determine geometry and mark colors for drill-related primitives
         */
        _getDrillElementColors(primitive, layer) {
            const props = primitive.properties || {};
            const toolRelation = props.toolRelation || 'exact';
            const colors = this._getColors();

            const isPreview = layer.isPreview || layer.type === 'preview';
            const isOffset = layer.isOffset || layer.type === 'offset';
            const isSourceDrill = layer.type === 'drill' && !isOffset && !isPreview;

            const isPeck = props.role === 'peck_mark' || props.isToolPeckMark;
            const statusColor = this._getStatusColor(toolRelation);

            let geometryColor, geometryFill, markColor;

            if (isSourceDrill) {
                // Blue source outlines
                geometryColor = colors.drillSource;
                geometryFill = 'none';
                markColor = colors.drillSource;
            } 
            else if (isPreview) {
                if (isPeck) {
                    // Preview Pecks: Filled circle + White Crosshair
                    geometryColor = statusColor;
                    geometryFill = statusColor;
                    markColor = colors.white;
                } else {
                    // Preview Mills: Outline (wall) + White/Warn Crosshair
                    geometryColor = colors.preview;
                    geometryFill = 'none';
                    markColor = toolRelation === 'undersized' ? colors.statusWarn : colors.white;
                }
            } 
            else if (isOffset) {
                // Offset mode: All Outlines
                geometryColor = statusColor;
                geometryFill = 'none'; 
                markColor = statusColor;
            } 
            else {
                // Fallback
                geometryColor = statusColor;
                geometryFill = 'none';
                markColor = statusColor;
            }

            return { geometryColor, geometryFill, markColor };
        }

        // Main Export
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
            if (exportConfig.embedStyles) svg.appendChild(this._createDefs());

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
            const colors = this._getColors();

            const src = this.core.colors?.source || {};
            const isBW = this.core.options.blackAndWhite;

            let css = `.lg { stroke-linecap: round; stroke-linejoin: round; }\n`;

            if (isBW) {
                const w = this.core.colors?.bw?.white || '#ffffff';
                const b = this.core.colors?.bw?.black || '#000000';
                css += `svg { background: ${b}; }\n`;
                css += `.fill { fill: ${w}; stroke: none; fill-rule: evenodd; }\n`;
                css += `.str { fill: none; stroke: ${w}; }\n`;
            } else {
                // Source layer fills
                css += `.iso { fill: ${src.isolation || '#ff8844'}; }\n`;
                css += `.drl { fill: ${src.drill || '#4488ff'}; }\n`;
                css += `.clr { fill: ${src.clearing || '#44ff88'}; }\n`;
                css += `.cut { fill: ${src.cutout || '#333333'}; }\n`;
                css += `.fus { fill: ${src.fused || '#ff8844'}; fill-rule: evenodd; }\n`;

                // Stroke-only layers
                css += `.trc { fill: none; stroke: ${src.isolation || '#ff8844'}; }\n`;
                css += `.off-e { fill: none; stroke: ${colors.offsetExternal}; }\n`;
                css += `.off-i { fill: none; stroke: ${colors.offsetInternal}; }\n`;
                css += `.prv { fill: none; stroke: ${colors.preview}; }\n`;
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

        // Layer Export
        _exportVisibleLayers(parentGroup, config) {
            const visibleLayers = this.core.getVisibleLayers();
            const order = ['cutout', 'source', 'fused', 'preprocessed', 'clearing', 'isolation', 'drill', 'offset', 'preview'];

            const sortedLayers = Array.from(visibleLayers.entries())
                .filter(([name, layer]) => this._shouldExportLayer(layer))
                .sort((a, b) => {
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

                this._applyGroupClass(layerGroup, layer);

                // Export each primitive via dispatcher
                layer.primitives.forEach(primitive => {
                    const el = this._primitiveToSVG(primitive, layer, config);
                    if (el) layerGroup.appendChild(el);
                });

                if (layerGroup.hasChildNodes()) parentGroup.appendChild(layerGroup);
            }
        }

        // Visibility helper
        _shouldExportLayer(layer) {
            const opts = this.core.options;
            
            if (layer.type === 'offset' && !opts.showOffsets) return false;
            if (layer.type === 'preview' && !opts.showPreviews) return false;
            if (layer.type === 'drill' && !opts.showDrills) return false;
            if (layer.type === 'cutout' && !opts.showCutouts) return false;
            
            return layer.visible;
        }

        // Group styling
        _applyGroupClass(group, layer) {
            if (this.core.options.showWireframe) return;

            const isDrillOperation = layer.operationType === 'drill' || layer.type === 'drill';

            if (layer.isPreview) {
                group.classList.add('prv');
            } else if (layer.isOffset) {
                // Drill offsets use inline styles, skip class
                if (isDrillOperation) return;
                group.classList.add(layer.offsetType === 'internal' ? 'off-i' : 'off-e');
            } else if (layer.isFused) {
                group.classList.add('fus');
            } else {
                const map = { isolation: 'iso', drill: 'drl', clearing: 'clr', cutout: 'cut' };
                if (map[layer.type]) group.classList.add(map[layer.type]);
            }
        }

        // Primitive Rendering
        _primitiveToSVG(primitive, layer, config) {
            const props = primitive.properties || {};
            const role = props.role;

            // Dispatch by role (mirrors renderer logic)
            if (role === 'peck_mark' || props.isToolPeckMark) {
                return this._exportPeckMark(primitive, layer, config);
            }

            if (role === 'drill_hole') {
                return this._exportSourceDrillHole(primitive, layer, config);
            }

            if (role === 'drill_slot') {
                return this._exportSourceDrillSlot(primitive, layer, config);
            }

            if (role === 'drill_milling_path' || props.isCenterlinePath) {
                return this._exportMillingPath(primitive, layer, config);
            }

            // Standard geometry fallback
            return this._exportStandardGeometry(primitive, layer, config);
        }

        // Peck Mark Handler
        _exportPeckMark(primitive, layer, config) {
            const prec = config.precision;
            const fmt = (n) => this._formatNumber(n, prec);
            const props = primitive.properties || {};

            const { geometryColor, geometryFill, markColor } = this._getDrillElementColors(primitive, layer);

            const isPreview = layer.isPreview || layer.type === 'preview';

            const group = document.createElementNS(this.svgNS, 'g');

            // Main Circle
            const circle = document.createElementNS(this.svgNS, 'circle');
            circle.setAttribute('cx', fmt(primitive.center.x));
            circle.setAttribute('cy', fmt(primitive.center.y));
            circle.setAttribute('r', fmt(primitive.radius));
            circle.setAttribute('fill', geometryFill);
            circle.setAttribute('stroke', geometryColor);

            // Scale stroke relative to geometry size for visibility
            const baseStroke = isPreview ? 0.025 : Math.max(0.05, primitive.radius * 0.08);
            circle.setAttribute('stroke-width', fmt(baseStroke));
            group.appendChild(circle);

            // Crosshair - scale to geometry
            const markSize = Math.min(0.5, primitive.radius * 0.4);
            group.appendChild(this._createCrosshair(primitive.center, markSize, prec, markColor));

            // Reduced Plunge Ring (dashed)
            if (props.reducedPlunge) {
                const ring = document.createElementNS(this.svgNS, 'circle');
                ring.setAttribute('cx', fmt(primitive.center.x));
                ring.setAttribute('cy', fmt(primitive.center.y));
                ring.setAttribute('r', fmt(primitive.radius * 0.8));
                ring.setAttribute('fill', 'none');
                ring.setAttribute('stroke', this._getColors().statusWarn);
                ring.setAttribute('stroke-width', fmt(baseStroke * 0.5));
                ring.setAttribute('stroke-dasharray', `${fmt(0.1)} ${fmt(0.1)}`);
                group.appendChild(ring);
            }

            return group;
        }

        // Source Drill Hole Handler
        _exportSourceDrillHole(primitive, layer, config) {
            const prec = config.precision;
            const fmt = (n) => this._formatNumber(n, prec);
            const colors = this._getColors();

            const group = document.createElementNS(this.svgNS, 'g');

            // Main circle
            const circle = document.createElementNS(this.svgNS, 'circle');
            circle.setAttribute('cx', fmt(primitive.center.x));
            circle.setAttribute('cy', fmt(primitive.center.y));
            circle.setAttribute('r', fmt(primitive.radius));
            circle.setAttribute('fill', 'none');
            circle.setAttribute('stroke', colors.drillSource);
            circle.setAttribute('stroke-width', fmt(0.05));
            group.appendChild(circle);

            // Crosshair
            const markSize = Math.min(0.5, primitive.radius * 0.6);
            group.appendChild(this._createCrosshair(primitive.center, markSize, prec, colors.drillSource));

            return group;
        }

        // Source Drill Slot Handler
        _exportSourceDrillSlot(primitive, layer, config) {
            const prec = config.precision;
            const fmt = (n) => this._formatNumber(n, prec);
            const props = primitive.properties || {};
            const colors = this._getColors();
            const slot = props.originalSlot;

            if (!slot) return null;

            const group = document.createElementNS(this.svgNS, 'g');
            const radius = props.diameter / 2;

            // Build slot perimeter path
            const dx = slot.end.x - slot.start.x;
            const dy = slot.end.y - slot.start.y;
            const angle = Math.atan2(dy, dx);

            // Perpendicular offsets
            const px = radius * Math.cos(angle + Math.PI / 2);
            const py = radius * Math.sin(angle + Math.PI / 2);

            // Use large=0, sweep=1 to match working _obroundToD logic
            const d = [
                `M${fmt(slot.start.x + px)} ${fmt(slot.start.y + py)}`,
                `A${fmt(radius)} ${fmt(radius)} 0 0 1 ${fmt(slot.start.x - px)} ${fmt(slot.start.y - py)}`,
                `L${fmt(slot.end.x - px)} ${fmt(slot.end.y - py)}`,
                `A${fmt(radius)} ${fmt(radius)} 0 0 1 ${fmt(slot.end.x + px)} ${fmt(slot.end.y + py)}`,
                'Z'
            ].join(' ');

            const path = document.createElementNS(this.svgNS, 'path');
            path.setAttribute('d', d);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', colors.drillSource);
            path.setAttribute('stroke-width', fmt(0.05));
            group.appendChild(path);

            // Crosshairs at endpoints
            const markSize = Math.min(0.5, radius * 0.6);
            group.appendChild(this._createCrosshair(slot.start, markSize, prec, colors.drillSource));
            group.appendChild(this._createCrosshair(slot.end, markSize, prec, colors.drillSource));

            return group;
        }

        // Milling Path Handler
        _exportMillingPath(primitive, layer, config) {
            const prec = config.precision;
            const fmt = (n) => this._formatNumber(n, prec);
            const props = primitive.properties || {};

            // Get Unified Colors
            const { geometryColor, geometryFill, markColor } = this._getDrillElementColors(primitive, layer);

            // State Flags
            const isPreview = layer.isPreview || layer.type === 'preview';
            const isCenterline = props.isCenterlinePath;

            const group = document.createElementNS(this.svgNS, 'g');
            let mainEl = null;

            // Generate the Main Geometry
            // Handle specific primitives that might be "milling paths"
            if (primitive.type === 'circle') {
                mainEl = document.createElementNS(this.svgNS, 'circle');
                mainEl.setAttribute('cx', fmt(primitive.center.x));
                mainEl.setAttribute('cy', fmt(primitive.center.y));
                mainEl.setAttribute('r', fmt(primitive.radius));

            } else if (primitive.type === 'obround') {
                mainEl = document.createElementNS(this.svgNS, 'path');
                mainEl.setAttribute('d', this._obroundToD(primitive, prec));

            } else if (isCenterline && primitive.contours?.[0]?.points?.length >= 2) {
                // Special case: Centerline slot body
                const pts = primitive.contours[0].points;
                const p1 = pts[0];
                const p2 = pts[pts.length - 1];
                const toolDia = props.toolDiameter || layer.metadata?.toolDiameter || 0.5;
                const radius = toolDia / 2;

                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const angle = Math.atan2(dy, dx);
                const px = radius * Math.cos(angle + Math.PI / 2);
                const py = radius * Math.sin(angle + Math.PI / 2);

                // sweep=1 for Y-flipped coords
                const d = [
                    `M${fmt(p1.x + px)} ${fmt(p1.y + py)}`,
                    `A${fmt(radius)} ${fmt(radius)} 0 0 1 ${fmt(p1.x - px)} ${fmt(p1.y - py)}`,
                    `L${fmt(p2.x - px)} ${fmt(p2.y - py)}`,
                    `A${fmt(radius)} ${fmt(radius)} 0 0 1 ${fmt(p2.x + px)} ${fmt(p2.y + py)}`,
                    'Z'
                ].join(' ');

                mainEl = document.createElementNS(this.svgNS, 'path');
                mainEl.setAttribute('d', d);

                // White centerline visual
                const line = document.createElementNS(this.svgNS, 'line');
                line.setAttribute('x1', fmt(p1.x));
                line.setAttribute('y1', fmt(p1.y));
                line.setAttribute('x2', fmt(p2.x));
                line.setAttribute('y2', fmt(p2.y));
                line.setAttribute('stroke', '#FFFFFF');
                line.setAttribute('stroke-width', fmt(0.025));
                group.appendChild(line);

            } else {
                // Fallback for complex paths
                const pathData = this._buildPathData(primitive, prec, config);
                if (pathData) {
                    mainEl = document.createElementNS(this.svgNS, 'path');
                    mainEl.setAttribute('d', pathData);
                }
            }

            if (!mainEl) return null; // Safety check

            // Apply Styling
            if (isPreview) {
                // In preview, milling paths should show the tool width or fill
                if (isCenterline) {
                    // Centerline slots are filled solid
                    mainEl.setAttribute('fill', geometryColor);
                    mainEl.setAttribute('stroke', 'none');
                } else {
                    // Regular milling paths (boring holes) are outlines of the hole wall
                    // The tool width is the stroke width
                    const toolDia = props.toolDiameter || layer.metadata?.toolDiameter || 0.1;
                    mainEl.setAttribute('fill', 'none');
                    mainEl.setAttribute('stroke', geometryColor);
                    mainEl.setAttribute('stroke-width', fmt(toolDia));
                    mainEl.setAttribute('stroke-linecap', 'round');
                    mainEl.setAttribute('stroke-linejoin', 'round');
                }
            } else {
                // Offset/Source mode: Hairline outline
                mainEl.setAttribute('fill', 'none');
                mainEl.setAttribute('stroke', geometryColor);
                mainEl.setAttribute('stroke-width', fmt(0.025));
            }

            group.appendChild(mainEl);

            // Add center marks
            if (props.originalSlot) {
                group.appendChild(this._createCrosshair(props.originalSlot.start, 0.5, prec, markColor));
                group.appendChild(this._createCrosshair(props.originalSlot.end, 0.5, prec, markColor));
            } else if (primitive.center) {
                group.appendChild(this._createCrosshair(primitive.center, 0.5, prec, markColor));
            } else if (isCenterline) {
                // Fallback for centerline path endpoints
                const pts = primitive.contours[0].points;
                group.appendChild(this._createCrosshair(pts[0], 0.5, prec, markColor));
                group.appendChild(this._createCrosshair(pts[pts.length-1], 0.5, prec, markColor));
            }

            return group;
        }

        // Standard Geometry Handler
        _exportStandardGeometry(primitive, layer, config) {
            const prec = config.precision;
            const fmt = (n) => this._formatNumber(n, prec);
            const props = primitive.properties || {};

            let el = null;

            // Generate Element based on type
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

                case 'obround':
                    el = document.createElementNS(this.svgNS, 'path');
                    el.setAttribute('d', this._obroundToD(primitive, prec));
                    break;

                case 'path':
                case 'arc':
                case 'bezier': 
                    el = document.createElementNS(this.svgNS, 'path');
                    const pathData = this._buildPathData(primitive, prec, config);
                    if (!pathData) return null;
                    el.setAttribute('d', pathData);
                    if (primitive.contours?.some(c => c.isHole)) {
                        el.setAttribute('fill-rule', 'evenodd');
                    }
                    break;

                default:
                    return null;
            }

            // Apply Layer-Context Styling
            const isPreview = layer.isPreview || layer.type === 'preview';
            const isOffset = layer.isOffset || layer.type === 'offset';
            const isTrace = (props.isTrace || props.stroke) && !props.fill;

            if (isPreview) {
                const toolDia = props.toolDiameter || layer.metadata?.toolDiameter || 0.1;
                el.setAttribute('fill', 'none');
                el.setAttribute('stroke', this._getColors().preview);
                el.setAttribute('stroke-width', fmt(toolDia));
                el.setAttribute('stroke-linecap', 'round');
                el.setAttribute('stroke-linejoin', 'round');

            } else if (isOffset) {
                const offsetColor = layer.offsetType === 'internal' 
                    ? this._getColors().offsetInternal 
                    : this._getColors().offsetExternal;
                el.setAttribute('fill', 'none');
                el.setAttribute('stroke', offsetColor);
                el.setAttribute('stroke-width', fmt(0.025));
                el.setAttribute('stroke-linejoin', 'round');

            } else if (isTrace) {
                // Source traces - use CSS class for color, inline for width
                el.classList.add('trc');
                if (props.strokeWidth) {
                    el.setAttribute('stroke-width', fmt(props.strokeWidth));
                }

            } else if (props.fill === false) {
                el.setAttribute('fill', 'none');
            }
            // Else: filled geometry uses CSS class from parent group

            return el;
        }

        // Helper to separate creation from styling
        _styleStandardElement(el, primitive, layer, config) {
            const fmt = (n) => this._formatNumber(n, config.precision);
            const props = primitive.properties || {};
            const colors = this._getColors();

            if (layer.isPreview || layer.type === 'preview') {
                // Preview Mode: Use tool diameter width
                const toolDia = props.toolDiameter || layer.metadata?.toolDiameter || 0.1;

                el.setAttribute('fill', 'none');
                el.setAttribute('stroke', colors.preview);
                el.setAttribute('stroke-width', fmt(toolDia));
                el.setAttribute('stroke-linecap', 'round');
                el.setAttribute('stroke-linejoin', 'round');

            } else if (layer.isOffset || layer.type === 'offset') {
                // Offset Mode: Thin lines
                const offsetColor = layer.offsetType === 'internal' 
                    ? colors.offsetInternal 
                    : colors.offsetExternal;

                el.setAttribute('fill', 'none');
                el.setAttribute('stroke', offsetColor);
                el.setAttribute('stroke-width', fmt(0.025)); // Hairline
                el.setAttribute('stroke-linejoin', 'round');
                
            } else {
                // Source Mode
                // Traces/Strokes
                if ((props.isTrace || props.stroke) && !props.fill) {
                    el.setAttribute('fill', 'none');
                    // If the element has a class (from layer group), stroke color comes from CSS.
                    // Must set width if defined.
                    if (props.strokeWidth) {
                        el.setAttribute('stroke-width', fmt(props.strokeWidth));
                    }
                    // If it's a generic stroke without width, default to 0
                } 
                // Regions/Fills - handled by CSS classes on the parent Group usually, but if specific properties override, handle here:
                else if (props.fill === false) {
                    el.setAttribute('fill', 'none');
                }
            }

            return el;
        }

        // Decorations (Crosshairs)
        _createCrosshair(pt, size, prec, color) {
            const path = document.createElementNS(this.svgNS, 'path');
            const fmt = (n) => this._formatNumber(n, prec);

            path.setAttribute('d', `M${fmt(pt.x - size)} ${fmt(pt.y)}L${fmt(pt.x + size)} ${fmt(pt.y)}M${fmt(pt.x)} ${fmt(pt.y - size)}L${fmt(pt.x)} ${fmt(pt.y + size)}`);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', color);
            path.setAttribute('stroke-width', fmt(0.025));

            return path;
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
                const sDx = this._formatNumber(px - cx, prec);
                const sDy = this._formatNumber(py - cy, prec);
                d += `l${sDx}${sDy.startsWith('-') ? '' : ' '}${sDy}`;
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

                // Use pre-computed sweepAngle if available (stitched paths), otherwise calculate from angles (regular geometry)
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

                cx = end.x; 
                cy = end.y;
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
            const f = (n) => this._formatNumber(n, prec);
            const sx = prim.center.x + prim.radius * Math.cos(prim.startAngle);
            const sy = prim.center.y + prim.radius * Math.sin(prim.startAngle);
            const ex = prim.center.x + prim.radius * Math.cos(prim.endAngle);
            const ey = prim.center.y + prim.radius * Math.sin(prim.endAngle);
            let span = prim.endAngle - prim.startAngle;

            if (prim.clockwise && span > 0) span -= 2 * Math.PI;
            if (!prim.clockwise && span < 0) span += 2 * Math.PI;

            const large = Math.abs(span) > Math.PI ? 1 : 0;
            const sweep = prim.clockwise ? 1 : 0;

            return `M${f(sx)} ${f(sy)} A${f(prim.radius)} ${f(prim.radius)} 0 ${large} ${sweep} ${f(ex)} ${f(ey)}`;
        }

        _obroundToD(prim, prec) {
            const fmt = (n) => this._formatNumber(n, prec);
            const { x, y } = prim.position;
            const w = prim.width;
            const h = prim.height;
            const r = Math.min(w, h) / 2;

            // In Y-flipped coords, sweep=1 for visually correct semicircles
            if (w > h) {
                // Horizontal obround
                return `M${fmt(x + r)} ${fmt(y)}` +
                    `L${fmt(x + w - r)} ${fmt(y)}` +
                    `A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x + w - r)} ${fmt(y + h)}` +
                    `L${fmt(x + r)} ${fmt(y + h)}` +
                    `A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x + r)} ${fmt(y)}Z`;
            } else {
                // Vertical obround
                return `M${fmt(x + w)} ${fmt(y + r)}` +
                    `L${fmt(x + w)} ${fmt(y + h - r)}` +
                    `A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x)} ${fmt(y + h - r)}` +
                    `L${fmt(x)} ${fmt(y + r)}` +
                    `A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x + w)} ${fmt(y + r)}Z`;
            }
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