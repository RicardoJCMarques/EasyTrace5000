// ui/ui-operations_r.js
// Operation cards and status management for workspace

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
            
            // Track operation section states
            this.sectionStates = {
                isolation: true,
                drill: true,
                clear: true,
                cutout: true
            };
        }
        
        renderAllOperations() {
            Object.keys(opsConfig).forEach(type => this.renderOperations(type));
            this.setupOperationToggles();
        }
        
        setupOperationToggles() {
            // Setup operation section toggles
            Object.keys(opsConfig).forEach(type => {
                const header = document.querySelector(`#${type}-operations`)?.closest('.operation-group')?.querySelector('.operation-group-header');
                if (header) {
                    // Add chevron if not present
                    if (!header.querySelector('.operation-chevron')) {
                        const chevron = document.createElement('span');
                        chevron.className = 'operation-chevron';
                        chevron.textContent = this.sectionStates[type] ? '▼' : '▶';
                        header.insertBefore(chevron, header.firstChild);
                    }
                    
                    // Make header clickable
                    header.style.cursor = 'pointer';
                    header.onclick = (e) => {
                        // Don't toggle if clicking button
                        if (e.target.tagName === 'BUTTON') return;
                        this.toggleOperationSection(type);
                    };
                }
            });
        }
        
        toggleOperationSection(type) {
            this.sectionStates[type] = !this.sectionStates[type];
            const container = document.getElementById(`${type}-operations`);
            const header = container?.closest('.operation-group')?.querySelector('.operation-group-header');
            const chevron = header?.querySelector('.operation-chevron');
            
            if (container) {
                container.style.display = this.sectionStates[type] ? 'block' : 'none';
            }
            if (chevron) {
                chevron.textContent = this.sectionStates[type] ? '▼' : '▶';
            }
        }
        
        expandAllOperations() {
            Object.keys(opsConfig).forEach(type => {
                this.sectionStates[type] = true;
                const container = document.getElementById(`${type}-operations`);
                const chevron = container?.closest('.operation-group')?.querySelector('.operation-chevron');
                
                if (container) container.style.display = 'block';
                if (chevron) chevron.textContent = '▼';
            });
        }
        
        renderOperations(type) {
            const container = document.getElementById(`${type}-operations`);
            if (!container) return;
            
            container.innerHTML = '';
            
            const typeOperations = this.core.getOperationsByType(type);
            
            if (typeOperations.length === 0) {
                container.innerHTML = '<div class="operation-empty">No files loaded</div>';
                return;
            }
            
            typeOperations.forEach(operation => {
                const card = this.createOperationCard(operation);
                container.appendChild(card);
            });
        }
        
        createOperationCard(operation) {
            const template = document.getElementById('operation-card-template');
            if (!template) {
                return this.createOperationCardFallback(operation);
            }
            
            const card = template.content.cloneNode(true).firstElementChild;
            const config = this.core.fileTypes[operation.type];
            
            let statusIcon = '⏳';
            if (operation.error) {
                statusIcon = '❌';
            } else if (operation.primitives) {
                statusIcon = '✅';
            }
            
            card.setAttribute('data-operation-id', operation.id);
            card.querySelector('.operation-icon').textContent = config.icon;
            card.querySelector('.operation-name').textContent = operation.file.name;
            card.querySelector('.operation-status').textContent = statusIcon;
            
            const expandBtn = card.querySelector('.expand-btn');
            const removeBtn = card.querySelector('.remove-btn');
            const settingsPanel = card.querySelector('.operation-settings');
            
            expandBtn.setAttribute('data-operation-id', operation.id);
            removeBtn.setAttribute('data-operation-id', operation.id);
            
            expandBtn.textContent = operation.expanded ? '▼' : '▶';
            settingsPanel.style.display = operation.expanded ? 'block' : 'none';
            
            // Enhanced statistics display
            if (operation.primitives) {
                let stats = `
                    <div class="operation-stats">
                        <div class="stat-row">
                            <span class="stat-label">Primitives:</span>
                            <span class="stat-value">${operation.primitives.length}</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Size:</span>
                            <span class="stat-value">${(operation.file.size / 1024).toFixed(1)} KB</span>
                        </div>`;
                
                if (operation.geometricContext) {
                    if (operation.geometricContext.strokeCount > 0) {
                        stats += `
                        <div class="stat-row">
                            <span class="stat-label">Strokes:</span>
                            <span class="stat-value">${operation.geometricContext.strokeCount}</span>
                        </div>`;
                    }
                    if (operation.geometricContext.hasArcs) {
                        stats += `
                        <div class="stat-row">
                            <span class="stat-label">Has arcs:</span>
                            <span class="stat-value">Yes</span>
                        </div>`;
                    }
                }
                
                if (operation.bounds) {
                    const width = (operation.bounds.maxX - operation.bounds.minX).toFixed(1);
                    const height = (operation.bounds.maxY - operation.bounds.minY).toFixed(1);
                    stats += `
                        <div class="stat-row">
                            <span class="stat-label">Bounds:</span>
                            <span class="stat-value">${width} × ${height} mm</span>
                        </div>`;
                }
                
                stats += '</div>';
                settingsPanel.innerHTML = stats;
            } else if (operation.error) {
                settingsPanel.innerHTML = `
                    <div class="operation-error">${operation.error}</div>
                `;
            } else {
                settingsPanel.innerHTML = `
                    <div class="operation-info">Processing...</div>
                `;
            }
            
            expandBtn.addEventListener('click', () => {
                operation.expanded = !operation.expanded;
                expandBtn.textContent = operation.expanded ? '▼' : '▶';
                settingsPanel.style.display = operation.expanded ? 'block' : 'none';
            });
            
            removeBtn.addEventListener('click', () => {
                this.removeOperation(operation.id);
            });
            
            return card;
        }
        
        createOperationCardFallback(operation) {
            const card = document.createElement('div');
            card.className = 'operation-card';
            card.setAttribute('data-operation-id', operation.id);
            
            const config = this.core.fileTypes[operation.type];
            let statusIcon = operation.error ? '❌' : (operation.primitives ? '✅' : '⏳');
            
            card.innerHTML = `
                <div class="operation-header">
                    <span class="operation-icon">${config.icon}</span>
                    <span class="operation-name">${operation.file.name}</span>
                    <span class="operation-status">${statusIcon}</span>
                    <button class="remove-btn" title="Remove">×</button>
                </div>
            `;
            
            card.querySelector('.remove-btn').addEventListener('click', () => {
                this.removeOperation(operation.id);
            });
            
            return card;
        }
        
        removeOperation(operationId) {
            const operation = this.core.operations.find(op => op.id === operationId);
            if (!operation) return;
            
            if (this.core.removeOperation(operationId)) {
                this.renderOperations(operation.type);
                this.ui.statusManager.updateStatus();
                
                if (this.ui.renderer) {
                    this.ui.updateRendererAsync();
                }
            }
        }
        
        showOperationMessage(type, message, messageType = 'error') {
            const container = document.getElementById(`${type}-operations`);
            if (!container) return;
            
            container.querySelectorAll('.operation-message').forEach(el => el.remove());
            
            if (!message) return;
            
            const messageEl = document.createElement('div');
            messageEl.className = `operation-message operation-${messageType}`;
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
            
            if (message) {
                statusText.textContent = message;
            } else {
                const hasValidOperations = this.ui.core.hasValidOperations();
                if (hasValidOperations) {
                    const stats = this.ui.core.getStats();
                    statusText.textContent = `Ready: ${stats.operations} operations, ${stats.totalPrimitives} primitives`;
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