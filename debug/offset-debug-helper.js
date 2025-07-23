// Offset Debug Helper - Testing and Validation Script
// Run these commands in browser console to test offset functionality
// Save as debug/offset-debug-helper.js

class OffsetDebugHelper {
    static async testOffsetGeneration() {
        console.log('🧪 Testing Offset Generation System');
        console.log('==================================');
        
        if (!window.cam) {
            console.error('❌ PCB CAM not initialized');
            return;
        }
        
        const operations = window.cam.operations;
        if (operations.length === 0) {
            console.error('❌ No operations loaded. Please load some PCB files first.');
            return;
        }
        
        console.log(`📁 Found ${operations.length} operations:`);
        operations.forEach(op => {
            const polygonCount = op.polygons ? op.polygons.length : 0;
            const holeCount = op.holes ? op.holes.length : 0;
            console.log(`  ${op.id}: ${op.type} - ${polygonCount} polygons, ${holeCount} holes`);
        });
        
        // Test each operation that supports offsets
        const offsetOperations = operations.filter(op => 
            ['isolation', 'clear', 'cutout'].includes(op.type) && 
            op.polygons && 
            op.polygons.length > 0
        );
        
        if (offsetOperations.length === 0) {
            console.warn('⚠️ No operations found that support offset generation');
            return;
        }
        
        console.log(`\n🎯 Testing offset generation for ${offsetOperations.length} operations...`);
        
        for (const operation of offsetOperations) {
            await this.testSingleOperation(operation);
        }
        
        console.log('\n📊 Offset Testing Complete');
        this.showOffsetSummary();
    }
    
    static async testSingleOperation(operation) {
        console.log(`\n🔧 Testing operation ${operation.id} (${operation.type})`);
        console.log(`   File: ${operation.file.name}`);
        console.log(`   Polygons: ${operation.polygons.length}`);
        console.log(`   Settings:`, operation.settings);
        
        try {
            const startTime = performance.now();
            const result = await window.cam.generateOffsetGeometry(operation.id);
            const endTime = performance.now();
            
            if (result && result.success) {
                console.log(`✅ Offset generation successful (${(endTime - startTime).toFixed(1)}ms)`);
                console.log(`   Tool diameter: ${result.toolDiameter}mm`);
                
                if (result.passes) {
                    console.log(`   Passes: ${result.passes.length}`);
                    result.passes.forEach((pass, index) => {
                        console.log(`     Pass ${pass.passNumber}: ${pass.polygons.length} polygons, ${pass.length.toFixed(2)}mm length`);
                    });
                } else if (result.toolpaths) {
                    console.log(`   Toolpaths: ${result.toolpaths.length}`);
                    console.log(`   Total length: ${result.totalLength.toFixed(2)}mm`);
                }
                
                if (result.warnings && result.warnings.length > 0) {
                    console.log(`   Warnings: ${result.warnings.length}`);
                    result.warnings.forEach(warning => console.log(`     ⚠️ ${warning}`));
                }
                
                // Verify renderer integration
                this.verifyRendererIntegration(operation.id);
                
            } else {
                console.error(`❌ Offset generation failed`);
                console.error(`   Error: ${result?.error || 'Unknown error'}`);
                
                if (result?.suggestions) {
                    console.log(`   Suggestions:`);
                    result.suggestions.forEach(suggestion => console.log(`     💡 ${suggestion}`));
                }
            }
            
        } catch (error) {
            console.error(`💥 Exception during offset generation:`);
            console.error(`   ${error.message}`);
            console.error(error.stack);
        }
    }
    
    static verifyRendererIntegration(operationId) {
        if (!window.cam.renderer) {
            console.warn('   ⚠️ Renderer not available - offset visualization not tested');
            return;
        }
        
        const offsetLayers = window.cam.renderer.offsetLayers;
        if (offsetLayers.has(operationId)) {
            const offsetPolygons = offsetLayers.get(operationId);
            console.log(`   🎨 Renderer integration: ${offsetPolygons.length} offset polygons loaded`);
        } else {
            console.warn(`   ⚠️ Renderer integration: No offset data found for ${operationId}`);
        }
    }
    
    static showOffsetSummary() {
        if (!window.cam.offsetResults || window.cam.offsetResults.size === 0) {
            console.log('📊 No offset results to summarize');
            return;
        }
        
        console.log('📊 Offset Generation Summary:');
        console.log('============================');
        
        let totalOperations = 0;
        let successfulOperations = 0;
        let totalPasses = 0;
        let totalLength = 0;
        
        for (const [operationId, result] of window.cam.offsetResults.entries()) {
            totalOperations++;
            if (result.success) {
                successfulOperations++;
                
                if (result.passes) {
                    totalPasses += result.passes.length;
                    totalLength += result.totalLength || 0;
                } else if (result.toolpaths) {
                    totalPasses += result.toolpaths.length;
                    totalLength += result.totalLength || 0;
                }
            }
        }
        
        console.log(`Operations tested: ${totalOperations}`);
        console.log(`Successful: ${successfulOperations}`);
        console.log(`Failed: ${totalOperations - successfulOperations}`);
        console.log(`Total toolpaths generated: ${totalPasses}`);
        console.log(`Total cutting length: ${totalLength.toFixed(2)}mm`);
        
        if (successfulOperations > 0) {
            console.log(`Average length per operation: ${(totalLength / successfulOperations).toFixed(2)}mm`);
        }
    }
    
