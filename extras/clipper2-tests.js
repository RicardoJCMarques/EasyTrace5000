/**
 * Clipper2 Tests Module
 * Individual test implementations using refactored operations
 * Version 3.10 - Updated for improved tangency resolution
 */

class Clipper2Tests {
    constructor() {
        this.core = null;
        this.geometry = null;
        this.operations = null;
        this.rendering = null;
        this.ui = null;
        this.testData = new Map();
        this.svgPaths = new Map(); // Store parsed SVG paths
    }

    /**
     * Initialize test system with all modules
     */
    async initialize() {
        try {
            // Initialize core
            this.core = new Clipper2Core();
            await this.core.initialize();
            
            // Initialize other modules
            this.geometry = new Clipper2Geometry(this.core);
            this.operations = new Clipper2Operations(this.core);
            this.rendering = new Clipper2Rendering(this.core);
            
            // Parse SVG paths
            this.initializeSVGPaths();
            
            // Log initial tangency settings
            const tangencySettings = this.operations.getTangencyResolution();
            console.log('[TESTS] Tangency resolution initialized:', tangencySettings);
            
            // UI will be initialized separately
            console.log('[TESTS] All modules initialized');
            
            return true;
        } catch (error) {
            console.error('[ERROR] Failed to initialize test system:', error);
            return false;
        }
    }

    /**
     * Initialize SVG paths like the rabbit
     */
    initializeSVGPaths() {
        // Rabbit path data (extracted from SVG, translated to origin)
        const rabbitPathData = 'm 117.827,473.496 -8.148,-2.095 -7.222,-4.233 -3.845,-7.305 0.58,-7.641 1.89,-7.452 2.575,-7.243 2.333,-5.778 -5.048,-0.572 -5.048,-0.572 -6.141,-0.733 -6.125,-0.86 -2.82,2.504 -2.802,5.561 -5.16,3.469 -8.834,0.605 -8.872,-0.029 -8.869,-0.21 -8.865,-0.338 -8.859,-0.466 -8.848,-0.647 -8.7614,-1.276 -4.6459,-7.072 2.8843,-8.492 5.478,-7.198 6.608,-6.191 4.85,-4.196 2.117,-5.783 -1.772,-5.173 -4.43,-3.518 -6.853,-5.828 -4.9814,-7.442 -2.056,-8.736 -0.2667,-8.999 0.4584,-8.995 0.7962,-8.905 0.9762,-8.887 1.088,-8.875 1.1893,-8.862 1.317,-8.842 1.655,-8.785 3.787,-7.716 5.144,-6.927 5.585,-6.58 5.786,-6.405 5.895,-6.305 6.342,-6.558 6.446,-6.458 6.519,-6.383 6.579,-6.321 6.636,-6.261 6.696,-6.198 6.766,-6.117 6.88,-5.993 7.206,-5.582 7.372,-3.146 7.613,-2.527 8.59,-2.717 7.365,-4.943 3.677,-8.186 2.607,-8.624 2.726,-8.495 3.376,-8.256 4.332,-7.792 -1.458,-5.5 -5.077,-8.354 -4.107,-6.133 -4.901,-5.546 -5.143,-5.321 -5.161,-5.33 -5.026,-5.46 -4.732,-5.71 -4.769,-8.681 -4.478,-8.836 -4.388,-8.881 -4.328,-8.9118 -4.274,-8.9376 -4.213,-8.9652 -4.122,-9.0077 -3.822,-9.1367 -1.49,-5.8115 -0.796,-5.9437 3.324,-8.4038 5.66,-4.6108 6.862,-2.4246 7.305,-0.2515 8.97,1.5992 8.434,3.4654 7.769,4.7856 7.175,5.644 6.7,6.2009 6.329,6.7251 5.725,7.2478 5.129,7.6801 4.7,7.9535 4.432,8.1049 4.275,8.1894 4.065,7.831 4.152,7.785 4.462,7.591 2.947,-8.361 1.153,-9.044 0.648,-9.095 0.55,-9.3465 1.417,-9.2418 2.861,-8.9116 2.684,-7.4629 2.844,-7.4041 3.144,-7.2812 4.078,-6.7684 8.321,-1.9385 6.629,5.7311 2.392,8.9515 0.86,9.2652 0.439,9.2971 0.266,9.3041 0.18,9.3061 0.125,7.6249 0.125,7.625 0.124,7.625 0.125,7.625 4.714,0.627 7.428,1.403 7.169,2.383 6.643,3.589 5.788,4.846 4.436,6.202 3.908,6.558 3.724,6.666 3.615,6.726 4.586,8.485 4.751,8.394 5.186,8.121 4.157,6.3 1.657,7.379 -0.019,7.584 -0.839,7.545 -1.674,7.58 -3.979,6.628 -5.465,5.526 -5.56,5.682 -3.206,7.214 -1.739,6.353 2.801,8.334 2.753,9.226 2.099,9.397 1.389,9.527 0.584,9.609 -0.365,9.619 -1.55,9.497 -2.509,9.05 -2.709,8.992 -2.82,8.958 -2.793,9.166 -2.483,9.254 -2.151,9.337 -1.818,9.408 -1.504,9.462 -1.223,9.504 -0.411,9.059 0.963,9.016 2.244,8.788 3.211,8.485 3.866,8.21 4.294,7.997 4.575,7.837 4.895,8.249 4.6,8.414 2.515,9.134 -4.607,5.514 -7.789,0.876 -7.851,0.142 -7.164,-0.054 -7.147,-0.484 -6.999,-1.494 -7.326,-2.485 -5.97,-4.777 -3.65,-6.812 -2.943,-7.161 -2.096,-5.292 -2.097,-5.293 -7.611,-0.392 -7.611,-0.392 -7.611,-0.392 -7.841,-0.434 -7.837,-0.491 -7.834,-0.555 -7.822,-0.698 -9.194,-0.324 -1.815,4.861 -1.504,4.978 -2.624,9.161 2.068,6.947 1.732,7.882 -0.428,7.949 -5.904,2.831 -6.75,0.429 -6.765,0.023 -9.656,-0.241 -9.631,-0.708 v 0 z';
        
        // Parse and scale rabbit path
        const rabbitPath = this.parseSVGPath(rabbitPathData, 0.3); // Scale down to fit
        this.svgPaths.set('rabbit', rabbitPath);
    }

