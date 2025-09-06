// cam-core.js - Refactored with config integration
// Core PCB CAM application logic with Clipper2 integration
// Handles async geometry processing and preserves geometric context

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
                polygonizedPrimitives: 0
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
                'GerberSemanticParser',
                'ExcellonSemanticParser',
                'GerberPlotter',
                'GeometryProcessor'
            ];
            
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
                    preservedShapes: []
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
                    if (typeof ExcellonSemanticParser === 'undefined') {
                        throw new Error('Excellon parser not available');
                    }
                    const excellonParser = new ExcellonSemanticParser({ 
                        debug: debugConfig.enabled
                    });
                    parseResult = excellonParser.parse(operation.file.content);
                } else {
                    if (typeof GerberSemanticParser === 'undefined') {
                        throw new Error('Gerber parser not available');
                    }
                    const gerberParser = new GerberSemanticParser({ 
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
                if (typeof GerberPlotter === 'undefined') {
                    throw new Error('Plotter not available');
                }
                const plotter = new GerberPlotter({ 
                    debug: debugConfig.enabled
                });
                
                let plotResult;
                if (operation.type === 'drill') {
                    plotResult = plotter.plotDrillData(parseResult);
                } else {
                    plotResult = plotter.plot(parseResult);
                }
                
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
                    primitive.properties.polarity = operation.type === 'clear' ? 'clear' : 'dark';
                    primitive.properties.operationType = operation.type;
                    primitive.properties.operationId = operation.id;
                    primitive.properties.layerType = operation.type === 'drill' ? 'drill' : operation.type;
                    
                    return primitive;
                });
                
                // Analyze geometric context
                this.analyzeGeometricContext(operation, primitives);
                
                // Validate and optimize primitives
                const validPrimitives = this.validateAndOptimizePrimitives(primitives);
                
                // Additional validation for fusion if enabled
                if (debugConfig.validation?.validatePolarity) {
                    const fusionValidation = this.validatePrimitivesForFusion(validPrimitives, operation.type);
                    if (debugConfig.logging?.fusionOperations) {
                        console.log(`Fusion validation for ${operation.file.name}:`, fusionValidation);
                    }
                }
                
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
                }
                
                return true;
                
            } catch (error) {
                operation.error = error.message;
                console.error(`Error processing ${operation.file.name}:`, error);
                return false;
            }
        }
        
        validatePrimitivesForFusion(primitives, operationType) {
            const validation = {
                totalPrimitives: primitives.length,
                validPrimitives: 0,
                invalidPrimitives: 0,
                missingPolarity: 0,
                incorrectPolarity: 0,
                emptyGeometry: 0,
                strokedPaths: 0,
                filledPaths: 0,
                circles: 0,
                rectangles: 0,
                obrounds: 0,
                issues: []
            };
            
            const expectedPolarity = operationType === 'clear' ? 'clear' : 'dark';
            
            primitives.forEach((primitive, index) => {
                let isValid = true;
                
                // Check polarity
                if (!primitive.properties || !primitive.properties.polarity) {
                    validation.missingPolarity++;
                    validation.issues.push(`Primitive ${index}: Missing polarity`);
                    isValid = false;
                } else if (primitive.properties.polarity !== expectedPolarity) {
                    validation.incorrectPolarity++;
                    validation.issues.push(`Primitive ${index}: Wrong polarity (${primitive.properties.polarity} instead of ${expectedPolarity})`);
                }
                
                // Check geometry based on type
                switch (primitive.type) {
                    case 'path':
                        if (!primitive.points || primitive.points.length < 2) {
                            validation.emptyGeometry++;
                            validation.issues.push(`Primitive ${index}: Path has ${primitive.points?.length || 0} points`);
                            isValid = false;
                        } else {
                            if (primitive.properties?.stroke && !primitive.properties?.fill) {
                                validation.strokedPaths++;
                            } else {
                                validation.filledPaths++;
                            }
                        }
                        break;
                        
                    case 'circle':
                        validation.circles++;
                        if (!primitive.center || !primitive.radius || primitive.radius <= 0) {
                            validation.emptyGeometry++;
                            validation.issues.push(`Primitive ${index}: Invalid circle geometry`);
                            isValid = false;
                        }
                        break;
                        
                    case 'rectangle':
                        validation.rectangles++;
                        if (!primitive.position || !primitive.width || !primitive.height) {
                            validation.emptyGeometry++;
                            validation.issues.push(`Primitive ${index}: Invalid rectangle geometry`);
                            isValid = false;
                        }
                        break;
                        
                    case 'obround':
                        validation.obrounds++;
                        if (!primitive.position || !primitive.width || !primitive.height) {
                            validation.emptyGeometry++;
                            validation.issues.push(`Primitive ${index}: Invalid obround geometry`);
                            isValid = false;
                        }
                        break;
                }
                
                if (isValid) {
                    validation.validPrimitives++;
                } else {
                    validation.invalidPrimitives++;
                }
            });
            
            // Log summary if validation is enabled
            if (debugConfig.validation?.warnOnInvalidData && validation.issues.length > 0) {
                console.warn(`Fusion validation found ${validation.issues.length} issues`);
                if (validation.issues.length <= 10) {
                    validation.issues.forEach(issue => console.warn(`  ${issue}`));
                } else {
                    console.warn(`  (Showing first 10 of ${validation.issues.length} issues)`);
                    validation.issues.slice(0, 10).forEach(issue => console.warn(`  ${issue}`));
                }
            }
            
            return validation;
        }
        
        analyzeGeometricContext(operation, primitives) {
            let analyticCount = 0;
            let hasArcs = false;
            let hasCircles = false;
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
            });
            
            operation.geometricContext = {
                hasArcs,
                hasCircles,
                analyticCount,
                preservedShapes
            };
            
            this.stats.analyticPrimitives += analyticCount;
            this.stats.polygonizedPrimitives += primitives.length - analyticCount;
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
        
        async fuseAllPrimitives() {
            await this.ensureProcessorReady();
            
            if (!this.geometryProcessor) {
                throw new Error('Geometry processor not available');
            }
            
            const allPrimitives = this.getAllPrimitives();
            
            if (allPrimitives.length === 0) {
                if (debugConfig.enabled) {
                    console.log('No primitives to fuse');
                }
                return [];
            }
            
            // Pre-fusion validation if enabled
            if (debugConfig.validation?.validatePolarity) {
                console.log('=== PRE-FUSION VALIDATION ===');
                const validationResults = new Map();
                
                this.operations.forEach(op => {
                    if (op.primitives && op.primitives.length > 0) {
                        const validation = this.validatePrimitivesForFusion(op.primitives, op.type);
                        validationResults.set(op.file.name, validation);
                        
                        console.log(`${op.file.name} (${op.type}):`);
                        console.log(`  Total: ${validation.totalPrimitives}`);
                        console.log(`  Valid: ${validation.validPrimitives}`);
                        console.log(`  Invalid: ${validation.invalidPrimitives}`);
                        if (validation.strokedPaths > 0) {
                            console.log(`  Stroked paths: ${validation.strokedPaths} (will be converted)`);
                        }
                    }
                });
            }
            
            // Separate by operation type
            const isolationPrimitives = [];
            const clearPrimitives = [];
            
            this.operations.forEach(op => {
                if (op.primitives && op.primitives.length > 0) {
                    if (op.type === 'isolation') {
                        isolationPrimitives.push(...op.primitives);
                    } else if (op.type === 'clear') {
                        clearPrimitives.push(...op.primitives);
                    }
                }
            });
            
            if (debugConfig.logging?.fusionOperations) {
                console.log(`=== FUSION INPUT ===`);
                console.log(`Isolation primitives: ${isolationPrimitives.length}`);
                console.log(`Clear primitives: ${clearPrimitives.length}`);
            }
            
            // Combine all primitives (isolation as dark, clear as clear)
            const allPrimitivesForFusion = [...isolationPrimitives, ...clearPrimitives];
            
            // Count analytic shapes before fusion
            let analyticShapes = 0;
            allPrimitivesForFusion.forEach(p => {
                if (p.canOffsetAnalytically && p.canOffsetAnalytically()) {
                    analyticShapes++;
                }
            });
            
            if (analyticShapes > 0 && debugConfig.enabled) {
                console.log(`Input contains ${analyticShapes} analytic shapes (circles/arcs)`);
            }
            
            try {
                if (debugConfig.logging?.fusionOperations) {
                    console.log('=== STARTING CLIPPER2 FUSION ===');
                }
                
                const fused = await this.geometryProcessor.fuseGeometry(allPrimitivesForFusion);
                
                if (debugConfig.logging?.fusionOperations) {
                    console.log(`=== FUSION COMPLETE ===`);
                    console.log(`Result: ${fused.length} primitives`);
                }
                
                // Count preserved holes
                let preservedHoles = 0;
                fused.forEach(p => {
                    if (p.holes && p.holes.length > 0) {
                        preservedHoles += p.holes.length;
                    }
                });
                
                if (preservedHoles > 0 && debugConfig.enabled) {
                    console.log(`Preserved ${preservedHoles} holes in fused geometry`);
                }
                
                return fused;
            } catch (error) {
                console.error('Fusion operation failed:', error);
                throw error;
            }
        }
        
        analyzePrimitivesForFusion() {
            console.log('=== PRIMITIVE ANALYSIS FOR FUSION ===');
            
            const analysis = {
                byType: {},
                byPolarity: { dark: 0, clear: 0, undefined: 0 },
                byOperation: {},
                issues: []
            };
            
            this.operations.forEach(op => {
                if (!op.primitives || op.primitives.length === 0) return;
                
                analysis.byOperation[op.type] = {
                    total: op.primitives.length,
                    byType: {},
                    byPolarity: { dark: 0, clear: 0, undefined: 0 }
                };
                
                op.primitives.forEach((prim, index) => {
                    // Count by type
                    analysis.byType[prim.type] = (analysis.byType[prim.type] || 0) + 1;
                    analysis.byOperation[op.type].byType[prim.type] = 
                        (analysis.byOperation[op.type].byType[prim.type] || 0) + 1;
                    
                    // Count by polarity
                    const polarity = prim.properties?.polarity;
                    if (polarity === 'dark') {
                        analysis.byPolarity.dark++;
                        analysis.byOperation[op.type].byPolarity.dark++;
                    } else if (polarity === 'clear') {
                        analysis.byPolarity.clear++;
                        analysis.byOperation[op.type].byPolarity.clear++;
                    } else {
                        analysis.byPolarity.undefined++;
                        analysis.byOperation[op.type].byPolarity.undefined++;
                        analysis.issues.push(`${op.file.name}[${index}]: undefined polarity`);
                    }
                    
                    // Check for other issues
                    if (prim.type === 'path' && (!prim.points || prim.points.length < 2)) {
                        analysis.issues.push(`${op.file.name}[${index}]: path with ${prim.points?.length || 0} points`);
                    }
                });
            });
            
            // Output analysis
            console.log('Overall primitive types:', analysis.byType);
            console.log('Overall polarity distribution:', analysis.byPolarity);
            
            Object.entries(analysis.byOperation).forEach(([opType, data]) => {
                console.log(`\n${opType} operation:`);
                console.log('  Types:', data.byType);
                console.log('  Polarity:', data.byPolarity);
            });
            
            if (analysis.issues.length > 0) {
                console.warn(`\nFound ${analysis.issues.length} issues:`);
                analysis.issues.slice(0, 10).forEach(issue => console.warn(`  - ${issue}`));
                if (analysis.issues.length > 10) {
                    console.warn(`  ... and ${analysis.issues.length - 10} more`);
                }
            }
            
            return analysis;
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
        
        // Debug and testing utilities
        getProcessorStats() {
            const stats = {
                core: this.getStats(),
                hasGeometryProcessor: !!this.geometryProcessor,
                processorInitialized: this.processorInitialized,
                isolationPrimitiveCount: this.getIsolationPrimitives().length,
                analyticPrimitives: this.stats.analyticPrimitives,
                polygonizedPrimitives: this.stats.polygonizedPrimitives
            };
            
            if (this.geometryProcessor) {
                stats.geometryProcessor = this.geometryProcessor.getStats();
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
        }
    }
    
    // Export
    window.PCBCamCore = PCBCamCore;
    
})();