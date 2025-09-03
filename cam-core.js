// cam-core.js - Core PCB CAM application logic with Clipper2 integration
// Handles async geometry processing and preserves geometric context
// FIXED: Added validation and debug helpers for fusion operations

class PCBCamCore {
    constructor(options = {}) {
        // Core data
        this.operations = [];
        this.nextOperationId = 1;
        
        // FIXED: Add initialization control
        this.skipInit = options.skipInit || false;
        this.isInitializing = false;
        this.isInitialized = false;
        
        // File type definitions with distinct colors
        this.fileTypes = {
            isolation: {
                extensions: ['.gbr', '.ger', '.gtl', '.gbl', '.gts', '.gbs', '.gto', '.gbo', '.gtp', '.gbp'],
                description: 'Gerber files for isolation routing',
                icon: '📄',
                color: '#ff8844'
            },
            clear: {
                extensions: ['.gbr', '.ger', '.gpl', '.gp1', '.gnd'],
                description: 'Gerber files for copper clearing',
                icon: '📄',
                color: '#44ff88'
            },
            drill: {
                extensions: ['.drl', '.xln', '.txt', '.drill', '.exc'],
                description: 'Excellon drill files',
                icon: '🔧',
                color: '#4488ff'
            },
            cutout: {
                extensions: ['.gbr', '.gko', '.gm1', '.outline', '.mill'],
                description: 'Gerber files for board cutout',
                icon: '📄',
                color: '#ff00ff'
            }
        };
        
        // Settings
        this.settings = this.loadSettings();
        
        // Statistics
        this.stats = {
            totalPrimitives: 0,
            operations: 0,
            layers: 0,
            holes: 0,
            holesDetected: 0,
            analyticPrimitives: 0, // NEW: Track analytic shapes
            polygonizedPrimitives: 0 // NEW: Track converted shapes
        };
        
        // Coordinate system (will be set by UI)
        this.coordinateSystem = null;
        
        // NEW: Async initialization flag
        this.processorInitialized = false;
        this.initializationPromise = null;
        
        // FIXED: Only initialize if not skipped
        if (!this.skipInit) {
            this.initializeProcessors();
        }
    }
    
