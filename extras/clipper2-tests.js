/**
 * Clipper2 Tests Module
 * Test implementations with state-driven architecture
 * Version 6.4 - Fixed PIP, Area, Minkowski, removed tangency
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
                shape: this.defaults.geometries.offset.defaults?.shape ?? 'star',
                type: this.defaults.geometries.offset.defaults?.type ?? 'external',
                count: this.defaults.geometries.offset.defaults?.count ?? 3,
                distance: this.defaults.geometries.offset.defaults?.distance ?? 10,
                joinType: this.defaults.geometries.offset.defaults?.joinType ?? 'Round',
                miterLimit: this.defaults.geometries.offset.defaults?.miterLimit ?? 10
            },
            simplify: {
                tolerance: this.defaults.geometries.simplify?.defaultTolerance ?? 4
            },
            area: {
                points: [],
                isDrawing: false
            },
            pip: {
                points: [],
                edgeTolerance: this.defaults.geometries.pip?.edgeTolerance ?? 3
            },
            minkowski: {
                pattern: this.defaults.geometries.minkowski.defaults?.pattern ?? 'circle',
                path: this.defaults.geometries.minkowski.defaults?.path ?? 'rectangle',
                operation: this.defaults.geometries.minkowski.defaults?.operation ?? 'sum',
                pathClosed: this.defaults.geometries.minkowski.defaults?.pathClosed ?? true
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
            console.log(`[STATE] ${testName}.${key} = ${value}`);
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
            
            // Use rabbit path for simplification - perfect test case with many points
            let coords;
            if (this.testState.boolean.rabbitPath && this.testState.boolean.rabbitPath.length > 0) {
                // Use the pre-loaded rabbit path, centered at canvas center
                coords = this.testState.boolean.rabbitPath.map(pt => [
                    pt[0] + 200,  // Center at canvas center
                    pt[1] + 200
                ]);
            } else {
                // Fallback: parse rabbit path directly if not initialized
                const rabbitDef = this.defaults.geometries.boolean.clips.rabbit;
                if (rabbitDef?.path) {
                    coords = this.geometry.parseSVGPath(
                        rabbitDef.path,
                        0.5,  // Larger scale for simplify test
                        [200, 200]  // Center position
                    );
                } else {
                    // Last fallback: use flower shape
                    const simplifyDef = this.defaults.geometries.simplify;
                    coords = this.defaults.generators.flower(
                        simplifyDef.center[0],
                        simplifyDef.center[1],
                        simplifyDef.baseRadius,
                        simplifyDef.noiseFrequency,
                        simplifyDef.noiseAmplitude,
                        simplifyDef.segments
                    );
                }
            }
            
            // Create path from coordinates
            const path = this.geometry.coordinatesToPath64(coords);
            const paths = new this.core.clipper2.Paths64();
            paths.push_back(path);
            
            // Store input with consistent key
            this.testData.set(`${testName}-input`, paths);
            
            // Get tolerance from state
            const tolerance = state.tolerance || 2;
            
            // Perform simplification
            const result = this.operations.simplify(paths, tolerance);
            
            // Store result
            this.testData.set(`${testName}-output`, result);
            
            // Count points
            const originalPoints = path.size();
            let simplifiedPoints = 0;
            for (let i = 0; i < result.size(); i++) {
                simplifiedPoints += result.get(i).size();
            }
            
            // Render both
            this.rendering.render(paths, 'simplify-canvas', this.defaults.styles.input);
            this.rendering.render(result, 'simplify-canvas', {
                ...this.defaults.styles.output,
                clear: false
            });
            
            this.setTestStatus(testName, 'success');
            
            const reduction = originalPoints > 0 ? Math.round((1 - simplifiedPoints / originalPoints) * 100) : 0;
            this.ui?.updateResult('simplify-result', 
                `[OK] Simplified rabbit: ${originalPoints} → ${simplifiedPoints} points (${reduction}% reduction)`);
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
            
            // Clear and draw original
            this.rendering.render(paths, 'offset-canvas', this.defaults.styles.default);
            
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
                
                // Draw with gradient
                const hue = (i / count) * 120;
                const alpha = 0.3 + (i / count) * 0.3;
                
                this.rendering.render(result, 'offset-canvas', {
                    fillOuter: `hsla(${hue}, 70%, 50%, ${alpha})`,
                    strokeOuter: `hsl(${hue}, 70%, 40%)`,
                    strokeWidth: 1,
                    clear: false
                });
            }
            
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
     * Test Minkowski operations - FIXED for better CAM visualization
     */
    async testMinkowski() {
        const testName = 'minkowski';
        this.setTestStatus(testName, 'pending');
        
        try {
            // Check if Minkowski operations are available
            if (!this.core.clipper2.MinkowskiSum64 || !this.core.clipper2.MinkowskiDiff64) {
                throw new Error('Minkowski operations not available in this Clipper2 build');
            }
            
            // Read from state
            const state = this.getTestState(testName);
            const { pattern: patternType, path: pathType, operation, pathClosed } = state;
            
            // Get definitions
            const patternDef = this.defaults.geometries.minkowski.patterns[patternType];
            const pathDef = this.defaults.geometries.minkowski.paths[pathType];
            
            // Create pattern
            let pattern;
            if (patternDef.type === 'parametric') {
                pattern = this.geometry.parametricToPath64(patternDef);
            } else if (patternDef.type === 'polygon') {
                pattern = this.geometry.polygonToPath64(patternDef);
            }
            
            // Create path
            let path;
            if (pathDef.type === 'polygon' || pathDef.type === 'polyline') {
                path = this.geometry.coordinatesToPath64(pathDef.data);
            }
            
            // Store inputs
            this.testData.set(`${testName}-pattern`, pattern);
            this.testData.set(`${testName}-path`, path);
            
            // Perform operation
            let result;
            if (operation === 'sum') {
                result = this.operations.minkowskiSum(pattern, path, pathClosed);
            } else {
                result = this.operations.minkowskiDiff(pattern, path, pathClosed);
            }
            
            // Store and render result
            this.testData.set(`${testName}-output`, result);
            
            // Clear canvas and draw
            this.rendering.clearCanvas('minkowski-canvas');
            
            // Draw original path (faded for reference)
            const paths = new this.core.clipper2.Paths64();
            paths.push_back(path);
            this.rendering.render(paths, 'minkowski-canvas', {
                fillOuter: 'rgba(150, 150, 150, 0.2)',
                strokeOuter: '#999',
                strokeWidth: 1,
                clear: false
            });
            
            // Draw pattern at origin for reference
            const scale = this.core.config.scale;
            const translatedPattern = this.core.clipper2.TranslatePath64(
                pattern, 
                BigInt(Math.round(30 * scale)),
                BigInt(Math.round(30 * scale))
            );
            const refPatterns = new this.core.clipper2.Paths64();
            refPatterns.push_back(translatedPattern);
            this.rendering.render(refPatterns, 'minkowski-canvas', {
                fillOuter: 'rgba(255, 0, 0, 0.3)',
                strokeOuter: '#ff0000',
                strokeWidth: 1,
                clear: false
            });
            
            // Draw result prominently
            this.rendering.render(result, 'minkowski-canvas', {
                fillOuter: operation === 'sum' ? 
                    'rgba(16, 185, 129, 0.4)' :  // Green for sum (expansion)
                    'rgba(59, 130, 246, 0.4)',    // Blue for diff (contraction)
                strokeOuter: operation === 'sum' ? '#10b981' : '#3b82f6',
                strokeWidth: 2,
                clear: false
            });
            
            // Add labels
            const canvas = document.getElementById('minkowski-canvas');
            if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx.font = '10px Arial';
                ctx.fillStyle = '#ff0000';
                ctx.fillText('Tool', 30, 60);
                ctx.fillStyle = '#999';
                ctx.fillText('Original', 200, 15);
                ctx.fillStyle = operation === 'sum' ? '#10b981' : '#3b82f6';
                ctx.fillText(operation === 'sum' ? 'Sum (Expanded)' : 'Diff (Contracted)', 200, 390);
            }
            
            // Clean up temporary objects
            paths.delete();
            translatedPattern.delete();
            refPatterns.delete();
            pattern.delete();
            path.delete();
            
            this.setTestStatus(testName, 'success');
            
            const description = operation === 'sum' ? 
                'Shows all areas the tool center can reach (tool swept along path)' :
                'Shows valid tool center positions to stay within bounds';
            
            this.ui?.updateResult('minkowski-result', 
                `[OK] Minkowski ${operation}: ${result.size()} path(s) - ${description}`);
            this.ui?.updateInfo('minkowski-info', this.formatGeometryInfo(result));
            
            return { success: true, output: result.size() };
            
        } catch (error) {
            console.error('[ERROR] Minkowski test failed:', error);
            this.setTestStatus(testName, 'error');
            this.ui?.updateResult('minkowski-result', `[ERROR] ${error.message}`, false);
            return { success: false, error: error.message };
        }
    }

    /**
     * Test point-in-polygon - FIXED: persist polygon
     */
    async testPointInPolygon() {
        const testName = 'pip';
        this.setTestStatus(testName, 'pending');
        
        try {
            const pipDef = this.defaults.geometries.pip;
            
            // Create test polygon
            const polygon = this.geometry.coordinatesToPath64(pipDef.data);
            
            // Store for click handler - this is the key fix
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
     * Check point locations for PIP test - FIXED
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
        
        points.forEach(point => {
            const testPoint = new this.core.clipper2.Point64(
                BigInt(Math.round(point.x * scale)),
                BigInt(Math.round(point.y * scale)),
                BigInt(0)
            );
            
            const result = this.core.clipper2.PointInPolygon64(testPoint, polygon);
            
            // Check near edge - only if NOT already on edge
            let isNearEdge = false;
            if (result !== 0) {  // 0 = IsOn
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
                    const nearResult = this.core.clipper2.PointInPolygon64(nearPoint, polygon);
                    nearPoint.delete();
                    
                    if (nearResult === 1) insideCount++;  // 1 = IsInside
                    else if (nearResult === 2) outsideCount++;  // 2 = IsOutside
                }
                
                isNearEdge = insideCount > 0 && outsideCount > 0;
            }
            
            let status, color;
            if (result === 0 || isNearEdge) {  // 0 = IsOn
                status = 'ON EDGE';
                color = getComputedStyle(document.documentElement)
                    .getPropertyValue('--pip-edge');
            } else if (result === 1) {  // 1 = IsInside
                status = 'INSIDE';
                color = getComputedStyle(document.documentElement)
                    .getPropertyValue('--pip-inside');
            } else if (result === 2) {  // 2 = IsOutside
                status = 'OUTSIDE';
                color = getComputedStyle(document.documentElement)
                    .getPropertyValue('--pip-outside');
            } else {
                // Shouldn't happen
                status = 'UNKNOWN';
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
     * Test area calculation - FIXED: interactive on load, better button flow
     */
    async testArea() {
        const testName = 'area';
        this.setTestStatus(testName, 'pending');
        
        try {
            const canvas = document.getElementById('area-canvas');
            if (!canvas) throw new Error('Canvas not found');
            
            const areaDef = this.defaults.geometries.area;
            
            // Clear and setup
            this.rendering.clearCanvas(canvas);
            this.rendering.drawGrid(canvas, areaDef.gridSize);
            
            // Reset points in state
            this.testState.area.points = [];
            this.testState.area.isDrawing = true;
            
            const ctx = canvas.getContext('2d');
            ctx.font = '14px Arial';
            ctx.fillStyle = getComputedStyle(document.documentElement)
                .getPropertyValue('--text');
            ctx.fillText('Click to add points (min 3), then Calculate', 10, 25);
            
            // Get or create calculate button
            let calculateBtn = document.getElementById('area-calculate');
            
            if (!calculateBtn) {
                // Find the button marked as primary in the controls
                const controlsDiv = canvas.parentNode.querySelector('.controls');
                if (controlsDiv) {
                    const buttons = controlsDiv.querySelectorAll('button.btn-primary');
                    buttons.forEach(btn => {
                        // Take over the first primary button that's not reset
                        if (!btn.id || btn.id !== 'area-reset') {
                            calculateBtn = btn;
                            calculateBtn.id = 'area-calculate';
                        }
                    });
                }
            }
            
            if (calculateBtn) {
                calculateBtn.textContent = 'Calculate Area';
                calculateBtn.disabled = true;
                calculateBtn.style.display = 'inline-block';
                // Clear any existing onclick to avoid conflicts
                calculateBtn.onclick = null;
            }
            
            // Click handler for canvas
            const clickHandler = (event) => {
                if (!this.testState.area.isDrawing) return;
                
                const rect = canvas.getBoundingClientRect();
                const scaleX = canvas.width / rect.width;
                const scaleY = canvas.height / rect.height;
                const x = (event.clientX - rect.left) * scaleX;
                const y = (event.clientY - rect.top) * scaleY;
                
                this.testState.area.points.push({ x, y });
                
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = getComputedStyle(document.documentElement)
                    .getPropertyValue('--shape-stroke');
                ctx.beginPath();
                ctx.arc(x, y, areaDef.pointRadius, 0, Math.PI * 2);
                ctx.fill();
                
                if (this.testState.area.points.length > 1) {
                    ctx.strokeStyle = getComputedStyle(document.documentElement)
                        .getPropertyValue('--shape-stroke');
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(this.testState.area.points[this.testState.area.points.length - 2].x, 
                              this.testState.area.points[this.testState.area.points.length - 2].y);
                    ctx.lineTo(x, y);
                    ctx.stroke();
                }
                
                if (this.testState.area.points.length >= areaDef.minPoints && calculateBtn) {
                    calculateBtn.disabled = false;
                }
                
                document.getElementById('area-result').textContent = 
                    `${this.testState.area.points.length} points added. ${this.testState.area.points.length >= areaDef.minPoints ? 'Ready!' : `Need ${areaDef.minPoints - this.testState.area.points.length} more.`}`;
            };
            
            // Set up canvas click handler
            canvas.onclick = clickHandler;
            
            // Calculate button handler
            if (calculateBtn) {
                calculateBtn.onclick = () => {
                    if (this.testState.area.points.length < areaDef.minPoints) return;
                    
                    this.testState.area.isDrawing = false;
                    canvas.onclick = null; // Disable clicking
                    
                    const ctx = canvas.getContext('2d');
                    ctx.strokeStyle = getComputedStyle(document.documentElement)
                        .getPropertyValue('--shape-stroke');
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(this.testState.area.points[this.testState.area.points.length - 1].x, 
                              this.testState.area.points[this.testState.area.points.length - 1].y);
                    ctx.lineTo(this.testState.area.points[0].x, this.testState.area.points[0].y);
                    ctx.stroke();
                    
                    const coordArray = this.testState.area.points.map(p => [p.x, p.y]);
                    const path = this.geometry.coordinatesToPath64(coordArray);
                    
                    const area = this.geometry.calculateArea(path);
                    const actualArea = area / (this.core.config.scale * this.core.config.scale);
                    
                    // In Y-down canvas coordinates:
                    // Positive area = CCW, Negative area = CW
                    const orientation = area > 0 ? 'COUNTER-CLOCKWISE' : 'CLOCKWISE';
                    
                    // Use correct color based on winding
                    ctx.fillStyle = area > 0 ? 
                        'rgba(16, 185, 129, 0.25)' : // Green for CCW
                        'rgba(239, 68, 68, 0.25)';    // Red for CW
                    ctx.beginPath();
                    this.testState.area.points.forEach((p, i) => {
                        if (i === 0) ctx.moveTo(p.x, p.y);
                        else ctx.lineTo(p.x, p.y);
                    });
                    ctx.closePath();
                    ctx.fill();
                    
                    this.setTestStatus(testName, 'success');
                    this.ui?.updateResult('area-result', 
                        `[OK] Area: ${Math.abs(actualArea).toFixed(0)} px² | Orientation: ${orientation}`);
                    
                    calculateBtn.textContent = 'New Polygon';
                    calculateBtn.disabled = false;
                    calculateBtn.onclick = () => {
                        this.testArea();
                    };
                    
                    path.delete();
                };
            }
            
            this.ui?.updateResult('area-result', `Click points to draw. Need at least ${areaDef.minPoints}.`);
            
            return { success: true };
            
        } catch (error) {
            console.error('[ERROR] Area test failed:', error);
            this.setTestStatus(testName, 'error');
            this.ui?.updateResult('area-result', `[ERROR] ${error.message}`, false);
            return { success: false, error: error.message };
        }
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
    exportSVG(testName) {
        // Check if output exists first
        let dataToExport = this.testData.get(`${testName}-output`);
        let filename = `clipper2-${testName}-output.svg`;
        
        // If no output, try to get input
        if (!dataToExport) {
            dataToExport = this.testData.get(`${testName}-input`) || 
                          this.testData.get(`${testName}-frame`) ||
                          this.testData.get('pip-polygon');
            filename = `clipper2-${testName}-input.svg`;
            
            if (!dataToExport) {
                alert('No data to export. Run the test first.');
                return;
            }
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
                break;
            case 'minkowski':
                // Reset to defaults from config
                this.testState.minkowski.pattern = this.defaults.geometries.minkowski.defaults.pattern;
                this.testState.minkowski.path = this.defaults.geometries.minkowski.defaults.path;
                this.testState.minkowski.operation = this.defaults.geometries.minkowski.defaults.operation;
                this.testState.minkowski.pathClosed = this.defaults.geometries.minkowski.defaults.pathClosed;
                break;
        }
        
        // Let UI handle the rest
        this.ui?.resetView(testName);
    }
}