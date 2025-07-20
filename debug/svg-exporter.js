// Fixed SVG Exporter for Polygon-Based System

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
    }
    
    // Main export function - generates complete SVG with PCB polygon data
    exportSVG() {
        const svg = [];
        
        // Get polygon data from renderer
        const polygonData = this.collectPolygonData();
        if (!polygonData || polygonData.totalPolygons === 0) {
            console.warn('No polygon data available for export');
            return this.createEmptySVG();
        }
        
        // Calculate bounds from all polygons
        const bounds = this.calculateOverallBounds(polygonData);
        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;
        const margin = Math.max(width, height) * 0.05;
        
        // SVG Header
        this.addSVGHeader(svg, bounds, width, height, margin);
        
        // SVG Styles and background
        this.addSVGStyles(svg);
        this.addBackground(svg, bounds, width, height, margin);
        
        // Grid and coordinate system (optional)
        this.addGrid(svg, bounds, margin);
        this.addOrigin(svg);
        this.addBounds(svg, bounds, width, height);
        
        // Render polygon layers in order
        const renderOrder = ['cutout', 'clear', 'isolation', 'drill'];
        
        renderOrder.forEach(operationType => {
            const layerPolygons = polygonData.layers[operationType];
            if (layerPolygons && layerPolygons.length > 0) {
                svg.push(`<!-- Operation: ${operationType} (${layerPolygons.length} polygons) -->`);
                this.addPolygonLayer(svg, layerPolygons, operationType);
            }
        });
        
        svg.push(`</svg>`);
        
        const svgContent = svg.join('\n');
        
        // Log export info
        console.log(`📄 SVG Export: ${polygonData.totalPolygons} polygons, ${width.toFixed(1)}×${height.toFixed(1)}mm`);
        
        return svgContent;
    }
    
    collectPolygonData() {
        if (!this.renderer || !this.renderer.layerPolygons) {
            return null;
        }
        
        const data = {
            layers: {
                isolation: [],
                clear: [],
                drill: [],
                cutout: []
            },
            totalPolygons: 0
        };
        
        // Collect polygons from renderer
        for (const [operationType, polygons] of this.renderer.layerPolygons.entries()) {
            if (Array.isArray(polygons)) {
                data.layers[operationType] = polygons;
                data.totalPolygons += polygons.length;
            }
        }
        
        return data;
    }
    
    calculateOverallBounds(polygonData) {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        // Check all polygon layers
        for (const operationType in polygonData.layers) {
            const polygons = polygonData.layers[operationType];
            
            for (const polygon of polygons) {
                if (polygon && polygon.getBounds) {
                    const bounds = polygon.getBounds();
                    minX = Math.min(minX, bounds.minX);
                    minY = Math.min(minY, bounds.minY);
                    maxX = Math.max(maxX, bounds.maxX);
                    maxY = Math.max(maxY, bounds.maxY);
                }
            }
        }
        
        // Fallback bounds if no valid polygons
        if (!isFinite(minX)) {
            return { minX: -10, minY: -10, maxX: 10, maxY: 10 };
        }
        
        return { minX, minY, maxX, maxY };
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
        svg.push(`<!-- PCB CAM Polygon Export -->`);
        svg.push(`<!-- Generated: ${new Date().toISOString()} -->`);
        svg.push(`<!-- Bounds: (${bounds.minX.toFixed(3)}, ${bounds.minY.toFixed(3)}) to (${bounds.maxX.toFixed(3)}, ${bounds.maxY.toFixed(3)}) -->`);
        svg.push(`<!-- Dimensions: ${width.toFixed(3)}mm × ${height.toFixed(3)}mm -->`);
        svg.push(`<!-- Y-axis flipped for PCB coordinate system -->`);
        svg.push(``);
    }
    
    addSVGStyles(svg) {
        svg.push(`<defs>`);
        svg.push(`<style><![CDATA[`);
        svg.push(`  .isolation { fill: ${this.colors.isolation}; fill-opacity: 0.8; stroke: ${this.colors.isolation}; stroke-width: 0.01; }`);
        svg.push(`  .clear { fill: ${this.colors.clear}; fill-opacity: 0.6; stroke: ${this.colors.clear}; stroke-width: 0.01; }`);
        svg.push(`  .drill { fill: ${this.colors.drill}; fill-opacity: 0.9; stroke: ${this.colors.drill}; stroke-width: 0.005; }`);
        svg.push(`  .cutout { fill: ${this.colors.cutout}; fill-opacity: 0.7; stroke: ${this.colors.cutout}; stroke-width: 0.02; }`);
        svg.push(`  .grid { stroke: ${this.colors.grid}; stroke-width: 0.005; opacity: 0.3; }`);
        svg.push(`  .bounds { stroke: ${this.colors.bounds}; fill: none; stroke-width: 0.01; stroke-dasharray: 0.5,0.5; }`);
        svg.push(`  .origin { stroke: ${this.colors.origin}; stroke-width: 0.02; }`);
        svg.push(`]]></style>`);
        svg.push(`</defs>`);
    }
    
    addBackground(svg, bounds, width, height, margin) {
        const svgWidth = width + 2 * margin;
        const svgHeight = height + 2 * margin;
        svg.push(`<rect x="${bounds.minX - margin}" y="${-(bounds.maxY + margin)}"`);
        svg.push(`      width="${svgWidth}" height="${svgHeight}"`);
        svg.push(`      fill="${this.colors.background}"/>`);
    }
    
    addGrid(svg, bounds, margin) {
        const gridSpacing = this.calculateGridSpacing(bounds);
        
        svg.push(`<!-- Grid (${gridSpacing}mm spacing) -->`);
        svg.push(`<g class="grid">`);
        
        // Vertical lines
        const startX = Math.floor((bounds.minX - margin) / gridSpacing) * gridSpacing;
        const endX = Math.ceil((bounds.maxX + margin) / gridSpacing) * gridSpacing;
        
        for (let x = startX; x <= endX; x += gridSpacing) {
            svg.push(`  <line x1="${x}" y1="${-(bounds.maxY + margin)}" x2="${x}" y2="${-(bounds.minY - margin)}"/>`);
        }
        
        // Horizontal lines
        const startY = Math.floor((bounds.minY - margin) / gridSpacing) * gridSpacing;
        const endY = Math.ceil((bounds.maxY + margin) / gridSpacing) * gridSpacing;
        
        for (let y = startY; y <= endY; y += gridSpacing) {
            svg.push(`  <line x1="${bounds.minX - margin}" y1="${-y}" x2="${bounds.maxX + margin}" y2="${-y}"/>`);
        }
        
        svg.push(`</g>`);
    }
    
    addOrigin(svg) {
        svg.push(`<!-- Origin -->`);
        svg.push(`<g class="origin">`);
        svg.push(`  <line x1="-5" y1="0" x2="5" y2="0"/>`);
        svg.push(`  <line x1="0" y1="-5" x2="0" y2="5"/>`);
        svg.push(`</g>`);
    }
    
    addBounds(svg, bounds, width, height) {
        svg.push(`<!-- PCB Bounds -->`);
        svg.push(`<rect class="bounds"`);
        svg.push(`      x="${bounds.minX}" y="${-bounds.maxY}"`);
        svg.push(`      width="${width}" height="${height}"/>`);
    }
    
    addPolygonLayer(svg, polygons, operationType) {
        svg.push(`<g class="${operationType}">`);
        
        polygons.forEach((polygon, index) => {
            if (!polygon || !polygon.isValid || !polygon.isValid()) {
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
            svg.push(`        data-area="${area}"`);
            svg.push(`        data-source="${source}"/>`);
        });
        
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
  <!-- No polygon data available -->
  <rect width="100" height="100" fill="#1a1a1a"/>
  <text x="50" y="50" text-anchor="middle" fill="#666" font-family="monospace" font-size="8">
    No polygon data to export
  </text>
</svg>`;
    }
    
    // Download the SVG file
    download(filename = `pcb-polygons-${Date.now()}.svg`) {
        try {
            const svgContent = this.exportSVG();
            
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
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SVGDebugExporter;
} else {
    window.SVGDebugExporter = SVGDebugExporter;
}