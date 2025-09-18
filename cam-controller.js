// cam-controller.js
// Main application controller - Workspace Edition
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
    
    // PCB Example definitions - can be loaded from server later
    const PCB_EXAMPLES = {
        'xiao': {
            name: 'Xiao ESP32 V1',
            files: {
                isolation: 'examples/xiao/Xiao-F_Cu.gbr',
                drill: 'examples/xiao/Xiao-PTH.drl',
                clear: 'examples/xiao/Xiao-Keepout.gbr',
                cutout: 'examples/xiao/Xiao-Edge_Cuts.gbr'
            }
        },
        'arduino-shield': {
            name: 'Arduino Shield',
            files: {
                isolation: 'examples/shield_top.gbr',
                drill: 'examples/shield.drl',
                cutout: 'examples/shield_edge.gbr'
            }
        },
        'smd-adapter': {
            name: 'SMD to DIP Adapter',
            files: {
                isolation: 'examples/adapter_copper.gbr',
                drill: 'examples/adapter.drl'
            }
        },
        'test-pattern': {
            name: 'Test Pattern',
            files: {
                isolation: 'examples/test_pattern.gbr'
            }
        }
    };
    
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
            
            // Upload modal file tracking
            this.uploadedFiles = {};
            
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
                console.log('🚀 Starting PCB CAM Workspace Edition...');
            }
            
            // Set theme from config or saved
            const savedTheme = localStorage.getItem('theme') || uiConfig.theme;
            document.documentElement.setAttribute('data-theme', savedTheme);
            
            // Initialize UI with workspace
            this.ui.initializeUI();
            this.ui.setupWorkspace();
            this.setupEventListeners();
            this.initializationState.uiReady = true;
            
            if (debugConfig.enabled) {
                console.log('✅ Workspace UI initialized');
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
                    console.log('✅ PCB CAM fully initialized');
                }
                
                this.ui.updateStatus(messagesConfig.ready || 'Ready - Workspace loaded', 'success');
                
                // Show welcome modal for first-time users
                if (!localStorage.getItem('hasVisited')) {
                    this.showWelcomeModal();
                }
                
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
        
        showWelcomeModal() {
            this.ui.openModal('welcome-modal'); 
            
            // Populate example dropdown from JS
            const select = document.getElementById('pcb-example-select');
            if (select) {
                select.innerHTML = '';
                Object.entries(PCB_EXAMPLES).forEach(([key, example]) => {
                    const option = document.createElement('option');
                    option.value = key;
                    option.textContent = example.name;
                    if (key === 'xiao') option.selected = true;
                    select.appendChild(option);
                });
            }
            
            const closeBtn = document.getElementById('welcome-modal-close');
            const dontShowCheckbox = document.getElementById('dont-show-welcome');
            
            // Load example button
            const loadExampleBtn = document.getElementById('load-example-btn');
            if (loadExampleBtn) {
                loadExampleBtn.onclick = async () => {
                    const select = document.getElementById('pcb-example-select');
                    if (select) {
                        await this.loadPCBExample(select.value);
                    }
                    if (dontShowCheckbox && dontShowCheckbox.checked) {
                        localStorage.setItem('hasVisited', 'true');
                    }
                    this.ui.closeActiveModal();
                    // Ensure coordinate system is initialized
                    this.ensureCoordinateSystem();
                };
            }
            
            // Upload files button
            const uploadFilesBtn = document.getElementById('upload-files-btn');
            if (uploadFilesBtn) {
                uploadFilesBtn.onclick = () => {
                    if (dontShowCheckbox && dontShowCheckbox.checked) {
                        localStorage.setItem('hasVisited', 'true');
                    }
                    this.ui.closeActiveModal();
                    this.ensureCoordinateSystem();
                    this.showUploadModal();
                };
            }
            
            // Start empty button
            const startEmptyBtn = document.getElementById('start-empty-btn');
            if (startEmptyBtn) {
                startEmptyBtn.onclick = () => {
                    if (dontShowCheckbox && dontShowCheckbox.checked) {
                        localStorage.setItem('hasVisited', 'true');
                    }
                    this.ui.closeActiveModal();
                    // Initialize coordinate system for empty workspace
                    this.ensureCoordinateSystem();
                };
            }
        }
        
        ensureCoordinateSystem() {
            if (this.core.coordinateSystem && !this.core.coordinateSystem.initialized) {
                // Initialize with empty bounds if no operations
                this.core.coordinateSystem.initializeEmpty();
                if (this.ui.renderer) {
                    this.ui.updateOriginDisplay();
                }
            }
        }
        
        showUploadModal() {
            this.ui.openModal('upload-modal');
            this.uploadedFiles = {};
            
            // Setup file inputs
            ['isolation', 'drill', 'clear', 'cutout'].forEach(type => {
                const input = document.getElementById(`${type}-file`);
                const status = document.getElementById(`${type}-status`);
                
                if (input) {
                    input.value = '';
                    input.onchange = (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            this.uploadedFiles[type] = file;
                            if (status) {
                                status.textContent = `Selected: ${file.name}`;
                                status.style.color = 'var(--success)';
                            }
                            this.updateProcessButton();
                        }
                    };
                }
                
                if (status) {
                    status.textContent = '';
                }
            });
            
            // Process files button
            const processBtn = document.getElementById('process-files-btn');
            if (processBtn) {
                processBtn.disabled = true;
                processBtn.onclick = async () => {
                    await this.processUploadedFiles();
                    this.ui.closeActiveModal();
                };
            }
            
            // Cancel button
            const cancelBtn = document.getElementById('cancel-upload-btn');
            if (cancelBtn) {
                cancelBtn.onclick = () => {
                    this.ui.closeActiveModal();
                    this.uploadedFiles = {};
                };
            }
        }
        
        updateProcessButton() {
            const processBtn = document.getElementById('process-files-btn');
            if (processBtn) {
                processBtn.disabled = Object.keys(this.uploadedFiles).length === 0;
            }
        }
        
        async processUploadedFiles() {
            for (const [type, file] of Object.entries(this.uploadedFiles)) {
                await this.processFile(file, type, null);
            }
            this.uploadedFiles = {};
            
            // Ensure coordinate system is initialized after file upload
            this.ensureCoordinateSystem();
            
            // Expand operations after loading
            this.ui.operationsManager.expandAllOperations();
        }
        
        async loadPCBExample(exampleId) {
            const example = PCB_EXAMPLES[exampleId];
            if (!example) {
                console.error(`Example ${exampleId} not found`);
                return;
            }

            this.ui.updateStatus(`Loading example: ${example.name}...`, 'info');

            // Clear existing operations
            this.core.operations = [];
            this.ui.operationsManager.renderAllOperations();

            // Load all files in parallel
            const filePromises = Object.entries(example.files).map(async ([type, filepath]) => {
                try {
                    // Fetch actual file from server
                    const response = await fetch(filepath);
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    const content = await response.text();
                    const fileName = filepath.split('/').pop();
                    const file = new File([content], fileName, { type: 'text/plain' });
                    
                    // Process the file
                    await this.processFile(file, type, null);

                } catch (e) {
                    console.error(`Failed to load example file ${filepath}:`, e);
                    this.ui.showOperationMessage(type, `Failed to load ${filepath.split('/').pop()}`, 'error');
                }
            });

            await Promise.all(filePromises);

            // Force coordinate system initialization after loading
            if (this.core.coordinateSystem) {
                this.core.coordinateSystem.analyzeCoordinateSystem(this.core.operations);
            }

            this.ui.updateStatus(`Example '${example.name}' loaded successfully.`, 'success');
            
            // Update renderer
            if (this.ui.renderer) {
                await this.ui.updateRendererAsync();
            }
            
            // Expand operations after loading
            this.ui.operationsManager.expandAllOperations();
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
            
            // Canvas zoom controls
            document.getElementById('zoom-fit-btn')?.addEventListener('click', () => this.ui.renderer?.zoomFit());
            document.getElementById('zoom-in-btn')?.addEventListener('click', () => this.ui.renderer?.zoomIn());
            document.getElementById('zoom-out-btn')?.addEventListener('click', () => this.ui.renderer?.zoomOut());
            
            // Export controls
            document.getElementById('export-svg-btn')?.addEventListener('click', async () => {
                await this.ui.exportSVG();
            });
            
            document.getElementById('generate-gcode-btn')?.addEventListener('click', async () => {
                await this.exportGcode();
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
            
            // G-code settings
            document.getElementById('post-processor')?.addEventListener('change', (e) => {
                this.core.updateSettings('gcode', { postProcessor: e.target.value });
            });
            
            document.getElementById('gcode-units')?.addEventListener('change', (e) => {
                this.core.updateSettings('gcode', { units: e.target.value });
            });
            
            // Collapsible sections - including master Operations toggle
            document.querySelectorAll('.section-toggle').forEach(toggle => {
                toggle.addEventListener('click', () => {
                    const targetId = toggle.getAttribute('data-target');
                    const content = document.getElementById(targetId);
                    if (content) {
                        const isActive = content.style.display === 'block';
                        content.style.display = isActive ? 'none' : 'block';
                        toggle.classList.toggle('active', !isActive);
                    }
                });
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
                    // Include SVG in accepted extensions
                    const extensions = [...opConfig.extensions];
                    if (!extensions.includes('.svg')) {
                        extensions.push('.svg');
                    }
                    fileInput.setAttribute('accept', extensions.join(','));
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
                    
                    // Update coordinate system after successful parse
                    if (this.core.coordinateSystem) {
                        this.core.coordinateSystem.analyzeCoordinateSystem(this.core.operations);
                    }
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
        
        getStats() {
            return {
                core: this.core.getProcessorStats(),
                ui: {
                    fusionStats: this.ui.fusionStats,
                    hasRenderer: !!this.ui.renderer
                },
                operations: this.core.operations.length,
                debugMode: this.debugMode,
                initialization: this.initializationState
            };
        }
    }
    
    // Initialize application
    async function initializePCBCAM() {
        if (debugConfig.enabled) {
            console.log('🎯 Starting PCB CAM Workspace Edition initialization...');
            console.log('📊 Document state:', document.readyState);
        }
        
        // Check for required classes (some may be optional for workspace mode)
        const requiredClasses = [
            'PCBCamCore',
            'PCBCamUI',
            'LayerRenderer',
            'RendererCore',
            'PrimitiveRenderer',
            'OverlayRenderer',
            'InteractionHandler',
            'OperationsManager',
            'StatusManager',
            'UIControls'
        ];
        
        const optionalClasses = [
            'GeometryProcessor',
            'GerberParser',
            'ExcellonParser',
            'SVGParser',
            'ParserPlotter',
            'ParserCore',
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
        
        // Check optional classes
        if (debugConfig.enabled) {
            console.log('📋 Checking optional classes:');
            optionalClasses.forEach(className => {
                const exists = typeof window[className] !== 'undefined';
                console.log(`  ${exists ? '✅' : '⚠️'} ${className}`);
            });
        }
        
        try {
            if (debugConfig.enabled) {
                console.log('🚀 Creating PCB CAM application...');
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
            console.log('📌 DOMContentLoaded event fired');
        }
        initializePCBCAM();
    });
    
    if (document.readyState === 'loading') {
        if (debugConfig.enabled) {
            console.log('📌 Document still loading, waiting for DOMContentLoaded...');
        }
    } else {
        if (debugConfig.enabled) {
            console.log('📌 Document already loaded, initializing immediately...');
        }
        initializePCBCAM();
    }
    
    // Fallback initialization
    setTimeout(() => {
        if (!window.cam) {
            if (debugConfig.enabled) {
                console.log('📌 Delayed initialization attempt...');
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
    window.showCamStats = function() {
        if (!window.cam) {
            console.error('CAM not initialized');
            return;
        }
        console.log('PCB CAM Statistics:', window.cam.getStats());
    };

    // NEW: Add this function to inspect the curve registry
    window.getReconstructionRegistry = function() {
        if (!window.cam || !window.cam.core.geometryProcessor) {
            console.error('Geometry processor not initialized');
            return;
        }
        const registry = window.cam.core.geometryProcessor.arcReconstructor.exportRegistry();
        console.log(`Arc Reconstructor Registry (${registry.length} curves):`);
        console.table(registry);
        return registry;
    };
    
    // Config access for debugging
    window.PCBCAMConfig = config;
    
})();