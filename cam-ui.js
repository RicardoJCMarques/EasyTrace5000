// cam-ui.js
// Simplified main UI controller that orchestrates sub-components

(function() {
    'use strict';
    
    const config = window.PCBCAMConfig || {};
    const debugConfig = config.debug || {};
    const messagesConfig = config.ui?.messages || {};
    const opsConfig = config.operations || {};
    
    class PCBCamUI {
        constructor(core) {
            this.core = core;
            this.renderer = null;
            this.coordinateSystem = null;
            this.svgExporter = null;
            
            // Initialize sub-components
            this.modalManager = new ModalManager();
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
            this.updateUIFromSettings();
            this.operationsManager.renderAllOperations();
            this.statusManager.updateStatus();
            
            // Initialize modal manager
            this.modalManager.init();
            this.modalManager.setCallbacks({
                onOpen: () => this.onModalOpen(),
                onClose: () => this.onModalClose(),
                onPageChange: (page) => this.onModalPageChange(page)
            });
            
            if (debugConfig.enabled) {
                console.log('PCBCamUI initialized with modular architecture');
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
                
                // Initialize controls with renderer
                this.controls.init(this.renderer, this.coordinateSystem);
                
                if (debugConfig.enabled) {
                    console.log('Renderer and coordinate system initialized');
                }
            }
        }
        
        updateUIFromSettings() {
            const elements = {
                'pcb-thickness': this.core.settings.pcb.thickness,
                'safe-z': this.core.settings.machine.safeZ,
                'travel-z': this.core.settings.machine.travelZ,
                'rapid-feed': this.core.settings.machine.rapidFeed,
                'work-coords': this.core.settings.machine.workCoordinateSystem,
                'post-processor': this.core.settings.gcode.postProcessor,
                'gcode-units': this.core.settings.gcode.units,
                'start-gcode': this.core.settings.gcode.startCode,
                'end-gcode': this.core.settings.gcode.endCode
            };
            
            Object.entries(elements).forEach(([id, value]) => {
                const element = document.getElementById(id);
                if (element) element.value = value;
            });
        }
        
        // Modal operations
        async openPreview() {
            if (!this.modalManager.open()) return;
            
            this.initializeRenderer();
            
            await new Promise(resolve => requestAnimationFrame(resolve));
            
            if (this.renderer) {
                this.core.updateCoordinateSystem();
                await this.updateRendererAsync();
                this.renderer.resizeCanvas();
                
                setTimeout(() => {
                    if (this.renderer && this.coordinateSystem) {
                        const originPos = this.coordinateSystem.getOriginPosition();
                        const rotationState = this.coordinateSystem.getRotationState();
                        
                        this.renderer.setOriginPosition(originPos.x, originPos.y);
                        this.renderer.setRotation(rotationState.angle, rotationState.center);
                        this.renderer.zoomFit();
                        this.renderer.render();
                    }
                }, 250);
            }
            
            this.updatePreviewUI();
            this.controls.updateOffsetInputsWithTracking();
        }
        
        closePreview() {
            this.modalManager.close();
        }
        
        onModalOpen() {
            this.updatePreviewUI();
        }
        
        onModalClose() {
            if (debugConfig.enabled) {
                console.log('Modal closed, renderer preserved');
            }
        }
        
        onModalPageChange(page) {
            if (debugConfig.enabled) {
                console.log(`Modal page changed to ${page}`);
            }
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
        updatePreviewUI() {
            const stats = this.core.getStats();
            const operationsElement = document.getElementById('preview-operations');
            const polygonsElement = document.getElementById('preview-total-polygons');
            
            if (operationsElement) operationsElement.textContent = stats.operations;
            if (polygonsElement) polygonsElement.textContent = stats.totalPrimitives;
            
            this.updateOriginDisplay();
            this.updateOperationStatistics();
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
        
        updateOperationStatistics() {
            const statsContainer = document.getElementById('operation-stats');
            if (!statsContainer) return;
            
            if (this.core.operations.length === 0) {
                statsContainer.innerHTML = '<p>Load PCB files to see statistics</p>';
                return;
            }
            
            let statsHtml = '';
            
            this.core.operations.forEach((operation) => {
                const status = operation.error ? '❌' : (operation.primitives ? '✅' : '⏳');
                const primitiveCount = operation.primitives ? operation.primitives.length : 0;
                const fileSize = (operation.file.size / 1024).toFixed(1);
                
                let extraInfo = '';
                if (operation.geometricContext?.strokeCount > 0) {
                    extraInfo += ` • Strokes: ${operation.geometricContext.strokeCount}`;
                }
                if (operation.geometricContext?.hasArcs) {
                    extraInfo += ` • Has arcs`;
                }
                
                statsHtml += `
                    <div style="margin-bottom: 0.75rem; padding: 0.5rem; background: var(--bg-hover); border-radius: 4px;">
                        <div style="font-weight: 500; margin-bottom: 0.25rem;">${status} ${operation.file.name}</div>
                        <div style="font-size: 0.75rem; color: var(--text-hint);">
                            Type: ${operation.type} • Size: ${fileSize}KB • Primitives: ${primitiveCount}${extraInfo}
                        </div>
                        ${operation.error ? `<div style="color: var(--error); font-size: 0.75rem; margin-top: 0.25rem;">Error: ${operation.error}</div>` : ''}
                    </div>
                `;
            });
            
            statsContainer.innerHTML = statsHtml;
        }
        
        // Loading state
        showLoadingState(operation, message = '') {
            this.loadingState.isLoading = true;
            this.loadingState.operation = operation;
            this.loadingState.startTime = performance.now();
            this.loadingState.message = message || `${messagesConfig.processing || 'Processing'} ${operation}...`;
            
            this.statusManager.updateStatus(this.loadingState.message, 'info');
            
            const modal = document.getElementById('preview-modal');
            if (modal && modal.classList.contains('active')) {
                this.showPreviewLoadingOverlay();
            }
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
            
            this.hidePreviewLoadingOverlay();
        }
        
        showPreviewLoadingOverlay() {
            const canvas = document.getElementById('preview-canvas');
            if (!canvas) return;
            
            let overlay = document.getElementById('preview-loading-overlay');
            if (!overlay) {
                overlay = this.createLoadingOverlay();
                canvas.parentElement.appendChild(overlay);
                this.addLoadingStyles();
            } else {
                const message = document.getElementById('preview-loading-message');
                if (message) {
                    message.textContent = this.loadingState.message;
                }
            }
        }
        
        createLoadingOverlay() {
            const overlay = document.createElement('div');
            overlay.id = 'preview-loading-overlay';
            overlay.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0.7);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 1000;
            `;
            
            const spinner = document.createElement('div');
            spinner.className = 'loading-spinner';
            spinner.style.cssText = `
                border: 3px solid rgba(255,255,255,0.3);
                border-top: 3px solid white;
                border-radius: 50%;
                width: 40px;
                height: 40px;
                animation: spin 1s linear infinite;
            `;
            
            const message = document.createElement('div');
            message.id = 'preview-loading-message';
            message.style.cssText = `
                position: absolute;
                bottom: 20px;
                color: white;
                font-size: 14px;
            `;
            message.textContent = this.loadingState.message;
            
            overlay.appendChild(spinner);
            overlay.appendChild(message);
            
            return overlay;
        }
        
        addLoadingStyles() {
            if (!document.getElementById('loading-spin-style')) {
                const style = document.createElement('style');
                style.id = 'loading-spin-style';
                style.textContent = `
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                `;
                document.head.appendChild(style);
            }
        }
        
        hidePreviewLoadingOverlay() {
            const overlay = document.getElementById('preview-loading-overlay');
            if (overlay) {
                overlay.remove();
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