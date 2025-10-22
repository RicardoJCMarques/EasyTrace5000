/**
 * @file        ui/ui-status-manager.js
 * @description Manages the status bar
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
    
    window.StatusManager = StatusManager;
    
})();