    /**
     * Parse SVG path data to Clipper2 Path64
     */
    parseSVGPath(pathData, scale = 1.0) {
        const path = new this.core.clipper2.Path64();
        const commands = pathData.match(/[mlhvcsqtaz][^mlhvcsqtaz]*/gi);
        
        let currentX = 0, currentY = 0;
        let startX = 0, startY = 0;
        
        commands?.forEach(cmd => {
            const type = cmd[0].toLowerCase();
            const numbers = cmd.slice(1).trim().split(/[\s,]+/).map(parseFloat);
            const isRelative = cmd[0] === cmd[0].toLowerCase();
            
            switch(type) {
                case 'm': // Move to
                    if (isRelative) {
                        currentX += numbers[0];
                        currentY += numbers[1];
                    } else {
                        currentX = numbers[0];
                        currentY = numbers[1];
                    }
                    startX = currentX;
                    startY = currentY;
                    
                    // Handle subsequent coordinates as line-to
                    for (let i = 2; i < numbers.length; i += 2) {
                        if (isRelative) {
                            currentX += numbers[i];
                            currentY += numbers[i + 1];
                        } else {
                            currentX = numbers[i];
                            currentY = numbers[i + 1];
                        }
                        path.push_back(new this.core.clipper2.Point64(
                            BigInt(Math.round(currentX * scale * this.core.config.scale)),
                            BigInt(Math.round(currentY * scale * this.core.config.scale)),
                            BigInt(0)
                        ));
                    }
                    break;
                    
                case 'l': // Line to
                    for (let i = 0; i < numbers.length; i += 2) {
                        if (isRelative) {
                            currentX += numbers[i];
                            currentY += numbers[i + 1];
                        } else {
                            currentX = numbers[i];
                            currentY = numbers[i + 1];
                        }
                        path.push_back(new this.core.clipper2.Point64(
                            BigInt(Math.round(currentX * scale * this.core.config.scale)),
                            BigInt(Math.round(currentY * scale * this.core.config.scale)),
                            BigInt(0)
                        ));
                    }
                    break;
                    
                case 'h': // Horizontal line
                    for (let i = 0; i < numbers.length; i++) {
                        currentX = isRelative ? currentX + numbers[i] : numbers[i];
                        path.push_back(new this.core.clipper2.Point64(
                            BigInt(Math.round(currentX * scale * this.core.config.scale)),
                            BigInt(Math.round(currentY * scale * this.core.config.scale)),
                            BigInt(0)
                        ));
                    }
                    break;
                    
                case 'v': // Vertical line
                    for (let i = 0; i < numbers.length; i++) {
                        currentY = isRelative ? currentY + numbers[i] : numbers[i];
                        path.push_back(new this.core.clipper2.Point64(
                            BigInt(Math.round(currentX * scale * this.core.config.scale)),
                            BigInt(Math.round(currentY * scale * this.core.config.scale)),
                            BigInt(0)
                        ));
                    }
                    break;
                    
                case 'z': // Close path
                    currentX = startX;
                    currentY = startY;
                    break;
                    
                // For curves, approximate with line segments
                case 'c': // Cubic bezier
                case 's': // Smooth cubic
                case 'q': // Quadratic bezier
                case 't': // Smooth quadratic
                case 'a': // Arc
                    // Simplified: just connect to end point
                    const lastIdx = numbers.length - 2;
                    if (lastIdx >= 0) {
                        if (isRelative) {
                            currentX += numbers[lastIdx];
                            currentY += numbers[lastIdx + 1];
                        } else {
                            currentX = numbers[lastIdx];
                            currentY = numbers[lastIdx + 1];
                        }
                        path.push_back(new this.core.clipper2.Point64(
                            BigInt(Math.round(currentX * scale * this.core.config.scale)),
                            BigInt(Math.round(currentY * scale * this.core.config.scale)),
                            BigInt(0)
                        ));
                    }
                    break;
            }
        });
        
        // Ensure CCW winding for parsed path
        if (this.geometry && this.geometry.ensureCounterClockwise) {
            this.geometry.ensureCounterClockwise(path);
        }
        
        return this.core.trackObject(path);
    }

