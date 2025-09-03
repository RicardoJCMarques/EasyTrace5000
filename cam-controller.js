// cam-controller2.js - Main application controller - FIXED async method names
// Ties together core logic and UI components with async WASM support
// FIXED: Prevent double initialization of processors

class SemanticPCBCam {
    constructor() {
        // ASYNC: Track initialization state
        this.initializationState = {
            coreReady: false,
            uiReady: false,
            wasmReady: false,
            fullyReady: false,
            error: null
        };
        
        // ASYNC: Operation queue for file processing
        this.pendingFileOperations = [];
        
        // FIXED: Initialize core with skipInit to prevent double initialization
        this.core = new PCBCamCore({ skipInit: true });
        this.ui = new PCBCamUI(this.core);
        
        // Debug mode
        this.debugMode = false;
        
        // ASYNC: Start initialization chain
        this.initializeApp();
    }
    
    // ASYNC: Main initialization method - now async
    async initializeApp() {
        console.log('🚀 Starting PCB CAM initialization with Clipper2 WASM...');
        
        // Set theme
        const savedTheme = localStorage.getItem('theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
        
        // Initialize UI first (synchronous parts)
        this.ui.initializeUI();
        this.setupEventListeners();
        this.initializationState.uiReady = true;
        console.log('✅ UI initialized');
        
        // FIXED: Single initialization of processors
        try {
            console.log('⏳ Loading Clipper2 WASM modules...');
            
            // Initialize processors once
            const wasmInitialized = await this.core.initializeProcessors();
            
            if (wasmInitialized) {
                this.initializationState.wasmReady = true;
                console.log('✅ Clipper2 WASM modules loaded successfully');
                
                // Process any pending file operations
                await this.processPendingFileOperations();
                
            } else {
                throw new Error('Failed to initialize Clipper2 WASM modules');
            }
            
            this.initializationState.coreReady = true;
            this.initializationState.fullyReady = true;
            
            console.log('✅ PCB CAM fully initialized with Clipper2');
            console.log('✅ Automatic hole detection via PolyTree active');
            console.log('✅ Arc preservation metadata enabled');
            console.log('📦 Ready for file import');
            
            // Update UI to show ready state
            this.ui.updateStatus('Ready - Clipper2 WASM loaded', 'success');
            
        } catch (error) {
            console.error('❌ Failed to initialize Clipper2 WASM:', error);
            this.initializationState.error = error.message;
            
            // Show error in UI
            this.ui.updateStatus('Warning: Clipper2 failed to load - fusion disabled', 'warning');
            
            // Still mark as ready but with limited functionality
            this.initializationState.coreReady = true;
            this.initializationState.fullyReady = true;
            
            console.warn('⚠️ Running in fallback mode without Clipper2 fusion');
        }
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
        
        // Preview button - now async
        document.getElementById('preview-btn')?.addEventListener('click', async () => {
            await this.ui.openPreview();
        });
        
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
        
        // Export controls - now async
        document.getElementById('export-svg-btn')?.addEventListener('click', async () => {
            await this.ui.exportSVG();
        });
        
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
    
    // ASYNC: File handling - queue if WASM not ready
    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const type = event.target.getAttribute('data-type');
        if (!type) return;
        
        // If WASM not ready, queue the operation
        if (!this.initializationState.wasmReady) {
            console.log('WASM not ready, queueing file operation...');
            this.pendingFileOperations.push({ file, type, event });
            this.ui.updateStatus('Loading Clipper2 WASM... File will be processed when ready', 'info');
            event.target.value = '';
            return;
        }
        
        // Process file normally
        await this.processFile(file, type, event);
    }
    
    // ASYNC: Process pending file operations after WASM loads
    async processPendingFileOperations() {
        if (this.pendingFileOperations.length === 0) return;
        
        console.log(`Processing ${this.pendingFileOperations.length} pending file operations...`);
        
        for (const operation of this.pendingFileOperations) {
            await this.processFile(operation.file, operation.type, operation.event);
        }
        
        this.pendingFileOperations = [];
    }
    
    // ASYNC: Main file processing logic
    async processFile(file, type, event) {
        const validation = this.core.validateFileType(file.name, type);
        if (!validation.valid) {
            this.ui.showOperationMessage(type, validation.message, 'error');
            if (event) event.target.value = '';
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
                
                // ARC RECONSTRUCTION TODO: Store original geometric data for arc reconstruction
                if (operation.parsed?.hasArcs) {
                    operation.originalArcs = operation.parsed.arcs;
                    console.log(`Preserved ${operation.originalArcs.length} arcs for potential reconstruction`);
                }
                
                this.ui.showOperationMessage(type, `Successfully loaded ${count} primitives`, 'success');
                this.ui.updateStatus(`Loaded ${operation.file.name}: ${count} primitives`, 'success');
            } else {
                this.ui.showOperationMessage(type, `Error: ${operation.error}`, 'error');
                this.ui.updateStatus(`Error processing ${operation.file.name}: ${operation.error}`, 'error');
            }
            
            this.ui.renderOperations(type);
            
            if (this.ui.renderer) {
                // ASYNC: Update renderer with async fusion
                await this.ui.updateRendererAsync();
            }
        };
        
        reader.onerror = () => {
            operation.error = 'Failed to read file';
            this.ui.showOperationMessage(type, 'Failed to read file', 'error');
            this.ui.updateStatus(`Failed to read ${file.name}`, 'error');
        };
        
        reader.readAsText(file);
        if (event) event.target.value = '';
    }
    
