// Complete PCB CAM Controller - Fixed Geometry Pipeline
// cam.js

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
        this.fusedLayers = new Map();
        
        // Offset engine results storage
        this.offsetResults = new Map(); // operationId -> offset geometry
        
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
        
        console.log('PCB CAM Controller initialized - Fixed geometry pipeline');
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
            warnings: null,
            polygons: [],
            holes: [],
            expanded: true,
            layerName: null,
            processed: false,
            offsetGenerated: false
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
    
    // Parse files immediately with FIXED warning handling
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
            
            // Better error vs warning handling
            if (result.errors && result.errors.length > 0) {
                operation.error = result.errors.join('; ');
                console.error(`❌ Critical errors for ${operation.file.name}: ${result.errors.length} issues`);
                this.showOperationMessage(operation.type, `Parse errors: ${result.errors.length} critical issues`, 'error');
            }
            
            // Handle warnings separately and don't spam console
            if (result.warnings && result.warnings.length > 0) {
                operation.warnings = result.warnings;
                if (this.debugMode) {
                    console.log(`⚠️ Parse warnings for ${operation.file.name}: ${result.warnings.length} minor issues (debug mode)`);
                }
            }
            
            // Simple layer setup
            operation.layerName = `${operation.type}_${operation.id}`;
            this.layers.set(operation.layerName, operation.polygons);
            
            // Mark that we need to reprocess geometry
            this.geometryProcessed = false;
            
            this.updateSimpleStatistics();
            
            const itemCount = operation.type === 'drill' ? result.holes.length : result.polygons.length;
            const unitType = operation.type === 'drill' ? 'holes' : 'polygons';
            
            // Only show success if no critical errors
            if (!operation.error) {
                this.showOperationMessage(operation.type, `Successfully loaded ${itemCount} ${unitType}`, 'success');
                this.updateStatus(`Loaded ${operation.file.name}: ${itemCount} ${unitType}`, 'success');
            }

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
            console.log('✅ Fixed coordinate system initialized');
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
            
            // Boolean fusion where beneficial - CONSOLIDATE GEOMETRY BY OPERATION
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

            this.fusedLayers = processedLayers;
            
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
    
    // FIXED: Enhanced preview with proper coordinate system initialization
    async openPreview() {
        const modal = document.getElementById('preview-modal');
        if (!modal) return;
        
        // Add overflow hidden to body
        document.body.style.overflow = 'hidden';
        
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
        
        // Initialize coordinate system properly
        if (this.coordinateAnalysis && this.coordinateAnalysis.boardBounds) {
            // Set Gerber origin in renderer
            this.renderer.setGerberOrigin(0, 0); // Gerber coordinate system origin
            
            // Set initial working origin to Gerber origin (don't auto-move to board corner)
            this.renderer.setOriginPosition(0, 0);
            
            // Update coordinate system manager
            this.coordinateSystem.setGerberOrigin(0, 0);
            
            // Link renderer to coordinate system
            this.coordinateSystem.setRenderer(this.renderer);
            this.renderer.setCoordinateSystemManager(this.coordinateSystem);
        }
        
        this.updateRenderer();
        this.updatePreviewUI();
        
        // Force canvas resize and render
        setTimeout(() => {
            if (this.renderer) {
                this.renderer.resizeCanvas();
                this.renderer.zoomFit();
            }
        }, 100);
    }

    updateRenderer() {
        if (!this.renderer) {
            console.warn('Renderer not initialized yet.');
            return;
        }

        // FIXED: Create proper operation data structure for renderer
        const operations = [];
        
        // Process each operation and create renderer-compatible data
        this.operations.forEach(operation => {
            if (operation.type === 'drill' && operation.holes && operation.holes.length > 0) {
                operations.push({
                    type: 'drill',
                    polygons: [],
                    holes: operation.holes,
                    preservedFills: []
                });
            } else if (operation.polygons && operation.polygons.length > 0) {
                // Use fused polygons if available, otherwise original
                const layerName = operation.layerName;
                const polygons = this.fusedLayers.has(layerName) ? 
                    this.fusedLayers.get(layerName) : operation.polygons;
                
                operations.push({
                    type: operation.type,
                    polygons: polygons,
                    holes: [],
                    preservedFills: []
                });
            }
        });

        // Set operations in renderer
        this.renderer.setOperations(operations);
        
        // Update bounds in renderer
        if (this.coordinateAnalysis) {
            this.renderer.bounds = this.coordinateAnalysis.boardBounds;
        }
        
        // Add offset polygons if any
        this.offsetResults.forEach((offsetData, opId) => {
            if (offsetData && offsetData.passes) {
                const allOffsetPolygons = [];
                offsetData.passes.forEach(pass => {
                    if (pass.polygons) {
                        allOffsetPolygons.push(...pass.polygons);
                    }
                });
                if (allOffsetPolygons.length > 0) {
                    this.renderer.setOffsetPolygons(opId, allOffsetPolygons);
                }
            }
        });
    }

    centerOrigin() {
        if (this.coordinateSystem && this.coordinateAnalysis && this.coordinateAnalysis.boardBounds) {
            const bounds = this.coordinateAnalysis.boardBounds;
            const centerX = (bounds.minX + bounds.maxX) / 2;
            const centerY = (bounds.minY + bounds.maxY) / 2;
            
            this.coordinateSystem.setWorkingOrigin(centerX, centerY);
            if (this.renderer) {
                this.renderer.setOriginPosition(centerX, centerY);
            }
            this.updateStatus(`Origin set to board center`, 'info');
        }
    }

    bottomLeftOrigin() {
        if (this.coordinateSystem && this.coordinateAnalysis && this.coordinateAnalysis.boardBounds) {
            const bounds = this.coordinateAnalysis.boardBounds;
            this.coordinateSystem.setWorkingOrigin(bounds.minX, bounds.minY);
            if (this.renderer) {
                this.renderer.setOriginPosition(bounds.minX, bounds.minY);
            }
            this.updateStatus(`Origin set to board bottom-left`, 'info');
        }
    }

    setOrigin() {
        if (!this.coordinateSystem || !this.renderer) {
            console.error('Coordinate system or renderer not initialized.');
            return;
        }

        const xOffsetInput = document.getElementById('x-offset');
        const yOffsetInput = document.getElementById('y-offset');
        
        const xVal = parseFloat(xOffsetInput.value) || 0;
        const yVal = parseFloat(yOffsetInput.value) || 0;

        if (xVal === 0 && yVal === 0) {
            // Tare operation
            const result = this.coordinateSystem.tareToCurrentPosition();
            if (result.success) {
                this.updateStatus('Origin tared - coordinates reset to (0, 0)', 'success');
            }
        } else {
            // Apply manual offset
            const result = this.coordinateSystem.applyManualOffset(xVal, yVal);
            if (result.success) {
                this.updateStatus(`Origin offset by (${xVal.toFixed(2)}, ${yVal.toFixed(2)})`, 'info');
            }
        }
        
        // Reset input fields
        if (xOffsetInput) xOffsetInput.value = 0;
        if (yOffsetInput) yOffsetInput.value = 0;
    }

    resetOrigin() {
        if (this.coordinateSystem) {
            this.coordinateSystem.reset();
            this.updateStatus('Origin reset to default', 'info');
        }
    }
    
    // Setup origin controls
    setupOriginControls() {
        // Remove any existing event listeners to prevent duplicates
        this.removeOriginListeners();
        
        // Origin preset buttons
        const centerBtn = document.getElementById('center-origin-btn');
        const bottomLeftBtn = document.getElementById('bottom-left-origin-btn');
        const setBtn = document.getElementById('set-origin-btn');
        
        if (centerBtn) {
            this.centerOriginHandler = () => this.centerOrigin();
            centerBtn.addEventListener('click', this.centerOriginHandler);
        }
        
        if (bottomLeftBtn) {
            this.bottomLeftOriginHandler = () => this.bottomLeftOrigin();
            bottomLeftBtn.addEventListener('click', this.bottomLeftOriginHandler);
        }
        
        if (setBtn) {
            this.setOriginHandler = () => this.setOrigin();
            setBtn.addEventListener('click', this.setOriginHandler);
        }
    }
    
    // Update preview UI with enhanced coordinate system
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
        
        // Setup debug controls
        this.setupDebugControls();
    }
    
    // FIXED: Setup debug controls in preview modal
    setupDebugControls() {
        const debugControls = document.getElementById('debug-controls');
        if (!debugControls) return;
        
        // Show/hide filled polygons
        const showFilledCheckbox = document.getElementById('show-filled');
        if (showFilledCheckbox) {
            showFilledCheckbox.checked = this.renderer?.showFilled ?? true;
            showFilledCheckbox.addEventListener('change', (e) => {
                if (this.renderer) {
                    this.renderer.showFilled = e.target.checked;
                    this.renderer.render();
                }
            });
        }
        
        // Show/hide outlines
        const showOutlinesCheckbox = document.getElementById('show-outlines');
        if (showOutlinesCheckbox) {
            showOutlinesCheckbox.checked = this.renderer?.showOutlines ?? true;
            showOutlinesCheckbox.addEventListener('change', (e) => {
                if (this.renderer) {
                    this.renderer.showOutlines = e.target.checked;
                    this.renderer.render();
                }
            });
        }
        
        // Black and white mode
        const blackWhiteCheckbox = document.getElementById('black-white');
        if (blackWhiteCheckbox) {
            blackWhiteCheckbox.checked = this.renderer?.blackAndWhite ?? false;
            blackWhiteCheckbox.addEventListener('change', (e) => {
                if (this.renderer) {
                    this.renderer.blackAndWhite = e.target.checked;
                    this.renderer.render();
                }
            });
        }
        
        // Show/hide grid
        const showGridCheckbox = document.getElementById('show-grid');
        if (showGridCheckbox) {
            showGridCheckbox.checked = this.renderer?.showGrid ?? true;
            showGridCheckbox.addEventListener('change', (e) => {
                if (this.renderer) {
                    this.renderer.showGrid = e.target.checked;
                    this.renderer.render();
                }
            });
        }
        
        // Show/hide rulers
        const showRulersCheckbox = document.getElementById('show-rulers');
        if (showRulersCheckbox) {
            showRulersCheckbox.checked = this.renderer?.showRulers ?? true;
            showRulersCheckbox.addEventListener('change', (e) => {
                if (this.renderer) {
                    this.renderer.showRulers = e.target.checked;
                    this.renderer.render();
                }
            });
        }
        
        // Export SVG button
        const exportSvgBtn = document.getElementById('export-svg-btn');
        if (exportSvgBtn) {
            exportSvgBtn.addEventListener('click', () => {
                if (this.renderer && this.renderer.svgExporter) {
                    const renderState = this.renderer.getRenderState();
                    this.renderer.svgExporter.exportCanvasState(renderState);
                }
            });
        }
    }
    
    // Generate offset geometry for specific operation
    async generateOffsetGeometry(operationId) {
        const operation = this.operations.find(op => op.id === operationId);
        if (!operation) {
            console.error(`Operation ${operationId} not found`);
            return null;
        }
        
        // Only generate offsets for operations that need them
        if (operation.type !== 'isolation' && operation.type !== 'clear' && operation.type !== 'cutout') {
            console.log(`Operation ${operation.type} doesn't require offset generation`);
            return null;
        }
        
        // Check if we have valid polygons to work with
        if (!operation.polygons || operation.polygons.length === 0) {
            console.warn(`No polygons available for offset generation in operation ${operationId}`);
            this.updateStatus(`No geometry loaded for ${operation.file.name}`, 'warning');
            return null;
        }
        
        this.initializeProcessingEngines();
        
        try {
            this.updateStatus(`Generating ${operation.type} toolpaths for ${operation.file.name}...`, 'info');
            console.log(`🎯 Starting offset generation for ${operation.type} operation ${operationId}`);
            
            let result;
            
            // Generate offsets based on operation type
            switch (operation.type) {
                case 'isolation':
                    result = this.offsetEngine.generateIsolationToolpaths(
                        operation.polygons,
                        operation.settings
                    );
                    break;
                    
                case 'clear':
                    result = this.offsetEngine.generateClearingToolpaths(
                        operation.polygons,
                        operation.settings
                    );
                    break;
                    
                case 'cutout':
                    result = this.offsetEngine.generateCutoutToolpaths(
                        operation.polygons,
                        operation.settings
                    );
                    break;
            }
            
            if (result && result.success) {
                this.offsetResults.set(operationId, result);
                operation.offsetGenerated = true;
                
                console.log(`✅ Offset generation success for ${operation.type}:`, result);
                
                // Update renderer with offset geometry
                if (this.renderer) {
                    const allOffsetPolygons = [];
                    if (result.passes) {
                        result.passes.forEach(pass => {
                            if (pass.polygons) {
                                allOffsetPolygons.push(...pass.polygons);
                            }
                        });
                    }
                    
                    if (allOffsetPolygons.length > 0) {
                        this.renderer.setOffsetPolygons(operationId, allOffsetPolygons);
                        console.log(`🎯 Updated renderer with ${allOffsetPolygons.length} offset polygons`);
                    }
                }
                
                const pathCount = result.passes?.length || result.toolpaths?.length || 0;
                this.updateStatus(`Generated ${operation.type} toolpaths: ${pathCount} paths`, 'success');
                
                // Update the operation card to show new status
                this.renderOperations(operation.type);
                
                return result;
            } else {
                const error = result?.error || 'Unknown offset generation error';
                this.updateStatus(`Offset generation failed: ${error}`, 'error');
                console.error(`❌ Offset generation failed for ${operation.type}:`, error);
                return null;
            }
            
        } catch (error) {
            console.error(`Offset generation error for ${operation.type}:`, error);
            this.updateStatus(`Offset generation failed: ${error.message}`, 'error');
            return null;
        }
    }
    
    // Generate G-code (stub for future implementation)
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
        
        // Generate offsets for all operations that need them
        let offsetsGenerated = 0;
        for (const operation of this.operations) {
            if (['isolation', 'clear', 'cutout'].includes(operation.type) && !operation.offsetGenerated) {
                const result = await this.generateOffsetGeometry(operation.id);
                if (result) offsetsGenerated++;
            }
        }
        
        if (offsetsGenerated > 0) {
            this.updateStatus(`Generated ${offsetsGenerated} toolpath operations. G-code generation in development.`, 'info');
        } else {
            this.updateStatus('All operations processed. G-code generation in development.', 'info');
        }
        
        console.log('G-code generation would use:', {
            operations: this.operations,
            processedGeometry: this.processedGeometry,
            coordinateAnalysis: this.coordinateAnalysis,
            offsetResults: this.offsetResults
        });
    }
    
    // Standard UI methods
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
                this.renderer.setTheme(newTheme);
            }
        });

        // File input change handler
        document.getElementById('file-input-temp')?.addEventListener('change', (e) => this.handleFileSelect(e));
        
        // Main action buttons
        document.getElementById('preview-btn')?.addEventListener('click', () => this.openPreview());
        document.getElementById('export-gcode-btn')?.addEventListener('click', () => this.exportGcode());
        
        // Modal and preview controls
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
        } else if (operation.offsetGenerated) {
            statusIcon = '🎯'; // Offset generated
        } else if (operation.parsed) {
            statusIcon = '✅';
        }
        
        card.innerHTML = `
            <div class="operation-header">
                <span class="operation-icon">${config.icon}</span>
                <span class="operation-name">${operation.file.name}</span>
                <span class="operation-status">${statusIcon}</span>
                ${this.createOffsetButton(operation)}
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
        
        // Add offset button listener if it exists
        const offsetBtn = card.querySelector('.btn-offset');
        if (offsetBtn) {
            offsetBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log(`🎯 Offset button clicked for operation ${operation.id}`);
                this.generateOffsetGeometry(operation.id);
            });
        }
        
        return card;
    }
    
    // Create offset generation button for applicable operations
    createOffsetButton(operation) {
        if (!['isolation', 'clear', 'cutout'].includes(operation.type) || !operation.parsed) {
            return '';
        }
        
        const label = operation.offsetGenerated ? 'Regenerate' : 'Generate';
        const icon = operation.offsetGenerated ? '🔄' : '🎯';
        
        return `<button class="btn-offset" data-operation-id="${operation.id}" 
                        title="Generate toolpath offsets" 
                        style="background: var(--isolation-accent); color: white; border: none; padding: 0.25rem 0.5rem; border-radius: 3px; font-size: 0.75rem; cursor: pointer; margin-right: 0.5rem;">
                    ${icon} ${label}
                </button>`;
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
                        <label>Direction</label>
                        <select id="direction-${operation.id}">
                            <option value="outside" ${settings.direction === 'outside' ? 'selected' : ''}>Outside</option>
                            <option value="inside" ${settings.direction === 'inside' ? 'selected' : ''}>Inside</option>
                            <option value="both" ${settings.direction === 'both' ? 'selected' : ''}>Both</option>
                        </select>
                        <small class="input-hint">Outside routes around copper (standard)</small>
                    </div>
                    <div class="input-group">
                        <label>Passes</label>
                        <input type="number" id="passes-${operation.id}" 
                               value="${settings.passes}" min="1" max="5" step="1">
                        <small class="input-hint">Number of concentric isolation passes</small>
                    </div>
                    <div class="input-group">
                        <label>Overlap %</label>
                        <input type="number" id="overlap-${operation.id}" 
                               value="${settings.overlap}" min="10" max="90" step="1">
                        <small class="input-hint">Overlap between passes</small>
                    </div>
                    <div class="input-group">
                        <label>
                            <input type="checkbox" id="corner-handling-${operation.id}" 
                                   ${settings.cornerHandling ? 'checked' : ''}> 
                            Corner Handling
                        </label>
                        <small class="input-hint">Smooth sharp corners for better tool access</small>
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
                        <small class="input-hint">Clearing pattern for material removal</small>
                    </div>
                    <div class="input-group">
                        <label>Overlap %</label>
                        <input type="number" id="overlap-${operation.id}" 
                               value="${settings.overlap}" min="10" max="90" step="1">
                        <small class="input-hint">Tool overlap for complete material removal</small>
                    </div>
                    <div class="input-group">
                        <label>Angle</label>
                        <div class="input-unit">
                            <input type="number" id="angle-${operation.id}" 
                                   value="${settings.angle || 0}" min="0" max="180" step="15">
                            <span>°</span>
                        </div>
                        <small class="input-hint">Cutting pattern angle</small>
                    </div>
                    <div class="input-group">
                        <label>Step Down</label>
                        <div class="input-unit">
                            <input type="number" id="step-down-${operation.id}" 
                                   value="${settings.stepDown || 0.1}" min="0.01" step="0.01">
                            <span>mm</span>
                        </div>
                        <small class="input-hint">Maximum depth per pass</small>
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
                        <small class="input-hint">Depth per peck (0 = no pecking)</small>
                    </div>
                    <div class="input-group">
                        <label>Dwell Time</label>
                        <div class="input-unit">
                            <input type="number" id="dwell-time-${operation.id}" 
                                   value="${settings.dwellTime}" min="0" step="0.1">
                            <span>s</span>
                        </div>
                        <small class="input-hint">Pause at bottom of hole</small>
                    </div>
                    <div class="input-group">
                        <label>Retract Height</label>
                        <div class="input-unit">
                            <input type="number" id="retract-height-${operation.id}" 
                                   value="${settings.retractHeight}" min="0.1" step="0.1">
                            <span>mm</span>
                        </div>
                        <small class="input-hint">Height to retract between holes</small>
                    </div>
                    <div class="input-group">
                        <label>Spindle Speed</label>
                        <div class="input-unit">
                            <input type="number" id="spindle-speed-${operation.id}" 
                                   value="${settings.spindleSpeed || 10000}" min="1000" step="500">
                            <span>RPM</span>
                        </div>
                        <small class="input-hint">Spindle speed for drilling</small>
                    </div>
                `;
                
            case 'cutout':
                return `
                    <div class="input-group">
                        <label>Tabs</label>
                        <input type="number" id="tabs-${operation.id}" 
                               value="${settings.tabs}" min="0" max="8" step="1">
                        <small class="input-hint">Number of holding tabs (0 = no tabs)</small>
                    </div>
                    <div class="input-group">
                        <label>Tab Width</label>
                        <div class="input-unit">
                            <input type="number" id="tab-width-${operation.id}" 
                                   value="${settings.tabWidth}" min="0.5" step="0.1">
                            <span>mm</span>
                        </div>
                        <small class="input-hint">Width of each holding tab</small>
                    </div>
                    <div class="input-group">
                        <label>Tab Height</label>
                        <div class="input-unit">
                            <input type="number" id="tab-height-${operation.id}" 
                                   value="${settings.tabHeight}" min="0.1" step="0.1">
                            <span>mm</span>
                        </div>
                        <small class="input-hint">Height of material left in tabs</small>
                    </div>
                    <div class="input-group">
                        <label>Step Down</label>
                        <div class="input-unit">
                            <input type="number" id="step-down-${operation.id}" 
                                   value="${settings.stepDown || 0.2}" min="0.01" step="0.01">
                            <span>mm</span>
                        </div>
                        <small class="input-hint">Maximum depth per pass</small>
                    </div>
                    <div class="input-group">
                        <label>Lead In/Out</label>
                        <div class="input-unit">
                            <input type="number" id="lead-in-${operation.id}" 
                                   value="${settings.leadIn || 0.5}" min="0" step="0.1">
                            <span>mm</span>
                        </div>
                        <small class="input-hint">Distance for gradual entry/exit</small>
                    </div>
                    <div class="input-group">
                        <label>Direction</label>
                        <select id="direction-${operation.id}">
                            <option value="conventional" ${settings.direction === 'conventional' ? 'selected' : ''}>Conventional</option>
                            <option value="climb" ${settings.direction === 'climb' ? 'selected' : ''}>Climb</option>
                        </select>
                        <small class="input-hint">Cutting direction (conventional is safer)</small>
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
        
        // Remove from layers and offset results
        if (operation.layerName) {
            this.layers.delete(operation.layerName);
            this.fusedLayers.delete(operation.layerName);
        }
        this.offsetResults.delete(operationId);
        
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
        
        // Update renderer if preview is open
        if (this.renderer) {
            this.updateRenderer();
        }
    }
    
    // Clean up origin listeners
    removeOriginListeners() {
        const centerBtn = document.getElementById('center-origin-btn');
        const bottomLeftBtn = document.getElementById('bottom-left-origin-btn');
        const setBtn = document.getElementById('set-origin-btn');
        
        if (centerBtn && this.centerOriginHandler) {
            centerBtn.removeEventListener('click', this.centerOriginHandler);
        }
        if (bottomLeftBtn && this.bottomLeftOriginHandler) {
            bottomLeftBtn.removeEventListener('click', this.bottomLeftOriginHandler);
        }
        if (setBtn && this.setOriginHandler) {
            setBtn.removeEventListener('click', this.setOriginHandler);
        }
    }
    
    closePreview() {
        document.getElementById('preview-modal').style.display = 'none';
        
        // Restore body overflow
        document.body.style.overflow = '';
        
        // Clean up origin listeners when closing preview
        this.removeOriginListeners();
    }
    
    hasValidOperations() {
        return this.operations.length > 0 && this.layers.size > 0;
    }
    
    zoomFit() { this.renderer?.zoomFit(); }
    zoomIn() { this.renderer?.zoomIn(); }
    zoomOut() { this.renderer?.zoomOut(); }
    
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