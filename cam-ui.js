/**
 * @file        cam-ui.js
 * @description Tooltip integration, status manager usage
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
    const opsConfig = config.operations || {};
    
    class PCBCamUI {
        constructor(core) {
            this.core = core;
            
            this.treeManager = null;
            this.propertyInspector = null;
            this.visibilityPanel = null;
            this.toolLibrary = null;
            this.statusManager = null;
            this.controls = null;
            
            this.renderer = null;
            this.coordinateSystem = null;
            this.svgExporter = null;
            
            this.viewState = {
                showPreprocessed: false,
                enableArcReconstruction: false,
                fuseGeometry: false,
                showWireframe: false,
                showGrid: true,
                blackAndWhite: false,
                debugPoints: false,
                debugPaths: false
            };
            
            this.fusionStats = {
                arcReconstructionEnabled: false,
                curvesRegistered: 0,
                curvesReconstructed: 0,
                curvesLost: 0
            };
            
            this.stats = {
                files: 0,
                operations: 0,
                primitives: 0,
                toolpaths: 0,
                processingTime: 0
            };
            
            this._updatePending = false;
            this._updateQueued = false;

            this._eventHandlersAttached = false;
        }
        
        async init(parameterManager) {
            try {
                // Initialize tool library
                if (typeof ToolLibrary !== 'undefined') {
                    this.toolLibrary = new ToolLibrary();
                    await this.toolLibrary.init();
                    if (this.core.setToolLibrary) {
                        this.core.setToolLibrary(this.toolLibrary);
                    }
                }
                
                // Initialize UI components
                if (typeof TreeManager !== 'undefined') {
                    this.treeManager = new TreeManager(this);
                    this.treeManager.init();
                }
                
                if (typeof PropertyInspector !== 'undefined') {
                    this.propertyInspector = new PropertyInspector(this);
                    this.propertyInspector.init(this.toolLibrary, parameterManager);
                }
                
                if (typeof VisibilityPanel !== 'undefined') {
                    this.visibilityPanel = new VisibilityPanel(this);
                }
                
                if (typeof StatusManager !== 'undefined') {
                    this.statusManager = new StatusManager(this);
                }
                
                this.initializeRenderer();
                
                if (typeof UIControls !== 'undefined') {
                    this.controls = new UIControls(this);
                    this.controls.init(this.renderer, this.coordinateSystem);
                }
                
                if (this.visibilityPanel && this.renderer) {
                    this.visibilityPanel.init(this.renderer);
                }
                
                this.setupEventHandlers();
                this.initializeTheme();
                
                this.updateStatus('Ready - Add PCB files to begin');
                
                if (debugConfig.enabled) {
                    console.log('PCBCamUI initialized');
                }
                
                return true;
                
            } catch (error) {
                console.error('UI initialization failed:', error);
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
                this.renderer = new LayerRenderer('preview-canvas', this.core);
                
                if (typeof CoordinateSystemManager !== 'undefined') {
                    this.coordinateSystem = new CoordinateSystemManager({ 
                        debug: debugConfig.enabled 
                    });
                    this.core.coordinateSystem = this.coordinateSystem;
                    this.renderer.setCoordinateSystem(this.coordinateSystem);
                    this.coordinateSystem.setRenderer(this.renderer);
                }
                
                if (typeof SVGExporter !== 'undefined') {
                    this.svgExporter = new SVGExporter(this.renderer);
                }
                
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
            if (this._eventHandlersAttached) {
                return; // Prevent re-attaching listeners
            }
            console.log("Attaching UI event handlers...");

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
            
            const toolbarExportSvgBtn = document.getElementById('toolbar-export-svg');
            if (toolbarExportSvgBtn) {
                toolbarExportSvgBtn.addEventListener('click', () => this.exportSVG());
            }
            
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

            this._eventHandlersAttached = true;
        }
        
        setupViewControls() {
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

            const toolPreviewControl = document.getElementById('show-tool-preview');
            if (toolPreviewControl) {
                toolPreviewControl.checked = this.viewState.showToolPreview || false;
                toolPreviewControl.addEventListener('change', (e) => {
                    this.viewState.showToolPreview = e.target.checked;
                    if (this.renderer) {
                        this.renderer.setOptions({ showToolPreview: e.target.checked });
                        this.renderer.render();
                    }
                });
            }
            
            const displayOptions = [
                { id: 'show-bounds', option: 'showBounds' },
                { id: 'show-rulers', option: 'showRulers' },
                { id: 'show-regions', option: 'showRegions' },
                { id: 'show-traces', option: 'showTraces' },
                { id: 'show-pads', option: 'showPads' },
                { id: 'show-drills', option: 'showDrills' },
                { id: 'show-cutouts', option: 'showCutouts' },
                { id: 'show-preprocessed', option: 'showPreprocessed' },
                { id: 'debug-points', option: 'debugCurvePoints' },
                { id: 'debug-paths', option: 'debugCurvePoints' },
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
        
        async updateRendererAsync() {
            if (!this.renderer) return;
            
            if (this._updatePending) {
                this._updateQueued = true;
                return;
            }
            
            this._updatePending = true;
            
            try {
                this.renderer.clearLayers();
                
                if (this.viewState.fuseGeometry) {
                    await this.performFusion();
                } else {
                    this.addIndividualLayers();
                }
                
                this.addOffsetLayers();
                
                if (this.visibilityPanel) {
                    this.visibilityPanel.onLayersChanged();
                }
                
                this.renderer.render();
                this.updateOriginDisplay();
                this.updateStatistics();
            } finally {
                this._updatePending = false;
                
                if (this._updateQueued) {
                    this._updateQueued = false;
                    setTimeout(() => this.updateRendererAsync(), 50);
                }
            }
        }
        
        async performFusion() {
            const fusionOptions = {
                enableArcReconstruction: this.viewState.enableArcReconstruction
            };

            console.log('[UI] performFusion() - Starting performFusion. Options:', fusionOptions);
            
            try {
                const fused = await this.core.fuseAllPrimitives(fusionOptions);
                
                if (this.viewState.enableArcReconstruction && this.core.geometryProcessor) {
                    const arcStats = this.core.geometryProcessor.getArcReconstructionStats();
                    this.fusionStats.curvesRegistered = arcStats.curvesRegistered || 0;
                    this.fusionStats.curvesReconstructed = arcStats.curvesReconstructed || 0;
                    this.fusionStats.curvesLost = arcStats.curvesLost || 0;
                    
                    if (this.controls && this.controls.updateArcReconstructionStats) {
                        this.controls.updateArcReconstructionStats();
                    }
                }
                
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
            const allPreprocessed = this.core.getPreprocessedPrimitives();
            if (!allPreprocessed || allPreprocessed.length === 0) return;
            
            const byOperation = new Map();
            allPreprocessed.forEach(p => {
                const opId = p.properties?.operationId || p._originalOperationId;
                if (opId) {
                    if (!byOperation.has(opId)) byOperation.set(opId, []);
                    byOperation.get(opId).push(p);
                }
            });
            
            byOperation.forEach((primitives, opId) => {
                const operation = this.core.operations.find(op => op.id === opId);
                if (operation) {
                    this.renderer.addLayer(`preprocessed_${opId}`, primitives, {
                        type: operation.type,
                        visible: true,
                        color: operation.color,
                        isPreprocessed: true
                    });
                }
            });
        }
        
        addFusedLayer(fused) {
            if (!fused || fused.length === 0) return;
            
            const byOperation = new Map();
            fused.forEach(p => {
                const opId = p.properties?.sourceOperationId;
                if (opId) {
                    if (!byOperation.has(opId)) byOperation.set(opId, []);
                    byOperation.get(opId).push(p);
                }
            });
            
            byOperation.forEach((primitives, opId) => {
                const operation = this.core.operations.find(op => op.id === opId);
                if (operation) {
                    this.renderer.addLayer(`fused_${opId}`, primitives, {
                        type: operation.type,
                        visible: true,
                        isFused: true,
                        color: operation.color || (opsConfig[operation.type] && opsConfig[operation.type].color)
                    });
                }
            });
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
        
        addOffsetLayers() {
            this.core.operations.forEach(operation => {
                // Color based on offset TYPE, not operation type
                const passColors = {
                    'external': ['#a60000ff'],  // Red for external (isolation)
                    'internal': ['#00a600ff'],   // Green for internal (clear)
                    'on': ['#bcbc02ff']   // Yellow for on (clear)
                };
                
                if (operation.offsets && operation.offsets.length > 0) {
                    operation.offsets.forEach((offset, passIndex) => {
                        if (offset.primitives && offset.primitives.length > 0) {
                            // Use offset.offsetType instead of operation.type
                            let offsetType;
                            if (offset.distance > 0) {
                            offsetType = 'external';
                            } else if (offset.distance < 0) {
                            offsetType = 'internal';
                            } else {
                            offsetType = 'on';
                            }
                            const colorArray = passColors[offsetType] || ['#888888ff'];
                            const colorIndex = Math.min(passIndex, colorArray.length - 1);
                            const color = colorArray[colorIndex];
                            
                            const layerName = offset.combined ? 
                                `offset_${operation.id}_combined` :
                                `offset_${operation.id}_pass_${passIndex + 1}`;
                            
                            this.renderer.addLayer(
                                layerName,
                                offset.primitives,
                                {
                                    type: 'offset',
                                    visible: true,
                                    color: color,
                                    operationId: operation.id,
                                    operationType: operation.type,
                                    offsetType: offsetType,
                                    pass: offset.pass,
                                    distance: offset.distance,
                                    combined: offset.combined || false,
                                    metadata: offset.metadata
                                }
                            );
                        }
                    });
                }
                
                // Preview layer
                if (operation.preview && operation.preview.primitives && operation.preview.primitives.length > 0) {
                    this.renderer.addLayer(
                        `preview_${operation.id}`,
                        operation.preview.primitives,
                        {
                            type: 'preview',
                            visible: true,
                            color: '#0060ddff',
                            operationId: operation.id,
                            operationType: operation.type,
                            isPreview: true,
                            metadata: operation.preview.metadata
                        }
                    );
                }
            });
        }
        
        updateOriginDisplay() {
            if (!this.coordinateSystem) return;
            
            const status = this.coordinateSystem.getStatus();
            const sizeElement = document.getElementById('board-size');
            if (sizeElement && status.boardSize) {
                sizeElement.textContent = status.boardSize.width.toFixed(1) + ' × ' + status.boardSize.height.toFixed(1) + ' mm';
            }
            
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
        
        async processFile(file, type) {
            if (!file || !type) return;
            
            if (window.pcbcam && window.pcbcam.processFile) {
                return window.pcbcam.processFile(file, type);
            }
            
            const operation = this.core.createOperation(type, file);
            
            if (this.treeManager) {
                this.treeManager.addFileNode(operation);
            }
            
            const reader = new FileReader();
            return new Promise((resolve) => {
                reader.onload = async (e) => {
                    operation.file.content = e.target.result;
                    const success = await this.core.parseOperation(operation);
                    
                    if (success) {
                        this.updateStatus('Loaded ' + file.name + ': ' + operation.primitives.length + ' primitives', 'success');
                        
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
        
        showFileModal() {
            if (window.pcbcam && window.pcbcam.showFileModal) {
                window.pcbcam.showFileModal();
            }
        }
        
        async generateToolpaths() {
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
            // The SVGExporter will handle the download internally.
            this.svgExporter.exportSVG(); 
            } catch (error) {
                console.error('SVG export error:', error);
                this.updateStatus('SVG export failed: ' + error.message, 'error');
            }
        }
        
        async exportGCode() {
            this.updateStatus('G-code export not yet implemented', 'warning');
        }
        
        removeOperation(operationId) {
            if (this.core.removeOperation(operationId)) {
                if (this.treeManager) {
                    this.treeManager.removeFileNode(operationId);
                }
                
                this.updateRendererAsync();
                this.updateStatistics();
                
                this.updateStatus('Operation removed', 'info');
            }
        }
        
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
    
    window.PCBCamUI = PCBCamUI;
    
})();