    /**
     * Consolidated Boolean Operation Test
     */
    async testBooleanOperation() {
        const testName = 'boolean';
        this.rendering.clearCanvas('boolean-canvas');
        
        try {
            // Get UI selections
            const operation = this.ui?.getInputValue('boolean-operation', 'union') || 'union';
            const clipShape = this.ui?.getInputValue('boolean-clip-shape', 'circle') || 'circle';
            
            // Get draggable positions if available
            const uiState = this.ui?.draggableShapes.get(testName);
            
            // Create subject (blue square) - geometry already normalized to CCW
            const subject = new this.core.clipper2.Paths64();
            const subjectRect = uiState?.shapes?.subject || { x: 100, y: 100, width: 200, height: 200 };
            subject.push_back(this.geometry.createRectangle(
                subjectRect.x, subjectRect.y, subjectRect.width, subjectRect.height
            ));
            
            // Create clip based on selection - geometry already normalized to CCW
            const clip = new this.core.clipper2.Paths64();
            const clipPos = uiState?.shapes?.clip || { x: 100, y: 100 };
            
            switch(clipShape) {
                case 'circle':
                    clip.push_back(this.geometry.createCircle(clipPos.x, clipPos.y, 80));
                    break;
                case 'triangle':
                    clip.push_back(this.geometry.createPolygon([
                        [clipPos.x, clipPos.y - 80],
                        [clipPos.x + 70, clipPos.y + 40],
                        [clipPos.x - 70, clipPos.y + 40]
                    ]));
                    break;
                case 'square':
                    clip.push_back(this.geometry.createRectangle(
                        clipPos.x - 75, clipPos.y - 75, 150, 150
                    ));
                    break;
                case 'star':
                    clip.push_back(this.geometry.createStar(clipPos.x, clipPos.y, 80, 40, 5));
                    break;
                case 'random':
                    // Generate and use stored random shape from UI
                    const uiState = this.ui?.draggableShapes.get('boolean');
                    if (uiState && uiState.randomShape) {
                        const randomPath = this.geometry.createPolygon(
                            uiState.randomShape.map(p => [p[0] + clipPos.x, p[1] + clipPos.y])
                        );
                        clip.push_back(randomPath);
                    } else {
                        // Fallback: generate new random shape
                        clip.push_back(this.geometry.createRandomConvexPolygon(
                            clipPos.x, clipPos.y, 70, 30, 8
                        ));
                    }
                    break;
                case 'rabbit':
                    const rabbitPath = this.svgPaths.get('rabbit');
                    if (rabbitPath) {
                        // Clone and translate rabbit to clip position
                        const translatedRabbit = new this.core.clipper2.Path64();
                        for (let i = 0; i < rabbitPath.size(); i++) {
                            const pt = rabbitPath.get(i);
                            translatedRabbit.push_back(new this.core.clipper2.Point64(
                                BigInt(Number(pt.x) + clipPos.x * this.core.config.scale),
                                BigInt(Number(pt.y) + clipPos.y * this.core.config.scale),
                                BigInt(0)
                            ));
                        }
                        clip.push_back(translatedRabbit);
                    } else {
                        // Fallback to star shape if rabbit not loaded
                        clip.push_back(this.geometry.createStar(clipPos.x, clipPos.y, 80, 40, 5));
                    }
                    break;
            }
            
            // Store inputs
            this.testData.set(`${testName}-subject`, subject);
            this.testData.set(`${testName}-clip`, clip);
            
            // Perform operation - operations module handles normalization
            let result;
            switch(operation) {
                case 'union':
                    result = this.operations.union(subject, clip);
                    break;
                case 'intersection':
                    result = this.operations.intersect(subject, clip);
                    break;
                case 'difference':
                    result = this.operations.difference(subject, clip);
                    break;
                case 'xor':
                    result = this.operations.xor(subject, clip);
                    break;
                default:
                    result = this.operations.union(subject, clip);
            }
            
            // Store result
            this.testData.set(`${testName}-output`, result);
            
            // Display
            this.rendering.drawPaths(result, 'boolean-canvas', {
                fillOuter: '#10b981' + '40',
                strokeOuter: '#10b981'
            });
            
            // Update view state
            this.ui?.setViewState(testName, true);
            
            this.ui?.updateResult('boolean-result', 
                `[OK] ${operation.toUpperCase()}: ${result.size()} path(s)`);
            
            this.ui?.updateInfo('boolean-info', this.formatGeometryInfo(result));
            
            return { success: true, output: result.size() };
            
        } catch (error) {
            console.error('[ERROR] Boolean operation failed:', error);
            this.ui?.updateResult('boolean-result', `[ERROR] ${error.message}`, false);
            return { success: false, error: error.message };
        }
    }

    /**
     * Test Letter B creation with improved tangency resolution
     */
    async testLetterB() {
        const testName = 'letter-b';
        this.rendering.clearCanvas('letter-b-canvas');
        
        try {
            // Log current tangency settings for debugging
            const tangencySettings = this.operations.getTangencyResolution();
            console.log('[Letter B] Current tangency settings:', tangencySettings);
            
            // Create letter B using strokes - geometry already normalized to CCW
            const strokes = new this.core.clipper2.Paths64();
            const strokeWidth = 25;
            
            // All strokes are created with CCW winding
            strokes.push_back(this.geometry.createTrace(100, 50, 100, 290, strokeWidth));
            strokes.push_back(this.geometry.createTrace(100, 80, 200, 80, strokeWidth));
            strokes.push_back(this.geometry.createArc(200, 110, 30, -Math.PI/2, Math.PI/2, strokeWidth));
            strokes.push_back(this.geometry.createTrace(200, 140, 100, 140, strokeWidth));
            strokes.push_back(this.geometry.createTrace(100, 200, 210, 200, strokeWidth));
            strokes.push_back(this.geometry.createArc(210, 235, 35, -Math.PI/2, Math.PI/2, strokeWidth));
            strokes.push_back(this.geometry.createTrace(210, 270, 100, 270, strokeWidth));
            
            // Store input
            this.testData.set(`${testName}-input`, strokes);
            
            console.log(`[Letter B] Starting union on ${strokes.size()} strokes`);
            console.log(`[Letter B] Tangency resolution: ${tangencySettings.enabled ? 'ENABLED' : 'DISABLED'}`);
            if (tangencySettings.enabled) {
                console.log(`[Letter B] Epsilon range: [${tangencySettings.minOffset}, ${tangencySettings.maxOffset}]`);
            }
            
            // Perform union - tangency resolution happens automatically with new epsilon values
            const result = this.operations.unionSelf(strokes, null, { forceSingle: true });
            
            console.log(`[Letter B] Union completed: ${result.size()} path(s)`);
            
            // Count holes from area analysis
            const resultArray = this.core.pathsToArray(result);
            const holes = resultArray.filter(p => p.orientation === 'hole').length;
            const outers = resultArray.filter(p => p.orientation === 'outer').length;
            
            console.log(`[Letter B] Result structure: ${outers} outer path(s), ${holes} hole(s)`);
            
            // Store result
            this.testData.set(`${testName}-output`, result);
            
            // Display with proper fill rule
            this.rendering.drawPaths(result, 'letter-b-canvas', {
                fillOuter: '#10b981' + '40',
                strokeOuter: '#10b981',
                fillRule: 'evenodd' // Use evenodd for proper hole rendering
            });
            
            // Update view state
            this.ui?.setViewState(testName, true);
            
            // Provide detailed result message
            let statusMessage = `[OK] Letter B: ${strokes.size()} strokes → ${result.size()} path(s), ${holes} hole(s)`;
            if (result.size() !== 1 || holes !== 2) {
                statusMessage = `[WARNING] Letter B: Expected 1 path with 2 holes, got ${result.size()} path(s) with ${holes} hole(s). Try adjusting epsilon.`;
            }
            
            this.ui?.updateResult('letter-b-result', statusMessage);
            
            this.ui?.updateInfo('letter-b-info', this.formatGeometryInfo(result));
            
            return { success: true, output: result.size(), holes: holes };
            
        } catch (error) {
            console.error('[ERROR] Letter B test failed:', error);
            this.ui?.updateResult('letter-b-result', `[ERROR] ${error.message}`, false);
            return { success: false, error: error.message };
        }
    }

