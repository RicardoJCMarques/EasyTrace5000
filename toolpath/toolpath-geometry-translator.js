/**
 * @file        toolpath/toolpath-geometry-translator.js
 * @description Translates offset geometry into pure cutting path plans
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
    
    const config = window.PCBCAMConfig;
    const debugConfig = config.debug;
    
    /**
     * Translates offset geometry primitives into pure cutting geometry plans.
     * NO machine moves (RAPID/PLUNGE/RETRACT) - only LINEAR/ARC cutting commands.
     */
    class GeometryTranslator {
        constructor(core) {
            this.core = core;
        }

        /**
         * Main entry point.
         * Accepts an array of {operation, context} pairs from the controller.
         */
        async translateAllOperations(operationContextPairs) {
            const allPlans = [];
            
            for (const { operation, context } of operationContextPairs) {
                if (!context) {
                    console.error(`[Translator] Missing context for operation ${operation.id}`);
                    continue;
                }
                
                // Pass BOTH to translateOperation
                const opPlans = await this.translateOperation(operation, context);
                allPlans.push(...opPlans);
            }

            if (debugConfig.enabled) {
                console.log(`[GeometryTranslator] Translated ${allPlans.length} pure geometry plans`);
            }
            
            return allPlans;
        }

        /**
         * Translates a single operation.
         */
        async translateOperation(operation, ctx) {
            const { operationType, computed } = ctx;
            const depthLevels = computed.depthLevels;
            const plans = [];

            // 2. Handle Drill Operations
            if (operationType === 'drill') {
                const strategyPrimitives = operation.offsets[0]?.primitives || [];
                // Pass the full context to the drill translator
                const drillPlans = this.translateDrillOperation(ctx, strategyPrimitives, depthLevels);
                plans.push(...drillPlans);
                return plans; // Return early for drills
            }

            // 3. Handle Milling Operations (Isolation, Clear, Cutout)
            for (const offset of operation.offsets) {
                // Get the computed offset distance for this specific pass
                const passIndex = (offset.pass || 1) - 1; 
                const offsetDistance = computed.offsetDistances[passIndex] || computed.offsetDistances[0] || 0; 

                for (const primitive of offset.primitives) {
                    // Handle multi-depth
                    for (const depth of depthLevels) {
                        // Create one plan per primitive, per depth level
                        // We pass the full context to your existing createPurePlan
                        const plan = this.createPurePlan(primitive, ctx, depth, offsetDistance);
                        if (plan) {
                            plans.push(plan);
                        }
                    }
                }
            }
            
            return plans;
        }
        
        /**
         * Create a pure cutting geometry plan from a primitive, using the ToolpathContext.
         */
        createPurePlan(primitive, ctx, depth, offsetDistance) {
            // Get all settings from the context
            const { operationId, operationType, tool, cutting, strategy } = ctx;

            const plan = new ToolpathPlan(operationId); // Correct class

            // Set metadata for later machine processing
            plan.metadata.operationId = ctx.operationId;
            plan.metadata.operationType = ctx.operationType;
            // Store only what's NOT in commands themselves
            plan.metadata.cutDepth = depth; // Varies per plan
            plan.metadata.feedRate = cutting.feedRate; // Needed by MachineProcessor
            plan.metadata.plungeRate = cutting.plungeRate; // Needed by MachineProcessor
            plan.metadata.entryType = strategy.entryType; // Needed by MachineProcessor
            plan.metadata.direction = strategy.direction; // Needed by MachineProcessor
            plan.metadata.depthPerPass = strategy.depthPerPass  // Needed by MachineProcessor
            plan.metadata.spindleSpeed = cutting.spindleSpeed; // Needed by GCodeGenerator
            plan.metadata.toolDiameter = tool.diameter; // Needed by Optimizer
            plan.metadata.stepOver = strategy.stepOver; // Needed by Optimizer
            // // Remove: context, tool object, direction, entryType (use context when needed)

            plan.metadata.groupKey = `T:${tool.diameter.toFixed(3)}_OP:${operationType}_Z:${depth.toFixed(3)}`;
            plan.metadata.operationType = operationType;
            plan.metadata.primitiveType = primitive.type;
            
            // For cutouts, check if tabs should be applied
            if (operationType === 'cutout' && strategy.cutout.tabs > 0 && primitive.type === 'path') {
                plan.metadata.hasTabs = true;
                const pathLength = this.calculatePathLength(primitive); // Use existing helper
                plan.metadata.tabPositions = this.calculateTabPositions(primitive, ctx, pathLength); // Pass ctx
            }
            
            this.analyzePrimitive(plan, primitive, depth); // Keep existing helper
            
            plan.metadata.optimization = { // Keep existing logic
                linkType: 'rapid',
                optimizedEntryPoint: plan.metadata.entryPoint,
                entryCommandIndex: 0
            };
            
            this.translatePrimitiveToCutting(plan, primitive, depth, cutting.feedRate); // Keep existing helper
            this.calculatePlanBounds(plan); // Keep existing helper
            
            return plan.commands.length > 0 ? plan : null;
        }
        
        /**
         * Analyze primitive to extract entry/exit points and metadata
         */
        analyzePrimitive(plan, primitive, depth) {
            const metadata = plan.metadata;
            
            if (primitive.type === 'circle') {
                metadata.entryPoint = {
                    x: primitive.center.x + primitive.radius,
                    y: primitive.center.y,
                    z: depth
                };
                metadata.exitPoint = { ...metadata.entryPoint };
                metadata.isClosedLoop = true;
                metadata.isSimpleCircle = true;
                metadata.primitiveType = 'circle';
                metadata.center = primitive.center;
                metadata.radius = primitive.radius;
                
            } else if (primitive.type === 'obround') {
                const slotRadius = Math.min(primitive.width, primitive.height) / 2;
                const isHorizontal = primitive.width > primitive.height;
                
                const startAngle = isHorizontal ? (Math.PI / 2) : Math.PI;
                const centerY = isHorizontal ? (primitive.position.y + primitive.height / 2) : (primitive.position.y + slotRadius);
                const centerX = isHorizontal ? (primitive.position.x + slotRadius) : (primitive.position.x + primitive.width / 2);

                metadata.entryPoint = {
                    x: centerX + slotRadius * Math.cos(startAngle),
                    y: centerY + slotRadius * Math.sin(startAngle),
                    z: depth
                };
                metadata.exitPoint = { ...metadata.entryPoint };
                metadata.isClosedLoop = true;
                metadata.isSimpleCircle = false;
                metadata.primitiveType = 'obround';
                
            } else if (primitive.type === 'arc') {
                metadata.entryPoint = { ...primitive.startPoint, z: depth };
                metadata.exitPoint = { ...primitive.endPoint, z: depth };
                metadata.isClosedLoop = false;
                metadata.primitiveType = 'arc';
                
            } else if (primitive.type === 'path' && primitive.points) {
                metadata.entryPoint = { ...primitive.points[0], z: depth };
                metadata.exitPoint = { ...primitive.points[primitive.points.length - 1], z: depth };
                
                const dist = Math.hypot(
                    metadata.exitPoint.x - metadata.entryPoint.x,
                    metadata.exitPoint.y - metadata.entryPoint.y
                );
                metadata.isClosedLoop = dist < 0.01 || (primitive.closed === true);
                metadata.primitiveType = 'path';
                metadata.hasArcs = primitive.arcSegments && primitive.arcSegments.length > 0;
            }
        }
        
        /**
         * Translate primitive to pure cutting commands
         */
        translatePrimitiveToCutting(plan, primitive, depth, feedRate) {
            const clockwise = plan.metadata.direction === 'conventional';
            
            if (primitive.type === 'circle') {
                this.translateCircle(plan, primitive, depth, feedRate, clockwise);
                
            } else if (primitive.type === 'obround') {
                this.translateObround(plan, primitive, depth, feedRate, clockwise);
                
            } else if (primitive.type === 'arc') {
                this.translateArc(plan, primitive, depth, feedRate);
                
            } else if (primitive.type === 'path') {
                this.translatePath(plan, primitive, depth, feedRate);
            }
        }
        
        /**
         * Translate circle to cutting commands
         */
        translateCircle(plan, primitive, depth, feedRate, clockwise) {
            const center = primitive.center;
            const radius = primitive.radius;
            
            const startX = center.x + radius;
            const startY = center.y;
            
            plan.addArc(startX, startY, depth, -radius, 0, clockwise, feedRate);
        }
        
        /**
         * Translate obround to cutting commands (2 lines, 2 arcs)
         */
        translateObround(plan, primitive, depth, feedRate, clockwise) {
            const slotRadius = Math.min(primitive.width, primitive.height) / 2;
            const isHorizontal = primitive.width > primitive.height;
            
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

            if (clockwise) {
                plan.addLinear(pD_x, pD_y, depth, feedRate);
                plan.addArc(pC_x, pC_y, depth, i2, j2, true, feedRate);
                plan.addLinear(pB_x, pB_y, depth, feedRate);
                plan.addArc(pA_x, pA_y, depth, i1, j1, true, feedRate);
            } else {
                plan.addArc(pB_x, pB_y, depth, i1, j1, false, feedRate);
                plan.addLinear(pC_x, pC_y, depth, feedRate);
                plan.addArc(pD_x, pD_y, depth, i2, j2, false, feedRate);
                plan.addLinear(pA_x, pA_y, depth, feedRate);
            }
        }
        
        /**
         * Translate arc to cutting commands
         */
        translateArc(plan, primitive, depth, feedRate) {
            const i = primitive.center.x - primitive.startPoint.x;
            const j = primitive.center.y - primitive.startPoint.y;
            
            plan.addLinear(primitive.startPoint.x, primitive.startPoint.y, depth, feedRate);
            
            plan.addArc(
                primitive.endPoint.x,
                primitive.endPoint.y,
                depth,
                i, j,
                primitive.clockwise,
                feedRate
            );
        }
        
        /**
         * Translate path to cutting commands
         */
        translatePath(plan, primitive, depth, feedRate) {
            const points = primitive.points;
            if (!points || points.length < 2) return;
            
            const arcSegments = primitive.arcSegments || [];
            const processedArcs = new Set();
            
            for (let i = 0; i < points.length - 1; i++) {
                const arc = arcSegments.find(seg => 
                    seg.startIndex === i && !processedArcs.has(seg)
                );
                
                if (arc) {
                    const startPoint = points[i];
                    const endPoint = points[arc.endIndex];
                    
                    const dist = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);
                    if (dist < 0.001) {
                        processedArcs.add(arc);
                        i = arc.endIndex - 1;
                        continue;
                    }
                    
                    const i_val = arc.center.x - startPoint.x;
                    const j_val = arc.center.y - startPoint.y;
                    
                    plan.addArc(
                        endPoint.x, endPoint.y, depth,
                        i_val, j_val,
                        arc.clockwise,
                        feedRate
                    );
                    
                    processedArcs.add(arc);
                    i = arc.endIndex - 1;
                } else {
                    plan.addLinear(points[i + 1].x, points[i + 1].y, depth, feedRate);
                }
            }
            
            if (primitive.closed && points.length >= 2) {
                const firstPt = points[0];
                const lastPt = points[points.length - 1];
                const distance = Math.hypot(lastPt.x - firstPt.x, lastPt.y - firstPt.y);
                
                if (distance > 0.001) {
                    plan.addLinear(firstPt.x, firstPt.y, depth, feedRate);
                }
            }
        }
        
        /**
         * Handle drill operations specially, reading from context.
         */
        translateDrillOperation(ctx, strategyPrimitives, depthLevels) {
            const plans = [];
            const { operationId, tool, cutting, strategy } = ctx;
            const finalDepth = depthLevels[depthLevels.length - 1];
            
            for (const primitive of strategyPrimitives) {
                const role = primitive.properties?.role;
                
                if (role === 'peck_mark') {
                    const plan = new ToolpathPlan(operationId);
                    plan.metadata.context = ctx;
                    plan.metadata.tool = tool;
                    plan.metadata.cutDepth = finalDepth;
                    plan.metadata.feedRate = cutting.feedRate;
                    plan.metadata.plungeRate = cutting.plungeRate;
                    plan.metadata.spindleSpeed = cutting.spindleSpeed;
                    plan.metadata.isPeckMark = true;
                    plan.metadata.entryPoint = { ...primitive.center, z: finalDepth };
                    plan.metadata.exitPoint = { ...primitive.center, z: finalDepth };
                    plan.metadata.groupKey = `D${tool.diameter.toFixed(3)}`;

                    plan.metadata.peckCycle = {
                        cannedCycle: strategy.drill.cannedCycle || 'none',
                        peckDepth: strategy.drill.peckDepth || 0,
                        dwellTime: strategy.drill.dwellTime || 0,
                        retractHeight: strategy.drill.retractHeight || 0.5
                    };
                    
                    plan.metadata.peckData = {
                        position: primitive.center,
                        ...primitive.properties
                    };
                    
                    plan.metadata.optimization = {
                        linkType: 'rapid',
                        optimizedEntryPoint: plan.metadata.entryPoint,
                        entryCommandIndex: 0
                    };
                    plans.push(plan);
                    
                } else if (role === 'drill_milling_path') {
                    if (strategy.entryType === 'helix') {
                        const plan = this.createPurePlan(primitive, ctx, finalDepth, 0); 
                        if (plan) {
                            plan.metadata.isDrillMilling = true;
                            if (primitive.type === 'obround') {
                               plan.metadata.obroundData = this.getObroundData(primitive);
                            }
                            plans.push(plan);
                        }
                    } else {
                        for (const depth of depthLevels) {
                            const plan = this.createPurePlan(primitive, ctx, depth, 0);
                            if (plan) {
                                plan.metadata.isDrillMilling = true;
                                if (primitive.type === 'obround') {
                                    plan.metadata.obroundData = this.getObroundData(primitive);
                                }
                                plans.push(plan);
                            }
                        }
                    }
                }
            }
            return plans;
        }

        /**
         * Calculate bounds for plan
         */
        calculatePlanBounds(plan) {
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            
            for (const cmd of plan.commands) {
                if (cmd.x !== null) {
                    minX = Math.min(minX, cmd.x);
                    maxX = Math.max(maxX, cmd.x);
                }
                if (cmd.y !== null) {
                    minY = Math.min(minY, cmd.y);
                    maxY = Math.max(maxY, cmd.y);
                }
            }
            
            plan.metadata.boundingBox = { minX, minY, maxX, maxY };
        }
        
        getOperationType(operationId) {
            if (!this.core || !this.core.operations) return 'unknown';
            const op = this.core.operations.find(o => o.id === operationId);
            return op ? op.type : 'unknown';
        }

        /**
         * Calculate tab positions avoiding corners and arcs when possible
         */
        calculateTabPositions(primitive, ctx, pathLength) {
            const { strategy, tool, config } = ctx;
            const params = strategy.cutout;
            
            if (!primitive.points || primitive.points.length < 3 || params.tabs <= 0) return [];

            const tabConfig = config.tabs;
            
            const tabWidth = params.tabWidth;
            const toolDiameter = tool.diameter;
            const cornerMargin = Math.max(
                toolDiameter * tabConfig.cornerMarginFactor, 
                tabWidth
            );
            const minSegmentLength = tabWidth * tabConfig.minTabLengthFactor;

            if (pathLength < cornerMargin * 2) return [];

            const { straight: straightSections } = this.analyzePath(primitive, cornerMargin, minSegmentLength);
            
            if (straightSections.length === 0) {
                 console.warn(`[Translator] No straight sections long enough for tabs.`);
                 return [];
            }

            const idealSpacing = pathLength / params.count;
            const tabPositions = [];
            
            for (let i = 0; i < params.count; i++) {
                const targetLength = (i + 0.5) * idealSpacing;
                let bestSection = null;
                let minDiff = Infinity;
                
                for (const section of straightSections) {
                    if (targetLength >= section.start && targetLength <= section.end) {
                        bestSection = section;
                        break;
                    }
                    const diff = Math.abs(targetLength - section.midpoint);
                    if (diff < minDiff) {
                        minDiff = diff;
                        bestSection = section;
                    }
                }
                if (!bestSection) continue;
                
                const tabDistance = bestSection.midpoint; 
                
                // RE-USE existing 'getPointAtDistance' function
                const pos = this.getPointAtDistance(primitive, tabDistance);
                
                if (pos) {
                    tabPositions.push({
                        position: pos,
                        distance: tabDistance,
                        width: tabWidth,
                        height: params.tabHeight
                    });
                }
            }
            return tabPositions;
        }

        /**
         * Analyze path to find straight and curved sections
         */
        analyzePath(primitive, cornerMargin, minLength) {
            const points = primitive.points;
            const arcSegments = primitive.arcSegments || [];
            const sections = { straight: [], curved: [] };
            let currentDistance = 0;
            
            for (let i = 0; i < points.length; i++) {
                const nextI = (i + 1) % points.length;
                const p1 = points[i];
                const p2 = points[nextI];
                
                const isArc = arcSegments.some(seg => seg.startIndex === i);
                
                if (isArc) {
                    const arc = arcSegments.find(seg => seg.startIndex === i);
                    let sweep = arc.endAngle - arc.startAngle;
                    if (arc.clockwise) {
                        if (sweep > 1e-9) sweep -= 2 * Math.PI; 
                    } else {
                        if (sweep < -1e-9) sweep += 2 * Math.PI;
                    }
                    const startPt = points[arc.startIndex];
                    const endPt = points[arc.endIndex];
                    const dist = Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y);
                    if (dist < 1e-6 && Math.abs(sweep) < 1e-6 && Math.abs(Math.abs(sweep) - 2 * Math.PI) > 1e-6) {
                        sweep = arc.clockwise ? -2 * Math.PI : 2 * Math.PI;
                    }
                    const arcLength = Math.abs(sweep * arc.radius);

                    if (arc.radius > minLength * 2) {
                        const availableLength = arcLength - 2 * cornerMargin;
                        if (availableLength >= minLength) {
                            sections.curved.push({
                                type: 'curved',
                                start: currentDistance + cornerMargin,
                                end: currentDistance + arcLength - cornerMargin,
                                length: availableLength,
                                midpoint: currentDistance + arcLength / 2
                            });
                        }
                    }
                    currentDistance += arcLength;
                } else {
                    const segLength = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                    const prevI = (i - 1 + points.length) % points.length;
                    const prevWasArc = arcSegments.some(seg => seg.endIndex === i);
                    let isCornerAtStart;
                    
                    if (prevWasArc) {
                        isCornerAtStart = true;
                    } else {
                        const p0 = points[prevI];
                        const angle1 = Math.atan2(p1.y - p0.y, p1.x - p0.x);
                        const angle2 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                        let angleDiff = Math.abs(angle2 - angle1);
                        if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
                        isCornerAtStart = angleDiff > (Math.PI / 6);
                    }

                    const nextIsArc = arcSegments.some(seg => seg.startIndex === nextI);
                    const isCornerAtEnd = nextIsArc;
                    
                    const availableStart = isCornerAtStart ? cornerMargin : 0;
                    const availableEnd = segLength - (isCornerAtEnd ? cornerMargin : 0);
                    const availableLength = availableEnd - availableStart;
                    
                    if (availableLength >= minLength) {
                        sections.straight.push({
                            type: 'straight',
                            start: currentDistance + availableStart,
                            end: currentDistance + availableEnd,
                            length: availableLength,
                            midpoint: currentDistance + (availableStart + availableEnd) / 2
                        });
                    }
                    currentDistance += segLength;
                }
            }
            return sections;
        }

        /**
         */
        calculatePathLength(primitive) {
            let length = 0;
            const points = primitive.points;
            if (!points || points.length < 2) return 0;
            
            const arcSegments = primitive.arcSegments || [];
            const processedArcs = new Set();
            
            for (let i = 0; i < points.length - 1; i++) {
                const arc = arcSegments.find(seg => seg.startIndex === i && !processedArcs.has(seg));
                
                if (arc) {
                    const radius = Math.hypot(arc.center.x - points[i].x, arc.center.y - points[i].y);
                    const startAngle = Math.atan2(points[i].y - arc.center.y, points[i].x - arc.center.x);
                    const endAngle = Math.atan2(points[arc.endIndex].y - arc.center.y, points[arc.endIndex].x - arc.center.x);
                    
                    let angle = arc.clockwise ? (startAngle - endAngle) : (endAngle - startAngle);
                    if (angle < 0) angle += 2 * Math.PI;
                    if (angle === 0) angle = 2 * Math.PI;
                    
                    length += radius * angle;
                    processedArcs.add(arc);
                    i = arc.endIndex - 1;
                } else {
                    length += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
                }
            }
            return length;
        }
        
        /**
         * Extracts dimensional data from an obround primitive.
         */
        getObroundData(primitive) {
            if (primitive.type !== 'obround') return null;
            
            const slotRadius = Math.min(primitive.width, primitive.height) / 2;
            const isHorizontal = primitive.width > primitive.height;
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
            return {
                position: primitive.position,
                width: primitive.width,
                height: primitive.height,
                isHorizontal: isHorizontal,
                slotRadius: slotRadius,
                startCapCenter: startCapCenter,
                endCapCenter: endCapCenter
            };
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
            return points[points.length - 1];
        }
    }
    
    window.GeometryTranslator = GeometryTranslator;
})();