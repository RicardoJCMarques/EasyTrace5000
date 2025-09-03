// cam-ui2.js - UI components and DOM manipulation - FIXED async method names
// Handles rendering, modal management, and user interface updates

class PCBCamUI {
    constructor(core) {
        this.core = core;
        this.renderer = null;
        this.coordinateSystem = null;
        this.svgExporter = null;
        
        // Modal state
        this.currentModalPage = 1;
        this.totalModalPages = 3;
        
        // UI state
        this.activeFileInputType = null;
        
        // Fusion statistics for UI display
        this.fusionStats = {
            lastOperation: null,
            totalReductions: 0,
            operationsWithFusion: 0,
            fusionType: 'clipper2_wasm'
        };
        
        // Input tracking for coordinate inputs
        this.inputTracking = {
            lastXValue: '0',
            lastYValue: '0',
            isUpdating: false
        };
        
        // ASYNC: Loading state management
        this.loadingState = {
            isLoading: false,
            operation: null,
            startTime: null,
            message: ''
        };
        
        // ASYNC: Operation queue for managing async operations
        this.operationQueue = [];
        this.isProcessingQueue = false;
    }
    
    initializeUI() {
        this.updateUIFromSettings();
        this.renderAllOperations();
        this.updateStatus();
        
        console.log('PCBCamUI initialized with async support');
    }
    
    initializeRenderer() {
        if (!this.renderer && typeof LayerRenderer !== 'undefined') {
            this.renderer = new LayerRenderer('preview-canvas');
            
            if (typeof SVGExporter !== 'undefined') {
                this.svgExporter = new SVGExporter(this.renderer);
                console.log('SVG exporter initialized');
            } else {
                console.warn('SVGExporter not available - SVG export will be disabled');
            }
            
            if (!this.coordinateSystem && typeof CoordinateSystemManager !== 'undefined') {
                this.coordinateSystem = new CoordinateSystemManager({ debug: false });
                this.core.coordinateSystem = this.coordinateSystem;
            }
            
            this.renderer.setCoordinateSystem(this.coordinateSystem);
            this.coordinateSystem.setRenderer(this.renderer);
            
            console.log('Layer renderer initialized with coordinate system');
        }
    }
    
    // ASYNC: Loading state management
    showLoadingState(operation, message = '') {
        this.loadingState.isLoading = true;
        this.loadingState.operation = operation;
        this.loadingState.startTime = performance.now();
        this.loadingState.message = message || `Processing ${operation}...`;
        
        // Update UI to show loading
        this.updateStatus(this.loadingState.message, 'info');
        
        // Add loading overlay to preview if modal is open
        const modal = document.getElementById('preview-modal');
        if (modal && modal.classList.contains('active')) {
            this.showPreviewLoadingOverlay();
        }
    }
    
    hideLoadingState() {
        const elapsed = this.loadingState.startTime ? 
            performance.now() - this.loadingState.startTime : 0;
        
        this.loadingState.isLoading = false;
        
        // Log operation time if significant
        if (elapsed > 100) {
            console.log(`Operation '${this.loadingState.operation}' took ${elapsed.toFixed(0)}ms`);
        }
        
        this.loadingState.operation = null;
        this.loadingState.startTime = null;
        this.loadingState.message = '';
        
        // Remove loading overlay
        this.hidePreviewLoadingOverlay();
    }
    
    showPreviewLoadingOverlay() {
        const canvas = document.getElementById('preview-canvas');
        if (!canvas) return;
        
        // Create or update loading overlay
        let overlay = document.getElementById('preview-loading-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
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
            canvas.parentElement.appendChild(overlay);
            
            // Add spin animation if not exists
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
        } else {
            // Update message
            const message = document.getElementById('preview-loading-message');
            if (message) {
                message.textContent = this.loadingState.message;
            }
        }
    }
    
    hidePreviewLoadingOverlay() {
        const overlay = document.getElementById('preview-loading-overlay');
        if (overlay) {
            overlay.remove();
        }
    }
    
