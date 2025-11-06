/**
 * @file        cam-controller.js
 * @description Initializes and connects core and UI
 * @author      Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

/*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2025 Eltryus
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

(function() {
    'use strict';
    
    const config = window.PCBCAMConfig || {};
    const debugConfig = config.debug || {};
    const messagesConfig = config.ui?.messages || {};
    const uiConfig = config.ui || {};
    const timingConfig = uiConfig.timing || {};
    const opsConfig = config.operations || {};
    
    // PCB Example definitions
    const PCB_EXAMPLES = {
        'example1': {
            name: 'Example 1',
            files: {
                isolation: 'examples/example1/isolation.gbr',
                drill: 'examples/example1/drill.drl',
                clear: 'examples/example1/clear.gbr',
                cutout: 'examples/example1/cutout.gbr'
            }
        },
        'line': {
            name: 'CNC Precision Line Test',
            files: {
                isolation: 'examples/LineTest.svg'
            }
        }
    };
    
    class PCBCAMController {
        constructor() {
            this.core = null;
            this.ui = null;
            
            // Phase 1: State managers
            this.parameterManager = null;
            this.modalManager = null;
            
            // Phase 2: Pipeline components (declare but don't instantiate yet)
            this.gcodeGenerator = null
            this.toolpathOptimizer = null
            
            // Track initialization state
            this.initState = {
                coreReady: false,
                uiReady: false,
                wasmReady: false,
                fullyReady: false,
                error: null
            };
            
            // Pending operations queue
            this.pendingOperations = [];
            
            // Upload modal file tracking - one per operation type
            this.uploadedFiles = {
                isolation: null,
                drill: null,
                clear: null,
                cutout: null
            };
            
            // Queued files for processing
            this.queuedFiles = [];
        }
        
        async initialize() {
            console.log('🚀 PCB CAM Advanced Workspace v2.0 initializing...');
            
            try {
                // Initialize core with skip init flag to control WASM loading
                this.core = new PCBCamCore({ skipInit: true });
                
                // Initialize managers before UI
                this.parameterManager = new ParameterManager();
                this.modalManager = new ModalManager(this);

                // Instantiate pipeline components *after* core exists
                this.gcodeGenerator = new GCodeGenerator(config.gcode);
                this.gcodeGenerator.setCore(this.core);
                this.geometryTranslator = new GeometryTranslator(this.core);
                this.toolpathOptimizer = new ToolpathOptimizer();
                this.machineProcessor = new MachineProcessor(this.core);                
                
                // Initialize UI with core reference
                this.ui = new PCBCamUI(this.core);
                
                // Initialize UI (pass parameter manager)
                const uiReady = await this.ui.init(this.parameterManager);
                this.initState.uiReady = uiReady;
                
                if (!uiReady) {
                    throw new Error('UI initialization failed');
                }
                
                // Pass tool library to core if using advanced UI
                if (this.ui.toolLibrary) {
                    this.core.setToolLibrary(this.ui.toolLibrary);
                }
                
                // Initialize WASM modules
                const wasmReady = await this.initializeWASM();
                this.initState.wasmReady = wasmReady;
                
                if (!wasmReady) {
                    console.warn('⚠️ WASM modules failed to load - running in fallback mode');
                    this.ui?.updateStatus(messagesConfig.warning || 'Warning: Clipper2 failed to load - fusion disabled', 'warning');
                }
                
                // Setup global event handlers
                this.setupGlobalHandlers();
                
                // Setup toolbar handlers
                this.setupToolbarHandlers();
                
                // Expose controller globally for PropertyInspector
                window.pcbcam = this;
                window.pcbcam.modalManager = this.modalManager;
                
                // Process any pending operations
                await this.processPendingOperations();
                
                // Hide loading overlay and show UI
                this.hideLoadingOverlay();
                
               // Check for first-time user
                const hideWelcome = localStorage.getItem('pcbcam-hide-welcome');
                const hasVisited = localStorage.getItem('hasVisited');
                
                if (!hideWelcome && !hasVisited) {
                    // USE THE MODAL MANAGER
                    this.modalManager.showModal('welcome', { examples: PCB_EXAMPLES });
                } else {
                    // Ensure coordinate system is initialized
                    this.ensureCoordinateSystem();
                }
                
                this.initState.fullyReady = true;
                
                console.log('✅ PCB CAM ready');
                
                // Update status
                this.ui?.updateStatus(messagesConfig.ready || 'Ready - Advanced workspace loaded', 'success');
                
            } catch (error) {
                console.error('❌ Initialization failed:', error);
                this.initState.error = error.message;
                this.ui?.updateStatus('Initialization failed: ' + error.message, 'error');
                this.hideLoadingOverlay();
            }
        }
        
        async initializeWASM() {
            try {
                if (!this.core || typeof this.core.initializeProcessors !== 'function') {
                    console.warn('Core processor initialization not available');
                    return false;
                }
                
                if (debugConfig.logging?.wasmOperations) {
                    console.log('⏳ Loading Clipper2 WASM modules...');
                }
                
                const result = await this.core.initializeProcessors();
                
                if (result) {
                    if (debugConfig.enabled) {
                        console.log('✅ Clipper2 WASM modules loaded successfully');
                    }
                }
                
                return result;
                
            } catch (error) {
                console.error('❌ WASM initialization error:', error);
                return false;
            }
        }
        
        hideLoadingOverlay() {
            const overlay = document.getElementById('loading-overlay');
            if (overlay) {
                overlay.style.opacity = '0';
                setTimeout(() => {
                    overlay.style.display = 'none';

                    // This function now also shows the main UI
                    const toolbar = document.getElementById('cam-toolbar');
                    const workspace = document.getElementById('cam-workspace');
                    
                    if (toolbar) toolbar.style.display = 'flex';
                    if (workspace) workspace.style.display = 'grid';
                    
                }, 300); // 300ms matches your original opacity transition
            }
        }
        
        setupToolbarHandlers() {
            // Quick Actions dropdown
            const quickActionsBtn = document.getElementById('quick-actions-btn');
            const quickActionsMenu = document.getElementById('quick-actions-menu');
            
            if (quickActionsBtn && quickActionsMenu) {
                quickActionsBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    quickActionsBtn.classList.toggle('active');
                    quickActionsMenu.classList.toggle('show');
                });
                
                // Close on outside click
                document.addEventListener('click', () => {
                    quickActionsBtn.classList.remove('active');
                    quickActionsMenu.classList.remove('show');
                });
                
                quickActionsMenu.addEventListener('click', (e) => {
                    e.stopPropagation();
                });
            }
            
            // Toolbar action buttons
            const addFilesBtn = document.getElementById('toolbar-add-files');
            if (addFilesBtn) {
                addFilesBtn.addEventListener('click', () => {
                    // USE THE MODAL MANAGER
                    this.modalManager.showModal('file'); 
                    quickActionsBtn.classList.remove('active');
                    quickActionsMenu.classList.remove('show');
                });
            }
            
            const manageToolpathsBtn = document.getElementById('toolbar-manage-toolpaths');
            if (manageToolpathsBtn) {
                manageToolpathsBtn.addEventListener('click', () => {
                    // Collect operations with previews
                    const readyOps = this.core.operations.filter(op => op.preview);
                    if (readyOps.length === 0) {
                        this.ui?.updateStatus('No operations ready. Generate previews first.', 'warning');
                        return;
                    }
                    this.modalManager.showToolpathModal(readyOps);
                    quickActionsBtn.classList.remove('active');
                    quickActionsMenu.classList.remove('show');
                });
            }

            const exportSvgBtn = document.getElementById('toolbar-export-svg');
            if (exportSvgBtn) {
                exportSvgBtn.addEventListener('click', async () => {
                    if (!this.ui?.svgExporter) {
                        this.ui?.updateStatus('SVG exporter not available', 'error');
                        return;
                    }
                    
                    try {
                        this.ui.svgExporter.exportSVG();
                        this.ui?.updateStatus('SVG exported successfully', 'success');
                    } catch (error) {
                        console.error('SVG export error:', error);
                        this.ui?.updateStatus('SVG export failed: ' + error.message, 'error');
                    }
                    
                    quickActionsBtn.classList.remove('active');
                    quickActionsMenu.classList.remove('show');
                });
            }
        }
        
        setupGlobalHandlers() {
            // Handle resize
            window.addEventListener('resize', () => {
                if (this.ui?.renderer) {
                    this.ui.renderer.resizeCanvas();
                }
            });
            
            // Handle file drops on entire window
            window.addEventListener('dragover', (e) => {
                e.preventDefault();
            });
            
            window.addEventListener('drop', async (e) => {
                e.preventDefault();
                // Only handle if not over a specific drop zone
                if (!e.target.closest('.file-drop-zone') && !e.target.closest('#file-drop-zone')) {
                    await this.handleGlobalFileDrop(e.dataTransfer.files);
                }
            });
            
            // Keyboard shortcuts
            document.addEventListener('keydown', (e) => {
                // Skip if typing in input field
                if (e.target.matches('input, textarea, select')) return;
                
                // Ctrl/Cmd + O: Open files
                if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
                    e.preventDefault();
                    this.showFileModal();
                }
                
                // Ctrl/Cmd + S: Export SVG
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    e.preventDefault();
                    this.exportSVG();
                }
                
                // F: Fit to view (when not in input)
                if (e.key === 'f') {
                    e.preventDefault();
                    this.ui?.renderer?.zoomFit();
                }
                
                // W: Toggle wireframe
                if (e.key === 'w') {
                    e.preventDefault();
                    this.ui?.toggleWireframe();
                }
                
                // G: Toggle grid (when not using Ctrl/Cmd)
                if (e.key === 'g' && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    this.ui?.toggleGrid();
                }
                
                // Delete: Remove selected operation
                if (e.key === 'Delete') {
                    e.preventDefault();
                    this.removeSelectedOperation();
                }
            });
            
            // Theme toggle button
            const themeToggle = document.getElementById('theme-toggle');
            if (themeToggle) {
                themeToggle.addEventListener('click', async () => {
                    if (window.ThemeLoader && window.ThemeLoader.isLoaded()) {
                        await window.ThemeLoader.toggleTheme();
                        
                        // Update renderer if needed
                        if (this.ui?.renderer) {
                            const currentTheme = window.ThemeLoader.getCurrentTheme();
                            this.ui.renderer.setOptions({ theme: currentTheme });
                            this.ui.renderer.render();
                        }
                    }
                });
            }
        }
        
        ensureCoordinateSystem() {
            if (this.core?.coordinateSystem && !this.core.coordinateSystem.initialized) {
                // Initialize with empty bounds if no operations
                this.core.coordinateSystem.initializeEmpty();
                if (this.ui?.renderer) {
                    this.ui.updateOriginDisplay();
                }
            }
        }
        
        async processUploadedFiles() {
            for (const [type, file] of Object.entries(this.uploadedFiles)) {
                if (file) {
                    await this.processFile(file, type);
                }
            }
            
            // Reset
            this.uploadedFiles = {
                isolation: null,
                drill: null,
                clear: null,
                cutout: null
            };
            
            // Ensure coordinate system is initialized after file upload
            this.ensureCoordinateSystem();
            
            // Update UI
            if (this.ui?.treeManager) {
                this.ui.treeManager.expandAll();
            }

            // Auto-fit to show all loaded geometry
            if (this.ui?.renderer) {
                setTimeout(() => {
                    this.ui.renderer.zoomFit(1.1);
                }, 100); // Small delay to ensure rendering is complete
            }
        }
        
        async loadExample(exampleId) {
            if (!exampleId) {
                // If no ID provided, try to get from welcome modal select
                const select = document.getElementById('pcb-example-select');
                exampleId = select ? select.value : 'xiao';
            }
            
            const example = PCB_EXAMPLES[exampleId];
            if (!example) {
                console.error(`Example ${exampleId} not found`);
                this.ui?.updateStatus(`Example not found: ${exampleId}`, 'error');
                return;
            }
            
            this.ui?.updateStatus(`Loading example: ${example.name}...`, 'info');
            
            // Clear existing operations
            if (this.core) {
                this.core.operations = [];
                this.core.toolpaths.clear();
                this.core.isToolpathCacheValid = false;
            }
            
            // Clear UI
            if (this.ui?.treeManager) {
                this.ui.treeManager.refreshTree();
            }
            
            // Load all files serially
            for (const [type, filepath] of Object.entries(example.files)) {
                try {
                    // Map 'clear' in examples to 'clearing' if that's what exists in config
                    let actualType = type;
                    if (type === 'clear') {
                        // If config has 'clearing' but not 'clear', use 'clearing'
                        if (config.operations.clearing && !config.operations.clear) {
                            actualType = 'clearing';
                        }
                    } else if (type === 'clearing') {
                        // If config has 'clear' but not 'clearing', use 'clear'
                        if (config.operations.clear && !config.operations.clearing) {
                            actualType = 'clear';
                        }
                    }
                    
                    const response = await fetch(filepath);
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    const content = await response.text();
                    const fileName = filepath.split('/').pop();
                    const file = new File([content], fileName, { type: 'text/plain' });
                    
                    // Process the file with corrected type
                    await this.processFile(file, actualType);
                    
                } catch (e) {
                    console.error(`Failed to load example file ${filepath}:`, e);
                    this.ui?.updateStatus(`Failed to load ${filepath.split('/').pop()}`, 'error');
                    this.ui?.showOperationMessage?.(type, `Failed to load ${filepath.split('/').pop()}`, 'error');
                }
            }
            
            // Force coordinate system initialization after loading
            if (this.core?.coordinateSystem) {
                this.core.coordinateSystem.analyzeCoordinateSystem(this.core.operations);
            }
            
            this.ui?.updateStatus(`Example '${example.name}' loaded successfully.`, 'success');
            
            // Update renderer and fit view
            if (this.ui?.renderer) {
                await this.ui.updateRendererAsync();
                this.ui.renderer.zoomFit();
            }
            
            // Expand operations after loading
            if (this.ui?.treeManager) {
                this.ui.treeManager.expandAll();
            }
        }
        
        async processFile(file, type) {
            if (!file || !type) {
                console.error('Invalid file or type provided');
                return;
            }
            
            // Validate file type
            const validation = this.core?.validateFileType(file.name, type);
            if (validation && !validation.valid) {
                this.ui?.showOperationMessage?.(type, validation.message, 'error');
                this.ui?.updateStatus(validation.message, 'error');
                return;
            }
            
            // Create operation
            const operation = this.core?.createOperation(type, file);
            if (!operation) {
                console.error('Failed to create operation');
                return;
            }
            
            // Add to UI tree if using advanced UI
            if (this.ui?.treeManager) {
                this.ui.treeManager.addFileNode(operation);
            }
            
            // Render in operations manager if using basic UI
            if (this.ui?.renderOperations) {
                this.ui.renderOperations(type);
            }
            
            // Show loading status
            this.ui?.updateStatus(`${messagesConfig.loading || 'Loading'} ${file.name}...`);
            
            // Read and parse file
            const reader = new FileReader();
            
            return new Promise((resolve) => {
                reader.onload = async (e) => {
                    operation.file.content = e.target.result;
                    
                    const success = await this.core.parseOperation(operation);
                    
                    if (success) {
                        const count = operation.primitives.length;
                        
                        if (operation.parsed?.hasArcs && debugConfig.enabled) {
                            console.log(`Preserved ${operation.originalArcs?.length || 0} arcs for potential reconstruction`);
                        }
                        
                        this.ui?.showOperationMessage?.(type, `Successfully loaded ${count} primitives`, 'success');
                        this.ui?.updateStatus(`Loaded ${operation.file.name}: ${count} primitives`, 'success');
                        
                        // Update coordinate system after successful parse
                        if (this.core?.coordinateSystem) {
                            this.core.coordinateSystem.analyzeCoordinateSystem(this.core.operations);
                        }
                    } else {
                        this.ui?.showOperationMessage?.(type, `Error: ${operation.error}`, 'error');
                        this.ui?.updateStatus(`Error processing ${operation.file.name}: ${operation.error}`, 'error');
                    }
                    
                    // Update UI
                    if (this.ui?.renderOperations) {
                        this.ui.renderOperations(type);
                    }
                    
                    // Update tree with geometry info if using advanced UI
                    if (this.ui?.treeManager) {
                        const fileNode = Array.from(this.ui.treeManager.nodes.values())
                            .find(n => n.operation?.id === operation.id);
                        if (fileNode) {
                            this.ui.treeManager.updateFileGeometries(fileNode.id, operation);
                        }
                    }
                    
                    // Update renderer to show new geometry
                    if (this.ui?.updateRendererAsync) {
                        await this.ui.updateRendererAsync();
                    } else if (this.ui?.updateRenderer) {
                        await this.ui.updateRenderer();
                    }

                    // Auto-fit on first file
                    const hasMultipleOps = this.core.operations.length > 1;
                    if (!hasMultipleOps && this.ui?.renderer) {
                        this.ui.renderer.zoomFit();
                    }
                    
                    // Update statistics
                    this.ui?.updateStatistics?.();
                    
                    resolve();
                };
                
                reader.onerror = () => {
                    operation.error = 'Failed to read file';
                    this.ui?.showOperationMessage?.(type, 'Failed to read file', 'error');
                    this.ui?.updateStatus(`Failed to read ${file.name}`, 'error');
                    resolve();
                };
                
                reader.readAsText(file);
            });
        }
        
        async handleGlobalFileDrop(files) {
            if (!this.ui) return;
            
            // Process files serially to avoid race conditions
            for (let file of files) {
                const ext = file.name.toLowerCase().split('.').pop();
                const opType = this.getOperationTypeFromExtension(ext);
                
                if (opType) {
                    if (this.initState.fullyReady) {
                        await this.processFile(file, opType);
                    } else {
                        this.pendingOperations.push({ file, opType });
                    }
                }
            }
            
            // Auto-fit *after* all files are loaded
            if (this.pendingOperations.length === 0 && this.initState.fullyReady) {
                // Ensure coordinate system updates
                if (this.core?.coordinateSystem) {
                    this.core.coordinateSystem.analyzeCoordinateSystem(this.core.operations);
                }
                
                // Force renderer update and zoom
                if (this.ui?.updateRendererAsync) {
                    await this.ui.updateRendererAsync();
                    if (this.ui.renderer) {
                        this.ui.renderer.zoomFit();
                    }
                }
            }
            
            if (this.pendingOperations.length > 0 && !this.initState.fullyReady) {
                this.ui?.updateStatus('Files queued - waiting for initialization...', 'info');
            }
        }
        
        getOperationTypeFromExtension(ext) {
            const operations = config.operations || {};
            for (let [type, op] of Object.entries(operations)) {
                if (op.extensions && op.extensions.some(e => e.slice(1) === ext)) {
                    return type;
                }
            }
            return null;
        }
        
        async processPendingOperations() {
            if (this.pendingOperations.length === 0) return;
            
            if (debugConfig.logging?.fileOperations) {
                console.log(`Processing ${this.pendingOperations.length} pending files...`);
            }
            
            for (let op of this.pendingOperations) {
                await this.processFile(op.file, op.opType);
            }
            
            this.pendingOperations = [];
        }
        
        removeSelectedOperation() {
            // Try advanced UI first
            const selectedNode = this.ui?.treeManager?.selectedNode;
            if (selectedNode?.type === 'file' && selectedNode.operation) {
                this.ui.removeOperation(selectedNode.operation.id);
                return;
            }
            
            // Fall back to basic UI selection method if needed
            const selectedOp = this.ui?.getSelectedOperation?.();
            if (selectedOp) {
                this.ui.removeOperation(selectedOp.id);
            }
        }

        async orchestrateToolpaths(options) {
            if (!options || !options.operationIds || !this.core || !this.gcodeGenerator) {
                console.error("[Controller] Orchestration failed, missing core components.");
                return { gcode: "; Generation Failed", lineCount: 1, planCount: 0, estimatedTime: 0 };
            }

            // Ensure processors exist
            if (!this.geometryTranslator) {
                this.geometryTranslator = new GeometryTranslator(this.core);
            }
            if (!this.machineProcessor) {
                this.machineProcessor = new MachineProcessor(this.core);
            }
            if (!this.toolpathOptimizer) {
                this.toolpathOptimizer = new ToolpathOptimizer();
            }

            // STAGE 1: Get operations
            const selectedOps = options.operationIds
                .map(id => options.operations.find(o => o.id === id))
                .filter(Boolean);
            
            if (selectedOps.length === 0) {
                return { gcode: "; No operations selected", lineCount: 1, planCount: 0, estimatedTime: 0 };
            }

            // STAGE 2: Separate operations
            const millingOps = selectedOps.filter(op => op.type !== 'drill');
            const drillOps = selectedOps.filter(op => op.type === 'drill');

            // STAGE 2a: Translate MILLING ops
            console.log(`[Controller] Stage 2a: Translating ${millingOps.length} milling operations...`);
            const pureMillingPlans = [];
            for (const op of millingOps) {
                if (!op.offsets || op.offsets.length === 0) {
                    console.warn(`[Controller] Milling Op ${op.id} has no offset geometry`);
                    continue;
                }
                const opPlans = await this.geometryTranslator.translateOperation(op);
                pureMillingPlans.push(...opPlans);
            }
            console.log(`[Controller] Stage 2a: ${pureMillingPlans.length} pure milling plans`);

            // STAGE 2b: Translate DRILL ops
            console.log(`[Controller] Stage 2b: Translating ${drillOps.length} drill operations...`);
            const pureDrillPlans = [];
            for (const op of drillOps) {
                if (!op.offsets || op.offsets.length === 0) {
                    console.warn(`[Controller] Drill Op ${op.id} has no strategy geometry`);
                    continue;
                }
                const opPlans = await this.geometryTranslator.translateOperation(op);
                pureDrillPlans.push(...opPlans);
            }
            console.log(`[Controller] Stage 2b: ${pureDrillPlans.length} pure drill plans`);

            
            // STAGE 3: Optimize geometry (optional)
            let optimizedMillingPlans = pureMillingPlans;
            let optimizedDrillPlans = pureDrillPlans;

            if (options.optimize === true) {
                console.log('[Controller] Stage 3: Optimizing with clustering...');
                
                // STAGE 3a: Optimize MILLING plans
                // (This runs with Z-grouping, clustering, etc.)
                optimizedMillingPlans = this.toolpathOptimizer.optimize(pureMillingPlans);
                
                // STAGE 3b: Optimize DRILL plans
                // (This will just do nearest-neighbor, as Z-grouping won't find groups)
                optimizedDrillPlans = this.toolpathOptimizer.optimize(pureDrillPlans);

                const stats = this.toolpathOptimizer.getStats();
                console.log(`[Controller] Optimization complete:`, {
                    pointsRemoved: stats.pointsRemoved,
                    travelSaved: `${stats.travelSavedPercent}% (${stats.travelDistanceSaved.toFixed(1)}mm)`,
                    time: `${stats.optimizationTime.toFixed(1)}ms`
                });
            }
            
            // STAGE 3c: Combine lists
            // We run all optimized milling, then all optimized drilling.
            const plansToProcess = [...optimizedMillingPlans, ...optimizedDrillPlans];

            // STAGE 4: Add machine moves
            console.log('[Controller] Stage 4: Adding machine operations...');

            const machineSettings = {
                safeZ: options.safeZ || this.core.settings.machine.safeZ || 5.0,
                travelZ: options.travelZ || this.core.settings.machine.travelZ || 2.0,
                plungeRate: options.plungeRate || 50,
                rapidFeedRate: options.rapidFeedRate || 1000,
                ...options
            };
            
            // Processor now takes ToolpathPlan[] directly
            const machineReadyPlans = this.machineProcessor.processPlans(plansToProcess, machineSettings);
            console.log(`[Controller] Stage 3: ${machineReadyPlans.length} machine-ready plans`);

            // STAGE 5: Generate G-code
            console.log('[Controller] Stage 5: Generating G-code...');
            const genOptions = {
                postProcessor: options.postProcessor || 'grbl',
                includeComments: options.includeComments !== false,
                singleFile: options.singleFile !== false,
                toolChanges: options.toolChanges || false,
                safeZ: machineSettings.safeZ
            };
            
            const gcode = this.gcodeGenerator.generate(machineReadyPlans, genOptions);

            // STAGE 6: Estimate time
            let estimatedTime = 0;
            if (this.machineProcessor) {
                estimatedTime = this.machineProcessor.estimateMachineTime(machineReadyPlans);
            }

            return {
                gcode: gcode,
                lineCount: gcode.split('\n').length,
                planCount: machineReadyPlans.length,
                estimatedTime: estimatedTime
            };
        }
        
        async exportSVG() {
            if (this.ui?.exportSVG) {
                await this.ui.exportSVG();
                return;
            }
            
            // Fallback implementation
            if (!this.ui?.svgExporter || !this.ui?.renderer) {
                this.ui?.updateStatus('SVG export not available', 'error');
                return;
            }
            
            try {
                const svgString = this.ui.svgExporter.exportSVG({
                    precision: 2,
                    padding: 5,
                    optimizePaths: true,
                    includeMetadata: true,
                    includeArcReconstructionStats: this.ui.fusionStats?.arcReconstructionEnabled
                });
                
                if (svgString) {
                    // Create download
                    const blob = new Blob([svgString], { type: 'image/svg+xml' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'pcb-export.svg';
                    a.click();
                    URL.revokeObjectURL(url);
                    
                    this.ui.updateStatus('SVG exported successfully', 'success');
                } else {
                    this.ui.updateStatus('SVG export failed - no content to export', 'warning');
                }
            } catch (error) {
                console.error('SVG export error:', error);
                this.ui?.updateStatus('SVG export failed: ' + error.message, 'error');
            }
        }
        
        // API for external access
        getCore() {
            return this.core;
        }
        
        getUI() {
            return this.ui;
        }
        
        isReady() {
            return this.initState.fullyReady;
        }
        
        getStats() {
            return {
                initialization: this.initState,
                core: this.core?.getStats ? this.core.getStats() : null,
                ui: this.ui?.stats,
                toolLibrary: this.ui?.toolLibrary?.getStats?.(),
                renderer: {
                    hasRenderer: !!this.ui?.renderer,
                    layerCount: this.ui?.renderer?.layers?.size || 0
                }
            };
        }
        
        // Debug utilities
        enableDebug() {
            debugConfig.enabled = true;
            if (this.core?.geometryProcessor) {
                this.core.geometryProcessor.options.debug = true;
            }
            console.log('Debug mode enabled');
        }
        
        disableDebug() {
            debugConfig.enabled = false;
            if (this.core?.geometryProcessor) {
                this.core.geometryProcessor.options.debug = false;
            }
            console.log('Debug mode disabled');
        }
        
        logState() {
            console.group('PCB CAM State');
            console.log('Initialization:', this.initState);
            console.log('Statistics:', this.getStats());
            console.log('Config:', config);
            console.groupEnd();
        }
    }
    
    // Initialize application
    let controller = null;
    
    async function startApplication() {
        if (controller) {
            console.warn('Application already initialized');
            return;
        }
        
        // Check for required core classes
        const requiredClasses = [
            'PCBCamCore',
            'PCBCamUI',
            'LayerRenderer'
        ];
        
        // Check for optional UI components (may not exist in basic mode)
        const optionalClasses = [
            'TreeManager',
            'PropertyInspector',
            'VisibilityPanel',
            'ToolLibrary',
            'StatusManager',
            'UIControls'
        ];
        
        const missing = requiredClasses.filter(cls => typeof window[cls] === 'undefined');
        
        if (missing.length > 0) {
            console.error('Missing required classes:', missing);
            
            // Update loading text
            const loadingText = document.getElementById('loading-text');
            if (loadingText) {
                loadingText.textContent = 'Loading error - missing modules';
            }
            
            return false;
        }
        
        // Check optional classes
        if (debugConfig.enabled) {
            console.log('Checking optional classes:');
            optionalClasses.forEach(cls => {
                const available = typeof window[cls] !== 'undefined';
                console.log(`  ${available ? '✓' : '○'} ${cls}`);
            });
        }
        
        controller = new PCBCAMController();
        await controller.initialize();
        
        // Expose to global scope for debugging
        window.pcbcam = controller;
        window.cam = controller; // Also expose as 'cam' for compatibility
        
        return true;
    }

    // Expose startApplication to the global scope so index.html can call it
    window.startApplication = startApplication;
    
    // Public API functions
    window.showPCBStats = function() {
        if (!controller) {
            console.error('Application not initialized');
            return;
        }
        controller.logState();
    };
    
    window.showCamStats = window.showPCBStats; // Alias for compatibility
    
    window.enablePCBDebug = function() {
        if (controller) {
            controller.enableDebug();
        } else {
            debugConfig.enabled = true;
        }
    };
    
    window.disablePCBDebug = function() {
        if (controller) {
            controller.disableDebug();
        } else {
            debugConfig.enabled = false;
        }
    };
    
    // Global function for HTML compatibility
    window.addFile = function(type) {
        if (debugConfig.logging?.fileOperations) {
            console.log(`🎯 addFile('${type}') called`);
        }
        
        if (controller?.ui) {
            // Try to use the UI's file input trigger if available
            if (controller.ui.triggerFileInput) {
                controller.ui.triggerFileInput(type);
            } else {
                // Fall back to direct file input trigger
                const fileInput = document.getElementById('file-input-temp') || 
                                 document.getElementById('file-input-hidden');
                if (fileInput) {
                    fileInput.setAttribute('data-type', type);
                    
                    const opConfig = opsConfig[type];
                    if (opConfig) {
                        const extensions = [...opConfig.extensions];
                        if (!extensions.includes('.svg')) {
                            extensions.push('.svg');
                        }
                        fileInput.setAttribute('accept', extensions.join(','));
                    }
                    
                    fileInput.onchange = async (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            await controller.processFile(file, type);
                        }
                        fileInput.value = '';
                    };
                    
                    fileInput.click();
                } else {
                    console.error('File input element not found');
                }
            }
        } else {
            console.error('Controller not initialized');
        }
    };
    
    // Arc reconstruction registry inspector
    window.getReconstructionRegistry = function() {
        if (!controller?.core?.geometryProcessor) {
            console.error('Geometry processor not initialized');
            return;
        }
        const registry = controller.core.geometryProcessor.arcReconstructor?.exportRegistry?.();
        if (registry) {
            console.log(`Arc Reconstructor Registry (${registry.length} curves):`);
            console.table(registry);
        }
        return registry;
    };
    
})();