    async exportGcode() {
        this.ui.updateStatus('G-code generation in development...', 'info');
        
        // ARC RECONSTRUCTION TODO: When generating G-code, we could use the preserved
        // arc data to generate G02/G03 arc commands instead of many G01 segments.
    }
    
    // Debug utilities
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
    
    // ASYNC: Test functions - now async
    async testBasicFusion() {
        const allPrimitives = this.core.getAllPrimitives();
        console.log(`Testing Clipper2 fusion with ${allPrimitives.length} primitives`);
        
        if (allPrimitives.length === 0) {
            console.error('No primitives loaded');
            return null;
        }
        
        if (!this.initializationState.wasmReady) {
            console.error('Clipper2 WASM not initialized');
            return null;
        }
        
        try {
            this.ui.showLoadingState('test-fusion', 'Testing Clipper2 fusion...');
            // Call fusion method
            const fused = await this.core.fuseAllPrimitives();
            console.log(`Result: ${fused.length} fused primitives with automatic hole detection`);
            
            // Validate dimensional accuracy if validator available
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
        } finally {
            this.ui.hideLoadingState();
        }
    }
    
    async visualTestFusion() {
        // Call fusion method
        const fused = await this.core.fuseAllPrimitives();
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
            console.log('Fused geometry displayed in green (with holes via PolyTree)');
        }
    }
    
    async testHolePreservation() {
        // With Clipper2, holes are automatically detected via PolyTree
        await this.visualTestFusion();
        
        // Count holes in fused result
        const fused = await this.core.fuseAllPrimitives();
        let holesFound = 0;
        
        fused.forEach((primitive, index) => {
            if (primitive.holes && primitive.holes.length > 0) {
                holesFound += primitive.holes.length;
                console.log(`Path ${index} has ${primitive.holes.length} holes (via PolyTree)`);
            }
        });
        
        console.log(`Total holes preserved by Clipper2: ${holesFound}`);
    }
    
    // Test region processing
    testRegionProcessing() {
        console.log('🔍 Testing region processing...');
        
        let regionCount = 0;
        let drawCount = 0;
        
        this.core.operations.forEach(operation => {
            if (operation.primitives) {
                operation.primitives.forEach(primitive => {
                    if (primitive.properties?.isRegion) {
                        regionCount++;
                    } else if (primitive.properties?.isStroke) {
                        drawCount++;
                    }
                });
            }
        });
        
        console.log(`📊 Region Analysis:`);
        console.log(`  Regions (filled): ${regionCount}`);
        console.log(`  Draws (stroked): ${drawCount}`);
        
        return {
            regionCount,
            drawCount
        };
    }
    
    // Analyze parsing output
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
            
            // Check for preserved arcs
            if (operation.originalArcs) {
                console.log(`   Original arcs preserved: ${operation.originalArcs.length}`);
            }
        });
    }
    
    // Analyze primitive types and duplicates
    analyzePrimitiveTypes() {
        console.log('🔍 Analyzing primitive types...');
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
                    if (primitive.properties.hasArcs) propertyCount.hasArcs = (propertyCount.hasArcs || 0) + 1;
                }
            });
            
            console.log('   By primitive type:', typeCount);
            console.log('   By properties:', propertyCount);
        });
        
        // Global analysis
        const allPrimitives = this.core.getAllPrimitives();
        console.log(`\n🌐 GLOBAL TOTALS: ${allPrimitives.length} primitives`);
    }
    
    // ASYNC: Test offset generation
    async testOffsetGeneration(offsetDistance = -0.1) {
        console.log(`🧪 Testing offset generation: ${offsetDistance}mm`);
        
        if (!this.initializationState.wasmReady) {
            console.error('Clipper2 WASM not initialized');
            return null;
        }
        
        try {
            this.ui.showLoadingState('test-offset', 'Testing offset generation...');
            
            // Test fusion first
            const fusedPrimitives = await this.core.fuseAllPrimitives();
            console.log(`✅ Fusion complete: ${fusedPrimitives.length} primitives`);
            
            // Test offset preparation
            const preparedGeometry = await this.core.prepareForOffsetGeneration();
            console.log(`✅ Geometry prepared: ${preparedGeometry.length} primitives`);
            
            // Test offset generation
            const offsetGeometry = await this.core.generateOffsetGeometry(offsetDistance);
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
        } finally {
            this.ui.hideLoadingState();
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
            debugMode: this.debugMode,
            initialization: this.initializationState
        };
        
        // Add region processing stats if available
        const regionStats = this.testRegionProcessing();
        baseStats.regionProcessing = regionStats;
        
        return baseStats;
    }
    
    // ARC RECONSTRUCTION TODO: Future method for arc reconstruction
    async reconstructArcsFromFusion(fusedPrimitives, originalOperations) {
        console.log('Arc reconstruction not yet implemented');
        return null;
    }
}

