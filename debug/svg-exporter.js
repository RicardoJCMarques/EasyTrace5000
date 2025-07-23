// Fixed SVG Exporter - Proper Hole Handling and Canvas State Export

class SVGDebugExporter {
    constructor(renderer) {
        this.renderer = renderer;
        this.colors = {
            isolation: '#00ff00',
            clear: '#ff6600', 
            drill: '#4488ff',
            cutout: '#ff00ff',
            grid: '#333333',
            bounds: '#ff0000',
            origin: '#ffffff',
            background: '#1a1a1a'
        };
        
        this.lightColors = {
            isolation: '#00aa00',
            clear: '#cc4400', 
            drill: '#0066cc',
            cutout: '#cc00cc',
            grid: '#cccccc',
            bounds: '#666666',
            origin: '#000000',
            background: '#ffffff'
        };
    }
    
    // NEW: Export exact canvas state with debug settings
    exportCanvasState(renderState) {
        const svg = this.generateSVGFromCanvasState(renderState);
        
        if (!svg || svg.length < 100) {
            console.error('Generated SVG content is too small, export may have failed');
            return;
        }
        
        this.downloadSVG(svg, `pcb-canvas-export-${Date.now()}.svg`);
        console.log('📁 Canvas state exported as SVG');
    }
    
    // Main export function - generates complete SVG with current canvas state
    generateSVGFromCanvasState(renderState) {
        const svg = [];
        
        // Get consolidated geometry data from renderer
        const geometryData = this.collectConsolidatedGeometry();
        if (!geometryData || geometryData.totalElements === 0) {
            console.warn('No geometry data available for canvas export');
            return this.createEmptySVG();
        }
        
        // Calculate bounds from all geometry
        const bounds = this.calculateOverallBounds(geometryData);
        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;
        const margin = Math.max(width, height) * 0.05;
        
        // Get colors based on theme and debug settings
        const colors = this.getCurrentColors(renderState);
        
        // SVG Header
        this.addSVGHeader(svg, bounds, width, height, margin);
        
        // SVG Styles and background
        this.addSVGStyles(svg, colors, renderState);
        this.addBackground(svg, bounds, width, height, margin, colors);
        
        // Grid and coordinate system (based on render state)
        if (renderState.showGrid) {
            this.addGrid(svg, bounds, margin, colors, renderState.originPosition);
        }
        if (renderState.showOrigin) {
            this.addOrigin(svg, colors, renderState.originPosition);
        }
        if (renderState.showBounds) {
            this.addBounds(svg, bounds, width, height, colors);
        }
        
        // Render operation layers in order
        const renderOrder = ['cutout', 'clear', 'isolation', 'drill'];
        
        renderOrder.forEach(operationType => {
            const layerData = geometryData.operations[operationType];
            if (layerData && (layerData.polygons.length > 0 || layerData.holes.length > 0)) {
                svg.push(`<!-- Operation: ${operationType} (${layerData.polygons.length} polygons, ${layerData.holes.length} holes) -->`);
                this.addOperationLayer(svg, layerData, operationType, colors, renderState);
            }
        });
        
        svg.push(`</svg>`);
        
        const svgContent = svg.join('\n');
        
        // Log export info
        console.log(`📄 Canvas SVG Export: ${geometryData.totalElements} elements, ${width.toFixed(1)}×${height.toFixed(1)}mm`);
        
        return svgContent;
    }
    
    // FIXED: Collect consolidated geometry by operation (matches renderer logic)
    collectConsolidatedGeometry() {
        if (!this.renderer || !this.renderer.operationLayers) {
            return null;
        }
        
        const data = {
            operations: {
                isolation: { polygons: [], holes: [] },
                clear: { polygons: [], holes: [] },
                drill: { polygons: [], holes: [] },
                cutout: { polygons: [], holes: [] }
            },
            totalElements: 0
        };
        
        // Collect consolidated geometry from renderer
        for (const [operationType, layer] of this.renderer.operationLayers.entries()) {
            if (layer && (layer.polygons || layer.holes)) {
                data.operations[operationType] = {
                    polygons: layer.polygons || [],
                    holes: layer.holes || []
                };
                data.totalElements += (layer.polygons ? layer.polygons.length : 0) + (layer.holes ? layer.holes.length : 0);
            }
        }
        
        return data;
    }
    
