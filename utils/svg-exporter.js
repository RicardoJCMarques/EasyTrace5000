/**
 * @file        utils/svg-exporter.js
 * @description Logic for exporting the current canvas contents as an SVG
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
    const debugConfig = config.debug;

    class SVGExporter {
        constructor(renderer) {
            this.renderer = renderer;
            this.core = renderer.core;
            this.svgNS = 'http://www.w3.org/2000/svg';

            this.options = {
                precision: config.gcode.precision.coordinates,
                padding: 5,
                preserveArcs: geomConfig.preserveArcs !== false,
                includeMetadata: true,
                useViewBox: true,
                embedStyles: true
            };
        }

        /**
         * Creates a comment node with metadata about the export state.
         * @returns {Comment} An SVG comment node.
         */
        _createExportComment() {
            const viewOptions = this.core.options;
            let geoState;

            if (viewOptions.fuseGeometry) {
                if (viewOptions.showPreprocessed) {
                    geoState = 'Preprocessed (Dark/Clear Polygons)';
                } else {
                    geoState = `Fused (Arc Reconstruction: ${viewOptions.enableArcReconstruction ? 'ON' : 'OFF'})`;
                }
            } else {
                geoState = 'Source Geometry';
            }

            const content = `
EasyTrace5000 SVG Export
Timestamp: ${new Date().toISOString()}
=================================================================
View State:
    - Mode: ${viewOptions.showWireframe ? 'Wireframe' : 'Solid Fill'}
    - Geometry: ${geoState}
=================================================================
Exported from the current canvas view.
`;
            return document.createComment(content);
        }

        /**
         * Main entry point. Exports the current canvas view to an SVG file.
         * @param {object} options - Optional overrides for export settings.
         */
        exportSVG(options = {}) {
            const exportConfig = { ...this.options, ...options };
            const filename = exportConfig.filename || 'pcb-export.svg';

            this.debug(`Exporting current canvas view to SVG: ${filename}`);

            // Calculate bounds from all visible layers
            this.core.calculateOverallBounds();
            const bounds = this.core.bounds;

            if (!bounds || !isFinite(bounds.width) || !isFinite(bounds.height)) {
                console.warn('[SVGExporter] No visible content to export.');
                if (window.pcbcam && window.pcbcam.ui) {
                    window.pcbcam.ui.updateStatus('No content to export', 'warning');
                }
                return null;
            }

            // Create root <svg> element
            const svg = this._createSVGRoot(bounds, exportConfig);

            // Add metadata
            if (exportConfig.includeMetadata) {
                svg.appendChild(this._createExportComment());
            }

            // Create <defs> with <style>
            if (exportConfig.embedStyles) {
                svg.appendChild(this._createDefs(exportConfig));
            }

            // Create main <g> with transforms
            const mainGroup = this._createMainGroup(exportConfig);
            svg.appendChild(mainGroup);

            // Serialize and download
            return this._serializeAndDownload(svg, filename, exportConfig);
        }

        /**
         * Creates the root <svg> element with viewBox.
         * @param {object} bounds - The calculated bounds of the content.
         * @param {object} config - The export configuration.
         * @returns {SVGElement} The configured <svg> root element.
         */
        _createSVGRoot(bounds, config) {
            const svg = document.createElementNS(this.svgNS, 'svg');

            const width = bounds.width + config.padding * 2;
            const height = bounds.height + config.padding * 2;

            svg.setAttribute('xmlns', this.svgNS);
            svg.setAttribute('width', `${width.toFixed(config.precision)}mm`);
            svg.setAttribute('height', `${height.toFixed(config.precision)}mm`);

            if (config.useViewBox) {
                // ViewBox Y is inverted due to scale(1, -1) transform
                const viewY = -(bounds.maxY + config.padding);
                svg.setAttribute('viewBox', 
                    `${this._formatNumber(bounds.minX - config.padding, config.precision)} ` +
                    `${this._formatNumber(viewY, config.precision)} ` +
                    `${this._formatNumber(width, config.precision)} ` +
                    `${this._formatNumber(height, config.precision)}`
                );
            }

            return svg;
        }

        /**
         * Creates the <defs> block with a <style> tag.
         * @returns {SVGElement} The <defs> element.
         */
        _createDefs() {
            const defs = document.createElementNS(this.svgNS, 'defs');
            const style = document.createElementNS(this.svgNS, 'style');
            style.setAttribute('type', 'text/css');

            const colors = this.core.colors.operations;
            const canvasColors = this.core.colors.canvas;
            const debugColors = this.core.colors.debug;
            const geometryColors = this.core.colors.geometry;

            const isWireframe = this.core.options.showWireframe;
            const wireframeColor = debugColors?.wireframe || '#00ff00';
            const isBlackAndWhite = this.core.options.blackAndWhite;

            this.debug(`Generating styles. isWireframe = ${isWireframe}`);

            const wireframeStroke = `fill: none; stroke: ${wireframeColor}; stroke-width: 0.025;`;
            const roundCaps = 'stroke-linecap: round; stroke-linejoin: round;';

            let css = '';

            if (isBlackAndWhite) {
                const white = this.core.colors.bw.white;
                const black = this.core.colors.bw.black;
                css = `
                    svg { background: ${black}; }
                    .pcb-source-isolation,
                    .pcb-source-drill,
                    .pcb-source-clearing,
                    .pcb-fused,
                    .pcb-preprocessed-dark { fill: ${white}; stroke: none; }
                    .pcb-fused { fill-rule: evenodd; }
                    .pcb-source-cutout { fill: none; stroke: ${white}; stroke-width: 0.1; }
                    .pcb-preprocessed-clear { fill: ${black}; stroke: none; }
                    .pcb-offset-external,
                    .pcb-offset-internal,
                    .pcb-offset-on { fill: none; stroke: ${white}; ${roundCaps} }
                    .pcb-preview { fill: none; stroke: ${white}; ${roundCaps} }
                `;
            } else if (isWireframe) {
                css = `
                    .pcb-source-isolation,
                    .pcb-source-drill,
                    .pcb-source-clearing,
                    .pcb-source-cutout,
                    .pcb-fused,
                    .pcb-preprocessed-dark,
                    .pcb-preprocessed-clear,
                    .pcb-offset-external,
                    .pcb-offset-internal,
                    .pcb-offset-on,
                    .pcb-preview,
                    .pcb-trace { ${wireframeStroke} }
                    .pcb-fused { fill-rule: evenodd; }
                `;
            } else {
                const bgColor = canvasColors.background;
                const offsetColors = geometryColors.offset;
                const previewColor = geometryColors.preview;

                css = `
                    .pcb-source-isolation { fill: ${colors.isolation}; stroke: none; }
                    .pcb-source-drill { fill: ${colors.drill}; stroke: none; }
                    .pcb-source-clearing { fill: ${colors.clearing}; stroke: none; }
                    .pcb-source-cutout { fill: ${colors.cutout}; stroke: none; }
                    .pcb-fused { fill: ${colors.fused || colors.isolation}; stroke: none; fill-rule: evenodd; }
                    .pcb-preprocessed-dark { fill: ${colors.isolation}; stroke: none; }
                    .pcb-preprocessed-clear { fill: ${bgColor}; stroke: none; }
                    .pcb-trace { fill: none; stroke: ${colors.isolation}; ${roundCaps} }
                    .pcb-offset-external { fill: none; stroke: ${offsetColors.external}; ${roundCaps} }
                    .pcb-offset-internal { fill: none; stroke: ${offsetColors.internal}; ${roundCaps} }
                    .pcb-offset-on { fill: none; stroke: ${offsetColors.on}; ${roundCaps} }
                    .pcb-preview { fill: none; stroke: ${previewColor}; ${roundCaps} }
                    .pcb-peck-mark { fill: none; stroke: ${this.core.colors.primitives.peckMarkGood}; }
                    .pcb-drill-hole { fill: none; stroke: ${colors.drill}; }
                    .pcb-drill-slot { fill: none; stroke: ${colors.drill}; }
                    .pcb-drill-milling { fill: none; stroke: ${this.core.colors.primitives.peckMarkWarn}; ${roundCaps} }
                    .pcb-peck-good { fill: ${this.core.colors.primitives.peckMarkGood}; stroke: ${this.core.colors.primitives.peckMarkGood}; }
                    .pcb-peck-warn { fill: ${this.core.colors.primitives.peckMarkWarn}; stroke: ${this.core.colors.primitives.peckMarkWarn}; }
                    .pcb-peck-error { fill: ${this.core.colors.primitives.peckMarkError}; stroke: ${this.core.colors.primitives.peckMarkError}; }
                `;
            }

            style.textContent = css;
            defs.appendChild(style);
            return defs;
        }

        /**
         * Creates the main <g> element with Y-flip and rotation transforms.
         * @param {object} config - The export configuration.
         * @returns {SVGElement} The main <g> element, ready for layers.
         */
        _createMainGroup(config) {
            const mainGroup = document.createElementNS(this.svgNS, 'g');
            mainGroup.setAttribute('id', 'pcb-layers');

            const viewState = this.core.getViewState();
            let transform = 'scale(1,-1)';

            if (viewState.rotation !== 0) {
                const center = this.core.rotationCenter;
                // Note: SVG rotation is clockwise, but Y-flip inverts it. Apply the same rotation angle as the canvas.
                transform += ` rotate(${viewState.rotation} ${this._formatNumber(center.x, config.precision)} ${this._formatNumber(center.y, config.precision)})`;
            }

            mainGroup.setAttribute('transform', transform);

            // Delegate to populate this group
            this._exportVisibleLayers(mainGroup, config);

            return mainGroup;
        }

        /**
         * Iterates visible layers in proper z-order and populates the main group.
         */
        _exportVisibleLayers(parentGroup, config) {
            const visibleLayers = this.core.getVisibleLayers();
            const isWireframe = this.core.options.showWireframe;

            // Define z-order: bottom to top
            const layerOrder = [
                'cutout',       // Board outline at bottom
                'source',       // Source geometry
                'fused',        // Fused geometry
                'preprocessed', // Preprocessed
                'clearing',     // Clearing operations
                'isolation',    // Isolation routing
                'drill',        // Drill holes
                'offset',       // Offset paths
                'preview',      // Tool previews on top
            ];

            // Sort layers by z-order
            const sortedLayers = Array.from(visibleLayers.entries()).sort((a, b) => {
                const layerA = a[1];
                const layerB = b[1];
                
                const getOrder = (layer) => {
                    if (layer.isPreview) return layerOrder.indexOf('preview');
                    if (layer.isOffset) return layerOrder.indexOf('offset');
                    if (layer.isFused) return layerOrder.indexOf('fused');
                    if (layer.isPreprocessed) return layerOrder.indexOf('preprocessed');
                    if (layer.type === 'cutout') return layerOrder.indexOf('cutout');
                    if (layer.type === 'drill') return layerOrder.indexOf('drill');
                    if (layer.type === 'clearing') return layerOrder.indexOf('clearing');
                    if (layer.type === 'isolation') return layerOrder.indexOf('isolation');
                    return layerOrder.indexOf('source');
                };
                
                return getOrder(layerA) - getOrder(layerB);
            });

            for (const [name, layer] of sortedLayers) {
                const layerGroup = document.createElementNS(this.svgNS, 'g');
                layerGroup.setAttribute('id', `layer-${name}`);
                layerGroup.setAttribute('data-layer-type', layer.type);
                if (layer.isFused) layerGroup.setAttribute('data-layer-state', 'fused');
                if (layer.isPreprocessed) layerGroup.setAttribute('data-layer-state', 'preprocessed');
                if (layer.isOffset) layerGroup.setAttribute('data-layer-state', 'offset');
                if (layer.isPreview) layerGroup.setAttribute('data-layer-state', 'preview');

                layer.primitives.forEach(primitive => {
                    const element = this._primitiveToSVGElement(primitive, layer, config, isWireframe);
                    if (element) {
                        layerGroup.appendChild(element);
                    }
                });

                if (layerGroup.hasChildNodes()) {
                    parentGroup.appendChild(layerGroup);
                }
            }
        }

        /**
         * Master function to convert any primitive to an SVG element.
         * @param {object} primitive - The geometry primitive.
         * @param {object} layer - The layer this primitive belongs to.
         * @param {object} config - The export configuration.
         * @returns {SVGElement | null}
         */
        _primitiveToSVGElement(primitive, layer, config, isWireframe) {
            let element = null;

            switch (primitive.type) {
                case 'circle':
                    element = this._createCircleElement(primitive, config);
                    break;
                case 'rectangle':
                    element = this._createRectElement(primitive, config);
                    break;
                case 'path':
                case 'obround':
                case 'arc':
                    // All other types are converted to <path>
                    element = this._createPathElement(primitive, config);
                    break;
                default:
                    console.warn(`[SVGExporter] Unknown primitive type for SVG export: ${primitive.type}`);
                    return null;
            }

            // Apply semantic class and dynamic styles (if any)
            this._applySemanticClass(element, primitive, layer, isWireframe);

            return element;
        }

        /**
         * Applies the correct semantic CSS class and dynamic styles.
         */
        _applySemanticClass(element, primitive, layer, isWireframe) {
            const props = primitive.properties || {};

            // Preview layers
            if (layer.isPreview) {
                element.setAttribute('class', 'pcb-preview');
                if (!isWireframe && layer.metadata?.toolDiameter) {
                    element.setAttribute('stroke-width', layer.metadata.toolDiameter);
                }
                return;
            }

            // Offset layers
            if (layer.isOffset) {
                const offsetType = layer.offsetType || 'external';
                element.setAttribute('class', `pcb-offset-${offsetType}`);
                if (!isWireframe) {
                    // Use a thin stroke for offset outlines
                    element.setAttribute('stroke-width', '0.025');
                }
                return;
            }

            // Preprocessed geometry
            if (layer.isPreprocessed) {
                const polarity = props.polarity || 'dark';
                element.setAttribute('class',
                    polarity === 'clear' ? 'pcb-preprocessed-clear' : 'pcb-preprocessed-dark'
                );
                return;
            }

            // Fused geometry
            if (layer.isFused) {
                element.setAttribute('class', 'pcb-fused');
                return;
            }

            // Stroked paths (traces)
            const isStrokedPath = (props.isTrace || props.stroke === true) && layer.type !== 'cutout';
            if (isStrokedPath) {
                element.setAttribute('class', 'pcb-trace');
                if (!isWireframe && props.strokeWidth) {
                    element.setAttribute('stroke-width', props.strokeWidth);
                    element.setAttribute('fill', 'none');
                }
                return;
            }

            // Peck marks
            if (props.role === 'peck_mark') {
                element.setAttribute('class', 'pcb-peck-mark');
                return;
            }

            // Drill-specific roles
            const role = props.role;
            if (role) {
                switch (role) {
                    case 'drill_hole':
                        element.setAttribute('class', 'pcb-drill-hole');
                        if (!isWireframe && props.diameter) {
                            element.setAttribute('stroke-width', '0.05');
                        }
                        return;
                    case 'drill_slot':
                        element.setAttribute('class', 'pcb-drill-slot');
                        if (!isWireframe) {
                            element.setAttribute('stroke-width', '0.05');
                        }
                        return;
                    case 'drill_milling_path':
                        element.setAttribute('class', 'pcb-drill-milling');
                        if (!isWireframe) {
                            element.setAttribute('stroke-width', '0.05');
                        }
                        return;
                    case 'peck_mark':
                        const relation = props.toolRelation || 'exact';
                        const peckClass = relation === 'oversized' ? 'pcb-peck-error' :
                                        relation === 'undersized' ? 'pcb-peck-warn' : 'pcb-peck-good';
                        element.setAttribute('class', peckClass);
                        return;
                }
            }

            // Source geometry by operation type
            switch (layer.type) {
                case 'cutout':
                    element.setAttribute('class', 'pcb-source-cutout');
                    break;
                case 'drill':
                    element.setAttribute('class', 'pcb-source-drill');
                    break;
                case 'clearing':
                    element.setAttribute('class', 'pcb-source-clearing');
                    break;
                case 'isolation':
                default:
                    element.setAttribute('class', 'pcb-source-isolation');
                    break;
            }
        }

        // Geometry Converters

        _createCircleElement(primitive, config) {
            const precision = config.precision;
            const circle = document.createElementNS(this.svgNS, 'circle');
            circle.setAttribute('cx', this._formatNumber(primitive.center.x, precision));
            circle.setAttribute('cy', this._formatNumber(primitive.center.y, precision));
            circle.setAttribute('r', this._formatNumber(primitive.radius, precision));
            return circle;
        }

        _createRectElement(primitive, config) {
            const precision = config.precision;
            const rect = document.createElementNS(this.svgNS, 'rect');
            rect.setAttribute('x', this._formatNumber(primitive.position.x, precision));
            rect.setAttribute('y', this._formatNumber(primitive.position.y, precision));
            rect.setAttribute('width', this._formatNumber(primitive.width, precision));
            rect.setAttribute('height', this._formatNumber(primitive.height, precision));
            return rect;
        }

        _createPathElement(primitive, config) {
            const path = document.createElementNS(this.svgNS, 'path');
            const d = this._buildPathData(primitive, config);
            path.setAttribute('d', d);
            
            // Multi-contour paths need evenodd for proper hole rendering
            const hasHoles = primitive.contours?.some(c => c.isHole);
            if (hasHoles) {
                path.setAttribute('fill-rule', 'evenodd');
            }
            
            return path;
        }

        /**
         * Master function to build the 'd' attribute for any path-like primitive.
         * @param {object} primitive - The primitive (path, obround, arc).
         * @param {object} config - The export configuration.
         * @returns {string} The SVG path data string.
         */
        _buildPathData(primitive, config) {
            const precision = config.precision;
            
            // Handle non-path types that got routed here
            if (primitive.type === 'obround' && config.preserveArcs) {
                return this._buildObroundPathData(primitive, precision);
            }
            if (primitive.type === 'arc' && config.preserveArcs) {
                return this._buildArcPathData(primitive, precision);
            }
            
            // Path primitives - iterate contours
            if (!primitive.contours || primitive.contours.length === 0) {
                return '';
            }
            
            const pathParts = [];
            
            for (const contour of primitive.contours) {
                if (!contour.points || contour.points.length === 0) continue;
                
                let contourPath;
                if (config.preserveArcs && contour.arcSegments?.length > 0) {
                    contourPath = this._buildContourWithArcs(contour, precision);
                } else {
                    contourPath = this._buildSimplePathData(contour.points, true, precision);
                }
                
                if (contourPath) {
                    pathParts.push(contourPath);
                }
            }
            
            return pathParts.join(' ');
        }

        /**
         * Builds a simple SVG path string from an array of points (lines only).
         */
        _buildSimplePathData(points, closed, precision) {
            if (!points || points.length === 0) return '';

            const p = (val) => this._formatNumber(val, precision);

            let d = `M${p(points[0].x)},${p(points[0].y)}`;
            for (let i = 1; i < points.length; i++) {
                d += ` L${p(points[i].x)},${p(points[i].y)}`;
            }
            if (closed !== false) { // Default to closed
                d += ' Z';
            }
            return d;
        }

        /**
         * Builds a complex SVG path string from a .contour
         */
        _buildContourWithArcs(contour, precision) {
            const points = contour.points;
            const arcSegments = contour.arcSegments || [];
            
            if (!points || points.length === 0) return '';
            
            const p = (val) => this._formatNumber(val, precision);
            const pathParts = [];
            const sortedArcs = [...arcSegments].sort((a, b) => a.startIndex - b.startIndex);
            
            pathParts.push(`M${p(points[0].x)},${p(points[0].y)}`);
            let currentIndex = 0;
            
            for (const arc of sortedArcs) {
                // Draw lines up to the arc start
                for (let i = currentIndex + 1; i <= arc.startIndex; i++) {
                    pathParts.push(`L${p(points[i].x)},${p(points[i].y)}`);
                }
                
                const endPointOfArc = points[arc.endIndex];
                let angleSpan = arc.sweepAngle;
                
                if (angleSpan === undefined) {
                    angleSpan = arc.endAngle - arc.startAngle;
                    if (arc.clockwise && angleSpan > 0) angleSpan -= 2 * Math.PI;
                    if (!arc.clockwise && angleSpan < 0) angleSpan += 2 * Math.PI;
                }
                
                const largeArc = Math.abs(angleSpan) > Math.PI ? 1 : 0;
                const sweep = arc.clockwise ? 1 : 0;
                
                pathParts.push(`A${p(arc.radius)},${p(arc.radius)} 0 ${largeArc} ${sweep} ${p(endPointOfArc.x)},${p(endPointOfArc.y)}`);
                currentIndex = arc.endIndex;
            }
            
            // Remaining lines
            const lastArc = sortedArcs[sortedArcs.length - 1];
            const pathClosedByArc = lastArc && lastArc.endIndex === 0 && lastArc.startIndex > 0;
            
            if (!pathClosedByArc) {
                for (let i = currentIndex + 1; i < points.length; i++) {
                    pathParts.push(`L${p(points[i].x)},${p(points[i].y)}`);
                }
            }
            
            pathParts.push('Z');
            return pathParts.join(' ');
        }

        /**
         * Builds an SVG path string for a standalone ArcPrimitive.
         */
        _buildArcPathData(primitive, precision) {
            const p = (val) => this._formatNumber(val, precision);

            const startX = primitive.center.x + primitive.radius * Math.cos(primitive.startAngle);
            const startY = primitive.center.y + primitive.radius * Math.sin(primitive.startAngle);
            const endX = primitive.center.x + primitive.radius * Math.cos(primitive.endAngle);
            const endY = primitive.center.y + primitive.radius * Math.sin(primitive.endAngle);

            let angleSpan = primitive.endAngle - primitive.startAngle;
            if (primitive.clockwise && angleSpan > 0) angleSpan -= 2 * Math.PI;
            if (!primitive.clockwise && angleSpan < 0) angleSpan += 2 * Math.PI;

            const largeArc = Math.abs(angleSpan) > Math.PI ? 1 : 0;
            // Invert sweep-flag due to Y-axis flip
            const sweep = !primitive.clockwise ? 1 : 0;

            let d = `M${p(startX)},${p(startY)}`;
            d += ` A${p(primitive.radius)},${p(primitive.radius)} 0 ${largeArc} ${sweep} ${p(endX)},${p(endY)}`;

            return d;
        }

        /**
         * Builds an SVG path string for an ObroundPrimitive.
         */
        _buildObroundPathData(primitive, precision) {
            const p = (val) => this._formatNumber(val, precision);
            const r = Math.min(primitive.width, primitive.height) / 2;
            let d = '';

            const x = primitive.position.x;
            const y = primitive.position.y;
            const w = primitive.width;
            const h = primitive.height;

            if (w > h) { // Horizontal
                d = `M${p(x + r)},${p(y)}`;
                d += ` L${p(x + w - r)},${p(y)}`;
                // Arc command: A rx ry x-axis-rotation large-arc-flag sweep-flag x y
                // Sweep-flag is 1 for positive angle (CCW), 0 for negative (CW)
                // Y-flip inverts this, so 1 means CW, 0 means CCW
                d += ` A${p(r)},${p(r)} 0 0 0 ${p(x + w - r)},${p(y + h)}`;
                d += ` L${p(x + r)},${p(y + h)}`;
                d += ` A${p(r)},${p(r)} 0 0 0 ${p(x + r)},${p(y)}`;
            } else { // Vertical
                d = `M${p(x + w)},${p(y + r)}`;
                d += ` L${p(x + w)},${p(y + h - r)}`;
                d += ` A${p(r)},${p(r)} 0 0 0 ${p(x)},${p(y + h - r)}`;
                d += ` L${p(x)},${p(y + r)}`;
                d += ` A${p(r)},${p(r)} 0 0 0 ${p(x + w)},${p(y + r)}`;
            }
            d += ' Z';
            return d;
        }

        // Serialize and Download

        _serializeAndDownload(svg, filename) {
            const serializer = new XMLSerializer();
            let svgString = serializer.serializeToString(svg);

            svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgString;

            this.downloadSVG(svgString, filename);
            return svgString;
        }

        _formatNumber(value, precision) {
            // Use parseFloat and toString to remove trailing zeros
            return parseFloat(value.toFixed(precision)).toString();
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

        debug(message, data = null) {
            if (debugConfig.enabled) {
                if (data) {
                    console.log(`[SVGExporter] ${message}`, data);
                } else {
                    console.log(`[SVGExporter] ${message}`);
                }
            }
        }
    }

    window.SVGExporter = SVGExporter;
})();