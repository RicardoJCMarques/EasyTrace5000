/*!
 * @file        ui/ui-status-manager.js
 * @description Manages the status bar and log panel
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 *
 * SPDX-FileCopyrightText: 2025-2026 Eltryus - Ricardo Marques
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

(function() {
    'use strict';

    const C = window.CAMConfig.constants;
    const D = window.CAMConfig.defaults;
    const timingConfig = D.ui.timing;
    const textConfig = C.ui.text;
    const debugState = D.debug;

    class StatusManager {
        constructor(ui) {
            this.ui = ui;
            this.lang = ui.lang;
            this.currentStatus = null;
            this.statusTimeout = null;
            this.progressVisible = false;

            this.logHistory = [];
            this.isExpanded = false;
            this.showDebugMessages = D.rendering.defaultOptions.showDebugInLog;

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

            this.statusTextEl = document.getElementById('status-text');
            this.progressBarEl = document.getElementById('progress-bar');
            this.progressContainerEl = document.getElementById('status-progress');
        }

        setDebugVisibility(isVisible) {
            this.showDebugMessages = isVisible;
            // Re-render the log with/without debug messages
            if (this.isExpanded) {
                this.renderLog();
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
                this.renderLog(); // Render the log content when it's opened
            }
        }

        addLogEntry(message, type = 'normal') {
            const isDebug = type === 'debug';

            // If this is a debug message and the global debug flag is off, skip it.
            if (isDebug && !debugState.enabled) {
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
                this.appendLogEntry(logEntry);
            }
        }

        renderLog() {
            if (!this.logHistoryContainer) return;

            // Filter log based on debug setting
            const showThisDebugMessage = debugState.enabled || this.showDebugMessages;
            const entriesToRender = this.logHistory.filter(entry => {
                return entry.type !== 'debug' || showThisDebugMessage;
            });

            const fragment = document.createDocumentFragment();
            for (const entry of entriesToRender) {
                fragment.appendChild(this.createLogElement(entry));
            }

            this.logHistoryContainer.innerHTML = ''; // Clear old content
            this.logHistoryContainer.appendChild(fragment);
            this.logHistoryContainer.scrollTop = this.logHistoryContainer.scrollHeight;
        }

        appendLogEntry(logEntry) {
            if (!this.logHistoryContainer) return;
            const shouldScroll = this.logHistoryContainer.scrollTop + this.logHistoryContainer.clientHeight >= this.logHistoryContainer.scrollHeight - 20;
            this.logHistoryContainer.appendChild(this.createLogElement(logEntry));
            if (shouldScroll) {
                this.logHistoryContainer.scrollTop = this.logHistoryContainer.scrollHeight;
            }
        }

        createLogElement(logEntry) {
            const p = document.createElement('p');
            p.className = `log-entry ${logEntry.type}`;
            p.textContent = `[${logEntry.timestamp}] ${logEntry.message}`;
            return p;
        }

        updateStatus(message = null, type = 'normal', skipLog = false) {
            if (!this.statusTextEl) return;

            // Set appropriate aria-live based on message type
            if (type === 'error') {
                this.statusTextEl.setAttribute('aria-live', 'assertive');
            } else {
                this.statusTextEl.setAttribute('aria-live', 'polite');
            }

            if (this.statusTimeout) {
                clearTimeout(this.statusTimeout);
                this.statusTimeout = null;
            }

            if (message) {
                this.statusTextEl.textContent = message;
                this.statusTextEl.className = `status-text ${type}`;
                this.currentStatus = { message, type };

                // Only add to permanent history if skipLog is false
                if (!skipLog) {
                    this.addLogEntry(message, type);
                }

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
                    defaultMessage = this.lang.get('status.readyDynamic', textConfig.statusReady);
                    // Replace the placeholders
                    defaultMessage = defaultMessage
                                        .replace('{ops}', stats.operations)
                                        .replace('{prims}', stats.totalPrimitives);
                } else {
                    // Get the default string:
                    defaultMessage = this.lang.get('status.default', textConfig.statusReady);
                }

                this.statusTextEl.textContent = defaultMessage;
                this.statusTextEl.className = 'status-text';
                this.currentStatus = null;
            }
        }

        debugLog(message) {
            this.addLogEntry(message, 'debug');
        }

        debug(message, data = null) {
            if (this.ui.debug) {
                this.ui.debug(`[StatusManager] ${message}`, data);
            }
        }
    }

    window.StatusManager = StatusManager;
})();