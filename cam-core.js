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

    const config = window.PCBCAMConfig;
    const geomConfig = config.geometry;
    const machineConfig = config.machine;
    const gcodeConfig = config.gcode;
    const opsConfig = config.operations;
    const debugConfig = config.debug;

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
                        color: op.color || '#888888' // Review - color and icon/emoji
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

            this.initializeProcessors();
        }

        async initializeProcessors() {
            if (this.isInitializing || this.isInitialized) {
                console.log('Processors already initializing or initialized');
                return this.initializationPromise || true;
            }

            this.isInitializing = true;

            this.debug('Initializing processors with Clipper2...');

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
                    console.error(`❌ ${className} not available`); // Review - replace emoji for character like ✓
                    allAvailable = false;
                } else this.debug(`✓ ${className} available`);

            });

            if (!allAvailable) {
                this.isInitializing = false;
                return false;
            }

            // Initialize GeometryProcessor
            if (typeof GeometryProcessor !== 'undefined') {
                this.geometryProcessor = new GeometryProcessor({
                    scale: geomConfig.clipperScale,
                    preserveOriginals: true
                });

                // Initialize GeometryOffsetter
                if (typeof GeometryOffsetter !== 'undefined') {
                    this.geometryOffsetter = new GeometryOffsetter({
                        precision: geomConfig.coordinatePrecision,
                        miterLimit: geomConfig.offsetting?.miterLimit
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
                    this.debug('Clipper2 initialized');
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
            this.debug('Tool library set');
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
                    safeZ: machineConfig.heights.safeZ,
                    travelZ: machineConfig.heights.travelZ,
                    rapidFeed: machineConfig.speeds?.rapidFeed,
                    workCoordinateSystem: machineConfig.workspace.system,
                    maxX: machineConfig.workspace?.maxX,
                    maxY: machineConfig.workspace?.maxY
                },
                gcode: {
                    postProcessor: gcodeConfig.postProcessor,
                    startCode: config.getGcodeTemplate ?
                        config.getGcodeTemplate(gcodeConfig.postProcessor, 'start') :
                        (gcodeConfig.templates?.[gcodeConfig.postProcessor]?.start),
                    endCode: config.getGcodeTemplate ?
                        config.getGcodeTemplate(gcodeConfig.postProcessor, 'end') :
                        (gcodeConfig.templates?.[gcodeConfig.postProcessor]?.end),
                    units: gcodeConfig.units
                },
                ui: {
                    theme: config.ui?.theme,
                    showTooltips: config.ui?.showTooltips !== false
                },
                geometry: {
                    preserveArcs: geomConfig.preserveArcs !== false,
                    adaptiveSegmentation: geomConfig.segments.adaptiveSegmentation !== false,
                    targetSegmentLength: geomConfig.segments.targetLength
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
                parsed: null,
                primitives: null,
                bounds: null,
                error: null,
                warnings: null,
                expanded: false,
                processed: false,
                color: fileType?.color || opConfig.color,
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

                if (fileName.endsWith('.svg')) {
                    if (typeof SVGParser === 'undefined') {
                        throw new Error('SVG parser not available');
                    }
                    const parser = new SVGParser();
                    parseResult = parser.parse(operation.file.content);
                } else if (operation.type === 'drill') {
                    if (typeof ExcellonParser === 'undefined') {
                        throw new Error('Excellon parser not available');
                    }
                    const parser = new ExcellonParser();
                    parseResult = parser.parse(operation.file.content);
                } else {
                    if (typeof GerberParser === 'undefined') {
                        throw new Error('Gerber parser not available');
                    }
                    const parser = new GerberParser();
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
                    markStrokes: true
                });

                const plotResult = plotter.plot(parseResult);

                if (!plotResult.success) {
                    operation.error = plotResult.error;
                    return false;
                }

                let primitives = plotResult.primitives;

                //Debug check
                const polarityCounts = primitives.reduce((acc, p) => {
                    const polarity = p.properties?.polarity || 'dark';
                    acc[polarity] = (acc[polarity] || 0) + 1;
                    return acc;
                }, {});

                this.debug(`Plotter returned ${primitives.length} primitives. Polarities:`, polarityCounts);

                if (operation.type === 'cutout') {
                    if (primitives.length > 1) {
                        const merged = GeometryUtils.mergeSegmentsIntoClosedPath(primitives);
                        if (merged) {
                            this.debug(`Merged ${primitives.length} cutout segments into 1 closed path`);
                            primitives = [merged];
                        }
                    }
                }

                primitives = primitives.map(primitive => {
                    if (!primitive.properties) primitive.properties = {};
                    // Respect the polarity from the plotter, only default to 'dark' if it's not already set.
                    if (primitive.properties.polarity === undefined) {
                        primitive.properties.polarity = 'dark';
                    }
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

        getPreprocessedPrimitives() {
            if (!this.geometryProcessor) return [];
            return this.geometryProcessor.getCachedState('preprocessedGeometry') || [];
        }

        getFuseablePrimitives() {
            const primitives = [];
            this.operations.forEach(op => {
                if ((op.type === 'isolation' || op.type === 'clearing') && 
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

        async generateOffsetGeometry(operation, settings) {
            this.debug(`=== OFFSET PIPELINE START ===`);
            this.debug(`Operation: ${operation.id} (${operation.type})`);

            await this.ensureProcessorReady();
            if (!this.geometryOffsetter || !this.geometryProcessor) {
                throw new Error('Geometry processors not initialized');
            }
            if (!operation.primitives || operation.primitives.length === 0) {
                return [];
            }

            // Determine Direction and Mode based on Operation and Cut Side
            let isInternal = operation.type === 'clearing';
            let isOnLine = false;

            if (operation.type === 'cutout') {
                // Respect the UI dropdown for Cutouts
                if (settings.cutSide === 'inside') {
                    isInternal = true;
                } else if (settings.cutSide === 'on') {
                    isOnLine = true;
                }
                // 'outside' leaves isInternal as false
            }

            let offsetDistances;

            // Calculate Distances
            if (isOnLine) {
                // "On Line" means exactly 0 offset. 
                offsetDistances = [0];
            } else {
                // Standard calculation for Inside (-) or Outside (+) offsets
                offsetDistances = this._calculateOffsetDistances(
                    settings.toolDiameter,
                    settings.passes,
                    settings.stepOver,
                    isInternal
                );
            }

            const outerContours = [];
            const holeContours = [];

            operation.primitives.forEach(primitive => {
                const primitivePolarity = primitive.properties?.polarity || 'dark';

                if (primitive.contours && primitive.contours.length > 1) {
                    primitive.contours.forEach(contour => {
                        const simplePrimitive = new PathPrimitive([contour], {
                            ...primitive.properties,
                            polarity: contour.isHole ? 'clear' : 'dark'
                        });

                        if (contour.isHole) {
                            holeContours.push(simplePrimitive);
                        } else {
                            outerContours.push(simplePrimitive);
                        }
                    });
                } else if (primitive.contours && primitive.contours.length === 1) {
                    if (primitivePolarity === 'clear') {
                        holeContours.push(primitive);
                    } else {
                        outerContours.push(primitive);
                    }
                } else {
                    // This handles non-Path primitives like Circle, Rectangle
                    if (primitivePolarity === 'clear') {
                        holeContours.push(primitive);
                    } else {
                        outerContours.push(primitive);
                    }
                }
            });

            this.debug(`Separated into ${outerContours.length} outer contours and ${holeContours.length} hole contours.`);

            operation.offsets = [];
            const passResults = [];

            for (let passIndex = 0; passIndex < offsetDistances.length; passIndex++) {
                const distance = offsetDistances[passIndex];
                const offsetType = distance >= 0 ? 'external' : 'internal';

                this.debug(`--- PASS ${passIndex + 1}/${offsetDistances.length}: ${distance.toFixed(3)}mm (${offsetType}) ---`);

                const offsetOuters = [];
                for (const primitive of outerContours) {
                    const role = primitive.properties?.role;

                    if (role === 'drill_hole' || role ==='drill_slot') {
                        continue;
                    }

                    const result = await this.geometryOffsetter.offsetPrimitive(primitive, distance);
                    if (result) {
                        Array.isArray(result) ? offsetOuters.push(...result) : offsetOuters.push(result);
                    } else {
                        console.warn(`[Core] Offset failed for primitive type: ${primitive.type}, id: ${primitive.id}`);
                    }
                }

                const offsetHoles = [];
                for (const primitive of holeContours) {
                    const result = await this.geometryOffsetter.offsetPrimitive(primitive, -distance); 
                    if (result) {
                        Array.isArray(result) ? offsetHoles.push(...result) : offsetHoles.push(result);
                    }
                }

                this.debug(`Offset generated: ${offsetOuters.length} outer shapes, ${offsetHoles.length} hole shapes.`);

                let finalPassGeometry;

                // The boolean pipeline is only needed if there are holes to subtract or if multiple outer shapes need to be merged.
                // If it's just 1 outer shape and 0 holes, skip the pipeline.
                const needsBoolean = offsetHoles.length > 0 || offsetOuters.length > 1;
                if (!needsBoolean) {
                    this.debug(`Single offset result (${offsetOuters.length} shape), skipping boolean operations`);
                    finalPassGeometry = offsetOuters;
                } else {
                    this.debug(`Running boolean operations...`);
                    const subjectGeometry = await this.geometryProcessor.unionGeometry(offsetOuters);
                    this.debug(`Union of outers resulted in ${subjectGeometry.length} subject shape(s).`);

                    if (offsetHoles.length > 0) {
                        const clipGeometry = await this.geometryProcessor.unionGeometry(offsetHoles);
                        this.debug(`Union of holes resulted in ${clipGeometry.length} clip shape(s).`);
                        finalPassGeometry = await this.geometryProcessor.difference(subjectGeometry, clipGeometry);
                    } else {
                        finalPassGeometry = subjectGeometry;
                    }
                }

                // Always run arc reconstruction if there are curves
                this.debug(`Running arc reconstruction...`);
                finalPassGeometry = this.geometryProcessor.arcReconstructor.processForReconstruction(finalPassGeometry);

                this.debug(`Pass complete: ${finalPassGeometry.length} primitive(s).`);

                const reconstructedGeometry = finalPassGeometry.map(p => {
                    if (!p.properties) p.properties = {};
                    p.properties.isOffset = true;
                    p.properties.pass = passIndex + 1;
                    p.properties.offsetDistance = distance;
                    p.properties.offsetType = offsetType;
                    // Check if the geometry has arcs after all processing
                    p.properties.hasAnalyticArcs = (p.type === 'circle') || (p.arcSegments && p.arcSegments.length > 0);
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
                        finalCount: reconstructedGeometry.length,
                        generatedAt: Date.now(),
                        toolDiameter: settings.toolDiameter,
                        analytic: !needsBoolean
                    }
                });
            }

            if (settings.combineOffsets && passResults.length > 1) {
                const allPassPrimitives = passResults.flatMap(p => p.primitives);
                operation.offsets = [{
                    id: `offset_combined_${operation.id}`,
                    distance: offsetDistances[0],
                    pass: 1,
                    primitives: allPassPrimitives,
                    type: 'offset',
                    metadata: {
                        sourceCount: operation.primitives.length,
                        finalCount: allPassPrimitives.length,
                        generatedAt: Date.now(),
                        toolDiameter: settings.toolDiameter,
                        offset: {
                            combined: true,
                            passes: passResults.length,
                            offsetCount: allPassPrimitives.length
                        }
                    },
                    settings: { ...settings }
                }];
            } else {
                operation.offsets = passResults.map((passResult, index) => ({
                    id: `offset_${operation.id}_${index}`,
                    ...passResult,
                    settings: { ...settings }
                }));
            }

            const totalPrimitives = operation.offsets.reduce((sum, o) => sum + o.primitives.length, 0);
            this.debug(`Generated ${operation.offsets.length} offset group(s), ${totalPrimitives} total primitives.`);
            this.debug(`=== OFFSET PIPELINE COMPLETE ===`);

            this.isToolpathCacheValid = false;
            return operation.offsets;
        }

        _determineDrillStrategy(operation, settings) {
            const plan = [];
            const warnings = [];
            const precision = geomConfig.coordinatePrecision || 0.001;
            const toolDiameter = parseFloat(settings.toolDiameter);
            const minMillingMargin = parseFloat(opsConfig.drill?.strategy?.minMillingMargin || 0.05);

            for (const primitive of operation.primitives) {
                const role = primitive.properties?.role;

                // Inline validation
                if (role === 'drill_hole') {
                    if (primitive.type !== 'circle' || !primitive.center || !primitive.radius) {
                        console.warn(`[Core] Invalid drill hole primitive ${primitive.id}`);
                        continue;
                    }
                } else if (role === 'drill_slot') {
                    if (!primitive.properties?.originalSlot) {
                        console.warn(`[Core] Drill slot ${primitive.id} missing originalSlot data`);
                        continue;
                    }
                    const slot = primitive.properties.originalSlot;
                    if (!slot.start || !slot.end) {
                        console.warn(`[Core] Drill slot ${primitive.id} has invalid originalSlot`);
                        continue;
                    }
                } else {
                    // Not a drill primitive
                    continue;
                }
                
                let isSlot = role === 'drill_slot';
                let featureSize = primitive.properties.diameter;

                // Handle tiny slots (degenerate geometry)
                if (isSlot) {
                    const slot = primitive.properties.originalSlot;
                    if (slot) {
                        const len = Math.hypot(slot.end.x - slot.start.x, slot.end.y - slot.start.y);
                        if (len < precision) {
                            isSlot = false; // Treat as hole
                            primitive.center = slot.start;
                            if (!primitive.radius) primitive.radius = featureSize / 2;
                        }
                    }
                }

                // Calculate tool relation
                const diff = featureSize - toolDiameter;
                let toolRelation = 'exact';
                if (diff < -precision) toolRelation = 'oversized';
                else if (diff > precision) toolRelation = 'undersized';

                // Hole logic
                if (!isSlot) {
                    const pathRadius = (featureSize - toolDiameter) / 2;
                    const minHelixDia = config.toolpath.generation.drilling.minHelixDiameter;

                    if (settings.millHoles && 
                        toolRelation === 'undersized' && 
                        diff >= minMillingMargin && 
                        pathRadius >= (minHelixDia / 2)) {  // Compare radius to half the diameter threshold
                        
                        plan.push({ 
                            type: 'mill',
                            primitiveToOffset: primitive, 
                            passes: settings.passes, 
                            toolRelation 
                        });
                    } else {
                        // Too small for helix, or mill setting disabled -> Peck/Ream
                        plan.push({
                            type: 'peck',
                            position: primitive.center,
                            toolDiameter: toolDiameter,
                            originalDiameter: featureSize,
                            toolRelation: toolRelation
                        });
                    }
                }
                // Slot logic
                else {
                    const slot = primitive.properties.originalSlot;
                    if (!slot) continue;

                    const isCenterline = 
                        toolRelation === 'exact' || 
                        toolRelation === 'oversized' || 
                        (toolRelation === 'undersized' && diff < minMillingMargin);

                    if (settings.millHoles) {
                        if (isCenterline) {
                            plan.push({
                                type: 'centerline',
                                primitiveToOffset: primitive,
                                isCenterline: true,
                                toolRelation: toolRelation,
                                originalSlot: slot
                            });
                        } else {
                            plan.push({
                                type: 'mill',
                                primitiveToOffset: primitive,
                                passes: settings.passes,
                                toolRelation: 'undersized'
                            });
                        }
                    } else {
                        const proximityRisk = Math.hypot(slot.end.x - slot.start.x, slot.end.y - slot.start.y) < toolDiameter;
                        plan.push(
                            { type: 'peck', position: slot.start, toolDiameter, originalDiameter: featureSize, toolRelation },
                            { type: 'peck', position: slot.end, toolDiameter, originalDiameter: featureSize, toolRelation, reducedPlunge: proximityRisk }
                        );
                    }
                }
            }
            return { plan, warnings };
        }

        async _generateDrillGeometryFromStrategy(plan, operation, settings) {
            const strategyPrimitives = [];

            // Calculate internal offset distances for milling
            const defaultToolDiameter = opsConfig.drill.tool.diameter;
            // Review these toolDiameter fallbacks
            const toolDiameter = settings.toolDiameter || settings.tool?.diameter || defaultToolDiameter; 

            for (const action of plan) {
                if (action.type === 'peck') {
                    // Create peck mark circle
                    strategyPrimitives.push(new CirclePrimitive(
                        action.position,
                        action.toolDiameter / 2,
                        {
                            role: 'peck_mark',
                            originalDiameter: action.originalDiameter,
                            toolDiameter: action.toolDiameter,
                            toolRelation: action.toolRelation,
                            reducedPlunge: action.reducedPlunge,
                            slotPart: action.slotPart,
                            operationId: operation.id
                        }
                    ));

                } else if (action.type === 'mill') {
                    const source = action.primitiveToOffset;
                    const toolRadius = toolDiameter / 2;
                    const drillStrategyConfig = opsConfig.drill?.strategy || {};
                    const minFeatureSize = drillStrategyConfig.minMillingFeatureSize || 0.001; 

                    // A. Milling a Circular Hole
                    if (source.type === 'circle') {
                        const holeRadius = source.radius;
                        const pathRadius = holeRadius - toolRadius;

                        if (pathRadius > minFeatureSize) {
                            strategyPrimitives.push(new CirclePrimitive(
                                source.center,
                                pathRadius,
                                {
                                    role: 'drill_milling_path',
                                    operationId: operation.id,
                                    toolDiameter: toolDiameter,
                                    originalDiameter: holeRadius * 2,
                                    toolRelation: action.toolRelation || 'undersized',
                                    isOffset: true,
                                    offsetType: 'internal'

                                }
                            ));
                        } else {
                            // Hole too small to mill - fall back to peck
                            strategyPrimitives.push(new CirclePrimitive(
                                source.center,
                                toolDiameter / 2,
                                {
                                    role: 'peck_mark',
                                    originalDiameter: source.radius * 2,
                                    toolDiameter: toolDiameter,
                                    toolRelation: 'undersized_too_small',
                                    operationId: operation.id
                                }
                            ));
                        }
                    } 
                    // B. Milling a Slot (Obround)
                    else if (source.properties?.originalSlot) {
                        const originalSlot = source.properties.originalSlot;
                        const slotWidth = source.properties.diameter || source.properties.width;
                        
                        const dx = originalSlot.end.x - originalSlot.start.x;
                        const dy = originalSlot.end.y - originalSlot.start.y;
                        const slotCenterDistance = Math.hypot(dx, dy);
                        
                        const pathThickness = slotWidth - toolDiameter;
                        
                        if (pathThickness > minFeatureSize) {
                            const pathLength = slotCenterDistance + pathThickness;
                            const centerX = (originalSlot.start.x + originalSlot.end.x) / 2;
                            const centerY = (originalSlot.start.y + originalSlot.end.y) / 2;
                            
                            const angle = Math.atan2(dy, dx);
                            const cos = Math.cos(angle);
                            const sin = Math.sin(angle);
                            
                            const localHalfLength = pathLength / 2;
                            const localHalfThickness = pathThickness / 2;
                            
                            const cornerX = centerX - (localHalfLength * cos - localHalfThickness * sin);
                            const cornerY = centerY - (localHalfLength * sin + localHalfThickness * cos);
                            
                            const millingPath = new ObroundPrimitive(
                                { x: cornerX, y: cornerY },
                                pathLength,
                                pathThickness,
                                {
                                    role: 'drill_milling_path',
                                    originalDiameter: slotWidth,
                                    toolDiameter: toolDiameter,
                                    originalSlot: originalSlot,
                                    rotation: angle,
                                    toolRelation: 'undersized',
                                    operationId: operation.id,
                                    isOffset: true,
                                    offsetType: 'internal'
                                }
                            );
                            strategyPrimitives.push(millingPath);
                        } else {
                            // Slot path too thin for regular milling - fall back to centerline or peck
                            console.warn(`[Core] Slot path too thin (${pathThickness.toFixed(3)}mm), skipping milling`);
                        }
                    }
                } else if (action.type === 'centerline') {
                // Handle explicit centerline action
                const source = action.primitiveToOffset;
                const originalSlot = source.properties?.originalSlot;
                
                if (originalSlot) {
                    const millingPath = new PathPrimitive([{
                        points: [originalSlot.start, originalSlot.end],
                        isHole: false,
                        nestingLevel: 0,
                        parentId: null,
                        arcSegments: [],
                        curveIds: []
                    }], {
                        role: 'drill_milling_path',
                        isCenterlinePath: true,
                        isDrillMilling: true,
                        toolRelation: action.toolRelation,
                        originalDiameter: source.properties.diameter,
                        toolDiameter: toolDiameter,
                        operationId: operation.id,
                        originalSlot: originalSlot,
                        closed: false,
                    });
                    strategyPrimitives.push(millingPath);
                }
            }
            }

            return strategyPrimitives;
        }

        async generateDrillStrategy(operation, settings) {
            this.debug(`=== DRILL STRATEGY GENERATION ===`);
            this.debug(`Mode: ${settings.millHoles ? 'milling' : 'pecking'}`);

            // Get the plan
            const { plan, warnings } = this._determineDrillStrategy(operation, settings);
            operation.warnings = warnings;

            // Generate geometry
            const strategyGeometry = await this._generateDrillGeometryFromStrategy(
                plan, operation, settings
            );

            // Store in operation.offsets for UI compatibility // Review - where does the parameterManager come in?
            operation.offsets = [{
                id: `drill_strategy_${operation.id}`,
                distance: 0,
                pass: 1,
                primitives: strategyGeometry,
                type: 'drill',
                metadata: {
                    sourceCount: operation.primitives.length,
                    finalCount: strategyGeometry.length,
                    generatedAt: Date.now(),
                    toolDiameter: settings.toolDiameter || settings.tool?.diameter,
                    drill: {
                        mode: settings.millHoles ? 'milling' : 'pecking',
                        peckCount: strategyGeometry.filter(p => p.properties?.role === 'peck_mark').length,
                        millCount: strategyGeometry.filter(p => p.properties?.role === 'drill_milling_path').length
                    }
                },
                settings: { ...settings }
            }];

            this.isToolpathCacheValid = false;
            return operation.offsets;
        }

        /**
         * Calculates the final offset distances for a toolpath.
         */
        _calculateOffsetDistances(toolDiameter, passes, stepOverPercent, isInternal = false) {
            if (!toolDiameter || toolDiameter <= 0 || !passes || passes <= 0) {
                return []; // Invalid parameters
            }

            const stepOver = stepOverPercent / 100;
            const stepDistance = toolDiameter * (1 - stepOver);
            const offsets = [];

            // isInternal (Clearing) = -1 (shrinks)
            // !isInternal (Isolation) = 1 (grows)
            const sign = isInternal ? -1 : 1;

            for (let i = 0; i < passes; i++) {
                offsets.push(sign * (toolDiameter / 2 + i * stepDistance));
            }

            return offsets;
        }

        /**
         * Calculates the final Z-depth levels for a toolpath.
         */
        _calculateDepthLevels(cutDepth, depthPerPass, multiDepth) {
            // Ensure cutDepth is negative
            const finalDepth = Math.abs(cutDepth) * -1;
            const step = Math.abs(depthPerPass);

            if (!multiDepth || step <= 0 || Math.abs(finalDepth) <= step) {
                return [finalDepth]; // Single pass
            }

            const levels = [];
            let currentDepth = 0;

            // Loop while currentDepth is greater than (less negative than) finalDepth
            while (currentDepth - step > finalDepth - 1e-9) { // Review - there are epsilon in the config.
                currentDepth -= step;
                levels.push(currentDepth);
            }

            // Ensure the final depth is always included if not already last
            if (levels.length === 0 || levels[levels.length - 1] > finalDepth) {
                levels.push(finalDepth);
            }

            return levels;
        }

        /**
         * The main "factory" function. Assembles all data for a single operation into a self-contained context object for the toolpath pipeline.
         */
        buildToolpathContext(operationId, parameterManager) {
            const operation = this.operations.find(op => op.id === operationId);
            if (!operation) {
                throw new Error(`Operation ${operationId} not found.`);
            }

            // Get all parameters from manager
            const params = parameterManager.getAllParameters(operationId);

            // Get global settings
            const machine = this.settings.machine;
            const gcode = this.settings.gcode;

            // Get precision values
            const toolpathConfig = config.toolpath || {};
            const precision = config.geometry.coordinatePrecision;
            const offsettingEpsilon = config.geometry.offsetting?.epsilon;

            // Compute derived values
            const isInternal = (operation.type === 'clearing');
            const offsetDistances = this._calculateOffsetDistances(
                params.toolDiameter,
                params.passes,
                params.stepOver,
                isInternal
            );

            const depthLevels = this._calculateDepthLevels(
                params.cutDepth,
                params.depthPerPass,
                params.multiDepth,
                precision
            );

            // Assemble final context
            const context = {
                // Metadata
                operationId: operation.id,
                operationType: operation.type,
                fileName: operation.file.name,

                // Global Settings
                machine: { ...machine },
                gcode: { ...gcode },

                // Operation Parameters
                tool: {
                    id: params.tool,
                    diameter: params.toolDiameter
                },
                cutting: {
                    feedRate: params.feedRate,
                    plungeRate: params.plungeRate,
                    spindleSpeed: params.spindleSpeed
                },
                strategy: {
                    cutDepth: params.cutDepth,
                    depthPerPass: params.depthPerPass,
                    multiDepth: params.multiDepth,
                    passes: params.passes,
                    stepOver: params.stepOver,
                    entryType: params.entryType,
                    drill: {
                        millHoles: params.millHoles,
                        peckDepth: params.peckDepth,
                        dwellTime: params.dwellTime,
                        cannedCycle: params.cannedCycle
                    },
                    cutout: {
                        tabs: params.tabs,
                        tabWidth: params.tabWidth,
                        tabHeight: params.tabHeight,
                        cutSide: params.cutSide
                    }
                },

                // Computed Values
                computed: {
                    offsetDistances: offsetDistances,
                    depthLevels: depthLevels
                },

                // Config References
                config: {
                    entry: toolpathConfig.generation?.entry,
                    tabs: toolpathConfig.tabs,
                    optimization: config.gcode?.optimization,
                    precision: precision,
                    offsettingEpsilon: offsettingEpsilon
                }
            };

            return context;
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

        async fuseAllPrimitives(options = {}) {
            await this.ensureProcessorReady();

            this.debug('fuseAllPrimitives() - Entered fuseAllPrimitives. Received options:', options);

            if (!this.geometryProcessor) {
                throw new Error('Geometry processor not available');
            }

            const fusedResults = [];

            for (const operation of this.operations) {
                if ((operation.type === 'isolation' || operation.type === 'clearing') &&
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

        debug(message, data = null) {
            if (debugConfig.enabled) {
                if (data) {
                    console.log(`[Core] ${message}`, data);
                } else {
                    console.log(`[Core] ${message}`);
                }
            }
        }
    }

    window.PCBCamCore = PCBCamCore;
})();