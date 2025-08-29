/**
 * Clipper2 UI Module
 * UI interactions and state management
 * Version 6.4 - Fixed PIP, removed tangency controls
 */

class Clipper2UI {
    constructor(tests) {
        this.tests = tests;
        this.viewStates = new Map();
        this.initialized = false;
        this.defaults = Clipper2Defaults;
    }

    /**
     * Initialize UI system
     */
    async initialize() {
        if (this.initialized) return;
        
        try {
            // Set up test reference
            this.tests.ui = this;
            
            // Initialize view states
            this.initializeViewStates();
            
            // Initialize event handlers
            this.initializeEventHandlers();
            
            // Draw all default shapes
            this.drawAllDefaults();
            
            // Hide loading screen
            this.hideLoading();
            
            this.initialized = true;
            console.log('[UI] UI system initialized');
            
        } catch (error) {
            console.error('[ERROR] UI initialization failed:', error);
            this.showError('Failed to initialize UI system');
        }
    }

    /**
     * Initialize view states
     */
    initializeViewStates() {
        const testNames = [
            'boolean', 'letter-b', 'nested', 'offset',
            'simplify', 'pcb-fusion', 'area', 'pip', 'minkowski'
        ];
        
        testNames.forEach(name => {
            this.viewStates.set(name, false);
        });
    }

    /**
     * Initialize event handlers for all controls
     */
    initializeEventHandlers() {
        // Boolean test controls
        const booleanOp = document.getElementById('boolean-operation');
        if (booleanOp) {
            booleanOp.addEventListener('change', (e) => {
                this.tests.updateTestState('boolean', 'operation', e.target.value);
                this.updateResult('boolean-result', 'Operation changed - click "Run Operation" to see result');
            });
        }
        
        const booleanClip = document.getElementById('boolean-clip-shape');
        if (booleanClip) {
            booleanClip.addEventListener('change', (e) => {
                this.tests.updateTestState('boolean', 'clipShape', e.target.value);
                this.onShapeChange('boolean-clip-shape');
            });
        }
        
        // Offset test controls
        const offsetShape = document.getElementById('offset-shape');
        if (offsetShape) {
            offsetShape.addEventListener('change', (e) => {
                this.tests.updateTestState('offset', 'shape', e.target.value);
                this.onShapeChange('offset-shape');
            });
        }
        
        const offsetType = document.getElementById('offset-type');
        if (offsetType) {
            offsetType.addEventListener('change', (e) => {
                this.tests.updateTestState('offset', 'type', e.target.value);
                this.onOffsetTypeChange();
            });
        }
        
        const offsetCount = document.getElementById('offset-count');
        if (offsetCount) {
            offsetCount.addEventListener('input', (e) => {
                this.tests.updateTestState('offset', 'count', parseInt(e.target.value));
            });
        }
        
        const offsetDistance = document.getElementById('offset-distance');
        if (offsetDistance) {
            offsetDistance.addEventListener('input', (e) => {
                this.tests.updateTestState('offset', 'distance', parseFloat(e.target.value));
            });
        }
        
        const offsetJoin = document.getElementById('offset-join');
        if (offsetJoin) {
            offsetJoin.addEventListener('change', (e) => {
                this.tests.updateTestState('offset', 'joinType', e.target.value);
            });
        }
        
        const offsetMiter = document.getElementById('offset-miter-limit');
        if (offsetMiter) {
            offsetMiter.addEventListener('input', (e) => {
                this.tests.updateTestState('offset', 'miterLimit', parseFloat(e.target.value));
            });
        }
        
        // Simplify tolerance control
        const simplifyTolerance = document.getElementById('simplify-tolerance');
        if (simplifyTolerance) {
            simplifyTolerance.addEventListener('input', (e) => {
                this.tests.updateTestState('simplify', 'tolerance', parseFloat(e.target.value));
                const value = e.target.value;
                // Update display if there's a value indicator
                const valueDisplay = document.getElementById('simplify-tolerance-value');
                if (valueDisplay) {
                    valueDisplay.textContent = value;
                }
            });
        }
        
        // Minkowski test controls
        const minkowskiPattern = document.getElementById('minkowski-pattern');
        if (minkowskiPattern) {
            minkowskiPattern.addEventListener('change', (e) => {
                this.tests.updateTestState('minkowski', 'pattern', e.target.value);
                this.drawDefaultMinkowski();
                this.updateResult('minkowski-result', 'Pattern changed - click "Run Operation" to see result');
            });
        }
        
        const minkowskiPath = document.getElementById('minkowski-path');
        if (minkowskiPath) {
            minkowskiPath.addEventListener('change', (e) => {
                this.tests.updateTestState('minkowski', 'path', e.target.value);
                this.drawDefaultMinkowski();
                this.updateResult('minkowski-result', 'Path changed - click "Run Operation" to see result');
            });
        }
        
        const minkowskiOp = document.getElementById('minkowski-operation');
        if (minkowskiOp) {
            minkowskiOp.addEventListener('change', (e) => {
                this.tests.updateTestState('minkowski', 'operation', e.target.value);
                this.updateResult('minkowski-result', 'Operation changed - click "Run Operation" to see result');
            });
        }
        
        const minkowskiClosed = document.getElementById('minkowski-closed');
        if (minkowskiClosed) {
            minkowskiClosed.addEventListener('change', (e) => {
                this.tests.updateTestState('minkowski', 'pathClosed', e.target.checked);
                this.updateResult('minkowski-result', 'Path closed setting changed - click "Run Operation" to see result');
            });
        }
        
        // PIP test controls
        const pipTolerance = document.getElementById('pip-tolerance');
        if (pipTolerance) {
            pipTolerance.addEventListener('input', (e) => {
                this.tests.updateTestState('pip', 'edgeTolerance', parseFloat(e.target.value));
                this.updateResult('pip-result', `Edge tolerance updated to ${e.target.value}px`);
            });
        }
        
        // Setup draggable shapes
        this.setupDraggableBoolean();
        this.setupDraggableNested();
        
        // Setup PIP canvas immediately
        this.setupPIPCanvas();
    }

