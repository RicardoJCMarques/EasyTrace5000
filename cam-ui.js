// cam-ui_r.js
// Main UI controller for workspace-centric design

(function() {
    'use strict';
    
    const config = window.PCBCAMConfig || {};
    const debugConfig = config.debug || {};
    const messagesConfig = config.ui?.messages || {};
    const opsConfig = config.operations || {};
    
    class PCBCamUI {
        constructor(core, modalManager) {
            this.core = core;
            this.activeModal = null;
            this.renderer = null;
            this.coordinateSystem = null;
            this.svgExporter = null;
            
            // Initialize sub-components
            this.operationsManager = new OperationsManager(this);
            this.statusManager = new StatusManager(this);
            this.controls = new UIControls(this);
            
            // View state
            this.viewState = {
                showPreprocessed: false,
                enableArcReconstruction: false
            };
            
            // Fusion statistics
            this.fusionStats = {
                lastOperation: null,
                totalReductions: 0,
                operationsWithFusion: 0,
                fusionType: 'clipper2_wasm',
                arcReconstructionEnabled: false,
                curvesRegistered: 0,
                curvesReconstructed: 0,
                curvesLost: 0
            };
            
            // Loading state
            this.loadingState = {
                isLoading: false,
                operation: null,
                startTime: null,
                message: ''
            };
        }
        
        // Initialization
        initializeUI() {
            this.initializeModals();
            this.updateUIFromSettings();
            this.operationsManager.renderAllOperations();
            this.statusManager.updateStatus();
            
            if (debugConfig.enabled) {
                console.log('PCBCamUI initialized for workspace');
            }
        }
        
        setupWorkspace() {
            // Initialize renderer immediately for workspace
            this.initializeRenderer();
            
            // Initialize controls
            this.controls.init(this.renderer, this.coordinateSystem);
            
            // Ensure coordinate system is initialized even if empty
            if (this.coordinateSystem && !this.coordinateSystem.initialized) {
                this.coordinateSystem.initializeEmpty();
            }
            
            // Setup canvas resize observer
            const canvas = document.getElementById('preview-canvas');
            if (canvas && window.ResizeObserver) {
                const resizeObserver = new ResizeObserver(() => {
                    if (this.renderer) {
                        this.renderer.resizeCanvas();
                    }
                });
                resizeObserver.observe(canvas.parentElement);
            }
            
            // Initial render
            if (this.renderer) {
                this.renderer.render();
            }
        }
        
        initializeRenderer() {
            if (!this.renderer && typeof LayerRenderer !== 'undefined') {
                this.renderer = new LayerRenderer('preview-canvas');
                
                if (typeof SVGExporter !== 'undefined') {
                    this.svgExporter = new SVGExporter(this.renderer);
                    if (debugConfig.enabled) {
                        console.log('SVG exporter initialized');
                    }
                }
                
                if (!this.coordinateSystem && typeof CoordinateSystemManager !== 'undefined') {
                    this.coordinateSystem = new CoordinateSystemManager({ 
                        debug: debugConfig.enabled 
                    });
                    this.core.coordinateSystem = this.coordinateSystem;
                }
                
                this.renderer.setCoordinateSystem(this.coordinateSystem);
                this.coordinateSystem.setRenderer(this.renderer);
                
                if (debugConfig.enabled) {
                    console.log('Renderer and coordinate system initialized');
                }
            }
        }

        // Modal Management 
        initializeModals() {
            // Setup close handlers for all modals
            document.querySelectorAll('.modal .modal-close').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const modal = e.target.closest('.modal');
                    if (modal) this.closeModal(modal);
                });
            });

            // Click outside to close
            document.querySelectorAll('.modal').forEach(modal => {
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) {
                        this.closeModal(modal);
                    }
                });
            });
            return true;
        }

        openModal(modalId) {
            const modal = document.getElementById(modalId);
            if (!modal) return false;

            this.closeActiveModal();
            modal.classList.add('active');
            this.activeModal = modal;
            document.body.style.overflow = 'hidden';

            if (debugConfig.enabled) {
                console.log(`Modal opened: ${modalId}`);
            }

            return true;
        }

        closeModal(modal) {
            if (!modal) return;

            modal.classList.remove('active');
            if (this.activeModal === modal) {
                this.activeModal = null;
                document.body.style.overflow = '';
            }

            if (debugConfig.enabled) {
                console.log(`Modal closed: ${modal.id}`);
            }
        }

        closeActiveModal() {
            if (this.activeModal) {
                this.closeModal(this.activeModal);
            }
        }
        
        updateUIFromSettings() {
            const elements = {
                'pcb-thickness': this.core.settings.pcb.thickness,
                'safe-z': this.core.settings.machine.safeZ,
                'travel-z': this.core.settings.machine.travelZ,
                'rapid-feed': this.core.settings.machine.rapidFeed,
                'post-processor': this.core.settings.gcode.postProcessor,
                'gcode-units': this.core.settings.gcode.units
            };
            
            Object.entries(elements).forEach(([id, value]) => {
                const element = document.getElementById(id);
                if (element) element.value = value;
            });
        }
        
        // Renderer updates
        async updateRendererAsync() {
            if (!this.renderer) return;
            
            this.renderer.clearLayers();
            
            if (this.renderer.options.fuseGeometry) {
                await this.performFusion();
            } else {
                this.addIndividualLayers();
            }
            
            this.renderer.render();
            this.updateWorkspaceUI();
        }
        
        async performFusion() {
            const fusionOptions = {
                enableArcReconstruction: this.viewState.enableArcReconstruction
            };
            
            const arcMsg = this.viewState.enableArcReconstruction ? 
                ' with arc reconstruction...' : '...';
            this.showLoadingState('fusion', 'Running Clipper2 fusion pipeline' + arcMsg);
            
            try {
                const fused = await this.core.fuseAllPrimitives(fusionOptions);
                
                // Update arc reconstruction stats
                if (this.viewState.enableArcReconstruction && this.core.geometryProcessor) {
                    const arcStats = this.core.geometryProcessor.getArcReconstructionStats();
                    this.fusionStats.arcReconstructionEnabled = true;
                    this.fusionStats.curvesRegistered = arcStats.curvesRegistered;
                    this.fusionStats.curvesReconstructed = arcStats.curvesReconstructed;
                    this.fusionStats.curvesLost = arcStats.curvesLost;
                } else {
                    this.fusionStats.arcReconstructionEnabled = false;
                    this.fusionStats.curvesRegistered = 0;
                    this.fusionStats.curvesReconstructed = 0;
                    this.fusionStats.curvesLost = 0;
                }
                
                // Add layers based on view state
                if (this.viewState.showPreprocessed) {
                    this.addPreprocessedLayer();
                } else {
                    this.addFusedLayer(fused);
                }
                
                this.addNonFusableLayers();
                
            } catch (error) {
                console.error('Fusion error:', error);
                this.statusManager.updateStatus('Fusion failed: ' + error.message, 'error');
                this.addIndividualLayers();
            } finally {
                this.hideLoadingState();
            }
        }
        
        addPreprocessedLayer() {
            const preprocessed = this.core.getPreprocessedPrimitives();
            if (preprocessed && preprocessed.length > 0) {
                this.renderer.addLayer('preprocessed', preprocessed, {
                    type: 'isolation',
                    visible: true,
                    color: opsConfig.isolation?.color,
                    isPreprocessed: true
                });
                
                const strokeCount = this.core.geometryProcessor?.stats?.strokesConverted || 0;
                this.statusManager.updateStatus(
                    `Preprocessed view: ${preprocessed.length} primitives (${strokeCount} strokes converted)`, 
                    'info'
                );
            }
        }
        
        addFusedLayer(fused) {
            if (fused && fused.length > 0) {
                this.renderer.addLayer('fused', fused, {
                    type: 'isolation',
                    visible: true,
                    isFused: true,
                    color: opsConfig.isolation?.color
                });
                
                const originalCount = this.core.getAllPrimitives().length;
                const reduction = originalCount - fused.length;
                const percentage = reduction > 0 ? ((reduction / originalCount) * 100).toFixed(1) : 0;
                
                let statusMsg = `Fusion complete: ${originalCount} → ${fused.length} primitives (${percentage}% reduction)`;
                
                if (this.fusionStats.arcReconstructionEnabled && this.fusionStats.curvesRegistered > 0) {
                    statusMsg += ` | Arcs: ${this.fusionStats.curvesReconstructed}/${this.fusionStats.curvesRegistered} reconstructed`;
                }
                
                this.statusManager.updateStatus(statusMsg, 'success');
                
                this.fusionStats.lastOperation = {
                    originalCount: originalCount,
                    fusedCount: fused.length,
                    reduction: reduction
                };
                this.fusionStats.totalReductions += reduction;
            }
        }
        
        addNonFusableLayers() {
            this.core.operations.forEach(operation => {
                if (operation.type !== 'isolation' && operation.type !== 'clear' && 
                    operation.primitives && operation.primitives.length > 0) {
                    this.renderer.addLayer(operation.id, operation.primitives, {
                        type: operation.type,
                        visible: true,
                        color: operation.color || opsConfig[operation.type]?.color
                    });
                }
            });
        }
        
        addIndividualLayers() {
            this.core.operations.forEach(operation => {
                if (operation.primitives && operation.primitives.length > 0) {
                    const markedPrimitives = operation.primitives.map(p => {
                        if (!p.properties) {
                            p.properties = {};
                        }
                        p.properties.operationType = operation.type;
                        p.properties.operationId = operation.id;
                        return p;
                    });
                    
                    this.renderer.addLayer(operation.id, markedPrimitives, {
                        type: operation.type,
                        visible: true,
                        color: operation.color,
                        bounds: operation.bounds
                    });
                }
            });
        }
        
        // UI updates
        updateWorkspaceUI() {
            this.updateOriginDisplay();
            this.controls.updateArcReconstructionStats();
        }
        
        updateOriginDisplay() {
            if (!this.coordinateSystem) return;
            
            const status = this.coordinateSystem.getStatus();
            
            const sizeElement = document.getElementById('board-size');
            if (sizeElement) {
                const size = status.boardSize;
                sizeElement.textContent = `${size.width.toFixed(1)} × ${size.height.toFixed(1)} mm`;
            }
            
            this.controls.updateOffsetInputsWithTracking();
        }
        
        // Loading state
        showLoadingState(operation, message = '') {
            this.loadingState.isLoading = true;
            this.loadingState.operation = operation;
            this.loadingState.startTime = performance.now();
            this.loadingState.message = message || `${messagesConfig.processing || 'Processing'} ${operation}...`;
            
            this.statusManager.updateStatus(this.loadingState.message, 'info');
            this.showCanvasLoadingOverlay();
        }
        
        hideLoadingState() {
            const elapsed = this.loadingState.startTime ? 
                performance.now() - this.loadingState.startTime : 0;
            
            this.loadingState.isLoading = false;
            
            if (elapsed > 100 && debugConfig.enabled) {
                console.log(`Operation '${this.loadingState.operation}' took ${elapsed.toFixed(0)}ms`);
            }
            
            this.loadingState.operation = null;
            this.loadingState.startTime = null;
            this.loadingState.message = '';
            
            this.hideCanvasLoadingOverlay();
        }
        
        showCanvasLoadingOverlay() {
            const overlay = document.getElementById('canvas-loading-overlay');
            if (!overlay) return;

            const message = document.getElementById('canvas-loading-message');
            if (message) {
                message.textContent = this.loadingState.message;
            }

            overlay.classList.remove('hidden');
        }
        
        hideCanvasLoadingOverlay() {
            const overlay = document.getElementById('canvas-loading-overlay');
            if (overlay) {
                overlay.classList.add('hidden');
            }
        }
        
        // Export functionality
        async exportSVG() {
            if (!this.svgExporter) {
                this.statusManager.updateStatus('SVG exporter not available', 'error');
                return;
            }
            
            if (!this.renderer) {
                this.statusManager.updateStatus('No renderer available for SVG export', 'error');
                return;
            }
            
            try {
                if (this.renderer.options.fuseGeometry) {
                    this.showLoadingState('export', 'Preparing SVG export...');
                    await this.updateRendererAsync();
                    this.hideLoadingState();
                }
                
                const svgString = this.svgExporter.exportSVG({
                    precision: 2,
                    padding: 5,
                    optimizePaths: true,
                    includeMetadata: true,
                    includeArcReconstructionStats: this.fusionStats.arcReconstructionEnabled
                });
                
                if (svgString) {
                    this.statusManager.updateStatus('SVG exported successfully', 'success');
                } else {
                    this.statusManager.updateStatus('SVG export failed - no content to export', 'warning');
                }
            } catch (error) {
                console.error('SVG export error:', error);
                this.statusManager.updateStatus('SVG export failed: ' + error.message, 'error');
            }
        }
        
        // Compatibility methods for external callers
        centerOrigin() { 
            this.controls.centerOrigin(); 
        }
        
        bottomLeftOrigin() { 
            this.controls.bottomLeftOrigin(); 
        }
        
        resetOrigin() { 
            this.controls.resetOrigin(); 
        }
        
        applyOffsetAndSetOrigin() { 
            this.controls.applyOffsetAndSetOrigin(); 
        }
        
        applyBoardRotation(angle) { 
            this.controls.applyBoardRotation(angle); 
        }
        
        resetBoardRotationOnly() { 
            this.controls.resetBoardRotationOnly(); 
        }
        
        showOperationMessage(type, message, messageType) { 
            this.operationsManager.showOperationMessage(type, message, messageType); 
        }
        
        renderOperations(type) { 
            this.operationsManager.renderOperations(type); 
        }
        
        updateStatus(message, type) { 
            this.statusManager.updateStatus(message, type); 
        }
    }
    
    // Export
    window.PCBCamUI = PCBCamUI;
    
})();