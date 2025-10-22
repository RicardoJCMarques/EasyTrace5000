/**
 * @file        ui/ui-property-inspector.js
 * @description Refactored property inspector using parameter manager
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
    const debugConfig = config.debug || {};
    
    class PropertyInspector {
        constructor(ui) {
            this.ui = ui;
            this.core = ui.core;
            this.toolLibrary = null;
            this.parameterManager = null;
            
            this.currentOperation = null;
            this.currentGeometryStage = 'source';
            
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
            
            if (debugConfig.enabled) {
                console.log('[PropertyInspector] Initialized with parameter manager');
            }
        }
        
        clearProperties() {
            const container = document.getElementById('property-form');
            const title = document.getElementById('inspector-title');
            
            if (container) container.innerHTML = '<div class="property-empty">Select an operation</div>';
            if (title) title.textContent = 'Properties';
            
            this.currentOperation = null;
            this.currentGeometryStage = 'source';
        }
        
        showOperationProperties(operation, geometryStage = 'source') {
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
            const titles = {
                tool: 'Tool Selection',
                offset: 'Offset Generation',
                depth: 'Depth Settings',
                feeds: 'Feeds & Speeds',
                strategy: 'Cutting Strategy',
                drill: 'Drilling Parameters',
                cutout: 'Cutout Settings',
                machine: 'Machine Configuration',
                general: 'General Settings'
            };
            return titles[category] || category;
        }
        
        getActionButtonText(stage, operationType) {
            if (stage === 'source') {
                if (operationType === 'drill') return 'Generate Drill Strategy';
                if (operationType === 'cutout') return 'Generate Cutout Path';
                return 'Generate Offsets';
            } else if (stage === 'offset') {
                return 'Generate Preview';
            } else if (stage === 'preview') {
                return 'Operations Manager';
            }
            return null;
        }
        
        createSection(title, fields) {
            const section = document.createElement('div');
            section.className = 'param-section';
            
            const h3 = document.createElement('h3');
            h3.textContent = title;
            section.appendChild(h3);
            
            fields.forEach(field => section.appendChild(field));
            
            return section;
        }
        
        createField(param, currentValue) {
            const field = document.createElement('div');
            field.className = 'param-field';
            field.dataset.param = param.name;
            
            // Handle conditionals
            if (param.conditional) {
                field.dataset.conditional = param.conditional;
                // Will be evaluated in attachEventHandlers
            }
            
            const label = document.createElement('label');
            label.textContent = param.label;
            field.appendChild(label);
            
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
                    console.warn(`Unknown parameter type: ${param.type}`);
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
            textarea.style.fontFamily = 'monospace';
            textarea.style.fontSize = '11px';
            field.appendChild(textarea);
        }
        
        populateToolSelect(select, operationType, selectedId) {
            const tools = this.toolLibrary?.getToolsForOperation(operationType) || [];
            
            if (tools.length === 0) {
                select.innerHTML = '<option>No tools available</option>';
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
            panel.style.cssText = `
                background: #fff3cd;
                border: 1px solid #ffc107;
                border-radius: 4px;
                padding: 12px;
                margin-bottom: 16px;
                color: #856404;
            `;
            
            const header = document.createElement('div');
            header.style.cssText = 'font-weight: bold; margin-bottom: 8px;';
            header.innerHTML = `⚠️ ${warnings.length} Warning${warnings.length > 1 ? 's' : ''}`;
            panel.appendChild(header);
            
            const list = document.createElement('ul');
            list.style.cssText = 'margin: 0; padding-left: 20px; font-size: 13px;';
            
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
            wrapper.className = 'action-button';
            
            const button = document.createElement('button');
            button.className = 'btn-primary btn-block';
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
                            this.onParameterChange('toolDiameter', tool.geometry.diameter);
                        }
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
                    this.evaluateConditionals(container);
                });
                
                // Also save on blur for text inputs
                if (input.type === 'text' || input.type === 'number' || input.tagName === 'TEXTAREA') {
                    input.addEventListener('blur', () => {
                        this.saveCurrentState();
                    });
                }
            });
            
            // Mill holes toggle - special handling for drill operations
            const millCheck = container.querySelector('#prop-millHoles');
            if (millCheck) {
                millCheck.addEventListener('change', async (e) => {
                    const isMilling = e.target.checked;
                    this.onParameterChange('millHoles', isMilling);
                    
                    // Clear dependent geometry
                    if (this.currentOperation) {
                        this.currentOperation.settings.millHoles = isMilling;
                        if (this.currentOperation.offsets?.length > 0) {
                            this.currentOperation.offsets = [];
                            this.currentOperation.preview = null;
                            this.currentOperation.warnings = [];
                        }
                    }
                    
                    // Re-render inspector
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
            container.querySelectorAll('[data-conditional]').forEach(field => {
                const conditional = field.dataset.conditional;
                let shouldShow = true;
                
                if (conditional.startsWith('!')) {
                    const paramName = conditional.slice(1);
                    const input = container.querySelector(`#prop-${paramName}`);
                    shouldShow = !input?.checked;
                } else {
                    const input = container.querySelector(`#prop-${conditional}`);
                    shouldShow = input?.checked;
                }
                
                field.style.display = shouldShow ? '' : 'none';
            });
        }
        
        onParameterChange(name, value) {
            if (!this.currentOperation) return;
            
            // Save to parameter manager
            this.parameterManager.setParameter(
                this.currentOperation.id,
                this.currentGeometryStage,
                name,
                value
            );
            
            // Debounced auto-save
            clearTimeout(this.changeTimeout);
            this.changeTimeout = setTimeout(() => {
                this.saveCurrentState();
            }, 500);
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
            
            if (debugConfig.enabled) {
                console.log(`[PropertyInspector] Saved state for operation ${this.currentOperation.id}`);
            }
        }
        
        async handleAction() {
            this.saveCurrentState(); 
            // Ensure current parameters are committed
            
            const op = this.currentOperation; 
            const stage = this.currentGeometryStage; 
            
            if (stage === 'source') {
                // STAGE 1: Source -> Offset
                // This logic is correct and remains unchanged.
                if (op.type === 'drill') { 
                    await this.generateDrillStrategy(op); 
                } else if (op.type === 'cutout') { 
                    await this.generateCutoutOffset(op); 
                } else {
                    await this.generateOffsets(op); 
                }

                // Auto-transition to offset stage
                const config = window.PCBCAMConfig || {};
                if (config.layout?.ui?.autoTransition) {
                    setTimeout(() => {
                        this.switchGeometryStage('offset');
                    }, config.layout.ui.transitionDelay || 500);
                }
                
            } else if (stage === 'offset') {
                // STAGE 2: Offset -> Preview
                // It generates the preview configuration. 
                try {
                    this.ui.statusManager?.showStatus('Generating preview configuration...', 'info'); 
                    // Call the new core method (defined in the Main Report)
                    // This method STORES settings in 'op.preview', it does NOT calculate toolpaths. 
                    
                    this.generatePreview(op); 
                    
                    // Update the tree manager to show the new 'preview' node
                    if (this.ui.treeManager) {
                        const fileNode = Array.from(this.ui.treeManager.nodes.values())
                            .find(n => n.operation?.id === op.id);
                        if (fileNode) { 
                            this.ui.treeManager.updateFileGeometries(fileNode.id, op); 
                        }
                    }
                    
                    // Update the renderer to visualize the preview
                    await this.ui.updateRendererAsync(); 
                    this.ui.statusManager?.showStatus('Preview generated - ready for export', 'success');

                    // Auto-transition to preview stage
                    const config = window.PCBCAMConfig || {};
                    if (config.layout?.ui?.autoTransition) {
                        setTimeout(() => {
                            this.switchGeometryStage('preview');
                        }, config.layout.ui.transitionDelay || 500);
                    }
                    
                } catch (error) {
                    console.error('Preview generation failed:', error); 
                    this.ui.statusManager?.showStatus('Preview failed: ' + error.message, 'error'); 
                }
                
            } else if (stage === 'preview') {
                // STAGE 3: Preview -> Modal
                // It opens the multi-operation modal. 
                if (window.pcbcam?.modalManager) {
                    // Collect all operations that are "ready" (have a preview object)
                    const readyOps = this.ui.core.operations.filter(o => o.preview?.ready); 
                    if (readyOps.length === 0) { 
                        this.ui.statusManager?.showStatus('No operations ready. Generate previews first.', 'warning'); 
                        return; 
                    }
                    
                    // Open the modal, passing all ready operations
                    window.pcbcam.modalManager.showToolpathModal(readyOps, op.id); 
                } else {
                    this.ui.statusManager?.showStatus('Operations manager not available', 'error'); 
                }
            }
        }

        switchGeometryStage(newStage) {
            const validStages = ['source', 'offset', 'preview'];
            if (!validStages.includes(newStage)) {
                console.warn(`Invalid geometry stage: ${newStage}`);
                return;
            }
            
            this.currentGeometryStage = newStage;
            
            // Simply rebuild the parameter panel for the new stage
            if (this.currentOperation) {
                this.showOperationProperties(this.currentOperation, newStage);
            }
        }
        
        // Existing generation methods remain the same
        async generateOffsets(operation) {
            const params = this.parameterManager.getAllParameters(operation.id);

            // Re-hydrate the tool object for cam-core.js compatibility
            if (params.tool && params.toolDiameter !== undefined) {
                params.tool = {
                    id: params.tool,
                    diameter: params.toolDiameter,
                    // Add other properties if cam-core needs them, e.g., type
                    type: this.toolLibrary?.getTool(params.tool)?.type || 'end_mill'
                };
            }
            
            const offsets = this.calculateOffsetDistances(
                params.toolDiameter,
                params.passes,
                params.stepOver,
                operation.type === 'clear'
            );
            
            this.ui.statusManager?.showStatus('Generating offset geometry...', 'info');
            
            try {
                await this.core.generateOffsetGeometry(operation, offsets, params);
                
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
                console.error('Offset generation failed:', error);
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
                console.error('Drill strategy generation failed:', error);
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

            const cutSide = params.cutSide;
            
            let offsetDistance;
            if (cutSide === 'on') {
                offsetDistance = 0;
            } else if (cutSide === 'outside') {
                offsetDistance = params.toolDiameter / 2;
            } else {
                offsetDistance = -(params.toolDiameter / 2);
            }
            
            this.ui.statusManager?.showStatus('Generating cutout path...', 'info');
            
            try {
                await this.core.generateOffsetGeometry(operation, [offsetDistance], params);
                
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
                console.error('Cutout offset failed:', error);
                this.ui.statusManager?.showStatus('Failed: ' + error.message, 'error');
            }
        }
        
        async generatePreview(operation) {
            if (!operation.offsets || operation.offsets.length === 0) {
                this.ui.statusManager?.showStatus('Generate offsets first', 'warning');
                return;
            }

            const firstOffset = operation.offsets[0];
            const toolDiameter = firstOffset.metadata?.toolDiameter;

            if (typeof toolDiameter === 'undefined' || toolDiameter <= 0) {
                this.ui.statusManager?.showStatus('Error: Tool diameter not found in offset metadata.', 'error');
                return;
            }
            
            const allPrimitives = [];
            operation.offsets.forEach(offset => {
                // Mark primitives as preview
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
                }
                , ready: true
            };
            
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
        
        calculateOffsetDistances(toolDiameter, passes, stepOverPercent, isInternal) {
            const stepOver = stepOverPercent / 100;
            const stepDistance = toolDiameter * (1 - stepOver);
            const offsets = [];
            const sign = isInternal ? -1 : 1;
            
            for (let i = 0; i < passes; i++) {
                offsets.push(sign * (toolDiameter / 2 + i * stepDistance));
            }
            
            return offsets;
        }
    }
    
    window.PropertyInspector = PropertyInspector;
    
})();