    /**
     * Setup PIP canvas click handler immediately - FIXED
     */
    setupPIPCanvas() {
        const canvas = document.getElementById('pip-canvas');
        if (!canvas) return;
        
        canvas.onclick = (event) => {
            const polygon = this.tests.testData.get('pip-polygon');
            
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const x = (event.clientX - rect.left) * scaleX;
            const y = (event.clientY - rect.top) * scaleY;
            
            this.tests.testState.pip.points.push({ x, y, status: 'unchecked' });
            
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = getComputedStyle(document.documentElement)
                .getPropertyValue('--input-stroke');
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fill();
            
            if (!polygon) {
                this.updateResult('pip-result', 
                    `${this.tests.testState.pip.points.length} point(s) added. Run test first, then click "Check Locations".`);
            } else {
                this.updateResult('pip-result', 
                    `${this.tests.testState.pip.points.length} point(s) added. Click "Check Locations" to test.`);
            }
        };
    }

    /**
     * Setup draggable shapes for boolean operations
     */
    setupDraggableBoolean() {
        const canvas = document.getElementById('boolean-canvas');
        if (!canvas) return;
        
        canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e, 'boolean'));
        canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e, 'boolean'));
        canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e, 'boolean'));
        canvas.addEventListener('mouseleave', (e) => this.handleMouseUp(e, 'boolean'));
        
        // Touch support
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            const mouseEvent = new MouseEvent('mousedown', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            canvas.dispatchEvent(mouseEvent);
        }, { passive: false });
        
        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousemove', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            canvas.dispatchEvent(mouseEvent);
        }, { passive: false });
        
        canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            canvas.dispatchEvent(new MouseEvent('mouseup', {}));
        }, { passive: false });
    }

    /**
     * Setup draggable islands for nested test
     */
    setupDraggableNested() {
        const canvas = document.getElementById('nested-canvas');
        if (!canvas) return;
        
        canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e, 'nested'));
        canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e, 'nested'));
        canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e, 'nested'));
        canvas.addEventListener('mouseleave', (e) => this.handleMouseUp(e, 'nested'));
    }

    /**
     * Mouse down handler
     */
    handleMouseDown(event, testName) {
        const rect = event.target.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        const state = this.tests.getTestState(testName);
        
        if (testName === 'boolean') {
            // Only drag the clip shape (subject is fixed)
            const clipRadius = 90; // Approximate radius for hit detection
            if (Math.sqrt(Math.pow(x - state.clipPos.x, 2) + 
                         Math.pow(y - state.clipPos.y, 2)) <= clipRadius) {
                this.dragInfo = {
                    isDragging: true,
                    shape: 'clip',
                    offset: { x: x - state.clipPos.x, y: y - state.clipPos.y }
                };
            }
        } else if (testName === 'nested') {
            // Check islands
            const island1 = state.island1Pos;
            const island2 = state.island2Pos;
            
            if (x >= island1.x && x <= island1.x + 100 &&
                y >= island1.y && y <= island1.y + 100) {
                this.dragInfo = {
                    isDragging: true,
                    shape: 'island1',
                    offset: { x: x - island1.x, y: y - island1.y }
                };
            } else if (x >= island2.x && x <= island2.x + 80 &&
                       y >= island2.y && y <= island2.y + 80) {
                this.dragInfo = {
                    isDragging: true,
                    shape: 'island2',
                    offset: { x: x - island2.x, y: y - island2.y }
                };
            }
        }
        
        if (this.dragInfo?.isDragging) {
            event.target.style.cursor = 'grabbing';
        }
    }

    /**
     * Mouse move handler
     */
    handleMouseMove(event, testName) {
        const rect = event.target.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        if (!this.dragInfo?.isDragging) {
            // Update hover cursor
            const state = this.tests.getTestState(testName);
            let hovering = false;
            
            if (testName === 'boolean') {
                // Only check clip shape (subject is fixed)
                if (Math.sqrt(Math.pow(x - state.clipPos.x, 2) + 
                             Math.pow(y - state.clipPos.y, 2)) <= 90) {
                    hovering = true;
                }
            }
            
            event.target.style.cursor = hovering ? 'grab' : 'default';
            return;
        }
        
        // Handle dragging
        const newX = Math.max(20, Math.min(380, x - this.dragInfo.offset.x));
        const newY = Math.max(20, Math.min(380, y - this.dragInfo.offset.y));
        
        if (testName === 'boolean') {
            if (this.dragInfo.shape === 'clip') {
                this.tests.updateTestState('boolean', 'clipPos', { x: newX, y: newY });
            }
        } else if (testName === 'nested') {
            if (this.dragInfo.shape === 'island1') {
                this.tests.updateTestState('nested', 'island1Pos', { x: newX, y: newY });
            } else if (this.dragInfo.shape === 'island2') {
                this.tests.updateTestState('nested', 'island2Pos', { x: newX, y: newY });
            }
        }
        
        this.redrawDraggableCanvas(testName);
    }

    /**
     * Mouse up handler
     */
    handleMouseUp(event, testName) {
        if (this.dragInfo?.isDragging) {
            this.dragInfo = null;
            event.target.style.cursor = 'default';
            
            const resultElement = document.getElementById(`${testName}-result`);
            if (resultElement) {
                resultElement.textContent = 'Shapes moved - click "Run Operation" to see result';
            }
        }
    }

    /**
     * Redraw draggable canvas
     */
    redrawDraggableCanvas(testName) {
        const canvas = document.getElementById(`${testName}-canvas`);
        if (!canvas) return;
        
        const state = this.tests.getTestState(testName);
        
        if (testName === 'nested') {
            // Create proper nested structure with holes
            const nestedDef = this.defaults.geometries.nested;
            
            // Clear canvas
            this.tests.rendering.clearCanvas(canvas);
            const ctx = canvas.getContext('2d');
            
            // Draw main frame with hole
            ctx.fillStyle = this.tests.rendering.resolveStyleValue('var(--shape-fill)');
            ctx.strokeStyle = this.tests.rendering.resolveStyleValue('var(--shape-stroke)');
            ctx.lineWidth = 2;
            
            // Use even-odd fill rule for proper holes
            ctx.beginPath();
            // Outer frame
            ctx.rect(50, 50, 300, 300);
            // Inner hole (drawn in opposite direction)
            ctx.rect(100, 100, 200, 200);
            ctx.fill('evenodd');
            ctx.stroke();
            
            // Draw islands with holes
            // Island 1
            ctx.fillStyle = 'rgba(16, 185, 129, 0.4)';
            ctx.strokeStyle = '#10b981';
            ctx.beginPath();
            // Outer
            ctx.rect(state.island1Pos.x, state.island1Pos.y, 100, 100);
            // Inner hole
            ctx.rect(state.island1Pos.x + 30, state.island1Pos.y + 30, 40, 40);
            ctx.fill('evenodd');
            ctx.stroke();
            
            // Island 2
            ctx.fillStyle = 'rgba(245, 158, 11, 0.4)';
            ctx.strokeStyle = '#f59e0b';
            ctx.beginPath();
            // Outer
            ctx.rect(state.island2Pos.x, state.island2Pos.y, 80, 80);
            // Inner hole
            ctx.rect(state.island2Pos.x + 20, state.island2Pos.y + 20, 40, 40);
            ctx.fill('evenodd');
            ctx.stroke();
            
            ctx.font = '12px Arial';
            ctx.fillStyle = '#6b7280';
            ctx.textAlign = 'center';
            ctx.fillText('Drag smaller frames to position', 200, 380);
            
        } else if (testName === 'boolean') {
            const shapes = {};
            
            // Subject is fixed at center   
            shapes.subject = {
                type: 'rect',
                x: state.subjectPos.x - 100,
                y: state.subjectPos.y - 100,
                width: 200,
                height: 200,
                color: 'var(--subject-stroke)'
            };
            
            const clipShape = state.clipShape;
            
            if (clipShape === 'circle') {
                shapes.clip = {
                    type: 'circle',
                    x: state.clipPos.x,
                    y: state.clipPos.y,
                    radius: 80,
                    color: 'var(--clip-stroke)'
                };
            } else if (clipShape === 'rabbit' && state.rabbitPath) {
                // Draw rabbit shape
                const coords = state.rabbitPath.map(pt => [
                    pt[0] + state.clipPos.x,
                    pt[1] + state.clipPos.y
                ]);
                shapes.clip = {
                    type: 'polygon',
                    coords: coords,
                    color: 'var(--clip-stroke)'
                };
            } else {
                const clipDef = this.defaults.geometries.boolean.clips[clipShape];
                let coords;
                
                if (clipShape === 'triangle') {
                    coords = clipDef.data.map(pt => [pt[0] + state.clipPos.x, pt[1] + state.clipPos.y]);
                } else if (clipShape === 'square') {
                    coords = clipDef.data.map(pt => [pt[0] + state.clipPos.x, pt[1] + state.clipPos.y]);
                } else if (clipShape === 'star') {
                    coords = this.defaults.generators.star(
                        state.clipPos.x, state.clipPos.y, 80, 40, 5
                    );
                } else if (clipShape === 'random' && state.randomShape) {
                    coords = state.randomShape.map(pt => [pt[0] + state.clipPos.x, pt[1] + state.clipPos.y]);
                }
                
                if (coords) {
                    shapes.clip = {
                        type: 'polygon',
                        coords: coords,
                        color: 'var(--clip-stroke)'
                    };
                }
            }
            
            this.tests.rendering.drawShapePreview(shapes, canvas);
            
            const ctx = canvas.getContext('2d');
            ctx.font = '12px Arial';
            ctx.fillStyle = '#6b7280';
            ctx.textAlign = 'center';
            ctx.fillText('Drag red shape to position', 200, 380);
        }
    }

    /**
     * Draw all default shapes
     */
    drawAllDefaults() {
        this.drawDefaultBoolean();
        this.drawDefaultLetterB();
        this.drawDefaultNested();
        this.drawDefaultOffset();
        this.drawDefaultSimplify();
        this.drawDefaultPCB();
        this.drawDefaultPIP();
        this.drawDefaultMinkowski();
        // Initialize area test to be interactive
        this.tests.testArea();
    }

    drawDefaultBoolean() {
        this.redrawDraggableCanvas('boolean');
    }

    drawDefaultLetterB() {
        const letterBDef = this.defaults.geometries.letterB;
        this.tests.rendering.drawStrokes(letterBDef, 'letter-b-canvas', {
            style: this.defaults.styles.default
        });
    }

    drawDefaultNested() {
        this.redrawDraggableCanvas('nested');
    }

    drawDefaultOffset() {
        const state = this.tests.getTestState('offset');
        const shapeDef = this.defaults.geometries.offset.shapes[state.shape];
        
        let coords;
        if (shapeDef.type === 'parametric') {
            if (shapeDef.shape === 'star') {
                coords = this.defaults.generators.star(
                    shapeDef.center[0], shapeDef.center[1],
                    shapeDef.outerRadius, shapeDef.innerRadius, shapeDef.points
                );
            } else if (shapeDef.shape === 'circle') {
                coords = this.defaults.generators.circle(
                    shapeDef.center[0], shapeDef.center[1], shapeDef.radius
                );
            }
        } else if (shapeDef.type === 'polygon') {
            coords = shapeDef.data;
        }
        
        if (coords) {
            this.tests.rendering.drawSimplePaths([coords], 'offset-canvas', this.defaults.styles.default);
        }
    }

    drawDefaultSimplify() {
        // Draw rabbit shape as the default for simplify test
        const rabbitPath = this.tests.testState.boolean.rabbitPath;
        if (rabbitPath && rabbitPath.length > 0) {
            // Use the pre-loaded rabbit path, centered at canvas center
            const coords = rabbitPath.map(pt => [
                pt[0] + 200,  // Center at canvas center
                pt[1] + 200
            ]);
            this.tests.rendering.drawSimplePaths([coords], 'simplify-canvas', this.defaults.styles.default);
        } else {
            // Fallback to flower if rabbit not loaded
            const simplifyDef = this.defaults.geometries.simplify;
            const coords = this.defaults.generators.flower(
                simplifyDef.center[0], simplifyDef.center[1],
                simplifyDef.baseRadius, simplifyDef.noiseFrequency,
                simplifyDef.noiseAmplitude, simplifyDef.segments
            );
            this.tests.rendering.drawSimplePaths([coords], 'simplify-canvas', this.defaults.styles.default);
        }
    }

    drawDefaultPCB() {
        const pcbDef = this.defaults.geometries.pcbFusion;
        this.tests.rendering.drawStrokes(pcbDef, 'pcb-fusion-canvas', {
            style: this.defaults.styles.pcb
        });
    }

    drawDefaultPIP() {
        const pipDef = this.defaults.geometries.pip;
        this.tests.rendering.drawSimplePaths([pipDef.data], 'pip-canvas', this.defaults.styles.default);
    }

    drawDefaultMinkowski() {
        const state = this.tests.getTestState('minkowski');
        const patternDef = this.defaults.geometries.minkowski.patterns[state.pattern];
        const pathDef = this.defaults.geometries.minkowski.paths[state.path];
        
        this.tests.rendering.clearCanvas('minkowski-canvas');
        
        // Draw path
        if (pathDef.type === 'polygon' || pathDef.type === 'polyline') {
            this.tests.rendering.drawSimplePaths([pathDef.data], 'minkowski-canvas', {
                ...this.defaults.styles.default,
                clear: false
            });
        }
        
        // Draw pattern reference at corner
        let patternCoords;
        if (patternDef.type === 'parametric' && patternDef.shape === 'circle') {
            patternCoords = this.defaults.generators.circle(30, 30, patternDef.radius);
        } else if (patternDef.type === 'polygon') {
            patternCoords = patternDef.data.map(pt => [pt[0] + 30, pt[1] + 30]);
        }
        
        if (patternCoords) {
            this.tests.rendering.drawSimplePaths([patternCoords], 'minkowski-canvas', {
                fillOuter: 'rgba(255, 0, 0, 0.3)',
                strokeOuter: '#ff0000',
                strokeWidth: 1,
                clear: false
            });
        }
        
        // Add label
        const canvas = document.getElementById('minkowski-canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.font = '10px Arial';
            ctx.fillStyle = '#ff0000';
            ctx.fillText('Pattern', 30, 60);
        }
    }

    /**
     * Shape change handler
     */
    onShapeChange(selectId) {
        const testName = selectId.includes('offset') ? 'offset' : 'boolean';
        
        if (testName === 'offset') {
            this.drawDefaultOffset();
        } else if (testName === 'boolean') {
            const state = this.tests.getTestState('boolean');
            if (state.clipShape === 'random') {
                const randomDef = this.defaults.geometries.boolean.clips.random;
                const randomShape = this.defaults.generators.randomConvex(
                    0, 0, randomDef.avgRadius, randomDef.variance, randomDef.points
                );
                this.tests.updateTestState('boolean', 'randomShape', randomShape);
            } else if (state.clipShape === 'rabbit') {
                // Rabbit path is already pre-parsed in tests initialization
                // Just redraw
            } else {
                this.tests.updateTestState('boolean', 'randomShape', null);
            }
            this.redrawDraggableCanvas('boolean');
        }
        
        const resultElement = document.getElementById(`${testName}-result`);
        if (resultElement) {
            resultElement.textContent = 'Shape changed - click "Run Operation" to see result';
        }
    }

    onOffsetTypeChange() {
        const resultElement = document.getElementById('offset-result');
        if (resultElement) {
            resultElement.textContent = 'Settings changed - click "Apply Offset" to see result';
        }
    }

    /**
     * Reset view to default
     */
    resetView(testName) {
        this.viewStates.set(testName, false);
        
        const resultElement = document.getElementById(`${testName}-result`);
        if (resultElement) {
            resultElement.textContent = this.defaults.labels.ready;
        }
        
        const infoElement = document.getElementById(`${testName}-info`);
        if (infoElement) {
            infoElement.textContent = '';
        }
        
        // Set card status
        const card = document.querySelector(`[data-test="${testName}"]`);
        if (card) {
            card.dataset.status = '';
        }
        
        // Redraw defaults
        switch(testName) {
            case 'boolean': 
                // Reset clip position when resetting
                this.tests.testState.boolean.clipPos = { x: 100, y: 100 };
                this.drawDefaultBoolean(); 
                break;
            case 'letter-b': this.drawDefaultLetterB(); break;
            case 'nested': this.drawDefaultNested(); break;
            case 'offset': this.drawDefaultOffset(); break;
            case 'simplify': this.drawDefaultSimplify(); break;
            case 'pcb-fusion': this.drawDefaultPCB(); break;
            case 'pip': 
                this.tests.testState.pip.points = [];
                this.drawDefaultPIP(); 
                break;
            case 'area':
                const areaCanvas = document.getElementById('area-canvas');
                if (areaCanvas) {
                    // Remove old buttons properly
                    const calculateBtn = document.getElementById('area-calculate');
                    const resetBtn = document.getElementById('area-reset');
                    if (calculateBtn) calculateBtn.remove();
                    if (resetBtn) resetBtn.remove();
                    
                    this.tests.testArea();
                }
                break;
            case 'minkowski':
                // Reset minkowski controls to defaults
                const patternSelect = document.getElementById('minkowski-pattern');
                const pathSelect = document.getElementById('minkowski-path');
                const opSelect = document.getElementById('minkowski-operation');
                const closedCheck = document.getElementById('minkowski-closed');
                
                if (patternSelect) patternSelect.value = this.defaults.geometries.minkowski.defaults.pattern;
                if (pathSelect) pathSelect.value = this.defaults.geometries.minkowski.defaults.path;
                if (opSelect) opSelect.value = this.defaults.geometries.minkowski.defaults.operation;
                if (closedCheck) closedCheck.checked = this.defaults.geometries.minkowski.defaults.pathClosed;
                
                this.drawDefaultMinkowski();
                break;
        }
        
        const label = document.getElementById(`${testName}-label`);
        if (label) label.textContent = this.defaults.labels.inputGeometry;
    }

    // Utility methods
    hideLoading() {
        const loading = document.getElementById('loading');
        if (loading) loading.classList.remove('active');
    }

    showError(message) {
        const loading = document.getElementById('loading');
        if (loading) {
            loading.innerHTML = `
                <div style="color: #ef4444; text-align: center; padding: 2rem;">
                    <h2>⚠️ Error</h2>
                    <p>${message}</p>
                    <button onclick="location.reload()" class="btn btn-primary">
                        Reload Page
                    </button>
                </div>
            `;
            loading.classList.add('active');
        }
    }

    getViewState(testName) {
        return this.viewStates.get(testName) || false;
    }

    setViewState(testName, isShowingOutput) {
        this.viewStates.set(testName, isShowingOutput);
    }

    updateResult(elementId, message, isSuccess = true) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = message;
            
            // Update card status based on result
            const testName = elementId.replace('-result', '');
            const card = document.querySelector(`[data-test="${testName}"]`);
            if (card) {
                if (message.includes('[OK]')) {
                    card.dataset.status = 'success';
                } else if (message.includes('[ERROR]')) {
                    card.dataset.status = 'error';
                } else if (message.includes('[WARNING]') || message.includes('changed')) {
                    card.dataset.status = 'pending';
                }
            }
        }
    }

    updateInfo(elementId, info) {
        const element = document.getElementById(elementId);
        if (element) element.textContent = info;
    }

    setLabel(elementId, text) {
        const element = document.getElementById(elementId);
        if (element) element.textContent = text;
    }
}