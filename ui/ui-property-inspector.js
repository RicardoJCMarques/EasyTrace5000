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
            
            // Setup apply/reset button handlers if template is loaded
            this.setupButtons();
            
            this.initialized = true;
            
            if (debugConfig.enabled) {
                console.log('PropertyInspector initialized');
            }
        }
        
        setupButtons() {
            // These buttons are part of the property template
            // We'll bind them when the template is rendered
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
            
            // Get template
            const template = document.getElementById('property-operation-template');
            if (!template) {
                container.innerHTML = '<div class="property-error">Property template not found</div>';
                return;
            }
            
            // Clone and populate template
            const content = template.content.cloneNode(true);
            
            // Populate fields
            this.populateOperationFields(content, operation);
            
            // Clear container and add new content
            container.innerHTML = '';
            container.appendChild(content);
            
            // Setup event handlers for all inputs
            this.attachEventHandlers(container, operation);
        }
        
        populateOperationFields(content, operation) {
            const opConfig = config.operations[operation.type];
            if (!opConfig) return;
            
            // Operation type
            const typeField = content.querySelector('#prop-type');
            if (typeField) {
                typeField.value = operation.type.charAt(0).toUpperCase() + operation.type.slice(1);
            }
            
            // Source file
            const sourceField = content.querySelector('#prop-source');
            if (sourceField) {
                sourceField.value = operation.file.name;
            }
            
            // Tool selection - using embedded tools from config
            const toolSelect = content.querySelector('#prop-tool');
            if (toolSelect && config.tools) {
                toolSelect.innerHTML = '';
                
                // Get compatible tools from config
                const compatibleTools = config.getToolsForOperation(operation.type);
                compatibleTools.forEach(tool => {
                    const option = document.createElement('option');
                    option.value = tool.id;
                    option.textContent = tool.name;
                    
                    // Select current tool
                    if (operation.settings?.tool?.id === tool.id ||
                        (!operation.settings?.tool && tool === config.getDefaultTool(operation.type))) {
                        option.selected = true;
                    }
                    
                    toolSelect.appendChild(option);
                });
                
                // Update tool diameter field
                this.updateToolDiameter(toolSelect.value);
            }
            
            // Populate settings with current or default values
            const settings = operation.settings || opConfig.strategy || {};
            
            // Cutting parameters
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
            // Tool selection change
            const toolSelect = container.querySelector('#prop-tool');
            if (toolSelect) {
                toolSelect.addEventListener('change', (e) => {
                    this.updateToolDiameter(e.target.value);
                    this.markDirty();
                    this.updateOperationTool(operation, e.target.value);
                });
            }
            
            // All input fields
            const inputs = container.querySelectorAll('input[type="number"], select');
            inputs.forEach(input => {
                input.addEventListener('change', () => {
                    this.markDirty();
                    this.debouncedSave();
                });
                
                // For number inputs, also handle input event for real-time updates
                if (input.type === 'number') {
                    input.addEventListener('input', () => {
                        this.markDirty();
                    });
                }
            });
            
            // Apply button
            const applyBtn = container.querySelector('#apply-properties-btn');
            if (applyBtn) {
                applyBtn.addEventListener('click', () => {
                    this.saveSettings();
                    if (this.ui.statusManager) {
                        this.ui.statusManager.showStatus('Settings applied', 'success');
                    }
                });
            }
            
            // Reset button
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
            
            // Also update feed/speed defaults from tool
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
            
            // Enable apply button
            const applyBtn = document.querySelector('#apply-properties-btn');
            if (applyBtn) {
                applyBtn.disabled = false;
                applyBtn.classList.add('btn-dirty');
            }
        }
        
        markClean() {
            this.isDirty = false;
            
            // Disable apply button
            const applyBtn = document.querySelector('#apply-properties-btn');
            if (applyBtn) {
                applyBtn.disabled = true;
                applyBtn.classList.remove('btn-dirty');
            }
        }
        
        saveSettings() {
            if (!this.currentOperation) return;
            
            const operation = this.currentOperation;
            
            // Gather all settings from form
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
            
            // Get selected tool
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
            
            // Update operation
            operation.settings = settings;
            
            // Invalidate toolpath cache if exists
            if (this.core.toolpaths) {
                this.core.isToolpathCacheValid = false;
            }
            
            // Update original settings reference
            this.originalSettings = JSON.parse(JSON.stringify(settings));
            
            this.markClean();
            
            if (debugConfig.enabled) {
                console.log('Settings saved for operation:', operation.id, settings);
            }
            
            // Trigger any necessary updates
            if (this.ui.treeManager) {
                this.ui.treeManager.updateNodeCounts();
            }
        }
        
        resetSettings() {
            if (!this.currentOperation || !this.originalSettings) return;
            
            // Restore original settings
            this.currentOperation.settings = JSON.parse(JSON.stringify(this.originalSettings));
            
            // Refresh the display
            this.showOperationProperties(this.currentOperation);
            
            this.markClean();
            
            if (this.ui.statusManager) {
                this.ui.statusManager.showStatus('Settings reset', 'info');
            }
        }
        
        showGeometryInfo(operation, geometryType) {
            // Show simplified info for geometry nodes
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
            // Called when toolpaths are generated
            // Could show additional info or statistics
            if (this.currentOperation && this.ui.treeManager) {
                this.ui.treeManager.updateFileGeometries(
                    this.ui.treeManager.selectedNode?.id,
                    this.currentOperation
                );
            }
        }
        
        // Utility function for debouncing
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
        
        // Validation helpers
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
            
            // Validate passes (1-10)
            const passesInput = document.querySelector('#prop-passes');
            if (passesInput) {
                isValid = this.validateNumericInput(passesInput, 1, 10) && isValid;
            }
            
            // Validate stepover (10-100%)
            const stepOverInput = document.querySelector('#prop-stepover');
            if (stepOverInput) {
                isValid = this.validateNumericInput(stepOverInput, 10, 100) && isValid;
            }
            
            // Validate cut depth (0.001-10mm)
            const cutDepthInput = document.querySelector('#prop-cut-depth');
            if (cutDepthInput) {
                isValid = this.validateNumericInput(cutDepthInput, 0.001, 10) && isValid;
            }
            
            // Validate feed rate (1-5000mm/min)
            const feedRateInput = document.querySelector('#prop-feed-rate');
            if (feedRateInput) {
                isValid = this.validateNumericInput(feedRateInput, 1, 5000) && isValid;
            }
            
            return isValid;
        }
    }
    
    // Export
    window.PropertyInspector = PropertyInspector;
    
})();