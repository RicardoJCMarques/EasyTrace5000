/**
 * @file        ui/ui-tree-manager.js
 * @description Manages the operations tree nav (left sidebar)
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
    const iconConfig = config.ui?.icons || {};
    
    class TreeManager {
        constructor(ui) {
            this.ui = ui;
            this.core = ui.core;
            
            this.nodes = new Map();
            this.selectedNode = null;
            this.expandedCategories = new Set(['isolation', 'drill', 'clear', 'cutout']);
            
            this.nextNodeId = 1;

            this.initialized = false;
        }

        init() {
            if (this.initialized) return;

            this.setupCategories();

            const collapseAllBtn = document.getElementById('collapse-all-btn');
            if (collapseAllBtn) {
                collapseAllBtn.addEventListener('click', () => this.collapseAll());
            }

            const expandAllBtn = document.getElementById('expand-all-btn');
            if (expandAllBtn) {
                expandAllBtn.addEventListener('click', () => this.expandAll());
            }

            this.initialized = true;

            this.debug('TreeManager initialized');
        }
        
        setupCategories() {
            const categories = document.querySelectorAll('.operation-category');
            
            categories.forEach(category => {
                const header = category.querySelector('.category-header');
                const opType = category.dataset.opType;
                const addBtn = category.querySelector('.add-file-btn');
                
                if (header) {
                    header.addEventListener('click', (e) => {
                        if (!e.target.closest('.add-file-btn')) {
                            this.toggleCategory(opType);
                        }
                    });
                }
                
                if (addBtn) {
                    addBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.ui.triggerFileInput(opType);
                    });
                }
                
                if (this.expandedCategories.has(opType)) {
                    category.classList.add('expanded');
                }
            });
        }
        
        toggleCategory(opType) {
            const category = document.querySelector(`.operation-category[data-op-type="${opType}"]`);
            if (!category) return;
            
            const isExpanded = category.classList.contains('expanded');
            
            if (isExpanded) {
                category.classList.remove('expanded');
                this.expandedCategories.delete(opType);
            } else {
                category.classList.add('expanded');
                this.expandedCategories.add(opType);
            }
        }
        
        expandAll() {
            document.querySelectorAll('.operation-category').forEach(cat => {
                cat.classList.add('expanded');
                const opType = cat.dataset.opType;
                if (opType) this.expandedCategories.add(opType);
            });
        }
        
        collapseAll() {
            document.querySelectorAll('.operation-category').forEach(cat => {
                cat.classList.remove('expanded');
            });
            this.expandedCategories.clear();
        }
        
        addFileNode(operation) {
            const category = document.querySelector(`.operation-category[data-op-type="${operation.type}"] .category-files`);
            if (!category) {
                console.error(`[UI-TreeManager] Category not found for operation type: ${operation.type}`);
                return null;
            }
            
            const fileId = `file_${this.nextNodeId++}`;
            const template = document.getElementById('file-node-template');
            if (!template) return null;
            
            const fileNode = template.content.cloneNode(true);
            const nodeElement = fileNode.querySelector('.file-node');
            
            nodeElement.dataset.fileId = fileId;
            nodeElement.dataset.operationId = operation.id;
            
            const content = nodeElement.querySelector('.file-node-content');
            const label = nodeElement.querySelector('.file-label');
            const settingsBtn = nodeElement.querySelector('.settings-btn');
            const deleteBtn = nodeElement.querySelector('.delete-btn');
            
            // Create and add visibility toggle button for the file itself
            const visBtnTemplate = document.getElementById('geometry-node-template')?.content.querySelector('.visibility-btn');
            if (visBtnTemplate) {
                const visBtn = visBtnTemplate.cloneNode(true);
                const layerName = `source_${operation.id}`; // The layer name it controls
                visBtn.dataset.layerName = layerName;
                
                // Set initial state by checking the layer property
                let isVisible = true; // Default to visible
                if (this.ui.renderer && this.ui.renderer.layers.has(layerName)) {
                    // If the layer *already* exists, get its actual state
                    isVisible = this.ui.renderer.layers.get(layerName).visible;
                }
                visBtn.classList.toggle('is-hidden', !isVisible);

                visBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleLayerVisibility(visBtn, layerName);
                });
                
                // Add the button to the node's actions
                nodeElement.querySelector('.node-actions').prepend(visBtn);
            }

            // Add statistics tooltip
            if (content && window.TooltipManager) {
                this.attachFileTooltip(content, operation);
            }
            
            label.textContent = operation.file.name;
            
            content.addEventListener('click', (e) => {
                if (!e.target.closest('.btn-icon')) {
                    this.selectFile(fileId, operation);
                }
            });
            
            if (settingsBtn) {
                settingsBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.selectFile(fileId, operation);
                });
            }
            
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.ui.removeOperation(operation.id);
                });
            }
            
            this.nodes.set(fileId, {
                id: fileId,
                type: 'file',
                operation: operation,
                element: nodeElement,
                geometries: new Map()
            });
            
            category.appendChild(fileNode);
            
            const categoryElement = category.closest('.operation-category');
            if (categoryElement && !categoryElement.classList.contains('expanded')) {
                categoryElement.classList.add('expanded');
                this.expandedCategories.add(operation.type);
            }
            
            this.updateFileGeometries(fileId, operation);
            
            return fileId;
        }

        attachFileTooltip(element, operation) {
            const bounds = operation.bounds || { width: 0, height: 0 };
            const ctx = operation.geometricContext || {};
            
            // Check if operation.primitives exists before accessing it.
            // If it's null (because parsing isn't finished), show '...'
            const primitiveCount = operation.primitives ? operation.primitives.length : '...';
            
            let statsText = `${operation.file.name}\n\n` +
                `Type: ${operation.type}\n` +
                `Primitives: ${primitiveCount}\n` +
                `Size: ${(operation.file.size / 1024).toFixed(1)} KB\n` +
                `Bounds: ${bounds.width?.toFixed(1) || 0} × ${bounds.height?.toFixed(1) || 0} mm`;
            
            if (ctx.hasArcs) statsText += '\n✓ Contains arcs';
            if (ctx.hasCircles) statsText += '\n✓ Contains circles';
            if (ctx.analyticCount > 0) statsText += `\n✓ Analytic shapes: ${ctx.analyticCount}`;
            if (ctx.strokeCount > 0) statsText += `\n✓ Strokes: ${ctx.strokeCount}`;
            
            // Also check if offsets/preview exist before trying to read them
            if (operation.offsets && operation.offsets.length > 0) {
                const totalOffsetPrims = operation.offsets.reduce((sum, o) => sum + (o.primitives?.length || 0), 0);
                statsText += `\n\nOffsets: ${operation.offsets.length} pass(es)`;
                statsText += `\nOffset primitives: ${totalOffsetPrims}`;
            }
            
            if (operation.preview && operation.preview.primitives) {
                statsText += `\n\nPreview: ${operation.preview.primitives.length} primitives`;
            }
            
            window.TooltipManager.attach(element, { text: statsText });
            
            // Also check if warnings exist
            if (operation.warnings && operation.warnings.length > 0) {
                const label = element.querySelector('.file-label');
                const warningIcon = document.createElement('span');
                warningIcon.className = 'warning-icon';
                warningIcon.textContent = iconConfig.treeWarning;
                warningIcon.title = `${operation.warnings.length} warning(s)`;
                
                const warningText = operation.warnings.map(w => w.message).join('\n');
                window.TooltipManager.attach(warningIcon, { text: warningText });
                
                // Check if label exists before appending
                if (label) {
                    label.appendChild(warningIcon);
                }
            }
        }
        
        updateFileGeometries(fileId, operation) {
            const fileData = this.nodes.get(fileId);
            if (!fileData) return;
            
            const geometriesContainer = fileData.element.querySelector('.file-geometries');
            if (!geometriesContainer) return;
            
            geometriesContainer.innerHTML = '';
            fileData.geometries.clear();
            
            // Add offset nodes
            if (operation.offsets && operation.offsets.length > 0) {
                if (operation.offsets[0]?.combined) {
                    const passes = operation.offsets[0].passes || operation.offsets.length;
                    const label = `Offsets`;
                    this.addGeometryNode(fileId, 'offsets_combined', label, 
                        operation.offsets[0].primitives?.length || 0, {
                        offset: operation.offsets[0].distance.toFixed(2),
                        combined: true,
                        passes: passes
                    });
                } else {
                    operation.offsets.forEach((offset, index) => {
                        const label = `Pass ${index + 1}`;
                        const count = offset.primitives?.length || 0;
                        this.addGeometryNode(fileId, `offset_${index}`, label, count, {
                            offset: offset.distance.toFixed(2)
                        });
                    });
                }
            }
            
            // Add preview node if exists
            if (operation.preview && operation.preview.primitives) {
                this.addGeometryNode(fileId, 'preview', 'Preview',
                    operation.preview.primitives.length, {
                    generated: true,
                    sourceOffsets: operation.preview.metadata?.sourceOffsets || 0
                });
            }
            
            // Add toolpath nodes if exist
            const toolpaths = this.ui.core.toolpaths?.get(operation.id);
            if (toolpaths && toolpaths.paths) {
                toolpaths.paths.forEach((path, index) => {
                    this.addGeometryNode(fileId, `toolpath_${index}`, 
                        `Toolpath ${index + 1}`, 
                        path.primitives?.length || 0);
                });
            }
        }
        
        addGeometryNode(fileId, geometryType, label, count, extraData = {}) {
            const fileData = this.nodes.get(fileId);
            if (!fileData) return;
            
            const template = document.getElementById('geometry-node-template');
            if (!template) return;
            
            const geometryNode = template.content.cloneNode(true);
            const nodeElement = geometryNode.querySelector('.geometry-node');
            const geometryId = `geometry_${this.nextNodeId++}`;
            
            nodeElement.dataset.geometryId = geometryId;
            nodeElement.dataset.geometryType = geometryType;
            
            const content = nodeElement.querySelector('.geometry-node-content');
            const iconEl = nodeElement.querySelector('.geometry-icon');
            const labelEl = nodeElement.querySelector('.geometry-label');
            const infoEl = nodeElement.querySelector('.geometry-info');
            const visBtn = nodeElement.querySelector('.visibility-btn');
            const deleteBtn = nodeElement.querySelector('.delete-geometry-btn');
            
            const icons = {
                'offsets_combined': iconConfig.offsetCombined,
                'offset': iconConfig.offsetPass,
                'preview': iconConfig.preview,
                'toolpath': iconConfig.toolpath
            };

            const baseType = geometryType.startsWith('offset') ? 'offset' :
                            geometryType === 'offsets_combined' ? 'offsets_combined' :
                            geometryType.startsWith('toolpath') ? 'toolpath' :
                            geometryType === 'preview' ? 'preview' : geometryType;
            
            iconEl.textContent = icons[baseType] || iconConfig.defaultGeometry;
            
            labelEl.textContent = label;
            
            if (extraData.offset) {
                infoEl.textContent = `${extraData.offset}mm`;
            } else {
                infoEl.textContent = count > 0 ? `${count}` : '';
            }
            
            content.addEventListener('click', (e) => {
                if (!e.target.closest('.btn-icon')) {
                    this.selectGeometry(geometryId, fileData.operation, geometryType);
                }
            });

            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteGeometry(fileId, geometryId);
                });
            }
            
            if (visBtn) {
                // Determine the exact layer name this button controls
                const operationId = fileData.operation.id;
                let layerName;
                
                if (geometryType === 'offsets_combined') {
                    layerName = `offset_${operationId}_combined`;
                } else if (geometryType.startsWith('offset_')) {
                    const passIndex = parseInt(geometryType.split('_')[1]);
                    layerName = `offset_${operationId}_pass_${passIndex + 1}`;
                } else if (geometryType === 'preview') {
                    layerName = `preview_${operationId}`;
                }
                
                visBtn.dataset.layerName = layerName || '';

                visBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleLayerVisibility(visBtn, layerName);
                });

                // Set initial button state by checking the layer property
                let isVisible = false; // Default to hidden
                if (layerName && this.ui.renderer) {
                    if (geometryType.startsWith('offset')) {
                        // Check if the operation *has* a preview.
                        const hasPreview = fileData.operation.preview && fileData.operation.preview.ready;
                        // Be visible *only if* there is no preview AND the global toggle is on.
                        isVisible = !hasPreview && this.ui.renderer.options.showOffsets;
                        
                    } else if (geometryType === 'preview') {
                        // Preview visibility is just the global toggle.
                        isVisible = this.ui.renderer.options.showPreviews;
                    } else {
                        // Fallback for other types (like toolpaths)
                        const layer = this.ui.renderer.layers.get(layerName);
                        if (layer) {
                            isVisible = layer.visible;
                        } else {
                            // Layer might not be created yet, check default
                            isVisible = this.ui.renderer.options.showToolpaths; // Assuming a 'showToolpaths' option
                        }
                    }
                }
                
                visBtn.classList.toggle('is-hidden', !isVisible);
            }

            const nodeContent = nodeElement.querySelector('.geometry-node-content');
            if (nodeContent && window.TooltipManager) {
                let tooltipText = `${label}\nPrimitives: ${count}`;
                
                if (extraData.offset) {
                    tooltipText += `\nOffset: ${extraData.offset}mm`;
                }
                
                if (extraData.combined) {
                    tooltipText += `\nPasses: ${extraData.passes}`;
                }
                
                window.TooltipManager.attach(nodeContent, { text: tooltipText });
            }
            
            fileData.geometries.set(geometryId, {
                id: geometryId,
                type: geometryType,
                label: label,
                element: nodeElement,
                extraData: extraData
            });
            
            const container = fileData.element.querySelector('.file-geometries');
            if (container) {
                container.appendChild(geometryNode);
            }
        }
        
        selectFile(fileId, operation) {
            this.ui.controls?.collapseRightSidebar();
            
            document.querySelectorAll('.file-node-content.selected, .geometry-node.selected').forEach(el => {
                el.classList.remove('selected');
            });
            
            const fileData = this.nodes.get(fileId);
            if (fileData) {
                const content = fileData.element.querySelector('.file-node-content');
                if (content) {
                    content.classList.add('selected');
                }
            }
            
            this.selectedNode = { type: 'file', id: fileId, operation };
            
            if (this.ui.propertyInspector) {
                this.ui.propertyInspector.showOperationProperties(operation, 'geometry');
            }
        }
        
        selectGeometry(geometryId, operation, geometryType) {
            this.ui.controls?.collapseRightSidebar();
            
            document.querySelectorAll('.file-node-content.selected, .geometry-node.selected').forEach(el => {
                el.classList.remove('selected');
            });
            
            const geometryNode = document.querySelector(`.geometry-node[data-geometry-id="${geometryId}"]`);
            if (geometryNode) {
                geometryNode.classList.add('selected');
            }
            
            this.selectedNode = { type: 'geometry', id: geometryId, operation, geometryType };
            
            // Determine geometry stage
            let stage = 'geometry';
            if (geometryType === 'preview') {
                stage = 'machine';
            } else if (geometryType.startsWith('offset') || geometryType === 'offsets_combined') {
                stage = 'strategy';
            }
            
            if (this.ui.propertyInspector) {
                this.ui.propertyInspector.showOperationProperties(operation, stage);
            }
        }

        deleteGeometry(fileId, geometryId) {
            const fileData = this.nodes.get(fileId);
            if (!fileData) return;
            
            const geoData = fileData.geometries.get(geometryId);
            if (!geoData) return;
            
            let layerName;
            
            if (geoData.type === 'offsets_combined') {
                layerName = `offset_${fileData.operation.id}_combined`;
                if (fileData.operation.offsets) {
                    fileData.operation.offsets = []; // Clear all offsets
                }
                
            } else if (geoData.type.startsWith('offset_')) {
                const passIndex = parseInt(geoData.type.split('_')[1]); // e.g., "offset_0" -> 0
                const passNumber = passIndex + 1;
                layerName = `offset_${fileData.operation.id}_pass_${passNumber}`;
                
                if (fileData.operation.offsets) {
                    fileData.operation.offsets.splice(passIndex, 1);
                }
            } else {
                layerName = `${geoData.type}_${fileData.operation.id}`;
                
                if (geoData.type === 'preview' && fileData.operation.preview) {
                    fileData.operation.preview = null;
                }
            }

            if (layerName && this.ui.renderer.layers.has(layerName)) {
                this.ui.renderer.layers.delete(layerName);
            } else {
                console.warn(`[TreeManager] Could not find layer to delete: ${layerName}`);
            }
            
            geoData.element.remove();
            fileData.geometries.delete(geometryId);
            
            // After deleting geometry, re-select the parent file node to show the 'geometry' stage again.
            this.selectFile(fileId, fileData.operation);

            this.ui.renderer.render();
        }
        
        toggleLayerVisibility(button, layerName) {
            if (!layerName || !this.ui.renderer) return;

            // Find the layer
            const layer = this.ui.renderer.layers.get(layerName);
            
            if (layer) {
                // Toggle only that layer
                layer.visible = !layer.visible;
                this.ui.renderer.render();
                
                // Update the button's appearance
                button.classList.toggle('is-hidden', !layer.visible);
            } else {
                console.warn(`[TreeManager] Could not find layer to toggle: ${layerName}`);
            }
        }
        
        removeFileNode(operationId) {
            let nodeToRemove = null;
            this.nodes.forEach((node, id) => {
                if (node.operation?.id === operationId) {
                    nodeToRemove = id;
                }
            });
            
            if (nodeToRemove) {
                const nodeData = this.nodes.get(nodeToRemove);
                if (nodeData && nodeData.element) {
                    nodeData.element.remove();
                }
                this.nodes.delete(nodeToRemove);
                
                if (this.selectedNode?.id === nodeToRemove) {
                    this.selectedNode = null;
                    if (this.ui.propertyInspector) {
                        this.ui.propertyInspector.clearProperties();
                    }
                }
            }
        }
        
        refreshTree() {
            document.querySelectorAll('.category-files').forEach(container => {
                container.innerHTML = '';
            });
            this.nodes.clear();
            this.nextNodeId = 1;
            
            if (this.core && this.core.operations) {
                this.core.operations.forEach(operation => {
                    if (operation.file) {
                        this.addFileNode(operation);
                    }
                });
            }
        }
        
        getSelectedOperation() {
            return this.selectedNode?.operation || null;
        }
        
        updateNodeCounts() {
            this.nodes.forEach(fileData => {
                if (fileData.type === 'file' && fileData.operation) {
                    this.updateFileGeometries(fileData.id, fileData.operation);
                }
            });
        }

        debug(message, data = null) {
            if (debugConfig.enabled) {
                if (data) {
                    console.log(`[TreeManager] ${message}`, data);
                } else {
                    console.log(`[TreeManager] ${message}`);
                }
            }
        }

    }
    
    window.TreeManager = TreeManager;
})();