    static testSpecificSettings() {
        console.log('🎛️ Testing Different Tool Settings');
        console.log('=================================');
        
        if (!window.cam || window.cam.operations.length === 0) {
            console.error('❌ No operations loaded');
            return;
        }
        
        // Find first isolation operation
        const isolationOp = window.cam.operations.find(op => op.type === 'isolation' && op.polygons.length > 0);
        if (!isolationOp) {
            console.error('❌ No isolation operation found for testing');
            return;
        }
        
        console.log(`Using operation: ${isolationOp.id} (${isolationOp.file.name})`);
        
        // Test different tool diameters
        const testDiameters = [0.1, 0.2, 0.5, 1.0];
        const originalDiameter = isolationOp.settings.tool.diameter;
        
        testDiameters.forEach(async (diameter) => {
            console.log(`\n🔧 Testing tool diameter: ${diameter}mm`);
            
            // Temporarily change tool diameter
            isolationOp.settings.tool.diameter = diameter;
            
            try {
                const result = await window.cam.generateOffsetGeometry(isolationOp.id);
                
                if (result && result.success) {
                    console.log(`   ✅ Success: ${result.passes?.length || result.toolpaths?.length || 0} paths`);
                    if (result.totalLength) {
                        console.log(`   📏 Length: ${result.totalLength.toFixed(2)}mm`);
                    }
                } else {
                    console.log(`   ❌ Failed: ${result?.error || 'Unknown error'}`);
                }
            } catch (error) {
                console.log(`   💥 Exception: ${error.message}`);
            }
        });
        
        // Restore original diameter
        isolationOp.settings.tool.diameter = originalDiameter;
        console.log(`\n🔄 Restored original tool diameter: ${originalDiameter}mm`);
    }
    
    static analyzeOffsetQuality() {
        console.log('🔍 Analyzing Offset Quality');
        console.log('===========================');
        
        if (!window.cam.offsetResults || window.cam.offsetResults.size === 0) {
            console.error('❌ No offset results to analyze. Run testOffsetGeneration() first.');
            return;
        }
        
        for (const [operationId, result] of window.cam.offsetResults.entries()) {
            if (!result.success) continue;
            
            console.log(`\n📋 Operation ${operationId}:`);
            
            if (result.passes) {
                result.passes.forEach((pass, index) => {
                    this.analyzePassQuality(pass, index + 1);
                });
            }
        }
    }
    
    static analyzePassQuality(pass, passNumber) {
        console.log(`  Pass ${passNumber}:`);
        console.log(`    Polygons: ${pass.polygons.length}`);
        console.log(`    Offset distance: ${pass.offsetDistance.toFixed(3)}mm`);
        console.log(`    Length: ${pass.length.toFixed(2)}mm`);
        
        // Check for potential issues
        const issues = [];
        
        // Check for very small polygons (potential artifacts)
        const smallPolygons = pass.polygons.filter(p => {
            const area = this.getPolygonArea(p);
            return area < 0.01; // Less than 0.01 mm²
        });
        
        if (smallPolygons.length > 0) {
            issues.push(`${smallPolygons.length} very small polygons (< 0.01mm²)`);
        }
        
        // Check for self-intersections
        const selfIntersecting = pass.polygons.filter(p => this.hasSelfIntersections(p));
        if (selfIntersecting.length > 0) {
            issues.push(`${selfIntersecting.length} self-intersecting polygons`);
        }
        
        // Check for degenerate polygons
        const degenerate = pass.polygons.filter(p => !p.points || p.points.length < 3);
        if (degenerate.length > 0) {
            issues.push(`${degenerate.length} degenerate polygons`);
        }
        
        if (issues.length > 0) {
            console.log(`    ⚠️ Issues found:`);
            issues.forEach(issue => console.log(`      ${issue}`));
        } else {
            console.log(`    ✅ No quality issues detected`);
        }
        
        if (pass.warnings && pass.warnings.length > 0) {
            console.log(`    ⚠️ Warnings:`);
            pass.warnings.forEach(warning => console.log(`      ${warning}`));
        }
    }
    