    calculateOverallBounds(geometryData) {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        // Check all operation layers
        for (const operationType in geometryData.operations) {
            const layer = geometryData.operations[operationType];
            
            // Process polygons
            for (const polygon of layer.polygons) {
                if (polygon && polygon.getBounds) {
                    const bounds = polygon.getBounds();
                    minX = Math.min(minX, bounds.minX);
                    minY = Math.min(minY, bounds.minY);
                    maxX = Math.max(maxX, bounds.maxX);
                    maxY = Math.max(maxY, bounds.maxY);
                } else if (polygon && polygon.points) {
                    // Fallback bounds calculation
                    for (const point of polygon.points) {
                        if (point && typeof point.x === 'number' && typeof point.y === 'number') {
                            minX = Math.min(minX, point.x);
                            minY = Math.min(minY, point.y);
                            maxX = Math.max(maxX, point.x);
                            maxY = Math.max(maxY, point.y);
                        }
                    }
                }
            }
            
            // Process holes
            for (const hole of layer.holes) {
                if (hole && hole.position) {
                    const radius = (hole.diameter || 1) / 2;
                    minX = Math.min(minX, hole.position.x - radius);
                    minY = Math.min(minY, hole.position.y - radius);
                    maxX = Math.max(maxX, hole.position.x + radius);
                    maxY = Math.max(maxY, hole.position.y + radius);
                }
            }
        }
        
        // Fallback bounds if no valid geometry
        if (!isFinite(minX)) {
            return { minX: -10, minY: -10, maxX: 10, maxY: 10 };
        }
        
        return { minX, minY, maxX, maxY };
    }
    
    // Get colors based on current theme and debug settings
    getCurrentColors(renderState) {
        const theme = document.documentElement.getAttribute('data-theme');
        const baseColors = theme === 'light' ? this.lightColors : this.colors;
        
        if (renderState && renderState.blackAndWhite) {
            const bwColor = theme === 'light' ? '#000000' : '#ffffff';
            return {
                ...baseColors,
                isolation: bwColor,
                clear: bwColor,
                drill: bwColor,
                cutout: bwColor
            };
        }
        
        return baseColors;
    }
    
    addSVGHeader(svg, bounds, width, height, margin) {
        const svgWidth = width + 2 * margin;
        const svgHeight = height + 2 * margin;
        
        svg.push(`<?xml version="1.0" encoding="UTF-8"?>`);
        svg.push(`<svg xmlns="http://www.w3.org/2000/svg"`);
        svg.push(`     viewBox="${bounds.minX - margin} ${-(bounds.maxY + margin)} ${svgWidth} ${svgHeight}"`);
        svg.push(`     width="${Math.max(800, width * 10)}"`);
        svg.push(`     height="${Math.max(600, height * 10)}">`);
        
        // Metadata in comments
        svg.push(`<!-- PCB CAM Canvas Export -->`);
        svg.push(`<!-- Generated: ${new Date().toISOString()} -->`);
        svg.push(`<!-- Bounds: (${bounds.minX.toFixed(3)}, ${bounds.minY.toFixed(3)}) to (${bounds.maxX.toFixed(3)}, ${bounds.maxY.toFixed(3)}) -->`);
        svg.push(`<!-- Dimensions: ${width.toFixed(3)}mm × ${height.toFixed(3)}mm -->`);
        svg.push(`<!-- Y-axis flipped for PCB coordinate system -->`);
        svg.push(``);
    }
    
    addSVGStyles(svg, colors, renderState) {
        svg.push(`<defs>`);
        svg.push(`<style><![CDATA[`);
        
        // Base styles for each operation (single color per operation)
        svg.push(`  .isolation { fill: ${colors.isolation}; fill-opacity: ${renderState.showFilled ? '0.8' : '0'}; stroke: ${renderState.showOutlines ? colors.isolation : 'none'}; stroke-width: 0.01; }`);
        svg.push(`  .clear { fill: ${colors.clear}; fill-opacity: ${renderState.showFilled ? '0.6' : '0'}; stroke: ${renderState.showOutlines ? colors.clear : 'none'}; stroke-width: 0.01; }`);
        svg.push(`  .drill { fill: ${colors.drill}; fill-opacity: ${renderState.showFilled ? '0.9' : '0'}; stroke: ${renderState.showOutlines ? colors.drill : 'none'}; stroke-width: 0.005; }`);
        svg.push(`  .cutout { fill: ${colors.cutout}; fill-opacity: ${renderState.showFilled ? '0.7' : '0'}; stroke: ${renderState.showOutlines ? colors.cutout : 'none'}; stroke-width: 0.02; }`);
        
        // Special styles for holes - they should cut out or be distinct
        svg.push(`  .hole { fill: ${colors.background}; stroke: ${colors.drill}; stroke-width: 0.01; }`);
        
        // Grid, bounds, origin
        svg.push(`  .grid { stroke: ${colors.grid}; stroke-width: 0.005; opacity: 0.3; }`);
        svg.push(`  .bounds { stroke: ${colors.bounds}; fill: none; stroke-width: 0.01; stroke-dasharray: 0.5,0.5; }`);
        svg.push(`  .origin { stroke: ${colors.origin}; stroke-width: 0.02; fill: none; }`);
        svg.push(`  .origin-text { fill: ${colors.origin}; font-family: monospace; font-size: 1px; }`);
        
        svg.push(`]]></style>`);
        svg.push(`</defs>`);
    }
    
