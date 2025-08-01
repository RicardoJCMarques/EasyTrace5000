// PCB CAM Controller - FIXED: Canvas positioning, coordinate inputs, modal lifecycle
// File Location: cam.js
// FIXES: Canvas positioning on modal open, editable offset inputs, proper modal lifecycle

class SemanticPCBCam {
    constructor() {
        // Operations storage
        this.operations = [];
        this.nextOperationId = 1;
        
        // File type definitions with distinct colors
        this.fileTypes = {
            isolation: {
                extensions: ['.gbr', '.ger', '.gtl', '.gbl', '.gts', '.gbs', '.gto', '.gbo', '.gtp', '.gbp'],
                description: 'Gerber files for isolation routing',
                icon: '📄',
                color: '#ff8844' // Orange
            },
            clear: {
                extensions: ['.gbr', '.ger', '.gpl', '.gp1', '.gnd'],
                description: 'Gerber files for copper clearing',
                icon: '📄',
                color: '#44ff88' // Green
            },
            drill: {
                extensions: ['.drl', '.xln', '.txt', '.drill', '.exc'],
                description: 'Excellon drill files',
                icon: '🔧',
                color: '#4488ff' // Blue
            },
            cutout: {
                extensions: ['.gbr', '.gko', '.gm1', '.outline', '.mill'],
                description: 'Gerber files for board cutout',
                icon: '📄',
                color: '#ff00ff' // Magenta
            }
        };
        
        // Parsers and plotter
        this.gerberParser = null;
        this.excellonParser = null;
        this.plotter = null;
        this.renderer = null;
        
        // FIXED: Coordinate system with clear workflow
        this.coordinateSystem = null;
        
        // Settings
        this.settings = this.loadSettings();
        
        // Stats
        this.stats = {
            totalPrimitives: 0,
            operations: 0,
            layers: 0,
            holes: 0
        };
        
        this.initializeUI();
        this.setupEventListeners();
        
        // FIXED: Modal page management
        this.currentModalPage = 1;
        this.totalModalPages = 3;
        
        console.log('FIXED: PCB CAM Controller initialized with working coordinate inputs and canvas positioning');
    }
    
    loadSettings() {
        const defaults = {
            pcb: { thickness: 1.6 },
            machine: { 
                safeZ: 2, 
                travelZ: 1, 
                rapidFeed: 1000, 
                workCoordinateSystem: 'G54',
                maxX: 200,
                maxY: 200
            },
            gcode: { 
                postProcessor: 'grbl', 
                startCode: 'G90 G21 G17\nM3 S1000\nG4 P1', 
                endCode: 'M5\nG0 Z10\nM2', 
                units: 'mm' 
            },
            ui: { theme: 'dark', showTooltips: true }
        };
        
        try {
            const saved = localStorage.getItem('pcbcam-settings');
            return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
        } catch (error) {
            console.warn('Error loading saved settings:', error);
            return defaults;
        }
    }
    
    saveSettings() {
        try {
            localStorage.setItem('pcbcam-settings', JSON.stringify(this.settings));
        } catch (error) {
            console.warn('Error saving settings:', error);
        }
    }
    
