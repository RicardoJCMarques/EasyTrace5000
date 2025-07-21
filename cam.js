// PCB CAM Controller

class PolygonPCBCam {
    constructor() {
        // Core architecture - each file is one operation
        this.operations = [];
        this.nextOperationId = 1;
        
        // File type definitions
        this.fileTypes = {
            isolation: {
                extensions: ['.gbr', '.ger', '.gtl', '.gbl', '.gts', '.gbs', '.gto', '.gbo', '.gtp', '.gbp'],
                description: 'Gerber files for isolation routing',
                icon: '📄'
            },
            clear: {
                extensions: ['.gbr', '.ger', '.gpl', '.gp1', '.gnd'],
                description: 'Gerber files for copper clearing',
                icon: '📄'
            },
            drill: {
                extensions: ['.drl', '.xln', '.txt', '.drill', '.exc'],
                description: 'Excellon drill files',
                icon: '🔧'
            },
            cutout: {
                extensions: ['.gbr', '.gko', '.gm1', '.outline', '.mill'],
                description: 'Gerber files for board cutout',
                icon: '📄'
            }
        };
        
        // Processing engines (initialized on demand)
        this.geometryAnalyzer = null;
        this.offsetEngine = null;
        this.coordinateSystem = null;
        this.fusionEngine = null;
        this.gcodeGenerator = null;
        
        // Processing state
        this.layers = new Map();
        this.processedGeometry = null;
        this.coordinateAnalysis = null;
        this.geometryProcessed = false;
        
        this.settings = this.loadSettings();
        this.debugMode = false;
        
        // Statistics
        this.stats = {
            totalPolygons: 0,
            operations: 0,
            layers: 0,
            holes: 0
        };
        
        this.initializeUI();
        this.setupEventListeners();
        
        console.log('Balanced PCB CAM initialized - Clean UI + Core Functionality');
    }
    
    loadSettings() {
        const defaults = {
            pcb: { thickness: 1.8 },
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
            return saved ? this.deepMerge(defaults, JSON.parse(saved)) : defaults;
        } catch (error) {
            console.warn('Error loading saved settings:', error);
            return defaults;
        }
    }
    
