/*!
 * @file        ui/tool-library.js
 * @description Manages tool definitions and tool selection functionality
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
    const debugState = D.debug;

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

            // PROD: Use the array injected by build.js
            if (typeof EMBEDDED_TOOLS !== 'undefined') {
                this.importTools(EMBEDDED_TOOLS);
                this.isLoaded = true;
                this.debug(`Loaded ${this.tools.length} embedded tools`);
                return true;
            }

            // DEV: Fetch the JSON file directly.
            const loaded = await this.loadFromFile('../tools.json');
            if (!loaded) {
                throw new Error("[ToolLibrary] ToolLibrary failed to load tools.json in development mode.");
            }

            return true;
        }

        /**
         * Gets the effective tool diameter for a given tool ID.
         * For V-bits, returns tipDiameter. For all others, returns diameter.
         */
        getToolDiameter(toolId) {
            const tool = this.getTool(toolId);
            if (!tool || !tool.geometry) return null;

            // V-bits use tipDiameter as their effective cutting width at surface
            if (tool.type === 'v_bit' && tool.geometry.tipDiameter !== undefined) {
                return tool.geometry.tipDiameter;
            }
            return tool.geometry.diameter;
        }

        /**
         * Gets full tool data including computed effective diameter.
         */
        getToolWithEffectiveDiameter(toolId) {
            const tool = this.getTool(toolId);
            if (!tool) return null;

            return {
                ...tool,
                effectiveDiameter: this.getToolDiameter(toolId)
            };
        }

        async loadFromFile(url) {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`[ToolLibrary] HTTP error loading tools: ${response.status}`);
            }

            const data = await response.json();
            if (!data.tools || !Array.isArray(data.tools)) {
                throw new Error('[ToolLibrary] Invalid tools.json format: Missing "tools" array');
            }

            this.tools = [];
            this.toolsById.clear();
            this.toolsByType.clear();
            this.toolsByOperation.clear();

            data.tools.forEach(tool => this.addTool(tool)); // Assume validateTool throws if invalid

            this.isLoaded = true;
            this.debug(`Loaded ${this.tools.length} tools from ${url}`);
            return true;
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
            // Grab an identifier for the error message so you know exactly which tool broke
            const toolIdentifier = tool.id || tool.name || 'Unknown Tool';

            const required = ['id', 'name', 'type', 'geometry', 'cutting', 'operations'];

            // Check top-level required fields
            for (const field of required) {
                if (!tool[field]) {
                    throw new Error(`[Fatal] Tool validation failed: Tool '${toolIdentifier}' is missing required field '${field}'.`);
                }
            }

            // Check required geometry properties based on tool type
            if (tool.type === 'v_bit') {
                if (tool.geometry.tipDiameter === undefined || tool.geometry.tipDiameter === null) {
                    throw new Error(`[Fatal] Tool validation failed: V-Bit '${toolIdentifier}' is missing 'geometry.tipDiameter'.`);
                }
            } else {
                if (tool.geometry.diameter === undefined || tool.geometry.diameter === null) {
                    throw new Error(`[Fatal] Tool validation failed: Tool '${toolIdentifier}' is missing 'geometry.diameter'.`);
                }
            }

            // Check required cutting properties
            const cuttingRequired = ['feedRate', 'plungeRate', 'spindleSpeed'];
            for (const field of cuttingRequired) {
                if (tool.cutting[field] === undefined || tool.cutting[field] === null) {
                    throw new Error(`[Fatal] Tool validation failed: Tool '${toolIdentifier}' is missing 'cutting.${field}'.`);
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
            const opConfig = D.operations?.[operationType];
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

        debug(message, data = null) {
            // does this work?
            if (this.ui && this.ui.debug) {
                this.ui.debug(`[ToolLibrary] ${message}`, data);
            }
        }

        logToolStats() {
            if (debugState.enabled) {
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