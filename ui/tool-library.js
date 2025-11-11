/**
 * @file        ui/tool-library.js
 * @description Manages tool definitions and tool selection functionality
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
    
    class ToolLibrary {
        constructor() {
            this.tools = [];
            this.toolsById = new Map();
            this.toolsByType = new Map();
            this.toolsByOperation = new Map();
            
            this.isLoaded = false;
            this.loadError = null;
        }
        
        async init() {
            if (this.isLoaded) return true;
            
            try {
                // First try to load from config
                if (config.tools && Array.isArray(config.tools)) {
                    this.loadFromConfig();
                    return true;
                }
                
                // Fallback to loading from external file
                const loaded = await this.loadFromFile('tools.json');
                return loaded;
                
            } catch (error) {
                console.error('[ToolLibrary] Failed to initialize tool library:', error);
                this.loadError = error.message;
                
                // Load minimal defaults as fallback
                this.loadDefaults();
                return false;
            }
        }
        
        loadFromConfig() {
            if (!config.tools || !Array.isArray(config.tools)) {
                throw new Error('No tools found in config');
            }
            
            this.tools = [];
            this.toolsById.clear();
            this.toolsByType.clear();
            this.toolsByOperation.clear();
            
            config.tools.forEach(tool => {
                if (this.validateTool(tool)) {
                    this.addTool(tool);
                } else {
                    console.warn(`[ToolLibrary] Invalid tool skipped: ${tool.id || 'unknown'}`);
                }
            });
            
            this.isLoaded = true;
            
            if (debugConfig.enabled) {
                console.log(`[ToolLibrary] Loaded ${this.tools.length} tools from config`);
                this.logToolStats();
            }
        }
        
        async loadFromFile(url) {
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                const data = await response.json();
                
                if (!data.tools || !Array.isArray(data.tools)) {
                    throw new Error('Invalid tools.json format');
                }
                
                this.tools = [];
                this.toolsById.clear();
                this.toolsByType.clear();
                this.toolsByOperation.clear();
                
                data.tools.forEach(tool => {
                    if (this.validateTool(tool)) {
                        this.addTool(tool);
                    }
                });
                
                this.isLoaded = true;
                
                this.debug(`Loaded ${this.tools.length} tools from ${url}`);
                
                return true;
                
            } catch (error) {
                console.error('[ToolLibrary] Failed to load tools from file:', error);
                this.loadError = error.message;
                return false;
            }
        }
        
        loadDefaults() {
            // Minimal fallback tools
            const defaults = [
                {
                    id: 'default_endmill',
                    name: 'Default End Mill',
                    type: 'end_mill',
                    category: 'standard',
                    geometry: {
                        diameter: 0.2,
                        tipType: 'flat',
                        flutes: 2,
                        cuttingLength: 3,
                        shankDiameter: 3.175,
                        totalLength: 38
                    },
                    cutting: {
                        feedRate: 150,
                        plungeRate: 50,
                        spindleSpeed: 12000,
                        maxDepthPerPass: 0.05,
                        stepOver: 0.5
                    },
                    operations: ['isolation', 'clear', 'cutout'],
                    material: 'carbide'
                },
                {
                    id: 'default_drill',
                    name: 'Default Drill',
                    type: 'drill',
                    category: 'standard',
                    geometry: {
                        diameter: 0.8,
                        pointAngle: 118,
                        fluteLength: 15,
                        shankDiameter: 3.175,
                        totalLength: 38
                    },
                    cutting: {
                        feedRate: 60,
                        plungeRate: 30,
                        spindleSpeed: 10000,
                        peckDepth: 0.8,
                        dwellTime: 0.1
                    },
                    operations: ['drill'],
                    material: 'carbide'
                }
            ];
            
            defaults.forEach(tool => this.addTool(tool));
            
            this.isLoaded = true;
            console.warn('[ToolLibrary] Using default tools due to loading failure');
        }
        
        addTool(tool) {
            this.tools.push(tool);
            this.toolsById.set(tool.id, tool);
            
            // Index by type
            if (!this.toolsByType.has(tool.type)) {
                this.toolsByType.set(tool.type, []);
            }
            this.toolsByType.get(tool.type).push(tool);
            
            // Index by operations
            if (tool.operations && Array.isArray(tool.operations)) {
                tool.operations.forEach(op => {
                    if (!this.toolsByOperation.has(op)) {
                        this.toolsByOperation.set(op, []);
                    }
                    this.toolsByOperation.get(op).push(tool);
                });
            }
        }
        
        validateTool(tool) {
            // Required top-level fields
            const required = ['id', 'name', 'type', 'geometry', 'cutting', 'operations'];
            for (const field of required) {
                if (!tool[field]) {
                    if (debugConfig.enabled) {
                        console.warn(`[ToolLibrary] Tool validation failed: missing '${field}'`, tool);
                    }
                    return false;
                }
            }
            
            // Required geometry fields
            if (!tool.geometry.diameter) {
                if (debugConfig.enabled) {
                    console.warn('[ToolLibrary] Tool validation failed: missing geometry.diameter', tool);
                }
                return false;
            }
            
            // Required cutting parameters
            const cuttingRequired = ['feedRate', 'plungeRate', 'spindleSpeed'];
            for (const field of cuttingRequired) {
                if (tool.cutting[field] === undefined) {
                    if (debugConfig.enabled) {
                        console.warn(`[ToolLibrary] Tool validation failed: missing cutting.${field}`, tool);
                    }
                    return false;
                }
            }
            
            return true;
        }
        
        getTool(id) {
            return this.toolsById.get(id) || null;
        }
        
        getToolsByType(type) {
            return this.toolsByType.get(type) || [];
        }
        
        getToolsForOperation(operationType) {
            return this.toolsByOperation.get(operationType) || [];
        }
        
        getDefaultToolForOperation(operationType) {
            // Try to get default from config
            const opConfig = config.operations?.[operationType];
            if (opConfig?.defaultTool) {
                const tool = this.getTool(opConfig.defaultTool);
                if (tool) return tool;
            }
            
            // Fallback to first compatible tool
            const compatibleTools = this.getToolsForOperation(operationType);
            return compatibleTools[0] || null;
        }
        
        getToolCategories() {
            const categories = new Set();
            this.tools.forEach(tool => {
                if (tool.category) {
                    categories.add(tool.category);
                }
            });
            return Array.from(categories);
        }
        
        getToolsByCategory(category) {
            return this.tools.filter(tool => tool.category === category);
        }
        
        // Calculate offset parameters for a tool
        calculateOffsetParameters(tool, passes = 1, stepOverPercent = 50) {
            if (!tool || !tool.geometry?.diameter) {
                throw new Error('Invalid tool for offset calculation');
            }
            
            const diameter = tool.geometry.diameter;
            const stepOver = stepOverPercent / 100;
            const stepDistance = diameter * (1 - stepOver);
            const offsets = [];
            
            for (let i = 0; i < passes; i++) {
                // Negative for external offset (tool outside geometry)
                // For isolation routing, we want to remove material outside the trace
                offsets.push(-(diameter / 2 + i * stepDistance));
            }
            
            return {
                diameter,
                stepOver,
                stepDistance,
                offsets
            };
        }
        
        // Get cutting parameters for G-code generation
        getCuttingParameters(toolId, material = 'fr4') {
            const tool = this.getTool(toolId);
            if (!tool) return null;
            
            // Base parameters from tool
            const params = {
                feedRate: tool.cutting.feedRate,
                plungeRate: tool.cutting.plungeRate,
                spindleSpeed: tool.cutting.spindleSpeed,
                maxDepthPerPass: tool.cutting.maxDepthPerPass || 0.1
            };
            
            return params;
        }
        
        // Create a tool selection dropdown
        createToolDropdown(operationType, selectedId = null) {
            const select = document.createElement('select');
            select.className = 'tool-select';
            
            const tools = this.getToolsForOperation(operationType);
            
            // Group by category if multiple categories exist
            const categories = new Set();
            tools.forEach(tool => {
                if (tool.category) categories.add(tool.category);
            });
            
            if (categories.size > 1) {
                // Create optgroups
                categories.forEach(category => {
                    const optgroup = document.createElement('optgroup');
                    optgroup.label = category.charAt(0).toUpperCase() + category.slice(1);
                    
                    tools.filter(t => t.category === category).forEach(tool => {
                        const option = this.createToolOption(tool, selectedId);
                        optgroup.appendChild(option);
                    });
                    
                    select.appendChild(optgroup);
                });
            } else {
                // Simple list
                tools.forEach(tool => {
                    const option = this.createToolOption(tool, selectedId);
                    select.appendChild(option);
                });
            }
            
            return select;
        }
        
        createToolOption(tool, selectedId) {
            const option = document.createElement('option');
            option.value = tool.id;
            option.textContent = `${tool.name} (${tool.geometry.diameter}mm)`;
            
            if (tool.id === selectedId) {
                option.selected = true;
            }
            
            // Add data attributes for quick access
            option.dataset.diameter = tool.geometry.diameter;
            option.dataset.type = tool.type;
            
            return option;
        }
        
        // Export tool library for backup/sharing
        exportTools() {
            return {
                version: 1,
                timestamp: new Date().toISOString(),
                tools: this.tools
            };
        }
        
        // Import tools from JSON
        importTools(data) {
            if (!data || !data.tools || !Array.isArray(data.tools)) {
                throw new Error('Invalid tool import data');
            }
            
            const imported = [];
            const failed = [];
            
            data.tools.forEach(tool => {
                if (this.validateTool(tool)) {
                    // Check for duplicate IDs
                    if (!this.toolsById.has(tool.id)) {
                        this.addTool(tool);
                        imported.push(tool.id);
                    } else {
                        failed.push({ id: tool.id, reason: 'Duplicate ID' });
                    }
                } else {
                    failed.push({ id: tool.id || 'unknown', reason: 'Validation failed' });
                }
            });
            
            return {
                imported,
                failed,
                total: data.tools.length
            };
        }
        
        // Debug helpers
        debug(message, data = null) {
            if (this.ui && this.ui.debug) {
                this.ui.debug(`[ToolLibrary] ${message}`, data);
            }
        }

        logToolStats() {
            if (debugConfig.enabled) {
                console.log('[ToolLibrary] Statistics:');
                console.log(`   Total tools: ${this.tools.length}`);
                console.log(`   Tool types: ${Array.from(this.toolsByType.keys()).join(', ')}`);
                console.log(`   Operations covered: ${Array.from(this.toolsByOperation.keys()).join(', ')}`);
                
                this.toolsByType.forEach((tools, type) => {
                    console.log(`   ${type}: ${tools.length} tools`);
                });
            }
        }
        
        getStats() {
            return {
                totalTools: this.tools.length,
                types: Array.from(this.toolsByType.keys()),
                operations: Array.from(this.toolsByOperation.keys()),
                categories: this.getToolCategories(),
                isLoaded: this.isLoaded,
                loadError: this.loadError
            };
        }
    }
    
    window.ToolLibrary = ToolLibrary;
    
})();