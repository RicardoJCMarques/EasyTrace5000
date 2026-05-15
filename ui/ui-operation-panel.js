/*!
 * @file        ui/ui-operation-panel.js
 * @description Parameter input builder (right sidebar)
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
    const inspectorConfig = C.ui.operationPanel;
    const timingConfig = D.ui.timing;
    const layoutConfig = D.layout;

    class OperationPanel {
        constructor(ui) {
            this.ui = ui;
            this.core = ui.core;
            this.lang = ui.lang;
            this.toolLibrary = null;
            this.parameterManager = null;

            this.currentOperation = null;
            this.currentGeometryStage = 'geometry';

            // Track input changes for auto-save
            this.changeTimeout = null;
        }

        init(toolLibrary, parameterManager) {
            this.toolLibrary = toolLibrary;
            this.parameterManager = parameterManager || new ParameterManager();

            // Listen for parameter changes from other sources
            this.parameterManager.addChangeListener((change) => {
                this.onExternalParameterChange(change);
            });

            this.debug('Initialized with parameter manager');
        }

        clearProperties() {
            this.currentOperation = null;
            this.currentGeometryStage = 'geometry';
        }

        setupPropertyGridNavigation(container) {
            const getNavigableItems = () => {
                return Array.from(container.querySelectorAll(
                    '.property-field, .tooltip-trigger, input:not([disabled]), select:not([disabled]), button:not([disabled])'
                )).filter(el => {
                    if (el.offsetParent === null) return false;
                    // Avoid duplicates: skip inputs/selects/buttons inside property-field if the field already exists
                    if (el.matches('input, select') && el.closest('.property-field')) {
                        return false; // Navigate to row first, then Enter to edit
                    }
                    return true;
                });
            };

            const items = getNavigableItems();
            if (items.length === 0) return;

            items.forEach((el, idx) => {
                el.setAttribute('tabindex', idx === 0 ? '0' : '-1');
            });

            // Prevent attaching multiple listeners to the same container
            if (container.dataset.hasNavListener === 'true') return;
            container.dataset.hasNavListener = 'true';

            container.addEventListener('keydown', (e) => {
                const focused = document.activeElement;
                if (!container.contains(focused)) return;

                const currentItems = getNavigableItems();
                const currentIdx = currentItems.indexOf(focused);

                const isEditing = focused.matches('input, select, textarea') && 
                                  focused.closest('.property-field');
                const isTooltip = focused.classList.contains('tooltip-trigger');

                // Up/Down: always navigate (except open select dropdown)
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    if (focused.tagName === 'SELECT') return; // let native handle

                    e.preventDefault();

                    // Close tooltip if open
                    if (window.TooltipManager) {
                        window.TooltipManager.hide();
                    }

                    const nextIdx = e.key === 'ArrowDown' ? currentIdx + 1 : currentIdx - 1;
                    if (currentItems[nextIdx]) {
                        focused.setAttribute('tabindex', '-1');
                        currentItems[nextIdx].setAttribute('tabindex', '0');
                        currentItems[nextIdx].focus();
                    }
                    return;
                }

                // Enter/Space on row: enter edit mode
                if ((e.key === 'Enter' || e.key === ' ') && focused.classList.contains('property-field')) {
                    e.preventDefault();
                    const input = focused.querySelector('input:not([disabled]), select:not([disabled])');
                    if (input) {
                        input.focus();
                        if (input.select) input.select();
                    }
                    return;
                }

                // Enter in input: commit and move to next item
                if (e.key === 'Enter' && isEditing && !focused.matches('textarea')) {
                    e.preventDefault();
                    focused.blur();
                    const nextIdx = currentIdx + 1;
                    if (currentItems[nextIdx]) {
                        currentItems[nextIdx].setAttribute('tabindex', '0');
                        currentItems[nextIdx].focus();
                    }
                    return;
                }

                // Escape: exit edit mode or close tooltip
                if (e.key === 'Escape') {
                    if (isEditing) {
                        e.preventDefault();
                        e.stopPropagation();
                        focused.blur();
                        const row = focused.closest('.property-field');
                        if (row) {
                            row.setAttribute('tabindex', '0');
                            row.focus();
                        }
                    } else if (isTooltip) {
                        e.preventDefault();
                        if (window.TooltipManager) {
                            window.TooltipManager.hide();
                        }
                        // Move to next item (typically the row below)
                        const nextIdx = currentIdx + 1;
                        if (currentItems[nextIdx]) {
                            focused.setAttribute('tabindex', '-1');
                            currentItems[nextIdx].setAttribute('tabindex', '0');
                            currentItems[nextIdx].focus();
                        }
                    }
                }
            });
        }

        showOperationProperties(operation, geometryStage = 'geometry') {
            if (!operation) {
                this.clearProperties();
                return;
            }

            const isSameOperation = this.currentOperation && this.currentOperation.id === operation.id;

            if (!isSameOperation) {
                // Switching operations: save outgoing, load incoming
                if (this.currentOperation) {
                    this.saveCurrentState();
                }
                this.currentOperation = operation;
            }

            // Resolve pipeline type once
            const pipelineType = window.pcbcam?.pipelineState?.type || 'cnc';
            const isLaser = window.pcbcam?.isLaserPipeline?.() || false;

            // Remap CNC-originated stages to laser/stencil equivalents
            const isStencil = operation.type === 'stencil';
            if ((isLaser || isStencil) && (geometryStage === 'strategy' || geometryStage === 'machine')) {
                const isReady = window.pcbcam?.core?.isExportReady(operation);
                geometryStage = isReady ? 'export_summary' : 'geometry';
            }

            this.currentGeometryStage = geometryStage;

            // Export summary is display-only (no editable parameters)
            if (geometryStage === 'export_summary') {
                this.renderExportSummary(operation);
                return;
            }

            // Only load from operation.settings when switching to a new operation.
            // Re-rendering the same operation (e.g. after a checkbox toggle that changes field visibility) must use the live ParameterManager state, which already has the user's uncommitted edits.
            if (!isSameOperation) {
                this.parameterManager.loadFromOperation(operation);
            }

            const container = document.getElementById('property-form');
            const title = document.getElementById('inspector-title');

            if (!container || !title) return;

            title.textContent = operation.file.name;
            container.innerHTML = '';

            // Invalidation Warning Panel
            if (operation.isInvalidated) {
                const invalidPanel = this.createInvalidationPanel(operation);
                container.appendChild(invalidPanel);
            }

            // Geometry summary panel (visible for source geometry stage)
            if (geometryStage === 'geometry') {
                const summaryPanel = this.createGeometrySummary(operation);
                if (summaryPanel) {
                    container.appendChild(summaryPanel);
                }
            }

            // Show warnings if any
            if (operation.warnings && operation.warnings.length > 0) {
                const warningMessages = operation.warnings.map(w => 
                    typeof w === 'string' ? { message: w } : w
                );
                container.appendChild(this.createWarningPanel(warningMessages));
            }

            // Get appropriate parameters for this stage and operation type
            const stageParams = this.parameterManager.getStageParameters(geometryStage, operation.type, pipelineType);
            const currentValues = this.parameterManager.getParameters(operation.id, geometryStage);

            // Group parameters by category
            const categories = this.groupByCategory(stageParams);

            // Render each category
            for (const [category, params] of Object.entries(categories)) {
                const section = this.createSection(
                    this.getCategoryTitle(category),
                    params.map(param => this.createField(param, currentValues[param.name]))
                );
                container.appendChild(section);
            }

            // Add action button
            const actionText = this.getActionButtonText(geometryStage, operation.type);
            if (actionText) {
                container.appendChild(this.createActionButton(actionText));
            }

            this.attachEventHandlers(container);
            this.setupPropertyGridNavigation(container);

            // Disable Drill Exclude if no drill operation is loaded
            if (operation.type === 'stencil' && geometryStage === 'geometry') {
                const hasDrill = this.core.operations.some(op => op.type === 'drill' && op.primitives && op.primitives.length > 0);
                const excludeInput = document.getElementById('prop-stencilExcludeDrillPads');
                
                if (excludeInput) {
                    excludeInput.disabled = !hasDrill;
                    const wrapper = excludeInput.closest('.checkbox-label');
                    if (wrapper) {
                        wrapper.style.opacity = hasDrill ? '1' : '0.5';
                        wrapper.title = hasDrill ? '' : 'No drill operations loaded. Add a drill file first.';
                    }
                }
            }
        }

        createInvalidationPanel(operation) {
            const template = document.getElementById('invalidation-panel-template');
            if (!template) return document.createElement('div'); // Fallback if template missing

            // Clone the template
            const panelNode = template.content.cloneNode(true);
            const panel = panelNode.querySelector('.invalidation-panel');
            const msg = panel.querySelector('.warning-message');
            const redoBtn = panel.querySelector('.invalidation-redo-btn');

            // Apply specific text
            msg.textContent = operation.invalidatedReason || 'Global machine settings have changed. Existing geometry is incompatible and must be regenerated.';

            // Attach functionality
            redoBtn.onclick = async () => {
                // Clear the invalid geometry data
                this.ui.core.resetOperationState(operation.id);

                // Remove the old visual layers from the canvas renderer
                const layerKeys = Array.from(this.ui.renderer.layers.keys())
                    .filter(key => key.includes(`_${operation.id}_`));
                layerKeys.forEach(key => this.ui.renderer.layers.delete(key));

                // Update the Nav Tree to remove the red strike-through nodes
                if (this.ui.navTreePanel) {
                    const fileNode = this.ui.navTreePanel.getNodeByOperationId(operation.id);
                    if (fileNode) {
                        this.ui.navTreePanel.updateFileGeometries(fileNode.id, operation);
                    }
                }

                // Update canvas and reset side-panel view
                await this.ui.updateRendererAsync();
                this.switchGeometryStage('geometry');
                this.ui.showStatus('Invalid geometry cleared. Ready to regenerate.', 'success');
            };

            return panel;
        }

        groupByCategory(params) {
            const groups = {};
            for (const param of params) {
                const category = param.category || 'general';
                if (!groups[category]) groups[category] = [];
                groups[category].push(param);
            }
            return groups;
        }

        getCategoryTitle(category) {
            const categoryTitles = inspectorConfig.categories;
            const title = categoryTitles[category] || category.charAt(0).toUpperCase() + category.slice(1);
            return title;
        }

        getActionButtonText(stage, operationType) {
            // Stencil — always 2-stage regardless of pipeline
            if (operationType === 'stencil') {
                if (stage === 'geometry') return 'Generate Stencil';
                if (stage === 'export_summary') return 'Export Manager';
                return null;
            }

            const isLaser = window.pcbcam?.isLaserPipeline?.() || false;

            // Laser stages
            if (isLaser) {
                if (stage === 'geometry') {
                    if (operationType === 'cutout') return 'Generate Laser Cut Path';
                    if (operationType === 'drill') return 'Generate Drill Marks';
                    return 'Generate Laser Paths';
                }
                if (stage === 'export_summary') return 'Export Manager';
                return null;
            }

            // CNC stages
            if (stage === 'geometry') {
                if (operationType === 'drill') return 'Generate Drill Strategy';
                if (operationType === 'cutout') return 'Generate Cutout Path';
                return 'Generate Offsets';
            } else if (stage === 'strategy') {
                return 'Generate Preview';
            } else if (stage === 'machine') {
                return 'Export Manager';
            }
            return null;
        }

        createSection(title, fields) {
            const section = document.createElement('div');
            section.className = 'property-section';

            const h3 = document.createElement('h3');
            h3.textContent = title;
            section.appendChild(h3);

            fields.forEach(field => section.appendChild(field));

            return section;
        }

        createField(param, currentValue) {
            const field = document.createElement('div');
            field.className = 'property-field';
            field.dataset.param = param.name;

            // Handle conditionals
            if (param.conditional) {
                field.dataset.conditional = param.conditional;
                // Will be evaluated in attachEventHandlers
            }

            const inputId = `prop-${param.name}`;

            const label = document.createElement('label');
            label.setAttribute('for', inputId);

            // Use param.name as the key (e.g., "toolDiameter", "passes")
            const helpKey = param.name; 
            const labelText = this.lang.get('parameters.' + helpKey, param.label);
            label.textContent = labelText;
            field.appendChild(label);

            // Check if a helpKey exists and the strings have been loaded
            const tooltipKey = 'tooltips.parameters.' + helpKey;
            if (this.lang.has(tooltipKey)) {

                // Get the tooltip text from en.json
                const helpText = this.lang.get(tooltipKey);
                // The title is the label text just found
                const helpTitle = labelText; 

                if (helpText && window.TooltipManager) {
                    // This will create the '?' icon at the end of the label
                    window.TooltipManager.attachWithIcon(label, { title: helpTitle, text: helpText }, {
                        showOnFocus: true
                    });
                }
            }

            // Use default if no current value
            if (currentValue === undefined) {
                const defaults = this.parameterManager.getDefaults(this.currentOperation.type);
                currentValue = defaults[param.name];
            }

            // Hide spindle speed for machines without software spindle control
            if (param.name === 'spindleSpeed') {
                const postProcessor = this.core.settings?.gcode?.postProcessor;
                if (postProcessor === 'roland') {
                    const rolandModel = this.core.settings?.machine?.rolandModel || 'mdx50';
                    const rolandProcessor = window.pcbcam?.gcodeGenerator?.getProcessor('roland');
                    const profile = rolandProcessor?.profiles?.[rolandModel];
                    if (profile && !profile.supportsRC) {
                        field.style.display = 'none';
                        return field; 
                    }
                }
            }

            switch (param.type) {
                case 'number':
                    this.createNumberField(field, param, currentValue);
                    break;
                case 'checkbox':
                    this.createCheckboxField(field, param, currentValue);
                    break;
                case 'select':
                    this.createSelectField(field, param, currentValue);
                    break;
                case 'textarea':
                    this.createTextAreaField(field, param, currentValue);
                    break;
                default:
                    console.warn(`[OperationPanel] Unknown parameter type: ${param.type}`);
            }

            return field;
        }

        createNumberField(field, param, value) {
            const wrapper = document.createElement('div');
            wrapper.className = 'input-unit';

            const input = document.createElement('input');
            input.type = 'number';
            input.id = `prop-${param.name}`;
            input.value = value ?? 0;
            if (param.min !== undefined) input.min = param.min;
            if (param.max !== undefined) input.max = param.max;
            if (param.step !== undefined) input.step = param.step;

            // If the parameter has a unit (e.g., "mm"), attach it with the label for screen readers
            if (param.unit) {
                input.setAttribute('aria-label', `${param.label} in ${param.unit}`);
            }

            if (param.readOnly) {
                input.readOnly = true;
                input.classList.add('input-readonly');
            }

            wrapper.appendChild(input);

            if (param.unit) {
                const unitSpan = document.createElement('span');
                unitSpan.className = 'unit';
                unitSpan.textContent = param.unit;
                unitSpan.setAttribute('aria-hidden', 'true'); // Hide visual unit from SR since it's in the label now
                wrapper.appendChild(unitSpan);
            }

            field.appendChild(wrapper);
        }

        createCheckboxField(field, param, value) {
            const label = field.querySelector('label');

            // Safely rescue the tooltip icon DOM element before wiping the label
            const icon = label.querySelector('.tooltip-trigger');
            if (icon) {
                label.removeChild(icon);
            }

            // Fetch the clean text directly from the dictionary (avoids the '?' text bug)
            const labelText = this.lang.get('parameters.' + param.name, param.label);

            // Clear the label and set the class
            label.textContent = ''; 
            label.className = 'checkbox-label';

            // Remove the 'for' attribute — it was set by createField() for standard label+input pairs, but checkbox labels WRAP their input instead.
            // Keeping 'for' causes the browser to redirect all clicks inside the label (including the tooltip trigger) to the checkbox input, stealing focus and preventing the tooltip from ever appearing.
            label.removeAttribute('for');

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.id = `prop-${param.name}`;
            input.checked = value || false;

            const span = document.createElement('span');
            span.textContent = labelText;

            // Reassemble the DOM
            label.appendChild(input);
            label.appendChild(span);

            // Re-insert the rescued tooltip icon with event isolation.
            // Even with 'for' removed, the label still wraps the checkbox — clicks on any label descendant still toggle the input by default.
            // Stop propagation so the tooltip trigger can receive focus and show its tooltip instead of toggling the checkbox.
            if (icon) {
                icon.addEventListener('mousedown', (e) => {
                    e.stopPropagation();  // Prevent label from starting a click sequence
                });
                icon.addEventListener('click', (e) => {
                    e.preventDefault();   // Prevent the label's default checkbox-toggle
                    e.stopPropagation();  // Prevent the click from reaching the label
                });
                label.appendChild(icon);
            }
        }

        createSelectField(field, param, value) {
            const select = document.createElement('select');
            select.id = `prop-${param.name}`;

            // Special case for tool selection
            if (param.name === 'tool') {
                this.populateToolSelect(select, this.currentOperation.type, value);
            } else if (param.options) {
                param.options.forEach(opt => {
                    const option = document.createElement('option');
                    option.value = opt.value;
                    option.textContent = opt.label;
                    if (opt.value === value) option.selected = true;
                    select.appendChild(option);
                });
            }

            field.appendChild(select);
        }

        createTextAreaField(field, param, value) {
            const textarea = document.createElement('textarea');
            textarea.id = `prop-${param.name}`;
            textarea.rows = param.rows || 4;
            textarea.value = value || '';

            // Apply styles from config
            if (inspectorConfig.textAreaStyle) {
                Object.assign(textarea.style, inspectorConfig.textAreaStyle);
            }

            field.appendChild(textarea);
        }

        populateToolSelect(select, operationType, selectedId) {
            const tools = this.toolLibrary.getToolsForOperation(operationType) || [];

            if (tools.length === 0) {
                select.innerHTML = `<option>${textConfig.noToolsAvailable}</option>`;
                select.disabled = true;
                return;
            }

            tools.forEach(tool => {
                const option = document.createElement('option');
                option.value = tool.id;
                option.textContent = `${tool.name} (${tool.geometry.diameter}mm)`;
                option.dataset.diameter = tool.geometry.diameter;
                if (tool.id === selectedId) option.selected = true;
                select.appendChild(option);
            });
        }

        createWarningPanel(warnings) {
            const panel = document.createElement('div');
            panel.className = 'warning-panel';

            const header = document.createElement('div');
            if (inspectorConfig.warningHeaderCSS) {
                Object.assign(header.style, inspectorConfig.warningHeaderCSS);
            }

            const icon = iconConfig.treeWarning;

            const list = document.createElement('ul');
            if (inspectorConfig.warningListCSS) {
                Object.assign(list.style, inspectorConfig.warningListCSS);
            }

            // Deduplicate warnings by their message text
            const seenMessages = new Set();
            const uniqueWarnings = warnings.filter(warning => {
                const msg = typeof warning === 'string' ? warning : warning.message;
                if (seenMessages.has(msg)) return false;
                seenMessages.add(msg);
                return true;
            });

            // Update header count to reflect unique warnings
            header.innerHTML = `${icon} ${uniqueWarnings.length} Warning${uniqueWarnings.length > 1 ? 's' : ''}`;
            panel.appendChild(header);

            uniqueWarnings.forEach(warning => {
                const item = document.createElement('li');
                item.textContent = typeof warning === 'string' ? warning : warning.message;
                list.appendChild(item);
            });

            panel.appendChild(list);
            return panel;
        }

        /**
         * Creates a read-only geometry summary panel showing source geometry info.
         * Visible for all operation types when source geometry stage is selected.
         */
        createGeometrySummary(operation) {
            const summary = this.core.getGeometrySummary(operation);
            if (!summary || summary.totalCount === 0) return null;

            const section = document.createElement('div');
            section.className = 'property-section geometry-summary';

            const h3 = document.createElement('h3');
            h3.textContent = 'Source Geometry';
            section.appendChild(h3);

            const info = document.createElement('div');
            info.className = 'geometry-summary-info';

            // Total count
            const totalLine = document.createElement('div');
            totalLine.className = 'summary-line';
            totalLine.innerHTML = `<strong>Primitives:</strong> ${summary.totalCount}`;
            if (summary.source === 'svg') {
                totalLine.innerHTML += ' <span class="badge badge--info">SVG</span>';
            }
            info.appendChild(totalLine);

            // Type breakdown (compact)
            if (Object.keys(summary.byType).length > 1 || !summary.isDrill) {
                const typeEntries = Object.entries(summary.byType)
                    .sort((a, b) => b[1] - a[1])
                    .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
                    .join(', ');
                const typeLine = document.createElement('div');
                typeLine.className = 'summary-line summary-secondary';
                typeLine.textContent = typeEntries;
                info.appendChild(typeLine);
            }

            // Drill-specific: hole/slot breakdown by size
            if (summary.isDrill && summary.drillSummary) {
                const ds = summary.drillSummary;

                if (ds.holes.length > 0) {
                    const holesLine = document.createElement('div');
                    holesLine.className = 'summary-line';
                    const holeDetails = ds.holes
                        .map(h => `⌀${h.diameter.toFixed(3)}mm × ${h.count}`)
                        .join(', ');
                    holesLine.innerHTML = `<strong>Holes:</strong> ${holeDetails}`;
                    info.appendChild(holesLine);
                }

                if (ds.slots.length > 0) {
                    const slotsLine = document.createElement('div');
                    slotsLine.className = 'summary-line';
                    const slotDetails = ds.slots
                        .map(s => `${s.width.toFixed(3)}×${s.length.toFixed(3)}mm × ${s.count}`)
                        .join(', ');
                    slotsLine.innerHTML = `<strong>Slots:</strong> ${slotDetails}`;
                    info.appendChild(slotsLine);
                }

                if (ds.totalRejected > 0) {
                    const rejLine = document.createElement('div');
                    rejLine.className = 'summary-line summary-warning';
                    rejLine.innerHTML = `<strong>Rejected:</strong> ${ds.totalRejected} unsupported shape${ds.totalRejected > 1 ? 's' : ''} — only circles and obrounds are valid for drilling`;
                    info.appendChild(rejLine);
                }
            }

            // Drill-specific: role breakdown for Excellon files
            if (summary.isDrill && !summary.drillSummary && summary.byRole) {
                const roleEntries = Object.entries(summary.byRole)
                    .map(([role, count]) => {
                        const label = role.replace('drill_', '').replace('_', ' ');
                        return `${count} ${label}${count > 1 ? 's' : ''}`;
                    })
                    .join(', ');
                const roleLine = document.createElement('div');
                roleLine.className = 'summary-line';
                roleLine.innerHTML = `<strong>Features:</strong> ${roleEntries}`;
                info.appendChild(roleLine);
            }

            // Check if generation has occurred (offsets exist or metadata is attached)
            const hasGeneratedOutput = (operation.offsets && operation.offsets.length > 0) || operation.stencilMetadata;

            if (hasGeneratedOutput) {
                const outputDivider = document.createElement('div');
                outputDivider.style.margin = 'var(--spacing-md) 0';
                outputDivider.style.borderTop = '1px dashed var(--color-border-primary)';
                info.appendChild(outputDivider);

                const outTitle = document.createElement('div');
                outTitle.className = 'summary-line';
                outTitle.innerHTML = `<strong>Generated Output:</strong>`;
                info.appendChild(outTitle);

                // Stencil-specific stats
                if (operation.type === 'stencil') {
                    const generatedCount = operation.offsets?.[0]?.primitives?.length || 0;
                    const skippedCount = operation.stencilMetadata?.skippedPads || 0;

                    const genLine = document.createElement('div');
                    genLine.className = 'summary-line';
                    genLine.textContent = `Apertures: ${generatedCount}`;
                    info.appendChild(genLine);

                    if (skippedCount > 0) {
                        const skipLine = document.createElement('div');
                        skipLine.className = 'summary-line summary-warning';
                        skipLine.textContent = `Skipped (Overlapping): ${skippedCount}`;
                        info.appendChild(skipLine);
                    }

                    if (generatedCount === 0) {
                        const errLine = document.createElement('div');
                        errLine.className = 'summary-line';
                        errLine.style.color = 'var(--color-error, #ff4444)';
                        errLine.textContent = 'No valid pads remaining to generate.';
                        info.appendChild(errLine);
                    }
                } 
                // Easily expandable for CNC/Laser stats later
                else {
                    const totalGenerated = operation.offsets.reduce((sum, off) => sum + (off.primitives?.length || 0), 0);

                    const outLine = document.createElement('div');
                    outLine.className = 'summary-line';
                    outLine.innerHTML = `<strong>Paths Generated:</strong> ${totalGenerated}`;
                    info.appendChild(outLine);

                    // Show achieved offset width if tracked
                    const firstMeta = operation.offsets[0]?.metadata;
                    if (firstMeta?.actualWidth > 0) {
                        const widthLine = document.createElement('div');
                        widthLine.className = 'summary-line';
                        const actual = firstMeta.actualWidth.toFixed(3);
                        const target = firstMeta.targetWidth;
                        if (target) {
                            widthLine.innerHTML = `<strong>Achieved Width:</strong> ${actual}mm (target: ${target.toFixed(3)}mm)`;
                        } else {
                            widthLine.innerHTML = `<strong>Clearing Depth:</strong> ${actual}mm`;
                        }
                        info.appendChild(widthLine);
                    }

                    // If the boolean engine collapsed everything to nothing
                    if (totalGenerated === 0) {
                        const errLine = document.createElement('div');
                        errLine.className = 'summary-line summary-warning';
                        errLine.textContent = '0 paths generated. Tool diameter or offset may be too large for the source features.';
                        info.appendChild(errLine);
                    }
                }
            }

            section.appendChild(info);
            return section;
        }

        createActionButton(text) {
            const wrapper = document.createElement('div');
            wrapper.className = 'property-actions';

            const button = document.createElement('button');
            button.className = 'btn btn--primary btn--block';
            button.id = 'action-button';
            button.textContent = text;

            wrapper.appendChild(button);
            return wrapper;
        }

        attachEventHandlers(container) {
            // Tool selection updates diameter
            const toolSelect = container.querySelector('#prop-tool');
            if (toolSelect) {
                toolSelect.addEventListener('change', (e) => {
                    const toolId = e.target.value;
                    const toolDiameter = this.toolLibrary?.getToolDiameter(toolId);

                    if (toolDiameter !== null && toolDiameter !== undefined) {
                        this.onParameterChange('tool', toolId);
                        this.onParameterChange('toolDiameter', toolDiameter);

                        const diamInput = container.querySelector('#prop-toolDiameter');
                        if (diamInput) {
                            diamInput.value = toolDiameter;
                        }
                    }
                });
            }

            // Attach handlers to all inputs
            container.querySelectorAll('input, select, textarea').forEach(input => {
                if (input.id === 'prop-tool') return; // Already handled above

                const paramName = input.id.replace('prop-', '');

                // Change event: Final validation and save
                input.addEventListener('change', () => {
                    const value = this.extractInputValue(input);
                    this.onParameterChange(paramName, value);
                });

                // Blur event: Also validate and save (catches tab-away without change)
                if (input.type === 'text' || input.type === 'number' || input.tagName === 'TEXTAREA') {
                    input.addEventListener('blur', () => {
                        const value = this.extractInputValue(input);
                        this.onParameterChange(paramName, value);
                        this.saveCurrentState();
                    });
                }

                // Input event: Only for visual feedback, no validation, no status messages
                // This allows free typing of intermediate values like "-", "0.", ".5"
                if (input.type === 'number') {
                    input.addEventListener('input', () => {
                        // Clear any previous error styling when user starts typing
                        input.classList.remove('input-error');
                    });
                }
            });

            // Mill holes toggle
            const millCheck = container.querySelector('#prop-millHoles');
            if (millCheck) {
                millCheck.addEventListener('change', async (e) => {
                    const isMilling = e.target.checked;
                    this.onParameterChange('millHoles', isMilling);

                    // Force synchronous commit before DOM rebuild.
                    // The generic change handler (attached earlier) set a debounced save that won't fire before showOperationProperties tears down the form.
                    // Without this, the value is only in live state and may not survive the loadFromOperation round-trip in all edge cases.
                    clearTimeout(this.changeTimeout);
                    this.saveCurrentState();

                    if (this.currentOperation) {
                        this.core.resetOperationState(this.currentOperation.id);
                    }

                    this.showOperationProperties(this.currentOperation, this.currentGeometryStage);
                    await this.ui.updateRendererAsync();

                    this.ui.showStatus(
                        `Switched to ${isMilling ? 'milling' : 'pecking'} mode`,
                        'info'
                    );
                });
            }

            // Action button
            const actionBtn = container.querySelector('#action-button');
            if (actionBtn) {
                actionBtn.addEventListener('click', () => this.handleAction());
            }

            // Initial conditional evaluation
            this.evaluateConditionals(container);
        }

        /**
         * Extracts and converts value from input element based on its type.
         */
        extractInputValue(input) {
            if (input.type === 'checkbox') {
                return input.checked;
            } else if (input.type === 'number') {
                const num = parseFloat(input.value);
                return isNaN(num) ? 0 : num;
            } else {
                return input.value;
            }
        }

        evaluateConditionals(container) {
            if (!this.currentOperation) return;
            const operation = this.currentOperation;
            const currentValues = this.parameterManager.getAllParameters(operation.id);

            // Helper: evaluate a single conditional clause
            const evalClause = (clause) => {
                clause = clause.trim();
                if (clause.includes(':')) {
                    const colonIdx = clause.indexOf(':');
                    const paramName = clause.substring(0, colonIdx);
                    const allowedValues = clause.substring(colonIdx + 1).split(',');
                    const currentVal = String(currentValues[paramName] ?? '');
                    return allowedValues.includes(currentVal);
                } else if (clause.startsWith('!')) {
                    const paramName = clause.slice(1);
                    return !currentValues[paramName];
                } else {
                    return !!currentValues[clause];
                }
            };

            container.querySelectorAll('[data-conditional]').forEach(field => {
                const conditional = field.dataset.conditional;
                let shouldShow;

                if (conditional.includes('&&')) {
                    // AND conjunction: all clauses must pass
                    shouldShow = conditional.split('&&').every(evalClause);
                } else {
                    shouldShow = evalClause(conditional);
                }

                field.style.display = shouldShow ? '' : 'none';
            });

            // Dynamic Canned Cycle Viability Logic
            if (operation.type === 'drill') {
                const cannedSelect = container.querySelector('#prop-cannedCycle');

                // Is it a panel that contains this select?
                if (cannedSelect) {
                    const currentSelection = cannedSelect.value;
                    const peckDepth = currentValues.peckDepth || 0;
                    const dwellTime = currentValues.dwellTime || 0;

                    // Clear existing options
                    cannedSelect.innerHTML = '';

                    const addOption = (val, label) => {
                        const opt = document.createElement('option');
                        opt.value = val;
                        opt.textContent = label;
                        cannedSelect.appendChild(opt);
                    };

                    // Baseline options always available
                    addOption('none', 'None (G0 + G1)');
                    addOption('G81', 'G81 - Simple Drill');

                    // Conditional options
                    if (dwellTime > 0) {
                        addOption('G82', 'G82 - Dwell');
                    }
                    if (peckDepth > 0) {
                        addOption('G83', 'G83 - Peck (Full Retract)');
                        addOption('G73', 'G73 - Peck (Chip Break)');
                    }

                    // Enforce fallback if previous selection is no longer viable
                    const optionExists = Array.from(cannedSelect.options).some(opt => opt.value === currentSelection);
                    
                    if (optionExists) {
                        cannedSelect.value = currentSelection;
                    } else {
                        const fallback = 'none';
                        cannedSelect.value = fallback;
                        // Alert the parameter manager that a change was made so the backend state stays in sync
                        this.onParameterChange('cannedCycle', fallback, true); 
                    }
                }
            }
        }

        onParameterChange(name, value, isRealtime = false) {
            if (!this.currentOperation) return;

            const operation = this.currentOperation;

            const result = this.parameterManager.setParameter(
                operation.id,
                this.currentGeometryStage,
                name,
                value
            );

            const inputEl = document.getElementById(`prop-${name}`);

            if (result.success) {
                // Clear error state
                if (inputEl) inputEl.classList.remove('input-error');

                // Clear status only if it was showing an error for this field
                if (this.ui.statusManager?.currentStatus?.type === 'error') {
                    this.ui.statusManager.updateStatus();
                }
            } else {
                // Show error and apply visual feedback
                if (!isRealtime) {
                    this.ui.showStatus(result.error, 'error');
                }

                if (inputEl) {
                    inputEl.classList.add('input-error');
                }

                // Apply corrected value to input
                if (result.correctedValue !== undefined && inputEl) {
                    inputEl.value = result.correctedValue;
                    inputEl.classList.remove('input-error'); // Corrected, no longer in error
                }
            }

            // Invalidate generated geometry when geometry-altering parameters change.
            // This prevents stale paths from being exported after parameter edits.
            if (operation && !isRealtime) {
                const paramDef = this.parameterManager.parameterDefinitions[name];
                if (paramDef && (paramDef.stage === 'geometry' || paramDef.stage === 'strategy')) {
                    const isReady = window.pcbcam?.core?.isExportReady(operation);

                    if (isReady) {
                        this.ui.core.invalidateOperationState(operation.id);

                        // Update tree node visuals but don't change selection - user is actively editing and should stay on the current stage - REVIEW - If a user has overwriten geometry they want the next step?
                        if (this.ui.navTreePanel) {
                            const fileNode = this.ui.navTreePanel.getNodeByOperationId(operation.id);
                            if (fileNode) {
                                this.ui.navTreePanel.updateFileGeometries(fileNode.id, operation);
                            }
                        }

                        this.ui.showStatus(
                            'Parameters changed — regenerate paths before exporting.', 'warning'
                        );
                    }
                }
            }

            // Re-evaluate conditionals
            const container = document.getElementById('property-form');
            if (container) this.evaluateConditionals(container);

            // Debounced auto-save (not during realtime typing)
            if (result.success && !isRealtime) {
                clearTimeout(this.changeTimeout);
                const delay = timingConfig.propertyDebounce;
                this.changeTimeout = setTimeout(() => {
                    this.saveCurrentState();
                }, delay);
            }
        }

        onExternalParameterChange(change) {
            // Update UI if the change is for current operation/stage
            if (change.operationId === this.currentOperation?.id &&
                change.stage === this.currentGeometryStage) {
                const input = document.querySelector(`#prop-${change.name}`);
                if (input) {
                    if (input.type === 'checkbox') {
                        input.checked = change.value;
                    } else {
                        input.value = change.value;
                    }
                }
            }
        }

        saveCurrentState() {
            if (!this.currentOperation) return;
            const operation = this.currentOperation;

            // Commit to operation
            this.parameterManager.commitToOperation(operation);

            this.debug(`Saved state for operation ${operation.id}`);
        }

        async handleAction() {
            this.saveCurrentState();

            const operation = this.currentOperation;
            const stage = this.currentGeometryStage;
            const isLaser = window.pcbcam?.isLaserPipeline?.() || false;
            const isStencil = operation.type === 'stencil';
            const transitionDelay = layoutConfig?.ui?.transitionDelay || 300;

            // ═══════════════════════════════════════
            // GEOMETRY STAGE — unified across all pipelines
            // ═══════════════════════════════════════
            if (stage === 'geometry') {
                this.ui.showCanvasSpinner('Generating...');
                await new Promise(r => setTimeout(r, 10));

                try {
                    const result = await this._runGeneration(operation);

                    this.ui.showStatus(result.message, result.status);

                    if (result.success && (isLaser || isStencil)) {
                        // UI only handles UI tasks now: showing the preview toggle
                        if (isLaser) {
                            this.ui.renderer?.setOptions({ showPreviews: true });
                            const previewToggle = document.getElementById('show-previews');
                            if (previewToggle) previewToggle.checked = true;
                        }
                    }

                    // Determine next stage
                    const nextStage = this.parameterManager.getNextStage(stage,
                        window.pcbcam?.pipelineState?.type || 'cnc', operation.type);

                    if (result.success && nextStage && layoutConfig?.ui?.autoTransition) {
                        setTimeout(() => {
                            this.switchGeometryStage(nextStage);
                        }, transitionDelay);
                    } else if (!result.success || result.refreshPanel) {
                        // Refresh current panel to show warnings
                        this.showOperationProperties(operation, stage);
                    }

                } catch (e) {
                    console.error('[OperationPanel] Generation failed:', e);
                    this.ui.showStatus('Failed: ' + e.message, 'error');
                } finally {
                    this.ui.hideCanvasSpinner();
                }

                this.returnFocusToTree();
                return;
            }

            // ═══════════════════════════════════════
            // STRATEGY STAGE (CNC only)
            // ═══════════════════════════════════════
            if (stage === 'strategy') {
                try {
                    this.ui.showStatus('Generating toolpath preview...', 'info');
                    const previewSuccess = await this.generatePreview(operation);
                    if (!previewSuccess) return;

                    if (layoutConfig?.ui?.autoTransition) {
                        setTimeout(() => {
                            this.switchGeometryStage('machine');
                        }, transitionDelay);
                    }
                    this.returnFocusToTree();
                } catch (error) {
                    console.error('[OperationPanel] Preview generation failed:', error);
                    this.ui.showStatus('Preview failed: ' + error.message, 'error');
                }
                return;
            }

            // ═══════════════════════════════════════
            // MACHINE / EXPORT SUMMARY — open Export Manager
            // ═══════════════════════════════════════
            if (stage === 'machine' || stage === 'export_summary') {
                const controller = window.pcbcam;
                if (controller?.modalManager) {
                    const readyOps = this.ui.core.operations.filter(o => this.ui.core.isExportReady(o));
                    if (readyOps.length === 0) {
                        this.ui.showStatus('No operations ready. Generate paths first.', 'warning');
                        return;
                    }
                    controller.modalManager.showModal('exportManager', {
                        operations: readyOps,
                        highlightOperationId: operation.id
                    });
                } else {
                    this.ui.showStatus('Export manager not available', 'error');
                }
            }
        }

        returnFocusToTree() {
            const selected = document.querySelector(
                '.file-node-content.selected, .geometry-node-content.selected, .geometry-node.selected'
            );
            if (selected) {
                const focusTarget = selected.querySelector('.file-node-content, .geometry-node-content') || selected;
                focusTarget.setAttribute('tabindex', '0');
                focusTarget.focus();
            }
        }

        switchGeometryStage(newStage) {
            const pipelineType = window.pcbcam?.pipelineState?.type || 'cnc';
            const validStages = this.parameterManager.getStagesForPipeline(pipelineType);
            // Also accept CNC stages so hybrid doesn't break
            const allValid = [...new Set([...validStages, 'geometry', 'strategy', 'machine', 'export_summary'])];

            if (!allValid.includes(newStage)) {
                console.warn(`[OperationPanel] Invalid geometry stage: ${newStage}`);
                return;
            }

            this.currentGeometryStage = newStage;

            if (this.currentOperation) {
                // All stages (including export_summary) route through showOperationProperties
                this.showOperationProperties(this.currentOperation, newStage);
            }
        }

        /**
         * Calls the operation handler's orchestrateGeneration, then refreshes tree and renderer.
         * Returns the handler's result for the caller to act on.
         */
        async _runGeneration(operation) {
            const params = this.parameterManager.getAllParameters(operation.id);
            const handler = this.core.getHandler(operation.type);

            const result = await handler.orchestrateGeneration(operation, params, this.core);
            if (this.ui.navTreePanel) {
                const fileNode = this.ui.navTreePanel.getNodeByOperationId(operation.id);
                if (fileNode) this.ui.navTreePanel.updateFileGeometries(fileNode.id, operation);
            }
            await this.ui.updateRendererAsync();

            return result;
        }

        /**
         * Renders the laser export summary panel. This is a display-only stage with no editable parameters.
         */
        renderExportSummary(operation) {
            const container = document.getElementById('property-form');
            const title = document.getElementById('inspector-title');

            if (!container || !title) return;

            title.textContent = operation.file.name;
            container.innerHTML = '';

            // Summary section
            const isStencil = operation.type === 'stencil';

            const section = document.createElement('div');
            section.className = 'property-section';

            const h3 = document.createElement('h3');
            h3.textContent = isStencil ? 'Stencil Export Summary' : 'Laser Export Summary';
            section.appendChild(h3);

            const summary = document.createElement('div');
            summary.className = 'exporter-summary-info';

            const strategy = isStencil ? 'stencil' : (operation.settings?.laserClearStrategy || 'offset');
            const offsetCount = operation.offsets?.length || 0;
            const primCount = operation.offsets?.reduce((sum, o) => sum + (o.primitives?.length || 0), 0) || 0;

            let html = `
                <div><strong>Operation:</strong> ${operation.type}</div>
                <div><strong>Strategy:</strong> ${strategy}</div>
                <div><strong>Passes:</strong> ${offsetCount}</div>
                <div><strong>Path count:</strong> ${primCount}</div>
            `;

            // Carry skipped pad metrics forward so they aren't hidden on the previous tab
            if (isStencil) {
                const skipped = operation.offsets?.[0]?.metadata?.skippedPads || operation.stencilMetadata?.skippedPads || 0;
                if (skipped > 0) {
                    html += `<div style="color: var(--color-warning); margin-top: var(--spacing-sm);"><strong>Overlapping Pads Skipped:</strong> ${skipped}</div>`;
                }
            }

            summary.innerHTML = html;
            section.appendChild(summary);
            container.appendChild(section);

            // Action button
            const actionText = this.getActionButtonText('export_summary', operation.type);
            if (actionText) {
                container.appendChild(this.createActionButton(actionText));

                const actionBtn = container.querySelector('#action-button');
                if (actionBtn) {
                    actionBtn.addEventListener('click', () => this.handleAction());
                }
            }
        }

        async generatePreview(operation) {
            if (!operation.offsets || operation.offsets.length === 0) {
                this.ui.showStatus('Generate offsets/strategy first', 'warning');
                return false;
            }

            const success = this.core.generateCNCPreview(operation.id);

            if (!success) {
                this.ui.showStatus('Error: Could not generate preview (check tool diameter).', 'error');
                return false;
            }

            // UI-only concerns: toggle visibility, update tree, re-render
            this.ui.renderer?.setOptions({ showPreviews: true });
            const previewToggle = document.getElementById('show-previews');
            if (previewToggle) previewToggle.checked = true;

            if (this.ui.navTreePanel) {
                const fileNode = this.ui.navTreePanel.getNodeByOperationId(operation.id);
                if (fileNode) {
                    this.ui.navTreePanel.updateFileGeometries(fileNode.id, operation);
                }
            }

            await this.ui.updateRendererAsync();
            this.ui.showStatus('Preview generated', 'success');
            return true;
        }

        debug(message, data = null) {
            if (this.ui.debug) {
                this.ui.debug(`[OperationPanel] ${message}`, data);
            }
        }
    }

    window.OperationPanel = OperationPanel; 
})();