    updateUIFromSettings() {
        const pcbThickness = document.getElementById('pcb-thickness');
        if (pcbThickness) {
            pcbThickness.value = this.core.settings.pcb.thickness;
        }
        
        const safeZ = document.getElementById('safe-z');
        if (safeZ) {
            safeZ.value = this.core.settings.machine.safeZ;
        }
        
        const travelZ = document.getElementById('travel-z');
        if (travelZ) {
            travelZ.value = this.core.settings.machine.travelZ;
        }
        
        const rapidFeed = document.getElementById('rapid-feed');
        if (rapidFeed) {
            rapidFeed.value = this.core.settings.machine.rapidFeed;
        }
        
        const workCoords = document.getElementById('work-coords');
        if (workCoords) {
            workCoords.value = this.core.settings.machine.workCoordinateSystem;
        }
        
        const postProcessor = document.getElementById('post-processor');
        if (postProcessor) {
            postProcessor.value = this.core.settings.gcode.postProcessor;
        }
        
        const gcodeUnits = document.getElementById('gcode-units');
        if (gcodeUnits) {
            gcodeUnits.value = this.core.settings.gcode.units;
        }
        
        const startGcode = document.getElementById('start-gcode');
        if (startGcode) {
            startGcode.value = this.core.settings.gcode.startCode;
        }
        
        const endGcode = document.getElementById('end-gcode');
        if (endGcode) {
            endGcode.value = this.core.settings.gcode.endCode;
        }
    }
    
    updateStatus(message = null, type = 'normal') {
        const statusText = document.getElementById('status-text');
        const statusBar = document.getElementById('status');
        if (!statusText || !statusBar) return;

        statusBar.className = 'status';
        if (type !== 'normal') statusBar.classList.add(type);

        const hasValidOperations = this.core.hasValidOperations();
        
        const previewBtn = document.getElementById('preview-btn');
        if (previewBtn) previewBtn.disabled = !hasValidOperations;

        if (message) {
            statusText.textContent = message;
        } else {
            if (hasValidOperations) {
                const stats = this.core.getStats();
                let statusMsg = `Ready: ${stats.operations} operations, ${stats.totalPrimitives} primitives`;
                
                if (this.fusionStats.totalReductions > 0) {
                    statusMsg += ` (${this.fusionStats.totalReductions} fused)`;
                }
                
                statusText.textContent = statusMsg;
            } else {
                statusText.textContent = 'Ready - Add PCB files to begin';
            }
        }
    }
    
    showOperationMessage(operationType, message, type = 'error') {
        const container = document.getElementById(`${operationType}-operations`);
        if (!container) return;
        
        container.querySelectorAll('.operation-message').forEach(el => el.remove());
        
        if (!message) return;
        
        const messageEl = document.createElement('div');
        messageEl.className = `operation-message operation-${type}`;
        messageEl.textContent = message;
        
        container.appendChild(messageEl);
        
        setTimeout(() => {
            if (messageEl.parentElement) {
                messageEl.remove();
            }
        }, 5000);
    }
    
    renderAllOperations() {
        ['isolation', 'clear', 'drill', 'cutout'].forEach(type => this.renderOperations(type));
    }
    
    renderOperations(type) {
        const container = document.getElementById(`${type}-operations`);
        if (!container) return;
        
        container.innerHTML = '';
        
        const typeOperations = this.core.getOperationsByType(type);
        
        typeOperations.forEach(operation => {
            const operationCard = this.createOperationCard(operation);
            container.appendChild(operationCard);
        });
    }
    
    createOperationCard(operation) {
        const card = document.createElement('div');
        card.className = 'operation-card';
        card.setAttribute('data-operation-id', operation.id);
        
        const config = this.core.fileTypes[operation.type];
        let statusIcon = '⏳';
        
        if (operation.error) {
            statusIcon = '❌';
        } else if (operation.primitives) {
            statusIcon = '✅';
        }
        
        const colorIndicator = `<span style="display: inline-block; width: 12px; height: 12px; background: ${operation.color}; border-radius: 2px; margin-right: 4px;"></span>`;
        
        card.innerHTML = `
            <div class="operation-header">
                <span class="operation-icon">${config.icon}</span>
                <span class="operation-name">${colorIndicator}${operation.file.name}</span>
                <span class="operation-status">${statusIcon}</span>
                <button class="expand-btn" data-operation-id="${operation.id}">
                    ${operation.expanded ? '▼' : '▶'}
                </button>
                <button class="remove-btn" data-operation-id="${operation.id}" title="Remove operation">×</button>
            </div>
            <div class="operation-settings" style="display: ${operation.expanded ? 'block' : 'none'}">
                ${this.createSettingsPanel(operation)}
            </div>
        `;
        
        // Add event listeners
        card.querySelector('.expand-btn').addEventListener('click', (e) => {
            this.toggleOperationExpansion(e.target.dataset.operationId);
        });
        
        card.querySelector('.remove-btn').addEventListener('click', (e) => {
            this.removeOperation(e.target.dataset.operationId);
        });
        
        return card;
    }
    