    /**
     * Test PCB trace fusion with improved tangency resolution
     */
    async testPCBFusion() {
        const testName = 'pcb-fusion';
        this.rendering.clearCanvas('pcb-fusion-canvas');
        
        try {
            // Log tangency settings
            const tangencySettings = this.operations.getTangencyResolution();
            console.log('[PCB] Tangency settings:', tangencySettings);
            
            // Create PCB components - all normalized to CCW
            const components = new this.core.clipper2.Paths64();
            const traceWidth = 12;
            
            // Create enclosed area by extending traces to form a triangle
            components.push_back(this.geometry.createTrace(50, 200, 350, 200, traceWidth));
            components.push_back(this.geometry.createTrace(150, 100, 150, 300, traceWidth));
            components.push_back(this.geometry.createTrace(250, 100, 350, 300, traceWidth));
            components.push_back(this.geometry.createTrace(150, 100, 250, 100, traceWidth));
            components.push_back(this.geometry.createTrace(150, 300, 350, 300, traceWidth));
            
            // Pads at junctions
            const padPositions = [
                [50, 200, 20], [150, 200, 25], [250, 200, 25], [350, 200, 20],
                [150, 100, 20], [150, 300, 20], [250, 100, 20], [350, 300, 20]
            ];
            
            padPositions.forEach(([x, y, r]) => {
                components.push_back(this.geometry.createPad(x, y, r));
            });
            
            // Store input
            this.testData.set(`${testName}-input`, components);
            const inputCount = components.size();
            
            console.log(`[PCB] Starting fusion of ${inputCount} components`);
            
            // Perform union - tangency resolution happens automatically
            const result = this.operations.unionSelf(components);
            
            // Store result
            this.testData.set(`${testName}-output`, result);
            const mergedCount = result.size();
            
            // Count holes using area analysis
            const resultArray = this.core.pathsToArray(result);
            const holes = resultArray.filter(p => p.orientation === 'hole').length;
            
            console.log(`[PCB] Fusion complete: ${inputCount} → ${mergedCount} region(s), ${holes} hole(s)`);
            
            // Display
            this.rendering.drawPaths(result, 'pcb-fusion-canvas', {
                fillOuter: '#10b981' + '40',
                strokeOuter: '#10b981',
                fillRule: 'evenodd'  // Use evenodd to show holes properly
            });
            
            // Update view state
            this.ui?.setViewState(testName, true);
            
            this.ui?.updateResult('pcb-fusion-result', 
                `[OK] PCB Fusion: ${inputCount} components → ${mergedCount} merged region(s), ${holes} hole(s)`);
            
            this.ui?.updateInfo('pcb-fusion-info', this.formatGeometryInfo(result));
            
            return {
                success: true,
                input: inputCount,
                output: mergedCount,
                holes: holes
            };
            
        } catch (error) {
            console.error('[ERROR] PCB fusion test failed:', error);
            this.ui?.updateResult('pcb-fusion-result', `[ERROR] ${error.message}`, false);
            return { success: false, error: error.message };
        }
    }

    /**
     * Test nested structure with islands-in-holes
     */
    async testNestedStructure() {
        const testName = 'nested';
        this.rendering.clearCanvas('nested-canvas');
        
        try {
            // Get shapes from UI if draggable is enabled
            const uiState = this.ui?.draggableShapes.get(testName);
            
            // Create outer frame with hole - all CCW
            const frameOuter = new this.core.clipper2.Paths64();
            frameOuter.push_back(this.geometry.createRectangle(50, 50, 300, 300));
            
            const frameHole = new this.core.clipper2.Paths64();
            frameHole.push_back(this.geometry.createRectangle(100, 100, 200, 200));
            
            // Create frame with hole using difference
            const frame = this.operations.difference(frameOuter, frameHole);
            
            // Create islands
            const islands = new this.core.clipper2.Paths64();
            
            if (uiState && uiState.shapes) {
                // Add draggable islands
                for (const [key, shape] of Object.entries(uiState.shapes)) {
                    if (key.startsWith('island')) {
                        const islandOuter = new this.core.clipper2.Paths64();
                        islandOuter.push_back(this.geometry.createRectangle(
                            shape.x, shape.y, shape.outerWidth, shape.outerHeight
                        ));
                        
                        const islandHole = new this.core.clipper2.Paths64();
                        islandHole.push_back(this.geometry.createRectangle(
                            shape.innerX, shape.innerY, shape.innerWidth, shape.innerHeight
                        ));
                        
                        const island = this.operations.difference(islandOuter, islandHole);
                        
                        for (let i = 0; i < island.size(); i++) {
                            islands.push_back(island.get(i));
                        }
                    }
                }
            } else {
                // Default islands
                const islandOuter = new this.core.clipper2.Paths64();
                islandOuter.push_back(this.geometry.createRectangle(150, 150, 100, 100));
                
                const islandHole = new this.core.clipper2.Paths64();
                islandHole.push_back(this.geometry.createRectangle(180, 180, 40, 40));
                
                const island = this.operations.difference(islandOuter, islandHole);
                for (let i = 0; i < island.size(); i++) {
                    islands.push_back(island.get(i));
                }
            }
            
            // Store inputs
            this.testData.set(`${testName}-frame`, frame);
            this.testData.set(`${testName}-islands`, islands);
            
            // Union frame and islands - operation handles normalization
            const result = this.operations.union(frame, islands);
            
            // Store result
            this.testData.set(`${testName}-output`, result);
            
            // Count features
            const resultArray = this.core.pathsToArray(result);
            const holes = resultArray.filter(p => p.orientation === 'hole').length;
            
            // Display
            this.rendering.drawPaths(result, 'nested-canvas', {
                fillOuter: '#10b981' + '40',
                strokeOuter: '#10b981',
                fillRule: 'evenodd'
            });
            
            // Update view state
            this.ui?.setViewState(testName, true);
            
            this.ui?.updateResult('nested-result', 
                `[OK] Nested: ${result.size()} path(s), ${holes} hole(s)`);
            
            this.ui?.updateInfo('nested-info', this.formatGeometryInfo(result));
            
            return { success: true, output: result.size(), holes: holes };
            
        } catch (error) {
            console.error('[ERROR] Nested structure test failed:', error);
            this.ui?.updateResult('nested-result', `[ERROR] ${error.message}`, false);
            return { success: false, error: error.message };
        }
    }

