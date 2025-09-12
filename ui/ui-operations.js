// ui/ui-operations.js
// Operation cards, file management, and status management

(function() {
    'use strict';
    
    const config = window.PCBCAMConfig || {};
    const opsConfig = config.operations || {};
    const timingConfig = config.ui?.timing || {};
    const messagesConfig = config.ui?.messages || {};
    const validationConfig = config.ui?.validation || {};
    const debugConfig = config.debug || {};
    
    class OperationsManager {
        constructor(ui) {
            this.ui = ui;
            this.core = ui.core;
            
            // Track active file input type
            this.activeFileInputType = null;
        }
        
        renderAllOperations() {
            Object.keys(opsConfig).forEach(type => this.renderOperations(type));
        }
        
        renderOperations(type) {
            const container = document.getElementById(`${type}-operations`);
            if (!container) return;
            
            container.innerHTML = '';
            
            const typeOperations = this.core.getOperationsByType(type);
            
            typeOperations.forEach(operation => {
                const operationCard = this.createOperationCard(operation);
                container.appendChild(operationCard);
            });
        }
        
        createOperationCard(operation) {
            const card = document.createElement('div');
            card.className = 'operation-card';
            card.setAttribute('data-operation-id', operation.id);
            
            const config = this.core.fileTypes[operation.type];
            let statusIcon = '⏳';
            
            if (operation.error) {
                statusIcon = '❌';
            } else if (operation.primitives) {
                statusIcon = '✅';
            }
            
            const colorIndicator = `<span style="display: inline-block; width: 12px; height: 12px; background: ${operation.color}; border-radius: 2px; margin-right: 4px;"></span>`;
            
            card.innerHTML = `
                <div class="operation-header">
                    <span class="operation-icon">${config.icon}</span>
                    <span class="operation-name">${colorIndicator}${operation.file.name}</span>
                    <span class="operation-status">${statusIcon}</span>
                    <button class="expand-btn" data-operation-id="${operation.id}">
                        ${operation.expanded ? '▼' : '▶'}
                    </button>
                    <button class="remove-btn" data-operation-id="${operation.id}" title="Remove operation">×</button>
                </div>
                <div class="operation-settings" style="display: ${operation.expanded ? 'block' : 'none'}">
                    ${this.createSettingsPanel(operation)}
                </div>
            `;
            
            card.querySelector('.expand-btn').addEventListener('click', (e) => {
                this.toggleOperationExpansion(e.target.dataset.operationId);
            });
            
            card.querySelector('.remove-btn').addEventListener('click', (e) => {
                this.removeOperation(e.target.dataset.operationId);
            });
            
            return card;
        }
        
        createSettingsPanel(operation) {
            const settings = operation.settings;
            
            return `
                <div class="settings-panel">
                    <div class="settings-section">
                        <h4>Tool Settings</h4>
                        <div class="input-group">
                            <label>Tool Diameter</label>
                            <div class="input-unit">
                                <input type="number" id="tool-diameter-${operation.id}" 
                                       value="${settings.tool.diameter}" 
                                       min="${validationConfig.minToolDiameter}" 
                                       max="${validationConfig.maxToolDiameter}"
                                       step="0.01">
                                <span>mm</span>
                            </div>
                        </div>
                        <div class="input-group">
                            <label>Tool Type</label>
                            <select id="tool-type-${operation.id}">
                                <option value="end_mill" ${settings.tool.type === 'end_mill' ? 'selected' : ''}>End Mill</option>
                                <option value="v_bit" ${settings.tool.type === 'v_bit' ? 'selected' : ''}>V-Bit</option>
                                <option value="drill" ${settings.tool.type === 'drill' ? 'selected' : ''}>Drill</option>
                            </select>
                        </div>
                    </div>
                    
                    <div class="settings-section">
                        <h4>Cutting Parameters</h4>
                        <div class="input-group">
                            <label>Cut Feed</label>
                            <div class="input-unit">
                                <input type="number" id="cut-feed-${operation.id}" 
                                       value="${settings.cutting.cutFeed}" 
                                       min="${validationConfig.minFeedRate}" 
                                       max="${validationConfig.maxFeedRate}"
                                       step="1">
                                <span>mm/min</span>
                            </div>
                        </div>
                        <div class="input-group">
                            <label>Cut Depth</label>
                            <div class="input-unit">
                                <input type="number" id="cut-depth-${operation.id}" 
                                       value="${settings.cutting.cutDepth}" 
                                       min="${validationConfig.minDepth}" 
                                       max="${validationConfig.maxDepth}"
                                       step="0.001">
                                <span>mm</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="settings-section">
                        <h4>Operation Settings</h4>
                        ${this.createOperationSpecificSettings(operation)}
                    </div>
                </div>
            `;
        }
        
        createOperationSpecificSettings(operation) {
            const settings = operation.settings.operation;
            
            switch (operation.type) {
                case 'isolation':
                    return `
                        <div class="input-group">
                            <label>Passes</label>
                            <input type="number" value="${settings.passes}" min="1" max="5">
                        </div>
                        <div class="input-group">
                            <label>Overlap %</label>
                            <input type="number" value="${settings.overlap}" min="10" max="90">
                        </div>
                    `;
                case 'drill':
                    return `
                        <div class="input-group">
                            <label>Peck Depth</label>
                            <div class="input-unit">
                                <input type="number" value="${settings.peckDepth}" min="0" step="0.1">
                                <span>mm</span>
                            </div>
                        </div>
                    `;
                case 'cutout':
                    return `
                        <div class="input-group">
                            <label>Tabs</label>
                            <input type="number" value="${settings.tabs}" min="0" max="8">
                        </div>
                    `;
                default:
                    return '';
            }
        }
        
        toggleOperationExpansion(operationId) {
            const operation = this.core.operations.find(op => op.id === operationId);
            if (!operation) return;
            
            operation.expanded = !operation.expanded;
            
            const card = document.querySelector(`[data-operation-id="${operationId}"]`);
            if (!card) return;
            
            const settings = card.querySelector('.operation-settings');
            const btn = card.querySelector('.expand-btn');
            
            if (settings) settings.style.display = operation.expanded ? 'block' : 'none';
            if (btn) btn.textContent = operation.expanded ? '▼' : '▶';
            
            this.core.saveSettings();
        }
        
        removeOperation(operationId) {
            const operation = this.core.operations.find(op => op.id === operationId);
            if (!operation) return;
            
            if (this.core.removeOperation(operationId)) {
                this.showOperationMessage(operation.type, null);
                this.renderOperations(operation.type);
                this.ui.statusManager.updateStatus();
                
                if (this.ui.renderer) {
                    this.ui.updateRendererAsync();
                }
            }
        }
        
        showOperationMessage(operationType, message, type = 'error') {
            const container = document.getElementById(`${operationType}-operations`);
            if (!container) return;
            
            container.querySelectorAll('.operation-message').forEach(el => el.remove());
            
            if (!message) return;
            
            const messageEl = document.createElement('div');
            messageEl.className = `operation-message operation-${type}`;
            messageEl.textContent = message;
            
            container.appendChild(messageEl);
            
            setTimeout(() => {
                if (messageEl.parentElement) {
                    messageEl.remove();
                }
            }, timingConfig.statusMessageDuration || 5000);
        }
    }
    
    class StatusManager {
        constructor(ui) {
            this.ui = ui;
        }
        
        updateStatus(message = null, type = 'normal') {
            const statusText = document.getElementById('status-text');
            const statusBar = document.getElementById('status');
            if (!statusText || !statusBar) return;

            statusBar.className = 'status';
            if (type !== 'normal') statusBar.classList.add(type);

            const hasValidOperations = this.ui.core.hasValidOperations();
            
            const previewBtn = document.getElementById('preview-btn');
            if (previewBtn) previewBtn.disabled = !hasValidOperations;

            if (message) {
                statusText.textContent = message;
            } else {
                if (hasValidOperations) {
                    const stats = this.ui.core.getStats();
                    let statusMsg = `Ready: ${stats.operations} operations, ${stats.totalPrimitives} primitives`;
                    
                    if (this.ui.fusionStats.totalReductions > 0) {
                        statusMsg += ` (${this.ui.fusionStats.totalReductions} fused)`;
                    }
                    
                    if (this.ui.fusionStats.arcReconstructionEnabled && this.ui.fusionStats.curvesRegistered > 0) {
                        statusMsg += ` | Arcs: ${this.ui.fusionStats.curvesReconstructed}/${this.ui.fusionStats.curvesRegistered}`;
                    }
                    
                    statusText.textContent = statusMsg;
                } else {
                    statusText.textContent = messagesConfig.ready || 'Ready - Add PCB files to begin';
                }
            }
        }
        
        showStatus(message, type = 'normal') {
            this.updateStatus(message, type);
        }
    }
    
    // Export
    window.OperationsManager = OperationsManager;
    window.StatusManager = StatusManager;
    
})();