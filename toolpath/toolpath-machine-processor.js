/*!
 * @file        toolpath/toolpath-machine-processor.js
 * @description Adds machine operations and defines special cycles (e.g. Helix entry milled holes and slots)
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
    const PRECISION = C.precision.coordinate;
    const debugState = D.debug;

    class MachineProcessor {
        constructor(core) {
            this.core = core;
            this.currentPosition = { x: 0, y: 0, z: 0 };
            this.context = null;
        }

        /**
         * Walks the optimizer's ordered plan list and expands each flat
         * 2D plan through its depth levels. Drill macros, peck marks,
         * 3D contours and centerline slots are dispatched to their
         * existing dedicated handlers (unchanged).
         *
         * Standard contour plans carry metadata.depthLevels - an array
         * of Z values from shallowest to deepest. For each depth the
         * processor stamps the commands with that Z and handles tab
         * Z-lifts when the plan carries tab metadata.
         */
        processPlans(toolpathPlans, context, initialPos) {
            if (!toolpathPlans || toolpathPlans.length === 0) {
                return { plans: [], endPos: initialPos };
            }

            if (!context) {
                console.error("[MachineProcessor] Plans are missing toolpath context!");
                return { plans: [], endPos: initialPos };
            }

            // Reset all per-batch transient state
            this.context = context;
            this.FEED_HEIGHT = context.machine.feedHeight;
            this.currentPosition = { ...initialPos };

            const machineReadyPlans = [];
            const plungeRate = context.cutting.plungeRate;

            this.debug(`Starting Batch. Initial Pos: Z${this.currentPosition.z.toFixed(3)}`, this.currentPosition);

            // Initial positioning
            const initPlan = new ToolpathPlan('init');

            // Use '<=' to force an explicit Safety Z retract at the start, even if the internal tracker thinks it's already there
            if (this.currentPosition.z <= this.context.machine.safeZ) {
                initPlan.addRapid(null, null, this.context.machine.safeZ);
                this.currentPosition.z = this.context.machine.safeZ;
            }

            // Move to the Start XY of the first plan while at safe Z
            if (toolpathPlans.length > 0) {
                const firstPlan = toolpathPlans[0];
                // Use optimized point if available, otherwise raw entry
                const startXY = firstPlan.metadata.optimization?.optimizedEntryPoint || firstPlan.metadata.entryPoint;
                if (startXY) {
                    initPlan.addRapid(startXY.x, startXY.y, null); // Move XY, keep Z at Safe
                    this.currentPosition.x = startXY.x;
                    this.currentPosition.y = startXY.y;
                }
            }
            machineReadyPlans.push(initPlan);

            // Main plan loop
            for (let i = 0; i < toolpathPlans.length; i++) {
                const plan = toolpathPlans[i];
                const meta = plan.metadata || {};

                // Special dispatch
                if (meta.isPeckMark) {
                    this.debug(`Processing Peck Mark ${i+1}/${toolpathPlans.length}`);
                    machineReadyPlans.push(this.processPeckMark(plan));

                    // Update the machine position tracker (processPeckMark ends with a retract to travelZ)
                    this.currentPosition = {
                        x: meta.entryPoint.x,
                        y: meta.entryPoint.y,
                        z: this.context.machine.travelZ
                    };
                    continue;
                }

                // Handle drill mill macro (complete hole-clearing sequence)
                if (meta.drillMillMacro) {
                    this.debug(`Processing Drill Mill Macro ${i+1}/${toolpathPlans.length}`);
                    machineReadyPlans.push(this.generateDrillMillMacro(plan));
                    this.currentPosition = {
                        ...(meta.entryPoint || { x: 0, y: 0 }),
                        z: this.context.machine.travelZ
                    };
                    continue;
                }

                // Handle drill peck marks // REVIEW - This comment is confusing without a planMetadata.isPeckMark check
                if (meta.isDrillMilling) {
                    const useHelix = (meta.entryType || 'plunge') === 'helix';
                    if (useHelix && (meta.primitiveType === 'circle' || meta.primitiveType === 'obround')) {
                        this.debug(`Processing Helix Mill ${meta.primitiveType} ${i+1}/${toolpathPlans.length}`);
                        machineReadyPlans.push(this.generateHelicalDrillMilling(plan));
                        this.currentPosition = { ...(meta.exitPoint || {x:0, y:0}), z: this.context.machine.travelZ };
                        continue;
                    }
                }

                // Handle centerline slots
                if (meta.isCenterlinePath && meta.strategy?.zigzag) {
                    this.debug(`Processing Centerline Slot (Macro) ${i+1}/${toolpathPlans.length}`);
                    const slotPlan = new ToolpathPlan(plan.operationId);
                    Object.assign(slotPlan.metadata, meta);
                    const strategy = meta.strategy;
                    const startXY = meta.entryPoint;
                    const endXY = { x: plan.commands[0].x, y: plan.commands[0].y };

                    // Validate strategy parameters
                    if (strategy.feedRate === undefined || strategy.plungeRate === undefined || strategy.cutDepth === undefined) {
                        console.error('[MachineProcessor] Missing strategy parameters for centerline slot');
                        continue;
                    }

                    // Move to Start at Travel Z
                    slotPlan.addRapid(startXY.x, startXY.y, this.context.machine.travelZ);
                    slotPlan.addRapid(null, null, this.FEED_HEIGHT);

                    // Execute Zig-Zag Depth Loop
                    const surfaceZ = startXY.z !== undefined ? startXY.z : 0; 
                    let currentZ = surfaceZ;

                    const finalZ = strategy.cutDepth; // Negative value
                    const stepZ = Math.abs(strategy.depthPerPass);
                    let goingForward = true;

                    while (currentZ > finalZ) {
                        // Calculate next depth
                        let nextZ = currentZ - stepZ;
                        if (nextZ < finalZ) nextZ = finalZ;

                        // Plunge to next depth at current position
                        slotPlan.addLinear(null, null, nextZ, strategy.plungeRate);
                        currentZ = nextZ;

                        // Cut to the other side
                        const target = goingForward ? endXY : startXY;
                        slotPlan.addLinear(target.x, target.y, currentZ, strategy.feedRate);

                        // Toggle direction for next pass
                        goingForward = !goingForward;
                    }

                    // Retract
                    slotPlan.addRetract(this.context.machine.travelZ);

                    // Update machine state
                    this.currentPosition = {
                        x: goingForward ? startXY.x : endXY.x,
                        y: goingForward ? startXY.y : endXY.y,
                        z: this.context.machine.travelZ
                    };

                    machineReadyPlans.push(slotPlan);
                    continue;
                }

                // 3D contour macro (V-Carve, Relief): every command
                // carries its own Z. Handles its own approach/plunge/
                // retract - bypasses the 2.5D depth-pass machinery.
                if (meta.is3DContour) {
                    this.debug(`Processing 3D Contour ${i + 1}/${toolpathPlans.length}`);
                    machineReadyPlans.push(this.process3DContourPlan(plan));
                    this.currentPosition = {
                        x: meta.exitPoint?.x ?? this.currentPosition.x,
                        y: meta.exitPoint?.y ?? this.currentPosition.y,
                        z: this.context.machine.travelZ
                    };
                    continue;
                }

                // Standard contour with depth expansion
                const linkType = meta.optimization?.linkType || 'rapid';
                const depthLevels = meta.depthLevels || [meta.cutDepth || 0];
                const entryPoint = meta.optimization?.optimizedEntryPoint || meta.entryPoint;

                // Connection move to this plan's entry
                const connectionPlan = new ToolpathPlan('connection');

                if (linkType === 'staydown') {
                    this.debug(`Link ${i}: Staydown move`);
                    connectionPlan.addLinear(
                        entryPoint.x, entryPoint.y, this.currentPosition.z,
                        meta.feedRate
                    );
                    connectionPlan.metadata.type = 'staydown_link';
                } else {
                    // Rapid Link or Retract if needed
                    if (this.currentPosition.z < this.context.machine.travelZ) {
                        connectionPlan.addRapid(null, null, this.context.machine.travelZ);
                        this.currentPosition.z = this.context.machine.travelZ;
                    }

                    // Move XY - only if not already at target position
                    const atTargetXY = Math.hypot(
                        entryPoint.x - this.currentPosition.x,
                        entryPoint.y - this.currentPosition.y
                    ) < PRECISION;
                    if (!atTargetXY) {
                        connectionPlan.addRapid(entryPoint.x, entryPoint.y, null);
                    }
                    connectionPlan.metadata.type = 'rapid_link';
                }
                machineReadyPlans.push(connectionPlan);
                this.currentPosition.x = entryPoint.x;
                this.currentPosition.y = entryPoint.y;

                // Depth expansion: iterate depthLevels
                // Tab data (if present)
                const isTabbedFeature = meta.isTabbedPass === true;

                // Read the tab height setting directly from the machine context 
                const tabTopZ = meta.tabTopZ;

                for (let di = 0; di < depthLevels.length; di++) {
                    const depth = depthLevels[di];
                    const isFirstDepth = (di === 0);

                    if (isFirstDepth && linkType !== 'staydown') {
                        const entryPlan = new ToolpathPlan('entry');
                        entryPlan.metadata.spindleSpeed = this.context.cutting.spindleSpeed;
                        entryPlan.metadata.spindleDwell = this.context.cutting.spindleDwell;
                        const entryType = meta.entryType || 'plunge';
                        const entryMeta = { ...meta, entryPoint: { ...entryPoint, z: depth } };
                        this.generateEntryMove(entryPlan, entryMeta, entryType);
                        machineReadyPlans.push(entryPlan);
                        this.currentPosition.z = depth;
                    } else if (isFirstDepth && linkType === 'staydown') {
                        if (Math.abs(this.currentPosition.z - depth) > PRECISION) {
                            const plungePlan = new ToolpathPlan('staydown_plunge');
                            plungePlan.addLinear(null, null, depth, plungeRate);
                            machineReadyPlans.push(plungePlan);
                        }
                        this.currentPosition.z = depth;
                    } else {
                        const plungePlan = new ToolpathPlan('depth_plunge');
                        plungePlan.addLinear(entryPoint.x, entryPoint.y, depth, plungeRate);
                        machineReadyPlans.push(plungePlan);
                        this.currentPosition.z = depth;
                    }

                    const cuttingPlan = new ToolpathPlan(plan.operationId);
                    Object.assign(cuttingPlan.metadata, meta);
                    cuttingPlan.metadata.cutDepth = depth;

                    const useTabs = isTabbedFeature && tabTopZ !== undefined &&
                                    depth < tabTopZ - PRECISION;

                    for (const cmd of plan.commands) {
                        if (useTabs && cmd.metadata?.isTab === true) {
                             // Tab Lift
                            cuttingPlan.addLinear(null, null, tabTopZ, plungeRate);
                            cuttingPlan.addCommand({ ...cmd, z: tabTopZ });
                            cuttingPlan.addLinear(null, null, depth, plungeRate);
                        } else {
                            // Normal Cut
                            cuttingPlan.addCommand({ ...cmd, z: depth });
                        }

                        if (cmd.x !== null) this.currentPosition.x = cmd.x;
                        if (cmd.y !== null) this.currentPosition.y = cmd.y;
                    }

                    machineReadyPlans.push(cuttingPlan);
                    this.currentPosition.z = depth;
                }

                // Retract logic
                const isStayDownSource = (
                    i < toolpathPlans.length - 1 &&
                    toolpathPlans[i + 1]?.metadata?.optimization?.linkType === 'staydown'
                );

                if (!isStayDownSource) {
                    const retractPlan = new ToolpathPlan('retract');
                    retractPlan.addRetract(this.context.machine.travelZ);
                    machineReadyPlans.push(retractPlan);
                    this.currentPosition.z = this.context.machine.travelZ;
                }
            }

            // Final Retract to Safe Z
            const finalPlan = new ToolpathPlan('final');
            if (this.currentPosition.z < this.context.machine.safeZ) {
                const finalPlan = new ToolpathPlan('final');
                finalPlan.addRetract(this.context.machine.safeZ);
                this.currentPosition.z = this.context.machine.safeZ;
                machineReadyPlans.push(finalPlan);
            }

            return { plans: machineReadyPlans, endPos: this.currentPosition };
        }

        /**
         * Complete machining sequence for one 3D contour plan (V-Carve
         * chain, relief raster): retract → rapid XY to entry → rapid to
         * feed height → plunge to the chain's first-point Z → pass the
         * commands through VERBATIM (each carries its own Z) → retract.
         */
        process3DContourPlan(purePlan) {
            const meta = purePlan.metadata;
            const machinePlan = new ToolpathPlan(purePlan.operationId);
            Object.assign(machinePlan.metadata, meta);

            const entry = meta.optimization?.optimizedEntryPoint || meta.entryPoint;
            const plungeRate = meta.plungeRate || this.context.cutting.plungeRate;

            if (this.currentPosition.z < this.context.machine.travelZ) {
                machinePlan.addRapid(null, null, this.context.machine.travelZ);
            }
            machinePlan.addRapid(entry.x, entry.y, null);
            if (this.context.machine.travelZ > this.FEED_HEIGHT) {
                machinePlan.addRapid(null, null, this.FEED_HEIGHT);
            }
            machinePlan.addLinear(null, null, entry.z, plungeRate);

            for (const cmd of purePlan.commands) {
                machinePlan.addCommand({ ...cmd });
            }

            machinePlan.addRetract(this.context.machine.travelZ);
            return machinePlan;
        }

        generateEntryMove(plan, planMetadata, entryType) {
            const cutDepth = planMetadata.entryPoint.z;
            const entryPoint = planMetadata.entryPoint;
            const plungeRate = planMetadata.plungeRate;

            // Rapid from Travel Z to FEED_HEIGHT if above it
            if (this.currentPosition.z > this.FEED_HEIGHT) {
                plan.addRapid(null, null, this.FEED_HEIGHT);
            }

            if (entryType === 'helix' && !planMetadata.isSimpleCircle) {
                this.generateHelixEntry(plan, entryPoint, cutDepth, plungeRate);
            // IGNORE RAMP ENTRY UNTIL PROPERLY DEVELOPED AND TESTED
            // } else if (entryType === 'ramp') { 
            //     this.generateRampEntry(plan, planMetadata, cutDepth, plungeRate);
            } else {
                // Default Plunge from FEED_HEIGHT (1mm) down
                plan.addLinear(
                    entryPoint.x,
                    entryPoint.y,
                    cutDepth, 
                    plungeRate
                );
            }
        }

        generateHelixEntry(plan, entryPoint, targetDepth, plungeRate) {
            const helixConfig = this.context.config.entry.helix;
            if (!helixConfig) {
                plan.addLinear(entryPoint.x, entryPoint.y, targetDepth, plungeRate);
                return;
            }

            const arcCW = this.determineWinding(plan.metadata.context);
            const angleDir = arcCW ? -1 : 1;

            const toolDiameter = this.context.tool.diameter;
            const helixRadius = toolDiameter * helixConfig.radiusFactor;
            const helixPitch = helixConfig.pitch;
            const revolutions = Math.abs(targetDepth) / helixPitch;
            const steps = Math.ceil(revolutions * helixConfig.segmentsPerRevolution);

            // Feed to material surface (Z0) to start helix geometry
            plan.addLinear(null, null, 0, plungeRate);

            for (let i = 1; i <= steps; i++) {
                const angle = (i / steps) * revolutions * 2 * Math.PI * angleDir;
                const z = (i / steps) * targetDepth;
                const x = entryPoint.x + helixRadius * Math.cos(angle);
                const y = entryPoint.y + helixRadius * Math.sin(angle);
                plan.addLinear(x, y, z, plungeRate);
            }

            // Re-center at bottom
            plan.addLinear(entryPoint.x, entryPoint.y, targetDepth, plungeRate);
        }

        /* IGNORE UNTIL PROPERLY DEVELOPED AND TESTED
        generateRampEntry(plan, purePlan, targetDepth, plungeRate) {
            // Feed to material surface (Z0)
            plan.addLinear(null, null, 0, plungeRate);

            const rampAngle = this.context.strategy.entryRampAngle;
            const rampSlope = Math.tan(rampAngle * Math.PI / 180);
            const rampLength = Math.abs(targetDepth) / rampSlope;
            const shallowDepth = targetDepth * 0.1;

            if (purePlan.metadata.primitiveType === 'path' && purePlan.commands && purePlan.commands.length > 2) {
                let accumulatedLength = 0;
                const entryPoint = purePlan.metadata.entryPoint;

                for (let i = 0; i < purePlan.commands.length && accumulatedLength < rampLength; i++) {
                    const cmd = purePlan.commands[i];
                    if (cmd.type === 'LINEAR' && cmd.x !== null && cmd.y !== null) {
                        const prevPos = i === 0 ? entryPoint : {
                            x: purePlan.commands[i - 1].x,
                            y: purePlan.commands[i - 1].y
                        };

                        const segLen = Math.hypot(cmd.x - prevPos.x, cmd.y - prevPos.y);
                        accumulatedLength += segLen;

                        const zAtPoint = shallowDepth - (accumulatedLength / rampLength) * Math.abs(targetDepth - shallowDepth);
                        const finalZ = Math.max(zAtPoint, targetDepth);

                        plan.addLinear(cmd.x, cmd.y, finalZ, plungeRate);

                        if (finalZ === targetDepth) break;
                    }
                }
            } else {
                plan.addLinear(null, null, targetDepth, plungeRate);
            }
        }
        */

        processPeckMark(purePlan) {
            const machinePlan = new ToolpathPlan(purePlan.operationId);
            Object.assign(machinePlan.metadata, purePlan.metadata);

            const planContext = purePlan.metadata.context;
            const peckData = purePlan.metadata.peckData;
            const position = peckData.position;
            const finalDepth = purePlan.metadata.cutDepth;

            const machine = planContext.machine;
            const strategy = planContext.strategy.drill;
            const cutting = planContext.cutting;

            // Check if current post-processor supports canned cycles
            const postProcessorName = planContext.gcode.postProcessor;
            const supportsCanned = planContext.gcode.supportsCannedCycles;

            if (this.currentPosition.z < machine.travelZ) {
                machinePlan.addRapid(null, null, machine.travelZ);
                this.currentPosition.z = machine.travelZ;
            }
            // Move to XY
            machinePlan.addRapid(position.x, position.y, null);
            this.currentPosition.x = position.x;
            this.currentPosition.y = position.y;

            // Rapid to Feed Height
            machinePlan.addRapid(null, null, this.FEED_HEIGHT);

            // Single plunge
            if (supportsCanned && strategy.cannedCycle !== 'none') {
                // Dispatch to Canned Cycle Primitive, passing the specific cycle type
                if (strategy.cannedCycle === 'G83' || strategy.cannedCycle === 'G73') {
                    machinePlan.addCannedPeck(position.x, position.y, finalDepth, strategy.retractHeight, strategy.peckDepth, cutting.plungeRate, strategy.cannedCycle);
                } else {
                    machinePlan.addCannedSimple(position.x, position.y, finalDepth, strategy.retractHeight, cutting.plungeRate, strategy.dwellTime);
                }
                // Update tracker: Machine ends cycle at the retract plane
                this.currentPosition.z = strategy.retractHeight;

            } else if (strategy.cannedCycle === 'none' || strategy.peckDepth === 0 || strategy.peckDepth >= Math.abs(finalDepth)) {
                // Standard manual single plunge
                machinePlan.addPlunge(finalDepth, cutting.plungeRate);
                if (strategy.dwellTime > 0) {
                    machinePlan.addDwell(strategy.dwellTime);
                }
                machinePlan.addRetract(machine.travelZ);
            } else {
                // Standard manual pecking loop
                let lastCutDepth = 0;
                const retractPlane = strategy.retractHeight;
                const rapidDownClearance = 0.1;

                while (lastCutDepth > finalDepth) {
                    let targetPeckDepth = lastCutDepth - planContext.strategy.drill.peckDepth;
                    if (targetPeckDepth < finalDepth) {
                        targetPeckDepth = finalDepth;
                    }

                    const rapidDownTo = (lastCutDepth === 0) ? this.FEED_HEIGHT : (lastCutDepth + rapidDownClearance);
                    machinePlan.addRapid(undefined, undefined, rapidDownTo);

                    machinePlan.addPlunge(targetPeckDepth, cutting.plungeRate);

                    if (strategy.dwellTime > 0) {
                        machinePlan.addDwell(strategy.dwellTime);
                    }

                    lastCutDepth = targetPeckDepth;

                    if (lastCutDepth > finalDepth) {
                        machinePlan.addRetract(retractPlane);
                    }
                }
                machinePlan.addRetract(machine.travelZ);
            }
            return machinePlan;
        }

        generateHelicalDrillMilling(purePlan) {
            const machinePlan = new ToolpathPlan(purePlan.operationId);
            Object.assign(machinePlan.metadata, purePlan.metadata);

            const primitiveType = purePlan.metadata.primitiveType;
            const entryPoint = purePlan.metadata.entryPoint;

            // Travel Z
            machinePlan.addRapid(entryPoint.x, entryPoint.y, this.context.machine.travelZ);
            // Feed Height
            machinePlan.addRapid(null, null, this.FEED_HEIGHT);

            const arcCW = this.determineWinding(purePlan.metadata.context);

            if (primitiveType === 'obround') {
                this.generateSlotHelix(machinePlan, purePlan, arcCW);
            } else if (primitiveType === 'circle') {
                this.generateCircleHelix(machinePlan, purePlan, arcCW);
            }

            return machinePlan;
        }

        generateCircleHelix(machinePlan, purePlan, arcCW) {
            const center = purePlan.metadata.center;
            const radius = purePlan.metadata.radius;

            const minHelixDia = this.context.config.entry?.drilling?.minHelixDiameter || 0; 
            const targetDepth = purePlan.metadata.cutDepth;
            const plungeRate = purePlan.metadata.plungeRate;

            if (!center || !radius || (radius * 2) < minHelixDia) {
                if (center) {
                    machinePlan.addRapid(center.x, center.y, null);
                    machinePlan.addLinear(center.x, center.y, targetDepth, plungeRate);
                    machinePlan.addRetract(this.context.machine.travelZ);
                }
                return;
            }

            const toolDiameter = purePlan.metadata.toolDiameter;
            const feedRate = purePlan.metadata.feedRate;
            const startX = purePlan.metadata.entryPoint.x;
            const startY = purePlan.metadata.entryPoint.y;
            const startAngle = Math.atan2(startY - center.y, startX - center.x);

            machinePlan.addRapid(startX, startY, null);
            machinePlan.addLinear(startX, startY, 0, plungeRate);

            const ring = { center, radius };
            const finalAngle = this.helixDownRing(machinePlan, ring, startAngle, 0, targetDepth, feedRate, toolDiameter, arcCW);
            this.fullCircleAtDepth(machinePlan, ring, finalAngle, targetDepth, feedRate, arcCW);

            machinePlan.addRetract(this.context.machine.travelZ);
        }

        /**
         * Expands a drill mill macro plan into a complete machine-ready cutting sequence.
         * Both entry types follow the same depth-staged pattern:
         *   For each depth: descend inner ring → cleanup inner → step out → cleanup outer → step back
         */
        generateDrillMillMacro(purePlan) {
            if (purePlan.metadata.slotMacro) {
                return this.generateSlotMillMacro(purePlan);
            }

            const machinePlan = new ToolpathPlan(purePlan.operationId);
            Object.assign(machinePlan.metadata, purePlan.metadata);

            const rings = purePlan.metadata.concentricRings;      // [innermost, ..., outermost]
            const entryType = purePlan.metadata.entryType;
            const depthLevels = purePlan.metadata.depthLevels;     // [-0.05, -0.10, ...] descending
            const feedRate = purePlan.metadata.feedRate;
            const plungeRate = purePlan.metadata.plungeRate;
            const toolDiameter = purePlan.metadata.toolDiameter;

            const innerRing = rings[0];
            const center = innerRing.center;
            const entryPoint = purePlan.metadata.optimization?.optimizedEntryPoint
                || purePlan.metadata.entryPoint;

            // Track the angle dynamically
            let currentAngle = Math.atan2(
                entryPoint.y - center.y,
                entryPoint.x - center.x
            );

            const initialEntryX = center.x + innerRing.radius * Math.cos(currentAngle);
            const initialEntryY = center.y + innerRing.radius * Math.sin(currentAngle);
            const minHelixDia = this.context.config.entry?.drilling?.minHelixDiameter || 0;
            const useHelix = entryType === 'helix' && (innerRing.radius * 2) >= minHelixDia;

            const arcCW = this.determineWinding(purePlan.metadata.context);

            machinePlan.addRapid(initialEntryX, initialEntryY, this.context.machine.travelZ);
            machinePlan.addRapid(null, null, this.FEED_HEIGHT);
            machinePlan.addLinear(initialEntryX, initialEntryY, 0, plungeRate);

            let currentZ = 0;
            const finalDepth = depthLevels[depthLevels.length - 1];
            if (rings.length === 1 && useHelix) {
                // Update currentAngle with wherever the helix stops
                currentAngle = this.helixDownRing(machinePlan, innerRing, currentAngle, 0, finalDepth, feedRate, toolDiameter, arcCW);
                this.fullCircleAtDepth(machinePlan, innerRing, currentAngle, finalDepth, feedRate, arcCW);

            } else {
                for (let d = 0; d < depthLevels.length; d++) {
                    const targetZ = depthLevels[d];
                    if (useHelix) {
                        // Update currentAngle with wherever the helix stops
                        currentAngle = this.helixDownRing(machinePlan, innerRing, currentAngle, currentZ, targetZ, feedRate, toolDiameter, arcCW);
                    } else {
                        // Dynamically calculate the plunge point based on current angle
                        const plungeX = center.x + innerRing.radius * Math.cos(currentAngle);
                        const plungeY = center.y + innerRing.radius * Math.sin(currentAngle);
                        machinePlan.addLinear(plungeX, plungeY, targetZ, plungeRate);
                    }
                    for (let r = 0; r < rings.length; r++) {
                        const ring = rings[r];

                        if (r > 0) {
                            // Step out to the next ring along the current angle
                            const ringEntryX = ring.center.x + ring.radius * Math.cos(currentAngle);
                            const ringEntryY = ring.center.y + ring.radius * Math.sin(currentAngle);
                            machinePlan.addLinear(ringEntryX, ringEntryY, targetZ, feedRate);
                        }

                        // Run the 360 clear starting exactly from the current angle
                        this.fullCircleAtDepth(machinePlan, ring, currentAngle, targetZ, feedRate, arcCW);
                    }
                    if (rings.length > 1 && d < depthLevels.length - 1) {
                        // Return to the inner ring exactly along the current angle
                        const returnX = center.x + innerRing.radius * Math.cos(currentAngle);
                        const returnY = center.y + innerRing.radius * Math.sin(currentAngle);
                        machinePlan.addLinear(returnX, returnY, targetZ, feedRate);
                    }

                    currentZ = targetZ;
                }
            }
            machinePlan.addRetract(this.context.machine.travelZ);

            this.debug(`Drill Mill Macro: ${machinePlan.commands.length} cmds, ` +
                       `${rings.length} ring(s), ${depthLevels.length} depth(s), ` +
                       `entry=${useHelix ? 'helix' : 'plunge'}`);

            return machinePlan;
        }

        /**
         * Helical descent along a single ring between two Z levels.
         * Called once per depth stage, NOT once for the full hole depth.
         */
        helixDownRing(machinePlan, ring, startAngle, fromZ, toZ, feedRate, toolDiameter, arcCW) {
            const center = ring.center;
            const radius = ring.radius;

            const deltaZ = Math.abs(toZ - fromZ);
            if (deltaZ < 1e-6) return startAngle; // Already at target

            const requestedPitch = Math.abs(this.context.strategy.depthPerPass);
            const maxPitchForTool = toolDiameter * 0.5;
            const helixPitch = Math.min(requestedPitch, maxPitchForTool);
            const revolutions = Math.max(1, Math.ceil(deltaZ / helixPitch));
            const segmentsPerRev = 16;
            const totalSegments = Math.ceil(revolutions * segmentsPerRev);

            const angleSpan = revolutions * 2 * Math.PI * (arcCW ? -1 : 1);

            let lastX = center.x + radius * Math.cos(startAngle);
            let lastY = center.y + radius * Math.sin(startAngle);
            let finalAngle = startAngle;

            for (let i = 1; i <= totalSegments; i++) {
                const ratio = i / totalSegments;
                finalAngle = startAngle + (ratio * angleSpan);
                const z = fromZ + ratio * (toZ - fromZ);
                const x = center.x + radius * Math.cos(finalAngle);
                const y = center.y + radius * Math.sin(finalAngle);
                const i_val = center.x - lastX;
                const j_val = center.y - lastY;

                machinePlan.addArc(x, y, z, i_val, j_val, arcCW, feedRate);
                lastX = x;
                lastY = y;
            }

            // Return the exact angle where the helix finished
            return finalAngle % (2 * Math.PI);
        }

        /**
         * Single full-circle cleanup pass on a ring at a given depth.
         */
        fullCircleAtDepth(machinePlan, ring, startAngle, depth, feedRate, arcCW) {
            const center = ring.center;
            const radius = ring.radius;

            const startX = center.x + radius * Math.cos(startAngle);
            const startY = center.y + radius * Math.sin(startAngle);

            const i_val = center.x - startX;
            const j_val = center.y - startY;

            // Passing null for X and Y to force the post-processor to output a perfect 360° circle (G2 I... J...)
            machinePlan.addArc(null, null, depth, i_val, j_val, arcCW, feedRate);
        }

        /**
         * Expands an obround drill mill macro into a complete machine-ready sequence.
         * Same depth-staged pattern as circle macro:
         *   For each depth: descend inner → cleanup inner → step out → cleanup outer → step back
         */
        generateSlotMillMacro(purePlan) {
            const machinePlan = new ToolpathPlan(purePlan.operationId);
            Object.assign(machinePlan.metadata, purePlan.metadata);

            const rings = purePlan.metadata.obroundRings;      // [innermost, ..., outermost]
            const entryType = purePlan.metadata.entryType;
            const depthLevels = purePlan.metadata.depthLevels;
            const feedRate = purePlan.metadata.feedRate;
            const plungeRate = purePlan.metadata.plungeRate;
            const toolDiameter = purePlan.metadata.toolDiameter;

            const innerRing = rings[0];
            const arcCW = this.determineWinding(purePlan.metadata.context);

            // Plunge exactly where the toolpath begins to avoid flat travel cuts
            const innerEntry = arcCW ? innerRing.pB : innerRing.pC;

            // Helix feasibility: inner ring slot radius must be large enough
            const minHelixDia = this.context.config.entry?.drilling?.minHelixDiameter || 0;
            const useHelix = entryType === 'helix' && (innerRing.slotRadius * 2) >= minHelixDia;

            // Approach
            machinePlan.addRapid(innerEntry.x, innerEntry.y, this.context.machine.travelZ);
            machinePlan.addRapid(null, null, this.FEED_HEIGHT);

            // Feed to material surface
            machinePlan.addLinear(innerEntry.x, innerEntry.y, 0, plungeRate);

            let currentZ = 0;
            const finalDepth = depthLevels[depthLevels.length - 1];

            // Single-ring shortcut
            if (rings.length === 1 && useHelix) {
                this.helixDownObround(machinePlan, innerRing, 0, finalDepth, plungeRate, feedRate, toolDiameter, arcCW);
                this.obroundLoopAtDepth(machinePlan, innerRing, finalDepth, feedRate, arcCW);
            } else {
                // Multi-ring depth-staged loop
                for (let d = 0; d < depthLevels.length; d++) {
                    const targetZ = depthLevels[d];
                    if (useHelix) {
                        this.helixDownObround(machinePlan, innerRing, currentZ, targetZ, plungeRate, feedRate, toolDiameter, arcCW);
                    } else {
                        machinePlan.addLinear(innerEntry.x, innerEntry.y, targetZ, plungeRate);
                    }

                    for (let r = 0; r < rings.length; r++) {
                        const ring = rings[r];
                        if (r > 0) {
                            // Transition to the exit-side point of the next ring to avoid diagonal traverses. CW loops end at pC, CCW loops end at pB.
                            const ringTransition = arcCW ? ring.pC : ring.pB;
                            machinePlan.addLinear(ringTransition.x, ringTransition.y, targetZ, feedRate);
                        }
                        this.obroundLoopAtDepth(machinePlan, ring, targetZ, feedRate, arcCW);
                    }

                    if (rings.length > 1 && d < depthLevels.length - 1) {
                        // All concentric rings have been cut at this depth, so the entire slot interior is clear. Go directly to the next helix/plunge entry point.
                        machinePlan.addLinear(innerEntry.x, innerEntry.y, targetZ, feedRate);
                    }
                    currentZ = targetZ;
                }
            }

            // Retract
            machinePlan.addRetract(this.context.machine.travelZ);
            return machinePlan;
        }

        /**
         * Helical descent along an obround ring between two Z levels.
         * Z change is distributed across the two cap arcs; linear segments stay flat.
         */
        helixDownObround(machinePlan, ring, fromZ, toZ, plungeRate, feedRate, toolDiameter, arcCW) {
            const deltaZ = Math.abs(toZ - fromZ);
            if (deltaZ < 1e-6) return;

            const pA = ring.pA, pB = ring.pB, pC = ring.pC, pD = ring.pD;
            const cStart = ring.startCapCenter, cEnd = ring.endCapCenter;

            const requestedPitch = Math.abs(this.context.strategy.depthPerPass);
            const helixPitch = Math.min(requestedPitch, toolDiameter * 0.5);
            const depthPerHalfLoop = helixPitch * 0.5;

            let currentZ = fromZ;
            while (currentZ > toZ + 1e-9) {
                if (!arcCW) { // CCW Logic
                    // Assume pC because of the entry logic
                    let targetZ = Math.max(currentZ - depthPerHalfLoop, toZ);
                    machinePlan.addArc(pD.x, pD.y, targetZ, cEnd.x - pC.x, cEnd.y - pC.y, false, feedRate);
                    currentZ = targetZ;

                    machinePlan.addLinear(pA.x, pA.y, currentZ, feedRate);
                    targetZ = Math.max(currentZ - depthPerHalfLoop, toZ);
                    machinePlan.addArc(pB.x, pB.y, targetZ, cStart.x - pA.x, cStart.y - pA.y, false, feedRate);
                    currentZ = targetZ;

                    if (currentZ > toZ + 1e-9) {
                        machinePlan.addLinear(pC.x, pC.y, currentZ, feedRate);
                    }
                } else { // CW Logic
                    // Assume pB because of the entry logic
                    let targetZ = Math.max(currentZ - depthPerHalfLoop, toZ);
                    machinePlan.addArc(pA.x, pA.y, targetZ, cStart.x - pB.x, cStart.y - pB.y, true, feedRate);
                    currentZ = targetZ;

                    machinePlan.addLinear(pD.x, pD.y, currentZ, feedRate); 
                    targetZ = Math.max(currentZ - depthPerHalfLoop, toZ);
                    machinePlan.addArc(pC.x, pC.y, targetZ, cEnd.x - pD.x, cEnd.y - pD.y, true, feedRate);
                    currentZ = targetZ;

                    if (currentZ > toZ + 1e-9) {
                        machinePlan.addLinear(pB.x, pB.y, currentZ, feedRate);
                    }
                }
            }
        }

        /**
         * Single full obround cleanup loop at constant depth.
         * CW order: A → D → C(arc) → B → A(arc)
         */
        obroundLoopAtDepth(machinePlan, ring, depth, feedRate, arcCW) {
            const pA = ring.pA, pB = ring.pB, pC = ring.pC, pD = ring.pD;
            const cStart = ring.startCapCenter, cEnd = ring.endCapCenter;

            if (!arcCW) { // CCW
                // Because helix ended at pB, linear traverse to pC to start the loop
                machinePlan.addLinear(pC.x, pC.y, depth, feedRate);
                machinePlan.addArc(pD.x, pD.y, depth, cEnd.x - pC.x, cEnd.y - pC.y, false, feedRate);
                machinePlan.addLinear(pA.x, pA.y, depth, feedRate);
                machinePlan.addArc(pB.x, pB.y, depth, cStart.x - pA.x, cStart.y - pA.y, false, feedRate);
            } else { // CW
                // Because helix ended at pC, linear traverse to pB to start the loop
                machinePlan.addLinear(pB.x, pB.y, depth, feedRate);
                machinePlan.addArc(pA.x, pA.y, depth, cStart.x - pB.x, cStart.y - pB.y, true, feedRate);
                machinePlan.addLinear(pD.x, pD.y, depth, feedRate);
                machinePlan.addArc(pC.x, pC.y, depth, cEnd.x - pD.x, cEnd.y - pD.y, true, feedRate);
            }
        }

        generateSlotHelix(machinePlan, purePlan, arcCW) {
            const od = purePlan.metadata.obroundData;
            const finalDepth = purePlan.metadata.cutDepth;
            const toolDiameter = purePlan.metadata.toolDiameter;
            const feedRate = purePlan.metadata.feedRate;
            const plungeRate = purePlan.metadata.plungeRate;

            const entryPt = arcCW ? od.pB : od.pC;
            machinePlan.addRapid(entryPt.x, entryPt.y, null);
            machinePlan.addLinear(entryPt.x, entryPt.y, 0, plungeRate);

            this.helixDownObround(machinePlan, od, 0, finalDepth, plungeRate, feedRate, toolDiameter, arcCW);
            this.obroundLoopAtDepth(machinePlan, od, finalDepth, feedRate, arcCW);

            machinePlan.addRetract(this.context.machine.travelZ);
        }

        determineWinding(ctx) {
            // Drill macros are mirror-agnostic since the geometry translator naturally handles point swapping during mirroring.
            const isClimb = true; // Enforced until UI supports conventional routing
            return isClimb; // Climb milling an internal pocket translates to CW (true)
        }

        calculatePathMetrics(plans, context) {
            let totalTime = 0;
            let totalDistance = 0;
            const machineContext = context?.machine || { safeZ: 5.0, rapidFeedRate: 1000 }; 
            let lastPos = { x: 0, y: 0, z: machineContext.safeZ }; 
            const rapidFeed = machineContext.rapidFeedRate;

            for (const plan of plans) {
                for (const cmd of plan.commands) {
                    let nextPos = { ...lastPos };
                    if (cmd.x !== null) nextPos.x = cmd.x;
                    if (cmd.y !== null) nextPos.y = cmd.y;
                    if (cmd.z !== null) nextPos.z = cmd.z;

                    const dx = nextPos.x - lastPos.x;
                    const dy = nextPos.y - lastPos.y;
                    const dz = nextPos.z - lastPos.z;
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    let feed = 100;

                    if (cmd.type === 'RAPID' || cmd.type === 'RETRACT') {
                        feed = rapidFeed;
                    } else if (cmd.f) {
                        feed = cmd.f;
                    }

                    if (dist > 0) {
                        totalDistance += dist; 
                        if (feed > 0) {
                            totalTime += (dist / feed) * 60; 
                        }
                    }

                    if (cmd.type === 'DWELL') {
                        totalTime += cmd.dwell || 0;
                    }
                    lastPos = nextPos;
                }
            }
            return { estimatedTime: totalTime, totalDistance: totalDistance };
        }

        debug(message, data = null) {
            if (!debugState.enabled) return;
            data ? console.log(`[MachineProcessor] ${message}`, data)
                 : console.log(`[MachineProcessor] ${message}`);
        }
    }

    window.MachineProcessor = MachineProcessor;
})();