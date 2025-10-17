/**
 * @file        ui/ui-property-inspector.js
 * @description Manages the properties panel (right sidebar
 * @comment     Unified: Stage-based parameters with consistent offset distance calculation
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
    const opsConfig = config.operations || {};
    
    class PropertyInspector {
        constructor(ui) {
            this.ui = ui;
            this.core = ui.core;
            this.toolLibrary = null;
            
            this.currentOperation = null;
            this.currentGeometryStage = 'source';
            
            this.isDirty = false;
            this.originalSettings = null;
        }
        
        init(toolLibrary) {
            this.toolLibrary = toolLibrary;
            if (debugConfig.enabled) console.log('PropertyInspector initialized');
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

            // Save previous operation's settings before switching
            if (this.currentOperation && 
                this.currentOperation.id !== operation.id && 
                this.isDirty) {
                this.saveSettings();
            }
            
            this.currentOperation = operation;
            this.currentGeometryStage = geometryStage;
            this.originalSettings = JSON.parse(JSON.stringify(operation.settings || {}));
            
            const container = document.getElementById('property-form');
            const title = document.getElementById('inspector-title');
            
            if (!container || !title) return;
            
            title.textContent = operation.file.name;
            container.innerHTML = '';

            // Show warnings if any exist
            if (operation.warnings && operation.warnings.length > 0) {
                container.appendChild(this.createWarningPanel(operation.warnings));
            }
            
            // Render based on operation type and stage
            if (operation.type === 'drill') {
                this.renderDrillProperties(container, operation, geometryStage);
            } else if (operation.type === 'cutout') {
                this.renderCutoutProperties(container, operation, geometryStage);
            } else {
                this.renderIsolationProperties(container, operation, geometryStage);
            }
            
            this.attachEventHandlers(container);
        }

        resetInspectorState() {
            if (this.currentOperation && this.isDirty) {
                // Optionally prompt user to save changes
                this.saveSettings();
            }
            
            this.currentOperation = null;
            this.currentGeometryStage = 'source';
            this.originalSettings = null;
            this.isDirty = false;
            
            // Clear any cached UI state
            const container = document.getElementById('property-form');
            if (container) {
                container.innerHTML = '<div class="property-empty">Select an operation</div>';
            }
        }

        // Helper to get user-friendly stage name
        getStageName(stage, operationType) {
            const stageNames = {
                isolation: {
                    source: 'Tool Selection',
                    offset: 'Offset Generation',
                    preview: 'Toolpath Preview',
                    gcode: 'G-code Setup'
                },
                drill: {
                    source: 'Tool & Hole Selection',
                    offset: 'Drill Strategy', // NOT "offset"
                    preview: 'Drilling Preview',
                    gcode: 'G-code Setup'
                },
                clear: {
                    source: 'Tool Selection',
                    offset: 'Clearing Paths',
                    preview: 'Toolpath Preview',
                    gcode: 'G-code Setup'
                },
                cutout: {
                    source: 'Tool Selection',
                    offset: 'Cutout Path',
                    preview: 'Cutting Preview',
                    gcode: 'G-code Setup'
                }
            };
            
            return stageNames[operationType]?.[stage] || stage;
        }
        
        renderIsolationProperties(container, operation, stage) {
            if (stage === 'source') {
                // Source stage: 2D X&Y parameters
                container.appendChild(this.createSection('Tool Selection', [
                    this.createToolField('tool', operation),
                    this.createField('toolDiameter', 'number', {
                        value: operation.settings.tool?.diameter || 0.2,
                        step: 0.001,
                        min: 0.01
                    })
                ]));
                
                container.appendChild(this.createSection('Offset Generation', [
                    this.createField('passes', 'number', {
                        value: operation.settings.passes || 3,
                        min: 1, max: 10
                    }),
                    this.createField('stepOver', 'number', {
                        value: operation.settings.stepOver || 50,
                        min: 10, max: 100
                    }),
                    this.createField('combineOffsets', 'checkbox', {
                        checked: operation.settings.combineOffsets !== false
                    })
                ]));
                
                container.appendChild(this.createActionButton('Generate Offsets'));
                
            } else if (stage === 'offset') {
                // Offset stage: Depth parameters
                container.appendChild(this.createSection('Toolpath Depth', [
                    this.createField('cutDepth', 'number', {
                        value: operation.settings.cutDepth || -0.05,
                        step: 0.001
                    }),
                    this.createField('travelZ', 'number', {
                        value: operation.settings.travelZ || 2.0,
                        step: 0.1
                    }),
                    this.createField('safeZ', 'number', {
                        value: operation.settings.safeZ || 5.0,
                        step: 0.1
                    }),
                    this.createField('multiDepth', 'checkbox', {
                        checked: operation.settings.multiDepth || false
                    }),
                    this.createField('depthPerPass', 'number', {
                        value: operation.settings.depthPerPass || 0.025,
                        step: 0.001,
                        disabled: !operation.settings.multiDepth
                    })
                ]));
                
                container.appendChild(this.createSection('Feeds & Speeds', [
                    this.createField('feedRate', 'number', {
                        value: operation.settings.feedRate || 150,
                        min: 1, max: 5000
                    }),
                    this.createField('plungeRate', 'number', {
                        value: operation.settings.plungeRate || 50,
                        min: 1, max: 1000
                    }),
                    this.createField('spindleSpeed', 'number', {
                        value: operation.settings.spindleSpeed || 12000,
                        min: 100, max: 30000
                    })
                ]));
                
                container.appendChild(this.createSection('Strategy', [
                    this.createSelectField('direction', 'Direction', operation.settings.direction || 'climb', [
                        { value: 'climb', label: 'Climb' },
                        { value: 'conventional', label: 'Conventional' }
                    ]),
                    this.createSelectField('entryType', 'Entry', operation.settings.entryType || 'plunge', [
                        { value: 'plunge', label: 'Plunge' },
                        { value: 'ramp', label: 'Ramp' },
                        { value: 'helix', label: 'Helix' }
                    ])
                ]));
                
                container.appendChild(this.createActionButton('Generate Preview'));
                
            } else if (stage === 'preview') {
                // Preview stage: Machine configuration
                container.appendChild(this.createSection('Machine Configuration', [
                    this.createSelectField('postProcessor', 'Post Processor', operation.settings.postProcessor || 'grbl', [
                        { value: 'grbl', label: 'GRBL' },
                        { value: 'marlin', label: 'Marlin' },
                        { value: 'linuxcnc', label: 'LinuxCNC' },
                        { value: 'mach3', label: 'Mach3' }
                    ]),
                    this.createSelectField('workOffset', 'Work Offset', operation.settings.workOffset || 'G54', [
                        { value: 'G54', label: 'G54' },
                        { value: 'G55', label: 'G55' },
                        { value: 'G56', label: 'G56' }
                    ])
                ]));
                
                // Pre/postamble text areas
                container.appendChild(this.createSection('G-code Pre/Postambles', [
                    this.createTextAreaField('startCode', 'Start G-code', 
                        operation.settings.startCode || 'G90 G21\nG0 Z5\nM3 S12000\nG4 P1', 4),
                    this.createTextAreaField('endCode', 'End G-code', 
                        operation.settings.endCode || 'M5\nG0 Z10\nM2', 3)
                ]));
                
                container.appendChild(this.createActionButton('Generate G-code'));
            }
        }
        
        renderDrillProperties(container, operation, stage) {
            if (stage === 'source') {
                // Drilling Mode section
                const isMilling = operation.settings.millHoles !== false;

                const sectionName = this.getStageName('source', 'drill');
                container.appendChild(this.createSection(sectionName, [
                    this.createToolField('tool', operation),
                    this.createField('toolDiameter', 'number', {
                        value: operation.settings.tool?.diameter || 0.8,
                        step: 0.001,
                        min: 0.01
                    })
                ]));
                
                

                container.appendChild(this.createSection('Drilling Mode', [
                    this.createField('millHoles', 'checkbox', {
                        checked: isMilling,
                        label: 'Mill Holes (for undersized tools)'
                    })
                ]));
                
                // Show parameters based on mode
                if (!isMilling) {
                    // Pecking mode parameters
                    const cannedCycleField = this.createSelectField('cannedCycle', 'Cycle',
                        operation.settings.cannedCycle || 'none', [
                        { value: 'none', label: 'None (G0 + G1)' },
                        { value: 'G81', label: 'G81 - Simple Drill' },
                        { value: 'G83', label: 'G83 - Peck Drilling' }
                    ]);
                    
                    container.appendChild(this.createSection('Drilling Parameters', [
                        cannedCycleField,
                        this.createField('dwellTime', 'number', {
                            value: operation.settings.dwellTime || 0,
                            step: 0.1
                        }),
                        this.createField('retractHeight', 'number', {
                            value: operation.settings.retractHeight || 0.5,
                            step: 0.01
                        }),
                        this.createField('peckDepth', 'number', {
                            value: operation.settings.peckDepth || 0,
                            step: 0.01
                        })
                    ]));
                    
                    container.appendChild(this.createSection('Cutting Parameters', [
                        this.createField('cutDepth', 'number', {
                            value: operation.settings.cutDepth || -1.8
                        }),
                        this.createField('feedRate', 'number', {
                            value: operation.settings.feedRate || 60
                        }),
                        this.createField('plungeRate', 'number', {
                            value: operation.settings.plungeRate || 30
                        }),
                        this.createField('spindleSpeed', 'number', {
                            value: operation.settings.spindleSpeed || 10000
                        })
                    ]));
                    
                    container.appendChild(this.createActionButton('Generate Drill Preview'));
                    
                } else {
                    // Milling mode parameters
                    container.appendChild(this.createSection('Hole Milling', [
                        this.createField('passes', 'number', {
                            value: operation.settings.passes || 2,
                            min: 1, max: 10
                        }),
                        this.createField('stepOver', 'number', {
                            value: operation.settings.stepOver || 50,
                            min: 10, max: 100
                        })
                    ]));
                    
                    container.appendChild(this.createActionButton('Generate Milling Paths'));
                }

                const actionBtn = container.querySelector('#action-button');
                if (actionBtn) {
                    if (stage === 'source') {
                        actionBtn.textContent = isMilling ? 'Generate Milling Offsets' : 'Generate Drill Positions';
                    } else if (stage === 'offset') {
                        actionBtn.textContent = 'Generate Preview';
                    } else {
                        actionBtn.textContent = 'Generate G-code';
                    }
                }
                
            } else if (stage === 'offset') {
                // Milled holes - same as isolation offset stage
                this.renderIsolationProperties(container, operation, 'offset');
                
            } else if (stage === 'preview') {
                // Same machine config as isolation
                this.renderIsolationProperties(container, operation, 'preview');
            }
        }
        
        renderCutoutProperties(container, operation, stage) {
            if (stage === 'source') {
                container.appendChild(this.createSection('Tool Selection', [
                    this.createToolField('tool', operation),
                    this.createField('toolDiameter', 'number', {
                        value: operation.settings.tool?.diameter || 1.0,
                        step: 0.001,
                        min: 0.01
                    })
                ]));
                
                container.appendChild(this.createSection('Cutout Path', [
                    this.createSelectField('cutSide', 'Cut Side', operation.settings.cutSide || 'outside', [
                        { value: 'outside', label: 'Outside (keep inner)' },
                        { value: 'inside', label: 'Inside (keep outer)' },
                        { value: 'on', label: 'On Line' }
                    ])
                ]));
                
                container.appendChild(this.createActionButton('Generate Offset'));
                
            } else if (stage === 'offset') {
                // Move tabs here
                container.appendChild(this.createSection('Multi-pass Cutting', [
                    this.createField('cutDepth', 'number', {
                        value: operation.settings.cutDepth || -1.8,
                        step: 0.1
                    }),
                    this.createField('depthPerPass', 'number', {
                        value: operation.settings.depthPerPass || 0.2,
                        step: 0.01
                    })
                ]));
                
                container.appendChild(this.createSection('Tabs', [
                    this.createField('tabs', 'number', {
                        value: operation.settings.tabs || 4,
                        min: 0, max: 12
                    }),
                    this.createField('tabWidth', 'number', {
                        value: operation.settings.tabWidth || 3.0,
                        step: 0.1
                    }),
                    this.createField('tabHeight', 'number', {
                        value: operation.settings.tabHeight || 0.5,
                        step: 0.1
                    })
                ]));
                
                container.appendChild(this.createActionButton('Generate Offsets'));
                
            } else if (stage === 'preview') {
                // Same machine config
                this.renderIsolationProperties(container, operation, 'preview');
            }
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
        
        createToolField(paramName, operation) {
            const field = document.createElement('div');
            field.className = 'param-field';
            field.dataset.param = paramName;
            
            const label = document.createElement('label');
            label.textContent = 'Tool';
            field.appendChild(label);
            
            const select = document.createElement('select');
            select.id = `prop-${paramName}`;
            this.populateToolSelect(select, operation.type, operation.settings.tool?.id);
            field.appendChild(select);
            
            return field;
        }
        
        createField(paramName, type, options = {}) {
            const field = document.createElement('div');
            field.className = 'param-field';
            field.dataset.param = paramName;
            if (options.conditionalOn) field.dataset.conditionalOn = options.conditionalOn;
            
            if (type === 'checkbox') {
                const label = document.createElement('label');
                label.className = 'checkbox-label';
                
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.id = `prop-${paramName}`;
                input.checked = options.checked || false;
                
                const span = document.createElement('span');
                span.textContent = options.label || this.getLabel(paramName);
                
                label.appendChild(input);
                label.appendChild(span);
                field.appendChild(label);
            } else {
                const label = document.createElement('label');
                label.textContent = this.getLabel(paramName);
                field.appendChild(label);
                
                const wrapper = document.createElement('div');
                wrapper.className = 'input-unit';
                
                const input = document.createElement('input');
                input.type = type;
                input.id = `prop-${paramName}`;
                if (options.value !== undefined) input.value = options.value;
                if (options.min !== undefined) input.min = options.min;
                if (options.max !== undefined) input.max = options.max;
                if (options.step !== undefined) input.step = options.step;
                if (options.disabled) input.disabled = true;
                
                wrapper.appendChild(input);
                
                const unit = this.getUnit(paramName);
                if (unit) {
                    const unitSpan = document.createElement('span');
                    unitSpan.className = 'unit';
                    unitSpan.textContent = unit;
                    wrapper.appendChild(unitSpan);
                }
                
                field.appendChild(wrapper);
            }
            
            return field;
        }
        
        createTextAreaField(paramName, label, defaultValue, rows = 4) {
            const field = document.createElement('div');
            field.className = 'param-field';
            field.dataset.param = paramName;
            
            const labelEl = document.createElement('label');
            labelEl.textContent = label;
            field.appendChild(labelEl);
            
            const textarea = document.createElement('textarea');
            textarea.id = `prop-${paramName}`;
            textarea.rows = rows;
            textarea.value = defaultValue;
            textarea.style.fontFamily = 'monospace';
            textarea.style.fontSize = '11px';
            field.appendChild(textarea);
            
            return field;
        }
        
        createSelectField(paramName, label, value, options) {
            const field = document.createElement('div');
            field.className = 'param-field';
            field.dataset.param = paramName;
            
            const labelEl = document.createElement('label');
            labelEl.textContent = label;
            field.appendChild(labelEl);
            
            const select = document.createElement('select');
            select.id = `prop-${paramName}`;
            
            options.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.label;
                if (opt.value === value) option.selected = true;
                select.appendChild(option);
            });
            
            field.appendChild(select);
            return field;
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
        
        populateToolSelect(select, operationType, selectedId) {
            const tools = this.toolLibrary?.getToolsForOperation(operationType) || [];
            
            if (tools.length === 0) {
                select.innerHTML = '<option>No tools</option>';
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
        
        attachEventHandlers(container) {
            // Tool selection updates diameter
            const toolSelect = container.querySelector('#prop-tool');
            if (toolSelect) {
                toolSelect.addEventListener('change', (e) => {
                    const tool = this.toolLibrary?.getTool(e.target.value);
                    if (tool) {
                        const diamInput = container.querySelector('#prop-toolDiameter');
                        if (diamInput) diamInput.value = tool.geometry.diameter;
                    }
                });
            }
            
            // Multi-depth enables/disables depth per pass
            const multiCheck = container.querySelector('#prop-multiDepth');
            if (multiCheck) {
                multiCheck.addEventListener('change', (e) => {
                    const depthInput = container.querySelector('#prop-depthPerPass');
                    if (depthInput) depthInput.disabled = !e.target.checked;
                });
            }
            
            // Mill holes toggle - regenerates property UI AND clears offset geometry
            const millCheck = container.querySelector('#prop-millHoles');
            if (millCheck) {
                millCheck.addEventListener('change', async (e) => {
                    const isMilling = e.target.checked;
                    
                    // Clear dependent geometry immediately
                    if (this.currentOperation) {
                        // Save the mode change
                        this.currentOperation.settings.millHoles = isMilling;
                        
                        // Clear offset/preview ONLY if they exist
                        if (this.currentOperation.offsets?.length > 0 || this.currentOperation.preview) {
                            this.currentOperation.offsets = [];
                            this.currentOperation.preview = null;
                            this.currentOperation.warnings = [];
                        }
                    }
                    
                    // Re-render inspector UI
                    this.showOperationProperties(this.currentOperation, this.currentGeometryStage);
                    
                    // Update renderer
                    await this.ui.updateRendererAsync();
                    
                    this.ui.statusManager.showStatus(
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
                item.style.marginBottom = '4px';
                item.textContent = warning.message;
                
                // Add severity styling
                if (warning.severity === 'error') {
                    item.style.color = '#dc3545';
                    item.style.fontWeight = 'bold';
                }
                
                // Add recommendation if present
                if (warning.recommendation) {
                    const rec = document.createElement('div');
                    rec.style.cssText = 'font-size: 12px; font-style: italic; margin-top: 2px; color: #666;';
                    rec.textContent = `→ ${warning.recommendation}`;
                    item.appendChild(rec);
                }
                
                list.appendChild(item);
            });
            
            panel.appendChild(list);
            return panel;
        }
        
        async handleAction() {
            this.saveSettings();
            
            const op = this.currentOperation;
            const stage = this.currentGeometryStage;
            
            if (op.type === 'drill') {
                if (stage === 'source') {
                    await this.generateDrillStrategy(op);
                } else if (stage === 'offset') {
                    await this.generatePreview(op);
                } else {
                    await this.generateGcode(op);
                }
            } else if (op.type === 'cutout') {
                if (stage === 'source') await this.generateCutoutOffset(op);
                else if (stage === 'offset') await this.generatePreview(op);
                else await this.generateGcode(op);
            } else {
                if (stage === 'source') await this.generateOffsets(op);
                else if (stage === 'offset') await this.generatePreview(op);
                else await this.generateGcode(op);
            }
        }
        
        async generateOffsets(operation) {
            const settings = this.collectSettings();
            
            // Determine if internal offset based on operation type
            const isInternal = operation.type === 'clear';
            
            // Calculate offset distances with proper sign
            const offsets = this.calculateOffsetDistances(
                settings.toolDiameter,
                settings.passes,
                settings.stepOver,
                isInternal
            );
            
            this.ui.statusManager.showStatus('Generating offset geometry...', 'info');
            
            try {
                await this.core.generateOffsetGeometry(operation, offsets, settings);
                
                if (this.ui.treeManager) {
                    const fileNode = Array.from(this.ui.treeManager.nodes.values())
                        .find(n => n.operation?.id === operation.id);
                    if (fileNode) {
                        this.ui.treeManager.updateFileGeometries(fileNode.id, operation);
                    }
                }
                
                await this.ui.updateRendererAsync();
                this.ui.statusManager.showStatus(`Generated ${operation.offsets.length} offset(s)`, 'success');
            } catch (error) {
                console.error('Offset generation failed:', error);
                this.ui.statusManager.showStatus('Failed: ' + error.message, 'error');
            }
        }
        
        // Unified offset distance calculation
        calculateOffsetDistances(toolDiameter, passes, stepOverPercent, isInternal) {
            const stepOver = stepOverPercent / 100;
            const stepDistance = toolDiameter * (1 - stepOver);
            const offsets = [];
            
            // Internal offsets are negative (deflate), External are positive (inflate)
            const sign = isInternal ? -1 : 1;
            
            for (let i = 0; i < passes; i++) {
                offsets.push(sign * (toolDiameter / 2 + i * stepDistance));
            }
            
            return offsets;
        }

        async generateCutoutOffset(operation) {
            const settings = this.collectSettings();
            const cutSide = settings.cutSide;
            
            let offsetDistance;
            
            if (cutSide === 'on') {
                // A zero distance means the toolpath will follow the line directly.
                offsetDistance = 0;
            } else if (cutSide === 'outside') {
                // A positive distance creates an external offset.
                offsetDistance = settings.toolDiameter / 2;
            } else { // 'inside'
                // A negative distance creates an internal offset.
                offsetDistance = -(settings.toolDiameter / 2);
            }
            
            console.log('[Inspector] Cutout offset distance:', offsetDistance, 'for cutSide:', cutSide);
            
            this.ui.statusManager.showStatus('Generating cutout path...', 'info');
            
            try {
                // The core generator expects an array of distances. For cutouts, it's just one.
                await this.core.generateOffsetGeometry(operation, [offsetDistance], settings);
                
                if (this.ui.treeManager) {
                    const fileNode = Array.from(this.ui.treeManager.nodes.values())
                        .find(n => n.operation?.id === operation.id);
                    if (fileNode) {
                        this.ui.treeManager.updateFileGeometries(fileNode.id, operation);
                    }
                }
                
                await this.ui.updateRendererAsync();
                this.ui.statusManager.showStatus('Cutout path generated', 'success');
            } catch (error) {
                console.error('Cutout offset failed:', error);
                this.ui.statusManager.showStatus('Failed: ' + error.message, 'error');
            }
        }
        
        async generatePreview(operation) {
            if (!operation.offsets || operation.offsets.length === 0) {
                this.ui.statusManager.showStatus('Generate offsets first', 'warning');
                return;
            }

            const firstOffset = operation.offsets[0];
            const toolDiameter = firstOffset.metadata?.toolDiameter;

            if (typeof toolDiameter === 'undefined' || toolDiameter <= 0) {
                this.ui.statusManager.showStatus('Error: Tool diameter not found in offset metadata.', 'error');
                return;
            }
            
            const allPrimitives = [];
            operation.offsets.forEach(offset => {
                // DON'T clone - just mark primitives as preview
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
            };
            
            if (this.ui.treeManager) {
                const fileNode = Array.from(this.ui.treeManager.nodes.values())
                    .find(n => n.operation?.id === operation.id);
                if (fileNode) {
                    this.ui.treeManager.updateFileGeometries(fileNode.id, operation);
                }
            }
            
            await this.ui.updateRendererAsync();
            this.ui.statusManager.showStatus('Preview generated', 'success');
        }
        async generateDrillStrategy(operation) {
            const settings = this.collectSettings();
            
            this.ui.statusManager.showStatus(
                settings.millHoles ? 'Generating milling paths...' : 'Generating peck positions...',
                'info'
            );
            
            try {
                // Call the new core method
                await this.core.generateDrillStrategy(operation, settings);
                
                // Update tree
                if (this.ui.treeManager) {
                    const fileNode = Array.from(this.ui.treeManager.nodes.values())
                        .find(n => n.operation?.id === operation.id);
                    if (fileNode) {
                        this.ui.treeManager.updateFileGeometries(fileNode.id, operation);
                    }
                }
                
                await this.ui.updateRendererAsync();
                
                // Show warnings if any
                const warnings = operation.warnings || [];
                if (warnings.length > 0) {
                    this.ui.statusManager.showStatus(
                        `Generated with ${warnings.length} warning(s)`,
                        'warning'
                    );
                    // Re-render to show warning panel
                    this.showOperationProperties(operation, this.currentGeometryStage);
                } else {
                    const count = operation.offsets[0]?.primitives.length || 0;
                    const mode = settings.millHoles ? 'milling paths' : 'peck positions';
                    this.ui.statusManager.showStatus(
                        `Generated ${count} ${mode}`,
                        'success'
                    );
                }
            } catch (error) {
                console.error('Drill strategy generation failed:', error);
                this.ui.statusManager.showStatus('Failed: ' + error.message, 'error');
            }
        }

        async generateGcode(operation) {
            this.ui.statusManager.showStatus('G-code generation not yet implemented', 'info');
        }

        collectSettings() {
            const settings = {};
            document.querySelectorAll('[data-param]').forEach(field => {
                const param = field.dataset.param;
                const input = field.querySelector('input, select, textarea');
                if (!input) return;
                
                if (input.type === 'checkbox') {
                    settings[param] = input.checked;
                } else if (input.type === 'number') {
                    settings[param] = parseFloat(input.value) || 0;
                } else {
                    settings[param] = input.value;
                }
            });
            
            // Handle tool
            if (settings.tool) {
                const tool = this.toolLibrary?.getTool(settings.tool);
                settings.tool = {
                    id: tool?.id || settings.tool,
                    diameter: settings.toolDiameter || 0.2,
                    type: tool?.type || 'end_mill'
                };
            }
            
            return settings;
        }
        
        saveSettings() {
            if (!this.currentOperation) return;
            const settings = this.collectSettings();
            this.currentOperation.settings = settings;
            this.originalSettings = JSON.parse(JSON.stringify(settings));
        }
        
        getLabel(param) {
            const labels = {
                toolDiameter: 'Diameter',
                passes: 'Number of Passes',
                stepOver: 'Step Over',
                combineOffsets: 'Combine Passes',
                millHoles: 'Mill Holes',
                cutDepth: 'Cut Depth',
                travelZ: 'Travel Z',
                safeZ: 'Safe Z',
                multiDepth: 'Multi-depth',
                depthPerPass: 'Depth/Pass',
                feedRate: 'Feed Rate',
                plungeRate: 'Plunge Rate',
                spindleSpeed: 'Spindle Speed',
                peckDepth: 'Peck Depth',
                peckStepDepth: 'Peck Step Depth',
                dwellTime: 'Dwell Time',
                retractHeight: 'Retract Height',
                tabs: 'Tabs',
                tabWidth: 'Tab Width',
                tabHeight: 'Tab Height'
            };
            return labels[param] || param;
        }
        
        getUnit(param) {
            const units = {
                toolDiameter: 'mm',
                cutDepth: 'mm',
                travelZ: 'mm',
                safeZ: 'mm',
                depthPerPass: 'mm',
                feedRate: 'mm/min',
                plungeRate: 'mm/min',
                spindleSpeed: 'RPM',
                stepOver: '%',
                peckDepth: 'mm',
                dwellTime: 's',
                retractHeight: 'mm',
                tabWidth: 'mm',
                tabHeight: 'mm'
            };
            return units[param] || '';
        }
    }
    
    window.PropertyInspector = PropertyInspector;
    
})();