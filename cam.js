// Enhanced PCB CAM with File-Based Operations Architecture

class PolygonPCBCam {
    constructor() {
        // NEW: Operations-based architecture - each file is one operation
        this.operations = [];
        this.nextOperationId = 1;
        
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
        
        this.layers = new Map();
        this.fusedLayers = new Map();
        
        this.settings = this.loadSettings();
        this.debugMode = true;
        
        // Initialize engines
        this.fusionEngine = new PolygonFusionEngine({
            debug: this.debugMode,
            scaleFactor: 1000000,
            simplifyTolerance: 0.001,
            enableSimplification: true
        });
        
        this.offsetEngine = new PolygonOffsetEngine({
            debug: this.debugMode,
            scaleFactor: 1000000,
            simplifyTolerance: 0.001
        });
        
        this.stats = {
            totalPolygons: 0,
            fusedPolygons: 0,
            operations: 0,
            layers: 0,
            holes: 0
        };
        
        this.initializeUI();
        this.setupEventListeners();
        
        console.log('PolygonPCBCam initialized with file-based operations architecture');
        console.log('Clipper.js available:', this.fusionEngine.isClipperAvailable());
    }
    
    loadSettings() {
        const defaults = {
            pcb: { thickness: 1.6 },
            machine: { safeZ: 2, travelZ: 1, rapidFeed: 1000, workCoordinateSystem: 'G54' },
            gcode: { postProcessor: 'grbl', startCode: 'G90 G21 G17\nM3 S1000\nG4 P1', endCode: 'M5\nG0 Z10\nM2', units: 'mm' },
            fusion: { enableFusion: true, simplifyTolerance: 0.001, enableSimplification: true },
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
    
    // Get default settings for a specific operation type
    getDefaultOperationSettings(operationType) {
        const baseDefaults = {
            tool: { diameter: 0.1, type: 'end_mill', material: 'carbide' },
            cutting: { cutDepth: 0.1, passDepth: 0.05, cutFeed: 100, plungeFeed: 50 },
            operation: {}
        };
        
        switch (operationType) {
            case 'isolation':
                baseDefaults.tool.diameter = 0.1;
                baseDefaults.cutting.cutFeed = 100;
                baseDefaults.operation = { passes: 2, overlap: 50, strategy: 'offset' };
                break;
            case 'clear':
                baseDefaults.tool.diameter = 0.8;
                baseDefaults.cutting.cutFeed = 200;
                baseDefaults.operation = { overlap: 50, pattern: 'parallel', angle: 0, margin: 0.1 };
                break;
            case 'drill':
                baseDefaults.tool.diameter = 1.0;
                baseDefaults.tool.type = 'drill';
                baseDefaults.cutting.cutFeed = 50;
                baseDefaults.operation = { peckDepth: 0, dwellTime: 0.1, retractHeight: 1 };
                break;
            case 'cutout':
                baseDefaults.tool.diameter = 1.0;
                baseDefaults.cutting.cutFeed = 150;
                baseDefaults.operation = { tabs: 4, tabWidth: 3, tabHeight: 0.5, direction: 'conventional' };
                break;
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
            layerName: null
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
            // Also save operations for persistence
            const operationsData = this.operations.map(op => ({
                id: op.id,
                type: op.type,
                fileName: op.file.name,
                settings: op.settings,
                expanded: op.expanded
            }));
            localStorage.setItem('pcbcam-operations', JSON.stringify(operationsData));
        } catch (error) {
            console.warn('Error saving settings:', error);
        }
    }

    initializeUI() {
        // Set dark theme as default
        const savedTheme = localStorage.getItem('theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
        
        this.updateUIFromSettings();
        this.renderAllOperations();
        this.addFusionControls();
        this.updateStatus();
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
    
    addFusionControls() {
        const pcbSection = document.querySelector('section h2');
        if (pcbSection && pcbSection.textContent.includes('PCB')) {
            const fusionSection = document.createElement('section');
            fusionSection.className = 'section';
            fusionSection.innerHTML = `
                <h2>Polygon Fusion</h2>
                <div class="fusion-config">
                    <div class="input-group">
                        <label>
                            <input type="checkbox" id="enable-fusion" ${this.settings.fusion.enableFusion ? 'checked' : ''}>
                            Enable Polygon Fusion
                        </label>
                        <small class="input-hint">Merge overlapping copper regions using boolean operations</small>
                    </div>
                    <div class="input-group">
                        <label>
                            <input type="checkbox" id="enable-simplification" ${this.settings.fusion.enableSimplification ? 'checked' : ''}>
                            Simplify Geometry
                        </label>
                        <small class="input-hint">Remove unnecessary polygon points</small>
                    </div>
                    <div class="input-group">
                        <label class="tooltip" data-tooltip="Tolerance for polygon simplification (smaller = more detail)">Simplify Tolerance</label>
                        <div class="input-unit">
                            <input type="number" id="simplify-tolerance" value="${this.settings.fusion.simplifyTolerance}" min="0.0001" step="0.0001">
                            <span>mm</span>
                        </div>
                    </div>
                </div>
                <div class="fusion-stats" id="fusion-stats" style="display: none;">
                    <h3>Fusion Statistics</h3>
                    <div class="stat-grid">
                        <div class="stat-item">
                            <span class="stat-label">Original:</span>
                            <span class="stat-value" id="original-polygons">0</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Fused:</span>
                            <span class="stat-value" id="fused-polygons">0</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Layers:</span>
                            <span class="stat-value" id="layer-count">0</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Clipper:</span>
                            <span class="stat-value" id="clipper-status">${this.fusionEngine.isClipperAvailable() ? 'OK' : 'Missing'}</span>
                        </div>
                    </div>
                </div>
            `;
            
            const parent = pcbSection.parentElement.parentElement;
            parent.insertBefore(fusionSection, parent.children[parent.children.length - 1]);
            
            this.setupFusionControlHandlers();
        }
    }
    
    setupFusionControlHandlers() {
        const fusionControls = ['enable-fusion', 'enable-simplification', 'simplify-tolerance'];
        
        fusionControls.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => {
                    this.updateFusionSettings();
                    this.triggerGeometryFusion();
                });
            }
        });
    }
    