    getDefaultOperationSettings(operationType) {
        const baseDefaults = {
            tool: { diameter: 0.1, type: 'end_mill', material: 'carbide' },
            cutting: { cutDepth: 0.1, passDepth: 0.05, cutFeed: 100, plungeFeed: 50 },
            operation: {}
        };
        
        switch (operationType) {
            case 'isolation':
                return {
                    ...baseDefaults,
                    tool: { diameter: 0.1, type: 'end_mill', material: 'carbide' },
                    cutting: { cutDepth: 0.05, passDepth: 0.05, cutFeed: 100, plungeFeed: 50 },
                    operation: { 
                        passes: 1, 
                        overlap: 50, 
                        strategy: 'offset',
                        direction: 'outside',
                        cornerHandling: true
                    }
                };
            case 'clear':
                return {
                    ...baseDefaults,
                    tool: { diameter: 0.8, type: 'end_mill', material: 'carbide' },
                    cutting: { cutDepth: 0.1, passDepth: 0.05, cutFeed: 200, plungeFeed: 50 },
                    operation: { 
                        overlap: 50, 
                        pattern: 'parallel', 
                        angle: 0, 
                        margin: 0.1,
                        stepDown: 0.1
                    }
                };
            case 'drill':
                return {
                    ...baseDefaults,
                    tool: { diameter: 1.0, type: 'drill', material: 'carbide' },
                    cutting: { cutDepth: 1.8, passDepth: 0.2, cutFeed: 50, plungeFeed: 25 },
                    operation: { 
                        peckDepth: 0.5, 
                        dwellTime: 0.1, 
                        retractHeight: 1,
                        spindleSpeed: 10000
                    }
                };
            case 'cutout':
                return {
                    ...baseDefaults,
                    tool: { diameter: 1.0, type: 'end_mill', material: 'carbide' },
                    cutting: { cutDepth: 1.8, passDepth: 0.2, cutFeed: 150, plungeFeed: 50 },
                    operation: { 
                        tabs: 4, 
                        tabWidth: 3, 
                        tabHeight: 0.5, 
                        direction: 'conventional',
                        stepDown: 0.2,
                        leadIn: 0.5,
                        leadOut: 0.5
                    }
                };
        }
        return baseDefaults;
    }
    
    createOperation(operationType, file) {
        const operation = {
            id: `op_${this.nextOperationId++}`,
            type: operationType,
            file: {
                name: file.name,
                content: null,
                size: file.size,
                lastModified: file.lastModified
            },
            settings: this.getDefaultOperationSettings(operationType),
            parsed: null,
            primitives: null,
            bounds: null,
            error: null,
            warnings: null,
            expanded: true,
            processed: false,
            color: this.fileTypes[operationType].color
        };
        
        this.operations.push(operation);
        return operation;
    }
    
