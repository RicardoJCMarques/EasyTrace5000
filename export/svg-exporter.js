/**
 * @file        export/svg-exporter.js
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
    
    const config = window.PCBCAMConfig || {};
    const geomConfig = config.geometry || {};
    const debugConfig = config.debug || {};
    
    class SVGExporter {
        constructor(renderer) {
            this.renderer = renderer;
            this.core = renderer.core;
            this.svgNS = 'http://www.w3.org/2000/svg';
            
            this.options = {
                precision: config.gcode?.precision?.coordinates || 3,
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

            // 1. Calculate bounds from all visible layers
            this.core.calculateOverallBounds();
            const bounds = this.core.bounds;

            if (!bounds || !isFinite(bounds.width) || !isFinite(bounds.height)) {
                console.warn('[SVGExporter] No visible content to export.');
                if (window.pcbcam && window.pcbcam.ui) {
                    window.pcbcam.ui.updateStatus('No content to export', 'warning');
                }
                return null;
            }

            // 2. Create root <svg> element
            const svg = this._createSVGRoot(bounds, exportConfig);

            // 3. Add metadata
            if (exportConfig.includeMetadata) {
                svg.appendChild(this._createExportComment());
            }

            // 4. Create <defs> with <style>
            if (exportConfig.embedStyles) {
                svg.appendChild(this._createDefs(exportConfig));
            }

            // 5. Create main <g> with transforms
            const mainGroup = this._createMainGroup(exportConfig);
            svg.appendChild(mainGroup);

            // 6. Serialize and download
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
            
            const isWireframe = this.core.options.showWireframe;
            const wireframeColor = (debugColors && debugColors.wireframe) ? debugColors.wireframe : '#00ff00';
            
            this.debug(`Generating styles. isWireframe = ${isWireframe}`);
            
            const wireframeStroke = `fill: none; stroke: ${wireframeColor}; stroke-width: 0.05;`;
            
            // Fallback colors added for safety
            const traceStyles = `fill: none; stroke: ${colors.isolation}; stroke-linecap: round; line-join: round;`;
            // Use 6-digit.
            const cutoutStyles = `fill: none; stroke: ${colors.cutout.substring(0, 7)}; stroke-width: 0.1;`;
            
            let css = '';

           if (isWireframe) {
                // WIREFRAME MODE
                css = `
                    .pcb-source-isolation,
                    .pcb-source-drill,
                    .pcb-fused,
                    .pcb-preprocessed-dark,
                    .pcb-preprocessed-clear,
                    .pcb-offset,
                    .pcb-preview,
                    .pcb-trace { ${wireframeStroke} }
                    .pcb-fused { fill-rule: evenodd; }
                    .pcb-cutout { ${cutoutStyles} }
                `;
            } else {
                // SOLID FILL MODE
                const solidFill = 'stroke: none;';
                const bgColor = (canvasColors && canvasColors.background) ? canvasColors.background : '#0f0f0f';
                
                css = `
                    .pcb-source-isolation { fill: ${colors.isolation}; ${solidFill} }
                    .pcb-source-drill { fill: ${colors.drill}; ${solidFill} }
                    .pcb-fused { fill: ${colors.fused || colors.isolation}; ${solidFill} fill-rule: evenodd; }
                    .pcb-preprocessed-dark { fill: ${colors.isolation}; ${solidFill} }
                    .pcb-preprocessed-clear { fill: ${bgColor}; ${solidFill} }
                    .pcb-trace { ${traceStyles} }
                    .pcb-cutout { ${cutoutStyles} }
                    .pcb-offset { fill: none; stroke-linecap: round; line-join: round; }
                    .pcb-preview { fill: none; stroke-linecap: round; line-join: round; }
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
                const center = this.core.rotationCenter || { x: 0, y: 0 };
                // Note: SVG rotation is clockwise, but our Y-flip inverts it. We apply the *same* rotation angle as the canvas.
                transform += ` rotate(${viewState.rotation} ${this._formatNumber(center.x, config.precision)} ${this._formatNumber(center.y, config.precision)})`;
            }
            
            mainGroup.setAttribute('transform', transform);
            
            // Delegate to populate this group
            this._exportVisibleLayers(mainGroup, config);
            
            return mainGroup;
        }

        /**
         * Iterates visible layers and populates the main group.
         * @param {SVGElement} parentGroup - The main <g> to append to.
         * @param {object} config - The export configuration.
         */
        _exportVisibleLayers(parentGroup, config) {
            const visibleLayers = this.core.getVisibleLayers();
            const isWireframe = this.core.options.showWireframe;

            visibleLayers.forEach((layer, name) => {
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
            });
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
         * @param {SVGElement} element - The SVG element to style.
         * @param {object} primitive - The geometry primitive.
         * @param {object} layer - The layer this primitive belongs to.
         */
        _applySemanticClass(element, primitive, layer, isWireframe) {
            const props = primitive.properties || {};
            // Get the layer state flags
            const isPreprocessed = layer.isPreprocessed;
            const isFused = layer.isFused;

            // Check for Preprocessed state
            if (isPreprocessed) {
                // Preprocessed geometry *always* uses fill, based on polarity
                const polarity = props.polarity || 'dark';
                element.setAttribute('class',
                    polarity === 'clear' ? 'pcb-preprocessed-clear' : 'pcb-preprocessed-dark'
                );
                // Ensure no stroke attributes are added later
                element.removeAttribute('stroke');
                element.removeAttribute('stroke-width');
                return; // Styling is complete for preprocessed
            }

            // If NOT preprocessed, continue with other checks...
            const isStrokedPath = (props.isTrace || props.stroke === true) && layer.type !== 'cutout';

            if (isStrokedPath) {
                element.setAttribute('class', 'pcb-trace');
                // Apply inline stroke-width ONLY if not in wireframe
                if (!isWireframe) {
                    const strokeWidthValue = props.strokeWidth;
                    let widthToSet; // Fallback
                    if (typeof strokeWidthValue === 'number' && isFinite(strokeWidthValue) && strokeWidthValue > 0) {
                        widthToSet = strokeWidthValue.toString();
                    }
                    // Use setAttribute('style', ...) OR individual stroke attributes
                    element.setAttribute('stroke-width', widthToSet);
                    // Ensure fill is none if setting stroke explicitly
                    element.setAttribute('fill', 'none');
                }
                return;
            }

            // Cutout check
            if (layer.type === 'cutout') {
                element.setAttribute('class', 'pcb-cutout');
                return;
            }

            // Fused check
            if (isFused) {
                element.setAttribute('class', 'pcb-fused');
                return;
            }

            // Drill check
            if (layer.type === 'drill' || props.role === 'drill_hole' || props.role === 'peck_mark') {
                element.setAttribute('class', 'pcb-source-drill');
                return;
            }

            // Default (Source Isolation, etc.)
            element.setAttribute('class', 'pcb-source-isolation');
        }

        // GEOMETRY CONVERTERS

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
            
            // Build the 'd' attribute string
            const d = this._buildPathData(primitive, config);
            path.setAttribute('d', d);

            // Handle holes for fused/preprocessed geometry
            if (primitive.holes && primitive.holes.length > 0) {
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
            let d = '';

            // 1. Build the main outer path
            if (config.preserveArcs && primitive.arcSegments?.length > 0) {
                d = this._buildPathWithArcs(primitive, precision);
            } else if (primitive.type === 'obround' && config.preserveArcs) {
                d = this._buildObroundPathData(primitive, precision);
            } else if (primitive.type === 'arc' && config.preserveArcs) {
                d = this._buildArcPathData(primitive, precision);
            } else {
                // Fallback for simple paths, or when arcs are disabled
                let points = primitive.points;
                if (primitive.type === 'obround') points = primitive.toPolygon().points;
                if (primitive.type === 'arc') points = primitive.toPolygon().points;
                
                d = this._buildSimplePathData(points, primitive.closed, precision);
            }

            // 2. Append all holes
            if (primitive.holes && primitive.holes.length > 0) {
                primitive.holes.forEach(hole => {
                    d += ' ' + this._buildSimplePathData(hole, true, precision);
                });
            }
            
            return d;
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
         * Builds a complex SVG path string from a PathPrimitive containing both lines and arcs.
         */
        _buildPathWithArcs(primitive, precision) {
            const points = primitive.points;
            if (!points || points.length === 0) return '';

            const p = (val) => this._formatNumber(val, precision);
            const pathParts = [];
            const sortedArcs = [...primitive.arcSegments].sort((a, b) => a.startIndex - b.startIndex);

            pathParts.push(`M${p(points[0].x)},${p(points[0].y)}`);
            let currentIndex = 0;

            for (const arc of sortedArcs) {
                // Draw lines up to the arc start
                for (let i = currentIndex + 1; i <= arc.startIndex; i++) {
                    pathParts.push(`L${p(points[i].x)},${p(points[i].y)}`);
                }

                const endPointOfArc = points[arc.endIndex];
                
                // Use the pre-calculated sweep angle from the stitcher
                let angleSpan = arc.sweepAngle;
                
                // Fallback if sweepAngle is missing (shouldn't happen with fixed stitcher)
                if (angleSpan === undefined) {
                    console.warn('[SVGExporter] arc.sweepAngle not found, recalculating...');
                    angleSpan = arc.endAngle - arc.startAngle;
                    if (arc.clockwise && angleSpan > 0) angleSpan -= 2 * Math.PI;
                    if (!arc.clockwise && angleSpan < 0) angleSpan += 2 * Math.PI;
                }

                const largeArc = Math.abs(angleSpan) > Math.PI ? 1 : 0;
                const sweep = !arc.clockwise ? 1 : 0;  // Inverted mapping for Y-flip

                pathParts.push(`A${p(arc.radius)},${p(arc.radius)} 0 ${largeArc} ${sweep} ${p(endPointOfArc.x)},${p(endPointOfArc.y)}`);
                
                currentIndex = arc.endIndex;
            }

            // Check if last arc wrapped to index 0 (closes path)
            const lastArc = sortedArcs[sortedArcs.length - 1];
            const pathClosedByArc = (lastArc && lastArc.endIndex === 0 && lastArc.startIndex > 0);

            // Only add remaining lines if path NOT closed by wrap-around arc
            if (!pathClosedByArc) {
                for (let i = currentIndex + 1; i < points.length; i++) {
                    pathParts.push(`L${p(points[i].x)},${p(points[i].y)}`);
                }
            }

            if (primitive.closed !== false) {
                pathParts.push('Z');
            }
            
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

        // SERIALIZE & DOWNLOAD
        
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