    /**
     * Test path simplification
     */
    async testSimplify() {
        const testName = 'simplify';
        this.rendering.clearCanvas('simplify-canvas');
        
        try {
            // Create stable noisy polygon - already CCW
            const path = new this.core.clipper2.Path64();
            const scale = this.core.config.scale;
            const segments = 100;
            const baseRadius = 100;
            const centerX = 200;
            const centerY = 200;
            
            // Create flower-like shape
            for (let i = 0; i <= segments; i++) {
                const angle = (i / segments) * Math.PI * 2;
                const noiseFreq = 5;
                const noise = Math.sin(angle * noiseFreq) * 30;
                const radius = baseRadius + noise;
                const x = centerX + radius * Math.cos(angle);
                const y = centerY + radius * Math.sin(angle);
                
                path.push_back(new this.core.clipper2.Point64(
                    BigInt(Math.round(x * scale)),
                    BigInt(Math.round(y * scale)),
                    BigInt(0)
                ));
            }
            
            // Ensure CCW
            if (this.geometry && this.geometry.ensureCounterClockwise) {
                this.geometry.ensureCounterClockwise(path);
            }
            
            const paths = new this.core.clipper2.Paths64();
            paths.push_back(path);
            
            // Store input
            this.testData.set(`${testName}-input`, paths);
            
            // Get tolerance
            const tolerance = this.ui?.getInputValue('simplify-tolerance', 5) || 5;
            
            // Perform simplification
            const result = this.operations.simplify(paths, tolerance);
            
            // Store result
            this.testData.set(`${testName}-output`, result);
            
            // Count point reduction
            const originalPoints = path.size();
            let simplifiedPoints = 0;
            for (let i = 0; i < result.size(); i++) {
                simplifiedPoints += result.get(i).size();
            }
            
            // Display both input and output
            this.rendering.drawPaths(paths, 'simplify-canvas', {
                fillOuter: '#e5e7eb40',
                strokeOuter: '#9ca3af',
                strokeWidth: 1
            });
            
            this.rendering.drawPaths(result, 'simplify-canvas', {
                fillOuter: '#10b98140',
                strokeOuter: '#10b981',
                strokeWidth: 2,
                clear: false
            });
            
            // Update view state
            this.ui?.setViewState(testName, true);
            
            const reduction = Math.round((1 - simplifiedPoints / originalPoints) * 100);
            this.ui?.updateResult('simplify-result', 
                `[OK] Simplified: ${originalPoints} → ${simplifiedPoints} points (${reduction}% reduction)`);
            
            this.ui?.updateInfo('simplify-info', this.formatGeometryInfo(result));
            
            return { success: true, original: originalPoints, simplified: simplifiedPoints };
            
        } catch (error) {
            console.error('[ERROR] Simplify test failed:', error);
            this.ui?.updateResult('simplify-result', `[ERROR] ${error.message}`, false);
            return { success: false, error: error.message };
        }
    }

