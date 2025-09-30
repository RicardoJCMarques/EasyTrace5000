// ui/ui-property-inspector.js
// Manages the dynamic property panel in the right sidebar

(function() {
    'use strict';
    
    const config = window.PCBCAMConfig || {};
    const debugConfig = config.debug || {};
    const debounceMs = config.performance?.debounce?.propertyChanges || 300;
    
    class PropertyInspector {
        constructor(ui) {
            this.ui = ui;
            this.core = ui.core;
            this.toolLibrary = null;
            
            // Current context
            this.currentOperation = null;
            this.currentGeometry = null;
            
            // Property change tracking
            this.isDirty = false;
            this.originalSettings = null;
            
            // Debounced save function
            this.debouncedSave = this.debounce(this.saveSettings.bind(this), debounceMs);
            
            this.initialized = false;
        }
        
        init(toolLibrary) {
            if (this.initialized) return;
            
            this.toolLibrary = toolLibrary;
            this.setupButtons();
            this.initialized = true;
            
            if (debugConfig.enabled) {
                console.log('PropertyInspector initialized');
            }
        }
        
        setupButtons() {
            // Buttons are bound when template is rendered
        }
        
        clearProperties() {
            const container = document.getElementById('property-form');
            if (!container) return;
            
            container.innerHTML = '<div class="property-empty">Select an operation to view properties</div>';
            
            const title = document.getElementById('inspector-title');
            if (title) {
                title.textContent = 'Properties';
            }
            
            this.currentOperation = null;
            this.currentGeometry = null;
            this.isDirty = false;
        }
        
        showOperationProperties(operation) {
            if (!operation) {
                this.clearProperties();
                return;
            }
            
            this.currentOperation = operation;
            this.currentGeometry = null;
            this.originalSettings = JSON.parse(JSON.stringify(operation.settings || {}));
            
            const container = document.getElementById('property-form');
            const title = document.getElementById('inspector-title');
            
            if (!container || !title) return;
            
            title.textContent = `${operation.file.name}`;
            
            const template = document.getElementById('property-operation-template');
            if (!template) {
                container.innerHTML = '<div class="property-error">Property template not found</div>';
                return;
            }
            
            const content = template.content.cloneNode(true);
            
            this.populateOperationFields(content, operation);
            
            container.innerHTML = '';
            container.appendChild(content);
            
            this.attachEventHandlers(container, operation);
        }
        
        populateOperationFields(content, operation) {
            const opConfig = config.operations[operation.type];
            if (!opConfig) return;
            
            const typeField = content.querySelector('#prop-type');
            if (typeField) {
                typeField.value = operation.type.charAt(0).toUpperCase() + operation.type.slice(1);
            }
            
            const sourceField = content.querySelector('#prop-source');
            if (sourceField) {
                sourceField.value = operation.file.name;
            }
            
            const toolSelect = content.querySelector('#prop-tool');
            if (toolSelect && config.tools) {
                toolSelect.innerHTML = '';
                
                const compatibleTools = config.getToolsForOperation(operation.type);
                compatibleTools.forEach(tool => {
                    const option = document.createElement('option');
                    option.value = tool.id;
                    option.textContent = tool.name;
                    
                    if (operation.settings?.tool?.id === tool.id ||
                        (!operation.settings?.tool && tool === config.getDefaultTool(operation.type))) {
                        option.selected = true;
                    }
                    
                    toolSelect.appendChild(option);
                });
                
                this.updateToolDiameter(toolSelect.value);
            }
            
            const settings = operation.settings || opConfig.strategy || {};
            
            const fields = {
                'prop-passes': settings.passes || 1,
                'prop-stepover': settings.overlap || 50,
                'prop-cut-depth': opConfig.cutting?.cutDepth || 0.05,
                'prop-feed-rate': opConfig.cutting?.cutFeed || 150,
                'prop-plunge-rate': opConfig.cutting?.plungeFeed || 50,
                'prop-spindle-speed': opConfig.cutting?.spindleSpeed || 12000,
                'prop-direction': settings.direction || 'climb',
                'prop-entry': settings.entryType || 'plunge'
            };
            
            Object.entries(fields).forEach(([id, value]) => {
                const field = content.querySelector(`#${id}`);
                if (field) {
                    field.value = value;
                }
            });
        }
        
        attachEventHandlers(container, operation) {
            const toolSelect = container.querySelector('#prop-tool');
            if (toolSelect) {
                toolSelect.addEventListener('change', (e) => {
                    this.updateToolDiameter(e.target.value);
                    this.markDirty();
                    this.updateOperationTool(operation, e.target.value);
                });
            }
            
            const inputs = container.querySelectorAll('input[type="number"], select');
            inputs.forEach(input => {
                input.addEventListener('change', () => {
                    this.markDirty();
                    this.debouncedSave();
                });
                
                if (input.type === 'number') {
                    input.addEventListener('input', () => {
                        this.markDirty();
                    });
                }
            });
            
            const applyBtn = container.querySelector('#apply-properties-btn');
            if (applyBtn) {
                applyBtn.addEventListener('click', () => {
                    this.saveSettings();
                    if (this.ui.statusManager) {
                        this.ui.statusManager.showStatus('Settings applied', 'success');
                    }
                });
            }

            const generateBtn = container.querySelector('#generate-offsets-btn');
            if (generateBtn) {
                generateBtn.addEventListener('click', async () => {
                    await this.generateOffsetGeometry(operation);
                });
            }
            
            const resetBtn = container.querySelector('#reset-properties-btn');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => {
                    this.resetSettings();
                });
            }
        }
        
        updateToolDiameter(toolId) {
            const tool = config.tools.find(t => t.id === toolId);
            if (!tool) return;
            
            const diameterField = document.querySelector('#prop-tool-diameter');
            if (diameterField) {
                diameterField.value = tool.diameter;
            }
            
            const feedField = document.querySelector('#prop-feed-rate');
            const plungeField = document.querySelector('#prop-plunge-rate');
            const spindleField = document.querySelector('#prop-spindle-speed');
            
            if (feedField && tool.cutting?.feedRate) {
                feedField.value = tool.cutting.feedRate;
            }
            if (plungeField && tool.cutting?.plungeRate) {
                plungeField.value = tool.cutting.plungeRate;
            }
            if (spindleField && tool.cutting?.spindleSpeed) {
                spindleField.value = tool.cutting.spindleSpeed;
            }
        }
        
        updateOperationTool(operation, toolId) {
            const tool = config.tools.find(t => t.id === toolId);
            if (!tool) return;
            
            if (!operation.settings) {
                operation.settings = {};
            }
            
            operation.settings.tool = {
                id: tool.id,
                diameter: tool.diameter,
                type: tool.type
            };
        }
        
        markDirty() {
            this.isDirty = true;
            
            const applyBtn = document.querySelector('#apply-properties-btn');
            if (applyBtn) {
                applyBtn.disabled = false;
                applyBtn.classList.add('btn-dirty');
            }
        }
        
        markClean() {
            this.isDirty = false;
            
            const applyBtn = document.querySelector('#apply-properties-btn');
            if (applyBtn) {
                applyBtn.disabled = true;
                applyBtn.classList.remove('btn-dirty');
            }
        }
        
        saveSettings() {
            if (!this.currentOperation) return;
            
            const operation = this.currentOperation;
            
            const settings = {
                tool: {},
                passes: parseInt(document.querySelector('#prop-passes')?.value) || 1,
                overlap: parseFloat(document.querySelector('#prop-stepover')?.value) || 50,
                cutDepth: parseFloat(document.querySelector('#prop-cut-depth')?.value) || 0.05,
                feedRate: parseFloat(document.querySelector('#prop-feed-rate')?.value) || 150,
                plungeRate: parseFloat(document.querySelector('#prop-plunge-rate')?.value) || 50,
                spindleSpeed: parseInt(document.querySelector('#prop-spindle-speed')?.value) || 12000,
                direction: document.querySelector('#prop-direction')?.value || 'climb',
                entryType: document.querySelector('#prop-entry')?.value || 'plunge'
            };
            
            const toolId = document.querySelector('#prop-tool')?.value;
            if (toolId) {
                const tool = config.tools.find(t => t.id === toolId);
                if (tool) {
                    settings.tool = {
                        id: tool.id,
                        diameter: tool.diameter,
                        type: tool.type
                    };
                }
            }
            
            operation.settings = settings;
            
            if (this.core.toolpaths) {
                this.core.isToolpathCacheValid = false;
            }
            
            this.originalSettings = JSON.parse(JSON.stringify(settings));
            
            this.markClean();
            
            if (debugConfig.enabled) {
                console.log('Settings saved for operation:', operation.id, settings);
            }
            
            if (this.ui.treeManager) {
                this.ui.treeManager.updateNodeCounts();
            }
        }
        
        resetSettings() {
            if (!this.currentOperation || !this.originalSettings) return;
            
            this.currentOperation.settings = JSON.parse(JSON.stringify(this.originalSettings));
            
            this.showOperationProperties(this.currentOperation);
            
            this.markClean();
            
            if (this.ui.statusManager) {
                this.ui.statusManager.showStatus('Settings reset', 'info');
            }
        }
        
        showGeometryInfo(operation, geometryType) {
            const container = document.getElementById('property-form');
            const title = document.getElementById('inspector-title');
            
            if (!container || !title) return;
            
            title.textContent = `Geometry: ${geometryType}`;
            
            let info = '';
            if (geometryType === 'source') {
                info = `
                    <div class="property-group">
                        <h3>Source Geometry</h3>
                        <div class="property-info">
                            <p>Original geometry from ${operation.file.name}</p>
                            <p>Primitives: ${operation.primitives?.length || 0}</p>
                            <p>Type: ${operation.type}</p>
                        </div>
                    </div>
                `;
            } else if (geometryType === 'fused') {
                const fusedCount = this.core.getFusedPrimitives ? this.core.getFusedPrimitives().length : 0;
                info = `
                    <div class="property-group">
                        <h3>Fused Geometry</h3>
                        <div class="property-info">
                            <p>Result of Clipper2 boolean operations</p>
                            <p>Primitives: ${fusedCount}</p>
                            <p>Arc reconstruction: ${this.ui.viewState?.enableArcReconstruction ? 'Enabled' : 'Disabled'}</p>
                        </div>
                    </div>
                `;
            } else if (geometryType.startsWith('toolpath')) {
                info = `
                    <div class="property-group">
                        <h3>Toolpath</h3>
                        <div class="property-info">
                            <p>Generated toolpath for machining</p>
                            <p>Parent operation: ${operation.file.name}</p>
                        </div>
                    </div>
                `;
            }
            
            container.innerHTML = info;
        }
        
        updateForToolpathGeneration() {
            if (this.currentOperation && this.ui.treeManager) {
                this.ui.treeManager.updateFileGeometries(
                    this.ui.treeManager.selectedNode?.id,
                    this.currentOperation
                );
            }
        }
        
        debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        }
        
        validateNumericInput(input, min, max) {
            const value = parseFloat(input.value);
            if (isNaN(value)) {
                input.classList.add('invalid');
                return false;
            }
            
            if (min !== undefined && value < min) {
                input.value = min;
            }
            if (max !== undefined && value > max) {
                input.value = max;
            }
            
            input.classList.remove('invalid');
            return true;
        }
        
        validateAllInputs() {
            let isValid = true;
            
            const passesInput = document.querySelector('#prop-passes');
            if (passesInput) {
                isValid = this.validateNumericInput(passesInput, 1, 10) && isValid;
            }
            
            const stepOverInput = document.querySelector('#prop-stepover');
            if (stepOverInput) {
                isValid = this.validateNumericInput(stepOverInput, 10, 100) && isValid;
            }
            
            const cutDepthInput = document.querySelector('#prop-cut-depth');
            if (cutDepthInput) {
                isValid = this.validateNumericInput(cutDepthInput, 0.001, 10) && isValid;
            }
            
            const feedRateInput = document.querySelector('#prop-feed-rate');
            if (feedRateInput) {
                isValid = this.validateNumericInput(feedRateInput, 1, 5000) && isValid;
            }
            
            return isValid;
        }

        // FIXED: Simplified offset generation - core handles fusion, UI rebuilds layers
        async generateOffsetGeometry(operation) {
            const settings = {
                tool: {
                    diameter: parseFloat(
                        document.querySelector('#prop-tool-diameter')?.value
                    ) || 0.2
                },
                passes: parseInt(
                    document.querySelector('#prop-passes')?.value
                ) || 1,
                stepOver: parseFloat(
                    document.querySelector('#prop-stepover')?.value
                ) || 50,
                joinType: document.querySelector('#prop-join-type')?.value || 'round',
                direction: document.querySelector('#prop-direction')?.value || 'climb'
            };
            
            if (settings.tool.diameter <= 0) {
                this.ui.updateStatus('Invalid tool diameter', 'error');
                return;
            }
            
            const offsets = this.calculateOffsetDistances(
                settings.tool.diameter,
                settings.passes,
                settings.stepOver
            );
            
            this.ui.updateStatus(`Generating ${settings.passes} pass(es) for ${settings.tool.diameter}mm tool...`, 'info');
            
            if (debugConfig.enabled) {
                console.log(`[PropertyInspector] Offset Strategy:`);
                console.log(`  Tool: ${settings.tool.diameter}mm diameter`);
                console.log(`  Passes: ${settings.passes}`);
                offsets.forEach((offset, i) => {
                    console.log(`  Pass ${i+1}: ${Math.abs(offset).toFixed(3)}mm outward`);
                });
            }
            
            try {
                // Core will handle fusion internally and store results in operation.offsets
                await this.core.generateOffsetGeometry(operation, offsets, settings);
                
                // Update tree to show offset nodes
                if (this.ui.treeManager) {
                    const fileNode = Array.from(this.ui.treeManager.nodes.values())
                        .find(n => n.operation?.id === operation.id);
                    if (fileNode) {
                        this.ui.treeManager.updateFileGeometries(fileNode.id, operation);
                    }
                }
                
                // Rebuild renderer - it will pick up offset layers from operation.offsets
                await this.ui.updateRendererAsync();
                
                this.ui.updateStatus(
                    `Generated ${operation.offsets.length} offset pass(es)`,
                    'success'
                );
                
            } catch (error) {
                console.error('Offset generation failed:', error);
                this.ui.updateStatus(
                    'Offset generation failed: ' + error.message,
                    'error'
                );
            }
        }

        calculateOffsetDistances(toolDiameter, passes, stepOverPercent) {
            const stepOver = stepOverPercent / 100;
            const stepDistance = toolDiameter * (1 - stepOver);
            const offsets = [];
            
            for (let i = 0; i < passes; i++) {
                offsets.push(-(toolDiameter / 2 + i * stepDistance));
            }
            
            return offsets;
        }
    }
    
    window.PropertyInspector = PropertyInspector;
    
})();