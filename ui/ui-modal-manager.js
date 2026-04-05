/*!
 * @file        ui/ui-modal-manager.js
 * @description Unified modal management
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
    const textConfig = C.ui.text;
    const iconConfig = C.ui.icons;
    const storageKeys = C.storageKeys;

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
                laserConfig: document.getElementById('laser-config-modal'),
                quickstart: document.getElementById('quickstart-modal'),
                exportManager: document.getElementById('exporter-manager-modal'),
                support: document.getElementById('support-modal'),
                help: document.getElementById('help-modal'),
                warning: document.getElementById('warning-modal')
            };

            // Track selected pipeline
            this.selectedPipeline = 'cnc'; // default

            // Track quickstart files
            this.quickstartFiles = {
                isolation: null,
                drill: null,
                clearing: null,
                cutout: null
            };

            // Focus management for accessibility
            this.previousActiveElement = null;
            this.focusTrapListener = null;

            // Toolpath-specific state
            this.selectedOperations = [];
            this.highlightedOpId = null;
            this.gcodeResults = new Map();

            this.init();
        }

        init() {
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.activeModal) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.handleEscapeKey(); 
                }
            });

            // Click-outside handling with special cases
            Object.entries(this.modals).forEach(([name, modal]) => {
                if (modal) {
                    modal.addEventListener('click', (e) => {
                        if (e.target === modal) {
                            this.handleClickOutside(name);
                        }
                    });
                }
            });

            window.addEventListener('hashchange', () => this.checkHash());
        }

        handleClickOutside(modalName) {
            if (modalName === 'welcome' || modalName === 'laserConfig') {
                // If users click outside the laser config, assume default UV laser settings
                if (modalName === 'laserConfig') {
                    const laserConfig = {
                        laserType: 'uv',
                        outputFormat: D.laser.exportFormat,
                        layerColors: { ...(D.laser.layerColors) }
                    };
                    this.controller.setPipeline('laser', laserConfig);

                    if (this.ui.controls) {
                        this.ui.controls.updatePipelineFieldVisibility();
                    }
                }

                // Clear the modal state
                this.activeModal?.classList.remove('active');
                this.activeModal = null;
                this.modalStack = [];

                // Move forward to quickstart if not disabled
                const hideWelcome = localStorage.getItem(storageKeys.hideWelcome);
                if (!hideWelcome) {
                    this.showModal('quickstart');
                }
            } else {
                this.closeModal();
            }
        }

        checkHash() {
            // Remove the '#' character
            const hash = window.location.hash.substring(1);

            // List of modals that are safe to open directly via URL
            const allowList = ['support', 'welcome', 'quickstart', 'help']; // (Excludes 'gcode' because it needs app state)

            if (allowList.includes(hash)) {
                this.showModal(hash);

                // This removes #modifier from the URL bar without reloading
                history.replaceState(null, null, window.location.pathname);
            }
        }

        showGcodeForOperation(opId) {
            const result = this.gcodeResults.get(opId);
            const previewText = document.getElementById('exporter-preview-text');
            if (!result || !previewText) return;

            previewText.value = result.gcode;

            const lineCount = document.getElementById('exporter-line-count');
            if (lineCount) lineCount.textContent = result.lineCount;

            const planCount = document.getElementById('exporter-op-count');
            if (planCount) planCount.textContent = result.planCount;

            const estTime = document.getElementById('exporter-est-time');
            if (estTime) {
                const minutes = Math.floor(result.estimatedTime / 60);
                const seconds = Math.floor(result.estimatedTime % 60);
                estTime.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            }

            const distance = document.getElementById('exporter-distance');
            if (distance) distance.textContent = `${result.totalDistance.toFixed(1)}mm`;
        }

        updateSplitDrillVisibility() {
            const checkbox = document.getElementById('exporter-split-drills');
            const hint = document.getElementById('exporter-split-drills-hint');
            if (!checkbox) return;

            const isSingleFile = document.getElementById('exporter-single-file')?.checked === true;

            if (isSingleFile) {
                checkbox.disabled = true;
                if (hint) hint.textContent = 'Disable "Export as single file" first.';
                return;
            }

            // Check if any checked drill ops have peck marks
            const list = document.getElementById('exporter-operation-order');
            let hasPecks = false;

            if (list) {
                list.querySelectorAll('.file-node-content').forEach(item => {
                    const cb = item.querySelector('input[type="checkbox"]');
                    if (!cb?.checked) return;
                    const op = this.selectedOperations.find(o => o.id === item.dataset.operationId);
                    if (op?.type !== 'drill') return;
                    if (!op.preview?.primitives) return;
                    if (op.preview.primitives.some(p => p.properties?.role === 'peck_mark')) {
                        hasPecks = true;
                    }
                });
            }

            checkbox.disabled = !hasPecks;
            if (hint) {
                hint.textContent = hasPecks
                    ? 'Separates peck operations into individual files per tool size.'
                    : 'No drill operations with peck marks found.';
            }
        }

        showPlaceholderPreview() {
            const previewText = document.getElementById('exporter-preview-text');
            if (previewText) {
                previewText.value = textConfig.gcodePlaceholder;
            }

            // Reset stats
            document.getElementById('exporter-line-count').textContent = '0';
            const opCountEl = document.getElementById('exporter-op-count');
            if(opCountEl) opCountEl.textContent = this.selectedOperations.length;
            document.getElementById('exporter-est-time').textContent = '--:--';
            document.getElementById('exporter-distance').textContent = '0mm';
        }

        // Generic modal methods
        showModal(modalName, options = {}) {
            const modal = this.modals[modalName];
            if (!modal) {
                console.error(`[UI-ModalManager] Modal - '${modalName}' - not found`);
                return;
            }

            // Only update hash for content modals, except welcome
            const hashableModals = ['quickstart', 'support'];
            if (hashableModals.includes(modalName)) {
                history.pushState(null, null, `#${modalName}`);
            }

            // Store return focus target
            this.previousActiveElement = document.activeElement;

            // Close current modal if exists
            if (this.activeModal) {
                this.removeFocusTrap();
                this.modalStack.push(this.activeModal);
                this.activeModal.classList.remove('active');
            }

            this.activeModal = modal;
            modal.classList.add('active');

            // Set ARIA attributes
            const content = modal.querySelector('.modal-content');
            if (content) {
                content.setAttribute('role', 'dialog');
                content.setAttribute('aria-modal', 'true');

                const heading = content.querySelector('.modal-header h2');
                if (heading) {
                    const headingId = `modal-heading-${modalName}`;
                    heading.id = headingId;
                    content.setAttribute('aria-labelledby', headingId);
                }
            }

            // Call specific show handler
            const handler = `show${modalName.charAt(0).toUpperCase() + modalName.slice(1)}Handler`;
            if (this[handler]) {
                this[handler](options);
            }

            // Setup focus trap
            this.setupFocusTrap(modal);
            this.setupModalFieldNavigation(modal);

            // Move focus to first focusable element inside modal
            requestAnimationFrame(() => {
                const content = modal.querySelector('.modal-content');
                if (content) {
                    // -1 allows JS to focus it, but users can't Tab to it
                    // This satisfies ARIA requirements without showing a button ring
                    content.setAttribute('tabindex', '-1'); 
                    content.style.outline = 'none'; // Ensure no visual ring on the box itself
                    content.focus();
                }
            });
        }

        closeModal() {
            if (!this.activeModal) return;

            this.removeFocusTrap();
            this.activeModal.classList.remove('active');

            if (this.modalStack.length > 0) {
                // Returning to previous modal
                this.activeModal = this.modalStack.pop();
                this.activeModal.classList.add('active');
                this.setupFocusTrap(this.activeModal);

                // Update hash to reflect the modal being returning to
                const returnModalName = this.getActiveModalName();
                if (returnModalName && returnModalName !== 'welcome') {
                    history.replaceState(null, null, `#${returnModalName}`);
                } else {
                    // If returning to welcome (or unknown), clean the URL to root
                    history.replaceState(null, null, window.location.pathname);
                }
            } else {
                // Fully closing removes hash
                this.activeModal = null;
                if (window.location.hash) {
                    history.replaceState(null, null, window.location.pathname);
                }

                // Restore focus - but never to canvas
                if (this.previousActiveElement && 
                    document.body.contains(this.previousActiveElement) &&
                    this.previousActiveElement.id !== 'preview-canvas') {
                    this.previousActiveElement.focus();
                } else {
                    // Fallback to first tree item
                    const treeItem = document.querySelector('#operations-tree [tabindex="0"]');
                    if (treeItem) treeItem.focus();
                }
                this.previousActiveElement = null;
            }
        }

        handleEscapeKey() {
            if (!this.activeModal) return;

            const modalName = this.getActiveModalName();

            switch (modalName) {
                case 'welcome':
                    // Welcome -> transition to quickstart (same as clicking outside)
                    this.handleClickOutside('welcome');
                    break;

                case 'quickstart':
                    // Quickstart -> go back to welcome
                    this.closeModal();
                    this.showModal('welcome');
                    break;

                case 'laserConfig':
                    // laserConfig -> go back to welcome
                    this.closeModal();
                    this.showModal('welcome');
                    break;

                case 'support':
                    // Support -> go back to previous (welcome if stacked, or just close)
                    if (this.modalStack.length > 0) {
                        // There's a modal underneath, go back to it
                        this.closeModal();
                    } else {
                        // Opened standalone (e.g., from footer), just close
                        this.closeModal();
                    }
                    break;

                case 'gcode':
                    // G-code modal -> just close
                    this.closeModal();
                    break;

                default:
                    this.closeModal();
            }
        }

        getActiveModalName() {
            if (!this.activeModal) return null;

            for (const [name, modal] of Object.entries(this.modals)) {
                if (modal === this.activeModal) {
                    return name;
                }
            }
            return null;
        }

        showLaserConfigHandler(options = {}) {
            const modal = this.modals.laserConfig;
            if (!modal) return;

            // UV card — full laser pipeline
            const uvCard = document.getElementById('laser-select-uv');
            if (uvCard) {
                uvCard.onclick = (e) => {
                    e.preventDefault();
                    const laserConfig = {
                        laserType: 'uv',
                        outputFormat: D.laser.exportFormat,
                        layerColors: { ...(D.laser.layerColors) }
                    };
                    this.controller.setPipeline('laser', laserConfig);

                    if (this.ui.controls) {
                        this.ui.controls.updatePipelineFieldVisibility();
                    }

                    this.closeModal();
                    this.showModal('quickstart', options);
                };
            }

            // Fiber card — hybrid pipeline
            const fiberCard = document.getElementById('laser-select-fiber');
            if (fiberCard) {
                fiberCard.onclick = (e) => {
                    e.preventDefault();

                    // --- HYBRID LOCK ---
                    this.ui.showStatus('Hybrid pipeline is currently locked for testing.', 'info');
                    return; 
                    // -------------------

                    /* COMMENTED OUT UNTIL ALL LASER OPERATIONS ARE THOROUGHLY TESTED:
                    const laserConfig = {
                        laserType: 'fiber',
                        outputFormat: D.laser.exportFormat || 'svg',
                        layerColors: { ...(D.laser.layerColors || {}) }
                    };
                    this.controller.setPipeline('hybrid', laserConfig);

                    if (this.ui.controls) {
                        this.ui.controls.updatePipelineFieldVisibility();
                    }

                    this.closeModal();
                    this.showModal('quickstart', options);
                    */
                };
            }

            // Back button
            const backBtn = document.getElementById('laser-config-back-btn');
            if (backBtn) {
                backBtn.onclick = () => {
                    this.closeModal();
                    this.showModal('welcome');
                };
            }

            // Close button
            const closeBtn = document.getElementById('laser-config-close');
            if (closeBtn) {
                closeBtn.onclick = () => this.closeModal();
            }
        }

        showSupportHandler() {
            const modal = this.modals.support;

            // Define the email parts to confuse basic scrapers
            const user = 'sponsor';
            const domain = 'eltryus';
            const tld = 'design';

            // Reassemble
            const email = `${user}@${domain}.${tld}`;

            // Get elements
            const oldBtn = document.getElementById('support-email-copy');
            const closeBtn = modal.querySelector('.modal-close');

            if (oldBtn) {
                // Clone the button to remove old listeners (critical for SPAs)
                const newBtn = oldBtn.cloneNode(true);
                oldBtn.parentNode.replaceChild(newBtn, oldBtn);

                // Get the text span inside the new button
                const textSpan = newBtn.querySelector('#support-email-text');

                // Reset state (in case it was stuck on "Copied!")
                if (textSpan) textSpan.textContent = email;
                newBtn.classList.remove('copied');

                // Attach Click Listener
                newBtn.onclick = async () => {
                    try {
                        await navigator.clipboard.writeText(email);

                        // Feedback: Change text inside button, leave external hint alone
                        if (textSpan) textSpan.textContent = 'Copied to clipboard!';
                        newBtn.classList.add('copied');

                        // Revert after 2 seconds
                        setTimeout(() => {
                            if (textSpan) textSpan.textContent = email;
                            newBtn.classList.remove('copied');
                        }, 2000);

                    } catch (err) {
                        console.error('Copy failed:', err);
                        // Fallback: Select text
                        if (textSpan) {
                            const range = document.createRange();
                            range.selectNode(textSpan);
                            window.getSelection().removeAllRanges();
                            window.getSelection().addRange(range);
                        }
                    }
                };
            }

            // Back button
            const backBtn = document.getElementById('support-back-btn');
            if (backBtn) {
                backBtn.onclick = () => {
                    this.closeModal(); // Returns to welcome via stack
                };
            }

            // Close Button Handler
            if (closeBtn) {
                closeBtn.onclick = () => {
                    this.closeModal();
                    // Clean hash if closing the support modal
                    if (window.location.hash === '#support') {
                        history.pushState("", document.title, window.location.pathname + window.location.search);
                    }
                };
            }
        }

        showHelpHandler() {
            const modal = this.modals.help;

            // Close button
            const closeBtn = modal?.querySelector('.modal-close');
            if (closeBtn) {
                closeBtn.onclick = () => this.closeModal();
            }

            // "Got it" button
            const gotItBtn = document.getElementById('help-close-btn');
            if (gotItBtn) {
                gotItBtn.onclick = () => this.closeModal();
            }
        }

        showWelcomeHandler(options) {
            const modal = this.modals.welcome;

            // CNC card
            const cncCard = document.getElementById('pipeline-cnc');
            if (cncCard) {
                cncCard.onclick = (e) => {
                    e.preventDefault();
                    this.selectedPipeline = 'cnc';
                    this.controller.setPipeline('cnc');
                    this.closeModal();

                    const hideWelcome = localStorage.getItem(storageKeys.hideWelcome);
                    if (!hideWelcome) {
                        this.showModal('quickstart', options);
                    }
                };
            }

            // Laser card - opens laser config modal
            const laserCard = document.getElementById('pipeline-laser');
            if (laserCard) {
                laserCard.onclick = (e) => {
                    e.preventDefault();
                    this.selectedPipeline = 'laser';
                    this.closeModal();

                    const hideWelcome = localStorage.getItem(storageKeys.hideWelcome);
                    if (!hideWelcome) {
                        this.showModal('laserConfig', options);
                    }
                };
            }

            // Sponsor slots and CTA
            ['sponsor-slot-1', 'sponsor-slot-2', 'sponsor-slot-3', 'sponsor-contact-cta'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.onclick = (e) => {
                        e.preventDefault();
                        this.showModal('support');
                    };
                }
            });

            // Help link in footer
            const helpLink = document.getElementById('welcome-help-link');
            if (helpLink) {
                helpLink.onclick = (e) => {
                    e.preventDefault();
                    this.showModal('help');
                };
            }

            // Close button - same behavior as click-outside
            const closeBtn = modal?.querySelector('.modal-close');
            if (closeBtn) {
                closeBtn.onclick = () => this.handleClickOutside('welcome');
            }
        }

        showQuickstartHandler(options = {}) {
            const modal = this.modals.quickstart;

            // Get the modal content wrapper (to apply the mode class)
            const modalContent = modal.querySelector('.modal-content');

            // Determine pipeline State
            const pipeline = this.selectedPipeline || 'cnc';

            // Apply State
            modalContent.classList.remove('mode-cnc', 'mode-laser');
            modalContent.classList.add(`mode-${pipeline}`);

            // Reset file state
            this.quickstartFiles = {
                isolation: null,
                drill: null,
                clearing: null,
                cutout: null
            };

            // Initialize "don't show again" checkbox from stored preference
            const dontShowCheckbox = document.getElementById('dont-show-quickstart');
            if (dontShowCheckbox) {
                const hideWelcome = localStorage.getItem(storageKeys.hideWelcome);
                dontShowCheckbox.checked = !!hideWelcome;

                dontShowCheckbox.onchange = (e) => {
                    if (!e.target.checked) {
                        localStorage.removeItem(storageKeys.hideWelcome);
                        this.ui.showStatus('Quickstart will show on next visit', 'info');
                    }
                };
            }

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

            // Setup compact drop zones
            this.setupQuickstartDropZones();

            // Load example button
            const loadExampleBtn = document.getElementById('load-example-btn');
            if (loadExampleBtn) {
                loadExampleBtn.onclick = async () => {
                    const selectedExample = select?.value;
                    if (selectedExample && this.controller.loadExample) {
                        await this.controller.loadExample(selectedExample);
                        this.ui.renderer.core.zoomFit(true);
                    }
                    this.handleQuickstartClose();
                };
            }

            // Process files button
            const processBtn = document.getElementById('process-quickstart-files-btn');
            if (processBtn) {
                processBtn.disabled = true;
                processBtn.onclick = async () => {
                    await this.processQuickstartFiles();
                    this.handleQuickstartClose();
                };
            }

            // Start empty button
            const startEmptyBtn = document.getElementById('start-empty-btn');
            if (startEmptyBtn) {
                startEmptyBtn.onclick = () => this.handleQuickstartClose();
            }

            // Back button — pipeline-aware
            const backBtn = document.getElementById('quickstart-back-btn');
            if (backBtn) {
                backBtn.onclick = () => {
                    this.closeModal();
                    if (this.selectedPipeline === 'laser') {
                        this.showModal('laserConfig');
                    } else {
                        this.showModal('welcome');
                    }
                };
            }

            // Close button
            const closeBtn = modal?.querySelector('.modal-close');
            if (closeBtn) {
                closeBtn.onclick = () => this.handleQuickstartClose();
            }
        }

        setupQuickstartDropZones() {
            const opTypes = ['isolation', 'drill', 'clearing', 'cutout'];

            opTypes.forEach(opType => {
                const zone = document.getElementById(`qs-${opType}-zone`);
                if (!zone) return;

                const fileInput = zone.querySelector('input[type="file"]');
                const fileLabel = zone.querySelector('.zone-file');

                // Reset visual state
                zone.classList.remove('has-file', 'dragging');
                if (fileLabel) fileLabel.textContent = '';

                // Make keyboard accessible
                zone.setAttribute('tabindex', '0');
                zone.setAttribute('role', 'button');
                zone.setAttribute('aria-label', `Upload ${opType} file. Click or press Enter to browse.`);

                // Click to browse
                zone.onclick = () => fileInput?.click();

                // Keyboard: Enter or Space to browse
                zone.onkeydown = (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        fileInput?.click();
                    }
                };

                // File input change
                if (fileInput) {
                    fileInput.onchange = (e) => {
                        const file = e.target.files[0];
                        if (file) this.handleQuickstartFile(file, opType, zone);
                    };
                }

                // Drag events
                zone.ondragover = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    zone.classList.add('dragging');
                };

                zone.ondragleave = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    zone.classList.remove('dragging');
                };

                zone.ondrop = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    zone.classList.remove('dragging');
                    const file = e.dataTransfer.files[0];
                    if (file) this.handleQuickstartFile(file, opType, zone);
                };
            });
        }

        handleQuickstartFile(file, opType, zone) {
            const validation = this.controller.core?.validateFileType(file.name, opType);
            if (validation && !validation.valid) {
                this.ui.showStatus(validation.message, 'error');
                return;
            }

            this.quickstartFiles[opType] = file;

            // Update zone visual
            zone.classList.add('has-file');
            const fileLabel = zone.querySelector('.zone-file');
            if (fileLabel) {
                fileLabel.textContent = file.name;
            }

            this.updateQuickstartProcessButton();
        }

        updateQuickstartProcessButton() {
            const processBtn = document.getElementById('process-quickstart-files-btn');
            if (processBtn) {
                const hasFiles = Object.values(this.quickstartFiles).some(f => f !== null);
                processBtn.disabled = !hasFiles;
            }
        }

        async processQuickstartFiles() {
            for (const [type, file] of Object.entries(this.quickstartFiles)) {
                if (file) {
                    await this.controller.processFile(file, type);
                }
            }

            // Reset
            this.quickstartFiles = {
                isolation: null,
                drill: null,
                clearing: null,
                cutout: null
            };

            // Update UI
            if (this.ui?.navTreePanel) {
                this.ui.navTreePanel.expandAll();
            }

            if (this.ui?.renderer) {
                setTimeout(() => {
                    this.ui.renderer.core.zoomFit();
                }, 100);
            }
        }

        handleQuickstartClose() {
            // Check the "Don't show again" checkbox
            const dontShowCheckbox = document.getElementById('dont-show-quickstart');
            if (dontShowCheckbox && dontShowCheckbox.checked) {
                // Save preference to localStorage
                localStorage.setItem(storageKeys.hideWelcome, 'true');
            }

            // Actually close the modal
            this.closeModal();
        }

        updateProcessButton() {
            const processBtn = document.getElementById('process-files-btn');
            if (processBtn) {
                const hasFiles = Object.values(this.controller.uploadedFiles).some(f => f !== null);
                processBtn.disabled = !hasFiles;
            }
        }

        // Toolpath modal handler
        async showExportManagerHandler(options = {}) {
            const operations = options.operations || [];
            const highlightOperationId = options.highlightOperationId || null;

            this.debug(`Opening Export Manager with ${operations.length} operation(s)`);

            // Reset per-session state
            this.gcodeResults.clear();

            // Sync all toggle visibility with current DOM state
            const selectorDiv = document.getElementById('exporter-operation-selector');
            const singleFileCheck = document.getElementById('exporter-single-file');
            if (selectorDiv) {
                selectorDiv.style.display = (singleFileCheck && singleFileCheck.checked) ? 'none' : '';
            }
            this.updateSplitDrillVisibility();

            const getSortOrder = (opType) => {
                switch (opType) {
                    case 'isolation': return 1;
                    case 'laser_isolation': return 1;
                    case 'clearing':  return 2;
                    case 'drill':     return 3;
                    case 'cutout':    return 4;
                    case 'stencil':   return 99;
                    default:          return 5;
                }
            };

            this.selectedOperations = operations.sort((a, b) => getSortOrder(a.type) - getSortOrder(b.type));
            this.highlightedOpId = highlightOperationId;

            // Check which operations actually exist in this job
            this.jobHasLaser = this.selectedOperations.some(
                op => this.controller.isLaserExportForOperation(op.type)
            );
            this.jobHasCNC = this.selectedOperations.some(
                op => !this.controller.isLaserExportForOperation(op.type) && op.type !== 'stencil'
            );
            this.jobHasStencil = this.selectedOperations.some(
                op => op.type === 'stencil'
            );

            const laserOptions = document.getElementById('exporter-laser-options');
            const cncOptions = document.getElementById('exporter-cnc-options');
            const cncPreview = document.getElementById('exporter-cnc-preview');
            const stencilOptions = document.getElementById('exporter-stencil-options');
            const leftColumnWrapper = document.querySelector('.gcode-options');

            // Set the MACRO layout based on the job contents.
            // Use class toggles instead of inline display so the CSS grid layout stays in control.
            if (laserOptions) laserOptions.classList.toggle('is-hidden', !this.jobHasLaser);
            if (cncOptions) cncOptions.classList.toggle('is-hidden', !this.jobHasCNC);
            if (cncPreview) cncPreview.classList.toggle('is-hidden', !this.jobHasCNC);
            if (stencilOptions) stencilOptions.classList.toggle('is-hidden', !this.jobHasStencil);

            // Update the calculate button text and visibility based on job contents
            const calcBtn = document.getElementById('exporter-calculate-btn');
            if (calcBtn) {
                calcBtn.textContent = this.jobHasCNC ? 'Calculate Toolpaths' : 'Preview Export';
                calcBtn.classList.toggle('is-hidden', !this.jobHasCNC);
            }

            // Fix the grid sizing if CNC preview is completely gone
            if (leftColumnWrapper) {
                leftColumnWrapper.classList.toggle('is-full-width', !this.jobHasCNC);
            }

            this.populateExportOperationsList();

            const orderList = document.getElementById('exporter-operation-order');
            const isSingleFile = document.getElementById('exporter-single-file')?.checked === true;
            if (orderList) {
                orderList.classList.toggle('is-orderable', isSingleFile);
            }

            // Hide split-drills field entirely in laser-only jobs
            const splitDrillsField = document.getElementById('exporter-split-drills-field');
            if (splitDrillsField) {
                splitDrillsField.style.display = this.jobHasCNC ? '' : 'none';
            }

            this.updateExportBlocksVisibility();
            this.updateSplitDrillVisibility();
            this.setupExportHandlers();

            // Laser specific init (only if laser ops present)
            if (this.jobHasLaser) {
                const laserSettings = this.controller.core.settings.laser;

                // Populate the per-job padding input from persisted settings
                const paddingInput = document.getElementById('laser-exporter-padding');
                if (paddingInput) {
                    paddingInput.value = laserSettings.exportPadding ?? D.laser.exportPadding;
                }

                // Update profile summary label in the modal
                const activeProfile = laserSettings.profiles?.[laserSettings.activeProfile];
                const summaryLabel = document.getElementById('laser-profile-summary-label');
                if (summaryLabel && activeProfile) {
                    summaryLabel.textContent = activeProfile.label;
                }
            }

            // Stencil specific init (only if stencil ops present)
            if (this.jobHasStencil) {
                const stencilPaddingInput = document.getElementById('stencil-exporter-padding');
                if (stencilPaddingInput) {
                    const laserSettings = this.controller.core.settings.laser;
                    stencilPaddingInput.value = laserSettings.exportPadding ?? D.laser.exportPadding;
                }
            }

            // Update filename input with the correct extension for immediate visual feedback
            const filenameInput = document.getElementById('exporter-filename');
            if (filenameInput) {
                let ext = '.nc';

                if (this.jobHasLaser && !this.jobHasCNC) {
                    ext = this.controller.core.settings.laser.exportFormat === 'png' ? '.png' : '.svg';
                } else if (this.jobHasStencil && !this.jobHasCNC && !this.jobHasLaser) {
                    ext = '.svg';
                } else if (this.jobHasCNC) {
                    const postProcessor = this.controller.core.settings.gcode.postProcessor;
                    const processorInfo = this.controller.gcodeGenerator.getProcessorInfo(postProcessor);
                    ext = processorInfo.fileExtension;
                }

                const defaultBaseName = this.controller.core.settings.export.defaultBaseName;
                const currentName = filenameInput.value || defaultBaseName;
                const baseName = currentName.replace(/\.[^/.]+$/, ''); // Strip old extension if present
                filenameInput.value = `${baseName}${ext}`;
            }

            this.attachExporterModalTooltips();
        }

        populateExportOperationsList() {
            const list = document.getElementById('exporter-operation-order');
            if (!list) return;
            list.innerHTML = '';

            for (const op of this.selectedOperations) {
                const item = document.createElement('div');
                item.className = 'file-node-content';
                item.dataset.operationId = op.id;

                // Three-way route badge with format indicator
                let routeBadge;
                if (op.type === 'stencil') {
                    routeBadge = '<span class="exporter-route-badge exporter-route-badge--stencil">SVG</span>';
                } else if (this.controller.isLaserExportForOperation(op.type)) {
                    const laserFormat = (this.controller.core.settings.laser.exportFormat).toUpperCase();
                    routeBadge = `<span class="exporter-route-badge exporter-route-badge--laser">${laserFormat}</span>`;
                } else {
                    const postProcessor = this.controller.core.settings.gcode.postProcessor;
                    const processorInfo = window.pcbcam.gcodeGenerator.getProcessorInfo(postProcessor);
                    const ext = (processorInfo?.fileExtension).replace('.', '').toUpperCase();
                    routeBadge = `<span class="exporter-route-badge exporter-route-badge--cnc">${ext}</span>`;
                }

                item.innerHTML = `
                    <span class="tree-expand-icon drag-handle">${iconConfig.modalDragHandle}</span>
                    <input type="checkbox" class="exporter-op-checkbox" id="exp-check-${op.id}" checked>
                    <label for="exp-check-${op.id}">
                        ${op.type}: ${op.file.name}
                        ${routeBadge}
                    </label>
                `;

                // Re-evaluate visibility when checkboxes change
                const checkbox = item.querySelector('input');
                checkbox.addEventListener('change', () => {
                    this.updateExportBlocksVisibility();
                    this.updateSplitDrillVisibility();
                });

                // Stencils are always last and never reorderable
                if (op.type === 'stencil') {
                    item.dataset.locked = 'true';
                }

                list.appendChild(item);
            }

            this.makeSortable(list);
        }

        updateExportBlocksVisibility() {
            const cncOptions = document.getElementById('exporter-cnc-options');
            const cncPreview = document.getElementById('exporter-cnc-preview');
            const calcBtn = document.getElementById('exporter-calculate-btn');
            const laserOptions = document.getElementById('exporter-laser-options');
            const stencilOptions = document.getElementById('exporter-stencil-options');
            const list = document.getElementById('exporter-operation-order');

            let hasCheckedLaser = false;
            let hasCheckedCNC = false;
            let hasCheckedStencil = false;

            // Check what the user currently has checked
            if (list) {
                list.querySelectorAll('.file-node-content').forEach(item => {
                    const checkbox = item.querySelector('input[type="checkbox"]');
                    if (checkbox && checkbox.checked) {
                        const op = this.selectedOperations.find(o => o.id === item.dataset.operationId);
                        if (op) {
                            if (op.type === 'stencil') {
                                hasCheckedStencil = true;
                            } else if (this.controller.isLaserExportForOperation(op.type)) {
                                hasCheckedLaser = true;
                            } else {
                                hasCheckedCNC = true;
                            }
                        }
                    }
                });
            }

            // MICRO STATE: Disable (gray out) blocks if their corresponding ops are unchecked
            if (cncOptions) cncOptions.classList.toggle('is-disabled', !hasCheckedCNC);
            if (cncPreview) cncPreview.classList.toggle('is-disabled', !hasCheckedCNC);
            if (laserOptions) laserOptions.classList.toggle('is-disabled', !hasCheckedLaser);
            if (stencilOptions) stencilOptions.classList.toggle('is-disabled', !hasCheckedStencil);

            if (calcBtn) {
                calcBtn.disabled = !hasCheckedCNC;
            }
        }

        setupExportHandlers() {
            const cancelBtn = document.getElementById('exporter-cancel-btn');
            const executeBtn = document.getElementById('exporter-execute-btn');
            const calcBtn = document.getElementById('exporter-calculate-btn');
            const closeBtn = this.modals.exportManager?.querySelector('.modal-close');

            if (cancelBtn) cancelBtn.onclick = () => this.closeModal();
            if (closeBtn) closeBtn.onclick = () => this.closeModal();

            if (calcBtn) {
                calcBtn.onclick = () => this.runToolpathOrchestration(calcBtn);
            }

            const singleFileToggle = document.getElementById('exporter-single-file');
            if (singleFileToggle) {
                singleFileToggle.onchange = (e) => {
                    const selectorDiv = document.getElementById('exporter-operation-selector');
                    if (selectorDiv) {
                        selectorDiv.style.display = e.target.checked ? 'none' : '';
                    }
                    const orderList = document.getElementById('exporter-operation-order');
                    if (orderList) {
                        orderList.classList.toggle('is-orderable', e.target.checked);
                    }
                    this.updateSplitDrillVisibility();
                    this.gcodeResults.clear();
                    this.showPlaceholderPreview();
                };
            }

            // Preview selector: switch displayed G-code when user picks a different operation
            const previewSelect = document.getElementById('exporter-preview-select');
            if (previewSelect) {
                previewSelect.onchange = (e) => this.showGcodeForOperation(e.target.value);
            }

            if (executeBtn) {
                executeBtn.onclick = async () => {
                    await this.executeUnifiedExport();
                };
            }
        }

        async executeUnifiedExport() {
            const executeBtn = document.getElementById('exporter-execute-btn');
            const loadingOverlay = document.getElementById('loading-overlay');
            const loadingText = document.getElementById('loading-text');

            if (executeBtn) {
                executeBtn.disabled = true;
            }

            // Trigger the global wait spinner (with webkit delay context)
            const isWebKit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
            if (loadingOverlay) {
                if (loadingText) {
                    loadingText.textContent = isWebKit
                        ? 'Exporting Files — Pacing downloads in webkit...'
                        : 'Exporting Files...';
                }
                loadingOverlay.style.display = 'flex';
                loadingOverlay.style.opacity = '1';
                loadingOverlay.focus();
            }

            try {
            // Gather all checked operations
            const list = document.getElementById('exporter-operation-order');
            const activeOpIds = [];

            if (list) {
                list.querySelectorAll('.file-node-content').forEach(item => {
                    const checkbox = item.querySelector('input[type="checkbox"]');
                    if (checkbox && checkbox.checked) {
                        activeOpIds.push(item.dataset.operationId);
                    }
                });
            }

            // Safeguard: Did users uncheck everything?
            if (activeOpIds.length === 0) {
                this.ui.showStatus('No operations selected for export.', 'warning');
                return;
            }

            // Separate into pipelines & Get Shared Settings
            const laserOps = [];
            const cncOps = [];
            const stencilOps = [];

            activeOpIds.forEach(id => {
                const op = this.selectedOperations.find(o => o.id === id);
                if (op) {
                    if (op.type === 'stencil') {
                        stencilOps.push(op);
                    } else if (this.controller.isLaserExportForOperation(op.type)) {
                        laserOps.push(op);
                    } else {
                        cncOps.push(op);
                    }
                }
            });

            // Get shared settings
            let rawBaseName = document.getElementById('exporter-filename')?.value || 'pcb-output';
            const baseName = rawBaseName.replace(/\.[^/.]+$/, '');
            const isSingleFile = document.getElementById('exporter-single-file')?.checked === true;

            // WebKit (Safari, DuckDuckGo on Apple) blocks rapid programmatic downloads.
            // Other engines handle simultaneous downloads fine.
            const isWebKit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
            const downloadDelay = () => isWebKit
                ? new Promise(res => setTimeout(res, 500))
                : Promise.resolve();

            const downloadBlobRaw = (blob, filename) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 5000);
            };

            let cncSuccess = false;
            let laserSuccess = false;
            let stencilSuccess = false;

            // ════════════════════════════════════════════
            // CNC EXPORT (G-CODE / RML)
            // ════════════════════════════════════════════
            if (cncOps.length > 0) {
                const postProcessor = this.controller.core.settings.gcode.postProcessor;
                const processorInfo = window.pcbcam.gcodeGenerator.getProcessorInfo(postProcessor);
                const cncExt = processorInfo.fileExtension;

                const downloadBlob = (content, filename) => {
                    const blob = new Blob([content], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(() => URL.revokeObjectURL(url), 5000);
                }

                if (isSingleFile) {
                    let combinedResult = this.gcodeResults.get('__combined__');
                    if (!combinedResult || !combinedResult.gcode) {
                        this.ui.showStatus('Auto-calculating G-Code...', 'info');
                        const calcBtn = document.getElementById('exporter-calculate-btn');
                        await this.runToolpathOrchestration(calcBtn, cncOps);
                        combinedResult = this.gcodeResults.get('__combined__');
                    }

                    if (combinedResult?.gcode && !combinedResult.gcode.startsWith('; Generation Failed')) {
                        downloadBlob(combinedResult.gcode, `${baseName}${cncExt}`);
                        cncSuccess = true;
                    } else {
                        this.ui.showStatus('G-code generation failed.', 'error');
                    }
                } else {
                    if (this.gcodeResults.size === 0 || this.gcodeResults.has('__combined__')) {
                        this.ui.showStatus('Calculating individual G-Code files...', 'info');
                        const calcBtn = document.getElementById('exporter-calculate-btn');
                        await this.runToolpathOrchestration(calcBtn, cncOps);
                    }

                    cncSuccess = true;
                    for (const op of cncOps) {
                        const splitKeys = Array.from(this.gcodeResults.keys())
                            .filter(k => k.startsWith(`${op.id}_`));

                        if (splitKeys.length > 0) {
                            for (const key of splitKeys) {
                                const result = this.gcodeResults.get(key);
                                if (result?.gcode && !result.gcode.startsWith('; Generation Failed')) {
                                    const opCleanName = op.file.name.replace(/\.[^/.]+$/, '');
                                    const suffix = key.substring(op.id.length + 1).replace(/_/g, '-');
                                    downloadBlob(result.gcode, `${baseName}-${suffix}-${opCleanName}${cncExt}`);
                                    await downloadDelay();
                                } else {
                                    cncSuccess = false;
                                }
                            }
                        } else {
                            const result = this.gcodeResults.get(op.id);
                            if (result?.gcode && !result.gcode.startsWith('; Generation Failed')) {
                                const opCleanName = op.file.name.replace(/\.[^/.]+$/, '');
                                downloadBlob(result.gcode, `${baseName}-${op.type}-${opCleanName}${cncExt}`);
                                await downloadDelay();
                            } else {
                                cncSuccess = false;
                                this.ui.showStatus(`Failed to generate G-code for ${op.type}: ${op.file.name}`, 'error');
                            }
                        }
                    }
                }
            }

            // Export LASER (SVG / PNG)
            if (laserOps.length > 0) {
                const unreadyOps = laserOps.filter(op => !op.offsets || op.offsets.length === 0);
                if (unreadyOps.length > 0) {
                    const names = unreadyOps.map(o => o.file.name).join(', ');
                    this.ui.showStatus(`Cannot export: Generate paths for ${names} first.`, 'error');
                } else {
                    // All structural settings now come from the persisted core state, populated by the active laser profile in Machine Settings.
                    const laserSettings = this.controller.core.settings.laser;
                    const exportFormat = laserSettings.exportFormat || 'svg';

                    // Retrieve the active profile so it can pass its palette
                    const activeProfileKey = laserSettings.activeProfile || 'generic';
                    const activeProfile = laserSettings.profiles?.[activeProfileKey] || {};

                    // Per-job settings: padding is the only laser-specific value still in the modal
                    const paddingInput = document.getElementById('laser-exporter-padding');
                    const exportPadding = paddingInput ? parseFloat(paddingInput.value) : laserSettings.exportPadding;

                    // Persist padding for next session
                    this.controller.core?.updateSettings('laser', {
                        exportPadding: exportPadding
                    });

                    try {
                        const result = await this.controller.orchestrateLaserExport(laserOps, {
                            layerColors: laserSettings.layerColors,
                            format: exportFormat,
                            dpi: laserSettings.exportDPI,
                            padding: exportPadding,
                            singleFile: isSingleFile,
                            baseName: baseName,
                            // Profile-driven structural settings — read from persisted state
                            heatManagement: (laserSettings.heatManagement !== 'off' && exportFormat !== 'png')
                                ? laserSettings.heatManagement : 'off',
                            reverseCutOrder: laserSettings.reverseCutOrder || false,
                            svgGrouping: laserSettings.svgGrouping || 'layer',
                            colorPerPass: laserSettings.colorPerPass || false,
                            // Pass palette configurations
                            palette: activeProfile.palette || null,
                            paletteLumping: activeProfile.paletteLumping || false
                        });

                        if (result.success && result.files?.length > 0) {
                            for (const file of result.files) {
                                downloadBlobRaw(file.blob, file.filename);
                                await downloadDelay();
                            }
                            laserSuccess = true;
                            this.ui.showStatus(
                                result.files.length > 1
                                    ? `Exported ${result.files.length} laser files`
                                    : `Laser ${exportFormat.toUpperCase()} exported`,
                                'success'
                            );
                        } else {
                            this.ui.showStatus('Laser export produced no output — check that paths are generated.', 'error');
                        }
                    } catch (error) {
                        console.error('[ModalManager] Laser export failed:', error);
                        this.ui.showStatus('Laser export failed: ' + error.message, 'error');
                    }
                }
            }

            // Stencil export (always SVG, hardcoded settings)
            if (stencilOps.length > 0) {
                const unreadyOps = stencilOps.filter(op => !op.offsets || op.offsets.length === 0);
                if (unreadyOps.length > 0) {
                    const names = unreadyOps.map(o => o.file.name).join(', ');
                    this.ui.showStatus(`Cannot export: Generate stencil geometry for ${names} first.`, 'error');
                } else {
                    const stencilPaddingInput = document.getElementById('stencil-exporter-padding');
                    const exportPadding = stencilPaddingInput ? parseFloat(stencilPaddingInput.value) : 5.0;

                    try {
                        // Stencils reuse the LaserImageExporter backend with strict, hardcoded settings. No user-facing complexity needed.
                        const result = await this.controller.orchestrateLaserExport(stencilOps, {
                            layerColors: { stencil: '#000000' },
                            format: 'svg',
                            padding: exportPadding,
                            singleFile: isSingleFile,
                            baseName: baseName + '-stencil',
                            heatManagement: 'off',
                            reverseCutOrder: false,
                            svgGrouping: 'layer',
                            colorPerPass: false
                        });

                        if (result.success && result.files?.length > 0) {
                            for (const file of result.files) {
                                downloadBlobRaw(file.blob, file.filename);
                                await downloadDelay();
                            }
                            stencilSuccess = true;
                            this.ui.showStatus(`Stencil SVG exported`, 'success');
                        } else {
                            this.ui.showStatus('Stencil export produced no output — check that geometry is generated.', 'error');
                        }
                    } catch (error) {
                        console.error('[ModalManager] Stencil export failed:', error);
                        this.ui.showStatus('Stencil export failed: ' + error.message, 'error');
                    }
                }
            }

            if (cncSuccess || laserSuccess || stencilSuccess) {
                const parts = [];
                if (cncSuccess) parts.push('G-code');
                if (laserSuccess) parts.push('Laser');
                if (stencilSuccess) parts.push('Stencil');
                this.ui.showStatus(`${parts.join(' + ')} export completed successfully`, 'success');
                this.closeModal();
            } else if (cncOps.length === 0 && laserOps.length === 0 && stencilOps.length === 0) {
                this.ui.showStatus('No operations to export.', 'warning');
            }

            } finally {
                if (executeBtn) {
                    executeBtn.disabled = false;
                }

                // Hide the global wait spinner gracefully
                if (loadingOverlay) {
                    loadingOverlay.style.opacity = '0';
                    setTimeout(() => {
                        loadingOverlay.style.display = 'none';
                    }, 300); // Wait for fade-out before removing from flow
                }
            }
        }

        attachExporterModalTooltips() {
            if (!this.lang || !window.TooltipManager) return;

            // Manage Modal box
            if (!this.exporterModalTooltipsProcessed) {
                this.exporterModalTooltipsProcessed = new Set();
            }
            const processedLabels = this.exporterModalTooltipsProcessed;

            const attachTo = (inputId, tooltipKey) => {
                const input = document.getElementById(inputId);
                if (!input) return;

                const label = input.closest('.property-field, .field-group')?.querySelector('label');
                if (label) {
                    // Check if modal already has tooltips
                    if (processedLabels.has(label)) {
                        return;
                    }
                    processedLabels.add(label);

                    const text = this.lang.get(tooltipKey);
                    const title = label.textContent; // Use the label text as title
                    
                    if (text) {
                        // This will create the '?' icon
                        window.TooltipManager.attachWithIcon(label, { title: title, text: text }, {
                            showOnFocus: true
                        });
                    }
                }
            };

            // Find the "Processing Order" <h3> and attach a tooltip to its help text
            const orderHelp = document.querySelector('#exporter-operation-order + .help-text');
            if (orderHelp) {
                 const text = this.lang.get('tooltips.modals.exporter.order');
                 if (text) {
                    window.TooltipManager.attach(orderHelp, { title: "Processing Order", text: text }, { immediate: true });
                    orderHelp.classList.add('has-help');
                 }
            }

            // Attach to checkboxes and inputs
            attachTo('exporter-include-comments', 'tooltips.modals.exporter.includeComments');
            attachTo('exporter-tool-changes', 'tooltips.modals.exporter.toolChanges');
            attachTo('exporter-optimize-paths', 'tooltips.modals.exporter.optimize');
            attachTo('exporter-single-file', 'tooltips.modals.exporter.singleFile');
            attachTo('exporter-split-drills', 'tooltips.modals.exporter.splitDrills');
            attachTo('exporter-filename', 'tooltips.modals.exporter.filename');
            attachTo('laser-exporter-padding', 'tooltips.machineSettings.laserExportPadding');
            attachTo('laser-exporter-dpi', 'tooltips.machineSettings.laserExportDPI');
            attachTo('stencil-exporter-padding', 'tooltips.machineSettings.stencilExportPadding');

            // Attach to calculate button
            const calcBtn = document.getElementById('exporter-calculate-btn');
            if (calcBtn) {
                 const text = this.lang.get('tooltips.modals.exporter.calculate');
                 if (text) {
                    window.TooltipManager.attach(calcBtn, { title: "Calculate Toolpaths", text: text }, { immediate: true });
                 }
            }
        }

        createOperationItem(operation) {
            const item = document.createElement('div');
            item.className = 'file-node-content';
            item.dataset.operationId = operation.id;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = true;
            checkbox.id = `op-check-${operation.id}`;

            const dragHandle = document.createElement('span');
            dragHandle.className = 'tree-expand-icon'; // Was 'drag-handle'
            dragHandle.innerHTML = iconConfig.modalDragHandle;

            const label = document.createElement('label');
            label.htmlFor = checkbox.id;
            label.className = 'file-label'; // Was part of the item
            label.textContent = `${operation.type}: ${operation.file.name}`;

            // Clear default field children and rebuild
            item.innerHTML = ''; 
            item.appendChild(dragHandle);
            item.appendChild(checkbox);
            item.appendChild(label);

            // Show key parameters
            const params = document.createElement('div');
            params.className = 'geometry-info';

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
            let grabbedItem = null;

            // Mouse drag support — only when ordering is active and item isn't locked
            container.addEventListener('dragstart', (e) => {
                if (!container.classList.contains('is-orderable')) {
                    e.preventDefault();
                    return;
                }
                const targetItem = e.target.closest('.file-node-content');
                if (targetItem && container.contains(targetItem) && !targetItem.dataset.locked) {
                    draggedItem = targetItem;
                    draggedItem.classList.add('dragging');
                    e.dataTransfer.effectAllowed = 'move';
                } else {
                    e.preventDefault();
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
                    // Don't append after locked items — insert before the first locked one
                    const firstLocked = container.querySelector('.file-node-content[data-locked="true"]');
                    if (firstLocked) {
                        container.insertBefore(draggedItem, firstLocked);
                    } else {
                        container.appendChild(draggedItem);
                    }
                } else if (afterElement.dataset.locked) {
                    // Don't insert after a locked item
                    container.insertBefore(draggedItem, afterElement);
                } else {
                    container.insertBefore(draggedItem, afterElement);
                }
            });

            // Make items draggable and keyboard accessible
            container.querySelectorAll('.file-node-content').forEach((item, idx) => {
                item.draggable = true;
                item.setAttribute('tabindex', idx === 0 ? '0' : '-1');
                item.setAttribute('role', 'listitem');
                item.setAttribute('aria-grabbed', 'false');
            });

            // Keyboard sorting
            container.addEventListener('keydown', (e) => {
                const focused = document.activeElement;
                if (!focused || !focused.classList.contains('file-node-content')) return;
                if (!container.contains(focused)) return;

                const items = Array.from(container.querySelectorAll('.file-node-content'));
                const isGrabbed = focused.getAttribute('aria-grabbed') === 'true';

                // Space: Toggle grab (only in orderable mode, never on locked items)
                if (e.key === ' ') {
                    e.preventDefault();

                    if (!container.classList.contains('is-orderable') || focused.dataset.locked) return;

                    if (isGrabbed) {
                        // Drop
                        focused.setAttribute('aria-grabbed', 'false');
                        focused.classList.remove('is-grabbed');
                        grabbedItem = null;
                        this.ui.showStatus('Item placed', 'info');
                    } else {
                        // Grab - release any other grabbed item first
                        items.forEach(item => {
                            item.setAttribute('aria-grabbed', 'false');
                            item.classList.remove('is-grabbed');
                        });
                        focused.setAttribute('aria-grabbed', 'true');
                        focused.classList.add('is-grabbed');
                        grabbedItem = focused;
                        this.ui.showStatus('Item grabbed. Use Up/Down to move, Space to place.', 'info');
                    }
                }

                // Arrow navigation / reordering
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const idx = items.indexOf(focused);
                    const targetIdx = e.key === 'ArrowDown' ? idx + 1 : idx - 1;

                    if (isGrabbed) {
                        // Reorder — but never past locked items
                        const sibling = e.key === 'ArrowDown' ? focused.nextElementSibling : focused.previousElementSibling;
                        if (sibling && sibling.classList.contains('file-node-content') && !sibling.dataset.locked) {
                            if (e.key === 'ArrowUp') {
                                container.insertBefore(focused, sibling);
                            } else {
                                container.insertBefore(sibling, focused);
                            }
                            focused.focus();
                        }
                    } else {
                        // Navigate
                        if (items[targetIdx]) {
                            focused.setAttribute('tabindex', '-1');
                            items[targetIdx].setAttribute('tabindex', '0');
                            items[targetIdx].focus();
                        }
                    }
                }

                // Escape: Cancel grab
                if (e.key === 'Escape' && isGrabbed) {
                    e.preventDefault();
                    e.stopPropagation();
                    focused.setAttribute('aria-grabbed', 'false');
                    focused.classList.remove('is-grabbed');
                    grabbedItem = null;
                    this.ui.showStatus('Reorder cancelled', 'info');
                }
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

        async runToolpathOrchestration(btn, explicitOps = null) {
            const originalText = btn.textContent;
            btn.textContent = 'Calculating...';
            btn.disabled = true;

            try {
                // Determine which CNC ops to calculate
                let selectedItemIds = [];
                if (explicitOps) {
                    selectedItemIds = explicitOps.map(o => o.id);
                } else {
                    const list = document.getElementById('exporter-operation-order');
                    list.querySelectorAll('.file-node-content').forEach(item => {
                        const checkbox = item.querySelector('input[type="checkbox"]');
                        const op = this.selectedOperations.find(o => o.id === item.dataset.operationId);
                        // Only calculate G-code for CNC ops (exclude both laser and stencil)
                    if (checkbox?.checked && !this.controller.isLaserExportForOperation(op.type) && op.type !== 'stencil') {
                            selectedItemIds.push(item.dataset.operationId);
                        }
                    });
                }

                if (selectedItemIds.length === 0) {
                    this.ui.showStatus('No CNC operations selected for calculation', 'info');
                    return;
                }

                // Validate all have previews
                const selectedOps = selectedItemIds
                    .map(id => this.selectedOperations.find(o => o.id === id))
                    .filter(Boolean);

                const opsWithoutPreview = selectedOps.filter(op => !op.preview || !op.preview.ready);
                if (opsWithoutPreview.length > 0) {
                    this.showPlaceholderPreview();
                    const names = opsWithoutPreview.map(o => o.file.name).join(', ');
                    this.ui.showStatus(
                        `Operations missing Preview: ${names}. Please generate previews first.`,
                        'warning'
                    );
                    return;
                }

                // Shared options
                const optimizeCheckbox = document.getElementById('exporter-optimize-paths');
                const baseOptions = {
                    safeZ: this.controller.core?.getSetting('machine', 'safeZ'),
                    travelZ: this.controller.core?.getSetting('machine', 'travelZ'),
                    rapidFeedRate: this.controller.core?.getSetting('machine', 'rapidFeed'),
                    postProcessor: this.controller.core?.getSetting('gcode', 'postProcessor'),
                    includeComments: document.getElementById('exporter-include-comments')?.checked,
                    toolChanges: document.getElementById('exporter-tool-changes')?.checked,
                    optimize: optimizeCheckbox ? optimizeCheckbox.checked : true
                };

                const isSingleFile = document.getElementById('exporter-single-file')?.checked === true;

                if (isSingleFile) {
                    // ── COMBINED: one orchestration call, one result ──
                    const options = {
                        ...baseOptions,
                        operationIds: selectedItemIds,
                        operations: this.selectedOperations,
                        singleFile: true
                    };

                    const result = await this.controller.orchestrateToolpaths(options);

                    if (!result || !result.gcode) {
                        this.showPlaceholderPreview();
                        this.ui.showStatus('Calculation returned no G-code', 'warning');
                        return;
                    }

                    // Store as a single combined result
                    this.gcodeResults.clear();
                    this.gcodeResults.set('__combined__', result);

                    this.showGcodeForOperation('__combined__');

                    const planCountEl = document.getElementById('exporter-op-count');
                    if (planCountEl) planCountEl.textContent = result.planCount;

                } else {
                    // ── PER-OPERATION: one call per op, populate selector ──
                    this.gcodeResults.clear();
                    const previewSelect = document.getElementById('exporter-preview-select');
                    if (previewSelect) previewSelect.innerHTML = '';

                    for (const opId of selectedItemIds) {
                        const op = this.selectedOperations.find(o => o.id === opId);
                        if (!op) continue;

                        // Check if this drill op should be split
                        const isDrill = op.type === 'drill';
                        const splitDrillsChecked = document.getElementById('exporter-split-drills')?.checked === true;
                        const shouldSplitDrill = isDrill && splitDrillsChecked && !document.getElementById('exporter-split-drills')?.disabled;

                        if (shouldSplitDrill) {
                            const { milledPrimitives, peckGroups } = this.controller._groupDrillPrimitives(op);

                            // Helper: swap preview, orchestrate, restore
                            const orchestrateWithPrimitives = async (primitives, resultKey, label) => {
                                const savedPreview = op.preview;
                                const savedOffsets = op.offsets;
                                op.preview = { ...savedPreview, primitives, ready: true };
                                op.offsets = [{ ...savedOffsets[0], primitives }];
                                try {
                                    const result = await this.controller.orchestrateToolpaths({
                                        ...baseOptions,
                                        operationIds: [op.id],
                                        operations: [op],
                                        singleFile: false
                                    });
                                    if (result?.gcode && !result.gcode.startsWith('; Generation Failed')) {
                                        this.gcodeResults.set(resultKey, result);
                                        if (previewSelect) {
                                            const opt = document.createElement('option');
                                            opt.value = resultKey;
                                            opt.textContent = label;
                                            previewSelect.appendChild(opt);
                                        }
                                    }
                                } finally {
                                    op.preview = savedPreview;
                                    op.offsets = savedOffsets;
                                }
                            };

                            // Milled paths as one group (if any)
                            if (milledPrimitives.length > 0) {
                                await orchestrateWithPrimitives(
                                    milledPrimitives,
                                    `${opId}_milled`,
                                    `drill milled: ${op.file.name} (${milledPrimitives.length} paths)`
                                );
                            }

                            // Peck groups split by diameter
                            for (const group of peckGroups) {
                                await orchestrateWithPrimitives(
                                    group.primitives,
                                    `${opId}_drill_${group.diameter}mm`,
                                    `drill ${group.diameter}mm: ${op.file.name} (${group.primitives.length} holes)`
                                );
                            }

                        } else {
                            // Standard single-result processing
                            const perOpOptions = {
                                ...baseOptions,
                                operationIds: [opId],
                                operations: [op],
                                singleFile: false
                            };
                            const result = await this.controller.orchestrateToolpaths(perOpOptions);
                            if (result?.gcode && !result.gcode.startsWith('; Generation Failed')) {
                                this.gcodeResults.set(opId, result);
                                if (previewSelect) {
                                    const opt = document.createElement('option');
                                    opt.value = opId;
                                    opt.textContent = `${op.type}: ${op.file.name}`;
                                    previewSelect.appendChild(opt);
                                }
                            } else {
                                this.ui.showStatus(`Failed to calculate ${op.type}: ${op.file.name}`, 'error');
                            }
                        }
                    }

                    // Show first operation's result
                    if (previewSelect && previewSelect.options.length > 0) {
                        previewSelect.value = previewSelect.options[0].value;
                        this.showGcodeForOperation(previewSelect.value);
                    } else {
                        this.showPlaceholderPreview();
                    }
                }

            } catch (error) {
                console.error('[UI-ModalManager] Orchestration failed:', error);
                this.showPlaceholderPreview();
                this.ui.showStatus(`Failed: ${error.message}`, 'error');
            } finally {
                // Restore button
                btn.textContent = originalText;
                btn.disabled = false;
            }
        }

        setupFocusTrap(modal) {
            const focusableSelector = 
                'button:not([disabled]), [href]:not([disabled]), input:not([disabled]), ' +
                'select:not([disabled]), textarea:not([disabled]), ' +
                '[tabindex]:not([tabindex="-1"])';

            // Store for trap logic
            this._currentModalFocusables = () => {
                return Array.from(modal.querySelectorAll(focusableSelector));
            };

            // Trap focus - handles both initial entry and cycling
            this.focusTrapListener = (e) => {
                if (e.key !== 'Tab') return;

                const focusables = this._currentModalFocusables();
                if (focusables.length === 0) return;

                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                const current = document.activeElement;

                // Check if focus is currently inside this modal
                const focusInModal = modal.contains(current);

                if (!focusInModal) {
                    // First Tab press - enter the modal
                    e.preventDefault();
                    if (e.shiftKey) {
                        last.focus();
                    } else {
                        first.focus();
                    }
                    return;
                }

                // Normal cycling within modal
                if (e.shiftKey && current === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && current === last) {
                    e.preventDefault();
                    first.focus();
                }
            };

            // Listen on document to catch Tab when focus is outside modal
            document.addEventListener('keydown', this.focusTrapListener);
        }

        removeFocusTrap() {
            if (this.focusTrapListener) {
                document.removeEventListener('keydown', this.focusTrapListener);
                this.focusTrapListener = null;
            }
            this._currentModalFocusables = null;
        }

        setupModalFieldNavigation(modal) {
            const content = modal.querySelector('.modal-content');
            if (!content) return;

            content.addEventListener('keydown', (e) => {
                // Only handle arrows
                if (!['ArrowUp', 'ArrowDown'].includes(e.key)) return;

                const focused = document.activeElement;

                // Skip if in select (let native handle), textarea and number
                if (focused.tagName === 'SELECT' || focused.tagName === 'TEXTAREA' || focused.type === 'number') return;

                // Get all navigable fields
                const fields = Array.from(content.querySelectorAll(
                    'input:not([type="hidden"]):not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex="0"]'
                )).filter(el => el.offsetParent !== null); // visible only

                const idx = fields.indexOf(focused);
                if (idx === -1) return;

                const nextIdx = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
                if (fields[nextIdx]) {
                    e.preventDefault();
                    fields[nextIdx].focus();
                }
            });
        }

        // Warning modal
        showWarning(title, message, options = {}) {
            const { onConfirm, onCancel, confirmText = 'OK', cancelText = 'Cancel', bodyHTML = null } = options;

            const modal = this.modals.warning;
            if (!modal) {
                console.error('[ModalManager] Warning modal not found in DOM');
                return;
            }

            // Set content
            modal.querySelector('.warning-title').textContent = title;

            const bodyContainer = modal.querySelector('.warning-body');
            if (bodyHTML) {
                bodyContainer.innerHTML = bodyHTML;
            } else {
                bodyContainer.innerHTML = '';
                const p = document.createElement('p');
                p.className = 'warning-message';
                p.textContent = message;
                bodyContainer.appendChild(p);
            }

            // Setup buttons
            const confirmBtn = modal.querySelector('.warning-confirm');
            confirmBtn.textContent = confirmText;
            confirmBtn.disabled = false;
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

            const closeBtn = modal.querySelector('.modal-close');
            if (closeBtn) {
                closeBtn.onclick = () => {
                    if (onCancel) onCancel();
                    this.closeModal();
                };
            }

            this.showModal('warning');
        }

        debug(message, data = null) {
            if (this.ui.debug) {
                this.ui.debug(`[UI-ModalManager] ${message}`, data);
            }
        }
    }

    window.ModalManager = ModalManager;
})();