    static getPolygonArea(polygon) {
        if (!polygon.points || polygon.points.length < 3) return 0;
        
        if (polygon.getArea && typeof polygon.getArea === 'function') {
            return Math.abs(polygon.getArea());
        }
        
        // Fallback area calculation
        let area = 0;
        const points = polygon.points;
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            if (p1 && p2) {
                area += (p1.x * p2.y - p2.x * p1.y);
            }
        }
        return Math.abs(area) / 2;
    }
    
    static hasSelfIntersections(polygon) {
        // Simple self-intersection check
        if (!polygon.points || polygon.points.length < 4) return false;
        
        const points = polygon.points;
        
        for (let i = 0; i < points.length - 1; i++) {
            for (let j = i + 2; j < points.length - 1; j++) {
                if (Math.abs(i - j) <= 1) continue; // Skip adjacent edges
                
                const p1 = points[i];
                const p2 = points[i + 1];
                const p3 = points[j];
                const p4 = points[j + 1];
                
                if (this.lineSegmentsIntersect(p1, p2, p3, p4)) {
                    return true;
                }
            }
        }
        
        return false;
    }
    
    static lineSegmentsIntersect(p1, p2, p3, p4) {
        const x1 = p1.x, y1 = p1.y;
        const x2 = p2.x, y2 = p2.y;
        const x3 = p3.x, y3 = p3.y;
        const x4 = p4.x, y4 = p4.y;
        
        const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        if (Math.abs(denom) < 1e-10) return false; // Parallel lines
        
        const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
        const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
        
        return t >= 0 && t <= 1 && u >= 0 && u <= 1;
    }
    
    static exportOffsetDebugSVG() {
        console.log('📁 Exporting Offset Debug SVG');
        console.log('=============================');
        
        if (!window.cam.renderer) {
            console.error('❌ Renderer not available');
            return;
        }
        
        if (!window.cam.renderer.svgExporter) {
            console.error('❌ SVG exporter not available');
            return;
        }
        
        try {
            // Export with all debug options enabled
            const debugRenderState = {
                showFilled: true,
                showOutlines: true,
                blackAndWhite: false,
                showGrid: true,
                showOrigin: true,
                showBounds: true,
                showOffsets: true,
                showOriginal: true,
                offsetOnly: false,
                originPosition: window.cam.renderer.originPosition
            };
            
            window.cam.renderer.svgExporter.exportCanvasState(debugRenderState);
            console.log('✅ Debug SVG exported successfully');
            console.log('   Check your downloads folder for the SVG file');
            
        } catch (error) {
            console.error('❌ SVG export failed:', error.message);
        }
    }
    
    static clearOffsetCache() {
        console.log('🧹 Clearing Offset Cache');
        console.log('========================');
        
        if (window.cam.offsetResults) {
            const count = window.cam.offsetResults.size;
            window.cam.offsetResults.clear();
            console.log(`✅ Cleared ${count} offset results`);
        }
        
        if (window.cam.renderer && window.cam.renderer.offsetLayers) {
            const count = window.cam.renderer.offsetLayers.size;
            window.cam.renderer.offsetLayers.clear();
            console.log(`✅ Cleared ${count} renderer offset layers`);
        }
        
        if (window.cam.offsetEngine && window.cam.offsetEngine.clearCache) {
            window.cam.offsetEngine.clearCache();
            console.log('✅ Cleared offset engine cache');
        }
        
        // Mark operations as not having offsets generated
        if (window.cam.operations) {
            window.cam.operations.forEach(op => {
                op.offsetGenerated = false;
            });
            console.log(`✅ Reset offset status for ${window.cam.operations.length} operations`);
        }
        
        // Re-render to update UI
        if (window.cam.renderAllOperations) {
            window.cam.renderAllOperations();
        }
        
        if (window.cam.renderer && window.cam.renderer.render) {
            window.cam.renderer.render();
        }
        
        console.log('🔄 Cache cleared and UI updated');
    }
    
    static showQuickHelp() {
        console.log('🎯 Offset Debug Helper - Quick Reference');
        console.log('=======================================');
        console.log('');
        console.log('Main Testing Commands:');
        console.log('  OffsetDebugHelper.testOffsetGeneration()    - Test all loaded operations');
        console.log('  OffsetDebugHelper.testSpecificSettings()    - Test different tool sizes');
        console.log('  OffsetDebugHelper.analyzeOffsetQuality()    - Check offset quality');
        console.log('');
        console.log('Debug and Export:');
        console.log('  OffsetDebugHelper.exportOffsetDebugSVG()    - Export debug SVG');
        console.log('  OffsetDebugHelper.showOffsetSummary()       - Show results summary');
        console.log('');
        console.log('Cleanup:');
        console.log('  OffsetDebugHelper.clearOffsetCache()        - Clear all offset data');
        console.log('');
        console.log('Manual Testing:');
        console.log('  window.cam.generateOffsetGeometry("op_1")   - Test specific operation');
        console.log('  window.cam.renderer.exportCanvasAsSVG()     - Export current view');
        console.log('');
        console.log('General Debug:');
        console.log('  PCBDebugHelper.analyzeGeometry()            - Analyze loaded geometry');
        console.log('  PCBDebugHelper.validateSystem()             - Check system status');
    }
}

// Make available globally
if (typeof window !== 'undefined') {
    window.OffsetDebugHelper = OffsetDebugHelper;
    
    console.log('🔧 Offset Debug Helper loaded');
    console.log('Run OffsetDebugHelper.showQuickHelp() for commands');
}

// Auto-run basic validation when loaded
if (typeof window !== 'undefined' && window.cam) {
    console.log('🎯 Offset Debug Helper ready for testing');
    console.log('Load some PCB files, then run: OffsetDebugHelper.testOffsetGeneration()');
}