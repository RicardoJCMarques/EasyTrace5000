/**
 * @file        clipper2-ui.js
 * @description UI Module
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 *
 * This module is part of the EasyTrace5000 Test Suite.
 * It interfaces with the Clipper2 library (Angus Johnson) via WASM (Erik Som).
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

class Clipper2UI {
    constructor(tests) {
        this.tests = tests;
        this.viewStates = new Map();
        this.initialized = false;
        this.defaults = Clipper2Defaults;
        this.dragInfo = null;
    }

    async initialize() {
        if (this.initialized) return;

        try {
            this.tests.ui = this;
            this.initializeViewStates();
            this.setDefaultValues();
            this.initializeEventHandlers();
            requestAnimationFrame(() => this.drawAllDefaults());
            this.hideLoading();
            this.initialized = true;
            console.log('[UI] Initialized');
        } catch (e) {
            console.error('[UI] Init failed:', e);
            this.showError('Failed to initialize UI');
        }
    }

    setDefaultValues() {
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.type === 'checkbox' ? el.checked = val : el.value = val;
        };

        setVal('boolean-operation', 'union');
        setVal('boolean-clip-shape', 'circle');

        const off = this.defaults.geometries.offset.defaults;
        setVal('offset-shape', off.shape);
        setVal('offset-type', off.type);
        setVal('offset-count', off.count);
        setVal('offset-distance', off.distance);
        setVal('offset-join', off.joinType);
        setVal('offset-miter-limit', off.miterLimit);

        setVal('simplify-tolerance', this.defaults.geometries.simplify.defaultTolerance);

        const mink = this.defaults.geometries.minkowski.defaults;
        setVal('minkowski-pattern', mink.pattern);
        setVal('minkowski-path', mink.path);
        setVal('minkowski-operation', mink.operation);
        setVal('minkowski-sweep', mink.showSweep);
        setVal('minkowski-offset', mink.showOffset);

        setVal('pip-tolerance', this.defaults.geometries.pip.edgeTolerance);

        const arc = this.defaults.geometries['arc-reconstruction'].defaults;
        setVal('arc-operation', arc.operation);
        setVal('arc-reconstruct-toggle', arc.showReconstruction);
        setVal('arc-show-metadata', arc.showMetadata);
    }

    initializeViewStates() {
        ['boolean', 'letter-b', 'nested', 'offset', 'simplify', 'pcb-fusion', 'area', 'pip', 'minkowski', 'arc-reconstruction']
            .forEach(name => this.viewStates.set(name, false));
    }

    initializeEventHandlers() {
        // Boolean
        this.addChange('boolean-operation', (v) => {
            this.tests.updateTestState('boolean', 'operation', v);
            this.updateResult('boolean-result', 'Operation changed - click "Run Operation"');
        });
        this.addChange('boolean-clip-shape', (v) => {
            this.tests.updateTestState('boolean', 'clipShape', v);
            this.onShapeChange('boolean-clip-shape');
        });

        // Offset
        this.addChange('offset-shape', (v) => {
            this.tests.updateTestState('offset', 'shape', v);
            this.onShapeChange('offset-shape');
        });
        this.addChange('offset-type', (v) => {
            this.tests.updateTestState('offset', 'type', v);
            this.updateResult('offset-result', 'Settings changed - click "Apply Offset"');
        });
        this.addInput('offset-count', (v) => this.tests.updateTestState('offset', 'count', parseInt(v)));
        this.addInput('offset-distance', (v) => this.tests.updateTestState('offset', 'distance', parseFloat(v)));
        this.addChange('offset-join', (v) => this.tests.updateTestState('offset', 'joinType', v));
        this.addInput('offset-miter-limit', (v) => this.tests.updateTestState('offset', 'miterLimit', parseFloat(v)));

        // Simplify
        this.addInput('simplify-tolerance', (v) => {
            this.tests.updateTestState('simplify', 'tolerance', parseFloat(v));
            const disp = document.getElementById('simplify-tolerance-value');
            if (disp) disp.textContent = v;
        });

        // Minkowski
        this.addChange('minkowski-pattern', (v) => {
            this.tests.updateTestState('minkowski', 'pattern', v);
            this.updateResult('minkowski-result', 'Pattern changed - click "Calculate"');
        });
        this.addChange('minkowski-path', (v) => {
            this.tests.updateTestState('minkowski', 'path', v);
            this.updateResult('minkowski-result', 'Path changed - click "Calculate"');
        });
        this.addChange('minkowski-operation', (v) => {
            this.tests.updateTestState('minkowski', 'operation', v);
            this.updateResult('minkowski-result', 'Operation changed - click "Calculate"');
        });
        this.addChange('minkowski-sweep', (v) => this.tests.updateTestState('minkowski', 'showSweep', v), true);
        this.addChange('minkowski-offset', (v) => this.tests.updateTestState('minkowski', 'showOffset', v), true);

        // PIP
        this.addInput('pip-tolerance', (v) => {
            this.tests.updateTestState('pip', 'edgeTolerance', parseFloat(v));
            this.updateResult('pip-result', `Edge tolerance: ${v}px`);
        });

        // Arc Reconstruction
        this.addChange('arc-operation', (v) => {
            this.tests.updateTestState('arc-reconstruction', 'operation', v);
            this.updateResult('arc-reconstruction-result', 'Operation changed - click "Run Test"');
        });
        this.addChange('arc-reconstruct-toggle', (v) => this.tests.updateTestState('arc-reconstruction', 'showReconstruction', v), true);
        this.addChange('arc-show-metadata', (v) => this.tests.updateTestState('arc-reconstruction', 'showMetadata', v), true);

        // Setup canvas interactions
        this.setupDraggableBoolean();
        this.setupDraggableNested();
        this.setupDraggableArcReconstruction();
        this.setupPIPCanvas();
        this.setupAreaTest();
    }

    addChange(id, cb, isCheckbox = false) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', (e) => cb(isCheckbox ? e.target.checked : e.target.value));
    }

    addInput(id, cb) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', (e) => cb(e.target.value));
    }

    /**
     * Coordinate System
     */

    getCanvasCoordinates(event, canvas) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        };
    }

    /**
     * Boolean Dragging
     */

    setupDraggableBoolean() {
        const canvas = document.getElementById('boolean-canvas');
        if (!canvas) return;

        const handler = (e) => {
            const pos = this.getCanvasCoordinates(e, canvas);
            const state = this.tests.getTestState('boolean');
            const clipRadius = this.getClipRadius(state.clipShape);
            const dist = Math.hypot(pos.x - state.clipPos.x, pos.y - state.clipPos.y);

            if (e.type === 'mousedown') {
                if (dist <= clipRadius) {
                    this.dragInfo = { test: 'boolean', offset: { x: pos.x - state.clipPos.x, y: pos.y - state.clipPos.y } };
                    canvas.style.cursor = 'grabbing';
                }
            } else if (e.type === 'mousemove') {
                if (this.dragInfo?.test === 'boolean') {
                    this.tests.updateTestState('boolean', 'clipPos', {
                        x: pos.x - this.dragInfo.offset.x,
                        y: pos.y - this.dragInfo.offset.y
                    });
                    this.redrawDraggableCanvas('boolean');
                } else {
                    canvas.style.cursor = dist <= clipRadius ? 'grab' : 'default';
                }
            } else if (e.type === 'mouseup' || e.type === 'mouseleave') {
                if (this.dragInfo?.test === 'boolean') {
                    this.dragInfo = null;
                    canvas.style.cursor = 'default';
                    this.updateResult('boolean-result', 'Shape moved - click "Run Operation"');
                }
            }
        };
        
        ['mousedown', 'mousemove', 'mouseup', 'mouseleave'].forEach(evt => canvas.addEventListener(evt, handler));
    }

    /**
     * Nested Dragging
     */

    setupDraggableNested() {
        const canvas = document.getElementById('nested-canvas');
        if (!canvas) return;

        const hitTest = (p, x, y, w, h) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;

        const handler = (e) => {
            const pos = this.getCanvasCoordinates(e, canvas);
            const state = this.tests.getTestState('nested');

            if (e.type === 'mousedown') {
                if (hitTest(pos, state.island1Pos.x, state.island1Pos.y, 200, 200)) {
                    this.dragInfo = { test: 'nested', shape: 'island1', offset: { x: pos.x - state.island1Pos.x, y: pos.y - state.island1Pos.y } };
                } else if (hitTest(pos, state.island2Pos.x, state.island2Pos.y, 160, 160)) {
                    this.dragInfo = { test: 'nested', shape: 'island2', offset: { x: pos.x - state.island2Pos.x, y: pos.y - state.island2Pos.y } };
                }
                if (this.dragInfo) canvas.style.cursor = 'grabbing';
            } else if (e.type === 'mousemove') {
                if (this.dragInfo?.test === 'nested') {
                    const newPos = { x: pos.x - this.dragInfo.offset.x, y: pos.y - this.dragInfo.offset.y };
                    this.tests.updateTestState('nested', `${this.dragInfo.shape}Pos`, newPos);
                    this.redrawDraggableCanvas('nested');
                } else {
                    const over = hitTest(pos, state.island1Pos.x, state.island1Pos.y, 200, 200) ||
                                 hitTest(pos, state.island2Pos.x, state.island2Pos.y, 160, 160);
                    canvas.style.cursor = over ? 'grab' : 'default';
                }
            } else if (e.type === 'mouseup' || e.type === 'mouseleave') {
                if (this.dragInfo?.test === 'nested') {
                    this.dragInfo = null;
                    canvas.style.cursor = 'default';
                    this.updateResult('nested-result', 'Islands moved - click "Create Structure"');
                }
            }
        };

        ['mousedown', 'mousemove', 'mouseup', 'mouseleave'].forEach(evt => canvas.addEventListener(evt, handler));
    }

    /**
     * Arc Reconstruction Dragging
     */

    setupDraggableArcReconstruction() {
        const canvas = document.getElementById('arc-reconstruction-canvas');
        if (!canvas) return;

        const handler = (e) => {
            const pos = this.getCanvasCoordinates(e, canvas);
            const state = this.tests.getTestState('arc-reconstruction');
            const d1 = Math.hypot(pos.x - state.circle1Pos.x, pos.y - state.circle1Pos.y);
            const d2 = Math.hypot(pos.x - state.circle2Pos.x, pos.y - state.circle2Pos.y);

            if (e.type === 'mousedown') {
                if (d1 <= state.circle1Radius) {
                    this.dragInfo = { test: 'arc', shape: 'circle1', offset: { x: pos.x - state.circle1Pos.x, y: pos.y - state.circle1Pos.y } };
                } else if (d2 <= state.circle2Radius) {
                    this.dragInfo = { test: 'arc', shape: 'circle2', offset: { x: pos.x - state.circle2Pos.x, y: pos.y - state.circle2Pos.y } };
                }
                if (this.dragInfo) canvas.style.cursor = 'grabbing';
            } else if (e.type === 'mousemove') {
                if (this.dragInfo?.test === 'arc') {
                    const newPos = {
                        x: Math.max(50, Math.min(750, pos.x - this.dragInfo.offset.x)),
                        y: Math.max(50, Math.min(750, pos.y - this.dragInfo.offset.y))
                    };
                    this.tests.updateTestState('arc-reconstruction', `${this.dragInfo.shape}Pos`, newPos);
                    this.tests.drawDefaultArcReconstruction();
                } else {
                    canvas.style.cursor = (d1 <= state.circle1Radius || d2 <= state.circle2Radius) ? 'grab' : 'default';
                }
            } else if (e.type === 'mouseup' || e.type === 'mouseleave') {
                if (this.dragInfo?.test === 'arc') {
                    this.dragInfo = null;
                    canvas.style.cursor = 'default';
                    this.updateResult('arc-reconstruction-result', 'Circles moved - click "Run Test"');
                }
            }
        };

        ['mousedown', 'mousemove', 'mouseup', 'mouseleave'].forEach(evt => canvas.addEventListener(evt, handler));
    }

    /**
     * PIP Canvas Setup
     */

    setupPIPCanvas() {
        const canvas = document.getElementById('pip-canvas');
        if (!canvas) return;

        canvas.onclick = (e) => {
            const pos = this.getCanvasCoordinates(e, canvas);
            this.tests.testState.pip.points.push({ x: pos.x, y: pos.y, status: 'unchecked' });

            const ctx = canvas.getContext('2d');
            ctx.fillStyle = this.tests.rendering.resolveStyleValue('var(--input-stroke)') || '#6b7280';
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
            ctx.fill();

            this.updateResult('pip-result', `${this.tests.testState.pip.points.length} points added`);
        };

        this.tests.testPointInPolygon();
    }

    /**
     * Area Test Setup
     */

    setupAreaTest() {
        const canvas = document.getElementById('area-canvas');
        if (!canvas) return;

        this.tests.initializeAreaTest();

        canvas.onclick = (e) => {
            if (!this.tests.testState.area.isDrawing) return;

            const pos = this.getCanvasCoordinates(e, canvas);
            this.tests.testState.area.points.push(pos);

            const ctx = canvas.getContext('2d');
            const def = this.defaults.geometries.area;
            const stroke = this.tests.rendering.resolveStyleValue('var(--shape-stroke)') || '#3b82f6';

            // Draw point
            ctx.fillStyle = stroke;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, def.pointRadius, 0, Math.PI * 2);
            ctx.fill();

            // Draw line to previous point
            const pts = this.tests.testState.area.points;
            if (pts.length > 1) {
                const prev = pts[pts.length - 2];
                ctx.strokeStyle = stroke;
                ctx.lineWidth = 2;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(prev.x, prev.y);
                ctx.lineTo(pos.x, pos.y);
                ctx.stroke();
            }

            this.updateResult('area-result', 
                `${pts.length} points. ${pts.length >= def.minPoints ? 'Ready to calculate.' : 'Need more points.'}`);
        };
    }

    /**
     * Helpers
     */

    getClipRadius(shape) {
        const def = this.defaults.geometries.boolean.clips[shape];
        if (!def) return 160;
        return def.boundingRadius || def.radius || def.outerRadius || 160;
    }

    redrawDraggableCanvas(testName) {
        const canvas = document.getElementById(`${testName}-canvas`);
        if (!canvas) return;

        const state = this.tests.getTestState(testName);

        if (testName === 'boolean') {
            const shapes = {
                subject: {
                    type: 'rect',
                    x: state.subjectPos.x - 200,
                    y: state.subjectPos.y - 200,
                    width: 400,
                    height: 400,
                    color: 'var(--subject-stroke)'
                }
            };

            const clipShape = state.clipShape;
            const clipDef = this.defaults.geometries.boolean.clips[clipShape];
            const clipColor = 'var(--clip-stroke)';

            if (clipShape === 'circle') {
                shapes.clip = { type: 'circle', x: state.clipPos.x, y: state.clipPos.y, radius: clipDef.radius, color: clipColor };
            } else if (clipShape === 'random' && state.randomShape) {
                shapes.clip = { type: 'polygon', coords: state.randomShape.map(p => [p[0] + state.clipPos.x, p[1] + state.clipPos.y]), color: clipColor };
            } else if (clipShape === 'rabbit' && this.tests.rabbitPath) {
                shapes.clip = { type: 'polygon', coords: this.tests.rabbitPath.map(p => [p[0] + state.clipPos.x, p[1] + state.clipPos.y]), color: clipColor };
            } else if (clipDef?.data) {
                shapes.clip = { type: 'polygon', coords: clipDef.data.map(p => [p[0] + state.clipPos.x, p[1] + state.clipPos.y]), color: clipColor };
            } else if (clipShape === 'star') {
                const coords = this.defaults.generators.star(state.clipPos.x, state.clipPos.y, clipDef.outerRadius, clipDef.innerRadius, clipDef.points);
                shapes.clip = { type: 'polygon', coords, color: clipColor };
            }

            this.tests.rendering.drawShapePreview(shapes, canvas);

        } else if (testName === 'nested') {
            this.tests.rendering.clearCanvas(canvas);
            const ctx = canvas.getContext('2d');

            // Frame
            ctx.fillStyle = this.tests.rendering.resolveStyleValue('var(--shape-fill)') || 'rgba(59,130,246,0.25)';
            ctx.strokeStyle = this.tests.rendering.resolveStyleValue('var(--shape-stroke)') || '#3b82f6';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.rect(100, 100, 600, 600);
            ctx.rect(200, 200, 400, 400);
            ctx.fill('evenodd');
            ctx.stroke();

            // Island 1
            ctx.fillStyle = 'rgba(16,185,129,0.4)';
            ctx.strokeStyle = '#10b981';
            ctx.beginPath();
            ctx.rect(state.island1Pos.x, state.island1Pos.y, 200, 200);
            ctx.rect(state.island1Pos.x + 60, state.island1Pos.y + 60, 80, 80);
            ctx.fill('evenodd');
            ctx.stroke();

            // Island 2
            ctx.fillStyle = 'rgba(245,158,11,0.4)';
            ctx.strokeStyle = '#f59e0b';
            ctx.beginPath();
            ctx.rect(state.island2Pos.x, state.island2Pos.y, 160, 160);
            ctx.rect(state.island2Pos.x + 40, state.island2Pos.y + 40, 80, 80);
            ctx.fill('evenodd');
            ctx.stroke();
        }
    }

    drawAllDefaults() {
        this.tests.drawDefaultBoolean();
        this.tests.drawDefaultLetterB();
        this.tests.drawDefaultNested();
        this.tests.drawDefaultOffset();
        this.tests.drawDefaultSimplify();
        this.tests.drawDefaultPCB();
        this.tests.drawDefaultPIP();
        this.tests.drawDefaultMinkowski();
        this.tests.drawDefaultArea();
        this.tests.drawDefaultArcReconstruction();
    }

    onShapeChange(selectId) {
        const testName = selectId.includes('offset') ? 'offset' : 'boolean';
        this.tests.testData.delete(`${testName}-output`);

        if (testName === 'offset') {
            this.tests.rendering.clearCanvas('offset-canvas');
            this.tests.drawDefaultOffset();
        } else if (testName === 'boolean') {
            const state = this.tests.getTestState('boolean');
            if (state.clipShape === 'random') {
                const def = this.defaults.geometries.boolean.clips.random;
                const rnd = this.defaults.generators.randomConvex(0, 0, def.avgRadius, def.variance, def.points);
                this.tests.updateTestState('boolean', 'randomShape', rnd);
            } else {
                this.tests.updateTestState('boolean', 'randomShape', null);
            }
            this.redrawDraggableCanvas('boolean');
        }

        this.updateResult(`${testName}-result`, 'Shape changed - click "Run"');
    }

    resetView(testName) {
        const state = this.tests.getTestState(testName);

        switch (testName) {
            case 'boolean':
                const bOp = document.getElementById('boolean-operation');
                if (bOp) bOp.value = state.operation || 'union';
                const bClip = document.getElementById('boolean-clip-shape');
                if (bClip) bClip.value = state.clipShape || 'circle';
                break;

            case 'offset':
                const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
                setVal('offset-shape', state.shape);
                setVal('offset-type', state.type);
                setVal('offset-count', state.count);
                setVal('offset-distance', state.distance);
                setVal('offset-join', state.joinType);
                setVal('offset-miter-limit', state.miterLimit);
                break;

            case 'simplify':
                const sTol = document.getElementById('simplify-tolerance');
                if (sTol) sTol.value = state.tolerance;
                const sDisp = document.getElementById('simplify-tolerance-value');
                if (sDisp) sDisp.textContent = state.tolerance;
                break;

            case 'minkowski':
                const setM = (id, val) => { 
                    const el = document.getElementById(id); 
                    if (el) el.type === 'checkbox' ? el.checked = val : el.value = val; 
                };
                setM('minkowski-pattern', state.pattern);
                setM('minkowski-path', state.path);
                setM('minkowski-operation', state.operation);
                setM('minkowski-sweep', state.showSweep);
                setM('minkowski-offset', state.showOffset);
                break;

            case 'arc-reconstruction':
                const aOp = document.getElementById('arc-operation');
                if (aOp) aOp.value = state.operation;
                const aRec = document.getElementById('arc-reconstruct-toggle');
                if (aRec) aRec.checked = state.showReconstruction;
                const aMeta = document.getElementById('arc-show-metadata');
                if (aMeta) aMeta.checked = state.showMetadata;
                break;

            case 'pip':
                const pipTol = document.getElementById('pip-tolerance');
                if (pipTol) pipTol.value = state.edgeTolerance;
                break;
        }
    }

    hideLoading() {
        const loading = document.getElementById('loading');
        if (loading) loading.classList.remove('active');
    }

    showError(message) {
        const loading = document.getElementById('loading');
        if (loading) {
            loading.innerHTML = `
                <div style="color:#ef4444;text-align:center;padding:2rem;">
                    <h2>⚠️ Error</h2>
                    <p>${message}</p>
                    <button onclick="location.reload()" class="btn btn-primary">Reload</button>
                </div>`;
            loading.classList.add('active');
        }
    }

    getViewState(testName) { return this.viewStates.get(testName) || false; }
    setViewState(testName, val) { this.viewStates.set(testName, val); }

    updateResult(elementId, message) {
        const el = document.getElementById(elementId);
        if (el) {
            el.textContent = message;

            const testName = elementId.replace('-result', '');
            const card = document.querySelector(`[data-test="${testName}"]`);
            if (card) {
                if (message.includes('[OK]')) card.dataset.status = 'success';
                else if (message.includes('[ERROR]')) card.dataset.status = 'error';
                else if (message.includes('[WARNING]') || message.includes('changed') || message.includes('moved')) {
                    card.dataset.status = 'pending';
                }
            }
        }
    }

    updateInfo(elementId, info) {
        const el = document.getElementById(elementId);
        if (el) el.textContent = info;
    }

    setLabel(elementId, text) {
        const el = document.getElementById(elementId);
        if (el) el.textContent = text;
    }
}