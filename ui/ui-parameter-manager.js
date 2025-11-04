/**
 * @file        ui/ui-parameter-manager.js
 * @description Enhanced parameter management with state storage and validation
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
    
    class ParameterManager {
        constructor() {
            // Parameter definitions and metadata
            this.parameterDefinitions = this.initializeDefinitions();
            
            // State storage - persists across operation/stage switches
            this.operationStates = new Map(); // operationId -> { source: {}, offset: {}, preview: {} }
            this.dirtyFlags = new Map(); // operationId -> Set of dirty stages
            
            // Active state
            this.currentOperationId = null;
            this.currentStage = null;
            
            // Validation rules
            this.validators = this.initializeValidators();
            
            // Change listeners
            this.changeListeners = new Set();
        }
        
        initializeDefinitions() {
            return {
                // Tool parameters
                tool: {
                    type: 'select',
                    label: 'Tool',
                    stage: 'source',
                    category: 'tool'
                },
                toolDiameter: {
                    type: 'number',
                    label: 'Tool Diameter',
                    unit: 'mm',
                    min: 0.01,
                    max: 10,
                    step: 0.001,
                    stage: 'source',
                    category: 'tool'
                },
                
                // Offset generation
                passes: {
                    type: 'number',
                    label: 'Number of Passes',
                    min: 1,
                    max: 10,
                    step: 1,
                    stage: 'source',
                    category: 'offset'
                },
                stepOver: {
                    type: 'number',
                    label: 'Step Over',
                    unit: '%',
                    min: 10,
                    max: 100,
                    step: 5,
                    stage: 'source',
                    category: 'offset'
                },
                combineOffsets: {
                    type: 'checkbox',
                    label: 'Combine Passes',
                    default: true,
                    stage: 'source',
                    category: 'offset'
                },
                
                // Z-axis parameters
                cutDepth: {
                    type: 'number',
                    label: 'Cut Depth',
                    unit: 'mm',
                    min: -10,
                    max: 0,
                    step: 0.001,
                    stage: 'offset',
                    category: 'depth'
                },
                depthPerPass: {
                    type: 'number',
                    label: 'Depth per Pass',
                    unit: 'mm',
                    min: 0.001,
                    max: 5,
                    step: 0.001,
                    stage: 'offset',
                    category: 'depth',
                    conditional: 'multiDepth'
                },
                multiDepth: {
                    type: 'checkbox',
                    label: 'Multi-depth Cutting',
                    default: true, // connect to config.js in the future.
                    stage: 'offset',
                    category: 'depth'
                },
                travelZ: {
                    type: 'number',
                    label: 'Travel Z',
                    unit: 'mm',
                    min: 0,
                    max: 50,
                    step: 0.1,
                    stage: 'offset',
                    category: 'depth'
                },
                safeZ: {
                    type: 'number',
                    label: 'Safe Z',
                    unit: 'mm',
                    min: 0,
                    max: 50,
                    step: 0.1,
                    stage: 'offset',
                    category: 'depth'
                },
                
                // Feed and speed
                feedRate: {
                    type: 'number',
                    label: 'Feed Rate',
                    unit: 'mm/min',
                    min: 1,
                    max: 5000,
                    step: 10,
                    stage: 'offset',
                    category: 'feeds'
                },
                plungeRate: {
                    type: 'number',
                    label: 'Plunge Rate',
                    unit: 'mm/min',
                    min: 1,
                    max: 1000,
                    step: 5,
                    stage: 'offset',
                    category: 'feeds'
                },
                spindleSpeed: {
                    type: 'number',
                    label: 'Spindle Speed',
                    unit: 'RPM',
                    min: 100,
                    max: 30000,
                    step: 100,
                    stage: 'offset',
                    category: 'feeds'
                },
                
                // Strategy
                direction: {
                    type: 'select',
                    label: 'Cut Direction',
                    options: [
                        { value: 'climb', label: 'Climb' },
                        { value: 'conventional', label: 'Conventional' }
                    ],
                    stage: 'offset',
                    category: 'strategy'
                },
                entryType: {
                    type: 'select',
                    label: 'Entry Type',
                    options: [
                        { value: 'plunge', label: 'Plunge' },
                        { value: 'ramp', label: 'Ramp' },
                        { value: 'helix', label: 'Helix' }
                    ],
                    stage: 'offset',
                    category: 'strategy'
                },
                
                // Drilling specific
                millHoles: {
                    type: 'checkbox',
                    label: 'Mill Holes',
                    default: true,
                    stage: 'source',
                    category: 'drill',
                    operationType: 'drill'
                },
                cannedCycle: {
                    type: 'select',
                    label: 'Canned Cycle',
                    options: [
                        { value: 'none', label: 'None (G0 + G1)' },
                        { value: 'G81', label: 'G81 - Simple Drill' },
                        { value: 'G82', label: 'G82 - Dwell' },
                        { value: 'G83', label: 'G83 - Peck' },
                        { value: 'G73', label: 'G73 - Peck (Stepped)' }
                    ],
                    stage: 'source',
                    category: 'drill',
                    operationType: 'drill',
                    conditional: '!millHoles'
                },
                peckDepth: {
                    type: 'number',
                    label: 'Peck Depth',
                    unit: 'mm',
                    min: 0,
                    max: 5,
                    step: 0.01,
                    stage: 'source',
                    category: 'drill',
                    operationType: 'drill'
                },
                dwellTime: {
                    type: 'number',
                    label: 'Dwell Time',
                    unit: 's',
                    min: 0,
                    max: 10,
                    step: 0.1,
                    stage: 'source',
                    category: 'drill',
                    operationType: 'drill'
                },
                retractHeight: {
                    type: 'number',
                    label: 'Retract Height',
                    unit: 'mm',
                    min: 0,
                    max: 10,
                    step: 0.01,
                    stage: 'source',
                    category: 'drill',
                    operationType: 'drill'
                },
                
                // Cutout specific
                cutSide: {
                    type: 'select',
                    label: 'Cut Side',
                    options: [
                        { value: 'outside', label: 'Outside' },
                        { value: 'inside', label: 'Inside' },
                        { value: 'on', label: 'On Line' }
                    ],
                    default: 'outside',
                    stage: 'source',
                    category: 'cutout',
                    operationType: 'cutout'
                },
                tabs: {
                    type: 'number',
                    label: 'Number of Tabs',
                    min: 0,
                    max: 12,
                    step: 1,
                    stage: 'offset',
                    category: 'cutout',
                    operationType: 'cutout'
                },
                tabWidth: {
                    type: 'number',
                    label: 'Tab Width',
                    unit: 'mm',
                    min: 0.5,
                    max: 10,
                    step: 0.1,
                    stage: 'offset',
                    category: 'cutout',
                    operationType: 'cutout'
                },
                tabHeight: {
                    type: 'number',
                    label: 'Tab Height',
                    unit: 'mm',
                    min: 0.1,
                    max: 5,
                    step: 0.1,
                    stage: 'offset',
                    category: 'cutout',
                    operationType: 'cutout'
                },
                
                // Machine config
                postProcessor: {
                    type: 'select',
                    label: 'Post Processor',
                    options: [
                        { value: 'grbl', label: 'GRBL' },
                        { value: 'marlin', label: 'Marlin' },
                        { value: 'linuxcnc', label: 'LinuxCNC' },
                        { value: 'mach3', label: 'Mach3' }
                    ],
                    stage: 'preview',
                    category: 'machine'
                },
                workOffset: {
                    type: 'select',
                    label: 'Work Offset',
                    options: [
                        { value: 'G54', label: 'G54' },
                        { value: 'G55', label: 'G55' },
                        { value: 'G56', label: 'G56' }
                    ],
                    stage: 'preview',
                    category: 'machine'
                },
                startCode: {
                    type: 'textarea',
                    label: 'Start G-code',
                    rows: 4,
                    stage: 'preview',
                    category: 'machine'
                },
                endCode: {
                    type: 'textarea',
                    label: 'End G-code',
                    rows: 3,
                    stage: 'preview',
                    category: 'machine'
                }
            };
        }
        
        initializeValidators() {
            return {
                toolDiameter: (val) => val >= 0.01 && val <= 10,
                passes: (val) => Number.isInteger(val) && val >= 1 && val <= 30,
                stepOver: (val) => val >= 10 && val <= 100,
                cutDepth: (val) => val <= 0 && val >= -10,
                depthPerPass: (val) => val > 0 && val <= 5, // MUST BE POSITIVE
                feedRate: (val) => val >= 1 && val <= 2000,
                plungeRate: (val) => val >= 1 && val <= 1000,
                spindleSpeed: (val) => val >= 100 && val <= 50000
            };
        }
        
        // Get or create state for an operation
        getOperationState(operationId) {
            if (!this.operationStates.has(operationId)) {
                this.operationStates.set(operationId, {
                    source: {},
                    offset: {},
                    preview: {}
                });
            }
            return this.operationStates.get(operationId);
        }
        
        // Get parameters for current context
        getParameters(operationId, stage) {
            const state = this.getOperationState(operationId);
            return state[stage] || {};
        }
        
        // Set a single parameter
        setParameter(operationId, stage, name, value) {
            const state = this.getOperationState(operationId);
            if (!state[stage]) state[stage] = {};
            
            // Validate if validator exists
            if (this.validators[name]) {
                if (!this.validators[name](value)) {
                    console.warn(`Invalid value for ${name}: ${value}`);
                    return false;
                }
            }
            
            state[stage][name] = value;
            
            // Mark as dirty
            if (!this.dirtyFlags.has(operationId)) {
                this.dirtyFlags.set(operationId, new Set());
            }
            this.dirtyFlags.get(operationId).add(stage);
            
            // Notify listeners
            this.notifyChange(operationId, stage, name, value);
            
            return true;
        }
        
        // Set multiple parameters
        setParameters(operationId, stage, params) {
            const state = this.getOperationState(operationId);
            if (!state[stage]) state[stage] = {};
            
            Object.assign(state[stage], params);
            
            // Mark as dirty
            if (!this.dirtyFlags.has(operationId)) {
                this.dirtyFlags.set(operationId, new Set());
            }
            this.dirtyFlags.get(operationId).add(stage);
            
            // Notify listeners
            for (const [name, value] of Object.entries(params)) {
                this.notifyChange(operationId, stage, name, value);
            }
        }
        
        // Get all parameters for an operation (merged across stages)
        getAllParameters(operationId) {
            const state = this.getOperationState(operationId);
            return {
                ...state.source,
                ...state.offset,
                ...state.preview
            };
        }
        
        // Commit parameters to operation object
        commitToOperation(operation) {
            const params = this.getAllParameters(operation.id);
            
            // Merge into operation settings
            if (!operation.settings) operation.settings = {};
            Object.assign(operation.settings, params);
            
            // Clear dirty flag
            this.dirtyFlags.delete(operation.id);
            
            if (debugConfig.enabled) {
                console.log(`[ParameterManager] Committed ${Object.keys(params).length} parameters to operation ${operation.id}`);
            }
        }
        
        // Load parameters from operation
        loadFromOperation(operation) {
            if (!operation.settings) return;
            
            const state = this.getOperationState(operation.id);
            
            const opSettings = operation.settings || {};
            const defaults = this.getDefaults(operation.type);

            // Iterate over ALL definitions, not just operation.settings
            for (const [name, def] of Object.entries(this.parameterDefinitions)) {
                if (!def.stage) continue; // Not a parameter with a stage

                // Find the value: 1. op.settings, 2. op.settings.tool, 3. definition.default, 4. config default
                let value;

                // 1. Check for flat param in opSettings
                if (opSettings[name] !== undefined) {
                    value = opSettings[name];
                }
                
                // 2. Handle nested tool object from old settings format
                if (name === 'tool' && opSettings.tool?.id) {
                    value = opSettings.tool.id;
                } else if (name === 'toolDiameter' && opSettings.tool?.diameter) {
                    value = opSettings.tool.diameter;
                }

                // 3. Check definition default
                if (value === undefined) {
                    value = def.default;
                }
                
                // 4. Check config default
                if (value === undefined) {
                    value = defaults[name];
                }
                
                // If a value was found, set it in the manager's state
                if (value !== undefined) {
                    if (!state[def.stage]) state[def.stage] = {};
                    state[def.stage][name] = value;
                }
            }
            
            // Clear dirty flag after loading
            this.dirtyFlags.delete(operation.id);
        }
        
        // Check if operation has unsaved changes
        hasUnsavedChanges(operationId) {
            return this.dirtyFlags.has(operationId);
        }
        
        // Get parameters filtered by stage and operation type
        getStageParameters(stage, operationType) {
            const params = [];
            
            for (const [name, def] of Object.entries(this.parameterDefinitions)) {
                // Check stage match
                if (def.stage !== stage) continue;
                
                // Check operation type if specified
                if (def.operationType && def.operationType !== operationType) continue;
                
                params.push({ name, ...def });
            }
            
            return params;
        }
        
        // Validate all parameters for an operation
        validateOperation(operationId) {
            const params = this.getAllParameters(operationId);
            const errors = [];
            
            for (const [name, value] of Object.entries(params)) {
                if (this.validators[name] && !this.validators[name](value)) {
                    errors.push({
                        parameter: name,
                        value: value,
                        message: `Invalid value for ${name}`
                    });
                }
            }
            
            return {
                valid: errors.length === 0,
                errors
            };
        }
        
        // Get default values for operation type
        getDefaults(operationType) {
            const opConfig = config.operations?.[operationType];
            if (!opConfig) return {};

            const enableMultiDepth = (operationType === 'drill' || operationType === 'cutout');
            
            return {
                passes: opConfig.defaultSettings?.passes || 1,
                stepOver: opConfig.defaultSettings?.stepOver || 50,
                cutDepth: opConfig.cutting?.cutDepth || -0.05,
                depthPerPass: opConfig.cutting?.passDepth || 0.05,
                multiDepth: enableMultiDepth,
                feedRate: opConfig.cutting?.cutFeed || 150,
                plungeRate: opConfig.cutting?.plungeFeed || 50,
                spindleSpeed: opConfig.cutting?.spindleSpeed || 12000,
                direction: opConfig.defaultSettings?.direction || 'climb',
                entryType: opConfig.defaultSettings?.entryType || 'plunge',
                travelZ: config.machine?.heights?.travelZ || 2.0,
                safeZ: config.machine?.heights?.safeZ || 5.0,
                postProcessor: config.gcode?.postProcessor || 'grbl',
                workOffset: 'G54'
            };
        }
        
        // Change notification
        addChangeListener(callback) {
            this.changeListeners.add(callback);
        }
        
        removeChangeListener(callback) {
            this.changeListeners.delete(callback);
        }
        
        notifyChange(operationId, stage, name, value) {
            for (const listener of this.changeListeners) {
                listener({ operationId, stage, name, value });
            }
        }
        
        // Export state for saving
        exportState() {
            const state = {};
            for (const [opId, opState] of this.operationStates) {
                state[opId] = JSON.parse(JSON.stringify(opState));
            }
            return state;
        }
        
        // Import saved state
        importState(state) {
            this.operationStates.clear();
            this.dirtyFlags.clear();
            
            for (const [opId, opState] of Object.entries(state)) {
                this.operationStates.set(opId, opState);
            }
        }
        
        // Clear state for an operation
        clearOperation(operationId) {
            this.operationStates.delete(operationId);
            this.dirtyFlags.delete(operationId);
        }
    }
    
    window.ParameterManager = ParameterManager;
    
})();