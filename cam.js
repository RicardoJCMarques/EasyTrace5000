// PCB CAM Controller - Fixed coordinate system and color handling
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
        
        // FIXED: Coordinate system integration
        this.coordinateSystem = null;
        
        // Settings
        this.settings = this.loadSettings();
        this.debugMode = localStorage.getItem('pcbcam-debug') === 'true' || false;
        
        // Stats
        this.stats = {
            totalPrimitives: 0,
            operations: 0,
            layers: 0,
            holes: 0
        };
        
        this.initializeUI();
        this.setupEventListeners();
        
        console.log('Semantic PCB CAM Controller initialized with fixed coordinate system');
        console.log('🔧 Press Ctrl+Alt+D to toggle debug mode');
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
            color: this.fileTypes[operationType].color // Store operation color
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
                if (!this.excellonParser) {
                    this.excellonParser = new ExcellonSemanticParser({ debug: this.debugMode });
                }
                parseResult = this.excellonParser.parse(operation.file.content);
            } else {
                if (!this.gerberParser) {
                    this.gerberParser = new GerberSemanticParser({ debug: this.debugMode });
                }
                parseResult = this.gerberParser.parse(operation.file.content);
            }
            
            if (!parseResult.success) {
                operation.error = parseResult.errors.join('; ');
                this.showOperationMessage(operation.type, `Parse errors: ${parseResult.errors.length} issues`, 'error');
                return;
            }
            
            operation.parsed = parseResult;
            
            // Convert to primitives immediately
            if (!this.plotter) {
                this.plotter = new GerberPlotter({ debug: this.debugMode });
            }
            
            let plotResult;
            if (operation.type === 'drill') {
                plotResult = this.plotter.plotDrillData(parseResult);
            } else {
                plotResult = this.plotter.plot(parseResult);
            }
            
            if (!plotResult.success) {
                operation.error = plotResult.error;
                this.showOperationMessage(operation.type, `Plot error: ${plotResult.error}`, 'error');
                return;
            }
            
            operation.primitives = plotResult.primitives;
            operation.bounds = plotResult.bounds;
            
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
            
            // FIXED: Initialize coordinate system properly
            if (!this.coordinateSystem) {
                this.coordinateSystem = new CoordinateSystemManager({ debug: this.debugMode });
            }
            
            // Link coordinate system to renderer
            this.renderer.setCoordinateSystem(this.coordinateSystem);
            this.coordinateSystem.setRenderer(this.renderer);
            
            console.log('✅ Layer renderer initialized with coordinate system');
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
        
        // Update renderer with current operations
        this.updateRenderer();
        
        // FIXED: Calculate coordinate analysis using coordinate system
        this.analyzeCoordinates();
        
        // Setup controls
        this.setupPreviewControls();
        
        // Update UI
        this.updatePreviewUI();
        
        // Fit view
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
    
    analyzeCoordinates() {
        if (!this.coordinateSystem) return;
        
        console.log('[CAM] Analyzing coordinates with operations:', this.operations.length);
        
        // Use coordinate system to analyze operations
        const analysis = this.coordinateSystem.analyzeCoordinateSystem(this.operations);
        
        // Store the analysis for UI updates
        this.coordinateAnalysis = analysis;
        
        console.log('[CAM] Coordinate analysis result:', analysis);
        
        return analysis;
    }
    
    setupPreviewControls() {
        // Origin controls - FIXED to use coordinate system methods
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
        
        // Debug controls - ENHANCED with better fill/outline toggle
        const showFilled = document.getElementById('show-filled');
        const showOutlines = document.getElementById('show-outlines');
        const blackWhite = document.getElementById('black-white');
        const showGrid = document.getElementById('show-grid');
        const showRulers = document.getElementById('show-rulers');
        const showBounds = document.getElementById('show-bounds');
        const showOffsets = document.getElementById('show-offsets');
        const showOriginal = document.getElementById('show-original');
        
        if (showFilled) {
            showFilled.checked = this.renderer.options.showFill;
            showFilled.onchange = (e) => {
                this.renderer.setOptions({ showFill: e.target.checked });
                // Auto-enable outlines when fill is disabled for better visibility
                if (!e.target.checked && showOutlines) {
                    showOutlines.checked = true;
                    this.renderer.setOptions({ showOutlines: true });
                }
            };
        }
        
        if (showOutlines) {
            showOutlines.checked = this.renderer.options.showOutlines;
            showOutlines.onchange = (e) => {
                this.renderer.setOptions({ showOutlines: e.target.checked });
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
        
        // Future offset geometry controls
        if (showOffsets) {
            showOffsets.checked = false;
            showOffsets.onchange = (e) => {
                // Placeholder for future offset path visualization
                console.log('Offset paths:', e.target.checked ? 'ON' : 'OFF');
            };
        }
        
        if (showOriginal) {
            showOriginal.checked = true;
            showOriginal.onchange = (e) => {
                // Control original geometry visibility
                this.renderer.setOptions({ showOriginal: e.target.checked });
            };
        }
        
        // Export SVG button
        const exportSvgBtn = document.getElementById('export-svg-btn');
        if (exportSvgBtn) {
            exportSvgBtn.onclick = () => this.exportSVG();
        }
    }
    
    // FIXED: Use coordinate system methods with proper UI updates
    centerOrigin() {
        if (!this.coordinateSystem) return;
        
        console.log('[CAM] Center origin button pressed');
        const result = this.coordinateSystem.centerOrigin();
        if (result.success) {
            // Force UI update
            this.updateOriginDisplay();
            // Force renderer update to show origin marker in new position
            if (this.renderer) {
                this.renderer.render();
            }
            this.updateStatus('Origin set to board center', 'info');
            console.log('[CAM] Origin centered successfully');
        } else {
            this.updateStatus('Cannot center origin: ' + result.error, 'error');
            console.log('[CAM] Failed to center origin:', result.error);
        }
    }
    
    bottomLeftOrigin() {
        if (!this.coordinateSystem) return;
        
        console.log('[CAM] Bottom-left origin button pressed');
        const result = this.coordinateSystem.bottomLeftOrigin();
        if (result.success) {
            // Force UI update
            this.updateOriginDisplay();
            // Force renderer update to show origin marker in new position
            if (this.renderer) {
                this.renderer.render();
            }
            this.updateStatus('Origin set to board bottom-left', 'info');
            console.log('[CAM] Origin set to bottom-left successfully');
        } else {
            this.updateStatus('Cannot set bottom-left origin: ' + result.error, 'error');
            console.log('[CAM] Failed to set bottom-left origin:', result.error);
        }
    }
    
    setOrigin() {
        const xInput = document.getElementById('x-offset');
        const yInput = document.getElementById('y-offset');
        
        const x = parseFloat(xInput.value) || 0;
        const y = parseFloat(yInput.value) || 0;
        
        console.log(`[CAM] Set origin button pressed with offset (${x}, ${y})`);
        
        if (x === 0 && y === 0) {
            // If both offsets are zero, treat as "tare" - current position becomes new 0,0
            const status = this.coordinateSystem.getStatus();
            this.coordinateSystem.setWorkingOrigin(status.workingOrigin.x, status.workingOrigin.y);
            this.updateStatus('Origin tared to current position', 'info');
            console.log('[CAM] Origin tared to current position');
        } else {
            // Apply offset
            const result = this.coordinateSystem.applyManualOffset(x, y);
            if (result.success) {
                this.updateStatus(`Origin moved by (${x.toFixed(2)}, ${y.toFixed(2)})`, 'info');
                console.log(`[CAM] Origin offset applied: (${x}, ${y})`);
            }
        }
        
        // Force UI update
        this.updateOriginDisplay();
        // Force renderer update
        if (this.renderer) {
            this.renderer.render();
        }
        
        // Reset inputs
        if (xInput) xInput.value = 0;
        if (yInput) yInput.value = 0;
    }
    
    resetOrigin() {
        if (!this.coordinateSystem) return;
        
        console.log('[CAM] Reset origin button pressed');
        this.coordinateSystem.reset();
        
        // Force UI update
        this.updateOriginDisplay();
        // Force renderer update
        if (this.renderer) {
            this.renderer.render();
        }
        
        this.updateStatus('Origin reset to (0, 0)', 'info');
        console.log('[CAM] Origin reset to (0, 0)');
    }
    
    updateOriginDisplay() {
        if (!this.coordinateSystem) return;
        
        const status = this.coordinateSystem.getStatus();
        const currentOriginElement = document.getElementById('current-origin');
        
        if (currentOriginElement) {
            const origin = status.workingOrigin;
            // Show the current working origin coordinates in board coordinate system
            currentOriginElement.textContent = `${origin.x.toFixed(2)}, ${origin.y.toFixed(2)}`;
        }
        
        if (status.boardBounds) {
            const bounds = status.boardBounds;
            const sizeElement = document.getElementById('board-size');
            if (sizeElement) {
                sizeElement.textContent = `${bounds.width.toFixed(1)} × ${bounds.height.toFixed(1)} mm`;
            }
            
            // ENHANCED: Show additional helpful info about the current origin
            if (this.debugMode) {
                console.log('[CAM] Origin display updated:');
                console.log(`  Working origin: (${status.workingOrigin.x.toFixed(2)}, ${status.workingOrigin.y.toFixed(2)})`);
                console.log(`  Board bounds: (${bounds.minX.toFixed(2)}, ${bounds.minY.toFixed(2)}) to (${bounds.maxX.toFixed(2)}, ${bounds.maxY.toFixed(2)})`);
                console.log(`  Board center: (${bounds.centerX.toFixed(2)}, ${bounds.centerY.toFixed(2)})`);
            }
        }
    }
    
    updatePreviewUI() {
        const stats = this.getStats();
        const operationsElement = document.getElementById('preview-operations');
        const polygonsElement = document.getElementById('preview-total-polygons');
        
        if (operationsElement) operationsElement.textContent = stats.operations;
        if (polygonsElement) polygonsElement.textContent = stats.totalPrimitives;
        
        this.updateOriginDisplay();
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
        
        // Debug mode toggle
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.altKey && e.key === 'D') {
                e.preventDefault();
                this.debugMode = !this.debugMode;
                localStorage.setItem('pcbcam-debug', this.debugMode.toString());
                console.log(`Debug mode: ${this.debugMode ? 'ON' : 'OFF'}`);
                
                // Update renderer debug mode
                if (this.renderer) {
                    this.renderer.setOptions({ debug: this.debugMode });
                }
                
                // Update parsers and systems
                if (this.gerberParser) {
                    this.gerberParser.options.debug = this.debugMode;
                }
                if (this.excellonParser) {
                    this.excellonParser.options.debug = this.debugMode;
                }
                if (this.plotter) {
                    this.plotter.options.debug = this.debugMode;
                }
                if (this.coordinateSystem) {
                    this.coordinateSystem.options.debug = this.debugMode;
                }
            }
        });
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
                `Ready: ${this.operations.length} operations, ${this.stats.totalPrimitives} primitives.` : 
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
        const settings = card.querySelector('.operation-settings');
        const btn = card.querySelector('.expand-btn');
        
        settings.style.display = operation.expanded ? 'block' : 'none';
        btn.textContent = operation.expanded ? '▼' : '▶';
        
        this.saveSettings();
    }
    
    removeOperation(operationId) {
        const operationIndex = this.operations.findIndex(op => op.id === operationId);
        if (operationIndex === -1) return;
        
        const operation = this.operations[operationIndex];
        
        // Remove from operations
        this.operations.splice(operationIndex, 1);
        
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
        // Placeholder for SVG export
        this.updateStatus('SVG export in development...', 'info');
        console.log('SVG export requested - will generate SVG from current primitives');
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