    createSettingsPanel(operation) {
        const settings = operation.settings;
        
        return `
            <div class="settings-panel">
                <div class="settings-section">
                    <h4>Tool Settings</h4>
                    <div class="input-group">
                        <label>Tool Diameter</label>
                        <div class="input-unit">
                            <input type="number" id="tool-diameter-${operation.id}" 
                                   value="${settings.tool.diameter}" min="0.01" step="0.01">
                            <span>mm</span>
                        </div>
                    </div>
                    <div class="input-group">
                        <label>Tool Type</label>
                        <select id="tool-type-${operation.id}">
                            <option value="end_mill" ${settings.tool.type === 'end_mill' ? 'selected' : ''}>End Mill</option>
                            <option value="v_bit" ${settings.tool.type === 'v_bit' ? 'selected' : ''}>V-Bit</option>
                            <option value="drill" ${settings.tool.type === 'drill' ? 'selected' : ''}>Drill</option>
                        </select>
                    </div>
                </div>
                
                <div class="settings-section">
                    <h4>Cutting Parameters</h4>
                    <div class="input-group">
                        <label>Cut Feed</label>
                        <div class="input-unit">
                            <input type="number" id="cut-feed-${operation.id}" 
                                   value="${settings.cutting.cutFeed}" min="1" step="1">
                            <span>mm/min</span>
                        </div>
                    </div>
                    <div class="input-group">
                        <label>Cut Depth</label>
                        <div class="input-unit">
                            <input type="number" id="cut-depth-${operation.id}" 
                                   value="${settings.cutting.cutDepth}" min="0.001" step="0.001">
                            <span>mm</span>
                        </div>
                    </div>
                </div>
                
                <div class="settings-section">
                    <h4>Operation Settings</h4>
                    ${this.createOperationSpecificSettings(operation)}
                </div>
            </div>
        `;
    }
    
    createOperationSpecificSettings(operation) {
        const settings = operation.settings.operation;
        
        switch (operation.type) {
            case 'isolation':
                return `
                    <div class="input-group">
                        <label>Passes</label>
                        <input type="number" value="${settings.passes}" min="1" max="5">
                    </div>
                    <div class="input-group">
                        <label>Overlap %</label>
                        <input type="number" value="${settings.overlap}" min="10" max="90">
                    </div>
                `;
            case 'drill':
                return `
                    <div class="input-group">
                        <label>Peck Depth</label>
                        <div class="input-unit">
                            <input type="number" value="${settings.peckDepth}" min="0" step="0.1">
                            <span>mm</span>
                        </div>
                    </div>
                `;
            case 'cutout':
                return `
                    <div class="input-group">
                        <label>Tabs</label>
                        <input type="number" value="${settings.tabs}" min="0" max="8">
                    </div>
                `;
            default:
                return '';
        }
    }
    
    toggleOperationExpansion(operationId) {
        const operation = this.core.operations.find(op => op.id === operationId);
        if (!operation) return;
        
        operation.expanded = !operation.expanded;
        
        const card = document.querySelector(`[data-operation-id="${operationId}"]`);
        if (!card) return;
        
        const settings = card.querySelector('.operation-settings');
        const btn = card.querySelector('.expand-btn');
        
        if (settings) settings.style.display = operation.expanded ? 'block' : 'none';
        if (btn) btn.textContent = operation.expanded ? '▼' : '▶';
        
        this.core.saveSettings();
    }
    
    removeOperation(operationId) {
        const operation = this.core.operations.find(op => op.id === operationId);
        if (!operation) return;
        
        if (this.core.removeOperation(operationId)) {
            this.showOperationMessage(operation.type, null);
            this.renderOperations(operation.type);
            this.updateStatus();
            
            if (this.renderer) {
                // ASYNC: Update renderer asynchronously
                this.updateRendererAsync();
            }
        }
    }
    
