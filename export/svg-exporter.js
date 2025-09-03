// export/svg-exporter.js
// SVG exporter with native arc support and geometric preservation

class SVGExporter {
    constructor(renderer) {
        this.renderer = renderer;
        
        this.options = {
            precision: 3,
            padding: 5,
            preserveArcs: true, // Use native SVG arcs where possible
            optimizePaths: true,
            includeMetadata: true,
            useViewBox: true,
            embedStyles: true,
            compressOutput: false
        };
        
        // SVG path optimization settings
        this.pathOptimization = {
            mergeAdjacentPaths: true,
            simplifyPrecision: 0.01,
            removeRedundantPoints: true
        };
    }
    
    /**
     * Export current renderer view as SVG
     */
    exportSVG(options = {}) {
        const config = { ...this.options, ...options };
        
        console.log('Exporting SVG with arc preservation...');
        
        // Get view state and bounds
        const viewState = this.renderer.getViewState();
        const bounds = this.calculateExportBounds(config);
        
        if (!bounds) {
            console.warn('No content to export');
            return null;
        }
        
        // Create SVG document
        const svg = this.createSVGDocument(bounds, config);
        
        // Add layers
        const layerGroup = this.createLayerGroup(svg, viewState, config);
        svg.appendChild(layerGroup);
        
        // Convert to string
        const svgString = this.serializeSVG(svg, config);
        
        // Download file
        this.downloadSVG(svgString, 'pcb-export.svg');
        
        return svgString;
    }
    
    /**
     * Create SVG document with proper setup
     */
    createSVGDocument(bounds, config) {
        const doc = document.implementation.createDocument('http://www.w3.org/2000/svg', 'svg', null);
        const svg = doc.documentElement;
        
        // Calculate dimensions with padding
        const width = bounds.width + config.padding * 2;
        const height = bounds.height + config.padding * 2;
        
        // Set attributes
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
        svg.setAttribute('width', `${width}mm`);
        svg.setAttribute('height', `${height}mm`);
        
        if (config.useViewBox) {
            svg.setAttribute('viewBox', 
                `${bounds.minX - config.padding} ${bounds.minY - config.padding} ${width} ${height}`);
        }
        
        // Add metadata
        if (config.includeMetadata) {
            const metadata = this.createMetadata(doc);
            svg.appendChild(metadata);
        }
        
        // Add styles
        if (config.embedStyles) {
            const defs = this.createDefs(doc);
            svg.appendChild(defs);
        }
        
        return svg;
    }
    
    /**
     * Create metadata element
     */
    createMetadata(doc) {
        const metadata = doc.createElement('metadata');
        
        const desc = doc.createElement('desc');
        desc.textContent = `PCB CAM Export - Generated ${new Date().toISOString()}`;
        metadata.appendChild(desc);
        
        const generator = doc.createElement('generator');
        generator.textContent = 'PCB CAM v7.5 with Clipper2';
        metadata.appendChild(generator);
        
        return metadata;
    }
    
    /**
     * Create defs with styles and patterns
     */
    createDefs(doc) {
        const defs = doc.createElement('defs');
        
        // Add style element
        const style = doc.createElement('style');
        style.setAttribute('type', 'text/css');
        style.textContent = `
            .pcb-isolation { fill: #ff8844; stroke: none; }
            .pcb-clear { fill: #44ff88; stroke: none; }
            .pcb-drill { fill: #4488ff; stroke: none; }
            .pcb-cutout { fill: none; stroke: #ff00ff; stroke-width: 0.1; }
            .pcb-trace { fill: none; stroke: #ff8844; stroke-linecap: round; stroke-linejoin: round; }
            .pcb-pad { fill: #ff8844; stroke: none; }
            .pcb-arc { fill: none; stroke-linecap: round; }
        `;
        defs.appendChild(style);
        
        return defs;
    }
    
    /**
     * Create layer group with all content
     */
    createLayerGroup(svg, viewState, config) {
        const doc = svg.ownerDocument;
        const mainGroup = doc.createElement('g');
        mainGroup.setAttribute('id', 'pcb-layers');
        
        // Apply transformations if needed
        if (viewState.rotation !== 0) {
            const center = this.renderer.rotationCenter || { x: 0, y: 0 };
            mainGroup.setAttribute('transform', 
                `rotate(${viewState.rotation} ${center.x} ${center.y})`);
        }
        
        // Process each layer
        const layers = this.renderer.getVisibleLayers();
        layers.forEach((layer, name) => {
            const layerGroup = this.createLayer(doc, layer, name, config);
            if (layerGroup) {
                mainGroup.appendChild(layerGroup);
            }
        });
        
        return mainGroup;
    }
    
