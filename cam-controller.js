// cam-controller.js - Main application controller
// Ties together core logic and UI components

class SemanticPCBCam {
    constructor() {
        // Initialize core and UI
        this.core = new PCBCamCore();
        this.ui = new PCBCamUI(this.core);
        
        // Debug mode
        this.debugMode = false;
        
        this.initializeApp();
    }
    
    initializeApp() {
        // Set theme
        const savedTheme = localStorage.getItem('theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
        
        // Initialize subsystems
        this.ui.initializeUI();
        this.setupEventListeners();
        
        console.log('📐 PCB CAM Controller initialized');
        console.log('✅ Simple union-all fusion system active');
        console.log('✅ FIXED: Region duplication prevention active');
        console.log('✅ Modular architecture: core, UI, controller');
        console.log('📦 Ready for file import');
    }
    
    setupEventListeners() {
        // Theme toggle
        document.getElementById('theme-toggle')?.addEventListener('click', () => {
            const newTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            
            if (this.ui.renderer) {
                this.ui.renderer.setOptions({ theme: newTheme });
            }
        });

        // File input
        document.getElementById('file-input-temp')?.addEventListener('change', (e) => this.handleFileSelect(e));
        
        // Preview button
        document.getElementById('preview-btn')?.addEventListener('click', () => this.ui.openPreview());
        
        // Modal controls
        document.getElementById('modal-close-btn')?.addEventListener('click', () => this.ui.closePreview());
        document.getElementById('zoom-fit-btn')?.addEventListener('click', () => this.ui.renderer?.zoomFit());
        document.getElementById('zoom-in-btn')?.addEventListener('click', () => this.ui.renderer?.zoomIn());
        document.getElementById('zoom-out-btn')?.addEventListener('click', () => this.ui.renderer?.zoomOut());
        
        // Coordinate system controls
        document.getElementById('center-origin-btn')?.addEventListener('click', () => this.ui.centerOrigin());
        document.getElementById('bottom-left-origin-btn')?.addEventListener('click', () => this.ui.bottomLeftOrigin());
        document.getElementById('reset-origin-btn')?.addEventListener('click', () => this.ui.resetOrigin());
        document.getElementById('apply-set-origin-btn')?.addEventListener('click', () => this.ui.applyOffsetAndSetOrigin());
        
        // Rotation controls
        document.getElementById('apply-rotation-btn')?.addEventListener('click', () => {
            const input = document.getElementById('rotation-angle');
            const angle = parseFloat(input?.value) || 0;
            if (angle !== 0) {
                this.ui.applyBoardRotation(angle);
                if (input) input.value = '0';
            }
        });
        
        document.getElementById('reset-rotation-btn')?.addEventListener('click', () => {
            this.ui.resetBoardRotationOnly();
            const input = document.getElementById('rotation-angle');
            if (input) input.value = '0';
        });
        
        // Export controls
        document.getElementById('export-svg-btn')?.addEventListener('click', () => this.ui.exportSVG());
        
        // Machine settings
        document.getElementById('pcb-thickness')?.addEventListener('change', (e) => {
            this.core.updateSettings('pcb', { thickness: parseFloat(e.target.value) });
        });
        
        document.getElementById('safe-z')?.addEventListener('change', (e) => {
            this.core.updateSettings('machine', { safeZ: parseFloat(e.target.value) });
        });
        
        document.getElementById('travel-z')?.addEventListener('change', (e) => {
            this.core.updateSettings('machine', { travelZ: parseFloat(e.target.value) });
        });
        
        document.getElementById('rapid-feed')?.addEventListener('change', (e) => {
            this.core.updateSettings('machine', { rapidFeed: parseFloat(e.target.value) });
        });
        
        document.getElementById('work-coords')?.addEventListener('change', (e) => {
            this.core.updateSettings('machine', { workCoordinateSystem: e.target.value });
        });
        
        // G-code settings
        document.getElementById('post-processor')?.addEventListener('change', (e) => {
            this.core.updateSettings('gcode', { postProcessor: e.target.value });
        });
        
        document.getElementById('gcode-units')?.addEventListener('change', (e) => {
            this.core.updateSettings('gcode', { units: e.target.value });
        });
        
        document.getElementById('start-gcode')?.addEventListener('change', (e) => {
            this.core.updateSettings('gcode', { startCode: e.target.value });
        });
        
        document.getElementById('end-gcode')?.addEventListener('change', (e) => {
            this.core.updateSettings('gcode', { endCode: e.target.value });
        });
        
        console.log('All event listeners setup');
    }
    
    triggerFileInput(type) {
        const fileInput = document.getElementById('file-input-temp');
        if (fileInput) {
            fileInput.setAttribute('data-type', type);
            
            const config = this.core.fileTypes[type];
            if (config) {
                fileInput.setAttribute('accept', config.extensions.join(','));
            }
            
            fileInput.click();
        }
    }
    
    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const type = event.target.getAttribute('data-type');
        if (!type) return;

        const validation = this.core.validateFileType(file.name, type);
        if (!validation.valid) {
            this.ui.showOperationMessage(type, validation.message, 'error');
            event.target.value = '';
            return;
        }

        const operation = this.core.createOperation(type, file);
        
        this.ui.renderOperations(type);
        this.ui.updateStatus(`Loading ${file.name}...`);
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            operation.file.content = e.target.result;
            
            const success = await this.core.parseOperation(operation);
            
            if (success) {
                const count = operation.primitives.length;
                this.ui.showOperationMessage(type, `Successfully loaded ${count} primitives`, 'success');
                this.ui.updateStatus(`Loaded ${operation.file.name}: ${count} primitives`, 'success');
            } else {
                this.ui.showOperationMessage(type, `Error: ${operation.error}`, 'error');
                this.ui.updateStatus(`Error processing ${operation.file.name}: ${operation.error}`, 'error');
            }
            
            this.ui.renderOperations(type);
            
            if (this.ui.renderer) {
                this.ui.updateRenderer();
            }
        };
        
