/**
 * @file        ui/ui-controls.js
 * @description Manages the user interactivity
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
    const debugConfig = config.debug || {};
    const uiConfig = config.ui || {};
    
    class UIControls {
        constructor(ui) {
            this.ui = ui;
            this.renderer = null;
            this.coordinateSystem = null;
            
            // Arc reconstruction state
            this.arcReconstructionEnabled = false;
            
            // Control groups
            this.debugControls = [];
            this.renderControls = [];
            this.offsetControls = [];
            
            // Input tracking
            this.inputTracking = {
                lastXValue: '0',
                lastYValue: '0',
                isUpdating: false
            };
        }
        
        init(renderer, coordinateSystem) {
            this.renderer = renderer;
            this.coordinateSystem = coordinateSystem;

            console.log("[UIControls] Initializing controls...");

            // Directly call setup methods to attach listeners
            this.setupVisualizationToggles(); // Centralized toggle setup
            this.setupOffsetControls();
            this.setupRotationControls();
            this.setupZoomControls();
            this.setupCollapsibleMenus();
            this.setupMachineSettings(); // Moved from cam-ui.js

            // Link coordinate system changes back to UI updates
            if (this.coordinateSystem) {
                this.coordinateSystem.addChangeListener(() => {
                    this.updateOffsetInputsWithTracking();
                });
            }

            console.log("[UIControls] Controls initialized.");
            return true;
        }

        setupVisualizationToggles() {
             if (!this.renderer) return;

             console.log("[UIControls] Setting up visualization toggles...");

            const toggleMappings = [
                // Display Group
                { id: 'show-grid', option: 'showGrid', default: true, triggersRender: true },
                { id: 'show-wireframe', option: 'showWireframe', default: false, triggersRender: true },
                { id: 'show-bounds', option: 'showBounds', default: false, triggersRender: true },
                { id: 'show-rulers', option: 'showRulers', default: true, triggersRender: true },
                // Layers Group
                { id: 'show-regions', option: 'showRegions', default: true, triggersRender: true },
                { id: 'show-traces', option: 'showTraces', default: true, triggersRender: true },
                { id: 'show-pads', option: 'showPads', default: true, triggersRender: true },
                { id: 'show-drills', option: 'showDrills', default: true, triggersRender: true },
                { id: 'show-cutouts', option: 'showCutouts', default: true, triggersRender: true },
                // Advanced Group
                { id: 'fuse-geometry', option: 'fuseGeometry', default: false, triggersUpdate: true }, // Triggers full update
                { id: 'show-preprocessed', option: 'showPreprocessed', default: false, triggersUpdate: true }, // Triggers full update
                { id: 'enable-arc-reconstruction', option: 'enableArcReconstruction', default: false, triggersUpdate: true }, // Triggers full update
                { id: 'debug-points', option: 'debugPoints', default: false, triggersRender: true }, // Simple render
                { id: 'debug-paths', option: 'debugPaths', default: false, triggersRender: true }, // Simple render
                { id: 'black-and-white', option: 'blackAndWhite', default: false, triggersRender: true }
            ];

            toggleMappings.forEach(mapping => {
                const element = document.getElementById(mapping.id);
                if (!element) {
                     console.warn(`[UIControls] Toggle element not found: #${mapping.id}`);
                    return;
                }

                // Initialize state from renderer options or defaults
                element.checked = this.renderer.options[mapping.option] !== undefined
                                  ? this.renderer.options[mapping.option]
                                  : mapping.default;

                // Attach listener
                element.addEventListener('change', async (e) => {
                     console.log(`[UIControls] Toggle changed: ${mapping.option} = ${e.target.checked}`);
                    const isChecked = e.target.checked;

                    // Special handling for dependent toggles
                    if (mapping.id === 'enable-arc-reconstruction' && isChecked && !this.renderer.options.fuseGeometry) {
                        e.target.checked = false; // Prevent enabling arc without fusion
                        this.ui.statusManager?.showStatus('Enable Fusion Mode first', 'warning');
                        return;
                    }
                    if (mapping.id === 'show-preprocessed' && isChecked && !this.renderer.options.fuseGeometry) {
                        e.target.checked = false; // Prevent enabling preprocessed without fusion
                        this.ui.viewState.showPreprocessed = false; // ← Ensure sync
                        this.ui.statusManager?.showStatus('Enable Fusion Mode first', 'warning');
                        return;
                    }

                    // Update renderer options
                    this.renderer.setOptions({ [mapping.option]: isChecked });

                    // Update internal state if necessary (used by other logic)
                    if (mapping.option === 'enableArcReconstruction') {
                        this.arcReconstructionEnabled = isChecked;
                         this.ui.viewState.enableArcReconstruction = isChecked; // Keep UI state synced
                        this.updateArcReconstructionStats(); // Update stats display
                    }
                     if (mapping.option === 'fuseGeometry') {
                          this.ui.viewState.fuseGeometry = isChecked; // Keep UI state synced
                         if (!isChecked) this.resetFusionStates(); // Reset dependents if fusion is turned off
                    }
                     if (mapping.option === 'showPreprocessed') {
                          this.ui.viewState.showPreprocessed = isChecked; // Keep UI state synced
                    }


                    // Trigger appropriate update
                    if (mapping.triggersUpdate) {
                         console.log(`[UIControls] Triggering full UI update for ${mapping.option}`);
                        if (mapping.option === 'enableArcReconstruction' || mapping.option === 'fuseGeometry') {
                             if (this.ui.core.geometryProcessor) {
                                  this.ui.core.geometryProcessor.clearCachedStates(); // Clear cache on fusion/arc changes
                             }
                        }
                        await this.ui.updateRendererAsync(); // Full update involves re-processing geometry
                    } else if (mapping.triggersRender) {
                         console.log(`[UIControls] Triggering simple render for ${mapping.option}`);
                        this.renderer.render(); // Simple render just redraws
                    }
                });
            });
             console.log("[UIControls] Visualization toggles setup complete.");
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
                xInput.removeAttribute('readonly');
                yInput.removeAttribute('readonly');
                
                this.inputTracking.lastXValue = xInput.value || '0';
                this.inputTracking.lastYValue = yInput.value || '0';
                
                const handleValueChange = () => {
                    if (this.inputTracking.isUpdating) return;
                    
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
                
                this.offsetControls.push(xInput, yInput);
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
        
        resetFusionStates() {
            // Reset preprocessed view
            this.ui.viewState.showPreprocessed = false;
            const preprocessedToggle = document.getElementById('show-preprocessed');
            if (preprocessedToggle) {
                preprocessedToggle.checked = false;
            }
            
            // Reset arc reconstruction
            this.arcReconstructionEnabled = false;
            this.ui.viewState.enableArcReconstruction = false;
            const arcToggle = document.getElementById('enable-arc-reconstruction');
            if (arcToggle) {
                arcToggle.checked = false;
            }
            
            this.ui.fusionStats.arcReconstructionEnabled = false;
            this.updateArcReconstructionStats();
        }
        
        updateArcReconstructionStats() {
            const statsContainer = document.getElementById('arc-reconstruction-stats');
            if (!statsContainer) return;
            
            const stats = this.ui.fusionStats;
            
            if (stats.arcReconstructionEnabled && stats.curvesRegistered > 0) {
                statsContainer.classList.remove('hidden');
                const successRate = stats.curvesRegistered > 0 ? 
                    ((stats.curvesReconstructed / stats.curvesRegistered) * 100).toFixed(1) : 0;
                
                statsContainer.innerHTML = `
                    <div>Curves registered: ${stats.curvesRegistered}</div>
                    <div>Curves reconstructed: ${stats.curvesReconstructed}</div>
                    <div>Curves lost: ${stats.curvesLost}</div>
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
                this.inputTracking.isUpdating = true;
                
                const offset = this.coordinateSystem.getOffsetFromSaved();
                const newXValue = offset.x.toFixed(1);
                const newYValue = offset.y.toFixed(1);
                
                xInput.value = newXValue;
                yInput.value = newYValue;
                
                this.inputTracking.lastXValue = newXValue;
                this.inputTracking.lastYValue = newYValue;
                
                this.inputTracking.isUpdating = false;
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
                this.inputTracking.isUpdating = true;
                
                const xInput = document.getElementById('x-offset');
                const yInput = document.getElementById('y-offset');
                if (xInput) {
                    xInput.value = '0';
                    this.inputTracking.lastXValue = '0';
                }
                if (yInput) {
                    yInput.value = '0';
                    this.inputTracking.lastYValue = '0';
                }
                
                this.inputTracking.isUpdating = false;
                
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
                fitBtn.addEventListener('click', () => this.renderer?.zoomFit());
            }
            if (inBtn) {
                inBtn.addEventListener('click', () => this.renderer?.zoomIn());
            }
            if (outBtn) {
                outBtn.addEventListener('click', () => this.renderer?.zoomOut());
            }
        }

        setupCollapsibleMenus() {
            const headers = document.querySelectorAll('.collapsible-header');
            headers.forEach(header => {
                const targetId = header.getAttribute('data-target');
                const content = document.getElementById(targetId);
                const indicator = header.querySelector('.collapse-indicator');

                // Set initial indicator state
                if (content && indicator) {
                    indicator.textContent = content.classList.contains('collapsed') ? '▼' : '▲';
                }

                // Add click listener
                header.addEventListener('click', () => {
                    if (content) {
                        content.classList.toggle('collapsed');
                        if (indicator) {
                            indicator.textContent = content.classList.contains('collapsed') ? '▼' : '▲';
                        }
                    }
                });
            });
        }

        setupMachineSettings() {
            const thicknessInput = document.getElementById('pcb-thickness');
            if (thicknessInput) {
                thicknessInput.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('pcb', { thickness: parseFloat(e.target.value) });
                });
            }
            
            const safeZInput = document.getElementById('safe-z');
            if (safeZInput) {
                safeZInput.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('machine', { safeZ: parseFloat(e.target.value) });
                });
            }
            
            const travelZInput = document.getElementById('travel-z');
            if (travelZInput) {
                travelZInput.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('machine', { travelZ: parseFloat(e.target.value) });
                });
            }
            
            const rapidFeedInput = document.getElementById('rapid-feed');
            if (rapidFeedInput) {
                rapidFeedInput.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('machine', { rapidFeed: parseFloat(e.target.value) });
                });
            }
            
            const postProcessorSelect = document.getElementById('post-processor');
            if (postProcessorSelect) {
                postProcessorSelect.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('gcode', { postProcessor: e.target.value });
                });
            }
            
            const gcodeUnitsSelect = document.getElementById('gcode-units');
            if (gcodeUnitsSelect) {
                gcodeUnitsSelect.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('gcode', { units: e.target.value });
                });
            }
        }
    }
    
    window.UIControls = UIControls;
    
})();