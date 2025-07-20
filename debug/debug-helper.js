// Debug Helper for PCB CAM System
// Save as debug/debug-helper.js
// Run these commands in browser console to diagnose issues

class PCBDebugHelper {
    static analyzeGeometry() {
        if (!window.cam) {
            console.error('❌ PCB CAM not initialized');
            return;
        }
        
        console.log('🔍 PCB Geometry Analysis');
        console.log('========================');
        
        // Analyze original layers
        console.log('\n📁 Original Layers:');
        for (const [layerName, polygons] of window.cam.layers.entries()) {
            const types = {};
            polygons.forEach(p => {
                const type = p.properties?.type || 'unknown';
                types[type] = (types[type] || 0) + 1;
            });
            
            console.log(`  ${layerName}: ${polygons.length} total`);
            Object.entries(types).forEach(([type, count]) => {
                console.log(`    ${type}: ${count}`);
            });
        }
        
        // Analyze fused layers
        if (window.cam.fusedLayers.size > 0) {
            console.log('\n🔗 Fused Layers:');
            for (const [layerName, polygons] of window.cam.fusedLayers.entries()) {
                console.log(`  ${layerName}: ${polygons.length} polygons`);
            }
        }
        
        // Bounds analysis
        const allPolygons = Array.from(window.cam.layers.values()).flat();
        if (allPolygons.length > 0) {
            const bounds = PolygonUtils.calculateBounds(allPolygons);
            console.log('\n📐 Overall Bounds:');
            console.log(`  X: ${bounds.minX.toFixed(3)} to ${bounds.maxX.toFixed(3)} mm`);
            console.log(`  Y: ${bounds.minY.toFixed(3)} to ${bounds.maxY.toFixed(3)} mm`);
            console.log(`  Size: ${(bounds.maxX - bounds.minX).toFixed(1)} × ${(bounds.maxY - bounds.minY).toFixed(1)} mm`);
        }
    }
    
    static inspectPolygon(layerName, index = 0) {
        if (!window.cam || !window.cam.layers.has(layerName)) {
            console.error(`❌ Layer ${layerName} not found`);
            this.listLayers();
            return;
        }
        
        const polygons = window.cam.layers.get(layerName);
        if (index >= polygons.length) {
            console.error(`❌ Index ${index} out of range. Layer has ${polygons.length} polygons.`);
            return;
        }
        
        const polygon = polygons[index];
        console.log(`🔍 Polygon ${index} in ${layerName}:`);
        console.log(`  Type: ${polygon.properties?.type || 'unknown'}`);
        console.log(`  Source: ${polygon.properties?.source || 'unknown'}`);
        console.log(`  Aperture: ${polygon.properties?.aperture || 'none'}`);
        console.log(`  Points: ${polygon.points.length}`);
        console.log(`  Valid: ${polygon.isValid()}`);
        console.log(`  Closed: ${polygon.isClosed()}`);
        
        if (polygon.points.length > 0) {
            const bounds = polygon.getBounds();
            console.log(`  Bounds: (${bounds.minX.toFixed(3)}, ${bounds.minY.toFixed(3)}) to (${bounds.maxX.toFixed(3)}, ${bounds.maxY.toFixed(3)})`);
            console.log(`  Area: ${polygon.getArea().toFixed(6)} mm²`);
            
            // Show first few points
            console.log(`  First 3 points:`, polygon.points.slice(0, 3));
        }
    }
    
    static listLayers() {
        if (!window.cam) {
            console.error('❌ PCB CAM not initialized');
            return;
        }
        
        console.log('📁 Available Layers:');
        for (const [layerName, polygons] of window.cam.layers.entries()) {
            console.log(`  ${layerName}: ${polygons.length} polygons`);
        }
    }
    
