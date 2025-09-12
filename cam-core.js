// cam-core.js
// Core PCB CAM application logic with Clipper2 integration

(function() {
    'use strict';
   
    // Get config reference
    const config = window.PCBCAMConfig || {};
    const geomConfig = config.geometry || {};
    const machineConfig = config.machine || {};
    const gcodeConfig = config.gcode || {};
    const opsConfig = config.operations || {};
    const uiConfig = config.ui || {};
    const debugConfig = config.debug || {};
    const perfConfig = config.performance || {};
   
    class PCBCamCore {
        constructor(options = {}) {
            // Core data
            this.operations = [];
            this.nextOperationId = 1;
           
            // Add initialization control
            this.skipInit = options.skipInit || false;
            this.isInitializing = false;
            this.isInitialized = false;
           
            // File type definitions from config
            this.fileTypes = {};
            Object.keys(opsConfig).forEach(type => {
                const op = opsConfig[type];
                this.fileTypes[type] = {
                    extensions: op.extensions,
                    description: `Files for ${type} operation`,
                    icon: op.icon,
                    color: op.color
                };
            });
           
            // Settings
            this.settings = this.loadSettings();
           
            // Statistics
            this.stats = {
                totalPrimitives: 0,
                operations: 0,
                layers: 0,
                holes: 0,
                holesDetected: 0,
                analyticPrimitives: 0,
                polygonizedPrimitives: 0,
                strokesConverted: 0
            };
           
            // Coordinate system (will be set by UI)
            this.coordinateSystem = null;
           
            // Async initialization flag
            this.processorInitialized = false;
            this.initializationPromise = null;
           
            // Only initialize if not skipped
            if (!this.skipInit) {
                this.initializeProcessors();
            }
        }
       
        async initializeProcessors() {
            // Prevent double initialization
            if (this.isInitializing || this.isInitialized) {
                if (debugConfig.enabled) {
                    console.log('Processors already initializing or initialized, skipping...');
                }
                return this.initializationPromise || true;
            }
           
            this.isInitializing = true;
            if (debugConfig.enabled) {
                console.log('Initializing processors with Clipper2...');
            }
           
            // Check for required classes
            const requiredClasses = [
                'GerberParser',
                'ExcellonParser',
                'ParserPlotter',
                'GeometryProcessor'
            ];
           
            // Also check for base class
            if (typeof ParserCore === 'undefined') {
                console.error('❌ ParserCore base class not available');
                this.isInitializing = false;
                return false;
            }
           
            let allAvailable = true;
            requiredClasses.forEach(className => {
                if (typeof window[className] !== 'undefined') {
                    if (debugConfig.enabled) {
                        console.log(`✅ ${className} available`);
                    }
                } else {
                    console.error(`❌ ${className} not available`);
                    allAvailable = false;
                }
            });
           
            if (!allAvailable) {
                console.error('Required classes not available');
                this.isInitializing = false;
                return false;
            }
           
            // Initialize GeometryProcessor with Clipper2 using config
            if (typeof GeometryProcessor !== 'undefined') {
                this.geometryProcessor = new GeometryProcessor({
                    debug: debugConfig.enabled,
                    scale: geomConfig.clipperScale || 10000,
                    preserveOriginals: true
                });
               
                // Wait for Clipper2 WASM to initialize
                this.initializationPromise = this.geometryProcessor.initPromise;
               
                try {
                    await this.initializationPromise;
                    this.processorInitialized = true;
                    this.isInitialized = true;
                    if (debugConfig.enabled) {
                        console.log('✅ Clipper2 GeometryProcessor initialized');
                    }
                    return true;
                } catch (error) {
                    console.error('❌ Failed to initialize Clipper2:', error);
                    this.processorInitialized = false;
                    return false;
                } finally {
                    this.isInitializing = false;
                }
            } else {
                console.error('❌ GeometryProcessor not available');
                this.isInitializing = false;
                return false;
            }
        }
       
        // Get cached states from geometry processor
        getPreprocessedPrimitives() {
            if (this.geometryProcessor) {
                return this.geometryProcessor.getCachedState('preprocessedGeometry');
            }
            return null;
        }
       
        getFusedPrimitives() {
            if (this.geometryProcessor) {
                return this.geometryProcessor.getCachedState('fusedGeometry');
            }
            return null;
        }
       
        // Ensure processor is ready before geometry operations
        async ensureProcessorReady() {
            if (!this.processorInitialized && this.initializationPromise) {
                if (debugConfig.logging?.wasmOperations) {
                    console.log('Waiting for Clipper2 initialization...');
                }
                await this.initializationPromise;
            }
           
            if (!this.processorInitialized) {
                throw new Error('Geometry processor not initialized');
            }
        }
       
        loadSettings() {
            const defaults = {
                pcb: { ...machineConfig.pcb },
                machine: {
                    safeZ: machineConfig.heights.safeZ,
                    travelZ: machineConfig.heights.travelZ,
                    rapidFeed: machineConfig.speeds.rapidFeed,
                    workCoordinateSystem: machineConfig.workspace.system,
                    maxX: machineConfig.workspace.maxX,
                    maxY: machineConfig.workspace.maxY
                },
                gcode: {
                    postProcessor: gcodeConfig.postProcessor,
                    startCode: config.getGcodeTemplate ?
                        config.getGcodeTemplate(gcodeConfig.postProcessor, 'start') :
                        gcodeConfig.templates.grbl.start,
                    endCode: config.getGcodeTemplate ?
                        config.getGcodeTemplate(gcodeConfig.postProcessor, 'end') :
                        gcodeConfig.templates.grbl.end,
                    units: gcodeConfig.units
                },
                ui: {
                    theme: uiConfig.theme,
                    showTooltips: uiConfig.showTooltips
                },
                geometry: {
                    preserveArcs: geomConfig.preserveArcs,
                    adaptiveSegmentation: geomConfig.adaptiveSegmentation,
                    targetSegmentLength: geomConfig.segments.targetLength
                }
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
            const operation = opsConfig[operationType] || opsConfig.isolation;
           
            return {
                tool: { ...operation.tool },
                cutting: { ...operation.cutting },
                operation: { ...operation.strategy }
            };
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
                color: this.fileTypes[operationType].color,
                geometricContext: {
                    hasArcs: false,
                    hasCircles: false,
                    analyticCount: 0,
                    preservedShapes: [],
                    hasStrokes: false,
                    strokeCount: 0
                }
            };
           
            this.operations.push(operation);
            return operation;
        }
       
        async parseOperation(operation) {
            try {
                if (debugConfig.logging?.parseOperations) {
                    console.log(`Parsing ${operation.file.name}...`);
                }
               
                let parseResult;
               
                // Create parser instances with debug from config
                if (operation.type === 'drill') {
                    if (typeof ExcellonParser === 'undefined') {
                        throw new Error('Excellon parser not available');
                    }
                    const excellonParser = new ExcellonParser({
                        debug: debugConfig.enabled
                    });
                    parseResult = excellonParser.parse(operation.file.content);
                } else {
                    if (typeof GerberParser === 'undefined') {
                        throw new Error('Gerber parser not available');
                    }
                    const gerberParser = new GerberParser({
                        debug: debugConfig.enabled
                    });
                    parseResult = gerberParser.parse(operation.file.content);
                }
               
                if (!parseResult.success) {
                    operation.error = parseResult.errors.join('; ');
                    return false;
                }
               
                operation.parsed = parseResult;
               
                // Create plotter instance with debug
                if (typeof ParserPlotter === 'undefined') {
                    throw new Error('Plotter not available');
                }
                const plotter = new ParserPlotter({
                    debug: debugConfig.enabled,
                    markStrokes: true
                });
               
                // ParserPlotter has a unified plot method that handles both types
                const plotResult = plotter.plot(parseResult);
               
                if (!plotResult.success) {
                    operation.error = plotResult.error;
                    return false;
                }
               
                // Process cutout primitives
                let primitives = plotResult.primitives;
                if (operation.type === 'cutout') {
                    primitives = this.processCutoutPrimitives(primitives);
                    if (debugConfig.logging?.parseOperations) {
                        console.log(`Cutout processing: ${primitives.length} primitives`);
                    }
                }
               
                // Add polarity to all primitives based on operation type
                primitives = primitives.map(primitive => {
                    if (!primitive.properties) {
                        primitive.properties = {};
                    }
                    // All copper operations (isolation, clear) use dark polarity
                    primitive.properties.polarity = 'dark';
                    primitive.properties.operationType = operation.type;
                    primitive.properties.operationId = operation.id;
                    primitive.properties.layerType = operation.type === 'drill' ? 'drill' : operation.type;
                   
                    return primitive;
                });
               
                // Analyze geometric context
                this.analyzeGeometricContext(operation, primitives);
               
                // Validate and optimize primitives
                const validPrimitives = this.validateAndOptimizePrimitives(primitives);
               
                operation.primitives = validPrimitives;
                operation.bounds = this.recalculateBounds(validPrimitives);
               
                this.updateStatistics();
                operation.processed = true;
               
                if (debugConfig.logging?.parseOperations) {
                    console.log(`Successfully parsed ${operation.file.name}: ${operation.primitives.length} primitives with ${operation.type === 'clear' ? 'clear' : 'dark'} polarity`);
                }
               
                // Log geometric context if present
                if (operation.geometricContext.analyticCount > 0 && debugConfig.enabled) {
                    console.log(`  Analytic shapes: ${operation.geometricContext.analyticCount}`);
                    console.log(`  Has arcs: ${operation.geometricContext.hasArcs}`);
                    console.log(`  Has circles: ${operation.geometricContext.hasCircles}`);
                    console.log(`  Stroked primitives: ${operation.geometricContext.strokeCount}`);
                }
               
                return true;
               
            } catch (error) {
                operation.error = error.message;
                console.error(`Error processing ${operation.file.name}:`, error);
                return false;
            }
        }
       
        analyzeGeometricContext(operation, primitives) {
            let analyticCount = 0;
            let hasArcs = false;
            let hasCircles = false;
            let hasStrokes = false;
            let strokeCount = 0;
            const preservedShapes = [];
           
            primitives.forEach(primitive => {
                if (primitive.canOffsetAnalytically && primitive.canOffsetAnalytically()) {
                    analyticCount++;
                    preservedShapes.push({
                        type: primitive.type,
                        metadata: primitive.getGeometricMetadata()
                    });
                }
               
                if (primitive.type === 'circle') {
                    hasCircles = true;
                }
               
                if (primitive.type === 'arc' ||
                    (primitive.arcSegments && primitive.arcSegments.length > 0)) {
                    hasArcs = true;
                }
               
                // Track stroked primitives
                if (primitive.properties) {
                    if (primitive.properties.stroke && !primitive.properties.fill) {
                        hasStrokes = true;
                        strokeCount++;
                    }
                    if (primitive.properties.isTrace) {
                        hasStrokes = true;
                        strokeCount++;
                    }
                }
            });
           
            operation.geometricContext = {
                hasArcs,
                hasCircles,
                analyticCount,
                preservedShapes,
                hasStrokes,
                strokeCount
            };
           
            this.stats.analyticPrimitives += analyticCount;
            this.stats.polygonizedPrimitives += primitives.length - analyticCount;
            
            // Update global stroke count
            this.stats.strokesConverted += strokeCount;
        }
       
        validateAndOptimizePrimitives(primitives) {
            const validPrimitives = [];
           
            primitives.forEach((primitive, index) => {
                try {
                    // Validate bounds
                    if (typeof primitive.getBounds !== 'function') {
                        if (debugConfig.validation?.warnOnInvalidData) {
                            console.warn(`Primitive ${index} missing getBounds method`);
                        }
                        return;
                    }
                   
                    const bounds = primitive.getBounds();
                    if (!isFinite(bounds.minX) || !isFinite(bounds.minY) ||
                        !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                        if (debugConfig.validation?.warnOnInvalidData) {
                            console.warn(`Primitive ${index} has invalid bounds:`, bounds);
                        }
                        return;
                    }
                   
                    // Check bounds against max coordinate
                    if (debugConfig.validation?.validateCoordinates) {
                        const maxCoord = geomConfig.maxCoordinate || 1000;
                        if (Math.abs(bounds.minX) > maxCoord || Math.abs(bounds.minY) > maxCoord ||
                            Math.abs(bounds.maxX) > maxCoord || Math.abs(bounds.maxY) > maxCoord) {
                            console.warn(`Primitive ${index} exceeds maximum coordinate ${maxCoord}`);
                        }
                    }
                   
                    validPrimitives.push(primitive);
                   
                } catch (error) {
                    if (debugConfig.validation?.warnOnInvalidData) {
                        console.warn(`Primitive ${index} validation failed:`, error);
                    }
                }
            });
           
            if (validPrimitives.length !== primitives.length && debugConfig.enabled) {
                console.warn(`Filtered out ${primitives.length - validPrimitives.length} invalid primitives`);
            }
           
            return validPrimitives;
        }
       
        processCutoutPrimitives(primitives) {
            if (!primitives || primitives.length === 0) return primitives;
           
            if (debugConfig.logging?.parseOperations) {
                console.log(`Processing cutout primitives: ${primitives.length} total`);
            }
           
            const processedPrimitives = [];
           
            primitives.forEach(p => {
                if (!p.properties) {
                    p.properties = {};
                }
               
                // Mark as cutout
                p.properties.isCutout = true;
               
                // Cutout paths should be stroked, not filled
                if (p.type === 'path') {
                    p.properties.fill = false;
                    p.properties.stroke = true;
                    p.properties.strokeWidth = 0.1;
                }
               
                // Preserve arc information in cutouts
                if (p.geometricContext && p.geometricContext.containsArcs) {
                    p.properties.preserveArcs = true;
                }
               
                processedPrimitives.push(p);
            });
           
            if (debugConfig.logging?.parseOperations) {
                console.log(`Cutout processing complete: ${processedPrimitives.length} primitives`);
            }
           
            return processedPrimitives;
        }
       
        recalculateBounds(primitives) {
            if (!primitives || primitives.length === 0) {
                return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
            }
           
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
           
            primitives.forEach(primitive => {
                const bounds = primitive.getBounds();
                minX = Math.min(minX, bounds.minX);
                minY = Math.min(minY, bounds.minY);
                maxX = Math.max(maxX, bounds.maxX);
                maxY = Math.max(maxY, bounds.maxY);
            });
           
            return { minX, minY, maxX, maxY };
        }
       
        removeOperation(operationId) {
            const index = this.operations.findIndex(op => op.id === operationId);
            if (index === -1) return false;
           
            this.operations.splice(index, 1);
            this.updateStatistics();
            this.updateCoordinateSystem();
           
            return true;
        }
       
        getAllPrimitives() {
            const primitives = [];
            this.operations.forEach(op => {
                if (op.primitives && op.primitives.length > 0) {
                    primitives.push(...op.primitives);
                }
            });
            return primitives;
        }
        
        // FIXED: Get only fuseable primitives (isolation + clear)
        getFuseablePrimitives() {
            const primitives = [];
            this.operations.forEach(op => {
                // Only include isolation and clear operations in fusion
                if ((op.type === 'isolation' || op.type === 'clear') && 
                    op.primitives && op.primitives.length > 0) {
                    primitives.push(...op.primitives);
                }
            });
            return primitives;
        }
       
        getIsolationPrimitives() {
            const primitives = [];
            this.operations.forEach(op => {
                if (op.type === 'isolation' && op.primitives && op.primitives.length > 0) {
                    primitives.push(...op.primitives);
                }
            });
            return primitives;
        }
       
        getOperationsByType(type) {
            return this.operations.filter(op => op.type === type);
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
       
        updateCoordinateSystem() {
            if (this.coordinateSystem) {
                this.coordinateSystem.analyzeCoordinateSystem(this.operations);
            }
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
       
        getStats() {
            return { ...this.stats };
        }
       
        hasValidOperations() {
            return this.operations.some(op => op.primitives && op.primitives.length > 0);
        }
       
        // FIXED: Only fuse isolation and clear primitives, not drill or cutout
        async fuseAllPrimitives(options = {}) {
            await this.ensureProcessorReady();
           
            if (!this.geometryProcessor) {
                throw new Error('Geometry processor not available');
            }
           
            // CRITICAL FIX: Only get fuseable primitives (isolation + clear)
            const fuseablePrimitives = this.getFuseablePrimitives();
           
            if (fuseablePrimitives.length === 0) {
                if (debugConfig.enabled) {
                    console.log('No fuseable primitives (isolation/clear) to fuse');
                }
                return [];
            }
           
            if (debugConfig.logging?.fusionOperations) {
                console.log(`=== FUSION INPUT ===`);
                
                // Count by operation type and polarity
                const isolationPrimitives = [];
                const clearPrimitives = [];
                const darkCount = fuseablePrimitives.filter(p => p.properties?.polarity === 'dark').length;
                const clearCount = fuseablePrimitives.filter(p => p.properties?.polarity === 'clear').length;
                
                this.operations.forEach(op => {
                    if (op.primitives && op.primitives.length > 0) {
                        if (op.type === 'isolation') {
                            isolationPrimitives.push(...op.primitives);
                        } else if (op.type === 'clear') {
                            clearPrimitives.push(...op.primitives);
                        }
                    }
                });
                
                console.log(`Isolation primitives: ${isolationPrimitives.length}`);
                console.log(`Clear primitives: ${clearPrimitives.length}`);
                console.log(`Dark polarity count: ${darkCount}`);
                console.log(`Clear polarity count: ${clearCount}`);
                console.log(`Total fuseable primitives: ${fuseablePrimitives.length}`);
                
                // Log excluded operations
                const drillOps = this.getOperationsByType('drill');
                const cutoutOps = this.getOperationsByType('cutout');
                if (drillOps.length > 0 || cutoutOps.length > 0) {
                    console.log(`EXCLUDED from fusion:`);
                    if (drillOps.length > 0) {
                        const drillCount = drillOps.reduce((sum, op) => 
                            sum + (op.primitives ? op.primitives.length : 0), 0);
                        console.log(`  Drill operations: ${drillOps.length} files, ${drillCount} primitives`);
                    }
                    if (cutoutOps.length > 0) {
                        const cutoutCount = cutoutOps.reduce((sum, op) => 
                            sum + (op.primitives ? op.primitives.length : 0), 0);
                        console.log(`  Cutout operations: ${cutoutOps.length} files, ${cutoutCount} primitives`);
                    }
                }
                
                // Log arc reconstruction state
                if (options.enableArcReconstruction) {
                    console.log(`Arc reconstruction: ENABLED`);
                }
            }
           
            try {
                // Pass options through to geometry processor
                const fused = await this.geometryProcessor.fuseGeometry(fuseablePrimitives, options);
               
                if (debugConfig.logging?.fusionOperations) {
                    console.log(`=== FUSION COMPLETE ===`);
                    console.log(`Result: ${fused.length} primitives`);
                    
                    // Count preserved holes
                    let preservedHoles = 0;
                    fused.forEach(p => {
                        if (p.holes && p.holes.length > 0) {
                            preservedHoles += p.holes.length;
                        }
                    });
                    
                    if (preservedHoles > 0) {
                        console.log(`Preserved ${preservedHoles} holes in fused geometry`);
                    }
                    
                    // Log arc reconstruction results if enabled
                    if (options.enableArcReconstruction && this.geometryProcessor) {
                        const arcStats = this.geometryProcessor.getArcReconstructionStats();
                        if (arcStats.curvesRegistered > 0) {
                            console.log(`Arc reconstruction results:`);
                            console.log(`  Curves registered: ${arcStats.curvesRegistered}`);
                            console.log(`  Curves reconstructed: ${arcStats.curvesReconstructed}`);
                            console.log(`  Success rate: ${((arcStats.curvesReconstructed / arcStats.curvesRegistered) * 100).toFixed(1)}%`);
                        }
                    }
                }
               
                return fused;
            } catch (error) {
                console.error('Fusion operation failed:', error);
                throw error;
            }
        }
       
        async prepareForOffsetGeneration() {
            await this.ensureProcessorReady();
           
            if (!this.geometryProcessor) {
                throw new Error('Geometry processor not available');
            }
           
            const fusedPrimitives = await this.fuseAllPrimitives();
           
            // Check for preserved analytic shapes
            const analyticShapes = fusedPrimitives.filter(p =>
                p.canOffsetAnalytically && p.canOffsetAnalytically()
            );
           
            if (analyticShapes.length > 0 && debugConfig.enabled) {
                console.log(`${analyticShapes.length} shapes can be offset analytically`);
            }
           
            return this.geometryProcessor.prepareForOffset(fusedPrimitives);
        }
       
        async generateOffsetGeometry(offsetDistance, options = {}) {
            await this.ensureProcessorReady();
           
            if (!this.geometryProcessor) {
                throw new Error('Geometry processor not available');
            }
           
            const preparedGeometry = await this.prepareForOffsetGeneration();
           
            return this.geometryProcessor.generateOffset(preparedGeometry, offsetDistance, options);
        }
       
        // Settings management
        updateSettings(category, settings) {
            if (this.settings[category]) {
                Object.assign(this.settings[category], settings);
                this.saveSettings();
            }
        }
       
        getSetting(category, key) {
            return this.settings[category]?.[key];
        }
        
        // FIXED: Add layer contamination check
        checkLayerContamination() {
            console.log('=== LAYER CONTAMINATION CHECK ===');
            
            const operations = this.operations.filter(op => op.primitives && op.primitives.length > 0);
            
            operations.forEach(op => {
                console.log(`\nOperation: ${op.type} (${op.file.name})`);
                console.log(`  Expected polarity: ${op.type === 'clear' ? 'clear' : 'dark'}`);
                
                // Check for mismatched polarities
                const polarities = {};
                const operationTypes = {};
                
                op.primitives.forEach(p => {
                    const pol = p.properties?.polarity || 'undefined';
                    const opType = p.properties?.operationType || 'undefined';
                    
                    polarities[pol] = (polarities[pol] || 0) + 1;
                    operationTypes[opType] = (operationTypes[opType] || 0) + 1;
                });
                
                console.log(`  Actual polarities:`, polarities);
                console.log(`  Operation types:`, operationTypes);
                
                // Check for contamination
                if (op.type === 'isolation' && polarities['clear'] > 0) {
                    console.warn(`  ⚠️ CONTAMINATION: Isolation layer has ${polarities['clear']} clear primitives!`);
                }
                if (op.type === 'clear' && polarities['dark'] > 0) {
                    console.warn(`  ⚠️ CONTAMINATION: Clear layer has ${polarities['dark']} dark primitives!`);
                }
                if (operationTypes[op.type] !== op.primitives.length) {
                    console.warn(`  ⚠️ CONTAMINATION: Operation type mismatch!`);
                }
            });
            
            console.log('\n=== END CONTAMINATION CHECK ===');
        }
       
        // Debug and testing utilities
        getProcessorStats() {
            const stats = {
                core: this.getStats(),
                hasGeometryProcessor: !!this.geometryProcessor,
                processorInitialized: this.processorInitialized,
                isolationPrimitiveCount: this.getIsolationPrimitives().length,
                fuseablePrimitiveCount: this.getFuseablePrimitives().length,
                analyticPrimitives: this.stats.analyticPrimitives,
                polygonizedPrimitives: this.stats.polygonizedPrimitives,
                strokesConverted: this.stats.strokesConverted
            };
           
            if (this.geometryProcessor) {
                stats.geometryProcessor = this.geometryProcessor.getStats();
                
                // Include cached states info
                stats.cachedStates = {
                    hasPreprocessed: !!this.geometryProcessor.getCachedState('preprocessedGeometry'),
                    hasFused: !!this.geometryProcessor.getCachedState('fusedGeometry')
                };
                
                // Include arc reconstruction stats
                stats.arcReconstruction = this.geometryProcessor.getArcReconstructionStats();
            }
           
            return stats;
        }
       
        checkGeometricContextPreservation() {
            if (!debugConfig.enabled) return;
           
            console.log('🔍 Checking geometric context preservation...');
            console.log('=====================================');
           
            this.operations.forEach((op, index) => {
                if (op.geometricContext) {
                    console.log(`\n📄 Operation ${index + 1}: ${op.type} - ${op.file.name}`);
                    console.log(`   Analytic shapes: ${op.geometricContext.analyticCount}`);
                    console.log(`   Has arcs: ${op.geometricContext.hasArcs}`);
                    console.log(`   Has circles: ${op.geometricContext.hasCircles}`);
                    console.log(`   Has strokes: ${op.geometricContext.hasStrokes}`);
                    console.log(`   Stroke count: ${op.geometricContext.strokeCount}`);
                   
                    if (op.geometricContext.preservedShapes.length > 0) {
                        console.log(`   Preserved shape types:`);
                        const types = {};
                        op.geometricContext.preservedShapes.forEach(shape => {
                            types[shape.type] = (types[shape.type] || 0) + 1;
                        });
                        Object.entries(types).forEach(([type, count]) => {
                            console.log(`     ${type}: ${count}`);
                        });
                    }
                }
            });
           
            console.log(`\n📊 Global totals:`);
            console.log(`   Analytic primitives: ${this.stats.analyticPrimitives}`);
            console.log(`   Polygonized primitives: ${this.stats.polygonizedPrimitives}`);
            console.log(`   Strokes converted: ${this.stats.strokesConverted}`);
            
            // Include arc reconstruction stats if available
            if (this.geometryProcessor) {
                const arcStats = this.geometryProcessor.getArcReconstructionStats();
                if (arcStats.registrySize > 0 || arcStats.curvesRegistered > 0) {
                    console.log(`\n🔄 Arc Reconstruction:`);
                    console.log(`   Registry size: ${arcStats.registrySize}`);
                    console.log(`   Curves registered: ${arcStats.curvesRegistered}`);
                    console.log(`   Curves reconstructed: ${arcStats.curvesReconstructed}`);
                    console.log(`   Curves lost: ${arcStats.curvesLost}`);
                }
            }
        }
    }
   
    // Export
    window.PCBCamCore = PCBCamCore;
   
})();