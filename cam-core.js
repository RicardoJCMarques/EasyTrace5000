// cam-core.js - Core PCB CAM application logic - FIXED: State isolation and cutout filtering
// Handles data management, parsing, and core operations

class PCBCamCore {
    constructor() {
        // Core data
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
        
        // FIXED: Don't share parser instances - create new ones for each operation
        // This prevents state contamination between files
        
        // Settings
        this.settings = this.loadSettings();
        
        // Statistics
        this.stats = {
            totalPrimitives: 0,
            operations: 0,
            layers: 0,
            holes: 0
        };
        
        // Coordinate system (will be set by UI)
        this.coordinateSystem = null;
        
        this.initializeProcessors();
    }
    
    initializeProcessors() {
        // FIXED: Only check if classes are available, don't create instances
        // We'll create fresh instances for each parse operation
        
        if (typeof GerberSemanticParser !== 'undefined') {
            console.log('✅ GerberSemanticParser available');
        } else {
            console.error('❌ GerberSemanticParser not available');
        }
        
        if (typeof ExcellonSemanticParser !== 'undefined') {
            console.log('✅ ExcellonSemanticParser available');
        } else {
            console.error('❌ ExcellonSemanticParser not available');
        }
        
        if (typeof GerberPlotter !== 'undefined') {
            console.log('✅ GerberPlotter available');
        } else {
            console.error('❌ GerberPlotter not available');
        }
        
        if (typeof GeometryProcessor !== 'undefined') {
            this.geometryProcessor = new GeometryProcessor({ debug: false });
            console.log('✅ GeometryProcessor initialized');
        } else {
            console.error('❌ GeometryProcessor not available');
        }
        
        console.log('PCBCamCore processors initialized');
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
    
    async parseOperation(operation) {
        try {
            console.log(`Parsing ${operation.file.name}...`);
            
            let parseResult;
            
            // FIXED: Create fresh parser instances for each file to prevent state contamination
            if (operation.type === 'drill') {
                if (typeof ExcellonSemanticParser === 'undefined') {
                    throw new Error('Excellon parser not available');
                }
                const excellonParser = new ExcellonSemanticParser({ debug: false });
                parseResult = excellonParser.parse(operation.file.content);
            } else {
                if (typeof GerberSemanticParser === 'undefined') {
                    throw new Error('Gerber parser not available');
                }
                const gerberParser = new GerberSemanticParser({ debug: false });
                parseResult = gerberParser.parse(operation.file.content);
            }
            
            if (!parseResult.success) {
                operation.error = parseResult.errors.join('; ');
                return false;
            }
            
            operation.parsed = parseResult;
            
            // FIXED: Create fresh plotter instance for each file
            if (typeof GerberPlotter === 'undefined') {
                throw new Error('Plotter not available');
            }
            const plotter = new GerberPlotter({ debug: false });
            
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
            
            // FIXED: Special handling for cutout - don't filter aggressively
            let primitives = plotResult.primitives;
            if (operation.type === 'cutout') {
                // Just mark cutout primitives, don't filter them
                primitives = this.processCutoutPrimitives(primitives);
                console.log(`Cutout processing: ${plotResult.primitives.length} primitives retained`);
            }
            
            // Validate primitive structure before storing
            const validPrimitives = primitives.filter((primitive, index) => {
                try {
                    // Check if primitive has required methods
                    if (typeof primitive.getBounds !== 'function') {
                        console.warn(`Primitive ${index} missing getBounds method`);
                        return false;
                    }
                    
                    // Check if bounds are valid
                    const bounds = primitive.getBounds();
                    if (!isFinite(bounds.minX) || !isFinite(bounds.minY) || 
                        !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                        console.warn(`Primitive ${index} has invalid bounds:`, bounds);
                        return false;
                    }
                    
                    return true;
                } catch (error) {
                    console.warn(`Primitive ${index} validation failed:`, error);
                    return false;
                }
            });
            
            if (validPrimitives.length !== primitives.length) {
                console.warn(`Filtered out ${primitives.length - validPrimitives.length} invalid primitives`);
            }
            
            operation.primitives = validPrimitives;
            operation.bounds = this.recalculateBounds(validPrimitives);
            
            // Add operation type to all primitives
            if (operation.primitives) {
                operation.primitives.forEach(primitive => {
                    if (!primitive.properties) {
                        primitive.properties = {};
                    }
                    // FIXED: Ensure each primitive is marked with its operation type
                    primitive.properties.operationType = operation.type;
                    primitive.properties.operationId = operation.id;
                    primitive.properties.layerType = operation.type === 'drill' ? 'drill' : operation.type;
                });
            }
            
            this.updateStatistics();
            operation.processed = true;
            
            console.log(`Successfully parsed ${operation.file.name}: ${operation.primitives.length} primitives`);
            return true;
            
        } catch (error) {
            operation.error = error.message;
            console.error(`Error processing ${operation.file.name}:`, error);
            return false;
        }
    }
    
    /**
     * FIXED: Process cutout primitives without aggressive filtering
     * Just mark them appropriately for rendering
     */
    processCutoutPrimitives(primitives) {
        if (!primitives || primitives.length === 0) return primitives;
        
        console.log(`Processing cutout primitives: ${primitives.length} total`);
        
        // Count primitive types
        const typeCount = {};
        primitives.forEach(p => {
            typeCount[p.type] = (typeCount[p.type] || 0) + 1;
        });
        console.log('Cutout primitive types:', typeCount);
        
        // Find all closed paths (these form the board outline)
        const closedPaths = [];
        const otherPrimitives = [];
        
        primitives.forEach(p => {
            if (p.type === 'path' && p.closed && p.points && p.points.length >= 3) {
                closedPaths.push(p);
            } else {
                otherPrimitives.push(p);
            }
        });
        
        console.log(`Found ${closedPaths.length} closed paths in cutout layer`);
        
        // Calculate areas for debugging
        closedPaths.forEach((path, index) => {
            const area = this.calculatePathArea(path.points);
            console.log(`Path ${index}: ${path.points.length} points, area: ${area.toFixed(2)} mm²`);
            
            // Mark all closed paths as potential board outline components
            if (!path.properties) {
                path.properties = {};
            }
            path.properties.isBoardOutline = true;
            path.properties.outlineArea = Math.abs(area);
        });
        
        // FIXED: Return ALL primitives, not just the largest one
        // The board outline might consist of multiple paths (e.g., rectangular with rounded corners)
        const allCutoutPrimitives = [...closedPaths, ...otherPrimitives];
        
        // Mark all primitives as cutout type
        allCutoutPrimitives.forEach(p => {
            if (!p.properties) {
                p.properties = {};
            }
            p.properties.isCutout = true;
            // Ensure cutout paths are stroked, not filled
            if (p.type === 'path') {
                p.properties.fill = false;
                p.properties.stroke = true;
                p.properties.strokeWidth = 0.1;
            }
        });
        
        console.log(`Cutout processing complete: ${allCutoutPrimitives.length} primitives retained`);
        
        return allCutoutPrimitives;
    }
    
    /**
     * Calculate the area of a closed path (signed area)
     */
    calculatePathArea(points) {
        if (!points || points.length < 3) return 0;
        
        let area = 0;
        for (let i = 0; i < points.length; i++) {
            const j = (i + 1) % points.length;
            area += points[i].x * points[j].y;
            area -= points[j].x * points[i].y;
        }
        
        return area / 2; // Return signed area
    }
    
    /**
     * Recalculate bounds for filtered primitives
     */
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
    
    /**
     * FIXED: Get primitives only from isolation operations for fusion
     */
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
    
    // FIXED: Enhanced fusion operations that only fuse isolation layer
    fuseAllPrimitives() {
        if (!this.geometryProcessor) {
            throw new Error('Geometry processor not available');
        }
        
        // FIXED: Only fuse isolation layer primitives
        const isolationPrimitives = this.getIsolationPrimitives();
        
        if (isolationPrimitives.length === 0) {
            console.log('No isolation primitives to fuse');
            return [];
        }
        
        console.log(`Fusing ${isolationPrimitives.length} isolation primitives...`);
        
        try {
            const fused = this.geometryProcessor.fuseGeometry(isolationPrimitives);
            console.log(`Fusion complete: ${fused.length} primitives`);
            
            // Validate fusion result
            if (typeof DimensionalValidator !== 'undefined') {
                const validation = DimensionalValidator.validateFusionResult(isolationPrimitives, fused);
                if (validation.ratio > 2.0) { // More than 200% area change is suspicious
                    console.warn('Very large area change during fusion - check for geometry issues');
                }
            }
            
            return fused;
        } catch (error) {
            console.error('Fusion operation failed:', error);
            throw error;
        }
    }
    
    // Prepare geometry for offset generation
    prepareForOffsetGeneration() {
        if (!this.geometryProcessor) {
            throw new Error('Geometry processor not available');
        }
        
        const fusedPrimitives = this.fuseAllPrimitives();
        return this.geometryProcessor.prepareForOffset(fusedPrimitives);
    }
    
    // Generate offset geometry for toolpaths
    generateOffsetGeometry(offsetDistance, options = {}) {
        if (!this.geometryProcessor) {
            throw new Error('Geometry processor not available');
        }
        
        const preparedGeometry = this.prepareForOffsetGeneration();
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
            isolationPrimitiveCount: this.getIsolationPrimitives().length
        };
        
        if (this.geometryProcessor) {
            stats.geometryProcessor = this.geometryProcessor.getStats();
        }
        
        return stats;
    }
    
