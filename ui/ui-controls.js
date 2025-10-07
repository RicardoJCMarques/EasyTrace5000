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
            
            this.setupDebugControls();
            this.setupRenderControls();
            this.setupOffsetControls();
            this.setupRotationControls();
            
            return true;
        }
        
        setupDebugControls() {
            // Wireframe toggle
            const showWireframe = document.getElementById('show-wireframe');
            if (showWireframe && this.renderer) {
                showWireframe.checked = this.renderer.options.showWireframe || false;
                
                showWireframe.addEventListener('change', async (e) => {
                    this.renderer.setOptions({ showWireframe: e.target.checked });
                    await this.ui.updateRendererAsync();
                    this.ui.statusManager.showStatus(
                        e.target.checked ? 'Wireframe mode enabled' : 'Fill mode enabled', 
                        'info'
                    );
                });
                
                this.debugControls.push(showWireframe);
            }
            
            // Fusion toggle
            const fuseToggle = document.getElementById('fuse-geometry');
            if (fuseToggle && this.renderer) {
                fuseToggle.checked = this.renderer.options.fuseGeometry || false;
                
                fuseToggle.addEventListener('change', async (e) => {
                    this.renderer.setOptions({ fuseGeometry: e.target.checked });
                    
                    if (e.target.checked) {
                        const arcMsg = this.arcReconstructionEnabled ? 
                            ' with arc reconstruction...' : '...';
                        this.ui.statusManager.showStatus('Running Clipper2 fusion pipeline' + arcMsg, 'info');
                    } else {
                        this.ui.statusManager.showStatus('Fusion disabled', 'info');
                        this.resetFusionStates();
                    }
                    
                    await this.ui.updateRendererAsync();
                });
                
                this.debugControls.push(fuseToggle);
            }
            
            // Preprocessed view toggle
            const showPreprocessed = document.getElementById('show-preprocessed');
            if (showPreprocessed && this.renderer) {
                showPreprocessed.checked = false;
                
                showPreprocessed.addEventListener('change', async (e) => {
                    if (!this.renderer.options.fuseGeometry) {
                        e.target.checked = false;
                        this.ui.statusManager.showStatus('Enable fusion first to view preprocessed geometry', 'warning');
                        return;
                    }
                    
                    this.ui.viewState.showPreprocessed = e.target.checked;
                    
                    this.ui.statusManager.showStatus(
                        e.target.checked ? 'Switching to preprocessed view...' : 'Switching to fused view...', 
                        'info'
                    );
                    
                    await this.ui.updateRendererAsync();
                });
                
                this.debugControls.push(showPreprocessed);
            }
            
            // Arc reconstruction toggle
            const arcReconstructToggle = document.getElementById('enable-arc-reconstruction');
            if (arcReconstructToggle && this.renderer) {
                arcReconstructToggle.checked = this.arcReconstructionEnabled;
                
                arcReconstructToggle.addEventListener('change', async (e) => {
                    if (!this.renderer.options.fuseGeometry) {
                        e.target.checked = false;
                        this.arcReconstructionEnabled = false;
                        this.ui.statusManager.showStatus('Enable fusion first to use arc reconstruction', 'warning');
                        return;
                    }
                    
                    this.arcReconstructionEnabled = e.target.checked;
                    this.ui.viewState.enableArcReconstruction = e.target.checked;
                    
                    const msg = e.target.checked ? 
                        'Arc reconstruction enabled - rerunning fusion...' : 
                        'Arc reconstruction disabled - rerunning fusion...';
                    this.ui.statusManager.showStatus(msg, 'info');
                    
                    if (this.ui.core.geometryProcessor) {
                        this.ui.core.geometryProcessor.clearCachedStates();
                    }
                    
                    await this.ui.updateRendererAsync();
                    this.updateArcReconstructionStats();
                });
                
                this.debugControls.push(arcReconstructToggle);
            }

            // Debug Curve Points toggle
            const debugCurvePoints = document.getElementById('debug-curve-points');
            if (debugCurvePoints && this.renderer) {
                debugCurvePoints.checked = this.renderer.options.debugCurvePoints || false;
                
                debugCurvePoints.addEventListener('change', async (e) => {
                    
                    // This option is part of the core renderer options
                    this.renderer.setOptions({ debugCurvePoints: e.target.checked });
                    
                    // No need to re-fuse, just re-render
                    this.renderer.render();
                    
                    this.ui.statusManager.showStatus(
                        e.target.checked ? 'Curve point debug enabled' : 'Curve point debug disabled', 
                        'info'
                    );
                });
                
                this.debugControls.push(debugCurvePoints);
            }
        }
        
        setupRenderControls() {
            const controls = [
                { id: 'show-pads', option: 'showPads', default: true },
                { id: 'show-grid', option: 'showGrid', default: true },
                { id: 'show-rulers', option: 'showRulers', default: true },
                { id: 'show-bounds', option: 'showBounds', default: false },
                { id: 'show-regions', option: 'showRegions', default: true },
                { id: 'show-traces', option: 'showTraces', default: true },
                { id: 'show-cutouts', option: 'showCutouts', default: true },
                { id: 'show-drills', option: 'showDrills', default: true }
            ];
            
            controls.forEach(control => {
                const element = document.getElementById(control.id);
                if (element && this.renderer) {
                    element.checked = this.renderer.options[control.option] !== undefined ? 
                        this.renderer.options[control.option] : control.default;
                    
                    element.onchange = (e) => {
                        this.renderer.setOptions({ [control.option]: e.target.checked });
                    };
                    
                    this.renderControls.push(element);
                }
            });
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
    }
    
    // Export
    window.UIControls = UIControls;
    
})();