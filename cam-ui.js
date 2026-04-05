/*!
 * @file        cam-ui.js
 * @description Tooltip integration, status manager usage
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
    const opsConfig = D.operations;
    const storageKeys = C.storageKeys;
    const debugState = D.debug;

    class PCBCamUI {
        constructor(core, languageManager) {
            this.core = core;
            this.lang = languageManager;
            this.navTreePanel = null;
            this.operationPanel = null;
            this.toolLibrary = null;
            this.statusManager = null;
            this.controls = null;
            this.renderer = null;
            this.coordinateSystem = null;
            this.canvasExporter = null; 
            this.stats = {
                files: 0,
                operations: 0,
                primitives: 0,
                processingTime: 0
            };
            this._updatePending = false;
            this._updateQueued = false;
            this._eventHandlersAttached = false;
        }

        async init(parameterManager) {
            try {
                // Initialize tool library
                if (typeof ToolLibrary !== 'undefined') {
                    this.toolLibrary = new ToolLibrary();
                    await this.toolLibrary.init();
                    if (this.core.setToolLibrary) {
                        this.core.setToolLibrary(this.toolLibrary);
                    }
                }

                // Initialize UI components
                if (typeof NavTreePanel !== 'undefined') {
                    this.navTreePanel = new NavTreePanel(this);
                    this.navTreePanel.init();
                }

                if (typeof OperationPanel !== 'undefined') {
                    this.operationPanel = new OperationPanel(this);
                    this.operationPanel.init(this.toolLibrary, parameterManager);
                }

                if (typeof StatusManager !== 'undefined') {
                    this.statusManager = new StatusManager(this);
                }

                this.initializeRenderer();

                if (typeof UIControls !== 'undefined') {
                    this.controls = new UIControls(this);
                    this.controls.init(this.renderer, this.coordinateSystem);
                }

                this.initializeTheme();

                this.debug('PCBCamUI initialized');

                return true;

            } catch (error) {
                console.error('UI initialization failed:', error);
                this.updateStatus('Initialization error: ' + error.message, 'error');
                return false;
            }
        }

        initializeRenderer() {
            const canvas = document.getElementById('preview-canvas');
            if (!canvas) {
                console.warn('Preview canvas not found');
                return;
            }

            if (typeof LayerRenderer !== 'undefined') {
                this.renderer = new LayerRenderer('preview-canvas', this.core);

                if (typeof CoordinateSystemManager !== 'undefined') {
                    this.coordinateSystem = new CoordinateSystemManager({ 
                        debug: debugState.enabled 
                    });
                    this.core.coordinateSystem = this.coordinateSystem;

                    // The UI listens for changes from the coordinate system
                    this.coordinateSystem.addChangeListener((status) => {
                        // When a change happens, the UI tells the renderer
                        if (this.renderer) {
                            this.renderer.core.setOriginPosition(status.currentPosition.x, status.currentPosition.y);
                            this.renderer.core.setRotation(status.currentRotation, status.rotationCenter);
                            // Use board center (from status.mirrorCenter) for mirroring
                            this.renderer.core.setMirror(status.mirrorX, status.mirrorY, status.mirrorCenter);
                            this.renderer.render();
                        }

                        if (debugState.enabled && (status.action === 'setMirrorX' || status.action === 'setMirrorY')) {
                            console.log(`[cam-ui] Mirror state updated: X=${status.mirrorX}, Y=${status.mirrorY}`);
                        }
                    });
                }

                if (typeof CanvasExporter !== 'undefined') {
                    this.canvasExporter = new CanvasExporter(this.renderer);
                }

                const renderingOptions = D.rendering.defaultOptions;
                this.renderer.setOptions({
                    showWireframe: renderingOptions.showWireframe,
                    showGrid: renderingOptions.showGrid,
                    showOrigin: renderingOptions.showOrigin,
                    showRulers: renderingOptions.showRulers,
                    fuseGeometry: renderingOptions.fuseGeometry,
                    blackAndWhite: renderingOptions.blackAndWhite,
                    debugPoints: renderingOptions.debugPoints,
                    debugArcs: renderingOptions.debugArcs,
                    theme: document.documentElement.getAttribute('data-theme')
                });

                if (window.ResizeObserver) {
                    const resizeObserver = new ResizeObserver(() => {
                        this.renderer.core.resizeCanvas();
                        this.renderer.render();
                    });
                    resizeObserver.observe(canvas.parentElement);
                }

                this.renderer.render();
            }
            
            // Firefox workaround: prevent canvas auto-focus on load
            if (canvas) {
                canvas.blur();
                document.body.focus();
            }

            // Global keyboard trap: block all input while loading overlay is visible
            const loadingOverlay = document.getElementById('loading-overlay');
            if (loadingOverlay) {
                loadingOverlay.addEventListener('keydown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                }, true);
            }
        }

        initializeTheme() {
            const key = storageKeys.theme;
            const savedTheme = localStorage.getItem(key);
            document.documentElement.setAttribute('data-theme', savedTheme);

            if (this.renderer) {
                this.renderer.setOptions({ theme: savedTheme });
            }
        }

        async updateRendererAsync() {
            if (this._updatePending) {
                this._updateQueued = true;
                return;
            }

            this._updatePending = true;

            try {
                this.renderer.clearLayers();

                if (this.renderer.options.fuseGeometry) {
                    await this.performFusion();
                } else {
                    this.addIndividualLayers();
                }

                this.addOffsetLayers();

                this.renderer.render();
                this.updateOriginDisplay();
                this.updateStatistics();
            } finally {
                this._updatePending = false;
                
                if (this._updateQueued) {
                    this._updateQueued = false;
                    setTimeout(() => this.updateRendererAsync(), 50);
                }
            }
        }

        async performFusion() {
            if (this.core.geometryProcessor) {
                this.core.geometryProcessor.clearProcessorCache();
            }

            const fusionOptions = {
                enableArcReconstruction: this.renderer.options.enableArcReconstruction
            };

            this.debug('performFusion() - Starting. Options:', fusionOptions);

            try {
                const fused = await this.core.fuseAllPrimitives(fusionOptions);
                if (this.renderer.options.enableArcReconstruction && this.core.geometryProcessor) {
                    const arcStats = this.core.geometryProcessor.getArcReconstructionStats();
                    if (this.controls && this.controls.updateArcReconstructionStats) {
                        this.controls.updateArcReconstructionStats(arcStats);
                    }
                }
                if (this.renderer.options.showPreprocessed) {
                    this.addPreprocessedLayer();
                } else {
                    this.addFusedLayer(fused);
                }

                this.addNonFusableLayers();

            } catch (error) {
                console.error('Fusion error:', error);
                this.updateStatus('Fusion failed: ' + error.message, 'error');
                this.addIndividualLayers();
            }
        }

        addPreprocessedLayer() {
            const allPreprocessed = this.core.getPreprocessedPrimitives();
            if (!allPreprocessed || allPreprocessed.length === 0) return;

            const byOperation = new Map();
            allPreprocessed.forEach(p => {
                const opId = p.properties?.operationId || p._originalOperationId;
                if (opId) {
                    if (!byOperation.has(opId)) byOperation.set(opId, []);
                    byOperation.get(opId).push(p);
                }
            });

            byOperation.forEach((primitives, opId) => {
                const operation = this.core.operations.find(op => op.id === opId);
                if (operation) {
                    this.renderer.addLayer(`preprocessed_${opId}`, primitives, {
                        type: operation.type,
                        visible: true,
                        color: operation.color,
                        isPreprocessed: true
                    });
                }
            });
        }

        addFusedLayer(fused) {
            if (!fused || fused.length === 0) return;

            const byOperation = new Map();
            fused.forEach(p => {
                const opId = p.properties?.sourceOperationId;
                if (opId) {
                    if (!byOperation.has(opId)) byOperation.set(opId, []);
                    byOperation.get(opId).push(p);
                }
            });

            byOperation.forEach((primitives, opId) => {
                const operation = this.core.operations.find(op => op.id === opId);
                if (operation) {
                    this.renderer.addLayer(`fused_${opId}`, primitives, {
                        type: operation.type,
                        visible: true,
                        isFused: true,
                        color: operation.color || (opsConfig[operation.type] && opsConfig[operation.type].color)
                    });
                }
            });
        }

        addNonFusableLayers() {
            this.core.operations.forEach(operation => {
                if (operation.type === 'drill' || operation.type === 'cutout' || operation.type === 'stencil') {
                    if (operation.primitives && operation.primitives.length > 0) {
                        const hasOffsets = operation.type === 'stencil' && operation.offsets && operation.offsets.length > 0;

                        this.renderer.addLayer('source_' + operation.id, operation.primitives, {
                            type: operation.type,
                            visible: !hasOffsets, // Simplified boolean flip
                            color: operation.color || (opsConfig[operation.type] && opsConfig[operation.type].color)
                        });
                    }
                }
            });
        }

        addIndividualLayers() {
            this.core.operations.forEach(operation => {
                if (operation.primitives && operation.primitives.length > 0) {
                    // Apply the same logic here so it works when Fusion Mode is OFF
                    const hasOffsets = operation.type === 'stencil' && operation.offsets && operation.offsets.length > 0;

                    this.renderer.addLayer('source_' + operation.id, operation.primitives, {
                        type: operation.type,
                        visible: !hasOffsets,
                        color: operation.color || (opsConfig[operation.type] && opsConfig[operation.type].color)
                    });
                }
            });
        }

        addOffsetLayers() {
            this.core.operations.forEach(operation => {
                if (operation.offsets && operation.offsets.length > 0) {
                    const isLaser = window.pcbcam?.isLaserPipeline?.() || false;
                    const isCombined = operation.offsets[0]?.metadata?.offset?.combined || isLaser;
                    const hasPreview = !isLaser && operation.preview && operation.preview.primitives && operation.preview.primitives.length > 0;

                    if (isCombined) {
                        // Flatten all passes into one canvas layer for combined visualization
                        const allPrimitives = operation.offsets.flatMap(o => o.primitives || []);
                        if (allPrimitives.length > 0) {
                            let offsetType = 'external';
                            if (operation.offsets[0].distance < 0) offsetType = 'internal';
                            else if (operation.offsets[0].distance === 0) offsetType = 'on';

                            const isHatch = operation.offsets[0].metadata?.isHatch === true;

                            this.renderer.addLayer(`offset_${operation.id}_combined`, allPrimitives, {
                                type: 'offset',
                                visible: hasPreview ? false : this.renderer.options.showOffsets,
                                operationId: operation.id,
                                operationType: operation.type,
                                offsetType: offsetType,
                                pass: 1,
                                distance: operation.offsets[0].distance,
                                combined: true,
                                metadata: operation.offsets[0].metadata,
                                isHatch: isHatch
                            });
                        }
                    } else {
                        // Individual pass layers
                        operation.offsets.forEach((offset, passIndex) => {
                            if (offset.primitives && offset.primitives.length > 0) {
                                let offsetType;
                                if (offset.distance > 0) offsetType = 'external';
                                else if (offset.distance < 0) offsetType = 'internal';
                                else offsetType = 'on';

                                const isHatch = offset.metadata?.isHatch === true;

                                this.renderer.addLayer(
                                    `offset_${operation.id}_pass_${passIndex + 1}`,
                                    offset.primitives,
                                    {
                                        type: 'offset',
                                        visible: hasPreview ? false : this.renderer.options.showOffsets,
                                        operationId: operation.id,
                                        operationType: operation.type,
                                        offsetType: offsetType,
                                        pass: offset.pass,
                                        distance: offset.distance,
                                        combined: false,
                                        metadata: offset.metadata,
                                        isHatch: isHatch
                                    }
                                );
                            }
                        });
                    }
                }

                // Preview layer
                if (operation.preview && operation.preview.primitives && operation.preview.primitives.length > 0) {
                    this.renderer.addLayer(
                        `preview_${operation.id}`,
                        operation.preview.primitives,
                        {
                            type: 'preview',
                            visible: this.renderer.options.showPreviews,
                            operationId: operation.id,
                            operationType: operation.type,
                            isPreview: true,
                            metadata: operation.preview.metadata
                        }
                    );
                }
            });
        }

        updateOriginDisplay() {
            const status = this.coordinateSystem.getStatus();
            const sizeElement = document.getElementById('board-size');
            if (sizeElement && status.boardSize) {
                sizeElement.textContent = status.boardSize.width.toFixed(1) + ' × ' + status.boardSize.height.toFixed(1) + ' mm';
            }

            if (this.controls && this.controls.updateOffsetInputsWithTracking) {
                this.controls.updateOffsetInputsWithTracking();
            }
        }

        updateStatistics() {
            const stats = this.core.getStats();

            const filesStat = document.getElementById('stat-files');
            if (filesStat) {
                const fileSet = new Set(this.core.operations.map(op => op.file.name));
                filesStat.textContent = fileSet.size;
            }

            const opsStat = document.getElementById('stat-operations');
            if (opsStat) {
                opsStat.textContent = stats.operations;
            }

            const primStat = document.getElementById('stat-primitives');
            if (primStat) {
                primStat.textContent = stats.totalPrimitives;
            }
        }

        toggleGrid() {
            const currentState = this.renderer.core.options.showGrid;
            this.renderer.core.setOptions({ showGrid: !currentState });
            this.renderer.render();
        }

        async processFile(file, type) {
            if (!file || !type) return;
            // Pass through to the main controller
            return window.pcbcam.processFile(file, type);
        }

        showFileModal() {
            if (window.pcbcam && window.pcbcam.showFileModal) {
                window.pcbcam.showFileModal();
            }
        }

        async exportCanvasSVG() {
            try {
                this.canvasExporter.exportCanvasSVG(); 
                this.updateStatus('Canvas exported successfully', 'success');
            } catch (error) {
                console.error('Canvas export error:', error);
                this.updateStatus('Canvas export failed: ' + error.message, 'error');
            }
        }

        async exportGCode() {
            this.updateStatus('G-code export not yet implemented', 'warning');
        }

        removeOperation(operationId) {
            if (this.core.removeOperation(operationId)) {
                if (this.navTreePanel) {
                    this.navTreePanel.removeFileNode(operationId);
                }

                // Refresh the property panel to catch cross-operation constraints
                if (this.operationPanel && this.operationPanel.currentOperation) {
                    // Only refresh if the deleted operation wasn't the one selected
                    if (this.operationPanel.currentOperation.id !== operationId) {
                        this.operationPanel.showOperationProperties(
                            this.operationPanel.currentOperation,
                            this.operationPanel.currentGeometryStage
                        );
                    }
                }

                this.updateRendererAsync();
                this.updateStatistics();

                this.updateStatus('Operation removed', 'info');
            }
        }

        /**
         * Handles the consequences of a selection in the NavTreePanel.
         */
        handleOperationSelection(operation, stage) {
            // Collapse the right sidebar controls to make room
            if (this.controls && this.controls.collapseRightSidebar) {
                this.controls.collapseRightSidebar();
            }

            // Tell the OperationPanel to show the properties
            if (this.operationPanel) {
                this.operationPanel.showOperationProperties(operation, stage);
            }
        }

        /**
         * Orchestrates the deletion of a geometry subgroup.
         */
        handleDeleteGeometry(fileId, fileData, geometryId, geoData) {
            if (!fileData || !geoData) return;

            // Determine the layer to be deleted
            let layerName;
            const operation = fileData.operation;

            if (geoData.type === 'offsets_combined') {
                layerName = `offset_${operation.id}_combined`;
                if (operation.offsets) {
                    operation.offsets = []; // Clear all offsets
                }
            } else if (geoData.type.startsWith('offset_')) {
                const passIndex = parseInt(geoData.type.split('_')[1]); // e.g., "offset_0" -> 0
                const passNumber = passIndex + 1;
                layerName = `offset_${operation.id}_pass_${passNumber}`;
                if (operation.offsets) {
                    operation.offsets.splice(passIndex, 1);
                }
            } else {
                layerName = `${geoData.type}_${operation.id}`;

                if (geoData.type === 'preview' && operation.preview) {
                    operation.preview = null;

                    // Auto-unhide offsets when CNC preview is deleted
                    if (operation.offsets && operation.offsets.length > 0) {
                        const isLaser = window.pcbcam?.isLaserPipeline?.() || false;
                        const isCombined = operation.offsets[0]?.metadata?.offset?.combined || isLaser;

                        // Unhide the specific offset layer(s) in the Renderer
                        if (isCombined) {
                            const offsetLayerName = `offset_${operation.id}_combined`;
                            if (this.renderer.layers.has(offsetLayerName)) {
                                this.renderer.layers.get(offsetLayerName).visible = true;
                            }
                        } else {
                            operation.offsets.forEach((_, passIndex) => {
                                const offsetLayerName = `offset_${operation.id}_pass_${passIndex + 1}`;
                                if (this.renderer.layers.has(offsetLayerName)) {
                                    this.renderer.layers.get(offsetLayerName).visible = true;
                                }
                            });
                        }

                        // Unhide the eye icons in the Nav Tree UI
                        if (this.navTreePanel) {
                            const fileNode = this.navTreePanel.nodes.get(fileId);
                            if (fileNode) {
                                fileNode.geometries.forEach((geo) => {
                                    if (geo.type.startsWith('offset')) {
                                        const visBtn = geo.element.querySelector('.visibility-btn');
                                        if (visBtn) visBtn.classList.remove('is-hidden');
                                    }
                                });
                            }
                        }
                    }
                }
            }

            // Restore stencil source visibility if all offsets are deleted
            if (operation.type === 'stencil' && (!operation.offsets || operation.offsets.length === 0)) {
                const sourceLayerName = `source_${operation.id}`;
                if (this.renderer.layers.has(sourceLayerName)) {
                    this.renderer.layers.get(sourceLayerName).visible = true;
                }
                if (this.navTreePanel) {
                    const fileNode = this.navTreePanel.nodes.get(fileId);
                    const visBtn = fileNode?.element.querySelector('.file-node-content .visibility-btn');
                    if (visBtn) visBtn.classList.remove('is-hidden');
                }
            }

            // Tell the renderer to delete the layer
            if (layerName && this.renderer.layers.has(layerName)) {
                this.renderer.layers.delete(layerName);
            } else {
                console.warn(`[PCBCamUI] Could not find layer to delete: ${layerName}`);
            }

            // Tell the NavTreePanel to remove the DOM node
            if (this.navTreePanel) {
                this.navTreePanel.removeGeometryNode(fileId, geometryId);

                // Re-select the parent file node
                this.navTreePanel.selectHighestStage(fileId);
            }

            // Re-draw the canvas
            this.renderer.render();
        }

        updateStatus(message, type) {
            if (!type) type = 'normal';
            
            if (this.statusManager) {
                this.statusManager.updateStatus(message, type);
            } else {
                console.error("StatusManager not initialized, cannot show status!");
            }
        }

        showStatus(message, type) {
            if (this.statusManager) {
                this.statusManager.showStatus(message, type);
            }
        }

        triggerFileInput(opType) {
            const fileInput = document.getElementById('file-input-hidden') || document.getElementById('file-input-temp');
            if (fileInput) {
                fileInput.setAttribute('data-type', opType);

                const opConfig = opsConfig[opType];
                if (opConfig) {
                    const extensions = opConfig.extensions ? opConfig.extensions.slice() : [];
                    if (extensions.indexOf('.svg') === -1) {
                        extensions.push('.svg');
                    }
                    fileInput.setAttribute('accept', extensions.join(','));
                }

                fileInput.onchange = async (e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) {
                        for (const file of files) {
                            await this.processFile(file, opType);
                        }
                        this.renderer.core.zoomFit(true);
                        this.renderer.render();
                        this.renderer.interactionHandler.updateZoomDisplay();
                    }
                    fileInput.value = '';
                };

                fileInput.click();
            } else {
                console.warn('No file input element found');
            }
        }

        showCanvasSpinner(message = 'Processing...') {
            const overlay = document.getElementById('canvas-loading-overlay');
            const msgEl = document.getElementById('canvas-loading-message');

            if (msgEl) {
                msgEl.textContent = message;
            }
            if (overlay) {
                overlay.classList.remove('hidden');
            }
        }

        hideCanvasSpinner() {
            const overlay = document.getElementById('canvas-loading-overlay');
            if (overlay) {
                overlay.classList.add('hidden');
            }
        }

        /**
         * The central "proxy" logger for all UI modules.
         */
        debug(message, data = null) {
            // This is now the only place that checks this flag // Review - this sounds unnecessarily complicated and will cause multiple cross-module requests for no reason? Does that matter?
            if (!debugState.enabled) {
                return;
            }

            // Log to the developer console
            if (data) {
                console.log(message, data);
            } else {
                console.log(message);
            }

            // Send to the StatusManager's UI log
            // (Note: this logs the raw message, StatusManager must add its own prefix/timestamp)
            if (this.statusManager && this.statusManager.debugLog) {
                let statusMsg = message;
                if (data) {
                    try {
                        // Attempt to stringify simple data for the log
                        statusMsg += ` ${JSON.stringify(data)}`;
                    } catch (e) {
                        statusMsg += " [Object]"; // Fallback for complex data
                    }
                }
                this.statusManager.debugLog(statusMsg);
            }
        }
    }

    window.PCBCamUI = PCBCamUI;
})();