// cam-controller_r.js - Refactored with config integration
// Main application controller - ties together core logic and UI components
// Manages async WASM operations and file processing pipeline

(function() {
    'use strict';
    
    // Get config reference
    const config = window.PCBCAMConfig || {};
    const debugConfig = config.debug || {};
    const uiConfig = config.ui || {};
    const timingConfig = uiConfig.timing || {};
    const messagesConfig = uiConfig.messages || {};
    const opsConfig = config.operations || {};
    
    class SemanticPCBCam {
        constructor() {
            // Initialization state tracking
            this.initializationState = {
                coreReady: false,
                uiReady: false,
                wasmReady: false,
                fullyReady: false,
                error: null
            };
            
            // Operation queue for file processing
            this.pendingFileOperations = [];
            
            // Initialize core components
            this.core = new PCBCamCore({ skipInit: true });
            this.ui = new PCBCamUI(this.core);
            
            // Debug mode from config
            this.debugMode = debugConfig.enabled;
            
            // Start initialization
            this.initializeApp();
        }
        
        async initializeApp() {
            if (debugConfig.enabled) {
                console.log('🚀 Starting PCB CAM initialization with Clipper2 WASM...');
            }
            
            // Set theme from config or saved
            const savedTheme = localStorage.getItem('theme') || uiConfig.theme;
            document.documentElement.setAttribute('data-theme', savedTheme);
            
            // Initialize UI
            this.ui.initializeUI();
            this.setupEventListeners();
            this.initializationState.uiReady = true;
            
            if (debugConfig.enabled) {
                console.log('✅ UI initialized');
            }
            
            // Initialize WASM processors
            try {
                if (debugConfig.logging?.wasmOperations) {
                    console.log('⏳ Loading Clipper2 WASM modules...');
                }
                
                const wasmInitialized = await this.core.initializeProcessors();
                
                if (wasmInitialized) {
                    this.initializationState.wasmReady = true;
                    if (debugConfig.enabled) {
                        console.log('✅ Clipper2 WASM modules loaded successfully');
                    }
                    
                    // Process pending operations
                    await this.processPendingFileOperations();
                } else {
                    throw new Error('Failed to initialize Clipper2 WASM modules');
                }
                
                this.initializationState.coreReady = true;
                this.initializationState.fullyReady = true;
                
                if (debugConfig.enabled) {
                    console.log('✅ PCB CAM fully initialized with Clipper2');
                    console.log('📦 Ready for file import');
                }
                
                this.ui.updateStatus(messagesConfig.ready || 'Ready - Clipper2 WASM loaded', 'success');
                
            } catch (error) {
                console.error('❌ Failed to initialize Clipper2 WASM:', error);
                this.initializationState.error = error.message;
                
                this.ui.updateStatus(messagesConfig.warning || 'Warning: Clipper2 failed to load - fusion disabled', 'warning');
                
                this.initializationState.coreReady = true;
                this.initializationState.fullyReady = true;
                
                if (debugConfig.enabled) {
                    console.warn('⚠️ Running in fallback mode without Clipper2 fusion');
                }
            }
        }
        
        setupEventListeners() {
            // Theme toggle
            document.getElementById('theme-toggle')?.addEventListener('click', () => {
                const currentTheme = document.documentElement.getAttribute('data-theme');
                const newTheme = currentTheme === 'light' ? 'dark' : 'light';
                document.documentElement.setAttribute('data-theme', newTheme);
                localStorage.setItem('theme', newTheme);
                
                if (this.ui.renderer) {
                    this.ui.renderer.setOptions({ theme: newTheme });
                }
            });
            
            // File input
            document.getElementById('file-input-temp')?.addEventListener('change', (e) => this.handleFileSelect(e));
            
            // Preview button
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
            
            // Export controls
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
            
            if (debugConfig.enabled) {
                console.log('Event listeners configured');
            }
        }
        
        triggerFileInput(type) {
            const fileInput = document.getElementById('file-input-temp');
            if (fileInput) {
                fileInput.setAttribute('data-type', type);
                
                const opConfig = opsConfig[type];
                if (opConfig) {
                    fileInput.setAttribute('accept', opConfig.extensions.join(','));
                }
                
                fileInput.click();
            }
        }
        
        async handleFileSelect(event) {
            const file = event.target.files[0];
            if (!file) return;
            
            const type = event.target.getAttribute('data-type');
            if (!type) return;
            
            // Queue if WASM not ready
            if (!this.initializationState.wasmReady) {
                if (debugConfig.logging?.wasmOperations) {
                    console.log('WASM not ready, queueing file operation...');
                }
                this.pendingFileOperations.push({ file, type, event });
                this.ui.updateStatus(messagesConfig.loading || 'Loading Clipper2 WASM... File will be processed when ready', 'info');
                event.target.value = '';
                return;
            }
            
            await this.processFile(file, type, event);
        }
        
        async processPendingFileOperations() {
            if (this.pendingFileOperations.length === 0) return;
            
            if (debugConfig.logging?.fileOperations) {
                console.log(`Processing ${this.pendingFileOperations.length} pending file operations...`);
            }
            
            for (const operation of this.pendingFileOperations) {
                await this.processFile(operation.file, operation.type, operation.event);
            }
            
            this.pendingFileOperations = [];
        }
        
        async processFile(file, type, event) {
            const validation = this.core.validateFileType(file.name, type);
            if (!validation.valid) {
                this.ui.showOperationMessage(type, validation.message, 'error');
                if (event) event.target.value = '';
                return;
            }
            
            const operation = this.core.createOperation(type, file);
            
            this.ui.renderOperations(type);
            this.ui.updateStatus(`${messagesConfig.loading || 'Loading'} ${file.name}...`);
            
            const reader = new FileReader();
            reader.onload = async (e) => {
                operation.file.content = e.target.result;
                
                const success = await this.core.parseOperation(operation);
                
                if (success) {
                    const count = operation.primitives.length;
                    
                    if (operation.parsed?.hasArcs && debugConfig.enabled) {
                        console.log(`Preserved ${operation.originalArcs?.length || 0} arcs for potential reconstruction`);
                    }
                    
                    this.ui.showOperationMessage(type, `Successfully loaded ${count} primitives`, 'success');
                    this.ui.updateStatus(`Loaded ${operation.file.name}: ${count} primitives`, 'success');
                } else {
                    this.ui.showOperationMessage(type, `Error: ${operation.error}`, 'error');
                    this.ui.updateStatus(`Error processing ${operation.file.name}: ${operation.error}`, 'error');
                }
                
                this.ui.renderOperations(type);
                
                if (this.ui.renderer) {
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
        }
        
        // Debug utilities
        enableDebugMode() {
            this.debugMode = true;
            debugConfig.enabled = true;
            if (this.core.geometryProcessor) {
                this.core.geometryProcessor.options.debug = true;
            }
            console.log('Debug mode enabled');
        }
        
        disableDebugMode() {
            this.debugMode = false;
            debugConfig.enabled = false;
            if (this.core.geometryProcessor) {
                this.core.geometryProcessor.options.debug = false;
            }
            console.log('Debug mode disabled');
        }
        
        // Test functions
        async testBasicFusion() {
            const allPrimitives = this.core.getAllPrimitives();
            
            if (debugConfig.logging?.fusionOperations) {
                console.log(`Testing Clipper2 fusion with ${allPrimitives.length} primitives`);
            }
            
            if (allPrimitives.length === 0) {
                console.error('No primitives loaded');
                return null;
            }
            
            if (!this.initializationState.wasmReady) {
                console.error('Clipper2 WASM not initialized');
                return null;
            }
            
            try {
                this.ui.showLoadingState('test-fusion', messagesConfig.processing || 'Testing Clipper2 fusion...');
                const fused = await this.core.fuseAllPrimitives();
                
                if (debugConfig.logging?.fusionOperations) {
                    console.log(`Result: ${fused.length} fused primitives with automatic hole detection`);
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
            const fused = await this.core.fuseAllPrimitives();
            if (!fused || fused.length === 0) {
                console.error('No fused primitives to display');
                return;
            }
            
            if (this.ui.renderer) {
                this.ui.renderer.clearLayers();
                this.ui.renderer.addLayer('fused-test', fused, {
                    type: 'copper',
                    color: config.rendering?.themes?.dark?.layers?.fused || '#00ff00',
                    visible: true
                });
                
                this.ui.renderer.render();
                
                if (debugConfig.enabled) {
                    console.log('Fused geometry displayed with PolyTree hole detection');
                }
            }
        }
        
        async testHolePreservation() {
            await this.visualTestFusion();
            
            const fused = await this.core.fuseAllPrimitives();
            let holesFound = 0;
            
            fused.forEach((primitive, index) => {
                if (primitive.holes && primitive.holes.length > 0) {
                    holesFound += primitive.holes.length;
                    if (debugConfig.logging?.fusionOperations) {
                        console.log(`Path ${index} has ${primitive.holes.length} holes (via PolyTree)`);
                    }
                }
            });
            
            if (debugConfig.enabled) {
                console.log(`Total holes preserved by Clipper2: ${holesFound}`);
            }
        }
        
        testRegionProcessing() {
            if (debugConfig.enabled) {
                console.log('🔍 Testing region processing...');
            }
            
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
            
            if (debugConfig.enabled) {
                console.log(`📊 Region Analysis:`);
                console.log(`  Regions (filled): ${regionCount}`);
                console.log(`  Draws (stroked): ${drawCount}`);
            }
            
            return { regionCount, drawCount };
        }
        
        analyzeParsingOutput() {
            if (!debugConfig.enabled) return;
            
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
                        console.log('     Object types:', typeCount);
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
        
        analyzePrimitiveTypes() {
            if (!debugConfig.enabled) return;
            
            console.log('🔍 Analyzing primitive types...');
            
            this.core.operations.forEach((operation, opIndex) => {
                if (!operation.primitives || operation.primitives.length === 0) return;
                
                console.log(`\n📄 Operation ${opIndex + 1}: ${operation.type.toUpperCase()} - ${operation.file.name}`);
                console.log(`   Total primitives: ${operation.primitives.length}`);
                
                const typeCount = {};
                const propertyCount = {};
                
                operation.primitives.forEach(primitive => {
                    typeCount[primitive.type] = (typeCount[primitive.type] || 0) + 1;
                    
                    if (primitive.properties) {
                        if (primitive.properties.isRegion) propertyCount.regions = (propertyCount.regions || 0) + 1;
                        if (primitive.properties.isStroke) propertyCount.strokes = (propertyCount.strokes || 0) + 1;
                        if (primitive.properties.isFlash) propertyCount.flashes = (propertyCount.flashes || 0) + 1;
                        if (primitive.properties.hasArcs) propertyCount.hasArcs = (propertyCount.hasArcs || 0) + 1;
                    }
                });
                
                console.log('   By type:', typeCount);
                console.log('   By properties:', propertyCount);
            });
            
            const allPrimitives = this.core.getAllPrimitives();
            console.log(`\n🌍 GLOBAL TOTALS: ${allPrimitives.length} primitives`);
        }
        
        async testOffsetGeneration(offsetDistance = -0.1) {
            if (debugConfig.logging?.toolpathGeneration) {
                console.log(`🧪 Testing offset generation: ${offsetDistance}mm`);
            }
            
            if (!this.initializationState.wasmReady) {
                console.error('Clipper2 WASM not initialized');
                return null;
            }
            
            try {
                this.ui.showLoadingState('test-offset', messagesConfig.processing || 'Testing offset generation...');
                
                const fusedPrimitives = await this.core.fuseAllPrimitives();
                const preparedGeometry = await this.core.prepareForOffsetGeneration();
                const offsetGeometry = await this.core.generateOffsetGeometry(offsetDistance);
                
                if (debugConfig.logging?.toolpathGeneration) {
                    console.log(`✅ Fusion: ${fusedPrimitives.length} primitives`);
                    console.log(`✅ Prepared: ${preparedGeometry.length} primitives`);
                    console.log(`✅ Offset: ${offsetGeometry.length} toolpaths`);
                }
                
                if (this.ui.renderer && offsetGeometry.length > 0) {
                    this.ui.renderer.clearLayers();
                    
                    this.ui.renderer.addLayer('original', fusedPrimitives, {
                        type: 'copper',
                        color: opsConfig.isolation?.color || '#ff8844',
                        visible: true
                    });
                    
                    this.ui.renderer.addLayer('offset', offsetGeometry, {
                        type: 'toolpath',
                        color: config.rendering?.themes?.dark?.layers?.toolpath || '#ffff00',
                        visible: true
                    });
                    
                    this.ui.renderer.render();
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
            return {
                core: this.core.getProcessorStats(),
                ui: {
                    fusionStats: this.ui.fusionStats,
                    modalPage: this.ui.currentModalPage,
                    hasRenderer: !!this.ui.renderer
                },
                operations: this.core.operations.length,
                debugMode: this.debugMode,
                initialization: this.initializationState,
                regionProcessing: this.testRegionProcessing()
            };
        }
    }
    
    // Initialize application
    async function initializePCBCAM() {
        if (debugConfig.enabled) {
            console.log('🎯 Starting PCB CAM initialization with config integration...');
            console.log('📊 Document state:', document.readyState);
        }
        
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
        
        if (debugConfig.enabled) {
            console.log('📋 Checking required classes:');
        }
        
        let missingClasses = [];
        requiredClasses.forEach(className => {
            const exists = typeof window[className] !== 'undefined';
            if (debugConfig.enabled) {
                console.log(`  ${exists ? '✅' : '❌'} ${className}`);
            }
            if (!exists) {
                missingClasses.push(className);
            }
        });
        
        if (missingClasses.length > 0) {
            console.error('❌ Missing required classes:', missingClasses);
            return false;
        }
        
        try {
            if (debugConfig.enabled) {
                console.log('🚀 Creating PCB CAM application with config...');
            }
            window.cam = new SemanticPCBCam();
            
            if (debugConfig.enabled) {
                console.log('✅ PCB CAM controller created');
            }
            
            return true;
            
        } catch (error) {
            console.error('💥 Failed to initialize PCB CAM:', error);
            return false;
        }
    }
    
    // Initialization strategies
    document.addEventListener('DOMContentLoaded', () => {
        if (debugConfig.enabled) {
            console.log('🔍 DOMContentLoaded event fired');
        }
        initializePCBCAM();
    });
    
    if (document.readyState === 'loading') {
        if (debugConfig.enabled) {
            console.log('🔍 Document still loading, waiting for DOMContentLoaded...');
        }
    } else {
        if (debugConfig.enabled) {
            console.log('🔍 Document already loaded, initializing immediately...');
        }
        initializePCBCAM();
    }
    
    // Fallback initialization
    setTimeout(() => {
        if (!window.cam) {
            if (debugConfig.enabled) {
                console.log('🔍 Delayed initialization attempt...');
            }
            initializePCBCAM();
        }
    }, timingConfig.autoSaveInterval || 1000);
    
    // Global function for HTML compatibility
    window.addFile = function(type) {
        if (debugConfig.logging?.fileOperations) {
            console.log(`🎯 addFile('${type}') called`);
        }
        
        if (window.cam) {
            try {
                window.cam.triggerFileInput(type);
            } catch (error) {
                console.error('❌ Error in triggerFileInput:', error);
            }
        } else {
            console.error('❌ window.cam not available');
            
            if (initializePCBCAM()) {
                window.cam.triggerFileInput(type);
            }
        }
    };
    
    // Console test functions
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
    
    window.checkLayerContamination = function() {
        if (!window.cam || !window.cam.core) {
            console.error('CAM not initialized');
            return;
        }
        return window.cam.core.checkLayerContamination();
    };
    
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
    
    // Config access for debugging
    window.PCBCAMConfig = config;
    
})();