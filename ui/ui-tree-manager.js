// ui/ui-tree-manager.js
// Manages the operation-based hierarchical navigation tree with tooltip support

(function() {
    'use strict';
    
    const config = window.PCBCAMConfig || {};
    const debugConfig = config.debug || {};
    
    class TreeManager {
        constructor(ui) {
            this.ui = ui;
            this.core = ui.core;
            
            // Track tree state
            this.nodes = new Map(); // nodeId -> node data
            this.selectedNode = null;
            this.expandedCategories = new Set(['isolation', 'drill', 'clear', 'cutout']);
            
            // Node ID generation
            this.nextNodeId = 1;
            
            // Tooltip element
            this.tooltip = null;
            this.tooltipTimeout = null;
            
            // Event handlers bound to this instance
            this.handleCategoryClick = this._handleCategoryClick.bind(this);
            this.handleFileClick = this._handleFileClick.bind(this);
            this.handleGeometryClick = this._handleGeometryClick.bind(this);
            
            this.initialized = false;
        }
        
        init() {
            if (this.initialized) return;
            
            // Create tooltip element
            this.createTooltip();
            
            // Setup operation category event handlers
            this.setupCategories();
            
            // Setup expand/collapse all buttons
            const collapseAllBtn = document.getElementById('collapse-all-btn');
            if (collapseAllBtn) {
                collapseAllBtn.addEventListener('click', () => this.collapseAll());
            }

            const expandAllBtn = document.getElementById('expand-all-btn');
            if (expandAllBtn) {
                expandAllBtn.addEventListener('click', () => this.expandAll());
            }
            
            // Setup visualization panel toggle
            const vizPanelHeader = document.getElementById('viz-panel-header');
            if (vizPanelHeader) {
                vizPanelHeader.addEventListener('click', () => {
                    const panel = document.getElementById('viz-panel');
                    const indicator = vizPanelHeader.querySelector('.collapse-indicator');
                    if (panel) {
                        panel.classList.toggle('collapsed');
                        if (indicator) {
                            indicator.textContent = panel.classList.contains('collapsed') ? '▲' : '▼';
                        }
                    }
                });
            }
            
            this.initialized = true;
            
            if (debugConfig.enabled) {
                console.log('TreeManager initialized with tooltip support');
            }
        }
        
        createTooltip() {
            this.tooltip = document.createElement('div');
            this.tooltip.className = 'tooltip';
            this.tooltip.innerHTML = '<div class="tooltip-content"></div>';
            document.body.appendChild(this.tooltip);
        }
        
        showTooltip(element, data) {
            if (this.tooltipTimeout) {
                clearTimeout(this.tooltipTimeout);
            }
            
            // Build tooltip content
            const content = this.tooltip.querySelector('.tooltip-content');
            let html = '';
            
            if (data.type === 'file') {
                html = `
                    <div class="tooltip-row">
                        <span class="tooltip-label">File:</span>
                        <span class="tooltip-value">${data.fileName}</span>
                    </div>
                    <div class="tooltip-row">
                        <span class="tooltip-label">Type:</span>
                        <span class="tooltip-value">${data.operationType}</span>
                    </div>
                    <div class="tooltip-row">
                        <span class="tooltip-label">Primitives:</span>
                        <span class="tooltip-value">${data.primitiveCount || 0}</span>
                    </div>
                `;
                
                if (data.hasArcs) {
                    html += `
                        <div class="tooltip-row">
                            <span class="tooltip-label">Arcs:</span>
                            <span class="tooltip-value">Yes</span>
                        </div>
                    `;
                }
                
                if (data.hasCircles) {
                    html += `
                        <div class="tooltip-row">
                            <span class="tooltip-label">Circles:</span>
                            <span class="tooltip-value">Yes</span>
                        </div>
                    `;
                }
            } else if (data.type === 'geometry') {
                html = `
                    <div class="tooltip-row">
                        <span class="tooltip-label">Type:</span>
                        <span class="tooltip-value">${data.geometryType}</span>
                    </div>
                    <div class="tooltip-row">
                        <span class="tooltip-label">Count:</span>
                        <span class="tooltip-value">${data.count || 0}</span>
                    </div>
                `;
                
                if (data.offset) {
                    html += `
                        <div class="tooltip-row">
                            <span class="tooltip-label">Offset:</span>
                            <span class="tooltip-value">${data.offset}mm</span>
                        </div>
                    `;
                }
            }
            
            content.innerHTML = html;
            
            // Position tooltip
            const rect = element.getBoundingClientRect();
            this.tooltip.style.left = rect.right + 10 + 'px';
            this.tooltip.style.top = rect.top + 'px';
            
            // Show tooltip
            this.tooltip.classList.add('visible');
        }
        
        hideTooltip() {
            this.tooltipTimeout = setTimeout(() => {
                this.tooltip.classList.remove('visible');
            }, 100);
        }
        
        setupCategories() {
            const categories = document.querySelectorAll('.operation-category');
            
            categories.forEach(category => {
                const header = category.querySelector('.category-header');
                const opType = category.dataset.opType;
                const addBtn = category.querySelector('.add-file-btn');
                
                if (header) {
                    // Toggle expand/collapse on header click
                    header.addEventListener('click', (e) => {
                        if (!e.target.closest('.add-file-btn')) {
                            this.toggleCategory(opType);
                        }
                    });
                }
                
                if (addBtn) {
                    // Handle add file button
                    addBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.ui.triggerFileInput(opType);
                    });
                }
                
                // Set initial expanded state
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
            // Expand all categories only (not files)
            document.querySelectorAll('.operation-category').forEach(cat => {
                cat.classList.add('expanded');
                const opType = cat.dataset.opType;
                if (opType) this.expandedCategories.add(opType);
            });
        }
        
        collapseAll() {
            // Collapse all categories only
            document.querySelectorAll('.operation-category').forEach(cat => {
                cat.classList.remove('expanded');
            });
            this.expandedCategories.clear();
        }
        
        // Add a new file to the tree
        addFileNode(operation) {
            const category = document.querySelector(`.operation-category[data-op-type="${operation.type}"] .category-files`);
            if (!category) {
                console.error(`Category not found for operation type: ${operation.type}`);
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
            
            label.textContent = operation.file.name;
            
            // Click handler for selection
            content.addEventListener('click', (e) => {
                if (!e.target.closest('.btn-icon')) {
                    this.selectFile(fileId, operation);
                }
            });
            
            // Hover handlers for tooltip
            content.addEventListener('mouseenter', () => {
                this.showTooltip(content, {
                    type: 'file',
                    fileName: operation.file.name,
                    operationType: operation.type,
                    primitiveCount: operation.primitives?.length || 0,
                    hasArcs: operation.geometricContext?.hasArcs,
                    hasCircles: operation.geometricContext?.hasCircles
                });
            });
            
            content.addEventListener('mouseleave', () => {
                this.hideTooltip();
            });
            
            // Settings button
            if (settingsBtn) {
                settingsBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.selectFile(fileId, operation);
                });
            }
            
            // Delete button
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.ui.removeOperation(operation.id);
                });
            }
            
            // Store node data
            this.nodes.set(fileId, {
                id: fileId,
                type: 'file',
                operation: operation,
                element: nodeElement,
                geometries: new Map()
            });
            
            category.appendChild(fileNode);
            
            // Auto-expand category
            const categoryElement = category.closest('.operation-category');
            if (categoryElement && !categoryElement.classList.contains('expanded')) {
                categoryElement.classList.add('expanded');
                this.expandedCategories.add(operation.type);
            }
            
            // Add default geometry nodes
            this.updateFileGeometries(fileId, operation);
            
            return fileId;
        }
        
        updateFileGeometries(fileId, operation) {
            const fileData = this.nodes.get(fileId);
            if (!fileData) return;
            
            const geometriesContainer = fileData.element.querySelector('.file-geometries');
            if (!geometriesContainer) return;
            
            // Clear existing
            geometriesContainer.innerHTML = '';
            fileData.geometries.clear();
            
            // Add source node
            if (operation.primitives && operation.primitives.length > 0) {
                this.addGeometryNode(fileId, 'source', 'Source', 
                    operation.primitives.length);
            }
            
            // Add fused node if fusion enabled
            if (this.ui.viewState?.fuseGeometry) {
                const fusedData = this.ui.core.getFusedPrimitives?.() || 
                                this.ui.core.geometryProcessor?.getCachedState('fusedGeometry');
                if (fusedData) {
                    this.addGeometryNode(fileId, 'fused', 'Fused', 
                        fusedData.length);
                }
            }
            
            // Add offset nodes (NEW)
            if (operation.offsets && operation.offsets.length > 0) {
                operation.offsets.forEach((offset, index) => {
                    const label = `Pass ${index + 1}`;
                    const count = offset.primitives?.length || 0;
                    this.addGeometryNode(fileId, `offset_${index}`, label, count, {
                        offset: offset.distance.toFixed(2),
                        color: '#ff0000'
                    });
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
            nodeElement.dataset.geometryType = geometryType.startsWith('offset') ? 'offset' : 
                                              geometryType.startsWith('toolpath') ? 'toolpath' : geometryType;
            
            const content = nodeElement.querySelector('.geometry-node-content');
            const iconEl = nodeElement.querySelector('.geometry-icon');
            const labelEl = nodeElement.querySelector('.geometry-label');
            const infoEl = nodeElement.querySelector('.geometry-info');
            const visBtn = nodeElement.querySelector('.visibility-btn');
            const deleteBtn = nodeElement.querySelector('.delete-geometry-btn');
            
            // Set icon based on type
            const icons = {
                'source': '📄',
                'fused': '🔀',
                'offset': '↔️',
                'toolpath': '🔧'
            };

            const baseType = geometryType.startsWith('offset') ? 'offset' :
                            geometryType.startsWith('toolpath') ? 'toolpath' :
                            geometryType;
            
            iconEl.textContent = icons[baseType] || '📊';
            
            // Color code offset nodes in red
            if (baseType === 'offset') {
                nodeElement.style.setProperty('--accent-color', '#ff0000');
            }

            iconEl.textContent = icons[nodeElement.dataset.geometryType] || '📊';
            
            labelEl.textContent = label;
            
            // Set info based on type
            if (extraData.offset) {
                infoEl.textContent = `${extraData.offset}mm`;
            } else {
                infoEl.textContent = count > 0 ? `${count}` : '';
            }
            
            // Click handler
            content.addEventListener('click', (e) => {
                if (!e.target.closest('.btn-icon')) {
                    this.selectGeometry(geometryId, fileData.operation, geometryType);
                }
            });
            
            // Hover handlers for tooltip
            content.addEventListener('mouseenter', () => {
                this.showTooltip(content, {
                    type: 'geometry',
                    geometryType: label,
                    count: count,
                    offset: extraData.offset
                });
            });
            
            content.addEventListener('mouseleave', () => {
                this.hideTooltip();
            });

            // Delete Geometry
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteGeometry(fileId, geometryId);
                });
            }
            
            // Visibility toggle
            if (visBtn) {
                visBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleGeometryVisibility(geometryId, geometryType);
                });
            }
            
            // Store geometry data
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
            // Clear previous selection
            document.querySelectorAll('.file-node-content.selected, .geometry-node.selected').forEach(el => {
                el.classList.remove('selected');
            });
            
            // Select this file
            const fileData = this.nodes.get(fileId);
            if (fileData) {
                const content = fileData.element.querySelector('.file-node-content');
                if (content) {
                    content.classList.add('selected');
                }
            }
            
            this.selectedNode = { type: 'file', id: fileId, operation };
            
            // Update property inspector
            if (this.ui.propertyInspector) {
                this.ui.propertyInspector.showOperationProperties(operation);
            }
        }
        
        selectGeometry(geometryId, operation, geometryType) {
            // Clear previous selection
            document.querySelectorAll('.file-node-content.selected, .geometry-node.selected').forEach(el => {
                el.classList.remove('selected');
            });
            
            // Find and select geometry node
            const geometryNode = document.querySelector(`.geometry-node[data-geometry-id="${geometryId}"]`);
            if (geometryNode) {
                geometryNode.classList.add('selected');
            }
            
            this.selectedNode = { type: 'geometry', id: geometryId, operation, geometryType };
            
            // Update property inspector for geometry
            if (this.ui.propertyInspector) {
                this.ui.propertyInspector.showGeometryInfo(operation, geometryType);
            }
        }

        deleteGeometry(fileId, geometryId) {
            const fileData = this.nodes.get(fileId);
            if (!fileData) return;
            
            const geoData = fileData.geometries.get(geometryId);
            if (!geoData) return;
            
            // Remove from operation.offsets if it's an offset
            if (geoData.type.startsWith('offset_')) {
                const passIndex = parseInt(geoData.type.split('_')[1]);
                if (fileData.operation.offsets) {
                    fileData.operation.offsets.splice(passIndex, 1);
                }
            }
            
            // Remove layer from renderer
            const layerName = `${geoData.type}_${fileData.operation.id}`;
            if (this.ui.renderer.layers.has(layerName)) {
                this.ui.renderer.layers.delete(layerName);
            }
            
            // Remove from UI
            geoData.element.remove();
            fileData.geometries.delete(geometryId);
            
            this.ui.renderer.render();
        }
        
        toggleGeometryVisibility(geometryId, geometryType) {
            // This should communicate with the renderer to toggle layer visibility
            const layerPrefix = geometryType.startsWith('toolpath') ? 'toolpath' : 
                              geometryType.startsWith('offset') ? 'offset' : geometryType;
            
            if (this.ui.renderer) {
                // Toggle visibility for this specific geometry
                const layers = this.ui.renderer.layers;
                layers.forEach((layer, name) => {
                    if (name.startsWith(layerPrefix)) {
                        layer.visible = !layer.visible;
                    }
                });
                this.ui.renderer.render();
            }
        }
        
        removeFileNode(operationId) {
            // Find and remove the file node
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
                
                // Clear selection if this was selected
                if (this.selectedNode?.id === nodeToRemove) {
                    this.selectedNode = null;
                    if (this.ui.propertyInspector) {
                        this.ui.propertyInspector.clearProperties();
                    }
                }
            }
        }
        
        refreshTree() {
            // Clear all file nodes
            document.querySelectorAll('.category-files').forEach(container => {
                container.innerHTML = '';
            });
            this.nodes.clear();
            this.nextNodeId = 1;
            
            // Rebuild tree from operations
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
            // Update counts for all geometry nodes
            this.nodes.forEach(fileData => {
                if (fileData.type === 'file' && fileData.operation) {
                    this.updateFileGeometries(fileData.id, fileData.operation);
                }
            });
        }
        
        _handleCategoryClick(e) {
            const category = e.currentTarget.closest('.operation-category');
            if (!category) return;
            
            const opType = category.dataset.opType;
            this.toggleCategory(opType);
        }
        
        _handleFileClick(e) {
            const fileNode = e.currentTarget.closest('.file-node');
            if (!fileNode) return;
            
            const fileId = fileNode.dataset.fileId;
            const operationId = fileNode.dataset.operationId;
            
            const operation = this.core.operations.find(op => op.id === operationId);
            if (operation) {
                this.selectFile(fileId, operation);
            }
        }
        
        _handleGeometryClick(e) {
            const geometryNode = e.currentTarget.closest('.geometry-node');
            if (!geometryNode) return;
            
            const geometryId = geometryNode.dataset.geometryId;
            const geometryType = geometryNode.dataset.geometryType;
            
            // Find parent operation
            const fileNode = geometryNode.closest('.file-node');
            if (fileNode) {
                const operationId = fileNode.dataset.operationId;
                const operation = this.core.operations.find(op => op.id === operationId);
                if (operation) {
                    this.selectGeometry(geometryId, operation, geometryType);
                }
            }
        }
    }
    
    // Export
    window.TreeManager = TreeManager;
    
})();