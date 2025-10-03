// ui/ui-property-inspector.js
// REFACTORED: Stage-based parameter organization, drilling mill holes support

(function() {
    'use strict';
    
    const config = window.PCBCAMConfig || {};
    const debugConfig = config.debug || {};
    
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
            
            this.currentOperation = operation;
            this.currentGeometryStage = geometryStage;
            this.originalSettings = JSON.parse(JSON.stringify(operation.settings || {}));
            
            const container = document.getElementById('property-form');
            const title = document.getElementById('inspector-title');
            
            if (!container || !title) return;
            
            title.textContent = operation.file.name;
            container.innerHTML = '';
            
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
                // Offset stage: Z-axis and depth parameters
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
                container.appendChild(this.createSection('Tool Selection', [
                    this.createToolField('tool', operation),
                    this.createField('toolDiameter', 'number', {
                        value: operation.settings.tool?.diameter || 0.8,
                        step: 0.001,
                        min: 0.01
                    })
                ]));
                
                // NEW: Mill holes option
                container.appendChild(this.createSection('Drilling Mode', [
                    this.createField('millHoles', 'checkbox', {
                        checked: operation.settings.millHoles || false,
                        label: 'Mill Holes (for undersized tools)'
                    })
                ]));
                
                // Show either direct drilling or milling params
                const millHoles = operation.settings.millHoles || false;
                
                if (!millHoles) {
                    // Direct drilling parameters
                    const cannedCycleField = this.createSelectField('cannedCycle', 'Cycle', 
                        operation.settings.cannedCycle || 'none', [
                        { value: 'none', label: 'None (G0 + G1)' },
                        { value: 'G81', label: 'G81 - Simple Drill' },
                        { value: 'G82', label: 'G82 - Dwell at Bottom' },
                        { value: 'G83', label: 'G83 - Peck Drilling' },
                        { value: 'G73', label: 'G73 - Peck Step Drilling' }
                    ]);
                    
                    container.appendChild(this.createSection('Drilling Parameters', [
                        cannedCycleField,
                        this.createField('dwellTime', 'number', {
                            value: operation.settings.dwellTime || 0,
                            step: 0.1,
                            min: 0
                        }),
                        this.createField('retractHeight', 'number', {
                            value: operation.settings.retractHeight || 0.5,
                            step: 0.01,
                            min: 0
                        }),
                        this.createField('peckDepth', 'number', {
                            value: operation.settings.peckDepth || 0,
                            step: 0.01,
                            min: 0
                        }),
                        this.createField('peckStepDepth', 'number', {
                            value: operation.settings.peckStepDepth || 0,
                            step: 0.01,
                            min: 0
                        })
                    ]));
                    
                    container.appendChild(this.createSection('Cutting Parameters', [
                        this.createField('cutDepth', 'number', {
                            value: operation.settings.cutDepth || -1.8,
                            step: 0.1
                        }),
                        this.createField('feedRate', 'number', {
                            value: operation.settings.feedRate || 60,
                            min: 1, max: 500
                        }),
                        this.createField('plungeRate', 'number', {
                            value: operation.settings.plungeRate || 30,
                            min: 1, max: 500
                        }),
                        this.createField('spindleSpeed', 'number', {
                            value: operation.settings.spindleSpeed || 10000,
                            min: 100, max: 30000
                        })
                    ]));
                    
                    container.appendChild(this.createActionButton('Generate Preview'));
                } else {
                    // Milling mode: offset generation parameters
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
                    
                    container.appendChild(this.createActionButton('Generate Offsets'));
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
                
            } else if (stage === 'offset') {
                // Same Z-axis params as isolation
                this.renderIsolationProperties(container, operation, 'offset');
                
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
            
            // Mill holes toggle changes button text
            const millCheck = container.querySelector('#prop-millHoles');
            if (millCheck) {
                millCheck.addEventListener('change', (e) => {
                    // Re-render to show appropriate parameters
                    this.showOperationProperties(this.currentOperation, this.currentGeometryStage);
                });
            }
            
            // Action button
            const actionBtn = container.querySelector('#action-button');
            if (actionBtn) {
                actionBtn.addEventListener('click', () => this.handleAction());
            }
        }
        
        async handleAction() {
            this.saveSettings();
            
            const op = this.currentOperation;
            const stage = this.currentGeometryStage;
            
            if (op.type === 'drill') {
                if (stage === 'source') {
                    if (op.settings.millHoles) {
                        await this.generateDrillOffsets(op);
                    } else {
                        await this.generateDrillPreview(op);
                    }
                } else if (stage === 'offset') {
                    await this.generatePreview(op);
                } else {
                    await this.generateGcode(op);
                }
            } else if (op.type === 'cutout') {
                if (stage === 'source') await this.generateCutoutOffset(op);  // Changed
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
            
            // Determine if internal offset (clear operation)
            const isInternal = operation.type === 'clear';
            
            const offsets = config.calculateOffsetDistances?.(
                settings.toolDiameter,
                settings.passes,
                settings.stepOver,
                isInternal  // Add this parameter
            ) || [];
            
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

        async generateCutoutOffset(operation) {
            const settings = this.collectSettings();
            const cutSide = settings.cutSide || 'outside';
            
            // Only works inside?
            let offsetDistance;
            if (cutSide === 'outside') {
                offsetDistance = settings.toolDiameter / 2;  // Positive = expand
            } else if (cutSide === 'inside') {
                offsetDistance = -(settings.toolDiameter / 2);  // Negative = shrink
            } else {
                offsetDistance = 0;  // Cut on line
            }
            
            console.log('[Inspector] Cutout offset:', offsetDistance, 'cutSide:', cutSide);
            
            this.ui.statusManager.showStatus('Generating cutout offset...', 'info');
            
            try {
                await this.core.generateOffsetGeometry(operation, [offsetDistance], settings);
                
                if (this.ui.treeManager) {
                    const fileNode = Array.from(this.ui.treeManager.nodes.values())
                        .find(n => n.operation?.id === operation.id);
                    if (fileNode) {
                        this.ui.treeManager.updateFileGeometries(fileNode.id, operation);
                    }
                }
                
                await this.ui.updateRendererAsync();
                this.ui.statusManager.showStatus('Cutout offset generated', 'success');
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
            
            const settings = this.collectSettings();
            const allPrimitives = [];
            operation.offsets.forEach(offset => {
                allPrimitives.push(...offset.primitives);
            });
            
            // FIXED: Properly clone primitives with getBounds() method
            const previewPrimitives = allPrimitives.map(p => {
                if (p.type === 'circle') {
                    // Use CirclePrimitive if available, otherwise create with getBounds
                    if (typeof CirclePrimitive !== 'undefined') {
                        return new CirclePrimitive(p.center, p.radius, {
                            ...p.properties,
                            isPreview: true,
                            toolDiameter: settings.toolDiameter
                        });
                    }
                    return {
                        type: 'circle',
                        center: p.center,
                        radius: p.radius,
                        properties: {
                            ...p.properties,
                            isPreview: true,
                            toolDiameter: settings.toolDiameter
                        },
                        getBounds: function() {
                            return {
                                minX: this.center.x - this.radius,
                                minY: this.center.y - this.radius,
                                maxX: this.center.x + this.radius,
                                maxY: this.center.y + this.radius
                            };
                        }
                    };
                } else if (p.type === 'path') {
                    // Use PathPrimitive if available
                    if (typeof PathPrimitive !== 'undefined') {
                        return new PathPrimitive(p.points, {
                            ...p.properties,
                            isPreview: true,
                            toolDiameter: settings.toolDiameter
                        });
                    }
                    return {
                        type: 'path',
                        points: p.points,
                        closed: p.closed,
                        properties: {
                            ...p.properties,
                            isPreview: true,
                            toolDiameter: settings.toolDiameter
                        },
                        getBounds: function() {
                            let minX = Infinity, minY = Infinity;
                            let maxX = -Infinity, maxY = -Infinity;
                            this.points.forEach(pt => {
                                minX = Math.min(minX, pt.x);
                                minY = Math.min(minY, pt.y);
                                maxX = Math.max(maxX, pt.x);
                                maxY = Math.max(maxY, pt.y);
                            });
                            return { minX, minY, maxX, maxY };
                        }
                    };
                }
                
                // Fallback for other types - copy with getBounds if it exists
                return p.getBounds ? p : {
                    ...p,
                    getBounds: () => ({ minX: 0, minY: 0, maxX: 0, maxY: 0 })
                };
            });
            
            operation.preview = {
                primitives: previewPrimitives,
                metadata: {
                    generatedAt: Date.now(),
                    sourceOffsets: operation.offsets.length,
                    toolDiameter: settings.toolDiameter
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
        
        async generateDrillOffsets(operation) {
            this.ui.statusManager.showStatus('Drill hole milling offsets not yet implemented', 'info');
            // TODO: Generate circular offsets for each drill hole
        }
        
        async generateDrillPreview(operation) {
            // Generate filled circles at tool diameter for each hole
            const settings = this.collectSettings();
            const toolRadius = settings.toolDiameter / 2;
            
            const previewPrimitives = [];
            operation.primitives.forEach(drillHole => {
                if (drillHole.type === 'circle') {
                    previewPrimitives.push({
                        type: 'circle',
                        center: drillHole.center,
                        radius: toolRadius,
                        properties: {
                            isDrillPreview: true,
                            toolDiameter: settings.toolDiameter,
                            originalHoleRadius: drillHole.radius,
                            fill: true
                        },
                        getBounds: function() {
                            return {
                                minX: this.center.x - this.radius,
                                minY: this.center.y - this.radius,
                                maxX: this.center.x + this.radius,
                                maxY: this.center.y + this.radius
                            };
                        }
                    });
                }
            });
            
            operation.preview = {
                primitives: previewPrimitives,
                metadata: {
                    generatedAt: Date.now(),
                    toolDiameter: settings.toolDiameter
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
            this.ui.statusManager.showStatus('Drill preview generated', 'success');
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