/**
 * @file        toolpath/toolpath-geometry-translator.js
 * @description Translates offset geometry into pure cutting path plans (no machine moves)
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
    
    /**
     * Translates offset geometry primitives into pure cutting geometry plans.
     * NO machine moves (RAPID/PLUNGE/RETRACT) - only LINEAR/ARC cutting commands.
     */
    class GeometryTranslator {
        constructor(core) {
            this.core = core;
        }
        
        /**
         * Main translation entry point
         * @param {Array} operations - Operations with offset geometry
         * @returns {Array} Array of pure geometry plans
         */
        async translateAllOperations(operations) {
            const allPlans = [];
            
            for (const operation of operations) {
                if (!operation.offsets || operation.offsets.length === 0) {
                    continue;
                }
                
                const opPlans = await this.translateOperation(operation);
                allPlans.push(...opPlans);
            }
            
            if (debugConfig.enabled) {
                console.log(`[GeometryTranslator] Translated ${allPlans.length} pure geometry plans`);
            }
            
            return allPlans;
        }
        
        /**
         * Translate a single operation's offset geometry
         */
        async translateOperation(operation) {
            const plans = [];
            const settings = operation.settings || {};
            
            // Extract parameters for metadata
            const params = {
                cutDepth: settings.cutDepth || -1.8,
                depthPerPass: settings.depthPerPass || 0.4,
                multiDepth: settings.multiDepth || true,
                feedRate: settings.feedRate || 150,
                direction: settings.direction || 'climb',
                entryType: settings.entryType || 'plunge',
                tabs: settings.tabs, // Will be undefined if not cutout, that's OK
                tabWidth: settings.tabWidth,
                tabHeight: settings.tabHeight,
                tool: {
                    id: settings.tool?.id || settings.tool || 'unknown', // Handle old/new format
                    diameter: settings.toolDiameter || settings.tool?.diameter
                }
            };
            
            // Calculate depth levels
            const depthLevels = this.calculateDepthLevels(params);
            
            // Special handling for drill operations
            if (operation.type === 'drill') {
                return this.translateDrillOperation(operation, params, depthLevels);
            }
            
            // Standard milling operations
            for (const offsetGroup of operation.offsets) {
                for (const primitive of offsetGroup.primitives) {
                    // Create one plan per primitive per depth level
                    for (const depth of depthLevels) {
                        const plan = this.createPurePlan(operation.id, primitive, depth, params);
                        if (plan) {
                            plans.push(plan);
                        }
                    }
                }
            }
            
            return plans;
        }
        
        /**
         * Create a pure cutting geometry plan from a primitive
         */
        createPurePlan(operationId, primitive, depth, params) {
            const plan = new ToolpathPlan(operationId);
            
            // Set metadata for later machine processing
            plan.metadata.tool = params.tool;
            plan.metadata.cutDepth = depth;
            plan.metadata.feedRate = params.feedRate;
            plan.metadata.direction = params.direction;
            plan.metadata.entryType = params.entryType;
            const opType = this.getOperationType(operationId);
            plan.metadata.groupKey = `T:${params.tool.diameter.toFixed(3)}_OP:${opType}`;

            // Add operation-specific metadata
            plan.metadata.operationType = this.getOperationType(operationId);
            plan.metadata.primitiveType = primitive.type;
            
            // For cutouts, check if tabs should be applied
            if (this.getOperationType(operationId) === 'cutout') {
                console.log(`[DEBUG Tabs] Cutout operation ${operationId}. Tab settings: count=${params.tabs}, width=${params.tabWidth}, height=${params.tabHeight}`);
                plan.metadata.hasTabs = params.tabs > 0;
                if (params.tabs > 0) {
                    plan.metadata.tabPositions = this.calculateTabPositions(primitive, params);
                    if (plan.metadata.tabPositions && plan.metadata.tabPositions.length > 0) {
                        console.log(`[DEBUG Tabs] Calculated ${plan.metadata.tabPositions.length} tab positions:`, JSON.stringify(plan.metadata.tabPositions));
                    } else {
                        console.warn(`[DEBUG Tabs] Failed to calculate any tab positions for primitive:`, primitive);
                    }
                }
            }
            
            // Analyze primitive to set entry/exit points WITH DEPTH
            this.analyzePrimitive(plan, primitive, depth);

            // Initialize optimization metadata with defaults - CRITICAL FIX
            plan.metadata.optimization = {
                linkType: 'rapid',
                optimizedEntryPoint: plan.metadata.entryPoint,
                entryCommandIndex: 0
            };
            
            // Generate ONLY cutting commands (LINEAR/ARC)
            this.translatePrimitiveToCutting(plan, primitive, depth, params);
            
            // Calculate bounds
            this.calculatePlanBounds(plan);
            
            return plan.commands.length > 0 ? plan : null;
        }
        
        /**
         * Analyze primitive to extract entry/exit points and metadata
         */
        analyzePrimitive(plan, primitive, depth) {
            const metadata = plan.metadata;
            
            if (primitive.type === 'circle') {
                // Entry at 0° (rightmost point)
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
                // Add obround handler
                const slotRadius = Math.min(primitive.width, primitive.height) / 2;
                const isHorizontal = primitive.width > primitive.height;
                
                // Define entry point (e.g., start of first arc)
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
                metadata.isSimpleCircle = false; // It's not a simple circle
                metadata.primitiveType = 'obround';
                
            } else if (primitive.type === 'arc') {
                metadata.entryPoint = { ...primitive.startPoint, z: depth };
                metadata.exitPoint = { ...primitive.endPoint, z: depth };
                metadata.isClosedLoop = false;
                metadata.primitiveType = 'arc';
                
            } else if (primitive.type === 'path' && primitive.points) {
                metadata.entryPoint = { ...primitive.points[0], z: depth };
                metadata.exitPoint = { ...primitive.points[primitive.points.length - 1], z: depth };
                
                // Check if closed
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
        translatePrimitiveToCutting(plan, primitive, depth, params) {
            const clockwise = params.direction === 'conventional';
            
            if (primitive.type === 'circle') {
                this.translateCircle(plan, primitive, depth, params.feedRate, clockwise);
                
            } else if (primitive.type === 'obround') {
                this.translateObround(plan, primitive, depth, params.feedRate, clockwise);
                
            } else if (primitive.type === 'arc') {
                this.translateArc(plan, primitive, depth, params.feedRate);
                
            } else if (primitive.type === 'path') {
                this.translatePath(plan, primitive, depth, params.feedRate);
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
            
            // plan.addLinear(startX, startY, depth, feedRate);
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

            // Calculate key points
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

            // Add commands to plan
            if (clockwise) {
                // plan.addLinear(pA_x, pA_y, depth, feedRate);
                plan.addLinear(pD_x, pD_y, depth, feedRate);
                plan.addArc(pC_x, pC_y, depth, i2, j2, true, feedRate);
                plan.addLinear(pB_x, pB_y, depth, feedRate);
                plan.addArc(pA_x, pA_y, depth, i1, j1, true, feedRate);
            } else {
                // plan.addLinear(pA_x, pA_y, depth, feedRate);
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
            
            // plan.addLinear(points[0].x, points[0].y, depth, feedRate);
            
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
         * Handle drill operations specially
         */
        translateDrillOperation(operation, params, depthLevels) {
            const plans = [];
            const finalDepth = depthLevels[depthLevels.length - 1];
            const strategyPrimitives = operation.offsets[0]?.primitives || [];
            
            for (const primitive of strategyPrimitives) {
                const role = primitive.properties?.role;
                
                if (role === 'peck_mark') {
                    const plan = new ToolpathPlan(operation.id);
                    plan.metadata.tool = params.tool;
                    plan.metadata.cutDepth = finalDepth;
                    plan.metadata.isPeckMark = true;
                    plan.metadata.entryPoint = { ...primitive.center, z: finalDepth };
                    plan.metadata.exitPoint = { ...primitive.center, z: finalDepth };
                    plan.metadata.groupKey = `D${params.tool.diameter.toFixed(3)}`;

                    plan.metadata.peckCycle = {
                        cannedCycle: params.cannedCycle || 'none',
                        peckDepth: params.peckDepth || 0,
                        dwellTime: params.dwellTime || 0,
                        retractHeight: params.retractHeight || 0.5
                    };
                    
                    plan.metadata.peckData = {
                        position: primitive.center,
                        oversized: primitive.properties.oversized,
                        undersized: primitive.properties.undersized,
                        reducedPlunge: primitive.properties.reducedPlunge
                    };
                    
                    // Initialize optimization metadata for peck marks
                    plan.metadata.optimization = {
                        linkType: 'rapid',
                        optimizedEntryPoint: plan.metadata.entryPoint,
                        entryCommandIndex: 0
                    };
                    
                    plans.push(plan);
                    
                } else if (role === 'drill_milling_path') {
                    // Multi-depth handling for drill milling
                    // Helical entry handles its OWN Z-stepping, so it only needs ONE plan at the FINAL depth.
                    if (params.entryType === 'helix') {
                        const plan = this.createPurePlan(operation.id, primitive, finalDepth, params);
                        if (plan) {
                            plan.metadata.isDrillMilling = true;
                            
                            // Pass obround data if it exists
                            if (primitive.type === 'obround') {
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
                                plan.metadata.obroundData = {
                                    position: primitive.position,
                                    width: primitive.width,
                                    height: primitive.height,
                                    isHorizontal: isHorizontal,
                                    slotRadius: slotRadius,
                                    startCapCenter: startCapCenter,
                                    endCapCenter: endCapCenter
                                };
                            }
                            plans.push(plan);
                        }
                    } else {
                        // Plunge or Ramp entry: Treat like regular milling.
                        // We must create one plan per depth level, respecting multiDepth.
                        for (const depth of depthLevels) {
                            const plan = this.createPurePlan(operation.id, primitive, depth, params);
                            if (plan) {
                                plan.metadata.isDrillMilling = true;
                                
                                // Pass obround data if it exists (must be in this loop too)
                                if (primitive.type === 'obround') {
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
                                    plan.metadata.obroundData = {
                                        position: primitive.position,
                                        width: primitive.width,
                                        height: primitive.height,
                                        isHorizontal: isHorizontal,
                                        slotRadius: slotRadius,
                                        startCapCenter: startCapCenter,
                                        endCapCenter: endCapCenter
                                    };
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
         * Calculate depth levels for multi-pass operations
         */
        calculateDepthLevels(params) {
            const levels = [];
            let finalDepth = params.cutDepth || -1.0;
            
            if (finalDepth > 0) {
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
        calculateTabPositions(primitive, params) {
            if (primitive.type !== 'path' || !primitive.points || primitive.points.length < 3) {
                return [];
            }
            if (!primitive.closed) return [];
            
            const { tabs, tabWidth } = params;
            const toolDiameter = params.tool?.diameter || 1.0;
            const minTabLength = tabWidth * 1.5;
            const cornerMargin = Math.max(toolDiameter * 2, tabWidth);
            
            // 1. Analyze path sections
            const sections = this.analyzePath(primitive, cornerMargin, minTabLength);
            
            if (sections.straight.length === 0 && sections.curved.length === 0) {
                console.warn('[Tabs] Path too short for any tabs');
                return [];
            }
            
            // 2. Prefer straight sections
            let targetSections = sections.straight;
            if (targetSections.length < tabs) {
                // Not enough straights, add gentle curves
                targetSections = [...targetSections, ...sections.curved];
            }
            
            if (targetSections.length === 0) {
                console.warn('[Tabs] No suitable sections for tabs');
                return [];
            }
            
            // 3. Sort by suitability (longer straights first)
            targetSections.sort((a, b) => {
                if (a.type !== b.type) return a.type === 'straight' ? -1 : 1;
                return b.length - a.length;
            });
            
            // 4. Distribute tabs across best sections
            const actualTabCount = Math.min(tabs, targetSections.length);
            const positions = [];
            
            for (let i = 0; i < actualTabCount; i++) {
                const section = targetSections[i];
                const tabDistance = section.midpoint;
                const position = this.getPointAtDistance(primitive, tabDistance);
                
                if (position) {
                    positions.push({
                        start: tabDistance - tabWidth / 2,
                        end: tabDistance + tabWidth / 2,
                        position: position,
                        height: params.tabHeight,
                        sectionType: section.type
                    });
                }
            }
            
            console.log(`[Tabs] Placed ${positions.length} tabs: ${positions.filter(p => p.sectionType === 'straight').length} on straights, ${positions.filter(p => p.sectionType === 'curved').length} on curves`);
            
            return positions;
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
                
                // Check if this segment is an arc
                const isArc = arcSegments.some(seg => seg.startIndex === i);
                
                if (isArc) {
                    const arc = arcSegments.find(seg => seg.startIndex === i);

                    let sweep = arc.endAngle - arc.startAngle;
                    // Normalize sweep based on direction (Ensure sweep has the correct sign and range)
                    if (arc.clockwise) {
                        // CW: Sweep should be negative or zero. If positive, subtract 2*PI.
                        if (sweep > 1e-9) sweep -= 2 * Math.PI; 
                    } else {
                        // CCW: Sweep should be positive or zero. If negative, add 2*PI.
                        if (sweep < -1e-9) sweep += 2 * Math.PI;
                    }
                    // Handle tiny potential floating point issues near zero or 2*PI
                    const startPt = points[arc.startIndex];
                    const endPt = points[arc.endIndex];
                    const dist = Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y);
                    // If start/end points match but sweep is near zero, it might be a full circle issue (less likely here)
                    if (dist < 1e-6 && Math.abs(sweep) < 1e-6 && Math.abs(Math.abs(sweep) - 2 * Math.PI) > 1e-6) {
                        sweep = arc.clockwise ? -2 * Math.PI : 2 * Math.PI;
                    }
                    const arcLength = Math.abs(sweep * arc.radius);

                    // Only use gentle arcs (radius > minLength * 2 seems reasonable)
                    if (arc.radius > minLength * 2) {
                        // Check if the available length (arcLength minus margins) is sufficient
                        // Arcs are always "corners" at both ends
                        const availableLength = arcLength - 2 * cornerMargin;
                        if (availableLength >= minLength) {
                            sections.curved.push({
                                type: 'curved',
                                start: currentDistance + cornerMargin, // Apply margin at start
                                end: currentDistance + arcLength - cornerMargin, // Apply margin at end
                                length: availableLength,
                                midpoint: currentDistance + arcLength / 2 // Midpoint of the original arc segment
                            });
                        }
                    }
                    
                    currentDistance += arcLength;
                } else {
                    // Straight segment
                    const segLength = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                    
                    const prevI = (i - 1 + points.length) % points.length;

                    // Check if START of this segment is a corner
                    // A corner is either a line-to-arc transition OR a sharp line-to-line angle
                    const prevWasArc = arcSegments.some(seg => seg.endIndex === i); // Check if any arc *ends* at our start point (i)
                    let isCornerAtStart;
                    
                    if (prevWasArc) {
                        isCornerAtStart = true; // Arc-to-Line is always a corner
                    } else {
                        // Check line-to-line angle
                        const p0 = points[prevI];
                        const angle1 = Math.atan2(p1.y - p0.y, p1.x - p0.x); // Angle of previous segment
                        const angle2 = Math.atan2(p2.y - p1.y, p2.x - p1.x); // Angle of current segment
                        let angleDiff = Math.abs(angle2 - angle1);
                        if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
                        isCornerAtStart = angleDiff > (Math.PI / 6); // >30° is a corner
                    }

                    // Check if END of this segment is a corner (i.e., transitions to an arc)
                    const nextIsArc = arcSegments.some(seg => seg.startIndex === nextI); // Check if any arc *starts* at our end point (nextI)
                    const isCornerAtEnd = nextIsArc; // Line-to-Arc is always a corner
                    // Note: The *next* segment's "isCornerAtStart" check will handle the line-to-line angle.
                    
                    const availableStart = isCornerAtStart ? cornerMargin : 0;
                    const availableEnd = segLength - (isCornerAtEnd ? cornerMargin : 0); // Only apply margin if it's a corner
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