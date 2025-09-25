/**
 * Clipper2 UI Module
 * UI interactions and state management
 * Version 8.2 - Fixed state corruption and hard-coded values
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
            this.tests.ui = this;
            this.initializeViewStates();
            this.setDefaultValues();
            this.initializeEventHandlers();
            this.drawAllDefaults();
            this.hideLoading();
            
            this.initialized = true;
            console.log('[UI] UI system initialized');
            
        } catch (error) {
            console.error('[ERROR] UI initialization failed:', error);
            this.showError('Failed to initialize UI system');
        }
    }

    /**
     * Set default values in UI controls from configuration
     */
    setDefaultValues() {
        const booleanOp = document.getElementById('boolean-operation');
        if (booleanOp) booleanOp.value = 'union';
        
        const booleanClip = document.getElementById('boolean-clip-shape');
        if (booleanClip) booleanClip.value = 'circle';
        
        const offsetShape = document.getElementById('offset-shape');
        if (offsetShape) offsetShape.value = this.defaults.geometries.offset.defaults.shape;
        
        const offsetType = document.getElementById('offset-type');
        if (offsetType) offsetType.value = this.defaults.geometries.offset.defaults.type;
        
        const offsetCount = document.getElementById('offset-count');
        if (offsetCount) offsetCount.value = this.defaults.geometries.offset.defaults.count;
        
        const offsetDistance = document.getElementById('offset-distance');
        if (offsetDistance) offsetDistance.value = this.defaults.geometries.offset.defaults.distance;
        
        const offsetJoin = document.getElementById('offset-join');
        if (offsetJoin) offsetJoin.value = this.defaults.geometries.offset.defaults.joinType;
        
        const offsetMiter = document.getElementById('offset-miter-limit');
        if (offsetMiter) offsetMiter.value = this.defaults.geometries.offset.defaults.miterLimit;
        
        const simplifyTolerance = document.getElementById('simplify-tolerance');
        if (simplifyTolerance) simplifyTolerance.value = this.defaults.geometries.simplify.defaultTolerance;
        
        const minkowskiPattern = document.getElementById('minkowski-pattern');
        if (minkowskiPattern) minkowskiPattern.value = this.defaults.geometries.minkowski.defaults.pattern;
        
        const minkowskiPath = document.getElementById('minkowski-path');
        if (minkowskiPath) minkowskiPath.value = this.defaults.geometries.minkowski.defaults.path;
        
        const minkowskiOp = document.getElementById('minkowski-operation');
        if (minkowskiOp) minkowskiOp.value = this.defaults.geometries.minkowski.defaults.operation;
        
        const minkowskiSweep = document.getElementById('minkowski-sweep');
        if (minkowskiSweep) minkowskiSweep.checked = this.defaults.geometries.minkowski.defaults.showSweep;
        
        const minkowskiOffset = document.getElementById('minkowski-offset');
        if (minkowskiOffset) minkowskiOffset.checked = this.defaults.geometries.minkowski.defaults.showOffset;
        
        const pipTolerance = document.getElementById('pip-tolerance');
        if (pipTolerance) pipTolerance.value = this.defaults.geometries.pip.edgeTolerance;
        
        const arcOp = document.getElementById('arc-operation');
        if (arcOp) arcOp.value = 'union';
        
        const arcReconstruct = document.getElementById('arc-reconstruct-toggle');
        if (arcReconstruct) arcReconstruct.checked = true;
        
        const arcMetadata = document.getElementById('arc-show-metadata');
        if (arcMetadata) arcMetadata.checked = false;
    }

    /**
     * Initialize view states
     */
    initializeViewStates() {
        const testNames = [
            'boolean', 'letter-b', 'nested', 'offset',
            'simplify', 'pcb-fusion', 'area', 'pip', 'minkowski', 'arc-reconstruction'
        ];
        
        testNames.forEach(name => {
            this.viewStates.set(name, false);
        });
    }

    /**
     * Initialize event handlers for all controls
     */
    initializeEventHandlers() {
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
        
        const simplifyTolerance = document.getElementById('simplify-tolerance');
        if (simplifyTolerance) {
            simplifyTolerance.addEventListener('input', (e) => {
                this.tests.updateTestState('simplify', 'tolerance', parseFloat(e.target.value));
                const valueDisplay = document.getElementById('simplify-tolerance-value');
                if (valueDisplay) valueDisplay.textContent = e.target.value;
            });
        }
        
        const minkowskiPattern = document.getElementById('minkowski-pattern');
        if (minkowskiPattern) {
            minkowskiPattern.addEventListener('change', (e) => {
                this.tests.updateTestState('minkowski', 'pattern', e.target.value);
                this.updateResult('minkowski-result', 'Pattern changed - click "Calculate" to see result');
            });
        }
        
        const minkowskiPath = document.getElementById('minkowski-path');
        if (minkowskiPath) {
            minkowskiPath.addEventListener('change', (e) => {
                this.tests.updateTestState('minkowski', 'path', e.target.value);
                this.updateResult('minkowski-result', 'Path changed - click "Calculate" to see result');
            });
        }
        
        const minkowskiOp = document.getElementById('minkowski-operation');
        if (minkowskiOp) {
            minkowskiOp.addEventListener('change', (e) => {
                this.tests.updateTestState('minkowski', 'operation', e.target.value);
                this.updateResult('minkowski-result', 'Operation changed - click "Calculate" to see result');
            });
        }
        
        const minkowskiSweep = document.getElementById('minkowski-sweep');
        if (minkowskiSweep) {
            minkowskiSweep.addEventListener('change', (e) => {
                this.tests.updateTestState('minkowski', 'showSweep', e.target.checked);
                this.updateResult('minkowski-result', 'Sweep visualization toggled - click "Calculate" to update');
            });
        }
        
        const minkowskiOffset = document.getElementById('minkowski-offset');
        if (minkowskiOffset) {
            minkowskiOffset.addEventListener('change', (e) => {
                this.tests.updateTestState('minkowski', 'showOffset', e.target.checked);
                this.updateResult('minkowski-result', 'Offset comparison toggled - click "Calculate" to update');
            });
        }
        
        const pipTolerance = document.getElementById('pip-tolerance');
        if (pipTolerance) {
            pipTolerance.addEventListener('input', (e) => {
                this.tests.updateTestState('pip', 'edgeTolerance', parseFloat(e.target.value));
                this.updateResult('pip-result', `Edge tolerance updated to ${e.target.value}px`);
            });
        }
        
        const arcOp = document.getElementById('arc-operation');
        if (arcOp) {
            arcOp.addEventListener('change', (e) => {
                this.tests.updateTestState('arc-reconstruction', 'operation', e.target.value);
                this.updateResult('arc-reconstruction-result', 'Operation changed - click "Run Test" to update');
            });
        }
        
        const arcReconstruct = document.getElementById('arc-reconstruct-toggle');
        if (arcReconstruct) {
            arcReconstruct.addEventListener('change', (e) => {
                this.tests.updateTestState('arc-reconstruction', 'showReconstruction', e.target.checked);
            });
        }
        
        const arcMetadata = document.getElementById('arc-show-metadata');
        if (arcMetadata) {
            arcMetadata.addEventListener('change', (e) => {
                this.tests.updateTestState('arc-reconstruction', 'showMetadata', e.target.checked);
            });
        }
        
        this.setupDraggableArcReconstruction();
        this.setupDraggableBoolean();
        this.setupDraggableNested();
        this.setupPIPCanvas();
        this.setupAreaTest();
    }

    /**
     * Setup draggable circles for arc reconstruction
     */
    setupDraggableArcReconstruction() {
        const canvas = document.getElementById('arc-reconstruction-canvas');
        if (!canvas) return;
        
        let draggingCircle = null;
        let dragOffset = { x: 0, y: 0 };
        
        canvas.addEventListener('mousedown', (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (canvas.width / rect.width);
            const y = (e.clientY - rect.top) * (canvas.height / rect.height);
            
            const state = this.tests.getTestState('arc-reconstruction');
            
            const dist1 = Math.sqrt(
                Math.pow(x - state.circle1Pos.x, 2) + 
                Math.pow(y - state.circle1Pos.y, 2)
            );
            if (dist1 <= state.circle1Radius) {
                draggingCircle = 'circle1';
                dragOffset = { x: x - state.circle1Pos.x, y: y - state.circle1Pos.y };
                canvas.style.cursor = 'grabbing';
                return;
            }
            
            const dist2 = Math.sqrt(
                Math.pow(x - state.circle2Pos.x, 2) + 
                Math.pow(y - state.circle2Pos.y, 2)
            );
            if (dist2 <= state.circle2Radius) {
                draggingCircle = 'circle2';
                dragOffset = { x: x - state.circle2Pos.x, y: y - state.circle2Pos.y };
                canvas.style.cursor = 'grabbing';
                return;
            }
        });
        
        canvas.addEventListener('mousemove', (e) => {
            if (!draggingCircle) {
                const rect = canvas.getBoundingClientRect();
                const x = (e.clientX - rect.left) * (canvas.width / rect.width);
                const y = (e.clientY - rect.top) * (canvas.height / rect.height);
                
                const state = this.tests.getTestState('arc-reconstruction');
                const dist1 = Math.sqrt(Math.pow(x - state.circle1Pos.x, 2) + Math.pow(y - state.circle1Pos.y, 2));
                const dist2 = Math.sqrt(Math.pow(x - state.circle2Pos.x, 2) + Math.pow(y - state.circle2Pos.y, 2));
                
                if (dist1 <= state.circle1Radius || dist2 <= state.circle2Radius) {
                    canvas.style.cursor = 'grab';
                } else {
                    canvas.style.cursor = 'default';
                }
                return;
            }
            
            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (canvas.width / rect.width);
            const y = (e.clientY - rect.top) * (canvas.height / rect.height);
            
            const radius = draggingCircle === 'circle1' ? 
                this.tests.getTestState('arc-reconstruction').circle1Radius :
                this.tests.getTestState('arc-reconstruction').circle2Radius;
            
            const canvasSize = this.defaults.config.canvasWidth;
            const newPos = {
                x: Math.max(radius, Math.min(canvasSize - radius, x - dragOffset.x)),
                y: Math.max(radius, Math.min(canvasSize - radius, y - dragOffset.y))
            };
            
            if (draggingCircle === 'circle1') {
                this.tests.updateTestState('arc-reconstruction', 'circle1Pos', newPos);
            } else if (draggingCircle === 'circle2') {
                this.tests.updateTestState('arc-reconstruction', 'circle2Pos', newPos);
            }
            
            this.drawDefaultArcReconstruction();
            this.updateResult('arc-reconstruction-result', 'Circles repositioned - click "Run Test" to update');
        });
        
        canvas.addEventListener('mouseup', () => {
            draggingCircle = null;
            canvas.style.cursor = 'default';
        });
        
        canvas.addEventListener('mouseleave', () => {
            draggingCircle = null;
            canvas.style.cursor = 'default';
        });
    }

    /**
     * Setup area test
     */
    setupAreaTest() {
        const canvas = document.getElementById('area-canvas');
        if (!canvas) return;
        this.tests.initializeAreaTest();
    }

    /**
     * Setup PIP canvas click handler
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
        
        this.tests.testPointInPolygon();
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
        
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
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
     * Get clip shape radius from defaults
     */
    getClipRadius(clipShape) {
        const clipDef = this.defaults.geometries.boolean.clips[clipShape];
        if (!clipDef) return 160; // fallback
        
        if (clipDef.radius) return clipDef.radius;
        if (clipDef.outerRadius) return clipDef.outerRadius;
        if (clipDef.avgRadius) return clipDef.avgRadius;
        
        // For polygon shapes, calculate bounding radius
        if (clipDef.data) {
            let maxDist = 0;
            clipDef.data.forEach(pt => {
                const dist = Math.sqrt(pt[0] * pt[0] + pt[1] * pt[1]);
                maxDist = Math.max(maxDist, dist);
            });
            return maxDist;
        }
        
        return 160; // fallback
    }

    /**
     * Mouse down handler
     */
    handleMouseDown(event, testName) {
        const canvas = event.target;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (event.clientX - rect.left) * scaleX;
        const y = (event.clientY - rect.top) * scaleY;
        
        const state = this.tests.getTestState(testName);
        
        if (testName === 'boolean') {
            const clipRadius = this.getClipRadius(state.clipShape);
            if (Math.sqrt(Math.pow(x - state.clipPos.x, 2) + 
                         Math.pow(y - state.clipPos.y, 2)) <= clipRadius) {
                this.dragInfo = {
                    isDragging: true,
                    shape: 'clip',
                    offset: { x: x - state.clipPos.x, y: y - state.clipPos.y },
                    radius: clipRadius
                };
            }
        } else if (testName === 'nested') {
            const island1 = state.island1Pos;
            const island2 = state.island2Pos;
            
            if (x >= island1.x && x <= island1.x + 200 &&
                y >= island1.y && y <= island1.y + 200) {
                this.dragInfo = {
                    isDragging: true,
                    shape: 'island1',
                    offset: { x: x - island1.x, y: y - island1.y }
                };
            } else if (x >= island2.x && x <= island2.x + 160 &&
                       y >= island2.y && y <= island2.y + 160) {
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
        const canvas = event.target;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (event.clientX - rect.left) * scaleX;
        const y = (event.clientY - rect.top) * scaleY;
        
        if (!this.dragInfo?.isDragging) {
            const state = this.tests.getTestState(testName);
            let hovering = false;
            
            if (testName === 'boolean') {
                const clipRadius = this.getClipRadius(state.clipShape);
                if (Math.sqrt(Math.pow(x - state.clipPos.x, 2) + 
                             Math.pow(y - state.clipPos.y, 2)) <= clipRadius) {
                    hovering = true;
                }
            }
            
            event.target.style.cursor = hovering ? 'grab' : 'default';
            return;
        }
        
        const canvasSize = this.defaults.config.canvasWidth;
        const clipRadius = this.dragInfo.radius || 160;
        const margin = this.defaults.config.draggableMargin || 20;
        const minBound = clipRadius + margin;
        const maxBound = canvasSize - clipRadius - margin;
        const newX = Math.max(minBound, Math.min(maxBound, x - this.dragInfo.offset.x));
        const newY = Math.max(minBound, Math.min(maxBound, y - this.dragInfo.offset.y));
        
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
        const canvasSize = this.defaults.config.canvasWidth;
        
        if (testName === 'nested') {
            this.tests.rendering.clearCanvas(canvas);
            const ctx = canvas.getContext('2d');
            
            ctx.fillStyle = this.tests.rendering.resolveStyleValue('var(--shape-fill)');
            ctx.strokeStyle = this.tests.rendering.resolveStyleValue('var(--shape-stroke)');
            ctx.lineWidth = 2;
            
            ctx.beginPath();
            ctx.rect(100, 100, 600, 600);
            ctx.rect(200, 200, 400, 400);
            ctx.fill('evenodd');
            ctx.stroke();
            
            ctx.fillStyle = 'rgba(16, 185, 129, 0.4)';
            ctx.strokeStyle = '#10b981';
            ctx.beginPath();
            ctx.rect(state.island1Pos.x, state.island1Pos.y, 200, 200);
            ctx.rect(state.island1Pos.x + 60, state.island1Pos.y + 60, 80, 80);
            ctx.fill('evenodd');
            ctx.stroke();
            
            ctx.fillStyle = 'rgba(245, 158, 11, 0.4)';
            ctx.strokeStyle = '#f59e0b';
            ctx.beginPath();
            ctx.rect(state.island2Pos.x, state.island2Pos.y, 160, 160);
            ctx.rect(state.island2Pos.x + 40, state.island2Pos.y + 40, 80, 80);
            ctx.fill('evenodd');
            ctx.stroke();
            
            ctx.font = '16px Arial';
            ctx.fillStyle = '#6b7280';
            ctx.textAlign = 'center';
            ctx.fillText('Drag smaller frames to position', canvasSize / 2, canvasSize - 50);
            
        } else if (testName === 'boolean') {
            const shapes = {};
            
            shapes.subject = {
                type: 'rect',
                x: state.subjectPos.x - 200,
                y: state.subjectPos.y - 200,
                width: 400,
                height: 400,
                color: 'var(--subject-stroke)'
            };
            
            const clipShape = state.clipShape;
            const clipRadius = this.getClipRadius(clipShape);
            
            if (clipShape === 'circle') {
                shapes.clip = {
                    type: 'circle',
                    x: state.clipPos.x,
                    y: state.clipPos.y,
                    radius: clipRadius,
                    color: 'var(--clip-stroke)'
                };
            } else if (clipShape === 'rabbit' && this.tests.rabbitPath) {
                const coords = this.tests.rabbitPath.map(pt => [
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
                        state.clipPos.x, state.clipPos.y, 
                        clipDef.outerRadius, clipDef.innerRadius, clipDef.points
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
            ctx.font = '16px Arial';
            ctx.fillStyle = '#6b7280';
            ctx.textAlign = 'center';
            ctx.fillText('Drag red shape to position', canvasSize / 2, canvasSize - 50);
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
        this.drawDefaultArea();
        this.drawDefaultArcReconstruction();
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
        const coords = this.tests.geometry.parseSVGPath(
            simplifyDef.path,
            simplifyDef.scale,
            simplifyDef.position
        );
        
        if (coords && coords.length > 0) {
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
        const canvas = document.getElementById('minkowski-canvas');
        if (!canvas) return;
        
        const state = this.tests.getTestState('minkowski');
        const patternDef = this.defaults.geometries.minkowski.patterns[state.pattern];
        const pathDef = this.defaults.geometries.minkowski.paths[state.path];
        
        this.tests.rendering.clearCanvas(canvas);
        
        if (pathDef) {
            this.tests.rendering.drawSimplePaths([pathDef.data], canvas, {
                fillOuter: 'none',
                strokeOuter: this.defaults.styles.minkowski.path.strokeOuter,
                strokeWidth: 2,
                clear: false
            });
        }
        
        if (patternDef) {
            let patternCoords;
            if (patternDef.type === 'parametric') {
                patternCoords = this.defaults.generators[patternDef.shape](
                    100, 200,
                    patternDef.radius || patternDef.outerRadius,
                    patternDef.innerRadius,
                    patternDef.points
                );
            } else {
                patternCoords = patternDef.data.map(pt => [pt[0] + 100, pt[1] + 200]);
            }
            
            this.tests.rendering.drawSimplePaths([patternCoords], canvas, {
                fillOuter: 'none',
                strokeOuter: this.defaults.styles.minkowski.pattern.strokeOuter,
                strokeWidth: 2,
                clear: false
            });
        }
        
        const ctx = canvas.getContext('2d');
        ctx.font = '12px Arial';
        ctx.fillStyle = '#6b7280';
        ctx.fillText('Click "Calculate" to see result', 10, 20);
    }

    drawDefaultArea() {
        const areaCanvas = document.getElementById('area-canvas');
        if (areaCanvas) {
            if (!this.tests.testState.area.isDrawing) {
                this.tests.initializeAreaTest();
            }
        }
    }

    /**
     * Draw default arc reconstruction
     */
    drawDefaultArcReconstruction() {
        const canvas = document.getElementById('arc-reconstruction-canvas');
        if (!canvas) return;
        
        const state = this.tests.getTestState('arc-reconstruction');
        
        this.tests.rendering.clearCanvas(canvas);
        this.tests.rendering.drawGrid(canvas, this.defaults.config.gridSize);
        
        const ctx = canvas.getContext('2d');
        
        ctx.strokeStyle = '#3b82f6';
        ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
        ctx.lineWidth = 2;
        
        ctx.beginPath();
        ctx.arc(state.circle1Pos.x, state.circle1Pos.y, state.circle1Radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        ctx.strokeStyle = '#10b981';
        ctx.fillStyle = 'rgba(16, 185, 129, 0.2)';
        
        ctx.beginPath();
        ctx.arc(state.circle2Pos.x, state.circle2Pos.y, state.circle2Radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        ctx.font = '12px Arial';
        ctx.fillStyle = '#6b7280';
        ctx.textAlign = 'center';
        ctx.fillText('Circle 1', state.circle1Pos.x, state.circle1Pos.y - state.circle1Radius - 10);
        ctx.fillText('Circle 2', state.circle2Pos.x, state.circle2Pos.y - state.circle2Radius - 10);
        
        ctx.textAlign = 'left';
        ctx.fillText('Drag circles to position', 10, 20);
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
                // Rabbit path is already pre-parsed
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
     * Reset view to default - FIXED array spread issue
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
        
        const card = document.querySelector(`[data-test="${testName}"]`);
        if (card) {
            card.dataset.status = '';
        }
        
        switch(testName) {
            case 'boolean': 
                // Use defaults from config
                const boolDefaults = this.defaults.geometries.boolean.clips.circle;
                // FIXED: Correctly handle array to object conversion
                this.tests.testState.boolean.clipPos = {
                    x: boolDefaults.initialPos[0],
                    y: boolDefaults.initialPos[1]
                };
                this.drawDefaultBoolean(); 
                break;
            case 'letter-b': 
                this.drawDefaultLetterB(); 
                break;
            case 'nested': 
                this.tests.testState.nested.island1Pos = { x: 300, y: 300 };
                this.tests.testState.nested.island2Pos = { x: 500, y: 500 };
                this.drawDefaultNested(); 
                break;
            case 'offset': 
                this.drawDefaultOffset(); 
                break;
            case 'simplify': 
                this.drawDefaultSimplify(); 
                break;
            case 'pcb-fusion': 
                this.drawDefaultPCB(); 
                break;
            case 'pip': 
                this.tests.testState.pip.points = [];
                this.drawDefaultPIP(); 
                break;
            case 'area':
                this.tests.testState.area.points = [];
                this.tests.testState.area.isDrawing = false;
                this.tests.testState.area.lastPolygonPath = null;
                this.tests.initializeAreaTest();
                break;
            case 'minkowski':
                const patternSelect = document.getElementById('minkowski-pattern');
                const pathSelect = document.getElementById('minkowski-path');
                const opSelect = document.getElementById('minkowski-operation');
                const sweepCheck = document.getElementById('minkowski-sweep');
                const offsetCheck = document.getElementById('minkowski-offset');
                
                if (patternSelect) patternSelect.value = this.defaults.geometries.minkowski.defaults.pattern;
                if (pathSelect) pathSelect.value = this.defaults.geometries.minkowski.defaults.path;
                if (opSelect) opSelect.value = this.defaults.geometries.minkowski.defaults.operation;
                if (sweepCheck) sweepCheck.checked = this.defaults.geometries.minkowski.defaults.showSweep;
                if (offsetCheck) offsetCheck.checked = this.defaults.geometries.minkowski.defaults.showOffset;
                
                this.drawDefaultMinkowski();
                break;
            case 'arc-reconstruction':
                const defaults = this.defaults.geometries['arc-reconstruction'].defaults;
                this.tests.testState['arc-reconstruction'].circle1Pos = { ...defaults.circle1Pos };
                this.tests.testState['arc-reconstruction'].circle2Pos = { ...defaults.circle2Pos };
                this.tests.testState['arc-reconstruction'].circle1Radius = defaults.circle1Radius;
                this.tests.testState['arc-reconstruction'].circle2Radius = defaults.circle2Radius;
                this.drawDefaultArcReconstruction();
                break;
        }
        
        const label = document.getElementById(`${testName}-label`);
        if (label) label.textContent = this.defaults.labels.inputGeometry;
    }

    handleExport(testName, dataType) {
        this.tests.exportSVG(testName, dataType);
    }

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