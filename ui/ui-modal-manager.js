/**
 * @file        ui/ui-modal-manager.js
 * @description Unified modal management
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
    const textConfig = config.ui.text || {};
    const iconConfig = config.ui.icons || {};
    const storageKeys = config.storageKeys || {};
    
    class ModalManager {
        constructor(controller) {
            this.controller = controller;
            this.ui = controller.ui;
            this.lang = this.ui.lang;
            this.activeModal = null;
            this.modalStack = [];
            
            // Modal references
            this.modals = {
                welcome: document.getElementById('welcome-modal'),
                file: document.getElementById('file-modal'),
                gcode: document.getElementById('gcode-export-modal')
            };
            
            // Toolpath-specific state
            this.selectedOperations = [];
            this.highlightedOpId = null;
            this.toolpathPlans = new Map();
            
            this.init();
        }
        
        init() {
            // Setup ESC key handler
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.activeModal) {
                    this.closeModal();
                }
            });
            
            // Setup click-outside-to-close
            Object.values(this.modals).forEach(modal => {
                if (modal) {
                    modal.addEventListener('click', (e) => {
                        if (e.target === modal) {
                            this.closeModal();
                        }
                    });
                }
            });
        }
        
        showPlaceholderPreview() {
            const previewText = document.getElementById('gcode-preview-text');
            if (previewText) {
                previewText.value = textConfig.gcodePlaceholder;
            }
            
            // Reset stats
            document.getElementById('gcode-line-count').textContent = '0';
            const opCountEl = document.getElementById('gcode-op-count');
            if(opCountEl) opCountEl.textContent = this.selectedOperations.length;
            document.getElementById('gcode-est-time').textContent = '--:--';
            document.getElementById('gcode-distance').textContent = '0mm';
        }
        
        // Generic modal methods
        showModal(modalName, options = {}) {
            const modal = this.modals[modalName];
            if (!modal) {
                console.error(`[UI-ModalManager] Modal - '${modalName}' - not found`);
                return;
            }
            
            // Close current modal if exists
            if (this.activeModal) {
                this.modalStack.push(this.activeModal);
                this.activeModal.classList.remove('active');
            }
            
            this.activeModal = modal;
            modal.classList.add('active');
            
            // Call specific show handler
            const handler = `show${modalName.charAt(0).toUpperCase() + modalName.slice(1)}Handler`;
            if (this[handler]) {
                this[handler](options);
            }
        }
        
        closeModal() {
            if (!this.activeModal) return;
            
            this.activeModal.classList.remove('active');
            
            // Check for stacked modals
            if (this.modalStack.length > 0) {
                this.activeModal = this.modalStack.pop();
                this.activeModal.classList.add('active');
            } else {
                this.activeModal = null;
            }
        }
        
        // Welcome modal handler
        showWelcomeHandler(options) {
            const modal = this.modals.welcome;
            
            // Setup example dropdown
            const select = document.getElementById('pcb-example-select');
            if (select && options.examples) {
                select.innerHTML = '';
                Object.entries(options.examples).forEach(([key, example]) => {
                    const option = document.createElement('option');
                    option.value = key;
                    option.textContent = example.name;
                    select.appendChild(option);
                });
            }
            
            // Setup buttons
            const loadExampleBtn = document.getElementById('load-example-btn');
            if (loadExampleBtn) {
                loadExampleBtn.onclick = async () => {
                    const selectedExample = select?.value;
                    if (selectedExample && this.controller.loadExample) {
                        await this.controller.loadExample(selectedExample);
                    }
                    this.handleWelcomeClose();
                };
            }
            
            const openFilesBtn = document.getElementById('open-files-btn');
            if (openFilesBtn) {
                openFilesBtn.onclick = () => {
                    // Don't close the welcome modal, just show 'file' on top of it. showModal() will handle the stack.
                    this.showModal('file'); 
                    
                    // We still want to handle the "don't show again" checkbox
                    const dontShowCheckbox = document.getElementById('dont-show-welcome');
                    const key = storageKeys.hideWelcome || 'pcbcam-hide-welcome';
                    if (dontShowCheckbox?.checked) {
                        localStorage.setItem(key, 'true');
                    }
                };
            }
            
            const startEmptyBtn = document.getElementById('start-empty-btn');
            if (startEmptyBtn) {
                startEmptyBtn.onclick = () => {
                    this.handleWelcomeClose();
                    if (this.controller.ensureCoordinateSystem) {
                        this.controller.ensureCoordinateSystem();
                    }
                };
            }
            
            const closeBtn = modal.querySelector('.modal-close');
            if (closeBtn) {
                closeBtn.onclick = () => {
                    this.handleWelcomeClose();
                };
            }
        }
        
        handleWelcomeClose() {
            const dontShowCheckbox = document.getElementById('dont-show-welcome');
            const key = storageKeys.hideWelcome || 'pcbcam-hide-welcome';
            if (dontShowCheckbox?.checked) {
                localStorage.setItem(key, 'true');
            }
            this.closeModal();
            if (this.controller.ensureCoordinateSystem) {
                this.controller.ensureCoordinateSystem();
            }
        }
        
        // File modal handler
        showFileHandler(options) {
            this.controller.uploadedFiles = {
                isolation: null,
                drill: null,
                clear: null,
                cutout: null
            };
            
            // Setup drop zones
            ['isolation', 'drill', 'clear', 'cutout'].forEach(type => {
                this.setupDropZone(type);
            });
            
            // Process button
            const processBtn = document.getElementById('process-files-btn');
            if (processBtn) {
                processBtn.disabled = true;
                processBtn.onclick = async () => {
                    await this.controller.processUploadedFiles();
                    this.modalStack = []; // Clear the modal stack completely
                    this.closeModal();    // Now this will close the file modal and not reopen the welcome modal
                };
            }
            
            // Back button
            const backBtn = document.getElementById('back-files-btn');
            if (backBtn) {
                backBtn.onclick = () => {
                    this.closeModal();
                    this.controller.uploadedFiles = {};
                };
            }
            
            // Close button
            const closeBtn = this.modals.file.querySelector('.modal-close');
            if (closeBtn) {
                closeBtn.onclick = () => {
                    this.closeModal();
                    this.controller.uploadedFiles = {};
                };
            }
        }
        
        setupDropZone(opType) {
            const dropZone = document.getElementById(`${opType}-drop-zone`);
            const fileInput = document.getElementById(`${opType}-file`);
            const status = document.getElementById(`${opType}-status`);
            
            if (!dropZone || !fileInput) return;
            
            // Click to browse
            dropZone.addEventListener('click', () => fileInput.click());
            
            // File input change
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    this.handleFileForOperation(file, opType);
                }
            });
            
            // Drag events
            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.classList.add('dragging');
            });
            
            dropZone.addEventListener('dragleave', () => {
                dropZone.classList.remove('dragging');
            });
            
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('dragging');
                const files = Array.from(e.dataTransfer.files);
                if (files.length > 0) {
                    this.handleFileForOperation(files[0], opType);
                }
            });
            
            // Clear status
            if (status) {
                status.textContent = '';
                status.className = 'zone-status';
            }
        }
        
        handleFileForOperation(file, opType) {
            const validation = this.controller.core?.validateFileType(file.name, opType);
            if (validation && !validation.valid) {
                const status = document.getElementById(`${opType}-status`);
                if (status) {
                    status.textContent = validation.message;
                    status.className = 'zone-status error';
                }
                return;
            }
            
            this.controller.uploadedFiles[opType] = file;
            
            const status = document.getElementById(`${opType}-status`);
            if (status) {
                status.textContent = `✓ ${file.name}`;
                status.className = 'zone-status success';
            }
            
            this.updateProcessButton();
        }
        
        updateProcessButton() {
            const processBtn = document.getElementById('process-files-btn');
            if (processBtn) {
                const hasFiles = Object.values(this.controller.uploadedFiles).some(f => f !== null);
                processBtn.disabled = !hasFiles;
            }
        }
        
        // Toolpath modal handler
        showToolpathModal(operations, highlightOperationId = null) {
            this.debug(`Opening toolpath manager with ${operations.length} operation(s)`);
            
            // Store operations
            this.selectedOperations = operations;
            this.highlightedOpId = highlightOperationId;
            this.toolpathPlans.clear();

            this.attachGcodeModalTooltips();

            // 1. Get the modal's dropdown
            const modalPostSelect = document.getElementById('gcode-post-processor');
            
            // 2. Get the *current* setting from the core
            const currentPost = this.controller.core?.getSetting('gcode', 'postProcessor') || 'grbl';

            if (modalPostSelect) {
                // 3. Populate it (if it's empty)
                if (modalPostSelect.options.length === 0) {
                    const options = config.ui?.parameterOptions?.postProcessor || [{ value: 'grbl', label: 'GRBL (Default)' }];
                    options.forEach(opt => {
                        const optionEl = document.createElement('option');
                        optionEl.value = opt.value;
                        optionEl.textContent = opt.label;
                        modalPostSelect.appendChild(optionEl);
                    });
                }
                
                // 4. Set its value to match the core setting
                modalPostSelect.value = currentPost;
            }
            
            // Set corresponding file extension
            const filenameInput = document.getElementById('gcode-filename');
            if (filenameInput && this.controller.gcodeGenerator) {
                // Get the info for the currently selected processor
                const processorInfo = this.controller.gcodeGenerator.getProcessorInfo(currentPost);
                if (processorInfo) {
                    const currentFilename = filenameInput.value;
                    const newFilename = currentFilename.replace(/\.[^.]+$/, processorInfo.fileExtension);
                    filenameInput.value = newFilename;
                }
            }
            
            this.showModal('gcode');
            
            // Update modal title
            const modal = this.modals.gcode;
            const header = modal.querySelector('.modal-header h2');
            if (header) header.textContent = 'Operations Manager';
            
            this.populateToolpathModal();
            
            this.showPlaceholderPreview(); // Only shows tool reach simulated stroked paths.
            
            this.setupToolpathHandlers();
        }

        attachGcodeModalTooltips() {
            if (!this.lang || !window.TooltipManager) return;

            // Manage Modal box
            if (!this.gcodeModalTooltipsProcessed) {
                this.gcodeModalTooltipsProcessed = new Set();
            }
            const processedLabels = this.gcodeModalTooltipsProcessed;
            
            const attachTo = (inputId, tooltipKey) => {
                const input = document.getElementById(inputId);
                if (!input) return;

                const label = input.closest('.property-field, .field-group')?.querySelector('label');
                if (label) {
                    // Check if modal already has tooltips
                    if (processedLabels.has(label)) {
                        return; // Already attached
                    }
                    processedLabels.add(label);

                    const text = this.lang.get(tooltipKey);
                    const title = label.textContent; // Just use the label text as title
                    
                    if (text) {
                        // This will create the '?' icon
                        window.TooltipManager.attachWithIcon(label, { title: title, text: text }, {
                            showOnFocus: true
                        });
                    }
                }
            };
            
            // Find the "Processing Order" <h3> and attach a tooltip to its help text
            const orderHelp = document.querySelector('#gcode-operation-order + .help-text');
            if (orderHelp) {
                 const text = this.lang.get('tooltips.modals.gcode.order');
                 if (text) {
                    window.TooltipManager.attach(orderHelp, { title: "Processing Order", text: text }, { immediate: true });
                    orderHelp.classList.add('has-help');
                 }
            }

            // Attach to checkboxes and inputs
            attachTo('gcode-post-processor', 'tooltips.modals.gcode.postProcessor');
            attachTo('gcode-single-file', 'tooltips.modals.gcode.singleFile');
            attachTo('gcode-include-comments', 'tooltips.modals.gcode.includeComments');
            attachTo('gcode-tool-changes', 'tooltips.modals.gcode.toolChanges');
            attachTo('gcode-optimize-paths', 'tooltips.modals.gcode.optimize');
            attachTo('gcode-filename', 'tooltips.modals.gcode.filename');
            
            // Attach to calculate button
            const calcBtn = document.getElementById('gcode-calculate-btn');
            if (calcBtn) {
                 const text = this.lang.get('tooltips.modals.gcode.calculate');
                 if (text) {
                    window.TooltipManager.attach(calcBtn, { title: "Calculate Toolpaths", text: text }, { immediate: true });
                 }
            }
        }
        
        populateToolpathModal() {
            const list = document.getElementById('gcode-operation-order');
            if (!list) {
                console.error('[UI-ModalManager] #gcode-operation-order list not found!');
                return;
            }
            
            list.innerHTML = '';
            
            for (const op of this.selectedOperations) {
                const item = this.createOperationItem(op);
                list.appendChild(item);
            }
            
            // Make the correct list sortable
            this.makeSortable(list);

            // Clear the *other* list (gcode-operation-list) in case it had old content
            const checklist = document.getElementById('gcode-operation-list');
            if (checklist) {
                checklist.innerHTML = ''; // This list is not used by this function
            }

            // Initialize checkbox state from config
            const optimizeCheckbox = document.getElementById('gcode-optimize-paths');
            if (optimizeCheckbox && config.gcode) {
                // Use the master switch 'enableOptimization'
                optimizeCheckbox.checked = config.gcode.enableOptimization || false;
            }
        }
        
        createOperationItem(operation) {
            const item = document.createElement('div');
            item.className = 'file-node-content'; // Was 'operation-item'
            item.style.marginBottom = 'var(--spacing-xs)';
            item.style.cursor = 'grab'; // Cue for dragging
            item.dataset.operationId = operation.id;
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = true;
            checkbox.id = `op-check-${operation.id}`;
            checkbox.style.margin = '0 var(--spacing-sm) 0 0'; // Add some spacing

            const dragHandle = document.createElement('span');
            dragHandle.className = 'tree-expand-icon'; // Was 'drag-handle'
            dragHandle.innerHTML = iconConfig.modalDragHandle;
            dragHandle.style.cursor = 'grab';
            dragHandle.style.marginRight = 'var(--spacing-sm)';

            const label = document.createElement('label');
            label.htmlFor = checkbox.id;
            label.className = 'file-label'; // Was part of the item
            label.textContent = `${operation.type}: ${operation.file.name}`;
            label.style.cursor = 'grab';
            label.style.flex = '1'; // Ensure it takes up space

            // Clear default field children and rebuild
            item.innerHTML = ''; 
            item.appendChild(dragHandle);
            item.appendChild(checkbox);
            item.appendChild(label);
            
            // Show key parameters
            const params = document.createElement('div');
            params.className = 'geometry-info'; // Was 'operation-params'
            params.style.fontSize = 'var(--font-size-xs)';
            params.style.color = 'var(--color-text-hint)';
            params.style.fontFamily = 'var(--font-mono)';

            const tool = operation.settings.tool?.diameter;
            const depth = operation.settings.cutDepth;
            const feed = operation.settings.feedRate;
            
            params.innerHTML = `
                T: ${tool}mm | Z: ${depth}mm | F: ${feed}
            `;
            item.appendChild(params);
            
            return item;
        }
        
        makeSortable(container) {
            let draggedItem = null;

            container.addEventListener('dragstart', (e) => {
                // Check if the target or its parent is the draggable item
                const targetItem = e.target.closest('.file-node-content');
                if (targetItem && container.contains(targetItem)) {
                    draggedItem = targetItem;
                    draggedItem.classList.add('dragging');
                    e.dataTransfer.effectAllowed = 'move';
                }
            });

            container.addEventListener('dragend', () => {
                if (draggedItem) {
                    draggedItem.classList.remove('dragging');
                    draggedItem = null;
                }
            });

            container.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (!draggedItem) return;
                
                const afterElement = this.getDragAfterElement(container, e.clientY);
                if (afterElement == null) {
                    container.appendChild(draggedItem);
                } else {
                    container.insertBefore(draggedItem, afterElement);
                }
            });

            // Make items draggable
            container.querySelectorAll('.file-node-content').forEach(item => {
                item.draggable = true;
            });
        }
        
        getDragAfterElement(container, y) {
            const draggableElements = [...container.querySelectorAll('.file-node-content:not(.dragging)')];
            
            return draggableElements.reduce((closest, child) => {
                const box = child.getBoundingClientRect();
                const offset = y - box.top - box.height / 2;
                
                if (offset < 0 && offset > closest.offset) {
                    return { offset: offset, element: child };
                } else {
                    return closest;
                }
            }, { offset: Number.NEGATIVE_INFINITY }).element;
        }
        
        async runToolpathOrchestration(btn) {
            // 1. Show loading state
            const originalText = btn.textContent;
            btn.textContent = 'Calculating...';
            btn.disabled = true;

            try {
                // 2. Find the correct list and items
                const list = document.getElementById('gcode-operation-order');
                if (!list) {
                    console.error("[UI-ModalManager] Could not find list 'gcode-operation-order'");
                    this.showPlaceholderPreview();
                    return;
                }

                const selectedItemIds = [];
                list.querySelectorAll('.file-node-content').forEach(item => {
                    const checkbox = item.querySelector('input[type="checkbox"]');
                    if (checkbox?.checked) {
                        selectedItemIds.push(item.dataset.operationId);
                    }
                });

                if (selectedItemIds.length === 0) {
                    this.showPlaceholderPreview();
                    this.ui?.statusManager?.showStatus('No operations selected', 'info');
                    return;
                }

                // 3. Validate operations
                const selectedOps = selectedItemIds
                    .map(id => this.selectedOperations.find(o => o.id === id))
                    .filter(Boolean);

                const opsWithoutPreview = selectedOps.filter(op => !op.preview || !op.preview.ready);
                if (opsWithoutPreview.length > 0) {
                    this.showPlaceholderPreview();
                    const names = opsWithoutPreview.map(o => o.file.name).join(', ');
                    this.ui?.statusManager?.showStatus(
                        `Operations missing Preview: ${names}. Please generate previews first.`,
                        'warning'
                    );
                    return;
                }

                // 4. Gather options
                const optimizeCheckbox = document.getElementById('gcode-optimize-paths');
                const options = {
                    operationIds: selectedItemIds,
                    operations: this.selectedOperations,
                    safeZ: this.controller.core?.getSetting('machine', 'safeZ'),
                    travelZ: this.controller.core?.getSetting('machine', 'travelZ'),
                    rapidFeedRate: this.controller.core?.getSetting('machine', 'rapidFeed'),
                    postProcessor: this.controller.core?.getSetting('gcode', 'postProcessor'),
                    includeComments: document.getElementById('gcode-include-comments')?.checked,
                    singleFile: document.getElementById('gcode-single-file')?.checked,
                    toolChanges: document.getElementById('gcode-tool-changes')?.checked,
                    optimize: optimizeCheckbox ? optimizeCheckbox.checked : false
                };

                // 5. Run orchestration
                const result = await this.controller.orchestrateToolpaths(options);

                if (!result || !result.gcode) {
                    this.showPlaceholderPreview();
                    this.ui?.statusManager?.showStatus('Calculation returned no G-code', 'warning');
                    return;
                }

                // 6. Display results
                const previewText = document.getElementById('gcode-preview-text');
                if (previewText) previewText.value = result.gcode;

                const lineCount = document.getElementById('gcode-line-count');
                if (lineCount) lineCount.textContent = result.lineCount;

                const planCountEl = document.getElementById('gcode-op-count');
                if (planCountEl) planCountEl.textContent = result.planCount;

                const estTimeEl = document.getElementById('gcode-est-time');
                if (estTimeEl) {
                    const minutes = Math.floor(result.estimatedTime / 60);
                    const seconds = Math.floor(result.estimatedTime % 60);
                    estTimeEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                }
                
                const distanceEl = document.getElementById('gcode-distance');
                if (distanceEl) {
                    distanceEl.textContent = `${result.totalDistance.toFixed(1)}mm`;
                }

            } catch (error) {
                console.error('[UI-ModalManager] Orchestration failed:', error);
                this.showPlaceholderPreview();
                this.ui?.statusManager?.showStatus(`Failed: ${error.message}`, 'error');
            } finally {
                // 7. Restore button
                btn.textContent = originalText;
                btn.disabled = false;
            }
        }
        
        setupToolpathHandlers() {
            // Cancel button
            const cancelBtn = document.getElementById('gcode-cancel-btn');
            if (cancelBtn) {
                cancelBtn.onclick = () => this.closeModal();
            }
            
            // Calculate button
            const calculateBtn = document.getElementById('gcode-calculate-btn');
            if (calculateBtn) {
                calculateBtn.onclick = () => {
                    this.runToolpathOrchestration(calculateBtn);
                };
            }
            
            // Export button
            const exportBtn = document.getElementById('gcode-export-btn');
            if (exportBtn) {
                exportBtn.onclick = () => this.exportGCode();
            }
            
            // Close button
            const closeBtn = this.modals.gcode?.querySelector('.modal-close');
            if (closeBtn) {
                closeBtn.onclick = () => this.closeModal();
            }
        }
        
        exportGCode() {
            const previewText = document.getElementById('gcode-preview-text');
            const filename = document.getElementById('gcode-filename')?.value || textConfig.gcodeDefaultFilename || 'output.nc';
            
            // Get the placeholder text from the config
            const placeholder = textConfig.gcodePlaceholder;
            const gcodeContent = previewText.value;

            if (!previewText || !gcodeContent) {
                alert(textConfig.gcodeNoExportAlert);
                return;
            }

            // Check if the content is *exactly* the placeholder
            if (gcodeContent === placeholder) {
                alert(textConfig.gcodeNoExportAlert);
                return;
            }

            // Check for our known "error" messages that start with ';'
            if (gcodeContent.startsWith('; No toolpath data available') || 
                gcodeContent.startsWith('; No operations selected') || 
                gcodeContent.startsWith('; Generation Failed')) 
            {
                alert(textConfig.gcodeNoExportAlert);
                return;
            }
            
            // Create download
            const blob = new Blob([gcodeContent], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            
            if (this.controller.ui?.statusManager) {
                this.controller.ui.statusManager.showStatus('G-code exported successfully', 'success');
            }
            
            this.closeModal();
        }
        
        // Warning modal (for future use)
        showWarning(title, message, options = {}) {
            const { onConfirm, onCancel, confirmText = 'OK', cancelText = 'Cancel' } = options;
            
            // Create modal dynamically if not exists
            let modal = document.getElementById('warning-modal');
            if (!modal) {
                modal = this.createWarningModal();
                document.body.appendChild(modal);
                this.modals.warning = modal;
            }
            
            // Set content
            modal.querySelector('.warning-title').textContent = title;
            modal.querySelector('.warning-message').textContent = message;
            
            // Setup buttons
            const confirmBtn = modal.querySelector('.warning-confirm');
            confirmBtn.textContent = confirmText;
            confirmBtn.onclick = () => {
                if (onConfirm) onConfirm();
                this.closeModal();
            };
            
            const cancelBtn = modal.querySelector('.warning-cancel');
            if (onCancel) {
                cancelBtn.style.display = '';
                cancelBtn.textContent = cancelText;
                cancelBtn.onclick = () => {
                    onCancel();
                    this.closeModal();
                };
            } else {
                cancelBtn.style.display = 'none';
            }
            
            this.showModal('warning');
        }
        
        createWarningModal() {
            const modal = document.createElement('div');
            modal.id = 'warning-modal';
            modal.className = 'modal';
            
            modal.innerHTML = `
                <div class="modal-content modal-warning">
                    <div class="modal-header">
                        <h2 class="warning-title">Warning</h2>
                        <button class="modal-close">×</button>
                    </div>
                    <div class="modal-body">
                        <p class="warning-message"></p>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary warning-cancel">Cancel</button>
                        <button class="btn btn-primary warning-confirm">OK</button>
                    </div>
                </div>
            `;
            
            modal.querySelector('.modal-close').onclick = () => this.closeModal();
            
            return modal;
        }

        debug(message, data = null) {
            if (debugConfig.enabled) {
                if (data) {
                    console.log(`[UI-ModalManager] ${message}`, data);
                } else {
                    console.log(`[UI-ModalManager] ${message}`);
                }
            }
        }
    }
    
    window.ModalManager = ModalManager;
})();