    async initializeProcessors() {
        // FIXED: Prevent double initialization
        if (this.isInitializing || this.isInitialized) {
            console.log('Processors already initializing or initialized, skipping...');
            return this.initializationPromise || true;
        }
        
        this.isInitializing = true;
        console.log('Initializing processors with Clipper2...');
        
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
                console.log(`✅ ${className} available`);
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
        
        // Initialize GeometryProcessor with Clipper2
        if (typeof GeometryProcessor !== 'undefined') {
            // Enable debug mode for better diagnosis
            this.geometryProcessor = new GeometryProcessor({
                debug: true, // FIXED: Enable debug for better diagnosis
                scale: 1000, // Use micrometers for better precision
                preserveOriginals: true // Always preserve for debug
            });
            
            // Wait for Clipper2 WASM to initialize
            this.initializationPromise = this.geometryProcessor.initPromise;
            
            try {
                await this.initializationPromise;
                this.processorInitialized = true;
                this.isInitialized = true;
                console.log('✅ Clipper2 GeometryProcessor initialized');
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
            console.log('Waiting for Clipper2 initialization...');
            await this.initializationPromise;
        }
        
        if (!this.processorInitialized) {
            throw new Error('Geometry processor not initialized');
        }
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
            ui: { theme: 'dark', showTooltips: true },
            geometry: {
                preserveArcs: true, // NEW: Preserve arc information
                adaptiveSegmentation: true, // NEW: Use adaptive segmentation
                targetSegmentLength: 0.1 // NEW: Target segment length in mm
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
                        cornerHandling: true,
                        preserveArcs: true // NEW: Preserve arcs in isolation
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
                        leadOut: 0.5,
                        preserveArcs: true // NEW: Preserve arcs in cutout
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
            color: this.fileTypes[operationType].color,
            // NEW: Geometric context tracking
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
            console.log(`Parsing ${operation.file.name}...`);
            
            let parseResult;
            
            // Create parser instances with debug enabled
            if (operation.type === 'drill') {
                if (typeof ExcellonSemanticParser === 'undefined') {
                    throw new Error('Excellon parser not available');
                }
                const excellonParser = new ExcellonSemanticParser({ debug: true });
                parseResult = excellonParser.parse(operation.file.content);
            } else {
                if (typeof GerberSemanticParser === 'undefined') {
                    throw new Error('Gerber parser not available');
                }
                const gerberParser = new GerberSemanticParser({ 
                    debug: true // FIXED: Enable debug
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
                debug: true // FIXED: Enable debug
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
                console.log(`Cutout processing: ${primitives.length} primitives`);
            }
            
            // CRITICAL: Add polarity to all primitives based on operation type
            // Clear operations have 'clear' polarity, everything else is 'dark'
            primitives = primitives.map(primitive => {
                if (!primitive.properties) {
                    primitive.properties = {};
                }
                // Set polarity based on operation type
                primitive.properties.polarity = operation.type === 'clear' ? 'clear' : 'dark';
                primitive.properties.operationType = operation.type;
                primitive.properties.operationId = operation.id;
                primitive.properties.layerType = operation.type === 'drill' ? 'drill' : operation.type;
                
                return primitive;
            });
            
            // NEW: Analyze geometric context
            this.analyzeGeometricContext(operation, primitives);
            
            // Validate and optimize primitives
            const validPrimitives = this.validateAndOptimizePrimitives(primitives);
            
            // FIXED: Additional validation for fusion
            const fusionValidation = this.validatePrimitivesForFusion(validPrimitives, operation.type);
            console.log(`Fusion validation for ${operation.file.name}:`, fusionValidation);
            
            operation.primitives = validPrimitives;
            operation.bounds = this.recalculateBounds(validPrimitives);
            
            this.updateStatistics();
            operation.processed = true;
            
            console.log(`Successfully parsed ${operation.file.name}: ${operation.primitives.length} primitives with ${operation.type === 'clear' ? 'clear' : 'dark'} polarity`);
            
            // Log geometric context
            if (operation.geometricContext.analyticCount > 0) {
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
    
    /**
     * NEW: Validate primitives for fusion operation
     */
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
        
        // Log summary
        if (validation.issues.length > 0) {
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
    
    /**
     * NEW: Analyze geometric context of primitives
     */
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
    
    /**
     * NEW: Validate and optimize primitives with smart segmentation
     */
    validateAndOptimizePrimitives(primitives) {
        const validPrimitives = [];
        
        primitives.forEach((primitive, index) => {
            try {
                // Validate bounds
                if (typeof primitive.getBounds !== 'function') {
                    console.warn(`Primitive ${index} missing getBounds method`);
                    return;
                }
                
                const bounds = primitive.getBounds();
                if (!isFinite(bounds.minX) || !isFinite(bounds.minY) || 
                    !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                    console.warn(`Primitive ${index} has invalid bounds:`, bounds);
                    return;
                }
                
                // Optimize circles and arcs if adaptive segmentation is enabled
                if (this.settings.geometry.adaptiveSegmentation) {
                    if (primitive.type === 'circle' || primitive.type === 'arc') {
                        // Keep as-is for now, convert to polygon only when needed for Clipper2
                        // This preserves the analytic information
                    }
                }
                
                validPrimitives.push(primitive);
                
            } catch (error) {
                console.warn(`Primitive ${index} validation failed:`, error);
            }
        });
        
        if (validPrimitives.length !== primitives.length) {
            console.warn(`Filtered out ${primitives.length - validPrimitives.length} invalid primitives`);
        }
        
        return validPrimitives;
    }
    
    processCutoutPrimitives(primitives) {
        if (!primitives || primitives.length === 0) return primitives;
        
        console.log(`Processing cutout primitives: ${primitives.length} total`);
        
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
        
        console.log(`Cutout processing complete: ${processedPrimitives.length} primitives`);
        
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
    
    /**
     * Enhanced fusion with Clipper2 - async operation
     * Now properly handles both isolation AND clear operations
     * FIXED: Added pre-fusion validation
     */
    async fuseAllPrimitives() {
        await this.ensureProcessorReady();
        
        if (!this.geometryProcessor) {
            throw new Error('Geometry processor not available');
        }
        
        // Get ALL primitives (both isolation and clear)
        const allPrimitives = this.getAllPrimitives();
        
        if (allPrimitives.length === 0) {
            console.log('No primitives to fuse');
            return [];
        }
        
        // Pre-fusion validation
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
        
        console.log(`=== FUSION INPUT ===`);
        console.log(`Isolation primitives: ${isolationPrimitives.length}`);
        console.log(`Clear primitives: ${clearPrimitives.length}`);
        
        // Combine all primitives (isolation as dark, clear as clear)
        const allPrimitivesForFusion = [...isolationPrimitives, ...clearPrimitives];
        
        // Count analytic shapes before fusion
        let analyticShapes = 0;
        allPrimitivesForFusion.forEach(p => {
            if (p.canOffsetAnalytically && p.canOffsetAnalytically()) {
                analyticShapes++;
            }
        });
        
        if (analyticShapes > 0) {
            console.log(`Input contains ${analyticShapes} analytic shapes (circles/arcs)`);
        }
        
        try {
            // Perform fusion with Clipper2 - geometry processor will handle polarity
            console.log('=== STARTING CLIPPER2 FUSION ===');
            const fused = await this.geometryProcessor.fuseGeometry(allPrimitivesForFusion);
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
            
            return fused;
        } catch (error) {
            console.error('Fusion operation failed:', error);
            throw error;
        }
    }
    
    /**
     * NEW: Debug method to analyze primitives before fusion
     */
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
    
    /**
     * Prepare geometry for offset generation - async
     */
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
        
        if (analyticShapes.length > 0) {
            console.log(`${analyticShapes.length} shapes can be offset analytically`);
        }
        
        return this.geometryProcessor.prepareForOffset(fusedPrimitives);
    }
    
    /**
     * Generate offset geometry for toolpaths - async
     */
    async generateOffsetGeometry(offsetDistance, options = {}) {
        await this.ensureProcessorReady();
        
        if (!this.geometryProcessor) {
            throw new Error('Geometry processor not available');
        }
        
        const preparedGeometry = await this.prepareForOffsetGeneration();
        
        // Future: Use Clipper2's offset capabilities
        // For now, return placeholder
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
    
    // Check for geometric context preservation
    checkGeometricContextPreservation() {
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
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PCBCamCore;
} else {
    window.PCBCamCore = PCBCamCore;
}