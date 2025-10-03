// ui/ui-status-manager.js
// Manages status bar, progress, and status messages

(function() {
    'use strict';
    
    const config = window.PCBCAMConfig || {};
    
    class StatusManager {
        constructor(ui) {
            this.ui = ui;
            this.currentStatus = null;
            this.statusTimeout = null;
            this.progressVisible = false;
        }
        
        updateStatus(message = null, type = 'normal') {
            const statusText = document.getElementById('status-text');
            if (!statusText) return;
            
            // Clear any existing timeout
            if (this.statusTimeout) {
                clearTimeout(this.statusTimeout);
                this.statusTimeout = null;
            }
            
            if (message) {
                statusText.textContent = message;
                statusText.className = `status-text ${type}`;
                this.currentStatus = { message, type };
                
                // Auto-clear success/info messages after delay
                if (type === 'success' || type === 'info') {
                    this.statusTimeout = setTimeout(() => {
                        this.updateStatus(); // Reset to default
                    }, 5000);
                }
            } else {
                // Reset to default status
                const hasOps = this.ui.core.hasValidOperations();
                if (hasOps) {
                    const stats = this.ui.core.getStats();
                    statusText.textContent = `Ready: ${stats.operations} operations, ${stats.totalPrimitives} primitives`;
                    statusText.className = 'status-text';
                } else {
                    statusText.textContent = 'Ready - Add PCB files to begin';
                    statusText.className = 'status-text';
                }
                this.currentStatus = null;
            }
        }
        
        showStatus(message, type = 'normal') {
            this.updateStatus(message, type);
        }
        
        showProgress(percent) {
            const progressBar = document.getElementById('progress-bar');
            const progressContainer = document.getElementById('status-progress');
            
            if (progressBar && progressContainer) {
                progressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
                progressContainer.classList.remove('hidden');
                this.progressVisible = true;
            }
        }
        
        hideProgress() {
            const progressContainer = document.getElementById('status-progress');
            if (progressContainer) {
                progressContainer.classList.add('hidden');
                this.progressVisible = false;
            }
        }
        
        updateProgressMessage(message, percent) {
            this.updateStatus(message, 'info');
            if (percent !== undefined) {
                this.showProgress(percent);
            }
        }
        
        // Helper for long operations with progress
        async withProgress(message, asyncFn) {
            this.updateStatus(message, 'info');
            this.showProgress(0);
            
            try {
                const result = await asyncFn((percent) => {
                    this.showProgress(percent);
                });
                
                this.hideProgress();
                this.updateStatus('Operation completed', 'success');
                return result;
            } catch (error) {
                this.hideProgress();
                this.updateStatus('Operation failed: ' + error.message, 'error');
                throw error;
            }
        }
    }
    
    // Export
    window.StatusManager = StatusManager;
    
})();