    addBackground(svg, bounds, width, height, margin, colors) {
        const svgWidth = width + 2 * margin;
        const svgHeight = height + 2 * margin;
        svg.push(`<rect x="${bounds.minX - margin}" y="${-(bounds.maxY + margin)}"`);
        svg.push(`      width="${svgWidth}" height="${svgHeight}"`);
        svg.push(`      fill="${colors.background}"/>`);
    }
    
    addGrid(svg, bounds, margin, colors, originPosition) {
        const gridSpacing = this.calculateGridSpacing(bounds);
        
        svg.push(`<!-- Grid (${gridSpacing}mm spacing, origin at ${originPosition.x.toFixed(1)}, ${originPosition.y.toFixed(1)}) -->`);
        svg.push(`<g class="grid">`);
        
        // Grid relative to origin position
        const originOffset = originPosition || { x: 0, y: 0 };
        
        // Vertical lines
        const startX = Math.floor((bounds.minX - margin - originOffset.x) / gridSpacing) * gridSpacing + originOffset.x;
        const endX = Math.ceil((bounds.maxX + margin - originOffset.x) / gridSpacing) * gridSpacing + originOffset.x;
        
        for (let x = startX; x <= endX; x += gridSpacing) {
            svg.push(`  <line x1="${x}" y1="${-(bounds.maxY + margin)}" x2="${x}" y2="${-(bounds.minY - margin)}"/>`);
        }
        
        // Horizontal lines
        const startY = Math.floor((bounds.minY - margin - originOffset.y) / gridSpacing) * gridSpacing + originOffset.y;
        const endY = Math.ceil((bounds.maxY + margin - originOffset.y) / gridSpacing) * gridSpacing + originOffset.y;
        
        for (let y = startY; y <= endY; y += gridSpacing) {
            svg.push(`  <line x1="${bounds.minX - margin}" y1="${-y}" x2="${bounds.maxX + margin}" y2="${-y}"/>`);
        }
        
        svg.push(`</g>`);
    }
    
    addOrigin(svg, colors, originPosition) {
        const origin = originPosition || { x: 0, y: 0 };
        
        svg.push(`<!-- Origin Marker at (${origin.x.toFixed(2)}, ${origin.y.toFixed(2)}) -->`);
        svg.push(`<g class="origin">`);
        svg.push(`  <line x1="${origin.x - 5}" y1="${-origin.y}" x2="${origin.x + 5}" y2="${-origin.y}"/>`);
        svg.push(`  <line x1="${origin.x}" y1="${-(origin.y - 5)}" x2="${origin.x}" y2="${-(origin.y + 5)}"/>`);
        svg.push(`  <circle cx="${origin.x}" cy="${-origin.y}" r="0.5"/>`);
        svg.push(`  <text x="${origin.x + 1}" y="${-(origin.y - 1)}" class="origin-text">(${origin.x.toFixed(1)}, ${origin.y.toFixed(1)})</text>`);
        svg.push(`</g>`);
    }
    
    addBounds(svg, bounds, width, height, colors) {
        svg.push(`<!-- PCB Bounds -->`);
        svg.push(`<rect class="bounds"`);
        svg.push(`      x="${bounds.minX}" y="${-bounds.maxY}"`);
        svg.push(`      width="${width}" height="${height}"/>`);
    }
    
