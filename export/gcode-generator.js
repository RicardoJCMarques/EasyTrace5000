/*!
 * @file        export/gcode-generator.js
 * @description Complete G-code generation from toolpath plans
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

    class GCodeGenerator {
        constructor(config) {
            this.config = config;
            this.processors = new Map();
            this.currentProcessor = null;
            this.core = null;
            this.untransformedPosition = { x: 0, y: 0, z: 0 };

            this.registerDefaultProcessors();
        }

        setCore(coreInstance) {
            this.core = coreInstance;
        }

        setLanguageManager(langManager) {
            this.lang = langManager;
        }

        registerDefaultProcessors() {
            if (typeof GRBLPostProcessor !== 'undefined') {
                this.registerProcessor('grbl', new GRBLPostProcessor());
            }
            if (typeof MakeraPostProcessor !== 'undefined') {
                this.registerProcessor('makera', new MakeraPostProcessor());
            }
            if (typeof RolandPostProcessor !== 'undefined') {
                this.registerProcessor('roland', new RolandPostProcessor());
            }
            if (typeof MarlinPostProcessor !== 'undefined') {
                this.registerProcessor('marlin', new MarlinPostProcessor());
            }
            if (typeof LinuxCNCPostProcessor !== 'undefined') {
                this.registerProcessor('linuxcnc', new LinuxCNCPostProcessor());
            }
            if (typeof Mach3PostProcessor !== 'undefined') {
                this.registerProcessor('mach3', new Mach3PostProcessor());
            }
            if (typeof GrblHALPostProcessor !== 'undefined') {
                this.registerProcessor('grblhal', new GrblHALPostProcessor());
            }
        }

        registerProcessor(name, processor) {
            this.processors.set(name.toLowerCase(), processor);
        }

        getProcessor(name) {
            return this.processors.get(name.toLowerCase());
        }

        // ── Descriptor API ─────────────────────────────────────────
        // These methods expose processor metadata for UI population, code resolution, and parameter validation. Consumers should use these instead of reading config.js.

        /**
         * Returns the full descriptor for a registered processor.
         * Replaces the old getProcessorInfo() shape.
         */
        getProcessorInfo(name) {
            const processor = this.getProcessor(name);
            if (!processor) return null;
            return processor.descriptor || null;
        }

        /**
         * Returns descriptors for all registered processors.
         * Can be used to populate the post-processor dropdown instead of config.ui.parameterOptions.postProcessor.
         */
        getAllProcessorDescriptors() {
            const result = [];
            for (const [key, processor] of this.processors) {
                result.push({
                    value: key,
                    ...(processor.descriptor || { label: key })
                });
            }
            return result;
        }

        /**
         * Resolves the effective start code for a processor.
         * Priority: userOverride > processor factory default > empty string.
         */
        resolveStartCode(processorName, userOverride) {
            if (userOverride !== undefined && userOverride !== null && userOverride !== '') {
                return userOverride;
            }
            const desc = this.getProcessorInfo(processorName);
            return desc?.defaults?.startCode ?? '';
        }

        /**
         * Resolves the effective end code for a processor.
         * Priority: userOverride > processor factory default > empty string.
         */
        resolveEndCode(processorName, userOverride) {
            if (userOverride !== undefined && userOverride !== null && userOverride !== '') {
                return userOverride;
            }
            const desc = this.getProcessorInfo(processorName);
            return desc?.defaults?.endCode ?? '';
        }

        generate(toolpathPlans, options) {
            if (!toolpathPlans || toolpathPlans.length === 0) {
                return '; No toolpath data available';
            }

            const processorName = options.postProcessor || 'grbl';
            this.currentProcessor = this.getProcessor(processorName);

            if (!this.currentProcessor) {
                throw new Error(`Post-processor '${processorName}' not found`);
            }

            this.currentProcessor.resetState();
            this.untransformedPosition = { x: 0, y: 0, z: 0 };

            // Resolve all comment strings from language system once.
            // Processors receive pre-resolved strings via options.comments.
            // If no language manager is available, comments degrade to empty strings — the appendComment() method handles this gracefully.
            if (this.lang) {
                const section = this.lang.getSection('gcode.comments') || {};
                // Flatten nested processor-specific sections (e.g., makera.*) into the top level so processors access options.comments.mtcRelease
                const flat = {};
                for (const [k, v] of Object.entries(section)) {
                    if (typeof v === 'object' && v !== null) {
                        Object.assign(flat, v);
                    } else {
                        flat[k] = v;
                    }
                }
                options.comments = flat;
            } else {
                options.comments = {};
            }

            // Resolve start/end codes from processor defaults with user overrides.
            // Backward-compatible: if caller already set options.startCode (legacy controller path), use it. Once controller is updated to pass userStartCode/userEndCode instead, the resolution kicks in.
            if (options.startCode === undefined || options.startCode === null) {
                options.startCode = this.resolveStartCode(processorName, options.userStartCode);
            }
            if (options.endCode === undefined || options.endCode === null) {
                options.endCode = this.resolveEndCode(processorName, options.userEndCode);
            }

            const output = [];

            // Temporary safety check for Roland post-processor that doesn't support comments
            if (options.includeComments && processorName !== 'roland') {
                // Gather data
                const c = options.comments || {};
                const opIds = [...new Set(toolpathPlans.map(p => p.operationId))];
                const operations = opIds.map(id => this.core.operations.find(op => op.id === id)).filter(Boolean);

                // Build comment block
                const commentBlock = [];
                commentBlock.push(c.header || 'G-code generated by EasyTrace5000');
                commentBlock.push((c.date || 'Date: {date}').replace('{date}', new Date().toLocaleString()));
                commentBlock.push((c.processor || 'Processor: {processor}').replace('{processor}', processorName));
                commentBlock.push(c.separator || '---');
                commentBlock.push((c.operationCount || 'Operations ({count}):').replace('{count}', operations.length));
                operations.forEach(op => {
                    commentBlock.push(
                        (c.operationEntry || '  - {type}: {file}')
                            .replace('{type}', op.type)
                            .replace('{file}', op.file.name)
                    );
                });
                commentBlock.push(c.separator || '---');

                // Add to options object
                options.commentBlock = commentBlock;
            }

            // Pass the first operational plan to the header for feed rate setup
            // Skip synthetic plans (init, connection, entry, retract, final) that don't carry real cutting parameters.
            const syntheticIds = new Set(['init', 'connection', 'entry', 'retract', 'final']);
            options.firstPlan = toolpathPlans.find(p => !syntheticIds.has(p.operationId)) || toolpathPlans[0];

            let originOffset = { x: 0, y: 0 };
            if (this.core && this.core.coordinateSystem) {
                const origin = this.core.coordinateSystem.getOriginPosition();
                originOffset = { x: -origin.x, y: -origin.y };
            }

            // Generate header
            output.push(this.currentProcessor.generateHeader(options));

            // Find init plan and process it first (safety height before spindle)
            const initPlanIndex = toolpathPlans.findIndex(p => p.operationId === 'init');
            if (initPlanIndex !== -1) {
                const initPlan = toolpathPlans[initPlanIndex];
                for (const cmd of initPlan.commands) {
                    let transformedCmd = this.transformCommand(cmd, originOffset);

                    const gcode = this.currentProcessor.processCommand(transformedCmd);
                    if (gcode) {
                        output.push(gcode);
                    }

                    // Update untransformed position tracking
                    if (cmd.x !== null && cmd.x !== undefined) this.untransformedPosition.x = cmd.x;
                    if (cmd.y !== null && cmd.y !== undefined) this.untransformedPosition.y = cmd.y;
                    if (cmd.z !== null && cmd.z !== undefined) this.untransformedPosition.z = cmd.z;
                }
            }

            // Handle initial spindle command (after safety height)
            const firstPlanWithSpindle = toolpathPlans.find(p => p.metadata?.spindleSpeed > 0);
            if (firstPlanWithSpindle) {
                const spindle = firstPlanWithSpindle.metadata.spindleSpeed;
                const dwell = firstPlanWithSpindle.metadata.spindleDwell || 0;
                const spindleGcode = this.currentProcessor.setSpindle(spindle, dwell, options);
                if (spindleGcode) {
                    output.push(spindleGcode);
                }
            }

            // Process remaining plans
            for (let i = 0; i < toolpathPlans.length; i++) {
                // Only skip the specific init plan index processed manually.
                // Do not skip plans by ID, as subsequent operations also have 'init' plans.
                if (i === initPlanIndex) {
                    continue;
                }

                const plan = toolpathPlans[i];
                const metadata = plan.metadata || {};

                // Handle spindle speed changes mid-job
                const spindle = metadata.spindleSpeed;
                if (spindle !== undefined && spindle !== this.currentProcessor.currentSpindle) {
                    const dwell = metadata.spindleDwell || 0;
                    const spindleGcode = this.currentProcessor.setSpindle(spindle, dwell, options);
                    if (spindleGcode) {
                        output.push(spindleGcode);
                    }
                }

                // Process commands
                for (const cmd of plan.commands) {
                    const startPosForTransform = { ...this.untransformedPosition };

                    let commandsToProcess = [cmd];

                    // Linearize arcs if processor doesn't support them
                    if ((cmd.type === 'ARC_CW' || cmd.type === 'ARC_CCW') &&
                        !this.currentProcessor.config.supportsArcCommands) {
                        const radius = Math.hypot(cmd.i || 0, cmd.j || 0);
                        const baseResolution = options.arcResolution || 0.1;
                        const adaptiveResolution = radius < 2 ? baseResolution * 0.5 :
                                                radius > 10 ? baseResolution * 2 :
                                                baseResolution;

                        commandsToProcess = this.linearizeArc(cmd, startPosForTransform, adaptiveResolution);
                    }

                    // Process each command/segment
                    for (const commandToProcess of commandsToProcess) {
                        let transformedCmd = this.transformCommand(commandToProcess, originOffset);

                        const gcode = this.currentProcessor.processCommand(transformedCmd);
                        if (gcode) {
                            output.push(gcode);
                        }

                        // Update untransformed position to end of segment
                        if (commandToProcess.x !== null && commandToProcess.x !== undefined) {
                            this.untransformedPosition.x = commandToProcess.x;
                        }
                        if (commandToProcess.y !== null && commandToProcess.y !== undefined) {
                            this.untransformedPosition.y = commandToProcess.y;
                        }
                        if (commandToProcess.z !== null && commandToProcess.z !== undefined) {
                            this.untransformedPosition.z = commandToProcess.z;
                        }
                    }
                }
            }

            output.push(this.currentProcessor.generateFooter(options));
            return output.join('\n');
        }

        transformCommand(cmd, originOffset) {
            if (originOffset.x === 0 && originOffset.y === 0) return cmd;

            // Instantiate a new flat object explicitly (much faster than spreading)
            const transformed = {
                type: cmd.type,
                x: cmd.x !== null ? cmd.x + originOffset.x : null,
                y: cmd.y !== null ? cmd.y + originOffset.y : null,
                z: cmd.z,
                i: cmd.i,
                j: cmd.j,
                f: cmd.f,
                dwell: cmd.dwell,
                metadata: cmd.metadata
            };

            return transformed;
        }

        linearizeArc(cmd, startPos, resolution = 1.0) {
            const linearizedCmds = [];

            const start = {
                x: startPos.x,
                y: startPos.y,
                z: startPos.z
            };
            const end = {
                x: (cmd.x !== null && cmd.x !== undefined) ? cmd.x : start.x,
                y: (cmd.y !== null && cmd.y !== undefined) ? cmd.y : start.y,
                z: (cmd.z !== null && cmd.z !== undefined) ? cmd.z : start.z
            };
            const center = {
                x: start.x + (cmd.i || 0),
                y: start.y + (cmd.j || 0)
            };
            const radius = Math.hypot(cmd.i || 0, cmd.j || 0);

            if (radius < 1e-9) {
                return [new MotionCommand('LINEAR', end, { feed: cmd.f })];
            }

            const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
            const endAngle = Math.atan2(end.y - center.y, end.x - center.x);

            let sweep = endAngle - startAngle;
            if (cmd.type === 'ARC_CW') {
                if (sweep >= 1e-9) sweep -= 2 * Math.PI;
            } else {
                if (sweep <= -1e-9) sweep += 2 * Math.PI;
            }

            // Handle full circle
            const dist = Math.hypot(start.x - end.x, start.y - end.y);
            if (dist < 1e-6 && Math.abs(sweep) < 1e-6) {
                sweep = (cmd.type === 'ARC_CW') ? -2 * Math.PI : 2 * Math.PI;
            }

            const arcLength = Math.abs(sweep) * radius;
            const segments = Math.max(2, Math.ceil(arcLength / resolution));
            const angleStep = sweep / segments;
            const zStep = (end.z - start.z) / segments;

            for (let i = 1; i <= segments; i++) {
                const angle = startAngle + i * angleStep;

                const nextX = (i === segments) ? end.x : (center.x + radius * Math.cos(angle));
                const nextY = (i === segments) ? end.y : (center.y + radius * Math.sin(angle));
                const nextZ = (i === segments) ? end.z : (start.z + i * zStep);

                linearizedCmds.push(new MotionCommand('LINEAR',
                    { x: nextX, y: nextY, z: nextZ },
                    { feed: cmd.f }
                ));
            }

            return linearizedCmds;
        }

        /**
         * Returns keys of all registered processors.
         * For richer data, use getAllProcessorDescriptors().
         */
        getAvailableProcessors() {
            return Array.from(this.processors.keys());
        }
    }

    window.GCodeGenerator = GCodeGenerator;
})();