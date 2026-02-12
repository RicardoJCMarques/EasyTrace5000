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

    const config = window.PCBCAMConfig ;
    const debugConfig = config.debug;
    const textConfig = config.ui.text;
    const iconConfig = config.ui.icons;
    const storageKeys = config.storageKeys;

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
                quickstart: document.getElementById('quickstart-modal'),
                gcode: document.getElementById('gcode-export-modal'),
                support: document.getElementById('support-modal'),
                help: document.getElementById('help-modal')
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
            this.toolpathPlans = new Map();

            this.init();
        }

        init() {
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.activeModal) {
                    e.preventDefault();
                    e.stopPropagation();

                    // Special case: welcome modal goes to quickstart, not closes
                    if (this.activeModal === this.modals.welcome) {
                        this.handleClickOutside('welcome');
                    } else {
                        // All other modals: just close (stack handles the rest)
                        this.closeModal();
                    }
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
            if (modalName === 'welcome') {
                // Transition to quickstart instead of closing everything
                this.activeModal?.classList.remove('active');
                this.activeModal = null;
                this.modalStack = [];
                
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
                    this.closeModal();

                    const hideWelcome = localStorage.getItem(storageKeys.hideWelcome);
                    if (!hideWelcome) {
                        this.showModal('quickstart', options);
                    }
                };
            }

            // Laser card - opens support modal
            const laserCard = document.getElementById('pipeline-laser');
            if (laserCard) {
                laserCard.onclick = (e) => {
                    e.preventDefault();
                    this.showModal('support');
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
                        this.ui?.statusManager?.showStatus('Quickstart will show on next visit', 'info');
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

            // Back button
            const backBtn = document.getElementById('quickstart-back-btn');
            if (backBtn) {
                backBtn.onclick = () => {
                    this.closeModal();
                    this.showModal('welcome');
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
                this.ui?.statusManager?.showStatus(validation.message, 'error');
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
        showToolpathModal(operations, highlightOperationId = null) {
            this.debug(`Opening toolpath manager with ${operations.length} operation(s)`);

            // Helper function to get the desired sort order
            const getSortOrder = (opType) => {
                switch (opType) {
                    case 'isolation': return 1;
                    case 'clearing':  return 2;
                    case 'drill':     return 3;
                    case 'cutout':    return 4;
                    default:          return 0; // Put any other types (if they exist) first
                }
            };

            // Sort the incoming operations array based on the priority
            const sortedOperations = operations.sort((a, b) => {
                return getSortOrder(a.type) - getSortOrder(b.type);
            });

            // Store the *sorted* operations
            this.selectedOperations = sortedOperations;
            this.highlightedOpId = highlightOperationId;
            this.toolpathPlans.clear();

            this.attachGcodeModalTooltips();

            // Get the modal's dropdown
            const modalPostSelect = document.getElementById('gcode-post-processor');
            
            // Get the *current* setting from the core
            const currentPost = this.controller.core?.getSetting('gcode', 'postProcessor') || 'grbl';

            if (modalPostSelect) {
                // Populate it (if it's empty)
                if (modalPostSelect.options.length === 0) {
                    const options = config.ui?.parameterOptions?.postProcessor || [{ value: 'grbl', label: 'GRBL (Default)' }];
                    options.forEach(opt => {
                        const optionEl = document.createElement('option');
                        optionEl.value = opt.value;
                        optionEl.textContent = opt.label;
                        modalPostSelect.appendChild(optionEl);
                    });
                }

                // Set its value to match the core setting
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

            // UI Polish: Disable incompatible options for Roland
            const commentsCheckbox = document.getElementById('gcode-include-comments');
            const toolChangeCheckbox = document.getElementById('gcode-tool-changes'); // Optional: Roland handles TCs differently

            if (commentsCheckbox) {
                if (currentPost === 'roland') {
                    // Disable and uncheck to prevent RML errors
                    commentsCheckbox.checked = false;
                    commentsCheckbox.disabled = true;
                    commentsCheckbox.parentElement.title = "Comments are disabled for Roland RML to prevent syntax errors.";
                    commentsCheckbox.parentElement.classList.add('disabled-control'); // Add visual cue if you have CSS for it
                } else {
                    // Restore defaults for G-code
                    commentsCheckbox.disabled = false;
                    commentsCheckbox.checked = true; // Or restore from settings
                    commentsCheckbox.parentElement.title = "";
                    commentsCheckbox.parentElement.classList.remove('disabled-control');
                }
            }

            this.populateToolpathModal();

            this.showPlaceholderPreview();

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

            // Clear the other list (gcode-operation-list) in case it had old content // Review - Does the operation-list data-structure still exist?
            const checklist = document.getElementById('gcode-operation-list');
            if (checklist) {
                checklist.innerHTML = ''; // This list is not used by this function
            }

            // Initialize checkbox state from config
            const optimizeCheckbox = document.getElementById('gcode-optimize-paths');
            if (optimizeCheckbox && config.gcode) {
                // Use the master switch 'enableOptimization'
                optimizeCheckbox.checked = config.gcode.enableOptimization;
            }
        }

        createOperationItem(operation) { // Review - There shouldn't be any CSS here
            const item = document.createElement('div');
            item.className = 'file-node-content';
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
            params.className = 'geometry-info';
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
            let grabbedItem = null;

            // Mouse drag support (existing)
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

                // Space: Toggle grab
                if (e.key === ' ') {
                    e.preventDefault();

                    if (isGrabbed) {
                        // Drop
                        focused.setAttribute('aria-grabbed', 'false');
                        focused.classList.remove('is-grabbed');
                        grabbedItem = null;
                        this.ui?.statusManager?.showStatus('Item placed', 'info');
                    } else {
                        // Grab - release any other grabbed item first
                        items.forEach(item => {
                            item.setAttribute('aria-grabbed', 'false');
                            item.classList.remove('is-grabbed');
                        });
                        focused.setAttribute('aria-grabbed', 'true');
                        focused.classList.add('is-grabbed');
                        grabbedItem = focused;
                        this.ui?.statusManager?.showStatus('Item grabbed. Use Up/Down to move, Space to place.', 'info');
                    }
                }

                // Arrow navigation / reordering
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const idx = items.indexOf(focused);
                    const targetIdx = e.key === 'ArrowDown' ? idx + 1 : idx - 1;

                    if (isGrabbed) {
                        // Reorder
                        const sibling = e.key === 'ArrowDown' ? focused.nextElementSibling : focused.previousElementSibling;
                        if (sibling && sibling.classList.contains('file-node-content')) {
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
                    this.ui?.statusManager?.showStatus('Reorder cancelled', 'info');
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

        async runToolpathOrchestration(btn) {
            // Show loading state
            const originalText = btn.textContent;
            btn.textContent = 'Calculating...';
            btn.disabled = true;

            try {
                // Find the correct list and items
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

                // Validate operations
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

                // Gather options
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
                    optimize: optimizeCheckbox ? optimizeCheckbox.checked : true
                };

                // Run orchestration
                const result = await this.controller.orchestrateToolpaths(options);

                if (!result || !result.gcode) {
                    this.showPlaceholderPreview();
                    this.ui?.statusManager?.showStatus('Calculation returned no G-code', 'warning');
                    return;
                }

                // Display results
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
                // Restore button
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

            // Check if the content is exactly the placeholder
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

                // Skip if in select (let native handle) or textarea
                if (focused.tagName === 'SELECT' || focused.tagName === 'TEXTAREA') return;

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