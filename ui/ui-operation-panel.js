/**
 * @file        ui/ui-operation-panel.js
 * @description Parameter input builder (right sidebar)
 * @author      Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

 /*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2025 Eltryus
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
    
    const config = window.PCBCAMConfig || {};
    const textConfig = config.ui.text || {};
    const iconConfig = config.ui.icons || {};
    const inspectorConfig = config.ui.propertyInspector || {};
    const timingConfig = config.ui.timing || {};
    const layoutConfig = config.layout || {};
    
    class PropertyInspector { // update class name to reflect new clearer file name
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
            this.currentGeometryStage = geometryStage;
            
            // Load existing parameters for this operation
            this.parameterManager.loadFromOperation(operation);
            
            const container = document.getElementById('property-form');
            const title = document.getElementById('inspector-title');
            
            if (!container || !title) return;
            
            title.textContent = operation.file.name;
            container.innerHTML = '';
            
            // Show warnings if any
            if (operation.warnings && operation.warnings.length > 0) {
                container.appendChild(this.createWarningPanel(operation.warnings));
            }
            
            // Get appropriate parameters for this stage and operation type
            const stageParams = this.parameterManager.getStageParameters(geometryStage, operation.type);
            const currentValues = this.parameterManager.getParameters(operation.id, geometryStage);
            
            // Group parameters by category
            const categories = this.groupByCategory(stageParams);
            
            // Render each category
            for (const [category, params] of Object.entries(categories)) {
                const section = this.createSection(
                    this.getCategoryTitle(category, operation.type),
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
        
        getCategoryTitle(category, operationType) {
            const categoryTitles = inspectorConfig.categories || {};
            const title = categoryTitles[category] || category.charAt(0).toUpperCase() + category.slice(1);
            return title;
        }
        
        getActionButtonText(stage, operationType) {
            if (stage === 'geometry') {
                if (operationType === 'drill') return 'Generate Drill Strategy';
                if (operationType === 'cutout') return 'Generate Cutout Path';
                return 'Generate Offsets';
            } else if (stage === 'strategy') {
                return 'Generate Toolpath Preview';
            } else if (stage === 'machine') {
                return 'Operations & G-Code';
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
            
            const label = document.createElement('label');

            // Use param.name as the key (e.g., "toolDiameter", "passes")
            const helpKey = param.name; 
            const labelText = this.lang.get('parameters.' + helpKey, param.label);
            label.textContent = labelText;
            field.appendChild(label);

            // Check if a helpKey exists AND the strings have been loaded
            const tooltipKey = 'tooltips.parameters.' + helpKey;
            if (this.lang.has(tooltipKey)) {
                
                // Get the tooltip text from en.json
                const helpText = this.lang.get(tooltipKey);
                // The title is the label text we just found
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
            input.value = value || 0;
            if (param.min !== undefined) input.min = param.min;
            if (param.max !== undefined) input.max = param.max;
            if (param.step !== undefined) input.step = param.step;
            
            // Prevent negative sign if min is >= 0
            if (param.min !== undefined && param.min >= 0) {
                input.addEventListener('keydown', (e) => {
                    if (e.key === '-' || e.key === 'Subtract') {
                        e.preventDefault();
                    }
                });
                input.addEventListener('paste', (e) => {
                    const pastedText = (e.clipboardData || window.clipboardData).getData('text');
                    if (pastedText.includes('-')) {
                        e.preventDefault();
                    }
                });
            }
            
            wrapper.appendChild(input);
            
            if (param.unit) {
                const unitSpan = document.createElement('span');
                unitSpan.className = 'unit';
                unitSpan.textContent = param.unit;
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
            const tools = this.toolLibrary?.getToolsForOperation(operationType) || [];
            
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
            
            if (inspectorConfig.warningPanelCSS) {
                Object.assign(panel.style, inspectorConfig.warningPanelCSS);
            }
            
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
                    const tool = this.toolLibrary?.getTool(e.target.value);
                    if (tool) {
                        const diamInput = container.querySelector('#prop-toolDiameter');
                        if (diamInput) {
                            diamInput.value = tool.geometry.diameter;
                            // Manually trigger onParameterChange for the diameter
                            this.onParameterChange('toolDiameter', tool.geometry.diameter);
                        }
                        // Trigger onParameterChange for the tool itself
                        this.onParameterChange('tool', e.target.value);
                    }
                });
            }
            
            // Auto-save on all inputs
            container.querySelectorAll('input, select, textarea').forEach(input => {
                if (input.id === 'prop-tool') return; // Already handled
                
                const paramName = input.id.replace('prop-', '');
                
                input.addEventListener('change', () => {
                    let value;
                    if (input.type === 'checkbox') {
                        value = input.checked;
                    } else if (input.type === 'number') {
                        value = parseFloat(input.value);
                    } else {
                        value = input.value;
                    }
                    
                    this.onParameterChange(paramName, value);
                });

                // Real-time validation for number inputs
                if (input.type === 'number') {
                    const paramName = input.id.replace('prop-', '');
                    
                    input.addEventListener('input', (e) => {
                        const value = e.target.value;
                        const def = this.parameterManager.parameterDefinitions[paramName];
                        
                        // 1. Check for invalid characters (e.g., 'abc', '5e-')
                        const num = parseFloat(value);
                        if (isNaN(num) && value !== "" && value !== "-") { 
                            this.ui.statusManager.showStatus(`${def.label} must be a number`, 'error');
                            // Revert to the last known good value
                            e.target.value = this.parameterManager.getParameters(this.currentOperation.id, this.currentGeometryStage)[paramName];
                            return;
                        }

                        // 2. Check Min/Max *while typing* (only clamp on max)
                        if (def.max !== undefined && num > def.max) {
                            this.ui.statusManager.showStatus(`${def.label} cannot be more than ${def.max}`, 'error');
                            e.target.value = def.max; // Clamp immediately
                            // Trigger the change to save the clamped value
                            this.onParameterChange(paramName, def.max);
                            return; // Stop further processing
                        }
                        
                        // Don't clamp min while typing, as user might be typing "-0.1"
                        
                        // 3. If it's a valid partial number, send it to the manager (onParameterChange will handle final validation on 'change'/'blur')
                        if (!isNaN(num)) {
                             this.onParameterChange(paramName, num, true); // 'true' for real-time update
                        }
                    });
                }
                
                // Save on blur for text inputs
                if (input.type === 'text' || input.type === 'number' || input.tagName === 'TEXTAREA') {
                    input.addEventListener('blur', () => {
                        // On blur, force a final validation/save
                        let value;
                        if (input.type === 'number') {
                            value = parseFloat(input.value);
                        } else {
                            value = input.value;
                        }
                        this.onParameterChange(paramName, value); // This will clamp
                        this.saveCurrentState(); // And this will save
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
                        this.currentOperation.settings.millHoles = isMilling;
                        if (this.currentOperation.offsets?.length > 0) {
                            this.currentOperation.offsets = [];
                            this.currentOperation.preview = null;
                            this.currentOperation.warnings = [];
                        }
                    }
                    
                    this.showOperationProperties(this.currentOperation, this.currentGeometryStage);
                    await this.ui.updateRendererAsync();
                    
                    this.ui.statusManager?.showStatus(
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
        
        evaluateConditionals(container) {
            const currentValues = this.parameterManager.getAllParameters(this.currentOperation.id);
            
            container.querySelectorAll('[data-conditional]').forEach(field => {
                const conditional = field.dataset.conditional;
                let shouldShow = true;
                
                if (conditional.startsWith('!')) {
                    const paramName = conditional.slice(1);
                    // Read the *actual* value from the manager, not the checkbox (which might be stale) - can checkbox become stale?
                    shouldShow = !currentValues[paramName];
                } else {
                    shouldShow = currentValues[conditional];
                }
                
                field.style.display = shouldShow ? '' : 'none';
            });
        }
        
        onParameterChange(name, value, isRealtime = false) {
            if (!this.currentOperation) return;
            
            const result = this.parameterManager.setParameter(
                this.currentOperation.id,
                this.currentGeometryStage,
                name,
                value
            );

            // Enforcement logic
            if (result.success) {
                if (this.ui.statusManager.currentStatus?.type === 'error') {
                    this.ui.statusManager.updateStatus(); 
                }
            } else {
                // Show error
                this.ui.statusManager.showStatus(result.error, 'error');
                
                // Clamp the value in the UI
                if (result.correctedValue !== undefined) {
                    const input = document.getElementById(`prop-${name}`);
                    if (input && input.value != result.correctedValue) {
                        input.value = result.correctedValue;
                    }
                }
            }
            
            // Conditionals must be re-evaluated on *every* change
            const container = document.getElementById('property-form');
            if (container) this.evaluateConditionals(container);

            // Debounced auto-save (only if successful and not a real-time 'input' event)
            if (result.success && !isRealtime) {
                clearTimeout(this.changeTimeout);
                const delay = timingConfig.propertyDebounce || 500;
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
            
            // Commit to operation
            this.parameterManager.commitToOperation(this.currentOperation);
            
            this.debug(`Saved state for operation ${this.currentOperation.id}`);
        }
        
        async handleAction() {
            this.saveCurrentState(); 
            
            const op = this.currentOperation; 
            const stage = this.currentGeometryStage; 
            
            if (stage === 'geometry') {
                // STAGE 1: Geometry -> Strategy
                if (op.type === 'drill') { 
                    await this.generateDrillStrategy(op); 
                } else if (op.type === 'cutout') { 
                    await this.generateCutoutOffset(op); 
                } else {
                    await this.generateOffsets(op); 
                }

                const transitionDelay = layoutConfig?.ui?.transitionDelay || 300;
                if (layoutConfig?.ui?.autoTransition) {
                    setTimeout(() => {
                        this.switchGeometryStage('strategy');
                    }, transitionDelay);
                }
                
            } else if (stage === 'strategy') {
                // STAGE 2: Strategy -> Machine
                try {
                    this.ui.statusManager?.showStatus('Generating toolpath preview...', 'info'); 
                    this.generatePreview(op); // This is just creating the preview primitives
                    
                    if (this.ui.treeManager) {
                        const fileNode = Array.from(this.ui.treeManager.nodes.values())
                            .find(n => n.operation?.id === op.id);
                        if (fileNode) { 
                            this.ui.treeManager.updateFileGeometries(fileNode.id, op); 
                        }
                    }
                    
                    await this.ui.updateRendererAsync(); 
                    this.ui.statusManager?.showStatus('Preview generated', 'success');

                    const transitionDelay = layoutConfig?.ui?.transitionDelay || 300;
                    if (layoutConfig?.ui?.autoTransition) {
                        setTimeout(() => {
                            this.switchGeometryStage('machine');
                        }, transitionDelay);
                    }
                    
                } catch (error) {
                    console.error('[OperationPanel] Preview generation failed:', error); 
                    this.ui.statusManager?.showStatus('Preview failed: ' + error.message, 'error'); 
                }
                
            } else if (stage === 'machine') {
                // STAGE 3: Machine -> Modal
                if (window.pcbcam?.modalManager) {
                    const readyOps = this.ui.core.operations.filter(o => o.preview?.ready); 
                    if (readyOps.length === 0) { 
                        this.ui.statusManager?.showStatus('No operations ready. Generate previews first.', 'warning'); 
                        return; 
                    }
                    
                    window.pcbcam.modalManager.showToolpathModal(readyOps, op.id); 
                } else {
                    this.ui.statusManager?.showStatus('Operations manager not available', 'error'); 
                }
            }
        }

        switchGeometryStage(newStage) {
            const validStages = ['geometry', 'strategy', 'machine'];
            if (!validStages.includes(newStage)) {
                console.warn(`[OperationPanel] Invalid geometry stage: ${newStage}`);
                return;
            }
            
            this.currentGeometryStage = newStage;
            
            // Simply rebuild the parameter panel for the new stage
            if (this.currentOperation) {
                this.showOperationProperties(this.currentOperation, newStage);
            }
        }
        
        async generateOffsets(operation) {
            const params = this.parameterManager.getAllParameters(operation.id);
            if (params.tool && params.toolDiameter !== undefined) {
                params.tool = {
                    id: params.tool,
                    diameter: params.toolDiameter,
                    type: this.toolLibrary?.getTool(params.tool)?.type || 'end_mill'
                };
            }
            this.ui.statusManager?.showStatus('Generating offset geometry...', 'info');
            try {
                await this.core.generateOffsetGeometry(operation, params);
                if (this.ui.treeManager) {
                    const fileNode = Array.from(this.ui.treeManager.nodes.values())
                        .find(n => n.operation?.id === operation.id);
                    if (fileNode) {
                        this.ui.treeManager.updateFileGeometries(fileNode.id, operation);
                    }
                }
                await this.ui.updateRendererAsync();
                this.ui.statusManager?.showStatus(`Generated ${operation.offsets.length} offset(s)`, 'success');
            } catch (error) {
                console.error('[OperationPanel] Offset generation failed:', error);
                this.ui.statusManager?.showStatus('Failed: ' + error.message, 'error');
            }
        }
        
        async generateDrillStrategy(operation) {
            const params = this.parameterManager.getAllParameters(operation.id);
            this.ui.statusManager?.showStatus(
                params.millHoles ? 'Generating milling paths...' : 'Generating peck positions...',
                'info'
            );
            try {
                await this.core.generateDrillStrategy(operation, params);
                if (this.ui.treeManager) {
                    const fileNode = Array.from(this.ui.treeManager.nodes.values())
                        .find(n => n.operation?.id === operation.id);
                    if (fileNode) {
                        this.ui.treeManager.updateFileGeometries(fileNode.id, operation);
                    }
                }
                await this.ui.updateRendererAsync();
                if (operation.warnings?.length > 0) {
                    this.ui.statusManager?.showStatus(
                        `Generated with ${operation.warnings.length} warning(s)`,
                        'warning'
                    );
                    this.showOperationProperties(operation, this.currentGeometryStage);
                } else {
                    const count = operation.offsets[0]?.primitives.length || 0;
                    const mode = params.millHoles ? 'milling paths' : 'peck positions';
                    this.ui.statusManager?.showStatus(`Generated ${count} ${mode}`, 'success');
                }
            } catch (error) {
                console.error('[OperationPanel] Drill strategy generation failed:', error);
                this.ui.statusManager?.showStatus('Failed: ' + error.message, 'error');
            }
        }
        
        async generateCutoutOffset(operation) {
            const params = this.parameterManager.getAllParameters(operation.id);

            if (params.tool && params.toolDiameter !== undefined) {
                params.tool = {
                    id: params.tool,
                    diameter: params.toolDiameter,
                    type: this.toolLibrary?.getTool(params.tool)?.type || 'end_mill'
                };
            }

            this.ui.statusManager?.showStatus('Generating cutout path...', 'info');
            
            try {
                // We pass the 'params' object as the settings.
                await this.core.generateOffsetGeometry(operation, params);
                
                if (this.ui.treeManager) {
                    const fileNode = Array.from(this.ui.treeManager.nodes.values())
                        .find(n => n.operation?.id === operation.id);
                    if (fileNode) {
                        this.ui.treeManager.updateFileGeometries(fileNode.id, operation);
                    }
                }
                
                await this.ui.updateRendererAsync();
                this.ui.statusManager?.showStatus('Cutout path generated', 'success');
            } catch (error) {
                console.error('[OperationPanel] Cutout offset failed:', error);
                this.ui.statusManager?.showStatus('Failed: ' + error.message, 'error');
            }
        }
        
        async generatePreview(operation) {
            if (!operation.offsets || operation.offsets.length === 0) {
                this.ui.statusManager?.showStatus('Generate offsets/strategy first', 'warning');
                return;
            }
            const firstOffset = operation.offsets[0];
            const toolDiameter = firstOffset.metadata?.toolDiameter;
            if (typeof toolDiameter === 'undefined' || toolDiameter <= 0) {
                this.ui.statusManager?.showStatus('Error: Tool diameter not found.', 'error');
                return;
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
            if (this.ui.treeManager) {
                const fileNode = Array.from(this.ui.treeManager.nodes.values())
                    .find(n => n.operation?.id === operation.id);
                if (fileNode) {
                    this.ui.treeManager.updateFileGeometries(fileNode.id, operation);
                }
            }
            await this.ui.updateRendererAsync();
            this.ui.statusManager?.showStatus('Preview generated', 'success');
        }

        debug(message, data = null) {
            if (this.ui && this.ui.debug) {
                this.ui.debug(`[OperationPanel] ${message}`, data);
            }
        }
    }
    
    window.PropertyInspector = PropertyInspector; 
})();