    initializeUI() {
        // Set theme
        const savedTheme = localStorage.getItem('theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
        
        this.updateUIFromSettings();
        this.renderAllOperations();
        this.updateStatus();
    }
    
    async parseOperationAsync(operation) {
        try {
            this.updateStatus(`Loading ${operation.file.name}...`, 'info');
            
            let parseResult;
            
            if (operation.type === 'drill') {
                const excellonParser = new ExcellonSemanticParser();
                parseResult = excellonParser.parse(operation.file.content);
            } else {
                const gerberParser = new GerberSemanticParser();
                parseResult = gerberParser.parse(operation.file.content);
            }
            
            if (!parseResult.success) {
                operation.error = parseResult.errors.join('; ');
                this.showOperationMessage(operation.type, `Parse errors: ${parseResult.errors.length} issues`, 'error');
                return;
            }
            
            operation.parsed = parseResult;
            
            const plotter = new GerberPlotter({ debug: this.debugMode });
            
            let plotResult;
            if (operation.type === 'drill') {
                plotResult = plotter.plotDrillData(parseResult);
            } else {
                plotResult = plotter.plot(parseResult);
            }
            
            if (!plotResult.success) {
                operation.error = plotResult.error;
                this.showOperationMessage(operation.type, `Plot error: ${plotResult.error}`, 'error');
                return;
            }
            
            operation.primitives = plotResult.primitives;
            operation.bounds = plotResult.bounds;
            
            this.updateCoordinateSystem();
            this.updateStatistics();
            
            const count = operation.primitives.length;
            this.showOperationMessage(operation.type, `Successfully loaded ${count} primitives`, 'success');
            this.updateStatus(`Loaded ${operation.file.name}: ${count} primitives`, 'success');
            
        } catch (error) {
            operation.error = error.message;
            console.error(`Error processing ${operation.file.name}:`, error);
            this.showOperationMessage(operation.type, `Error: ${error.message}`, 'error');
            this.updateStatus(`Error processing ${operation.file.name}: ${error.message}`, 'error');
        }
        
        this.renderOperations(operation.type);
    }
    
    initializeRenderer() {
        if (!this.renderer) {
            this.renderer = new LayerRenderer('preview-canvas');
            
            if (!this.coordinateSystem) {
                this.coordinateSystem = new CoordinateSystemManager({ debug: true });
            }
            
            this.renderer.setCoordinateSystem(this.coordinateSystem);
            this.coordinateSystem.setRenderer(this.renderer);
            
            console.log('✅ FIXED: Layer renderer initialized');
        }
    }
    
    updateCoordinateSystem() {
        if (this.coordinateSystem) {
            this.coordinateSystem.analyzeCoordinateSystem(this.operations);
        }
    }
    
    // FIXED: Enhanced modal opening with proper canvas positioning
    async openPreview() {
        const modal = document.getElementById('preview-modal');
        if (!modal) return;
        
        console.log('FIXED: Opening preview modal with proper canvas positioning...');
        
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
        
        // FIXED: Ensure canvas is properly sized and positioned
        if (this.renderer) {
            console.log('FIXED: Resizing canvas and fitting view...');
            
            // Update coordinate system and renderer
            this.updateCoordinateSystem();
            this.updateRenderer();
            
            // Resize canvas to fit container
            this.renderer.resizeCanvas();
            
            // FIXED: Longer delay to ensure everything is ready
            setTimeout(() => {
                if (this.renderer) {
                    console.log('FIXED: Executing zoomFit with current bounds:', this.renderer.bounds);
                    this.renderer.zoomFit();
                    this.renderer.render(); // Force render after zoom fit
                }
            }, 250); // Increased delay for complex layouts
        }
        
        // Setup controls and UI
        this.setupPreviewControls();
        this.updatePreviewUI();
        
        // FIXED: Update offset inputs to show current offset
        this.updateOffsetInputs();
        
        console.log('FIXED: Modal opened successfully');
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
            '📐 PCB Preview & Coordinate Setup',
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
    
    updateRenderer() {
        if (!this.renderer) return;
        
        this.renderer.clearLayers();
        
        this.operations.forEach(operation => {
            if (operation.primitives && operation.primitives.length > 0) {
                this.renderer.addLayer(operation.id, operation.primitives, {
                    type: operation.type,
                    visible: true,
                    bounds: operation.bounds,
                    color: operation.color || this.fileTypes[operation.type].color
                });
            }
        });
    }
    
    setupPreviewControls() {
        // Origin controls
        const centerBtn = document.getElementById('center-origin-btn');
        const bottomLeftBtn = document.getElementById('bottom-left-origin-btn');
        const setBtn = document.getElementById('set-origin-btn');
        const resetBtn = document.getElementById('reset-origin-btn');
        
        if (centerBtn) {
            centerBtn.onclick = () => this.centerOrigin();
        }
        if (bottomLeftBtn) {
            bottomLeftBtn.onclick = () => this.bottomLeftOrigin();
        }
        if (setBtn) {
            setBtn.onclick = () => this.setOrigin();
        }
        if (resetBtn) {
            resetBtn.onclick = () => this.resetOrigin();
        }
        
        // FIXED: Setup manual offset input handlers
        this.setupOffsetInputHandlers();
        
        // Debug controls setup
        const showFilled = document.getElementById('show-filled');
        const showPads = document.getElementById('show-pads');
        const blackWhite = document.getElementById('black-white');
        const showGrid = document.getElementById('show-grid');
        const showRulers = document.getElementById('show-rulers');
        const showBounds = document.getElementById('show-bounds');
        
        // Geometry type controls
        const showRegions = document.getElementById('show-regions');
        const showTraces = document.getElementById('show-traces');
        const showCutouts = document.getElementById('show-cutouts');
        const showDrills = document.getElementById('show-drills');
        
        if (showFilled) {
            showFilled.checked = this.renderer.options.showFill;
            showFilled.onchange = (e) => {
                this.renderer.setOptions({ showFill: e.target.checked });
            };
        }
        
        if (showPads) {
            showPads.checked = this.renderer.options.showPads !== false;
            showPads.onchange = (e) => {
                this.renderer.setOptions({ showPads: e.target.checked });
            };
        }
        
        if (blackWhite) {
            blackWhite.checked = this.renderer.options.blackAndWhite;
            blackWhite.onchange = (e) => {
                this.renderer.setOptions({ blackAndWhite: e.target.checked });
            };
        }
        
        if (showGrid) {
            showGrid.checked = this.renderer.options.showGrid;
            showGrid.onchange = (e) => {
                this.renderer.setOptions({ showGrid: e.target.checked });
            };
        }
        
        if (showRulers) {
            showRulers.checked = this.renderer.options.showRulers;
            showRulers.onchange = (e) => {
                this.renderer.setOptions({ showRulers: e.target.checked });
            };
        }
        
        if (showBounds) {
            showBounds.checked = this.renderer.options.showBounds;
            showBounds.onchange = (e) => {
                this.renderer.setOptions({ showBounds: e.target.checked });
            };
        }
        
        // Geometry type controls
        if (showRegions) {
            showRegions.checked = this.renderer.options.showRegions !== false;
            showRegions.onchange = (e) => {
                this.renderer.setOptions({ showRegions: e.target.checked });
            };
        }
        
        if (showTraces) {
            showTraces.checked = this.renderer.options.showTraces !== false;
            showTraces.onchange = (e) => {
                this.renderer.setOptions({ showTraces: e.target.checked });
            };
        }
        
        if (showCutouts) {
            showCutouts.checked = this.renderer.options.showCutouts !== false;
            showCutouts.onchange = (e) => {
                this.renderer.setOptions({ showCutouts: e.target.checked });
            };
        }
        
        if (showDrills) {
            showDrills.checked = this.renderer.options.showDrills !== false;
            showDrills.onchange = (e) => {
                this.renderer.setOptions({ showDrills: e.target.checked });
            };
        }
        
        // Export SVG button
        const exportSvgBtn = document.getElementById('export-svg-btn');
        if (exportSvgBtn) {
            exportSvgBtn.onclick = () => this.exportSVG();
        }
        
        this.setupAdvancedOptionsCollapse();
    }
    
    // FIXED: Setup manual offset input handlers
    setupOffsetInputHandlers() {
        const xInput = document.getElementById('x-offset');
        const yInput = document.getElementById('y-offset');
        const applyBtn = document.getElementById('apply-offset-btn');
        
        if (xInput && yInput) {
            // Remove readonly attribute to make inputs editable
            xInput.removeAttribute('readonly');
            yInput.removeAttribute('readonly');
            
            // Add apply button if it doesn't exist
            if (!applyBtn) {
                const applyButton = document.createElement('button');
                applyButton.id = 'apply-offset-btn';
                applyButton.className = 'btn-secondary';
                applyButton.style.width = '100%';
                applyButton.style.marginTop = '0.5rem';
                applyButton.textContent = '↗ Apply Manual Offset';
                applyButton.title = 'Apply the offset values entered above';
                applyButton.onclick = () => this.applyManualOffset();
                
                // Insert after y-offset input group
                const yInputGroup = yInput.closest('.input-group');
                if (yInputGroup && yInputGroup.parentNode) {
                    yInputGroup.parentNode.insertBefore(applyButton, yInputGroup.nextSibling);
                }
            } else {
                applyBtn.onclick = () => this.applyManualOffset();
            }
            
            // Add enter key handlers for quick application
            const handleEnter = (e) => {
                if (e.key === 'Enter') {
                    this.applyManualOffset();
                }
            };
            
            xInput.addEventListener('keypress', handleEnter);
            yInput.addEventListener('keypress', handleEnter);
        }
    }
    
    // FIXED: Advanced options collapse using CSS classes
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
    
    updateOperationStatistics() {
        const statsContainer = document.getElementById('operation-stats');
        if (!statsContainer) return;
        
        if (this.operations.length === 0) {
            statsContainer.innerHTML = '<p>Load PCB files to see statistics</p>';
            return;
        }
        
        let statsHtml = '';
        
        this.operations.forEach((operation, index) => {
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
        
        const totalPrimitives = this.operations.reduce((sum, op) => sum + (op.primitives ? op.primitives.length : 0), 0);
        const validOperations = this.operations.filter(op => op.primitives && op.primitives.length > 0).length;
        
        statsHtml += `
            <div style="margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid var(--border); font-size: 0.8rem;">
                <strong>Total: ${validOperations}/${this.operations.length} files loaded, ${totalPrimitives} primitives</strong>
            </div>
        `;
        
        statsContainer.innerHTML = statsHtml;
    }
    
    centerOrigin() {
        if (!this.coordinateSystem) return;
        
        console.log('[FIXED] Move to center');
        const result = this.coordinateSystem.moveToCenter();
        if (result.success) {
            this.updateOffsetInputs();
            this.updateOriginDisplay();
            this.updateStatus('Origin moved to board center', 'success');
        } else {
            this.updateStatus('Cannot move to center: ' + result.error, 'error');
        }
    }
    
    bottomLeftOrigin() {
        if (!this.coordinateSystem) return;
        
        console.log('[FIXED] Move to bottom-left');
        const result = this.coordinateSystem.moveToBottomLeft();
        if (result.success) {
            this.updateOffsetInputs();
            this.updateOriginDisplay();
            this.updateStatus('Origin moved to board bottom-left', 'success');
        } else {
            this.updateStatus('Cannot move to bottom-left: ' + result.error, 'error');
        }
    }
    
    setOrigin() {
        if (!this.coordinateSystem) return;
        
        console.log('[FIXED] Save current origin position');
        const result = this.coordinateSystem.saveCurrentOrigin();
        
        if (result.success) {
            this.updateOffsetInputs();
            this.updateOriginDisplay();
            this.updateStatus(`Origin saved at current position`, 'success');
        } else {
            this.updateStatus('Cannot save origin: ' + result.error, 'error');
        }
    }
    
    // FIXED: Update offset input boxes to show difference from saved origin
    updateOffsetInputs() {
        const xInput = document.getElementById('x-offset');
        const yInput = document.getElementById('y-offset');
        
        if (xInput && yInput && this.coordinateSystem) {
            const offset = this.coordinateSystem.getOffsetFromSaved();
            xInput.value = offset.x.toFixed(1);
            yInput.value = offset.y.toFixed(1);
        }
    }
    
    // FIXED: Apply manual offset entered by user
    applyManualOffset() {
        const xInput = document.getElementById('x-offset');
        const yInput = document.getElementById('y-offset');
        
        if (!xInput || !yInput || !this.coordinateSystem) return;
        
        const offsetX = parseFloat(xInput.value) || 0;
        const offsetY = parseFloat(yInput.value) || 0;
        
        console.log(`[FIXED] Applying manual offset: (${offsetX}, ${offsetY})`);
        
        const result = this.coordinateSystem.moveOriginByOffset(offsetX, offsetY);
        
        if (result.success) {
            this.updateOffsetInputs(); // Reset inputs to show new offset from saved
            this.updateOriginDisplay();
            this.updateStatus(`Manual offset applied: (${offsetX}, ${offsetY})mm`, 'success');
        } else {
            this.updateStatus('Cannot apply offset: ' + result.error, 'error');
        }
    }
    
    resetOrigin() {
        if (!this.coordinateSystem) return;
        
        console.log('[FIXED] Reset to last stored origin');
        const result = this.coordinateSystem.resetToStoredOrigin();
        
        if (result.success) {
            this.updateOffsetInputs();
            this.updateOriginDisplay();
            this.updateStatus('Origin reset to last stored position', 'success');
        } else {
            this.updateStatus('Cannot reset: ' + result.error, 'error');
        }
    }
    
    updateOriginDisplay() {
        if (!this.coordinateSystem) return;
        
        const status = this.coordinateSystem.getStatus();
        
        const sizeElement = document.getElementById('board-size');
        if (sizeElement) {
            const size = status.boardSize;
            sizeElement.textContent = `${size.width.toFixed(1)} × ${size.height.toFixed(1)} mm`;
        }
        
        const positionElement = document.getElementById('board-position');
        if (positionElement) {
            positionElement.textContent = status.originDescription;
        }
        
        this.updateOffsetInputs();
    }
    
    updatePreviewUI() {
        const stats = this.getStats();
        const operationsElement = document.getElementById('preview-operations');
        const polygonsElement = document.getElementById('preview-total-polygons');
        
        if (operationsElement) operationsElement.textContent = stats.operations;
        if (polygonsElement) polygonsElement.textContent = stats.totalPrimitives;
        
        this.updateOriginDisplay();
        this.updateOperationStatistics();
    }
    
    // FIXED: Proper modal close that preserves renderer
    closePreview() {
        console.log('FIXED: Closing modal - preserving renderer state');
        
        const modal = document.getElementById('preview-modal');
        modal.classList.remove('active');
        document.body.style.overflow = '';
        
        // FIXED: Don't destroy the renderer - just hide the modal
        // The renderer stays active for future modal opens
        if (this.renderer) {
            console.log('FIXED: Renderer preserved with', this.renderer.layers.size, 'layers');
        }
    }
    
    updateStatistics() {
        this.stats.operations = this.operations.length;
        this.stats.totalPrimitives = this.operations.reduce((sum, op) => 
            sum + (op.primitives ? op.primitives.length : 0), 0);
        this.stats.layers = this.operations.filter(op => op.primitives && op.primitives.length > 0).length;
        this.stats.holes = this.operations
            .filter(op => op.type === 'drill')
            .reduce((sum, op) => sum + (op.primitives ? op.primitives.length : 0), 0);
    }
    
    getStats() {
        return {
            totalPrimitives: this.stats.totalPrimitives,
            layers: this.stats.layers,
            holes: this.stats.holes,
            operations: this.stats.operations
        };
    }
    
    validateFileType(fileName, operationType) {
        const extension = this.getFileExtension(fileName);
        const config = this.fileTypes[operationType];
        
        if (config.extensions.includes(extension)) {
            return { valid: true, message: null };
        }
        
        return {
            valid: false,
            message: `Invalid file type for ${operationType}. Expected: ${config.extensions.join(', ')}`
        };
    }
    
    getFileExtension(fileName) {
        const match = fileName.toLowerCase().match(/(\.[^.]+)$/);
        return match ? match[1] : '';
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
    
    setupEventListeners() {
        // Theme toggle
        document.getElementById('theme-toggle')?.addEventListener('click', () => {
            const newTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            
            if (this.renderer) {
                this.renderer.setOptions({ theme: newTheme });
            }
        });

        // File input
        document.getElementById('file-input-temp')?.addEventListener('change', (e) => this.handleFileSelect(e));
        
        document.getElementById('preview-btn')?.addEventListener('click', () => this.openPreview());
        
        // Modal controls
        document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closePreview());
        document.getElementById('zoom-fit-btn')?.addEventListener('click', () => this.renderer?.zoomFit());
        document.getElementById('zoom-in-btn')?.addEventListener('click', () => this.renderer?.zoomIn());
        document.getElementById('zoom-out-btn')?.addEventListener('click', () => this.renderer?.zoomOut());
    }
    
    triggerFileInput(type) {
        const fileInput = document.getElementById('file-input-temp');
        if (fileInput) {
            fileInput.setAttribute('data-type', type);
            
            const config = this.fileTypes[type];
            if (config) {
                fileInput.setAttribute('accept', config.extensions.join(','));
            }
            
            fileInput.click();
        }
    }
    
    updateUIFromSettings() {
        const pcbThickness = document.getElementById('pcb-thickness');
        if (pcbThickness) {
            pcbThickness.value = this.settings.pcb.thickness;
        }
        
        const safeZ = document.getElementById('safe-z');
        if (safeZ) {
            safeZ.value = this.settings.machine.safeZ;
        }
        
        const rapidFeed = document.getElementById('rapid-feed');
        if (rapidFeed) {
            rapidFeed.value = this.settings.machine.rapidFeed;
        }
    }
    
    updateStatus(message = null, type = 'normal') {
        const statusText = document.getElementById('status-text');
        const statusBar = document.getElementById('status');
        if (!statusText || !statusBar) return;

        statusBar.className = 'status';
        if (type !== 'normal') statusBar.classList.add(type);

        const hasValidOperations = this.operations.length > 0 && 
            this.operations.some(op => op.primitives && op.primitives.length > 0);
        
        const previewBtn = document.getElementById('preview-btn');
        if (previewBtn) previewBtn.disabled = !hasValidOperations;

        if (message) {
            statusText.textContent = message;
        } else {
            statusText.textContent = hasValidOperations ? 
                `Ready: ${this.operations.length} operations, ${this.stats.totalPrimitives} primitives` : 
                'Ready - Add PCB files to begin';
        }
    }
    
    handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const type = event.target.getAttribute('data-type');
        if (!type) return;

        const validation = this.validateFileType(file.name, type);
        if (!validation.valid) {
            this.showOperationMessage(type, validation.message, 'error');
            event.target.value = '';
            return;
        }

        const operation = this.createOperation(type, file);
        
        this.renderOperations(type);
        this.updateStatus(`Loading ${file.name}...`);
        
        const reader = new FileReader();
        reader.onload = (e) => {
            operation.file.content = e.target.result;
            this.parseOperationAsync(operation);
        };
        reader.readAsText(file);
        event.target.value = '';
    }
    
    renderAllOperations() {
        ['isolation', 'clear', 'drill', 'cutout'].forEach(type => this.renderOperations(type));
    }
    
    renderOperations(type) {
        const container = document.getElementById(`${type}-operations`);
        if (!container) return;
        
        container.innerHTML = '';
        
        const typeOperations = this.operations.filter(op => op.type === type);
        
        typeOperations.forEach(operation => {
            const operationCard = this.createOperationCard(operation);
            container.appendChild(operationCard);
        });
    }
    
    createOperationCard(operation) {
        const card = document.createElement('div');
        card.className = 'operation-card';
        card.setAttribute('data-operation-id', operation.id);
        
        const config = this.fileTypes[operation.type];
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
        const operation = this.operations.find(op => op.id === operationId);
        if (!operation) return;
        
        operation.expanded = !operation.expanded;
        
        const card = document.querySelector(`[data-operation-id="${operationId}"]`);
        if (!card) return;
        
        const settings = card.querySelector('.operation-settings');
        const btn = card.querySelector('.expand-btn');
        
        if (settings) settings.style.display = operation.expanded ? 'block' : 'none';
        if (btn) btn.textContent = operation.expanded ? '▼' : '▶';
        
        this.saveSettings();
    }
    
    removeOperation(operationId) {
        const operationIndex = this.operations.findIndex(op => op.id === operationId);
        if (operationIndex === -1) return;
        
        const operation = this.operations[operationIndex];
        
        this.operations.splice(operationIndex, 1);
        this.updateCoordinateSystem();
        
        if (this.renderer) {
            this.updateRenderer();
        }
        
        this.showOperationMessage(operation.type, null);
        this.renderOperations(operation.type);
        this.updateStatistics();
        this.updateStatus();
        this.saveSettings();
    }
    
    async exportGcode() {
        this.updateStatus('G-code generation in development...', 'info');
    }
    
    async exportSVG() {
        this.updateStatus('SVG export foundation prepared - implementation coming next...', 'info');
    }
    
    hasValidOperations() {
        return this.operations.some(op => op.primitives && op.primitives.length > 0);
    }
}

// Global function exposure
window.addFile = function(type) { 
    if (window.cam) {
        window.cam.triggerFileInput(type);
    }
};

// Global functions for HTML onclick handlers  
function openPreview() { window.cam?.openPreview(); }
function closePreview() { window.cam?.closePreview(); }
function exportGcode() { window.cam?.exportGcode(); }
function exportSVG() { window.cam?.exportSVG(); }
function centerOrigin() { window.cam?.centerOrigin(); }
function bottomLeftOrigin() { window.cam?.bottomLeftOrigin(); }
function setOrigin() { window.cam?.setOrigin(); }
function resetOrigin() { window.cam?.resetOrigin(); }
function zoomFit() { window.cam?.renderer?.zoomFit(); }
function zoomIn() { window.cam?.renderer?.zoomIn(); }
function zoomOut() { window.cam?.renderer?.zoomOut(); }

// Debug helpers
window.enableRendererDebug = function() {
    if (window.cam?.renderer) {
        window.cam.renderer.setOptions({ debug: true });
        console.log('✅ Renderer debug mode enabled');
    }
};

// Initialize when scripts are loaded
document.addEventListener('DOMContentLoaded', () => {
    if (typeof SemanticPCBCam !== 'undefined') {
        window.cam = new SemanticPCBCam();
        console.log('🎯 FIXED: PCB CAM initialized with working coordinate inputs and canvas positioning');
    }
});