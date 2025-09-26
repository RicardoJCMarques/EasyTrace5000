// cam-ui.js
// UI orchestrator for PCB CAM - manages components and coordinates interactions
// This is THE interface - no mode detection, no fallbacks

(function() {
    'use strict';
    
    const config = window.PCBCAMConfig || {};
    const debugConfig = config.debug || {};
    const messagesConfig = (config.ui && config.ui.messages) || {};
    const opsConfig = config.operations || {};
    
    class PCBCamUI {
        constructor(core) {
            this.core = core;
            
            // UI Components - initialize what's available
            this.treeManager = null;
            this.propertyInspector = null;
            this.visibilityPanel = null;
            this.toolLibrary = null;
            this.statusManager = null;
            this.operationsManager = null;
            this.controls = null;
            
            // Renderer and exporters
            this.renderer = null;
            this.coordinateSystem = null;
            this.svgExporter = null;
            
            // View state
            this.viewState = {
                showPreprocessed: false,
                enableArcReconstruction: false,
                fuseGeometry: false,
                showWireframe: false,
                showGrid: true,
                blackAndWhite: false,
                debugCurvePoints: false
            };
            
            // Fusion statistics
            this.fusionStats = {
                arcReconstructionEnabled: false,
                curvesRegistered: 0,
                curvesReconstructed: 0,
                curvesLost: 0
            };
            
            // Statistics
            this.stats = {
                files: 0,
                operations: 0,
                primitives: 0,
                toolpaths: 0,
                processingTime: 0
            };
        }
        
        async init() {
            try {
                // Initialize tool library first (embedded in config)
                if (typeof ToolLibrary !== 'undefined') {
                    this.toolLibrary = new ToolLibrary();
                    await this.toolLibrary.init();
                    // Pass to core for toolpath generation
                    if (this.core.setToolLibrary) {
                        this.core.setToolLibrary(this.toolLibrary);
                    }
                }
                
                // Initialize available UI components
                if (typeof TreeManager !== 'undefined') {
                    this.treeManager = new TreeManager(this);
                    this.treeManager.init();
                }
                
                if (typeof PropertyInspector !== 'undefined') {
                    this.propertyInspector = new PropertyInspector(this);
                    this.propertyInspector.init(this.toolLibrary);
                }
                
                if (typeof VisibilityPanel !== 'undefined') {
                    this.visibilityPanel = new VisibilityPanel(this);
                    // Init after renderer
                }
                
                if (typeof OperationsManager !== 'undefined') {
                    this.operationsManager = new OperationsManager(this);
                }
                
                if (typeof StatusManager !== 'undefined') {
                    this.statusManager = new StatusManager(this);
                }
                
                // Initialize renderer
                this.initializeRenderer();
                
                // Initialize controls AFTER renderer
                if (typeof UIControls !== 'undefined') {
                    this.controls = new UIControls(this);
                    this.controls.init(this.renderer, this.coordinateSystem);
                }
                
                // Initialize visibility panel with renderer
                if (this.visibilityPanel && this.renderer) {
                    this.visibilityPanel.init(this.renderer);
                }
                
                // Setup event handlers
                this.setupEventHandlers();
                
                // Setup theme
                this.initializeTheme();
                
                // Update initial status
                this.updateStatus('Ready - Add PCB files to begin');
                
                if (debugConfig.enabled) {
                    console.log('PCBCamUI initialized');
                }
                
                return true;
                
            } catch (error) {
                console.error('Failed to initialize UI:', error);
                this.updateStatus('Initialization error: ' + error.message, 'error');
                return false;
            }
        }
        
        initializeRenderer() {
            const canvas = document.getElementById('preview-canvas');
            if (!canvas) {
                console.warn('Preview canvas not found');
                return;
            }
            
            if (typeof LayerRenderer !== 'undefined') {
                this.renderer = new LayerRenderer('preview-canvas');
                
                // Initialize coordinate system
                if (typeof CoordinateSystemManager !== 'undefined') {
                    this.coordinateSystem = new CoordinateSystemManager({ 
                        debug: debugConfig.enabled 
                    });
                    this.core.coordinateSystem = this.coordinateSystem;
                    this.renderer.setCoordinateSystem(this.coordinateSystem);
                    this.coordinateSystem.setRenderer(this.renderer);
                }
                
                // Initialize SVG exporter
                if (typeof SVGExporter !== 'undefined') {
                    this.svgExporter = new SVGExporter(this.renderer);
                }
                
                // Apply default view settings
                this.renderer.setOptions({
                    showWireframe: this.viewState.showWireframe,
                    showGrid: this.viewState.showGrid,
                    showOrigin: true,
                    showRulers: true,
                    fuseGeometry: this.viewState.fuseGeometry,
                    blackAndWhite: this.viewState.blackAndWhite,
                    debugCurvePoints: this.viewState.debugCurvePoints,
                    theme: document.documentElement.getAttribute('data-theme') || 'dark'
                });
                
                // Setup canvas resize observer
                if (window.ResizeObserver) {
                    const resizeObserver = new ResizeObserver(() => {
                        if (this.renderer) {
                            this.renderer.resizeCanvas();
                        }
                    });
                    resizeObserver.observe(canvas.parentElement);
                }
                
                this.renderer.render();
            }
        }
        
        initializeTheme() {
            const savedTheme = localStorage.getItem('pcbcam-theme') || (config.ui && config.ui.theme) || 'dark';
            document.documentElement.setAttribute('data-theme', savedTheme);
            
            if (this.renderer) {
                this.renderer.setOptions({ theme: savedTheme });
            }
        }
        
        setupEventHandlers() {
            // Canvas controls
            const zoomFitBtn = document.getElementById('zoom-fit-btn');
            if (zoomFitBtn) {
                zoomFitBtn.addEventListener('click', () => {
                    if (this.renderer) this.renderer.zoomFit();
                });
            }
            
            const zoomInBtn = document.getElementById('zoom-in-btn');
            if (zoomInBtn) {
                zoomInBtn.addEventListener('click', () => {
                    if (this.renderer) this.renderer.zoomIn();
                });
            }
            
            const zoomOutBtn = document.getElementById('zoom-out-btn');
            if (zoomOutBtn) {
                zoomOutBtn.addEventListener('click', () => {
                    if (this.renderer) this.renderer.zoomOut();
                });
            }
            
            const gridBtn = document.getElementById('toggle-grid-btn');
            if (gridBtn) {
                gridBtn.addEventListener('click', () => this.toggleGrid());
            }
            
            const wireframeBtn = document.getElementById('toggle-wireframe-btn');
            if (wireframeBtn) {
                wireframeBtn.addEventListener('click', () => this.toggleWireframe());
            }
            
            // Quick actions
            const addFileBtn = document.getElementById('add-file-btn');
            if (addFileBtn) {
                addFileBtn.addEventListener('click', () => this.showFileModal());
            }
            
            const genToolpathsBtn = document.getElementById('generate-toolpaths-btn');
            if (genToolpathsBtn) {
                genToolpathsBtn.addEventListener('click', () => this.generateToolpaths());
            }
            
            const exportGcodeBtn = document.getElementById('export-gcode-btn');
            if (exportGcodeBtn) {
                exportGcodeBtn.addEventListener('click', () => this.exportGCode());
            }
            
            const exportSvgBtn = document.getElementById('export-svg-btn');
            if (exportSvgBtn) {
                exportSvgBtn.addEventListener('click', async () => await this.exportSVG());
            }
            
            /* DOCUMENTATION - View Controls Needed:
               These controls exist in backend but need HTML elements:
               
               #show-wireframe (checkbox) - Wireframe mode
               #show-grid (checkbox) - Grid display
               #show-bounds (checkbox) - Board bounds
               #show-rulers (checkbox) - Canvas rulers
               #show-regions (checkbox) - Filled regions
               #show-traces (checkbox) - Trace lines
               #show-pads (checkbox) - Pad display
               #show-drills (checkbox) - Drill holes
               #show-cutouts (checkbox) - Board cutouts
               
               #fuse-geometry (checkbox) - Enable fusion
               #show-preprocessed (checkbox) - Show preprocessed vs fused
               #enable-arc-reconstruction (checkbox) - Arc reconstruction
               #debug-curve-points (checkbox) - Debug curve points
               #black-and-white (checkbox) - B&W mode
            */
            this.setupViewControls();
            
            /* DOCUMENTATION - Coordinate System Controls Needed:
               These exist in UIControls but need HTML elements:
               
               #x-offset (input) - X offset for origin preview
               #y-offset (input) - Y offset for origin preview
               #center-origin-btn (button) - Center origin
               #bottom-left-origin-btn (button) - Bottom-left origin
               #reset-origin-btn (button) - Reset to saved
               #apply-set-origin-btn (button) - Save current origin
               #rotation-angle (input) - Board rotation angle
               #apply-rotation-btn (button) - Apply rotation
               #reset-rotation-btn (button) - Reset rotation
               #board-size (span) - Display board dimensions
            */
            this.setupCoordinateControls();
            
            /* DOCUMENTATION - Machine Settings Needed:
               Backend exists but needs UI panel:
               
               #pcb-thickness (input) - PCB thickness in mm
               #safe-z (input) - Safe Z height
               #travel-z (input) - Travel Z height
               #rapid-feed (input) - Rapid feed rate
               #post-processor (select) - G-code post processor
               #gcode-units (select) - Units (mm/inch)
            */
            this.setupMachineSettings();
            
            // File input handler
            const fileInput = document.getElementById('file-input-hidden');
            if (fileInput) {
                fileInput.addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        const opType = fileInput.getAttribute('data-type') || 
                                      (fileInput.dataset && fileInput.dataset.opType);
                        if (opType) {
                            await this.processFile(file, opType);
                        }
                    }
                    fileInput.value = '';
                });
            }
            
            // Collapsible sections
            const headers = document.querySelectorAll('.collapsible-header');
            headers.forEach(header => {
                header.addEventListener('click', () => {
                    const targetId = header.getAttribute('data-target');
                    const content = document.getElementById(targetId);
                    if (content) {
                        content.classList.toggle('collapsed');
                        const indicator = header.querySelector('.collapse-indicator');
                        if (indicator) {
                            indicator.classList.toggle('collapsed');
                        }
                    }
                });
            });
        }
        
        setupViewControls() {
            // Wireframe
            const wireframeControl = document.getElementById('show-wireframe');
            if (wireframeControl) {
                wireframeControl.checked = this.viewState.showWireframe;
                wireframeControl.addEventListener('change', (e) => {
                    this.viewState.showWireframe = e.target.checked;
                    if (this.renderer) {
                        this.renderer.setOptions({ showWireframe: e.target.checked });
                        this.renderer.render();
                    }
                });
            }
            
            // Grid
            const gridControl = document.getElementById('show-grid');
            if (gridControl) {
                gridControl.checked = this.viewState.showGrid;
                gridControl.addEventListener('change', (e) => {
                    this.viewState.showGrid = e.target.checked;
                    if (this.renderer) {
                        this.renderer.setOptions({ showGrid: e.target.checked });
                        this.renderer.render();
                    }
                });
            }
            
            // Fusion
            const fuseControl = document.getElementById('fuse-geometry');
            if (fuseControl) {
                fuseControl.checked = this.viewState.fuseGeometry;
                fuseControl.addEventListener('change', async (e) => {
                    this.viewState.fuseGeometry = e.target.checked;
                    if (this.renderer) {
                        this.renderer.setOptions({ fuseGeometry: e.target.checked });
                    }
                    await this.updateRendererAsync();
                });
            }
            
            // Arc reconstruction
            const arcControl = document.getElementById('enable-arc-reconstruction');
            if (arcControl) {
                arcControl.checked = this.viewState.enableArcReconstruction;
                arcControl.addEventListener('change', async (e) => {
                    if (!this.viewState.fuseGeometry && e.target.checked) {
                        e.target.checked = false;
                        this.updateStatus('Enable fusion first to use arc reconstruction', 'warning');
                        return;
                    }
                    
                    this.viewState.enableArcReconstruction = e.target.checked;
                    this.fusionStats.arcReconstructionEnabled = e.target.checked;
                    
                    if (this.core.geometryProcessor) {
                        this.core.geometryProcessor.clearCachedStates();
                    }
                    
                    await this.updateRendererAsync();
                });
            }
            
            // Other display options
            const displayOptions = [
                { id: 'show-bounds', option: 'showBounds' },
                { id: 'show-rulers', option: 'showRulers' },
                { id: 'show-regions', option: 'showRegions' },
                { id: 'show-traces', option: 'showTraces' },
                { id: 'show-pads', option: 'showPads' },
                { id: 'show-drills', option: 'showDrills' },
                { id: 'show-cutouts', option: 'showCutouts' },
                { id: 'show-preprocessed', option: 'showPreprocessed' },
                { id: 'debug-curve-points', option: 'debugCurvePoints' },
                { id: 'black-and-white', option: 'blackAndWhite' }
            ];
            
            displayOptions.forEach(({ id, option }) => {
                const control = document.getElementById(id);
                if (control) {
                    control.checked = this.viewState[option] || (this.renderer && this.renderer.options[option]);
                    control.addEventListener('change', async (e) => {
                        this.viewState[option] = e.target.checked;
                        if (this.renderer) {
                            this.renderer.setOptions({ [option]: e.target.checked });
                        }
                        
                        // Some options need re-render
                        if (option === 'showPreprocessed') {
                            await this.updateRendererAsync();
                        } else if (this.renderer) {
                            this.renderer.render();
                        }
                    });
                }
            });
        }
        
        setupCoordinateControls() {
            // These delegate to UIControls when available
            const centerBtn = document.getElementById('center-origin-btn');
            if (centerBtn) {
                centerBtn.addEventListener('click', () => {
                    if (this.controls && this.controls.centerOrigin) {
                        this.controls.centerOrigin();
                    }
                });
            }
            
            const bottomLeftBtn = document.getElementById('bottom-left-origin-btn');
            if (bottomLeftBtn) {
                bottomLeftBtn.addEventListener('click', () => {
                    if (this.controls && this.controls.bottomLeftOrigin) {
                        this.controls.bottomLeftOrigin();
                    }
                });
            }
            
            const resetBtn = document.getElementById('reset-origin-btn');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => {
                    if (this.controls && this.controls.resetOrigin) {
                        this.controls.resetOrigin();
                    }
                });
            }
            
            const applyBtn = document.getElementById('apply-set-origin-btn');
            if (applyBtn) {
                applyBtn.addEventListener('click', () => {
                    if (this.controls && this.controls.applyOffsetAndSetOrigin) {
                        this.controls.applyOffsetAndSetOrigin();
                    }
                });
            }
            
            const applyRotBtn = document.getElementById('apply-rotation-btn');
            if (applyRotBtn) {
                applyRotBtn.addEventListener('click', () => {
                    const angleInput = document.getElementById('rotation-angle');
                    if (angleInput) {
                        const angle = parseFloat(angleInput.value) || 0;
                        if (angle !== 0 && this.controls && this.controls.applyBoardRotation) {
                            this.controls.applyBoardRotation(angle);
                        }
                    }
                });
            }
            
            const resetRotBtn = document.getElementById('reset-rotation-btn');
            if (resetRotBtn) {
                resetRotBtn.addEventListener('click', () => {
                    if (this.controls && this.controls.resetBoardRotationOnly) {
                        this.controls.resetBoardRotationOnly();
                    }
                });
            }
        }
        
        setupMachineSettings() {
            // Machine settings update core settings
            const thicknessInput = document.getElementById('pcb-thickness');
            if (thicknessInput) {
                thicknessInput.addEventListener('change', (e) => {
                    this.core.updateSettings('pcb', { thickness: parseFloat(e.target.value) });
                });
            }
            
            const safeZInput = document.getElementById('safe-z');
            if (safeZInput) {
                safeZInput.addEventListener('change', (e) => {
                    this.core.updateSettings('machine', { safeZ: parseFloat(e.target.value) });
                });
            }
            
            const travelZInput = document.getElementById('travel-z');
            if (travelZInput) {
                travelZInput.addEventListener('change', (e) => {
                    this.core.updateSettings('machine', { travelZ: parseFloat(e.target.value) });
                });
            }
            
            const rapidFeedInput = document.getElementById('rapid-feed');
            if (rapidFeedInput) {
                rapidFeedInput.addEventListener('change', (e) => {
                    this.core.updateSettings('machine', { rapidFeed: parseFloat(e.target.value) });
                });
            }
            
            const postProcessorSelect = document.getElementById('post-processor');
            if (postProcessorSelect) {
                postProcessorSelect.addEventListener('change', (e) => {
                    this.core.updateSettings('gcode', { postProcessor: e.target.value });
                });
            }
            
            const gcodeUnitsSelect = document.getElementById('gcode-units');
            if (gcodeUnitsSelect) {
                gcodeUnitsSelect.addEventListener('change', (e) => {
                    this.core.updateSettings('gcode', { units: e.target.value });
                });
            }
        }
        
        // Renderer updates
        async updateRendererAsync() {
            if (!this.renderer) return;
            
            this.renderer.clearLayers();
            
            if (this.viewState.fuseGeometry) {
                await this.performFusion();
            } else {
                this.addIndividualLayers();
            }
            
            // Update visibility panel
            if (this.visibilityPanel) {
                this.visibilityPanel.onLayersChanged();
            }
            
            this.renderer.render();
            this.updateOriginDisplay();
            this.updateStatistics();
        }
        
        async updateRenderer() {
            return this.updateRendererAsync();
        }
        
        async performFusion() {
            const fusionOptions = {
                enableArcReconstruction: this.viewState.enableArcReconstruction
            };
            
            try {
                const fused = await this.core.fuseAllPrimitives(fusionOptions);
                
                // Update arc stats
                if (this.viewState.enableArcReconstruction && this.core.geometryProcessor) {
                    const arcStats = this.core.geometryProcessor.getArcReconstructionStats();
                    this.fusionStats.curvesRegistered = arcStats.curvesRegistered || 0;
                    this.fusionStats.curvesReconstructed = arcStats.curvesReconstructed || 0;
                    this.fusionStats.curvesLost = arcStats.curvesLost || 0;
                    
                    // Update UI if controls exist
                    if (this.controls && this.controls.updateArcReconstructionStats) {
                        this.controls.updateArcReconstructionStats();
                    }
                }
                
                // Add appropriate layer
                if (this.viewState.showPreprocessed) {
                    this.addPreprocessedLayer();
                } else {
                    this.addFusedLayer(fused);
                }
                
                this.addNonFusableLayers();
                
            } catch (error) {
                console.error('Fusion error:', error);
                this.updateStatus('Fusion failed: ' + error.message, 'error');
                this.addIndividualLayers();
            }
        }
        
        addPreprocessedLayer() {
            let preprocessed = null;
            if (this.core.getPreprocessedPrimitives) {
                preprocessed = this.core.getPreprocessedPrimitives();
            } else if (this.core.geometryProcessor && this.core.geometryProcessor.getPreprocessedPrimitives) {
                preprocessed = this.core.geometryProcessor.getPreprocessedPrimitives();
            }
            
            if (preprocessed && preprocessed.length > 0) {
                this.renderer.addLayer('preprocessed', preprocessed, {
                    type: 'isolation',
                    visible: true,
                    color: (opsConfig.isolation && opsConfig.isolation.color),
                    isPreprocessed: true
                });
            }
        }
        
        addFusedLayer(fused) {
            if (fused && fused.length > 0) {
                this.renderer.addLayer('fused', fused, {
                    type: 'isolation',
                    visible: true,
                    isFused: true,
                    color: (opsConfig.isolation && opsConfig.isolation.color)
                });
            }
        }
        
        addNonFusableLayers() {
            this.core.operations.forEach(operation => {
                if (operation.type === 'drill' || operation.type === 'cutout') {
                    if (operation.primitives && operation.primitives.length > 0) {
                        this.renderer.addLayer('source_' + operation.id, operation.primitives, {
                            type: operation.type,
                            visible: true,
                            color: operation.color || (opsConfig[operation.type] && opsConfig[operation.type].color)
                        });
                    }
                }
            });
        }
        
        addIndividualLayers() {
            this.core.operations.forEach(operation => {
                if (operation.primitives && operation.primitives.length > 0) {
                    this.renderer.addLayer('source_' + operation.id, operation.primitives, {
                        type: operation.type,
                        visible: true,
                        color: operation.color || (opsConfig[operation.type] && opsConfig[operation.type].color)
                    });
                }
            });
        }
        
        // UI updates
        updateOriginDisplay() {
            if (!this.coordinateSystem) return;
            
            const status = this.coordinateSystem.getStatus();
            const sizeElement = document.getElementById('board-size');
            if (sizeElement && status.boardSize) {
                sizeElement.textContent = status.boardSize.width.toFixed(1) + ' × ' + status.boardSize.height.toFixed(1) + ' mm';
            }
            
            // Update offset inputs if controls exist
            if (this.controls && this.controls.updateOffsetInputsWithTracking) {
                this.controls.updateOffsetInputsWithTracking();
            }
        }
        
        updateStatistics() {
            const stats = this.core.getStats();
            
            const filesStat = document.getElementById('stat-files');
            if (filesStat) {
                const fileSet = new Set(this.core.operations.map(op => op.file.name));
                filesStat.textContent = fileSet.size;
            }
            
            const opsStat = document.getElementById('stat-operations');
            if (opsStat) {
                opsStat.textContent = stats.operations;
            }
            
            const primStat = document.getElementById('stat-primitives');
            if (primStat) {
                primStat.textContent = stats.totalPrimitives;
            }
            
            const toolpathStat = document.getElementById('stat-toolpaths');
            if (toolpathStat) {
                toolpathStat.textContent = stats.toolpaths;
            }
            
            // Enable/disable action buttons
            const hasOperations = stats.operations > 0;
            const generateBtn = document.getElementById('generate-toolpaths-btn');
            if (generateBtn) {
                generateBtn.disabled = !hasOperations;
            }
            
            const exportBtn = document.getElementById('export-gcode-btn');
            if (exportBtn) {
                exportBtn.disabled = stats.toolpaths === 0;
            }
        }
        
        // View controls
        toggleWireframe() {
            this.viewState.showWireframe = !this.viewState.showWireframe;
            if (this.renderer) {
                this.renderer.setOptions({ showWireframe: this.viewState.showWireframe });
                this.renderer.render();
            }
        }
        
        toggleGrid() {
            this.viewState.showGrid = !this.viewState.showGrid;
            if (this.renderer) {
                this.renderer.setOptions({ showGrid: this.viewState.showGrid });
                this.renderer.render();
            }
        }
        
        // File processing
        async processFile(file, type) {
            if (!file || !type) return;
            
            // This delegates to controller if available
            if (window.pcbcam && window.pcbcam.processFile) {
                return window.pcbcam.processFile(file, type);
            }
            
            // Otherwise handle directly
            const operation = this.core.createOperation(type, file);
            
            // Add to tree if available
            if (this.treeManager) {
                this.treeManager.addFileNode(operation);
            }
            
            // Read and parse
            const reader = new FileReader();
            return new Promise((resolve) => {
                reader.onload = async (e) => {
                    operation.file.content = e.target.result;
                    const success = await this.core.parseOperation(operation);
                    
                    if (success) {
                        this.updateStatus('Loaded ' + file.name + ': ' + operation.primitives.length + ' primitives', 'success');
                        
                        // Update tree with geometry info
                        if (this.treeManager) {
                            const nodes = this.treeManager.nodes;
                            let fileNode = null;
                            nodes.forEach((node) => {
                                if (node.operation && node.operation.id === operation.id) {
                                    fileNode = node;
                                }
                            });
                            
                            if (fileNode) {
                                this.treeManager.updateFileGeometries(fileNode.id, operation);
                            }
                        }
                        
                        await this.updateRendererAsync();
                    } else {
                        this.updateStatus('Error processing ' + file.name + ': ' + operation.error, 'error');
                    }
                    
                    resolve();
                };
                
                reader.readAsText(file);
            });
        }
        
        // UI actions
        showFileModal() {
            if (window.pcbcam && window.pcbcam.showFileModal) {
                window.pcbcam.showFileModal();
            }
        }
        
        async generateToolpaths() {
            /* DOCUMENTATION - Toolpath Generation Flow:
               1. Get selected operation from tree (or all operations)
               2. Validate tool selection (from PropertyInspector)
               3. Call core.generateAllToolpaths() with settings
               4. Add toolpath layers to renderer
               5. Update tree with toolpath nodes
               
               Needs: Tool selection UI, offset parameters
            */
            
            if (window.pcbcam && window.pcbcam.generateToolpaths) {
                return window.pcbcam.generateToolpaths();
            }
            
            this.updateStatus('Toolpath generation not yet implemented', 'warning');
        }
        
        async exportSVG() {
            if (!this.svgExporter) {
                this.updateStatus('SVG exporter not available', 'error');
                return;
            }
            
            try {
                const svgString = this.svgExporter.exportSVG({
                    precision: 2,
                    padding: 5,
                    optimizePaths: true,
                    includeMetadata: true,
                    includeArcReconstructionStats: this.fusionStats.arcReconstructionEnabled
                });
                
                if (svgString) {
                    const blob = new Blob([svgString], { type: 'image/svg+xml' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'pcb-export.svg';
                    a.click();
                    URL.revokeObjectURL(url);
                    
                    this.updateStatus('SVG exported successfully', 'success');
                } else {
                    this.updateStatus('No content to export', 'warning');
                }
            } catch (error) {
                console.error('SVG export error:', error);
                this.updateStatus('SVG export failed: ' + error.message, 'error');
            }
        }
        
        async exportGCode() {
            /* DOCUMENTATION - G-Code Export Flow:
               1. Get toolpaths from core.toolpaths
               2. Apply coordinate transform
               3. Generate G-code with headers/footers
               4. Include tool changes
               5. Download file
               
               Needs: GCodeExporter class, machine settings UI
            */
            
            this.updateStatus('G-code export not yet implemented', 'warning');
        }
        
        // Operation management
        removeOperation(operationId) {
            if (this.core.removeOperation(operationId)) {
                // Update tree
                if (this.treeManager) {
                    this.treeManager.removeFileNode(operationId);
                }
                
                // Update renderer
                this.updateRendererAsync();
                
                // Update stats
                this.updateStatistics();
                
                this.updateStatus('Operation removed', 'info');
            }
        }
        
        // Status management
        updateStatus(message, type) {
            if (!type) type = 'normal';
            
            if (this.statusManager) {
                this.statusManager.updateStatus(message, type);
            } else {
                const statusText = document.getElementById('status-text');
                if (statusText) {
                    statusText.textContent = message;
                    statusText.className = 'status-text ' + type;
                }
            }
        }
        
        // File input trigger
        triggerFileInput(opType) {
            const fileInput = document.getElementById('file-input-hidden') || 
                           document.getElementById('file-input-temp');
            if (fileInput) {
                fileInput.setAttribute('data-type', opType);
                
                const opConfig = opsConfig[opType];
                if (opConfig) {
                    const extensions = opConfig.extensions ? opConfig.extensions.slice() : [];
                    if (extensions.indexOf('.svg') === -1) {
                        extensions.push('.svg');
                    }
                    fileInput.setAttribute('accept', extensions.join(','));
                }
                
                fileInput.click();
            } else {
                console.warn('No file input element found');
            }
        }
    }
    
    // Export the class
    window.PCBCamUI = PCBCamUI;
    
})();