    /**
     * Create individual layer
     */
    createLayer(doc, layer, name, config) {
        if (!layer.visible || !layer.primitives || layer.primitives.length === 0) {
            return null;
        }
        
        const group = doc.createElement('g');
        group.setAttribute('id', `layer-${name}`);
        group.setAttribute('data-layer-type', layer.type);
        
        // Process primitives
        layer.primitives.forEach(primitive => {
            const element = this.primitiveToSVG(doc, primitive, layer.type, config);
            if (element) {
                group.appendChild(element);
            }
        });
        
        return group;
    }
    
    /**
     * Convert primitive to SVG element with arc preservation
     */
    primitiveToSVG(doc, primitive, layerType, config) {
        const precision = config.precision;
        
        switch (primitive.type) {
            case 'path':
                return this.pathToSVG(doc, primitive, layerType, config);
            
            case 'circle':
                return this.circleToSVG(doc, primitive, layerType, precision);
            
            case 'rectangle':
                return this.rectangleToSVG(doc, primitive, layerType, precision);
            
            case 'obround':
                return this.obroundToSVG(doc, primitive, layerType, config);
            
            case 'arc':
                return this.arcToSVG(doc, primitive, layerType, config);
            
            default:
                console.warn(`Unknown primitive type: ${primitive.type}`);
                return null;
        }
    }
    
    /**
     * Convert path to SVG with arc segment preservation
     */
    pathToSVG(doc, primitive, layerType, config) {
        const path = doc.createElement('path');
        const precision = config.precision;
        
        // Build path data
        let d = '';
        
        // Check for arc segments
        if (config.preserveArcs && primitive.arcSegments && primitive.arcSegments.length > 0) {
            d = this.buildPathWithArcs(primitive, precision);
        } else {
            d = this.buildSimplePath(primitive.points, primitive.closed, precision);
        }
        
        // Handle holes using compound paths
        if (primitive.holes && primitive.holes.length > 0) {
            primitive.holes.forEach(hole => {
                d += ' ' + this.buildSimplePath(hole, true, precision);
            });
            path.setAttribute('fill-rule', 'evenodd');
        }
        
        path.setAttribute('d', d);
        
        // Apply styles based on properties
        this.applyPrimitiveStyles(path, primitive, layerType);
        
        return path;
    }
    
    /**
     * Build path with preserved arc segments
     */
    buildPathWithArcs(primitive, precision) {
        let d = '';
        const points = primitive.points;
        const arcSegments = primitive.arcSegments;
        
        // Create a map of arc segments by start index
        const arcMap = new Map();
        arcSegments.forEach(arc => {
            arcMap.set(arc.startIndex, arc);
        });
        
        for (let i = 0; i < points.length; i++) {
            const point = points[i];
            
            if (i === 0) {
                d += `M${this.formatNumber(point.x, precision)},${this.formatNumber(point.y, precision)}`;
            } else {
                // Check if this segment is an arc
                const arc = arcMap.get(i - 1);
                if (arc && config.preserveArcs) {
                    // Use SVG arc command
                    const endPoint = points[arc.endIndex];
                    const largeArc = Math.abs(arc.endAngle - arc.startAngle) > Math.PI ? 1 : 0;
                    const sweep = arc.clockwise ? 1 : 0;
                    
                    d += ` A${this.formatNumber(arc.radius, precision)},${this.formatNumber(arc.radius, precision)} 0 ${largeArc} ${sweep} ${this.formatNumber(endPoint.x, precision)},${this.formatNumber(endPoint.y, precision)}`;
                    
                    // Skip to end of arc
                    i = arc.endIndex;
                } else {
                    // Regular line segment
                    d += ` L${this.formatNumber(point.x, precision)},${this.formatNumber(point.y, precision)}`;
                }
            }
        }
        
        if (primitive.closed) {
            d += ' Z';
        }
        
        return d;
    }
    
