/*!
 * @file        ui/ui-parameter-manager.js
 * @description Parameter input management and validation
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

    const C = window.PCBCAMConfig.constants;
    const D = window.PCBCAMConfig.defaults;
    const validationRules = C.ui.validation;
    const paramOptions = C.ui.parameterOptions;

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

                // ═══════════════════════════════════════
                // CNC PIPELINE PARAMETERS
                // ═══════════════════════════════════════

                // Geometry
                tool: {
                    type: 'select',
                    label: 'Tool',
                    stage: 'geometry',
                    category: 'tool',
                    operationTypes: ['isolation', 'clearing', 'cutout', 'drill']
                },
                toolDiameter: {
                    type: 'number',
                    label: 'Tool Diameter',
                    unit: 'mm',
                    ...validationRules.toolDiameter,
                    stage: 'geometry',
                    category: 'tool',
                    operationTypes: ['isolation', 'clearing', 'cutout', 'drill']
                },
                passes: {
                    type: 'number',
                    label: 'Number of Passes',
                    ...validationRules.passes,
                    stage: 'geometry',
                    category: 'offset',
                    operationTypes: 'isolation'
                },
                stepOver: {
                    type: 'number',
                    label: 'Step Over',
                    unit: '%',
                    ...validationRules.stepOver,
                    stage: 'geometry',
                    category: 'offset',
                    operationTypes: ['isolation', 'clearing']
                },
                combineOffsets: {
                    type: 'checkbox',
                    label: 'Combine Passes',
                    default: true,
                    stage: 'geometry',
                    category: 'offset',
                    operationTypes: 'isolation'
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

                // Strategy
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
                entryType: {
                    type: 'select',
                    label: 'Entry Type',
                    options: paramOptions.entryType,
                    stage: 'strategy',
                    category: 'strategy'
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
                cannedCycle: {
                    type: 'select',
                    label: 'Canned Cycle',
                    options: paramOptions.cannedCycle,
                    stage: 'strategy',
                    category: 'drill',
                    operationType: 'drill',
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
                    stage: 'strategy',
                    category: 'cutout',
                    operationType: 'cutout'
                },  

                // Machine
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
                },
                spindleDwell: {
                    type: 'number',
                    label: 'Dwell',
                    unit: 's',
                    step: 0.5,
                    default: 1,
                    ...validationRules.spindleDwell,
                    stage: 'machine',
                    category: 'feeds'
                },

                // ═══════════════════════════════════════
                // LASER PIPELINE PARAMETERS
                // ═══════════════════════════════════════

                // Laser Geometry Stage — Tool
                laserSpotSize: {
                    type: 'number',
                    label: 'Laser Spot Size',
                    unit: 'mm',
                    step: 0.01,
                    min: 0.01,
                    max: 1.0,
                    default: 0.05,
                    stage: 'geometry',
                    category: 'laser_tool',
                    pipelineType: 'laser',
                    readOnly: true
                },

                // Laser Geometry Stage — Isolation
                laserIsolationWidth: {
                    type: 'number',
                    label: 'Isolation Width',
                    unit: 'mm',
                    step: 0.01,
                    min: 0.01,
                    max: 5.0,
                    default: 0.3,
                    stage: 'geometry',
                    category: 'laser_geometry',
                    pipelineType: 'laser',
                    operationType: 'isolation'
                },

                // Laser Geometry Stage — Clearing Padding
                // NOTE: Dormant — reserved for future "fill-to-cutout" board-fill feature.
                // Currently hidden from all operation types.
                laserClearingPadding: {
                    type: 'number',
                    label: 'Clearing Padding',
                    unit: 'mm',
                    step: 0.1,
                    min: 0,
                    max: 10.0,
                    default: 1.0,
                    stage: 'geometry',
                    category: 'laser_geometry',
                    pipelineType: 'laser',
                    operationType: '_board_fill'
                },

                // Laser Geometry Stage — Step Over (all non-cutout ops)
                laserStepOver: {
                    type: 'number',
                    label: 'Step Over',
                    unit: '%',
                    step: 5,
                    min: 10,
                    max: 95,
                    default: 50,
                    stage: 'geometry',
                    category: 'laser_strategy',
                    pipelineType: 'laser',
                    operationTypes: ['isolation', 'clearing'],
                    conditional: 'laserClearStrategy:offset,hatch'
                },

                // Laser Geometry Stage — Clearing Strategy
                laserClearStrategy: {
                    type: 'select',
                    label: 'Clearing Strategy',
                    options: [
                        { value: 'offset', label: 'Offset Paths — Concentric, streak-proof' },
                        { value: 'filled', label: 'Filled Polygon — Laser software controls fill' },
                        { value: 'hatch', label: 'Hatch Fill — Directional line coverage' }
                    ],
                    default: 'offset',
                    stage: 'geometry',
                    category: 'laser_strategy',
                    pipelineType: 'laser',
                    operationTypes: ['isolation', 'clearing']
                },

                // Laser Geometry Stage — Hatch Passes (number of angular passes)
                laserHatchPasses: {
                    type: 'number',
                    label: 'Hatch Passes',
                    step: 1,
                    min: 1,
                    max: 8,
                    default: 2,
                    stage: 'geometry',
                    category: 'laser_strategy',
                    pipelineType: 'laser',
                    operationTypes: ['isolation', 'clearing'],
                    conditional: 'laserClearStrategy:hatch'
                },

                // Laser Geometry Stage — Hatch Angle
                laserHatchAngle: {
                    type: 'number',
                    label: 'Hatch Base Angle',
                    unit: '°',
                    step: 5,
                    min: 0,
                    max: 180,
                    default: 45,
                    stage: 'geometry',
                    category: 'laser_strategy',
                    pipelineType: 'laser',
                    operationTypes: ['isolation', 'clearing'],
                    conditional: 'laserClearStrategy:hatch'
                },

                // Laser Geometry Stage — Cutout
                laserCutSide: {
                    type: 'select',
                    label: 'Cut Side',
                    options: null, // Populated from C.ui.parameterOptions.laserCutSide
                    default: 'outside',
                    stage: 'geometry',
                    category: 'laser_cutout',
                    pipelineType: 'laser',
                    operationTypes: ['cutout', 'drill']
                },

                // ═══════════════════════════════════════
                // STENCIL PIPELINE PARAMETERS
                // ═══════════════════════════════════════

                stencilOffset: {
                    type: 'number',
                    label: 'Aperture Offset',
                    unit: 'mm',
                    step: 0.01,
                    min: -1.0,
                    max: 1.0,
                    default: -0.05,
                    stage: 'geometry',
                    category: 'stencil',
                    operationType: 'stencil'
                },
                stencilIgnoreRegions: {
                    type: 'checkbox',
                    label: 'Ignore Solid Regions (Pads Only)',
                    default: true,
                    stage: 'geometry',
                    category: 'stencil',
                    operationType: 'stencil'
                },
                stencilExcludeDrillPads: {
                    type: 'checkbox',
                    label: 'Exclude Pads Over Drill Holes',
                    default: true,
                    stage: 'geometry',
                    category: 'stencil',
                    operationType: 'stencil'
                },
                stencilAddRegHoles: {
                    type: 'checkbox',
                    label: 'Add Registration Holes',
                    default: false,
                    stage: 'geometry',
                    category: 'stencil',
                    operationType: 'stencil'
                },
                stencilRegDiameter: {
                    type: 'number',
                    label: 'Registration Hole Diameter',
                    unit: 'mm',
                    step: 0.1,
                    min: 0.5,
                    max: 10.0,
                    default: 3.0,
                    stage: 'geometry',
                    category: 'stencil',
                    operationType: 'stencil',
                    conditional: 'stencilAddRegHoles'
                },
                stencilRegMargin: {
                    type: 'number',
                    label: 'Registration Hole Margin',
                    unit: 'mm',
                    step: 0.5,
                    min: 1.0,
                    max: 25.0,
                    default: 5.0,
                    stage: 'geometry',
                    category: 'stencil',
                    operationType: 'stencil',
                    conditional: 'stencilAddRegHoles'
                }
            };
        }

        initializeValidators() {
            // Dynamically build validator based on the definitions, which are based on the config.
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
                // REVIEW - Are they needed?
            }
            return validators;
        }

        /**
         * Updates validator constraints based on the active machine profile.
         * Called when the user changes the Roland machine model or switches post-processor.
         */
        updateMachineConstraints(machineProfile, postProcessor) {
            if (!machineProfile) return;

            const isRoland = postProcessor === 'roland';

            // Update spindle speed constraints from profile
            if (machineProfile.spindleRange) {
                const def = this.parameterDefinitions.spindleSpeed;
                def.min = machineProfile.spindleRange.min;
                def.max = machineProfile.spindleRange.max;

                // Regenerate validator
                this.validators.spindleSpeed = (val) => {
                    const num = parseFloat(val);
                    if (isNaN(num)) return { success: false, error: `${def.label} must be a number` };
                    if (num < def.min) return { success: false, error: `${def.label} must be at least ${def.min}`, correctedValue: def.min };
                    if (num > def.max) return { success: false, error: `${def.label} must be no more than ${def.max}`, correctedValue: def.max };
                    return { success: true, value: num };
                };
            } else if (isRoland && !machineProfile.supportsRC) {
                // Fixed or manual spindle - accept any value but it won't be emitted
                // REVIEW - Is this supposed to be doing something? Why is it empty?
            }

            // Update feed rate constraints from profile max speeds
            if (isRoland && machineProfile.maxFeedXY) {
                const maxMmMin = machineProfile.maxFeedXY * 60;

                const feedDef = this.parameterDefinitions.feedRate;
                feedDef.max = maxMmMin;
                this.validators.feedRate = (val) => {
                    const num = parseFloat(val);
                    if (isNaN(num)) return { success: false, error: `${feedDef.label} must be a number` };
                    if (num < feedDef.min) return { success: false, error: `${feedDef.label} must be at least ${feedDef.min}`, correctedValue: feedDef.min };
                    if (num > feedDef.max) return { success: false, error: `${feedDef.label} must be no more than ${feedDef.max}`, correctedValue: feedDef.max };
                    return { success: true, value: num };
                };

                const plungeDef = this.parameterDefinitions.plungeRate;
                const maxPlungeMmMin = (machineProfile.maxFeedZ || machineProfile.maxFeedXY) * 60;
                plungeDef.max = maxPlungeMmMin;
                this.validators.plungeRate = (val) => {
                    const num = parseFloat(val);
                    if (isNaN(num)) return { success: false, error: `${plungeDef.label} must be a number` };
                    if (num < plungeDef.min) return { success: false, error: `${plungeDef.label} must be at least ${plungeDef.min}`, correctedValue: plungeDef.min };
                    if (num > plungeDef.max) return { success: false, error: `${plungeDef.label} must be no more than ${plungeDef.max}`, correctedValue: plungeDef.max };
                    return { success: true, value: num };
                };
            } else if (!isRoland) {
                // Switching away from Roland — restore default validation limits
                this._restoreDefaultValidators(['feedRate', 'plungeRate', 'spindleSpeed']);
            }

            // Re-validate all currently loaded operations against new constraints
            for (const [opId, state] of this.operationStates) {
                for (const [stage, params] of Object.entries(state)) {
                    for (const [name, value] of Object.entries(params)) {
                        if (this.validators[name]) {
                            const result = this.validators[name](value);
                            if (result.correctedValue !== undefined) {
                                state[stage][name] = result.correctedValue;
                                this.markDirty(opId, stage);
                            }
                        }
                    }
                }
            }

            this.debug(`Machine constraints updated for ${machineProfile.label || 'unknown'}`);
        }

        // Restores validators to their original config-based limits.
        _restoreDefaultValidators(paramNames) {
            for (const name of paramNames) {
                const def = this.parameterDefinitions[name];
                if (!def || def.type !== 'number') continue;

                // Restore min/max from original config spread
                if (validationRules[name]) {
                    if (validationRules[name].min !== undefined) def.min = validationRules[name].min;
                    if (validationRules[name].max !== undefined) def.max = validationRules[name].max;
                }

                // Regenerate validator from restored definition
                this.validators[name] = (val) => {
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

            // Check if validator exists
            if (this.validators[name]) {
                const result = this.validators[name](value);

                if (!result.success) {
                    this.debug(`Invalid value for ${name}: ${value}. ${result.error}`);
                    // If validation failed but provided a corrected value (clamping), set that corrected value.
                    if (result.correctedValue !== undefined) {
                        state[stage][name] = result.correctedValue;
                        this.markDirty(operationId, stage);
                        this.notifyChange(operationId, stage, name, result.correctedValue);
                        // Return the error and the value it was changed to
                        return { success: false, error: result.error, correctedValue: result.correctedValue };
                    }
                    // If no corrected value, return the failure
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
         */
        loadFromOperation(operation) {
            if (!operation) return;

            // Get the settings from the operation.
            const opSettings = operation.settings || {};

            // Get the operation-specific config defaults (e.g., passes for "isolation")
            const defaults = this.getDefaults(operation.type);

            // Get (or create) the manager's internal state record for this op
            const state = this.getOperationState(operation.id);

            // Iterate over ALL parameter definitions, not just opSettings
            for (const [name, def] of Object.entries(this.parameterDefinitions)) {
                if (!def.stage) continue; // Skip non-parameter definitions

                let value;

                // Ignore parameters that don't belong to this operation type
                if (def.operationType && def.operationType !== operation.type) continue;
                if (def.operationTypes && !def.operationTypes.includes(operation.type)) continue;

                // Check for a value in the manager's current "live" state first.
                // Preserve unsaved changes if switching tabs and coming back.
                value = state[def.stage][name];

                // If not in live state, check the operation's saved settings.
                // This is the "load" step. ONLY check for the flat property.
                if (value === undefined) {
                    value = opSettings[name];
                }

                // If not in saved settings, check the config defaults for this OpType.
                if (value === undefined) {
                    value = defaults[name];
                }

                // If still not found, check the parameter's hardcoded default.
                if (value === undefined) {
                    value = def.default;
                }

                // If a value was found (from any source), set it in the manager.
                // This validates/clamps the value on load.
                if (value !== undefined) {
                    // Use setParameter to ensure the loaded value is valid
                    // Note: Uses the internal state-setting method to avoid marking the operation as "dirty" just from loading it.
                    const result = this.validators[name] 
                        ? this.validators[name](value) 
                        : { success: true, value: value };

                    const finalValue = result.correctedValue !== undefined ? result.correctedValue : result.value;

                    if (!state[def.stage]) state[def.stage] = {};
                    state[def.stage][name] = finalValue;
                }
            }

            // Sync laser spot size from machine settings
            const controller = window.pcbcam;
            if (controller?.isLaserPipeline?.()) {
                const machineSpotSize = controller.core?.settings?.laser?.spotSize;
                if (machineSpotSize !== undefined && state.geometry) {
                    state.geometry.laserSpotSize = machineSpotSize;
                }
            }

            // Clear dirty flag after a fresh load
            this.dirtyFlags.delete(operation.id);
        }

        // Check if operation has unsaved changes
        hasUnsavedChanges(operationId) {
            return this.dirtyFlags.has(operationId);
        }

        // Get parameters filtered by stage, operation type, and pipeline.
        getStageParameters(stage, operationType, pipelineType) {
            const params = [];
            const isLaser = pipelineType === 'laser' || pipelineType === 'hybrid';

            const exportFormat = window.pcbcam.core.settings.laser.exportFormat;

            for (const [name, def] of Object.entries(this.parameterDefinitions)) {
                // Stage matching: 'export_summary' has no parameters — it's a display-only stage
                if (stage === 'export_summary') continue;
                if (def.stage !== stage) continue;

                // Single operationType filter
                if (def.operationType && def.operationType !== operationType) continue;

                // Array operationTypes filter (must be one of listed types)
                if (def.operationTypes && !def.operationTypes.includes(operationType)) continue;

                // Pipeline filtering: laser params only in laser mode, CNC params only in CNC mode.
                // Stencil params have no pipelineType and operationType === 'stencil', so they pass through regardless of pipeline.
                const isStencilParam = def.operationType === 'stencil';
                if (!isStencilParam) {
                    if (def.pipelineType === 'laser' && !isLaser) continue;
                    if (!def.pipelineType && isLaser) continue;
                }

                // Hide clearing-related params if exporting to PNG
                if (isLaser && exportFormat === 'png') {
                    if (name === 'laserClearStrategy' || name === 'laserStepOver' || name === 'laserHatchAngle') {
                        continue; 
                    }
                }

                // Resolve dynamic options from config
                const resolved = { name, ...def };
                if (resolved.options === null) {
                    const configOptions = C.ui.parameterOptions?.[name];
                    if (configOptions) {
                        resolved.options = configOptions;
                    }
                }

                params.push(resolved);
            }

            return params;
        }

        /**
         * Returns the valid stages for a given pipeline type.
         */
        getStagesForPipeline(pipelineType, operationType) {
            if (pipelineType === 'laser' || operationType === 'stencil') {
                return ['geometry', 'export_summary'];
            }
            // CNC and hybrid use the standard three stages
            return ['geometry', 'strategy', 'machine'];
        }

        /**
         * Returns the next stage in the pipeline after the given one.
         * Returns null if the current stage is the last one.
         */
        getNextStage(currentStage, pipelineType, operationType) {
            const stages = this.getStagesForPipeline(pipelineType, operationType);
            const idx = stages.indexOf(currentStage);
            if (idx === -1 || idx >= stages.length - 1) return null;
            return stages[idx + 1];
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
            const opConfig = D.operations?.[operationType] || {};
            const cuttingConfig = opConfig.cutting || {};
            const settingsConfig = opConfig.defaultSettings || {};
            const defaultToolId = opConfig.defaultTool;

            let toolDiameter;
            if (defaultToolId && window.pcbcam?.ui?.toolLibrary) {
                const libraryDiameter = window.pcbcam.ui.toolLibrary.getToolDiameter(defaultToolId);
                if (libraryDiameter !== null && libraryDiameter !== undefined) {
                    toolDiameter = libraryDiameter;
                }
            }

            // Flatten the config objects directly without shadow fallbacks
            const defaults = {
                tool: defaultToolId,
                toolDiameter: toolDiameter,
                ...cuttingConfig,
                ...settingsConfig
            };

            // Handle specific pipeline injections (Laser/Stencil)
            const controller = window.pcbcam;
            if (controller?.isLaserPipeline?.()) {
                const laserMachine = controller.core?.settings?.laser || {};
                const opLaserDefaults = D.laser.operations?.[operationType];

                defaults.laserSpotSize = laserMachine.spotSize;
                defaults.laserExportFormat = laserMachine.exportFormat;
                defaults.laserExportDPI = laserMachine.exportDPI;
                
                // Spread operation-specific laser overrides directly
                Object.assign(defaults, opLaserDefaults);
            }

            if (operationType === 'stencil') {
                const stencilSettings = D.operations.stencil.defaultSettings || {};
                Object.assign(defaults, stencilSettings);
            }

            return defaults;
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
            if (D.debug.enabled) {
                if (data !== null) {
                    console.log(`[ParameterManager] ${message}`, data);
                } else {
                    console.log(`[ParameterManager] ${message}`);
                }
            }
        }
    }

    window.ParameterManager = ParameterManager;
})();