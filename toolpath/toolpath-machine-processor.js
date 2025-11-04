/**
 * @file        toolpath/toolpath-machine-processor.js
 * @description Adds machine operations to pure geometry plans
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
    const machineConfig = config.machine || {};
    
    class MachineProcessor {
        constructor(core) {
            this.core = core;
            this.currentPosition = { x: 0, y: 0, z: 0 };
        }
        
        /**
         * Process toolpath plans and add machine moves
         */
        processPlans(toolpathPlans, settings = {}) {
            if (!toolpathPlans || toolpathPlans.length === 0) {
                return [];
            }
            
            this.settings = {
                safeZ: settings.safeZ || machineConfig.heights?.safeZ || 5.0,
                travelZ: settings.travelZ || machineConfig.heights?.travelZ || 2.0,
                plungeRate: settings.plungeRate || 50,
                rapidFeedRate: settings.rapidFeedRate || 1000,
                cannedCycle: settings.cannedCycle || 'none',
                peckDepth: settings.peckDepth || 0,
                dwellTime: settings.dwellTime || 0,
                retractHeight: settings.retractHeight || 0.5,
                tabs: settings.tabs || 0,
                tabWidth: settings.tabWidth,
                tabHeight: settings.tabHeight,
                ...settings
            };
            
            const machineReadyPlans = [];
            // Initialize at safe Z
            this.currentPosition = { x: 0, y: 0, z: this.settings.safeZ };
            
            // Initial safe Z move (if not already there implicitly)
            // It's safer to always add this explicitly.
            const initPlan = new ToolpathPlan('init');
            initPlan.addRapid(null, null, this.settings.safeZ); // Ensure starting at safe Z
            machineReadyPlans.push(initPlan);
            
            for (let i = 0; i < toolpathPlans.length; i++) {
                const plan = toolpathPlans[i];
                const planMetadata = plan.metadata || {}; // Ensure metadata exists
                
                // 1. HANDLE PECK MARKS (Drills)
                if (planMetadata.isPeckMark) {
                    const drillPlan = this.processPeckMark(plan);
                    machineReadyPlans.push(drillPlan);
                    // Update position: After pecking, we are at travel Z above the hole
                    const peckData = planMetadata.peckData;
                    if (peckData && peckData.position) {
                         this.currentPosition = { ...peckData.position, z: this.settings.travelZ };
                    } else {
                         // Fallback if position missing, assume exit point used
                         this.currentPosition = { ...(planMetadata.exitPoint || {x:0, y:0}), z: this.settings.travelZ };
                    }
                    continue; // Go to the next plan
                }
                
                // 2. HANDLE DRILL MILLING (Helical Entry)
                if (planMetadata.isDrillMilling) {
                    const primitiveType = planMetadata.primitiveType;
                    const useHelix = (planMetadata.entryType || 'plunge') === 'helix';
                    
                    if (useHelix && (primitiveType === 'circle' || primitiveType === 'obround')) {
                        const helixPlan = this.generateHelicalDrillMilling(plan);
                        machineReadyPlans.push(helixPlan);
                         // Update position: After helical milling, we retract to travel Z
                        this.currentPosition = { ...(planMetadata.exitPoint || {x:0, y:0}), z: this.settings.travelZ };
                        continue; // Go to the next plan
                    }
                    // Otherwise fall through to standard milling
                }
                
                // 3. FALL-THROUGH: STANDARD MILLING (Isolation, Clear, Cutout, non-helical Drills)
                const linkType = planMetadata.optimization?.linkType || 'rapid';
                
                 // Check if this is a multi-depth step-down from the *previous* plan
                let isMultiDepthPlunge = false;
                if (i > 0 && linkType === 'rapid') { // Only check if we're not a staydown
                    const prevPlan = toolpathPlans[i - 1];
                    const prevMeta = prevPlan.metadata || {};
                    const isSameOp = prevMeta.operationId === planMetadata.operationId;
                    // Make sure cutDepth exists and is numeric before comparing
                    const currentDepth = typeof planMetadata.cutDepth === 'number' ? planMetadata.cutDepth : 0;
                    const prevDepth = typeof prevMeta.cutDepth === 'number' ? prevMeta.cutDepth : 0;
                    const isDeeper = currentDepth < prevDepth;
                    
                    const currentEntry = planMetadata.entryPoint || {x:0, y:0};
                    const prevExit = prevMeta.exitPoint || {x:0, y:0};
                    const isSameXY = Math.hypot(currentEntry.x - prevExit.x, currentEntry.y - prevExit.y) < 0.01;
                    
                    const isCutout = planMetadata.operationType === 'cutout';
                    const sameClosedLoop = planMetadata.isClosedLoop; // prevMeta.isClosedLoop is implied

                    if (isSameOp && isDeeper && (isSameXY || (isCutout && sameClosedLoop)) && !planMetadata.isPeckMark && !planMetadata.isDrillMilling) {
                        isMultiDepthPlunge = true;
                    }
                }

                // Create connection move based on type
                const connectionPlan = new ToolpathPlan('connection');
                
                if (isMultiDepthPlunge) {
                    console.log(`[DEBUG] Multi-depth plunge detected: Z ${this.currentPosition.z.toFixed(3)} → ${planMetadata.entryPoint.z.toFixed(3)}`);
                    // This is a step-down. We are already at the correct XY.
                    // Explicitly command ONLY a Z move to the new depth.
                    connectionPlan.addLinear(
                        null, // Do NOT command X
                        null, // Do NOT command Y
                        planMetadata.entryPoint.z, // Command ONLY Z
                        this.settings.plungeRate // Use plunge rate for Z move
                    );
                    connectionPlan.metadata.type = 'multidepth_plunge';
                    this.currentPosition.z = planMetadata.entryPoint.z; // Z changes here
                } else if (linkType === 'staydown') {
                    // G1 linear move at current cutting depth
                    const cuttingFeed = planMetadata.feedRate;
                    // Move only in XY, Z is already correct from previous plan
                    connectionPlan.addLinear(
                        planMetadata.entryPoint.x,
                        planMetadata.entryPoint.y,
                        undefined, // Keep current Z
                        cuttingFeed
                    );
                    connectionPlan.metadata.type = 'staydown_link';
                    // Current Z remains the cutting depth
                } else { // Default: Rapid move
                    // Retract to travel Z ONLY if currently below it
                    if (this.currentPosition.z < this.settings.travelZ) {
                        connectionPlan.addRapid(null, null, this.settings.travelZ);
                        this.currentPosition.z = this.settings.travelZ;
                    }
                    // Rapid XY move at travel Z
                    connectionPlan.addRapid(planMetadata.entryPoint.x, planMetadata.entryPoint.y, null); // Keep Z at travelZ
                    connectionPlan.metadata.type = 'rapid_link';
                    // Z remains at travelZ after this
                }
                machineReadyPlans.push(connectionPlan);

                // Update XY position after connection move
                this.currentPosition.x = planMetadata.entryPoint.x;
                this.currentPosition.y = planMetadata.entryPoint.y;

                // Add entry move (plunge, ramp) ONLY if it was a standard RAPID link
                // Skip for staydown and multi-depth plunges
                if (linkType === 'rapid' && !isMultiDepthPlunge) {
                    const entryPlan = new ToolpathPlan('entry');
                    const entryType = planMetadata.entryType || 'plunge';
                    this.generateEntryMove(entryPlan, planMetadata, entryType); // This should only change Z
                    machineReadyPlans.push(entryPlan);
                    // Update Z position after entry move
                    this.currentPosition.z = planMetadata.entryPoint.z;
                }
                
                // Add cutting plan (handles tabs internally)
                if (planMetadata.hasTabs && planMetadata.tabPositions && planMetadata.tabPositions.length > 0) {
                    const tabbedPlan = this.processMillingWithTabs(plan);
                    machineReadyPlans.push(tabbedPlan);
                } else {
                    // Push the original plan containing only the cutting moves
                    machineReadyPlans.push(plan);
                }

                // Update position to the exit of the cutting plan
                this.currentPosition.x = planMetadata.exitPoint.x;
                this.currentPosition.y = planMetadata.exitPoint.y;
                // Z is at cutDepth after cutting

                // Add retract (unless next is stay-down OR a multi-depth plunge)
                const isStayDownSource = (
                    i < toolpathPlans.length - 1 &&
                    toolpathPlans[i + 1]?.metadata?.optimization?.linkType === 'staydown'
                );
                
                let isNextMultiDepth = false;
                if (i < toolpathPlans.length - 1) {
                    const nextPlan = toolpathPlans[i + 1];
                    const nextMeta = nextPlan.metadata || {};
                    
                    // Check if same operation
                    const isSameOp = nextMeta.operationId === planMetadata.operationId;
                    
                    // Check if next pass is deeper
                    const currentDepth = typeof planMetadata.cutDepth === 'number' ? planMetadata.cutDepth : 0;
                    const nextDepth = typeof nextMeta.cutDepth === 'number' ? nextMeta.cutDepth : 0;
                    const isDeeper = nextDepth < currentDepth;
                    
                    // Check if same toolpath geometry (XY only, ignore Z)
                    const nextEntry = nextMeta.entryPoint || {x:0, y:0, z:0};
                    const currentExit = planMetadata.exitPoint || {x:0, y:0, z:0};
                    const xyDistance = Math.hypot(nextEntry.x - currentExit.x, nextEntry.y - currentExit.y);
                    const isSameXY = xyDistance < 0.01;
                    
                    // For cutouts, also check if same primitive type
                    const isCutout = planMetadata.operationType === 'cutout';
                    const sameClosedLoop = planMetadata.isClosedLoop && nextMeta.isClosedLoop;
                    
                    // Accept as multi-depth if:
                    // 1. Same operation
                    // 2. Next is deeper
                    // 3. Same XY position OR (for cutouts: same closed loop path)
                    // 4. Not a drill operation
                    if (isSameOp && isDeeper && (isSameXY || (isCutout && sameClosedLoop)) && 
                        !nextMeta.isPeckMark && !nextMeta.isDrillMilling) {
                        isNextMultiDepth = true;
                        
                        if (debugConfig.enabled) {
                            console.log(`[MachineProcessor] Detected multi-depth continuation: ${currentDepth.toFixed(3)} → ${nextDepth.toFixed(3)}mm`);
                        }
                    }
                }

                if (!isStayDownSource && !isNextMultiDepth) {
                    // Retract needed
                    const retractPlan = new ToolpathPlan('retract');
                    // Retract to travel Z
                    retractPlan.addRetract(this.settings.travelZ);
                    machineReadyPlans.push(retractPlan);
                    // Update Z position after retract
                    this.currentPosition.z = this.settings.travelZ;
                } else {
                    // No retract, Z stays at cutDepth for staydown or multi-depth
                    this.currentPosition.z = planMetadata.exitPoint.z;
                }
            } // End main loop
            
            // Final retract to safe Z
            const finalPlan = new ToolpathPlan('final');
            // Only add if not already there
            if (this.currentPosition.z < this.settings.safeZ) {
                 finalPlan.addRetract(this.settings.safeZ);
                 machineReadyPlans.push(finalPlan);
            }
            
            return machineReadyPlans;
        }
        
        /**
         * Generate entry move
         */
        generateEntryMove(plan, planMetadata, entryType) {
            const cutDepth = planMetadata.entryPoint.z;
            const entryPoint = planMetadata.entryPoint;
            
            // Actually respect the entry type setting
            if (entryType === 'helix' && !planMetadata.isSimpleCircle) {
                this.generateHelixEntry(plan, entryPoint, cutDepth);
            } else if (entryType === 'ramp') {
                this.generateRampEntry(plan, planMetadata, cutDepth);
            } else {
                // Default to plunge for everything else including circles
                plan.addPlunge(cutDepth, this.settings.plungeRate);
            }
        }
        
        /**
         * Helix entry for standard milling
         */
        generateHelixEntry(plan, entryPoint, targetDepth) {
            const toolDiameter = this.settings.tool?.diameter || 1.0;
            const helixRadius = toolDiameter * 0.4;
            const helixPitch = 0.5;
            const revolutions = Math.abs(targetDepth) / helixPitch;
            const steps = Math.ceil(revolutions * 16);
            
            plan.addPlunge(0, this.settings.plungeRate);
            
            for (let i = 1; i <= steps; i++) {
                const angle = (i / steps) * revolutions * 2 * Math.PI;
                const z = (i / steps) * targetDepth;
                const x = entryPoint.x + helixRadius * Math.cos(angle);
                const y = entryPoint.y + helixRadius * Math.sin(angle);
                plan.addLinear(x, y, z, this.settings.plungeRate);
            }
            
            plan.addLinear(entryPoint.x, entryPoint.y, targetDepth, this.settings.plungeRate);
        }
        
        /**
         * Ramp entry
         */
        generateRampEntry(plan, purePlan, targetDepth) {
            const rampAngle = this.settings.rampAngle || 10;
            const rampSlope = Math.tan(rampAngle * Math.PI / 180);
            const rampLength = Math.abs(targetDepth) / rampSlope;
            
            const shallowDepth = targetDepth * 0.1;
            plan.addPlunge(shallowDepth, this.settings.plungeRate);
            
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
                        
                        plan.addLinear(cmd.x, cmd.y, finalZ, this.settings.plungeRate);
                        
                        if (finalZ === targetDepth) break;
                    }
                }
            } else {
                plan.addPlunge(targetDepth, this.settings.plungeRate);
            }
        }
        
        /**
         * Process peck mark (ASSUMES at X,Y,travelZ from connection)
         */
        processPeckMark(purePlan) {
            const machinePlan = new ToolpathPlan(purePlan.operationId);
            Object.assign(machinePlan.metadata, purePlan.metadata);
            
            const peckData = purePlan.metadata.peckData;
            const position = peckData.position;
            const finalDepth = purePlan.metadata.cutDepth;
            
            // Connection to position
            machinePlan.addRapid(position.x, position.y, this.settings.travelZ);
            
            if (this.settings.cannedCycle === 'none' || this.settings.peckDepth === 0 ||
                this.settings.peckDepth >= Math.abs(finalDepth)) {
                // Single plunge
                machinePlan.addPlunge(finalDepth, this.settings.plungeRate);
                
                if (this.settings.dwellTime > 0) {
                    machinePlan.addDwell(this.settings.dwellTime);
                }
                machinePlan.addRetract(this.settings.travelZ);
            } else {
                // Multi-peck cycle
                let lastCutDepth = 0;
                const retractPlane = this.settings.retractHeight;
                const rapidDownClearance = 0.1;
                
                while (lastCutDepth > finalDepth) {
                    let targetPeckDepth = lastCutDepth - this.settings.peckDepth;
                    if (targetPeckDepth < finalDepth) {
                        targetPeckDepth = finalDepth;
                    }
                    
                    const rapidDownTo = (lastCutDepth === 0) ? rapidDownClearance : (lastCutDepth + rapidDownClearance);
                    machinePlan.addRapid(undefined, undefined, rapidDownTo);
                    
                    machinePlan.addPlunge(targetPeckDepth, this.settings.plungeRate);
                    
                    if (this.settings.dwellTime > 0) {
                        machinePlan.addDwell(this.settings.dwellTime);
                    }
                    
                    lastCutDepth = targetPeckDepth;
                    
                    if (lastCutDepth > finalDepth) {
                        machinePlan.addRetract(retractPlane);
                    }
                }
                
                machinePlan.addRetract(this.settings.travelZ);
            }
            
            return machinePlan;
        }
        
        /**
         * Generate helical drill milling (ASSUMES at X,Y,travelZ from connection)
         */
        generateHelicalDrillMilling(purePlan) {
            const machinePlan = new ToolpathPlan(purePlan.operationId);
            Object.assign(machinePlan.metadata, purePlan.metadata);
            
            const primitiveType = purePlan.metadata.primitiveType;
            const finalDepth = purePlan.metadata.cutDepth;
            const toolDiameter = purePlan.metadata.tool?.diameter || 0.8;
            const feedRate = purePlan.metadata.feedRate || 150;
            const direction = purePlan.metadata.direction || 'climb';
            const clockwise = direction === 'conventional';
            
            // Add connection to entry point
            const entryPoint = purePlan.metadata.entryPoint;
            machinePlan.addRapid(entryPoint.x, entryPoint.y, this.settings.travelZ);
            
            if (primitiveType === 'obround') {
                this.generateSlotHelix(machinePlan, purePlan, finalDepth, toolDiameter, feedRate, clockwise);
            } else if (primitiveType === 'circle') {
                this.generateCircleHelix(machinePlan, purePlan, finalDepth, toolDiameter, feedRate, clockwise);
            }
            
            return machinePlan;
        }
        
        /**
         * Circle helix
         */
        generateCircleHelix(machinePlan, purePlan, finalDepth, toolDiameter, feedRate, clockwise) {
            const center = purePlan.metadata.center;
            const radius = purePlan.metadata.radius;
            
            if (!center || !radius) {
                console.error('[MachineProcessor] Missing circle center or radius');
                return;
            }
            
            const helixPitch = Math.min(Math.abs(finalDepth / 3), toolDiameter * 0.5);
            const revolutions = Math.max(2, Math.abs(finalDepth) / helixPitch);
            const segmentsPerRev = 16;
            const totalSegments = Math.ceil(revolutions * segmentsPerRev);
            
            const startX = center.x + radius;
            const startY = center.y;
            
            machinePlan.addPlunge(0, this.settings.plungeRate);
            
            let lastX = startX, lastY = startY;
            const angleSpan = revolutions * 2 * Math.PI;
            
            for (let i = 1; i <= totalSegments; i++) {
                const ratio = i / totalSegments;
                const angle = clockwise ? (-ratio * angleSpan) : (ratio * angleSpan);
                const z = ratio * finalDepth;
                
                const x = center.x + radius * Math.cos(angle);
                const y = center.y + radius * Math.sin(angle);
                const i_val = center.x - lastX;
                const j_val = center.y - lastY;
                
                machinePlan.addArc(x, y, z, i_val, j_val, clockwise, feedRate);
                lastX = x;
                lastY = y;
            }
            
            // Cleanup pass
            machinePlan.addLinear(lastX, lastY, undefined, feedRate);
            const i_val = center.x - lastX;
            const j_val = center.y - lastY;
            machinePlan.addArc(lastX, lastY, finalDepth, i_val, j_val, clockwise, feedRate);
            
            machinePlan.addRetract(this.settings.travelZ);
        }
        
        /**
         * Slot helix
         */
        generateSlotHelix(machinePlan, purePlan, finalDepth, toolDiameter, feedRate, clockwise) {
            const obroundData = purePlan.metadata.obroundData;
            if (!obroundData) {
                console.error('[MachineProcessor] Missing obround data - falling back to plunge');
                machinePlan.addPlunge(finalDepth, this.settings.plungeRate);
                // Add the cutting commands from the pure plan
                for (const cmd of purePlan.commands) {
                    machinePlan.commands.push(cmd);
                }
                machinePlan.addRetract(this.settings.travelZ);
                return;
            }
            
            const slotRadius = obroundData.slotRadius;
            const isHorizontal = obroundData.isHorizontal;
            const startCapCenter = obroundData.startCapCenter;
            const endCapCenter = obroundData.endCapCenter;
            
            const requestedPitch = Math.abs(this.settings.depthPerPass || 0.5); // Using fallback, not connected to UI? depthPerPass doesn't exist in this.settings
            const maxPitchForTool = toolDiameter * 0.5;
            const helixPitch = Math.min(requestedPitch, maxPitchForTool);
            const depthPerSemicircle = helixPitch * 0.5;
            const segmentsPerSemicircle = 12;
            
            const totalDepth = Math.abs(finalDepth);
            const passesNeeded = Math.ceil(totalDepth / depthPerSemicircle);
            
            let startAngle = isHorizontal ? (Math.PI / 2) : Math.PI;
            const startX = startCapCenter.x + slotRadius * Math.cos(startAngle);
            const startY = startCapCenter.y + slotRadius * Math.sin(startAngle);
            
            machinePlan.addPlunge(0, this.settings.plungeRate);
            
            let currentZ = 0;
            let atStartCap = true;
            let lastX = startX;
            let lastY = startY;
            
            for (let pass = 0; pass < passesNeeded; pass++) {
                const targetZ = Math.max(currentZ - depthPerSemicircle, finalDepth);
                const deltaZ = targetZ - currentZ;
                const capCenter = atStartCap ? startCapCenter : endCapCenter;
                
                let arcStartAngle, arcEndAngle;
                if (isHorizontal) {
                    if (atStartCap) {
                        arcStartAngle = Math.PI / 2;
                        arcEndAngle = 3 * Math.PI / 2;
                    } else {
                        arcStartAngle = -Math.PI / 2;
                        arcEndAngle = Math.PI / 2;
                    }
                } else {
                    if (atStartCap) {
                        arcStartAngle = Math.PI;
                        arcEndAngle = 2 * Math.PI;
                    } else {
                        arcStartAngle = 0;
                        arcEndAngle = Math.PI;
                    }
                }
                
                if (clockwise) {
                    const temp = arcStartAngle;
                    arcStartAngle = arcEndAngle;
                    arcEndAngle = temp;
                }
                
                const angleSpan = arcEndAngle - arcStartAngle;
                for (let i = 1; i <= segmentsPerSemicircle; i++) {
                    const ratio = i / segmentsPerSemicircle;
                    const angle = arcStartAngle + (angleSpan * ratio);
                    const z = currentZ + (deltaZ * ratio);
                    
                    const x = capCenter.x + slotRadius * Math.cos(angle);
                    const y = capCenter.y + slotRadius * Math.sin(angle);
                    
                    const i_val = capCenter.x - lastX;
                    const j_val = capCenter.y - lastY;
                    
                    machinePlan.addArc(x, y, z, i_val, j_val, clockwise, feedRate);
                    
                    lastX = x;
                    lastY = y;
                }
                
                currentZ = targetZ;
                
                if (currentZ > finalDepth) {
                    atStartCap = !atStartCap;
                    const nextCenter = atStartCap ? startCapCenter : endCapCenter;
                    
                    let nextArcStartAngle;
                    if (isHorizontal) {
                        nextArcStartAngle = atStartCap ? (Math.PI / 2) : (-Math.PI / 2);
                    } else {
                        nextArcStartAngle = atStartCap ? Math.PI : 0;
                    }
                    
                    if (clockwise) {
                        if (isHorizontal) {
                            nextArcStartAngle = atStartCap ? (3 * Math.PI / 2) : (Math.PI / 2);
                        } else {
                            nextArcStartAngle = atStartCap ? (2 * Math.PI) : Math.PI;
                        }
                    }
                    
                    const nextArcStartX = nextCenter.x + slotRadius * Math.cos(nextArcStartAngle);
                    const nextArcStartY = nextCenter.y + slotRadius * Math.sin(nextArcStartAngle);
                    
                    machinePlan.addLinear(nextArcStartX, nextArcStartY, currentZ, feedRate);
                    
                    lastX = nextArcStartX;
                    lastY = nextArcStartY;
                }
            }
            
            // Final cleanup pass at full depth
            // The helix finished at (lastX, lastY) at finalDepth.
            // We must now run the full perimeter starting from the closest "corner" of the obround path.
            
            // Recalculate obround key points from obroundData
            const startAngle1 = isHorizontal ? (Math.PI / 2) : Math.PI;
            const endAngle1 = isHorizontal ? (3 * Math.PI / 2) : (2 * Math.PI);
            const startAngle2 = isHorizontal ? (-Math.PI / 2) : 0;
            const endAngle2 = isHorizontal ? (Math.PI / 2) : Math.PI;
            
            const pA_x = startCapCenter.x + slotRadius * Math.cos(startAngle1);
            const pA_y = startCapCenter.y + slotRadius * Math.sin(startAngle1);
            const pB_x = startCapCenter.x + slotRadius * Math.cos(endAngle1);
            const pB_y = startCapCenter.y + slotRadius * Math.sin(endAngle1);
            const pC_x = endCapCenter.x + slotRadius * Math.cos(startAngle2);
            const pC_y = endCapCenter.y + slotRadius * Math.sin(startAngle2);
            const pD_x = endCapCenter.x + slotRadius * Math.cos(endAngle2);
            const pD_y = endCapCenter.y + slotRadius * Math.sin(endAngle2);

            const i1 = startCapCenter.x - pA_x;
            const j1 = startCapCenter.y - pA_y;
            const i2 = endCapCenter.x - pC_x;
            const j2 = endCapCenter.y - pC_y;

            // Find which point we are closest to
            const distToA = Math.hypot(lastX - pA_x, lastY - pA_y);
            const distToC = Math.hypot(lastX - pC_x, lastY - pC_y);
            
            // Move from helix end point to closest corner
            if (distToA < distToC) {
                machinePlan.addLinear(pA_x, pA_y, finalDepth, feedRate);
            } else {
                machinePlan.addLinear(pC_x, pC_y, finalDepth, feedRate);
            }

            // Run the perimeter loop, respecting the clockwise flag
            if (clockwise) {
                if (distToA < distToC) {
                    // We are at pA. Run A -> D -> C -> B -> A
                    machinePlan.addLinear(pD_x, pD_y, finalDepth, feedRate);
                    machinePlan.addArc(pC_x, pC_y, finalDepth, i2, j2, true, feedRate);
                    machinePlan.addLinear(pB_x, pB_y, finalDepth, feedRate);
                    machinePlan.addArc(pA_x, pA_y, finalDepth, i1, j1, true, feedRate);
                } else {
                    // We are at pC. Run C -> B -> A -> D -> C
                    machinePlan.addLinear(pB_x, pB_y, finalDepth, feedRate);
                    machinePlan.addArc(pA_x, pA_y, finalDepth, i1, j1, true, feedRate);
                    machinePlan.addLinear(pD_x, pD_y, finalDepth, feedRate);
                    machinePlan.addArc(pC_x, pC_y, finalDepth, i2, j2, true, feedRate);
                }
            } else {
                // Counter-Clockwise (climb)
                if (distToA < distToC) {
                    // We are at pA. Run A -> B -> C -> D -> A
                    machinePlan.addArc(pB_x, pB_y, finalDepth, i1, j1, false, feedRate);
                    machinePlan.addLinear(pC_x, pC_y, finalDepth, feedRate);
                    machinePlan.addArc(pD_x, pD_y, finalDepth, i2, j2, false, feedRate);
                    machinePlan.addLinear(pA_x, pA_y, finalDepth, feedRate);
                } else {
                    // We are at pC. Run C -> D -> A -> B -> C
                    machinePlan.addArc(pD_x, pD_y, finalDepth, i2, j2, false, feedRate);
                    machinePlan.addLinear(pA_x, pA_y, finalDepth, feedRate);
                    machinePlan.addArc(pB_x, pB_y, finalDepth, i1, j1, false, feedRate);
                    machinePlan.addLinear(pC_x, pC_y, finalDepth, feedRate);
                }
            }

            machinePlan.addRetract(this.settings.travelZ);
        }
        
        /**
         * Process milling with tabs
         */
        processMillingWithTabs(purePlan) {
            const machinePlan = new ToolpathPlan(purePlan.operationId);
            Object.assign(machinePlan.metadata, JSON.parse(JSON.stringify(purePlan.metadata)));
            
            const cutDepth = purePlan.metadata.cutDepth;
            const tabPositions = purePlan.metadata.tabPositions || [];
            const tabHeight = purePlan.metadata.tabHeight || this.settings.tabHeight;
            const tabTopZ = -tabHeight;
            const needsLift = cutDepth < tabTopZ;
            const tabZ = needsLift ? tabTopZ : cutDepth;
            
            if (!needsLift) {
                console.log(`[DEBUG Tabs] Pass at ${cutDepth.toFixed(3)}mm already above tab (${tabTopZ.toFixed(3)}mm), no lift needed`);
            }
            
            const feedRate = purePlan.metadata.feedRate;
            const sortedTabs = tabPositions.sort((a, b) => a.start - b.start);
            
            let tabIndex = 0;
            let currentDistance = 0;
            
            const commands = purePlan.commands;
            const entryPoint = purePlan.metadata.optimization?.optimizedEntryPoint || purePlan.metadata.entryPoint || { x: commands[0]?.x || 0, y: commands[0]?.y || 0 };
            
            // Track position for distance calculation
            let currentPos = { x: entryPoint.x, y: entryPoint.y, z: entryPoint.z };
            
            console.log(`[DEBUG Tabs] Processing ${commands.length} commands for tabs. Entry: (${entryPoint.x.toFixed(3)}, ${entryPoint.y.toFixed(3)}). ${sortedTabs.length} target tabs.`);
            
            for (let i = 0; i < commands.length; i++) {
                const cmd = commands[i];
                if (!needsLift) {
                    machinePlan.addCommand(cmd);
                    // Update position tracking
                    if (cmd.x !== null && cmd.x !== undefined) currentPos.x = cmd.x;
                    if (cmd.y !== null && cmd.y !== undefined) currentPos.y = cmd.y;
                    if (cmd.z !== null && cmd.z !== undefined) currentPos.z = cmd.z;
                    continue;  // Skip to next command
                }
                // Determine the correct previous position for distance calculation
                const prevCmdPos = i === 0 ? entryPoint : { x: commands[i-1].x, y: commands[i-1].y };
                console.log(`[DEBUG Tabs] Command ${i}: ${cmd.type} to (${cmd.x?.toFixed(3)}, ${cmd.y?.toFixed(3)}). Current path dist: ${currentDistance.toFixed(3)}`);

                let segmentLength = 0;
                if (cmd.type === 'LINEAR') {
                    // Calculate segment length only if coords are present
                    if (cmd.x !== null && cmd.y !== null) {
                        segmentLength = Math.hypot(cmd.x - prevCmdPos.x, cmd.y - prevCmdPos.y);
                    } else {
                        segmentLength = 0; // Cannot calculate length if coords missing
                        console.warn(`[DEBUG Tabs] Linear command ${i} missing coordinates, length assumed 0.`);
                    }
                } else if (cmd.type === 'ARC_CW' || cmd.type === 'ARC_CCW') {
                    const radius = Math.hypot(cmd.i || 0, cmd.j || 0); // Use || 0 for safety
                    if (radius > 1e-6) {
                        const centerX = prevCmdPos.x + (cmd.i || 0);
                        const centerY = prevCmdPos.y + (cmd.j || 0);
                        
                        const startAngle = Math.atan2(prevCmdPos.y - centerY, prevCmdPos.x - centerX);
                        // Use cmd.x/y if available, otherwise assume full circle end=start
                        const endX = (cmd.x !== null) ? cmd.x : prevCmdPos.x;
                        const endY = (cmd.y !== null) ? cmd.y : prevCmdPos.y;
                        const endAngle = Math.atan2(endY - centerY, endX - centerX);
                        
                        let sweep = endAngle - startAngle;
                        // Normalize sweep based on direction
                        if (cmd.type === 'ARC_CW') {
                            if (sweep >= 1e-9) sweep -= 2 * Math.PI; // Go negative
                        } else { // ARC_CCW
                            if (sweep <= -1e-9) sweep += 2 * Math.PI; // Go positive
                        }
                        
                        // Handle potential full circle if start/end points are identical
                        const dist = Math.hypot(endX - prevCmdPos.x, endY - prevCmdPos.y);
                        if (dist < 1e-6 && Math.abs(Math.abs(sweep) - 2 * Math.PI) > 1e-6 && Math.abs(sweep) < 1e-6 ) {
                            // Points match, but sweep is near zero - force full circle
                            sweep = (cmd.type === 'ARC_CW') ? -2 * Math.PI : 2 * Math.PI;
                            console.log(`[DEBUG Tabs]   Forcing full circle sweep for command ${i}`);
                        }

                        segmentLength = Math.abs(sweep) * radius;
                    } else {
                        segmentLength = 0; // Invalid arc (zero radius)
                        console.warn(`[DEBUG Tabs] Arc command ${i} has zero radius, length assumed 0.`);
                    }
                }
                console.log(`[DEBUG Tabs]   Segment length calculated: ${segmentLength.toFixed(3)}`);
                
                const segmentStartDistance = currentDistance; // Store for clarity
                const segmentEndDistance = currentDistance + segmentLength;
                
                let processingTab = false; // Flag to track if we are currently inside a tab region
                let nextCommandIndex = i + 1; // Where to jump to after handling tabs in this segment

                // Check all tabs that *could* overlap this segment
                for (let t = tabIndex; t < sortedTabs.length; t++) {
                     const tab = sortedTabs[t];
                     // Check for overlap: tab starts before segment ends AND tab ends after segment starts
                     const overlaps = tab.start < segmentEndDistance && tab.end > segmentStartDistance;

                     if (overlaps) {
                          console.log(`[DEBUG Tabs]   >> Potential Overlap << Tab ${t} (${tab.start.toFixed(3)}-${tab.end.toFixed(3)}) with segment (${segmentStartDistance.toFixed(3)}-${segmentEndDistance.toFixed(3)})`);

                          // Complex Tab Handling Logic
                          // Scenario 1: Tab starts *before* this segment
                          if (tab.start <= segmentStartDistance) {
                               console.log(`[DEBUG Tabs]     Scenario 1: Tab started before this segment.`);
                               processingTab = true; // We are definitely inside the tab now

                               // Scenario 1a: Tab also ends *within* or *at the end* of this segment
                               if (tab.end <= segmentEndDistance) {
                                    console.log(`[DEBUG Tabs]       Scenario 1a: Tab ends within segment at ${tab.end.toFixed(3)}.`);
                                    // Cut AT TAB HEIGHT until the tab ends
                                    const tabEndPos = this._getPointAlongSegment(prevCmdPos, cmd, tab.end - segmentStartDistance);
                                    if(tabEndPos) {
                                        const tabCmdPartial = this._createPartialCommand(cmd, prevCmdPos, tabEndPos, tabZ, feedRate);
                                        machinePlan.addCommand(tabCmdPartial);
                                    } else { machinePlan.addCommand({ ...cmd, z: tabZ, f: cmd.f || feedRate }); } // Fallback: full seg at tab Z

                                    // Plunge back down
                                    machinePlan.addLinear(null, null, cutDepth, this.settings.plungeRate);
                                    processingTab = false; // Exited tab region

                                    // Cut at CUT DEPTH from tab end to segment end
                                    const cutCmdPartial = this._createPartialCommand(cmd, tabEndPos || prevCmdPos, {x: cmd.x, y: cmd.y}, cutDepth, feedRate);
                                    if(cutCmdPartial) machinePlan.addCommand(cutCmdPartial);

                                    tabIndex = t + 1; // Move to the next tab
                                    currentDistance = segmentEndDistance; // Update distance
                                    i = nextCommandIndex -1; // Ensure loop continues correctly
                                    break; // Finished processing this segment and tab
                               }
                               // Scenario 1b: Tab ends *after* this segment
                               else {
                                    console.log(`[DEBUG Tabs]       Scenario 1b: Tab continues past segment end.`);
                                    // Cut the ENTIRE segment AT TAB HEIGHT
                                    machinePlan.addCommand({ ...cmd, z: tabZ, f: cmd.f || feedRate });
                                    // We are still inside the tab, tabIndex doesn't advance
                                    currentDistance = segmentEndDistance; // Update distance
                                    i = nextCommandIndex - 1; // Ensure loop continues correctly
                                    break; // Finished processing this segment, still in tab
                               }
                          }
                          // Scenario 2: Tab starts *within* this segment
                          else { // tab.start > segmentStartDistance
                               console.log(`[DEBUG Tabs]     Scenario 2: Tab starts within segment at ${tab.start.toFixed(3)}.`);
                               // Cut at CUT DEPTH until the tab starts
                               const tabStartPos = this._getPointAlongSegment(prevCmdPos, cmd, tab.start - segmentStartDistance);
                               if (tabStartPos) {
                                   const cutCmdPartial = this._createPartialCommand(cmd, prevCmdPos, tabStartPos, cutDepth, feedRate);
                                   if(cutCmdPartial) machinePlan.addCommand(cutCmdPartial);
                               } else { /* Should not happen if overlap detected */ }

                               // Lift Z
                               machinePlan.addLinear(null, null, tabZ, this.settings.plungeRate);
                               processingTab = true; // Entered tab region

                               // Scenario 2a: Tab also ends *within* or *at the end* of this segment
                               if (tab.end <= segmentEndDistance) {
                                    console.log(`[DEBUG Tabs]       Scenario 2a: Tab also ends within segment at ${tab.end.toFixed(3)}.`);
                                     // Cut AT TAB HEIGHT from tab start to tab end
                                    const tabEndPos = this._getPointAlongSegment(prevCmdPos, cmd, tab.end - segmentStartDistance);
                                    if(tabStartPos && tabEndPos) {
                                        const tabCmdPartial = this._createPartialCommand(cmd, tabStartPos, tabEndPos, tabZ, feedRate);
                                        machinePlan.addCommand(tabCmdPartial);
                                    } else { /* Error case */ }

                                    // Plunge back down
                                    machinePlan.addLinear(null, null, cutDepth, this.settings.plungeRate);
                                    processingTab = false; // Exited tab region

                                    // Cut at CUT DEPTH from tab end to segment end
                                    const cutCmdPartial2 = this._createPartialCommand(cmd, tabEndPos || tabStartPos, {x: cmd.x, y: cmd.y}, cutDepth, feedRate);
                                     if(cutCmdPartial2) machinePlan.addCommand(cutCmdPartial2);

                                    tabIndex = t + 1; // Move to the next tab
                                    currentDistance = segmentEndDistance; // Update distance
                                    i = nextCommandIndex - 1; // Ensure loop continues correctly
                                    break; // Finished processing this segment and tab
                               }
                               // Scenario 2b: Tab ends *after* this segment
                               else {
                                    console.log(`[DEBUG Tabs]       Scenario 2b: Tab continues past segment end.`);
                                    // Cut AT TAB HEIGHT from tab start to the end of the segment
                                    const tabCmdPartial = this._createPartialCommand(cmd, tabStartPos || prevCmdPos, {x: cmd.x, y: cmd.y}, tabZ, feedRate);
                                    if(tabCmdPartial) machinePlan.addCommand(tabCmdPartial);

                                    // We are still inside the tab, tabIndex doesn't advance
                                    currentDistance = segmentEndDistance; // Update distance
                                    i = nextCommandIndex - 1; // Ensure loop continues correctly
                                    break; // Finished processing this segment, still in tab
                               }
                          }
                     } // End if(overlaps)
                } // End for loop through tabs

                // If no tab overlapped this segment after checking all relevant tabs
                if (!processingTab && tabIndex >= sortedTabs.length || !sortedTabs.slice(tabIndex).some(tab => tab.start < segmentEndDistance && tab.end > segmentStartDistance)) {
                      console.log(`[DEBUG Tabs]   No tab overlap.`);
                     machinePlan.addCommand(cmd); // Add original command at cutDepth
                     currentDistance = segmentEndDistance; // Update distance normally
                }
                // If we broke out of the tab loop because a tab was processed, currentDistance/i are already updated.

            } // End for loop through commands
            
            return machinePlan;
        }

       // Helper to find a point along a line or arc segment
       _getPointAlongSegment(startPos, cmd, distanceAlong) {
           if (distanceAlong < 1e-6) return startPos;

           if (cmd.type === 'LINEAR') {
               const dx = cmd.x - startPos.x;
               const dy = cmd.y - startPos.y;
               const len = Math.hypot(dx, dy);
               if (len < 1e-6) return startPos;
               const ratio = Math.min(1.0, distanceAlong / len); // Clamp ratio
               return { x: startPos.x + dx * ratio, y: startPos.y + dy * ratio };
           } else if (cmd.type === 'ARC_CW' || cmd.type === 'ARC_CCW') {
               const radius = Math.hypot(cmd.i || 0, cmd.j || 0);
               if (radius < 1e-6) return startPos; // Invalid arc
               const centerX = startPos.x + (cmd.i || 0);
               const centerY = startPos.y + (cmd.j || 0);
               const startAngle = Math.atan2(startPos.y - centerY, startPos.x - centerX);
               
               // Calculate full segment sweep angle correctly
               const endX = (cmd.x !== null) ? cmd.x : startPos.x;
               const endY = (cmd.y !== null) ? cmd.y : startPos.y;
               const endAngle = Math.atan2(endY - centerY, endX - centerX);
               let sweep = endAngle - startAngle;
               if (cmd.type === 'ARC_CW') { if (sweep >= 1e-9) sweep -= 2 * Math.PI; } 
               else { if (sweep <= -1e-9) sweep += 2 * Math.PI; }
               const dist = Math.hypot(endX - startPos.x, endY - startPos.y);
               if (dist < 1e-6 && Math.abs(Math.abs(sweep) - 2 * Math.PI) > 1e-6 && Math.abs(sweep) < 1e-6 ) {
                   sweep = (cmd.type === 'ARC_CW') ? -2 * Math.PI : 2 * Math.PI;
               }
               const segmentLength = Math.abs(sweep * radius);
               if (segmentLength < 1e-6) return startPos;

               const ratio = Math.min(1.0, distanceAlong / segmentLength); // Clamp ratio
               const angle = startAngle + sweep * ratio;
               return { x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) };
           }
           return null; // Unknown command type
       }

        // Helper to create a partial linear or arc command between two points
        _createPartialCommand(originalCmd, startPos, endPos, z, feedRate) {
            if (!startPos || !endPos) return null;
            const dist = Math.hypot(endPos.x - startPos.x, endPos.y - startPos.y);
            if (dist < 1e-6) return null; // Ignore zero-length segments

            if (originalCmd.type === 'LINEAR') {
                return new MotionCommand('LINEAR', { x: endPos.x, y: endPos.y, z: z }, { feed: feedRate });
            } else if (originalCmd.type === 'ARC_CW' || originalCmd.type === 'ARC_CCW') {
                // For arcs, need to recalculate I, J relative to the *new* startPos
                const radius = Math.hypot(originalCmd.i || 0, originalCmd.j || 0);
                 if (radius < 1e-6) return null; // Invalid arc
                const centerX = startPos.x + (originalCmd.i || 0); // Center relative to original start
                const centerY = startPos.y + (originalCmd.j || 0);
                const i_new = centerX - startPos.x; // New I relative to actual startPos
                const j_new = centerY - startPos.y; // New J relative to actual startPos
                return new MotionCommand(originalCmd.type, { x: endPos.x, y: endPos.y, z: z }, { i: i_new, j: j_new, feed: feedRate });
            }
            return null; // Unknown type
        }
        
        /**
         * Estimate machine time
         */
        estimateMachineTime(plans) {
            let totalTime = 0;
            let lastPos = { x: 0, y: 0, z: 0 };
            
            for (const plan of plans) {
                for (const cmd of plan.commands) {
                    let nextPos = { ...lastPos };
                    if (cmd.x !== null) nextPos.x = cmd.x;
                    if (cmd.y !== null) nextPos.y = cmd.y;
                    if (cmd.z !== null) nextPos.z = cmd.z;
                    
                    const dist = Math.hypot(nextPos.x - lastPos.x, nextPos.y - lastPos.y, nextPos.z - lastPos.z);
                    
                    let feed = 100;
                    if (cmd.type === 'RAPID' || cmd.type === 'RETRACT') {
                        feed = 1000;
                    } else if (cmd.f) {
                        feed = cmd.f;
                    }
                    
                    if (dist > 0 && feed > 0) {
                        totalTime += (dist / feed) * 60;
                    }
                    
                    if (cmd.type === 'DWELL') {
                        totalTime += cmd.dwell || 0;
                    }
                    
                    lastPos = nextPos;
                }
            }
            
            return totalTime;
        }
    }
    
    window.MachineProcessor = MachineProcessor;
})();