/**
 * Clipper2 UI Module
 * UI interactions and state management
 * Version 6.1 - Fixed rabbit loading, nested holes, simplify control
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
            
            // Initialize tangency controls
            this.initializeTangencyControls();
            
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
            'simplify', 'pcb-fusion', 'area', 'pip'
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
        
        // Fix simplify control - change from slider to text input
        const simplifyCard = document.querySelector('[data-test="simplify"]');
        if (simplifyCard) {
            const controlDiv = simplifyCard.querySelector('#simplify-tolerance')?.parentElement?.parentElement;
            if (controlDiv) {
                // Replace slider with text input
                controlDiv.innerHTML = `
                    <div class="control">
                        <label for="simplify-tolerance">Tolerance:</label>
                        <input type="number" id="simplify-tolerance" min="0.5" max="50" value="2" step="0.5">
                    </div>
                    <button class="btn btn-primary" onclick="tests.testSimplify()">Simplify Path</button>
                `;
                
                // Add event listener to new input
                const simplifyTolerance = document.getElementById('simplify-tolerance');
                if (simplifyTolerance) {
                    simplifyTolerance.addEventListener('input', (e) => {
                        this.tests.updateTestState('simplify', 'tolerance', parseFloat(e.target.value));
                    });
                }
            }
        }
        
        // Setup draggable shapes
        this.setupDraggableBoolean();
        this.setupDraggableNested();
    }

    /**
     * Initialize tangency epsilon controls
     */
    initializeTangencyControls() {
        const controlsContainer = document.createElement('div');
        controlsContainer.id = 'tangency-controls';
        controlsContainer.className = 'tangency-controls';
        
        controlsContainer.innerHTML = `
            <h4>Tangency Resolution Settings</h4>
            
            <div class="control-group">
                <label>Epsilon (scaled units):</label>
                <div class="control-row">
                    <input type="range" id="tangency-epsilon" 
                           min="1" max="200" value="${this.defaults.tangency.epsilon}">
                    <span id="epsilon-display">${this.defaults.tangency.epsilon} (0.050 units)</span>
                </div>
            </div>
            
            <div class="control-group">
                <label>Resolution Strategy:</label>
                <select id="tangency-strategy">
                    <option value="none" ${this.defaults.tangency.strategy === 'none' ? 'selected' : ''}>Disabled</option>
                    <option value="polygon" ${this.defaults.tangency.strategy === 'polygon' ? 'selected' : ''}>Polygon-level</option>
                </select>
            </div>
            
            <div class="control-group">
                <label>Detection Threshold:</label>
                <div class="control-row">
                    <input type="range" id="tangency-threshold" 
                           min="1" max="50" value="${this.defaults.tangency.threshold}">
                    <span id="threshold-display">${this.defaults.tangency.threshold}</span>
                </div>
            </div>
            
            <button id="apply-tangency-settings" class="btn btn-primary">Apply Settings</button>
            
            <div id="tangency-info" class="tangency-info"></div>
        `;
        
        document.body.appendChild(controlsContainer);
        
        // Add event handlers
        const epsilonSlider = document.getElementById('tangency-epsilon');
        const thresholdSlider = document.getElementById('tangency-threshold');
        const strategySelect = document.getElementById('tangency-strategy');
        const applyButton = document.getElementById('apply-tangency-settings');
        
        epsilonSlider.addEventListener('input', (e) => {
            const scaled = parseInt(e.target.value);
            const original = scaled / this.tests.core.config.scale;
            document.getElementById('epsilon-display').textContent = 
                `${scaled} (${original.toFixed(3)} units)`;
            
            const info = document.getElementById('tangency-info');
            if (scaled < 10) {
                info.textContent = '⚠️ Too small - may fail to resolve tangencies';
                info.className = 'tangency-info warning';
            } else if (scaled > 100) {
                info.textContent = '⚠️ Large value - may cause visible distortion';
                info.className = 'tangency-info warning';
            } else {
                info.textContent = '✓ Recommended range for most geometries';
                info.className = 'tangency-info success';
            }
        });
        
        thresholdSlider.addEventListener('input', (e) => {
            document.getElementById('threshold-display').textContent = e.target.value;
        });
        
        applyButton.addEventListener('click', () => {
            const epsilon = parseInt(epsilonSlider.value);
            const threshold = parseInt(thresholdSlider.value);
            const strategy = strategySelect.value;
            
            this.tests.operations.setTangencyResolution({
                minOffset: -epsilon,
                maxOffset: epsilon,
                threshold: threshold,
                strategy: strategy,
                enabled: strategy !== 'none'
            });
            
            const info = document.getElementById('tangency-info');
            info.textContent = `✓ Settings applied`;
            info.className = 'tangency-info success';
            
            setTimeout(() => {
                info.textContent = '';
                info.className = 'tangency-info';
            }, 3000);
            
            console.log(`[UI] Tangency settings updated`);
        });
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
        const simplifyDef = this.defaults.geometries.simplify;
        const coords = this.defaults.generators.flower(
            simplifyDef.center[0], simplifyDef.center[1],
            simplifyDef.baseRadius, simplifyDef.noiseFrequency,
            simplifyDef.noiseAmplitude, simplifyDef.segments
        );
        this.tests.rendering.drawSimplePaths([coords], 'simplify-canvas', this.defaults.styles.default);
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
            case 'pip': this.drawDefaultPIP(); break;
            case 'area':
                const areaCanvas = document.getElementById('area-canvas');
                if (areaCanvas) {
                    const btn = areaCanvas.parentNode.querySelector('button');
                    if (btn) btn.remove();
                    this.tests.testArea();
                }
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