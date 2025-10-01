// ui/ui-operations.js
// Minimal operations support for backward compatibility
// Most functionality moved to ui-tree-manager.js

(function() {
    'use strict';
    
    const config = window.PCBCAMConfig || {};
    
    // Stub class for backward compatibility
    class OperationsManager {
        constructor(ui) {
            this.ui = ui;
            this.core = ui.core;
        }
        
        // Called by old code - redirect to tree manager
        renderAllOperations() {
            if (this.ui.treeManager) {
                this.ui.treeManager.refreshTree();
            }
        }
        
        removeOperation(operationId) {
            if (this.core.removeOperation(operationId)) {
                if (this.ui.treeManager) {
                    this.ui.treeManager.removeFileNode(operationId);
                }
                this.ui.updateRendererAsync();
                this.ui.updateStatistics();
            }
        }
    }
    
    // Status manager remains unchanged
    class StatusManager {
        constructor(ui) {
            this.ui = ui;
        }
        
        updateStatus(message = null, type = 'normal') {
            const statusText = document.getElementById('status-text');
            if (!statusText) return;
            
            if (message) {
                statusText.textContent = message;
                statusText.className = `status-text ${type}`;
            } else {
                const hasOps = this.ui.core.hasValidOperations();
                if (hasOps) {
                    const stats = this.ui.core.getStats();
                    statusText.textContent = `Ready: ${stats.operations} operations, ${stats.totalPrimitives} primitives`;
                } else {
                    statusText.textContent = 'Ready - Add PCB files to begin';
                }
            }
        }
        
        showStatus(message, type = 'normal') {
            this.updateStatus(message, type);
        }
        
        showProgress(percent) {
            const progressBar = document.getElementById('progress-bar');
            const progressContainer = document.getElementById('status-progress');
            
            if (progressBar && progressContainer) {
                progressBar.style.width = `${percent}%`;
                progressContainer.classList.remove('hidden');
            }
        }
        
        hideProgress() {
            const progressContainer = document.getElementById('status-progress');
            if (progressContainer) {
                progressContainer.classList.add('hidden');
            }
        }
    }
    
    // Export
    window.OperationsManager = OperationsManager;
    window.StatusManager = StatusManager;
    
})();