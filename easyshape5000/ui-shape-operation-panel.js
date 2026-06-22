/*!
 * @file        easyshape5000/ui-shape-operation-panel.js
 * @description Operation parameter panel for EasyShape5000.
 *              Parallel to ui/ui-operation-panel.js (EasyTrace5000).
 *              Renders staged parameter forms for the selected shape's
 *              assigned operation. Emits events for mutations —
 *              the controller decides what to execute.
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 *
 * SPDX-FileCopyrightText: 2025-2026 Eltryus - Ricardo Marques
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

(function() {
    'use strict';

    // REVIEW - Work these into the theme, same as EasyTrace5000
    const OP_COLORS = {
        profile: 'var(--color-op-profile)',
        pocket:  'var(--color-op-pocket)',
        drill:   'var(--color-op-drill)',
        engrave: 'var(--color-op-engrave)',
        vcarve:  'var(--color-op-vcarve)',
        pattern: 'var(--color-accent-primary)'
    };

    const COMING_SOON_OPS = new Set(['pattern']);

    class ShapeOperationPanel extends BaseOperationPanel {
        constructor(ui) {
            super(ui);

            this.scene = null;
            this.selection = null;
        }

        // ═══════════════════════════════════════════════════════════════
        // Hook Overrides
        // ═══════════════════════════════════════════════════════════════

        getIdPrefix() { return 'op-'; }

        getFormContainer() { return document.getElementById('operation-form-container'); }

        getPipelineType() { return 'cnc'; }

        init(scene, selection, core, paramManager, appProfile, lang) {
            this.scene = scene;
            this.selection = selection;
            this.initBase(core, paramManager, appProfile, lang);
        }

        normalizeForCommit(resolved) {
            // Shape panel: resolved is the shape node, operation is nested
            const shape = resolved;
            if (!shape?.operation) return null;
            // Also persist to the shape's local params via saveToSelection
            this.saveToSelection(shape.operation.type);
            return {
                id: shape.id,
                type: shape.operation.type,
                settings: shape.operation.params || {}
            };
        }

        onMillHolesToggle(value) {
            const container = this.getFormContainer();
            if (container) {
                const values = this.parameterManager.getAllParameters(this.currentOperationId);
                ParameterManager.evaluateConditionals(container, values);
            }
            this.ui.setStatus(`Switched to ${value ? 'milling' : 'pecking'} mode`, 'info');
        }

        // ═══════════════════════════════════════════════════════════════
        // showOperationProperties
        // ═══════════════════════════════════════════════════════════════

        /**
         * Renders the operation form for the given shape into the container.
         *
         * @param {HTMLElement} container  The #operation-form-container element
         * @param {Object}      shape      The anchor shape from selection
         * @param {string}      stage      'geometry' | 'strategy' | 'machine'
         */
        showOperationProperties(container, shape, stage = 'geometry') {
            if (!shape?.operation) {
                this.clearProperties();
                if (container) container.innerHTML = '';
                return;
            }

            const isSameShape = this.currentOperationId === shape.id;

            if (!isSameShape) {
                // Persist outgoing state before switching
                if (this.currentOperationId) this.saveCurrentState();
                this.currentOperationId = shape.id;

                // Load incoming shape's params into ParameterManager
                this.parameterManager.loadFromOperation({
                    id: shape.id,
                    type: shape.operation.type,
                    settings: shape.operation.params || {}
                });
            }

            this.currentStage = stage;

            if (!container) return;
            container.innerHTML = '';

            const opType = shape.operation.type;
            const values = this.parameterManager.getAllParameters(shape.id);

            // Mixed-operation warning
            this.renderMixedOpWarning(container, opType);

            // Header with operation name + remove button
            this.renderHeader(container, opType);

            // Parameter form (shared)
            this.renderParameterForm(container, opType, stage, values);

            // Action button
            const actionInfo = this.getActionButtonInfo(stage, opType);
            if (actionInfo) {
                container.appendChild(this.createActionButton(actionInfo.text, actionInfo.disabled));
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // Fresh Selection + Bucket Stage
        // ═══════════════════════════════════════════════════════════════

        showFreshSelection(container, shapeId, opType) {
            this.currentOperationId = shapeId;
            this.currentStage = 'geometry';
            container.innerHTML = '';

            // Seed PM state with full default cascade so captureFormStateForId
            // can read toolDiameter and all other defaults. Without this,
            // getAllParameters() returns {} and offset distances become NaN.
            this.parameterManager.loadFromOperation({
                id: shapeId,
                type: opType,
                settings: {}
            });

            const values = this.parameterManager.getAllParameters(shapeId);
            this.renderParameterForm(container, opType, 'geometry', values);

            const wrapper = document.createElement('div');
            wrapper.className = 'property-actions';
            const btn = document.createElement('button');
            btn.className = 'btn btn--primary btn--block';
            btn.id = 'action-button';
            btn.textContent = 'Generate Offsets';
            btn.addEventListener('click', () => this.emit('createAndGenerate', { shapeId, opType }));
            wrapper.appendChild(btn);
            container.appendChild(wrapper);
        }

        /**
         * Renders params for a specific stage of an existing bucket.
         */
        showBucketStage(container, bucket, stage) {
            this.currentOperationId = bucket.shapeRefs[0] || null;
            this.currentStage = stage;
            container.innerHTML = '';

            const opType = bucket.type;

            // Map bucket UI stages to parameter-definition stages
            const paramStage = stage === 'offsets' ? 'strategy'
                             : stage === 'preview' ? 'machine'
                             : 'geometry';

            // Load bucket settings into parameter manager
            this.parameterManager.loadFromOperation({
                id: bucket.id, type: opType, settings: bucket.settings
            });

            // Header
            const header = document.createElement('div');
            header.className = 'param-form-header';
            const title = document.createElement('span');
            title.className = 'op-title';
            title.style.color = OP_COLORS[opType] || 'inherit';
            title.textContent = opType.charAt(0).toUpperCase() + opType.slice(1) + ' — ' + bucket.label;
            header.appendChild(title);
            container.appendChild(header);

            // Render Parameter form
            const values = this.parameterManager.getAllParameters(bucket.id);
            this.renderParameterForm(container, opType, paramStage, values);

            // Stage-appropriate action button
            const actionInfo = this.getBucketActionInfo(stage, bucket);
            if (actionInfo) {
                const wrapper = document.createElement('div');
                wrapper.className = 'property-actions';
                const btn = document.createElement('button');
                btn.className = 'btn btn--primary btn--block';
                btn.id = 'action-button';
                btn.textContent = actionInfo.text;
                btn.disabled = actionInfo.disabled;
                btn.addEventListener('click', () => this.emit('bucketAction', { bucketId: bucket.id, stage }));
                wrapper.appendChild(btn);
                container.appendChild(wrapper);
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // Action Dispatch
        // ═══════════════════════════════════════════════════════════════

        resolveCurrentOperation() {
            const shape = this.scene.findShape(this.currentOperationId);
            return shape?.operation ? shape : null;
        }

        resolveOperationType(operation) {
            return operation?.operation?.type || '';
        }

        getSpinnerLabel(stage, opType) {
            if (stage === 'geometry') return 'Generating... pass 1';
            if (stage === 'strategy') return 'Generating preview...';
            return null;
        }

        async onGenerationSuccess(opId, operation) {
            if (this.ui.rebuildLayers) this.ui.rebuildLayers();
        }

        onGenerationFailure(opId, operation, stage) {
            const container = this.getFormContainer();
            if (container) this.showOperationProperties(container, operation, stage);
        }

        async onPreviewSuccess(opId, operation) {
            if (this.ui.rebuildLayers) this.ui.rebuildLayers();
        }

        onStageTransition(newStage) {
            this.emit('stageChanged', newStage);
        }

        onExportStage(opId, operation) {
            this.emit('openExportManager', { opType: this.resolveOperationType(operation) });
        }

        // ═══════════════════════════════════════════════════════════════
        // Button Info
        // ═══════════════════════════════════════════════════════════════

        getActionButtonInfo(stage, opType) {
            if (COMING_SOON_OPS.has(opType)) {
                return { text: 'Coming Soon', disabled: true };
            }

            if (stage === 'geometry') {
                const labels = {
                    profile: 'Generate Profile Path',
                    pocket: 'Generate Pocket Paths',
                    drill: 'Generate Drill Strategy',
                    vcarve: 'Generate V-Carve Paths',
                    engrave: 'Generate Engrave Path',
                    pattern: 'Generate Pattern'
                };
                return { text: labels[opType] || 'Generate', disabled: false };
            }
            if (stage === 'strategy') return { text: 'Generate Preview', disabled: false };
            if (stage === 'machine') return { text: 'Export Manager', disabled: false };
            return null;
        }

        getBucketActionInfo(stage, bucket) {
            if (stage === 'geometry') return { text: bucket.hasOffsets ? 'Regenerate Offsets' : 'Generate Offsets', disabled: false };
            if (stage === 'offsets')  return { text: 'Generate Preview', disabled: !bucket.hasOffsets };
            if (stage === 'preview')  return { text: 'Export Manager', disabled: !bucket.hasPreview };
            return null;
        }

        // ═══════════════════════════════════════════════════════════════
        // Save & Capture
        // ═══════════════════════════════════════════════════════════════

        saveToSelection(opType) {
            const pm = this.parameterManager;
            if (!pm) return;

            const defs = pm.parameterDefinitions;
            const prefix = this.getIdPrefix();
            const values = {};

            for (const [name, def] of Object.entries(defs)) {
                if (!def.stage) continue;
                if (def.operationType && def.operationType !== opType) continue;
                if (def.operationTypes && !def.operationTypes.includes(opType)) continue;

                const el = document.getElementById(`${prefix}${name}`);
                if (!el) continue;

                let rawVal;
                if (def.type === 'checkbox') rawVal = el.checked;
                else if (def.type === 'number') rawVal = parseFloat(el.value) || def.default || 0;
                else rawVal = el.value;

                // Validate and clamp
                if (pm.validators[name]) {
                    const result = pm.validators[name](rawVal);
                    values[name] = result.correctedValue !== undefined ? result.correctedValue : (result.value ?? rawVal);
                    if (result.correctedValue !== undefined && el) el.value = result.correctedValue;
                } else {
                    values[name] = rawVal;
                }
            }

            // Write to all selected shapes of the same operation type
            for (const id of this.selection.toArray()) {
                const s = this.scene.findShape(id);
                if (!s?.operation || s.operation.type !== opType) continue;
                s.operation.params = { ...s.operation.params, ...values };
            }
        }

        captureFormStateForId(targetId, opType) {
            // Flush any pending debounced save
            clearTimeout(this.changeTimeout);

            // PM state is already current — onParameterChange writes on every input.
            // Just copy from current operation's PM state to the target.
            const pm = this.parameterManager;
            const sourceValues = pm.getAllParameters(this.currentOperationId);
            const defs = pm.parameterDefinitions;
            const captured = {};

            for (const [name, def] of Object.entries(defs)) {
                if (!def.stage) continue;
                if (def.operationType && def.operationType !== opType) continue;
                if (def.operationTypes && !def.operationTypes.includes(opType)) continue;
                if (sourceValues[name] !== undefined) {
                    pm.setParameter(targetId, def.stage, name, sourceValues[name]);
                    captured[name] = sourceValues[name];
                }
            }

            // Also persist to shapes for multi-selection consistency
            for (const id of this.selection.toArray()) {
                const s = this.scene.findShape(id);
                if (!s?.operation || s.operation.type !== opType) continue;
                s.operation.params = { ...s.operation.params, ...captured };
            }

            return captured;
        }

        // ═══════════════════════════════════════════════════════════════
        // Rendering Helpers
        // ═══════════════════════════════════════════════════════════════

        renderMixedOpWarning(container, opType) {
            const selIds = this.selection.toArray();
            const opTypes = new Set();
            for (const id of selIds) {
                const s = this.scene.findShape(id);
                if (s?.operation?.type) opTypes.add(s.operation.type);
            }
            if (opTypes.size <= 1) return;

            const warn = document.createElement('div');
            warn.className = 'warning-panel warning-panel--inline';
            warn.textContent = `Mixed operations selected. Changes apply only to ${opType} shapes.`;
            container.appendChild(warn);
        }

        renderHeader(container, opType) {
            const header = document.createElement('div');
            header.className = 'param-form-header';

            const title = document.createElement('span');
            title.className = 'op-title';
            title.style.color = OP_COLORS[opType] || 'inherit';
            title.textContent = opType.charAt(0).toUpperCase() + opType.slice(1);
            header.appendChild(title);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'op-clear';
            removeBtn.textContent = 'Remove';
            removeBtn.addEventListener('click', () => this.emit('clearOp'));
            header.appendChild(removeBtn);

            container.appendChild(header);
        }
    }

    window.ShapeOperationPanel = ShapeOperationPanel;
})();