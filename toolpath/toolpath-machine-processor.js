/*!
 * @file        toolpath/toolpath-machine-processor.js
 * @description Adds machine operations and defines special cycles (e.g. Helix entry milled holes and slots)
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

    class MachineProcessor {
        constructor(core) {
            this.core = core;
            this.currentPosition = { x: 0, y: 0, z: 0 };
            this.context = null;
            // Clearance above Z0 to switch from G0 to G1.
            // This saves time compared to plunging from Travel Z.
            this.FEED_HEIGHT = 1.0;  // Review - Add to config.js
        }

        processPlans(toolpathPlans, context, initialPos) {
            if (!toolpathPlans || toolpathPlans.length === 0) {
                return { plans: [], endPos: initialPos };
            }

            if (!context) {
                console.error("[MachineProcessor] Plans are missing toolpath context!");
                return { plans: [], endPos: initialPos };
            }

            this.context = context;
            // Grab the feedHeight from config properly // Review this logic
            this.FEED_HEIGHT = this.context.machine.feedHeight || 1.0;  // REVIEW - Add to config.js
            const machineReadyPlans = [];

            // Initialize current position.
            // Use provided initialPos, or default to Safe Z if starting fresh
            this.currentPosition = { ...(initialPos || { x: 0, y: 0, z: this.context.machine.safeZ }) };

            this.debug(`Starting Batch. Initial Pos: Z${this.currentPosition.z.toFixed(3)}`, this.currentPosition);

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

            for (let i = 0; i < toolpathPlans.length; i++) {
                const plan = toolpathPlans[i];
                const planMetadata = plan.metadata || {};

                if (debugState.enabled && planMetadata.isTabbedPass) {
                    const tabCmds = plan.commands.filter(c => c.metadata?.isTab === true).length;
                    console.log(`[MachineProcessor] Received TABBED plan: ${tabCmds}/${plan.commands.length} tab commands`);
                }

                if (planMetadata.isPeckMark) {
                    this.debug(`Processing Peck Mark ${i+1}/${toolpathPlans.length}`);
                    const peckPlan = this.processPeckMark(plan);
                    machineReadyPlans.push(peckPlan);

                    // Update the machine position tracker (processPeckMark ends with a retract to travelZ)
                    this.currentPosition = {
                        x: planMetadata.entryPoint.x,
                        y: planMetadata.entryPoint.y,
                        z: this.context.machine.travelZ
                    };
                    continue;
                }

                // Handle drill mill macro (complete hole-clearing sequence)
                if (planMetadata.drillMillMacro) {
                    this.debug(`Processing Drill Mill Macro ${i+1}/${toolpathPlans.length}`);
                    const macroPlan = this.generateDrillMillMacro(plan);
                    machineReadyPlans.push(macroPlan);
                    this.currentPosition = {
                        ...(planMetadata.entryPoint || { x: 0, y: 0 }),
                        z: this.context.machine.travelZ
                    };
                    continue;
                }

                // Handle drill peck marks // This comment is confusing without a planMetadata.isPeckMark check
                if (planMetadata.isDrillMilling) {
                    const primitiveType = planMetadata.primitiveType;
                    const useHelix = (planMetadata.entryType || 'plunge') === 'helix';

                    if (useHelix && (primitiveType === 'circle' || primitiveType === 'obround')) {
                        this.debug(`Processing Helix Mill ${primitiveType} ${i+1}/${toolpathPlans.length}`);
                        const helixPlan = this.generateHelicalDrillMilling(plan);
                        machineReadyPlans.push(helixPlan);
                        this.currentPosition = { ...(planMetadata.exitPoint || {x:0, y:0}), z: this.context.machine.travelZ };
                        continue; 
                    }
                }

                // Handle centerline slots
                if (planMetadata.isCenterlinePath && planMetadata.strategy?.zigzag) {
                    this.debug(`Processing Centerline Slot (Macro) ${i+1}/${toolpathPlans.length}`);

                    const slotPlan = new ToolpathPlan(plan.operationId);
                    Object.assign(slotPlan.metadata, planMetadata);

                    const strategy = planMetadata.strategy;
                    const startXY = planMetadata.entryPoint;
                    const endXY = { x: plan.commands[0].x, y: plan.commands[0].y };

                    // Validate strategy parameters
                    if (!strategy.feedRate || !strategy.plungeRate || !strategy.cutDepth) {
                        console.error('[MachineProcessor] Missing strategy parameters for centerline slot');
                        continue;
                    }

                    // Move to Start at Travel Z
                    slotPlan.addRapid(startXY.x, startXY.y, this.context.machine.travelZ);
                    slotPlan.addRapid(null, null, this.FEED_HEIGHT);

                    // Execute Zig-Zag Depth Loop
                    const surfaceZ = 0; // Assume material surface at Z0
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

                // Connection Move Logic
                const linkType = planMetadata.optimization?.linkType || 'rapid';
                let isMultiDepthPlunge = false;

                if (i > 0 && linkType === 'rapid') { 
                    const prevPlan = toolpathPlans[i - 1];
                    const prevMeta = prevPlan.metadata || {};

                    const isSameOp = prevMeta.operationId === planMetadata.operationId;
                    const currentDepth = typeof planMetadata.cutDepth === 'number' ? planMetadata.cutDepth : 0;
                    const prevDepth = typeof prevMeta.cutDepth === 'number' ? prevMeta.cutDepth : 0;
                    const isDeeper = currentDepth < prevDepth;

                    const currentEntry = planMetadata.entryPoint || {x:0, y:0};
                    const prevExit = this.currentPosition;
                    const isSameXY = Math.hypot(currentEntry.x - prevExit.x, currentEntry.y - prevExit.y) < 0.01; // REVIEW - precision value in config?

                    if (isSameOp && isDeeper && !planMetadata.isPeckMark && !planMetadata.isDrillMilling && isSameXY) {
                         isMultiDepthPlunge = true;
                    }
                }

                const connectionPlan = new ToolpathPlan('connection');
                if (isMultiDepthPlunge) {
                    // Direct plunge (Z only)
                    this.debug(`Link ${i}: Multi-Depth Plunge to ${planMetadata.entryPoint.z.toFixed(3)}`);
                    connectionPlan.addLinear(
                        planMetadata.entryPoint.x, 
                        planMetadata.entryPoint.y, 
                        planMetadata.entryPoint.z, 
                        this.context.cutting.plungeRate 
                    );
                    connectionPlan.metadata.type = 'multidepth_plunge';
                    this.currentPosition.z = planMetadata.entryPoint.z;
                    this.currentPosition.x = planMetadata.entryPoint.x;
                    this.currentPosition.y = planMetadata.entryPoint.y;
                } else if (linkType === 'staydown') {
                    // Staydown (XY only)
                    this.debug(`Link ${i}: Staydown move`);
                    connectionPlan.addLinear(
                        planMetadata.entryPoint.x,
                        planMetadata.entryPoint.y,
                        undefined, 
                        planMetadata.feedRate
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
                    planMetadata.entryPoint.x - this.currentPosition.x,
                    planMetadata.entryPoint.y - this.currentPosition.y
                ) < 0.01;

                if (!atTargetXY) {
                    connectionPlan.addRapid(planMetadata.entryPoint.x, planMetadata.entryPoint.y, null);
                }

                connectionPlan.metadata.type = 'rapid_link';
            }
                machineReadyPlans.push(connectionPlan);

                this.currentPosition.x = planMetadata.entryPoint.x;
                this.currentPosition.y = planMetadata.entryPoint.y;

                // Entry Move
                if (linkType === 'rapid' && !isMultiDepthPlunge) {
                    const entryPlan = new ToolpathPlan('entry');
                    entryPlan.metadata.spindleSpeed = this.context.cutting.spindleSpeed;
                    entryPlan.metadata.spindleDwell = this.context.cutting.spindleDwell;
                    const entryType = planMetadata.entryType || 'plunge';
                    this.generateEntryMove(entryPlan, planMetadata, entryType); 
                    machineReadyPlans.push(entryPlan);
                    this.currentPosition.z = planMetadata.entryPoint.z;
                }

                // Execute cutting plan
                const cuttingPlan = new ToolpathPlan(plan.operationId);
                Object.assign(cuttingPlan.metadata, plan.metadata);

                let currentPassDepth = this.currentPosition.z; 
                const isTabbedPass = planMetadata.isTabbedPass === true;
                const tabTopZ = planMetadata.tabTopZ; 
                const plungeRate = this.context.cutting.plungeRate;

                for (const cmd of plan.commands) {
                    const requiresTabSequence = isTabbedPass && cmd.metadata?.isTab === true;

                    if (requiresTabSequence) {
                        // Tab Lift
                        this.debug(`Generating Tab Lift to Z${tabTopZ}`);
                        cuttingPlan.addLinear(null, null, tabTopZ, plungeRate);
                        const tabMoveCmd = { ...cmd, z: tabTopZ };
                        cuttingPlan.addCommand(tabMoveCmd);
                        cuttingPlan.addLinear(null, null, currentPassDepth, plungeRate);
                    } else {
                        // Normal Cut
                        const cutCmd = { ...cmd, z: currentPassDepth }; 
                        cuttingPlan.addCommand(cutCmd);
                    }

                    if (cmd.x !== null) this.currentPosition.x = cmd.x;
                    if (cmd.y !== null) this.currentPosition.y = cmd.y;
                }

                machineReadyPlans.push(cuttingPlan);
                this.currentPosition.z = currentPassDepth; 

                // Retract Logic
                const isStayDownSource = (
                    i < toolpathPlans.length - 1 &&
                    toolpathPlans[i + 1]?.metadata?.optimization?.linkType === 'staydown'
                );

                let isNextMultiDepth = false;
                if (i < toolpathPlans.length - 1) {
                     const nextPlan = toolpathPlans[i + 1];
                     const nextMeta = nextPlan.metadata || {};
                     const isSameOp = nextMeta.operationId === planMetadata.operationId;
                     const currentDepth = typeof planMetadata.cutDepth === 'number' ? planMetadata.cutDepth : 0;
                     const nextDepth = typeof nextMeta.cutDepth === 'number' ? nextMeta.cutDepth : 0;
                     const isDeeper = nextDepth < currentDepth;
                     const nextEntry = nextMeta.entryPoint || {x:0, y:0, z:0};
                     const currentExit = this.currentPosition;
                     const isSameXY = Math.hypot(nextEntry.x - currentExit.x, nextEntry.y - currentExit.y) < 0.01;

                     if (isSameOp && isDeeper && isSameXY && !nextMeta.isPeckMark && !nextMeta.isDrillMilling) {
                         isNextMultiDepth = true;
                     }
                 }

                if (!isStayDownSource && !isNextMultiDepth) {
                    const retractPlan = new ToolpathPlan('retract');
                    retractPlan.addRetract(this.context.machine.travelZ);
                    machineReadyPlans.push(retractPlan);
                    this.currentPosition.z = this.context.machine.travelZ;
                } else {
                    this.currentPosition.z = currentPassDepth;
                }
            }

            // Final Retract to Safe Z
            const finalPlan = new ToolpathPlan('final');
            if (this.currentPosition.z < this.context.machine.safeZ) {
                 finalPlan.addRetract(this.context.machine.safeZ);
                 this.currentPosition.z = this.context.machine.safeZ; 
                 machineReadyPlans.push(finalPlan);
            }

            return { plans: machineReadyPlans, endPos: this.currentPosition };
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
                // Standard Plunge from FEED_HEIGHT (1mm) down
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

            const toolDiameter = this.context.tool.diameter;
            const helixRadius = toolDiameter * helixConfig.radiusFactor;
            const helixPitch = helixConfig.pitch;
            const revolutions = Math.abs(targetDepth) / helixPitch;
            const steps = Math.ceil(revolutions * helixConfig.segmentsPerRevolution);

            // Feed to material surface (Z0) to start helix geometry
            plan.addLinear(null, null, 0, plungeRate);

            for (let i = 1; i <= steps; i++) {
                const angle = (i / steps) * revolutions * 2 * Math.PI;
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
            const processorInfo = window.pcbcam.gcodeGenerator.getProcessorInfo(postProcessorName);
            const supportsCanned = processorInfo?.capabilities?.supportsCannedCycles;

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

            if (primitiveType === 'obround') {
                this.generateSlotHelix(machinePlan, purePlan);
            } else if (primitiveType === 'circle') {
                this.generateCircleHelix(machinePlan, purePlan);
            }

            return machinePlan;
        }

        generateCircleHelix(machinePlan, purePlan) {
            const center = purePlan.metadata.center;
            const radius = purePlan.metadata.radius;

            const minHelixDia = this.context.config.entry?.drilling?.minHelixDiameter; // config value is DIAMETER, so check against radius * 2 (or threshold / 2)

            // If path diameter is less than threshold, it's degenerate -> Plunge/Ream
            if (!center || !radius || (radius * 2) < minHelixDia) {
                const targetDepth = purePlan.metadata.cutDepth;
                const plungeRate = purePlan.metadata.plungeRate;

                if (center) {
                    machinePlan.addRapid(center.x, center.y, null);
                    machinePlan.addLinear(center.x, center.y, targetDepth, plungeRate);
                    machinePlan.addRetract(this.context.machine.travelZ);
                }
                return;
            }

            const finalDepth = purePlan.metadata.cutDepth;
            const toolDiameter = purePlan.metadata.toolDiameter;
            const feedRate = purePlan.metadata.feedRate;
            const plungeRate = purePlan.metadata.plungeRate;

            const requestedPitch = Math.abs(purePlan.metadata.depthPerPass);
            const maxPitchForTool = toolDiameter * 0.5;
            const helixPitch = Math.min(requestedPitch, maxPitchForTool);
            const revolutions = Math.max(2, Math.abs(finalDepth) / helixPitch);
            const segmentsPerRev = 16;
            const totalSegments = Math.ceil(revolutions * segmentsPerRev);

            // Use the correctly transformed entry point as start position
            const startX = purePlan.metadata.entryPoint.x;
            const startY = purePlan.metadata.entryPoint.y;

            // Calculate the starting angle from actual entry point position relative to center
            // This ensures helix traces from wherever the transformed entry point landed
            const startAngle = Math.atan2(startY - center.y, startX - center.x);

            machinePlan.addRapid(startX, startY, null);
            machinePlan.addLinear(startX, startY, 0, plungeRate);

            // Always CW for climb milling (coordinates already transformed)
            const arcCW = true;

            // Negative angleSpan = CW traversal, Positive = CCW
            const angleSpan = revolutions * 2 * Math.PI * (arcCW ? -1 : 1);

            let lastX = startX, lastY = startY;

            for (let i = 1; i <= totalSegments; i++) {
                const ratio = i / totalSegments;
                const angle = startAngle + (ratio * angleSpan);
                const z = ratio * finalDepth;

                const x = center.x + radius * Math.cos(angle);
                const y = center.y + radius * Math.sin(angle);

                const i_val = center.x - lastX;
                const j_val = center.y - lastY;

                machinePlan.addArc(x, y, z, i_val, j_val, arcCW, feedRate);
                lastX = x;
                lastY = y;
            }

            machinePlan.addLinear(lastX, lastY, finalDepth, feedRate);

            // Full circle cleanup pass at final depth
            const i_center = center.x - lastX;
            const j_center = center.y - lastY;
            machinePlan.addArc(lastX, lastY, finalDepth, i_center, j_center, arcCW, feedRate);

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

            // Track the angle dynamically!
            let currentAngle = Math.atan2(
                entryPoint.y - center.y,
                entryPoint.x - center.x
            );

            const initialEntryX = center.x + innerRing.radius * Math.cos(currentAngle);
            const initialEntryY = center.y + innerRing.radius * Math.sin(currentAngle);
            const minHelixDia = this.context.config.entry?.drilling?.minHelixDiameter || 0;
            const useHelix = entryType === 'helix' && (innerRing.radius * 2) >= minHelixDia;

            machinePlan.addRapid(initialEntryX, initialEntryY, this.context.machine.travelZ);
            machinePlan.addRapid(null, null, this.FEED_HEIGHT);
            machinePlan.addLinear(initialEntryX, initialEntryY, 0, plungeRate);

            let currentZ = 0;
            const finalDepth = depthLevels[depthLevels.length - 1];
            if (rings.length === 1 && useHelix) {
                // Update currentAngle with wherever the helix stops
                currentAngle = this._helixDownRing(machinePlan, innerRing, currentAngle, 0, finalDepth, feedRate, toolDiameter);
                this._fullCircleAtDepth(machinePlan, innerRing, currentAngle, finalDepth, feedRate);

            } else {
                for (let d = 0; d < depthLevels.length; d++) {
                    const targetZ = depthLevels[d];
                    if (useHelix) {
                        // Update currentAngle with wherever the helix stops
                        currentAngle = this._helixDownRing(machinePlan, innerRing, currentAngle, currentZ, targetZ, feedRate, toolDiameter);
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
                        this._fullCircleAtDepth(machinePlan, ring, currentAngle, targetZ, feedRate);
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
        _helixDownRing(machinePlan, ring, startAngle, fromZ, toZ, feedRate, toolDiameter) {
            const center = ring.center;
            const radius = ring.radius;

            const deltaZ = Math.abs(toZ - fromZ);
            if (deltaZ < 1e-6) return startAngle; // Already at target

            const requestedPitch = Math.abs(this.context.strategy.depthPerPass);
            const maxPitchForTool = toolDiameter * 0.5;
            const helixPitch = Math.min(requestedPitch, maxPitchForTool);

            // Allow natural float revolutions!
            const revolutions = Math.max(1, deltaZ / helixPitch); 
            const segmentsPerRev = 16;
            const totalSegments = Math.ceil(revolutions * segmentsPerRev);
            const arcCW = true;
            const angleSpan = revolutions * 2 * Math.PI * -1; // -1 for CW

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
        _fullCircleAtDepth(machinePlan, ring, startAngle, depth, feedRate) {
            const center = ring.center;
            const radius = ring.radius;
            const arcCW = true;

            const startX = center.x + radius * Math.cos(startAngle);
            const startY = center.y + radius * Math.sin(startAngle);

            const i_val = center.x - startX;
            const j_val = center.y - startY;

            machinePlan.addArc(startX, startY, depth, i_val, j_val, arcCW, feedRate);
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
            const innerEntry = innerRing.pA;

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
                this._helixDownObround(machinePlan, innerRing, 0, finalDepth, plungeRate, feedRate, toolDiameter);
                this._obroundLoopAtDepth(machinePlan, innerRing, finalDepth, feedRate);

            } else {
                // Multi-ring depth-staged loop
                for (let d = 0; d < depthLevels.length; d++) {
                    const targetZ = depthLevels[d];

                    if (useHelix) {
                        this._helixDownObround(machinePlan, innerRing, currentZ, targetZ, plungeRate, feedRate, toolDiameter);
                    } else {
                        machinePlan.addLinear(innerEntry.x, innerEntry.y, targetZ, plungeRate);
                    }

                    for (let r = 0; r < rings.length; r++) {
                        const ring = rings[r];

                        if (r > 0) {
                            machinePlan.addLinear(ring.pA.x, ring.pA.y, targetZ, feedRate);
                        }

                        this._obroundLoopAtDepth(machinePlan, ring, targetZ, feedRate);
                    }

                    if (rings.length > 1 && d < depthLevels.length - 1) {
                        machinePlan.addLinear(innerEntry.x, innerEntry.y, targetZ, feedRate);
                    }

                    currentZ = targetZ;
                }
            }

            // ── Retract ──
            machinePlan.addRetract(this.context.machine.travelZ);

            this.debug(`Slot Mill Macro: ${machinePlan.commands.length} cmds, ` +
                       `${rings.length} ring(s), ${depthLevels.length} depth(s), ` +
                       `entry=${useHelix ? 'helix' : 'plunge'}`);

            return machinePlan;
        }

        /**
         * Helical descent along an obround ring between two Z levels.
         * Z change is distributed across the two cap arcs; linear segments stay flat.
         */
        _helixDownObround(machinePlan, ring, fromZ, toZ, plungeRate, feedRate, toolDiameter) {
            const deltaZ = Math.abs(toZ - fromZ);
            if (deltaZ < 1e-6) return;

            const pA = ring.pA, pB = ring.pB, pC = ring.pC, pD = ring.pD;
            const startCapCenter = ring.startCapCenter;
            const endCapCenter = ring.endCapCenter;
            const arcCW = true;

            const requestedPitch = Math.abs(this.context.strategy.depthPerPass);
            const helixPitch = Math.min(requestedPitch, toolDiameter * 0.5);
            const depthPerHalfLoop = helixPitch * 0.5;

            let currentZ = fromZ;

            while (currentZ > toZ + 1e-9) {
                // A → D (flat linear at currentZ)
                machinePlan.addLinear(pD.x, pD.y, currentZ, feedRate);

                // D → C (end cap arc, descending)
                let targetZ = Math.max(currentZ - depthPerHalfLoop, toZ);
                const i1 = endCapCenter.x - pD.x;
                const j1 = endCapCenter.y - pD.y;
                machinePlan.addArc(pC.x, pC.y, targetZ, i1, j1, arcCW, feedRate);
                currentZ = targetZ;

                // C → B (flat linear at new currentZ)
                machinePlan.addLinear(pB.x, pB.y, currentZ, feedRate);

                // B → A (start cap arc, descending)
                targetZ = Math.max(currentZ - depthPerHalfLoop, toZ);
                const i2 = startCapCenter.x - pB.x;
                const j2 = startCapCenter.y - pB.y;
                machinePlan.addArc(pA.x, pA.y, targetZ, i2, j2, arcCW, feedRate);
                currentZ = targetZ;
            }
        }

        /**
         * Single full obround cleanup loop at constant depth.
         * CW order: A → D → C(arc) → B → A(arc)
         */
        _obroundLoopAtDepth(machinePlan, ring, depth, feedRate) {
            const pA = ring.pA, pB = ring.pB, pC = ring.pC, pD = ring.pD;
            const startCapCenter = ring.startCapCenter;
            const endCapCenter = ring.endCapCenter;
            const arcCW = true;

            // A → D (straight side)
            machinePlan.addLinear(pD.x, pD.y, depth, feedRate);

            // D → C (end cap arc)
            const i1 = endCapCenter.x - pD.x;
            const j1 = endCapCenter.y - pD.y;
            machinePlan.addArc(pC.x, pC.y, depth, i1, j1, arcCW, feedRate);

            // C → B (straight side)
            machinePlan.addLinear(pB.x, pB.y, depth, feedRate);

            // B → A (start cap arc)
            const i2 = startCapCenter.x - pB.x;
            const j2 = startCapCenter.y - pB.y;
            machinePlan.addArc(pA.x, pA.y, depth, i2, j2, arcCW, feedRate);
        }

        generateSlotHelix(machinePlan, purePlan) {
            const obroundData = purePlan.metadata.obroundData;

            const pA = obroundData.pA;
            const pB = obroundData.pB;
            const pC = obroundData.pC;
            const pD = obroundData.pD;

            // Use transformed centers (these are just for I/J calculation)
            const startCapCenter = obroundData.startCapCenter;
            const endCapCenter = obroundData.endCapCenter;

            const finalDepth = purePlan.metadata.cutDepth;
            const toolDiameter = purePlan.metadata.toolDiameter;
            const feedRate = purePlan.metadata.feedRate;
            const plungeRate = purePlan.metadata.plungeRate;

            // Always CW for climb milling (coordinates already transformed)
            const arcCW = true;

            // Move to Start of Helix Loop (pA)
            machinePlan.addRapid(pA.x, pA.y, null);

            // Feed to Z0
            machinePlan.addLinear(pA.x, pA.y, 0, plungeRate);

            const requestedPitch = Math.abs(purePlan.metadata.depthPerPass);
            const helixPitch = Math.min(requestedPitch, toolDiameter * 0.5);
            const depthPerHalfLoop = helixPitch * 0.5;

            let currentZ = 0;
            let targetZ = 0;

            while (currentZ > finalDepth) {
                // Linear cut along side
                machinePlan.addLinear(pD.x, pD.y, currentZ, feedRate);

                // Cap Arc 1 (End Cap)
                targetZ = Math.max(currentZ - depthPerHalfLoop, finalDepth);
                const i1 = endCapCenter.x - pD.x;
                const j1 = endCapCenter.y - pD.y;
                // Use dynamic arcCW
                machinePlan.addArc(pC.x, pC.y, targetZ, i1, j1, arcCW, feedRate); 
                currentZ = targetZ;

                // Linear cut along other side
                machinePlan.addLinear(pB.x, pB.y, currentZ, feedRate);

                // Cap Arc 2 (Start Cap)
                targetZ = Math.max(currentZ - depthPerHalfLoop, finalDepth);
                const i2 = startCapCenter.x - pB.x;
                const j2 = startCapCenter.y - pB.y;

                // Use dynamic arcCW
                machinePlan.addArc(pA.x, pA.y, targetZ, i2, j2, arcCW, feedRate); 
                currentZ = targetZ;
            }

            // Bottom cleanup pass (Final Depth)
            const i_end = endCapCenter.x - pD.x;
            const j_end = endCapCenter.y - pD.y;
            const i_start = startCapCenter.x - pB.x;
            const j_start = startCapCenter.y - pB.y;

            machinePlan.addLinear(pD.x, pD.y, finalDepth, feedRate);
            machinePlan.addArc(pC.x, pC.y, finalDepth, i_end, j_end, arcCW, feedRate);
            machinePlan.addLinear(pB.x, pB.y, finalDepth, feedRate);
            machinePlan.addArc(pA.x, pA.y, finalDepth, i_start, j_start, arcCW, feedRate);

            machinePlan.addRetract(this.context.machine.travelZ);
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
            // Prefer the Global UI Logger (Sends to Status Panel + Console)
            if (window.pcbcam && window.pcbcam.ui && window.pcbcam.ui.debug) {
                // Pass the tag as part of the message so UI formats it correctly
                window.pcbcam.ui.debug(`[MachineProcessor] ${message}`, data);
                return;
            }
        }
    }

    window.MachineProcessor = MachineProcessor;
})();