/**
 * @file        ui/ui-controls.js
 * @description Manages the user interactivity
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

    const config = window.PCBCAMConfig;
    const debugConfig = config.debug;
    const renderDefaults = config.rendering?.defaultOptions;

    class UIControls {
        constructor(ui) {
            this.ui = ui;
            this.lang = ui.lang
            this.renderer = null;
            this.coordinateSystem = null;

            // Input tracking
            this.inputTracking = {
                lastXValue: '0',
                lastYValue: '0'
            };
        }

        setupFocusZones() {
            // Define zones - canvas excluded from cycling
            this.focusZones = [
                { id: 'cam-toolbar', selector: '#cam-toolbar' },
                { id: 'sidebar-left', selector: '#sidebar-left' },
                { id: 'sidebar-right', selector: '#sidebar-right' }
            ];
            this.currentZoneIndex = 1;
            this.lastFocusedPerZone = new Map();

            document.addEventListener('keydown', (e) => {
                if (e.key === 'F6') {
                    // Don't cycle if modal is open
                    if (window.pcbcam?.modalManager?.activeModal) return;

                    e.preventDefault();
                    this.cycleZone(e.shiftKey ? -1 : 1);
                }
            });
        }

        cycleZone(direction) {
            const currentZone = this.focusZones[this.currentZoneIndex];
            if (currentZone && document.activeElement) {
                const zoneEl = document.querySelector(currentZone.selector);
                if (zoneEl && zoneEl.contains(document.activeElement)) {
                    this.lastFocusedPerZone.set(currentZone.id, document.activeElement);
                }
            }

            this.currentZoneIndex = (this.currentZoneIndex + direction + this.focusZones.length) % this.focusZones.length;
            const nextZone = this.focusZones[this.currentZoneIndex];
            const zoneEl = document.querySelector(nextZone.selector);
            if (!zoneEl) return;

            const lastFocused = this.lastFocusedPerZone.get(nextZone.id);
            if (lastFocused && document.body.contains(lastFocused)) {
                lastFocused.focus();
                return;
            }

            // Find first focusable - never auto-focus canvas
            const focusTarget = zoneEl.querySelector(
                '[tabindex="0"]:not(canvas), button:not([disabled]), input:not([disabled]), select:not([disabled])'
            );
            if (focusTarget) focusTarget.focus();
        }

        findZoneFocusTarget(container, zoneId) {
            // Canvas is directly focusable
            if (zoneId === 'preview-canvas') {
                container.setAttribute('tabindex', '0');
                return container;
            }

            // Priority: Element with tabindex="0" (roving tabindex active item)
            const activeItem = container.querySelector('[tabindex="0"]:not([disabled])');
            if (activeItem) return activeItem;

            // Fallback: First interactive element
            return container.querySelector(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
            );
        }

        init(renderer, coordinateSystem) {
            this.renderer = renderer;
            this.coordinateSystem = coordinateSystem;

            this.debug("Initializing controls...");

            this.setupFocusZones();

            // Directly call setup methods to attach listeners
            this.setupVisualizationToggles();
            this.setupOffsetControls();
            this.setupRotationControls();
            this.setupMirrorControls();
            this.setupZoomControls();
            this.setupCollapsibleMenus();
            this.setupVizPanelButton();
            this.setupMachineSettings();
            this.setupSidebarSectionNavigation();
            this.attachStaticTooltips();

            // Link coordinate system changes back to UI updates
            if (this.coordinateSystem) {
                this.coordinateSystem.addChangeListener(() => {
                    this.updateOffsetInputsWithTracking();
                });
            }

            this.debug("Controls initialized.");
            return true;
        }

        attachStaticTooltips() {
            if (!this.lang || !window.TooltipManager) return;

            const processedLabels = new Set();

            // Helper to find the label for an input
            const attachTo = (inputId, tooltipKey) => {
                const input = document.getElementById(inputId);
                if (!input) return;

                // Find the label associated with this input
                const label = document.querySelector(`label[for="${inputId}"]`) || 
                            input.closest('.property-field, .sidebar-section')?.querySelector('label');

                if (label) {
                    // Check if this input's label already has a tooltip
                    if (processedLabels.has(label)) {
                        return; // Tooltip already attached to this label
                    }
                    processedLabels.add(label); // Mark this label as processed

                    const text = this.lang.get(tooltipKey);

                    // Try to get a title from the 'parameters' section, fallback to label text
                    const titleKey = tooltipKey.replace('tooltips.', 'parameters.');
                    const title = this.lang.get(titleKey, label.textContent);

                    if (text) {
                        // This will create the '?' tooltip icon
                        window.TooltipManager.attachWithIcon(label, { title: title, text: text }, {
                            showOnFocus: true
                        });
                    }
                }
            };

            // Helper for standalone labels (not associated with inputs)
            const attachToLabel = (labelId, tooltipKey) => {
                const label = document.getElementById(labelId);
                if (!label || processedLabels.has(label)) return;

                processedLabels.add(label);
                const text = this.lang.get(tooltipKey);
                const title = label.textContent?.trim() || 'Mirror Geometry';

                if (text) {
                    window.TooltipManager.attachWithIcon(label, { title: title, text: text }, {
                        showOnFocus: true
                    });
                }
            };

            // Origin Controls
            attachTo('x-offset', 'tooltips.originControls.originOffset');
            attachTo('y-offset', 'tooltips.originControls.originOffset');
            attachTo('rotation-angle', 'tooltips.originControls.boardRotation');

            // Mirror Controls
            attachToLabel('mirrorGeometry', 'tooltips.originControls.mirrorGeometry');

            // Machine Settings
            attachTo('pcb-thickness', 'tooltips.machineSettings.pcbThickness');
            attachTo('safe-z', 'tooltips.machineSettings.safeZ');
            attachTo('travel-z', 'tooltips.machineSettings.travelZ');
            attachTo('rapid-feed', 'tooltips.machineSettings.rapidFeed');
            attachTo('post-processor', 'tooltips.machineSettings.postProcessor');
            attachTo('gcode-units', 'tooltips.machineSettings.gcodeUnits');

            // Visualization Panel Toggles
            attachTo('show-grid', 'tooltips.vizPanel.grid');
            attachTo('show-wireframe', 'tooltips.vizPanel.wireframe');
            attachTo('show-bounds', 'tooltips.vizPanel.boardBounds');
            attachTo('show-rulers', 'tooltips.vizPanel.rulers');
            attachTo('show-offsets', 'tooltips.vizPanel.offsets');
            attachTo('show-previews', 'tooltips.vizPanel.previews');
            attachTo('fuse-geometry', 'tooltips.vizPanel.fusionMode');
            attachTo('show-preprocessed', 'tooltips.vizPanel.preprocessed');
            attachTo('enable-arc-reconstruction', 'tooltips.vizPanel.arcReconstruction');
            attachTo('debug-points', 'tooltips.vizPanel.debugPoints');
            attachTo('debug-arcs', 'tooltips.vizPanel.debugArcs');
            attachTo('black-and-white', 'tooltips.vizPanel.bwMode');
            attachTo('debug-log-toggle', 'tooltips.vizPanel.verboseDebug');
        }

        /**
         * Sets up visualization toggles using event delegation and declarative data attributes from the HTML
         */
        setupVisualizationToggles() {
            if (!this.renderer) return;

            this.debug("Setting up visualization toggles...");
            const vizControls = document.getElementById('viz-controls');
            if (!vizControls) {
                console.warn("[UIControls] Visualization panel 'viz-controls' not found.");
                return;
            }

            // Set Initial State
            // Iterate over all checkboxes with a [data-option]
            vizControls.querySelectorAll('input[type="checkbox"][data-option]').forEach(el => {
                const option = el.dataset.option;
                if (option && renderDefaults[option] !== undefined) {
                    const initialState = renderDefaults[option];
                    el.checked = initialState;
                    // Sync the renderer's options to this default
                    this.renderer.options[option] = initialState;
                }
            });

            // Special case: Debug log toggle
            const debugLogToggle = document.getElementById('debug-log-toggle');
            if (debugLogToggle) {
                debugLogToggle.checked = debugConfig.enabled || false;
            }

            // Attach Single Event Listener
            vizControls.addEventListener('change', async (e) => {
                const el = e.target;
                
                // Ensure it's a checkbox that changed
                if (el.tagName !== 'INPUT' || el.type !== 'checkbox') {
                    return;
                }

                const isChecked = el.checked;
                const option = el.dataset.option;
                const action = el.dataset.action;
                const dependencyId = el.dataset.dependency;

                this.debug(`Viz toggle changed: ${option || el.id} = ${isChecked}, action: ${action}`);

                // Handle Dependencies
                if (dependencyId) {
                    const dependencyEl = document.getElementById(dependencyId);
                    if (dependencyEl && !dependencyEl.checked) {
                        el.checked = false; // Un-check it
                        this.ui.statusManager?.showStatus(`Enable '${dependencyEl.labels[0].textContent}' first`, 'warning');
                        return;
                    }
                }

                if (option === 'showPreprocessed' && isChecked) {
                    const arcToggle = document.getElementById('enable-arc-reconstruction');
                    if (arcToggle && arcToggle.checked) {
                        arcToggle.checked = false;
                        this.renderer.setOptions({ enableArcReconstruction: false });
                    }
                }
                if (option === 'enableArcReconstruction' && isChecked) {
                    const prepToggle = document.getElementById('show-preprocessed');
                    if (prepToggle && prepToggle.checked) {
                        prepToggle.checked = false;
                        this.renderer.setOptions({ showPreprocessed: false });
                    }
                }

                // Perform Action
                switch (action) {
                    case 'render':
                        // Simple redraw (e.g., grid, wireframe)
                        if (option) {
                            this.renderer.setOptions({ [option]: isChecked });
                        }
                        this.renderer.render();
                        break;

                    case 'update':
                        // Full re-process and redraw (e.g., fusion, offsets)
                        if (option) {
                            this.renderer.setOptions({ [option]: isChecked });
                        }

                        // Special logic for fusion/arc changes
                        if (option === 'fuseGeometry' && !isChecked) {
                            this.resetFusionStates(); // Turn off dependents
                        }
                        if (option === 'enableArcReconstruction') {
                            this.updateArcReconstructionStats(); // Update stats display
                        }
                        if (option === 'fuseGeometry' || option === 'enableArcReconstruction') {
                            if (this.ui.core.geometryProcessor) {
                                this.ui.core.geometryProcessor.clearCachedStates();
                            }
                        }

                        await this.ui.updateRendererAsync();
                        break;

                    case 'toggle-debug':
                        // Special case for the global debug flag
                        if (window.PCBCAMConfig) {
                            window.PCBCAMConfig.debug.enabled = isChecked;
                        }
                        if (this.ui.statusManager) {
                            this.ui.statusManager.setDebugVisibility(isChecked);
                        }
                        break;

                    default:
                        // For toggles that manage layer visibility directly (e.g., show-regions)
                        if (option) {
                            this.renderer.setOptions({ [option]: isChecked });
                        }
                        // This will be caught on the next render, but a simple render is safer // Review - What now?
                        this.renderer.render();
                        break;
                }
            });

            this.debug("Visualization toggles setup complete.");
        }

        setupOffsetControls() {
            const xInput = document.getElementById('x-offset');
            const yInput = document.getElementById('y-offset');

            if (!xInput || !yInput) {
                console.warn('[UIControls] Coordinate inputs not found in sidebar');
                return;
            }

            xInput.removeAttribute('readonly');
            yInput.removeAttribute('readonly');

            this.inputTracking.lastXValue = xInput.value || '0';
            this.inputTracking.lastYValue = yInput.value || '0';

            if (xInput && yInput) {
                const handleValueChange = () => {
                    const currentX = xInput.value;
                    const currentY = yInput.value;

                    if (currentX !== this.inputTracking.lastXValue || currentY !== this.inputTracking.lastYValue) {
                        const offsetX = parseFloat(currentX) || 0;
                        const offsetY = parseFloat(currentY) || 0;

                        if (this.coordinateSystem) {
                            this.coordinateSystem.updatePreviewByOffset(offsetX, offsetY);
                            this.ui.updateOriginDisplay();
                        }

                        this.inputTracking.lastXValue = currentX;
                        this.inputTracking.lastYValue = currentY;
                    }
                };

                xInput.addEventListener('blur', handleValueChange);
                yInput.addEventListener('blur', handleValueChange);
                
                const handleEnter = (e) => {
                    if (e.key === 'Enter') {
                        handleValueChange();
                        this.applyOffsetAndSetOrigin();
                    }
                };
                
                xInput.addEventListener('keypress', handleEnter);
                yInput.addEventListener('keypress', handleEnter);
            }

            // Center origin button
            const centerBtn = document.getElementById('center-origin-btn');
            if (centerBtn) {
                centerBtn.addEventListener('click', () => this.centerOrigin());
            }

            // Bottom-left origin button
            const bottomLeftBtn = document.getElementById('bottom-left-origin-btn');
            if (bottomLeftBtn) {
                bottomLeftBtn.addEventListener('click', () => this.bottomLeftOrigin());
            }

            // Reset origin button
            const resetBtn = document.getElementById('reset-origin-btn');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => this.resetOrigin());
            }

            // Apply offset button
            const applyBtn = document.getElementById('apply-set-origin-btn');
            if (applyBtn) {
                applyBtn.addEventListener('click', () => this.applyOffsetAndSetOrigin());
            }
        }

        setupRotationControls() {
            const rotationInput = document.getElementById('rotation-angle');

            if (rotationInput) {
                rotationInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        const angle = parseFloat(rotationInput.value) || 0;
                        if (angle !== 0) {
                            this.applyBoardRotation(angle);
                            rotationInput.value = '0';
                        }
                    }
                });
            }

            // Apply rotation button
            const applyBtn = document.getElementById('apply-rotation-btn');
            if (applyBtn) {
                applyBtn.addEventListener('click', () => {
                    const input = document.getElementById('rotation-angle');
                    const angle = parseFloat(input?.value) || 0;
                    if (angle !== 0) {
                        this.applyBoardRotation(angle);
                        if (input) input.value = '0';
                    }
                });
            }

            // Reset rotation button
            const resetBtn = document.getElementById('reset-rotation-btn');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => {
                    this.resetBoardRotationOnly();
                    const input = document.getElementById('rotation-angle');
                    if (input) input.value = '0';
                });
            }
        }

        setupMirrorControls() {
            const toggleX = document.getElementById('mirror-x-toggle');
            const toggleY = document.getElementById('mirror-y-toggle');

            if (toggleX) {
                toggleX.addEventListener('change', (e) => {
                    if (!this.coordinateSystem) return;

                    const result = this.coordinateSystem.setMirrorX(e.target.checked);

                    if (result.success) {
                        this.ui.updateOriginDisplay();
                        const state = result.mirrorX ? 'enabled' : 'disabled';
                        this.ui.statusManager?.showStatus(`Horizontal mirror ${state}`, 'info');
                    }
                });
            }

            if (toggleY) {
                toggleY.addEventListener('change', (e) => {
                    if (!this.coordinateSystem) return;

                    const result = this.coordinateSystem.setMirrorY(e.target.checked);

                    if (result.success) {
                        this.ui.updateOriginDisplay();
                        const state = result.mirrorY ? 'enabled' : 'disabled';
                        this.ui.statusManager?.showStatus(`Vertical mirror ${state}`, 'info');
                    }
                });
            }

            // Initial state sync and add listener for external changes
            this.syncMirrorCheckboxes();

            // Re-sync checkboxes whenever coordinate system changes
            if (this.coordinateSystem) {
                this.coordinateSystem.addChangeListener((status) => {
                    this.syncMirrorCheckboxes();
                });
            }
        }

        syncMirrorCheckboxes() {
            if (!this.coordinateSystem) return;

            const state = this.coordinateSystem.getMirrorState();
            const toggleX = document.getElementById('mirror-x-toggle');
            const toggleY = document.getElementById('mirror-y-toggle');

            if (toggleX && toggleX.checked !== state.mirrorX) {
                toggleX.checked = state.mirrorX;
            }
            if (toggleY && toggleY.checked !== state.mirrorY) {
                toggleY.checked = state.mirrorY;
            }
        }

        resetFusionStates() {
            // Reset preprocessed view
            this.renderer.setOptions({ showPreprocessed: false });
            const preprocessedToggle = document.getElementById('show-preprocessed');
            if (preprocessedToggle) {
                preprocessedToggle.checked = false;
            }

            // Reset arc reconstruction
            this.renderer.setOptions({ enableArcReconstruction: false });
            const arcToggle = document.getElementById('enable-arc-reconstruction');
            if (arcToggle) {
                arcToggle.checked = false;
            }

            // Clear stats by calling with empty data
            this.updateArcReconstructionStats({ curvesRegistered: 0 });
        }
        
        updateArcReconstructionStats(stats = null) {
            const statsContainer = document.getElementById('arc-reconstruction-stats');
            if (!statsContainer) return;

            // If stats weren't passed, get them from core. Default to empty.
            const currentStats = stats || this.ui.core.geometryProcessor?.getArcReconstructionStats() || {};

            // Get enabled state
            const isEnabled = this.renderer.options.enableArcReconstruction;

            if (isEnabled && currentStats.curvesRegistered > 0) {
                statsContainer.classList.remove('hidden');
                const successRate = currentStats.curvesRegistered > 0 ? 
                    ((currentStats.curvesReconstructed / currentStats.curvesRegistered) * 100).toFixed(1) : 0;

                statsContainer.innerHTML = `
                    <div>Curves registered: ${currentStats.curvesRegistered}</div>
                    <div>Curves reconstructed: ${currentStats.curvesReconstructed}</div>
                    <div>Curves lost: ${currentStats.curvesLost}</div>
                    <div>Success rate: ${successRate}%</div>
                `;
            } else {
                statsContainer.classList.add('hidden');
            }
        }

        updateOffsetInputsWithTracking() {
            const xInput = document.getElementById('x-offset');
            const yInput = document.getElementById('y-offset');

            if (xInput && yInput && this.coordinateSystem) {

                const offset = this.coordinateSystem.getOffsetFromSaved();
                const precision = config.gcode?.precision?.coordinates || 3;
                const newXValue = offset.x.toFixed(precision);
                const newYValue = offset.y.toFixed(precision);

                xInput.value = newXValue;
                yInput.value = newYValue;

                // Also update the trackers
                this.inputTracking.lastXValue = newXValue;
                this.inputTracking.lastYValue = newYValue;
            }
        }

        // Coordinate system operations
        centerOrigin() {
            if (!this.coordinateSystem) return;

            const result = this.coordinateSystem.previewCenterOrigin();
            if (result.success) {
                this.updateOffsetInputsWithTracking();
                this.ui.updateOriginDisplay();
                this.ui.statusManager.showStatus('Preview: Origin at board center (not saved)', 'info');
            } else {
                this.ui.statusManager.showStatus('Cannot preview center: ' + result.error, 'error');
            }
        }

        bottomLeftOrigin() {
            if (!this.coordinateSystem) return;

            const result = this.coordinateSystem.previewBottomLeftOrigin();
            if (result.success) {
                this.updateOffsetInputsWithTracking();
                this.ui.updateOriginDisplay();
                this.ui.statusManager.showStatus('Preview: Origin at board bottom-left (not saved)', 'info');
            } else {
                this.ui.statusManager.showStatus('Cannot preview bottom-left: ' + result.error, 'error');
            }
        }

        applyOffsetAndSetOrigin() {
            if (!this.coordinateSystem) return;
            
            const result = this.coordinateSystem.saveCurrentOrigin();
            if (result.success) {
                // The change listener will fire and call updateOffsetInputsWithTracking which now correctly updates the inputs AND the trackers.
                this.ui.updateOriginDisplay();
                this.ui.statusManager.showStatus('Origin saved at current position', 'success');
            } else {
                this.ui.statusManager.showStatus('Cannot save origin: ' + result.error, 'error');
            }
        }

        resetOrigin() {
            if (!this.coordinateSystem) return;

            const result = this.coordinateSystem.resetToSavedOrigin();
            if (result.success) {
                this.updateOffsetInputsWithTracking();
                this.ui.updateOriginDisplay();
                this.ui.statusManager.showStatus('Reset to saved origin', 'success');
            } else {
                this.ui.statusManager.showStatus('Cannot reset: ' + result.error, 'error');
            }
        }

        applyBoardRotation(angle) {
            if (!this.coordinateSystem) return;

            const result = this.coordinateSystem.rotateBoardBy(angle);
            if (result.success) {
                this.ui.updateOriginDisplay();
                this.ui.statusManager.showStatus(`Board rotated by ${angle}°`, 'success');
            } else {
                this.ui.statusManager.showStatus(`Cannot rotate board: ${result.error}`, 'error');
            }
        }

        resetBoardRotationOnly() {
            if (!this.coordinateSystem) return;

            const result = this.coordinateSystem.resetRotationOnly();
            if (result.success) {
                this.ui.updateOriginDisplay();
                this.ui.statusManager.showStatus('Board rotation reset (position unchanged)', 'success');
            } else {
                this.ui.statusManager.showStatus(`Cannot reset rotation: ${result.error}`, 'error');
            }
        }

        setupZoomControls() {
            const fitBtn = document.getElementById('zoom-fit-btn');
            const inBtn = document.getElementById('zoom-in-btn');
            const outBtn = document.getElementById('zoom-out-btn');

            if (fitBtn) {
                fitBtn.addEventListener('click', () => {
                    this.ui.renderer.core.zoomFit();
                    this.ui.renderer.render();
                    this.ui.renderer.interactionHandler.updateZoomDisplay();
                });
            }
            if (inBtn) {
                inBtn.addEventListener('click', () => {
                    this.ui.renderer.core.zoomIn();
                    this.ui.renderer.render();
                    this.ui.renderer.interactionHandler.updateZoomDisplay();
                });
            }
            if (outBtn) {
                outBtn.addEventListener('click', () => {
                    this.ui.renderer.core.zoomOut();
                    this.ui.renderer.render();
                    this.ui.renderer.interactionHandler.updateZoomDisplay();
                });
            }
        }

        setupCollapsibleMenus() {
            const headers = document.querySelectorAll('.section-header.collapsible');
            headers.forEach(header => {
                const targetId = header.getAttribute('data-target');
                const content = document.getElementById(targetId);
                const indicator = header.querySelector('.collapse-indicator');

                if (!content || !indicator) return;

                // Make header focusable
                header.setAttribute('tabindex', '0');
                header.setAttribute('role', 'button');
                header.setAttribute('aria-expanded', !content.classList.contains('collapsed'));
                header.setAttribute('aria-controls', targetId);

                // Set initial indicator state
                if (content.classList.contains('collapsed')) {
                    indicator.classList.add('collapsed');
                } else {
                    indicator.classList.remove('collapsed');
                }

                // Click handler
                const toggleSection = () => {
                    content.classList.toggle('collapsed');
                    indicator.classList.toggle('collapsed');
                    header.setAttribute('aria-expanded', !content.classList.contains('collapsed'));
                };

                header.addEventListener('click', toggleSection);

                // Keyboard handler
                header.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleSection();
                    }
                });
            });
        }

        /**
         * Finds and collapses all collapsible sections in the right sidebar.
         */
        collapseRightSidebar() {
            this.debug('Collapsing right sidebar sections...');
            const rightSidebar = document.getElementById('sidebar-right');
            if (!rightSidebar) return;

            // Find all collapsible content panels within the right sidebar
            const sections = rightSidebar.querySelectorAll('.section-content.collapsible');

            // This is safer than querying the headers, as it finds the content directly
            sections.forEach(content => {
                // Find the corresponding header and indicator
                const header = content.previousElementSibling;
                const indicator = header?.querySelector('.collapse-indicator');

                // Add the 'collapsed' class to hide the content
                content.classList.add('collapsed');

                // Also update the '▼' indicator
                if (indicator) {
                    indicator.classList.add('collapsed');
                }
            });
        }

        setupVizPanelButton() {
            const btn = document.getElementById('show-viz-panel-btn');
            const panel = document.getElementById('viz-panel');

            if (!btn || !panel) {
                console.warn('[UIControls] Visualization panel button or panel not found');
                return;
            }

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Toggle the collapsed class
                panel.classList.toggle('collapsed'); 
                btn.classList.toggle('active', !panel.classList.contains('collapsed'));
            });

            // Click outside to close (if it's open)
            document.addEventListener('click', (e) => {
                if (!panel.classList.contains('collapsed') && !panel.contains(e.target) && !btn.contains(e.target)) {
                    panel.classList.add('collapsed');
                    btn.classList.remove('active');
                }
            });

            // Prevent panel clicks from closing it
            panel.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }

        setupMachineSettings() {
            const loadedSettings = this.ui.core.settings;

            const postProcessorSelect = document.getElementById('post-processor');
            const startCodeTA = document.getElementById('start-code-ta');
            const endCodeTA = document.getElementById('end-code-ta');
            if (postProcessorSelect) {
                postProcessorSelect.innerHTML = '';
                const options = config.ui?.parameterOptions?.postProcessor || [{ value: 'grbl', label: 'GRBL (Default)' }];
                options.forEach(opt => {
                    const optionEl = document.createElement('option');
                    optionEl.value = opt.value;
                    optionEl.textContent = opt.label;
                    postProcessorSelect.appendChild(optionEl);
                });
                postProcessorSelect.value = loadedSettings.gcode.postProcessor;
                postProcessorSelect.addEventListener('change', (e) => {
                    const newProcessor = e.target.value;

                    // 1. Get the new default templates
                    const newStartCode = config.getGcodeTemplate(newProcessor, 'start');
                    const newEndCode = config.getGcodeTemplate(newProcessor, 'end');

                    // 2. Update the text areas in the UI
                    if (startCodeTA) startCodeTA.value = newStartCode;
                    if (endCodeTA) endCodeTA.value = newEndCode;

                    // 3. Save all three settings to the core
                    this.ui.core.updateSettings('gcode', { 
                        postProcessor: newProcessor,
                        startCode: newStartCode,
                        endCode: newEndCode
                    });
                });
            }

            if (startCodeTA) {
                startCodeTA.value = loadedSettings.gcode.startCode;
                startCodeTA.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('gcode', { startCode: e.target.value });
                });
            }

            if (endCodeTA) {
                endCodeTA.value = loadedSettings.gcode.endCode;
                endCodeTA.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('gcode', { endCode: e.target.value });
                });
            }

            const thicknessInput = document.getElementById('pcb-thickness');
            if (thicknessInput) {
                thicknessInput.value = loadedSettings.pcb.thickness;
                thicknessInput.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('pcb', { thickness: parseFloat(e.target.value) });
                });
            }

            const safeZInput = document.getElementById('safe-z');
            if (safeZInput) {
                safeZInput.value = loadedSettings.machine.safeZ;
                safeZInput.addEventListener('change', (e) => {
                    const val = parseFloat(e.target.value);
                    this.ui.core.updateSettings('machine', { safeZ: val });
                });
            }

            const travelZInput = document.getElementById('travel-z');
            if (travelZInput) {
                travelZInput.value = loadedSettings.machine.travelZ;
                travelZInput.addEventListener('change', (e) => {
                    const val = parseFloat(e.target.value);
                    this.ui.core.updateSettings('machine', { travelZ: val });
                });
            }

            const rapidFeedInput = document.getElementById('rapid-feed');
            if (rapidFeedInput) {
                rapidFeedInput.value = loadedSettings.machine.rapidFeed;
                rapidFeedInput.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('machine', { rapidFeed: parseFloat(e.target.value) });
                });
            }

            const gcodeUnitsSelect = document.getElementById('gcode-units');
            if (gcodeUnitsSelect) {
                gcodeUnitsSelect.value = loadedSettings.gcode.units;
                gcodeUnitsSelect.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('gcode', { units: e.target.value });
                });
            }

            const coolantSelect = document.getElementById('coolant-type');
            if (coolantSelect) {
                coolantSelect.value = loadedSettings.machine.coolant || 'none';
                coolantSelect.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('machine', { coolant: e.target.value });
                });
            }

            const vacuumToggle = document.getElementById('vacuum-toggle');
            if (vacuumToggle) {
                vacuumToggle.checked = loadedSettings.machine.vacuum || false;
                vacuumToggle.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('machine', { vacuum: e.target.checked });
                });
            }
        }

        setupSidebarSectionNavigation() {
            const rightSidebar = document.getElementById('sidebar-right');
            if (!rightSidebar) return;

            const headers = rightSidebar.querySelectorAll('.section-header.collapsible');
            headers.forEach((header, idx) => {
                header.setAttribute('tabindex', idx === 0 ? '0' : '-1');
            });

            rightSidebar.addEventListener('keydown', (e) => {
                if (!['ArrowUp', 'ArrowDown'].includes(e.key)) return;

                const focused = document.activeElement;
                if (!rightSidebar.contains(focused)) return;

                // Prevent scroll
                e.preventDefault();

                // If on a section header
                if (focused.classList.contains('section-header')) {
                    const allHeaders = Array.from(headers);
                    const idx = allHeaders.indexOf(focused);

                    if (e.key === 'ArrowDown') {
                        const section = focused.closest('.sidebar-section');
                        const content = section?.querySelector('.section-content:not(.collapsed)');
                        if (content) {
                            const firstField = content.querySelector('input, select, button, [tabindex="0"]');
                            if (firstField) {
                                focused.setAttribute('tabindex', '-1');
                                firstField.focus();
                                return;
                            }
                        }
                        if (allHeaders[idx + 1]) {
                            focused.setAttribute('tabindex', '-1');
                            allHeaders[idx + 1].setAttribute('tabindex', '0');
                            allHeaders[idx + 1].focus();
                        }
                    } else {
                        if (allHeaders[idx - 1]) {
                            focused.setAttribute('tabindex', '-1');
                            allHeaders[idx - 1].setAttribute('tabindex', '0');
                            allHeaders[idx - 1].focus();
                        }
                    }
                    return;
                }

                // If on input/select within section
                if (focused.matches('input, select')) {
                    const section = focused.closest('.section-content');
                    if (!section) return;

                    const fields = Array.from(section.querySelectorAll('input, select, button')).filter(f => !f.disabled);
                    const idx = fields.indexOf(focused);
                    const nextIdx = e.key === 'ArrowDown' ? idx + 1 : idx - 1;

                    if (fields[nextIdx]) {
                        fields[nextIdx].focus();
                    } else if (e.key === 'ArrowUp' && idx === 0) {
                        // Go back to header
                        const header = section.closest('.sidebar-section')?.querySelector('.section-header');
                        if (header) {
                            header.setAttribute('tabindex', '0');
                            header.focus();
                        }
                    }
                }
            });
        }

        debug(message, data = null) {
            if (this.ui.debug) {
                this.ui.debug(`[UIControls] ${message}`, data);
            }
        }
    }
    
    window.UIControls = UIControls;
})();