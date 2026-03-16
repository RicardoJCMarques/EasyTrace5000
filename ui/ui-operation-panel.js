/*!
 * @file        ui/ui-operation-panel.js
 * @description Parameter input builder (right sidebar)
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
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

(function() {
    'use strict';

    const config = window.PCBCAMConfig;
    const textConfig = config.ui.text;
    const iconConfig = config.ui.icons;
    const inspectorConfig = config.ui.operationPanel;
    const timingConfig = config.ui.timing;
    const layoutConfig = config.layout;

    class OperationPanel {
        constructor(ui) {
            this.ui = ui;
            this.core = ui.core;
            this.lang = ui.lang;
            this.toolLibrary = null;
            this.parameterManager = null;

            this.currentOperation = null;
            this.currentGeometryStage = 'geometry';

            // Track input changes for auto-save
            this.changeTimeout = null;
        }

        init(toolLibrary, parameterManager) {
            this.toolLibrary = toolLibrary;
            this.parameterManager = parameterManager || new ParameterManager();

            // Listen for parameter changes from other sources
            this.parameterManager.addChangeListener((change) => {
                this.onExternalParameterChange(change);
            });

            this.debug('Initialized with parameter manager');
        }

        clearProperties() {
            this.currentOperation = null;
            this.currentGeometryStage = 'geometry';
        }

        setupPropertyGridNavigation(container) {
            const getNavigableItems = () => {
                return Array.from(container.querySelectorAll(
                    '.property-field, .tooltip-trigger, input:not([disabled]), select:not([disabled]), button:not([disabled])'
                )).filter(el => {
                    if (el.offsetParent === null) return false;
                    // Avoid duplicates: skip inputs/selects/buttons inside property-field if the field already exists
                    if (el.matches('input, select') && el.closest('.property-field')) {
                        return false; // Navigate to row first, then Enter to edit
                    }
                    return true;
                });
            };

            const items = getNavigableItems();
            if (items.length === 0) return;

            items.forEach((el, idx) => {
                el.setAttribute('tabindex', idx === 0 ? '0' : '-1');
            });

            container.addEventListener('keydown', (e) => {
                const focused = document.activeElement;
                if (!container.contains(focused)) return;

                const currentItems = getNavigableItems();
                const currentIdx = currentItems.indexOf(focused);

                const isEditing = focused.matches('input, select, textarea') && 
                                  focused.closest('.property-field');
                const isTooltip = focused.classList.contains('tooltip-trigger');

                // Up/Down: always navigate (except open select dropdown)
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    if (focused.tagName === 'SELECT') return; // let native handle

                    e.preventDefault();

                    // Close tooltip if open
                    if (window.TooltipManager) {
                        window.TooltipManager.hide();
                    }

                    const nextIdx = e.key === 'ArrowDown' ? currentIdx + 1 : currentIdx - 1;
                    if (currentItems[nextIdx]) {
                        focused.setAttribute('tabindex', '-1');
                        currentItems[nextIdx].setAttribute('tabindex', '0');
                        currentItems[nextIdx].focus();
                    }
                    return;
                }

                // Enter/Space on row: enter edit mode
                if ((e.key === 'Enter' || e.key === ' ') && focused.classList.contains('property-field')) {
                    e.preventDefault();
                    const input = focused.querySelector('input:not([disabled]), select:not([disabled])');
                    if (input) {
                        input.focus();
                        if (input.select) input.select();
                    }
                    return;
                }

                // Enter in input: commit and move to next item
                if (e.key === 'Enter' && isEditing && !focused.matches('textarea')) {
                    e.preventDefault();
                    focused.blur();
                    const nextIdx = currentIdx + 1;
                    if (currentItems[nextIdx]) {
                        currentItems[nextIdx].setAttribute('tabindex', '0');
                        currentItems[nextIdx].focus();
                    }
                    return;
                }

                // Escape: exit edit mode or close tooltip
                if (e.key === 'Escape') {
                    if (isEditing) {
                        e.preventDefault();
                        e.stopPropagation();
                        focused.blur();
                        const row = focused.closest('.property-field');
                        if (row) {
                            row.setAttribute('tabindex', '0');
                            row.focus();
                        }
                    } else if (isTooltip) {
                        e.preventDefault();
                        if (window.TooltipManager) {
                            window.TooltipManager.hide();
                        }
                        // Move to next item (typically the row below)
                        const nextIdx = currentIdx + 1;
                        if (currentItems[nextIdx]) {
                            focused.setAttribute('tabindex', '-1');
                            currentItems[nextIdx].setAttribute('tabindex', '0');
                            currentItems[nextIdx].focus();
                        }
                    }
                }
            });
        }

        showOperationProperties(operation, geometryStage = 'geometry') {
            if (!operation) {
                this.clearProperties();
                return;
            }

            // Auto-save current operation before switching
            if (this.currentOperation && this.currentOperation.id !== operation.id) {
                this.saveCurrentState();
            }

            this.currentOperation = operation;

            // Resolve pipeline type once
            const pipelineType = window.pcbcam?.pipelineState?.type || 'cnc';
            const isLaser = window.pcbcam?.isLaserPipeline?.() || false;

            // Remap CNC-originated stages to laser equivalents
            if (isLaser && (geometryStage === 'strategy' || geometryStage === 'machine')) {
                const isReady = window.pcbcam?.core?.isExportReady(operation);
                geometryStage = isReady ? 'export_summary' : 'geometry';
            }

            this.currentGeometryStage = geometryStage;

            // Export summary is display-only (no editable parameters)
            if (geometryStage === 'export_summary') {
                this.renderExportSummary(operation);
                return;
            }

            // Load existing parameters for this operation
            this.parameterManager.loadFromOperation(operation);

            const container = document.getElementById('property-form');
            const title = document.getElementById('inspector-title');

            if (!container || !title) return;

            title.textContent = operation.file.name;
            container.innerHTML = '';

            // Invalidation Warning Panel
            if (operation.isInvalidated) {
                const invalidPanel = this.createInvalidationPanel(operation);
                container.appendChild(invalidPanel);
            }

            // Show warnings if any
            if (operation.warnings && operation.warnings.length > 0) {
                container.appendChild(this.createWarningPanel(operation.warnings));
            }

            // Get appropriate parameters for this stage and operation type
            const stageParams = this.parameterManager.getStageParameters(geometryStage, operation.type, pipelineType);
            const currentValues = this.parameterManager.getParameters(operation.id, geometryStage);

            // Group parameters by category
            const categories = this.groupByCategory(stageParams);

            // Render each category
            for (const [category, params] of Object.entries(categories)) {
                const section = this.createSection(
                    this.getCategoryTitle(category),
                    params.map(param => this.createField(param, currentValues[param.name]))
                );
                container.appendChild(section);
            }

            // Add action button
            const actionText = this.getActionButtonText(geometryStage, operation.type);
            if (actionText) {
                container.appendChild(this.createActionButton(actionText));
            }

            this.attachEventHandlers(container);
            this.setupPropertyGridNavigation(container);
        }

        createInvalidationPanel(operation) {
            const template = document.getElementById('invalidation-panel-template');
            if (!template) return document.createElement('div'); // Fallback if template missing

            // Clone the template
            const panelNode = template.content.cloneNode(true);
            const panel = panelNode.querySelector('.invalidation-panel');
            const msg = panel.querySelector('.warning-message');
            const redoBtn = panel.querySelector('.invalidation-redo-btn');

            // Apply specific text
            msg.textContent = operation.invalidatedReason || 'Global machine settings have changed. Existing geometry is incompatible and must be regenerated.';

            // Attach functionality
            redoBtn.onclick = async () => {
                // Clear the invalid geometry data
                operation.offsets = [];
                operation.preview = null;
                operation.exportReady = false;
                operation.isInvalidated = false;
                operation.invalidatedReason = null;

                // Remove the old visual layers from the canvas renderer
                const layerKeys = Array.from(this.ui.renderer.layers.keys())
                    .filter(key => key.includes(`_${operation.id}_`));
                layerKeys.forEach(key => this.ui.renderer.layers.delete(key));

                // Update the Nav Tree to remove the red strike-through nodes
                if (this.ui.navTreePanel) {
                    const fileNode = this.ui.navTreePanel.getNodeByOperationId(operation.id);
                    if (fileNode) {
                        this.ui.navTreePanel.updateFileGeometries(fileNode.id, operation);
                    }
                }

                // Update canvas and reset side-panel view
                await this.ui.updateRendererAsync();
                this.switchGeometryStage('geometry');
                this.ui.showStatus('Invalid geometry cleared. Ready to regenerate.', 'success');
            };

            return panel;
        }

        groupByCategory(params) {
            const groups = {};
            for (const param of params) {
                const category = param.category || 'general';
                if (!groups[category]) groups[category] = [];
                groups[category].push(param);
            }
            return groups;
        }

        getCategoryTitle(category) {
            const categoryTitles = inspectorConfig.categories;
            const title = categoryTitles[category] || category.charAt(0).toUpperCase() + category.slice(1);
            return title;
        }

        getActionButtonText(stage, operationType) {
            const isLaser = window.pcbcam?.isLaserPipeline?.() || false;

            // Laser stages
            if (isLaser) {
                if (stage === 'geometry') {
                    if (operationType === 'cutout') return 'Generate Laser Cut Path';
                    if (operationType === 'drill') return 'Generate Drill Marks';
                    return 'Generate Laser Paths';
                }
                if (stage === 'export_summary') return 'Export Manager';
                return null;
            }

            // CNC stages
            if (stage === 'geometry') {
                if (operationType === 'drill') return 'Generate Drill Strategy';
                if (operationType === 'cutout') return 'Generate Cutout Path';
                return 'Generate Offsets';
            } else if (stage === 'strategy') {
                return 'Generate Preview';
            } else if (stage === 'machine') {
                return 'Export Manager';
            }
            return null;
        }

        createSection(title, fields) {
            const section = document.createElement('div');
            section.className = 'property-section';

            const h3 = document.createElement('h3');
            h3.textContent = title;
            section.appendChild(h3);

            fields.forEach(field => section.appendChild(field));

            return section;
        }

        createField(param, currentValue) {
            const field = document.createElement('div');
            field.className = 'property-field';
            field.dataset.param = param.name;

            // Handle conditionals
            if (param.conditional) {
                field.dataset.conditional = param.conditional;
                // Will be evaluated in attachEventHandlers
            }

            const inputId = `prop-${param.name}`;

            const label = document.createElement('label');
            label.setAttribute('for', inputId);

            // Use param.name as the key (e.g., "toolDiameter", "passes")
            const helpKey = param.name; 
            const labelText = this.lang.get('parameters.' + helpKey, param.label);
            label.textContent = labelText;
            field.appendChild(label);

            // Check if a helpKey exists and the strings have been loaded
            const tooltipKey = 'tooltips.parameters.' + helpKey;
            if (this.lang.has(tooltipKey)) {

                // Get the tooltip text from en.json
                const helpText = this.lang.get(tooltipKey);
                // The title is the label text just found
                const helpTitle = labelText; 

                if (helpText && window.TooltipManager) {
                    // This will create the '?' icon at the end of the label
                    window.TooltipManager.attachWithIcon(label, { title: helpTitle, text: helpText }, {
                        showOnFocus: true
                    });
                }
            }

            // Use default if no current value
            if (currentValue === undefined) {
                const defaults = this.parameterManager.getDefaults(this.currentOperation.type);
                currentValue = defaults[param.name];
            }

            // Hide spindle speed for machines without software spindle control
            if (param.name === 'spindleSpeed') {
                const postProcessor = this.core.settings?.gcode?.postProcessor;
                if (postProcessor === 'roland') {
                    const rolandModel = this.core.settings?.machine?.rolandModel || 'mdx50';
                    const profile = window.PCBCAMConfig?.roland?.getProfile?.(rolandModel);
                    if (profile && !profile.supportsRC) {
                        field.style.display = 'none';
                        return field; // Return hidden field, skip input creation
                    }
                }
            }

            switch (param.type) {
                case 'number':
                    this.createNumberField(field, param, currentValue);
                    break;
                case 'checkbox':
                    this.createCheckboxField(field, param, currentValue);
                    break;
                case 'select':
                    this.createSelectField(field, param, currentValue);
                    break;
                case 'textarea':
                    this.createTextAreaField(field, param, currentValue);
                    break;
                default:
                    console.warn(`[OperationPanel] Unknown parameter type: ${param.type}`);
            }

            return field;
        }

        createNumberField(field, param, value) {
            const wrapper = document.createElement('div');
            wrapper.className = 'input-unit';

            const input = document.createElement('input');
            input.type = 'number';
            input.id = `prop-${param.name}`;
            input.value = value ?? 0;
            if (param.min !== undefined) input.min = param.min;
            if (param.max !== undefined) input.max = param.max;
            if (param.step !== undefined) input.step = param.step;

            // If the parameter has a unit (e.g., "mm"), attach it with the label for screen readers
            if (param.unit) {
                input.setAttribute('aria-label', `${param.label} in ${param.unit}`);
            }

            if (param.readOnly) {
                input.readOnly = true;
                input.classList.add('input-readonly');
            }

            wrapper.appendChild(input);

            if (param.unit) {
                const unitSpan = document.createElement('span');
                unitSpan.className = 'unit';
                unitSpan.textContent = param.unit;
                unitSpan.setAttribute('aria-hidden', 'true'); // Hide visual unit from SR since it's in the label now
                wrapper.appendChild(unitSpan);
            }

            field.appendChild(wrapper);
        }

        createCheckboxField(field, param, value) {
            // Clear the label already added
            field.innerHTML = '';

            const label = document.createElement('label');
            label.className = 'checkbox-label';

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.id = `prop-${param.name}`;
            input.checked = value || false;

            const span = document.createElement('span');
            span.textContent = param.label;

            label.appendChild(input);
            label.appendChild(span);
            field.appendChild(label);
        }

        createSelectField(field, param, value) {
            const select = document.createElement('select');
            select.id = `prop-${param.name}`;

            // Special case for tool selection
            if (param.name === 'tool') {
                this.populateToolSelect(select, this.currentOperation.type, value);
            } else if (param.options) {
                param.options.forEach(opt => {
                    const option = document.createElement('option');
                    option.value = opt.value;
                    option.textContent = opt.label;
                    if (opt.value === value) option.selected = true;
                    select.appendChild(option);
                });
            }

            field.appendChild(select);
        }

        createTextAreaField(field, param, value) {
            const textarea = document.createElement('textarea');
            textarea.id = `prop-${param.name}`;
            textarea.rows = param.rows || 4;
            textarea.value = value || '';

            // Apply styles from config
            if (inspectorConfig.textAreaStyle) {
                Object.assign(textarea.style, inspectorConfig.textAreaStyle);
            }

            field.appendChild(textarea);
        }

        populateToolSelect(select, operationType, selectedId) {
            const tools = this.toolLibrary.getToolsForOperation(operationType) || [];

            if (tools.length === 0) {
                select.innerHTML = `<option>${textConfig.noToolsAvailable}</option>`;
                select.disabled = true;
                return;
            }

            tools.forEach(tool => {
                const option = document.createElement('option');
                option.value = tool.id;
                option.textContent = `${tool.name} (${tool.geometry.diameter}mm)`;
                option.dataset.diameter = tool.geometry.diameter;
                if (tool.id === selectedId) option.selected = true;
                select.appendChild(option);
            });
        }

        createWarningPanel(warnings) {
            const panel = document.createElement('div');
            panel.className = 'warning-panel';

            const header = document.createElement('div');
            if (inspectorConfig.warningHeaderCSS) {
                Object.assign(header.style, inspectorConfig.warningHeaderCSS);
            }

            const icon = iconConfig.treeWarning;
            header.innerHTML = `${icon} ${warnings.length} Warning${warnings.length > 1 ? 's' : ''}`;
            panel.appendChild(header);

            const list = document.createElement('ul');
            if (inspectorConfig.warningListCSS) {
                Object.assign(list.style, inspectorConfig.warningListCSS);
            }

            warnings.forEach(warning => {
                const item = document.createElement('li');
                item.textContent = warning.message;
                list.appendChild(item);
            });

            panel.appendChild(list);
            return panel;
        }

        createActionButton(text) {
            const wrapper = document.createElement('div');
            wrapper.className = 'property-actions';

            const button = document.createElement('button');
            button.className = 'btn btn--primary btn--block';
            button.id = 'action-button';
            button.textContent = text;

            wrapper.appendChild(button);
            return wrapper;
        }

        attachEventHandlers(container) {
            // Tool selection updates diameter
            const toolSelect = container.querySelector('#prop-tool');
            if (toolSelect) {
                toolSelect.addEventListener('change', (e) => {
                    const toolId = e.target.value;
                    const toolDiameter = this.toolLibrary?.getToolDiameter(toolId);

                    if (toolDiameter !== null && toolDiameter !== undefined) {
                        this.onParameterChange('tool', toolId);
                        this.onParameterChange('toolDiameter', toolDiameter);

                        const diamInput = container.querySelector('#prop-toolDiameter');
                        if (diamInput) {
                            diamInput.value = toolDiameter;
                        }
                    }
                });
            }

            // Attach handlers to all inputs
            container.querySelectorAll('input, select, textarea').forEach(input => {
                if (input.id === 'prop-tool') return; // Already handled above

                const paramName = input.id.replace('prop-', '');

                // Change event: Final validation and save
                input.addEventListener('change', () => {
                    const value = this.extractInputValue(input);
                    this.onParameterChange(paramName, value);
                });

                // Blur event: Also validate and save (catches tab-away without change)
                if (input.type === 'text' || input.type === 'number' || input.tagName === 'TEXTAREA') {
                    input.addEventListener('blur', () => {
                        const value = this.extractInputValue(input);
                        this.onParameterChange(paramName, value);
                        this.saveCurrentState();
                    });
                }

                // Input event: Only for visual feedback, no validation, no status messages
                // This allows free typing of intermediate values like "-", "0.", ".5"
                if (input.type === 'number') {
                    input.addEventListener('input', () => {
                        // Clear any previous error styling when user starts typing
                        input.classList.remove('input-error');
                    });
                }
            });

            // Mill holes toggle
            const millCheck = container.querySelector('#prop-millHoles');
            if (millCheck) {
                millCheck.addEventListener('change', async (e) => {
                    const isMilling = e.target.checked;
                    this.onParameterChange('millHoles', isMilling);

                    if (this.currentOperation) {
                        if (this.currentOperation.offsets?.length > 0) {
                            this.currentOperation.offsets = [];
                            this.currentOperation.preview = null;
                            this.currentOperation.warnings = [];
                        }
                    }

                    this.showOperationProperties(this.currentOperation, this.currentGeometryStage);
                    await this.ui.updateRendererAsync();

                    this.ui.showStatus(
                        `Switched to ${isMilling ? 'milling' : 'pecking'} mode`,
                        'info'
                    );
                });
            }

            // Action button
            const actionBtn = container.querySelector('#action-button');
            if (actionBtn) {
                actionBtn.addEventListener('click', () => this.handleAction());
            }

            // Initial conditional evaluation
            this.evaluateConditionals(container);
        }

        /**
         * Extracts and converts value from input element based on its type.
         */
        extractInputValue(input) {
            if (input.type === 'checkbox') {
                return input.checked;
            } else if (input.type === 'number') {
                const num = parseFloat(input.value);
                return isNaN(num) ? 0 : num;
            } else {
                return input.value;
            }
        }

        evaluateConditionals(container) {
            if (!this.currentOperation) return;
            const operation = this.currentOperation;
            const currentValues = this.parameterManager.getAllParameters(operation.id);

            container.querySelectorAll('[data-conditional]').forEach(field => {
                const conditional = field.dataset.conditional;
                let shouldShow = true;

                if (conditional.includes(':')) {
                    // Value-based conditional: "paramName:val1,val2,val3"
                    const colonIdx = conditional.indexOf(':');
                    const paramName = conditional.substring(0, colonIdx);
                    const allowedValues = conditional.substring(colonIdx + 1).split(',');
                    const currentVal = String(currentValues[paramName] ?? '');
                    shouldShow = allowedValues.includes(currentVal);
                } else if (conditional.startsWith('!')) {
                    const paramName = conditional.slice(1);
                    // Read the value from the manager, not the checkbox (which might be stale) // REVIEW - can checkboxes become stale?
                    shouldShow = !currentValues[paramName];
                } else {
                    shouldShow = !!currentValues[conditional];
                }

                field.style.display = shouldShow ? '' : 'none';
            });
        }

        onParameterChange(name, value, isRealtime = false) {
            if (!this.currentOperation) return;

            const operation = this.currentOperation;

            const result = this.parameterManager.setParameter(
                operation.id,
                this.currentGeometryStage,
                name,
                value
            );

            const inputEl = document.getElementById(`prop-${name}`);

            if (result.success) {
                // Clear error state
                if (inputEl) inputEl.classList.remove('input-error');

                // Clear status only if it was showing an error for this field
                if (this.ui.statusManager?.currentStatus?.type === 'error') {
                    this.ui.statusManager.updateStatus();
                }
            } else {
                // Show error and apply visual feedback
                if (!isRealtime) {
                    this.ui.showStatus(result.error, 'error');
                }

                if (inputEl) {
                    inputEl.classList.add('input-error');
                }

                // Apply corrected value to input
                if (result.correctedValue !== undefined && inputEl) {
                    inputEl.value = result.correctedValue;
                    inputEl.classList.remove('input-error'); // Corrected, no longer in error
                }
            }

            // Invalidate generated geometry when geometry-altering parameters change.
            // This prevents stale paths from being exported after parameter edits.
            if (operation && !isRealtime) {
                const paramDef = this.parameterManager.parameterDefinitions[name];
                if (paramDef && (paramDef.stage === 'geometry' || paramDef.stage === 'strategy')) {
                    const isReady = window.pcbcam?.core?.isExportReady(operation);

                    if (isReady) {
                        operation.exportReady = false;
                        if (operation.preview) {
                            operation.preview.ready = false;
                        }

                        // Update tree node to remove stale geometry indicators
                        if (this.ui.navTreePanel) {
                            const fileNode = this.ui.navTreePanel.getNodeByOperationId(operation.id);
                            if (fileNode) {
                                this.ui.navTreePanel.updateFileGeometries(fileNode.id, operation);
                            }
                        }

                        this.ui.showStatus(
                            'Parameters changed — regenerate paths before exporting.', 'warning'
                        );
                    }
                }
            }

            // Re-evaluate conditionals
            const container = document.getElementById('property-form');
            if (container) this.evaluateConditionals(container);

            // Debounced auto-save (not during realtime typing)
            if (result.success && !isRealtime) {
                clearTimeout(this.changeTimeout);
                const delay = timingConfig.propertyDebounce;
                this.changeTimeout = setTimeout(() => {
                    this.saveCurrentState();
                }, delay);
            }
        }

        onExternalParameterChange(change) {
            // Update UI if the change is for current operation/stage
            if (change.operationId === this.currentOperation?.id &&
                change.stage === this.currentGeometryStage) {
                const input = document.querySelector(`#prop-${change.name}`);
                if (input) {
                    if (input.type === 'checkbox') {
                        input.checked = change.value;
                    } else {
                        input.value = change.value;
                    }
                }
            }
        }

        saveCurrentState() {
            if (!this.currentOperation) return;
            const operation = this.currentOperation;

            // Commit to operation
            this.parameterManager.commitToOperation(operation);

            this.debug(`Saved state for operation ${operation.id}`);
        }

        async handleAction() {
            this.saveCurrentState();

            const operation = this.currentOperation;
            const stage = this.currentGeometryStage;
            const isLaser = window.pcbcam?.isLaserPipeline?.() || false;
            const transitionDelay = layoutConfig?.ui?.transitionDelay || 300;

            // ═══════════════════════════════════════
            // LASER PIPELINE
            // ═══════════════════════════════════════
            if (isLaser && stage === 'geometry') {
                // The offset engine is geometry-agnostic — generateLaserPaths translates laser params (spot size, isolation width) into offset engine inputs (toolDiameter, passes, stepOver).
                await this.generateLaserPaths(operation);

                // Mark operation as export-ready. In laser mode there's no separate preview step — the generated offsets ARE the exportable result.
                // Set preview.ready so the Export Manager can filter ready operations.
                if (operation.offsets && operation.offsets.length > 0) {
                    const allPrimitives = [];
                    operation.offsets.forEach(offset => {
                        offset.primitives.forEach(prim => {
                            if (!prim.properties) prim.properties = {};
                            prim.properties.isPreview = true;
                            allPrimitives.push(prim);
                        });
                    });

                    // Mark operation as export-ready, the Export Manager checks this flag for laser operations.
                    operation.exportReady = true;
                    operation.exportMetadata = {
                        generatedAt: Date.now(),
                        sourceOffsets: operation.offsets.length,
                        laserStrategy: operation.settings?.laserClearStrategy || 'offset'
                    };

                    this.ui.renderer?.setOptions({ showPreviews: true });
                    const previewToggle = document.getElementById('show-previews');
                    if (previewToggle) previewToggle.checked = true;

                    await this.ui.updateRendererAsync();
                    this.ui.showStatus('Laser paths generated — ready for export', 'success');
                }

                if (layoutConfig?.ui?.autoTransition) {
                    setTimeout(() => {
                        this.switchGeometryStage('export_summary');
                    }, transitionDelay);
                }

                this.returnFocusToTree();
                return;
            }

            if (isLaser && stage === 'export_summary') {
                const controller = window.pcbcam;
                if (controller?.modalManager) {
                    const readyOps = this.ui.core.operations.filter(o => this.ui.core.isExportReady(o));
                    if (readyOps.length === 0) {
                        this.ui.showStatus('No operations ready. Generate laser paths first.', 'warning');
                        return;
                    }
                    controller.modalManager.showModal('exportManager', { operations: readyOps, highlightOperationId: operation.id });
                }
                return;
            }

            // ═══════════════════════════════════════
            // CNC PIPELINE
            // ═══════════════════════════════════════
            if (stage === 'geometry') {
                if (operation.type === 'drill') {
                    await this.generateDrillStrategy(operation);
                } else if (operation.type === 'cutout') {
                    await this.generateCutoutOffset(operation);
                } else {
                    await this.generateOffsets(operation);
                }

                if (layoutConfig?.ui?.autoTransition) {
                    setTimeout(() => {
                        this.switchGeometryStage('strategy');
                    }, transitionDelay);
                }

                // Return focus to tree after action completes
                this.returnFocusToTree();

            } else if (stage === 'strategy') {
                // Strategy -> Machine
                try {
                    this.ui.showStatus('Generating toolpath preview...', 'info');
                    const previewSuccess = await this.generatePreview(operation);

                    if (!previewSuccess) return;

                    if (this.ui.navTreePanel) {
                        const fileNode = this.ui.navTreePanel.getNodeByOperationId(operation.id);
                        if (fileNode) {
                            this.ui.navTreePanel.updateFileGeometries(fileNode.id, operation);
                        }
                    }

                    await this.ui.updateRendererAsync();
                    this.ui.showStatus('Preview generated', 'success');

                    if (layoutConfig?.ui?.autoTransition) {
                        setTimeout(() => {
                            this.switchGeometryStage('machine');
                        }, transitionDelay);
                    }

                    // Return focus to tree
                    this.returnFocusToTree();

                } catch (error) {
                    console.error('[OperationPanel] Preview generation failed:', error);
                    this.ui.showStatus('Preview failed: ' + error.message, 'error');
                }

            } else if (stage === 'machine') {
                const controller = window.pcbcam;
                if (controller?.modalManager) {
                    const readyOps = this.ui.core.operations.filter(o => this.ui.core.isExportReady(o));
                    if (readyOps.length === 0) {
                        this.ui.showStatus('No operations ready. Generate previews first.', 'warning');
                        return;
                    }
                    controller.modalManager.showModal('exportManager', { operations: readyOps, highlightOperationId: operation.id });
                } else {
                    this.ui.showStatus('Export manager not available', 'error');
                }
            }
        }

        returnFocusToTree() {
            const selected = document.querySelector(
                '.file-node-content.selected, .geometry-node-content.selected, .geometry-node.selected'
            );
            if (selected) {
                const focusTarget = selected.querySelector('.file-node-content, .geometry-node-content') || selected;
                focusTarget.setAttribute('tabindex', '0');
                focusTarget.focus();
            }
        }

        switchGeometryStage(newStage) {
            const pipelineType = window.pcbcam?.pipelineState?.type || 'cnc';
            const validStages = this.parameterManager.getStagesForPipeline(pipelineType);
            // Also accept CNC stages so hybrid doesn't break
            const allValid = [...new Set([...validStages, 'geometry', 'strategy', 'machine', 'export_summary'])];

            if (!allValid.includes(newStage)) {
                console.warn(`[OperationPanel] Invalid geometry stage: ${newStage}`);
                return;
            }

            this.currentGeometryStage = newStage;

            if (this.currentOperation) {
                // All stages (including export_summary) route through showOperationProperties
                this.showOperationProperties(this.currentOperation, newStage);
            }
        }

        async generateOffsets(operation) {
            const params = this.parameterManager.getAllParameters(operation.id);

            // Show the spinner (and update status)
            this.ui.showCanvasSpinner('Generating offsets...');

            // Wait for 10ms. This yields to the event loop and gives the browser time to render the spinner
            await new Promise(resolve => setTimeout(resolve, 10));

            try {
                // Run the heavy task
                await this.core.generateOffsetGeometry(operation, params);

                if (this.ui.navTreePanel) {
                    const fileNode = this.ui.navTreePanel.getNodeByOperationId(operation.id);
                    if (fileNode) {
                        this.ui.navTreePanel.updateFileGeometries(fileNode.id, operation);
                    }
                }
                await this.ui.updateRendererAsync();
                this.ui.showStatus(`Generated ${operation.offsets.length} offset(s)`, 'success');
            } catch (error) {
                console.error('[OperationPanel] Offset generation failed:', error);
                this.ui.showStatus('Failed: ' + error.message, 'error');
            } finally {
                // Hide the spinner (this runs on success OR failure)
                this.ui.hideCanvasSpinner();
            }
        }

        async generateDrillStrategy(operation) {
            const params = this.parameterManager.getAllParameters(operation.id);
            this.ui.showStatus(
                params.millHoles ? 'Generating milling paths...' : 'Generating peck positions...',
                'info'
            );
            try {
                await this.core.generateDrillStrategy(operation, params);
                if (this.ui.navTreePanel) {
                    const fileNode = this.ui.navTreePanel.getNodeByOperationId(operation.id);
                    if (fileNode) {
                        this.ui.navTreePanel.updateFileGeometries(fileNode.id, operation);
                    }
                }
                await this.ui.updateRendererAsync();
                if (operation.warnings?.length > 0) {
                    this.ui.showStatus(
                        `Generated with ${operation.warnings.length} warning(s)`,
                        'warning'
                    );
                    this.showOperationProperties(operation, this.currentGeometryStage);
                } else {
                    const count = operation.offsets[0]?.primitives.length || 0;
                    const mode = params.millHoles ? 'milling paths' : 'peck positions';
                    this.ui.showStatus(`Generated ${count} ${mode}`, 'success');
                }
            } catch (error) {
                console.error('[OperationPanel] Drill strategy generation failed:', error);
                this.ui.showStatus('Failed: ' + error.message, 'error');
            }
        }

        async generateCutoutOffset(operation) {
            const params = this.parameterManager.getAllParameters(operation.id);
            this.ui.showStatus('Generating cutout path...', 'info');

            try {
                // Pass the params object as the settings.
                await this.core.generateOffsetGeometry(operation, params);

                if (this.ui.navTreePanel) {
                    const fileNode = this.ui.navTreePanel.getNodeByOperationId(operation.id);
                    if (fileNode) {
                        this.ui.navTreePanel.updateFileGeometries(fileNode.id, operation);
                    }
                }

                await this.ui.updateRendererAsync();
                this.ui.showStatus('Cutout path generated', 'success');
            } catch (error) {
                console.error('[OperationPanel] Cutout offset failed:', error);
                this.ui.showStatus('Failed: ' + error.message, 'error');
            }
        }

        /**
         * Translates laser parameters into offset engine inputs. The offset engine is geometry-agnostic — it works with toolDiameter/passes/stepOver regardless of whether the "tool" is a mill bit or a laser spot.
         */
        async generateLaserPaths(operation) {
            const params = this.parameterManager.getAllParameters(operation.id);

            const exportFormat = window.pcbcam.core.settings.laser.exportFormat;

            const spotSize = params.laserSpotSize;
            const stepOverPct = exportFormat === 'png' ? 0 : (params.laserStepOver);
            const stepDistance = spotSize * (1 - stepOverPct / 100);
            const strategy = exportFormat === 'png' ? 'filled' : (params.laserClearStrategy);

            // Build settings object — shared fields
            const laserSettings = {
                toolDiameter: spotSize,
                stepOver: stepOverPct,
                stepDistance: stepDistance,
                clearStrategy: strategy,
                hatchAngle: params.laserHatchAngle,
                hatchPasses: params.laserHatchPasses,
                combineOffsets: true
            };

            // Per-operation-type configuration
            if (operation.type === 'cutout' || operation.type === 'drill') {
                // Cutout and drill: single-pass offset with cut-side control
                laserSettings.passes = 1;
                laserSettings.cutSide = params.laserCutSide || (operation.type === 'drill' ? 'inside' : 'outside');
                laserSettings.clearStrategy = 'offset';

            } else if (operation.type === 'clearing') {
                // Clearing: fill the source geometry inward according to selected strategy.
                // The operation's own primitives define the clearing zone.
                laserSettings.clearStrategy = strategy;

                switch (strategy) {
                    case 'offset':
                        // REVIEW - BECAUSE THERE'S NO SELF INTERSECTING SAFEGUARDS THIS ALMOST ALWAYS GENERATES CORRUPTED GEOMETRY - MAY NEED USER PASS INPUT UNTIL AUTOMATED
                        // Auto-calculate passes to fill the entire geometry with concentric inward offsets.
                        // Use half the largest dimension of the source geometry as the fill distance.
                        if (operation.bounds && stepDistance > 0) {
                            const maxDim = Math.max(
                                operation.bounds.maxX - operation.bounds.minX,
                                operation.bounds.maxY - operation.bounds.minY
                            );
                            laserSettings.passes = Math.ceil((maxDim / 2) / stepDistance);
                        } else {
                            laserSettings.passes = 1;
                        }
                        break;
                    case 'filled':
                    case 'hatch':
                    default:
                        laserSettings.passes = 1;
                        break;
                }

            } else {
                // Isolation: standard halo approach
                const isolationWidth = params.laserIsolationWidth;

                laserSettings.clearStrategy = strategy;
                laserSettings.isolationWidth = isolationWidth;

                switch (strategy) {
                    case 'offset':
                        laserSettings.passes = stepDistance > 0 ? Math.ceil(isolationWidth / stepDistance) : 1;
                        break;
                    case 'filled':
                    case 'hatch':
                    default:
                        laserSettings.passes = 1;
                        break;
                }
            }

            // Invalidate cached clearance polygon so stale geometry isn't reused
            operation.clearancePolygon = null;

            this.ui.showCanvasSpinner('Generating laser paths...');
            await new Promise(resolve => setTimeout(resolve, 10));

            try {
                await this.core.generateLaserGeometry(operation, laserSettings);

                if (this.ui.navTreePanel) {
                    const fileNode = this.ui.navTreePanel.getNodeByOperationId(operation.id);
                    if (fileNode) {
                        this.ui.navTreePanel.updateFileGeometries(fileNode.id, operation);
                    }
                }

                await this.ui.updateRendererAsync();

                const totalPrimitives = operation.offsets?.reduce(
                    (sum, o) => sum + (o.primitives?.length || 0), 0
                ) || 0;
                this.ui.showStatus(
                    `Generated ${totalPrimitives} laser path(s) [${strategy}]`, 'success'
                );
            } catch (error) {
                console.error('[OperationPanel] Laser path generation failed:', error);
                this.ui.showStatus('Failed: ' + error.message, 'error');
            } finally {
                this.ui.hideCanvasSpinner();
            }
        }

        /**
         * Renders the laser export summary panel. This is a display-only stage with no editable parameters.
         */
        renderExportSummary(operation) {
            const container = document.getElementById('property-form');
            const title = document.getElementById('inspector-title');

            if (!container || !title) return;

            title.textContent = operation.file.name;
            container.innerHTML = '';

            // Summary section
            const section = document.createElement('div');
            section.className = 'property-section';

            const h3 = document.createElement('h3');
            h3.textContent = 'Laser Export Summary';
            section.appendChild(h3);

            const summary = document.createElement('div');
            summary.className = 'exporter-summary-info';

            const strategy = operation.settings?.laserClearStrategy || 'offset';
            const offsetCount = operation.offsets?.length || 0;
            const primCount = operation.offsets?.reduce((sum, o) => sum + (o.primitives?.length || 0), 0) || 0;
            const previewReady = this.core.isExportReady(operation) ? 'Yes' : 'No';

            summary.innerHTML = `
                <div><strong>Operation:</strong> ${operation.type}</div>
                <div><strong>Strategy:</strong> ${strategy}</div>
                <div><strong>Passes:</strong> ${offsetCount}</div>
                <div><strong>Path count:</strong> ${primCount}</div>
            `;
            section.appendChild(summary);
            container.appendChild(section);

            // Action button
            const actionText = this.getActionButtonText('export_summary', operation.type);
            if (actionText) {
                container.appendChild(this.createActionButton(actionText));

                const actionBtn = container.querySelector('#action-button');
                if (actionBtn) {
                    actionBtn.addEventListener('click', () => this.handleAction());
                }
            }
        }

        async generatePreview(operation) {
            if (!operation.offsets || operation.offsets.length === 0) {
                this.ui.showStatus('Generate offsets/strategy first', 'warning');
                return;
            }
            const firstOffset = operation.offsets[0];
            const toolDiameter = firstOffset.metadata?.toolDiameter;
            if (typeof toolDiameter === 'undefined' || toolDiameter <= 0) {
                this.ui.showStatus('Error: Tool diameter not found.', 'error');
                return false;
            }
            const allPrimitives = [];
            operation.offsets.forEach(offset => {
                offset.primitives.forEach(prim => {
                    if (!prim.properties) prim.properties = {};
                    prim.properties.isPreview = true;
                    prim.properties.toolDiameter = toolDiameter;
                    allPrimitives.push(prim);
                });
            });
            operation.preview = {
                primitives: allPrimitives,
                metadata: {
                    generatedAt: Date.now(),
                    sourceOffsets: operation.offsets.length,
                    toolDiameter: toolDiameter
                },
                ready: true
            };
            this.ui.renderer?.setOptions({ showPreviews: true });
            const previewToggle = document.getElementById('show-previews');
            if (previewToggle) previewToggle.checked = true;
            if (this.ui.navTreePanel) {
                const fileNode = this.ui.navTreePanel.getNodeByOperationId(operation.id);
                if (fileNode) {
                    this.ui.navTreePanel.updateFileGeometries(fileNode.id, operation);
                }
            }
            await this.ui.updateRendererAsync();
            this.ui.showStatus('Preview generated', 'success');
            return true;
        }

        debug(message, data = null) {
            if (this.ui.debug) {
                this.ui.debug(`[OperationPanel] ${message}`, data);
            }
        }
    }

    window.OperationPanel = OperationPanel; 
})();