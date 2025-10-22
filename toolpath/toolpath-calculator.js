/**
 * @file        toolpath/toolpath-calculator.js
 * @description Complete toolpath calculation engine
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
    
    // Lightweight motion command structure
    class MotionCommand {
        constructor(type, coords, params = {}) {
            this.type = type; // 'RAPID', 'LINEAR', 'ARC_CW', 'ARC_CCW', 'PLUNGE', 'RETRACT', 'DWELL'
            // Only set coordinates that are explicitly provided
            this.x = coords.x !== undefined ? coords.x : null;
            this.y = coords.y !== undefined ? coords.y : null;
            this.z = coords.z !== undefined ? coords.z : null;
            this.f = params.feed;
            
            // Arc parameters (I,J are relative offsets from start)
            if (type === 'ARC_CW' || type === 'ARC_CCW') {
                this.i = params.i;
                this.j = params.j;
            }
            
            // Optional parameters
            if (params.dwell) this.dwell = params.dwell;
            if (params.comment) this.comment = params.comment;
        }
    }
    
    // Toolpath plan container
    class ToolpathPlan {
        constructor(operationId) {
            this.operationId = operationId;
            this.commands = [];
            this.metadata = {
                tool: null,
                estimatedTime: 0,
                boundingBox: null,
                totalDistance: 0,
                depthLevels: []
            };
        }
        
        addCommand(cmd) {
            this.commands.push(cmd);
        }
        
        addRapid(x, y, z) {
            this.commands.push(new MotionCommand('RAPID', {
                x: x !== undefined ? x : null, 
                y: y !== undefined ? y : null, 
                z: z !== undefined ? z : null
            }));
        }
        
        addLinear(x, y, z, feed) {
            this.commands.push(new MotionCommand('LINEAR', {
                x: x !== undefined ? x : null, 
                y: y !== undefined ? y : null, 
                z: z !== undefined ? z : null
            }, { feed: feed }));
        }
        
        addPlunge(z, feed) {
            this.commands.push(new MotionCommand('PLUNGE', {x: null, y: null, z}, {feed}));
        }
        
        addRetract(z) {
            this.commands.push(new MotionCommand('RETRACT', {x: null, y: null, z}));
        }
        
        addArc(x, y, z, i, j, clockwise, feed) {
            const type = clockwise ? 'ARC_CW' : 'ARC_CCW';
            this.commands.push(new MotionCommand(type, {x, y, z}, {i, j, feed}));
        }
        
        addDwell(duration) {
            this.commands.push(new MotionCommand('DWELL', {x: null, y: null, z: null}, {dwell: duration}));
        }
    }
    
    class ToolpathCalculator {
        constructor(core) {
            this.core = core;
            this.currentPosition = {x: 0, y: 0, z: 0};
        }
        
        async calculateToolpath(operation) {
            if (!operation.offsets || operation.offsets.length === 0) {
                throw new Error('No offset geometry to calculate toolpath from');
            }
            
            const plan = new ToolpathPlan(operation.id);
            const settings = operation.settings || {};

            if (!operation.settings) {
                console.error(`[Toolpath] Operation ${operation.id} has no settings!`);
                throw new Error('Operation settings missing');
            }

            console.log(`[Toolpath] Operation ${operation.id} settings:`, operation.settings);
            
            // Extract key parameters
            const params = {
                cutDepth: settings.cutDepth || -1.0,
                depthPerPass: settings.depthPerPass || 0.5,
                multiDepth: settings.multiDepth || false,
                safeZ: settings.safeZ || machineConfig.heights?.safeZ || 5.0,
                travelZ: settings.travelZ || machineConfig.heights?.travelZ || 2.0,
                feedRate: settings.feedRate || 150,
                plungeRate: settings.plungeRate || 50,
                spindleSpeed: settings.spindleSpeed || 12000,
                direction: settings.direction || 'climb',
                entryType: settings.entryType || 'plunge',
                tabs: settings.tabs || 0,
                tabWidth: settings.tabWidth || 3.0,
                tabHeight: settings.tabHeight || 0.5,
                tool: {
                    id: settings.tool || 'unknown',
                    diameter: settings.toolDiameter || 1.0
                },
                
                // Drilling specific
                cannedCycle: settings.cannedCycle || 'none',
                peckDepth: settings.peckDepth || 0,
                dwellTime: settings.dwellTime || 0,
                retractHeight: settings.retractHeight || 0.5
            };
            
            // Calculate depth levels
            const depthLevels = this.calculateDepthLevels(params);
            plan.metadata.depthLevels = depthLevels;
            plan.metadata.tool = params.tool;
            const finalDepth = depthLevels[depthLevels.length - 1]; // Get the final target depth

            // Initial rapid to safe Z
            plan.addRetract(params.safeZ);

            // Process based on operation type BEFORE depth looping
            if (operation.type === 'drill') {
                // Process the entire drill operation once
                this.processDrillOperation(plan, operation, params, depthLevels);
            } else {
                // Original logic for Milling/Cutout (looping through depthLevels)
                if (operation.type === 'cutout') {
                    // Pass depthLevels to cutout processor if it needs them
                    this.processCutoutOperation(plan, operation, params, depthLevels);
                } else {
                    // Loop by depth for standard milling
                    for (const depthLevel of depthLevels) {
                        console.log(`[Toolpath] Processing depth ${depthLevel}`);
                        for (const offsetGroup of operation.offsets) {
                            // ... (existing primitive processing loop remains here) ...
                            const sortedPrimitives = offsetGroup.primitives; // Use sorted if implemented
                             for (let i = 0; i < sortedPrimitives.length; i++) {
                                const primitive = sortedPrimitives[i];
                                // Use processPrimitive for standard milling
                                this.processPrimitive(plan, primitive, depthLevel, params);

                                // Add rapid to next primitive if needed
                                if (i < sortedPrimitives.length - 1) {
                                    const nextPrimitive = sortedPrimitives[i + 1];
                                    const nextEntry = this.getEntryPoint(nextPrimitive);
                                    if (nextEntry) {
                                        plan.addRapid(nextEntry.x, nextEntry.y, params.travelZ);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            
            // Final retract
            plan.addRetract(params.safeZ);
            
            // Calculate metadata
            this.calculateMetadata(plan);
            
            if (debugConfig.enabled) {
                console.log(`[ToolpathCalculator] Generated ${plan.commands.length} commands for operation ${operation.id}`);
            }
            
            return plan;
        }
        
        calculateDepthLevels(params) {
            const levels = [];
            let finalDepth = params.cutDepth || -1.0;
            
            // Ensure depth is negative (below Z=0)
            if (finalDepth > 0) {
                console.warn(`[Toolpath] cutDepth was positive (${finalDepth}), converting to negative`);
                finalDepth = -Math.abs(finalDepth);
            }
            
            if (!params.multiDepth) {
                levels.push(finalDepth);
            } else {
                const depthPerPass = Math.abs(params.depthPerPass || 0.5);
                let currentDepth = 0;
                
                while (currentDepth > finalDepth) {
                    currentDepth -= depthPerPass;
                    if (currentDepth < finalDepth) {
                        currentDepth = finalDepth;
                    }
                    levels.push(currentDepth);
                }
            }
            
            return levels;
        }
        
        processMillingOperation(plan, operation, params, depthLevels) {
            console.log(`[Toolpath] Depth levels:`, depthLevels);
            
            // Loop by depth 
            for (const depthLevel of depthLevels) {
                console.log(`[Toolpath] Processing depth ${depthLevel}`);
                
                // At this depth, cut all offset passes
                for (const offsetGroup of operation.offsets) {
                    console.log(`[Toolpath] Offset group has ${offsetGroup.primitives?.length || 0} primitives`);
                    
                    if (!offsetGroup.primitives || offsetGroup.primitives.length === 0) {
                        console.warn(`[Toolpath] Skipping empty offset group`);
                        continue;
                    }
                    
                    // TODO: Optimize primitive order here (e.g., nearest-neighbor)
                    const sortedPrimitives = offsetGroup.primitives;

                    // Now, process each primitive (contour) as a full job
                    for (let i = 0; i < sortedPrimitives.length; i++) {
                        const primitive = sortedPrimitives[i];
                        this.processPrimitive(plan, primitive, depthLevel, params);
                        
                        // Add safe rapid to next primitive if exists
                        if (i < sortedPrimitives.length - 1) {
                            const nextPrimitive = sortedPrimitives[i + 1];
                            const nextEntry = this.getEntryPoint(nextPrimitive);
                            if (nextEntry) {
                                // Ensure we're at travel Z before rapid
                                // processPrimitive already did retract, but make explicit
                                plan.addRapid(nextEntry.x, nextEntry.y, params.travelZ);
                            }
                        }
                    }
                }
            }
        }
        
        processDrillOperation(plan, operation, params, depthLevels) {
            
            // Get 'finalDepth' (number) from the array
            const finalDepth = depthLevels[depthLevels.length - 1];

            const strategyPrimitives = operation.offsets[0]?.primitives || [];

            for (const primitive of strategyPrimitives) {
                const role = primitive.properties?.role;

                if (role === 'peck_mark') {
                    // Pecking logic needs the final depth
                    // Pass 'finalDepth' (number) to generatePeckCycle
                    this.generatePeckCycle(plan, primitive, params, finalDepth);
                }
                else if (role === 'drill_milling_path') {
                    if (params.entryType === 'helix') {
                        if (primitive.type === 'circle') {
                            // Call generateHelicalMilling ONCE for the full depth
                            this.generateHelicalMilling(plan, primitive, finalDepth, params);
                        } else if (primitive.type === 'obround') {
                            // Delegate to generateHelicalMilling for proper slot helix
                            this.generateHelicalMilling(plan, primitive, finalDepth, params);
                        } else {
                             console.warn(`[Toolpath] Helix entry requested for unsupported drill_milling_path type: ${primitive.type}`);
                             this.processPrimitive(plan, primitive, finalDepth, params);
                        }
                    } else {
                        // Standard milling for the slot/hole (e.g., plunge or ramp entry)
                        // Use the 'depthLevels' array that was passed in
                        if (params.multiDepth) {
                            for (const depth of depthLevels) {
                                this.processPrimitive(plan, primitive, depth, params);
                            }
                        } else {
                            // Single pass at final depth
                             this.processPrimitive(plan, primitive, finalDepth, params);
                        }
                    }
                }
            }
        }

        generateHelicalMilling(plan, primitive, finalDepth, params) {

            // Check if the primitive is an obround (slot) first
            if (primitive.type === 'obround') {
                console.log('[Toolpath] Generating helical slot milling for obround');
                
                const slotRadius = Math.min(primitive.width, primitive.height) / 2;
                const isHorizontal = primitive.width > primitive.height;
                
                // Calculate end cap centers
                let startCapCenter, endCapCenter;
                if (isHorizontal) {
                    const centerY = primitive.position.y + primitive.height / 2;
                    startCapCenter = { x: primitive.position.x + slotRadius, y: centerY };
                    endCapCenter = { x: primitive.position.x + primitive.width - slotRadius, y: centerY };
                } else {
                    const centerX = primitive.position.x + primitive.width / 2;
                    startCapCenter = { x: centerX, y: primitive.position.y + slotRadius };
                    endCapCenter = { x: centerX, y: primitive.position.y + primitive.height - slotRadius };
                }
                
                // Helix parameters
                const requestedPitch = Math.abs(params.depthPerPass || 0.5);
                const maxPitchForTool = (params.tool?.diameter || 0.8) * 0.5;
                const helixPitch = Math.min(requestedPitch, maxPitchForTool);
                const depthPerSemicircle = helixPitch * 0.5;
                const segmentsPerSemicircle = 12;
                const clockwise = params.direction === 'conventional';
                
                // Calculate number of passes needed
                const totalDepth = Math.abs(finalDepth);
                const passesNeeded = Math.ceil(totalDepth / depthPerSemicircle);
                
                // Determine starting point on first semicircle
                let startAngle;
                if (isHorizontal) {
                    startAngle = Math.PI / 2; // Top of left cap
                } else {
                    startAngle = Math.PI; // Left of top cap
                }
                
                const startX = startCapCenter.x + slotRadius * Math.cos(startAngle);
                const startY = startCapCenter.y + slotRadius * Math.sin(startAngle);
                
                // 1. Rapid to start point ON the circle at travel Z
                plan.addRapid(startX, startY, params.travelZ);
                
                // 2. Plunge to Z=0
                plan.addPlunge(0, params.plungeRate);
                
                // 3. Helix alternating between caps
                let currentZ = 0;
                let atStartCap = true;
                let lastX = startX;
                let lastY = startY;
                
                for (let pass = 0; pass < passesNeeded; pass++) {
                    const targetZ = Math.max(currentZ - depthPerSemicircle, finalDepth);
                    const deltaZ = targetZ - currentZ;
                    const capCenter = atStartCap ? startCapCenter : endCapCenter;
                    
                    // Determine arc angles for this cap and direction
                    let arcStartAngle, arcEndAngle;
                    if (isHorizontal) {
                        if (atStartCap) {
                            // Left cap: top to bottom
                            arcStartAngle = Math.PI / 2;
                            arcEndAngle = 3 * Math.PI / 2;
                        } else {
                            // Right cap: bottom to top  
                            arcStartAngle = -Math.PI / 2;
                            arcEndAngle = Math.PI / 2;
                        }
                    } else {
                        if (atStartCap) {
                            // Top cap: left to right
                            arcStartAngle = Math.PI;
                            arcEndAngle = 2 * Math.PI;
                        } else {
                            // Bottom cap: right to left
                            arcStartAngle = 0;
                            arcEndAngle = Math.PI;
                        }
                    }
                    
                    if (clockwise) {
                        const temp = arcStartAngle;
                        arcStartAngle = arcEndAngle;
                        arcEndAngle = temp;
                    }
                    
                    // Generate semicircle with descending Z
                    const angleSpan = arcEndAngle - arcStartAngle;
                    for (let i = 1; i <= segmentsPerSemicircle; i++) {
                        const ratio = i / segmentsPerSemicircle;
                        const angle = arcStartAngle + (angleSpan * ratio);
                        const z = currentZ + (deltaZ * ratio);
                        
                        const x = capCenter.x + slotRadius * Math.cos(angle);
                        const y = capCenter.y + slotRadius * Math.sin(angle);
                        
                        const i_val = capCenter.x - lastX;
                        const j_val = capCenter.y - lastY;
                        
                        plan.addArc(x, y, z, i_val, j_val, clockwise, params.feedRate);
                        
                        lastX = x;
                        lastY = y;
                    }
                    
                    currentZ = targetZ;
                    
                    // Linear move to opposite cap if not done
                    if (currentZ > finalDepth) {
                        atStartCap = !atStartCap; // Toggle state first
                        const nextCenter = atStartCap ? startCapCenter : endCapCenter; // Get the cap we are *moving to*

                        // Determine the start angle of the *next* arc
                        let nextArcStartAngle;
                        if (isHorizontal) {
                            nextArcStartAngle = atStartCap ? (Math.PI / 2) : (-Math.PI / 2); // Top-left or Bottom-right
                        } else {
                            nextArcStartAngle = atStartCap ? Math.PI : 0; // Left-top or Right-bottom
                        }

                        // Apply direction
                        if (clockwise) {
                             if (isHorizontal) {
                                nextArcStartAngle = atStartCap ? (3 * Math.PI / 2) : (Math.PI / 2);
                            } else {
                                nextArcStartAngle = atStartCap ? (2 * Math.PI) : Math.PI;
                            }
                        }

                        // Calculate the precise start point of the next arc
                        const nextArcStartX = nextCenter.x + slotRadius * Math.cos(nextArcStartAngle);
                        const nextArcStartY = nextCenter.y + slotRadius * Math.sin(nextArcStartAngle);

                        // Move linearly to the start of the next arc
                        plan.addLinear(nextArcStartX, nextArcStartY, currentZ, params.feedRate);

                        // Update lastX/lastY to this new position
                        lastX = nextArcStartX;
                        lastY = nextArcStartY;
                        
                        // atStartCap was already toggled
                    }
                }
                
                // 4. Final cleanup pass at full depth
                // Calculate all points for the perimeter
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

                // --- Generate G-code ---
                // The helix loop finished at (lastX, lastY), which is either the start of arc 1 (pA) or the start of arc 2 (pC).                
                // We must determine if (lastX, lastY) is closer to pA or pC to know which order to run the loop.
                const distToA = Math.hypot(lastX - pA_x, lastY - pA_y);
                const distToC = Math.hypot(lastX - pC_x, lastY - pC_y);

                if (distToA < distToC) {
                    // We ended at pA. Run A -> B -> C -> D -> A
                    plan.addArc(pB_x, pB_y, finalDepth, i1, j1, clockwise, params.feedRate); // First semicircle (A -> B)
                    plan.addLinear(pC_x, pC_y, finalDepth, params.feedRate); // Linear move (B -> C)
                    plan.addArc(pD_x, pD_y, finalDepth, i2, j2, clockwise, params.feedRate); // Second semicircle (C -> D)
                    plan.addLinear(pA_x, pA_y, finalDepth, params.feedRate); // Final linear move to close loop (D -> A)
                } else {
                    // We ended at pC. Run C -> D -> A -> B -> C
                    plan.addArc(pD_x, pD_y, finalDepth, i2, j2, clockwise, params.feedRate); // Second semicircle (C -> D)
                    plan.addLinear(pA_x, pA_y, finalDepth, params.feedRate); // Final linear move to close loop (D -> A)
                    plan.addArc(pB_x, pB_y, finalDepth, i1, j1, clockwise, params.feedRate); // First semicircle (A -> B)
                    plan.addLinear(pC_x, pC_y, finalDepth, params.feedRate); // Linear move (B -> C)
                }

                // 5. Retract
                plan.addRetract(params.travelZ);
                
                return;
            }

            if (primitive.type !== 'circle') {
                console.warn('[Toolpath] Helical milling only supported for circles.');
                this.processPrimitive(plan, primitive, finalDepth, params);
                return;
            }

            const pathRadius = primitive.radius;
            const center = primitive.center;
            
            // Helix pitch calculation
            const requestedPitch = Math.abs(params.depthPerPass); // From settings

            // Rule: Pitch can be up to 50% of the tool's diameter.
            // This allows for a much steeper ramp.
            const maxPitchForTool = (params.tool?.diameter) * 0.5;
            const helixPitch = Math.min(requestedPitch, maxPitchForTool);
            
            // Calculate revolutions needed
            const revolutions = Math.abs(finalDepth) / helixPitch;
            
            // Ensure minimum 2 revolutions for smooth entry, even if pitch must be adjusted
            const minRevolutions = 2;
            const actualRevolutions = Math.max(revolutions, minRevolutions);
            
            // Segments per revolution (16 = smooth for most cases)
            const segmentsPerRev = 16;
            const totalSegments = Math.ceil(actualRevolutions * segmentsPerRev);
            
            // Start point on circle (0 degrees)
            const startX = center.x + pathRadius;
            const startY = center.y;

            // 1. Rapid to start point at travel Z
            plan.addRapid(startX, startY, params.travelZ);
            
            // 2. Plunge to Z=0 (top of material) - Almost VERTICAL entry for copper skin
            plan.addPlunge(0, params.plungeRate);

            // 3. Generate helix from Z=0 down to finalDepth
            let lastX = startX, lastY = startY;

            // Determine direction ONCE before the loop
            const clockwise = params.direction === 'conventional';
            const angleSpan = actualRevolutions * 2 * Math.PI;

            for (let i = 1; i <= totalSegments; i++) {
                const ratio = i / totalSegments;

                // Angle must move positive (CCW) or negative (CW) based on the 'clockwise' direction.
                const angle = clockwise ? (-ratio * angleSpan) : (ratio * angleSpan);
                
                const z = ratio * finalDepth;
                
                // The x/y coordinates are now calculated in the correct direction
                const x = center.x + pathRadius * Math.cos(angle);
                const y = center.y + pathRadius * Math.sin(angle);
                
                // I/J are always relative to the center from the *last* point
                const i_val = center.x - lastX;
                const j_val = center.y - lastY;
                
                plan.addArc(x, y, z, i_val, j_val, clockwise, params.feedRate);
                
                lastX = x;
                lastY = y;
            }
            
            // 4. Final cleanup circle at bottom
            // Add a G1 move to the *same position* to force the controller to exit the helical state.
            // Passing 'undefined' for Z omits it from the G-code.
            plan.addLinear(lastX, lastY, undefined, params.feedRate);

            // Calculate I/J relative to the *actual* end of the helix
            const i_val_cleanup = center.x - lastX;
            const j_val_cleanup = center.y - lastY;

            // Command the full circle starting and ending at lastX, lastY
            const clockwise_cleanup = params.direction === 'conventional'; // Keep same direction
            plan.addArc(lastX, lastY, finalDepth, i_val_cleanup, j_val_cleanup, clockwise_cleanup, params.feedRate);

            // 5. Retract
            plan.addRetract(params.travelZ);
        }
        
        generatePeckCycle(plan, primitive, params, finalDepth) {
            const position = primitive.center;
            if (!position) {
                console.error('[ToolpathCalculator] Peck mark has no center point');
                return;
            }
            
            // Rapid to position at travel Z
            plan.addRapid(position.x, position.y, params.travelZ);
            
            if (params.cannedCycle === 'none' || params.peckDepth === 0 || params.peckDepth >= Math.abs(finalDepth)) {
                // Simple drilling (no peck or single peck)
                plan.commands.push(new MotionCommand('PLUNGE', { x: position.x, y: position.y, z: finalDepth }, { feed: params.plungeRate }));
                if (params.dwellTime > 0) plan.addDwell(params.dwellTime);
                plan.addRetract(params.travelZ);
                
            } else {
                let lastCutDepth = 0;
                // Absolute Z plane to retract to for chip clearing
                const retractPlane = params.retractHeight || 0.5;
                // Z-offset above last cut to "rapid" down to
                const rapidDownClearance = 0.1; 

                while (lastCutDepth > finalDepth) {
                    let targetPeckDepth = lastCutDepth - params.peckDepth;
                    if (targetPeckDepth < finalDepth) {
                        targetPeckDepth = finalDepth;
                    }
                    
                    // 1. Rapid down to just above last cut
                    const rapidDownTo = (lastCutDepth === 0) ? rapidDownClearance : (lastCutDepth + rapidDownClearance);

                    // Use addRapid (G0), not addLinear (G1)
                    plan.addRapid(undefined, undefined, rapidDownTo);

                    // 2. Plunge the peck
                    plan.commands.push(new MotionCommand('PLUNGE', { x: position.x, y: position.y, z: targetPeckDepth }, { feed: params.plungeRate }));
                    
                    if (params.dwellTime > 0) {
                        plan.addDwell(params.dwellTime);
                    }

                    lastCutDepth = targetPeckDepth;
                    
                    // 3. Retract for chip clearing (if not at final depth)
                    if (lastCutDepth > finalDepth) {
                        plan.addRetract(retractPlane);
                    }
                }
                
                // 4. Final retract to safe travel height
                plan.addRetract(params.travelZ);
            }
        }
        
        processCutoutOperation(plan, operation, params, depthLevels) {
            // Get tabs from nested settings if needed
            const tabCount = params.tabs || params.operation?.tabs || 0;
            const tabWidth = params.tabWidth || params.operation?.tabWidth || 3.0;
            const tabHeight = params.tabHeight || params.operation?.tabHeight || 0.5;
            
            for (const offsetGroup of operation.offsets) {
                if (!offsetGroup.primitives || offsetGroup.primitives.length === 0) continue;
                
                // Calculate tab positions ONCE per primitive
                const primitiveTabMap = new Map();
                if (tabCount > 0) {
                    for (const primitive of offsetGroup.primitives) {
                        const positions = this.calculateTabPositions(primitive, {
                            ...params,
                            tabs: tabCount,
                            tabWidth: tabWidth,
                            tabHeight: tabHeight
                        });
                        if (positions.length > 0) {
                            primitiveTabMap.set(primitive, positions);
                        }
                    }
                }
                
                // Calculate tab top Z-plane ONCE
                const finalDepth = depthLevels[depthLevels.length - 1];
                // tabHeight is positive, finalDepth is negative.
                const tabTopZ = finalDepth + tabHeight; 

                // Process depth levels
                for (const depthLevel of depthLevels) {
                    
                    for (const primitive of offsetGroup.primitives) {
                        const baseTabPositions = primitiveTabMap.get(primitive) || [];
                        
                        // Check if this depthLevel is at or below the tab's top surface.
                        // Use a small tolerance for floating point errors.
                        const precision = 1e-6;
                        if (baseTabPositions.length > 0 && depthLevel <= (tabTopZ + precision)) {
                            // This pass intersects the tab height.
                            // We must use processPrimitiveWithTabs.
                            this.processPrimitiveWithTabs(plan, primitive, depthLevel, params, baseTabPositions);
                        } else {
                            // This pass is above the tabs.
                            // Cut normally.
                            this.processPrimitive(plan, primitive, depthLevel, params);
                        }
                    }
                }
            }
        }
        
        calculateTabPositions(primitive, params) {
            const positions = [];
            
            if (primitive.type !== 'path' || !primitive.points) return positions;
            
            // Use arc-aware path length
            const totalLength = this.calculatePathLength(primitive);
            if (totalLength < 0.01) return positions;
            
            const spacing = totalLength / params.tabs;
            
            for (let i = 0; i < params.tabs; i++) {
                // Place tabs in the middle of each segment
                const distance = i * spacing + spacing / 2;
                
                // Use arc-aware point finding
                const position = this.getPointAtDistance(primitive, distance);
                
                if (position) {
                    positions.push({
                        start: distance - params.tabWidth / 2,
                        end: distance + params.tabWidth / 2,
                        position: position,
                        height: params.tabHeight
                    });
                }
            }
            
            return positions;
        }
        
        processPrimitive(plan, primitive, depth, params) {
            console.log(`[Toolpath] Processing primitive type: ${primitive.type}`);
            const entryPoint = this.getEntryPoint(primitive);
            
            if (!entryPoint) {
                console.warn(`[Toolpath] Skipping primitive with no valid entry point:`, primitive);
                return; // Stop processing this primitive
            }

            // Move to entry position
            plan.addRapid(entryPoint.x, entryPoint.y, params.travelZ);
            
            // Entry strategy
            if (params.entryType === 'plunge') {
                plan.addPlunge(depth, params.plungeRate);
            } else if (params.entryType === 'ramp') {
                // Plunge to a shallow depth, then ramp while cutting
                const shallowDepth = depth * 0.1; // Start 10% of the way down
                plan.addPlunge(shallowDepth, params.plungeRate);
                
            } else if (params.entryType === 'helix') {
                if (primitive.type === 'circle') {
                    plan.addPlunge(depth, params.plungeRate);
                } else {
                    this.generateHelixEntry(plan, entryPoint, depth, params);
                }
            }
            
            // Process the primitive geometry
            if (primitive.type === 'circle') {
                this.processCircle(plan, primitive, depth, params);
            } else if (primitive.type === 'arc') {
                this.processArc(plan, primitive, depth, params);
            } else if (primitive.type === 'path') {
                this.processPath(plan, primitive, depth, params);
            }
            
            // Retract
            plan.addRetract(params.travelZ);
        }
        
        processPrimitiveWithTabs(plan, primitive, depth, params, tabPositions) {
            if (primitive.type !== 'path' || !primitive.points || primitive.points.length < 2) {
                this.processPrimitive(plan, primitive, depth, params);
                return;
            }

            const points = primitive.points;
            const arcSegments = primitive.arcSegments || [];
            const processedArcs = new Set();
            
            const entryPoint = this.getEntryPoint(primitive);

            // params.cutDepth is the final depth (e.g., -10.0)
            // params.tabHeight is the positive height (e.g., 1.5)
            // tabZ is the absolute Z coordinate of the tab's top surface (e.g., -8.5)
            const tabZ = (params.cutDepth || 0) + (params.tabHeight || 0);

            const precision = this.core?.geometryProcessor?.options?.precision || 0.001;
            
            const sortedTabs = tabPositions.sort((a, b) => a.start - b.start);
            let tabIndex = 0;
            let currentDistance = 0;

            // --- 1. Entry Move ---
            plan.addRapid(entryPoint.x, entryPoint.y, params.travelZ);
            plan.addPlunge(depth, params.plungeRate);
            plan.addLinear(entryPoint.x, entryPoint.y, depth, params.feedRate); // Move to start

            const pathPoints = [...points];
            if (primitive.closed) {
                pathPoints.push(points[0]); // Add closing segment
            }

            // --- 2. Walk the Path ---
            for (let i = 0; i < pathPoints.length - 1; i++) {
                
                const arc = arcSegments.find(seg => seg.startIndex === i && !processedArcs.has(seg));
                
                if (arc) {
                    // --- 2a. PROCESS ARC SEGMENT (Fix) ---
                    const startPoint = points[arc.startIndex];
                    const endPoint = points[arc.endIndex];
                    const i_val = arc.center.x - startPoint.x;
                    const j_val = arc.center.y - startPoint.y;

                    // Calculate a more accurate arc length
                    const radius = Math.hypot(i_val, j_val);
                    const startAngle = Math.atan2(startPoint.y - arc.center.y, startPoint.x - arc.center.x);
                    const endAngle = Math.atan2(endPoint.y - arc.center.y, endPoint.x - arc.center.x);
                    
                    let angle = arc.clockwise ? (startAngle - endAngle) : (endAngle - startAngle);
                    if (angle < 0) angle += 2 * Math.PI;
                    if (angle === 0 && radius > 0.001) angle = 2 * Math.PI; // Full circle
                    
                    const segmentLength = radius * angle;
                    const segmentEndDistance = currentDistance + segmentLength;
                    
                    let tabOnThisArc = false;
                    for (let t = tabIndex; t < sortedTabs.length; t++) {
                        // Check if tab overlaps this segment at all
                        if (sortedTabs[t].start < segmentEndDistance && sortedTabs[t].end > currentDistance) {
                            tabOnThisArc = true;
                            break;
                        }
                    }

                    if (tabOnThisArc) {
                        // Lift, cut arc at tabZ, plunge
                        plan.addLinear(null, null, tabZ, params.plungeRate);
                        plan.addArc(endPoint.x, endPoint.y, tabZ, i_val, j_val, arc.clockwise, params.feedRate);
                        plan.addLinear(null, null, depth, params.plungeRate);
                        
                        // Advance tab index for any tabs we just *fully* passed
                        while(tabIndex < sortedTabs.length && sortedTabs[tabIndex].end < segmentEndDistance) {
                            tabIndex++;
                        }
                    } else {
                        // Cut arc normally at depth
                        plan.addArc(endPoint.x, endPoint.y, depth, i_val, j_val, arc.clockwise, params.feedRate);
                    }
                    
                    processedArcs.add(arc);
                    i = arc.endIndex - 1; // Jump to arc end
                    currentDistance = segmentEndDistance;

                } else {
                    // --- 2b. PROCESS LINEAR SEGMENT ---
                    const p1 = pathPoints[i];
                    const p2 = pathPoints[i + 1];

                    const segmentVec = { x: p2.x - p1.x, y: p2.y - p1.y };
                    const segmentLength = Math.hypot(segmentVec.x, segmentVec.y);

                    // Skip zero-length segments
                    if (segmentLength < precision) continue;
                    
                    const segmentEndDistance = currentDistance + segmentLength;
                    let segmentRatio = 0.0;
                    
                    while (tabIndex < sortedTabs.length && sortedTabs[tabIndex].start < segmentEndDistance) {
                        const tab = sortedTabs[tabIndex];
                        
                        // 1. Cut part of segment BEFORE tab
                        if (tab.start > currentDistance + (segmentLength * segmentRatio)) {
                            const tabStartRatio = (tab.start - currentDistance) / segmentLength;
                            const preTabPoint = {
                                x: p1.x + segmentVec.x * tabStartRatio,
                                y: p1.y + segmentVec.y * tabStartRatio
                            };
                            plan.addLinear(preTabPoint.x, preTabPoint.y, depth, params.feedRate);
                            segmentRatio = tabStartRatio;
                        }

                        // 2. Generate Tab (Lift -> Traverse -> Plunge)
                        const tabEndRatio = Math.min(1.0, (tab.end - currentDistance) / segmentLength);
                        
                        const tabEndPoint = {
                            x: p1.x + segmentVec.x * tabEndRatio,
                            y: p1.y + segmentVec.y * tabEndRatio
                        };

                        plan.addLinear(null, null, tabZ, params.plungeRate); // LIFT
                        plan.addLinear(tabEndPoint.x, tabEndPoint.y, tabZ, params.feedRate); // TRAVERSE
                        plan.addLinear(null, null, depth, params.plungeRate); // PLUNGE
                        
                        segmentRatio = tabEndRatio;
                        
                        if (tab.end < segmentEndDistance) {
                            tabIndex++;
                        } else {
                            break; 
                        }
                    }
                    
                    // 3. Cut remaining part of segment
                    // Use precision check to avoid floating point errors
                    if (1.0 - segmentRatio > precision) {
                        plan.addLinear(p2.x, p2.y, depth, params.feedRate);
                    }
                    currentDistance = segmentEndDistance;
                }
            }
            
            // --- 3. Final Retract ---
            plan.addRetract(params.travelZ);
        }
        
        processCircle(plan, primitive, depth, params) {
            const radius = primitive.radius;
            const center = primitive.center;
            
            // Start at 0 degrees (rightmost point on circle)
            const startX = center.x + radius;
            const startY = center.y;
            
            // Move to start position at depth first
            plan.addLinear(startX, startY, depth, params.feedRate);
            
            // Full circle as G2/G3
            const clockwise = params.direction === 'conventional';
            plan.addArc(startX, startY, depth, -radius, 0, clockwise, params.feedRate);
        }
        
        processArc(plan, primitive, depth, params) {
            
            // Arc move
            const i = primitive.center.x - primitive.startPoint.x;
            const j = primitive.center.y - primitive.startPoint.y;
            
            plan.addArc(
                primitive.endPoint.x,
                primitive.endPoint.y,
                depth,
                i, j,
                primitive.clockwise,
                params.feedRate
            );
        }
        
        processPath(plan, primitive, depth, params) {
            const points = primitive.points;
            if (!points || points.length < 2) return;

            const arcSegments = primitive.arcSegments || [];
            const processedArcs = new Set();
            
            // Explicitly move to first point at depth
            plan.addLinear(points[0].x, points[0].y, depth, params.feedRate);
            
            // Process segments from current position
            for (let i = 0; i < points.length - 1; i++) {
                const arc = arcSegments.find(seg => 
                    seg.startIndex === i && !processedArcs.has(seg)
                );

                if (arc) {
                    // Arc segment
                    const startPoint = points[i];
                    const endPoint = points[arc.endIndex];

                    const dist = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);
                    const precision = this.core?.geometryProcessor?.options?.precision || 0.001;

                    if (dist < precision) {
                        // This is a zero-length arc. Likely a minor geometry bug from straight segmented trace pads.
                        // Do not generate a command for it and jump to the end of it.
                        processedArcs.add(arc);
                        i = arc.endIndex - 1; // Jump to arc end (-1 for loop increment)
                        continue; // Skip the rest of the loop
                    }
                    
                    const i_val = arc.center.x - startPoint.x;
                    const j_val = arc.center.y - startPoint.y;

                    plan.addArc(
                        endPoint.x, endPoint.y, depth,
                        i_val, j_val,
                        arc.clockwise,
                        params.feedRate
                    );

                    processedArcs.add(arc);
                    i = arc.endIndex - 1; // Jump to arc end (-1 for loop increment)
                } else {
                    // Linear segment to next point
                    plan.addLinear(points[i + 1].x, points[i + 1].y, depth, params.feedRate);
                }
            }
            
            // For closed paths, ensure we explicitly close the loop if needed
            if (primitive.closed && points.length >= 2) {
                const firstPt = points[0];
                const lastPt = points[points.length - 1];
                const distance = Math.hypot(lastPt.x - firstPt.x, lastPt.y - firstPt.y);
                
                // If not already closed (distance > precision), close it
                if (distance > 0.001) {
                    plan.addLinear(firstPt.x, firstPt.y, depth, params.feedRate);
                }
            }
        }
        
        generateRampEntry(plan, primitive, targetDepth, params) {
            const entryPoint = this.getEntryPoint(primitive);
            
            if (!entryPoint) {
                plan.addPlunge(targetDepth, params.plungeRate);
                return;
            }
            
            // For paths: ramp ALONG the path, not before it
            if (primitive.type === 'path' && primitive.points && primitive.points.length >= 2) {
                const rampAngle = params.rampAngle || 10;
                const rampSlope = Math.tan(rampAngle * Math.PI / 180);
                const rampLength = Math.abs(targetDepth) / rampSlope;
                
                // Calculate path length we'll need
                let accumulatedLength = 0;
                let rampPoints = [{ ...primitive.points[0], z: 0 }]; // Start at Z0
                
                for (let i = 1; i < primitive.points.length && accumulatedLength < rampLength; i++) {
                    const p1 = primitive.points[i - 1];
                    const p2 = primitive.points[i];
                    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                    
                    if (accumulatedLength + segLen <= rampLength) {
                        // Whole segment is part of ramp
                        accumulatedLength += segLen;
                        const zAtPoint = -(accumulatedLength / rampLength) * Math.abs(targetDepth);
                        rampPoints.push({ x: p2.x, y: p2.y, z: zAtPoint });
                    } else {
                        // Partial segment to reach full depth
                        const remaining = rampLength - accumulatedLength;
                        const ratio = remaining / segLen;
                        const finalX = p1.x + (p2.x - p1.x) * ratio;
                        const finalY = p1.y + (p2.y - p1.y) * ratio;
                        rampPoints.push({ x: finalX, y: finalY, z: targetDepth });
                        break;
                    }
                }
                
                // Move to start at travel Z
                plan.addRapid(rampPoints[0].x, rampPoints[0].y, params.travelZ);
                
                // Plunge to Z0
                plan.addPlunge(0, params.plungeRate);
                
                // Ramp along path
                for (let i = 1; i < rampPoints.length; i++) {
                    plan.addLinear(rampPoints[i].x, rampPoints[i].y, rampPoints[i].z, params.plungeRate);
                }
                
                // Now at full depth somewhere along the path
                // Continue from here - this is the challenge
                return;
            }
            
            // For non-paths, fall back to plunge
            plan.addRapid(entryPoint.x, entryPoint.y, params.travelZ);
            plan.addPlunge(targetDepth, params.plungeRate);
        }
        
        generateHelixEntry(plan, entryPoint, targetDepth, params) {
            // This is a small helix for *entering* a path, not milling a hole.
            const helixRadius = (params.tool?.diameter || 1.0) * 0.4; // 40% of tool diameter
            const helixPitch = 0.5; // mm per revolution
            const revolutions = Math.abs(targetDepth) / helixPitch;
            const steps = Math.ceil(revolutions * 16); // 16 segments per revolution
            
            // Helix *around* the entryPoint
            const startX = entryPoint.x + helixRadius;
            const startY = entryPoint.y;

            // Rapid to ABOVE the start of the helix
            plan.addRapid(startX, startY, params.travelZ);
            plan.addPlunge(0, params.plungeRate); // Plunge to Z0
            
            for (let i = 1; i <= steps; i++) {
                const angle = (i / steps) * revolutions * 2 * Math.PI;
                const z = (i / steps) * targetDepth;
                const x = entryPoint.x + helixRadius * Math.cos(angle);
                const y = entryPoint.y + helixRadius * Math.sin(angle);
                plan.addLinear(x, y, z, params.plungeRate);
            }

            // Final move to the entry point at depth
            plan.addLinear(entryPoint.x, entryPoint.y, targetDepth, params.feedRate);
        }
        
        getEntryPoint(primitive) {
            if (primitive.type === 'circle') {
                return {
                    x: primitive.center.x + primitive.radius,
                    y: primitive.center.y
                };
            } else if (primitive.type === 'arc') {
                return primitive.startPoint;
            } else if (primitive.type === 'path' && primitive.points?.length > 0) {
                return primitive.points[0];
            } else if (primitive.type === 'obround') {
                const slotRadius = Math.min(primitive.width, primitive.height) / 2;
                const isHorizontal = primitive.width > primitive.height;
                
                let startAngle = isHorizontal ? (Math.PI / 2) : Math.PI;
                
                if (isHorizontal) {
                    const centerY = primitive.position.y + primitive.height / 2;
                    const centerX = primitive.position.x + slotRadius;
                    return {
                        x: centerX + slotRadius * Math.cos(startAngle),
                        y: centerY + slotRadius * Math.sin(startAngle)
                    };
                } else {
                    const centerX = primitive.position.x + primitive.width / 2;
                    const centerY = primitive.position.y + slotRadius;
                    return {
                        x: centerX + slotRadius * Math.cos(startAngle),
                        y: centerY + slotRadius * Math.sin(startAngle)
                    };
                }
            }
            return null;
        }
        
        calculatePathLength(primitive) {
            let length = 0;
            const points = primitive.points;
            if (!points || points.length < 2) return 0;

            const arcSegments = primitive.arcSegments || [];
            const processedArcs = new Set();
            
            for (let i = 0; i < points.length - 1; i++) {
                const arc = arcSegments.find(seg => seg.startIndex === i && !processedArcs.has(seg));
                
                if (arc) {
                    // Arc segment
                    const radius = Math.hypot(arc.center.x - points[i].x, arc.center.y - points[i].y);
                    const startAngle = Math.atan2(points[i].y - arc.center.y, points[i].x - arc.center.x);
                    const endAngle = Math.atan2(points[arc.endIndex].y - arc.center.y, points[arc.endIndex].x - arc.center.x);
                    
                    let angle = arc.clockwise ? (startAngle - endAngle) : (endAngle - startAngle);
                    if (angle < 0) angle += 2 * Math.PI;
                    if (angle === 0) angle = 2 * Math.PI; // Full circle
                    
                    length += radius * angle;
                    processedArcs.add(arc);
                    i = arc.endIndex - 1;
                } else {
                    // Linear segment
                    length += Math.hypot(
                        points[i + 1].x - points[i].x,
                        points[i + 1].y - points[i].y
                    );
                }
            }
            return length;
        }
        
        getPointAtDistance(primitive, targetDistance) {
            let currentDistance = 0;
            const points = primitive.points;
            if (!points || points.length < 2) return null;

            const arcSegments = primitive.arcSegments || [];
            const processedArcs = new Set();

            for (let i = 0; i < points.length - 1; i++) {
                const p1 = points[i];
                const arc = arcSegments.find(seg => seg.startIndex === i && !processedArcs.has(seg));
                
                if (arc) {
                    // Arc segment
                    const p2 = points[arc.endIndex];
                    const center = arc.center;
                    const radius = Math.hypot(center.x - p1.x, center.y - p1.y);
                    const startAngle = Math.atan2(p1.y - center.y, p1.x - center.x);
                    const endAngle = Math.atan2(p2.y - center.y, p2.x - center.x);
                    
                    let angle = arc.clockwise ? (startAngle - endAngle) : (endAngle - startAngle);
                    if (angle < 0) angle += 2 * Math.PI;
                    if (angle === 0) angle = 2 * Math.PI;
                    
                    const segmentLength = radius * angle;

                    if (currentDistance + segmentLength >= targetDistance) {
                        const ratio = (targetDistance - currentDistance) / segmentLength;
                        const finalAngle = startAngle + (angle * ratio * (arc.clockwise ? -1 : 1));
                        return {
                            x: center.x + radius * Math.cos(finalAngle),
                            y: center.y + radius * Math.sin(finalAngle)
                        };
                    }
                    currentDistance += segmentLength;
                    processedArcs.add(arc);
                    i = arc.endIndex - 1;

                } else {
                    // Linear segment
                    const p2 = points[i + 1];
                    const segmentLength = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                    
                    if (currentDistance + segmentLength >= targetDistance) {
                        const ratio = (targetDistance - currentDistance) / segmentLength;
                        return {
                            x: p1.x + ratio * (p2.x - p1.x),
                            y: p1.y + ratio * (p2.y - p1.y)
                        };
                    }
                    currentDistance += segmentLength;
                }
            }
            return points[points.length - 1]; // Return last point if distance is out of bounds
        }
        
        calculateMetadata(plan) {
            let totalDistance = 0;
            let totalTime = 0;
            let minX = Infinity, minY = Infinity, minZ = Infinity;
            let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
            
            let lastPosition = {x: 0, y: 0, z: 0};
            
            for (const cmd of plan.commands) {
                // Update bounds
                if (cmd.x !== null) {
                    minX = Math.min(minX, cmd.x);
                    maxX = Math.max(maxX, cmd.x);
                }
                if (cmd.y !== null) {
                    minY = Math.min(minY, cmd.y);
                    maxY = Math.max(maxY, cmd.y);
                }
                if (cmd.z !== null) {
                    minZ = Math.min(minZ, cmd.z);
                    maxZ = Math.max(maxZ, cmd.z);
                }
                
                // Calculate distance and time
                if (cmd.type === 'LINEAR' || cmd.type === 'RAPID') {
                    const distance = Math.sqrt(
                        Math.pow((cmd.x || lastPosition.x) - lastPosition.x, 2) +
                        Math.pow((cmd.y || lastPosition.y) - lastPosition.y, 2) +
                        Math.pow((cmd.z || lastPosition.z) - lastPosition.z, 2)
                    );
                    totalDistance += distance;
                    
                    const feed = cmd.f || (cmd.type === 'RAPID' ? 1000 : 100);
                    totalTime += (distance / feed) * 60; // Convert to seconds
                } else if (cmd.type === 'ARC_CW' || cmd.type === 'ARC_CCW') {
                    // Approximate arc length
                    const radius = Math.hypot(cmd.i, cmd.j);
                    const arcLength = radius * Math.PI; // Approximate as semicircle
                    totalDistance += arcLength;
                    
                    const feed = cmd.f || 100;
                    totalTime += (arcLength / feed) * 60;
                } else if (cmd.type === 'DWELL') {
                    totalTime += cmd.dwell || 0;
                }
                
                // Update position
                if (cmd.x !== null) lastPosition.x = cmd.x;
                if (cmd.y !== null) lastPosition.y = cmd.y;
                if (cmd.z !== null) lastPosition.z = cmd.z;
            }
            
            plan.metadata.totalDistance = totalDistance;
            plan.metadata.estimatedTime = totalTime;
            plan.metadata.boundingBox = {
                minX: isFinite(minX) ? minX : 0,
                minY: isFinite(minY) ? minY : 0,
                minZ: isFinite(minZ) ? minZ : 0,
                maxX: isFinite(maxX) ? maxX : 0,
                maxY: isFinite(maxY) ? maxY : 0,
                maxZ: isFinite(maxZ) ? maxZ : 0
            };
        }
    }
    
    window.ToolpathCalculator = ToolpathCalculator;
    window.MotionCommand = MotionCommand;
    window.ToolpathPlan = ToolpathPlan;
    
})();