    /**
     * Test offset operations with configurable miter limit
     */
    async testOffset() {
        const testName = 'offset';
        this.rendering.clearCanvas('offset-canvas');
        
        try {
            // Get settings
            const shape = this.ui?.getInputValue('offset-shape', 'star') || 'star';
            const offsetType = this.ui?.getInputValue('offset-type', 'external') || 'external';
            const count = parseInt(this.ui?.getInputValue('offset-count', 3) || 3);
            const distance = parseFloat(this.ui?.getInputValue('offset-distance', 10) || 10);
            const joinType = this.ui?.getJoinType('offset-join');
            
            // Get miter limit from UI
            const miterLimit = parseFloat(this.ui?.getInputValue('offset-miter-limit', 10) || 10);
            
            // Create base shape - already CCW
            let basePath;
            switch(shape) {
                case 'circle':
                    basePath = this.geometry.createCircle(200, 200, 80);
                    break;
                case 'square':
                    basePath = this.geometry.createRectangle(120, 120, 160, 160);
                    break;
                case 'star':
                    basePath = this.geometry.createStar(200, 200, 120, 60, 8);
                    break;
                case 'triangle':
                    basePath = this.geometry.createPolygon([
                        [200, 80], [320, 280], [80, 280]
                    ]);
                    break;
                case 'bottleneck':
                    // Hourglass/bottleneck shape - challenging for internal offsets
                    basePath = this.geometry.createPolygon([
                        [120, 120], [280, 120], [220, 200], 
                        [280, 280], [120, 280], [180, 200]
                    ]);
                    break;
                default:
                    basePath = this.geometry.createStar(200, 200, 120, 60, 8);
            }
            
            const paths = new this.core.clipper2.Paths64();
            paths.push_back(basePath);
            
            // Store input
            this.testData.set(`${testName}-input`, paths);
            
            // Draw original shape
            this.rendering.drawPaths(paths, 'offset-canvas', {
                fillOuter: '#3b82f640',
                strokeOuter: '#3b82f6',
                strokeWidth: 2
            });
            
            // Perform offsets with configurable miter limit
            const actualDistance = offsetType === 'internal' ? -Math.abs(distance) : Math.abs(distance);
            const offsetResults = [];
            
            for (let i = 1; i <= count; i++) {
                const delta = actualDistance * i;
                // Note: offset now expects values in original units, not scaled
                const result = this.operations.offset(paths, delta, joinType, null, miterLimit);
                offsetResults.push(result);
                
                // Draw each offset with gradient color
                const hue = (i / count) * 120;
                const alpha = 0.3 + (i / count) * 0.3;
                
                this.rendering.drawPaths(result, 'offset-canvas', {
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
            
            // Update view state
            this.ui?.setViewState(testName, true);
            
            this.ui?.updateResult('offset-result', 
                `[OK] ${offsetType === 'internal' ? 'Internal' : 'External'} offset: ${count} iterations at ${distance}px (miter limit: ${miterLimit})`);
            
            return { success: true, count: count };
            
        } catch (error) {
            console.error('[ERROR] Offset test failed:', error);
            this.ui?.updateResult('offset-result', `[ERROR] ${error.message}`, false);
            return { success: false, error: error.message };
        }
    }

    /**
     * Test point-in-polygon with fixed detection
     */
    async testPointInPolygon() {
        const testName = 'pip';
        
        try {
            // Create test polygon - already CCW
            const polygon = this.geometry.createPolygon([
                [100, 50], [300, 100], [350, 200],
                [250, 350], [50, 300], [50, 150]
            ]);
            
            // Store polygon for click handler
            this.testData.set('pip-polygon', polygon);
            
            // Clear any existing click handler
            const canvas = document.getElementById('pip-canvas');
            const newCanvas = canvas.cloneNode(true);
            canvas.parentNode.replaceChild(newCanvas, canvas);
            
            // Redraw polygon
            const paths = new this.core.clipper2.Paths64();
            paths.push_back(polygon);
            this.rendering.drawPaths(paths, 'pip-canvas', {
                fillOuter: '#3b82f640',
                strokeOuter: '#3b82f6'
            });
            
            // Initialize test points array
            if (!this.testData.has('pip-points')) {
                this.testData.set('pip-points', []);
            }
            
            // Add instructions
            const ctx = newCanvas.getContext('2d');
            ctx.font = '12px Arial';
            ctx.fillStyle = '#6b7280';
            ctx.fillText('Click to add test points, then check their locations', 10, 20);
            
            // Add click handler for adding points
            newCanvas.onclick = (event) => {
                const rect = newCanvas.getBoundingClientRect();
                const x = event.clientX - rect.left;
                const y = event.clientY - rect.top;
                
                // Add point to list
                const points = this.testData.get('pip-points');
                points.push({ x, y, status: 'unchecked' });
                
                // Draw point
                ctx.fillStyle = '#6b7280';
                ctx.beginPath();
                ctx.arc(x, y, 5, 0, Math.PI * 2);
                ctx.fill();
                
                // Update display
                this.ui?.updateResult('pip-result', 
                    `${points.length} point(s) added. Click "Check Locations" to test.`);
            };
            
            this.ui?.updateResult('pip-result', 
                'Click to add test points, then check their locations');
            
            return { success: true };
            
        } catch (error) {
            console.error('[ERROR] Point-in-polygon test failed:', error);
            this.ui?.updateResult('pip-result', `[ERROR] ${error.message}`, false);
            return { success: false, error: error.message };
        }
    }

    /**
     * Check point locations for PIP test with fixed enum mapping
     */
    checkPointLocations() {
        const polygon = this.testData.get('pip-polygon');
        const points = this.testData.get('pip-points');
        
        if (!polygon || !points || points.length === 0) {
            this.ui?.updateResult('pip-result', 'No points to check. Click to add points first.');
            return;
        }
        
        const canvas = document.getElementById('pip-canvas');
        const ctx = canvas.getContext('2d');
        const scale = this.core.config.scale;
        
        // Redraw polygon
        const paths = new this.core.clipper2.Paths64();
        paths.push_back(polygon);
        this.rendering.drawPaths(paths, 'pip-canvas', {
            fillOuter: '#3b82f640',
            strokeOuter: '#3b82f6'
        });
        
        // Add instructions
        ctx.font = '12px Arial';
        ctx.fillStyle = '#6b7280';
        ctx.fillText('Click to add test points, then check their locations', 10, 20);
        
        const results = [];
        const edgeTolerance = 3; // Pixels tolerance for edge detection
        
        // Check each point
        points.forEach(point => {
            // First check exact point
            const testPoint = new this.core.clipper2.Point64(
                BigInt(Math.round(point.x * scale)),
                BigInt(Math.round(point.y * scale)),
                BigInt(0)
            );
            
            const result = this.core.clipper2.PointInPolygon64(testPoint, polygon);
            
            // Check if point is near edge by testing nearby points
            let isNearEdge = false;
            const offsets = [
                [-edgeTolerance, 0], [edgeTolerance, 0],
                [0, -edgeTolerance], [0, edgeTolerance],
                [-edgeTolerance, -edgeTolerance], [edgeTolerance, edgeTolerance],
                [-edgeTolerance, edgeTolerance], [edgeTolerance, -edgeTolerance]
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
                
                // Count results
                const enumValues = this.core.clipper2.PointInPolygonResult;
                if (enumValues) {
                    if (nearResult === enumValues.IsInside || nearResult.value === enumValues.IsInside.value || nearResult === 1) {
                        insideCount++;
                    } else if (nearResult === enumValues.IsOutside || nearResult.value === enumValues.IsOutside.value || nearResult === 2) {
                        outsideCount++;
                    }
                } else {
                    if (nearResult === 1) insideCount++;
                    else if (nearResult === 2) outsideCount++;
                }
            }
            
            // If we have both inside and outside points nearby, we're near the edge
            isNearEdge = insideCount > 0 && outsideCount > 0;
            
            // Debug: log raw result to understand enum mapping
            console.log(`[DEBUG] PIP raw result for (${point.x}, ${point.y}):`, result, 'Near edge:', isNearEdge);
            
            // Determine final status
            let status, color;
            
            if (isNearEdge) {
                status = 'ON EDGE';
                color = '#f59e0b'; // Orange
            } else {
                // Use original result for clear inside/outside
                const enumValues = this.core.clipper2.PointInPolygonResult;
                if (enumValues) {
                    if (result === enumValues.IsInside || result.value === enumValues.IsInside.value || result === 1) {
                        status = 'INSIDE';
                        color = '#10b981'; // Green
                    } else if (result === enumValues.IsOutside || result.value === enumValues.IsOutside.value || result === 2) {
                        status = 'OUTSIDE';
                        color = '#ef4444'; // Red  
                    } else if (result === enumValues.IsOn || result.value === enumValues.IsOn.value || result === 0) {
                        status = 'ON EDGE';
                        color = '#f59e0b'; // Orange
                    } else {
                        // Fallback
                        if (result === 1) {
                            status = 'INSIDE';
                            color = '#10b981';
                        } else if (result === 2) {
                            status = 'OUTSIDE';
                            color = '#ef4444';
                        } else {
                            status = 'ON EDGE';
                            color = '#f59e0b';
                        }
                    }
                } else {
                    // Direct numeric interpretation
                    if (result === 1) {
                        status = 'INSIDE';
                        color = '#10b981';
                    } else if (result === 2) {
                        status = 'OUTSIDE';
                        color = '#ef4444';
                    } else {
                        status = 'ON EDGE';
                        color = '#f59e0b';
                    }
                }
            }
            
            point.status = status;
            
            // Draw point with appropriate color
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.stroke();
            
            results.push(`(${Math.round(point.x)}, ${Math.round(point.y)}): ${status}`);
            
            // Clean up
            testPoint.delete();
        });
        
        // Update display
        this.ui?.updateResult('pip-result', 
            `Checked ${points.length} points:\n${results.join('\n')}\n\nGreen=Inside, Red=Outside, Orange=On Edge\n(Edge detection tolerance: ±${edgeTolerance}px)`);
    }

    /**
     * Test area calculation
     */
    async testArea() {
        const testName = 'area';
        
        try {
            const canvas = document.getElementById('area-canvas');
            if (!canvas) throw new Error('Canvas not found');
            
            const ctx = canvas.getContext('2d');
            const scale = this.core.config.scale;
            
            // Clear canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Draw grid
            ctx.strokeStyle = '#e5e7eb';
            ctx.lineWidth = 1;
            for (let i = 0; i <= 400; i += 20) {
                ctx.beginPath();
                ctx.moveTo(i, 0);
                ctx.lineTo(i, 400);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(0, i);
                ctx.lineTo(400, i);
                ctx.stroke();
            }
            
            // Initialize drawing state
            const points = [];
            let isDrawing = true;
            
            // Remove old listeners
            const newCanvas = canvas.cloneNode(true);
            canvas.parentNode.replaceChild(newCanvas, canvas);
            
            // Add instructions
            const ctx2 = newCanvas.getContext('2d');
            // Redraw grid
            ctx2.strokeStyle = '#e5e7eb';
            ctx2.lineWidth = 1;
            for (let i = 0; i <= 400; i += 20) {
                ctx2.beginPath();
                ctx2.moveTo(i, 0);
                ctx2.lineTo(i, 400);
                ctx2.stroke();
                ctx2.beginPath();
                ctx2.moveTo(0, i);
                ctx2.lineTo(400, i);
                ctx2.stroke();
            }
            
            ctx2.font = '14px Arial';
            ctx2.fillStyle = '#374151';
            ctx2.fillText('Click to add points (min 3 points)', 10, 25);
            
            // Add button for calculating area
            const calculateBtn = document.createElement('button');
            calculateBtn.textContent = 'Calculate Area';
            calculateBtn.className = 'btn btn-primary';
            calculateBtn.style.cssText = 'position: absolute; bottom: 10px; right: 10px;';
            calculateBtn.disabled = true;
            newCanvas.parentNode.style.position = 'relative';
            
            // Remove any existing button first
            const existingBtn = newCanvas.parentNode.querySelector('button');
            if (existingBtn) existingBtn.remove();
            
            newCanvas.parentNode.appendChild(calculateBtn);
            
            // Click handler for adding points
            newCanvas.onclick = (event) => {
                if (!isDrawing) return;
                
                const rect = newCanvas.getBoundingClientRect();
                const x = event.clientX - rect.left;
                const y = event.clientY - rect.top;
                
                points.push({ x, y });
                
                // Draw point
                const ctx = newCanvas.getContext('2d');
                ctx.fillStyle = '#3b82f6';
                ctx.beginPath();
                ctx.arc(x, y, 4, 0, Math.PI * 2);
                ctx.fill();
                
                // Draw line from previous point
                if (points.length > 1) {
                    ctx.strokeStyle = '#3b82f6';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(points[points.length - 2].x, points[points.length - 2].y);
                    ctx.lineTo(x, y);
                    ctx.stroke();
                }
                
                // Enable button when we have enough points
                if (points.length >= 3) {
                    calculateBtn.disabled = false;
                }
                
                // Update display
                document.getElementById('area-result').textContent = 
                    `${points.length} points added. ${points.length >= 3 ? 'Ready to calculate!' : `Need ${3 - points.length} more point(s).`}`;
            };
            
            // Calculate button handler
            calculateBtn.onclick = () => {
                if (points.length < 3) return;
                
                isDrawing = false;
                
                // Close the polygon visually
                const ctx = newCanvas.getContext('2d');
                ctx.strokeStyle = '#3b82f6';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(points[points.length - 1].x, points[points.length - 1].y);
                ctx.lineTo(points[0].x, points[0].y);
                ctx.stroke();
                
                // Create Path64
                const path = new this.core.clipper2.Path64();
                points.forEach(p => {
                    path.push_back(new this.core.clipper2.Point64(
                        BigInt(Math.round(p.x * scale)),
                        BigInt(Math.round(p.y * scale)),
                        BigInt(0)
                    ));
                });
                
                const area = this.core.calculateArea(path);
                const orientation = area > 0 ? 'COUNTER-CLOCKWISE' : 'CLOCKWISE';
                
                // Draw filled polygon
                ctx.fillStyle = area > 0 ? '#3b82f640' : '#ef444440';
                ctx.beginPath();
                points.forEach((p, i) => {
                    if (i === 0) ctx.moveTo(p.x, p.y);
                    else ctx.lineTo(p.x, p.y);
                });
                ctx.closePath();
                ctx.fill();
                
                // Show result
                this.ui?.updateResult('area-result', 
                    `[OK] Area: ${Math.abs(area).toFixed(0)} pixels² | Orientation: ${orientation}`);
                
                // Change button to reset
                calculateBtn.textContent = 'Reset';
                calculateBtn.onclick = () => {
                    calculateBtn.remove();
                    this.testArea();
                };
                
                // Cleanup
                path.delete();
            };
            
            this.ui?.updateResult('area-result', 
                'Click points to draw a polygon. Need at least 3 points.');
            
            return { success: true };
            
        } catch (error) {
            console.error('[ERROR] Area test failed:', error);
            this.ui?.updateResult('area-result', `[ERROR] ${error.message}`, false);
            return { success: false, error: error.message };
        }
    }

    /**
     * Format geometry info for display
     */
    formatGeometryInfo(paths) {
        if (!paths || paths.size() === 0) return 'No paths';
        
        let info = `Total paths: ${paths.size()}\n`;
        
        const pathsArray = this.core.pathsToArray(paths);
        pathsArray.forEach((pathInfo, i) => {
            const area = Math.abs(pathInfo.area).toFixed(0);
            const points = pathInfo.points.length;
            
            info += `Path ${i}: ${points} points, area: ${area}, type: ${pathInfo.orientation}\n`;
            
            // Show first few points
            if (points > 0) {
                info += `  First points: `;
                for (let j = 0; j < Math.min(3, points); j++) {
                    const p = pathInfo.points[j];
                    info += `(${p.x.toFixed(1)},${p.y.toFixed(1)})`;
                    if (j < Math.min(3, points) - 1) info += ' ';
                }
                if (points > 3) info += ' ...';
                info += '\n';
            }
        });
        
        // Add PolyTree info if available
        if (paths._polyTreeInfo) {
            info += '\nPolyTree structure:\n';
            paths._polyTreeInfo.forEach(p => {
                info += `  ${' '.repeat(p.depth * 2)}${p.type} (${p.childCount} children)\n`;
            });
        }
        
        return info;
    }

    /**
     * Export test result as SVG - Fixed for multi-path inputs
     */
    exportSVG(testName) {
        // Check if we're showing output or input
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
            alert('No data to export. Draw or run the test first.');
            return;
        }
        
        // Use fixed export function
        const svg = this.exportPathsAsSVG(dataToExport);
        
        // Create download link
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    /**
     * Export paths as SVG - properly handles multi-path inputs
     */
    exportPathsAsSVG(paths, width = 400, height = 400) {
        if (!paths) return '';
        
        const pathsArray = this.core.pathsToArray(paths);
        
        let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" 
     xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="white"/>
`;
        
        // Check if this is a single merged shape or multiple separate paths
        const isMerged = pathsArray.length > 1 && 
                        pathsArray.some(p => p.orientation === 'hole');
        
        if (isMerged) {
            // Single merged shape with holes - use one path element with evenodd
            svg += '  <g fill="#3b82f640" stroke="#3b82f6" stroke-width="2" fill-rule="evenodd">\n';
            let pathData = '';
            
            pathsArray.forEach(pathInfo => {
                pathData += 'M ';
                pathInfo.points.forEach((point, i) => {
                    if (i === 0) {
                        pathData += `${point.x} ${point.y} `;
                    } else {
                        pathData += `L ${point.x} ${point.y} `;
                    }
                });
                pathData += 'Z ';
            });
            
            svg += `    <path d="${pathData}"/>\n`;
            svg += '  </g>\n';
        } else {
            // Multiple separate paths - render each individually
            svg += '  <g fill="#3b82f640" stroke="#3b82f6" stroke-width="2">\n';
            
            pathsArray.forEach((pathInfo, index) => {
                let pathData = 'M ';
                pathInfo.points.forEach((point, i) => {
                    if (i === 0) {
                        pathData += `${point.x} ${point.y} `;
                    } else {
                        pathData += `L ${point.x} ${point.y} `;
                    }
                });
                pathData += 'Z';
                
                svg += `    <path d="${pathData}"/>\n`;
            });
            
            svg += '  </g>\n';
        }
        
        svg += '</svg>';
        
        return svg;
    }

    /**
     * Reset view to default geometry
     */
    resetView(testName) {
        // Clear test data
        this.testData.delete(`${testName}-output`);
        
        // Reset UI state
        this.ui?.resetView(testName);
    }
}