    // Modal management
    async openPreview() {
        const modal = document.getElementById('preview-modal');
        if (!modal) return;
        
        console.log('Opening preview modal...');
        
        // Show modal first
        document.body.style.overflow = 'hidden';
        modal.classList.add('active');
        
        // Reset to page 1
        this.currentModalPage = 1;
        this.updateModalPage();
        
        // Initialize renderer if needed
        this.initializeRenderer();
        
        // Wait for modal to be fully rendered
        await new Promise(resolve => requestAnimationFrame(resolve));
        
        if (this.renderer) {
            console.log('Updating renderer...');
            
            // Update coordinate system and renderer
            this.core.updateCoordinateSystem();
            
            // ASYNC: Update renderer with async fusion
            await this.updateRendererAsync();
            
            // Resize canvas to fit container
            this.renderer.resizeCanvas();
            
            // Sync coordinate system to renderer
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
        
        // Setup controls and UI
        this.setupPreviewControls();
        this.updatePreviewUI();
        this.updateOffsetInputsWithTracking();
        
        console.log('Modal opened successfully');
    }
    
    closePreview() {
        console.log('Closing modal');
        
        const modal = document.getElementById('preview-modal');
        modal.classList.remove('active');
        document.body.style.overflow = '';
        
        // Renderer stays active for future modal opens
        if (this.renderer) {
            console.log('Renderer preserved with', this.renderer.layers.size, 'layers');
        }
    }
    
    updateModalPage() {
        const modalTitle = document.getElementById('modal-title');
        const pageIndicator = document.getElementById('page-indicator');
        const backBtn = document.getElementById('modal-back-btn');
        const nextBtn = document.getElementById('modal-next-btn');
        
        // Hide all pages
        for (let i = 1; i <= this.totalModalPages; i++) {
            const page = document.getElementById(`modal-page-${i}`);
            if (page) {
                page.style.display = 'none';
            }
        }
        
        // Show current page
        const currentPage = document.getElementById(`modal-page-${this.currentModalPage}`);
        if (currentPage) {
            currentPage.style.display = 'block';
        }
        
        // Update title and navigation
        const titles = [
            '🔍 PCB Preview & Fusion Setup',
            '⚙️ Offset Geometry Configuration', 
            '🛠️ Toolpath Generation'
        ];
        
        if (modalTitle) {
            modalTitle.textContent = titles[this.currentModalPage - 1] || titles[0];
        }
        
        if (pageIndicator) {
            pageIndicator.textContent = `Page ${this.currentModalPage} of ${this.totalModalPages}`;
        }
        
        if (backBtn) {
            backBtn.textContent = this.currentModalPage === 1 ? '← Back to Main' : '← Previous';
            backBtn.onclick = this.currentModalPage === 1 ? 
                () => this.closePreview() : 
                () => this.navigateModal(-1);
        }
        
        if (nextBtn) {
            if (this.currentModalPage < this.totalModalPages) {
                nextBtn.style.display = 'block';
                nextBtn.textContent = 'Next →';
                nextBtn.onclick = () => this.navigateModal(1);
            } else {
                nextBtn.style.display = 'none';
            }
        }
    }
    
    navigateModal(direction) {
        const newPage = this.currentModalPage + direction;
        if (newPage >= 1 && newPage <= this.totalModalPages) {
            this.currentModalPage = newPage;
            this.updateModalPage();
        }
    }
    
    // ASYNC: Main renderer update method - now async
    async updateRendererAsync() {
        if (!this.renderer) return;
        
        console.log('ASYNC: Updating renderer with Clipper2 fusion...');
        this.renderer.clearLayers();
        
        // Check if fusion is enabled
        if (this.renderer.options.fuseGeometry) {
            console.log('ASYNC: Fusion enabled, using Clipper2 WASM...');
            this.showLoadingState('fusion', 'Applying Clipper2 fusion to isolation layer...');
            
            try {
                // Separate isolation operations from others
                const isolationOps = [];
                const otherOps = [];
                
                this.core.operations.forEach(operation => {
                    if (!operation.primitives || operation.primitives.length === 0) return;
                    
                    if (operation.type === 'isolation') {
                        isolationOps.push(operation);
                    } else {
                        otherOps.push(operation);
                    }
                });
                
                // ASYNC: Use async fusion with Clipper2 WASM
                if (isolationOps.length > 0) {
                    // Collect all isolation primitives
                    const isolationPrimitives = [];
                    isolationOps.forEach(op => {
                        isolationPrimitives.push(...op.primitives);
                    });
                    
                    console.log(`ASYNC: Fusing ${isolationPrimitives.length} isolation primitives with Clipper2...`);
                    
                    // ASYNC: Call async fusion method - FIXED: Use correct method name
                    const fused = await this.core.fuseAllPrimitives();
                    
                    if (fused && fused.length > 0) {
                        // Add fused layer
                        this.renderer.addLayer('isolation_fused', fused, {
                            type: 'isolation',
                            visible: true,
                            isFused: true,
                            color: '#ff8844' // Orange for isolation
                        });
                        
                        console.log(`ASYNC: Added fused isolation layer with ${fused.length} primitives`);
                        
                        const reduction = isolationPrimitives.length - fused.length;
                        const percentage = reduction > 0 ? ((reduction / isolationPrimitives.length) * 100).toFixed(1) : 0;
                        this.updateStatus(`Clipper2 fusion complete: ${isolationPrimitives.length} → ${fused.length} primitives (${percentage}% reduction)`, 'success');
                        
                        // Update fusion stats
                        this.fusionStats.lastOperation = {
                            originalCount: isolationPrimitives.length,
                            fusedCount: fused.length,
                            reduction: reduction
                        };
                        this.fusionStats.totalReductions += reduction;
                        
                    } else {
                        console.warn('ASYNC: Fusion produced no valid geometry');
                        this.updateStatus('Clipper2 fusion failed - no valid geometry produced', 'error');
                        
                        // Fall back to original primitives
                        isolationOps.forEach(op => {
                            this.renderer.addLayer(op.id, op.primitives, {
                                type: op.type,
                                visible: true,
                                color: op.color
                            });
                        });
                    }
                }
                
                // Add other layers without fusion
                otherOps.forEach(operation => {
                    this.renderer.addLayer(operation.id, operation.primitives, {
                        type: operation.type,
                        visible: true,
                        color: operation.color || this.getColorForType(operation.type)
                    });
                });
                
            } catch (error) {
                console.error('ASYNC: Fusion error:', error);
                this.updateStatus('Clipper2 fusion failed: ' + error.message, 'error');
                
                // Fall back to individual layers
                this.addIndividualLayers();
            } finally {
                this.hideLoadingState();
            }
        } else {
            console.log('ASYNC: Fusion disabled, adding individual layers...');
            // Add individual operation layers
            this.addIndividualLayers();
        }
        
        console.log(`ASYNC: Renderer has ${this.renderer.layers.size} layer(s)`);
        
        // Force render
        this.renderer.render();
    }
    
    // Keep synchronous wrapper for backwards compatibility with deprecation warning
    updateRenderer() {
        console.warn('DEPRECATED: updateRenderer() is synchronous. Use updateRendererAsync() instead.');
        // Run async version without awaiting (fire and forget)
        this.updateRendererAsync().catch(error => {
            console.error('Error in async renderer update:', error);
        });
    }

    // Helper method to get color for operation type
    getColorForType(type) {
        switch (type) {
            case 'isolation': return '#ff8844';
            case 'clear': return '#44ff88';
            case 'drill': return '#4488ff';
            case 'cutout': return '#ff00ff';
            default: return '#ff8844';
        }
    }
    
    addIndividualLayers() {
        this.core.operations.forEach(operation => {
            if (operation.primitives && operation.primitives.length > 0) {
                // Double-check that primitives are marked with their operation
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
                
                console.log(`Added layer ${operation.id} (${operation.type}) with ${markedPrimitives.length} primitives`);
            }
        });
    }
    
    updateFusionStats(original, fused) {
        const reduction = original - fused;
        
        this.fusionStats.lastOperation = {
            originalCount: original,
            fusedCount: fused,
            reduction: reduction
        };
        
        if (reduction > 0) {
            this.fusionStats.totalReductions += reduction;
            this.fusionStats.operationsWithFusion++;
        }
    }
    
    setupPreviewControls() {
        // Setup enhanced offset input handlers
        this.setupEnhancedOffsetInputHandlers();
        
        // Setup board rotation controls
        this.setupBoardRotationControls();
        
        // Setup debug controls with async fusion toggle
        this.setupDebugControlsAsync();
        
        // Setup advanced options
        this.setupAdvancedOptionsCollapse();
        
        console.log('Preview controls setup complete');
    }
    
    setupEnhancedOffsetInputHandlers() {
        const xInput = document.getElementById('x-offset');
        const yInput = document.getElementById('y-offset');
        
        if (xInput && yInput) {
            // Remove readonly attribute
            xInput.removeAttribute('readonly');
            yInput.removeAttribute('readonly');
            
            // Initialize tracking values
            this.inputTracking.lastXValue = xInput.value || '0';
            this.inputTracking.lastYValue = yInput.value || '0';
            
            // Value-change detection
            const handleValueChange = () => {
                if (this.inputTracking.isUpdating) return;
                
                const currentX = xInput.value;
                const currentY = yInput.value;
                
                // Only update if values actually changed
                if (currentX !== this.inputTracking.lastXValue || currentY !== this.inputTracking.lastYValue) {
                    const offsetX = parseFloat(currentX) || 0;
                    const offsetY = parseFloat(currentY) || 0;
                    
                    if (this.coordinateSystem) {
                        this.coordinateSystem.updatePreviewByOffset(offsetX, offsetY);
                        this.updateOriginDisplay();
                    }
                    
                    // Update tracking values
                    this.inputTracking.lastXValue = currentX;
                    this.inputTracking.lastYValue = currentY;
                }
            };
            
            // Use blur events with value-change detection
            xInput.addEventListener('blur', handleValueChange);
            yInput.addEventListener('blur', handleValueChange);
            
            // Handle Enter key
            const handleEnter = (e) => {
                if (e.key === 'Enter') {
                    handleValueChange();
                    this.applyOffsetAndSetOrigin();
                }
            };
            
            xInput.addEventListener('keypress', handleEnter);
            yInput.addEventListener('keypress', handleEnter);
        }
    }
    
    setupBoardRotationControls() {
        const rotationInput = document.getElementById('rotation-angle');
        
        if (rotationInput) {
            rotationInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const angle = parseFloat(rotationInput.value) || 0;
                    if (angle !== 0) {
                        this.applyBoardRotation(angle);
                        rotationInput.value = '0';
                    }
                }
            });
        }
    }
    
    // ASYNC: Updated debug controls for async fusion
    setupDebugControlsAsync() {
        // Wireframe toggle
        const showWireframe = document.getElementById('show-wireframe');
        if (showWireframe && this.renderer) {
            showWireframe.checked = this.renderer.options.showWireframe || false;
            
            showWireframe.addEventListener('change', async (e) => {
                if (e.target.checked) {
                    // Disable fusion when enabling wireframe
                    const fuseToggle = document.getElementById('fuse-geometry');
                    if (fuseToggle && fuseToggle.checked) {
                        fuseToggle.checked = false;
                    }
                }
                
                this.renderer.setOptions({ showWireframe: e.target.checked });
                await this.updateRendererAsync();
                
                const modeText = e.target.checked ? 'Wireframe mode enabled' : 'Fill mode enabled';
                this.updateStatus(modeText, 'info');
            });
        }
        
        // Fusion toggle - now async
        const fuseToggle = document.getElementById('fuse-geometry');
        if (fuseToggle && this.renderer) {
            fuseToggle.checked = this.renderer.options.fuseGeometry || false;
            
            fuseToggle.addEventListener('change', async (e) => {
                if (e.target.checked) {
                    // Disable wireframe when enabling fusion
                    const wireframeToggle = document.getElementById('show-wireframe');
                    if (wireframeToggle && wireframeToggle.checked) {
                        wireframeToggle.checked = false;
                    }
                    
                    this.updateStatus('Enabling Clipper2 fusion - combining overlapping geometry...', 'info');
                } else {
                    this.updateStatus('Fusion disabled', 'info');
                }
                
                this.renderer.setOptions({ 
                    fuseGeometry: e.target.checked,
                    showWireframe: false // Ensure wireframe is off for fusion
                });
                
                // ASYNC: Update renderer with async fusion
                await this.updateRendererAsync();
            });
        }
        
        // Other controls
        const controls = [
            { id: 'show-pads', option: 'showPads', default: true },
            { id: 'black-white', option: 'blackAndWhite', default: false },
            { id: 'show-grid', option: 'showGrid', default: true },
            { id: 'show-rulers', option: 'showRulers', default: true },
            { id: 'show-bounds', option: 'showBounds', default: false },
            { id: 'show-regions', option: 'showRegions', default: true },
            { id: 'show-traces', option: 'showTraces', default: true },
            { id: 'show-cutouts', option: 'showCutouts', default: true },
            { id: 'show-drills', option: 'showDrills', default: true }
        ];
        
        controls.forEach(control => {
            const element = document.getElementById(control.id);
            if (element && this.renderer) {
                element.checked = this.renderer.options[control.option] !== undefined ? 
                    this.renderer.options[control.option] : control.default;
                
                element.onchange = (e) => {
                    this.renderer.setOptions({ [control.option]: e.target.checked });
                };
            }
        });
    }
    
    setupAdvancedOptionsCollapse() {
        const advancedToggle = document.getElementById('advanced-options-toggle');
        const advancedSection = document.getElementById('advanced-options-section');
        
        if (advancedToggle && advancedSection) {
            advancedSection.classList.remove('expanded');
            advancedToggle.classList.remove('active');
            advancedToggle.textContent = '🔧 Show Advanced Options';
            
            advancedToggle.onclick = () => {
                const isExpanded = advancedSection.classList.contains('expanded');
                
                if (isExpanded) {
                    advancedSection.classList.remove('expanded');
                    advancedToggle.classList.remove('active');
                    advancedToggle.textContent = '🔧 Show Advanced Options';
                } else {
                    advancedSection.classList.add('expanded');
                    advancedToggle.classList.add('active');
                    advancedToggle.textContent = '🔧 Hide Advanced Options';
                    this.updateOperationStatistics();
                }
            };
        }
    }
    
    updatePreviewUI() {
        const stats = this.core.getStats();
        const operationsElement = document.getElementById('preview-operations');
        const polygonsElement = document.getElementById('preview-total-polygons');
        
        if (operationsElement) operationsElement.textContent = stats.operations;
        if (polygonsElement) polygonsElement.textContent = stats.totalPrimitives;
        
        this.updateOriginDisplay();
        this.updateOperationStatistics();
    }
    
    updateOperationStatistics() {
        const statsContainer = document.getElementById('operation-stats');
        if (!statsContainer) return;
        
        if (this.core.operations.length === 0) {
            statsContainer.innerHTML = '<p>Load PCB files to see statistics</p>';
            return;
        }
        
        let statsHtml = '';
        
        this.core.operations.forEach((operation, index) => {
            const status = operation.error ? '❌' : (operation.primitives ? '✅' : '⏳');
            const primitiveCount = operation.primitives ? operation.primitives.length : 0;
            const fileSize = (operation.file.size / 1024).toFixed(1);
            
            statsHtml += `
                <div style="margin-bottom: 0.75rem; padding: 0.5rem; background: var(--bg-hover); border-radius: 4px;">
                    <div style="font-weight: 500; margin-bottom: 0.25rem;">${status} ${operation.file.name}</div>
                    <div style="font-size: 0.75rem; color: var(--text-hint);">
                        Type: ${operation.type} • Size: ${fileSize}KB • Primitives: ${primitiveCount}
                    </div>
                    ${operation.error ? `<div style="color: var(--error); font-size: 0.75rem; margin-top: 0.25rem;">Error: ${operation.error}</div>` : ''}
                </div>
            `;
        });
        
        const totalPrimitives = this.core.stats.totalPrimitives;
        const validOperations = this.core.operations.filter(op => op.primitives && op.primitives.length > 0).length;
        
        statsHtml += `
            <div style="margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid var(--border); font-size: 0.8rem;">
                <strong>Total: ${validOperations}/${this.core.operations.length} files loaded, ${totalPrimitives} primitives</strong>
            </div>
        `;
        
        // Add fusion statistics if available
        if (this.fusionStats.lastOperation && this.renderer && this.renderer.options.fuseGeometry) {
            const fusionStats = this.fusionStats.lastOperation;
            const totalReduction = fusionStats.reduction;
            
            if (totalReduction > 0) {
                const percentage = ((totalReduction / fusionStats.originalCount) * 100).toFixed(1);
                statsHtml += `
                    <div style="margin-top: 0.75rem; padding: 0.5rem; background: rgba(34, 197, 94, 0.1); border: 1px solid var(--success); border-radius: 4px; font-size: 0.75rem;">
                        <strong>🔗 Clipper2 Fusion Active:</strong><br>
                        ${fusionStats.originalCount} → ${fusionStats.fusedCount} primitives<br>
                        <span style="color: var(--success);">${totalReduction} primitives reduced (${percentage}%)</span><br>
                        <small>✅ Automatic hole detection via PolyTree</small>
                    </div>
                `;
            } else {
                statsHtml += `
                    <div style="margin-top: 0.75rem; padding: 0.5rem; background: rgba(245, 158, 11, 0.1); border: 1px solid var(--warning); border-radius: 4px; font-size: 0.75rem;">
                        <strong>🔗 Clipper2 Fusion Active:</strong><br>
                        <span style="color: var(--warning);">No overlapping geometry found</span><br>
                        <small>✅ WASM module loaded</small>
                    </div>
                `;
            }
        }
        
        statsContainer.innerHTML = statsHtml;
    }
    
    // Coordinate system UI methods
    centerOrigin() {
        if (!this.coordinateSystem) return;
        
        const result = this.coordinateSystem.previewCenterOrigin();
        if (result.success) {
            this.updateOffsetInputsWithTracking();
            this.updateOriginDisplay();
            this.updateStatus('Preview: Origin at board center (not saved)', 'info');
        } else {
            this.updateStatus('Cannot preview center: ' + result.error, 'error');
        }
    }
    
    bottomLeftOrigin() {
        if (!this.coordinateSystem) return;
        
        const result = this.coordinateSystem.previewBottomLeftOrigin();
        if (result.success) {
            this.updateOffsetInputsWithTracking();
            this.updateOriginDisplay();
            this.updateStatus('Preview: Origin at board bottom-left (not saved)', 'info');
        } else {
            this.updateStatus('Cannot preview bottom-left: ' + result.error, 'error');
        }
    }
    
    applyOffsetAndSetOrigin() {
        if (!this.coordinateSystem) return;
        
        const result = this.coordinateSystem.saveCurrentOrigin();
        if (result.success) {
            // Reset input boxes to 0 after saving
            this.inputTracking.isUpdating = true;
            
            const xInput = document.getElementById('x-offset');
            const yInput = document.getElementById('y-offset');
            if (xInput) {
                xInput.value = '0';
                this.inputTracking.lastXValue = '0';
            }
            if (yInput) {
                yInput.value = '0';
                this.inputTracking.lastYValue = '0';
            }
            
            this.inputTracking.isUpdating = false;
            
            this.updateOriginDisplay();
            this.updateStatus('Origin saved at current position', 'success');
        } else {
            this.updateStatus('Cannot save origin: ' + result.error, 'error');
        }
    }
    
    resetOrigin() {
        if (!this.coordinateSystem) return;
        
        const result = this.coordinateSystem.resetToSavedOrigin();
        
        if (result.success) {
            this.updateOffsetInputsWithTracking();
            this.updateOriginDisplay();
            this.updateStatus('Reset to saved origin', 'success');
        } else {
            this.updateStatus('Cannot reset: ' + result.error, 'error');
        }
    }
    
    applyBoardRotation(angle) {
        if (!this.coordinateSystem) return;
        
        const result = this.coordinateSystem.rotateBoardBy(angle);
        if (result.success) {
            this.updateOriginDisplay();
            this.updateStatus(`Board rotated by ${angle}°`, 'success');
        } else {
            this.updateStatus(`Cannot rotate board: ${result.error}`, 'error');
        }
    }
    
    resetBoardRotationOnly() {
        if (!this.coordinateSystem) return;
        
        const result = this.coordinateSystem.resetRotationOnly();
        if (result.success) {
            this.updateOriginDisplay();
            this.updateStatus('Board rotation reset (position unchanged)', 'success');
        } else {
            this.updateStatus(`Cannot reset rotation: ${result.error}`, 'error');
        }
    }
    
    updateOffsetInputsWithTracking() {
        const xInput = document.getElementById('x-offset');
        const yInput = document.getElementById('y-offset');
        
        if (xInput && yInput && this.coordinateSystem) {
            this.inputTracking.isUpdating = true;
            
            const offset = this.coordinateSystem.getOffsetFromSaved();
            const newXValue = offset.x.toFixed(1);
            const newYValue = offset.y.toFixed(1);
            
            xInput.value = newXValue;
            yInput.value = newYValue;
            
            // Update tracking values
            this.inputTracking.lastXValue = newXValue;
            this.inputTracking.lastYValue = newYValue;
            
            this.inputTracking.isUpdating = false;
        }
    }
    
    updateOriginDisplay() {
        if (!this.coordinateSystem) return;
        
        const status = this.coordinateSystem.getStatus();
        
        // Update board size in modal header
        const sizeElement = document.getElementById('board-size');
        if (sizeElement) {
            const size = status.boardSize;
            sizeElement.textContent = `${size.width.toFixed(1)} × ${size.height.toFixed(1)} mm`;
        }
        
        this.updateOffsetInputsWithTracking();
    }
    
    // ASYNC: Export SVG - now supports async fusion results
    async exportSVG() {
        if (!this.svgExporter) {
            this.updateStatus('SVG exporter not available', 'error');
            return;
        }
        
        if (!this.renderer) {
            this.updateStatus('No renderer available for SVG export', 'error');
            return;
        }
        
        console.log('ASYNC: Exporting SVG with Clipper2 fusion results...');
        
        try {
            // Ensure renderer is up to date
            if (this.renderer.options.fuseGeometry) {
                this.showLoadingState('export', 'Preparing SVG export with fused geometry...');
                await this.updateRendererAsync();
                this.hideLoadingState();
            }
            
            const svgString = this.svgExporter.exportSVG({
                precision: 2,
                padding: 5,
                optimizePaths: true,
                includeMetadata: true
            });
            
            if (svgString) {
                this.updateStatus('SVG exported successfully with Clipper2 fusion', 'success');
            } else {
                this.updateStatus('SVG export failed - no content to export', 'warning');
            }
        } catch (error) {
            console.error('ASYNC: SVG export error:', error);
            this.updateStatus('SVG export failed: ' + error.message, 'error');
        }
    }
    
    // ASYNC: Queue management for sequential operations
    async processOperationQueue() {
        if (this.isProcessingQueue || this.operationQueue.length === 0) {
            return;
        }
        
        this.isProcessingQueue = true;
        
        while (this.operationQueue.length > 0) {
            const operation = this.operationQueue.shift();
            try {
                await operation();
            } catch (error) {
                console.error('Error processing queued operation:', error);
            }
        }
        
        this.isProcessingQueue = false;
    }
    
    // Add operation to queue
    queueOperation(operation) {
        this.operationQueue.push(operation);
        this.processOperationQueue();
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PCBCamUI;
} else {
    window.PCBCamUI = PCBCamUI;
}