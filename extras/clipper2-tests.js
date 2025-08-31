/**
 * Clipper2 Tests Module
 * Test implementations with state-driven architecture
 * Version 6.9 - Fixed Minkowski diff sweep & area ghost polygon
 */

class Clipper2Tests {
    constructor() {
        this.core = null;
        this.geometry = null;
        this.operations = null;
        this.rendering = null;
        this.ui = null;
        this.testData = new Map();
        this.defaults = Clipper2Defaults;
        
        // Centralized test state - single source of truth
        this.testState = {
            boolean: {
                operation: 'union',
                clipShape: 'circle',
                subjectPos: { x: 200, y: 200 }, // Fixed at center
                clipPos: { x: 100, y: 100 }, // Top-left corner of subject
                randomShape: null,
                rabbitPath: null // Store parsed rabbit path
            },
            letterB: {
                // No parameters needed
            },
            pcbFusion: {
                // No parameters needed
            },
            nested: {
                island1Pos: { x: 150, y: 150 },
                island2Pos: { x: 250, y: 250 }
            },
            offset: {
                shape: 'star',
                type: 'external',
                count: 3,
                distance: 10,
                joinType: 'Round',
                miterLimit: 10
            },
            simplify: {
                tolerance: 2
            },
            area: {
                points: [],
                isDrawing: false,
                lastPolygonPath: null // Store the last drawn polygon for cleanup
            },
            pip: {
                points: [],
                edgeTolerance: 3
            },
            minkowski: {
                pattern: 'circle',
                path: 'square',
                operation: 'sum',
                pathClosed: true,
                showSweep: false,
                showOffset: false,
                patternPos: { x: 100, y: 200 }  // Pattern starting position
            }
        };
        
        // Track test execution status
        this.testStatus = new Map();
    }

    /**
     * Initialize test system with all modules
     */
    async initialize() {
        try {
            // Initialize core
            this.core = new Clipper2Core();
            await this.core.initialize();
            
            // Initialize modules
            this.geometry = new Clipper2Geometry(this.core);
            this.operations = new Clipper2Operations(this.core);
            this.rendering = new Clipper2Rendering(this.core);
            
            // Initialize modules with defaults
            this.geometry.initialize(this.defaults);
            this.operations.initialize(this.defaults);
            this.rendering.initialize(this.defaults);
            
            // Set cross-references
            this.operations.setGeometryModule(this.geometry);
            this.rendering.setGeometryModule(this.geometry);
            
            // Apply configuration from defaults
            this.core.setConfig(this.defaults.config);
            
            // Pre-parse rabbit SVG
            this.initializeRabbitPath();
            
            console.log('[TESTS] All modules initialized');
            
            // Check for Minkowski support
            if (this.core.clipper2.MinkowskiSum64 && this.core.clipper2.MinkowskiDiff64) {
                console.log('[TESTS] Minkowski operations available');
            } else {
                console.warn('[TESTS] Minkowski operations not available in this build');
            }
            
            return true;
        } catch (error) {
            console.error('[ERROR] Failed to initialize test system:', error);
            return false;
        }
    }

    /**
     * Initialize rabbit path from SVG
     */
    initializeRabbitPath() {
        const rabbitDef = this.defaults.geometries.boolean.clips.rabbit;
        if (rabbitDef?.path) {
            try {
                // Use geometry module's improved SVG parser
                const scale = rabbitDef.scale || 0.3;
                const coords = this.geometry.parseSVGPath(rabbitDef.path, scale, [0, 0]);
                
                if (coords.length === 0) {
                    console.error('[TESTS] Rabbit path parsing produced no coordinates');
                    this.testState.boolean.rabbitPath = null;
                    return;
                }
                
                // Center the rabbit around origin
                const bounds = this.getPathBounds(coords);
                const centerX = (bounds.minX + bounds.maxX) / 2;
                const centerY = (bounds.minY + bounds.maxY) / 2;
                
                this.testState.boolean.rabbitPath = coords.map(pt => [
                    pt[0] - centerX,
                    pt[1] - centerY
                ]);
                
                console.log('[TESTS] Rabbit path initialized with', this.testState.boolean.rabbitPath?.length, 'points');
            } catch (error) {
                console.error('[TESTS] Failed to parse rabbit path:', error);
                this.testState.boolean.rabbitPath = null;
            }
        } else {
            console.warn('[TESTS] Rabbit definition not found');
        }
    }

    /**
     * Get path bounds
     */
    getPathBounds(coords) {
        if (!coords || coords.length === 0) {
            return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        }
        
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        coords.forEach(point => {
            const x = Array.isArray(point) ? point[0] : point.x;
            const y = Array.isArray(point) ? point[1] : point.y;
            
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        });
        
        return { minX, minY, maxX, maxY };
    }

    /**
     * Update test state from UI
     */
    updateTestState(testName, key, value) {
        if (this.testState[testName]) {
            this.testState[testName][key] = value;
            console.log(`[STATE] ${testName}.${key} = ${JSON.stringify(value)}`);
        }
    }

    /**
     * Get test state
     */
    getTestState(testName) {
        return this.testState[testName] || {};
    }

    /**
     * Set test status for visual feedback
     */
    setTestStatus(testName, status) {
        this.testStatus.set(testName, status);
        const card = document.querySelector(`[data-test="${testName}"]`);
        if (card) {
            card.dataset.status = status; // 'pending', 'success', 'error'
        }
    }

