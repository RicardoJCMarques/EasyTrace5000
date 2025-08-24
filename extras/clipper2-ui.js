/**
 * Clipper2 UI Module
 * Handles all UI interactions, event handlers, and view state management
 * Version 3.8 - Added tangency epsilon controls for testing
 */

class Clipper2UI {
    constructor(tests) {
        this.tests = tests;
        this.viewStates = new Map();
        this.defaultShapes = new Map();
        this.draggableShapes = new Map();
        this.initialized = false;
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
            
            // Initialize draggable shapes BEFORE drawing defaults
            this.initializeDraggableShapes();
            
            // Initialize tangency controls
            this.initializeTangencyControls();
            
            // Draw all default shapes AFTER draggable setup
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
     * Initialize tangency epsilon controls for interactive testing
     */
    initializeTangencyControls() {
        // Create control container if it doesn't exist
        const controlsContainer = document.createElement('div');
        controlsContainer.id = 'tangency-controls';
        controlsContainer.className = 'tangency-controls';
        controlsContainer.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: white;
            border: 2px solid #e5e7eb;
            border-radius: 8px;
            padding: 15px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            z-index: 1000;
            min-width: 280px;
        `;
        
        controlsContainer.innerHTML = `
            <h4 style="margin: 0 0 10px 0; color: #111827; font-size: 14px; font-weight: 600;">
                Tangency Resolution Settings
            </h4>
            
            <div class="control-group" style="margin-bottom: 12px;">
                <label style="display: block; font-size: 12px; color: #6b7280; margin-bottom: 4px;">
                    Epsilon (scaled units):
                </label>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <input type="range" id="tangency-epsilon" 
                           min="1" max="200" value="50" 
                           style="flex: 1;">
                    <span id="epsilon-display" 
                          style="min-width: 120px; font-size: 12px; font-family: monospace; color: #111827;">
                        50 (0.050 units)
                    </span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 10px; color: #9ca3af; margin-top: 2px;">
                    <span>1</span>
                    <span>100</span>
                    <span>200</span>
                </div>
            </div>
            
            <div class="control-group" style="margin-bottom: 12px;">
                <label style="display: block; font-size: 12px; color: #6b7280; margin-bottom: 4px;">
                    Resolution Strategy:
                </label>
                <select id="tangency-strategy" 
                        style="width: 100%; padding: 4px 8px; border: 1px solid #e5e7eb; border-radius: 4px; font-size: 12px;">
                    <option value="polygon">Polygon-level (current)</option>
                    <option value="none">Disabled</option>
                </select>
            </div>
            
            <div class="control-group" style="margin-bottom: 12px;">
                <label style="display: block; font-size: 12px; color: #6b7280; margin-bottom: 4px;">
                    Detection Threshold:
                </label>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <input type="range" id="tangency-threshold" 
                           min="1" max="50" value="10" 
                           style="flex: 1;">
                    <span id="threshold-display" 
                          style="min-width: 60px; font-size: 12px; font-family: monospace; color: #111827;">
                        10
                    </span>
                </div>
            </div>
            
            <div style="border-top: 1px solid #e5e7eb; margin-top: 12px; padding-top: 12px;">
                <button id="apply-tangency-settings" 
                        style="width: 100%; padding: 6px 12px; background: #3b82f6; color: white; border: none; border-radius: 4px; font-size: 12px; font-weight: 500; cursor: pointer;">
                    Apply Settings
                </button>
            </div>
            
            <div id="tangency-info" 
                 style="margin-top: 8px; padding: 8px; background: #f9fafb; border-radius: 4px; font-size: 11px; color: #6b7280; display: none;">
            </div>
        `;
        
        document.body.appendChild(controlsContainer);
        
        // Add event handlers
        const epsilonSlider = document.getElementById('tangency-epsilon');
        const thresholdSlider = document.getElementById('tangency-threshold');
        const strategySelect = document.getElementById('tangency-strategy');
        const applyButton = document.getElementById('apply-tangency-settings');
        
        // Epsilon slider handler
        epsilonSlider.addEventListener('input', (e) => {
            const scaled = parseInt(e.target.value);
            const original = scaled / this.tests.core.config.scale;
            document.getElementById('epsilon-display').textContent = 
                `${scaled} (${original.toFixed(3)} units)`;
            
            // Show recommendation based on value
            const info = document.getElementById('tangency-info');
            if (scaled < 10) {
                info.textContent = '⚠️ Too small - may fail to resolve tangencies';
                info.style.display = 'block';
                info.style.background = '#fef2f2';
                info.style.color = '#991b1b';
            } else if (scaled > 100) {
                info.textContent = '⚠️ Large value - may cause visible distortion';
                info.style.display = 'block';
                info.style.background = '#fef3c7';
                info.style.color = '#92400e';
            } else {
                info.textContent = '✓ Recommended range for most geometries';
                info.style.display = 'block';
                info.style.background = '#ecfdf5';
                info.style.color = '#065f46';
            }
        });
        
        // Threshold slider handler
        thresholdSlider.addEventListener('input', (e) => {
            document.getElementById('threshold-display').textContent = e.target.value;
        });
        
        // Apply button handler
        applyButton.addEventListener('click', () => {
            const epsilon = parseInt(epsilonSlider.value);
            const threshold = parseInt(thresholdSlider.value);
            const strategy = strategySelect.value;
            
            // Update operations module
            this.tests.operations.setTangencyResolution({
                minOffset: -epsilon,
                maxOffset: epsilon,
                threshold: threshold,
                strategy: strategy,
                enabled: strategy !== 'none'
            });
            
            // Show confirmation
            const info = document.getElementById('tangency-info');
            info.textContent = `✓ Settings applied - epsilon: ${epsilon}, threshold: ${threshold}, strategy: ${strategy}`;
            info.style.display = 'block';
            info.style.background = '#ecfdf5';
            info.style.color = '#065f46';
            
            setTimeout(() => {
                info.style.display = 'none';
            }, 3000);
            
            console.log(`[UI] Tangency settings updated - epsilon: ${epsilon}, threshold: ${threshold}, strategy: ${strategy}`);
        });
        
        // Initialize with current values
        if (this.tests?.operations) {
            const current = this.tests.operations.getTangencyResolution();
            epsilonSlider.value = Math.abs(current.maxOffset);
            thresholdSlider.value = current.threshold;
            strategySelect.value = current.strategy || 'polygon';
            
            // Trigger input event to update display
            epsilonSlider.dispatchEvent(new Event('input'));
            thresholdSlider.dispatchEvent(new Event('input'));
        }
    }

    /**
     * Initialize view states for all tests
     */
    initializeViewStates() {
        const testNames = [
            'boolean', 'letter-b', 'nested', 'offset',
            'simplify', 'pcb-fusion', 'area', 'pip'
        ];
        
        testNames.forEach(name => {
            this.viewStates.set(name, false); // false = showing input
        });
    }

    /**
     * Initialize draggable shapes for interactive tests
     */
    initializeDraggableShapes() {
        // Initialize draggable shapes for consolidated boolean operation
        this.setupDraggableBoolean();
        
        // Initialize draggable islands for nested test
        this.setupDraggableNested();
    }

    /**
     * Setup draggable shapes for boolean operations
     */
    setupDraggableBoolean() {
        const canvas = document.getElementById('boolean-canvas');
        if (!canvas) return;
        
        // Store draggable state with better initial positions
        // Blue square centered, red shape at top-left corner of blue square
        this.draggableShapes.set('boolean', {
            isDragging: false,
            dragShape: null,
            offset: { x: 0, y: 0 },
            shapes: {
                subject: { x: 100, y: 100, width: 200, height: 200, color: '#3b82f6', fixed: false },
                clip: { x: 100, y: 100, color: '#ef4444', fixed: false }  // Start at corner of blue square
            },
            randomShape: null  // Store generated random shape
        });
        
        // Add mouse event listeners
        canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e, 'boolean'));
        canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e, 'boolean'));
        canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e, 'boolean'));
        canvas.addEventListener('mouseleave', (e) => this.handleMouseUp(e, 'boolean'));
        
        // Add touch support for mobile
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousedown', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            canvas.dispatchEvent(mouseEvent);
        });
        
        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousemove', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            canvas.dispatchEvent(mouseEvent);
        });
        
        canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            const mouseEvent = new MouseEvent('mouseup', {});
            canvas.dispatchEvent(mouseEvent);
        });
    }

    /**
     * Setup draggable islands for nested test
     */
    setupDraggableNested() {
        const canvas = document.getElementById('nested-canvas');
        if (!canvas) return;
        
        this.draggableShapes.set('nested', {
            isDragging: false,
            dragShape: null,
            offset: { x: 0, y: 0 },
            shapes: {
                frame: { x: 50, y: 50, outerWidth: 300, outerHeight: 300, 
                        innerX: 100, innerY: 100, innerWidth: 200, innerHeight: 200, 
                        color: '#3b82f6', fixed: true },
                island1: { x: 150, y: 150, outerWidth: 100, outerHeight: 100,
                         innerX: 180, innerY: 180, innerWidth: 40, innerHeight: 40,
                         color: '#10b981', fixed: false },
                island2: { x: 250, y: 250, outerWidth: 80, outerHeight: 80,
                         innerX: 270, innerY: 270, innerWidth: 40, innerHeight: 40,
                         color: '#f59e0b', fixed: false }
            }
        });
        
        canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e, 'nested'));
        canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e, 'nested'));
        canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e, 'nested'));
        canvas.addEventListener('mouseleave', (e) => this.handleMouseUp(e, 'nested'));
    }

    /**
     * Handle mouse down for draggable shapes
     */
    handleMouseDown(event, testName) {
        const rect = event.target.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        const state = this.draggableShapes.get(testName);
        if (!state) return;
        
        // Check which shape was clicked
        for (const [key, shape] of Object.entries(state.shapes)) {
            if (shape.fixed) continue;
            
            // Get current clip shape type for boolean operations
            if (testName === 'boolean' && key === 'clip') {
                const shapeType = this.getInputValue('boolean-clip-shape', 'circle');
                
                // Check based on shape type with larger hit area for better UX
                const hitRadius = 90; // Slightly larger than visual radius
                switch(shapeType) {
                    case 'circle':
                    case 'star':
                    case 'random':
                        const dx = x - shape.x;
                        const dy = y - shape.y;
                        if (Math.sqrt(dx * dx + dy * dy) <= hitRadius) {
                            state.isDragging = true;
                            state.dragShape = key;
                            state.offset = { x: dx, y: dy };
                        }
                        break;
                    default:
                        // For other shapes, use bounding box
                        if (x >= shape.x - hitRadius && x <= shape.x + hitRadius &&
                            y >= shape.y - hitRadius && y <= shape.y + hitRadius) {
                            state.isDragging = true;
                            state.dragShape = key;
                            state.offset = { x: x - shape.x, y: y - shape.y };
                        }
                        break;
                }
            } else if (shape.width || shape.outerWidth) {
                // Rectangle check
                const width = shape.width || shape.outerWidth;
                const height = shape.height || shape.outerHeight;
                if (x >= shape.x && x <= shape.x + width &&
                    y >= shape.y && y <= shape.y + height) {
                    state.isDragging = true;
                    state.dragShape = key;
                    state.offset = { x: x - shape.x, y: y - shape.y };
                    break;
                }
            }
        }
        
        // Change cursor if dragging
        if (state.isDragging) {
            event.target.style.cursor = 'grabbing';
        }
    }

    /**
     * Handle mouse move for draggable shapes
     */
    handleMouseMove(event, testName) {
        const state = this.draggableShapes.get(testName);
        if (!state) return;
        
        const rect = event.target.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        // Update cursor based on hover
        if (!state.isDragging) {
            let hovering = false;
            for (const [key, shape] of Object.entries(state.shapes)) {
                if (shape.fixed) continue;
                
                if (testName === 'boolean' && key === 'clip') {
                    const dx = x - shape.x;
                    const dy = y - shape.y;
                    if (Math.sqrt(dx * dx + dy * dy) <= 90) {
                        hovering = true;
                        break;
                    }
                } else if (shape.width || shape.outerWidth) {
                    const width = shape.width || shape.outerWidth;
                    const height = shape.height || shape.outerHeight;
                    if (x >= shape.x && x <= shape.x + width &&
                        y >= shape.y && y <= shape.y + height) {
                        hovering = true;
                        break;
                    }
                }
            }
            event.target.style.cursor = hovering ? 'grab' : 'default';
        }
        
        if (!state.isDragging) return;
        
        const shape = state.shapes[state.dragShape];
        if (shape) {
            // Calculate new position with bounds checking
            let newX = x - state.offset.x;
            let newY = y - state.offset.y;
            
            // Keep shape within canvas bounds
            const canvas = event.target;
            const margin = 20;
            newX = Math.max(margin, Math.min(canvas.width - margin, newX));
            newY = Math.max(margin, Math.min(canvas.height - margin, newY));
            
            shape.x = newX;
            shape.y = newY;
            
            // Update inner coordinates for nested shapes
            if (shape.innerX !== undefined) {
                shape.innerX = shape.x + 30;
                shape.innerY = shape.y + 30;
            }
            
            // Redraw the canvas
            this.redrawDraggableCanvas(testName);
        }
    }

    /**
     * Handle mouse up for draggable shapes
     */
    handleMouseUp(event, testName) {
        const state = this.draggableShapes.get(testName);
        if (!state) return;
        
        if (state.isDragging) {
            state.isDragging = false;
            state.dragShape = null;
            event.target.style.cursor = 'default';
            
            // Clear any previous result to show shapes need to be re-run
            const resultElement = document.getElementById(`${testName}-result`);
            if (resultElement) {
                resultElement.textContent = 'Shapes moved - click "Run Operation" to see result';
                resultElement.className = 'result';
            }
        }
    }

    /**
     * Redraw draggable canvas
     */
    redrawDraggableCanvas(testName) {
        const canvas = document.getElementById(`${testName}-canvas`);
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const state = this.draggableShapes.get(testName);
        if (!state) return;
        
        // Clear canvas
        this.clearCanvas(ctx, canvas);
        
        if (testName === 'nested') {
            // Draw frame with hole
            const { frame } = state.shapes;
            
            ctx.fillStyle = frame.color + '40';
            ctx.strokeStyle = frame.color;
            ctx.lineWidth = 2;
            
            // Use evenodd fill rule for proper hole rendering
            ctx.beginPath();
            ctx.rect(frame.x, frame.y, frame.outerWidth, frame.outerHeight);
            ctx.rect(frame.innerX, frame.innerY, frame.innerWidth, frame.innerHeight);
            ctx.fill('evenodd');
            
            // Draw frame strokes
            ctx.beginPath();
            ctx.rect(frame.x, frame.y, frame.outerWidth, frame.outerHeight);
            ctx.stroke();
            ctx.beginPath();
            ctx.rect(frame.innerX, frame.innerY, frame.innerWidth, frame.innerHeight);
            ctx.stroke();
            
            // Draw all islands
            for (const [key, island] of Object.entries(state.shapes)) {
                if (key.startsWith('island')) {
                    ctx.fillStyle = island.color + '40';
                    ctx.strokeStyle = island.color;
                    
                    ctx.beginPath();
                    ctx.rect(island.x, island.y, island.outerWidth, island.outerHeight);
                    ctx.rect(island.innerX, island.innerY, island.innerWidth, island.innerHeight);
                    ctx.fill('evenodd');
                    
                    // Draw island strokes
                    ctx.beginPath();
                    ctx.rect(island.x, island.y, island.outerWidth, island.outerHeight);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.rect(island.innerX, island.innerY, island.innerWidth, island.innerHeight);
                    ctx.stroke();
                }
            }
            
            // Add instruction text
            ctx.font = '12px Arial';
            ctx.fillStyle = '#6b7280';
            ctx.textAlign = 'center';
            ctx.fillText('Drag the colored islands', 200, 380);
            
        } else if (testName === 'boolean') {
            // Draw subject shape (blue square)
            const { subject, clip } = state.shapes;
            
            ctx.fillStyle = subject.color + '40';
            ctx.strokeStyle = subject.color;
            ctx.lineWidth = 2;
            ctx.fillRect(subject.x, subject.y, subject.width, subject.height);
            ctx.strokeRect(subject.x, subject.y, subject.width, subject.height);
            
            // Draw clip shape based on selection
            const shapeType = this.getInputValue('boolean-clip-shape', 'circle');
            ctx.fillStyle = clip.color + '40';
            ctx.strokeStyle = clip.color;
            
            switch(shapeType) {
                case 'circle':
                    ctx.beginPath();
                    ctx.arc(clip.x, clip.y, 80, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    break;
                case 'triangle':
                    ctx.beginPath();
                    ctx.moveTo(clip.x, clip.y - 80);
                    ctx.lineTo(clip.x + 70, clip.y + 40);
                    ctx.lineTo(clip.x - 70, clip.y + 40);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                    break;
                case 'square':
                    ctx.fillRect(clip.x - 75, clip.y - 75, 150, 150);
                    ctx.strokeRect(clip.x - 75, clip.y - 75, 150, 150);
                    break;
                case 'star':
                    this.drawStar(ctx, clip.x, clip.y, 80, 40, 5);
                    ctx.fill();
                    ctx.stroke();
                    break;
                case 'random':
                    // Draw stored random shape or generate new one
                    const state = this.draggableShapes.get('boolean');
                    if (state.randomShape && state.randomShape.length > 0) {
                        ctx.beginPath();
                        state.randomShape.forEach((point, i) => {
                            if (i === 0) ctx.moveTo(point[0] + clip.x, point[1] + clip.y);
                            else ctx.lineTo(point[0] + clip.x, point[1] + clip.y);
                        });
                        ctx.closePath();
                        ctx.fill();
                        ctx.stroke();
                    }
                    break;
                case 'rabbit':
                    // Draw simplified rabbit silhouette based on actual SVG path
                    ctx.save();
                    ctx.translate(clip.x, clip.y);
                    ctx.scale(0.5, 0.5); // Scale down for preview
                    ctx.beginPath();
                    // Simplified rabbit body
                    ctx.ellipse(0, 0, 40, 50, 0, 0, Math.PI * 2);
                    // Head
                    ctx.ellipse(0, -35, 25, 30, 0, 0, Math.PI * 2);
                    // Ears
                    ctx.ellipse(-12, -55, 8, 20, -0.2, 0, Math.PI * 2);
                    ctx.ellipse(12, -55, 8, 20, 0.2, 0, Math.PI * 2);
                    ctx.restore();
                    ctx.fill();
                    ctx.stroke();
                    break;
            }
            
            // Add instruction text
            ctx.font = '12px Arial';
            ctx.fillStyle = '#6b7280';
            ctx.textAlign = 'center';
            ctx.fillText('Drag shapes to position', 200, 380);
        }
    }

    /**
     * Helper: Draw star shape
     */
    drawStar(ctx, x, y, outerRadius, innerRadius, points) {
        ctx.beginPath();
        for (let i = 0; i < points * 2; i++) {
            const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
            const radius = i % 2 === 0 ? outerRadius : innerRadius;
            const px = x + radius * Math.cos(angle);
            const py = y + radius * Math.sin(angle);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
    }

    /**
     * Reset view to default geometry - full reset including positions
     */
    resetView(testName) {
        // Clear output data
        this.tests.testData.delete(`${testName}-output`);
        
        // Reset view state
        this.viewStates.set(testName, false);
        
        // Clear any test results
        const resultElement = document.getElementById(`${testName}-result`);
        if (resultElement) {
            resultElement.textContent = 'Ready to run test';
            resultElement.className = 'result';
        }
        
        // Clear info display
        const infoElement = document.getElementById(`${testName}-info`);
        if (infoElement) {
            infoElement.textContent = '';
        }
        
        // Reset draggable positions if applicable
        if (testName === 'boolean') {
            const state = this.draggableShapes.get('boolean');
            if (state) {
                state.shapes.subject = { x: 100, y: 100, width: 200, height: 200, color: '#3b82f6', fixed: false };
                state.shapes.clip = { x: 100, y: 100, color: '#ef4444', fixed: false };
                
                // Generate random shape if currently selected
                const shapeType = this.getInputValue('boolean-clip-shape', 'circle');
                if (shapeType === 'random') {
                    const points = [];
                    const numPoints = 8;
                    const angles = [];
                    for (let i = 0; i < numPoints; i++) {
                        angles.push(Math.random() * Math.PI * 2);
                    }
                    angles.sort((a, b) => a - b);
                    angles.forEach(angle => {
                        const radius = 50 + Math.random() * 30;
                        points.push([
                            radius * Math.cos(angle),
                            radius * Math.sin(angle)
                        ]);
                    });
                    state.randomShape = points;
                } else {
                    state.randomShape = null;
                }
                
                this.redrawDraggableCanvas('boolean');
            }
        } else if (testName === 'nested') {
            const state = this.draggableShapes.get('nested');
            if (state) {
                state.shapes.island1 = { x: 150, y: 150, outerWidth: 100, outerHeight: 100,
                                        innerX: 180, innerY: 180, innerWidth: 40, innerHeight: 40,
                                        color: '#10b981', fixed: false };
                state.shapes.island2 = { x: 250, y: 250, outerWidth: 80, outerHeight: 80,
                                        innerX: 270, innerY: 270, innerWidth: 40, innerHeight: 40,
                                        color: '#f59e0b', fixed: false };
                this.redrawDraggableCanvas('nested');
            }
        } else if (testName === 'pip') {
            // Clear test points
            this.tests.testData.delete('pip-points');
            this.tests.testData.set('pip-points', []);
            this.drawDefaultPIP();
        } else {
            // Redraw default shape for other tests
            switch(testName) {
                case 'letter-b': this.drawDefaultLetterB(); break;
                case 'offset': this.drawDefaultOffset(); break;
                case 'simplify': this.drawDefaultSimplify(); break;
                case 'pcb-fusion': this.drawDefaultPCB(); break;
                case 'area': 
                    // Area test needs special handling
                    const areaCanvas = document.getElementById('area-canvas');
                    if (areaCanvas) {
                        const btn = areaCanvas.parentNode.querySelector('button');
                        if (btn) btn.remove();
                        this.tests.testArea();
                    }
                    break;
            }
        }
        
        // Update label if exists
        const label = document.getElementById(`${testName}-label`);
        if (label) label.textContent = 'Input Geometry';
    }

    /**
     * Hide loading screen
     */
    hideLoading() {
        const loading = document.getElementById('loading');
        if (loading) {
            loading.style.display = 'none';
        }
    }

    /**
     * Show error message
     */
    showError(message) {
        const loading = document.getElementById('loading');
        if (loading) {
            loading.innerHTML = `
                <div style="color: #ef4444; text-align: center; padding: 2rem;">
                    <h2>⚠️ Error</h2>
                    <p>${message}</p>
                    <button onclick="location.reload()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        Reload Page
                    </button>
                </div>
            `;
        }
    }

    /**
     * Get view state for a test
     */
    getViewState(testName) {
        return this.viewStates.get(testName) || false;
    }

    /**
     * Set view state for a test
     */
    setViewState(testName, isShowingOutput) {
        this.viewStates.set(testName, isShowingOutput);
    }

    /**
     * Update result display
     */
    updateResult(elementId, message, isSuccess = true) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = message;
            element.className = isSuccess ? 'result success' : (message.includes('WARNING') ? 'result warning' : 'result error');
        }
    }

    /**
     * Update geometry info display
     */
    updateInfo(elementId, info) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = info;
        }
    }

    /**
     * Set label text
     */
    setLabel(elementId, text) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = text;
        }
    }

    /**
     * Get input value
     */
    getInputValue(elementId, defaultValue) {
        const element = document.getElementById(elementId);
        if (element) {
            const value = element.value;
            return element.type === 'number' ? 
                parseFloat(value) || defaultValue : value;
        }
        return defaultValue;
    }

    /**
     * Get join type for offset operations
     */
    getJoinType(elementId) {
        const value = this.getInputValue(elementId, 'Round');
        const { JoinType } = this.tests.core.clipper2;
        
        switch(value) {
            case 'Miter': return JoinType.Miter;
            case 'Square': return JoinType.Square;
            default: return JoinType.Round;
        }
    }

    /**
     * Clear canvas helper
     */
    clearCanvas(ctx, canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
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
        // Area test initializes on first run
    }

    /**
     * Draw default boolean test with current shape selection
     */
    drawDefaultBoolean() {
        this.redrawDraggableCanvas('boolean');
    }

    /**
     * Draw default Letter B test
     */
    drawDefaultLetterB() {
        const canvas = document.getElementById('letter-b-canvas');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        this.clearCanvas(ctx, canvas);
        
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 25;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        // Draw vertical stroke
        ctx.beginPath();
        ctx.moveTo(100, 50);
        ctx.lineTo(100, 290);
        ctx.stroke();
        
        // Draw top curve
        ctx.beginPath();
        ctx.moveTo(100, 80);
        ctx.lineTo(200, 80);
        ctx.arc(200, 110, 30, -Math.PI/2, Math.PI/2, false);
        ctx.lineTo(100, 140);
        ctx.stroke();
        
        // Draw bottom curve
        ctx.beginPath();
        ctx.moveTo(100, 200);
        ctx.lineTo(210, 200);
        ctx.arc(210, 235, 35, -Math.PI/2, Math.PI/2, false);
        ctx.lineTo(100, 270);
        ctx.stroke();
        
        // Add label
        ctx.font = '12px Arial';
        ctx.fillStyle = '#6b7280';
        ctx.textAlign = 'left';
        ctx.fillText('Letter B strokes (will merge with holes)', 10, 20);
    }

    /**
     * Draw default nested structure test
     */
    drawDefaultNested() {
        this.redrawDraggableCanvas('nested');
    }

    /**
     * Draw default offset test with selected shape
     */
    drawDefaultOffset() {
        const canvas = document.getElementById('offset-canvas');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        this.clearCanvas(ctx, canvas);
        
        const shape = this.getInputValue('offset-shape', 'star');
        
        ctx.fillStyle = '#3b82f640';
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        
        switch(shape) {
            case 'circle':
                ctx.beginPath();
                ctx.arc(200, 200, 80, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                break;
            case 'square':
                ctx.fillRect(120, 120, 160, 160);
                ctx.strokeRect(120, 120, 160, 160);
                break;
            case 'triangle':
                ctx.beginPath();
                ctx.moveTo(200, 80);
                ctx.lineTo(320, 280);
                ctx.lineTo(80, 280);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                break;
            case 'bottleneck':
                // Hourglass/bottleneck shape
                ctx.beginPath();
                ctx.moveTo(120, 120);
                ctx.lineTo(280, 120);
                ctx.lineTo(220, 200);
                ctx.lineTo(280, 280);
                ctx.lineTo(120, 280);
                ctx.lineTo(180, 200);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                break;
            case 'star':
            default:
                this.drawStar(ctx, 200, 200, 120, 60, 8);
                ctx.fill();
                ctx.stroke();
                break;
        }
        
        ctx.font = '12px Arial';
        ctx.fillStyle = '#6b7280';
        ctx.textAlign = 'center';
        ctx.fillText(`${shape.charAt(0).toUpperCase() + shape.slice(1)} shape for offset testing`, 200, 360);
    }

    /**
     * Draw default simplify test
     */
    drawDefaultSimplify() {
        const canvas = document.getElementById('simplify-canvas');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        this.clearCanvas(ctx, canvas);
        
        ctx.fillStyle = '#3b82f640';
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        // Create stable flower shape
        const segments = 100;
        const baseRadius = 100;
        const centerX = 200;
        const centerY = 200;
        
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const noise = Math.sin(angle * 5) * 30;
            const radius = baseRadius + noise;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);
            
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        ctx.fillStyle = '#6b7280';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Flower shape with 100+ points', 200, 340);
    }

    /**
     * Draw default PCB fusion test
     */
    drawDefaultPCB() {
        const canvas = document.getElementById('pcb-fusion-canvas');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        this.clearCanvas(ctx, canvas);
        
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 12;
        ctx.lineCap = 'round';
        
        // Draw traces forming enclosed area
        // Horizontal trace
        ctx.beginPath();
        ctx.moveTo(50, 200);
        ctx.lineTo(350, 200);
        ctx.stroke();
        
        // Left vertical trace
        ctx.beginPath();
        ctx.moveTo(150, 100);
        ctx.lineTo(150, 300);
        ctx.stroke();
        
        // Right diagonal trace
        ctx.beginPath();
        ctx.moveTo(250, 100);
        ctx.lineTo(350, 300);
        ctx.stroke();
        
        // Top connecting trace
        ctx.beginPath();
        ctx.moveTo(150, 100);
        ctx.lineTo(250, 100);
        ctx.stroke();
        
        // Bottom right connecting trace
        ctx.beginPath();
        ctx.moveTo(150, 300);
        ctx.lineTo(350, 300);
        ctx.stroke();
        
        // Draw pads
        ctx.fillStyle = '#10b98140';
        const padPositions = [
            [50, 200, 20], [150, 200, 25], [250, 200, 25], [350, 200, 20],
            [150, 100, 20], [150, 300, 20], [250, 100, 20], [350, 300, 20]
        ];
        
        padPositions.forEach(([x, y, r]) => {
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        });
        
        ctx.fillStyle = '#6b7280';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('PCB traces forming enclosed area (will show hole)', 200, 380);
    }

    /**
     * Draw default PIP test
     */
    drawDefaultPIP() {
        const canvas = document.getElementById('pip-canvas');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        this.clearCanvas(ctx, canvas);
        
        // Draw test polygon
        ctx.fillStyle = '#3b82f640';
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        
        ctx.beginPath();
        const points = [
            [100, 50], [300, 100], [350, 200],
            [250, 350], [50, 300], [50, 150]
        ];
        
        points.forEach(([x, y], i) => {
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        ctx.font = '12px Arial';
        ctx.fillStyle = '#6b7280';
        ctx.fillText('Click to add test points', 10, 20);
    }

    /**
     * Handle shape selection change
     */
    onShapeChange(selectId) {
        const testName = selectId.includes('offset') ? 'offset' : 'boolean';
        
        if (testName === 'offset') {
            this.drawDefaultOffset();
        } else if (testName === 'boolean') {
            // Generate random shape if selected
            const shapeType = this.getInputValue('boolean-clip-shape', 'circle');
            if (shapeType === 'random') {
                const state = this.draggableShapes.get('boolean');
                if (state) {
                    // Generate random convex polygon points relative to origin
                    const points = [];
                    const numPoints = 8;
                    const angles = [];
                    
                    // Generate random angles and sort
                    for (let i = 0; i < numPoints; i++) {
                        angles.push(Math.random() * Math.PI * 2);
                    }
                    angles.sort((a, b) => a - b);
                    
                    // Generate points at those angles with varying radius
                    angles.forEach(angle => {
                        const radius = 50 + Math.random() * 30;
                        points.push([
                            radius * Math.cos(angle),
                            radius * Math.sin(angle)
                        ]);
                    });
                    
                    state.randomShape = points;
                }
            }
            this.redrawDraggableCanvas('boolean');
        }
        
        // Clear any previous result
        const resultElement = document.getElementById(`${testName}-result`);
        if (resultElement) {
            resultElement.textContent = 'Shape changed - click "Run Operation" to see result';
            resultElement.className = 'result';
        }
    }

    /**
     * Handle offset type change
     */
    onOffsetTypeChange() {
        const offsetType = this.getInputValue('offset-type', 'external');
        const joinSelect = document.getElementById('offset-join');
        
        if (joinSelect) {
            // Join type is less relevant for internal offsets
            joinSelect.disabled = false; // Keep enabled but note it may have less effect
        }
        
        // Clear any previous result
        const resultElement = document.getElementById('offset-result');
        if (resultElement) {
            resultElement.textContent = 'Settings changed - click "Apply Offset" to see result';
            resultElement.className = 'result';
        }
    }
}