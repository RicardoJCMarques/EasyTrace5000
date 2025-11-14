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
                    console.error(`❌ ${className} not available`);
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
                    scale: geomConfig.clipperScale || 10000,
                    preserveOriginals: true
                });
                
                // Initialize GeometryOffsetter
                if (typeof GeometryOffsetter !== 'undefined') {
                    this.geometryOffsetter = new GeometryOffsetter({
                        precision: geomConfig.coordinatePrecision || 0.001,
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
                        const merged = this.mergeSegmentsIntoClosedPath(primitives);
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
        
        mergeSegmentsIntoClosedPath(segments) {
            if (!segments || segments.length < 2) return null;

            this.debug('Merge input:', segments.map((s, i) => 
                    `[${i}] ${s.type} ${s.startPoint ? `(${s.startPoint.x.toFixed(1)},${s.startPoint.y.toFixed(1)})→(${s.endPoint.x.toFixed(1)},${s.endPoint.y.toFixed(1)})` : ''}`
                ).join(', '));

            const precision = geomConfig.coordinatePrecision || 0.001;
            
            // Step 1: Build adjacency graph
            const graph = this.buildSegmentGraph(segments);
            
            // Step 2: Find Eulerian path (if exists)
            const orderedSegments = this.findClosedPath(graph, segments);
            
            if (!orderedSegments || orderedSegments.length !== segments.length) {
                console.warn('[Core] Failed to create closed path from segments');
                return null;
            }
            
            // Step 3: Build final PathPrimitive with correct arc indices
            return this.assembleClosedPath(orderedSegments, precision);
        }

        buildSegmentGraph(segments) {
            const getEndpoints = (prim) => {
                if (prim.type === 'arc') {
                    return { start: prim.startPoint, end: prim.endPoint };
                }
                if (prim.type === 'path' && prim.points.length >= 2) {
                    return { 
                        start: prim.points[0], 
                        end: prim.points[prim.points.length - 1] 
                    };
                }
                return null;
            };

            const keyPrecision = geomConfig.edgeKeyPrecision || 3;
            const pointKey = (p) => {
                return `${p.x.toFixed(keyPrecision)},${p.y.toFixed(keyPrecision)}`;
            };

            const graph = new Map();
            
            segments.forEach((seg, idx) => {
                const endpoints = getEndpoints(seg);
                if (!endpoints) return;
                
                const startKey = pointKey(endpoints.start);
                const endKey = pointKey(endpoints.end);
                
                // Add forward connection
                if (!graph.has(startKey)) graph.set(startKey, []);
                graph.get(startKey).push({
                    segmentIndex: idx,
                    direction: 'forward',
                    nextPoint: endpoints.end
                });
                
                // Add reverse connection
                if (!graph.has(endKey)) graph.set(endKey, []);
                graph.get(endKey).push({
                    segmentIndex: idx,
                    direction: 'reverse',
                    nextPoint: endpoints.start
                });
            });

            this.debug('Graph built:',
                Array.from(graph.entries()).map(([key, conns]) => 
                    `${key}: [${conns.map(c => `seg${c.segmentIndex}${c.direction[0]}`).join(',')}]`
                ).join('; ')
            );
            
            return graph;
        }

        findClosedPath(graph, segments) {
            const keyPrecision = geomConfig.edgeKeyPrecision || 3;
            const pointKey = (p) => `${p.x.toFixed(keyPrecision)},${p.y.toFixed(keyPrecision)}`;
            
            // Find starting point
            let startKey = null;
            for (const [key, connections] of graph.entries()) {
                if (connections.length > 0) {
                    startKey = key;
                    break;
                }
            }
            
            if (!startKey) return null;
            
            const used = new Set();
            const path = [];
            let currentKey = startKey;
            
            while (path.length < segments.length) {
                const connections = graph.get(currentKey);
                if (!connections) break;
                
                // Find unused connection
                let found = false;
                for (const conn of connections) {
                    if (!used.has(conn.segmentIndex)) {
                        used.add(conn.segmentIndex);
                        
                        // Store segment with direction info
                        path.push({
                            segment: segments[conn.segmentIndex],
                            direction: conn.direction,
                            originalIndex: conn.segmentIndex
                        });
                        
                        currentKey = pointKey(conn.nextPoint);
                        found = true;
                        break;
                    }
                }
                
                if (!found) break;
            }
            
            // Verify closed loop
            if (path.length === segments.length) {
                const firstStart = this.getSegmentStart(path[0].segment, path[0].direction);
                const lastEnd = this.getSegmentEnd(path[path.length - 1].segment, path[path.length - 1].direction);
                
                const precision = geomConfig.coordinatePrecision || 0.001;
                if (Math.hypot(firstStart.x - lastEnd.x, firstStart.y - lastEnd.y) < precision) {
                    return path;
                }
            }
            
            return null;
        }

        getSegmentStart(segment, direction) {
            if (segment.type === 'arc') {
                return direction === 'forward' ? segment.startPoint : segment.endPoint;
            }
            if (segment.type === 'path') {
                return direction === 'forward' ? 
                    segment.points[0] : 
                    segment.points[segment.points.length - 1];
            }
            return null;
        }

        getSegmentEnd(segment, direction) {
            if (segment.type === 'arc') {
                return direction === 'forward' ? segment.endPoint : segment.startPoint;
            }
            if (segment.type === 'path') {
                return direction === 'forward' ? 
                    segment.points[segment.points.length - 1] : 
                    segment.points[0];
            }
            return null;
        }

        assembleClosedPath(orderedSegments, precision) {
            this.debug('Stitched order:', orderedSegments.map((seg, i) => 
                `[${i}] orig[${seg.originalIndex}] ${seg.segment.type} ${seg.direction}`
            ).join(', '));

            const finalPoints = [];
            const finalArcSegments = [];
            
            // Add first point
            const firstSeg = orderedSegments[0];
            const firstStart = this.getSegmentStart(firstSeg.segment, firstSeg.direction);
            finalPoints.push(firstStart);

            // Determine path winding
            const tempPoints = orderedSegments.map(seg => 
                this.getSegmentStart(seg.segment, seg.direction)
            );
            const pathWinding = GeometryUtils.calculateWinding(tempPoints);
            const pathIsCCW = pathWinding > 0;
            
            this.debug(`Path winding: ${pathIsCCW ? 'CCW' : 'CW'} (preserving arc directions)`);


            for (let idx = 0; idx < orderedSegments.length; idx++) {
                const {segment, direction} = orderedSegments[idx];
                const currentPointIndex = finalPoints.length - 1;
                
                if (segment.type === 'arc') {
                    const arc = segment;
                    const nextPointIndex = currentPointIndex + 1;
                    
                    // Handle segment reversal
                    let arcClockwise = arc.clockwise;
                    let arcStartAngle = arc.startAngle;
                    let arcEndAngle = arc.endAngle;
                    let arcEndPoint = arc.endPoint;
                    
                    if (direction === 'reverse') {
                        // Reversed segment: swap start/end and flip direction
                        arcStartAngle = arc.endAngle;
                        arcEndAngle = arc.startAngle;
                        arcClockwise = !arc.clockwise;
                        arcEndPoint = arc.startPoint;
                    }

                    this.debug(`  Arc ${idx}: ${arcClockwise ? 'CW' : 'CCW'} (direction=${direction})`);

                    finalPoints.push(arcEndPoint);
                    
                    if (isFinite(arc.radius) && arc.radius > 0) {
                        // Calculate sweep angle
                        let sweepAngle = arcEndAngle - arcStartAngle;
                        
                        // Normalize to smallest absolute angle
                        while (sweepAngle > Math.PI) sweepAngle -= 2 * Math.PI;
                        while (sweepAngle < -Math.PI) sweepAngle += 2 * Math.PI;
                        
                        // Apply direction
                        if (!arcClockwise && sweepAngle < 0) {
                            sweepAngle += 2 * Math.PI;
                        } else if (arcClockwise && sweepAngle > 0) {
                            sweepAngle -= 2 * Math.PI;
                        }
                        
                        finalArcSegments.push({
                            startIndex: currentPointIndex,
                            endIndex: nextPointIndex,
                            center: arc.center,
                            radius: arc.radius,
                            startAngle: arcStartAngle,
                            endAngle: arcEndAngle,
                            clockwise: arcClockwise,
                            sweepAngle: sweepAngle
                        });
                        
                        this.debug(`Arc ${finalArcSegments.length - 1}: ${currentPointIndex}->${nextPointIndex}, r=${arc.radius.toFixed(3)}, sweep=${(sweepAngle * 180 / Math.PI).toFixed(1)}°, ${arcClockwise ? 'CW' : 'CCW'}`);
                    }
                    
                } else if (segment.type === 'path') {
                    this.debug(`ath segment orig[${orderedSegments[idx].originalIndex}]: ${segment.points.length} points, ${direction}`);
                    const points = direction === 'forward' ? 
                        segment.points.slice(1) : 
                        segment.points.slice(0, -1).reverse();
                    finalPoints.push(...points);
                }
            }
            
            // Remove duplicate closing point
            const originalEndPointIndex = finalPoints.length - 1;
            if (originalEndPointIndex > 0 && 
                Math.hypot(finalPoints[0].x - finalPoints[originalEndPointIndex].x,
                        finalPoints[0].y - finalPoints[originalEndPointIndex].y) < precision) {
                finalPoints.pop();
                
                // Adjust arc indices
                finalArcSegments.forEach(seg => {
                    if (seg.endIndex === originalEndPointIndex) {
                        seg.endIndex = 0;
                    }
                    if (seg.startIndex === originalEndPointIndex) {
                        seg.startIndex = 0;
                    }
                });
            }
            
            this.debug(`Final path: ${finalPoints.length} points, ${finalArcSegments.length} arcs`);

            // Create the final primitive
            const finalContour = {
                points: finalPoints,
                isHole: false,
                nestingLevel: 0,
                parentId: null,
                curveIds: [],
                arcSegments: finalArcSegments
            };
            
            const finalProperties = {
                isCutout: true,
                fill: true,
                stroke: false,
                closed: true,
                mergedFromSegments: orderedSegments.length,
                polarity: 'dark',
                contours: [finalContour],
                arcSegments: finalArcSegments
            };
            
            const finalPrimitive = new PathPrimitive(finalPoints, finalProperties);
            
            return finalPrimitive;
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
            
            const offsetDistances = this._calculateOffsetDistances(
                settings.toolDiameter,
                settings.passes,
                settings.stepOver,
                operation.type === 'clear' // isInternal
            );

            const outerContours = [];
            const holeContours = [];
            
            operation.primitives.forEach(primitive => {
                const primitivePolarity = primitive.properties?.polarity || 'dark';

                if (primitive.contours && primitive.contours.length === 1) {
                    if (primitivePolarity === 'clear') {
                        holeContours.push(primitive);
                    } else {
                        outerContours.push(primitive);
                    }
                } else if (primitive.contours && primitive.contours.length > 1) {
                    primitive.contours.forEach(contour => {
                        const contourPrimitive = this._createPathPrimitive(contour.points, {
                            ...primitive.properties,
                            polarity: contour.isHole ? 'clear' : 'dark',
                            arcSegments: contour.arcSegments || [],
                            curveIds: contour.curveIds || []
                        });
                        contourPrimitive.points = contour.points;
                        
                        if (contour.isHole) {
                            holeContours.push(contourPrimitive);
                        } else {
                            outerContours.push(contourPrimitive);
                        }
                    });
                } else {
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
                    
                    if (role === 'drill_hole' || role === 'drill_slot') {
                        continue;
                    }
                    
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
                
                this.debug(`Offset generated: ${offsetOuters.length} outer shapes, ${offsetHoles.length} hole shapes.`);

                const polygonizedOuters = offsetOuters.map(p => this.tessellateForProcessor(p)).filter(Boolean);
                const polygonizedHoles = offsetHoles.map(p => this.tessellateForProcessor(p)).filter(Boolean);

                this.debug(`Polygonized to: ${polygonizedOuters.length} outer paths, ${polygonizedHoles.length} hole paths.`);

                if (polygonizedOuters.length === 0) {
                    console.warn(`[Core] Pass ${passIndex + 1} produced no valid outer geometry. Skipping.`);
                    continue;
                }

                const subjectGeometry = await this.geometryProcessor.unionGeometry(polygonizedOuters);

                this.debug(`Union of outers resulted in ${subjectGeometry.length} subject shape(s).`);

                let finalPassGeometry;

                const firstOuter = polygonizedOuters[0];
                const isAnalytic = firstOuter &&
                                firstOuter.contours &&
                                firstOuter.contours[0]?.arcSegments?.length > 0;

                if (polygonizedOuters.length === 1 && polygonizedHoles.length === 0 && isAnalytic) {
                    console.log(`Skipping boolean/reconstruction for single analytic path.`);
                    
                    finalPassGeometry = polygonizedOuters;
                    
                    const reconstructedGeometry = finalPassGeometry.map(p => {
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
                        unionCount: 0,
                        finalCount: reconstructedGeometry.length,
                        generatedAt: Date.now(),
                        toolDiameter: settings.toolDiameter,
                        analytic: true
                        }
                    });

                    continue;

                } else {
                    this.debug(`Running boolean operations for complex geometry...`);
                    const subjectGeometry = await this.geometryProcessor.unionGeometry(polygonizedOuters);
                    this.debug(`Union of outers resulted in ${subjectGeometry.length} subject shape(s).`);

                    if (polygonizedHoles.length > 0) {
                        const clipGeometry = await this.geometryProcessor.unionGeometry(polygonizedHoles);
                        this.debug(`Union of holes resulted in ${clipGeometry.length} clip shape(s).`);
                        this.debug(`Performing DIFFERENCE operation...`);
                        finalPassGeometry = await this.geometryProcessor.difference(subjectGeometry, clipGeometry);
                    } else {
                        finalPassGeometry = subjectGeometry;
                    }
                }
                
                this.debug(`Boolean operations complete. Final geometry has ${finalPassGeometry.length} primitive(s).`);
                this.debug(`Running arc reconstruction...`);

                let reconstructedGeometry = this.geometryProcessor.arcReconstructor.processForReconstruction(finalPassGeometry);

                this.debug(`Arc reconstruction complete. Primitive count: ${reconstructedGeometry.length}`);
                
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
                        toolDiameter: settings.toolDiameter
                    }
                });
            }
            
            if (settings.combineOffsets && passResults.length > 1) {
                this.debug(`=== COMBINING ${passResults.length} PASSES ===`);
                
                const allPassPrimitives = passResults.flatMap(p => p.primitives);

                this.debug(`Combined ${allPassPrimitives.length} total primitives`);
                
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

            // Validate and warn about oversized tools
            operation.offsets.forEach(offsetGroup => {
                const oversizedMarks = offsetGroup.primitives.filter(p => p.properties?.oversized);
                if (oversizedMarks.length > 0) {
                    const warningMsg = `Warning: ${oversizedMarks.length} hole(s) have tool diameter larger than hole diameter.`;
                    console.warn(`[Core] ${warningMsg}`);
                    
                    if (!operation.warnings) operation.warnings = [];
                    operation.warnings.push({
                        type: 'oversized-drill',
                        count: oversizedMarks.length,
                        message: warningMsg,
                        positions: oversizedMarks.map(m => ({
                            x: m.center.x,
                            y: m.center.y,
                            holeDiameter: m.properties.originalHoleDiameter,
                            toolDiameter: m.properties.toolDiameter
                        }))
                    });
                }
            });
            
            this.isToolpathCacheValid = false;
            return operation.offsets;
        }
        
        // Helper to tessellate primitives for processor
        tessellateForProcessor(primitive) {
            if (primitive.type === 'path') {
                // If it's a path, check if it has analytic segments that the processor might not understand (e.g., from cutout merge)
                if (primitive.arcSegments && primitive.arcSegments.length > 0) {
                    // Re-tessellate the path using its own analytic data
                    return primitive;
                }
                return primitive;
            }

            // This will return a new PathPrimitive
            if (typeof GeometryUtils !== 'undefined' && GeometryUtils.primitiveToPath) {
                return GeometryUtils.primitiveToPath(primitive);
            }

            console.warn(`[Core] Tessellation failed: GeometryUtils.primitiveToPath missing.`);
            return null;
        }

        _determineDrillStrategy(operation, settings) {
            const plan = [];
            const warnings = [];
            const toolRadius = settings.toolDiameter / 2;
            const precision = geomConfig.coordinatePrecision;

            for (const primitive of operation.primitives) {
                const role = primitive.properties?.role;
                
                if (role === 'drill_hole') {
                    const holeRadius = primitive.radius;
                    const holeDiameter = primitive.properties.diameter;
                    const comparison = toolRadius - holeRadius;

                    const drillStrategyConfig = opsConfig.drill?.strategy || {};
                    const minMillingMargin = drillStrategyConfig.minMillingMargin || 0.05;

                    if (settings.millHoles && (holeRadius - toolRadius) >= minMillingMargin) {
                        plan.push({
                            type: 'mill',
                            primitiveToOffset: primitive,
                            passes: settings.passes
                        });
                    } else {
                        const isOversized = comparison > precision;
                        const isUndersized = comparison < -precision;
                        
                        if (isOversized) {
                            warnings.push({
                                type: 'oversized-drill',
                                message: `Hole at (${primitive.center.x.toFixed(1)}, ${primitive.center.y.toFixed(1)}): Tool (${(toolRadius * 2).toFixed(2)}mm) larger than hole (${holeDiameter.toFixed(2)}mm).`,
                                severity: 'warning',
                                recommendation: 'Select a smaller tool diameter'
                            });
                        }
                        
                        if (isUndersized) {
                            warnings.push({
                                type: 'undersized-drill',
                                message: `Hole at (${primitive.center.x.toFixed(1)}, ${primitive.center.y.toFixed(1)}): Tool (${(toolRadius * 2).toFixed(2)}mm) too close to hole size (${holeDiameter.toFixed(2)}mm).`,
                                severity: 'warning',
                                recommendation: 'Leave milling mode enabled'
                            });
                        }
                        
                        plan.push({
                            type: 'peck',
                            position: primitive.center,
                            toolDiameter: toolRadius * 2,
                            originalDiameter: holeDiameter,
                            oversized: isOversized,
                            undersized: isUndersized
                        });
                    }
                } else if (role === 'drill_slot') {
                    const slot = primitive.properties.originalSlot;
                    const slotRadius = primitive.properties.diameter / 2;
                    const slotDiameter = primitive.properties.diameter;
                    const comparison = toolRadius - slotRadius;
                    const slotLength = Math.hypot(slot.end.x - slot.start.x, slot.end.y - slot.start.y);
                    const toolDiameter = toolRadius * 2;

                    const canMill = settings.millHoles && comparison < -precision;

                    if (!canMill) {
                        const proximityRisk = slotLength < toolDiameter;
                        
                        if (proximityRisk) {
                            warnings.push({
                                type: 'slot-dual-drill',
                                message: `Slot at (${slot.start.x.toFixed(1)}, ${slot.start.y.toFixed(1)}) to (${slot.end.x.toFixed(1)}, ${slot.end.y.toFixed(1)}): Too short for tool. Using dual-drill with 50% reduced plunge.`,
                                severity: 'error',
                                recommendation: 'Reduce plunge rate by 50% to minimize drill bit bending'
                            });
                        }
                        
                        plan.push(
                            {
                                type: 'peck',
                                position: slot.start,
                                toolDiameter: toolDiameter,
                                originalDiameter: slotDiameter,
                                oversized: comparison > precision,
                                undersized: comparison < -precision 
                            },
                            {
                                type: 'peck',
                                position: slot.end,
                                toolDiameter: toolDiameter,
                                originalDiameter: slotDiameter,
                                oversized: comparison > precision,
                                undersized: comparison < -precision,
                                reducedPlunge: proximityRisk
                            }
                        );
                    } else {
                        plan.push({
                            type: 'mill',
                            primitiveToOffset: primitive,
                            passes: settings.passes
                        });
                    }
                }
            }
            
            return { plan, warnings };
        }

        async _generateDrillGeometryFromStrategy(plan, operation, settings) {
            const strategyPrimitives = [];
            
            // Calculate internal offset distances for milling
            const defaultToolDiameter = opsConfig.drill.tool.diameter;
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
                            oversized: action.oversized,
                            undersized: action.undersized,
                            reducedPlunge: action.reducedPlunge,
                            slotPart: action.slotPart,
                            operationId: operation.id
                        }
                    ));
                    
                } else if (action.type === 'mill') {
                    // Single pass at tool centerline
                    const source = action.primitiveToOffset;
                    const holeRadius = source.radius;
                    const toolRadius = toolDiameter / 2;
                    const pathRadius = holeRadius - toolRadius;

                    const drillStrategyConfig = opsConfig.drill?.strategy || {};
                    const minFeatureSize = drillStrategyConfig.minMillingFeatureSize;
                    
                    if (pathRadius > minFeatureSize) {
                        if (source.type === 'circle') {
                            const millingPath = new CirclePrimitive(
                                source.center,
                                pathRadius,
                                {
                                    role: 'drill_milling_path',
                                    originalDiameter: source.properties.diameter,
                                    operationId: operation.id,
                                    toolDiameter: toolDiameter
                                }
                            );
                            strategyPrimitives.push(millingPath);
                        } 
                        else if (source.type === 'obround') {
                            const newWidth = source.width - toolDiameter;
                            const newHeight = source.height - toolDiameter;
                            
                            if (newWidth > minFeatureSize && newHeight > minFeatureSize) {
                                const millingPath = new ObroundPrimitive(
                                    {
                                        x: source.position.x + toolRadius,
                                        y: source.position.y + toolRadius
                                    },
                                    newWidth,
                                    newHeight,
                                    {
                                        role: 'drill_milling_path',
                                        originalDiameter: source.properties.diameter,
                                        operationId: operation.id,
                                        toolDiameter: toolDiameter,
                                        originalSlot: source.properties?.originalSlot
                                    }
                                );
                                strategyPrimitives.push(millingPath);
                            }
                        }
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

            // Store in operation.offsets for UI compatibility
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
            // Use a small epsilon to handle floating point errors
            while (currentDepth - step > finalDepth - 1e-9) { 
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

            // Get ALL parameters from manager
            const params = parameterManager.getAllParameters(operationId);
            
            // Get global settings
            const machine = this.settings.machine;
            const gcode = this.settings.gcode;

            // Get precision values
            const toolpathConfig = config.toolpath || {};
            const precision = config.geometry.coordinatePrecision;
            const offsettingEpsilon = config.geometry.offsetting?.epsilon;

            // Compute derived values
            const isInternal = (operation.type === 'clear');
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
                    direction: params.direction,
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