    // FIXED: Debug function to check for layer contamination
    checkLayerContamination() {
        console.log('🔍 Checking for layer contamination...');
        console.log('=====================================');
        
        const operationPrimitives = new Map();
        
        // Collect all primitives by operation
        this.operations.forEach(op => {
            if (op.primitives) {
                operationPrimitives.set(op.id, {
                    type: op.type,
                    name: op.file.name,
                    primitives: op.primitives,
                    count: op.primitives.length
                });
            }
        });
        
        // Check each operation's primitives
        operationPrimitives.forEach((opData, opId) => {
            console.log(`\n📄 Operation: ${opData.type} - ${opData.name}`);
            console.log(`   Total primitives: ${opData.count}`);
            
            // Check if primitives are properly marked
            const properlyMarked = opData.primitives.filter(p => 
                p.properties?.operationType === opData.type
            ).length;
            
            const wronglyMarked = opData.primitives.filter(p => 
                p.properties?.operationType && p.properties.operationType !== opData.type
            );
            
            console.log(`   ✅ Properly marked: ${properlyMarked}/${opData.count}`);
            
            if (wronglyMarked.length > 0) {
                console.warn(`   ❌ CONTAMINATION: ${wronglyMarked.length} primitives with wrong operation type!`);
                const wrongTypes = new Set(wronglyMarked.map(p => p.properties.operationType));
                console.warn(`      Wrong types found: ${Array.from(wrongTypes).join(', ')}`);
            }
            
            // Count primitive types
            const typeCount = {};
            opData.primitives.forEach(p => {
                typeCount[p.type] = (typeCount[p.type] || 0) + 1;
            });
            console.log(`   Primitive types:`, typeCount);
            
            // Check for specific contamination patterns
            if (opData.type === 'clear') {
                const textPrimitives = opData.primitives.filter(p => 
                    p.properties?.isText || p.properties?.function === 'Legend'
                );
                if (textPrimitives.length > 0) {
                    console.warn(`   ⚠️ Found ${textPrimitives.length} text primitives in clear layer`);
                }
            }
        });
        
        return operationPrimitives;
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PCBCamCore;
} else {
    window.PCBCamCore = PCBCamCore;
}