    /**
     * Test Minkowski operations with offset comparison
     */
    async testMinkowski() {
        const testName = 'minkowski';
        this.setTestStatus(testName, 'pending');
        
        try {
            if (!this.core.clipper2.MinkowskiSum64 || !this.core.clipper2.MinkowskiDiff64) {
                throw new Error('Minkowski operations not available in this build');
            }
            
            // Read from centralized state
            const state = this.getTestState(testName);
            const { pattern, path: pathName, operation, pathClosed, showSweep, showOffset, patternPos } = state;
            
            // Get definitions from defaults
            const patternDef = this.defaults.geometries.minkowski.patterns[pattern];
            const pathDef = this.defaults.geometries.minkowski.paths[pathName];
            
            // Create pattern at position (for visualization)
            let patternCoords;
            if (patternDef.type === 'parametric') {
                const centered = { ...patternDef, center: [0, 0] };
                patternCoords = this.getParametricCoords(centered);
            } else {
                patternCoords = patternDef.data;
            }
            
            // Create path
            let pathCoords;
            if (pathDef.type === 'parametric') {
                pathCoords = this.getParametricCoords(pathDef);
            } else {
                pathCoords = pathDef.data;
            }
            
            // Convert to Clipper2 paths
            const patternPath = this.geometry.coordinatesToPath64(patternCoords);
            const pathPath = this.geometry.coordinatesToPath64(pathCoords);
            
            // Store inputs
            this.testData.set(`${testName}-pattern`, patternPath);
            this.testData.set(`${testName}-path`, pathPath);
            
            // Perform Minkowski operation
            const isPathClosed = pathDef.isClosed !== undefined ? pathDef.isClosed : pathClosed;
            let minkowskiResult;
            
            if (operation === 'sum') {
                minkowskiResult = this.operations.minkowskiSum(patternPath, pathPath, isPathClosed);
            } else {
                minkowskiResult = this.operations.minkowskiDiff(patternPath, pathPath, isPathClosed);
            }
            
            // Store Minkowski result
            this.testData.set(`${testName}-output`, minkowskiResult);
            
            // Calculate equivalent offset if requested
            let offsetResult = null;
            if (showOffset) {
                const equivalentRadius = this.calculateEquivalentRadius(patternCoords, patternDef);
                const pathPaths = new this.core.clipper2.Paths64();
                pathPaths.push_back(pathPath);
                
                // Use positive radius for sum (external), negative for diff (internal)
                const offsetDelta = operation === 'sum' ? equivalentRadius : -equivalentRadius;
                
                offsetResult = this.operations.offset(
                    pathPaths,
                    offsetDelta,
                    this.core.clipper2.JoinType.Round,
                    isPathClosed ? this.core.clipper2.EndType.Polygon : this.core.clipper2.EndType.Round
                );
                
                this.testData.set(`${testName}-offset`, offsetResult);
                pathPaths.delete();
            }
            
            // Clear canvas
            const canvas = document.getElementById('minkowski-canvas');
            this.rendering.clearCanvas(canvas);
            
            // Draw sweep visualization if enabled (before other elements)
            if (showSweep) {
                this.drawMinkowskiSweep(canvas, patternCoords, pathCoords, operation);
            }
            
            // Draw path (input geometry)
            const pathPaths = new this.core.clipper2.Paths64();
            pathPaths.push_back(pathPath);
            this.rendering.render(pathPaths, canvas, {
                fillOuter: 'none',
                strokeOuter: this.defaults.styles.minkowski.path.strokeOuter,
                strokeWidth: 2,
                clear: false
            });
            
            // Draw pattern at start position (visual reference)
            const displayPattern = patternCoords.map(pt => [
                pt[0] + patternPos.x,
                pt[1] + patternPos.y
            ]);
            this.rendering.drawSimplePaths([displayPattern], canvas, {
                fillOuter: 'none',
                strokeOuter: this.defaults.styles.minkowski.pattern.strokeOuter,
                strokeWidth: 2,
                clear: false
            });
            
            // Draw Minkowski result (solid fill, distinct color)
            const resultStyle = operation === 'sum' ? 
                this.defaults.styles.minkowski.sumResult : 
                this.defaults.styles.minkowski.diffResult;
            
            this.rendering.render(minkowskiResult, canvas, {
                ...resultStyle,
                strokeWidth: 2,
                clear: false
            });
            
            // Draw offset result if calculated (dashed outline only)
            if (offsetResult && showOffset) {
                const ctx = canvas.getContext('2d');
                ctx.save();
                ctx.strokeStyle = '#f59e0b';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                
                for (let i = 0; i < offsetResult.size(); i++) {
                    const path = offsetResult.get(i);
                    ctx.beginPath();
                    for (let j = 0; j < path.size(); j++) {
                        const pt = path.get(j);
                        const x = Number(pt.x) / this.core.config.scale;
                        const y = Number(pt.y) / this.core.config.scale;
                        if (j === 0) {
                            ctx.moveTo(x, y);
                        } else {
                            ctx.lineTo(x, y);
                        }
                    }
                    ctx.closePath();
                    ctx.stroke();
                }
                ctx.restore();
            }
            
            // Add labels
            const ctx = canvas.getContext('2d');
            ctx.font = '12px Arial';
            ctx.fillStyle = '#6b7280';
            ctx.fillText(`Pattern: ${patternDef.displayName}`, 10, 20);
            ctx.fillText(`Path: ${pathDef.displayName}`, 10, 35);
            ctx.fillStyle = operation === 'sum' ? '#10b981' : '#ef4444';
            ctx.fillText(`Minkowski ${operation.toUpperCase()}`, 10, 50);
            
            if (showOffset) {
                ctx.fillStyle = '#f59e0b';
                const radius = this.calculateEquivalentRadius(patternCoords, patternDef);
                ctx.fillText(`Offset (r=${radius.toFixed(1)}px): - - -`, 10, 65);
            }
            
            // Clean up temporary paths
            pathPaths.delete();
            
            this.setTestStatus(testName, 'success');
            
            let resultMessage = `[OK] Minkowski ${operation}: ${minkowskiResult.size()} path(s)`;
            if (showOffset && offsetResult) {
                resultMessage += ` | Offset: ${offsetResult.size()} path(s)`;
                
                // Check if results are visually similar
                if (pattern === 'circle' && minkowskiResult.size() === offsetResult.size()) {
                    resultMessage += ' (equivalent for circle)';
                }
            }
            
            this.ui?.updateResult('minkowski-result', resultMessage);
            this.ui?.updateInfo('minkowski-info', this.formatGeometryInfo(minkowskiResult));
            
            return { success: true, output: minkowskiResult.size() };
            
        } catch (error) {
            console.error('[ERROR] Minkowski test failed:', error);
            this.setTestStatus(testName, 'error');
            this.ui?.updateResult('minkowski-result', `[ERROR] ${error.message}`, false);
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Calculate equivalent radius for offset comparison
     */
    calculateEquivalentRadius(coords, definition) {
        // If pre-calculated, use it
        if (definition && definition.equivalentRadius) {
            return definition.equivalentRadius;
        }
        
        // Calculate max distance from center
        let maxDist = 0;
        let centerX = 0, centerY = 0;
        
        // Find centroid
        coords.forEach(point => {
            centerX += point[0];
            centerY += point[1];
        });
        centerX /= coords.length;
        centerY /= coords.length;
        
        // Find max distance from centroid
        coords.forEach(point => {
            const dx = point[0] - centerX;
            const dy = point[1] - centerY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            maxDist = Math.max(maxDist, dist);
        });
        
        return maxDist;
    }

    /**
     * Draw Minkowski sweep visualization - FIXED for diff operation
     */
    drawMinkowskiSweep(canvas, patternCoords, pathCoords, operation) {
        const ctx = canvas.getContext('2d');
        const sweepSteps = this.testState.minkowski.sweepSteps || 8;
        
        // Much more subtle visualization
        const isSumOperation = operation === 'sum';
        const markerColor = isSumOperation ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
        const markerRadius = 1.5;
        
        ctx.save();
        
        // Draw pattern markers along the path
        const markerPositions = [];
        
        if (this.testState.minkowski.pathClosed) {
            // For closed paths, show pattern at vertices
            pathCoords.forEach((vertex, i) => {
                markerPositions.push(vertex);
            });
        } else {
            // For open paths, interpolate along segments
            for (let i = 0; i < pathCoords.length - 1; i++) {
                const p1 = pathCoords[i];
                const p2 = pathCoords[i + 1];
                
                for (let t = 0; t <= 1; t += 1 / sweepSteps) {
                    markerPositions.push([
                        p1[0] + (p2[0] - p1[0]) * t,
                        p1[1] + (p2[1] - p1[1]) * t
                    ]);
                }
            }
        }
        
        // For difference operation, properly negate the pattern (flip both X and Y)
        let visualPatternCoords = patternCoords;
        if (!isSumOperation) {
            // Negate both X and Y for proper Minkowski difference visualization
            visualPatternCoords = patternCoords.map(pt => [-pt[0], -pt[1]]);
        }
        
        // Draw very faint pattern shapes at each marker position
        ctx.strokeStyle = markerColor;
        ctx.fillStyle = markerColor;
        ctx.lineWidth = 0.3;
        
        markerPositions.forEach((pos, idx) => {
            // Draw a small dot
            ctx.beginPath();
            ctx.arc(pos[0], pos[1], markerRadius, 0, Math.PI * 2);
            ctx.fill();
            
            // Draw a very faint pattern outline every few positions
            if (idx % 6 === 0) {  // Less frequent
                ctx.save();
                ctx.globalAlpha = 0.08; // Even more subtle
                ctx.beginPath();
                visualPatternCoords.forEach((pt, j) => {
                    const x = pt[0] + pos[0];
                    const y = pt[1] + pos[1];
                    if (j === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                });
                ctx.closePath();
                ctx.stroke();
                ctx.restore();
            }
        });
        
        ctx.restore();
    }

    /**
     * Get parametric shape coordinates
     */
    getParametricCoords(definition) {
        const pos = definition.center || [0, 0];
        
        switch (definition.shape) {
            case 'circle':
                return this.defaults.generators.circle(
                    pos[0], pos[1], 
                    definition.radius,
                    32
                );
                
            case 'star':
                return this.defaults.generators.star(
                    pos[0], pos[1],
                    definition.outerRadius,
                    definition.innerRadius,
                    definition.points
                );
                
            default:
                return [];
        }
    }

    /**
     * Test boolean operation
     */
    async testBooleanOperation() {
        const testName = 'boolean';
        this.setTestStatus(testName, 'pending');
        
        try {
            // Read from centralized state
            const state = this.getTestState(testName);
            const { operation, clipShape, subjectPos, clipPos, randomShape, rabbitPath } = state;
            
            // Clear canvas
            this.rendering.clearCanvas('boolean-canvas');
            
            // Create subject from defaults - FIXED at center
            const subjectDef = this.defaults.geometries.boolean.subject;
            const subjectPaths = new this.core.clipper2.Paths64();
            
            const subjectCoords = subjectDef.data;
            subjectPaths.push_back(this.geometry.coordinatesToPath64(subjectCoords));
            
            // Create clip from defaults using state position
            const clipDef = this.defaults.geometries.boolean.clips[clipShape];
            const clipPaths = new this.core.clipper2.Paths64();
            
            let clipPath;
            if (clipShape === 'rabbit') {
                // Use pre-parsed rabbit path
                const rabbitCoords = rabbitPath.map(pt => [
                    pt[0] + clipPos.x,
                    pt[1] + clipPos.y
                ]);
                clipPath = this.geometry.coordinatesToPath64(rabbitCoords);
            } else if (clipShape === 'random') {
                // Use stored random shape if exists, generate if not
                let randomCoords = randomShape;
                if (!randomCoords) {
                    const randomDef = this.defaults.geometries.boolean.clips.random;
                    randomCoords = this.defaults.generators.randomConvex(
                        0, 0, randomDef.avgRadius, randomDef.variance, randomDef.points
                    );
                    this.testState.boolean.randomShape = randomCoords;
                }
                const positioned = randomCoords.map(pt => [
                    pt[0] + clipPos.x,
                    pt[1] + clipPos.y
                ]);
                clipPath = this.geometry.coordinatesToPath64(positioned);
            } else if (clipDef.type === 'parametric') {
                clipPath = this.geometry.parametricToPath64(clipDef, {
                    position: [clipPos.x, clipPos.y]
                });
            } else if (clipDef.type === 'polygon') {
                clipPath = this.geometry.polygonToPath64(clipDef, {
                    position: [clipPos.x, clipPos.y]
                });
            } else if (clipDef.type === 'svg') {
                clipPath = this.geometry.svgToPath64(clipDef, {
                    position: [clipPos.x, clipPos.y]
                });
            }
            
            clipPaths.push_back(clipPath);
            
            // Store inputs with consistent keys
            this.testData.set(`${testName}-input`, subjectPaths);
            this.testData.set(`${testName}-clip`, clipPaths);
            
            // Perform operation based on state
            let result;
            switch(operation) {
                case 'union':
                    result = this.operations.union(subjectPaths, clipPaths);
                    break;
                case 'intersection':
                    result = this.operations.intersect(subjectPaths, clipPaths);
                    break;
                case 'difference':
                    result = this.operations.difference(subjectPaths, clipPaths);
                    break;
                case 'xor':
                    result = this.operations.xor(subjectPaths, clipPaths);
                    break;
            }
            
            // Store and render result
            this.testData.set(`${testName}-output`, result);
            this.rendering.render(result, 'boolean-canvas', this.defaults.styles.output);
            
            this.setTestStatus(testName, 'success');
            this.ui?.updateResult('boolean-result', 
                `[OK] ${operation.toUpperCase()}: ${result.size()} path(s)`);
            this.ui?.updateInfo('boolean-info', this.formatGeometryInfo(result));
            
            return { success: true, output: result.size() };
            
        } catch (error) {
            console.error('[ERROR] Boolean operation failed:', error);
            this.setTestStatus(testName, 'error');
            this.ui?.updateResult('boolean-result', `[ERROR] ${error.message}`, false);
            return { success: false, error: error.message };
        }
    }

    /**
     * Test Letter B creation
     */
    async testLetterB() {
        const testName = 'letter-b';
        this.setTestStatus(testName, 'pending');
        
        try {
            const letterBDef = this.defaults.geometries.letterB;
            
            // Convert strokes to paths
            const strokes = this.geometry.toClipper2Paths(letterBDef);
            
            // Store input with consistent key
            this.testData.set(`${testName}-input`, strokes);
            
            console.log(`[Letter B] Union of ${strokes.size()} strokes`);
            
            // Perform union
            const result = this.operations.unionSelf(strokes);
            
            // Analyze result
            const pathData = this.geometry.paths64ToCoordinates(result);
            const holes = pathData.filter(p => p.orientation === 'hole').length;
            const outers = pathData.filter(p => p.orientation === 'outer').length;
            
            console.log(`[Letter B] Result: ${outers} outer(s), ${holes} hole(s)`);
            
            // Store and render
            this.testData.set(`${testName}-output`, result);
            this.rendering.render(result, 'letter-b-canvas', {
                ...this.defaults.styles.output,
                fillRule: 'evenodd'
            });
            
            const validation = this.defaults.validation.letterB;
            const isValid = result.size() === validation.expectedPaths && holes === validation.expectedHoles;
            
            this.setTestStatus(testName, isValid ? 'success' : 'pending');
            
            let statusMessage = `[OK] Letter B: ${strokes.size()} strokes → ${result.size()} path(s), ${holes} hole(s)`;
            if (!isValid) {
                statusMessage = `[WARNING] ${validation.description}. Got ${result.size()} path(s) with ${holes} hole(s).`;
            }
            
            this.ui?.updateResult('letter-b-result', statusMessage);
            this.ui?.updateInfo('letter-b-info', this.formatGeometryInfo(result));
            
            return { success: true, output: result.size(), holes: holes };
            
        } catch (error) {
            console.error('[ERROR] Letter B test failed:', error);
            this.setTestStatus(testName, 'error');
            this.ui?.updateResult('letter-b-result', `[ERROR] ${error.message}`, false);
            return { success: false, error: error.message };
        }
    }

    /**
     * Test PCB trace fusion
     */
    async testPCBFusion() {
        const testName = 'pcb-fusion';
        this.setTestStatus(testName, 'pending');
        
        try {
            const pcbDef = this.defaults.geometries.pcbFusion;
            
            // Convert PCB components to paths
            const components = this.geometry.toClipper2Paths(pcbDef);
            
            // Store input with consistent key
            this.testData.set(`${testName}-input`, components);
            const inputCount = components.size();
            
            console.log(`[PCB] Fusing ${inputCount} components`);
            
            // Perform union
            const result = this.operations.unionSelf(components);
            
            // Analyze result
            const pathData = this.geometry.paths64ToCoordinates(result);
            const holes = pathData.filter(p => p.orientation === 'hole').length;
            
            // Store and render
            this.testData.set(`${testName}-output`, result);
            this.rendering.render(result, 'pcb-fusion-canvas', {
                ...this.defaults.styles.pcb,
                fillRule: 'evenodd'
            });
            
            const validation = this.defaults.validation.pcbFusion;
            const isValid = result.size() <= validation.maxPaths && holes >= validation.minHoles;
            
            this.setTestStatus(testName, isValid ? 'success' : 'pending');
            
            let statusMessage = `[OK] PCB Fusion: ${inputCount} components → ${result.size()} region(s), ${holes} hole(s)`;
            if (!isValid) {
                statusMessage += ` [Note: ${validation.description}]`;
            }
            
            this.ui?.updateResult('pcb-fusion-result', statusMessage);
            this.ui?.updateInfo('pcb-fusion-info', this.formatGeometryInfo(result));
            
            return { success: true, input: inputCount, output: result.size(), holes: holes };
            
        } catch (error) {
            console.error('[ERROR] PCB fusion test failed:', error);
            this.setTestStatus(testName, 'error');
            this.ui?.updateResult('pcb-fusion-result', `[ERROR] ${error.message}`, false);
            return { success: false, error: error.message };
        }
    }

    /**
     * Test nested structure
     */
    async testNestedStructure() {
        const testName = 'nested';
        this.setTestStatus(testName, 'pending');
        
        try {
            // Read from state
            const state = this.getTestState(testName);
            const nestedDef = this.defaults.geometries.nested;
            
            // Create frame with hole
            const frameOuter = this.geometry.coordinatesToPath64(nestedDef.frame.outer);
            const frameInner = this.geometry.coordinatesToPath64(nestedDef.frame.inner);
            
            const frameOuterPaths = new this.core.clipper2.Paths64();
            frameOuterPaths.push_back(frameOuter);
            
            const frameInnerPaths = new this.core.clipper2.Paths64();
            frameInnerPaths.push_back(frameInner);
            
            const frame = this.operations.difference(frameOuterPaths, frameInnerPaths);
            
            // Create islands using state positions
            const islands = new this.core.clipper2.Paths64();
            
            nestedDef.islands.forEach((islandDef, index) => {
                const posKey = `island${index + 1}Pos`;
                const pos = state[posKey];
                
                let outerCoords = islandDef.outer;
                let innerCoords = islandDef.inner;
                
                if (pos) {
                    // Adjust for state position
                    const dx = pos.x - islandDef.outer[0][0];
                    const dy = pos.y - islandDef.outer[0][1];
                    outerCoords = outerCoords.map(pt => [pt[0] + dx, pt[1] + dy]);
                    innerCoords = innerCoords.map(pt => [pt[0] + dx, pt[1] + dy]);
                }
                
                const islandOuterPath = this.geometry.coordinatesToPath64(outerCoords);
                const islandInnerPath = this.geometry.coordinatesToPath64(innerCoords);
                
                const islandOuterPaths = new this.core.clipper2.Paths64();
                islandOuterPaths.push_back(islandOuterPath);
                
                const islandInnerPaths = new this.core.clipper2.Paths64();
                islandInnerPaths.push_back(islandInnerPath);
                
                const island = this.operations.difference(islandOuterPaths, islandInnerPaths);
                
                for (let i = 0; i < island.size(); i++) {
                    islands.push_back(island.get(i));
                }
                
                // Clean up temporary objects
                islandOuterPaths.delete();
                islandInnerPaths.delete();
                island.delete();
            });
            
            // Store inputs with consistent keys
            this.testData.set(`${testName}-input`, frame);
            this.testData.set(`${testName}-islands`, islands);
            
            // Union frame and islands
            const result = this.operations.union(frame, islands);
            
            // Analyze result
            const pathData = this.geometry.paths64ToCoordinates(result);
            const holes = pathData.filter(p => p.orientation === 'hole').length;
            
            // Store and render
            this.testData.set(`${testName}-output`, result);
            this.rendering.render(result, 'nested-canvas', {
                ...this.defaults.styles.output,
                fillRule: 'evenodd'
            });
            
            // Clean up
            frameOuterPaths.delete();
            frameInnerPaths.delete();
            
            this.setTestStatus(testName, 'success');
            this.ui?.updateResult('nested-result', 
                `[OK] Nested: ${result.size()} path(s), ${holes} hole(s)`);
            this.ui?.updateInfo('nested-info', this.formatGeometryInfo(result));
            
            return { success: true, output: result.size(), holes: holes };
            
        } catch (error) {
            console.error('[ERROR] Nested structure test failed:', error);
            this.setTestStatus(testName, 'error');
            this.ui?.updateResult('nested-result', `[ERROR] ${error.message}`, false);
            return { success: false, error: error.message };
        }
    }

    /**
     * Test path simplification - using rabbit shape
     */
    async testSimplify() {
        const testName = 'simplify';
        this.setTestStatus(testName, 'pending');
        
        try {
            const state = this.getTestState(testName);
            const simplifyDef = this.defaults.geometries.simplify;

            // Use the SVG definition directly from defaults
            const coords = this.geometry.parseSVGPath(
                simplifyDef.path,
                simplifyDef.scale,
                [85, 10] // Center on canvas
            );
            
            if (!coords || coords.length === 0) {
                throw new Error("Failed to parse SVG path for simplification test.");
            }

            const path = this.geometry.coordinatesToPath64(coords);
            const paths = new this.core.clipper2.Paths64();
            paths.push_back(path);
            
            this.testData.set(`${testName}-input`, paths);
            
            const tolerance = state.tolerance || simplifyDef.defaultTolerance;
            
            const result = this.operations.simplify(paths, tolerance);
            
            this.testData.set(`${testName}-output`, result);
            
            const originalPoints = path.size();
            let simplifiedPoints = 0;
            for (let i = 0; i < result.size(); i++) {
                simplifiedPoints += result.get(i).size();
            }
            
            this.rendering.render(paths, 'simplify-canvas', this.defaults.styles.input);
            this.rendering.render(result, 'simplify-canvas', {
                ...this.defaults.styles.output,
                clear: false
            });
            
            this.setTestStatus(testName, 'success');
            
            const reduction = originalPoints > 0 ? Math.round((1 - simplifiedPoints / originalPoints) * 100) : 0;
            this.ui?.updateResult('simplify-result', 
                `[OK] Simplified: ${originalPoints} → ${simplifiedPoints} points (${reduction}% reduction)`);
            this.ui?.updateInfo('simplify-info', this.formatGeometryInfo(result));
            
            return { success: true, original: originalPoints, simplified: simplifiedPoints };
            
        } catch (error) {
            console.error('[ERROR] Simplify test failed:', error);
            this.setTestStatus(testName, 'error');
            this.ui?.updateResult('simplify-result', `[ERROR] ${error.message}`, false);
            return { success: false, error: error.message };
        }
    }

    /**
     * Test offset operations
     */
    async testOffset() {
        const testName = 'offset';
        this.setTestStatus(testName, 'pending');
        
        try {
            // Read from state
            const state = this.getTestState(testName);
            const { shape, type, count, distance, joinType, miterLimit } = state;
            
            // Get shape definition
            const shapeDef = this.defaults.geometries.offset.shapes[shape];
            
            // Create base shape
            let basePath;
            if (shapeDef.type === 'parametric') {
                basePath = this.geometry.parametricToPath64(shapeDef);
            } else if (shapeDef.type === 'polygon') {
                basePath = this.geometry.polygonToPath64(shapeDef);
            }
            
            const paths = new this.core.clipper2.Paths64();
            paths.push_back(basePath);
            
            // Store input with consistent key
            this.testData.set(`${testName}-input`, paths);
            
            // Clear canvas first
            this.rendering.clearCanvas('offset-canvas');
            
            // Get join type enum
            const joinTypeEnum = this.getJoinTypeEnum(joinType);
            const endTypeEnum = this.core.clipper2.EndType.Polygon;
            
            // Perform offsets - use operations.offset which handles scaling
            const actualDistance = type === 'internal' ? -Math.abs(distance) : Math.abs(distance);
            const offsetResults = [];
            
            for (let i = 1; i <= count; i++) {
                const delta = actualDistance * i;
                const result = this.operations.offset(
                    paths,
                    delta,
                    joinTypeEnum,
                    endTypeEnum,
                    miterLimit
                );
                
                offsetResults.push(result);
            }
            
            // Draw offsets with proper z-order based on type
            this.rendering.drawOffsetPaths(offsetResults, 'offset-canvas', type, paths);
            
            // Store last result
            if (offsetResults.length > 0) {
                this.testData.set(`${testName}-output`, offsetResults[offsetResults.length - 1]);
            }
            
            this.setTestStatus(testName, 'success');
            this.ui?.updateResult('offset-result', 
                `[OK] ${type === 'internal' ? 'Internal' : 'External'} offset: ${count} iterations at ${distance}px (miter limit: ${miterLimit})`);
            
            return { success: true, count: count };
            
        } catch (error) {
            console.error('[ERROR] Offset test failed:', error);
            this.setTestStatus(testName, 'error');
            this.ui?.updateResult('offset-result', `[ERROR] ${error.message}`, false);
            return { success: false, error: error.message };
        }
    }

    /**
     * Test point-in-polygon - FIXED: handle enum values properly
     */
    async testPointInPolygon() {
        const testName = 'pip';
        this.setTestStatus(testName, 'pending');
        
        try {
            const pipDef = this.defaults.geometries.pip;
            
            // Create test polygon
            const polygon = this.geometry.coordinatesToPath64(pipDef.data);
            
            // Store for click handler
            this.testData.set('pip-polygon', polygon);
            
            // Draw polygon
            const paths = new this.core.clipper2.Paths64();
            paths.push_back(polygon);
            this.rendering.render(paths, 'pip-canvas', this.defaults.styles.default);
            
            // Don't reset points if they already exist
            if (!this.testState.pip.points || this.testState.pip.points.length === 0) {
                this.testState.pip.points = [];
            }
            
            // Add instructions
            const canvas = document.getElementById('pip-canvas');
            const ctx = canvas.getContext('2d');
            ctx.font = '12px Arial';
            ctx.fillStyle = getComputedStyle(document.documentElement)
                .getPropertyValue('--input-stroke');
            ctx.fillText('Click to add test points', 10, 20);
            
            // Clean up temporary paths object
            paths.delete();
            
            this.setTestStatus(testName, 'success');
            this.ui?.updateResult('pip-result', 'Click to add test points, then "Check Locations"');
            
            return { success: true };
            
        } catch (error) {
            console.error('[ERROR] Point-in-polygon test failed:', error);
            this.setTestStatus(testName, 'error');
            this.ui?.updateResult('pip-result', `[ERROR] ${error.message}`, false);
            return { success: false, error: error.message };
        }
    }

    /**
     * Check point locations for PIP test - FIXED enum value handling
     */
    checkPointLocations() {
        const polygon = this.testData.get('pip-polygon');
        const points = this.testState.pip.points;
        
        if (!polygon) {
            // Run the test first to create polygon
            this.testPointInPolygon().then(() => {
                // Try again if we have points
                if (points && points.length > 0) {
                    this.checkPointLocations();
                }
            });
            return;
        }
        
        if (!points || points.length === 0) {
            this.ui?.updateResult('pip-result', 'No points to check. Click to add points.');
            return;
        }
        
        const canvas = document.getElementById('pip-canvas');
        const ctx = canvas.getContext('2d');
        const scale = this.core.config.scale;
        
        // Redraw polygon
        const paths = new this.core.clipper2.Paths64();
        paths.push_back(polygon);
        this.rendering.render(paths, 'pip-canvas', this.defaults.styles.default);
        
        // Add instructions
        ctx.font = '12px Arial';
        ctx.fillStyle = getComputedStyle(document.documentElement)
            .getPropertyValue('--input-stroke');
        ctx.fillText('Click to add test points', 10, 20);
        
        const results = [];
        const edgeTolerance = this.testState.pip.edgeTolerance;
        
        // Get enum values from Clipper2
        const { PointInPolygonResult } = this.core.clipper2;
        const IsOn = PointInPolygonResult.IsOn.value;
        const IsInside = PointInPolygonResult.IsInside.value;
        const IsOutside = PointInPolygonResult.IsOutside.value;
        
        points.forEach(point => {
            const testPoint = new this.core.clipper2.Point64(
                BigInt(Math.round(point.x * scale)),
                BigInt(Math.round(point.y * scale)),
                BigInt(0)
            );
            
            const resultObj = this.core.clipper2.PointInPolygon64(testPoint, polygon);
            // Extract the numeric value from the enum object
            const result = resultObj.value;
            
            // Check near edge - only if NOT already on edge
            let isNearEdge = false;
            if (result !== IsOn) {
                const offsets = [
                    [-edgeTolerance, 0], [edgeTolerance, 0],
                    [0, -edgeTolerance], [0, edgeTolerance]
                ];
                
                let insideCount = 0;
                let outsideCount = 0;
                
                for (const [dx, dy] of offsets) {
                    const nearPoint = new this.core.clipper2.Point64(
                        BigInt(Math.round((point.x + dx) * scale)),
                        BigInt(Math.round((point.y + dy) * scale)),
                        BigInt(0)
                    );
                    const nearResultObj = this.core.clipper2.PointInPolygon64(nearPoint, polygon);
                    const nearResult = nearResultObj.value;
                    nearPoint.delete();
                    
                    if (nearResult === IsInside) insideCount++;
                    else if (nearResult === IsOutside) outsideCount++;
                }
                
                isNearEdge = insideCount > 0 && outsideCount > 0;
            }
            
            let status, color;
            if (result === IsOn || isNearEdge) {
                status = 'ON EDGE';
                color = getComputedStyle(document.documentElement)
                    .getPropertyValue('--pip-edge');
            } else if (result === IsInside) {
                status = 'INSIDE';
                color = getComputedStyle(document.documentElement)
                    .getPropertyValue('--pip-inside');
            } else if (result === IsOutside) {
                status = 'OUTSIDE';
                color = getComputedStyle(document.documentElement)
                    .getPropertyValue('--pip-outside');
            } else {
                // This shouldn't happen but provide fallback
                status = `UNKNOWN (${result})`;
                color = '#666';
            }
            
            point.status = status;
            
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(point.x, point.y, this.defaults.styles.pointInPolygon.pointRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.stroke();
            
            results.push(`(${Math.round(point.x)}, ${Math.round(point.y)}): ${status}`);
            
            testPoint.delete();
        });
        
        // Clean up
        paths.delete();
        
        this.setTestStatus('pip', 'success');
        this.ui?.updateResult('pip-result', 
            `Checked ${points.length} points:\n${results.join('\n')}`);
    }

    /**
     * Initialize area test - make canvas immediately clickable like PIP
     */
    initializeAreaTest() {
        const canvas = document.getElementById('area-canvas');
        if (!canvas) return;
        
        const areaDef = this.defaults.geometries.area;
        
        // Clear and setup
        this.rendering.clearCanvas(canvas);
        this.rendering.drawGrid(canvas, areaDef.gridSize);
        
        // Clean up any existing polygon before starting new one
        if (this.testState.area.lastPolygonPath) {
            this.testState.area.lastPolygonPath = null;
        }
        
        this.testState.area.points = [];
        this.testState.area.isDrawing = true;
        
        const ctx = canvas.getContext('2d');
        ctx.font = '14px Arial';
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text');
        ctx.fillText('Click to add points (min 3), then Calculate', 10, 25);
        
        // Set up click handler immediately
        canvas.onclick = (event) => {
            if (!this.testState.area.isDrawing) return;
            
            const rect = canvas.getBoundingClientRect();
            const x = (event.clientX - rect.left) * (canvas.width / rect.width);
            const y = (event.clientY - rect.top) * (canvas.height / rect.height);
            
            this.testState.area.points.push({ x, y });
            
            // Draw point
            ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--shape-stroke');
            ctx.beginPath();
            ctx.arc(x, y, areaDef.pointRadius, 0, Math.PI * 2);
            ctx.fill();
            
            // Draw connecting line
            if (this.testState.area.points.length > 1) {
                ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--shape-stroke');
                ctx.lineWidth = 2;
                ctx.beginPath();
                const prev = this.testState.area.points[this.testState.area.points.length - 2];
                ctx.moveTo(prev.x, prev.y);
                ctx.lineTo(x, y);
                ctx.stroke();
            }
            
            this.ui?.updateResult('area-result', 
                `${this.testState.area.points.length} points added. ${this.testState.area.points.length >= areaDef.minPoints ? 'Ready to calculate!' : `Need ${areaDef.minPoints - this.testState.area.points.length} more.`}`);
        };
        
        this.ui?.updateResult('area-result', `Click points to draw polygon (min ${areaDef.minPoints})`);
    }

    /**
     * Test area calculation - no longer needed as separate test
     */
    async testArea() {
        // Just initialize the test
        this.initializeAreaTest();
        return { success: true };
    }

    /**
     * Calculate area for drawn polygon - IMPROVED winding indicator
     */
    calculateArea() {
        const testName = 'area';
        const areaDef = this.defaults.geometries.area;
        
        if (this.testState.area.points.length < areaDef.minPoints) {
            this.ui?.updateResult('area-result', `Need at least ${areaDef.minPoints} points`);
            return;
        }
        
        // Stop drawing
        this.testState.area.isDrawing = false;
        const canvas = document.getElementById('area-canvas');
        
        // Store the polygon coordinates for later cleanup
        const coordArray = this.testState.area.points.map(p => [p.x, p.y]);
        this.testState.area.lastPolygonPath = coordArray;
        
        // Close the polygon visually
        const ctx = canvas.getContext('2d');
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--shape-stroke');
        ctx.lineWidth = 2;
        ctx.beginPath();
        const lastPoint = this.testState.area.points[this.testState.area.points.length - 1];
        const firstPoint = this.testState.area.points[0];
        ctx.moveTo(lastPoint.x, lastPoint.y);
        ctx.lineTo(firstPoint.x, firstPoint.y);
        ctx.stroke();
        
        // Calculate area using shoelace formula
        let area = 0;
        const n = coordArray.length;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            area += coordArray[i][0] * coordArray[j][1];
            area -= coordArray[j][0] * coordArray[i][1];
        }
        area = area / 2;
        
        // In screen coordinates (Y increases downward), CCW is negative, CW is positive
        const orientation = area < 0 ? 'COUNTER-CLOCKWISE' : 'CLOCKWISE';
        const actualArea = Math.abs(area);
        
        // Fill polygon with appropriate color
        ctx.fillStyle = area < 0 ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)';
        ctx.beginPath();
        coordArray.forEach((p, i) => i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]));
        ctx.closePath();
        ctx.fill();
        
        // Draw animated directional outline
        ctx.strokeStyle = area < 0 ? '#10b981' : '#ef4444';
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 5]);
        
        // Animate the dash offset to show direction
        let dashOffset = 0;
        const animateOutline = () => {
            ctx.save();
            ctx.lineDashOffset = area < 0 ? -dashOffset : dashOffset;
            ctx.beginPath();
            coordArray.forEach((p, i) => i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]));
            ctx.closePath();
            ctx.stroke();
            ctx.restore();
            
            dashOffset = (dashOffset + 1) % 15;
            if (dashOffset < 15) {
                requestAnimationFrame(animateOutline);
            }
        };
        animateOutline();
        
        // Find bounding box for label placement
        const bounds = this.getPathBounds(coordArray);
        const labelX = (bounds.minX + bounds.maxX) / 2;
        const labelY = bounds.minY - 15;
        
        // Draw winding direction label
        ctx.setLineDash([]);
        ctx.font = 'bold 14px Arial';
        ctx.fillStyle = area < 0 ? '#10b981' : '#ef4444';
        ctx.textAlign = 'center';
        ctx.fillText(orientation, labelX, labelY);
        
        // Draw small directional arrows along the path
        ctx.strokeStyle = area < 0 ? '#10b981' : '#ef4444';
        ctx.fillStyle = area < 0 ? '#10b981' : '#ef4444';
        ctx.lineWidth = 2;
        
        // Place arrows at a few points along the path
        for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 4))) {
            const curr = coordArray[i];
            const next = coordArray[(i + 1) % n];
            
            const midX = (curr[0] + next[0]) / 2;
            const midY = (curr[1] + next[1]) / 2;
            
            const dx = next[0] - curr[0];
            const dy = next[1] - curr[1];
            const len = Math.sqrt(dx * dx + dy * dy);
            
            if (len > 0) {
                const ux = dx / len;
                const uy = dy / len;
                
                ctx.save();
                ctx.translate(midX, midY);
                ctx.rotate(Math.atan2(uy, ux));
                
                // Draw arrow
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(-8, -4);
                ctx.lineTo(-8, 4);
                ctx.closePath();
                ctx.fill();
                
                ctx.restore();
            }
        }
        
        this.setTestStatus(testName, 'success');
        this.ui?.updateResult('area-result', 
            `[OK] Area: ${actualArea.toFixed(0)} px² | Winding: ${orientation}`);
    }

    /**
     * Get JoinType enum value
     */
    getJoinTypeEnum(joinType) {
        const { JoinType } = this.core.clipper2;
        switch(joinType) {
            case 'Miter': return JoinType.Miter;
            case 'Square': return JoinType.Square;
            case 'Round': 
            default: return JoinType.Round;
        }
    }

    /**
     * Format geometry info for display
     */
    formatGeometryInfo(paths) {
        if (!paths || paths.size() === 0) return 'No paths';
        
        const pathData = this.geometry.paths64ToCoordinates(paths);
        let info = `Total paths: ${paths.size()}\n`;
        
        pathData.forEach((item, i) => {
            const area = Math.abs(item.area / (this.core.config.scale * this.core.config.scale)).toFixed(0);
            const points = item.coords.length;
            
            info += `Path ${i}: ${points} points, area: ${area}, type: ${item.orientation}\n`;
            
            if (points > 0) {
                info += `  First points: `;
                for (let j = 0; j < Math.min(3, points); j++) {
                    const p = item.coords[j];
                    const x = Array.isArray(p) ? p[0] : p.x;
                    const y = Array.isArray(p) ? p[1] : p.y;
                    info += `(${x.toFixed(1)},${y.toFixed(1)})`;
                    if (j < Math.min(3, points) - 1) info += ' ';
                }
                if (points > 3) info += ' ...';
                info += '\n';
            }
        });
        
        return info;
    }

    /**
     * Export test result as SVG
     */
    exportSVG(testName, dataType = 'output') {
        let dataToExport;
        let filename;
        
        if (dataType === 'raw') {
            // Export raw geometry from defaults (unprocessed)
            filename = `clipper2-${testName}-raw.svg`;
            dataToExport = this.getRawGeometry(testName);
        } else if (dataType === 'input') {
            // Export processed input data
            filename = `clipper2-${testName}-input.svg`;
            dataToExport = this.testData.get(`${testName}-input`) || 
                          this.testData.get(`${testName}-frame`) ||
                          this.testData.get('pip-polygon');
        } else {
            // Export output data (default)
            filename = `clipper2-${testName}-output.svg`;
            dataToExport = this.testData.get(`${testName}-output`);
        }
        
        if (!dataToExport) {
            alert(`No ${dataType} data to export. Run the test first.`);
            return;
        }
        
        const svg = this.rendering.exportSVG(dataToExport);
        
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        
        console.log(`[EXPORT] Exported ${filename}`);
    }
    
    /**
     * Get raw geometry for export
     */
    getRawGeometry(testName) {
        try {
            // Get geometry definition from defaults
            const geometries = this.defaults.geometries;
            let rawPaths = new this.core.clipper2.Paths64();
            
            switch(testName) {
                case 'boolean':
                    // Export subject as raw
                    const subjectDef = geometries.boolean.subject;
                    rawPaths.push_back(this.geometry.coordinatesToPath64(subjectDef.data));
                    break;
                    
                case 'letter-b':
                    const letterBDef = geometries.letterB;
                    rawPaths = this.geometry.toClipper2Paths(letterBDef);
                    break;
                    
                case 'pcb-fusion':
                    const pcbDef = geometries.pcbFusion;
                    rawPaths = this.geometry.toClipper2Paths(pcbDef);
                    break;
                    
                case 'offset':
                    const offsetShape = this.testState.offset.shape;
                    const shapeDef = geometries.offset.shapes[offsetShape];
                    if (shapeDef.type === 'parametric') {
                        rawPaths.push_back(this.geometry.parametricToPath64(shapeDef));
                    } else {
                        rawPaths.push_back(this.geometry.polygonToPath64(shapeDef));
                    }
                    break;
                    
                case 'simplify':
                    const simplifyDef = geometries.simplify;
                    const coords = this.geometry.parseSVGPath(
                        simplifyDef.path,
                        simplifyDef.scale,
                        [85, 10]
                    );
                    rawPaths.push_back(this.geometry.coordinatesToPath64(coords));
                    break;
                    
                case 'pip':
                    const pipDef = geometries.pip;
                    rawPaths.push_back(this.geometry.coordinatesToPath64(pipDef.data));
                    break;
                    
                default:
                    return null;
            }
            
            return rawPaths;
        } catch (error) {
            console.error(`[ERROR] Failed to get raw geometry for ${testName}:`, error);
            return null;
        }
    }

    /**
     * Reset test to initial state
     */
    resetTest(testName) {
        // Clear output data
        this.testData.delete(`${testName}-output`);
        
        // Reset status
        this.setTestStatus(testName, '');
        
        // Reset state to defaults
        switch(testName) {
            case 'boolean':
                this.testState.boolean.subjectPos = { x: 200, y: 200 }; // Keep centered
                this.testState.boolean.clipPos = { x: 150, y: 150 }; // Top-left of subject
                // Keep random shape if it exists
                break;
            case 'nested':
                this.testState.nested.island1Pos = { x: 150, y: 150 };
                this.testState.nested.island2Pos = { x: 250, y: 250 };
                break;
            case 'pip':
                this.testState.pip.points = [];
                this.testData.delete('pip-polygon');  // Clear stored polygon
                break;
            case 'area':
                this.testState.area.points = [];
                this.testState.area.isDrawing = false;
                this.testState.area.lastPolygonPath = null; // Clear stored polygon
                break;
            case 'minkowski':
                // Reset to defaults from config
                this.testState.minkowski.pattern = this.defaults.geometries.minkowski.defaults.pattern;
                this.testState.minkowski.path = this.defaults.geometries.minkowski.defaults.path;
                this.testState.minkowski.operation = this.defaults.geometries.minkowski.defaults.operation;
                this.testState.minkowski.pathClosed = this.defaults.geometries.minkowski.defaults.pathClosed;
                this.testState.minkowski.showSweep = this.defaults.geometries.minkowski.defaults.showSweep;
                this.testState.minkowski.showOffset = this.defaults.geometries.minkowski.defaults.showOffset;
                this.testState.minkowski.patternPos = { x: 100, y: 200 };
                break;
        }
        
        // Let UI handle the rest
        this.ui?.resetView(testName);
    }
}