// Enhanced initialization with async support
async function initializePCBCAM() {
    console.log('🎯 Starting PCB CAM initialization with Clipper2 WASM...');
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
        console.log('🚀 Creating PCB CAM application with Clipper2...');
        window.cam = new SemanticPCBCam();
        console.log('✅ PCB CAM controller created');
        
        // Test if cam object has triggerFileInput method
        if (window.cam && typeof window.cam.triggerFileInput === 'function') {
            console.log('✅ cam.triggerFileInput method available');
        } else {
            console.error('❌ cam.triggerFileInput method missing');
        }
        
        // Note: The actual WASM initialization happens asynchronously
        // in the constructor, so the app might not be fully ready yet
        
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
    console.log('🔍 DOMContentLoaded event fired');
    initializePCBCAM();
});

// Fallback: If document is already loaded
if (document.readyState === 'loading') {
    console.log('🔍 Document still loading, waiting for DOMContentLoaded...');
} else {
    console.log('🔍 Document already loaded, initializing immediately...');
    initializePCBCAM();
}

// Fallback: Initialize after a delay
setTimeout(() => {
    if (!window.cam) {
        console.log('🔍 Delayed initialization attempt...');
        initializePCBCAM();
    }
}, 1000);

// Global function exposure for HTML compatibility
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

// ASYNC: Updated console test functions to be async
window.testBasicFusion = async function() {
    if (!window.cam) {
        console.error('CAM not initialized');
        return;
    }
    return await window.cam.testBasicFusion();
};

window.visualTestFusion = async function() {
    if (!window.cam) {
        console.error('CAM not initialized');
        return;
    }
    await window.cam.visualTestFusion();
};

window.testHolePreservation = async function() {
    if (!window.cam) {
        console.error('CAM not initialized');
        return;
    }
    await window.cam.testHolePreservation();
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

window.testOffsetGeneration = async function(offsetDistance = -0.1) {
    if (!window.cam) {
        console.error('CAM not initialized');
        return;
    }
    return await window.cam.testOffsetGeneration(offsetDistance);
};

window.showCamStats = function() {
    if (!window.cam) {
        console.error('CAM not initialized');
        return;
    }
    console.log('PCB CAM Statistics:', window.cam.getStats());
};

// Debug function to check layer contamination
window.checkLayerContamination = function() {
    if (!window.cam || !window.cam.core) {
        console.error('CAM not initialized');
        return;
    }
    return window.cam.core.checkLayerContamination();
};

// Debug function to inspect specific layer
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
    
    // Initialize the application (async initialization happens in constructor)
    window.cam = new SemanticPCBCam();
    
    console.log('🎉 PCB CAM Ready (Clipper2 WASM loading...)');
    console.log('📋 Available commands (async functions marked with *)');
    console.log('  testBasicFusion()* - Test Clipper2 fusion with loaded primitives');
    console.log('  visualTestFusion()* - Display fused geometry with holes');
    console.log('  testHolePreservation()* - Check automatic hole detection via PolyTree');
    console.log('  testRegionProcessing() - Validate region processing');
    console.log('  analyzePrimitiveTypes() - Analyze primitive types');
    console.log('  analyzeParsingOutput() - Debug parser output');
    console.log('  testOffsetGeneration(distance)* - Test offset toolpath generation');
    console.log('  showCamStats() - Display application statistics');
    console.log('  cam.enableDebugMode() - Enable debug logging');
    console.log('  cam.disableDebugMode() - Disable debug logging');
});