/**
 * @file        ui/ui-status-manager.js
 * @description Manages the status bar and log panel
 * @author      Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

 /*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2026 Eltryus
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
    const timingConfig = config.ui.timing;
    const textConfig = config.ui.text;
    const debugConfig = config.debug;

    class StatusManager {
        constructor(ui) {
            this.ui = ui;
            this.lang = ui.lang;
            this.currentStatus = null;
            this.statusTimeout = null;
            this.progressVisible = false;

            this.logHistory = [];
            this.isExpanded = false;
            this.showDebugMessages = config.rendering.defaultOptions.showDebugInLog;

            this.footerBar = document.getElementById('footer-bar'); // The whole footer
            this.statusBar = document.getElementById('status-bar'); // The clickable center part
            this.logPanel = document.getElementById('status-log-panel');
            this.logHistoryContainer = document.getElementById('status-log-history');

            this.init();
        }

        init() {
            if (!this.statusBar || !this.logHistoryContainer || !this.footerBar) {
                console.error('[StatusManager] Failed to find required log elements.');
                return;
            }

            // Add click listener to toggle the log
            this.statusBar.addEventListener('click', () => {
                this.toggleLog();
            });

            // Add listener for the debug toggle
            const debugToggle = document.getElementById('debug-log-toggle');
            if (debugToggle) {
                // Set initial state from config
                debugToggle.checked = this.showDebugMessages;
                // Add listener
                debugToggle.addEventListener('change', (e) => {
                    this.setDebugVisibility(e.target.checked);
                });
            }

            // Add initial hint message to the log
            this.addLogEntry(textConfig.logHintViz, 'info');
        }

        setDebugVisibility(isVisible) {
            this.showDebugMessages = isVisible;
            // Re-render the log with/without debug messages
            if (this.isExpanded) {
                this._renderLog();
            }
        }

        toggleLog() {
            this.isExpanded = !this.isExpanded;
            // Toggle classes on the new elements
            if (this.footerBar) {
                this.footerBar.classList.toggle('is-expanded', this.isExpanded);
            }
            if (this.logPanel) {
                this.logPanel.classList.toggle('is-expanded', this.isExpanded);
            }
            
            if (this.isExpanded) {
                this._renderLog(); // Render the log content when it's opened
            }
        }

        addLogEntry(message, type = 'normal') {
            const isDebug = type === 'debug';

            // If this is a debug message and the global debug flag is off, skip it.
            if (isDebug && !debugConfig.enabled) {
                return;
            }

            const timestamp = new Date().toLocaleTimeString();
            const logEntry = {
                timestamp,
                message,
                type
            };

            this.logHistory.push(logEntry);

            // Keep log from getting too big
            if (this.logHistory.length > 500) {
                this.logHistory.shift();
            }

            // If the log is open, append the new message
            if (this.isExpanded && this.logHistoryContainer) {
                this._appendLogEntry(logEntry);
            }
        }

        _renderLog() {
            if (!this.logHistoryContainer) return;

            // Filter log based on debug setting
            const showThisDebugMessage = debugConfig.enabled || this.showDebugMessages;
            const entriesToRender = this.logHistory.filter(entry => {
                return entry.type !== 'debug' || showThisDebugMessage;
            });

            const fragment = document.createDocumentFragment();
            for (const entry of entriesToRender) {
                fragment.appendChild(this._createLogElement(entry));
            }
            
            this.logHistoryContainer.innerHTML = ''; // Clear old content
            this.logHistoryContainer.appendChild(fragment);
            this.logHistoryContainer.scrollTop = this.logHistoryContainer.scrollHeight;
        }

        _appendLogEntry(logEntry) {
            if (!this.logHistoryContainer) return;
            const shouldScroll = this.logHistoryContainer.scrollTop + this.logHistoryContainer.clientHeight >= this.logHistoryContainer.scrollHeight - 20;
            this.logHistoryContainer.appendChild(this._createLogElement(logEntry));
            if (shouldScroll) {
                this.logHistoryContainer.scrollTop = this.logHistoryContainer.scrollHeight;
            }
        }

        _createLogElement(logEntry) {
            const p = document.createElement('p');
            p.className = `log-entry ${logEntry.type}`;
            p.textContent = `[${logEntry.timestamp}] ${logEntry.message}`;
            return p;
        }

        updateStatus(message = null, type = 'normal') {
            const statusText = document.getElementById('status-text');
            if (!statusText) return;

            if (this.statusTimeout) {
                clearTimeout(this.statusTimeout);
                this.statusTimeout = null;
            }

            if (message) {
                statusText.textContent = message;
                statusText.className = `status-text ${type}`;
                this.currentStatus = { message, type };

                this.addLogEntry(message, type);

                if (type === 'success' || type === 'info') {
                    const duration = timingConfig.statusMessageDuration;
                    this.statusTimeout = setTimeout(() => {
                        this.updateStatus(); // Reset to default
                    }, duration);
                }
            } else {
                // Reset to default status
                const hasOps = this.ui.core.hasValidOperations();
                let defaultMessage;
                if (hasOps) {
                    const stats = this.ui.core.getStats();
                    // Get the string from en.json
                    defaultMessage = this.lang.get('status.readyDynamic', textConfig.statusDefault);
                    // Replace the placeholders
                    defaultMessage = defaultMessage
                                        .replace('{ops}', stats.operations)
                                        .replace('{prims}', stats.totalPrimitives);
                } else {
                    // Get the default string:
                    defaultMessage = this.lang.get('status.default', textConfig.statusDefault);
                }

                statusText.textContent = defaultMessage;
                statusText.className = 'status-text';
                this.currentStatus = null;
            }
        }

        showStatus(message, type = 'normal') {
            this.updateStatus(message, type);
        }

        debugLog(message) {
            this.addLogEntry(message, 'debug');
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

        async withProgress(message, asyncFn) {
            this.updateStatus(message, 'info');
            this.showProgress(0);

            try {
                const result = await asyncFn((percent) => {
                    this.showProgress(percent);
                });

                this.hideProgress();
                this.updateStatus(textConfig.success, 'success');
                return result;
            } catch (error) {
                this.hideProgress();
                this.updateStatus(`${textConfig.error}: ${error.message}`, 'error');
                throw error;
            }
        }

        debug(message, data = null) {
            if (this.ui && this.ui.debug) {
                this.ui.debug(`[StatusManager] ${message}`, data);
            }
        }
    }

    window.StatusManager = StatusManager;
})();