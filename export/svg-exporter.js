// export/svg-exporter.js - Refactored with config integration
// SVG exporter that respects canvas state and exports what's actually visible
// Supports dual export when fusion is active (pre/post fusion geometry)

(function() {
    'use strict';
    
    // Get config reference
    const config = window.PCBCAMConfig || {};
    const renderConfig = config.rendering || {};
    const themeConfig = renderConfig.themes || {};
    const opsConfig = config.operations || {};
    const debugConfig = config.debug || {};
    const geomConfig = config.geometry || {};
    
    class SVGExporter {
        constructor(renderer) {
            this.renderer = renderer;
            
            // Options with config defaults
            this.options = {
                precision: config.gcode?.precision?.coordinates || 3,
                padding: 5,
                preserveArcs: geomConfig.preserveArcs !== false,
                optimizePaths: true,
                includeMetadata: true,
                useViewBox: true,
                embedStyles: true,
                compressOutput: false,
                respectCanvasState: true // Export what's visible on canvas
            };
        }
        
        /**
         * Main export function - respects canvas state and fusion mode
         */
        exportSVG(options = {}) {
            const exportConfig = { ...this.options, ...options };
            
            // Check if fusion is active
            const isFusionActive = this.renderer.options.fuseGeometry;
            
            if (isFusionActive && !exportConfig.skipDualExport) {
                return this.exportDualSVG(exportConfig);
            } else {
                return this.exportSingleSVG(exportConfig);
            }
        }
        
/**
         * Export dual SVG files when fusion is active
         */
        exportDualSVG(exportConfig) {
            if (debugConfig.enabled) {
                console.log('Exporting dual SVG (pre/post fusion)...');
            }
            
            // Get geometry processor reference
            const geometryProcessor = this.getGeometryProcessor();
            if (!geometryProcessor) {
                console.warn('Geometry processor not available for dual export');
                return this.exportSingleSVG(exportConfig);
            }
            
            // 1. Export pre-fusion geometry (preprocessed primitives with strokes converted to polygons)
            const preprocessedGeometry = geometryProcessor.getLastPreprocessedGeometry();
            let preFusionString = null;
            
            if (preprocessedGeometry && preprocessedGeometry.length > 0) {
                preFusionString = this.exportPreprocessedGeometry(preprocessedGeometry, {
                    ...exportConfig,
                    filename: 'pcb-preprocessed.svg'
                });
            } else {
                console.warn('No preprocessed geometry available, exporting current canvas state as pre-fusion');
                preFusionString = this.exportSingleSVG({
                    ...exportConfig,
                    filename: 'pcb-prefusion.svg',
                    forceFusionState: false
                });
            }
            
            // 2. Export post-fusion geometry from geometry processor
            const fusedGeometry = geometryProcessor.getLastFusedGeometry();
            let postFusionString = null;
            
            if (fusedGeometry && fusedGeometry.length > 0) {
                postFusionString = this.exportFusedGeometry(fusedGeometry, {
                    ...exportConfig,
                    filename: 'pcb-fused.svg'
                });
            } else {
                console.warn('No fused geometry available, exporting current canvas state as post-fusion');
                postFusionString = this.exportSingleSVG({
                    ...exportConfig,
                    filename: 'pcb-postfusion.svg',
                    forceFusionState: true
                });
            }
            
            return {
                preFusion: preFusionString,
                postFusion: postFusionString
            };
        }
        
        /**
         * Export preprocessed geometry (strokes converted to polygons)
         */
        exportPreprocessedGeometry(primitives, exportConfig) {
            const filename = exportConfig.filename || 'pcb-preprocessed.svg';
            
            if (debugConfig.enabled) {
                console.log(`Exporting preprocessed geometry: ${primitives.length} primitives`);
            }
            
            // Calculate bounds from preprocessed primitives
            const bounds = this.calculatePrimitiveBounds(primitives);
            
            // Create SVG document
            const svg = this.createSVGDocument(bounds, exportConfig);
            
            // Add preprocessed primitives
            const svgNS = 'http://www.w3.org/2000/svg';
            const mainGroup = document.createElementNS(svgNS, 'g');
            mainGroup.setAttribute('id', 'pcb-preprocessed-layers');
            mainGroup.setAttribute('transform', 'scale(1,-1)');
            
            // Apply rotation if present
            const viewState = this.renderer.getViewState();
            if (viewState.rotation !== 0) {
                const center = this.renderer.rotationCenter || { x: 0, y: 0 };
                const transform = mainGroup.getAttribute('transform');
                mainGroup.setAttribute('transform', 
                    `${transform} rotate(${viewState.rotation} ${center.x} ${center.y})`);
            }
            
            // Group primitives by polarity for better organization
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
            
            // Add dark primitives group
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
            
            // Add clear primitives group
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
            
            // Add metadata comment
            const comment = document.createComment(
                ` Preprocessed geometry: ${primitives.length} total (${darkPrimitives.length} dark, ${clearPrimitives.length} clear) `
            );
            svg.insertBefore(comment, svg.firstChild);
            
            // Serialize and download
            const svgString = this.serializeSVG(svg, exportConfig);
            this.downloadSVG(svgString, filename);
            
            return svgString;
        }
        
        /**
         * Export fused geometry (post-boolean operations)
         */
        exportFusedGeometry(primitives, exportConfig) {
            const filename = exportConfig.filename || 'pcb-fused.svg';
            
            if (debugConfig.enabled) {
                console.log(`Exporting fused geometry: ${primitives.length} primitives`);
                
                // Count holes
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
            
            // Calculate bounds from fused primitives
            const bounds = this.calculatePrimitiveBounds(primitives);
            
            // Create SVG document
            const svg = this.createSVGDocument(bounds, exportConfig);
            
            // Add fused primitives
            const svgNS = 'http://www.w3.org/2000/svg';
            const mainGroup = document.createElementNS(svgNS, 'g');
            mainGroup.setAttribute('id', 'pcb-fused-layers');
            mainGroup.setAttribute('transform', 'scale(1,-1)');
            
            // Apply rotation if present
            const viewState = this.renderer.getViewState();
            if (viewState.rotation !== 0) {
                const center = this.renderer.rotationCenter || { x: 0, y: 0 };
                const transform = mainGroup.getAttribute('transform');
                mainGroup.setAttribute('transform', 
                    `${transform} rotate(${viewState.rotation} ${center.x} ${center.y})`);
            }
            
            // Add all fused primitives
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
            
            // Add metadata comment
            let metadataText = ` Fused geometry: ${primitives.length} primitives `;
            const holesCount = primitives.reduce((sum, p) => sum + (p.holes?.length || 0), 0);
            if (holesCount > 0) {
                metadataText += `with ${holesCount} holes `;
            }
            const comment = document.createComment(metadataText);
            svg.insertBefore(comment, svg.firstChild);
            
            // Serialize and download
            const svgString = this.serializeSVG(svg, exportConfig);
            this.downloadSVG(svgString, filename);
            
            return svgString;
        }
        
        /**
         * Export single SVG respecting current canvas state
         */
        exportSingleSVG(exportConfig) {
            const filename = exportConfig.filename || 'pcb-export.svg';
            
            if (debugConfig.logging?.fileOperations) {
                console.log(`Exporting SVG: ${filename}`);
            }
            
            // Get current view state
            const viewState = this.renderer.getViewState();
            const bounds = this.calculateExportBounds(exportConfig);
            
            if (!bounds) {
                console.warn('No content to export');
                return null;
            }
            
            // Create SVG document
            const svg = this.createSVGDocument(bounds, exportConfig);
            
            // Add visible layers respecting canvas state
            const layerGroup = this.createVisibleLayers(svg, viewState, exportConfig);
            svg.appendChild(layerGroup);
            
            // Serialize and download
            const svgString = this.serializeSVG(svg, exportConfig);
            this.downloadSVG(svgString, filename);
            
            return svgString;
        }
        
        /**
         * Get geometry processor from the renderer's coordinate system or cam core
         */
        getGeometryProcessor() {
            // Try to get from cam core first
            if (window.cam && window.cam.core && window.cam.core.geometryProcessor) {
                return window.cam.core.geometryProcessor;
            }
            
            // Fallback to checking renderer's coordinate system
            if (this.renderer.coordinateSystem && this.renderer.coordinateSystem.geometryProcessor) {
                return this.renderer.coordinateSystem.geometryProcessor;
            }
            
            return null;
        }
        
        /**
         * Calculate bounds from an array of primitives
         */
        calculatePrimitiveBounds(primitives) {
            if (!primitives || primitives.length === 0) {
                return { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 };
            }
            
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            
            primitives.forEach(primitive => {
                let bounds;
                
                // Get bounds based on primitive type
                if (typeof primitive.getBounds === 'function') {
                    bounds = primitive.getBounds();
                } else if (primitive.type === 'path' && primitive.points) {
                    // Calculate bounds from points
                    primitive.points.forEach(p => {
                        minX = Math.min(minX, p.x);
                        minY = Math.min(minY, p.y);
                        maxX = Math.max(maxX, p.x);
                        maxY = Math.max(maxY, p.y);
                    });
                    
                    // Include holes in bounds
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
            
            // Fallback to default bounds if nothing found
            if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
                return { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 };
            }
            
            return {
                minX, minY, maxX, maxY,
                width: maxX - minX,
                height: maxY - minY
            };
        }
        
        /**
         * Create SVG document with proper setup
         */
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
        
        /**
         * Create metadata element
         */
        createMetadata(svgNS) {
            const metadata = document.createElementNS(svgNS, 'metadata');
            const desc = document.createElementNS(svgNS, 'desc');
            desc.textContent = `PCB CAM Export - ${new Date().toISOString()}`;
            metadata.appendChild(desc);
            return metadata;
        }
        
        /**
         * Create styles based on current theme and canvas state
         */
        createStyles(svgNS, exportConfig) {
            const defs = document.createElementNS(svgNS, 'defs');
            const style = document.createElementNS(svgNS, 'style');
            style.setAttribute('type', 'text/css');
            
            const theme = themeConfig[this.renderer.options.theme] || themeConfig.dark;
            const colors = theme.layers;
            const isWireframe = this.renderer.options.showWireframe;
            
            let css = '';
            
            if (isWireframe) {
                // Wireframe mode - everything is stroked
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
                // Normal mode - respect fill/stroke
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
        
        /**
         * Create layers respecting visibility settings
         */
        createVisibleLayers(svg, viewState, exportConfig) {
            const svgNS = 'http://www.w3.org/2000/svg';
            const mainGroup = document.createElementNS(svgNS, 'g');
            mainGroup.setAttribute('id', 'pcb-layers');
            mainGroup.setAttribute('transform', 'scale(1,-1)');
            
            // Apply rotation if present
            if (viewState.rotation !== 0) {
                const center = this.renderer.rotationCenter || { x: 0, y: 0 };
                const transform = mainGroup.getAttribute('transform');
                mainGroup.setAttribute('transform', 
                    `${transform} rotate(${viewState.rotation} ${center.x} ${center.y})`);
            }
            
            // Get visible layers and apply canvas filters
            const layers = this.renderer.getVisibleLayers();
            
            layers.forEach((layer, name) => {
                if (this.shouldExportLayer(layer, exportConfig)) {
                    const layerGroup = this.createFilteredLayer(svgNS, layer, name, exportConfig);
                    if (layerGroup) {
                        mainGroup.appendChild(layerGroup);
                    }
                }
            });
            
            return mainGroup;
        }
        
        /**
         * Check if layer should be exported based on canvas state
         */
        shouldExportLayer(layer, exportConfig) {
            if (!layer.visible) return false;
            
            // Force fusion state if specified
            if (exportConfig.forceFusionState !== undefined) {
                if (exportConfig.forceFusionState && !layer.isFused) return false;
                if (!exportConfig.forceFusionState && layer.isFused) return false;
            }
            
            return true;
        }
        
        /**
         * Create layer with canvas state filters applied
         */
        createFilteredLayer(svgNS, layer, name, exportConfig) {
            const group = document.createElementNS(svgNS, 'g');
            group.setAttribute('id', `layer-${name}`);
            group.setAttribute('data-layer-type', layer.type);
            
            // Filter primitives based on canvas visibility settings
            const filteredPrimitives = this.filterPrimitives(layer.primitives, layer.type);
            
            if (filteredPrimitives.length === 0) return null;
            
            // Export filtered primitives
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
        
        /**
         * Filter primitives based on canvas visibility settings
         */
        filterPrimitives(primitives, layerType) {
            const options = this.renderer.options;
            
            return primitives.filter(primitive => {
                const props = primitive.properties || {};
                
                // Apply visibility filters
                if (props.isDrillHole && !options.showDrills) return false;
                if (props.isTrace && !options.showTraces) return false;
                if ((props.isPad || props.isFlash) && !options.showPads) return false;
                if (props.isRegion && !options.showRegions) return false;
                if (props.isCutout && !options.showCutouts) return false;
                
                return true;
            });
        }
        
        /**
         * Convert primitive to SVG element
         */
        primitiveToSVG(svgNS, primitive, layerType, exportConfig, isWireframe) {
            const precision = exportConfig.precision;
            isWireframe = isWireframe || this.renderer.options.showWireframe;
            
            switch (primitive.type) {
                case 'path':
                    return this.pathToSVG(svgNS, primitive, layerType, exportConfig, isWireframe);
                case 'circle':
                    return this.circleToSVG(svgNS, primitive, layerType, precision, isWireframe);
                case 'rectangle':
                    return this.rectangleToSVG(svgNS, primitive, layerType, precision, isWireframe);
                case 'obround':
                    return this.obroundToSVG(svgNS, primitive, layerType, exportConfig, isWireframe);
                case 'arc':
                    return this.arcToSVG(svgNS, primitive, layerType, exportConfig, isWireframe);
                default:
                    return null;
            }
        }
        
        /**
         * Export fused primitive
         */
        fusedPrimitiveToSVG(svgNS, primitive, exportConfig) {
            const path = document.createElementNS(svgNS, 'path');
            const precision = exportConfig.precision;
            
            let d = this.buildSimplePath(primitive.points, primitive.closed !== false, precision);
            
            // Add holes
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
        
        /**
         * Group connected traces
         */
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
        
        /**
         * Find connected traces
         */
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
        
        /**
         * Export grouped traces
         */
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
        
        /**
         * Path to SVG
         */
        pathToSVG(svgNS, primitive, layerType, exportConfig, isWireframe) {
            const path = document.createElementNS(svgNS, 'path');
            const precision = exportConfig.precision;
            
            let d = '';
            if (exportConfig.preserveArcs && primitive.arcSegments?.length > 0) {
                d = this.buildPathWithArcs(primitive, precision, exportConfig);
            } else {
                d = this.buildSimplePath(primitive.points, primitive.closed !== false, precision);
            }
            
            if (primitive.holes && primitive.holes.length > 0) {
                primitive.holes.forEach(hole => {
                    d += ' ' + this.buildSimplePath(hole, true, precision);
                });
                path.setAttribute('fill-rule', 'evenodd');
            }
            
            path.setAttribute('d', d);
            this.applyStyles(path, primitive, layerType, isWireframe);
            
            return path;
        }
        
        /**
         * Circle to SVG
         */
        circleToSVG(svgNS, primitive, layerType, precision, isWireframe) {
            const circle = document.createElementNS(svgNS, 'circle');
            
            circle.setAttribute('cx', this.formatNumber(primitive.center.x, precision));
            circle.setAttribute('cy', this.formatNumber(primitive.center.y, precision));
            circle.setAttribute('r', this.formatNumber(primitive.radius, precision));
            
            this.applyStyles(circle, primitive, layerType, isWireframe);
            
            return circle;
        }
        
        /**
         * Rectangle to SVG
         */
        rectangleToSVG(svgNS, primitive, layerType, precision, isWireframe) {
            const rect = document.createElementNS(svgNS, 'rect');
            
            rect.setAttribute('x', this.formatNumber(primitive.position.x, precision));
            rect.setAttribute('y', this.formatNumber(primitive.position.y, precision));
            rect.setAttribute('width', this.formatNumber(primitive.width, precision));
            rect.setAttribute('height', this.formatNumber(primitive.height, precision));
            
            this.applyStyles(rect, primitive, layerType, isWireframe);
            
            return rect;
        }
        
        /**
         * Obround to SVG
         */
        obroundToSVG(svgNS, primitive, layerType, exportConfig, isWireframe) {
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
            this.applyStyles(path, primitive, layerType, isWireframe);
            
            return path;
        }
        
        /**
         * Arc to SVG
         */
        arcToSVG(svgNS, primitive, layerType, exportConfig, isWireframe) {
            const precision = exportConfig.precision;
            const path = document.createElementNS(svgNS, 'path');
            
            let d = '';
            if (exportConfig.preserveArcs) {
                const startX = primitive.center.x + primitive.radius * Math.cos(primitive.startAngle);
                const startY = primitive.center.y + primitive.radius * Math.sin(primitive.startAngle);
                const endX = primitive.center.x + primitive.radius * Math.cos(primitive.endAngle);
                const endY = primitive.center.y + primitive.radius * Math.sin(primitive.endAngle);
                
                const largeArc = Math.abs(primitive.endAngle - primitive.startAngle) > Math.PI ? 1 : 0;
                const sweep = primitive.clockwise ? 1 : 0;
                
                d = `M${this.formatNumber(startX, precision)},${this.formatNumber(startY, precision)}`;
                d += ` A${this.formatNumber(primitive.radius, precision)},${this.formatNumber(primitive.radius, precision)} 0 ${largeArc} ${sweep} ${this.formatNumber(endX, precision)},${this.formatNumber(endY, precision)}`;
            }
            
            path.setAttribute('d', d);
            this.applyStyles(path, primitive, layerType, isWireframe);
            
            return path;
        }
        
        /**
         * Apply styles based on wireframe mode and properties
         */
        applyStyles(element, primitive, layerType, isWireframe) {
            const props = primitive.properties || {};
            
            let className = `pcb-${layerType}`;
            if (props.isFused) className = 'pcb-fused';
            else if (props.isPreprocessed) className = `pcb-${layerType === 'preprocessed-clear' ? 'preprocessed-clear' : 'preprocessed'}`;
            else if (props.isTrace) className = 'pcb-trace';
            else if (props.isPad || props.isFlash) className = 'pcb-pad';
            else if (props.isDrillHole) className = 'pcb-drill';
            
            element.setAttribute('class', className);
            
            // Override for wireframe mode
            if (isWireframe) {
                element.setAttribute('fill', 'none');
                if (props.strokeWidth) {
                    element.setAttribute('stroke-width', props.strokeWidth.toString());
                }
            } else {
                if (props.fill === false) element.setAttribute('fill', 'none');
                if (props.strokeWidth) element.setAttribute('stroke-width', props.strokeWidth.toString());
            }
        }
        
        /**
         * Build path with arcs
         */
        buildPathWithArcs(primitive, precision, exportConfig) {
            let d = '';
            const points = primitive.points;
            const arcMap = new Map();
            
            primitive.arcSegments.forEach(arc => {
                arcMap.set(arc.startIndex, arc);
            });
            
            for (let i = 0; i < points.length; i++) {
                const point = points[i];
                
                if (i === 0) {
                    d += `M${this.formatNumber(point.x, precision)},${this.formatNumber(point.y, precision)}`;
                } else {
                    const arc = arcMap.get(i - 1);
                    if (arc && exportConfig.preserveArcs) {
                        const endPoint = points[arc.endIndex];
                        const largeArc = Math.abs(arc.endAngle - arc.startAngle) > Math.PI ? 1 : 0;
                        const sweep = arc.clockwise ? 1 : 0;
                        
                        d += ` A${this.formatNumber(arc.radius, precision)},${this.formatNumber(arc.radius, precision)} 0 ${largeArc} ${sweep} ${this.formatNumber(endPoint.x, precision)},${this.formatNumber(endPoint.y, precision)}`;
                        i = arc.endIndex;
                    } else {
                        d += ` L${this.formatNumber(point.x, precision)},${this.formatNumber(point.y, precision)}`;
                    }
                }
            }
            
            if (primitive.closed !== false) d += ' Z';
            
            return d;
        }
        
        /**
         * Build simple path
         */
        buildSimplePath(points, closed, precision) {
            let d = '';
            
            points.forEach((point, i) => {
                if (i === 0) {
                    d += `M${this.formatNumber(point.x, precision)},${this.formatNumber(point.y, precision)}`;
                } else {
                    d += ` L${this.formatNumber(point.x, precision)},${this.formatNumber(point.y, precision)}`;
                }
            });
            
            if (closed) d += ' Z';
            
            return d;
        }
        
        /**
         * Calculate export bounds
         */
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
        
        /**
         * Serialize SVG
         */
        serializeSVG(svg, exportConfig) {
            const serializer = new XMLSerializer();
            let svgString = serializer.serializeToString(svg);
            
            svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgString;
            
            if (exportConfig.compressOutput) {
                svgString = svgString.replace(/>\s+</g, '><').replace(/\s+/g, ' ');
            }
            
            return svgString;
        }
        
        /**
         * Format number
         */
        formatNumber(value, precision) {
            return parseFloat(value.toFixed(precision)).toString();
        }
        
        /**
         * Download SVG
         */
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
    
    // Export
    window.SVGExporter = SVGExporter;
    
})();