    /**
     * Build simple path without arcs
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
        
        if (closed) {
            d += ' Z';
        }
        
        return d;
    }
    
    /**
     * Convert circle to native SVG circle element
     */
    circleToSVG(doc, primitive, layerType, precision) {
        const circle = doc.createElement('circle');
        
        circle.setAttribute('cx', this.formatNumber(primitive.center.x, precision));
        circle.setAttribute('cy', this.formatNumber(primitive.center.y, precision));
        circle.setAttribute('r', this.formatNumber(primitive.radius, precision));
        
        // Preserve geometric context
        if (primitive.geometricContext) {
            circle.setAttribute('data-geometric-type', 'analytic-circle');
        }
        
        this.applyPrimitiveStyles(circle, primitive, layerType);
        
        return circle;
    }
    
    /**
     * Convert rectangle to native SVG rect element
     */
    rectangleToSVG(doc, primitive, layerType, precision) {
        const rect = doc.createElement('rect');
        
        rect.setAttribute('x', this.formatNumber(primitive.position.x, precision));
        rect.setAttribute('y', this.formatNumber(primitive.position.y, precision));
        rect.setAttribute('width', this.formatNumber(primitive.width, precision));
        rect.setAttribute('height', this.formatNumber(primitive.height, precision));
        
        this.applyPrimitiveStyles(rect, primitive, layerType);
        
        return rect;
    }
    
    /**
     * Convert obround to SVG with arc preservation
     */
    obroundToSVG(doc, primitive, layerType, config) {
        const precision = config.precision;
        const r = Math.min(primitive.width, primitive.height) / 2;
        
        // Create path with rounded ends
        const path = doc.createElement('path');
        let d = '';
        
        const x = primitive.position.x;
        const y = primitive.position.y;
        const w = primitive.width;
        const h = primitive.height;
        
        if (config.preserveArcs) {
            // Use native arc commands for rounded ends
            if (w > h) {
                // Horizontal obround
                d = `M${this.formatNumber(x + r, precision)},${this.formatNumber(y, precision)}`;
                d += ` L${this.formatNumber(x + w - r, precision)},${this.formatNumber(y, precision)}`;
                d += ` A${this.formatNumber(r, precision)},${this.formatNumber(r, precision)} 0 0 1 ${this.formatNumber(x + w - r, precision)},${this.formatNumber(y + h, precision)}`;
                d += ` L${this.formatNumber(x + r, precision)},${this.formatNumber(y + h, precision)}`;
                d += ` A${this.formatNumber(r, precision)},${this.formatNumber(r, precision)} 0 0 1 ${this.formatNumber(x + r, precision)},${this.formatNumber(y, precision)}`;
            } else {
                // Vertical obround
                d = `M${this.formatNumber(x + w, precision)},${this.formatNumber(y + r, precision)}`;
                d += ` L${this.formatNumber(x + w, precision)},${this.formatNumber(y + h - r, precision)}`;
                d += ` A${this.formatNumber(r, precision)},${this.formatNumber(r, precision)} 0 0 1 ${this.formatNumber(x, precision)},${this.formatNumber(y + h - r, precision)}`;
                d += ` L${this.formatNumber(x, precision)},${this.formatNumber(y + r, precision)}`;
                d += ` A${this.formatNumber(r, precision)},${this.formatNumber(r, precision)} 0 0 1 ${this.formatNumber(x + w, precision)},${this.formatNumber(y + r, precision)}`;
            }
            d += ' Z';
        } else {
            // Convert to polygon if arc preservation is disabled
            const polygon = primitive.toPolygon();
            d = this.buildSimplePath(polygon.points, true, precision);
        }
        
        path.setAttribute('d', d);
        
        // Preserve geometric context
        if (primitive.geometricContext) {
            path.setAttribute('data-geometric-type', 'analytic-obround');
        }
        
        this.applyPrimitiveStyles(path, primitive, layerType);
        
        return path;
    }
    
    /**
     * Convert arc to SVG path with native arc command
     */
    arcToSVG(doc, primitive, layerType, config) {
        const precision = config.precision;
        const path = doc.createElement('path');
        
        let d = '';
        
        if (config.preserveArcs) {
            // Use native SVG arc
            const largeArc = Math.abs(primitive.endAngle - primitive.startAngle) > Math.PI ? 1 : 0;
            const sweep = primitive.clockwise ? 1 : 0;
            
            d = `M${this.formatNumber(primitive.startPoint.x, precision)},${this.formatNumber(primitive.startPoint.y, precision)}`;
            d += ` A${this.formatNumber(primitive.radius, precision)},${this.formatNumber(primitive.radius, precision)} 0 ${largeArc} ${sweep} ${this.formatNumber(primitive.endPoint.x, precision)},${this.formatNumber(primitive.endPoint.y, precision)}`;
        } else {
            // Convert to polyline
            const polygon = primitive.toPolygon();
            d = this.buildSimplePath(polygon.points, false, precision);
        }
        
        path.setAttribute('d', d);
        path.setAttribute('class', 'pcb-arc');
        
        // Preserve geometric context
        if (primitive.geometricContext) {
            path.setAttribute('data-geometric-type', 'analytic-arc');
            path.setAttribute('data-radius', primitive.radius);
        }
        
        this.applyPrimitiveStyles(path, primitive, layerType);
        
        return path;
    }
    
