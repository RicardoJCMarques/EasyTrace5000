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

                if (operation.type === 'cutout') {
                    if (primitives.length > 1) {
                        const { loops, orphans } = GeometryUtils.extractClosedLoops(primitives);

                        if (loops.length > 0) {
                            const topology = GeometryUtils.classifyCutoutTopology(loops);
                            const compounds = GeometryUtils.assembleCutoutCompounds(topology);

                            if (compounds.length > 0) {
                                primitives = compounds;
                                const holeCount = topology.filter(t => t.isHole).length;
                                this.debug(`Cutout: ${compounds.length} board(s), ${holeCount} hole(s) from ${loops.length} loop(s)`);
                            } else {
                                primitives = loops;
                            }

                            // Preserve loops for re-classification if orphans get resolved later
                            if (orphans.length > 0) {
                                operation._extractedLoops = loops;
                            }
                        }

                        if (orphans.length > 0) {
                            operation.needsClosurePrompt = true;
                            operation._closureInfo = { rawPrimitives: orphans };
                            this.debug(`${orphans.length} orphan segment(s) flagged for closure prompt`);
                        }

                    } else if (primitives.length === 1) {
                        const pts = primitives[0].contours?.[0]?.points;
                        if (pts && pts.length >= 3 && GeometryUtils.isClockwise(pts)) {
                            GeometryUtils._reverseContourWinding(primitives[0].contours[0]);
                            this.debug('Single cutout primitive reversed to CCW');
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

                // SVG drill classification: tag round shapes with drill roles
                if (operation.type === 'drill' && fileName.endsWith('.svg')) {
                    this._classifySVGDrillPrimitives(operation);
                }

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
         * Classifies SVG primitives into drill roles (hole/slot).
         * Only called when operation.type === 'drill' and the source file is SVG.
         * Rejects non-circular/non-obround shapes with warnings.
         */
        _classifySVGDrillPrimitives(operation) {
            const quantize = (value) => Math.round(value / PRECISION) * PRECISION;

            const accepted = [];
            const warnings = [];
            const rejected = [];
            const holeSizes = new Map();  // quantizedDiameter -> count
            const slotSizes = new Map();  // "widthxlength" -> count

            for (const prim of operation.primitives) {
                if (!prim.properties) prim.properties = {};

                if (prim.type === 'circle') {
                    // Direct circle → drill hole
                    const rawDiameter = prim.radius * 2;
                    const diameter = quantize(rawDiameter);

                    prim.properties.role = 'drill_hole';
                    prim.properties.diameter = diameter;
                    prim.center = prim.center || prim.getCenter();

                    if (Math.abs(rawDiameter - diameter) > PRECISION * 0.1) {
                        this.debug(`[SVG Drill] Quantized circle diameter: ${rawDiameter.toFixed(6)} → ${diameter.toFixed(3)}mm`);
                    }

                    const key = diameter.toFixed(3);
                    holeSizes.set(key, (holeSizes.get(key) || 0) + 1);
                    accepted.push(prim);

                } else if (prim.type === 'obround') {
                    const w = prim.width;
                    const h = prim.height;
                    const isCircular = Math.abs(w - h) < PRECISION;

                    if (isCircular) {
                        // Square obround → drill hole (same as plotter logic)
                        const diameter = quantize(Math.min(w, h));
                        const cx = prim.position.x + w / 2;
                        const cy = prim.position.y + h / 2;

                        prim.properties.role = 'drill_hole';
                        prim.properties.diameter = diameter;
                        prim.center = { x: cx, y: cy };
                        prim.radius = diameter / 2;

                        const key = diameter.toFixed(3);
                        holeSizes.set(key, (holeSizes.get(key) || 0) + 1);
                        accepted.push(prim);
                    } else {
                        // True obround → drill slot
                        const isHorizontal = w > h;
                        const r = Math.min(w, h) / 2;
                        const diameter = quantize(Math.min(w, h));

                        let start, end;
                        if (isHorizontal) {
                            const cy = prim.position.y + h / 2;
                            start = { x: prim.position.x + r, y: cy };
                            end = { x: prim.position.x + w - r, y: cy };
                        } else {
                            const cx = prim.position.x + w / 2;
                            start = { x: cx, y: prim.position.y + r };
                            end = { x: cx, y: prim.position.y + h - r };
                        }

                        prim.properties.role = 'drill_slot';
                        prim.properties.diameter = diameter;
                        prim.properties.originalSlot = { start, end };

                        const slotLength = Math.hypot(end.x - start.x, end.y - start.y);
                        const slotKey = `${diameter.toFixed(3)}x${quantize(slotLength + diameter).toFixed(3)}`;
                        slotSizes.set(slotKey, (slotSizes.get(slotKey) || 0) + 1);
                        accepted.push(prim);
                    }

                } else if (prim.type === 'rectangle') {
                    const w = prim.width;
                    const h = prim.height;
                    const isSquare = Math.abs(w - h) < PRECISION;

                    if (isSquare) {
                        // Square rectangle → approximate as circular drill hole
                        const diameter = quantize(w);
                        const cx = prim.position.x + w / 2;
                        const cy = prim.position.y + h / 2;

                        prim.properties.role = 'drill_hole';
                        prim.properties.diameter = diameter;
                        prim.center = { x: cx, y: cy };
                        prim.radius = diameter / 2;

                        warnings.push({
                            message: `Square rectangle (${w.toFixed(3)}mm) treated as circular hole`,
                            severity: 'info'
                        });

                        const key = diameter.toFixed(3);
                        holeSizes.set(key, (holeSizes.get(key) || 0) + 1);
                        accepted.push(prim);
                    } else {
                        // Non-square rectangle → not a valid drill shape
                        rejected.push({ type: 'rectangle', id: prim.id, width: w, height: h });
                        warnings.push({
                            message: `Non-square rectangle (${w.toFixed(3)}×${h.toFixed(3)}mm) rejected — use circles or obrounds for drill holes`,
                            severity: 'warning'
                        });
                    }

                } else {
                    // PathPrimitive, ArcPrimitive, BezierPrimitive, etc.
                    rejected.push({ type: prim.type, id: prim.id });
                    warnings.push({
                        message: `${prim.type} shape rejected — drill operation only supports circles and obrounds`,
                        severity: 'warning'
                    });
                }
            }

            // Recovery detection: scan rejected PathPrimitives for circle/obround patterns
            const recoverableCircles = [];
            const recoverableObrounds = [];

            for (const entry of rejected) {
                // Only attempt recovery on PathPrimitives
                const prim = operation.primitives.find(p => p.id === entry.id);
                if (!prim || prim.type !== 'path') continue;

                const circleMatch = this._detectCircleFromPath(prim);
                if (circleMatch) {
                    const qDiam = quantize(circleMatch.diameter);
                    recoverableCircles.push({
                        primitiveId: prim.id,
                        detected: { ...circleMatch, diameter: qDiam }
                    });
                    continue;
                }

                const obroundMatch = this._detectObroundFromPath(prim);
                if (obroundMatch) {
                    const qDiam = quantize(obroundMatch.diameter);
                    recoverableObrounds.push({
                        primitiveId: prim.id,
                        detected: { ...obroundMatch, diameter: qDiam }
                    });
                }
            }

            const hasRecoverable = recoverableCircles.length > 0 || recoverableObrounds.length > 0;
            if (hasRecoverable) {
                operation.drillRecoverable = {
                    circles: recoverableCircles.length > 0 ? recoverableCircles : null,
                    obrounds: recoverableObrounds.length > 0 ? recoverableObrounds : null
                };
                this.debug(`[SVG Drill] Found ${recoverableCircles.length} circle + ${recoverableObrounds.length} obround candidates for recovery`);
            }

            // Replace primitives with accepted-only set
            operation.primitives = accepted;
            operation.bounds = this.recalculateBounds(accepted);

            // Store summary for UI
            operation.drillSummary = {
                holes: Array.from(holeSizes.entries())
                    .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
                    .map(([diameter, count]) => ({ diameter: parseFloat(diameter), count })),
                slots: Array.from(slotSizes.entries())
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([key, count]) => {
                        const [w, l] = key.split('x').map(parseFloat);
                        return { width: w, length: l, count };
                    }),
                totalAccepted: accepted.length,
                totalRejected: rejected.length,
                rejected: rejected,
                source: 'svg'
            };

            // Merge warnings into operation
            if (!operation.warnings) operation.warnings = [];
            operation.warnings.push(...warnings);

            this.debug(`[SVG Drill] Classified ${accepted.length} accepted, ${rejected.length} rejected from ${accepted.length + rejected.length} primitives`);
            if (rejected.length > 0) {
                this.debug(`[SVG Drill] Rejected types: ${rejected.map(r => r.type).join(', ')}`);
            }
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
         * Detects if a PathPrimitive is a compound circle (two semicircular arcs).
         */
        _detectCircleFromPath(primitive) {
            if (primitive.type !== 'path' || !primitive.contours || primitive.contours.length !== 1) return null;

            const contour = primitive.contours[0];
            if (!contour.arcSegments || contour.arcSegments.length !== 2) return null;

            const arc1 = contour.arcSegments[0];
            const arc2 = contour.arcSegments[1];

            if (!arc1.center || !arc2.center || !arc1.radius || !arc2.radius) return null;

            // Same center
            const centerDist = Math.hypot(arc1.center.x - arc2.center.x, arc1.center.y - arc2.center.y);
            if (centerDist > PRECISION) return null;

            // Same radius
            if (Math.abs(arc1.radius - arc2.radius) > PRECISION) return null;

            // Combined sweep ≈ 2π
            const sweep1 = arc1.sweepAngle !== undefined ? Math.abs(arc1.sweepAngle) : Math.abs(arc1.endAngle - arc1.startAngle);
            const sweep2 = arc2.sweepAngle !== undefined ? Math.abs(arc2.sweepAngle) : Math.abs(arc2.endAngle - arc2.startAngle);
            const totalSweep = sweep1 + sweep2;

            if (Math.abs(totalSweep - 2 * Math.PI) > 0.1) return null;

            const radius = (arc1.radius + arc2.radius) / 2;
            const center = {
                x: (arc1.center.x + arc2.center.x) / 2,
                y: (arc1.center.y + arc2.center.y) / 2
            };

            return {
                center: center,
                radius: radius,
                diameter: radius * 2
            };
        }

        /**
         * Detects if a PathPrimitive is a compound obround (two semicircular arcs + linear segments).
         */
        _detectObroundFromPath(primitive) {
            if (primitive.type !== 'path' || !primitive.contours || primitive.contours.length !== 1) return null;

            const contour = primitive.contours[0];
            if (!contour.arcSegments || contour.arcSegments.length !== 2) return null;
            if (!contour.points || contour.points.length < 4) return null;

            const arc1 = contour.arcSegments[0];
            const arc2 = contour.arcSegments[1];

            if (!arc1.center || !arc2.center || !arc1.radius || !arc2.radius) return null;

            // Same radius (both caps are semicircles of equal size)
            if (Math.abs(arc1.radius - arc2.radius) > PRECISION) return null;

            // Each arc sweeps ≈ π (semicircle)
            const sweep1 = arc1.sweepAngle !== undefined ? Math.abs(arc1.sweepAngle) : Math.abs(arc1.endAngle - arc1.startAngle);
            const sweep2 = arc2.sweepAngle !== undefined ? Math.abs(arc2.sweepAngle) : Math.abs(arc2.endAngle - arc2.startAngle);

            if (Math.abs(sweep1 - Math.PI) > 0.15 || Math.abs(sweep2 - Math.PI) > 0.15) return null;

            // Centers must not coincide (that would be a circle, not an obround)
            const centerDist = Math.hypot(arc1.center.x - arc2.center.x, arc1.center.y - arc2.center.y);
            if (centerDist < PRECISION) return null;

            // Verify non-arc segments are linear (no additional curves)
            const arcPointIndices = new Set();
            for (const arc of contour.arcSegments) {
                for (let i = arc.startIndex; i <= arc.endIndex; i++) {
                    arcPointIndices.add(i % contour.points.length);
                }
            }

            // Check that remaining segments are roughly straight
            const r = (arc1.radius + arc2.radius) / 2;
            const start = arc1.center;
            const end = arc2.center;

            // Compute axis-aligned bounding box
            const minX = Math.min(start.x, end.x) - r;
            const minY = Math.min(start.y, end.y) - r;
            const maxX = Math.max(start.x, end.x) + r;
            const maxY = Math.max(start.y, end.y) + r;
            const width = maxX - minX;
            const height = maxY - minY;

            return {
                position: { x: minX, y: minY },
                width: width,
                height: height,
                diameter: r * 2,
                originalSlot: { start: { ...start }, end: { ...end } }
            };
        }

        /**
         * Promotes user-accepted recoverable shapes into proper drill primitives.
         */
        _promoteDrillRecoverable(operation, acceptCircles, acceptObrounds) {
            if (!operation.drillRecoverable) return;

            const quantize = (value) => Math.round(value / PRECISION) * PRECISION;
            let promoted = 0;

            if (acceptCircles && operation.drillRecoverable.circles) {
                for (const candidate of operation.drillRecoverable.circles) {
                    const diameter = quantize(candidate.detected.diameter);
                    const prim = new CirclePrimitive(
                        candidate.detected.center,
                        diameter / 2,
                        {
                            role: 'drill_hole',
                            diameter: diameter,
                            polarity: 'dark',
                            operationType: operation.type,
                            operationId: operation.id,
                            recoveredFromPath: true
                        }
                    );
                    operation.primitives.push(prim);
                    promoted++;
                }
            }

            if (acceptObrounds && operation.drillRecoverable.obrounds) {
                for (const candidate of operation.drillRecoverable.obrounds) {
                    const det = candidate.detected;
                    const diameter = quantize(det.diameter);
                    const prim = new ObroundPrimitive(
                        det.position,
                        det.width,
                        det.height,
                        {
                            role: 'drill_slot',
                            diameter: diameter,
                            originalSlot: det.originalSlot,
                            polarity: 'dark',
                            operationType: operation.type,
                            operationId: operation.id,
                            recoveredFromPath: true
                        }
                    );
                    operation.primitives.push(prim);
                    promoted++;
                }
            }

            // Rebuild bounds and summary
            operation.bounds = this.recalculateBounds(operation.primitives);
            delete operation.drillRecoverable;

            // Re-run summary generation (reuse the summary logic from classify)
            const holeSizes = new Map();
            const slotSizes = new Map();

            for (const prim of operation.primitives) {
                const d = prim.properties?.diameter;
                if (!d) continue;

                if (prim.properties.role === 'drill_hole') {
                    const key = d.toFixed(3);
                    holeSizes.set(key, (holeSizes.get(key) || 0) + 1);
                } else if (prim.properties.role === 'drill_slot') {
                    const slot = prim.properties.originalSlot;
                    if (slot) {
                        const len = Math.hypot(slot.end.x - slot.start.x, slot.end.y - slot.start.y);
                        const slotKey = `${d.toFixed(3)}x${quantize(len + d).toFixed(3)}`;
                        slotSizes.set(slotKey, (slotSizes.get(slotKey) || 0) + 1);
                    }
                }
            }

            operation.drillSummary = {
                holes: Array.from(holeSizes.entries())
                    .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
                    .map(([diameter, count]) => ({ diameter: parseFloat(diameter), count })),
                slots: Array.from(slotSizes.entries())
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([key, count]) => {
                        const [w, l] = key.split('x').map(parseFloat);
                        return { width: w, length: l, count };
                    }),
                totalAccepted: operation.primitives.length,
                totalRejected: 0,
                rejected: [],
                source: 'svg',
                promoted: promoted
            };

            this.debug(`[SVG Drill] Promoted ${promoted} recoverable shape(s)`);
        }

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

                // Copper footprint — skip pre-union so Z metadata (curveIds) survives through a single Clipper2 pass. Clipper2 difference handles overlapping clips internally, making the separate union redundant.
                const footprint = [];
                for (const prim of operation.primitives) {
                    const standardized = this.geometryProcessor.standardizePrimitive(prim, prim.curveIds || []);
                    if (!standardized) continue;
                    if (Array.isArray(standardized)) {
                        footprint.push(...standardized);
                    } else {
                        footprint.push(standardized);
                    }
                }

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

            // ── AUTO-CAP INTERNAL OFFSETS ──
            // For inward-offsetting operations (clearing, internal cutouts), cap passes at the point where geometry would collapse. Prevents wasted WASM calls on empty results and avoids self-intersecting offsets.
            if (isInternal && offsetDistances.length > 1 && operation.bounds) {
                const smallestDim = Math.min(
                    operation.bounds.maxX - operation.bounds.minX,
                    operation.bounds.maxY - operation.bounds.minY
                );
                // Max inward offset = half the smallest dimension (center of smallest feature)
                const maxInwardOffset = smallestDim / 2;
                const cappedDistances = offsetDistances.filter(d => Math.abs(d) <= maxInwardOffset);
                // Always keep at least the first pass
                if (cappedDistances.length > 0 && cappedDistances.length < offsetDistances.length) {
                    this.debug(`Auto-capped internal offsets: ${offsetDistances.length} → ${cappedDistances.length} (smallest dim: ${smallestDim.toFixed(3)}mm)`);
                    offsetDistances = cappedDistances;
                }
            }

            // ── PRE-FUSION FOR CLEARING & CUT-IN RESOLUTION ──
            let primitivesToProcess = operation.primitives;

            // Targeted Cut-In Resolution (For all Copper Layers)
            // Resolves KiCad's self-intersecting zero-width cut-ins into topological holes
            if (operation.type === 'isolation' || operation.type === 'clearing') {
                const resolvedPrimitives = [];
                for (const prim of primitivesToProcess) {
                    const isRegion = prim.type === 'path' && prim.properties?.fill && !prim.properties?.stroke && !prim.properties?.isTrace && !prim.properties?.isComposited;

                    if (isRegion) {
                        try {
                            const resolved = await this.geometryProcessor.unionGeometry([prim]);
                            if (resolved && resolved.length > 0) {
                                resolved.forEach(r => Object.assign(r.properties || (r.properties = {}), prim.properties));
                                resolvedPrimitives.push(...resolved);
                            } else { resolvedPrimitives.push(prim); }
                        } catch (e) { resolvedPrimitives.push(prim); }
                    } else {
                        resolvedPrimitives.push(prim);
                    }
                }
                primitivesToProcess = resolvedPrimitives;
            }

            // ── TOPOLOGICAL CATEGORIZATION ──
            const levelBuckets = [];     // For pre-composited Eagle PolyTrees
            const complexRegions = [];   // KiCad solid regions containing holes (Copper Pours)
            const simpleGeometry = [];   // Traces, Flashes, and solid Polygon Pads

            const isLaserPipeline = settings.clearStrategy !== undefined;
            const shouldSkipPrimitive = (primitive) => {
                if (isLaserPipeline) return false;
                return primitive.properties?.role === 'drill_hole' || primitive.properties?.role === 'drill_slot';
            };

            primitivesToProcess.forEach(prim => {
                if (shouldSkipPrimitive(prim)) return;

                if (prim.properties?.isComposited) {
                    // Eagle files: Already fully resolved into a PolyTree. Just bin by nesting level.
                    if (prim.contours && prim.contours.length > 0) {
                        prim.contours.forEach(contour => {
                            const lvl = contour.nestingLevel || 0;
                            if (!levelBuckets[lvl]) levelBuckets[lvl] = [];
                            levelBuckets[lvl].push(new PathPrimitive([contour], { ...prim.properties }));
                        });
                    } else {
                        if (!levelBuckets[0]) levelBuckets[0] = [];
                        levelBuckets[0].push(prim);
                    }
                } else {
                    // KiCad files: Sort into Simple vs Complex
                    const isTraceOrPad = prim.properties?.isTrace || prim.properties?.isPad || prim.properties?.isFlash || prim.properties?.stroke;

                    if (prim.type === 'path' && prim.contours && prim.contours.length > 0 && !isTraceOrPad) {
                        // Check if this region actually contains any holes
                        const hasHoles = prim.contours.some(c => c.isHole);
                        if (hasHoles) {
                            complexRegions.push(prim); // Treat as a Copper Pour
                        } else {
                            simpleGeometry.push(prim); // Treat as a solid Polygon Pad
                        }
                    } else {
                        simpleGeometry.push(prim); // Standard traces and flashes
                    }
                }
            });

            operation.offsets = [];
            const passResults = [];

            for (let passIndex = 0; passIndex < offsetDistances.length; passIndex++) {
                const distance = offsetDistances[passIndex];
                const offsetType = distance >= 0 ? 'external' : 'internal';

                this.debug(`--- PASS ${passIndex + 1}/${offsetDistances.length}: ${distance.toFixed(3)}mm (${offsetType}) ---`);

                // Helper to process arrays through the fast mathematical offsetter
                const processGroup = async (group, dist) => {
                    const out = [];
                    for (const p of group) {
                        const res = await this.geometryOffsetter.offsetPrimitive(p, dist);
                        if (Array.isArray(res)) out.push(...res);
                        else if (res) out.push(res);
                    }
                    return out;
                };

                let shellPassGeometry = [];
                let holePassGeometry = [];

                if (levelBuckets.length > 0) {
                    // ── EAGLE LOGIC: Level-by-Level Recomposition ──
                    const offsetSimpleGeom = await processGroup(simpleGeometry, distance);

                    for (let lvl = 0; lvl < levelBuckets.length; lvl++) {
                        const bucket = levelBuckets[lvl];
                        if (!bucket || bucket.length === 0) continue;

                        const isHoleLevel = lvl % 2 === 1;
                        const dist = isHoleLevel ? -distance : distance;
                        const offsetBucket = await processGroup(bucket, dist);

                        if (offsetBucket.length === 0) continue;

                        if (lvl === 0) {
                            shellPassGeometry = await this.geometryProcessor.unionGeometry(offsetBucket);
                        } else if (isHoleLevel) {
                            const holeUnion = await this.geometryProcessor.unionGeometry(offsetBucket);
                            if (isLaserPipeline) {
                                // LASER: Keep hole boundaries separate so the cut order can be reversed
                                holePassGeometry.push(...holeUnion);
                            } else {
                                // CNC: Standard behavior, difference holes out of shells
                                if (shellPassGeometry.length > 0) {
                                    shellPassGeometry = await this.geometryProcessor.difference(shellPassGeometry, holeUnion);
                                }
                            }
                        } else {
                            const islandUnion = await this.geometryProcessor.unionGeometry(offsetBucket);
                            shellPassGeometry = await this.geometryProcessor.unionGeometry(shellPassGeometry.concat(islandUnion));
                        }
                    }

                    if (offsetSimpleGeom.length > 0) {
                        if (shellPassGeometry.length > 0) {
                            shellPassGeometry = await this.geometryProcessor.unionGeometry(shellPassGeometry.concat(offsetSimpleGeom));
                        } else {
                            shellPassGeometry = await this.geometryProcessor.unionGeometry(offsetSimpleGeom);
                        }
                    }
                } else {
                    // ── KICAD LOGIC: Per-Region Resolution ──
                    // Batch all simple traces and polygon pads into one fast operation
                    const offsetSimpleGeom = await processGroup(simpleGeometry, distance);
                    const resolvedOffsetRegions = [];

                    for (const regionPrim of complexRegions) {
                        const regionShells = [];
                        const regionHoles = [];

                        regionPrim.contours.forEach(contour => {
                            const simplePrim = new PathPrimitive([contour], { ...regionPrim.properties });
                            if (contour.isHole) regionHoles.push(simplePrim);
                            else regionShells.push(simplePrim);
                        });

                        const offsetShells = await processGroup(regionShells, distance);
                        const offsetHoles = await processGroup(regionHoles, -distance);

                        if (isLaserPipeline) {
                            // LASER: Process separately
                            if (offsetShells.length > 0) {
                                const shellUnion = await this.geometryProcessor.unionGeometry(offsetShells);
                                shellPassGeometry.push(...shellUnion);
                            }
                            if (offsetHoles.length > 0) {
                                const holeUnion = await this.geometryProcessor.unionGeometry(offsetHoles);
                                holePassGeometry.push(...holeUnion);
                            }
                        } else {
                            // CNC: Standard difference
                            let regionResult = [];
                            if (offsetShells.length > 0) {
                                const shellUnion = await this.geometryProcessor.unionGeometry(offsetShells);
                                if (offsetHoles.length > 0) {
                                    const holeUnion = await this.geometryProcessor.unionGeometry(offsetHoles);
                                    regionResult = await this.geometryProcessor.difference(shellUnion, holeUnion);
                                } else {
                                    regionResult = shellUnion;
                                }
                            }
                            if (regionResult.length > 0) {
                                resolvedOffsetRegions.push(...regionResult);
                            }
                        }
                    }

                    if (!isLaserPipeline) {
                        if (resolvedOffsetRegions.length > 0) {
                            if (offsetSimpleGeom.length > 0) {
                                shellPassGeometry = await this.geometryProcessor.unionGeometry(resolvedOffsetRegions.concat(offsetSimpleGeom));
                            } else {
                                shellPassGeometry = await this.geometryProcessor.unionGeometry(resolvedOffsetRegions);
                            }
                        } else if (offsetSimpleGeom.length > 0) {
                            shellPassGeometry = await this.geometryProcessor.unionGeometry(offsetSimpleGeom);
                        }
                    } else if (offsetSimpleGeom.length > 0) {
                        shellPassGeometry.push(...await this.geometryProcessor.unionGeometry(offsetSimpleGeom));
                    }
                }

                // Apply post-processing to both buckets
                const processBucket = (geometryBucket, groupTag, actualDist) => {
                    if (geometryBucket.length === 0) return;

                    if (!settings.skipArcReconstruction && Math.abs(actualDist) >= PRECISION) {
                        geometryBucket = this.geometryProcessor.arcReconstructor.processForReconstruction(geometryBucket);
                    }
                    this.geometryOffsetter.simplifyOffsetResult(geometryBucket, Math.abs(actualDist));

                    // A negative actual distance means the path shrinks inward (Clearing outers, Isolation holes)
                    // A positive actual distance means the path grows outward (Isolation outers, Clearing islands)
                    const thermalGroup = actualDist < 0 ? 'internal' : 'external';

                    const reconstructedGeometry = geometryBucket.map(p => {
                        if (!p.properties) p.properties = {};
                        p.properties.isOffset = true;
                        p.properties.pass = passIndex + 1;
                        p.properties.offsetDistance = distance;
                        p.properties.offsetType = offsetType;
                        p.properties.thermalGroup = thermalGroup; 
                        p.properties.hasAnalyticArcs = (p.type === 'circle') || (p.arcSegments && p.arcSegments.length > 0);
                        return p;
                    });

                    passResults.push({
                        distance: distance,         // The nominal loop distance
                        actualDistance: actualDist, // The physical math distance
                        pass: passIndex + 1,
                        offsetType: offsetType,
                        thermalGroup: thermalGroup,
                        primitives: reconstructedGeometry,
                        metadata: {
                            sourceCount: primitivesToProcess.length,
                            finalCount: reconstructedGeometry.length,
                            generatedAt: Date.now(),
                            toolDiameter: settings.toolDiameter,
                            wasFused: primitivesToProcess !== operation.primitives,
                            thermalGroup: thermalGroup
                        }
                    });
                };

                // Pass the true physical distance logic applied to each bucket
                processBucket(shellPassGeometry, 'shell', distance);
                processBucket(holePassGeometry, 'hole', -distance);
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
                        if (len < PRECISION) {
                            isSlot = false; // Treat as hole
                            primitive.center = slot.start;
                            if (!primitive.radius) primitive.radius = featureSize / 2;
                        }
                    }
                }

                // Calculate tool relation
                const diff = featureSize - toolDiameter;
                let toolRelation = 'exact';
                if (diff < -PRECISION) toolRelation = 'oversized';
                else if (diff > PRECISION) toolRelation = 'undersized';

                // Hole logic
                if (!isSlot) {

                    // Only check if the hole is larger than the tool by the minimum margin.
                    if (settings.millHoles && 
                        toolRelation === 'undersized' && 
                        diff >= (minMillingMargin - EPSILON)) {

                        plan.push({ 
                            type: 'mill',
                            primitiveToOffset: primitive, 
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

            for (let actionIdx = 0; actionIdx < plan.length; actionIdx++) {
                const action = plan[actionIdx];
                if (action.type === 'peck') {
                    // Create peck mark circle
                    strategyPrimitives.push(new CirclePrimitive(
                        action.position,
                        toolDiameter / 2,
                        {
                            role: 'peck_mark',
                            holeIndex: actionIdx,
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
                            const stepOverPct = settings.stepOver !== undefined ? settings.stepOver : D.toolpath.generation.drilling.defaultStepOver;
                            const stepDist = toolDiameter * (stepOverPct / 100);

                            const concentricPasses = [];
                            let currentRadius = pathRadius;
                            let p = 1;

                            while (currentRadius >= minFeatureSize) {
                                concentricPasses.push(new CirclePrimitive(
                                    source.center,
                                    currentRadius,
                                    {
                                        role: 'drill_milling_path',
                                        holeIndex: actionIdx,
                                        operationId: operation.id,
                                        toolDiameter: toolDiameter,
                                        originalDiameter: holeRadius * 2,
                                        toolRelation: action.toolRelation || 'undersized',
                                        isOffset: true,
                                        offsetType: 'internal',
                                        pass: p++
                                    }
                                ));

                                // Core destroyed when tool at this radius clears past center
                                if (currentRadius <= toolRadius) break;

                                currentRadius -= stepDist;

                                // Clamp to minimum rather than skipping a needed center pass
                                if (currentRadius < minFeatureSize && currentRadius > 0) {
                                    currentRadius = minFeatureSize;
                                }
                            }

                            // Reverse: innermost first (macro expects inside-out)
                            strategyPrimitives.push(...concentricPasses.reverse());
                        } else {
                            // Hole too small to mill - fall back to peck
                            strategyPrimitives.push(new CirclePrimitive(
                                source.center,
                                toolDiameter / 2,
                                {
                                    role: 'peck_mark',
                                    holeIndex: actionIdx,
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
                            const stepOverPct = settings.stepOver !== undefined ? settings.stepOver : D.toolpath.generation.drilling.defaultStepOver;
                            const stepDist = toolDiameter * (stepOverPct / 100);

                            const concentricPasses = [];
                            let currentShort = pathThickness;
                            let currentLong = pathLength;
                            let p = 1;

                            while (currentShort >= minFeatureSize && currentLong >= currentShort) {
                                let obroundWidth, obroundHeight, cornerX, cornerY;

                                if (isHorizontal) {
                                    // Horizontal slot: long axis along X
                                    obroundWidth = currentLong;
                                    obroundHeight = currentShort;
                                    cornerX = centerX - currentLong / 2;
                                    cornerY = centerY - currentShort / 2;
                                } else {
                                    // Vertical slot: long axis along Y
                                    obroundWidth = currentShort;
                                    obroundHeight = currentLong;
                                    cornerX = centerX - currentShort / 2;
                                    cornerY = centerY - currentLong / 2;
                                }

                                concentricPasses.push(new ObroundPrimitive(
                                    { x: cornerX, y: cornerY },
                                    obroundWidth,
                                    obroundHeight,
                                    {
                                        role: 'drill_milling_path',
                                        holeIndex: actionIdx,
                                        originalDiameter: slotWidth,
                                        toolDiameter: toolDiameter,
                                        originalSlot: originalSlot,
                                        toolRelation: 'undersized',
                                        operationId: operation.id,
                                        isOffset: true,
                                        offsetType: 'internal',
                                        pass: p++
                                    }
                                ));

                                // Core destroyed when minor axis <= tool diameter
                                if (currentShort <= toolDiameter) break;

                                currentShort -= (2 * stepDist);
                                currentLong -= (2 * stepDist);

                                // Clamp to minimum rather than skipping
                                if (currentShort < minFeatureSize && currentShort > 0) {
                                    currentShort = minFeatureSize;
                                    currentLong = Math.max(currentLong, currentShort);
                                }
                            }

                            strategyPrimitives.push(...concentricPasses.reverse());
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
                            holeIndex: actionIdx,
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

        async generateStencilGeometry(operation, settings) {
            this.debug(`=== STENCIL GEOMETRY GENERATION ===`);
            await this.ensureProcessorReady();

            if (!operation.primitives || operation.primitives.length === 0) {
                return [];
            }

            // Filter primitives based on user settings
            let primitivesToProcess;

            if (settings.stencilIgnoreRegions) {
                primitivesToProcess = operation.primitives.filter(prim => {
                    const props = prim.properties || {};
                    if (props.isFlash || props.isPad) return true;
                    if (prim.type === 'circle' || prim.type === 'rectangle' || prim.type === 'obround') return true;
                    if (props.isTrace || props.stroke) return false;
                    if (prim.type === 'path' && props.fill && !props.isFlash) return false;
                    return false;
                });
                this.debug(`Filtered primitives: ${operation.primitives.length} → ${primitivesToProcess.length}`);
            } else {
                primitivesToProcess = [...operation.primitives];
            }

            // Exclude pads that overlap drill holes (soldermask around through-hole pins)
            if (settings.stencilExcludeDrillPads && primitivesToProcess.length > 0) {
                // Collect all drill hole centers and radii from drill operations
                const drillHoles = [];
                for (const op of this.operations) {
                    if (op.type !== 'drill' || !op.primitives) continue;
                    for (const prim of op.primitives) {
                        if (prim.properties?.role === 'drill_hole' && prim.center && prim.radius) {
                            drillHoles.push({ x: prim.center.x, y: prim.center.y, r: prim.radius });
                        }
                    }
                }

                if (drillHoles.length > 0) {
                    const beforeCount = primitivesToProcess.length;
                    primitivesToProcess = primitivesToProcess.filter(prim => {
                        // Get a representative center point for this pad
                        const rep = GeometryUtils.getRepresentativePoint(prim);
                        if (!rep) return true; // Keep if position can't determined

                        // Check if any drill hole center is inside or very close to this pad's center
                        for (const hole of drillHoles) {
                            const dist = Math.hypot(rep.x - hole.x, rep.y - hole.y);
                            // If the drill hole center is within the pad's bounding radius, exclude it
                            const bounds = prim.getBounds();
                            const padRadius = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2;
                            if (dist < padRadius * 0.8) {
                                return false; // Drill hole overlaps this pad, exclude it
                            }
                        }
                        return true;
                    });
                    this.debug(`Drill hole exclusion: ${beforeCount} → ${primitivesToProcess.length} (removed ${beforeCount - primitivesToProcess.length})`);
                }
            }

            // Apply shrink/grow offset
            let processedGeometry = [];
            const offsetDist = settings.stencilOffset || 0;

            if (Math.abs(offsetDist) > PRECISION && this.geometryOffsetter) {
                this.debug(`Applying stencil offset: ${offsetDist.toFixed(3)}mm`);

                for (const prim of primitivesToProcess) {
                    const offsetResult = await this.geometryOffsetter.offsetPrimitive(prim, offsetDist);
                    if (offsetResult) {
                        if (Array.isArray(offsetResult)) {
                            processedGeometry.push(...offsetResult);
                        } else {
                            processedGeometry.push(offsetResult);
                        }
                    }
                }

                // Union to clean up any self-intersections from shrinking
                if (processedGeometry.length > 1 && this.geometryProcessor) {
                    try {
                        processedGeometry = await this.geometryProcessor.unionGeometry(processedGeometry);
                    } catch (e) {
                        this.debug(`Union after offset failed: ${e.message}, using raw offset results`);
                    }
                }
            } else {
                // No offset — use primitives as-is, but ensure they are standardized paths for the exporter
                for (const prim of primitivesToProcess) {
                    if (prim.type === 'path') {
                        processedGeometry.push(prim);
                    } else {
                        const pathPrim = GeometryUtils.primitiveToPath(prim);
                        if (pathPrim) {
                            processedGeometry.push(pathPrim);
                        }
                    }
                }
            }

            // Add registration holes (appended after union so they stay as clean circles)
            if (settings.stencilAddRegHoles) {
                const bounds = this.coordinateSystem?.boardBounds || operation.bounds;
                if (bounds && isFinite(bounds.minX)) {
                    const margin = settings.stencilRegMargin || 5.0;
                    const radius = (settings.stencilRegDiameter || 3.0) / 2;

                    const corners = [
                        { x: bounds.minX - margin, y: bounds.minY - margin },
                        { x: bounds.maxX + margin, y: bounds.minY - margin },
                        { x: bounds.minX - margin, y: bounds.maxY + margin },
                        { x: bounds.maxX + margin, y: bounds.maxY + margin }
                    ];

                    for (const center of corners) {
                        const regHole = new CirclePrimitive(center, radius, {
                            polarity: 'dark',
                            isRegistration: true,
                            role: 'registration_hole',
                            operationId: operation.id
                        });
                        // Keep as CirclePrimitive — both the renderer and LaserImageExporter handle circles natively
                        processedGeometry.push(regHole);
                    }
                    this.debug(`Added 4 registration holes (r=${radius.toFixed(2)}mm, margin=${margin}mm)`);
                } else {
                    console.warn('[Core] Cannot add registration holes: board bounds not available');
                }
            }

            // Tag as machine paths (stroked outlines, no fill — like cutout offsets)
            processedGeometry.forEach(p => {
                if (!p.properties) p.properties = {};
                p.properties.operationType = 'stencil';
                p.properties.operationId = operation.id;
                p.properties.fill = false;
                p.properties.stroke = true;
                p.properties.strokeWidth = 1;
                p.properties.isOffset = true;
                p.properties.offsetType = 'external';
            });

            operation.offsets = [{
                distance: offsetDist,
                pass: 1,
                type: 'stencil',
                primitives: processedGeometry,
                metadata: {
                    strategy: 'offset',
                    isStencil: true,
                    finalCount: processedGeometry.length,
                    generatedAt: Date.now()
                }
            }];

            this.isToolpathCacheValid = false;
            this.debug(`Stencil generation complete: ${processedGeometry.length} primitives`);
            this.debug(`=== STENCIL GEOMETRY COMPLETE ===`);
            return operation.offsets;
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