        reader.onerror = () => {
            operation.error = 'Failed to read file';
            this.ui.showOperationMessage(type, 'Failed to read file', 'error');
            this.ui.updateStatus(`Failed to read ${file.name}`, 'error');
        };
        
        reader.readAsText(file);
        event.target.value = '';
    }
    
    async exportGcode() {
        this.ui.updateStatus('G-code generation in development...', 'info');
    }
    
    // FIXED: Enhanced debug utilities with region processing validation
    enableDebugMode() {
        this.debugMode = true;
        if (this.core.geometryProcessor) {
            this.core.geometryProcessor.options.debug = true;
        }
        console.log('Debug mode enabled');
    }
    
    disableDebugMode() {
        this.debugMode = false;
        if (this.core.geometryProcessor) {
            this.core.geometryProcessor.options.debug = false;
        }
        console.log('Debug mode disabled');
    }
    
    // FIXED: Enhanced testing utilities
    async testBasicFusion() {
        const allPrimitives = this.core.getAllPrimitives();
        console.log(`Testing fusion with ${allPrimitives.length} primitives`);
        
        if (allPrimitives.length === 0) {
            console.error('No primitives loaded');
            return null;
        }
        
        try {
            const fused = this.core.fuseAllPrimitives();
            console.log(`Result: ${fused.length} fused primitives`);
            
            // FIXED: Validate dimensional accuracy
            if (typeof DimensionalValidator !== 'undefined') {
                const validation = DimensionalValidator.validateFusionResult(allPrimitives, fused);
                console.log('Dimensional validation:', validation);
                
                if (validation.ratio > 2.0) {
                    console.warn('⚠️ Very large area change detected - check for geometry issues');
                } else if (validation.ratio > 0.5) {
                    console.log('ℹ️ Area increased due to stroke/pad overlap - this is normal');
                } else {
                    console.log('✅ Dimensional accuracy validated');
                }
            }
            
            return fused;
        } catch (error) {
            console.error('Fusion test failed:', error);
            return null;
        }
    }
    
    visualTestFusion() {
        const fused = this.core.fuseAllPrimitives();
        if (!fused || fused.length === 0) {
            console.error('No fused primitives to display');
            return;
        }
        
        // Clear renderer and show only fused result
        if (this.ui.renderer) {
            this.ui.renderer.clearLayers();
            this.ui.renderer.addLayer('fused-test', fused, {
                type: 'copper',
                color: '#00ff00',
                visible: true
            });
            
            this.ui.renderer.render();
            console.log('Fused geometry displayed in green');
        }
    }
    
    testHolePreservation() {
        // This should work automatically with proper union
        // The letter 'B' or 'a' should maintain its holes
        this.visualTestFusion();
        
        // Log if there are any paths with holes
        const fused = this.core.fuseAllPrimitives();
        let holesFound = 0;
        
        fused.forEach((primitive, index) => {
            if (primitive.type === 'path' && primitive.closed) {
                // Check if this path represents a hole by checking its area sign
                const area = this.core.geometryProcessor.calculateSignedArea(primitive.points);
                if (area < 0) {
                    holesFound++;
                    console.log(`Hole found in primitive ${index}`);
                }
            }
        });
        
        console.log(`Total holes preserved: ${holesFound}`);
    }
    
    // FIXED: Test region processing to ensure no duplicates
    testRegionProcessing() {
        console.log('🔍 Testing region processing for duplicates...');
        
        let regionCount = 0;
        let drawCount = 0;
        let duplicateRegionPerimeters = 0;
        
        this.core.operations.forEach(operation => {
            if (operation.primitives) {
                operation.primitives.forEach(primitive => {
                    if (primitive.properties?.isRegion) {
                        regionCount++;
                        
                        // Check if region has stroke (indicates duplication issue)
                        if (primitive.properties.stroke) {
                            duplicateRegionPerimeters++;
                            console.warn(`⚠️ Region with stroke detected - possible perimeter duplication`);
                        }
                    } else if (primitive.properties?.isStroke) {
                        drawCount++;
                    }
                });
            }
        });
        
        console.log(`📊 Region Analysis:`);
        console.log(`  Regions (filled): ${regionCount}`);
        console.log(`  Draws (stroked): ${drawCount}`);
        console.log(`  Duplicate perimeters: ${duplicateRegionPerimeters}`);
        
        if (duplicateRegionPerimeters === 0) {
            console.log('✅ No region perimeter duplication detected');
        } else {
            console.warn(`❌ ${duplicateRegionPerimeters} regions have duplicate perimeters`);
        }
        
        return {
            regionCount,
            drawCount,
            duplicateRegionPerimeters
        };
    }
    
    // FIXED: New debug function to analyze parsing output
    analyzeParsingOutput() {
        console.log('🔍 Analyzing parsing output...');
        console.log('================================');
        
        this.core.operations.forEach((operation, opIndex) => {
            console.log(`\n📄 Operation ${opIndex + 1}: ${operation.type.toUpperCase()} - ${operation.file.name}`);
            
            if (operation.parsed && operation.parsed.layers) {
                const layers = operation.parsed.layers;
                console.log('   Parsed data:');
                console.log(`     Objects: ${layers.objects ? layers.objects.length : 0}`);
                
                if (layers.objects) {
                    const typeCount = {};
                    layers.objects.forEach(obj => {
                        typeCount[obj.type] = (typeCount[obj.type] || 0) + 1;
                    });
                    console.log('     Object types from parser:', typeCount);
                }
                
                if (operation.parsed.debugStats) {
                    console.log('   Parser debug stats:', operation.parsed.debugStats);
                }
            }
            
            if (operation.primitives) {
                const primitiveTypes = {};
                const propertyTypes = {};
                
                operation.primitives.forEach(p => {
                    primitiveTypes[p.type] = (primitiveTypes[p.type] || 0) + 1;
                    
                    if (p.properties) {
                        if (p.properties.isRegion) propertyTypes.regions = (propertyTypes.regions || 0) + 1;
                        if (p.properties.isStroke) propertyTypes.strokes = (propertyTypes.strokes || 0) + 1;
                        if (p.properties.isFlash) propertyTypes.flashes = (propertyTypes.flashes || 0) + 1;
                    }
                });
                
                console.log('   Plotted primitives:', primitiveTypes);
                console.log('   Primitive properties:', propertyTypes);
            }
        });
    }
    
    // FIXED: New debug function to analyze primitive types and duplicates
    analyzePrimitiveTypes() {
        console.log('🔍 Analyzing primitive types and potential duplicates...');
        console.log('==================================================');
        
        this.core.operations.forEach((operation, opIndex) => {
            if (!operation.primitives || operation.primitives.length === 0) return;
            
            console.log(`\n📄 Operation ${opIndex + 1}: ${operation.type.toUpperCase()} - ${operation.file.name}`);
            console.log(`   Total primitives: ${operation.primitives.length}`);
            
            // Count by type
            const typeCount = {};
            const propertyCount = {};
            
            operation.primitives.forEach(primitive => {
                // Count by primitive type
                typeCount[primitive.type] = (typeCount[primitive.type] || 0) + 1;
                
                // Count by properties
                if (primitive.properties) {
                    if (primitive.properties.isRegion) propertyCount.regions = (propertyCount.regions || 0) + 1;
                    if (primitive.properties.isStroke) propertyCount.strokes = (propertyCount.strokes || 0) + 1;
                    if (primitive.properties.isFlash) propertyCount.flashes = (propertyCount.flashes || 0) + 1;
                    if (primitive.properties.fill && !primitive.properties.stroke) {
                        propertyCount.fillOnly = (propertyCount.fillOnly || 0) + 1;
                    }
                    if (!primitive.properties.fill && primitive.properties.stroke) {
                        propertyCount.strokeOnly = (propertyCount.strokeOnly || 0) + 1;
                    }
                    if (primitive.properties.fill && primitive.properties.stroke) {
                        propertyCount.fillAndStroke = (propertyCount.fillAndStroke || 0) + 1;
                    }
                }
            });
            
            console.log('   By primitive type:', typeCount);
            console.log('   By properties:', propertyCount);
            
            // Look for suspicious patterns
            if (propertyCount.regions && propertyCount.strokes) {
                const ratio = propertyCount.strokes / propertyCount.regions;
                if (ratio > 0.8) {
                    console.warn(`   ⚠️ High stroke-to-region ratio (${ratio.toFixed(2)}) - possible duplication`);
                }
            }
        });
        
        // Global analysis
        const allPrimitives = this.core.getAllPrimitives();
        console.log(`\n🌍 GLOBAL TOTALS: ${allPrimitives.length} primitives`);
        
        // Check for overlapping geometry
        this.detectOverlappingGeometry();
    }
    
    // FIXED: Detect overlapping geometry that might cause fusion issues
    detectOverlappingGeometry() {
        console.log('\n🔍 Detecting overlapping geometry...');
        
        const allPrimitives = this.core.getAllPrimitives();
        const regions = allPrimitives.filter(p => p.properties?.isRegion);
        const strokes = allPrimitives.filter(p => p.properties?.isStroke);
        
        console.log(`   Checking ${regions.length} regions against ${strokes.length} strokes`);
        
        let overlaps = 0;
        const tolerance = 0.01; // 10 micron tolerance
        
        regions.forEach((region, rIndex) => {
            const regionBounds = region.getBounds();
            
            strokes.forEach((stroke, sIndex) => {
                const strokeBounds = stroke.getBounds();
                
                // Quick bounds check
                if (this.boundsOverlap(regionBounds, strokeBounds, tolerance)) {
                    // Check if stroke might be region perimeter
                    if (stroke.type === 'path' && region.type === 'path') {
                        const strokeLen = stroke.points ? stroke.points.length : 0;
                        const regionLen = region.points ? region.points.length : 0;
                        
                        if (Math.abs(strokeLen - regionLen) < 5) {
                            overlaps++;
                            if (overlaps < 5) { // Only log first few
                                console.warn(`   ⚠️ Stroke ${sIndex} might be perimeter of region ${rIndex}`);
                            }
                        }
                    }
                }
            });
        });
        
        if (overlaps > 0) {
            console.warn(`   ❌ Found ${overlaps} potential region/stroke duplicates`);
        } else {
            console.log(`   ✅ No obvious region/stroke duplicates detected`);
        }
    }
    
    boundsOverlap(bounds1, bounds2, tolerance = 0) {
        return !(bounds1.maxX + tolerance < bounds2.minX - tolerance ||
                 bounds1.minX - tolerance > bounds2.maxX + tolerance ||
                 bounds1.maxY + tolerance < bounds2.minY - tolerance ||
                 bounds1.minY - tolerance > bounds2.maxY + tolerance);
    }
    
    // FIXED: Test offset generation pipeline
    async testOffsetGeneration(offsetDistance = -0.1) {
        console.log(`🧪 Testing offset generation: ${offsetDistance}mm`);
        
        try {
            // Test fusion first
            const fusedPrimitives = this.core.fuseAllPrimitives();
            console.log(`✅ Fusion complete: ${fusedPrimitives.length} primitives`);
            
            // Test offset preparation
            const preparedGeometry = this.core.prepareForOffsetGeneration();
            console.log(`✅ Geometry prepared: ${preparedGeometry.length} primitives`);
            
            // Test offset generation
            const offsetGeometry = this.core.generateOffsetGeometry(offsetDistance);
            console.log(`✅ Offset generated: ${offsetGeometry.length} toolpaths`);
            
            // Visualize offset if renderer available
            if (this.ui.renderer && offsetGeometry.length > 0) {
                this.ui.renderer.clearLayers();
                
                // Show original fused geometry
                this.ui.renderer.addLayer('original', fusedPrimitives, {
                    type: 'copper',
                    color: '#ff8844',
                    visible: true
                });
                
                // Show offset geometry
                this.ui.renderer.addLayer('offset', offsetGeometry, {
                    type: 'toolpath',
                    color: '#00ff00',
                    visible: true
                });
                
                this.ui.renderer.render();
                console.log('✅ Offset visualization updated');
            }
            
            return {
                fusedCount: fusedPrimitives.length,
                preparedCount: preparedGeometry.length,
                offsetCount: offsetGeometry.length,
                offsetDistance: offsetDistance
            };
            
        } catch (error) {
            console.error('❌ Offset generation test failed:', error);
            return null;
        }
    }
    
    getStats() {
        const baseStats = {
            core: this.core.getProcessorStats(),
            ui: {
                fusionStats: this.ui.fusionStats,
                modalPage: this.ui.currentModalPage,
                hasRenderer: !!this.ui.renderer
            },
            operations: this.core.operations.length,
            debugMode: this.debugMode
        };
        
        // Add region processing stats if available
        const regionStats = this.testRegionProcessing();
        baseStats.regionProcessing = regionStats;
        
        return baseStats;
    }
}

