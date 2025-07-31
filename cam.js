// PCB CAM Controller - FIXED: Professional coordinate system workflow
// cam.js

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
        
        // PROFESSIONAL: Coordinate system with clear workflow
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
        
        console.log('PROFESSIONAL: PCB CAM Controller initialized with professional coordinate workflow');
        console.log('🎯 Coordinate system mirrors professional CAM tools');
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
                // FIXED: Create fresh parser instance for each operation to prevent contamination
                const excellonParser = new ExcellonSemanticParser();
                parseResult = excellonParser.parse(operation.file.content);
            } else {
                // FIXED: Create fresh parser instance for each operation to prevent contamination
                const gerberParser = new GerberSemanticParser();
                parseResult = gerberParser.parse(operation.file.content);
            }
            
            if (!parseResult.success) {
                operation.error = parseResult.errors.join('; ');
                this.showOperationMessage(operation.type, `Parse errors: ${parseResult.errors.length} issues`, 'error');
                return;
            }
            
            operation.parsed = parseResult;
            
            // FIXED: Create fresh plotter instance for each operation to prevent contamination
            const plotter = new GerberPlotter({ debug: this.debugMode });
            
            // Convert to primitives with ORIGINAL coordinates
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
            
            // Store primitives (geometry never moves in new system)
            operation.primitives = plotResult.primitives;
            operation.bounds = plotResult.bounds;
            
            // FIXED: Debug logging to track primitive isolation per operation
            console.log(`[CUTOUT-FIX] Operation ${operation.type} (${operation.file.name}): ${operation.primitives.length} primitives`);
            if (operation.type === 'cutout') {
                console.log('[CUTOUT-FIX] Cutout operation primitives:', operation.primitives.map(p => ({
                    type: p.type, 
                    closed: p.closed,
                    bounds: p.getBounds()
                })));
            }
            
            // Update coordinate system bounds
            this.updateCoordinateSystem();
            
            // Update stats
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
            
            // Initialize coordinate system with professional workflow
            if (!this.coordinateSystem) {
                this.coordinateSystem = new CoordinateSystemManager({ debug: true });
            }
            
            // Link coordinate system and renderer
            this.renderer.setCoordinateSystem(this.coordinateSystem);
            this.coordinateSystem.setRenderer(this.renderer);
            
            console.log('✅ PROFESSIONAL: Layer renderer initialized with professional coordinate workflow');
        }
    }
    
    // Update coordinate system with current operations
    updateCoordinateSystem() {
        if (this.coordinateSystem) {
            this.coordinateSystem.analyzeCoordinateSystem(this.operations);
        }
    }
    
    async openPreview() {
        const modal = document.getElementById('preview-modal');
        if (!modal) return;
        
        // Show modal
        document.body.style.overflow = 'hidden';
        modal.style.display = 'flex';
        
        // Initialize renderer
        this.initializeRenderer();
        
        // Update coordinate system and renderer with current operations
        this.updateCoordinateSystem();
        this.updateRenderer();
        
        // Setup controls
        this.setupPreviewControls();
        
        // Update UI with current coordinate system state
        this.updatePreviewUI();
        
        // Fit view after a short delay to ensure everything is ready
        setTimeout(() => {
            if (this.renderer) {
                this.renderer.resizeCanvas();
                this.renderer.zoomFit();
            }
        }, 100);
    }
    
    updateRenderer() {
        if (!this.renderer) return;
        
        // Clear existing layers
        this.renderer.clearLayers();
        
        // Add each operation as a layer with proper type and color
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
        
        // Debug controls setup (keeping existing functionality)
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
                if (!e.target.checked && showPads) {
                    showPads.checked = true;
                    this.renderer.setOptions({ showPads: true });
                }
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
        
        // Advanced options collapse functionality
        this.setupAdvancedOptionsCollapse();
    }
    
    setupAdvancedOptionsCollapse() {
        const advancedToggle = document.getElementById('advanced-options-toggle');
        const advancedSection = document.getElementById('advanced-options-section');
        
        if (advancedToggle && advancedSection) {
            advancedToggle.onclick = () => {
                const isExpanded = advancedSection.style.display !== 'none';
                advancedSection.style.display = isExpanded ? 'none' : 'block';
                advancedToggle.textContent = isExpanded ? '🔧 Show Advanced Options' : '🔧 Hide Advanced Options';
                
                // Add visual indicator when expanded
                if (isExpanded) {
                    advancedToggle.classList.remove('active');
                } else {
                    advancedToggle.classList.add('active');
                    // Update operation statistics when opened
                    this.updateOperationStatistics();
                }
            };
            
            // Start collapsed
            advancedSection.style.display = 'none';
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
        
        // Add summary
        const totalPrimitives = this.operations.reduce((sum, op) => sum + (op.primitives ? op.primitives.length : 0), 0);
        const validOperations = this.operations.filter(op => op.primitives && op.primitives.length > 0).length;
        
        statsHtml += `
            <div style="margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid var(--border); font-size: 0.8rem;">
                <strong>Total: ${validOperations}/${this.operations.length} files loaded, ${totalPrimitives} primitives</strong>
            </div>
        `;
        
        statsContainer.innerHTML = statsHtml;
    }
    
    // PROFESSIONAL: Calculate and show required offsets without applying them
    centerOrigin() {
        if (!this.coordinateSystem) return;
        
        console.log('[CAM-PROFESSIONAL] Calculate center offset');
        const result = this.coordinateSystem.calculateCenterOffset();
        if (result.success) {
            // Update text boxes to show required offset
            const xOffsetInput = document.getElementById('x-offset');
            const yOffsetInput = document.getElementById('y-offset');
            
            if (xOffsetInput) xOffsetInput.value = result.offset.x.toFixed(1);
            if (yOffsetInput) yOffsetInput.value = result.offset.y.toFixed(1);
            
            this.updateStatus('Offset calculated for board center - click "Move Origin" to apply', 'info');
        } else {
            this.updateStatus('Cannot calculate center offset: ' + result.error, 'error');
        }
    }
    
    bottomLeftOrigin() {
        if (!this.coordinateSystem) return;
        
        console.log('[CAM-PROFESSIONAL] Calculate bottom-left offset');
        const result = this.coordinateSystem.calculateBottomLeftOffset();
        if (result.success) {
            // Update text boxes to show required offset
            const xOffsetInput = document.getElementById('x-offset');
            const yOffsetInput = document.getElementById('y-offset');
            
            if (xOffsetInput) xOffsetInput.value = result.offset.x.toFixed(1);
            if (yOffsetInput) yOffsetInput.value = result.offset.y.toFixed(1);
            
            this.updateStatus('Offset calculated for board bottom-left - click "Move Origin" to apply', 'info');
        } else {
            this.updateStatus('Cannot calculate bottom-left offset: ' + result.error, 'error');
        }
    }
    
    setOrigin() {
        const xInput = document.getElementById('x-offset');
        const yInput = document.getElementById('y-offset');
        
        const x = parseFloat(xInput.value) || 0;
        const y = parseFloat(yInput.value) || 0;
        
        console.log(`[CAM-PROFESSIONAL] Apply offset from text boxes: (${x}, ${y})`);
        
        // Validate inputs
        if (Math.abs(x) > 500 || Math.abs(y) > 500) {
            this.updateStatus('Offset too large (max ±500mm)', 'error');
            return;
        }
        
        // PROFESSIONAL: Apply the offset shown in text boxes
        const result = this.coordinateSystem.moveOriginByOffset(x, y);
        if (result.success) {
            this.updateOriginDisplay();
            this.updateStatus(`Origin moved by (${x.toFixed(1)}, ${y.toFixed(1)})mm`, 'success');
        } else {
            this.updateStatus('Cannot move origin: ' + result.error, 'error');
        }
    }
    
    resetOrigin() {
        if (!this.coordinateSystem) return;
        
        console.log('[CAM-PROFESSIONAL] Reset to last stored origin');
        const result = this.coordinateSystem.resetToStoredOrigin();
        
        if (result.success) {
            this.updateOriginDisplay();
            this.updateStatus('Origin reset to last stored position', 'success');
        } else {
            this.updateStatus('Cannot reset: ' + result.error, 'error');
        }
    }
    
    
    // PROFESSIONAL: Display coordinate information showing current offsets
    updateOriginDisplay() {
        if (!this.coordinateSystem) return;
        
        const status = this.coordinateSystem.getStatus();
        
        console.log('[CAM-PROFESSIONAL] Updating coordinate display');
        
        // Update board size display
        const sizeElement = document.getElementById('board-size');
        if (sizeElement) {
            const size = status.boardSize;
            sizeElement.textContent = `${size.width.toFixed(1)} × ${size.height.toFixed(1)} mm`;
        }
        
        // PROFESSIONAL: Show clear origin status
        const positionElement = document.getElementById('board-position');
        if (positionElement) {
            positionElement.textContent = status.originDescription;
        }
        
        // PROFESSIONAL: Keep current values in offset inputs (don't reset them)
        // This allows user to see what they've entered or what preset buttons calculated
        // Only update if user is not currently editing the fields
        const xOffsetInput = document.getElementById('x-offset');
        const yOffsetInput = document.getElementById('y-offset');
        
        if (xOffsetInput && !xOffsetInput.matches(':focus')) {
            // Keep current value or show 0 if empty
            if (!xOffsetInput.value) {
                xOffsetInput.value = '0.0';
            }
        }
        if (yOffsetInput && !yOffsetInput.matches(':focus')) {
            // Keep current value or show 0 if empty  
            if (!yOffsetInput.value) {
                yOffsetInput.value = '0.0';
            }
        }
        
        console.log('[CAM-PROFESSIONAL] Coordinate display updated:');
        console.log(`  Board size: ${status.boardSize.width.toFixed(1)} × ${status.boardSize.height.toFixed(1)} mm`);
        console.log(`  Origin: ${status.originDescription}`);
        console.log(`  Current position: (${status.currentPosition.x.toFixed(2)}, ${status.currentPosition.y.toFixed(2)})`);
    }
    
    updatePreviewUI() {
        const stats = this.getStats();
        const operationsElement = document.getElementById('preview-operations');
        const polygonsElement = document.getElementById('preview-total-polygons');
        
        if (operationsElement) operationsElement.textContent = stats.operations;
        if (polygonsElement) polygonsElement.textContent = stats.totalPrimitives;
        
        // Update coordinate display
        this.updateOriginDisplay();
        
        // Update operation statistics in debug section
        this.updateOperationStatistics();
    }
    
    closePreview() {
        document.getElementById('preview-modal').style.display = 'none';
        document.body.style.overflow = '';
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
        
        // Remove existing messages
        container.querySelectorAll('.operation-message').forEach(el => el.remove());
        
        if (!message) return;
        
        const messageEl = document.createElement('div');
        messageEl.className = `operation-message operation-${type}`;
        messageEl.textContent = message;
        
        container.appendChild(messageEl);
        
        // Auto-remove after 5 seconds
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
            
            // Update renderer theme
            if (this.renderer) {
                this.renderer.setOptions({ theme: newTheme });
            }
        });

        // File input
        document.getElementById('file-input-temp')?.addEventListener('change', (e) => this.handleFileSelect(e));
        
        // Main buttons
        document.getElementById('preview-btn')?.addEventListener('click', () => this.openPreview());
        document.getElementById('export-gcode-btn')?.addEventListener('click', () => this.exportGcode());
        
        // Modal controls
        document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closePreview());
        document.getElementById('modal-goback-btn')?.addEventListener('click', () => this.closePreview());
        document.getElementById('generate-gcode-modal-btn')?.addEventListener('click', () => this.exportGcode());
        document.getElementById('zoom-fit-btn')?.addEventListener('click', () => this.renderer?.zoomFit());
        document.getElementById('zoom-in-btn')?.addEventListener('click', () => this.renderer?.zoomIn());
        document.getElementById('zoom-out-btn')?.addEventListener('click', () => this.renderer?.zoomOut());
    }
    
    triggerFileInput(type) {
        const fileInput = document.getElementById('file-input-temp');
        if (fileInput) {
            fileInput.setAttribute('data-type', type);
            
            // Set file filter
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
        
        // Update button states
        const previewBtn = document.getElementById('preview-btn');
        const exportBtn = document.getElementById('export-gcode-btn');
        
        if (previewBtn) previewBtn.disabled = !hasValidOperations;
        if (exportBtn) exportBtn.disabled = !hasValidOperations;

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

        // Validate file type
        const validation = this.validateFileType(file.name, type);
        if (!validation.valid) {
            this.showOperationMessage(type, validation.message, 'error');
            event.target.value = '';
            return;
        }

        // Create new operation
        const operation = this.createOperation(type, file);
        
        this.renderOperations(type);
        this.updateStatus(`Loading ${file.name}...`);
        
        // Read file content
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
        
        // Clear existing content
        container.innerHTML = '';
        
        // Render operations of this type
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
        
        // Add color indicator
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
        
        // Remove from operations
        this.operations.splice(operationIndex, 1);
        
        // Update coordinate system
        this.updateCoordinateSystem();
        
        // Remove from renderer
        if (this.renderer) {
            this.updateRenderer();
        }
        
        // Update UI
        this.showOperationMessage(operation.type, null);
        this.renderOperations(operation.type);
        this.updateStatistics();
        this.updateStatus();
        this.saveSettings();
    }
    
    async exportGcode() {
        // Placeholder for G-code generation
        this.updateStatus('G-code generation in development...', 'info');
    }
    
    async exportSVG() {
        // SVG Export Foundation - will export visible geometry from current viewport
        console.log('🎯 SVG Export Plan:');
        console.log('1. Capture current viewport bounds');
        console.log('2. Collect visible layers/primitives based on current show/hide settings');
        console.log('3. Apply coordinate transformation based on origin position');
        console.log('4. Generate SVG with proper scaling and colors');
        console.log('5. Include coordinate system markers (optional)');
        
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

window.debugCutoutLayer = function() {
    if (!window.cam?.renderer) {
        console.log('❌ No renderer available');
        return;
    }
    
    console.log('🔍 CUTOUT LAYER DEBUG');
    console.log('=====================');
    
    window.cam.renderer.layers.forEach((layer, layerName) => {
        if (layer.type === 'cutout') {
            console.log(`📄 Cutout layer: ${layerName}`);
            console.log(`  Primitives: ${layer.primitives.length}`);
            console.log(`  Visible: ${layer.visible}`);
            
            layer.primitives.forEach((primitive, index) => {
                console.log(`  [${index}] Type: ${primitive.type}, Properties:`, primitive.properties);
            });
        }
    });
};

// PROFESSIONAL: Enhanced debug for coordinate system
window.debugCoordinateSystem = function() {
    if (!window.cam?.coordinateSystem) {
        console.log('❌ No coordinate system available');
        return;
    }
    
    console.log('🔍 PROFESSIONAL COORDINATE SYSTEM DEBUG');
    console.log('=======================================');
    
    const status = window.cam.coordinateSystem.getStatus();
    console.log('Current Status:');
    console.log(`  Origin: ${status.originDescription}`);
    console.log(`  Board Size: ${status.boardSize.width.toFixed(1)} × ${status.boardSize.height.toFixed(1)} mm`);
    console.log(`  Current Position: (${status.currentPosition.x.toFixed(2)}, ${status.currentPosition.y.toFixed(2)})`);
    console.log(`  Has Custom Origin: ${status.hasCustomOrigin ? 'Yes' : 'No'}`);
    
    return status;
};