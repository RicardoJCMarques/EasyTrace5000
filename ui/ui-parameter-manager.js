/**
 * @file        ui/ui-parameter-manager.js
 * @description Parameter input management and validation
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
    const validationRules = config.ui.validation || {};
    const paramOptions = config.ui.parameterOptions || {};
    
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
            
            this.validators = this.initializeValidators();
            
            // Change listeners
            this.changeListeners = new Set();
        }
        
        initializeDefinitions() {
            return {
                // STAGE 1: GEOMETRY
                tool: {
                    type: 'select',
                    label: 'Tool',
                    stage: 'geometry',
                    category: 'tool'
                },
                toolDiameter: {
                    type: 'number',
                    label: 'Tool Diameter',
                    unit: 'mm',
                    ...validationRules.toolDiameter,
                    stage: 'geometry',
                    category: 'tool'
                },
                passes: {
                    type: 'number',
                    label: 'Number of Passes',
                    ...validationRules.passes,
                    stage: 'geometry',
                    category: 'offset'
                },
                stepOver: {
                    type: 'number',
                    label: 'Step Over',
                    unit: '%',
                    ...validationRules.stepOver,
                    stage: 'geometry',
                    category: 'offset'
                },
                combineOffsets: {
                    type: 'checkbox',
                    label: 'Combine Passes',
                    default: true,
                    stage: 'geometry',
                    category: 'offset'
                },
                millHoles: {
                    type: 'checkbox',
                    label: 'Mill Holes',
                    default: true,
                    stage: 'geometry',
                    category: 'drill',
                    operationType: 'drill'
                },
                cutSide: {
                    type: 'select',
                    label: 'Cut Side',
                    options: paramOptions.cutSide,
                    default: 'outside',
                    stage: 'geometry',
                    category: 'cutout',
                    operationType: 'cutout'
                },

                // STAGE 2: STRATEGY
                cutDepth: {
                    type: 'number',
                    label: 'Cut Depth',
                    unit: 'mm',
                    ...validationRules.cutDepth,
                    stage: 'strategy',
                    category: 'depth'
                },
                depthPerPass: {
                    type: 'number',
                    label: 'Depth per Pass',
                    unit: 'mm',
                    ...validationRules.depthPerPass,
                    stage: 'strategy',
                    category: 'depth',
                    conditional: 'multiDepth'
                },
                multiDepth: {
                    type: 'checkbox',
                    label: 'Multi-depth Cutting',
                    default: true,
                    stage: 'strategy',
                    category: 'depth'
                },
                direction: {
                    type: 'select',
                    label: 'Cut Direction',
                    options: paramOptions.direction,
                    stage: 'strategy',
                    category: 'strategy'
                },
                entryType: {
                    type: 'select',
                    label: 'Entry Type',
                    options: paramOptions.entryType,
                    stage: 'strategy',
                    category: 'strategy'
                },
                cannedCycle: {
                    type: 'select',
                    label: 'Canned Cycle',
                    options: paramOptions.cannedCycle,
                    stage: 'strategy',
                    category: 'drill',
                    operationType: 'drill',
                    conditional: '!millHoles'
                },
                peckDepth: {
                    type: 'number',
                    label: 'Peck Depth',
                    unit: 'mm',
                    ...validationRules.peckDepth,
                    stage: 'strategy',
                    category: 'drill',
                    operationType: 'drill'
                },
                dwellTime: {
                    type: 'number',
                    label: 'Dwell Time',
                    unit: 's',
                    ...validationRules.dwellTime,
                    stage: 'strategy',
                    category: 'drill',
                    operationType: 'drill'
                },
                retractHeight: {
                    type: 'number',
                    label: 'Retract Height',
                    unit: 'mm',
                    ...validationRules.retractHeight,
                    stage: 'strategy',
                    category: 'drill',
                    operationType: 'drill'
                },
                tabs: {
                    type: 'number',
                    label: 'Number of Tabs',
                    ...validationRules.tabs,
                    stage: 'strategy',
                    category: 'cutout',
                    operationType: 'cutout'
                },
                tabWidth: {
                    type: 'number',
                    label: 'Tab Width',
                    unit: 'mm',
                    ...validationRules.tabWidth,
                    stage: 'strategy',
                    category: 'cutout',
                    operationType: 'cutout'
                },
                tabHeight: {
                    type: 'number',
                    label: 'Tab Height',
                    unit: 'mm',
                    ...validationRules.tabHeight,
                    stage: 'strategy', // 
                    category: 'cutout',
                    operationType: 'cutout'
                },  

                // STAGE 3: MACHINE
                feedRate: {
                    type: 'number',
                    label: 'Feed Rate',
                    unit: 'mm/min',
                    ...validationRules.feedRate,
                    stage: 'machine',
                    category: 'feeds'
                },
                plungeRate: {
                    type: 'number',
                    label: 'Plunge Rate',
                    unit: 'mm/min',
                    ...validationRules.plungeRate,
                    stage: 'machine',
                    category: 'feeds'
                },
                spindleSpeed: {
                    type: 'number',
                    label: 'Spindle Speed',
                    unit: 'RPM',
                    ...validationRules.spindleSpeed,
                    stage: 'machine',
                    category: 'feeds'
                }
            };
        }

        initializeValidators() {
            // Dynamically build validator based on the definitions, which are based on the config.
            // This is the SINGLE source of truth for validation logic.
            const validators = {};
            for (const [name, def] of Object.entries(this.parameterDefinitions)) {
                if (def.type === 'number') {
                    // Create a validation function for this number
                    validators[name] = (val) => {
                        const num = parseFloat(val);
                        if (isNaN(num)) return { success: false, error: `${def.label} must be a number` };
                        
                        if (def.min !== undefined && num < def.min) {
                            return { success: false, error: `${def.label} must be at least ${def.min}`, correctedValue: def.min };
                        }
                        if (def.max !== undefined && num > def.max) {
                            return { success: false, error: `${def.label} must be no more than ${def.max}`, correctedValue: def.max };
                        }
                        return { success: true, value: num };
                    };
                }
                // Add more validators for 'select', 'checkbox' etc. if needed
            }
            return validators;
        }
        
        // Get or create state for an operation
        getOperationState(operationId) {
            if (!this.operationStates.has(operationId)) {
                this.operationStates.set(operationId, {
                    geometry: {},
                    strategy: {},
                    machine: {}
                });
            }
            return this.operationStates.get(operationId);
        }
        
        // Get parameters for current context
        getParameters(operationId, stage) {
            const state = this.getOperationState(operationId);
            return state[stage] || {};
        }
        
        setParameter(operationId, stage, name, value) {
            const state = this.getOperationState(operationId);
            if (!state[stage]) state[stage] = {};
            
            // Validate if validator exists
            if (this.validators[name]) {
                const result = this.validators[name](value);

                if (!result.success) {
                    this.debug(`Invalid value for ${name}: ${value}. ${result.error}`);
                    // If validation failed but provided a corrected value (clamping), we'll set that corrected value.
                    if (result.correctedValue !== undefined) {
                        state[stage][name] = result.correctedValue;
                        this.markDirty(operationId, stage);
                        this.notifyChange(operationId, stage, name, result.correctedValue);
                        // Return the error AND the value it was changed to
                        return { success: false, error: result.error, correctedValue: result.correctedValue };
                    }
                    // If no corrected value, just return the failure
                    return { success: false, error: result.error, correctedValue: state[stage][name] }; // Return old value
                }
                
                // Validation succeeded, update the value
                value = result.value;
            }
            
            // Non-validated type (e.g., checkbox, select) or valid number
            state[stage][name] = value;
            this.markDirty(operationId, stage);
            this.notifyChange(operationId, stage, name, value);
            
            return { success: true, value: value };
        }
        
        markDirty(operationId, stage) {
            if (!this.dirtyFlags.has(operationId)) {
                this.dirtyFlags.set(operationId, new Set());
            }
            this.dirtyFlags.get(operationId).add(stage);
        }

        // Set multiple parameters (less used by UI, more by loading logic)
        setParameters(operationId, stage, params) {
            const state = this.getOperationState(operationId);
            if (!state[stage]) state[stage] = {};
            
            for (const [name, value] of Object.entries(params)) {
                this.setParameter(operationId, stage, name, value);
            }
        }
        
        // Get all parameters for an operation (merged across stages)
        getAllParameters(operationId) {
            const state = this.getOperationState(operationId);
            return {
                ...state.geometry,
                ...state.strategy,
                ...state.machine
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
            
            this.debug(`Committed ${Object.keys(params).length} parameters to operation ${operation.id}`);
        }
        
        /**
         * Loads parameters from an operation's settings into the manager's state.
         * This function now acts as the bridge from the persistent (but "dumb")
         * operation.settings object into the manager's "live" state.
         */
        loadFromOperation(operation) {
            if (!operation) return;

            // Get the settings from the operation. This is the *only* place we should be *reading* from this property.
            const opSettings = operation.settings || {};

            // Get the operation-specific config defaults (e.g., passes for "isolation")
            const defaults = this.getDefaults(operation.type);

            // Get (or create) the manager's internal state record for this op
            const state = this.getOperationState(operation.id);

            // Iterate over ALL parameter definitions, not just opSettings
            for (const [name, def] of Object.entries(this.parameterDefinitions)) {
                if (!def.stage) continue; // Skip non-parameter definitions

                let value;

                // 1. Check for a value in the manager's current "live" state first.
                //    This preserves unsaved changes if we just switch tabs and come back.
                value = state[def.stage][name];

                // 2. If not in live state, check the operation's saved settings.
                //    This is the "load" step. We ONLY check for the flat property.
                if (value === undefined) {
                    value = opSettings[name];
                }
                
                // 3. If not in saved settings, check the config defaults for this OpType.
                if (value === undefined) {
                    value = defaults[name];
                }

                // 4. If still not found, check the parameter's hardcoded default.
                if (value === undefined) {
                    value = def.default;
                }

                // 5. If a value was found (from any source), set it in the manager.
                //    This validates/clamps the value on load.
                if (value !== undefined) {
                    // Use setParameter to ensure the loaded value is valid
                    // Note: We use the internal state-setting method to avoid marking the operation as "dirty" just from loading it.
                    const result = this.validators[name] 
                        ? this.validators[name](value) 
                        : { success: true, value: value };
                    
                    const finalValue = result.correctedValue !== undefined ? result.correctedValue : result.value;
                    
                    if (!state[def.stage]) state[def.stage] = {};
                    state[def.stage][name] = finalValue;
                }
            }
            
            // Clear dirty flag after a fresh load
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
                if (this.validators[name]) {
                    const result = this.validators[name](value);
                    if (!result.success) {
                        errors.push({
                            parameter: name,
                            value: value,
                            message: result.error || `Invalid value for ${name}`
                        });
                    }
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

            // Define opConfig.tool and opConfig.cutting as safe objects
            const toolConfig = opConfig.tool;
            const cuttingConfig = opConfig.cutting;
            const settingsConfig = opConfig.defaultSettings;

            const enableMultiDepth = (operationType === 'drill' || operationType === 'cutout');

            return {
                // Tool/Strategy
                toolDiameter: toolConfig.diameter,
                multiDepth: settingsConfig.multiDepth,
                passes: settingsConfig.passes,
                stepOver: settingsConfig.stepOver,
                direction: settingsConfig.direction,
                entryType: settingsConfig.entryType,

                // Cutting
                cutDepth: cuttingConfig.cutDepth,
                depthPerPass: cuttingConfig.passDepth,
                feedRate: cuttingConfig.cutFeed,
                plungeRate: cuttingConfig.plungeFeed,
                spindleSpeed: cuttingConfig.spindleSpeed,

                // Drill-specific strategy defaults
                cannedCycle: settingsConfig.cannedCycle,
                peckDepth: settingsConfig.peckDepth,
                dwellTime: settingsConfig.dwellTime,
                retractHeight: settingsConfig.retractHeight
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

        debug(message, data = null) {
            if (this.ui && this.ui.debug) {
                this.ui.debug(`[ParameterManager] ${message}`, data);
            }
        }
    }
    
    window.ParameterManager = ParameterManager;
})();