    /**
     * Apply styles to SVG element based on primitive properties
     */
    applyPrimitiveStyles(element, primitive, layerType) {
        const props = primitive.properties || {};
        
        // Set class based on layer type
        let className = `pcb-${layerType}`;
        if (props.isTrace) className = 'pcb-trace';
        if (props.isPad || props.isFlash) className = 'pcb-pad';
        if (props.isDrillHole) className = 'pcb-drill';
        
        element.setAttribute('class', className);
        
        // Override with inline styles if needed
        if (props.fill === false) {
            element.setAttribute('fill', 'none');
        }
        
        if (props.stroke === false) {
            element.setAttribute('stroke', 'none');
        }
        
        if (props.strokeWidth) {
            element.setAttribute('stroke-width', props.strokeWidth);
        }
        
        // Add data attributes for additional context
        if (props.operationType) {
            element.setAttribute('data-operation', props.operationType);
        }
        
        if (props.isFused) {
            element.setAttribute('data-fused', 'true');
        }
    }
    
    /**
     * Calculate bounds for export
     */
    calculateExportBounds(config) {
        const bounds = this.renderer.bounds;
        
        if (!bounds || !isFinite(bounds.width) || !isFinite(bounds.height)) {
            console.warn('Invalid bounds for export');
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
     * Serialize SVG to string
     */
    serializeSVG(svg, config) {
        const serializer = new XMLSerializer();
        let svgString = serializer.serializeToString(svg);
        
        // Add XML declaration
        svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgString;
        
        // Optionally compress output
        if (config.compressOutput) {
            svgString = this.compressSVG(svgString);
        }
        
        return svgString;
    }
    
    /**
     * Basic SVG compression
     */
    compressSVG(svgString) {
        // Remove unnecessary whitespace
        svgString = svgString.replace(/>\s+</g, '><');
        svgString = svgString.replace(/\s+/g, ' ');
        
        // Remove comments
        svgString = svgString.replace(/<!--.*?-->/g, '');
        
        return svgString;
    }
    
    /**
     * Format number with precision
     */
    formatNumber(value, precision) {
        return parseFloat(value.toFixed(precision)).toString();
    }
    
    /**
     * Download SVG file
     */
    downloadSVG(svgString, filename) {
        const blob = new Blob([svgString], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        
        // Clean up
        setTimeout(() => URL.revokeObjectURL(url), 100);
    }
    
    /**
     * Export with statistics
     */
    exportWithStats(options = {}) {
        const startTime = performance.now();
        
        const svgString = this.exportSVG(options);
        
        const endTime = performance.now();
        const exportTime = endTime - startTime;
        
        // Calculate statistics
        const stats = {
            exportTime: exportTime,
            fileSize: svgString ? svgString.length : 0,
            fileSizeKB: svgString ? (svgString.length / 1024).toFixed(2) : 0,
            preservedArcs: this.countPreservedArcs(svgString),
            totalElements: this.countSVGElements(svgString)
        };
        
        console.log('SVG Export Statistics:');
        console.log(`  Export time: ${stats.exportTime.toFixed(1)}ms`);
        console.log(`  File size: ${stats.fileSizeKB}KB`);
        console.log(`  Preserved arcs: ${stats.preservedArcs}`);
        console.log(`  Total elements: ${stats.totalElements}`);
        
        return { svgString, stats };
    }
    
    /**
     * Count preserved arc commands in SVG
     */
    countPreservedArcs(svgString) {
        if (!svgString) return 0;
        const matches = svgString.match(/\sA[\d\s\.,\-]+/g);
        return matches ? matches.length : 0;
    }
    
    /**
     * Count total SVG elements
     */
    countSVGElements(svgString) {
        if (!svgString) return 0;
        const matches = svgString.match(/<(path|circle|rect|g|line|ellipse|polygon)[^>]*>/g);
        return matches ? matches.length : 0;
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SVGExporter;
} else {
    window.SVGExporter = SVGExporter;
}