// ui/ui-parameter-manager.js
// Central parameter validation, defaults, and i18n strings

(function() {
    'use strict';
    
    const config = window.PCBCAMConfig || {};
    
    class ParameterManager {
        constructor() {
            this.strings = null;
            this.validators = this.initializeValidators();
            this.parameterGroups = this.initializeGroups();
            this.loadStrings();
        }
        
        async loadStrings() {
            try {
                const response = await fetch('strings.json');
                this.strings = await response.json();
            } catch (error) {
                console.warn('Failed to load strings.json, using defaults');
                this.strings = { strings: {} };
            }
        }
        
        getString(key, replacements = {}) {
            const keys = key.split('.');
            let value = this.strings?.strings;
            
            for (const k of keys) {
                value = value?.[k];
                if (!value) return key; // Fallback to key if not found
            }
            
            // Replace placeholders like {count}, {passes}, etc.
            if (typeof value === 'string') {
                Object.entries(replacements).forEach(([placeholder, replacement]) => {
                    value = value.replace(`{${placeholder}}`, replacement);
                });
            }
            
            return value || key;
        }
        
        initializeValidators() {
            return {
                toolDiameter: (val) => val >= 0.01 && val <= 10,
                passes: (val) => Number.isInteger(val) && val >= 1 && val <= 10,
                stepOver: (val) => val >= 10 && val <= 100,
                cutDepth: (val) => val >= -10 && val <= 0,
                travelZ: (val) => val >= 0 && val <= 50,
                safeZ: (val) => val >= 0 && val <= 50,
                depthPerPass: (val) => val > 0 && val <= 1,
                feedRate: (val) => val >= 1 && val <= 5000,
                plungeRate: (val) => val >= 1 && val <= 1000,
                spindleSpeed: (val) => val >= 100 && val <= 30000,
                peckDepth: (val) => val > 0 && val <= 5,
                dwellTime: (val) => val >= 0 && val <= 10,
                retractHeight: (val) => val >= 0 && val <= 10,
                leadIn: (val) => val >= 0 && val <= 5,
                leadOut: (val) => val >= 0 && val <= 5,
                rotationAngle: (val) => val >= -360 && val <= 360
            };
        }
        
        initializeGroups() {
            return {
                geometryGeneration: [
                    'tool', 'toolDiameter', 'passes', 'stepOver', 'combineOffsets'
                ],
                toolpathPlanning: [
                    'cutDepth', 'travelZ', 'safeZ', 'multiDepth', 'depthPerPass'
                ],
                cuttingParameters: [
                    'feedRate', 'plungeRate', 'spindleSpeed'
                ],
                strategy: [
                    'direction', 'entryType', 'leadIn', 'leadOut'
                ],
                drilling: [
                    'cannedCycle', 'peckDepth', 'dwellTime', 'retractHeight', 'drillingOrder'
                ],
                machineConfiguration: [
                    'postProcessor', 'workOffset', 'spindleSpeed'
                ]
            };
        }
        
        validateParameter(name, value) {
            const validator = this.validators[name];
            if (!validator) return { valid: true };
            
            const valid = validator(value);
            return {
                valid,
                message: valid ? null : this.getString(`validation.range`)
            };
        }
        
        getParameterDefaults(operationType) {
            const opConfig = config.operations?.[operationType];
            if (!opConfig) return {};
            
            return {
                passes: opConfig.defaultSettings?.passes || 1,
                stepOver: opConfig.defaultSettings?.stepOver || 50,
                cutDepth: opConfig.cutting?.cutDepth || -0.05,
                feedRate: opConfig.cutting?.cutFeed || 150,
                plungeRate: opConfig.cutting?.plungeFeed || 50,
                spindleSpeed: opConfig.cutting?.spindleSpeed || 12000,
                direction: opConfig.defaultSettings?.direction || 'climb',
                entryType: opConfig.defaultSettings?.entryType || 'plunge'
            };
        }
        
        getParameterTooltip(name) {
            const text = this.getString(`tooltips.${name}`);
            const example = this.getString(`examples.${name}`);
            
            if (text === `tooltips.${name}`) {
                return null; // No tooltip defined
            }
            
            return {
                text,
                example: example !== `examples.${name}` ? example : null
            };
        }
        
        getParameterLabel(name) {
            return this.getString(`parameters.${name}`);
        }
        
        getParameterUnit(name) {
            const units = {
                toolDiameter: 'mm',
                cutDepth: 'mm',
                travelZ: 'mm',
                safeZ: 'mm',
                depthPerPass: 'mm',
                feedRate: 'mmPerMin',
                plungeRate: 'mmPerMin',
                spindleSpeed: 'rpm',
                stepOver: 'percent',
                peckDepth: 'mm',
                dwellTime: 'seconds',
                retractHeight: 'mm',
                leadIn: 'mm',
                leadOut: 'mm',
                rotationAngle: 'degrees'
            };
            
            const unit = units[name];
            return unit ? this.getString(`units.${unit}`) : '';
        }
        
        // Get parameters visible for specific geometry stage
        getVisibleParameters(geometryStage, operationType) {
            const stages = {
                source: ['geometryGeneration', 'strategy'],
                offset: ['toolpathPlanning', 'cuttingParameters', 'strategy'],
                preview: ['machineConfiguration']
            };
            
            let groups = stages[geometryStage] || [];
            
            // Add drilling-specific parameters
            if (operationType === 'drill' && geometryStage === 'source') {
                groups.push('drilling');
            }
            
            return groups.flatMap(group => this.parameterGroups[group] || []);
        }
        
        // Validate all parameters for a stage
        validateStage(parameters, stage) {
            const errors = [];
            
            Object.entries(parameters).forEach(([name, value]) => {
                const result = this.validateParameter(name, value);
                if (!result.valid) {
                    errors.push({
                        parameter: name,
                        message: result.message
                    });
                }
            });
            
            return {
                valid: errors.length === 0,
                errors
            };
        }
    }
    
    // Export
    window.ParameterManager = ParameterManager;
    
})();