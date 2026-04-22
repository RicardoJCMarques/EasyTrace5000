/*!
 * @file        cam-core.js
 * @description Core engine — state, parsing, shared infrastructure, pipeline execution
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

    const C = window.PCBCAMConfig.constants;
    const D = window.PCBCAMConfig.defaults;
    const EPSILON = C.precision.epsilon;
    const PRECISION = C.precision.coordinate;
    const opsConfig = D.operations;
    const debugState = D.debug;

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

            // Operation handler registry
            this.handlers = new Map();

            // Pipeline components (engine-owned)
            this.geometryTranslator = null;
            this.toolpathOptimizer = null;
            this.machineProcessor = null;

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

        /**
         * Handler Registry
         */

        registerHandler(type, handler) {
            this.handlers.set(type, handler);
            this.debug(`Registered handler for '${type}': ${handler.constructor.name}`);
        }

        getHandler(type) {
            const handler = this.handlers.get(type);
            if (!handler) {
                throw new Error(`No handler registered for operation type: ${type}`);
            }
            return handler;
        }

        /**
         * Processor Initialization
         */

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
                    preserveOriginals: true
                });

                // Initialize GeometryOffsetter
                if (typeof GeometryOffsetter !== 'undefined') {
                    this.geometryOffsetter = new GeometryOffsetter({
                        precision: PRECISION,
                        miterLimit: D.geometry.offsetting.miterLimit
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

        /**
         * Pipeline Component Initialization
         *
         * The core owns the translate → optimize → machine pipeline.
         * Called by the application controller after core construction
         * so that pipeline components exist before any toolpath work.
         */

        initializePipeline() {
            if (typeof GeometryTranslator !== 'undefined') {
                this.geometryTranslator = new GeometryTranslator(this);
            } else {
                console.error('[Core] GeometryTranslator module missing');
            }

            if (typeof ToolpathOptimizer !== 'undefined') {
                this.toolpathOptimizer = new ToolpathOptimizer();
            } else {
                console.error('[Core] ToolpathOptimizer module missing');
            }

            if (typeof MachineProcessor !== 'undefined') {
                this.machineProcessor = new MachineProcessor(this);
            } else {
                console.error('[Core] MachineProcessor module missing');
            }

            this.debug('Pipeline components initialized');
        }

        setToolLibrary(toolLibrary) {
            this.toolLibrary = toolLibrary;
            this.debug('Tool library set');
        }

        async ensureProcessorReady() {
            if (!this.processorInitialized && this.initializationPromise) {
                if (debugState.logging?.wasmOperations) {
                    console.log('Waiting for Clipper2...');
                }
                await this.initializationPromise;
            }

            if (!this.processorInitialized) {
                throw new Error('Geometry processor not initialized');
            }
        }

        /**
         * Settings
         */

        loadSettings() {
            const defaults = JSON.parse(JSON.stringify(D));

            try {
                const raw = localStorage.getItem(C.storageKeys.settings);
                if (!raw) return defaults;

                const saved = JSON.parse(raw);

                // Intercept Laser Profiles to prevent aggressive caching
                if (saved.laser && saved.laser.profiles) {
                    for (const [profId, savedProf] of Object.entries(saved.laser.profiles)) {
                        if (defaults.laser.profiles[profId] && savedProf.layerColors) {
                            // Splice the saved custom colors into the fresh factory defaults
                            defaults.laser.profiles[profId].layerColors = {
                                ...defaults.laser.profiles[profId].layerColors,
                                ...savedProf.layerColors
                            };
                        }
                    }
                    // Delete the cached profiles object so mergeDeep doesn't blindly overwrite the live defaults with the rest of the outdated cached data.
                    delete saved.laser.profiles; 
                }

                // Deep Merge Utility
                const isObject = item => (item && typeof item === 'object' && !Array.isArray(item));
                const mergeDeep = (target, ...sources) => {
                    if (!sources.length) return target;
                    const source = sources.shift();
                    if (isObject(target) && isObject(source)) {
                        for (const key in source) {
                            if (isObject(source[key])) {
                                if (!target[key]) Object.assign(target, { [key]: {} });
                                mergeDeep(target[key], source[key]);
                            } else {
                                Object.assign(target, { [key]: source[key] });
                            }
                        }
                    }
                    return mergeDeep(target, ...sources);
                };

                // Safely deep merge saved settings over defaults
                const mergedSettings = mergeDeep({}, defaults, saved);

                // Handle specific legacy fallbacks REVIEW - Is this still necessary?
                if (saved.gcode?.startCode !== undefined && mergedSettings.gcode.userStartCode === undefined) {
                    mergedSettings.gcode.userStartCode = saved.gcode.startCode;
                }
                if (saved.gcode?.endCode !== undefined && mergedSettings.gcode.userEndCode === undefined) {
                    mergedSettings.gcode.userEndCode = saved.gcode.endCode;
                }

                return mergedSettings;
            } catch (error) {
                console.warn('Error loading settings from localStorage:', error);
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

        updateSettings(category, settings) {
            if (this.settings[category]) {
                Object.assign(this.settings[category], settings);
                this.saveSettings();
            }
        }

        getSetting(category, key) {
            return this.settings[category]?.[key];
        }

        /**
         * Operation CRUD
         */

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
                color: fileType?.color,
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

        /**
         * Parsing — delegates classification to handlers
         */

        async parseOperation(operation) {
            try {
                if (debugState.logging?.parseOperations) {
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

                // Transfer parser warnings to the main operation object so the UI can see them
                if (!operation.warnings) operation.warnings = [];
                if (parseResult.warnings && parseResult.warnings.length > 0) {
                    operation.warnings.push(...parseResult.warnings);
                }

                // Handler pre-validation classification
                const handler = this.getHandler(operation.type);
                const classification = handler.classifyPrimitives(operation, primitives);
                primitives = classification.primitives;
                if (classification.warnings?.length > 0) {
                    if (!operation.warnings) operation.warnings = [];
                    operation.warnings.push(...classification.warnings);
                }

                // Tag primitives with operation metadata
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

                // Only run sequential compositing for Eagle files (mixed polarity).
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

                // Handler post-parse hook
                handler.postParsePrimitives(operation);

                this.updateStatistics();
                operation.processed = true;
                this.isToolpathCacheValid = false;

                if (debugState.logging?.parseOperations) {
                    console.log(`Parsed ${operation.file.name}: ${operation.primitives.length} primitives`);
                }

                return true;

            } catch (error) {
                operation.error = error.message;
                console.error(`Parse error for ${operation.file.name}:`, error);
                return false;
            }
        }

        /**
         * Geometric Analysis
         */

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

        /**
         * Builds a structured geometry summary for any operation type.
         * Used by the UI to display source geometry information.
         */
        getGeometrySummary(operation) {
            if (!operation || !operation.primitives) return null;

            const primitives = operation.primitives;
            const summary = {
                totalCount: primitives.length,
                byType: {},
                isDrill: operation.type === 'drill',
                drillSummary: operation.drillSummary || null,
                source: operation.file?.name?.endsWith('.svg') ? 'svg' : 'native'
            };

            // Count by primitive type
            for (const prim of primitives) {
                const type = prim.type || 'unknown';
                if (!summary.byType[type]) summary.byType[type] = 0;
                summary.byType[type]++;
            }

            // For drill operations, also count by role
            if (operation.type === 'drill') {
                summary.byRole = {};
                for (const prim of primitives) {
                    const role = prim.properties?.role || 'unclassified';
                    if (!summary.byRole[role]) summary.byRole[role] = 0;
                    summary.byRole[role]++;
                }
            }

            return summary;
        }

        /**
         * Validation & Compositing
         */

        validateAndOptimizePrimitives(primitives) {
            const validPrimitives = [];

            primitives.forEach((primitive, index) => {
                try {
                    if (typeof primitive.getBounds !== 'function') {
                        if (debugState.validation?.warnOnInvalidData) {
                            console.warn(`Primitive ${index} missing getBounds()`);
                        }
                        return;
                    }

                    const bounds = primitive.getBounds();
                    if (!isFinite(bounds.minX) || !isFinite(bounds.minY) ||
                        !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                        if (debugState.validation?.warnOnInvalidData) {
                            console.warn(`Primitive ${index} invalid bounds:`, bounds);
                        }
                        return;
                    }

                    if (debugState.validation?.validateCoordinates) {
                        const maxCoord = C.geometry.maxCoordinate;
                        if (Math.abs(bounds.minX) > maxCoord || Math.abs(bounds.minY) > maxCoord ||
                            Math.abs(bounds.maxX) > maxCoord || Math.abs(bounds.maxY) > maxCoord) {
                            console.warn(`Primitive ${index} exceeds max coordinate ${maxCoord}`);
                        }
                    }

                    validPrimitives.push(primitive);

                } catch (error) {
                    if (debugState.validation?.warnOnInvalidData) {
                        console.warn(`Primitive ${index} validation failed:`, error);
                    }
                }
            });

            if (validPrimitives.length !== primitives.length && debugState.enabled) {
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

            await this.ensureProcessorReady();

            this.debug(`[Compositing] === SEQUENTIAL COMPOSITING START ===`);
            this.debug(`[Compositing] Input: ${primitives.length} primitives`);

            // Separate traces/pads from regions/clears
            const independentGeometry = [];
            const polarityGroups = [];
            let currentGroup = null;

            for (const prim of primitives) {
                const isTraceOrPad = prim.properties?.isTrace || prim.properties?.isPad || prim.properties?.isFlash || (prim.properties?.stroke && !prim.properties?.fill);
                const isClear = prim.properties?.polarity === 'clear';

                // Keep dark traces/pads independent to preserve perfect analytic properties
                if (isTraceOrPad && !isClear) {
                    independentGeometry.push(prim);
                    continue;
                }

                const polarity = prim.properties?.polarity || 'dark';
                if (!currentGroup || currentGroup.polarity !== polarity) {
                    currentGroup = { polarity: polarity, items: [] };
                    polarityGroups.push(currentGroup);
                }
                currentGroup.items.push(prim);
            }

            this.debug(`[Compositing] Polarity groups: ${polarityGroups.length}`);

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
                                accumulator.concat(groupGeometry)
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

            // Re-combine the composited regions with the protected independent geometry
            const finalResult = [...accumulator, ...independentGeometry];
            this.debug(`[Compositing] Result: ${primitives.length} input → ${finalResult.length} output primitives`);

            return finalResult;
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

        /*
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
        /*
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
        */

        /**
         * Executes the full toolpath pipeline for a set of operation/context
         * pairs.  Returns machine-ready plans and the final machine position.
         *
         * @param {Array<{operation, context}>} operationContextPairs
         * @param {Object} [options]
         * @param {boolean} [options.optimize=true]  Run path optimizer
         * @param {{x,y,z}} [options.startPos]       Override starting position
         * @returns {{ plans: Array, endPos: {x,y,z} }}
         */
        async executePipeline(operationContextPairs, options = {}) {
            if (!this.geometryTranslator || !this.machineProcessor) {
                throw new Error('Pipeline components not initialized — call initializePipeline() first');
            }

            const optimize = options.optimize !== false;
            const allMachineReadyPlans = [];

            if (!operationContextPairs || operationContextPairs.length === 0) {
                return { plans: allMachineReadyPlans, endPos: { x: 0, y: 0, z: 0 } };
            }

            const firstContext = operationContextPairs[0].context;
            let currentMachinePos = options.startPos || { x: 0, y: 0, z: firstContext.machine.safeZ };

            // One batch per operation instance
            const operationSuperBatches = operationContextPairs.map(({ operation, context }) => ({
                type: operation.type,
                operationId: operation.id,
                pairs: [{ operation, context }]
            }));

            this.debug(`Executing pipeline: ${operationSuperBatches.length} batch(es), optimize=${optimize}`);

            for (const superBatch of operationSuperBatches) {
                this.debug(`--- Batch: ${superBatch.type} (${superBatch.operationId}) ---`);

                // Translate
                const batchPlans = await this.geometryTranslator.translateAllOperations(superBatch.pairs);

                if (!batchPlans || batchPlans.length === 0) {
                    this.debug(`--- Batch ${superBatch.type} produced no plans. Skipping. ---`);
                    continue;
                }

                // Optimize
                let plansToProcess = batchPlans;
                if (optimize && this.toolpathOptimizer) {
                    this.debug(`Optimizing ${batchPlans.length} plans...`);
                    plansToProcess = this.toolpathOptimizer.optimize(batchPlans, currentMachinePos);
                }

                if (plansToProcess.length === 0) {
                    this.debug(`--- Batch ${superBatch.type} empty after optimization. Skipping. ---`);
                    continue;
                }

                // Machine processing
                this.debug('Adding machine operations...');
                const batchContext = superBatch.pairs[0].context;

                const { plans: machineReadyPlans, endPos } = this.machineProcessor.processPlans(
                    plansToProcess,
                    batchContext,
                    currentMachinePos
                );

                allMachineReadyPlans.push(...machineReadyPlans);
                currentMachinePos = endPos;

                this.debug(`--- Batch complete. Machine pos: (${endPos.x.toFixed(2)}, ${endPos.y.toFixed(2)}, ${endPos.z.toFixed(2)}) ---`);
            }

            this.debug(`Pipeline complete: ${allMachineReadyPlans.length} machine-ready plans`);
            return { plans: allMachineReadyPlans, endPos: currentMachinePos };
        }

        /**
         * Shared Math Utilities (called by handlers)
         */

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
            while (currentDepth - step > finalDepth - EPSILON) {
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
         * Toolpath Context Builder
         *
         * Assembles all data for a single operation into a
         * self-contained context object.  Delegates offset direction
         * to the registered handler so the core never checks
         * operation type names for geometric decisions.
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

            // Compute derived values
            const offsetDistances = (operation.offsets || []).map(o => o.distance);

            // Transform Values - use board center for mirror, not origin
            const boardCenter = this.coordinateSystem?.boardBounds ? {
                x: this.coordinateSystem.boardBounds.centerX,
                y: this.coordinateSystem.boardBounds.centerY
            } : { x: 0, y: 0 };

            const depthLevels = this._calculateDepthLevels(
                params.cutDepth,
                params.depthPerPass,
                params.multiDepth,
                PRECISION
            );

            // Assemble final context
            const context = {
                // Metadata
                operationId: operation.id,
                operationType: operation.type,
                fileName: operation.file.name,

                // Global Settings
                machine: {
                    ...machine,
                    safeZ: machine.heights.safeZ,
                    travelZ: machine.heights.travelZ,
                    probeZ: machine.heights.probeZ,
                    homeZ: machine.heights.homeZ,
                    feedHeight: machine.heights.feedHeight,
                    rapidFeed: machine.speeds.rapidFeed,
                    probeFeed: machine.speeds.probeFeed,
                    maxFeed: machine.speeds.maxFeed,
                    maxAcceleration: machine.speeds.maxAcceleration
                },
                // Processor-specific settings (Roland, Makera, etc.)
                gcode: { ...gcode },

                // Processor-specific settings (Roland, Makera, etc.)
                processorSettings: { ...(this.settings.processorSettings || {}) },

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
                        cannedCycle: params.cannedCycle,
                        retractHeight: params.retractHeight
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
                    entry: D.toolpath.generation?.entry,
                    tabs: D.toolpath.tabs,
                    optimization: D.gcode.optimization,
                    precision: PRECISION,
                    offsettingEpsilon: EPSILON
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

        /**
         * State & Query Methods
         */

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
         * Fusion
         */

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

        /**
         * Debug & Stats
         */

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
                hasToolLibrary: !!this.toolLibrary,
                registeredHandlers: Array.from(this.handlers.keys())
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
            if (debugState.enabled) {
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