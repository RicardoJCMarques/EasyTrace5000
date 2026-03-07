/*!
 * @file        cam-core.js
 * @description Core application logic
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

/*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2025-2026 Eltryus
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

            // Initialize GeometryProcessor
            if (typeof GeometryProcessor !== 'undefined') {
                this.geometryProcessor = new GeometryProcessor({
                    scale: geomConfig.clipperScale,
                    preserveOriginals: true
                });

                // Initialize GeometryOffsetter
                if (typeof GeometryOffsetter !== 'undefined') {
                    this.geometryOffsetter = new GeometryOffsetter({
                        precision: config.precision.coordinate,
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
                    maxY: machineConfig.workspace?.maxY,
                    // Roland defaults
                    rolandModel: 'mdx50',
                    rolandStepsPerMM: 100,
                    rolandMaxFeed: 60,
                    rolandZMode: '3d',
                    rolandSpindleMode: 'direct',
                    rolandSpindleSpeed: 10000,
                    rolandStartCode: ';;^DF\nPA;',
                    rolandEndCode: '!MC0;\nPU0,0;\n;;^DF',
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
                laser: {
                    spotSize: config.laser.defaults.spotSize,
                    exportFormat: config.laser.defaults.exportFormat,
                    exportDPI: config.laser.defaults.exportDPI,
                    defaultClearStrategy: config.laser.defaults.defaultClearStrategy
                },
                ui: {
                    theme: config.ui?.theme,
                    showTooltips: config.ui?.showTooltips !== false
                },
                geometry: {
                    preserveArcs: geomConfig.fusion.preserveArcs,
                    adaptiveSegmentation: geomConfig.segments.adaptiveSegmentation !== false,
                    targetSegmentLength: geomConfig.segments.targetLength
                }
            };

            // Snapshot the factory defaults before any merge overwrites them
            const factoryMachine = { ...defaults.machine };

            try {
                const raw = localStorage.getItem('pcbcam-settings');
                if (!raw) return defaults;

                const saved = JSON.parse(raw);

                // Deep merge: preserve new defaults when localStorage has partial sub-objects
                for (const key of Object.keys(defaults)) {
                    if (saved[key] === undefined) continue;

                    if (typeof defaults[key] === 'object' && !Array.isArray(defaults[key]) &&
                        typeof saved[key] === 'object' && !Array.isArray(saved[key])) {
                        defaults[key] = { ...defaults[key], ...saved[key] };
                    } else {
                        defaults[key] = saved[key];
                    }
                }

                // Restore factory defaults for any string fields that got blanked by stale storage.
                // This handles the case where a previous version saved rolandStartCode as '' or undefined, which the deep merge would preserve over the new default.
                for (const [field, factoryValue] of Object.entries(factoryMachine)) {
                    if (typeof factoryValue === 'string' && !defaults.machine[field]) {
                        defaults.machine[field] = factoryValue;
                    }
                }

                return defaults;
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

                // Sequential compositing for mixed-polarity layers (Eagle LPD→LPC→LPD pattern).
                let finalPrimitives = validPrimitives;

                const isCopperLayer = (operation.type === 'isolation' || operation.type === 'clearing');
                const hasMixedPolarity = validPrimitives.some(
                    p => (p.properties?.polarity || 'dark') === 'clear'
                );

                if (isCopperLayer && hasMixedPolarity && this.processorInitialized) {
                    this.debug(`[Compositing] Mixed polarity detected in ${operation.file.name}, running sequential compositing...`);

                    try {
                        const composited = await this.compositeByPolarity(validPrimitives);

                        if (composited && composited.length > 0) {
                            operation.isComposited = true;
                            this.debug(`[Compositing] ${validPrimitives.length} input → ${composited.length} output primitives`);
                            finalPrimitives = composited;
                        } else {
                            this.debug(`[Compositing] Compositing returned empty, using original primitives`);
                            operation.isComposited = false;
                        }
                    } catch (error) {
                        console.error(`[Compositing] Compositing failed for ${operation.file.name}:`, error);
                        operation.isComposited = false;
                    }
                }

                // Ensure all primitives have correct operation metadata after compositing
                finalPrimitives.forEach(p => {
                    if (!p.properties) p.properties = {};
                    p.properties.operationType = operation.type;
                    p.properties.operationId = operation.id;
                    p.properties.layerType = operation.type === 'drill' ? 'drill' : operation.type;
                });

                operation.primitives = finalPrimitives;
                operation.bounds = this.recalculateBounds(finalPrimitives);

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

        /**
         * Sequential boolean compositing that respects Gerber rendering order.
         * Group contiguous same-polarity primitives to minimize WASM calls, then applies union (dark) or difference (clear) sequentially.
         */
        async compositeByPolarity(primitives) {
            if (!primitives || primitives.length === 0) return [];

            // Quick check: if no clear primitives exist, skip entirely (KiCad, simple files)
            const hasClear = primitives.some(p => (p.properties?.polarity || 'dark') === 'clear');
            if (!hasClear) {
                this.debug('[Compositing] No clear-polarity primitives found, skipping compositing');
                return primitives;
            }

            await this.ensureProcessorReady();

            this.debug(`[Compositing] === SEQUENTIAL COMPOSITING START ===`);
            this.debug(`[Compositing] Input: ${primitives.length} primitives`);

            // Group contiguous same-polarity primitives to batch WASM calls.
            const polarityGroups = [];
            let currentGroup = null;

            for (const prim of primitives) {
                const polarity = prim.properties?.polarity || 'dark';
                if (!currentGroup || currentGroup.polarity !== polarity) {
                    currentGroup = { polarity: polarity, items: [] };
                    polarityGroups.push(currentGroup);
                }
                currentGroup.items.push(prim);
            }

            this.debug(`[Compositing] Polarity groups: ${polarityGroups.length}`);
            polarityGroups.forEach((g, i) => {
                this.debug(`[Compositing]   Group ${i}: ${g.polarity} (${g.items.length} primitives)`);
            });

            // Sequential compositing: process groups in order
            let accumulator = [];

            for (let i = 0; i < polarityGroups.length; i++) {
                const group = polarityGroups[i];

                this.debug(`[Compositing] Processing group ${i}: ${group.polarity} (${group.items.length} items)`);

                // Preprocess: convert strokes (traces, arcs) to filled polygons.
                const standardized = [];
                let strokesConverted = 0;

                for (const prim of group.items) {
                    const result = this.geometryProcessor.standardizePrimitive(prim, prim.curveIds || []);
                    if (result) {
                        // Handle arrays returned by traceToPolygon
                        if (Array.isArray(result)) {
                            result.forEach(r => {
                                if (!r.properties) r.properties = {};
                                r.properties.polarity = prim.properties?.polarity || 'dark';
                                standardized.push(r);
                            });
                        } else {
                            if (!result.properties) result.properties = {};
                            result.properties.polarity = prim.properties?.polarity || 'dark';
                            standardized.push(result);
                        }

                        const wasStroke = (prim.properties?.stroke && !prim.properties?.fill) || 
                                          prim.properties?.isTrace;
                        if (wasStroke) strokesConverted++;
                    } else {
                        this.debug(`[Compositing]   Standardization failed for primitive ${prim.id} (${prim.type}), skipping`);
                    }
                }

                if (strokesConverted > 0) {
                    this.debug(`[Compositing]   Converted ${strokesConverted} stroke(s) to filled polygons`);
                }

                // Union everything within this group into a single geometry set (one WASM call per group)
                let groupGeometry;
                try {
                    groupGeometry = await this.geometryProcessor.unionGeometry(standardized);
                } catch (error) {
                    console.error(`[Compositing] Union failed for group ${i}:`, error);
                    continue;
                }

                if (!groupGeometry || groupGeometry.length === 0) {
                    this.debug(`[Compositing]   Group ${i} produced no geometry after union, skipping`);
                    continue;
                }

                this.debug(`[Compositing]   Group ${i} unioned to ${groupGeometry.length} primitive(s)`);

                if (group.polarity === 'dark') {
                    if (accumulator.length === 0) {
                        accumulator = groupGeometry;
                    } else {
                        // Union the new dark geometry with the accumulator
                        try {
                            accumulator = await this.geometryProcessor.unionGeometry(
                                [...accumulator, ...groupGeometry]
                            );
                        } catch (error) {
                            console.error(`[Compositing] Accumulator union failed at group ${i}:`, error);
                            // Fallback: just append
                            accumulator.push(...groupGeometry);
                        }
                    }
                    this.debug(`[Compositing]   Accumulator after dark union: ${accumulator.length} primitive(s)`);
                } else {
                    // Clear: subtract from accumulator
                    if (accumulator.length > 0 && groupGeometry.length > 0) {
                        try {
                            accumulator = await this.geometryProcessor.difference(
                                accumulator, groupGeometry
                            );
                        } catch (error) {
                            console.error(`[Compositing] Difference failed at group ${i}:`, error);
                            // Accumulator unchanged on failure
                        }
                        this.debug(`[Compositing]   Accumulator after clear difference: ${accumulator.length} primitive(s)`);
                    } else {
                        this.debug(`[Compositing]   Skipping clear subtraction (accumulator empty or no clear geometry)`);
                    }
                }
            }

            // Tag all output primitives as dark and composited
            accumulator.forEach(p => {
                if (!p.properties) p.properties = {};
                p.properties.polarity = 'dark';
                p.properties.isComposited = true;
            });

            this.debug(`[Compositing] === SEQUENTIAL COMPOSITING COMPLETE ===`);
            this.debug(`[Compositing] Result: ${primitives.length} input → ${accumulator.length} output primitives`);

            return accumulator;
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

        /**
         * Universal export-readiness check for any pipeline.
         * CNC: requires preview.ready (generated via the preview stage).
         * Laser: requires exportReady (set after laser path generation).
         */
        isExportReady(op) {
            if (!op) return false;
            return !!(op.exportReady || op.preview?.ready);
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

        /**
         * Generates the clearance polygon: the area between the offset boundary (at isolationWidth from copper) and the original copper shapes.
         * Both sides are kept as raw Clipper polygon output (no arc reconstruction) through the final boolean difference. This prevents tessellation mismatches where independently-reconstructed-then-re-tessellated circles produce wedge artifacts in the difference result.
         * The caller (generateLaserGeometry) reconstructs arcs on the result only when needed (e.g. filled SVG export, not hatching).
         */
        async _generateClearancePolygon(operation, isolationWidth) {
            await this.ensureProcessorReady();

            if (!operation.primitives || operation.primitives.length === 0) return [];

            this.debug(`=== CLEARANCE POLYGON GENERATION: width=${isolationWidth.toFixed(3)}mm ===`);

            const savedOffsets = operation.offsets;

            try {
                await this.generateOffsetGeometry(operation, {
                    toolDiameter: isolationWidth * 2,
                    passes: 1,
                    stepOver: 0,
                    combineOffsets: true,
                    skipArcReconstruction: true
                });

                const expanded = operation.offsets.flatMap(o => o.primitives);

                if (expanded.length === 0) {
                    this.debug('Offset expansion produced no geometry');
                    return [];
                }

                // Copper footprint
                this.geometryProcessor.clearProcessorCache();

                const footprint = await this.geometryProcessor.fuseGeometry(
                    operation.primitives,
                    { enableArcReconstruction: false }
                );

                if (footprint.length === 0) {
                    this.debug('Fusion produced no copper footprint');
                    return [];
                }

                this.debug(`Expanded boundary: ${expanded.length} primitive(s)`);
                this.debug(`Copper footprint: ${footprint.length} primitive(s)`);

                // Boolean difference
                const clearanceZone = await this.geometryProcessor.difference(expanded, footprint);

                this.debug(`Clearance polygon: ${clearanceZone.length} polygon(s)`);
                this.debug(`=== CLEARANCE POLYGON COMPLETE ===`);

                operation.clearancePolygon = clearanceZone;
                return clearanceZone;

            } finally {
                operation.offsets = savedOffsets;
            }
        }

        /**
         * UNUSED FOR NOW
         * Generates the full-board clearance polygon for copper clearing operations.
         * This is fundamentally different from isolation clearance:
         * - Isolation: expandedCopper − originalCopper = halo around traces
         * - Clearing: boardBounds − copperFootprint = all unused copper area
         *
         * @param {Object} operation - The operation with parsed primitives.
         * @param {number} padding - Extra padding beyond board bounds in mm.
         * @returns {Array<PathPrimitive>} Raw polygon clearance zone.
         */
        async _generateBoardClearance(operation, padding = 1.0) {
            await this.ensureProcessorReady();

            if (!operation.primitives || operation.primitives.length === 0) return [];

            this.debug(`=== BOARD CLEARANCE GENERATION: padding=${padding.toFixed(3)}mm ===`);

            // Board boundary rectangle
            // Use coordinateSystem bounds if available, otherwise compute from all operations
            let bounds = this.coordinateSystem?.boardBounds;
            if (!bounds) {
                // Fallback: compute bounds from all loaded operations
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const op of this.operations) {
                    if (op.bounds) {
                        minX = Math.min(minX, op.bounds.minX);
                        minY = Math.min(minY, op.bounds.minY);
                        maxX = Math.max(maxX, op.bounds.maxX);
                        maxY = Math.max(maxY, op.bounds.maxY);
                    }
                }
                if (!isFinite(minX)) {
                    this.debug('No valid bounds found for board clearance');
                    return [];
                }
                bounds = { minX, minY, maxX, maxY };
            }

            // Create a rectangle primitive representing the board + padding
            const boardRect = new PathPrimitive([{
                points: [
                    { x: bounds.minX - padding, y: bounds.minY - padding },
                    { x: bounds.maxX + padding, y: bounds.minY - padding },
                    { x: bounds.maxX + padding, y: bounds.maxY + padding },
                    { x: bounds.minX - padding, y: bounds.maxY + padding },
                    { x: bounds.minX - padding, y: bounds.minY - padding }
                ],
                isHole: false,
                nestingLevel: 0,
                parentId: null,
                arcSegments: [],
                curveIds: []
            }], {
                polarity: 'dark',
                operationType: 'clearing',
                operationId: operation.id
            });

            // Copper footprint from ALL copper operations
            // Clearing removes copper that ISN'T traces/pads/regions.
            // Gather primitives from isolation + clearing operations.
            const copperPrimitives = [];
            for (const op of this.operations) {
                if ((op.type === 'isolation' || op.type === 'clearing') &&
                    op.primitives && op.primitives.length > 0) {
                    copperPrimitives.push(...op.primitives);
                }
            }

            if (copperPrimitives.length === 0) {
                this.debug('No copper primitives found — returning full board as clearance');
                return [boardRect];
            }

            // Fuse copper without arc reconstruction (raw polygons for clean boolean)
            this.geometryProcessor.clearProcessorCache();
            const copperFootprint = await this.geometryProcessor.fuseGeometry(
                copperPrimitives,
                { enableArcReconstruction: false }
            );

            if (copperFootprint.length === 0) {
                this.debug('Fusion produced no copper footprint — returning full board');
                return [boardRect];
            }

            this.debug(`Board boundary: ${(bounds.maxX - bounds.minX).toFixed(1)} × ${(bounds.maxY - bounds.minY).toFixed(1)}mm + ${padding}mm padding`);
            this.debug(`Copper footprint: ${copperFootprint.length} polygon(s)`);

            // Boolean difference: board − copper
            const clearanceZone = await this.geometryProcessor.difference([boardRect], copperFootprint);

            this.debug(`Board clearance: ${clearanceZone.length} polygon(s)`);
            this.debug(`=== BOARD CLEARANCE COMPLETE ===`);

            return clearanceZone;
        }

        async generateLaserGeometry(operation, settings) {
            this.debug(`=== LASER GEOMETRY GENERATION: ${settings.clearStrategy} ===`);

            const strategy = settings.clearStrategy || 'offset';

            // OFFSET STRATEGY
            // Concentric passes around copper — same geometry as CNC isolation.
            // The offset contours ARE the final laser paths.
            // Also used by drill and cutout (single-pass with cut-side control).
            if (strategy === 'offset') {
                await this.generateOffsetGeometry(operation, settings);
                this.isToolpathCacheValid = false;
                return operation.offsets;
            }

            // FILLED / HATCH STRATEGIES
            // These need a clearance polygon to fill or hatch inside.
            // The source of that polygon differs by operation type:
            //   - Isolation: expanded copper − original copper (halo)
            //   - Clearing:  board bounds − copper footprint (full board clear)

            let clearanceZone = operation.clearancePolygon;

            if (!clearanceZone || clearanceZone.length === 0) {
                if (operation.type === 'clearing') {
                    // Clearing: the source geometry IS the area to fill.
                    // Fuse primitives into clean polygons for hatching/filling.
                    this.geometryProcessor.clearProcessorCache();
                    clearanceZone = await this.geometryProcessor.fuseGeometry(
                        operation.primitives,
                        { enableArcReconstruction: false }
                    );
                    this.debug(`Clearing zone from source geometry: ${clearanceZone.length} polygon(s)`);
                } else {
                    // Isolation: halo around traces, pads and regions
                    const isolationWidth = settings.isolationWidth
                        || (settings.toolDiameter * settings.passes * (1 - (settings.stepOver || 50) / 100))
                        || 0.3;
                    this.debug(`Laser isolation width: ${isolationWidth.toFixed(3)}mm`);
                    clearanceZone = await this._generateClearancePolygon(operation, isolationWidth);
                }
            }

            if (!clearanceZone || clearanceZone.length === 0) {
                this.debug('Clearance zone generation returned empty, falling back to offset');
                await this.generateOffsetGeometry(operation, settings);
                return operation.offsets;
            }

            switch (strategy) {
                case 'filled': {
                    // Filled export benefits from arc reconstruction for cleaner SVG curves.
                    let filledGeometry = clearanceZone;
                    if (this.geometryProcessor?.arcReconstructor) {
                        filledGeometry = this.geometryProcessor.arcReconstructor
                            .processForReconstruction(clearanceZone);
                        this.debug(`Filled: reconstructed ${clearanceZone.length} → ${filledGeometry.length} primitives`);
                    }

                    operation.offsets = [{
                        distance: 0,
                        pass: 1,
                        type: 'filled',
                        primitives: filledGeometry,
                        metadata: {
                            strategy: 'filled',
                            isolationWidth: settings.isolationWidth || 0,
                            isBoardClearing: settings.isBoardClearing || false,
                            finalCount: filledGeometry.length
                        }
                    }];
                    break;
                }

                case 'hatch': {
                    if (typeof HatchGenerator !== 'undefined') {
                        operation.offsets = HatchGenerator.generate(clearanceZone, settings);
                        this.debug(`Hatch: generated ${operation.offsets.length} pass(es)`);
                    } else {
                        console.warn('[Core] HatchGenerator is missing. Falling back to offset.');
                        await this.generateOffsetGeometry(operation, settings);
                    }
                    break;
                }

                default:
                    this.debug(`Unknown laser strategy: ${strategy}, falling back to offset`);
                    await this.generateOffsetGeometry(operation, settings);
                    break;
            }

            this.isToolpathCacheValid = false;
            return operation.offsets;
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

            // Determine offset direction and mode
            let isInternal = operation.type === 'clearing';
            let isOnLine = false;

            if (operation.type === 'cutout' || operation.type === 'drill') {
                if (settings.cutSide === 'inside') {
                    isInternal = true;
                } else if (settings.cutSide === 'on') {
                    isOnLine = true;
                }
            }

            // Calculate offset distances
            let offsetDistances;
            if (isOnLine) {
                offsetDistances = [0];
            } else {
                offsetDistances = this._calculateOffsetDistances(
                    settings.toolDiameter,
                    settings.passes,
                    settings.stepOver,
                    isInternal
                );
            }

            // Guard: If all offset distances would collapse geometry (e.g. hole smaller than spot), fall back to on-line (zero offset) so the user still gets output.
            if (operation.type === 'drill' && isInternal && offsetDistances.length > 0) {
                const drillCircles = operation.primitives
                    .filter(p => p.type === 'circle' && p.radius);
                if (drillCircles.length > 0) {
                    const smallestFeature = Math.min(...drillCircles.map(p => p.radius * 2));
                    const largestOffset = Math.max(...offsetDistances.map(d => Math.abs(d)));
                    if (smallestFeature > 0 && largestOffset >= smallestFeature / 2) {
                        this.debug(`Drill offset ${largestOffset.toFixed(3)}mm would collapse features (smallest: ${smallestFeature.toFixed(3)}mm). Falling back to on-line.`);
                        offsetDistances = [0];
                    }
                }
            }

            // Recalculate if on-line was set above but distances were already computed
            if (isOnLine) {
                offsetDistances = [0];
            }

            // ── PRE-FUSION FOR CLEARING & CUT-IN RESOLUTION ──
            let primitivesToProcess = operation.primitives;

            // Full-board fusion (Restricted to Internal Clearing only)
            if (isInternal && operation.type === 'clearing' && primitivesToProcess.length > 1) {
                this.debug(`[Clearing Pre-Fusion] Fusing ${primitivesToProcess.length} clearing primitives...`);
                this.geometryProcessor.clearProcessorCache();

                try {
                    const fused = await this.geometryProcessor.fuseGeometry(
                        primitivesToProcess,
                        { enableArcReconstruction: false }
                    );

                    if (fused && fused.length > 0) {
                        this.debug(`[Clearing Pre-Fusion] ${primitivesToProcess.length} → ${fused.length} primitives`);
                        fused.forEach(p => {
                            if (!p.properties) p.properties = {};
                            p.properties.operationType = operation.type;
                            p.properties.operationId = operation.id;
                        });
                        primitivesToProcess = fused;
                    }
                } catch (error) {
                    console.error(`[Clearing Pre-Fusion] Failed:`, error);
                }
            } 
            // Targeted Cut-In Resolution (For Isolation passes)
            else if (operation.type === 'isolation') {
                // Self-union region primitives INDIVIDUALLY. This resolves 0-width cut-in seams  into a clean PolyTree (shell + holes) without merging the entire board and crashing  the Boolean Offsetter with massive monolithic contours.
                const resolvedPrimitives = [];
                let resolvedCount = 0;

                for (const prim of primitivesToProcess) {
                    // Filter: Only target filled polygons that aren't traces or simple analytic shapes
                    const isRegion = prim.type === 'path' && 
                                     prim.properties?.fill && 
                                     !prim.properties?.stroke && 
                                     !prim.properties?.isTrace &&
                                     !prim.properties?.isComposited;
                    
                    if (isRegion) {
                        try {
                            const resolved = await this.geometryProcessor.unionGeometry([prim]);
                            if (resolved && resolved.length > 0) {
                                resolved.forEach(r => {
                                    if (!r.properties) r.properties = {};
                                    // Preserve metadata
                                    Object.assign(r.properties, prim.properties);
                                    r.properties.operationType = operation.type;
                                    r.properties.operationId = operation.id;
                                });
                                resolvedPrimitives.push(...resolved);
                                resolvedCount++;
                            } else {
                                resolvedPrimitives.push(prim);
                            }
                        } catch (e) {
                            resolvedPrimitives.push(prim);
                        }
                    } else {
                        resolvedPrimitives.push(prim);
                    }
                }
                
                if (resolvedCount > 0) {
                    this.debug(`[Cut-in Resolution] Resolved ${resolvedCount} region(s) into shells and holes`);
                }
                primitivesToProcess = resolvedPrimitives;
            }

            /**
             * PHASE 1: Separate contours into shells, islands, and holes
             * Shells:  outer contours that form the pour/clearing boundary.
             * Islands: outer contours that sit inside a hole (pads, traces in
             *          clearance gaps). These must NOT be subtracted by holes.
             * Holes:   clear/hole contours (clearance gaps, anti-pads).
             */

            const allOuterContours = [];
            const holeContours = [];

            // Helper: check if a primitive should be skipped (drill roles in CNC pipeline)
            const isLaserPipeline = settings.clearStrategy !== undefined;
            const shouldSkipPrimitive = (primitive) => {
                if (isLaserPipeline) return false;
                const role = primitive.properties?.role;
                return role === 'drill_hole' || role === 'drill_slot';
            };

            primitivesToProcess.forEach(primitive => {
                if (shouldSkipPrimitive(primitive)) return;

                const primitivePolarity = primitive.properties?.polarity || 'dark';

                if (primitive.contours && primitive.contours.length > 1) {
                    const compoundParentId = primitive.id;
                    primitive.contours.forEach(contour => {
                        const simplePrimitive = new PathPrimitive([contour], {
                            ...primitive.properties,
                            polarity: contour.isHole ? 'clear' : 'dark',
                            _compoundParentId: compoundParentId,
                            _nestingLevel: contour.nestingLevel || 0
                        });

                        if (contour.isHole) {
                            holeContours.push(simplePrimitive);
                        } else {
                            allOuterContours.push(simplePrimitive);
                        }
                    });
                } else if (primitive.contours && primitive.contours.length === 1) {
                    if (primitivePolarity === 'clear') {
                        holeContours.push(primitive);
                    } else {
                        allOuterContours.push(primitive);
                    }
                } else {
                    if (primitivePolarity === 'clear') {
                        holeContours.push(primitive);
                    } else {
                        allOuterContours.push(primitive);
                    }
                }
            });

            /** Classify outers as shells vs islands
             * Level-0 outers skip holes from the same compound primitive (prevents ring shapes like "0" from self-classifying as islands).
             * Level-2+ outers (pads inside clearance gaps) test against ALL holes including same-compound siblings — they ARE islands.
             */
            const shellOuters = [];
            const islandOuters = [];

            if (holeContours.length > 0 && allOuterContours.length > 1) {
                const holeEntries = holeContours.map(h => {
                    const points = (h.contours && h.contours[0]?.points) ? h.contours[0].points : null;
                    const parentId = h.properties?._compoundParentId || null;
                    return points ? { points, parentId } : null;
                }).filter(Boolean);

                for (const outer of allOuterContours) {
                    const testPoint = GeometryUtils.getRepresentativePoint(outer);
                    const outerParentId = outer.properties?._compoundParentId || null;
                    const outerNestingLevel = outer.properties?._nestingLevel || 0;

                    let isInsideHole = false;
                    if (testPoint) {
                        for (const entry of holeEntries) {
                            if (outerNestingLevel === 0 &&
                                outerParentId && entry.parentId &&
                                outerParentId === entry.parentId) {
                                continue;
                            }
                            if (GeometryUtils.pointInPolygon(testPoint, entry.points)) {
                                isInsideHole = true;
                                break;
                            }
                        }
                    }

                    if (isInsideHole) {
                        islandOuters.push(outer);
                    } else {
                        shellOuters.push(outer);
                    }
                }

                this.debug(`Island detection: ${allOuterContours.length} outers → ${shellOuters.length} shells + ${islandOuters.length} islands (${holeContours.length} holes)`);
            } else {
                shellOuters.push(...allOuterContours);
            }

            this.debug(`Separated into ${shellOuters.length} shell outers, ${islandOuters.length} island outers, and ${holeContours.length} hole contours.`);

            /**
             * PHASE 2: Generate offsets for each pass
             */

            operation.offsets = [];
            const passResults = [];

            for (let passIndex = 0; passIndex < offsetDistances.length; passIndex++) {
                const distance = offsetDistances[passIndex];
                const offsetType = distance >= 0 ? 'external' : 'internal';

                this.debug(`--- PASS ${passIndex + 1}/${offsetDistances.length}: ${distance.toFixed(3)}mm (${offsetType}) ---`);

                // Offset shells
                const offsetShells = [];
                for (const primitive of shellOuters) {
                    const result = await this.geometryOffsetter.offsetPrimitive(primitive, distance);
                    if (Array.isArray(result)) {
                        offsetShells.push(...result);
                    } else if (result) {
                        offsetShells.push(result);
                    }
                }

                // Offset islands
                const offsetIslands = [];
                for (const primitive of islandOuters) {
                    const result = await this.geometryOffsetter.offsetPrimitive(primitive, distance);
                    if (Array.isArray(result)) {
                        offsetIslands.push(...result);
                    } else if (result) {
                        offsetIslands.push(result);
                    }
                }

                // Offset holes (invert distance)
                const offsetHoles = [];
                for (const primitive of holeContours) {
                    const result = await this.geometryOffsetter.offsetPrimitive(primitive, -distance);
                    if (Array.isArray(result)) {
                        offsetHoles.push(...result);
                    } else if (result) {
                        offsetHoles.push(result);
                    }
                }

                this.debug(`Offset generated: ${offsetShells.length} shells, ${offsetIslands.length} islands, ${offsetHoles.length} holes.`);

                /** 
                 * PHASE 3: Boolean operations with island protection
                 * 1. Union shells, subtract holes → pour offset geometry
                 * 2. Union islands back in → final geometry with pads preserved
                 */

                let finalPassGeometry;

                const totalOuters = offsetShells.length + offsetIslands.length;
                const needsBoolean = offsetHoles.length > 0 || totalOuters > 1;

                if (!needsBoolean) {
                    this.debug(`Single offset result, skipping boolean operations`);
                    finalPassGeometry = [...offsetShells, ...offsetIslands];
                } else {
                    this.debug(`Running island-aware boolean operations...`);

                    // Shells & Holes
                    let shellResult = [];
                    if (offsetShells.length > 0) {
                        const shellUnion = await this.geometryProcessor.unionGeometry(offsetShells);
                        this.debug(`Union of shells resulted in ${shellUnion.length} shape(s).`);

                        if (offsetHoles.length > 0) {
                            const holeUnion = await this.geometryProcessor.unionGeometry(offsetHoles);
                            this.debug(`Union of holes resulted in ${holeUnion.length} shape(s).`);
                            shellResult = await this.geometryProcessor.difference(shellUnion, holeUnion);
                            this.debug(`Shell − Holes resulted in ${shellResult.length} shape(s).`);
                        } else {
                            shellResult = shellUnion;
                        }
                    }

                    // Union islands back (protected from hole subtraction)
                    if (offsetIslands.length > 0) {
                        this.debug(`Unioning ${offsetIslands.length} protected island(s) back into result...`);
                        finalPassGeometry = await this.geometryProcessor.unionGeometry(
                            [...shellResult, ...offsetIslands]
                        );
                        this.debug(`Final union: ${finalPassGeometry.length} shape(s).`);
                    } else {
                        finalPassGeometry = shellResult;
                    }
                }

                // Arc reconstruction - skip for on-line (zero offset) passes since source geometry already has correct arc metadata that the reconstructor cannot recover (points lack curveId tags)
                if (!settings.skipArcReconstruction && Math.abs(distance) >= config.precision.coordinate) {
                    this.debug(`Running arc reconstruction...`);
                    finalPassGeometry = this.geometryProcessor.arcReconstructor.processForReconstruction(finalPassGeometry);
                } else if (Math.abs(distance) < config.precision.coordinate) {
                    this.debug(`Arc reconstruction skipped for on-line pass (source arcs preserved)`);
                } else {
                    this.debug(`Arc reconstruction skipped (caller will handle)`);
                }

                // Post-reconstruction simplification
                this.geometryOffsetter.simplifyOffsetResult(finalPassGeometry, Math.abs(distance));

                this.debug(`Pass complete: ${finalPassGeometry.length} primitive(s).`);

                const reconstructedGeometry = finalPassGeometry.map(p => {
                    if (!p.properties) p.properties = {};
                    p.properties.isOffset = true;
                    p.properties.pass = passIndex + 1;
                    p.properties.offsetDistance = distance;
                    p.properties.offsetType = offsetType;
                    p.properties.hasAnalyticArcs = (p.type === 'circle') || (p.arcSegments && p.arcSegments.length > 0);
                    return p;
                });

                passResults.push({
                    distance: distance,
                    pass: passIndex + 1,
                    offsetType: offsetType,
                    primitives: reconstructedGeometry,
                    metadata: {
                        sourceCount: primitivesToProcess.length,
                        shellCount: offsetShells.length,
                        islandCount: offsetIslands.length,
                        holeCount: offsetHoles.length,
                        finalCount: reconstructedGeometry.length,
                        generatedAt: Date.now(),
                        toolDiameter: settings.toolDiameter,
                        analytic: !needsBoolean,
                        wasFused: primitivesToProcess !== operation.primitives
                    }
                });
            }

            // Combine passes if requested
            if (settings.combineOffsets && passResults.length > 1) {
                const allPassPrimitives = passResults.flatMap(p => p.primitives);
                operation.offsets = [{
                    id: `offset_combined_${operation.id}`,
                    distance: offsetDistances[0],
                    pass: 1,
                    primitives: allPassPrimitives,
                    type: 'offset',
                    metadata: {
                        sourceCount: primitivesToProcess.length,
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
            const precision = config.precision.coordinate;
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
            const toolDiameter = parseFloat(settings.toolDiameter);

            // Safety Check: Prevent generating geometry with invalid tools
            if (!toolDiameter || isNaN(toolDiameter) || toolDiameter <= 0) {
                console.error(`[Core] Drill strategy generation failed: Invalid tool diameter (${toolDiameter})`);
                return []; 
            }

            for (const action of plan) {
                if (action.type === 'peck') {
                    // Create peck mark circle
                    strategyPrimitives.push(new CirclePrimitive(
                        action.position,
                        toolDiameter / 2, // Use the resolved diameter
                        {
                            role: 'peck_mark',
                            originalDiameter: action.originalDiameter,
                            toolDiameter: toolDiameter,
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
                        const slotLength = Math.hypot(dx, dy);

                        const pathThickness = slotWidth - toolDiameter;

                        if (pathThickness > minFeatureSize) {
                            const pathLength = slotLength + pathThickness;
                            const centerX = (originalSlot.start.x + originalSlot.end.x) / 2;
                            const centerY = (originalSlot.start.y + originalSlot.end.y) / 2;

                            // Determine slot orientation - ObroundPrimitive only supports axis-aligned
                            const isHorizontal = Math.abs(dx) > Math.abs(dy);

                            let obroundWidth, obroundHeight, cornerX, cornerY;

                            if (isHorizontal) {
                                // Horizontal slot: long axis along X
                                obroundWidth = pathLength;
                                obroundHeight = pathThickness;
                                cornerX = centerX - pathLength / 2;
                                cornerY = centerY - pathThickness / 2;
                            } else {
                                // Vertical slot: long axis along Y
                                obroundWidth = pathThickness;
                                obroundHeight = pathLength;
                                cornerX = centerX - pathThickness / 2;
                                cornerY = centerY - pathLength / 2;
                            }

                            const millingPath = new ObroundPrimitive(
                                { x: cornerX, y: cornerY },
                                obroundWidth,
                                obroundHeight,
                                {
                                    role: 'drill_milling_path',
                                    originalDiameter: slotWidth,
                                    toolDiameter: toolDiameter,
                                    originalSlot: originalSlot,
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
            const precision = config.precision.coordinate;
            const offsettingEpsilon = config.geometry.offsetting?.epsilon;

            // Compute derived values
            const isInternal = (operation.type === 'clearing');
            const offsetDistances = this._calculateOffsetDistances(
                params.toolDiameter,
                params.passes,
                params.stepOver,
                isInternal
            );

            // Transform Values - use board center for mirror, not origin
            const boardCenter = this.coordinateSystem?.boardBounds ? {
                x: this.coordinateSystem.boardBounds.centerX,
                y: this.coordinateSystem.boardBounds.centerY
            } : { x: 0, y: 0 };

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
                    spindleSpeed: params.spindleSpeed,
                    spindleDwell: params.spindleDwell
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

                // Transform Values
                transforms: {
                    origin: this.coordinateSystem?.getOriginPosition() || { x: 0, y: 0 },
                    rotation: this.coordinateSystem?.currentRotation || 0,
                    rotationCenter: this.coordinateSystem?.rotationCenter || null,
                    mirrorX: this.coordinateSystem?.mirrorX || false,
                    mirrorY: this.coordinateSystem?.mirrorY || false,
                    mirrorCenter: boardCenter
                },

                // Config References
                config: {
                    entry: toolpathConfig.generation?.entry,
                    tabs: toolpathConfig.tabs,
                    optimization: config.gcode?.optimization,
                    precision: precision,
                    offsettingEpsilon: offsettingEpsilon
                },

                // Laser-specific (only populated in laser/hybrid pipeline)
                laser: (() => {
                    const controller = window.pcbcam;
                    if (!controller || (controller.pipelineState.type !== 'laser' && controller.pipelineState.type !== 'hybrid')) {
                        return null;
                    }

                    const laserMachine = this.settings.laser;
                    const spotSize = laserMachine.spotSize;
                    const stepOverPct = params.laserStepOver;
                    const isolationWidth = params.laserIsolationWidth;
                    const stepDistance = spotSize * (1 - stepOverPct / 100);

                    return {
                        spotSize: spotSize,
                        exportFormat: laserMachine.exportFormat,
                        exportDPI: laserMachine.exportDPI,
                        isolationWidth: isolationWidth,
                        stepOver: stepOverPct,
                        clearStrategy: params.laserClearStrategy,
                        hatchAngle: params.laserHatchAngle,
                        cutSide: params.laserCutSide,
                        computedPasses: stepDistance > 0 ? Math.ceil(isolationWidth / stepDistance) : 1,
                        stepDistance: stepDistance
                    };
                })()
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
                if (data !== null) {
                    console.log(`[Core] ${message}`, data);
                } else {
                    console.log(`[Core] ${message}`);
                }
            }
        }
    }

    window.PCBCamCore = PCBCamCore;
})();