    updateFusionSettings() {
        this.settings.fusion.enableFusion = document.getElementById('enable-fusion')?.checked || false;
        this.settings.fusion.enableSimplification = document.getElementById('enable-simplification')?.checked || false;
        this.settings.fusion.simplifyTolerance = parseFloat(document.getElementById('simplify-tolerance')?.value || 0.001);
        
        this.fusionEngine.configure({
            enableSimplification: this.settings.fusion.enableSimplification,
            simplifyTolerance: this.settings.fusion.simplifyTolerance,
            debug: this.debugMode
        });
        
        this.saveSettings();
    }
    
    triggerGeometryFusion() {
        if (this.settings.fusion.enableFusion) {
            this.fuseAllLayers();
        } else {
            this.fusedLayers.clear();
            for (const [layerName, polygons] of this.layers.entries()) {
                this.fusedLayers.set(layerName, [...polygons]);
            }
        }
        
        this.updateRenderer();
        this.updateFusionStatsUI();
        this.updateStatus();
    }
    
    fuseAllLayers() {
        console.log('🔧 Fusing polygons across all layers...');
        
        this.fusedLayers.clear();
        let totalOriginal = 0;
        let totalFused = 0;
        
        for (const [layerName, polygons] of this.layers.entries()) {
            if (polygons.length > 0) {
                totalOriginal += polygons.length;
                
                const fusedPolygons = this.fusionEngine.fusePolygons(polygons, 'union');
                this.fusedLayers.set(layerName, fusedPolygons);
                
                totalFused += fusedPolygons.length;
                
                if (polygons.length !== fusedPolygons.length) {
                    console.log(`Layer ${layerName}: ${polygons.length} → ${fusedPolygons.length} polygons`);
                }
            }
        }
        
        this.stats.totalPolygons = totalOriginal;
        this.stats.fusedPolygons = totalFused;
        this.stats.layers = this.fusedLayers.size;
        
        if (totalOriginal !== totalFused) {
            console.log(`✅ Fusion complete: ${totalOriginal} → ${totalFused} polygons across ${this.fusedLayers.size} layers`);
        }
    }
    
