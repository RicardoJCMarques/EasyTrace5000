/**
 * Clipper2 Tests Module
 * Test implementations with state-driven architecture
 * Version 6.1 - Fixed dragging, rabbit loading, PIP clicking, area winding
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
                clipPos: { x: 150, y: 150 }, // Start at top-left of subject
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
                tolerance: 5
            },
            area: {
                points: []
            },
            pip: {
                points: []
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
            
            // Set cross-references
            this.operations.setGeometryModule(this.geometry);
            this.rendering.setGeometryModule(this.geometry);
            
            // Apply configuration from defaults
            this.core.setConfig(this.defaults.config);
            this.operations.setTangencyResolution(this.defaults.tangency);
            
            // Pre-parse rabbit SVG
            this.initializeRabbitPath();
            
            console.log('[TESTS] All modules initialized');
            console.log('[TESTS] Tangency resolution:', this.operations.getTangencyResolution());
            
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
        this.testState.boolean.rabbitPath = this.geometry.parseSVGPath(
            rabbitDef.path, 
            rabbitDef.scale, 
            [0, 0] // Parse at origin, will be positioned later
        );
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
            
            const subjectCoords = subjectDef.data.map(pt => [
                pt[0] - 100 + subjectPos.x,
                pt[1] - 100 + subjectPos.y
            ]);
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
            } else if (clipDef.type === 'parametric') {
                clipPath = this.geometry.parametricToPath64(clipDef, {
                    position: [clipPos.x, clipPos.y],
                    randomShape: randomShape
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
            
            // Store inputs
            this.testData.set(`${testName}-subject`, subjectPaths);
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
            
            // Store input
            this.testData.set(`${testName}-input`, strokes);
            
            console.log(`[Letter B] Union of ${strokes.size()} strokes`);
            
            // Perform union
            const result = this.operations.unionSelf(strokes, null, { forceSingle: true });
            
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
            
            // Store input
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
            });
            
            // Store inputs
            this.testData.set(`${testName}-frame`, frame);
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
     * Test path simplification
     */
    async testSimplify() {
        const testName = 'simplify';
        this.setTestStatus(testName, 'pending');
        
        try {
            const simplifyDef = this.defaults.geometries.simplify;
            const state = this.getTestState(testName);
            
            // Create noisy path
            const path = this.geometry.parametricToPath64(simplifyDef);
            const paths = new this.core.clipper2.Paths64();
            paths.push_back(path);
            
            // Store input
            this.testData.set(`${testName}-input`, paths);
            
            // Get tolerance from state
            const tolerance = state.tolerance || simplifyDef.defaultTolerance;
            
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
            
            const reduction = Math.round((1 - simplifiedPoints / originalPoints) * 100);
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
            
            // Store input
            this.testData.set(`${testName}-input`, paths);
            
            // Clear and draw original
            this.rendering.render(paths, 'offset-canvas', this.defaults.styles.default);
            
            // Get join type enum
            const joinTypeEnum = this.getJoinTypeEnum(joinType);
            const endTypeEnum = this.core.clipper2.EndType.Polygon;
            
            // Perform offsets
            const actualDistance = type === 'internal' ? -Math.abs(distance) : Math.abs(distance);
            const offsetResults = [];
            
            for (let i = 1; i <= count; i++) {
                const delta = actualDistance * i;
                const result = this.core.clipper2.InflatePaths64(
                    paths,
                    delta,
                    joinTypeEnum,
                    endTypeEnum,
                    miterLimit,
                    0
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
     * Test point-in-polygon
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
            
            // Clear any existing handler
            const canvas = document.getElementById('pip-canvas');
            const newCanvas = canvas.cloneNode(true);
            canvas.parentNode.replaceChild(newCanvas, canvas);
            
            // Redraw polygon
            const paths = new this.core.clipper2.Paths64();
            paths.push_back(polygon);
            this.rendering.render(paths, 'pip-canvas', this.defaults.styles.default);
            
            // Initialize points array in state
            this.testState.pip.points = [];
            
            // Add instructions
            const ctx = newCanvas.getContext('2d');
            ctx.font = '12px Arial';
            ctx.fillStyle = getComputedStyle(document.documentElement)
                .getPropertyValue('--input-stroke');
            ctx.fillText('Click to add test points', 10, 20);
            
            // Add click handler - FIX: use arrow function to preserve 'this'
            newCanvas.onclick = (event) => {
                const rect = newCanvas.getBoundingClientRect();
                const scaleX = newCanvas.width / rect.width;
                const scaleY = newCanvas.height / rect.height;
                const x = (event.clientX - rect.left) * scaleX;
                const y = (event.clientY - rect.top) * scaleY;
                
                this.testState.pip.points.push({ x, y, status: 'unchecked' });
                
                const ctx = newCanvas.getContext('2d');
                ctx.fillStyle = getComputedStyle(document.documentElement)
                    .getPropertyValue('--input-stroke');
                ctx.beginPath();
                ctx.arc(x, y, 5, 0, Math.PI * 2);
                ctx.fill();
                
                this.ui?.updateResult('pip-result', 
                    `${this.testState.pip.points.length} point(s) added. Click "Check Locations" to test.`);
            };
            
            this.ui?.updateResult('pip-result', 'Click to add test points');
            
            return { success: true };
            
        } catch (error) {
            console.error('[ERROR] Point-in-polygon test failed:', error);
            this.setTestStatus(testName, 'error');
            this.ui?.updateResult('pip-result', `[ERROR] ${error.message}`, false);
            return { success: false, error: error.message };
        }
    }

    /**
     * Check point locations for PIP test
     */
    checkPointLocations() {
        const polygon = this.testData.get('pip-polygon');
        const points = this.testState.pip.points;
        
        if (!polygon || !points || points.length === 0) {
            this.ui?.updateResult('pip-result', 'No points to check');
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
        const edgeTolerance = this.defaults.geometries.pip.edgeTolerance;
        
        points.forEach(point => {
            const testPoint = new this.core.clipper2.Point64(
                BigInt(Math.round(point.x * scale)),
                BigInt(Math.round(point.y * scale)),
                BigInt(0)
            );
            
            const result = this.core.clipper2.PointInPolygon64(testPoint, polygon);
            
            // Check near edge
            let isNearEdge = false;
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
                
                if (nearResult === 1) insideCount++;
                else if (nearResult === 2) outsideCount++;
            }
            
            isNearEdge = insideCount > 0 && outsideCount > 0;
            
            let status, color;
            if (isNearEdge) {
                status = 'ON EDGE';
                color = getComputedStyle(document.documentElement)
                    .getPropertyValue('--pip-edge');
            } else if (result === 1) {
                status = 'INSIDE';
                color = getComputedStyle(document.documentElement)
                    .getPropertyValue('--pip-inside');
            } else if (result === 2) {
                status = 'OUTSIDE';
                color = getComputedStyle(document.documentElement)
                    .getPropertyValue('--pip-outside');
            } else {
                status = 'ON EDGE';
                color = getComputedStyle(document.documentElement)
                    .getPropertyValue('--pip-edge');
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
        
        this.setTestStatus('pip', 'success');
        this.ui?.updateResult('pip-result', 
            `Checked ${points.length} points:\n${results.join('\n')}`);
    }

    /**
     * Test area calculation
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
            let isDrawing = true;
            
            const newCanvas = canvas.cloneNode(true);
            canvas.parentNode.replaceChild(newCanvas, canvas);
            
            // Redraw grid
            this.rendering.drawGrid(newCanvas, areaDef.gridSize);
            
            const ctx = newCanvas.getContext('2d');
            ctx.font = '14px Arial';
            ctx.fillStyle = getComputedStyle(document.documentElement)
                .getPropertyValue('--text');
            ctx.fillText('Click to add points (min 3)', 10, 25);
            
            // Add calculate button
            const calculateBtn = document.createElement('button');
            calculateBtn.textContent = 'Calculate Area';
            calculateBtn.className = 'btn btn-primary';
            calculateBtn.style.cssText = 'position: absolute; bottom: 10px; right: 10px;';
            calculateBtn.disabled = true;
            newCanvas.parentNode.style.position = 'relative';
            
            const existingBtn = newCanvas.parentNode.querySelector('button');
            if (existingBtn) existingBtn.remove();
            
            newCanvas.parentNode.appendChild(calculateBtn);
            
            // Click handler
            newCanvas.onclick = (event) => {
                if (!isDrawing) return;
                
                const rect = newCanvas.getBoundingClientRect();
                const scaleX = newCanvas.width / rect.width;
                const scaleY = newCanvas.height / rect.height;
                const x = (event.clientX - rect.left) * scaleX;
                const y = (event.clientY - rect.top) * scaleY;
                
                this.testState.area.points.push({ x, y });
                
                const ctx = newCanvas.getContext('2d');
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
                
                if (this.testState.area.points.length >= areaDef.minPoints) {
                    calculateBtn.disabled = false;
                }
                
                document.getElementById('area-result').textContent = 
                    `${this.testState.area.points.length} points added. ${this.testState.area.points.length >= areaDef.minPoints ? 'Ready!' : `Need ${areaDef.minPoints - this.testState.area.points.length} more.`}`;
            };
            
            // Calculate button handler
            calculateBtn.onclick = () => {
                if (this.testState.area.points.length < areaDef.minPoints) return;
                
                isDrawing = false;
                
                const ctx = newCanvas.getContext('2d');
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
                // FIX: Detect actual winding direction properly
                const actualArea = area / (this.core.config.scale * this.core.config.scale);
                const orientation = area > 0 ? 'COUNTER-CLOCKWISE' : 'CLOCKWISE';
                
                // Use correct color based on actual winding
                ctx.fillStyle = area > 0 ? 
                    getComputedStyle(document.documentElement).getPropertyValue('--shape-fill') : 
                    'rgba(239, 68, 68, 0.25)';
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
                
                calculateBtn.textContent = 'Reset';
                calculateBtn.onclick = () => {
                    calculateBtn.remove();
                    this.testArea();
                };
                
                path.delete();
            };
            
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
        const isShowingOutput = this.ui?.getViewState(testName);
        
        let dataToExport;
        let filename;
        
        if (isShowingOutput) {
            dataToExport = this.testData.get(`${testName}-output`);
            filename = `clipper2-${testName}-output.svg`;
        }
        
        if (!dataToExport) {
            dataToExport = this.testData.get(`${testName}-input`) || 
                          this.testData.get(`${testName}-subject`);
            filename = `clipper2-${testName}-input.svg`;
        }
        
        if (!dataToExport) {
            alert('No data to export');
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
                this.testState.boolean.randomShape = null;
                break;
            case 'nested':
                this.testState.nested.island1Pos = { x: 150, y: 150 };
                this.testState.nested.island2Pos = { x: 250, y: 250 };
                break;
            case 'pip':
                this.testState.pip.points = [];
                break;
            case 'area':
                this.testState.area.points = [];
                break;
        }
        
        // Let UI handle the rest
        this.ui?.resetView(testName);
    }
}