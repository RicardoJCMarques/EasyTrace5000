/**
 * @file        cam-core.js
 * @description Core application logic
 * @author      Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

/*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2025 Eltryus
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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
                        icon: op.icon || 'ðŸ“„',
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
                    console.error(`âŒ ${className} not available`);
                    allAvailable = false;
                } else if (debugConfig.enabled) {
                    console.log(`âœ… ${className} available`);
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
                        console.log('Clipper2 initialized');
                    }
                    return true;
                } catch (error) {
                    console.error('Clipper2 initialization failed:', error);
                    this.processorInitialized = false;
                    return false;
                } finally {
                    this.isInitializing = false;
                }
            }
            
            console.error('GeometryProcessor not available');
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
                const fileName = operation.file.name.toLowerCase();
                
                // === START MODIFICATION (Refined Logic) ===
                if (fileName.endsWith('.svg')) {
                    if (typeof SVGParser === 'undefined') {
                        throw new Error('SVG parser not available');
                    }
                    const parser = new SVGParser({ debug: debugConfig.enabled });
                    // The new SVGParser returns the same structure as GerberParser,
                    // so we can use its result directly.
                    parseResult = parser.parse(operation.file.content);
                } else if (operation.type === 'drill') {
                // === END MODIFICATION ===
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
                
                // The plotter now receives a consistent input format regardless of the source.
                operation.parsed = parseResult;
                
                if (typeof ParserPlotter === 'undefined') {
                    throw new Error('Plotter not available');
                }
                const plotter = new ParserPlotter({
                    debug: debugConfig.enabled,
                    markStrokes: true
                });
                
                // The plotter expects the full parseResult object, which contains `layers` or `drillData`
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
            if (!primitives || primitives.length < 2) {
                return primitives;
            }

            // This function acts as the entry point for the new merging logic.
            // It attempts to stitch lines and arcs into a closed path.
            const mergedPath = this.mergeSegmentsIntoClosedPath(primitives);

            if (mergedPath) {
                if (debugConfig.enabled) {
                    console.log(`[Core] Implicit region closure successful. Replaced ${primitives.length} segments with 1 closed path.`);
                }
                // Important: We return an array containing the SINGLE new primitive.
                return [mergedPath];
            }

            if (debugConfig.enabled) {
                console.warn('[Core] Implicit region closure failed. Outline may have gaps. Rendering individual segments.');
            }
            // If merging fails, return the original segments so the user can see the issue.
            return primitives;
        }

        mergeSegmentsIntoClosedPath(segments) {
            if (!segments || segments.length < 2) {
                return null;
            }

            const precision = geomConfig.coordinatePrecision || 0.001;
            const usedIndices = new Set();
            const stitchedPoints = [];

            // Helper to get start/end points from any primitive type
            const getEndpoints = (prim) => {
                if (prim.type === 'arc') {
                    return { start: prim.startPoint, end: prim.endPoint };
                }
                if (prim.type === 'path' && prim.points.length >= 2) {
                    return { start: prim.points[0], end: prim.points[prim.points.length - 1] };
                }
                return null;
            };

            // Helper to get polygonized points from a primitive
            const getPoints = (prim) => {
                if (prim.type === 'arc') {
                    // Polygonize the arc to get its points
                    return prim.toPolygon().points;
                }
                return prim.points;
            };
            
            // Start with the first segment
            let currentSegment = segments[0];
            stitchedPoints.push(...getPoints(currentSegment));
            usedIndices.add(0);

            // Loop until we can't connect any more segments
            let connectionsMade;
            do {
                connectionsMade = false;
                const lastPoint = stitchedPoints[stitchedPoints.length - 1];

                for (let i = 0; i < segments.length; i++) {
                    if (usedIndices.has(i)) {
                        continue;
                    }

                    const nextSegment = segments[i];
                    const endpoints = getEndpoints(nextSegment);
                    if (!endpoints) continue;

                    let segmentToAdd = nextSegment;
                    let reversed = false;

                    // Check for connection: current_end -> next_start
                    if (Math.hypot(endpoints.start.x - lastPoint.x, endpoints.start.y - lastPoint.y) < precision) {
                        // Correct direction, do nothing
                    }
                    // Check for connection: current_end -> next_end (requires reversal)
                    else if (Math.hypot(endpoints.end.x - lastPoint.x, endpoints.end.y - lastPoint.y) < precision) {
                        reversed = true;
                        if (nextSegment.type === 'arc') {
                            segmentToAdd = nextSegment.reverse();
                        }
                    }
                    // No connection found with this segment
                    else {
                        continue;
                    }

                    let pointsToAdd = getPoints(segmentToAdd);
                    if (reversed && segmentToAdd.type === 'path') {
                        pointsToAdd = [...pointsToAdd].reverse();
                    }

                    // Append points (excluding the first point, which is a duplicate of the last)
                    stitchedPoints.push(...pointsToAdd.slice(1));
                    usedIndices.add(i);
                    connectionsMade = true;
                    break; // Restart search from the beginning
                }
            } while (connectionsMade && usedIndices.size < segments.length);

            // After looping, check if we used all segments and if the path is closed
            if (usedIndices.size !== segments.length) {
                console.warn(`[Core] Failed to merge all segments. Only used ${usedIndices.size}/${segments.length}. The outline is likely open or has multiple separate contours.`);
                return null;
            }

            const firstPoint = stitchedPoints[0];
            const finalPoint = stitchedPoints[stitchedPoints.length - 1];
            const isClosed = Math.hypot(firstPoint.x - finalPoint.x, firstPoint.y - finalPoint.y) < precision;

            if (!isClosed) {
                console.warn('[Core] Merged segments do not form a closed path.');
                return null;
            }
            
            // Clean up the final point if it's a duplicate of the first
            if (isClosed) {
                stitchedPoints.pop();
            }

            // Success! Create a new, single PathPrimitive.
            return new PathPrimitive(stitchedPoints, {
                isCutout: true,
                fill: true,
                stroke: false,
                closed: true,
                mergedFromSegments: segments.length,
                polarity: 'dark' // Cutouts are dark polarity geometry
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
        // UNIFIED OFFSET PIPELINE: Bidirectional inflation with winding selection
        // =====================================================================
        
        // Calculate signed area of a polygon
        calculateSignedArea(points) {
            if (!points || points.length < 3) return 0;
            
            let area = 0;
            for (let i = 0; i < points.length; i++) {
                const j = (i + 1) % points.length;
                area += points[i].x * points[j].y;
                area -= points[j].x * points[i].y;
            }
            return area / 2;
        }
        
        async generateOffsetGeometry(operation, offsetDistances, settings) {
            console.log(`[Core] === REVISED OFFSET PIPELINE START ===`);
            console.log(`[Core] Operation: ${operation.id} (${operation.type})`);
            
            await this.ensureProcessorReady();
            if (!this.geometryOffsetter || !this.geometryProcessor) {
                throw new Error('Geometry processors not initialized');
            }
            if (!operation.primitives || operation.primitives.length === 0) {
                return [];
            }
            
            const outerContours = [];
            const holeContours = [];
            
            operation.primitives.forEach(primitive => {
            if (primitive.contours && primitive.contours.length > 0) {
                primitive.contours.forEach(contour => {
                    const contourPrimitive = this._createPathPrimitive(contour.points, {
                        ...primitive.properties,
                        polarity: contour.isHole ? 'clear' : 'dark',
                        // ADD: Preserve curve metadata from contours
                        curveIds: contour.curveIds || []
                    });
                    // ADD: Transfer point-level curve metadata
                    contourPrimitive.points = contour.points; // Preserves curveId tags on points
                    
                    if (contour.isHole) {
                        holeContours.push(contourPrimitive);
                    } else {
                        outerContours.push(contourPrimitive);
                    }
                });
            } else {
                outerContours.push(primitive);
            }
        });
            
            console.log(`[Core] Separated into ${outerContours.length} outer contours and ${holeContours.length} hole contours.`);
            
            operation.offsets = [];
            const passResults = [];
            
            for (let passIndex = 0; passIndex < offsetDistances.length; passIndex++) {
                const distance = offsetDistances[passIndex];
                const offsetType = distance >= 0 ? 'external' : 'internal';
                
                console.log(`[Core] --- PASS ${passIndex + 1}/${offsetDistances.length}: ${distance.toFixed(3)}mm (${offsetType}) ---`);
                
                const offsetOuters = [];
                for (const primitive of outerContours) {
                    const result = await this.geometryOffsetter.offsetPrimitive(primitive, distance, settings);
                    if (result) {
                        Array.isArray(result) ? offsetOuters.push(...result) : offsetOuters.push(result);
                    }
                }
                
                const offsetHoles = [];
                for (const primitive of holeContours) {
                    const result = await this.geometryOffsetter.offsetPrimitive(primitive, -distance, settings);
                    if (result) {
                        Array.isArray(result) ? offsetHoles.push(...result) : offsetHoles.push(result);
                    }
                }
                
                console.log(`[Core] Offset generated: ${offsetOuters.length} outer shapes, ${offsetHoles.length} hole shapes.`);
                
                const polygonizedOuters = offsetOuters.map(p => this.geometryProcessor.standardizePrimitive(p)).filter(Boolean);
                const polygonizedHoles = offsetHoles.map(p => this.geometryProcessor.standardizePrimitive(p)).filter(Boolean);

                console.log(`[Core] Polygonized to: ${polygonizedOuters.length} outer paths, ${polygonizedHoles.length} hole paths.`);

                if (polygonizedOuters.length === 0) {
                    console.warn(`[Core] Pass ${passIndex + 1} produced no valid outer geometry. Skipping.`);
                    continue;
                }

                const subjectGeometry = await this.geometryProcessor.unionGeometry(polygonizedOuters);
                console.log(`[Core] Union of outers resulted in ${subjectGeometry.length} subject shape(s).`);

                let finalPassGeometry;
                if (polygonizedHoles.length > 0) {
                    const clipGeometry = await this.geometryProcessor.unionGeometry(polygonizedHoles);
                    console.log(`[Core] Union of holes resulted in ${clipGeometry.length} clip shape(s).`);
                    console.log(`[Core] Performing DIFFERENCE operation...`);
                    finalPassGeometry = await this.geometryProcessor.difference(subjectGeometry, clipGeometry);
                } else {
                    finalPassGeometry = subjectGeometry;
                }
                
                console.log(`[Core] Boolean operations complete. Final geometry has ${finalPassGeometry.length} primitive(s).`);

                console.log(`[Core] Running arc reconstruction...`);
                let reconstructedGeometry = this.geometryProcessor.arcReconstructor.processForReconstruction(finalPassGeometry);
                console.log(`[Core] Arc reconstruction complete. Primitive count: ${reconstructedGeometry.length}`);
                
                reconstructedGeometry = reconstructedGeometry.map(p => {
                    if (!p.properties) p.properties = {};
                    p.properties.isOffset = true;
                    p.properties.pass = passIndex + 1;
                    p.properties.offsetDistance = distance;
                    p.properties.offsetType = offsetType;
                    return p;
                });

                passResults.push({
                    distance: distance,
                    pass: passIndex + 1,
                    offsetType: offsetType,
                    primitives: reconstructedGeometry,
                    metadata: {
                        sourceCount: operation.primitives.length,
                        offsetCount: offsetOuters.length + offsetHoles.length,
                        unionCount: subjectGeometry.length,
                        finalCount: reconstructedGeometry.length,
                        generatedAt: Date.now(),
                        toolDiameter: settings.tool?.diameter
                    }
                });
            }
            
            if (settings.combineOffsets && passResults.length > 1) {
                console.log(`[Core] === COMBINING ${passResults.length} PASSES ===`);
                
                const allPassPrimitives = passResults.flatMap(p => p.primitives);
                
                console.log(`[Core] Combined ${allPassPrimitives.length} total primitives`);
                
                operation.offsets = [{
                    id: `offset_combined_${operation.id}`,
                    distance: offsetDistances[0],
                    pass: 1,
                    primitives: allPassPrimitives,
                    combined: true,
                    passes: passResults.length,
                    settings: { ...settings },
                    metadata: {
                       sourceCount: operation.primitives.length,
                        totalPrimitives: allPassPrimitives.length,
                        passCount: passResults.length,
                        generatedAt: Date.now(),
                        toolDiameter: settings.tool?.diameter
                    }
                }];
            } else {
                operation.offsets = passResults.map((passResult, index) => ({
                    id: `offset_${operation.id}_${index}`,
                    ...passResult,
                    settings: { ...settings }
                }));
            }
            
            const totalPrimitives = operation.offsets.reduce((sum, o) => sum + o.primitives.length, 0);
            console.log(`[Core] === REVISED OFFSET PIPELINE COMPLETE ===`);
            console.log(`[Core] Generated ${operation.offsets.length} offset group(s), ${totalPrimitives} total primitives.`);
            
            this.isToolpathCacheValid = false;
            return operation.offsets;
        }
        
        // Calculate offset distances with proper sign
        calculateOffsetDistances(toolDiameter, passes, stepOverPercent, isInternal = false) {
            const stepOver = stepOverPercent / 100;
            const stepDistance = toolDiameter * (1 - stepOver);
            const offsets = [];
            
            // External offsets are negative, internal offsets are positive
            const sign = isInternal ? -1 : 1;
            
            for (let i = 0; i < passes; i++) {
                offsets.push(sign * (toolDiameter / 2 + i * stepDistance));
            }
            
            return offsets;
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
                if (operation.type === 'isolation' || operation.type === 'clear') {
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
            
            const isInternal = operation.type === 'clear';
            const offsets = this.calculateOffsetDistances(
                settings.tool.diameter,
                settings.passes || 1,
                settings.stepOver || 50,
                isInternal
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
        
        // Fusion for visualization
        async fuseAllPrimitives(options = {}) {
            await this.ensureProcessorReady();

            console.log('[Core] fuseAllPrimitives() - Entered fuseAllPrimitives. Received options:', options);

            
            if (!this.geometryProcessor) {
                throw new Error('Geometry processor not available');
            }
            
            const fusedResults = [];
            
            for (const operation of this.operations) {
                if ((operation.type === 'isolation' || operation.type === 'clear') &&
                    operation.primitives && operation.primitives.length > 0) {
                    
                    const fused = await this.geometryProcessor.fuseGeometry(operation.primitives, options);
                    
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
                contours: properties?.contours || [{
                    points: points,
                    nestingLevel: 0,
                    isHole: false,
                    parentId: null
                }],
                getBounds: function() {
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    this.contours.forEach(c => {
                        c.points.forEach(p => {
                            minX = Math.min(minX, p.x);
                            minY = Math.min(minY, p.y);
                            maxX = Math.max(maxX, p.x);
                            maxY = Math.max(maxY, p.y);
                        });
                    });
                    return { minX, minY, maxX, maxY };
                }
            };
        }
    }
    
    window.PCBCamCore = PCBCamCore;
    
})();