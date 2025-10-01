// cam-core.js
// REFACTORED: Offset-first pipeline with Clipper2 unions per pass

(function() {
    'use strict';
    
    const config = window.PCBCAMConfig || {};
    const geomConfig = config.geometry || {};
    const machineConfig = config.machine || {};
    const gcodeConfig = config.gcode || {};
    const opsConfig = config.operations || {};
    const debugConfig = config.debug || {};
    
    class PCBCamCore {
        constructor(options = {}) {
            // Core data
            this.operations = [];
            this.nextOperationId = 1;
            
            // Toolpath management
            this.toolpaths = new Map();
            this.isToolpathCacheValid = false;
            
            // Tool library reference
            this.toolLibrary = null;
            
            // Initialization control
            this.skipInit = options.skipInit || false;
            this.isInitializing = false;
            this.isInitialized = false;
            
            // Initialize fileTypes from config
            this.fileTypes = {};
            Object.keys(opsConfig).forEach(type => {
                const op = opsConfig[type];
                if (op) {
                    this.fileTypes[type] = {
                        extensions: op.extensions || [],
                        description: op.name || `Files for ${type} operation`,
                        icon: op.icon || '📄',
                        color: op.color || '#888888'
                    };
                }
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
                strokesConverted: 0,
                toolpaths: 0
            };
            
            // Coordinate system
            this.coordinateSystem = null;
            
            // Geometry processors
            this.geometryProcessor = null;
            this.geometryOffsetter = null;
            this.processorInitialized = false;
            this.initializationPromise = null;
            
            if (!this.skipInit) {
                this.initializeProcessors();
            }
        }
        
        async initializeProcessors() {
            if (this.isInitializing || this.isInitialized) {
                if (debugConfig.enabled) {
                    console.log('Processors already initializing or initialized');
                }
                return this.initializationPromise || true;
            }
            
            this.isInitializing = true;
            if (debugConfig.enabled) {
                console.log('Initializing processors with Clipper2...');
            }
            
            // Check required classes
            const requiredClasses = ['GerberParser', 'ExcellonParser', 'ParserPlotter', 'GeometryProcessor'];
            
            if (typeof ParserCore === 'undefined') {
                console.error('ParserCore base class not available');
                this.isInitializing = false;
                return false;
            }
            
            let allAvailable = true;
            requiredClasses.forEach(className => {
                if (typeof window[className] === 'undefined') {
                    console.error(`❌ ${className} not available`);
                    allAvailable = false;
                } else if (debugConfig.enabled) {
                    console.log(`✅ ${className} available`);
                }
            });
            
            if (!allAvailable) {
                this.isInitializing = false;
                return false;
            }
            
            // Initialize GeometryProcessor
            if (typeof GeometryProcessor !== 'undefined') {
                this.geometryProcessor = new GeometryProcessor({
                    debug: debugConfig.enabled,
                    scale: geomConfig.clipperScale || 10000,
                    preserveOriginals: true
                });
                
                // Initialize GeometryOffsetter
                if (typeof GeometryOffsetter !== 'undefined') {
                    this.geometryOffsetter = new GeometryOffsetter({
                        precision: geomConfig.coordinatePrecision || 0.001,
                        debug: debugConfig.enabled
                    });
                    
                    // Link processor for union operations
                    if (this.geometryOffsetter.setGeometryProcessor) {
                        this.geometryOffsetter.setGeometryProcessor(this.geometryProcessor);
                    }
                }
                
                // Wait for Clipper2 WASM
                this.initializationPromise = this.geometryProcessor.initPromise;
                
                try {
                    await this.initializationPromise;
                    this.processorInitialized = true;
                    this.isInitialized = true;
                    if (debugConfig.enabled) {
                        console.log('✅ Clipper2 initialized');
                    }
                    return true;
                } catch (error) {
                    console.error('❌ Clipper2 initialization failed:', error);
                    this.processorInitialized = false;
                    return false;
                } finally {
                    this.isInitializing = false;
                }
            }
            
            console.error('❌ GeometryProcessor not available');
            this.isInitializing = false;
            return false;
        }
        
        setToolLibrary(toolLibrary) {
            this.toolLibrary = toolLibrary;
            if (debugConfig.enabled) {
                console.log('Tool library set');
            }
        }
        
        getPreprocessedPrimitives() {
            return this.geometryProcessor?.getCachedState('preprocessedGeometry') || null;
        }
        
        getFusedPrimitives() {
            return this.geometryProcessor?.getCachedState('fusedGeometry') || null;
        }
        
        async ensureProcessorReady() {
            if (!this.processorInitialized && this.initializationPromise) {
                if (debugConfig.logging?.wasmOperations) {
                    console.log('Waiting for Clipper2...');
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
                    safeZ: machineConfig.heights?.safeZ || 2,
                    travelZ: machineConfig.heights?.travelZ || 1,
                    rapidFeed: machineConfig.speeds?.rapidFeed || 1000,
                    workCoordinateSystem: machineConfig.workspace?.system || 'G54',
                    maxX: machineConfig.workspace?.maxX || 200,
                    maxY: machineConfig.workspace?.maxY || 200
                },
                gcode: {
                    postProcessor: gcodeConfig.postProcessor || 'grbl',
                    startCode: config.getGcodeTemplate ?
                        config.getGcodeTemplate(gcodeConfig.postProcessor, 'start') :
                        gcodeConfig.templates?.grbl?.start || '',
                    endCode: config.getGcodeTemplate ?
                        config.getGcodeTemplate(gcodeConfig.postProcessor, 'end') :
                        gcodeConfig.templates?.grbl?.end || '',
                    units: gcodeConfig.units || 'mm'
                },
                ui: {
                    theme: config.ui?.theme || 'dark',
                    showTooltips: config.ui?.showTooltips !== false
                },
                geometry: {
                    preserveArcs: geomConfig.preserveArcs !== false,
                    adaptiveSegmentation: geomConfig.segments?.adaptiveSegmentation !== false,
                    targetSegmentLength: geomConfig.segments?.targetLength || 0.1
                }
            };
            
            try {
                const saved = localStorage.getItem('pcbcam-settings');
                return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
            } catch (error) {
                console.warn('Error loading settings:', error);
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
            
            let defaultTool = null;
            if (this.toolLibrary) {
                defaultTool = this.toolLibrary.getDefaultToolForOperation(operationType);
            } else if (config.getDefaultTool) {
                defaultTool = config.getDefaultTool(operationType);
            }
            
            return {
                tool: defaultTool ? {
                    id: defaultTool.id,
                    diameter: defaultTool.geometry?.diameter || defaultTool.diameter || 0.2,
                    type: defaultTool.type
                } : { ...operation.tool },
                cutting: { ...operation.cutting },
                operation: { ...operation.strategy },
                passes: operation.defaultSettings?.passes || 1,
                stepOver: operation.defaultSettings?.stepOver || 50,
                direction: operation.defaultSettings?.direction || 'climb',
                entryType: operation.defaultSettings?.entryType || 'plunge'
            };
        }
        
        createOperation(operationType, file) {
            const opConfig = opsConfig[operationType] || opsConfig.isolation;
            const fileType = this.fileTypes[operationType];
            
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
                expanded: false,
                processed: false,
                color: fileType?.color || opConfig.color || '#888888',
                geometricContext: {
                    hasArcs: false,
                    hasCircles: false,
                    analyticCount: 0,
                    preservedShapes: [],
                    hasStrokes: false,
                    strokeCount: 0
                },
                offsets: []
            };
            
            this.operations.push(operation);
            this.isToolpathCacheValid = false;
            
            return operation;
        }
        
        async parseOperation(operation) {
            try {
                if (debugConfig.logging?.parseOperations) {
                    console.log(`Parsing ${operation.file.name}...`);
                }
                
                let parseResult;
                
                if (operation.type === 'drill') {
                    if (typeof ExcellonParser === 'undefined') {
                        throw new Error('Excellon parser not available');
                    }
                    const parser = new ExcellonParser({ debug: debugConfig.enabled });
                    parseResult = parser.parse(operation.file.content);
                } else {
                    if (typeof GerberParser === 'undefined') {
                        throw new Error('Gerber parser not available');
                    }
                    const parser = new GerberParser({ debug: debugConfig.enabled });
                    parseResult = parser.parse(operation.file.content);
                }
                
                if (!parseResult.success) {
                    operation.error = parseResult.errors?.join('; ') || 'Parse failed';
                    return false;
                }
                
                operation.parsed = parseResult;
                
                if (typeof ParserPlotter === 'undefined') {
                    throw new Error('Plotter not available');
                }
                const plotter = new ParserPlotter({
                    debug: debugConfig.enabled,
                    markStrokes: true
                });
                
                const plotResult = plotter.plot(parseResult);
                
                if (!plotResult.success) {
                    operation.error = plotResult.error;
                    return false;
                }
                
                let primitives = plotResult.primitives;
                
                if (operation.type === 'cutout') {
                    primitives = this.processCutoutPrimitives(primitives);
                }
                
                primitives = primitives.map(primitive => {
                    if (!primitive.properties) primitive.properties = {};
                    primitive.properties.polarity = 'dark';
                    primitive.properties.operationType = operation.type;
                    primitive.properties.operationId = operation.id;
                    primitive.properties.layerType = operation.type === 'drill' ? 'drill' : operation.type;
                    return primitive;
                });
                
                this.analyzeGeometricContext(operation, primitives);
                const validPrimitives = this.validateAndOptimizePrimitives(primitives);
                
                operation.primitives = validPrimitives;
                operation.bounds = this.recalculateBounds(validPrimitives);
                
                this.updateStatistics();
                operation.processed = true;
                this.isToolpathCacheValid = false;
                
                if (debugConfig.logging?.parseOperations) {
                    console.log(`Parsed ${operation.file.name}: ${operation.primitives.length} primitives`);
                }
                
                return true;
                
            } catch (error) {
                operation.error = error.message;
                console.error(`Parse error for ${operation.file.name}:`, error);
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
                        metadata: primitive.getGeometricMetadata ? primitive.getGeometricMetadata() : {}
                    });
                }
                
                if (primitive.type === 'circle') hasCircles = true;
                if (primitive.type === 'arc' || (primitive.arcSegments && primitive.arcSegments.length > 0)) hasArcs = true;
                
                if (primitive.properties) {
                    if ((primitive.properties.stroke && !primitive.properties.fill) || primitive.properties.isTrace) {
                        hasStrokes = true;
                        strokeCount++;
                    }
                }
            });
            
            operation.geometricContext = {
                hasArcs, hasCircles, analyticCount, preservedShapes, hasStrokes, strokeCount
            };
            
            this.stats.analyticPrimitives += analyticCount;
            this.stats.polygonizedPrimitives += primitives.length - analyticCount;
            this.stats.strokesConverted += strokeCount;
        }
        
        validateAndOptimizePrimitives(primitives) {
            const validPrimitives = [];
            
            primitives.forEach((primitive, index) => {
                try {
                    if (typeof primitive.getBounds !== 'function') {
                        if (debugConfig.validation?.warnOnInvalidData) {
                            console.warn(`Primitive ${index} missing getBounds()`);
                        }
                        return;
                    }
                    
                    const bounds = primitive.getBounds();
                    if (!isFinite(bounds.minX) || !isFinite(bounds.minY) ||
                        !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                        if (debugConfig.validation?.warnOnInvalidData) {
                            console.warn(`Primitive ${index} invalid bounds:`, bounds);
                        }
                        return;
                    }
                    
                    if (debugConfig.validation?.validateCoordinates) {
                        const maxCoord = geomConfig.maxCoordinate || 1000;
                        if (Math.abs(bounds.minX) > maxCoord || Math.abs(bounds.minY) > maxCoord ||
                            Math.abs(bounds.maxX) > maxCoord || Math.abs(bounds.maxY) > maxCoord) {
                            console.warn(`Primitive ${index} exceeds max coordinate ${maxCoord}`);
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
                console.warn(`Filtered ${primitives.length - validPrimitives.length} invalid primitives`);
            }
            
            return validPrimitives;
        }
        
        processCutoutPrimitives(primitives) {
            if (!primitives || primitives.length === 0) return primitives;
            
            return primitives.map(p => {
                if (!p.properties) p.properties = {};
                p.properties.isCutout = true;
                
                if (p.type === 'path') {
                    p.properties.fill = false;
                    p.properties.stroke = true;
                    p.properties.strokeWidth = 0.1;
                }
                
                if (p.geometricContext && p.geometricContext.containsArcs) {
                    p.properties.preserveArcs = true;
                }
                
                return p;
            });
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
            this.toolpaths.delete(operationId);
            
            this.updateStatistics();
            this.updateCoordinateSystem();
            this.isToolpathCacheValid = false;
            
            return true;
        }
        
        updateOperationSettings(operationId, settings) {
            const operation = this.operations.find(op => op.id === operationId);
            if (!operation) return false;
            
            Object.assign(operation.settings, settings);
            this.isToolpathCacheValid = false;
            
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
        
        getFuseablePrimitives() {
            const primitives = [];
            this.operations.forEach(op => {
                if ((op.type === 'isolation' || op.type === 'clear' || op.type === 'clearing') && 
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
            
            this.stats.toolpaths = Array.from(this.toolpaths.values())
                .reduce((sum, data) => sum + (data.paths?.length || 0), 0);
        }
        
        updateCoordinateSystem() {
            if (this.coordinateSystem) {
                this.coordinateSystem.analyzeCoordinateSystem(this.operations);
            }
        }
        
        validateFileType(fileName, operationType) {
            const extension = this.getFileExtension(fileName);
            const config = this.fileTypes[operationType];
            
            if (!config) {
                return { valid: false, message: `Unknown operation type: ${operationType}` };
            }
            
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
        
        // =====================================================================
        // OFFSET-FIRST PIPELINE: Offset individuals → Union per pass
        // =====================================================================
        
        async generateOffsetGeometry(operation, offsetDistances, settings) {
            console.log(`[Core] === OFFSET-FIRST PIPELINE START ===`);
            console.log(`[Core] Operation: ${operation.id} (${operation.type})`);
            console.log(`[Core] Passes: ${offsetDistances.length}`);
            console.log(`[Core] Tool: ${settings.tool?.diameter}mm`);
            
            await this.ensureProcessorReady();
            
            if (!this.geometryOffsetter) {
                throw new Error('Geometry offsetter not initialized');
            }
            
            if (!this.geometryProcessor) {
                throw new Error('Geometry processor not initialized');
            }
            
            if (!operation.primitives || operation.primitives.length === 0) {
                throw new Error('No source primitives to offset');
            }
            
            console.log(`[Core] Source: ${operation.primitives.length} primitives`);
            
            operation.offsets = [];
            
            // Process each pass independently
            for (let passIndex = 0; passIndex < offsetDistances.length; passIndex++) {
                const distance = offsetDistances[passIndex];
                console.log(`[Core] === PASS ${passIndex + 1}/${offsetDistances.length} ===`);
                console.log(`[Core] Distance: ${distance.toFixed(3)}mm`);
                
                // Step 1: Offset individual primitives
                const offsetPrimitives = [];
                let successCount = 0;
                let failCount = 0;
                const failuresByType = {};
                
                for (const primitive of operation.primitives) {
                    try {
                        if (!this.validatePrimitiveForOffset(primitive)) {
                            failCount++;
                            failuresByType[primitive.type] = (failuresByType[primitive.type] || 0) + 1;
                            continue;
                        }
                        
                        let primToOffset = primitive;
                        if (primitive.type === 'path' && primitive.arcSegments && primitive.arcSegments.length > 0) {
                            primToOffset = {
                                type: 'path',
                                points: primitive.points,
                                closed: primitive.closed,
                                properties: { ...primitive.properties, hadArcs: true }
                            };
                        }
                        
                        const offsetResult = await this.geometryOffsetter.offsetPrimitive(
                            primToOffset,
                            distance,
                            settings
                        );
                        
                        // FIXED: Handle both single primitives and arrays
                        if (offsetResult) {
                            if (Array.isArray(offsetResult)) {
                                offsetPrimitives.push(...offsetResult);
                                successCount += offsetResult.length;
                            } else {
                                offsetPrimitives.push(offsetResult);
                                successCount++;
                            }
                        } else {
                            failCount++;
                            failuresByType[primitive.type] = (failuresByType[primitive.type] || 0) + 1;
                        }
                    } catch (error) {
                        console.error(`[Core] Offset failed for ${primitive.type}:`, error.message);
                        failCount++;
                        failuresByType[primitive.type] = (failuresByType[primitive.type] || 0) + 1;
                    }
                }
                
                console.log(`[Core] Offset: ${successCount} success, ${failCount} failed`);
                if (Object.keys(failuresByType).length > 0) {
                    console.log(`[Core] Failures by type:`, failuresByType);
                }
                
                if (offsetPrimitives.length === 0) {
                    console.warn(`[Core] Pass ${passIndex + 1} produced no geometry`);
                    continue;
                }
                
                // Step 2: Polygonize all offset primitives using proper protocols
                console.log(`[Core] Polygonizing ${offsetPrimitives.length} offset primitives...`);
                const polygonizedPrimitives = [];
                
                for (const primitive of offsetPrimitives) {
                    try {
                        if (primitive.type === 'circle') {
                            // Use toPolygon or GeometryUtils
                            if (primitive.toPolygon && typeof primitive.toPolygon === 'function') {
                                polygonizedPrimitives.push(primitive.toPolygon());
                            } else if (typeof GeometryUtils !== 'undefined') {
                                const segments = GeometryUtils.getOptimalSegments(primitive.radius);
                                const points = [];
                                for (let i = 0; i < segments; i++) {
                                    const angle = (i / segments) * 2 * Math.PI;
                                    points.push({
                                        x: primitive.center.x + primitive.radius * Math.cos(angle),
                                        y: primitive.center.y + primitive.radius * Math.sin(angle)
                                    });
                                }
                                polygonizedPrimitives.push(this._createPathPrimitive(points, {
                                    ...primitive.properties,
                                    closed: true,
                                    polygonized: true
                                }));
                            }
                        } else if (primitive.type === 'path') {
                            // Check if stroked path needing polygonization
                            const isStroke = primitive.properties && 
                                           (primitive.properties.stroke || primitive.properties.isTrace) &&
                                           primitive.properties.strokeWidth !== undefined;
                            
                            if (isStroke && typeof GeometryUtils !== 'undefined') {
                                // Use GeometryUtils to convert stroked path to polygon
                                let polygonPoints;
                                
                                if (primitive.points.length === 2) {
                                    // Single line segment
                                    polygonPoints = GeometryUtils.lineToPolygon(
                                        primitive.points[0],
                                        primitive.points[1],
                                        primitive.properties.strokeWidth
                                    );
                                } else {
                                    // Polyline
                                    polygonPoints = GeometryUtils.polylineToPolygon(
                                        primitive.points,
                                        primitive.properties.strokeWidth
                                    );
                                }
                                
                                if (polygonPoints && polygonPoints.length >= 3) {
                                    polygonizedPrimitives.push(this._createPathPrimitive(polygonPoints, {
                                        ...primitive.properties,
                                        closed: true,
                                        fill: true,
                                        stroke: false,
                                        polygonized: true
                                    }));
                                }
                            } else if (!isStroke) {
                                // Already a filled path polygon
                                polygonizedPrimitives.push(primitive);
                            }
                        } else if (primitive.type === 'arc') {
                            if (primitive.toPolygon && typeof primitive.toPolygon === 'function') {
                                polygonizedPrimitives.push(primitive.toPolygon());
                            }
                        }
                    } catch (error) {
                        console.error(`[Core] Polygonization failed for ${primitive.type}:`, error.message);
                    }
                }
                
                console.log(`[Core] Polygonized: ${offsetPrimitives.length} → ${polygonizedPrimitives.length} path primitives`);
                
                if (polygonizedPrimitives.length === 0) {
                    console.warn(`[Core] No valid primitives after polygonization`);
                    continue;
                }
                
                // Step 3: Union overlapping offsets
                console.log(`[Core] Unioning ${polygonizedPrimitives.length} path primitives...`);

                let finalGeometry;
                try {
                    const unionResult = await this.geometryProcessor.unionGeometry(
                        polygonizedPrimitives,
                        { fillRule: 'nonzero' }
                    );
                    
                    console.log(`[Core] Union: ${polygonizedPrimitives.length} → ${unionResult.length} primitives`);
                    
                    // FIXED: Always run arc reconstruction in offset pipeline
                    console.log(`[Core] Running arc reconstruction...`);
                    finalGeometry = this.geometryProcessor.arcReconstructor.processForReconstruction(unionResult);
                    console.log(`[Core] Reconstructed: ${unionResult.length} → ${finalGeometry.length} primitives`);
                    
                    finalGeometry = finalGeometry.map(p => {
                        if (!p.properties) p.properties = {};
                        p.properties.isOffset = true;
                        p.properties.pass = passIndex + 1;
                        p.properties.offsetDistance = distance;
                        return p;
                    });
                    
                } catch (error) {
                    console.error(`[Core] Union failed for pass ${passIndex + 1}:`, error);
                    finalGeometry = polygonizedPrimitives.map(p => {
                        if (!p.properties) p.properties = {};
                        p.properties.isOffset = true;
                        p.properties.pass = passIndex + 1;
                        p.properties.offsetDistance = distance;
                        p.properties.unionFailed = true;
                        return p;
                    });
                }
                
                // Store pass geometry
                operation.offsets.push({
                    id: `offset_${operation.id}_${passIndex}`,
                    distance: distance,
                    pass: passIndex + 1,
                    primitives: finalGeometry,
                    settings: { ...settings },
                    metadata: {
                        sourceCount: operation.primitives.length,
                        offsetCount: offsetPrimitives.length,
                        finalCount: finalGeometry.length,
                        generatedAt: Date.now(),
                        toolDiameter: settings.tool?.diameter
                    }
                });
            }
            
            const totalPrimitives = operation.offsets.reduce((sum, o) => sum + o.primitives.length, 0);
            console.log(`[Core] === OFFSET-FIRST PIPELINE COMPLETE ===`);
            console.log(`[Core] Generated ${operation.offsets.length} passes, ${totalPrimitives} primitives`);
            
            this.isToolpathCacheValid = false;
            return operation.offsets;
        }

        validatePrimitiveForOffset(primitive) {
            if (!primitive || !primitive.type) return false;
            
            if (primitive.type === 'path') {
                return primitive.points && primitive.points.length >= 2;
            }
            
            if (primitive.type === 'circle') {
                return primitive.center && primitive.radius > 0;
            }
            
            if (primitive.type === 'arc') {
                return primitive.center && primitive.radius > 0 &&
                       primitive.startAngle !== undefined && primitive.endAngle !== undefined;
            }
            
            if (primitive.type === 'rectangle') {
                return primitive.position && primitive.width !== undefined && primitive.height !== undefined;
            }
            
            return true;
        }
        
        // Toolpath management
        async generateAllToolpaths() {
            if (this.isToolpathCacheValid && this.toolpaths.size > 0) {
                if (debugConfig.enabled) {
                    console.log('Using cached toolpaths');
                }
                return this.toolpaths;
            }
            
            if (!this.geometryProcessor) {
                console.warn('Geometry processor not available');
                return this.toolpaths;
            }
            
            this.toolpaths.clear();
            
            for (const operation of this.operations) {
                if (operation.type === 'isolation' || operation.type === 'clearing' || operation.type === 'clear') {
                    const toolpathData = await this.generateOperationToolpaths(operation);
                    if (toolpathData) {
                        this.toolpaths.set(operation.id, toolpathData);
                    }
                }
            }
            
            this.updateStatistics();
            this.isToolpathCacheValid = true;
            
            if (debugConfig.enabled) {
                console.log(`Generated ${this.stats.toolpaths} toolpaths`);
            }
            
            return this.toolpaths;
        }
        
        async generateOperationToolpaths(operation) {
            if (!operation.primitives || operation.primitives.length === 0) {
                return null;
            }
            
            const settings = operation.settings;
            if (!settings.tool) {
                console.warn(`No tool for operation ${operation.id}`);
                return null;
            }
            
            const offsets = this.calculateOffsetDistances(
                settings.tool.diameter,
                settings.passes || 1,
                settings.stepOver || 50
            );
            
            const toolpathData = {
                operationId: operation.id,
                tool: settings.tool,
                paths: []
            };
            
            for (let i = 0; i < offsets.length; i++) {
                toolpathData.paths.push({
                    offset: offsets[i],
                    pass: i + 1,
                    primitives: []
                });
            }
            
            return toolpathData;
        }
        
        calculateOffsetDistances(toolDiameter, passes, stepOverPercent) {
            const stepOver = stepOverPercent / 100;
            const stepDistance = toolDiameter * (1 - stepOver);
            const offsets = [];
            
            for (let i = 0; i < passes; i++) {
                offsets.push(-(toolDiameter / 2 + i * stepDistance));
            }
            
            return offsets;
        }
        
        async getTransformedToolpathsForExport() {
            if (!this.isToolpathCacheValid) {
                await this.generateAllToolpaths();
            }
            
            const finalToolpaths = [];
            for (const [opId, toolpathData] of this.toolpaths) {
                finalToolpaths.push(toolpathData);
            }
            
            return finalToolpaths;
        }
        
        // Fusion for visualization (separate from offsetting)
        async fuseAllPrimitives(options = {}) {
            await this.ensureProcessorReady();
            
            if (!this.geometryProcessor) {
                throw new Error('Geometry processor not available');
            }
            
            const fusedResults = [];
            
            // Fuse each operation independently
            for (const operation of this.operations) {
                if ((operation.type === 'isolation' || operation.type === 'clear' || operation.type === 'clearing') &&
                    operation.primitives && operation.primitives.length > 0) {
                    
                    const fused = await this.geometryProcessor.fuseGeometry(operation.primitives, options);
                    
                    // Tag with operation ID
                    fused.forEach(p => {
                        if (!p.properties) p.properties = {};
                        p.properties.sourceOperationId = operation.id;
                        p.properties.operationType = operation.type;
                    });
                    
                    fusedResults.push(...fused);
                }
            }
            
            this.isToolpathCacheValid = false;
            return fusedResults;
        }
        
        updateSettings(category, settings) {
            if (this.settings[category]) {
                Object.assign(this.settings[category], settings);
                this.saveSettings();
            }
        }
        
        getSetting(category, key) {
            return this.settings[category]?.[key];
        }
        
        getProcessorStats() {
            const stats = {
                core: this.getStats(),
                hasGeometryProcessor: !!this.geometryProcessor,
                hasGeometryOffsetter: !!this.geometryOffsetter,
                processorInitialized: this.processorInitialized,
                isolationPrimitiveCount: this.getIsolationPrimitives().length,
                fuseablePrimitiveCount: this.getFuseablePrimitives().length,
                analyticPrimitives: this.stats.analyticPrimitives,
                polygonizedPrimitives: this.stats.polygonizedPrimitives,
                strokesConverted: this.stats.strokesConverted,
                toolpathCount: this.stats.toolpaths,
                hasToolLibrary: !!this.toolLibrary
            };
            
            if (this.geometryProcessor) {
                stats.geometryProcessor = this.geometryProcessor.getStats();
                stats.cachedStates = {
                    hasPreprocessed: !!this.geometryProcessor.getCachedState('preprocessedGeometry'),
                    hasFused: !!this.geometryProcessor.getCachedState('fusedGeometry')
                };
                stats.arcReconstruction = this.geometryProcessor.getArcReconstructionStats();
            }
            
            return stats;
        }
        
        // Helper to create path primitive with getBounds
        _createPathPrimitive(points, properties) {
            if (typeof PathPrimitive !== 'undefined') {
                return new PathPrimitive(points, properties);
            }
            
            return {
                type: 'path',
                points: points,
                properties: properties || {},
                closed: properties?.closed !== false,
                getBounds: function() {
                    if (this.points.length === 0) {
                        return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
                    }
                    let minX = Infinity, minY = Infinity;
                    let maxX = -Infinity, maxY = -Infinity;
                    this.points.forEach(p => {
                        minX = Math.min(minX, p.x);
                        minY = Math.min(minY, p.y);
                        maxX = Math.max(maxX, p.x);
                        maxY = Math.max(maxY, p.y);
                    });
                    return { minX, minY, maxX, maxY };
                }
            };
        }
    }
    
    window.PCBCamCore = PCBCamCore;
    
})();