// FIXED: Enhanced initialization with comprehensive validation
function initializePCBCAM() {
    console.log('🎯 Starting PCB CAM initialization...');
    console.log('📊 Document state:', document.readyState);
    
    const requiredClasses = [
        'PCBCamCore',
        'PCBCamUI', 
        'GeometryProcessor',
        'GerberSemanticParser',
        'ExcellonSemanticParser',
        'GerberPlotter',
        'LayerRenderer',
        'CoordinateSystemManager'
    ];
    
    console.log('📋 Checking required classes:');
    let missingClasses = [];
    requiredClasses.forEach(className => {
        const exists = typeof window[className] !== 'undefined';
        console.log(`  ${exists ? '✅' : '❌'} ${className}`);
        if (!exists) {
            missingClasses.push(className);
        }
    });
    
    if (missingClasses.length > 0) {
        console.error('❌ Missing required classes:', missingClasses);
        console.error('💡 Check browser console for script loading errors');
        console.error('💡 Verify script loading order in index.html');
        return false;
    }
    
    try {
        console.log('🚀 Creating PCB CAM application...');
        window.cam = new SemanticPCBCam();
        console.log('✅ PCB CAM initialized successfully');
        
        // Test if cam object has triggerFileInput method
        if (window.cam && typeof window.cam.triggerFileInput === 'function') {
            console.log('✅ cam.triggerFileInput method available');
        } else {
            console.error('❌ cam.triggerFileInput method missing');
        }
        
        return true;
        
    } catch (error) {
        console.error('💥 Failed to initialize PCB CAM:', error);
        console.error('💥 Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        return false;
    }
}

// Try multiple initialization strategies
document.addEventListener('DOMContentLoaded', () => {
    console.log('📍 DOMContentLoaded event fired');
    initializePCBCAM();
});

// Fallback: If document is already loaded
if (document.readyState === 'loading') {
    console.log('📍 Document still loading, waiting for DOMContentLoaded...');
} else {
    console.log('📍 Document already loaded, initializing immediately...');
    initializePCBCAM();
}

// Fallback: Initialize after a delay
setTimeout(() => {
    if (!window.cam) {
        console.log('📍 Delayed initialization attempt...');
        initializePCBCAM();
    }
}, 1000);

// FIXED: Enhanced global function exposure for HTML compatibility
window.addFile = function(type) {
    console.log(`🎯 addFile('${type}') called`);
    
    if (window.cam) {
        console.log('✅ window.cam exists, calling triggerFileInput');
        try {
            window.cam.triggerFileInput(type);
        } catch (error) {
            console.error('❌ Error in triggerFileInput:', error);
        }
    } else {
        console.error('❌ window.cam not available when addFile called');
        console.log('💡 Attempting emergency initialization...');
        
        // Emergency initialization attempt
        if (initializePCBCAM()) {
            console.log('🚑 Emergency initialization successful, retrying...');
            window.cam.triggerFileInput(type);
        } else {
            console.error('🚑 Emergency initialization failed');
        }
    }
};

// FIXED: Enhanced console test functions
window.testBasicFusion = function() {
    if (!window.cam) {
        console.error('CAM not initialized');
        return;
    }
    return window.cam.testBasicFusion();
};

window.visualTestFusion = function() {
    if (!window.cam) {
        console.error('CAM not initialized');
        return;
    }
    window.cam.visualTestFusion();
};

window.testHolePreservation = function() {
    if (!window.cam) {
        console.error('CAM not initialized');
        return;
    }
    window.cam.testHolePreservation();
};

window.testRegionProcessing = function() {
    if (!window.cam) {
        console.error('CAM not initialized');
        return;
    }
    return window.cam.testRegionProcessing();
};

window.analyzePrimitiveTypes = function() {
    if (!window.cam) {
        console.error('CAM not initialized');
        return;
    }
    return window.cam.analyzePrimitiveTypes();
};

window.analyzeParsingOutput = function() {
    if (!window.cam) {
        console.error('CAM not initialized');
        return;
    }
    return window.cam.analyzeParsingOutput();
};

window.testOffsetGeneration = function(offsetDistance = -0.1) {
    if (!window.cam) {
        console.error('CAM not initialized');
        return;
    }
    return window.cam.testOffsetGeneration(offsetDistance);
};

window.showCamStats = function() {
    if (!window.cam) {
        console.error('CAM not initialized');
        return;
    }
    console.log('PCB CAM Statistics:', window.cam.getStats());
};

// FIXED: New debug function to check layer contamination
window.checkLayerContamination = function() {
    if (!window.cam || !window.cam.core) {
        console.error('CAM not initialized');
        return;
    }
    return window.cam.core.checkLayerContamination();
};

// FIXED: New debug function to inspect specific layer
window.inspectLayer = function(operationType) {
    if (!window.cam || !window.cam.core) {
        console.error('CAM not initialized');
        return;
    }
    
    const operations = window.cam.core.getOperationsByType(operationType);
    if (operations.length === 0) {
        console.log(`No operations of type '${operationType}' found`);
        return;
    }
    
    operations.forEach((op, index) => {
        console.log(`\n📄 ${operationType} Operation ${index + 1}: ${op.file.name}`);
        console.log(`   Primitives: ${op.primitives ? op.primitives.length : 0}`);
        
        if (op.primitives) {
            // Sample first few primitives
            const sample = op.primitives.slice(0, 5);
            sample.forEach((p, i) => {
                console.log(`   Primitive ${i}:`, {
                    type: p.type,
                    properties: p.properties,
                    bounds: p.getBounds()
                });
            });
            
            if (op.primitives.length > 5) {
                console.log(`   ... and ${op.primitives.length - 5} more`);
            }
        }
    });
};

// Initialize when scripts are loaded
document.addEventListener('DOMContentLoaded', () => {
    const requiredClasses = [
        'PCBCamCore',
        'PCBCamUI',
        'GeometryProcessor',
        'GerberSemanticParser',
        'ExcellonSemanticParser',
        'GerberPlotter',
        'LayerRenderer',
        'CoordinateSystemManager'
    ];
    
    let missingClasses = [];
    requiredClasses.forEach(className => {
        if (typeof window[className] === 'undefined') {
            missingClasses.push(className);
        }
    });
    
    if (missingClasses.length > 0) {
        console.error('Missing required classes:', missingClasses);
        console.error('Make sure all scripts are loaded in the correct order');
        return;
    }
    
    // Initialize the application
    window.cam = new SemanticPCBCam();
    
    console.log('🎉 PCB CAM Ready!');
    console.log('📋 Available commands:');
    console.log('  testBasicFusion() - Test fusion with loaded primitives');
    console.log('  visualTestFusion() - Display fused geometry in green');
    console.log('  testHolePreservation() - Check if holes are preserved');
    console.log('  testRegionProcessing() - Validate no region duplication');
    console.log('  analyzePrimitiveTypes() - Analyze primitive types and duplicates');
    console.log('  analyzeParsingOutput() - NEW: Debug parser output vs plotter output');
    console.log('  testOffsetGeneration(distance) - Test offset toolpath generation');
    console.log('  showCamStats() - Display application statistics');
    console.log('  cam.enableDebugMode() - Enable debug logging');
    console.log('  cam.disableDebugMode() - Disable debug logging');
});