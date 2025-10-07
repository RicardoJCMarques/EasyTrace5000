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
    const renderConfig = config.rendering || {};
    const themeConfig = renderConfig.themes || {};
    const opsConfig = config.operations || {};
    const debugConfig = config.debug || {};
    const geomConfig = config.geometry || {};
    
    class SVGExporter {
        constructor(renderer) {
            this.renderer = renderer;
            
            this.options = {
                precision: config.gcode?.precision?.coordinates || 3,
                padding: 5,
                preserveArcs: geomConfig.preserveArcs !== false,
                optimizePaths: true,
                includeMetadata: true,
                useViewBox: true,
                embedStyles: true,
                compressOutput: false,
                respectCanvasState: true
            };
        }

        /**
         * Creates a comment node with metadata about the export state.
         * @param {object} exportConfig - The configuration used for the export.
         * @returns {Comment} An SVG comment node.
         */
        createExportComment(exportConfig) {
            const viewOptions = this.renderer.options;
            const fusionState = viewOptions.fuseGeometry ? 
                `Fusion ON (Arc Reconstruction: ${viewOptions.enableArcReconstruction ? 'ON' : 'OFF'})` : 
                'Fusion OFF';
            
            const content = `
EasyTrace5000 SVG Export
Timestamp: ${new Date().toISOString()}
---
View State:
    - Mode: ${viewOptions.showWireframe ? 'Wireframe' : 'Solid Fill'}
    - Geometry: ${fusionState}
    - B&W: ${viewOptions.blackAndWhite}
---
Exported from the current canvas view.
`;
            return document.createComment(content);
        }
        
        exportSVG(options = {}) {
            const exportConfig = { ...this.options, ...options };
            const filename = exportConfig.filename || 'pcb-export.svg';

            if (debugConfig.logging?.fileOperations) {
                console.log(`Exporting current canvas view to SVG: ${filename}`);
            }

            const viewState = this.renderer.getViewState();
            const bounds = this.calculateExportBounds(exportConfig);

            if (!bounds) {
                console.warn('No visible content to export.');
                // Consider notifying the user via the status manager
                if (window.pcbcam && window.pcbcam.ui) {
                    window.pcbcam.ui.updateStatus('No content to export', 'warning');
                }
                return null;
            }

            const svg = this.createSVGDocument(bounds, exportConfig);
            const layerGroup = this.createVisibleLayers(svg, viewState, exportConfig);
            svg.appendChild(layerGroup);

            // Add metadata about the export state
            const comment = this.createExportComment(exportConfig);
            svg.insertBefore(comment, svg.firstChild);

            const svgString = this.serializeSVG(svg, exportConfig);
            this.downloadSVG(svgString, filename);

            return svgString;
        }
        
        exportPreprocessedGeometry(primitives, exportConfig) {
            const filename = exportConfig.filename || 'pcb-preprocessed.svg';
            
            if (debugConfig.enabled) {
                console.log(`Exporting preprocessed geometry: ${primitives.length} primitives`);
            }
            
            const bounds = this.calculatePrimitiveBounds(primitives);
            const svg = this.createSVGDocument(bounds, exportConfig);
            
            const svgNS = 'http://www.w3.org/2000/svg';
            const mainGroup = document.createElementNS(svgNS, 'g');
            mainGroup.setAttribute('id', 'pcb-preprocessed-layers');
            mainGroup.setAttribute('transform', 'scale(1,-1)');
            
            const viewState = this.renderer.getViewState();
            if (viewState.rotation !== 0) {
                const center = this.renderer.rotationCenter || { x: 0, y: 0 };
                const transform = mainGroup.getAttribute('transform');
                mainGroup.setAttribute('transform', 
                    `${transform} rotate(${viewState.rotation} ${center.x} ${center.y})`);
            }
            
            const darkPrimitives = [];
            const clearPrimitives = [];
            
            primitives.forEach(primitive => {
                const polarity = primitive.properties?.polarity || 'dark';
                if (polarity === 'clear') {
                    clearPrimitives.push(primitive);
                } else {
                    darkPrimitives.push(primitive);
                }
            });
            
            if (darkPrimitives.length > 0) {
                const darkGroup = document.createElementNS(svgNS, 'g');
                darkGroup.setAttribute('id', 'dark-primitives');
                darkGroup.setAttribute('data-polarity', 'dark');
                darkGroup.setAttribute('data-count', darkPrimitives.length.toString());
                
                darkPrimitives.forEach((primitive, index) => {
                    const element = this.primitiveToSVG(svgNS, primitive, 'preprocessed', exportConfig);
                    if (element) {
                        element.setAttribute('data-index', index.toString());
                        darkGroup.appendChild(element);
                    }
                });
                
                mainGroup.appendChild(darkGroup);
            }
            
            if (clearPrimitives.length > 0) {
                const clearGroup = document.createElementNS(svgNS, 'g');
                clearGroup.setAttribute('id', 'clear-primitives');
                clearGroup.setAttribute('data-polarity', 'clear');
                clearGroup.setAttribute('data-count', clearPrimitives.length.toString());
                
                clearPrimitives.forEach((primitive, index) => {
                    const element = this.primitiveToSVG(svgNS, primitive, 'preprocessed-clear', exportConfig);
                    if (element) {
                        element.setAttribute('data-index', index.toString());
                        clearGroup.appendChild(element);
                    }
                });
                
                mainGroup.appendChild(clearGroup);
            }
            
            svg.appendChild(mainGroup);
            
            const comment = document.createComment(
                ` Preprocessed geometry: ${primitives.length} total (${darkPrimitives.length} dark, ${clearPrimitives.length} clear) `
            );
            svg.insertBefore(comment, svg.firstChild);
            
            const svgString = this.serializeSVG(svg, exportConfig);
            this.downloadSVG(svgString, filename);
            
            return svgString;
        }
        
        exportFusedGeometry(primitives, exportConfig) {
            const filename = exportConfig.filename || 'pcb-fused.svg';
            
            if (debugConfig.enabled) {
                console.log(`Exporting fused geometry: ${primitives.length} primitives`);
                
                let totalHoles = 0;
                primitives.forEach(p => {
                    if (p.holes && p.holes.length > 0) {
                        totalHoles += p.holes.length;
                    }
                });
                
                if (totalHoles > 0) {
                    console.log(`  Including ${totalHoles} holes`);
                }
            }
            
            const bounds = this.calculatePrimitiveBounds(primitives);
            const svg = this.createSVGDocument(bounds, exportConfig);
            
            const svgNS = 'http://www.w3.org/2000/svg';
            const mainGroup = document.createElementNS(svgNS, 'g');
            mainGroup.setAttribute('id', 'pcb-fused-layers');
            mainGroup.setAttribute('transform', 'scale(1,-1)');
            
            const viewState = this.renderer.getViewState();
            if (viewState.rotation !== 0) {
                const center = this.renderer.rotationCenter || { x: 0, y: 0 };
                const transform = mainGroup.getAttribute('transform');
                mainGroup.setAttribute('transform', 
                    `${transform} rotate(${viewState.rotation} ${center.x} ${center.y})`);
            }
            
            const fusedGroup = document.createElementNS(svgNS, 'g');
            fusedGroup.setAttribute('id', 'fused-geometry');
            fusedGroup.setAttribute('data-primitive-count', primitives.length.toString());
            
            primitives.forEach((primitive, index) => {
                const element = this.fusedPrimitiveToSVG(svgNS, primitive, exportConfig);
                if (element) {
                    element.setAttribute('data-index', index.toString());
                    if (primitive.holes && primitive.holes.length > 0) {
                        element.setAttribute('data-holes', primitive.holes.length.toString());
                    }
                    fusedGroup.appendChild(element);
                }
            });
            
            mainGroup.appendChild(fusedGroup);
            svg.appendChild(mainGroup);
            
            let metadataText = ` Fused geometry: ${primitives.length} primitives `;
            const holesCount = primitives.reduce((sum, p) => sum + (p.holes?.length || 0), 0);
            if (holesCount > 0) {
                metadataText += `with ${holesCount} holes `;
            }
            const comment = document.createComment(metadataText);
            svg.insertBefore(comment, svg.firstChild);
            
            const svgString = this.serializeSVG(svg, exportConfig);
            this.downloadSVG(svgString, filename);
            
            return svgString;
        }
        
        exportSingleSVG(exportConfig) {
            const filename = exportConfig.filename || 'pcb-export.svg';
            
            if (debugConfig.logging?.fileOperations) {
                console.log(`Exporting SVG: ${filename}`);
            }
            
            const viewState = this.renderer.getViewState();
            const bounds = this.calculateExportBounds(exportConfig);
            
            if (!bounds) {
                console.warn('No content to export');
                return null;
            }
            
            const svg = this.createSVGDocument(bounds, exportConfig);
            const layerGroup = this.createVisibleLayers(svg, viewState, exportConfig);
            svg.appendChild(layerGroup);
            
            const svgString = this.serializeSVG(svg, exportConfig);
            this.downloadSVG(svgString, filename);
            
            return svgString;
        }
        
        getGeometryProcessor() {
            // Primary: get from cam core
            if (window.cam && window.cam.core && window.cam.core.geometryProcessor) {
                return window.cam.core.geometryProcessor;
            }
            
            // Fallback: renderer's coordinate system (shouldn't have it)
            if (this.renderer.coordinateSystem && this.renderer.coordinateSystem.geometryProcessor) {
                return this.renderer.coordinateSystem.geometryProcessor;
            }
            
            return null;
        }
        
        calculatePrimitiveBounds(primitives) {
            if (!primitives || primitives.length === 0) {
                return { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 };
            }
            
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            
            primitives.forEach(primitive => {
                let bounds;
                
                if (typeof primitive.getBounds === 'function') {
                    bounds = primitive.getBounds();
                } else if (primitive.type === 'path' && primitive.points) {
                    primitive.points.forEach(p => {
                        minX = Math.min(minX, p.x);
                        minY = Math.min(minY, p.y);
                        maxX = Math.max(maxX, p.x);
                        maxY = Math.max(maxY, p.y);
                    });
                    
                    if (primitive.holes) {
                        primitive.holes.forEach(hole => {
                            hole.forEach(p => {
                                minX = Math.min(minX, p.x);
                                minY = Math.min(minY, p.y);
                                maxX = Math.max(maxX, p.x);
                                maxY = Math.max(maxY, p.y);
                            });
                        });
                    }
                    
                    bounds = { minX, minY, maxX, maxY };
                }
                
                if (bounds) {
                    minX = Math.min(minX, bounds.minX);
                    minY = Math.min(minY, bounds.minY);
                    maxX = Math.max(maxX, bounds.maxX);
                    maxY = Math.max(maxY, bounds.maxY);
                }
            });
            
            if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
                return { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 };
            }
            
            return {
                minX, minY, maxX, maxY,
                width: maxX - minX,
                height: maxY - minY
            };
        }
        
        createSVGDocument(bounds, exportConfig) {
            const svgNS = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(svgNS, 'svg');
            
            const width = bounds.width + exportConfig.padding * 2;
            const height = bounds.height + exportConfig.padding * 2;
            
            svg.setAttribute('xmlns', svgNS);
            svg.setAttribute('width', `${width}mm`);
            svg.setAttribute('height', `${height}mm`);
            
            if (exportConfig.useViewBox) {
                const viewY = -(bounds.maxY + exportConfig.padding);
                svg.setAttribute('viewBox', 
                    `${bounds.minX - exportConfig.padding} ${viewY} ${width} ${height}`);
            }
            
            if (exportConfig.includeMetadata) {
                svg.appendChild(this.createMetadata(svgNS));
            }
            
            if (exportConfig.embedStyles) {
                svg.appendChild(this.createStyles(svgNS, exportConfig));
            }
            
            return svg;
        }
        
        createMetadata(svgNS) {
            const metadata = document.createElementNS(svgNS, 'metadata');
            const desc = document.createElementNS(svgNS, 'desc');
            desc.textContent = `PCB CAM Export - ${new Date().toISOString()}`;
            metadata.appendChild(desc);
            return metadata;
        }
        
        createStyles(svgNS, exportConfig) {
            const defs = document.createElementNS(svgNS, 'defs');
            const style = document.createElementNS(svgNS, 'style');
            style.setAttribute('type', 'text/css');
            
            const theme = themeConfig[this.renderer.options.theme] || themeConfig.dark;
            const colors = theme.layers;
            const isWireframe = this.renderer.options.showWireframe;
            
            let css = '';
            
            if (isWireframe) {
                css = `
                    .pcb-isolation { fill: none; stroke: ${colors.isolation}; stroke-width: 0.05; }
                    .pcb-clear { fill: none; stroke: ${colors.clear}; stroke-width: 0.05; }
                    .pcb-drill { fill: none; stroke: ${colors.drill}; stroke-width: 0.05; }
                    .pcb-cutout { fill: none; stroke: ${colors.cutout}; stroke-width: 0.05; }
                    .pcb-trace { fill: none; stroke: ${colors.isolation}; stroke-width: 0.05; }
                    .pcb-pad { fill: none; stroke: ${colors.isolation}; stroke-width: 0.05; }
                    .pcb-fused { fill: none; stroke: ${colors.fused}; stroke-width: 0.05; }
                    .pcb-preprocessed { fill: ${colors.isolation}; stroke: none; fill-opacity: 0.8; }
                    .pcb-preprocessed-clear { fill: ${colors.clear}; stroke: none; fill-opacity: 0.8; }
                `;
            } else {
                css = `
                    .pcb-isolation { fill: ${colors.isolation}; stroke: none; }
                    .pcb-clear { fill: ${colors.clear}; stroke: none; }
                    .pcb-drill { fill: ${colors.drill}; stroke: none; }
                    .pcb-cutout { fill: none; stroke: ${colors.cutout}; stroke-width: 0.1; }
                    .pcb-trace { fill: none; stroke: ${colors.isolation}; stroke-linecap: round; }
                    .pcb-pad { fill: ${colors.isolation}; stroke: none; }
                    .pcb-fused { fill: ${colors.fused}; stroke: none; fill-rule: evenodd; }
                    .pcb-preprocessed { fill: ${colors.isolation}; stroke: none; fill-opacity: 0.9; }
                    .pcb-preprocessed-clear { fill: ${colors.clear}; stroke: none; fill-opacity: 0.9; }
                `;
            }
            
            style.textContent = css;
            defs.appendChild(style);
            
            return defs;
        }
        
        createVisibleLayers(svg, viewState, exportConfig) {
            const svgNS = 'http://www.w3.org/2000/svg';
            const mainGroup = document.createElementNS(svgNS, 'g');
            mainGroup.setAttribute('id', 'pcb-layers');
            mainGroup.setAttribute('transform', 'scale(1,-1)');

            if (viewState.rotation !== 0) {
                const center = this.renderer.rotationCenter || { x: 0, y: 0 };
                const currentTransform = mainGroup.getAttribute('transform');
                mainGroup.setAttribute('transform',
                    `${currentTransform} rotate(${-viewState.rotation} ${center.x} ${center.y})`);
            }

            const visibleLayers = this.renderer.getVisibleLayers();

            visibleLayers.forEach((layer, name) => {
                const layerGroup = document.createElementNS(svgNS, 'g');
                layerGroup.setAttribute('id', `layer-${name}`);
                layerGroup.setAttribute('data-layer-type', layer.type);

                layer.primitives.forEach(primitive => {
                    // CRITICAL FIX: Pass the full 'layer' object, not just its type.
                    const element = this.primitiveToSVG(svgNS, primitive, layer, exportConfig);
                    if (element) {
                        layerGroup.appendChild(element);
                    }
                });

                if (layerGroup.hasChildNodes()) {
                    mainGroup.appendChild(layerGroup);
                }
            });

            return mainGroup;
        }
        
        shouldExportLayer(layer, exportConfig) {
            if (!layer.visible) return false;
            
            if (exportConfig.forceFusionState !== undefined) {
                if (exportConfig.forceFusionState && !layer.isFused) return false;
                if (!exportConfig.forceFusionState && layer.isFused) return false;
            }
            
            return true;
        }
        
        createFilteredLayer(svgNS, layer, name, exportConfig) {
            const group = document.createElementNS(svgNS, 'g');
            group.setAttribute('id', `layer-${name}`);
            group.setAttribute('data-layer-type', layer.type);
            
            const filteredPrimitives = this.filterPrimitives(layer.primitives, layer.type);
            
            if (filteredPrimitives.length === 0) return null;
            
            if (layer.isFused) {
                filteredPrimitives.forEach(primitive => {
                    const element = this.fusedPrimitiveToSVG(svgNS, primitive, exportConfig);
                    if (element) group.appendChild(element);
                });
            } else {
                const grouped = this.groupConnectedTraces(filteredPrimitives);
                grouped.forEach(item => {
                    if (item.type === 'trace-group') {
                        const element = this.traceGroupToSVG(svgNS, item, exportConfig);
                        if (element) group.appendChild(element);
                    } else {
                        const element = this.primitiveToSVG(svgNS, item.primitive, layer.type, exportConfig);
                        if (element) group.appendChild(element);
                    }
                });
            }
            
            return group;
        }
        
        filterPrimitives(primitives, layerType) {
            const options = this.renderer.options;
            
            return primitives.filter(primitive => {
                const props = primitive.properties || {};
                
                if (props.isDrillHole && !options.showDrills) return false;
                if (props.isTrace && !options.showTraces) return false;
                if ((props.isPad || props.isFlash) && !options.showPads) return false;
                if (props.isRegion && !options.showRegions) return false;
                if (props.isCutout && !options.showCutouts) return false;
                
                return true;
            });
        }
        
        primitiveToSVG(svgNS, primitive, layer, exportConfig) {
            const isWireframe = this.renderer.options.showWireframe;
            let element = null;
            
            switch (primitive.type) {
                case 'path':
                    element = this.pathToSVG(svgNS, primitive, layer, exportConfig);
                    break;
                case 'circle':
                    element = this.circleToSVG(svgNS, primitive, layer, exportConfig);
                    break;
                case 'rectangle':
                    element = this.rectangleToSVG(svgNS, primitive, layer, exportConfig);
                    break;
                case 'obround':
                    element = this.obroundToSVG(svgNS, primitive, layer, exportConfig);
                    break;
                case 'arc':
                    element = this.arcToSVG(svgNS, primitive, layer, exportConfig);
                    break;
            }
            
            if (element) {
                this.applyStyles(element, primitive, layer, isWireframe);
            }

            return element;
        }
        
        fusedPrimitiveToSVG(svgNS, primitive, exportConfig) {
            const path = document.createElementNS(svgNS, 'path');
            const precision = exportConfig.precision;
            
            let d = this.buildSimplePath(primitive.points, primitive.closed !== false, precision);
            
            if (primitive.holes && primitive.holes.length > 0) {
                primitive.holes.forEach(hole => {
                    d += ' ' + this.buildSimplePath(hole, true, precision);
                });
            }
            
            path.setAttribute('d', d);
            path.setAttribute('class', 'pcb-fused');
            
            if (primitive.holes && primitive.holes.length > 0) {
                path.setAttribute('fill-rule', 'evenodd');
            }
            
            return path;
        }
        
        groupConnectedTraces(primitives) {
            const grouped = [];
            const used = new Set();
            
            primitives.forEach((primitive, index) => {
                if (used.has(index)) return;
                
                if (primitive.type === 'path' && 
                    primitive.properties?.isTrace && 
                    primitive.points?.length === 2) {
                    
                    const group = this.findConnectedTraces(primitives, index, used);
                    if (group.length > 1) {
                        grouped.push({
                            type: 'trace-group',
                            traces: group,
                            strokeWidth: primitive.properties.strokeWidth
                        });
                    } else {
                        grouped.push({ type: 'single', primitive });
                        used.add(index);
                    }
                } else {
                    grouped.push({ type: 'single', primitive });
                    used.add(index);
                }
            });
            
            return grouped;
        }
        
        findConnectedTraces(primitives, startIndex, used) {
            const traces = [];
            const startTrace = primitives[startIndex];
            traces.push(startTrace);
            used.add(startIndex);
            
            let currentEnd = startTrace.points[1];
            let found = true;
            
            while (found) {
                found = false;
                for (let i = 0; i < primitives.length; i++) {
                    if (used.has(i)) continue;
                    
                    const prim = primitives[i];
                    if (prim.type === 'path' && prim.properties?.isTrace && prim.points?.length === 2) {
                        const tolerance = geomConfig.coordinatePrecision || 0.001;
                        if (Math.abs(prim.points[0].x - currentEnd.x) < tolerance && 
                            Math.abs(prim.points[0].y - currentEnd.y) < tolerance) {
                            traces.push(prim);
                            currentEnd = prim.points[1];
                            used.add(i);
                            found = true;
                            break;
                        }
                    }
                }
            }
            
            return traces;
        }
        
        traceGroupToSVG(svgNS, group, exportConfig) {
            const path = document.createElementNS(svgNS, 'path');
            const precision = exportConfig.precision;
            
            let d = '';
            group.traces.forEach((trace, index) => {
                if (index === 0) {
                    d += `M${this.formatNumber(trace.points[0].x, precision)},${this.formatNumber(trace.points[0].y, precision)}`;
                }
                d += ` L${this.formatNumber(trace.points[1].x, precision)},${this.formatNumber(trace.points[1].y, precision)}`;
            });
            
            path.setAttribute('d', d);
            path.setAttribute('class', 'pcb-trace');
            path.setAttribute('stroke-width', group.strokeWidth || 0.1);
            
            return path;
        }
        
        pathToSVG(svgNS, primitive, layer, exportConfig) {
            const path = document.createElementNS(svgNS, 'path');
            const precision = exportConfig.precision;
            let d = '';

            if (exportConfig.preserveArcs && primitive.arcSegments?.length > 0) {
                d = this.buildPathWithArcs(primitive, precision, exportConfig);
            } else {
                d = this.buildSimplePath(primitive.points, primitive.closed !== false, precision);
            }
            
            if (primitive.holes && primitive.holes.length > 0) {
                d += ' ' + this.buildSimplePath(primitive.holes[0], true, precision);
                path.setAttribute('fill-rule', 'evenodd');
            }

            path.setAttribute('d', d);
            return path;
        }

        /**
         * Builds a complex SVG path string from a PathPrimitive containing both lines and arcs.
         * @param {PathPrimitive} primitive - The path primitive with arcSegments.
         * @param {number} precision - The number of decimal places for coordinates.
         * @returns {string} The SVG path data string.
         */
        buildPathWithArcs(primitive, precision, exportConfig) {
            const points = primitive.points;
            if (!points || points.length === 0) return '';

            const pathParts = [];
            const sortedArcs = [...primitive.arcSegments].sort((a, b) => a.startIndex - b.startIndex);

            // Start the path at the first point
            pathParts.push(`M${this.formatNumber(points[0].x, precision)},${this.formatNumber(points[0].y, precision)}`);

            let currentIndex = 0;

            // Iterate through the high-level arc segments
            for (const arc of sortedArcs) {
                // Draw all straight line segments from the last position up to the start point of this arc.
                // This is the key fix for the concatenation issue.
                for (let i = currentIndex + 1; i <= arc.startIndex; i++) {
                    pathParts.push(`L${this.formatNumber(points[i].x, precision)},${this.formatNumber(points[i].y, precision)}`);
                }

                // Now, draw the arc command.
                const endPointOfArc = points[arc.endIndex];
                
                let angleSpan = arc.endAngle - arc.startAngle;
                if (arc.clockwise && angleSpan > 0) angleSpan -= 2 * Math.PI;
                if (!arc.clockwise && angleSpan < 0) angleSpan += 2 * Math.PI;

                const largeArc = Math.abs(angleSpan) > Math.PI ? 1 : 0;
                // Invert sweep-flag due to Y-axis flip in SVG transform
                const sweep = !arc.clockwise ? 1 : 0; 

                pathParts.push(`A${this.formatNumber(arc.radius, precision)},${this.formatNumber(arc.radius, precision)} 0 ${largeArc} ${sweep} ${this.formatNumber(endPointOfArc.x, precision)},${this.formatNumber(endPointOfArc.y, precision)}`);

                // Jump the current index past all points that the arc just replaced.
                currentIndex = arc.endIndex;
            }

            // After the last arc, draw any remaining line segments to the end of the path.
            for (let i = currentIndex + 1; i < points.length; i++) {
                pathParts.push(`L${this.formatNumber(points[i].x, precision)},${this.formatNumber(points[i].y, precision)}`);
            }

            if (primitive.closed) {
                pathParts.push('Z');
            }
            
            return pathParts.join(' ');
        }

        /**
         * Builds a simple SVG path string from an array of points (lines only).
         * @param {Array<object>} points - Array of {x, y} points.
         * @param {boolean} closed - Whether to close the path.
         * @param {number} precision - The number of decimal places for coordinates.
         * @returns {string} The SVG path data string.
         */
        buildSimplePath(points, closed, precision) {
            if (!points || points.length === 0) return '';
            let d = `M${this.formatNumber(points[0].x, precision)},${this.formatNumber(points[0].y, precision)}`;
            for (let i = 1; i < points.length; i++) {
                d += ` L${this.formatNumber(points[i].x, precision)},${this.formatNumber(points[i].y, precision)}`;
            }
            if (closed) {
                d += ' Z';
            }
            return d;
        }
        
       circleToSVG(svgNS, primitive, layer, exportConfig) {
            const precision = exportConfig.precision;
            const circle = document.createElementNS(svgNS, 'circle');

            circle.setAttribute('cx', this.formatNumber(primitive.center.x, precision));
            circle.setAttribute('cy', this.formatNumber(primitive.center.y, precision));
            circle.setAttribute('r', this.formatNumber(primitive.radius, precision));

            return circle;
        }
        
        rectangleToSVG(svgNS, primitive, layer, exportConfig) {
            const rect = document.createElementNS(svgNS, 'rect');
            
            rect.setAttribute('x', this.formatNumber(primitive.position.x, precision));
            rect.setAttribute('y', this.formatNumber(primitive.position.y, precision));
            rect.setAttribute('width', this.formatNumber(primitive.width, precision));
            rect.setAttribute('height', this.formatNumber(primitive.height, precision));
            
            return rect;
        }
        
        obroundToSVG(svgNS, primitive, layer, exportConfig) {
            const precision = exportConfig.precision;
            const r = Math.min(primitive.width, primitive.height) / 2;
            const path = document.createElementNS(svgNS, 'path');
            
            let d = '';
            const x = primitive.position.x;
            const y = primitive.position.y;
            const w = primitive.width;
            const h = primitive.height;
            
            if (exportConfig.preserveArcs) {
                if (w > h) {
                    d = `M${this.formatNumber(x + r, precision)},${this.formatNumber(y, precision)}`;
                    d += ` L${this.formatNumber(x + w - r, precision)},${this.formatNumber(y, precision)}`;
                    d += ` A${this.formatNumber(r, precision)},${this.formatNumber(r, precision)} 0 0 1 ${this.formatNumber(x + w - r, precision)},${this.formatNumber(y + h, precision)}`;
                    d += ` L${this.formatNumber(x + r, precision)},${this.formatNumber(y + h, precision)}`;
                    d += ` A${this.formatNumber(r, precision)},${this.formatNumber(r, precision)} 0 0 1 ${this.formatNumber(x + r, precision)},${this.formatNumber(y, precision)}`;
                } else {
                    d = `M${this.formatNumber(x + w, precision)},${this.formatNumber(y + r, precision)}`;
                    d += ` L${this.formatNumber(x + w, precision)},${this.formatNumber(y + h - r, precision)}`;
                    d += ` A${this.formatNumber(r, precision)},${this.formatNumber(r, precision)} 0 0 1 ${this.formatNumber(x, precision)},${this.formatNumber(y + h - r, precision)}`;
                    d += ` L${this.formatNumber(x, precision)},${this.formatNumber(y + r, precision)}`;
                    d += ` A${this.formatNumber(r, precision)},${this.formatNumber(r, precision)} 0 0 1 ${this.formatNumber(x + w, precision)},${this.formatNumber(y + r, precision)}`;
                }
                d += ' Z';
            }
            
            path.setAttribute('d', d);
            
            return path;
        }
        
        // This function handles a standalone ArcPrimitive.
        arcToSVG(svgNS, primitive, layer, exportConfig) {
            const precision = exportConfig.precision;
            const path = document.createElementNS(svgNS, 'path');
            
            let d = '';
            // The preserveArcs option from the config file determines if arcs are preserved
            if (exportConfig.preserveArcs) {
                const startX = primitive.center.x + primitive.radius * Math.cos(primitive.startAngle);
                const startY = primitive.center.y + primitive.radius * Math.sin(primitive.startAngle);
                const endX = primitive.center.x + primitive.radius * Math.cos(primitive.endAngle);
                const endY = primitive.center.y + primitive.radius * Math.sin(primitive.endAngle);

                // Determine large-arc-flag based on the angle span
                let angleSpan = primitive.endAngle - primitive.startAngle;
                if (primitive.clockwise && angleSpan > 0) angleSpan -= 2 * Math.PI;
                if (!primitive.clockwise && angleSpan < 0) angleSpan += 2 * Math.PI;
                
                const largeArc = Math.abs(angleSpan) > Math.PI ? 1 : 0;
                
                // The sweep-flag is 1 for clockwise, 0 for counter-clockwise.
                const sweep = !primitive.clockwise ? 1 : 0;
                
                d = `M${this.formatNumber(startX, precision)},${this.formatNumber(startY, precision)}`;
                d += ` A${this.formatNumber(primitive.radius, precision)},${this.formatNumber(primitive.radius, precision)} 0 ${largeArc} ${sweep} ${this.formatNumber(endX, precision)},${this.formatNumber(endY, precision)}`;
            } else {
                // Fallback: If not preserving arcs, convert to a polygon and create a simple path.
                // This assumes the primitive has a toPolygon method, which it does.
                const polygonPath = primitive.toPolygon();
                d = this.buildSimplePath(polygonPath.points, false, precision);
            }
            
            path.setAttribute('d', d);
            // Note: applyStyles is now called from the parent primitiveToSVG function.
            
            return path;
        }

        /**
         * Retrieves the correct color for a layer or primitive, with multiple fallbacks.
         * @param {object} layer - The layer object from the renderer.
         * @param {object} primitive - The primitive being rendered.
         * @returns {string} A valid CSS color string.
         */
        getExportColor(layer, primitive) {
            // 1. Primary: Use the color explicitly set on the layer object.
            if (layer.color) {
                return layer.color;
            }

            // 2. Fallback for Fused Geo: Use the primitive's stored operation type.
            const opType = primitive.properties?.operationType || layer.type;
            if (opType && config.operations[opType]) {
                return config.operations[opType].color;
            }

            console.log(`[SVG Exporter] getExportColor - Failed to recover layer color`);

        }
        
        applyStyles(element, primitive, layer, isWireframe) {
            const props = primitive.properties || {};
            const color = this.getExportColor(layer, primitive);

            // --- Wireframe Mode: Overrides everything, but respects trace width ---
            if (isWireframe) {
                element.setAttribute('fill', 'none');
                element.setAttribute('stroke', color);
                // If the primitive is a trace, use its actual width. Otherwise, use a thin line.
                if (props.isTrace && props.strokeWidth) {
                    element.setAttribute('stroke-width', props.strokeWidth.toString());
                } else {
                    element.setAttribute('stroke-width', (this.renderer.core.getWireframeStrokeWidth() * 0.5).toFixed(4));
                }
                element.setAttribute('stroke-linecap', 'round');
                return;
            }

            // --- Normal (Solid) Mode Styling ---

            // Case 1: Traces, Cutouts, and other explicitly stroked paths
            if (props.isTrace || layer.type === 'cutout' || (props.stroke && !props.fill)) {
                element.setAttribute('fill', 'none');
                element.setAttribute('stroke', color);
                element.setAttribute('stroke-width', (props.strokeWidth || 0.1).toString());
                element.setAttribute('stroke-linecap', 'round');
            }
            // Case 2: Drill holes (render as a hole with a colored outline)
            else if (props.isDrillHole) {
                element.setAttribute('fill', this.renderer.getBackgroundColor());
                element.setAttribute('stroke', color);
                element.setAttribute('stroke-width', (primitive.radius * 0.1).toFixed(4));
            }
            // Case 3: All other filled shapes (Pads, Regions, Fused Geo)
            else {
                element.setAttribute('fill', color);
                element.setAttribute('stroke', 'none');
                // For fused geometry with holes
                if (primitive.holes && primitive.holes.length > 0) {
                    element.setAttribute('fill-rule', 'evenodd');
                }
            }
        }
        
        calculateExportBounds(exportConfig) {
            const bounds = this.renderer.bounds;
            
            if (!bounds || !isFinite(bounds.width) || !isFinite(bounds.height)) {
                return null;
            }
            
            return {
                minX: bounds.minX,
                minY: bounds.minY,
                maxX: bounds.maxX,
                maxY: bounds.maxY,
                width: bounds.width,
                height: bounds.height
            };
        }
        
        serializeSVG(svg, exportConfig) {
            const serializer = new XMLSerializer();
            let svgString = serializer.serializeToString(svg);
            
            svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgString;
            
            if (exportConfig.compressOutput) {
                svgString = svgString.replace(/>\s+</g, '><').replace(/\s+/g, ' ');
            }
            
            return svgString;
        }
        
        formatNumber(value, precision) {
            return parseFloat(value.toFixed(precision)).toString();
        }
        
        downloadSVG(svgString, filename) {
            const blob = new Blob([svgString], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(blob);
            
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.click();
            
            setTimeout(() => URL.revokeObjectURL(url), 100);
        }
    }
    
    window.SVGExporter = SVGExporter;
})();