/*!
 * @file        ui/ui-machine-settings.js
 * @description Shared machine configuration UI — post-processor selection,
 *              Roland profiles, laser settings, and global CNC parameters.
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 *
 * SPDX-FileCopyrightText: 2025-2026 Eltryus - Ricardo Marques
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

(function() {
    'use strict';

    const D = window.CAMConfig.defaults;

    class MachineSettingsUI {
        constructor(ui) {
            this.ui = ui;
        }

        setup() {
            const opPanel = this.ui.traceOperationPanel || this.ui.shapeOperationPanel;
            const loadedSettings = this.ui.core.settings;

            // --- Roland machine profiles ---
            const rolandProcessor = this.ui.ctrl.gcodeGenerator.getProcessor('roland');
            const ROLAND_PROFILES = rolandProcessor?.profiles || {};
            const rolandSettings = loadedSettings.processorSettings?.roland || {};

            // --- Post-Processor Dropdown ---
            const postProcessorSelect = document.getElementById('post-processor');
            const startCodeTA = document.getElementById('start-code-ta');
            const endCodeTA = document.getElementById('end-code-ta');

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
                const generator = this.ui.ctrl.gcodeGenerator;
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

                    this.ui.core.updateSettings('gcode', {
                        postProcessor: newProcessor,
                        userStartCode: undefined,
                        userEndCode: undefined
                    });

                    const generator = this.ui.ctrl.gcodeGenerator;
                    if (generator && startCodeTA && endCodeTA) {
                        startCodeTA.value = generator.resolveStartCode(newProcessor, undefined);
                        endCodeTA.value = generator.resolveEndCode(newProcessor, undefined);
                    }

                    this.updateProcessorFieldVisibility(newProcessor);

                    this.ui.ctrl.modalManager.clearExportPreview();

                    const isRoland = newProcessor === 'roland';
                    if (isRoland) {
                        const currentModel = rolandSettings.rolandModel || 'mdx50';
                        const currentProfile = ROLAND_PROFILES[currentModel];
                        opPanel.parameterManager.updateMachineConstraints(currentProfile, 'roland');
                    } else {
                        opPanel.parameterManager.updateMachineConstraints({}, newProcessor);
                    }
                    

                    if (newProcessor !== wasProcessor) {
                        this.ui.setStatus(
                            `Switched to ${newProcessor}. Recalculate toolpaths to apply changes.`,
                            'warning'
                        );
                    }
                });
            }

            // --- Start/End Code ---
            if (startCodeTA) {
                const processor = loadedSettings.gcode.postProcessor;
                const generator = this.ui.ctrl.gcodeGenerator;
                startCodeTA.value = generator
                    ? generator.resolveStartCode(processor, loadedSettings.gcode.userStartCode)
                    : '';
                startCodeTA.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('gcode', { userStartCode: e.target.value });
                });
            }

            if (endCodeTA) {
                const processor = loadedSettings.gcode.postProcessor;
                const generator = this.ui.ctrl.gcodeGenerator;
                endCodeTA.value = generator
                    ? generator.resolveEndCode(processor, loadedSettings.gcode.userEndCode)
                    : '';
                endCodeTA.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('gcode', { userEndCode: e.target.value });
                });
            }

            // --- G-code Units ---
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
                    const profile = rolandProcessor?.profiles[modelId];
                    if (!profile) return;

                    const defaultRPM = profile.spindleFixed ||
                        (profile.spindleRange
                            ? Math.round((profile.spindleRange.min + profile.spindleRange.max) / 2)
                            : 10000);

                    if (rolandStepsInput) rolandStepsInput.value = profile.stepsPerMM;
                    if (rolandMaxFeedInput) rolandMaxFeedInput.value = profile.maxFeedXY;
                    if (rolandZModeSelect) rolandZModeSelect.value = profile.zMode;
                    if (rolandSpindleModeSelect) {
                        rolandSpindleModeSelect.value = profile.spindleMode;
                        rolandSpindleModeSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    if (rolandSpindleInput) rolandSpindleInput.value = defaultRPM;

                    const initCmd = profile.initCommand || ';;^DF';
                    const endCmd = profile.endCommand || ';;^DF';
                    const newStartCode = `${initCmd}\nPA;`;
                    const newEndCode = endCmd;

                    if (startCodeTA) startCodeTA.value = newStartCode;
                    if (endCodeTA) endCodeTA.value = newEndCode;

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

                    this.updateRolandProfileFields(profile);

                    opPanel.parameterManager.updateMachineConstraints(
                        profile,
                        this.ui.core.settings.gcode.postProcessor
                    );

                    if (opPanel) {
                        opPanel.refresh();
                    }

                    this.ui.setStatus(
                        `Roland profile: ${profile.label} (${profile.stepsPerMM} steps/mm, Z: ${profile.zMode})`, 'info'
                    );
                });
            }

            if (rolandStepsInput) {
                rolandStepsInput.value = rolandSettings.rolandStepsPerMM || initialProfile?.stepsPerMM || 100;
                rolandStepsInput.addEventListener('change', (e) => {
                    updateRolandSettings({ rolandStepsPerMM: parseInt(e.target.value) || 100 });
                });
            }

            if (rolandMaxFeedInput) {
                rolandMaxFeedInput.value = rolandSettings.rolandMaxFeed || initialProfile?.maxFeedXY || 60;
                rolandMaxFeedInput.addEventListener('change', (e) => {
                    updateRolandSettings({ rolandMaxFeed: parseFloat(e.target.value) || 60 });
                });
            }

            if (rolandZModeSelect) {
                rolandZModeSelect.value = rolandSettings.rolandZMode || initialProfile?.zMode || '3d';
                rolandZModeSelect.addEventListener('change', (e) => {
                    updateRolandSettings({ rolandZMode: e.target.value });
                });
            }

            if (rolandSpindleModeSelect) {
                rolandSpindleModeSelect.value = rolandSettings.rolandSpindleMode || initialProfile?.spindleMode || 'direct';
                rolandSpindleModeSelect.addEventListener('change', (e) => {
                    updateRolandSettings({ rolandSpindleMode: e.target.value });
                });
            }

            // --- Laser-specific fields ---
            const laserProfileSelect = document.getElementById('laser-profile-select');
            const laserSpotSizeInput = document.getElementById('laser-spot-size');
            const laserExportFormatSelect = document.getElementById('laser-export-format');
            const laserExportDpiInput = document.getElementById('laser-export-dpi');

            const laserSettings = loadedSettings.laser;

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

            if (laserLockDefaults) {
                laserLockDefaults.checked = laserSettings.profileLocked !== false;
                if (laserOverrideContainer) laserOverrideContainer.classList.toggle('is-locked-guardrail', laserLockDefaults.checked);

                laserLockDefaults.addEventListener('change', (e) => {
                    const isLocked = e.target.checked;
                    this.ui.core.updateSettings('laser', { profileLocked: isLocked });
                    if (laserOverrideContainer) laserOverrideContainer.classList.toggle('is-locked-guardrail', isLocked);

                    if (isLocked && laserProfileSelect) {
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
                    if (laserOverrideContainer) laserOverrideContainer.classList.add('is-locked-guardrail');
                    this.ui.core.updateSettings('laser', { profileLocked: true });
                }

                const isLocked = laserLockDefaults ? laserLockDefaults.checked : true;

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
                            profile.layerColors[layerName] = newColor;
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

                let initialLaserProfile = laserSettings.activeProfile || 'generic';
                if (!laserSettings.profiles[initialLaserProfile]) {
                    initialLaserProfile = 'generic';
                }
                laserProfileSelect.value = initialLaserProfile;

                applyLaserProfile(laserProfileSelect.value);

                laserProfileSelect.addEventListener('change', (e) => {
                    applyLaserProfile(e.target.value, true);
                    const profile = laserSettings.profiles?.[e.target.value];
                    this.ui.setStatus(`Laser profile: ${profile?.label || e.target.value}`, 'info');
                    this.invalidateLaserOperations('Laser profile changed. Regeneration recommended.');
                });
            }

            if (laserSpotSizeInput) {
                laserSpotSizeInput.value = laserSettings.spotSize;
                laserSpotSizeInput.addEventListener('change', (e) => {
                    const newSpotSize = parseFloat(e.target.value);
                    this.ui.core.updateSettings('laser', { spotSize: newSpotSize });
                    this.invalidateLaserOperations('Laser spot size changed. Please regenerate laser paths.');

                    if (opPanel?.currentOperation) {
                        const opId = opPanel.currentOperation.id;
                        opPanel.parameterManager.setParameter(opId, 'geometry', 'laserSpotSize', newSpotSize);
                        const propInput = document.getElementById('prop-laserSpotSize');
                        if (propInput) propInput.value = newSpotSize;
                    }
                });
            }

            if (laserExportFormatSelect) {
                laserExportFormatSelect.value = laserSettings.exportFormat;
                laserExportFormatSelect.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('laser', { exportFormat: e.target.value });
                    updateFormatDependentVisibility(e.target.value);
                });
                updateFormatDependentVisibility(laserExportFormatSelect.value);
            }

            if (laserExportDpiInput) {
                laserExportDpiInput.value = laserSettings.exportDPI || 1000;
                laserExportDpiInput.addEventListener('change', (e) => {
                    this.ui.core.updateSettings('laser', { exportDPI: parseInt(e.target.value, 10) || 1000 });
                });
            }

            // --- Universal fields ---
            const thicknessInput = document.getElementById('pcb-thickness');
            if (thicknessInput) {
                thicknessInput.value = loadedSettings.machine.pcb?.thickness ?? '';
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

            // Apply initial visibility
            this.updateProcessorFieldVisibility(loadedSettings.gcode.postProcessor);
            this.updatePipelineFieldVisibility();
            if (initialProfile) this.updateRolandProfileFields(initialProfile);
        }

        // ═══════════════════════════════════════════════════════════════
        // Processor / Pipeline / Roland Visibility
        // ═══════════════════════════════════════════════════════════════

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
        }

        updatePipelineFieldVisibility() {
            const ctrl = this.ui.ctrl;
            if (!ctrl) return;

            const pipelineType = ctrl.pipelineState?.type || 'cnc';
            const machineSection = document.querySelector('.sidebar-section.machine-section');
            if (!machineSection) return;
            machineSection.style.display = '';

            const machineControls = document.getElementById('machine-controls');
            if (!machineControls) return;

            const isCNC = pipelineType === 'cnc' || pipelineType === 'hybrid';
            const isLaser = ctrl.isLaserPipeline?.() || false;

            machineControls.querySelectorAll('[data-pipeline-group="cnc"]').forEach(el => {
                el.style.display = isCNC ? '' : 'none';
            });
            machineControls.querySelectorAll('[data-pipeline-group="laser"]').forEach(el => {
                el.style.display = isLaser ? '' : 'none';
            });
        }

        updateRolandProfileFields(profile) {
            const rolandStepsInput = document.getElementById('roland-steps-per-mm');
            const rolandMaxFeedInput = document.getElementById('roland-max-feed');
            const rolandSpindleModeSelect = document.getElementById('roland-spindle-mode');
            const rolandSpindleInput = document.getElementById('roland-spindle-speed');
            const rpmField = document.getElementById('roland-spindle-rpm-field');

            const isCustom = !profile || profile.label === 'Custom Machine';

            if (rolandStepsInput) rolandStepsInput.readOnly = !isCustom;

            if (rolandMaxFeedInput) {
                const lockFeed = !isCustom && (profile.maxFeedXY <= 15);
                rolandMaxFeedInput.readOnly = lockFeed;
            }

            if (rolandSpindleModeSelect) {
                const hasSpindleControl = profile.supportsRC !== false;
                const spindleSection = rolandSpindleModeSelect.closest('.property-field');
                if (spindleSection) spindleSection.style.display = hasSpindleControl ? '' : 'none';
            }

            if (rpmField && !profile.supportsRC) {
                rpmField.style.display = 'none';
            }

            if (rolandSpindleInput && profile.spindleRange) {
                rolandSpindleInput.min = profile.spindleRange.min;
                rolandSpindleInput.max = profile.spindleRange.max;
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // Laser Invalidation
        // ═══════════════════════════════════════════════════════════════

        invalidateLaserOperations(reasonMessage, affectedTypes = null) {
            let invalidated = false;

            this.ui.core.operations.forEach(op => {
                if (!this.ui.ctrl?.isLaserExportForOperation?.(op.type)) return;
                if (!this.ui.core.isExportReady(op)) return;
                if (affectedTypes && !affectedTypes.includes(op.type)) return;

                op.exportReady = false;
                if (op.preview) op.preview.ready = false;
                op.isInvalidated = true;
                op.invalidatedReason = reasonMessage;
                invalidated = true;

                const treePanel = this.ui.navTreePanel;
                if (treePanel) {
                    const fileNode = treePanel.getNodeByOperationId(op.id);
                    if (fileNode) treePanel.updateFileGeometries(fileNode.id, op);
                }
            });

            if (invalidated && reasonMessage) {
                this.ui.setStatus('Existing geometry invalidated. Please review operations.', 'warning');
            }
        }

        debug(message, data = null) {
            if (D.debug.enabled) {
                data !== null
                    ? console.log(`[MachineSettings] ${message}`, data)
                    : console.log(`[MachineSettings] ${message}`);
            }
        }
    }

    window.MachineSettingsUI = MachineSettingsUI;
})();