    static validateSystem() {
        console.log('🔧 System Validation');
        console.log('===================');
        
        // Check core components
        const checks = [
            { name: 'ClipperLib', test: () => typeof ClipperLib !== 'undefined' },
            { name: 'CopperPolygon', test: () => typeof CopperPolygon !== 'undefined' },
            { name: 'PolygonFactory', test: () => typeof PolygonFactory !== 'undefined' },
            { name: 'PolygonFusionEngine', test: () => typeof PolygonFusionEngine !== 'undefined' },
            { name: 'GerberPolygonParser', test: () => typeof GerberPolygonParser !== 'undefined' },
            { name: 'ExcellonPolygonParser', test: () => typeof ExcellonPolygonParser !== 'undefined' },
            { name: 'Main Controller', test: () => window.cam && window.cam.constructor.name === 'PolygonPCBCam' },
            { name: 'Renderer', test: () => window.cam && window.cam.renderer },
            { name: 'Has Data', test: () => window.cam && window.cam.layers.size > 0 }
        ];
        
        checks.forEach(check => {
            const result = check.test();
            console.log(`  ${result ? '✅' : '❌'} ${check.name}`);
        });
    }
    
    static testParser(type = 'gerber') {
        console.log(`🧪 Testing ${type} Parser`);
        console.log('========================');
        
        if (type === 'gerber') {
            const testGerber = `
%FSLAX46Y46*%
%MOMM*%
%ADD10C,0.200000*%
%ADD11R,1.000000X2.000000*%
G01*
D10*
X10000000Y-5000000D02*
X15000000Y-5000000D01*
D11*
X12500000Y-7500000D03*
M02*
            `.trim();
            
            const parser = new GerberPolygonParser({ debug: true });
            const result = parser.parse(testGerber);
            
            console.log(`Result: ${result.polygons.length} polygons`);
            console.log(`Stats:`, result.stats);
            console.log(`Errors:`, result.errors);
            
        } else if (type === 'excellon') {
            const testExcellon = `
M48
METRIC
T1C0.8000
T2C1.2000
%
G90
T1
X12.5Y-7.5
T2
X15.0Y-10.0
M30
            `.trim();
            
            const parser = new ExcellonPolygonParser({ debug: true });
            const result = parser.parse(testExcellon);
            
            console.log(`Result: ${result.holes.length} holes, ${result.polygons.length} polygons`);
            console.log(`Stats:`, result.stats);
            console.log(`Errors:`, result.errors);
        }
    }
    
    static exportDebugData() {
        if (!window.cam) {
            console.error('❌ PCB CAM not initialized');
            return;
        }
        
        const debugData = {
            timestamp: new Date().toISOString(),
            layers: {},
            fusedLayers: {},
            stats: window.cam.stats,
            settings: window.cam.settings.fusion
        };
        
        // Export layer data
        for (const [name, polygons] of window.cam.layers.entries()) {
            debugData.layers[name] = {
                count: polygons.length,
                types: {},
                bounds: PolygonUtils.calculateBounds(polygons)
            };
            
            polygons.forEach(p => {
                const type = p.properties?.type || 'unknown';
                debugData.layers[name].types[type] = (debugData.layers[name].types[type] || 0) + 1;
            });
        }
        
        // Export fused layer data
        for (const [name, polygons] of window.cam.fusedLayers.entries()) {
            debugData.fusedLayers[name] = {
                count: polygons.length,
                bounds: PolygonUtils.calculateBounds(polygons)
            };
        }
        
        console.log('📊 Debug Data:', debugData);
        
        // Download as JSON
        const blob = new Blob([JSON.stringify(debugData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pcb-debug-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log('💾 Debug data exported');
    }
}

// Make available globally
if (typeof window !== 'undefined') {
    window.PCBDebugHelper = PCBDebugHelper;
    
    console.log('🔧 PCB Debug Helper loaded');
    console.log('Available commands:');
    console.log('  PCBDebugHelper.analyzeGeometry() - Analyze all polygon data');
    console.log('  PCBDebugHelper.inspectPolygon(layerName, index) - Inspect specific polygon');
    console.log('  PCBDebugHelper.listLayers() - List all layers');
    console.log('  PCBDebugHelper.validateSystem() - Check system components');
    console.log('  PCBDebugHelper.testParser("gerber"|"excellon") - Test parser with sample data');
    console.log('  PCBDebugHelper.exportDebugData() - Export debug information');
}