/*!
 * @file        ui/ui-nav-tree-panel.js
 * @description Manages the operations tree nav (left sidebar)
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

    const config = window.PCBCAMConfig;
    const iconConfig = config.ui.icons;

    class NavTreePanel {
        constructor(ui) {
            this.ui = ui;
            this.core = ui.core;
            this.lang = ui.lang;
            this.nodes = new Map();
            this.selectedNode = null;
            this.expandedCategories = new Set(['isolation', 'drill', 'clearing', 'cutout']);

            this.nextNodeId = 1;

            this.initialized = false;

            // File node suggestion states (for new users, session-only)
            this._suggestionTimer = null;
            this._suggestionInterval = null;
            this._suggestionDismissed = false;
            this._highlightIndex = -1;
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

            // Add keyboard navigation
            this.setupKeyboardNavigation();

            this.initialized = true;

            this.debug('NavTreePanel initialized');
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

            const header = category.querySelector('.category-header');
            const isExpanded = category.classList.contains('expanded');

            if (isExpanded) {
                category.classList.remove('expanded');
                this.expandedCategories.delete(opType);
                if (header) header.setAttribute('aria-expanded', 'false');
            } else {
                category.classList.add('expanded');
                this.expandedCategories.add(opType);
                if (header) header.setAttribute('aria-expanded', 'true');
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
                console.error(`[NavTreePanel] Category not found for operation type: ${operation.type}`);
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

            // ARIA attributes for keyboard navigation
            content.setAttribute('role', 'treeitem');
            content.setAttribute('tabindex', '-1');
            content.setAttribute('aria-selected', 'false');
            content.setAttribute('aria-level', '2');

            // Setup geometries container with group role
            const geometriesContainer = nodeElement.querySelector('.file-geometries');
            if (geometriesContainer) {
                geometriesContainer.setAttribute('role', 'group');
            }

            // Find the buttons already in your template
            const deleteBtn = nodeElement.querySelector('.delete-btn');
            const visBtn = nodeElement.querySelector('.visibility-btn');

            // Set dynamic accessible names
            if (deleteBtn) {
                deleteBtn.setAttribute('aria-label', `Delete ${operation.file.name}`);
            }
            if (visBtn) {
                visBtn.setAttribute('aria-label', `Toggle visibility of ${operation.file.name}`);
            }

            // Attach listener for the visibility button
            if (visBtn) {
                const layerName = `source_${operation.id}`; // The layer name it controls
                visBtn.dataset.layerName = layerName;

                // Set initial state
                let isVisible = true;
                if (this.ui.renderer && this.ui.renderer.layers.has(layerName)) {
                    isVisible = this.ui.renderer.layers.get(layerName).visible;
                }
                visBtn.classList.toggle('is-hidden', !isVisible);

                // Attach the "smart" re-usable toggle function
                visBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleLayerVisibility(visBtn, layerName);
                });
            }

            label.textContent = operation.file.name;

            // Attach listener for the main content click
            content.addEventListener('click', (e) => {
                if (!e.target.closest('.btn-icon')) {
                    this.selectFile(fileId, operation);
                }
            });

            // Attach listener for the delete button
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    // This calls the "delete entire operation" mediator function
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

            // Update category aria-expanded since it now has files
            const categoryElement = category.closest('.operation-category');
            if (categoryElement) {
                const categoryHeader = categoryElement.querySelector('.category-header');
                if (!categoryElement.classList.contains('expanded')) {
                    categoryElement.classList.add('expanded');
                    this.expandedCategories.add(operation.type);
                }
                if (categoryHeader) {
                    categoryHeader.setAttribute('aria-expanded', 'true');
                }
            }

            this.updateFileGeometries(fileId, operation);

            // Schedule onboarding suggestion (resets with each new file to handle multi-file loads)
            this._scheduleSuggestion();

            return fileId;
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

            // Update aria-expanded based on populated geometries
            const fileContent = fileData.element.querySelector('.file-node-content');
            if (fileContent) {
                if (geometriesContainer.children.length > 0) {
                    fileContent.setAttribute('aria-expanded', 'true');
                } else {
                    fileContent.removeAttribute('aria-expanded');
                }
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

            // ARIA attributes for keyboard navigation
            content.setAttribute('role', 'treeitem');
            content.setAttribute('tabindex', '-1');
            content.setAttribute('aria-selected', 'false');
            content.setAttribute('aria-level', '3');

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
                        // Be visible only if there is no preview and the global toggle is on.
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

                // Update aria-setsize and aria-posinset for all geometry siblings
                this.updateGeometrySetInfo(fileId);
            }
        }

        selectFile(fileId, operation) {
            // Dismiss onboarding suggestion - user discovered the workflow
            this._dismissSuggestion();

            // Clear previous selections
            document.querySelectorAll('.file-node-content.selected, .geometry-node.selected').forEach(el => {
                el.classList.remove('selected');
            });

            const fileData = this.nodes.get(fileId);
            if (fileData) {
                const content = fileData.element.querySelector('.file-node-content');
                if (content) {
                    content.classList.add('selected');
                    content.setAttribute('aria-selected', 'true');
                }
            }

            // Clear aria-selected from others
            document.querySelectorAll('[aria-selected="true"]').forEach(el => {
                if (el !== fileData?.element.querySelector('.file-node-content')) {
                    el.setAttribute('aria-selected', 'false');
                }
            });

            this.selectedNode = { type: 'file', id: fileId, operation };

            // Announce the selection to cam-ui.js
            if (this.ui.handleOperationSelection) {
                this.ui.handleOperationSelection(operation, 'geometry');
            }
        }

        selectGeometry(geometryId, operation, geometryType) {
            // Clear previous selections
            document.querySelectorAll('.file-node-content.selected, .geometry-node.selected').forEach(el => {
                el.classList.remove('selected');
            });
            document.querySelectorAll('[aria-selected="true"]').forEach(el => {
                el.setAttribute('aria-selected', 'false');
            });

            const geometryNode = document.querySelector(`.geometry-node[data-geometry-id="${geometryId}"]`);
            if (geometryNode) {
                geometryNode.classList.add('selected');
                const content = geometryNode.querySelector('.geometry-node-content');
                if (content) {
                    content.setAttribute('aria-selected', 'true');
                }
            }

            this.selectedNode = { type: 'geometry', id: geometryId, operation, geometryType };

            // Determine geometry stage
            let stage = 'geometry';
            if (geometryType === 'preview') {
                stage = 'machine';
            } else if (geometryType.startsWith('offset') || geometryType === 'offsets_combined') {
                stage = 'strategy';
            }

            // Announce the selection to cam-ui.js
            if (this.ui.handleOperationSelection) {
                this.ui.handleOperationSelection(operation, stage);
            }
        }

        deleteGeometry(fileId, geometryId) {
            // Find the data associated with the click
            const fileData = this.nodes.get(fileId);
            if (!fileData) return;

            const geoData = fileData.geometries.get(geometryId);
            if (!geoData) return;

            // Announce the "intent to delete" to cam-ui.js
            if (this.ui.handleDeleteGeometry) {
                // Pass all the info cam-ui.js needs to do the job
                this.ui.handleDeleteGeometry(fileId, fileData, geometryId, geoData);
            }
        }

        updateGeometrySetInfo(fileId) {
            const fileData = this.nodes.get(fileId);
            if (!fileData) return;

            const container = fileData.element.querySelector('.file-geometries');
            if (!container) return;

            const geometryContents = container.querySelectorAll('.geometry-node-content');
            const total = geometryContents.length;

            geometryContents.forEach((content, index) => {
                content.setAttribute('aria-setsize', total.toString());
                content.setAttribute('aria-posinset', (index + 1).toString());
            });
        }

        removeGeometryNode(fileId, geometryId) {
            const fileData = this.nodes.get(fileId);
            if (!fileData) return;

            const geoData = fileData.geometries.get(geometryId);
            if (geoData && geoData.element) {
                geoData.element.remove();
                fileData.geometries.delete(geometryId);

                // Recalculate aria-expanded and setsize after removal
                const geometriesContainer = fileData.element.querySelector('.file-geometries');
                const fileContent = fileData.element.querySelector('.file-node-content');

                if (fileContent && geometriesContainer) {
                    if (geometriesContainer.children.length > 0) {
                        fileContent.setAttribute('aria-expanded', 'true');
                        this.updateGeometrySetInfo(fileId);
                    } else {
                        fileContent.removeAttribute('aria-expanded');
                    }
                }
            }
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
                console.warn(`[NavTreePanel] Could not find layer to toggle: ${layerName}`);
            }
        }

        removeFileNode(operationId) {
            let nodeToRemove = null;
            let operationType = null;

            this.nodes.forEach((node, id) => {
                if (node.operation?.id === operationId) {
                    nodeToRemove = id;
                    operationType = node.operation.type;
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
                    if (this.ui.operationPanel) {
                        this.ui.operationPanel.clearProperties();
                    }
                }

                // Update category aria-expanded if now empty
                if (operationType) {
                    const category = document.querySelector(`.operation-category[data-op-type="${operationType}"]`);
                    if (category) {
                        const filesContainer = category.querySelector('.category-files');
                        const categoryHeader = category.querySelector('.category-header');

                        if (categoryHeader && filesContainer) {
                            if (filesContainer.children.length === 0) {
                                categoryHeader.removeAttribute('aria-expanded');
                            }
                        }
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

        setupKeyboardNavigation() {
            const treeView = document.getElementById('operations-tree');
            if (!treeView) return;

            // Set ARIA role on container
            treeView.setAttribute('role', 'tree');
            treeView.setAttribute('aria-label', 'Operations');

            // Setup categories with ARIA
            this.setupCategoryARIA();

            // Single keydown listener on tree container
            treeView.addEventListener('keydown', (e) => this.handleTreeKeydown(e));
        }

        setupCategoryARIA() {
            const categories = document.querySelectorAll('.operation-category');

            categories.forEach((category, index) => {
                const header = category.querySelector('.category-header');
                const filesContainer = category.querySelector('.category-files');

                if (header) {
                    header.setAttribute('role', 'treeitem');
                    header.setAttribute('tabindex', index === 0 ? '0' : '-1');
                    header.setAttribute('aria-level', '1');

                    const hasFiles = filesContainer && filesContainer.children.length > 0;
                    if (hasFiles) {
                        header.setAttribute('aria-expanded', 
                            category.classList.contains('expanded').toString());
                    } else {
                        header.removeAttribute('aria-expanded');
                    }
                }

                if (filesContainer) {
                    filesContainer.setAttribute('role', 'group');
                }
            });
        }

        handleTreeKeydown(e) {
            const focused = document.activeElement;
            if (!focused) return;

            const isCategory = focused.classList.contains('category-header');
            const isFileContent = focused.classList.contains('file-node-content');
            const isGeometryContent = focused.classList.contains('geometry-node-content');

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    this.moveFocusDown(focused);
                    break;

                case 'ArrowUp':
                    e.preventDefault();
                    this.moveFocusUp(focused);
                    break;

                case 'ArrowRight':
                    e.preventDefault();
                    if (isCategory) {
                        const category = focused.closest('.operation-category');
                        if (!category.classList.contains('expanded')) {
                            this.expandCategoryByHeader(focused);
                        } else {
                            const firstFile = category.querySelector('.file-node-content');
                            if (firstFile) this.setFocusOnItem(focused, firstFile);
                        }
                    } else if (isFileContent) {
                        const firstGeo = focused.closest('.file-node')?.querySelector('.geometry-node-content');
                        if (firstGeo) this.setFocusOnItem(focused, firstGeo);
                    }
                    break;

                case 'ArrowLeft':
                    e.preventDefault();
                    if (isCategory) {
                        this.collapseCategoryByHeader(focused);
                    } else if (isGeometryContent) {
                        const parentFile = focused.closest('.file-node')?.querySelector('.file-node-content');
                        if (parentFile) this.setFocusOnItem(focused, parentFile);
                    } else if (isFileContent) {
                        const header = focused.closest('.operation-category')?.querySelector('.category-header');
                        if (header) this.setFocusOnItem(focused, header);
                    }
                    break;

                case 'Enter':
                case ' ':
                    e.preventDefault();
                    if (isCategory) {
                        this.toggleCategory(focused.closest('.operation-category').dataset.opType);
                        focused.setAttribute('aria-expanded', 
                            focused.closest('.operation-category').classList.contains('expanded').toString());
                    } else if (isFileContent) {
                        this.activateFileNode(focused);
                    } else if (isGeometryContent) {
                        this.activateGeometryNode(focused);
                    }
                    break;

                case 'Home':
                    e.preventDefault();
                    this.focusFirstItem();
                    break;

                case 'End':
                    e.preventDefault();
                    this.focusLastItem();
                    break;

                case 'Delete':
                    e.preventDefault();
                    this.handleDeleteOnFocused(focused, isFileContent, isGeometryContent);
                    break;

                case 'v':
                case 'V':
                    // Toggle visibility of focused item
                    if (isFileContent || isGeometryContent) {
                        e.preventDefault();
                        const visBtn = focused.querySelector('.visibility-btn');
                        if (visBtn) visBtn.click();
                    }
                    break;
            }
        }

        activateFileNode(fileContent) {
            const fileNode = fileContent.closest('.file-node');
            const fileId = fileNode?.dataset.fileId;
            const nodeData = this.nodes.get(fileId);

            if (nodeData?.operation) {
                this.selectFile(fileId, nodeData.operation);
                this.focusParameterPanel();
            }
        }

        activateGeometryNode(geometryContent) {
            const geometryNode = geometryContent.closest('.geometry-node');
            const geometryId = geometryNode?.dataset.geometryId;
            const geometryType = geometryNode?.dataset.geometryType;

            // Find parent file node to get operation
            const fileNode = geometryNode.closest('.file-node');
            const fileId = fileNode?.dataset.fileId;
            const nodeData = this.nodes.get(fileId);

            if (nodeData?.operation) {
                this.selectGeometry(geometryId, nodeData.operation, geometryType);
                this.focusParameterPanel();
            }
        }

        focusParameterPanel() {
            // Delay to allow panel to render
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    const paramForm = document.getElementById('property-form');
                    if (!paramForm) return;

                    // Focus the first property ROW, not input
                    const firstRow = paramForm.querySelector('.property-field[tabindex]');
                    if (firstRow) {
                        firstRow.focus();
                        return;
                    }

                    // Fallback: first focusable if no rows
                    const firstFocusable = paramForm.querySelector(
                        'button:not([disabled]), [tabindex="0"]'
                    );
                    if (firstFocusable) firstFocusable.focus();
                });
            });
        }

        getVisibleTreeItems() {
            const items = [];
            const categories = document.querySelectorAll('.operation-category');

            categories.forEach(cat => {
                const header = cat.querySelector('.category-header');
                if (header) items.push(header);

                if (cat.classList.contains('expanded')) {
                    const fileNodes = cat.querySelectorAll('.file-node');
                    fileNodes.forEach(fileNode => {
                        // Add file content
                        const fileContent = fileNode.querySelector('.file-node-content');
                        if (fileContent) {
                            items.push(fileContent);
                            // Add buttons within file node
                            const buttons = fileContent.querySelectorAll('.btn-icon');
                            buttons.forEach(btn => items.push(btn));
                        }

                        // Add geometry nodes and their buttons
                        const geoNodes = fileNode.querySelectorAll('.geometry-node');
                        geoNodes.forEach(geoNode => {
                            const geoContent = geoNode.querySelector('.geometry-node-content');
                            if (geoContent) {
                                items.push(geoContent);
                                const buttons = geoContent.querySelectorAll('.btn-icon');
                                buttons.forEach(btn => items.push(btn));
                            }
                        });
                    });
                }
            });

            return items;
        }

        moveFocusDown(current) {
            const items = this.getVisibleTreeItems();
            const currentIndex = items.indexOf(current);
            const next = items[currentIndex + 1];

            if (next) {
                this.setFocusOnItem(current, next);
            }
        }

        moveFocusUp(current) {
            const items = this.getVisibleTreeItems();
            const currentIndex = items.indexOf(current);
            const prev = items[currentIndex - 1];

            if (prev) {
                this.setFocusOnItem(current, prev);
            }
        }

        setFocusOnItem(oldItem, newItem) {
            if (oldItem) oldItem.setAttribute('tabindex', '-1');
            if (newItem) {
                newItem.setAttribute('tabindex', '0');
                newItem.focus();
            }
        }

        expandCategoryByHeader(header) {
            const category = header.closest('.operation-category');
            if (category && !category.classList.contains('expanded')) {
                category.classList.add('expanded');
                header.setAttribute('aria-expanded', 'true');
                this.expandedCategories.add(category.dataset.opType);
            }
        }

        collapseCategoryByHeader(header) {
            const category = header.closest('.operation-category');
            if (category && category.classList.contains('expanded')) {
                category.classList.remove('expanded');
                header.setAttribute('aria-expanded', 'false');
                this.expandedCategories.delete(category.dataset.opType);
            }
        }

        moveFocusToParent(item) {
            const fileNode = item.closest('.file-node');
            const category = item.closest('.operation-category');

            if (fileNode && item.closest('.geometry-node')) {
                // Geometry -> File
                const fileContent = fileNode.querySelector('.file-node-content');
                this.setFocusOnItem(item, fileContent);
            } else if (category) {
                // File -> Category
                const header = category.querySelector('.category-header');
                this.setFocusOnItem(item, header);
            }
        }

        moveFocusToFirstChild(fileContent) {
            const fileNode = fileContent.closest('.file-node');
            const firstGeo = fileNode?.querySelector('.geometry-node-content');
            if (firstGeo) {
                this.setFocusOnItem(fileContent, firstGeo);
            }
        }

        focusFirstItem() {
            const items = this.getVisibleTreeItems();
            if (items[0]) {
                const current = document.activeElement;
                this.setFocusOnItem(current, items[0]);
            }
        }

        focusLastItem() {
            const items = this.getVisibleTreeItems();
            if (items.length) {
                const current = document.activeElement;
                this.setFocusOnItem(current, items[items.length - 1]);
            }
        }

        handleDeleteOnFocused(focused, isFileContent, isGeometryContent) {
            if (isFileContent) {
                const fileNode = focused.closest('.file-node');
                const fileId = fileNode?.dataset.fileId;
                const nodeData = this.nodes.get(fileId);
                if (nodeData?.operation) {
                    // Store next focusable before deletion
                    const items = this.getVisibleTreeItems();
                    const idx = items.indexOf(focused);
                    const nextFocus = items[idx + 1] || items[idx - 1];

                    this.ui.removeOperation(nodeData.operation.id);

                    // Restore focus
                    if (nextFocus && document.body.contains(nextFocus)) {
                        this.setFocusOnItem(null, nextFocus);
                    }
                }
            } else if (isGeometryContent) {
                const geoNode = focused.closest('.geometry-node');
                const fileNode = focused.closest('.file-node');
                const geometryId = geoNode?.dataset.geometryId;
                const fileId = fileNode?.dataset.fileId;
                const fileData = this.nodes.get(fileId);
                const geoData = fileData?.geometries.get(geometryId);

                if (fileData && geoData) {
                    // Store next focusable
                    const items = this.getVisibleTreeItems();
                    const idx = items.indexOf(focused);
                    const nextFocus = items[idx + 1] || items[idx - 1];

                    this.ui.handleDeleteGeometry(fileId, fileData, geometryId, geoData);

                    if (nextFocus && document.body.contains(nextFocus)) {
                        this.setFocusOnItem(null, nextFocus);
                    }
                }
            }
        }

        /**
         * Schedules (or reschedules) the onboarding highlight cycle each time a file node is added.
         */
        _scheduleSuggestion() {
            if (this._suggestionDismissed) return;

            if (this._suggestionTimer) clearTimeout(this._suggestionTimer);

            this._suggestionTimer = setTimeout(() => {
                this._suggestionTimer = null;
                this._startSuggestionCycle();
            }, 12500);
        }

        /**
         * Begins cycling the highlight across loaded file nodes (if no file has been selected yet).
         */
        _startSuggestionCycle() {
            if (this._suggestionDismissed || this._suggestionInterval) return;

            // User already found the workflow on their own
            if (this.ui.operationPanel?.currentOperation) {
                this._dismissSuggestion();
                return;
            }

            const nodes = this._getHighlightableNodes();
            if (nodes.length === 0) return;

            this._highlightIndex = -1;
            this._cycleHighlight(); // Start immediately
            this._suggestionInterval = setInterval(() => this._cycleHighlight(), 3250);

            this.debug('Onboarding suggestion cycle started');
        }

        /**
         * Advances the highlight to the next file node with loaded primitives.
         */
        _cycleHighlight() {
            if (this._suggestionDismissed) return;

            const nodes = this._getHighlightableNodes();
            if (nodes.length === 0) {
                this._dismissSuggestion();
                return;
            }

            // Remove highlight from all nodes
            document.querySelectorAll('.file-node-content.onboarding-highlight')
                .forEach(el => el.classList.remove('onboarding-highlight'));

            // Advance to next
            this._highlightIndex = (this._highlightIndex + 1) % nodes.length;
            const target = nodes[this._highlightIndex];
            target.classList.add('onboarding-highlight');

            // Ensure parent category is expanded so the highlight is visible
            const category = target.closest('.operation-category');
            if (category && !category.classList.contains('expanded')) {
                category.classList.add('expanded');
                const opType = category.dataset.opType;
                if (opType) this.expandedCategories.add(opType);
            }
        }

        /**
         * Returns file-node-content elements for operations that have loaded primitives.
         */
        _getHighlightableNodes() {
            const elements = [];
            this.nodes.forEach((data) => {
                if (data.type === 'file' && data.operation?.primitives?.length > 0) {
                    const content = data.element.querySelector('.file-node-content');
                    if (content) elements.push(content);
                }
            });
            return elements;
        }

        /**
         * Permanently disables the onboarding suggestion for this session.
         */
        _dismissSuggestion() {
            if (this._suggestionDismissed) return;

            this._suggestionDismissed = true;

            if (this._suggestionTimer) {
                clearTimeout(this._suggestionTimer);
                this._suggestionTimer = null;
            }
            if (this._suggestionInterval) {
                clearInterval(this._suggestionInterval);
                this._suggestionInterval = null;
            }

            document.querySelectorAll('.file-node-content.onboarding-highlight')
                .forEach(el => el.classList.remove('onboarding-highlight'));

            this.debug('Onboarding suggestion dismissed');
        }

        debug(message, data = null) {
            if (this.ui.debug) {
                this.ui.debug(`[NavTreePanel] ${message}`, data);
            }
        }

    }

    window.NavTreePanel = NavTreePanel;
})();