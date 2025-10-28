/**
 * @file        ui/ui-modal-manager.js
 * @description Unified modal management for all modals
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
    
    class ModalManager {
        constructor(controller) {
            this.controller = controller;
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
                previewText.value = '; Click "Calculate Preview" to generate G-code preview\n; or "Export G-code" to proceed directly to export';
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
                console.error(`Modal '${modalName}' not found`);
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
                    this.handleWelcomeClose();
                    this.showModal('file');
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
            if (dontShowCheckbox?.checked) {
                localStorage.setItem('pcbcam-hide-welcome', 'true');
                localStorage.setItem('hasVisited', 'true');
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
                    this.closeModal();
                };
            }
            
            // Cancel button
            const cancelBtn = document.getElementById('cancel-files-btn');
            if (cancelBtn) {
                cancelBtn.onclick = () => {
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
            console.log(`[ModalManager] Opening toolpath manager with ${operations.length} operation(s)`);
            
            // Store operations
            this.selectedOperations = operations;
            this.highlightedOpId = highlightOperationId;
            this.toolpathPlans.clear();
            
            this.showModal('gcode');
            
            // Update modal title
            const modal = this.modals.gcode;
            const header = modal.querySelector('.modal-header h2');
            if (header) header.textContent = 'Toolpath Manager & G-code Export';
            
            this.populateToolpathModal();
            
            // Show placeholder instead of calculating immediately
            this.showPlaceholderPreview();
            
            this.setupToolpathHandlers();
        }
        
        populateToolpathModal() {
            const list = document.getElementById('gcode-operation-list');
            if (!list) return;
            
            list.innerHTML = '';
            
            for (const op of this.selectedOperations) {
                const item = this.createOperationItem(op);
                list.appendChild(item);
            }
            
            // Make list sortable
            this.makeSortable(list);
            // Initialize checkbox state from config
            const optimizeCheckbox = document.getElementById('gcode-optimize-paths');
            if (optimizeCheckbox && config.gcode) {
                // Use the master switch 'enableOptimization'
                optimizeCheckbox.checked = config.gcode.enableOptimization || false;
            }
        }
        
        createOperationItem(operation) {
            const item = document.createElement('div');
            item.className = 'operation-item';
            item.dataset.operationId = operation.id;
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = true;
            checkbox.id = `op-check-${operation.id}`;
            
            const label = document.createElement('label');
            label.htmlFor = checkbox.id;
            label.textContent = `${operation.type}: ${operation.file.name}`;
            
            const dragHandle = document.createElement('span');
            dragHandle.className = 'drag-handle';
            dragHandle.innerHTML = '☰';
            
            item.appendChild(dragHandle);
            item.appendChild(checkbox);
            item.appendChild(label);
            
            // Show key parameters
            const params = document.createElement('div');
            params.className = 'operation-params';
            params.style.fontSize = '11px';
            params.style.color = '#999';
            params.innerHTML = `
                Tool: ${operation.settings.tool?.diameter || 0}mm | 
                Depth: ${operation.settings.cutDepth || 0}mm | 
                Feed: ${operation.settings.feedRate || 0}mm/min
            `;
            item.appendChild(params);
            
            return item;
        }
        
        makeSortable(container) {
            let draggedItem = null;
            
            container.addEventListener('dragstart', (e) => {
                if (e.target.classList.contains('operation-item')) {
                    draggedItem = e.target;
                    e.target.classList.add('dragging');
                }
            });
            
            container.addEventListener('dragend', (e) => {
                if (e.target.classList.contains('operation-item')) {
                    e.target.classList.remove('dragging');
                    draggedItem = null;
                    this.updatePreview();
                }
            });
            
            container.addEventListener('dragover', (e) => {
                e.preventDefault();
                const afterElement = this.getDragAfterElement(container, e.clientY);
                if (afterElement == null) {
                    container.appendChild(draggedItem);
                } else {
                    container.insertBefore(draggedItem, afterElement);
                }
            });
            
            // Make items draggable
            container.querySelectorAll('.operation-item').forEach(item => {
                item.draggable = true;
            });
        }
        
        getDragAfterElement(container, y) {
            const draggableElements = [...container.querySelectorAll('.operation-item:not(.dragging)')];
            
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
        
        async calculateToolpaths() {
            // Validate operations have offsets
            const readyOps = this.selectedOperations.filter(op => op.offsets && op.offsets.length > 0);
            
            if (readyOps.length === 0) {
                this.showPlaceholderPreview();
                this.ui?.statusManager?.showStatus('No operations have offset geometry. Generate previews first.', 'warning');
                return;
            }

            // Clear cached plans to force recalculation
            this.toolpathPlans.clear();
            
            // Store that we have calculated (even if it's just metadata preparation)
            for (const op of readyOps) {
                this.toolpathPlans.set(op.id, { ready: true });
            }
            
            // Update preview to generate actual G-code
            this.updatePreview();
        }
        
        async updatePreview() {
            const list = document.getElementById('gcode-operation-list');
            if (!list) return;
            
            const selectedItemIds = [];
            list.querySelectorAll('.operation-item').forEach(item => {
                const checkbox = item.querySelector('input[type="checkbox"]');
                if (checkbox?.checked) {
                    selectedItemIds.push(item.dataset.operationId);
                }
            });
            
            if (selectedItemIds.length === 0) {
                this.showPlaceholderPreview();
                return;
            }
            
            // Validate operations have offsets
            const selectedOps = selectedItemIds
                .map(id => this.selectedOperations.find(o => o.id === id))
                .filter(Boolean);
            
            const opsWithoutOffsets = selectedOps.filter(op => !op.offsets || op.offsets.length === 0);
            if (opsWithoutOffsets.length > 0) {
                this.showPlaceholderPreview();
                const names = opsWithoutOffsets.map(o => o.file.name).join(', ');
                this.ui?.statusManager?.showStatus(
                    `Operations missing offset geometry: ${names}`, 
                    'warning'
                );
                return;
            }
            
            // Gather options - FIX: Actually read the checkbox value
            const optimizeCheckbox = document.getElementById('gcode-optimize-paths');
            const options = {
                operationIds: selectedItemIds,
                operations: this.selectedOperations,
                
                // Machine settings
                safeZ: 5.0,
                travelZ: 2.0,
                plungeRate: 50,
                rapidFeedRate: 1000,
                
                // G-code settings
                postProcessor: document.getElementById('gcode-post-processor')?.value || 'grbl',
                includeComments: document.getElementById('gcode-include-comments')?.checked !== false,
                singleFile: document.getElementById('gcode-single-file')?.checked !== false,
                toolChanges: document.getElementById('gcode-tool-changes')?.checked || false,
                
                // FIX: Read actual checkbox state
                optimize: optimizeCheckbox ? optimizeCheckbox.checked : false
            };

            try {
                const result = await this.controller.orchestrateToolpaths(options);
                
                if (!result || !result.gcode) {
                    this.showPlaceholderPreview();
                    return;
                }

                // Update UI
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
                
            } catch (error) {
                console.error('[ModalManager] Orchestration failed:', error);
                this.showPlaceholderPreview();
                this.ui?.statusManager?.showStatus(`Failed: ${error.message}`, 'error');
            }
        }
        
        estimateTime(plans) {
            let totalTime = 0;
            let lastPos = { x: 0, y: 0, z: 0 }; // Track position
            const rapidFeed = this.controller.core?.getSetting('machine', 'rapidFeed') || 1000;

            for (const plan of plans) {
                if (!plan.commands) continue;
                
                for (const cmd of plan.commands) {
                    let dist = 0;
                    let feed = 100;
                    let nextPos = { ...lastPos };
                    
                    if (cmd.x !== null) nextPos.x = cmd.x;
                    if (cmd.y !== null) nextPos.y = cmd.y;
                    if (cmd.z !== null) nextPos.z = cmd.z;

                    if (cmd.type === 'RAPID' || cmd.type === 'RETRACT') {
                        dist = Math.hypot(nextPos.x - lastPos.x, nextPos.y - lastPos.y, nextPos.z - lastPos.z);
                        feed = rapidFeed;
                    } 
                    else if (cmd.type === 'LINEAR' || cmd.type === 'PLUNGE') {
                        dist = Math.hypot(nextPos.x - lastPos.x, nextPos.y - lastPos.y, nextPos.z - lastPos.z);
                        feed = cmd.f || 100;
                    } 
                    else if (cmd.type === 'ARC_CW' || cmd.type === 'ARC_CCW') {
                        // Approximate arc distance using radius
                        const radius = Math.hypot(cmd.i, cmd.j);
                        if (radius > 0) {
                            // Calculate angle
                            const v1 = { x: -cmd.i, y: -cmd.j };
                            const v2 = { x: nextPos.x - (lastPos.x + cmd.i), y: nextPos.y - (lastPos.y + cmd.j) };
                            const angle = Math.acos((v1.x * v2.x + v1.y * v2.y) / (radius * radius));
                            dist = radius * angle;
                            // If dist is NaN (e.g., full circle), approximate
                            if (isNaN(dist) || dist === 0) {
                                dist = Math.hypot(nextPos.x - lastPos.x, nextPos.y - lastPos.y);
                            }
                        } else {
                            dist = Math.hypot(nextPos.x - lastPos.x, nextPos.y - lastPos.y);
                        }
                        feed = cmd.f || 100;
                    }
                    else if (cmd.type === 'DWELL') {
                        totalTime += cmd.dwell || 0; // Add dwell time directly
                    }

                    if (feed > 0 && dist > 0) {
                        totalTime += (dist / feed) * 60; // Time in seconds
                    }
                    
                    lastPos = nextPos; // Update position
                }
            }
            
            return totalTime;
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
                calculateBtn.onclick = async () => {
                    await this.calculateToolpaths();
                };
            }
            
            // Update preview button
            const previewBtn = document.getElementById('gcode-preview-btn');
            if (previewBtn) {
                previewBtn.onclick = () => this.updatePreview();
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
            
            // Update on checkbox change
            const list = document.getElementById('gcode-operation-list');
            if (list) {
                list.addEventListener('change', () => this.updatePreview());
            }
            
            // Update on options change
            [
                'gcode-single-file', 
                'gcode-include-comments', 
                'gcode-tool-changes'
            ].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('change', () => this.updatePreview());
            });
        }
        
        exportGCode() {
            const previewText = document.getElementById('gcode-preview-text');
            const filename = document.getElementById('gcode-filename')?.value || 'output.nc';
            
            if (!previewText || !previewText.value) {
                alert('No G-code to export');
                return;
            }
            
            // Create download
            const blob = new Blob([previewText.value], { type: 'text/plain' });
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
    }
    
    window.ModalManager = ModalManager;
    
})();