    updateFusionStatsUI() {
        const statsElement = document.getElementById('fusion-stats');
        if (!statsElement) return;
        
        if (this.stats.totalPolygons > 0) {
            statsElement.style.display = 'block';
            document.getElementById('original-polygons').textContent = this.stats.totalPolygons;
            document.getElementById('fused-polygons').textContent = this.stats.fusedPolygons;
            document.getElementById('layer-count').textContent = this.stats.layers;
            document.getElementById('clipper-status').textContent = this.fusionEngine.isClipperAvailable() ? 'OK' : 'Missing';
        } else {
            statsElement.style.display = 'none';
        }
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
        document.getElementById('center-origin-btn')?.addEventListener('click', () => this.centerOrigin());
        document.getElementById('bottom-left-origin-btn')?.addEventListener('click', () => this.bottomLeftOrigin());
        document.getElementById('export-clean-svg-btn')?.addEventListener('click', () => this.exportCleanSVG());
        document.getElementById('export-debug-svg-btn')?.addEventListener('click', () => this.exportDebugSVG());
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
        document.getElementById('preview-btn').disabled = !hasValidOperations;

        if (message) {
            statusText.textContent = message;
        } else {
            statusText.textContent = hasValidOperations ? 
                `Ready: ${this.operations.length} operations, ${this.stats.layers} layers, ${this.stats.totalPolygons} polygons.` : 
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
    
    async parseOperationAsync(operation) {
        try {
            let parser;
            let result;
            
            if (operation.type === 'drill') {
                parser = new ExcellonPolygonParser({ debug: this.debugMode });
                result = parser.parse(operation.file.content);
                
                operation.parsed = result;
                operation.holes = result.holes;
                operation.polygons = [];
                
                operation.layerName = `drill_${operation.id}`;
                this.layers.set(operation.layerName, result.polygons);
                
                this.stats.holes += result.holes.length;
                
                console.log(`✅ ${operation.file.name}: ${result.holes.length} holes`);
                
            } else {
                parser = new GerberPolygonParser({ debug: this.debugMode });
                result = parser.parse(operation.file.content);
                
                operation.parsed = result;
                operation.polygons = result.polygons;
                
                operation.layerName = `${operation.type}_${operation.id}`;
                this.layers.set(operation.layerName, result.polygons);
                
                console.log(`✅ ${operation.file.name}: ${result.polygons.length} polygons`);
            }
            
            if (result.errors && result.errors.length > 0) {
                operation.warnings = result.errors;
                console.warn(`⚠️ Parse warnings for ${operation.file.name}: ${result.errors.length} issues`);
                if (result.errors.length > 10) {
                    this.showOperationMessage(operation.type, `Warning: ${result.errors.length} parsing issues in ${operation.file.name}`, 'warning');
                }
            }
            
            this.updateStatistics();
            this.triggerGeometryFusion();
            
            const polygonCount = operation.type === 'drill' ? result.holes.length : result.polygons.length;
            const unitType = operation.type === 'drill' ? 'holes' : 'polygons';
            
            this.showOperationMessage(operation.type, `Successfully loaded ${polygonCount} ${unitType}`, 'success');
            this.updateStatus(`Parsed ${operation.file.name}: ${polygonCount} ${unitType}`, 'success');

        } catch (error) {
            operation.error = error.message;
            console.error(`Error parsing ${operation.file.name}:`, error);
            this.showOperationMessage(operation.type, `Error parsing ${operation.file.name}: ${error.message}`, 'error');
            this.updateStatus(`Error parsing ${operation.file.name}: ${error.message}`, 'error');
        }
        
        this.renderOperations(operation.type);
        
        if (!operation.error) {
            setTimeout(() => {
                this.updateStatus();
            }, 3000);
        }
    }
    
    updateStatistics() {
        this.stats.operations = this.operations.length;
        this.stats.layers = this.layers.size;
        this.stats.totalPolygons = Array.from(this.layers.values()).reduce((sum, polygons) => sum + polygons.length, 0);
    }
    
    renderAllOperations() {
        ['isolation', 'clear', 'drill', 'cutout'].forEach(type => this.renderOperations(type));
    }
    
    renderOperations(type) {
        const container = document.getElementById(`${type}-operations`);
        if (!container) return;
        
        // Clear existing content except upload area
        const uploadArea = container.querySelector('.upload-area');
        container.innerHTML = '';
        
        // Render operations of this type
        const typeOperations = this.operations.filter(op => op.type === type);
        
        typeOperations.forEach(operation => {
            const operationCard = this.createOperationCard(operation);
            container.appendChild(operationCard);
        });
        
        // Always add upload area at the bottom
        if (uploadArea) {
            container.appendChild(uploadArea);
        } else {
            this.createUploadArea(type, container);
        }
    }
    
    createOperationCard(operation) {
        const card = document.createElement('div');
        card.className = 'operation-card';
        card.setAttribute('data-operation-id', operation.id);
        
        const config = this.fileTypes[operation.type];
        const statusIcon = operation.error ? '❌' : (operation.parsed ? '✅' : '⏳');
        
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
    
    createUploadArea(type, container) {
        const config = this.fileTypes[type];
        const uploadArea = document.createElement('div');
        uploadArea.className = 'upload-area';
        uploadArea.setAttribute('data-operation-type', type);
        
        uploadArea.innerHTML = `
            <div class="upload-content">
                <span class="upload-icon">${config.icon}</span>
                <div class="upload-text">Add ${type} file</div>
                <div class="upload-hint">${config.description}</div>
            </div>
        `;
        
        uploadArea.addEventListener('click', () => {
            this.triggerFileInput(type);
        });
        
        container.appendChild(uploadArea);
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
            this.fusedLayers.delete(operation.layerName);
        }
        
        // Remove from operations
        this.operations.splice(operationIndex, 1);
        
        // Clear any messages for this operation type
        this.showOperationMessage(operation.type, null);
        
        // Re-render and update
        this.renderOperations(operation.type);
        this.updateStatistics();
        this.triggerGeometryFusion();
        this.updateStatus();
        this.saveSettings();
    }
    
    openPreview() {
        const modal = document.getElementById('preview-modal');
        if (!modal) return;
        modal.style.display = 'flex';
        
        if (!this.renderer) {
            this.renderer = new PreviewRenderer('preview-canvas');
            if (this.debugMode && typeof SVGDebugExporter !== 'undefined') {
                this.renderer.svgExporter = new SVGDebugExporter(this.renderer);
            }
        }

        this.renderer.setDebugMode(this.debugMode);
        this.updateRenderer();
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
        
        const layersToUse = this.fusedLayers.size > 0 ? this.fusedLayers : this.layers;
        
        // Map operations to render data
        this.operations.forEach(operation => {
            if (operation.layerName && layersToUse.has(operation.layerName)) {
                const polygons = layersToUse.get(operation.layerName);
                
                const virtualFile = {
                    name: operation.file.name,
                    polygons: polygons,
                    parsed: {
                        polygons: polygons,
                        bounds: PolygonUtils.calculateBounds(polygons)
                    },
                    error: operation.error
                };
                
                renderData[operation.type].push(virtualFile);
            }
        });
        
        return renderData;
    }
    
    closePreview() {
        document.getElementById('preview-modal').style.display = 'none';
    }
    
    exportGcode() {
        if (this.operations.length === 0) {
            this.updateStatus('No operations loaded for G-code export.', 'warning');
            return;
        }
        
        this.updateStatus('G-code export not implemented yet. Coming soon!', 'warning');
        console.log("Operations ready for G-code export:", this.operations);
    }
    
    hasValidOperations() {
        return this.operations.length > 0 && this.layers.size > 0;
    }
    
    // Coordinate system methods
    centerOrigin() { this.renderer?.updateOffset(0, 0); }
    bottomLeftOrigin() { 
        if (this.renderer?.bounds) {
            this.renderer.updateOffset(-this.renderer.bounds.minX, -this.renderer.bounds.minY);
        }
    }
    
    zoomFit() { this.renderer?.zoomFit(); }
    zoomIn() { this.renderer?.zoomIn(); }
    zoomOut() { this.renderer?.zoomOut(); }
    
    // Debug and export methods
    exportCleanSVG() {
        if (this.renderer && this.renderer.svgExporter) {
            this.renderer.svgExporter.download(`pcb-clean-${Date.now()}.svg`);
        } else {
            console.error('SVG exporter not available');
        }
    }
    
    exportDebugSVG() {
        if (this.renderer && this.renderer.svgExporter) {
            this.renderer.svgExporter.download(`pcb-debug-${Date.now()}.svg`);
        } else {
            console.error('SVG exporter not available');
        }
    }
    
    getPolygonStats() {
        return {
            totalPolygons: this.stats.totalPolygons,
            unifiedPolygons: this.stats.fusedPolygons,
            layers: this.stats.layers,
            holes: this.stats.holes,
            operations: this.stats.operations
        };
    }
}

// Global function exposure for backwards compatibility
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