    // Get default settings for operation types
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
                    tool: { diameter: 0.2, type: 'end_mill', material: 'carbide' },
                    cutting: { cutDepth: 0.25, passDepth: 0.25, cutFeed: 100, plungeFeed: 50 },
                    operation: { passes: 1, overlap: 50, strategy: 'offset' }
                };
            case 'clear':
                return {
                    ...baseDefaults,
                    tool: { diameter: 1.0, type: 'end_mill', material: 'carbide' },
                    cutting: { cutDepth: 0.25, passDepth: 0.25, cutFeed: 200, plungeFeed: 50 },
                    operation: { overlap: 50, pattern: 'parallel', angle: 0, margin: 0.1 }
                };
            case 'drill':
                return {
                    ...baseDefaults,
                    tool: { diameter: 1.0, type: 'drill', material: 'carbide' },
                    cutting: { cutDepth: 1.8, passDepth: 0.2, cutFeed: 50, plungeFeed: 25 },
                    operation: { peckDepth: 0.5, dwellTime: 0.1, retractHeight: 1 }
                };
            case 'cutout':
                return {
                    ...baseDefaults,
                    tool: { diameter: 1.0, type: 'end_mill', material: 'carbide' },
                    cutting: { cutDepth: 1.8, passDepth: 0.5, cutFeed: 100, plungeFeed: 50 },
                    operation: { tabs: 4, tabWidth: 3, tabHeight: 0.5, direction: 'conventional' }
                };
        }
        return baseDefaults;
    }
    
    // Create new operation from file
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
            error: null,
            polygons: [],
            holes: [],
            expanded: true,
            layerName: null,
            processed: false
        };
        
        this.operations.push(operation);
        return operation;
    }
    
    deepMerge(target, source) {
        const result = { ...target };
        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = this.deepMerge(target[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }
        return result;
    }

    saveSettings() {
        try {
            localStorage.setItem('pcbcam-settings', JSON.stringify(this.settings));
        } catch (error) {
            console.warn('Error saving settings:', error);
        }
    }

    initializeUI() {
        // Set theme
        const savedTheme = localStorage.getItem('theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
        
        this.updateUIFromSettings();
        this.renderAllOperations();
        this.updateStatus();
    }
    
    // Parse files immediately
    async parseOperationAsync(operation) {
        try {
            this.updateStatus(`Loading ${operation.file.name}...`, 'info');
            
            let parser;
            let result;
            
            if (operation.type === 'drill') {
                parser = new ExcellonPolygonParser({ debug: this.debugMode });
                result = parser.parse(operation.file.content);
                
                operation.parsed = result;
                operation.holes = result.holes;
                operation.polygons = [];
                
            } else {
                parser = new GerberPolygonParser({ debug: this.debugMode });
                result = parser.parse(operation.file.content);
                
                operation.parsed = result;
                operation.polygons = result.polygons;
            }
            
            if (result.errors && result.errors.length > 0) {
                operation.warnings = result.errors;
                console.warn(`⚠️ Parse warnings for ${operation.file.name}: ${result.errors.length} issues`);
            }
            
            // Simple layer setup - NO processing yet
            operation.layerName = `${operation.type}_${operation.id}`;
            this.layers.set(operation.layerName, operation.polygons);
            
            // Mark that we need to reprocess geometry
            this.geometryProcessed = false;
            
            this.updateSimpleStatistics();
            
            const itemCount = operation.type === 'drill' ? result.holes.length : result.polygons.length;
            const unitType = operation.type === 'drill' ? 'holes' : 'polygons';
            
            this.showOperationMessage(operation.type, `Successfully loaded ${itemCount} ${unitType}`, 'success');
            this.updateStatus(`Loaded ${operation.file.name}: ${itemCount} ${unitType}`, 'success');

        } catch (error) {
            operation.error = error.message;
            console.error(`Error parsing ${operation.file.name}:`, error);
            this.showOperationMessage(operation.type, `Error parsing ${operation.file.name}: ${error.message}`, 'error');
            this.updateStatus(`Error parsing ${operation.file.name}: ${error.message}`, 'error');
        }
        
        this.renderOperations(operation.type);
    }
    
    // Initialize processing engines on first use
    initializeProcessingEngines() {
        if (!this.geometryAnalyzer) {
            this.geometryAnalyzer = new GeometryAnalyzer({ debug: this.debugMode });
            console.log('✅ Geometry analyzer initialized');
        }
        
        if (!this.offsetEngine) {
            this.offsetEngine = new EnhancedOffsetEngine({ debug: this.debugMode });
            console.log('✅ Enhanced offset engine initialized');
        }
        
        if (!this.coordinateSystem) {
            this.coordinateSystem = new CoordinateSystemManager({ debug: this.debugMode });
            console.log('✅ Coordinate system initialized');
        }
        
        if (!this.fusionEngine) {
            this.fusionEngine = new PolygonFusionEngine({ debug: this.debugMode });
            console.log('✅ Polygon fusion engine initialized');
        }
    }
    
    // Process geometry when preview is opened
    async processGeometryForPreview() {
        if (this.operations.length === 0) return null;
        
        this.updateStatus('Processing geometry for preview...', 'info');
        
        try {
            // Initialize engines
            this.initializeProcessingEngines();
            
            // Collect all geometry
            const allPolygons = [];
            const allHoles = [];
            
            this.operations.forEach(operation => {
                if (operation.polygons && operation.polygons.length > 0) {
                    allPolygons.push(...operation.polygons);
                }
                if (operation.holes && operation.holes.length > 0) {
                    allHoles.push(...operation.holes);
                }
            });
            
            // Geometry analysis (filtered to avoid spam)
            const geometryAnalysis = this.geometryAnalyzer.analyzeGeometry(this.operations);
            
            // Coordinate system analysis
            this.coordinateAnalysis = this.coordinateSystem.analyzeCoordinateSystem(this.operations);
            
            // Boolean fusion where beneficial
            const processedLayers = new Map();
            for (const [layerName, polygons] of this.layers.entries()) {
                if (polygons.length > 1 && this.shouldFuseLayer(layerName, polygons)) {
                    const fusedPolygons = this.fusionEngine.fusePolygons(polygons, 'union');
                    processedLayers.set(layerName, fusedPolygons);
                    console.log(`Fused layer ${layerName}: ${polygons.length} → ${fusedPolygons.length} polygons`);
                } else {
                    processedLayers.set(layerName, [...polygons]);
                }
            }
            
            this.updateStatus('Geometry processing complete', 'success');
            
            return {
                polygons: allPolygons,
                holes: allHoles,
                processedLayers: processedLayers,
                coordinateAnalysis: this.coordinateAnalysis,
                geometryAnalysis: geometryAnalysis
            };
            
        } catch (error) {
            console.error('Geometry processing error:', error);
            this.updateStatus(`Geometry processing failed: ${error.message}`, 'error');
            return null;
        }
    }
    
    // Determine if layer should be fused
    shouldFuseLayer(layerName, polygons) {
        if (polygons.length <= 1) return false;
        
        // Simple heuristics for auto-fusion
        if (polygons.length > 20) return true; // Many small features
        
        // Check for overlapping or very close polygons
        const bounds = PolygonUtils.calculateBounds(polygons);
        const totalArea = bounds ? (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY) : 0;
        const polygonArea = polygons.reduce((sum, p) => sum + (p.getArea ? p.getArea() : 0), 0);
        
        // If polygons take up significant area, they might be connected
        if (totalArea > 0 && polygonArea / totalArea > 0.3) return true;
        
        return false;
    }
    
    // Enhanced preview with proper processing
    async openPreview() {
        const modal = document.getElementById('preview-modal');
        if (!modal) return;
        
        modal.style.display = 'flex';
        
        // Process geometry if not already done
        if (!this.geometryProcessed) {
            this.processedGeometry = await this.processGeometryForPreview();
            this.geometryProcessed = true;
        }
        
        if (!this.renderer) {
            this.renderer = new PreviewRenderer('preview-canvas');
            
            // Initialize SVG exporter
            if (typeof SVGDebugExporter !== 'undefined') {
                this.renderer.svgExporter = new SVGDebugExporter(this.renderer);
                console.log('✅ SVG exporter initialized');
            }
        }

        this.renderer.setDebugMode(this.debugMode);
        this.updateRenderer();
        this.updatePreviewUI();
    }
    
    updateRenderer() {
        if (!this.renderer) return;
        
        const renderData = this.createRenderData();
        this.renderer.setData(renderData);
    }
    
    createRenderData() {
        const renderData = {
            isolation: [],
            clear: [],
            drill: [],
            cutout: []
        };
        
        // Use processed layers if available, otherwise original
        const layersToUse = this.processedGeometry?.processedLayers || this.layers;
        
        this.operations.forEach(operation => {
            if (operation.layerName && layersToUse.has(operation.layerName)) {
                const polygons = layersToUse.get(operation.layerName);
                
                const virtualFile = {
                    name: operation.file.name,
                    polygons: polygons,
                    holes: operation.holes || [],
                    parsed: {
                        polygons: polygons,
                        bounds: polygons.length > 0 ? PolygonUtils.calculateBounds(polygons) : null
                    },
                    error: operation.error,
                    processed: operation.processed
                };
                
                renderData[operation.type].push(virtualFile);
            }
        });
        
        return renderData;
    }
    
    // Update preview UI with coordinate system
    updatePreviewUI() {
        // Update board size
        if (this.coordinateAnalysis && this.coordinateAnalysis.boardBounds) {
            const bounds = this.coordinateAnalysis.boardBounds;
            const sizeElement = document.getElementById('board-size');
            if (sizeElement) {
                sizeElement.textContent = `${bounds.width.toFixed(1)} × ${bounds.height.toFixed(1)} mm`;
            }
        }
        
        // Update statistics
        const stats = this.getPolygonStats();
        const operationsElement = document.getElementById('preview-operations');
        const polygonsElement = document.getElementById('preview-total-polygons');
        
        if (operationsElement) operationsElement.textContent = stats.operations;
        if (polygonsElement) polygonsElement.textContent = stats.totalPolygons;
        
        // Setup origin controls
        this.setupOriginControls();
        
        // Update current origin display
        this.updateOriginDisplay(this.coordinateSystem?.currentOrigin || { x: 0, y: 0 });
    }
    
    setupOriginControls() {
        // Origin preset buttons
        document.getElementById('center-origin-btn')?.addEventListener('click', () => {
            this.centerOrigin();
        });
        
        document.getElementById('bottom-left-origin-btn')?.addEventListener('click', () => {
            this.bottomLeftOrigin();
        });
        
        // Explicit Set button for manual coordinates
        document.getElementById('set-origin-btn')?.addEventListener('click', () => {
            const xOffsetInput = document.getElementById('x-offset');
            const yOffsetInput = document.getElementById('y-offset');
            
            if (xOffsetInput && yOffsetInput) {
                const x = parseFloat(xOffsetInput.value) || 0;
                const y = parseFloat(yOffsetInput.value) || 0;
                this.setManualOrigin(x, y);
            }
        });
        
        // Optional: Update display as user types (but don't move origin until Set is clicked)
        const xOffsetInput = document.getElementById('x-offset');
        const yOffsetInput = document.getElementById('y-offset');
        
        if (xOffsetInput && yOffsetInput) {
            [xOffsetInput, yOffsetInput].forEach(input => {
                input.addEventListener('input', () => {
                    // Visual feedback that values have changed but not yet set
                    const setButton = document.getElementById('set-origin-btn');
                    if (setButton) {
                        setButton.style.background = 'var(--warning)';
                        setButton.style.color = 'white';
                        setButton.textContent = '📌 Set Origin (Modified)';
                    }
                });
            });
        }
    }
    
    // Coordinate system methods - move origin marker, not geometry
    centerOrigin() {
        if (this.coordinateAnalysis && this.coordinateAnalysis.boardBounds) {
            const bounds = this.coordinateAnalysis.boardBounds;
            const centerX = bounds.centerX;
            const centerY = bounds.centerY;
            this.setOriginPosition(centerX, centerY);
        }
    }
    
    bottomLeftOrigin() {
        if (this.coordinateAnalysis && this.coordinateAnalysis.boardBounds) {
            const bounds = this.coordinateAnalysis.boardBounds;
            this.setOriginPosition(bounds.minX, bounds.minY);
        }
    }
    
    setManualOrigin(x, y) {
        this.setOriginPosition(x, y);
    }
    
    // Core origin setting - visual feedback only
    setOriginPosition(x, y) {
        if (this.coordinateSystem) {
            this.coordinateSystem.currentOrigin = { x, y };
        }
        
        // Update visual display
        this.updateOriginDisplay({ x, y });
        
        // Move origin marker in renderer
        if (this.renderer) {
            this.renderer.setOriginPosition(x, y);
        }
        
        // Reset Set button styling
        const setButton = document.getElementById('set-origin-btn');
        if (setButton) {
            setButton.style.background = 'var(--bg)';
            setButton.style.color = 'var(--text)';
            setButton.textContent = '📌 Set Origin';
        }
        
        this.updateStatus(`Origin set to (${x.toFixed(2)}, ${y.toFixed(2)}) - G-code coordinates will be relative to this point`, 'success');
    }
    
    updateOriginDisplay(origin) {
        const currentOriginElement = document.getElementById('current-origin');
        if (currentOriginElement) {
            currentOriginElement.textContent = `${origin.x.toFixed(2)}, ${origin.y.toFixed(2)}`;
        }
        
        // Update input fields
        const xOffsetInput = document.getElementById('x-offset');
        const yOffsetInput = document.getElementById('y-offset');
        if (xOffsetInput) xOffsetInput.value = origin.x.toFixed(2);
        if (yOffsetInput) yOffsetInput.value = origin.y.toFixed(2);
    }
    
    // Generate G-code
    async exportGcode() {
        if (this.operations.length === 0) {
            this.updateStatus('No operations loaded for G-code export.', 'warning');
            return;
        }
        
        // Initialize processing if needed
        if (!this.geometryProcessed) {
            this.processedGeometry = await this.processGeometryForPreview();
            this.geometryProcessed = true;
        }
        
        this.updateStatus('G-code generation - feature in development', 'warning');
        console.log('G-code generation would use:', {
            operations: this.operations,
            processedGeometry: this.processedGeometry,
            coordinateAnalysis: this.coordinateAnalysis
        });
    }
    
    // Standard UI methods (unchanged)
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
        });

        // File input change handler
        document.getElementById('file-input-temp')?.addEventListener('change', (e) => this.handleFileSelect(e));
        
        // Main action buttons
        document.getElementById('preview-btn')?.addEventListener('click', () => this.openPreview());
        document.getElementById('export-gcode-btn')?.addEventListener('click', () => this.exportGcode());
        
        // Modal and preview controls
        document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closePreview());
        document.getElementById('modal-goback-btn')?.addEventListener('click', () => this.closePreview());
        document.getElementById('zoom-fit-btn')?.addEventListener('click', () => this.renderer?.zoomFit());
        document.getElementById('zoom-in-btn')?.addEventListener('click', () => this.renderer?.zoomIn());
        document.getElementById('zoom-out-btn')?.addEventListener('click', () => this.renderer?.zoomOut());
        document.getElementById('export-clean-svg-btn')?.addEventListener('click', () => this.exportCleanSVG());
    }

    triggerFileInput(type) {
        const fileInput = document.getElementById('file-input-temp');
        if (fileInput) {
            fileInput.setAttribute('data-type', type);
            
            // Set file filter based on operation type
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

        const hasValidOperations = this.operations.length > 0 && this.layers.size > 0;
        
        // Update button states
        const previewBtn = document.getElementById('preview-btn');
        const exportBtn = document.getElementById('export-gcode-btn');
        
        if (previewBtn) previewBtn.disabled = !hasValidOperations;
        if (exportBtn) exportBtn.disabled = !hasValidOperations;

        if (message) {
            statusText.textContent = message;
        } else {
            statusText.textContent = hasValidOperations ? 
                `Ready: ${this.operations.length} operations, ${this.stats.totalPolygons} polygons.` : 
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
    
    updateSimpleStatistics() {
        this.stats.operations = this.operations.length;
        this.stats.layers = this.layers.size;
        this.stats.totalPolygons = Array.from(this.layers.values()).reduce((sum, polygons) => sum + polygons.length, 0);
        this.stats.holes = this.operations.reduce((sum, op) => sum + (op.holes ? op.holes.length : 0), 0);
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
        } else if (operation.parsed) {
            statusIcon = '✅';
        }
        
        card.innerHTML = `
            <div class="operation-header">
                <span class="operation-icon">${config.icon}</span>
                <span class="operation-name">${operation.file.name}</span>
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
                        <input type="number" id="passes-${operation.id}" 
                               value="${settings.passes}" min="1" step="1">
                    </div>
                    <div class="input-group">
                        <label>Overlap %</label>
                        <input type="number" id="overlap-${operation.id}" 
                               value="${settings.overlap}" min="0" max="100" step="1">
                    </div>
                `;
                
            case 'clear':
                return `
                    <div class="input-group">
                        <label>Pattern</label>
                        <select id="pattern-${operation.id}">
                            <option value="parallel" ${settings.pattern === 'parallel' ? 'selected' : ''}>Parallel</option>
                            <option value="crosshatch" ${settings.pattern === 'crosshatch' ? 'selected' : ''}>Crosshatch</option>
                        </select>
                    </div>
                    <div class="input-group">
                        <label>Overlap %</label>
                        <input type="number" id="overlap-${operation.id}" 
                               value="${settings.overlap}" min="0" max="100" step="1">
                    </div>
                `;
                
            case 'drill':
                return `
                    <div class="input-group">
                        <label>Peck Depth</label>
                        <div class="input-unit">
                            <input type="number" id="peck-depth-${operation.id}" 
                                   value="${settings.peckDepth}" min="0" step="0.1">
                            <span>mm</span>
                        </div>
                    </div>
                    <div class="input-group">
                        <label>Dwell Time</label>
                        <div class="input-unit">
                            <input type="number" id="dwell-time-${operation.id}" 
                                   value="${settings.dwellTime}" min="0" step="0.1">
                            <span>s</span>
                        </div>
                    </div>
                `;
                
            case 'cutout':
                return `
                    <div class="input-group">
                        <label>Tabs</label>
                        <input type="number" id="tabs-${operation.id}" 
                               value="${settings.tabs}" min="0" step="1">
                    </div>
                    <div class="input-group">
                        <label>Tab Width</label>
                        <div class="input-unit">
                            <input type="number" id="tab-width-${operation.id}" 
                                   value="${settings.tabWidth}" min="0" step="0.1">
                            <span>mm</span>
                        </div>
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
        
        // Remove from layers
        if (operation.layerName) {
            this.layers.delete(operation.layerName);
        }
        
        // Remove from operations
        this.operations.splice(operationIndex, 1);
        
        // Mark for reprocessing
        this.geometryProcessed = false;
        
        // Clear any messages for this operation type
        this.showOperationMessage(operation.type, null);
        
        // Re-render and update
        this.renderOperations(operation.type);
        this.updateSimpleStatistics();
        this.updateStatus();
        this.saveSettings();
    }
    
    closePreview() {
        document.getElementById('preview-modal').style.display = 'none';
    }
    
    hasValidOperations() {
        return this.operations.length > 0 && this.layers.size > 0;
    }
    
    zoomFit() { this.renderer?.zoomFit(); }
    zoomIn() { this.renderer?.zoomIn(); }
    zoomOut() { this.renderer?.zoomOut(); }
    
    // SVG export
    exportCleanSVG() {
        if (this.renderer && this.renderer.svgExporter) {
            this.renderer.svgExporter.download(`pcb-clean-${Date.now()}.svg`);
            this.updateStatus('SVG exported successfully', 'success');
        } else {
            console.error('SVG exporter not available');
            this.updateStatus('SVG export not available', 'error');
        }
    }
    
    getPolygonStats() {
        return {
            totalPolygons: this.stats.totalPolygons,
            layers: this.stats.layers,
            holes: this.stats.holes,
            operations: this.stats.operations
        };
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
function centerOrigin() { window.cam?.centerOrigin(); }
function bottomLeftOrigin() { window.cam?.bottomLeftOrigin(); }
function zoomFit() { window.cam?.zoomFit(); }
function zoomIn() { window.cam?.zoomIn(); }
function zoomOut() { window.cam?.zoomOut(); }