    // FIXED: Add operation layer with proper hole handling
    addOperationLayer(svg, layerData, operationType, colors, renderState) {
        svg.push(`<g class="${operationType}">`);
        
        // Add all polygons as single group (consolidated appearance)
        layerData.polygons.forEach((polygon, index) => {
            if (!polygon || !this.isPolygonValid(polygon)) {
                svg.push(`  <!-- Invalid polygon ${index} -->`);
                return;
            }
            
            const pathData = this.polygonToSVGPath(polygon);
            if (!pathData) {
                svg.push(`  <!-- Empty polygon ${index} -->`);
                return;
            }
            
            // Add polygon metadata as comments
            const points = polygon.points ? polygon.points.length : 0;
            const area = polygon.getArea ? polygon.getArea().toFixed(6) : 'unknown';
            const source = polygon.properties ? polygon.properties.source : 'unknown';
            
            svg.push(`  <!-- Polygon ${index}: ${points} points, area: ${area}mm², source: ${source} -->`);
            
            // Create SVG path with proper Y-axis flip
            svg.push(`  <path class="${operationType}"`);
            svg.push(`        d="${pathData}"`);
            svg.push(`        data-index="${index}"`);
            svg.push(`        data-points="${points}"`);
            svg.push(`        data-area="${area}"/>`);
        });
        
        // FIXED: Add holes as cutouts or distinct objects
        if (layerData.holes && layerData.holes.length > 0) {
            svg.push(`  <!-- Holes: ${layerData.holes.length} total -->`);
            layerData.holes.forEach((hole, index) => {
                if (hole && hole.position && hole.diameter) {
                    const x = hole.position.x;
                    const y = -hole.position.y; // Flip Y coordinate
                    const radius = hole.diameter / 2;
                    
                    // Create hole as circle with special class
                    svg.push(`  <circle class="hole"`);
                    svg.push(`          cx="${x.toFixed(6)}" cy="${y.toFixed(6)}" r="${radius.toFixed(6)}"`);
                    svg.push(`          data-hole-index="${index}"`);
                    svg.push(`          data-diameter="${hole.diameter.toFixed(3)}mm"`);
                    svg.push(`          data-tool="${hole.tool || 'unknown'}"/>`);
                }
            });
        }
        
        svg.push(`</g>`);
    }
    
    polygonToSVGPath(polygon) {
        if (!polygon.points || polygon.points.length < 3) {
            return '';
        }
        
        const points = polygon.points;
        const pathSegments = [];
        
        // Move to first point (with Y-axis flip)
        const firstPoint = points[0];
        pathSegments.push(`M ${firstPoint.x.toFixed(6)} ${(-firstPoint.y).toFixed(6)}`);
        
        // Line to subsequent points
        for (let i = 1; i < points.length; i++) {
            const point = points[i];
            pathSegments.push(`L ${point.x.toFixed(6)} ${(-point.y).toFixed(6)}`);
        }
        
        // Close path if not already closed
        if (!polygon.isClosed || !polygon.isClosed()) {
            pathSegments.push('Z');
        }
        
        return pathSegments.join(' ');
    }
    
    isPolygonValid(polygon) {
        return polygon && 
               polygon.points && 
               Array.isArray(polygon.points) && 
               polygon.points.length >= 3 &&
               polygon.points.every(p => p && 
                   typeof p.x === 'number' && 
                   typeof p.y === 'number' &&
                   isFinite(p.x) && 
                   isFinite(p.y));
    }
    
    calculateGridSpacing(bounds) {
        const size = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
        
        if (size > 100) return 10;
        if (size > 50) return 5;
        if (size > 20) return 2;
        if (size > 10) return 1;
        if (size > 5) return 0.5;
        return 0.1;
    }
    
    createEmptySVG() {
        return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="400" height="400">
  <!-- No geometry data available -->
  <rect width="100" height="100" fill="#1a1a1a"/>
  <text x="50" y="50" text-anchor="middle" fill="#666" font-family="monospace" font-size="8">
    No geometry data to export
  </text>
</svg>`;
    }
    
    // Download the SVG file
    downloadSVG(svgContent, filename = `pcb-canvas-${Date.now()}.svg`) {
        try {
            if (!svgContent || svgContent.length < 100) {
                console.error('Generated SVG content is too small, export may have failed');
                return;
            }
            
            const blob = new Blob([svgContent], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            URL.revokeObjectURL(url);
            console.log(`📁 Downloaded SVG: ${filename} (${(svgContent.length / 1024).toFixed(1)}KB)`);
        } catch (error) {
            console.error('Error downloading SVG:', error);
            alert('Error downloading SVG file. Check console for details.');
        }
    }
    
    // Legacy methods for compatibility
    exportSVG() {
        // Default export without render state
        return this.generateSVGFromCanvasState({
            showFilled: true,
            showOutlines: true,
            blackAndWhite: false,
            showGrid: false,
            showOrigin: true,
            showBounds: false,
            originPosition: { x: 0, y: 0 }
        });
    }
    
    download(filename = `pcb-export-${Date.now()}.svg`) {
        const svgContent = this.exportSVG();
        this.downloadSVG(svgContent, filename);
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SVGDebugExporter;
} else {
    window.SVGDebugExporter = SVGDebugExporter;
}