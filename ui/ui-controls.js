/*!
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

    const C = window.PCBCAMConfig.constants;
    const D = window.PCBCAMConfig.defaults;
    const debugState = D.debug;
    const renderingOptions = D.rendering.defaultOptions;

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
                { id: 'preview-canvas', selector: '#preview-canvas' },
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

            // Viewport warning bar dismiss
            const viewportBarDismiss = document.getElementById('dismiss-viewport-bar');
            if (viewportBarDismiss) {
                viewportBarDismiss.addEventListener('click', () => {
                    const bar = document.getElementById('workspace-viewport-bar');
                    if (bar) {
                        bar.classList.add('dismissed');
                    }
                });
            }

            this.debug("Controls initialized.");
            return true;
        }

        attachStaticTooltips() {
            if (!this.lang || !window.TooltipManager) return;

            const processedLabels = new Set();

            // Find the label for an input
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

            // Standalone labels (not associated with inputs)
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

            // Attach to Start/End Code
            attachTo('start-code-ta', 'tooltips.parameters.startCode'); 
            attachTo('end-code-ta', 'tooltips.parameters.endCode');

            // Roland Machine Settings
            attachTo('roland-machine-model', 'tooltips.machineSettings.rolandMachineModel');
            attachTo('roland-steps-per-mm', 'tooltips.machineSettings.rolandStepsPerMM');
            attachTo('roland-z-mode', 'tooltips.machineSettings.rolandZMode');
            attachTo('roland-max-feed', 'tooltips.machineSettings.rolandMaxFeed');
            attachTo('roland-spindle-mode', 'tooltips.machineSettings.rolandSpindleMode');

            // Laser Machine Settings
            attachTo('laser-profile-select', 'tooltips.machineSettings.laserProfile');
            attachTo('laser-profile-colors-display', 'tooltips.machineSettings.laserProfileColors');
            attachTo('laser-spot-size', 'tooltips.machineSettings.laserSpotSize');
            attachTo('laser-export-format', 'tooltips.machineSettings.laserExportFormat');
            attachTo('laser-export-dpi', 'tooltips.machineSettings.laserExportDPI');
            attachTo('laser-svg-grouping', 'tooltips.machineSettings.laserSvgGrouping');
            attachTo('laser-reverse-cut', 'tooltips.machineSettings.laserReverseCutOrder');
            attachTo('laser-heat-management', 'tooltips.machineSettings.laserHeatManagement');
            attachTo('laser-color-per-pass', 'tooltips.machineSettings.laserColorPerPass');

            // Visualization Panel Toggles
            attachTo('show-grid', 'tooltips.vizPanel.grid');
            attachTo('show-wireframe', 'tooltips.vizPanel.wireframe');
            attachTo('show-bounds', 'tooltips.vizPanel.boardBounds');
            attachTo('show-rulers', 'tooltips.vizPanel.rulers');
            attachTo('show-offsets', 'tooltips.vizPanel.offsets');
            attachTo('show-previews', 'tooltips.vizPanel.previews');
            attachTo('fuse-geometry', 'tooltips.vizPanel.fusionMode');
            attachTo('show-preprocessed', 'tooltips.vizPanel.preprocessed');
            attachTo('show-preprocessed-offsets', 'tooltips.vizPanel.preprocessedOffsets');
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
                if (option && renderingOptions[option] !== undefined) {
                    const initialState = renderingOptions[option];
                    el.checked = initialState;
                    // Sync the renderer's options to this default
                    this.renderer.options[option] = initialState;
                }
            });

            // Set initial disabled state for dependent toggles
            const fuseGeometryToggle = document.getElementById('fuse-geometry');
            const preprocessedToggle = document.getElementById('show-preprocessed');
            const arcToggle = document.getElementById('enable-arc-reconstruction');

            if (fuseGeometryToggle) {
                const isFused = fuseGeometryToggle.checked;
                if (preprocessedToggle) preprocessedToggle.disabled = !isFused;
                if (arcToggle) arcToggle.disabled = !isFused;
            }

            // Special case: Debug log toggle
            const debugLogToggle = document.getElementById('debug-log-toggle');
            if (debugLogToggle) {
                debugLogToggle.checked = debugState.enabled;
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
                        this.ui.showStatus(`Enable '${dependencyEl.labels[0].textContent}' first`, 'warning');
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
                if (option === 'fuseGeometry') {
                    const prepToggle = document.getElementById('show-preprocessed');
                    const arcToggle = document.getElementById('enable-arc-reconstruction');

                    if (prepToggle) prepToggle.disabled = !isChecked;
                    if (arcToggle) arcToggle.disabled = !isChecked;
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
                            D.debug.enabled = isChecked;
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

        /**
         * Invalidates generated laser operation if global machine settings change in a way that makes existing geometry incompatible.
         */
        invalidateLaserOperations(reasonMessage, affectedTypes = null) {
            if (!this.ui || !this.ui.core) return;
            let invalidated = false;

            this.ui.core.operations.forEach(op => {
                if (!window.pcbcam?.isLaserExportForOperation(op.type)) return;
                if (!this.ui.core.isExportReady(op)) return;
                if (affectedTypes && !affectedTypes.includes(op.type)) return;

                op.exportReady = false;
                if (op.preview) op.preview.ready = false;

                // Explicit invalidation state
                op.isInvalidated = true;
                op.invalidatedReason = reasonMessage;

                invalidated = true;

                // Force tree node to update and show invalidation styling
                if (this.ui.navTreePanel) {
                    const fileNode = this.ui.navTreePanel.getNodeByOperationId(op.id);
                    if (fileNode) {
                        this.ui.navTreePanel.updateFileGeometries(fileNode.id, op);
                    }
                }
            });

            if (invalidated && reasonMessage) {
                this.ui.showStatus('Existing geometry invalidated. Please review operations.', 'warning');
            }
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
                        this.ui.showStatus(`Horizontal mirror ${state}`, 'info');
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
                        this.ui.showStatus(`Vertical mirror ${state}`, 'info');
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
                    <div class="stats-display">
                        <div class="stat-item">
                            <span class="stat-label">Registered:</span>
                            <span class="stat-value">${currentStats.curvesRegistered}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Reconstructed:</span>
                            <span class="stat-value">${currentStats.curvesReconstructed}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Lost:</span>
                            <span class="stat-value">${currentStats.curvesLost}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Success Rate:</span>
                            <span class="stat-value">${successRate}%</span>
                        </div>
                    </div>
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
                const precision = D.gcode.decimals.coordinates;
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
                this.ui.showStatus('Preview: Origin at board center (not saved)', 'info');
            } else {
                this.ui.showStatus('Cannot preview center: ' + result.error, 'error');
            }
        }

        bottomLeftOrigin() {
            if (!this.coordinateSystem) return;

            const result = this.coordinateSystem.previewBottomLeftOrigin();
            if (result.success) {
                this.updateOffsetInputsWithTracking();
                this.ui.updateOriginDisplay();
                this.ui.showStatus('Preview: Origin at board bottom-left (not saved)', 'info');
            } else {
                this.ui.showStatus('Cannot preview bottom-left: ' + result.error, 'error');
            }
        }

        applyOffsetAndSetOrigin() {
            if (!this.coordinateSystem) return;

            const result = this.coordinateSystem.saveCurrentOrigin();
            if (result.success) {
                // The change listener will fire and call updateOffsetInputsWithTracking which now correctly updates the inputs AND the trackers.
                this.ui.updateOriginDisplay();
                this.ui.showStatus('Origin saved at current position', 'success');
            } else {
                this.ui.showStatus('Cannot save origin: ' + result.error, 'error');
            }
        }

        resetOrigin() {
            if (!this.coordinateSystem) return;

            const result = this.coordinateSystem.resetToSavedOrigin();
            if (result.success) {
                this.updateOffsetInputsWithTracking();
                this.ui.updateOriginDisplay();
                this.ui.showStatus('Reset to saved origin', 'success');
            } else {
                this.ui.showStatus('Cannot reset: ' + result.error, 'error');
            }
        }

        applyBoardRotation(angle) {
            if (!this.coordinateSystem) return;

            const result = this.coordinateSystem.rotateBoardBy(angle);
            if (result.success) {
                this.ui.updateOriginDisplay();
                this.ui.showStatus(`Board rotated by ${angle}°`, 'success');
            } else {
                this.ui.showStatus(`Cannot rotate board: ${result.error}`, 'error');
            }
        }

        resetBoardRotationOnly() {
            if (!this.coordinateSystem) return;

            const result = this.coordinateSystem.resetRotationOnly();
            if (result.success) {
                this.ui.updateOriginDisplay();
                this.ui.showStatus('Board rotation reset (position unchanged)', 'success');
            } else {
                this.ui.showStatus(`Cannot reset rotation: ${result.error}`, 'error');
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

            // --- Roland machine profiles ---
            const rolandProcessor = window.pcbcam?.gcodeGenerator?.getProcessor('roland');
            const ROLAND_PROFILES = rolandProcessor?.profiles || {};
            const rolandSettings = loadedSettings.processorSettings?.roland || {};

            // --- Post-Processor Dropdown ---
            const postProcessorSelect = document.getElementById('post-processor');
            const startCodeTA = document.getElementById('start-code-ta');
            const endCodeTA = document.getElementById('end-code-ta');

            // REVIEW - Double check all default Roland Profile logic
            const updateRolandSettings = (newSettings) => {
                const currentRoland = this.ui.core.settings.processorSettings?.roland || {};
                this.ui.core.updateSettings('processorSettings', {
                    roland: { ...currentRoland, ...newSettings }
                });
            };
            const initialRolandModel = rolandSettings.rolandModel || 'mdx50';
            const initialProfile = ROLAND_PROFILES[initialRolandModel] || ROLAND_PROFILES['custom'];

            if (postProcessorSelect) {
                postProcessorSelect.innerHTML = '';
                const generator = window.pcbcam?.gcodeGenerator;
                const options = generator ? generator.getAllProcessorDescriptors() : [{ value: 'grbl', label: 'Grbl (Default)' }];
                options.forEach(opt => {
                    const optionEl = document.createElement('option');
                    optionEl.value = opt.value;
                    optionEl.textContent = opt.label;
                    postProcessorSelect.appendChild(optionEl);
                });
                postProcessorSelect.value = loadedSettings.gcode.postProcessor;

                postProcessorSelect.addEventListener('change', (e) => {
                    const newProcessor = e.target.value;
                    const wasProcessor = this.ui.core.settings.gcode.postProcessor;

                    // Clear user overrides on processor switch — forces factory defaults
                    this.ui.core.updateSettings('gcode', {
                        postProcessor: newProcessor,
                        userStartCode: undefined,
                        userEndCode: undefined
                    });

                    // Resolve factory defaults from the new processor
                    const generator = window.pcbcam?.gcodeGenerator;
                    if (generator && startCodeTA && endCodeTA) {
                        startCodeTA.value = generator.resolveStartCode(newProcessor, undefined);
                        endCodeTA.value = generator.resolveEndCode(newProcessor, undefined);
                    }

                    this.updateProcessorFieldVisibility(newProcessor);

                    // Clear cached G-code preview
                    const previewText = document.getElementById('exporter-preview-text');
                    if (previewText && previewText.value) {
                        previewText.value = '';
                        const lineCount = document.getElementById('exporter-line-count');
                        const opCount = document.getElementById('exporter-op-count');
                        const estTime = document.getElementById('exporter-est-time');
                        const distance = document.getElementById('exporter-distance');
                        if (lineCount) lineCount.textContent = '0';
                        if (opCount) opCount.textContent = '0';
                        if (estTime) estTime.textContent = '--:--';
                        if (distance) distance.textContent = '0mm';
                    }

                    // Update parameter constraints when switching processor type
                    if (this.ui.operationPanel?.parameterManager) {
                        const isRoland = newProcessor === 'roland';
                        if (isRoland) {
                            const currentModel = rolandSettings.rolandModel || 'mdx50';
                            const currentProfile = ROLAND_PROFILES[currentModel];
                            this.ui.operationPanel.parameterManager.updateMachineConstraints(currentProfile, 'roland');
                        } else {
                            this.ui.operationPanel.parameterManager.updateMachineConstraints({}, newProcessor);
                        }
                    }

                    if (newProcessor !== wasProcessor) {
                        this.ui.showStatus(
                            `Switched to ${newProcessor}. Recalculate toolpaths to apply changes.`,
                            'warning'
                        );
                    }
                });
            }

            // --- Start/End Code (universal, content depends on processor) ---
            if (startCodeTA) {
                const processor = loadedSettings.gcode.postProcessor;
                const generator = window.pcbcam?.gcodeGenerator;
                const startVal = generator
                    ? generator.resolveStartCode(processor, loadedSettings.gcode.userStartCode)
                    : '';
                startCodeTA.value = startVal;

                startCodeTA.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('gcode', { userStartCode: e.target.value });
                });
            }

            if (endCodeTA) {
                const processor = loadedSettings.gcode.postProcessor;
                const generator = window.pcbcam?.gcodeGenerator;
                const endVal = generator
                    ? generator.resolveEndCode(processor, loadedSettings.gcode.userEndCode)
                    : '';
                endCodeTA.value = endVal;

                endCodeTA.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('gcode', { userEndCode: e.target.value });
                });
            }

            // --- G-code specific ---
            const gcodeUnitsSelect = document.getElementById('gcode-units');
            if (gcodeUnitsSelect) {
                gcodeUnitsSelect.value = loadedSettings.gcode.units;
                gcodeUnitsSelect.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('gcode', { units: e.target.value });
                });
            }

            // --- Roland-specific fields ---
            const rolandModelSelect = document.getElementById('roland-machine-model');
            const rolandStepsInput = document.getElementById('roland-steps-per-mm');
            const rolandMaxFeedInput = document.getElementById('roland-max-feed');
            const rolandZModeSelect = document.getElementById('roland-z-mode');
            const rolandSpindleModeSelect = document.getElementById('roland-spindle-mode');
            const rolandSpindleInput = document.getElementById('roland-spindle-speed');

            if (rolandModelSelect) {
                rolandModelSelect.value = rolandSettings.rolandModel;
                rolandModelSelect.addEventListener('change', (e) => {
                    const modelId = e.target.value;
                    const rolandProcessor = window.pcbcam.gcodeGenerator.getProcessor('roland');
                    const profile = rolandProcessor.profiles[modelId];
                    if (!profile) return;

                    // Compute a sensible default spindle RPM from profile
                    const defaultRPM = profile.spindleFixed ||
                        (profile.spindleRange
                            ? Math.round((profile.spindleRange.min + profile.spindleRange.max) / 2)
                            : 10000);

                    // Auto-populate all fields from profile
                    if (rolandStepsInput) rolandStepsInput.value = profile.stepsPerMM;
                    if (rolandMaxFeedInput) rolandMaxFeedInput.value = profile.maxFeedXY;
                    if (rolandZModeSelect) rolandZModeSelect.value = profile.zMode;
                    if (rolandSpindleModeSelect) {
                        rolandSpindleModeSelect.value = profile.spindleMode;
                        // Trigger visibility update for spindle sub-fields
                        rolandSpindleModeSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    if (rolandSpindleInput) rolandSpindleInput.value = defaultRPM;

                    // Update start/end code textareas with profile-appropriate init/end commands
                    const initCmd = profile.initCommand || ';;^DF';
                    const endCmd = profile.endCommand || ';;^DF';
                    const newStartCode = `${initCmd}\nPA;`; // Gently enforce Absolute coordinates mode. Toolpath planning is absolute, not relative.
                    const newEndCode = endCmd;

                    if (startCodeTA) startCodeTA.value = newStartCode;
                    if (endCodeTA) endCodeTA.value = newEndCode;

                    // Save all to machine settings
                    updateRolandSettings({
                        rolandModel: modelId,
                        rolandStepsPerMM: profile.stepsPerMM,
                        rolandMaxFeed: profile.maxFeedXY,
                        rolandZMode: profile.zMode,
                        rolandSpindleMode: profile.spindleMode,
                        rolandSpindleSpeed: defaultRPM,
                    });
                    this.ui.core.updateSettings('gcode', {
                        userStartCode: newStartCode,
                        userEndCode: newEndCode
                    });

                    // Update field visibility/locking based on profile capabilities
                    this.updateRolandProfileFields(profile);

                    // Update Parameter Constraints
                    if (this.ui.operationPanel?.parameterManager) {
                        this.ui.operationPanel.parameterManager.updateMachineConstraints(
                            profile,
                            this.ui.core.settings.gcode.postProcessor
                        );
                    }

                    // Refresh operation panel to reflect new constraints (hidden inputs/new max values)
                    if (this.ui.operationPanel && this.ui.operationPanel.currentOperation) {
                        this.ui.operationPanel.showOperationProperties(
                            this.ui.operationPanel.currentOperation,
                            this.ui.operationPanel.currentGeometryStage
                        );
                    }

                    this.ui.showStatus(
                        `Roland profile: ${profile.label} (${profile.stepsPerMM} steps/mm, Z: ${profile.zMode})`, 'info'
                    );
                });
            }

            if (rolandStepsInput) {
                rolandStepsInput.value = rolandSettings.rolandStepsPerMM || initialProfile.stepsPerMM;
                rolandStepsInput.addEventListener('change', (e) => {
                    updateRolandSettings({ rolandStepsPerMM: parseInt(e.target.value) || 100 });
                });
            }

            if (rolandMaxFeedInput) {
                rolandMaxFeedInput.value = rolandSettings.rolandMaxFeed || initialProfile.maxFeedXY;
                rolandMaxFeedInput.addEventListener('change', (e) => {
                    updateRolandSettings({ rolandMaxFeed: parseFloat(e.target.value) || 60 });
                });
            }

            if (rolandZModeSelect) {
                rolandZModeSelect.value = rolandSettings.rolandZMode || initialProfile.zMode;
                rolandZModeSelect.addEventListener('change', (e) => {
                    updateRolandSettings({ rolandZMode: e.target.value });
                });
            }

            if (rolandSpindleModeSelect) {
                rolandSpindleModeSelect.value = rolandSettings.rolandSpindleMode || initialProfile.spindleMode;
                rolandSpindleModeSelect.addEventListener('change', (e) => {
                    const mode = e.target.value;
                    updateRolandSettings({ rolandSpindleMode: mode });
                });
            }

            // --- Laser-specific fields ---
            const laserProfileSelect = document.getElementById('laser-profile-select');
            const laserSpotSizeInput = document.getElementById('laser-spot-size');
            const laserExportFormatSelect = document.getElementById('laser-export-format');
            const laserExportDpiInput = document.getElementById('laser-export-dpi');

            // Initialize laser settings from loaded state
            const laserSettings = loadedSettings.laser;

            // Apply format-dependent visibility in the sidebar
            const updateFormatDependentVisibility = (format) => {
                const isPng = format === 'png';
                const dpiField = document.getElementById('laser-dpi-sidebar-field');
                const pngWarning = document.getElementById('laser-png-sidebar-warning');
                if (dpiField) dpiField.style.display = isPng ? '' : 'none';
                if (pngWarning) pngWarning.style.display = isPng ? '' : 'none';
            };

            const laserOverrideContainer = document.getElementById('laser-override-container');
            const laserLockDefaults = document.getElementById('laser-lock-defaults');
            const svgGroupingSelect = document.getElementById('laser-svg-grouping');
            const reverseCutCheck = document.getElementById('laser-reverse-cut');
            const heatCheck = document.getElementById('laser-heat-management');
            const colorPassCheck = document.getElementById('laser-color-per-pass');
            const colorGridContainer = document.getElementById('laser-color-grid-container');

            // Hydrate the Lock Checkbox from State
            if (laserLockDefaults) {
                laserLockDefaults.checked = laserSettings.profileLocked !== false; 
                laserOverrideContainer.classList.toggle('is-locked-guardrail', laserLockDefaults.checked);

                laserLockDefaults.addEventListener('change', (e) => {
                    const isLocked = e.target.checked;
                    this.ui.core.updateSettings('laser', { profileLocked: isLocked });
                    laserOverrideContainer.classList.toggle('is-locked-guardrail', isLocked);

                    if (isLocked) {
                        applyLaserProfile(laserProfileSelect.value, true);
                        this.invalidateLaserOperations('Reverted to profile defaults. Regeneration recommended.');
                    }
                });
            }

            const applyLaserProfile = (profileId, forceLock = false) => {
                const profile = laserSettings.profiles?.[profileId];
                if (!profile) return;

                if (forceLock && laserLockDefaults) {
                    laserLockDefaults.checked = true;
                    laserOverrideContainer.classList.add('is-locked-guardrail');
                    this.ui.core.updateSettings('laser', { profileLocked: true });
                }

                const isLocked = laserLockDefaults ? laserLockDefaults.checked : true;

                // Synchronize State
                if (isLocked) {
                    this.ui.core.updateSettings('laser', {
                        activeProfile: profileId,
                        svgGrouping: profile.svgGrouping,
                        reverseCutOrder: profile.reverseCutOrder,
                        heatManagement: profile.heatManagement,
                        colorPerPass: profile.colorPerPass,
                        layerColors: { ...profile.layerColors }
                    });
                } else {
                    this.ui.core.updateSettings('laser', { activeProfile: profileId });
                }

                // Hydrate UI from ACTIVE STATE (not profile defaults)
                const activeState = this.ui.core.settings.laser;

                if (svgGroupingSelect) svgGroupingSelect.value = activeState.svgGrouping;
                if (reverseCutCheck) reverseCutCheck.checked = activeState.reverseCutOrder;
                if (heatCheck) heatCheck.checked = activeState.heatManagement !== 'off';
                if (colorPassCheck) colorPassCheck.checked = activeState.colorPerPass;

                const summaryLabel = document.getElementById('laser-profile-summary-label');
                if (summaryLabel) summaryLabel.textContent = profile.label;

                if (colorGridContainer && activeState.layerColors) {
                    colorGridContainer.innerHTML = '';
                    Object.entries(activeState.layerColors).forEach(([layerName, colorHex]) => {
                        const wrapper = document.createElement('div');
                        wrapper.className = 'laser-color-field';

                        const colorInput = document.createElement('input');
                        colorInput.type = 'color';
                        colorInput.value = colorHex;
                        colorInput.id = `laser-color-${layerName}`;

                        const label = document.createElement('label');
                        label.htmlFor = colorInput.id;
                        label.textContent = layerName.charAt(0).toUpperCase() + layerName.slice(1);

                        colorInput.addEventListener('change', (e) => {
                            const newColor = e.target.value;         
                            // Update the specific profile's memory so it persists
                            profile.layerColors[layerName] = newColor;
                            // Update the active working state
                            const currentColors = this.ui.core.settings.laser.layerColors;
                            this.ui.core.updateSettings('laser', {
                                layerColors: { ...currentColors, [layerName]: newColor }
                            });
                            this.invalidateLaserOperations('Color override applied. Regeneration recommended.');
                        });

                        wrapper.appendChild(colorInput);
                        wrapper.appendChild(label);
                        colorGridContainer.appendChild(wrapper);
                    });
                }
            };

            const wireOverride = (el, settingKey, isCheckbox = false) => {
                if (el) el.addEventListener('change', (e) => {
                    const val = isCheckbox ? e.target.checked : e.target.value;
                    const finalVal = settingKey === 'heatManagement' ? (val ? 'standard' : 'off') : val;
                    this.ui.core.updateSettings('laser', { [settingKey]: finalVal });
                    this.invalidateLaserOperations(`${settingKey} overridden. Regeneration recommended.`);
                });
            };

            wireOverride(svgGroupingSelect, 'svgGrouping');
            wireOverride(reverseCutCheck, 'reverseCutOrder', true);
            wireOverride(heatCheck, 'heatManagement', true);
            wireOverride(colorPassCheck, 'colorPerPass', true);

            if (laserProfileSelect) {
                laserProfileSelect.innerHTML = '';
                const profiles = laserSettings.profiles || {};
                Object.entries(profiles).forEach(([id, profile]) => {
                    const opt = document.createElement('option');
                    opt.value = id;
                    opt.textContent = profile.label;
                    laserProfileSelect.appendChild(opt);
                });

                // Ensure value matches an actual option, fallback to 'generic' if missing/mismatched
                let initialProfile = laserSettings.activeProfile || 'generic';
                if (!laserSettings.profiles[initialProfile]) {
                    initialProfile = 'generic'; 
                }
                laserProfileSelect.value = initialProfile;

                // Hydrate on load without forcing a lock
                applyLaserProfile(laserProfileSelect.value);

                laserProfileSelect.addEventListener('change', (e) => {
                    // Force lock when switching ecosystems to guarantee safety
                    applyLaserProfile(e.target.value, true);
                    const profile = laserSettings.profiles?.[e.target.value];
                    this.ui.showStatus(`Laser profile: ${profile?.label || e.target.value}`, 'info');
                    this.invalidateLaserOperations('Laser profile changed. Regeneration recommended.');
                });
            }

            // Spot size
            if (laserSpotSizeInput) {
                laserSpotSizeInput.value = laserSettings.spotSize;
                laserSpotSizeInput.addEventListener('change', (e) => {
                    const newSpotSize = parseFloat(e.target.value);

                    // Update the global machine state
                    this.ui.core.updateSettings('laser', { spotSize: newSpotSize });
                    this.invalidateLaserOperations('Laser spot size changed. Please regenerate laser paths.');

                    // Propagate instantly to the active operation state
                    if (this.ui.operationPanel && this.ui.operationPanel.currentOperation) {
                        const opId = this.ui.operationPanel.currentOperation.id;
                        this.ui.operationPanel.parameterManager.setParameter(opId, 'geometry', 'laserSpotSize', newSpotSize);

                        // Update the read-only DOM input if it's currently visible
                        const propInput = document.getElementById('prop-laserSpotSize');
                        if (propInput) propInput.value = newSpotSize;
                    }
                });
            }

            // Export format
            if (laserExportFormatSelect) {
                laserExportFormatSelect.value = laserSettings.exportFormat;
                laserExportFormatSelect.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('laser', { exportFormat: e.target.value });
                    updateFormatDependentVisibility(e.target.value);
                });

                // Apply initial visibility
                updateFormatDependentVisibility(laserExportFormatSelect.value);
            }

            // DPI
            if (laserExportDpiInput) {
                laserExportDpiInput.value = laserSettings.exportDPI || 1000;
                laserExportDpiInput.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('laser', { exportDPI: parseInt(e.target.value, 10) || 1000 });
                });
            }

            // --- Universal fields ---
            const thicknessInput = document.getElementById('pcb-thickness');
            if (thicknessInput) {
                thicknessInput.value = loadedSettings.machine.pcb.thickness;
                thicknessInput.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('machine', { 
                        pcb: { ...loadedSettings.machine.pcb, thickness: parseFloat(e.target.value) } 
                    });
                });
            }

            const safeZInput = document.getElementById('safe-z');
            if (safeZInput) {
                safeZInput.value = loadedSettings.machine.heights.safeZ;
                safeZInput.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('machine', { 
                        heights: { ...loadedSettings.machine.heights, safeZ: parseFloat(e.target.value) } 
                    });
                });
            }

            const travelZInput = document.getElementById('travel-z');
            if (travelZInput) {
                travelZInput.value = loadedSettings.machine.heights.travelZ;
                travelZInput.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('machine', { 
                        heights: { ...loadedSettings.machine.heights, travelZ: parseFloat(e.target.value) } 
                    });
                });
            }

            const rapidFeedInput = document.getElementById('rapid-feed');
            if (rapidFeedInput) {
                rapidFeedInput.value = loadedSettings.machine.speeds.rapidFeed;
                rapidFeedInput.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('machine', { 
                        speeds: { ...loadedSettings.machine.speeds, rapidFeed: parseFloat(e.target.value) } 
                    });
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

            // Apply initial visibility states
            this.updateProcessorFieldVisibility(loadedSettings.gcode.postProcessor);
            this.updatePipelineFieldVisibility();
            this.updateRolandProfileFields(initialProfile);

            // Reconfigure laser button
            const reconfigBtn = document.getElementById('reconfigure-laser-btn');
            if (reconfigBtn) {
                reconfigBtn.addEventListener('click', () => {
                    if (window.pcbcam?.modalManager) {
                        window.pcbcam.modalManager.showModal('laserConfig');
                    }
                });
            }
        }

        /**
         * Shows/hides processor-specific field groups.
         */
        updateProcessorFieldVisibility(processorName) {
            const isRoland = processorName === 'roland';
            const machineControls = document.getElementById('machine-controls');
            if (!machineControls) return;

            machineControls.querySelectorAll('[data-processor-group="gcode"]').forEach(el => {
                el.style.display = isRoland ? 'none' : '';
            });
            machineControls.querySelectorAll('[data-processor-group="roland"]').forEach(el => {
                el.style.display = isRoland ? '' : 'none';
            });

            this.debug(`Processor field visibility updated: ${processorName}`);
        }

        /**
         * Shows/hides machine setting sections based on pipeline type.
         * CNC: show cnc, hide laser. Laser: show laser, hide cnc. Hybrid: show both.
         *
         * NOTE: This method intentionally does NOT touch the export manager modal.
         * The modal has its own handler (showExportManagerHandler) that controls visibility based on actual job contents, not just pipeline type.
         */
        updatePipelineFieldVisibility() {
            const controller = window.pcbcam;
            if (!controller) return;

            const pipelineType = controller.pipelineState.type;
            const machineSection = document.querySelector('.sidebar-section.machine-section');

            if (!machineSection) return;

            // Always show the Machine Settings section
            machineSection.style.display = '';

            const machineControls = document.getElementById('machine-controls');
            if (!machineControls) return;

            const isCNC = pipelineType === 'cnc' || pipelineType === 'hybrid';
            const isLaser = window.pcbcam?.isLaserPipeline?.() || false;

            // CNC-specific sections (sidebar only)
            machineControls.querySelectorAll('[data-pipeline-group="cnc"]').forEach(el => {
                el.style.display = isCNC ? '' : 'none';
            });

            // Laser-specific sections (sidebar only)
            machineControls.querySelectorAll('[data-pipeline-group="laser"]').forEach(el => {
                el.style.display = isLaser ? '' : 'none';
            });

            this.debug(`Pipeline field visibility updated: ${pipelineType} (CNC: ${isCNC}, Laser: ${isLaser})`);
        }

        /**
         * Updates Roland-specific field visibility and editability based on machine profile.
         */
        updateRolandProfileFields(profile) {
            const rolandStepsInput = document.getElementById('roland-steps-per-mm');
            const rolandMaxFeedInput = document.getElementById('roland-max-feed');
            // const rolandZModeSelect = document.getElementById('roland-z-mode'); // REVIEW - UNUSED, should it be used? Is it missing somewhere?
            const rolandSpindleModeSelect = document.getElementById('roland-spindle-mode');
            const rolandSpindleInput = document.getElementById('roland-spindle-speed');
            const rpmField = document.getElementById('roland-spindle-rpm-field');

            const isCustom = !profile || profile.label === 'Custom Machine';

            // Steps/mm — locked for known machines (hardware-defined resolution)
            if (rolandStepsInput) {
                rolandStepsInput.readOnly = !isCustom;
            }

            // Max feed — locked for low-rigidity machines, editable otherwise
            if (rolandMaxFeedInput) {
                const lockFeed = !isCustom && (profile.maxFeedXY <= 15);
                rolandMaxFeedInput.readOnly = lockFeed;
            }

            // Spindle control — visibility depends on machine capability
            if (rolandSpindleModeSelect) {
                const hasSpindleControl = profile.supportsRC !== false;
                const spindleSection = rolandSpindleModeSelect.closest('.property-field');
                if (spindleSection) {
                    spindleSection.style.display = hasSpindleControl ? '' : 'none';
                }
            }

            // Spindle RPM field
            if (rpmField) {
                if (!profile.supportsRC) {
                    rpmField.style.display = 'none';
                }
            }

            // Clamp spindle speed to profile range if available
            if (rolandSpindleInput && profile.spindleRange) {
                rolandSpindleInput.min = profile.spindleRange.min;
                rolandSpindleInput.max = profile.spindleRange.max;
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

                    const fields = Array.from(section.querySelectorAll('input, select, button')).filter(f => !f.disabled && f.offsetParent !== null); // Check offsetParent for visibility
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