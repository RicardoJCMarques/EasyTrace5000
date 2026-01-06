/**
 * @file        toolpath/toolpath-geometry-translator.js
 * @description Translates offset geometry into pure toolpath plans
 * @author      Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

/*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2026 Eltryus
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
     * Translates offset geometry into pure toolpath plans
     * NO machine moves (RAPID/PLUNGE/RETRACT) - only LINEAR/ARC cutting commands.
     */
    class GeometryTranslator {
        constructor(core) {
            this.core = core;
            // Initialize the tab planning module
            if (typeof ToolpathTabPlanner !== 'undefined') {
                this.tabPlanner = new ToolpathTabPlanner(this);
            } else {
                console.error("ToolpathTabPlanner module missing.");
            }
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

                const opPlans = await this.translateOperation(operation, context);
                allPlans.push(...opPlans);
            }

            if (debugConfig.enabled) {
                console.log(`[GeometryTranslator] Translated ${allPlans.length} pure geometry plans`);
            }

            return allPlans;
        }

        /**
         * Processes a single contour for cutout operations with tab support.
         */
        _processCutoutContour(contour, operation, ctx, depthLevels, isHole) {
            const plans = [];
            const TOLERANCE = 0.001;

            // Generate unsegmented commands
            const tempPlan = new ToolpathPlan(operation.id);
            tempPlan.metadata.isClosed = true;
            this.translatePrimitiveToCutting(tempPlan, contour, 0, ctx.cutting.feedRate);

            const unsegmentedCommands = tempPlan.commands.map(cmd => {
                cmd.metadata = cmd.metadata || {};
                cmd.metadata.isTab = false;
                return cmd;
            });

            if (unsegmentedCommands.length === 0) return plans;

            // Generate tab-split commands
            let segmentedCommands = [];
            const tabsRequested = ctx.strategy.cutout?.tabs || 0;

            if (tabsRequested > 0 && this.tabPlanner) {
                segmentedCommands = this.tabPlanner.calculateTabPositions(contour, ctx);
                if (debugConfig.enabled) {
                    const tabCount = segmentedCommands.filter(c => c.metadata?.isTab).length;
                    console.log(`[Translator] Tab Planner: ${segmentedCommands.length} segments, ${tabCount} tabs`);
                }
            }

            // Z thresholds
            const finalDepth = ctx.strategy.cutDepth;
            const tabLiftAmount = ctx.strategy.cutout?.tabHeight || 0;
            const Z_top = finalDepth + tabLiftAmount;

            for (const depth of depthLevels) {
                const plan = this.createPurePlan(contour, ctx, depth, true, isHole, false);
                if (!plan) continue;

                const useTabbedPath = segmentedCommands.length > 0 && depth < Z_top - TOLERANCE;
                const commandsToSend = useTabbedPath ? segmentedCommands : unsegmentedCommands;

                plan.commands = commandsToSend.map(cmd => ({
                    ...cmd,
                    z: depth,
                    metadata: cmd.metadata ? { ...cmd.metadata } : { isTab: false }
                }));

                if (useTabbedPath) {
                    plan.metadata.isTabbedPass = true;
                    plan.metadata.tabTopZ = Z_top;
                    plan.metadata.finalDepth = finalDepth;
                } else {
                    plan.metadata.isTabbedPass = false;
                }

                this.calculatePlanBounds(plan);

                // Enforce CW winding for climb milling
                if (plan.commands.length > 0) {
                    const commandPoints = [];
                    let pos = { ...plan.metadata.entryPoint };
                    for (const cmd of plan.commands) {
                        if (cmd.x !== null) pos.x = cmd.x;
                        if (cmd.y !== null) pos.y = cmd.y;
                        commandPoints.push({ x: pos.x, y: pos.y });
                    }
                    if (commandPoints.length >= 3 && !GeometryUtils.isClockwise(commandPoints)) {
                        this.reversePlan(plan);
                    }
                }

                plans.push(plan);
            }

            return plans;
        }

        /**
         * Translates a single operation.
         * Iterates over contours within primitives.
         */
        async translateOperation(operation, ctx) {
            const { operationType, computed } = ctx;
            const depthLevels = computed.depthLevels;
            const plans = [];

            // Drill operations
            if (operationType === 'drill') {
                const strategyPrimitives = operation.offsets[0]?.primitives || [];
                return this.translateDrillOperation(ctx, strategyPrimitives, depthLevels);
            }

            // Milling operations
            const isCutoutWithTabs = operationType === 'cutout' && (ctx.strategy.cutout?.tabs || 0) > 0;

            for (const offset of operation.offsets) {
                for (const primitive of offset.primitives) {

                    // Centerline paths
                    if (primitive.properties?.isCenterlinePath) {
                        plans.push(...this.translateCenterlinePath(primitive, ctx, depthLevels));
                        continue;
                    }

                    // Convert non-path primitives to PathPrimitive
                    let processable = primitive;
                    if (primitive.type !== 'path') {
                        const converted = typeof GeometryUtils !== 'undefined' 
                            ? GeometryUtils.primitiveToPath(primitive) 
                            : null;

                        if (converted?.contours?.length > 0) {
                            processable = converted;
                        } else {
                            // Fallback: simple depth passes
                            for (const depth of depthLevels) {
                                const plan = this.createPurePlan(primitive, ctx, depth, primitive.closed, primitive.properties?.isHole || false);
                                if (plan) plans.push(plan);
                            }
                            continue;
                        }
                    }

                    if (!processable.contours?.length) {
                        console.warn(`[Translator] Primitive ${processable.id} has no contours`);
                        continue;
                    }

                    // Process contours
                    for (const contour of processable.contours) {
                        const isHole = contour.isHole || false;

                        if (isCutoutWithTabs) {
                            plans.push(...this._processCutoutContour(contour, operation, ctx, depthLevels, isHole));
                        } else {
                            for (const depth of depthLevels) {
                                const plan = this.createPurePlan(contour, ctx, depth, processable.closed ?? true, isHole, true);
                                if (plan) {
                                    this.calculatePlanBounds(plan);
                                    plans.push(plan);
                                }
                            }
                        }
                    }
                }
            }

            return plans;
        }

        /**
         * New specialized translator for Centerline Slot Paths.
         * Generates a single "Macro" plan that the MachineProcessor expands into a Zig-Zag pattern.
         */
        translateCenterlinePath(primitive, ctx, depthLevels) {
            const plans = [];

            const points = primitive.contours[0]?.points;
            if (!points || points.length < 2) return [];

            const startPoint = points[0];
            const endPoint = points[points.length - 1];
            const slotLength = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);

            // Create one abstract plan for the entire slot operation
            const plan = this.createPurePlan(primitive, ctx, depthLevels[0], false, false, false);

            if (plan) {
                plan.metadata.entryPoint = { ...startPoint, z: depthLevels[0] };
                plan.metadata.exitPoint = { ...endPoint, z: depthLevels[depthLevels.length - 1] };

                plan.metadata.primitiveType = 'centerline_slot';
                plan.metadata.isCenterlinePath = true;
                plan.metadata.isDrillMilling = true;
                plan.metadata.toolDiameter = ctx.tool.diameter;
                plan.metadata.slotLength = slotLength;

                // Attach strategy for the processor
                plan.metadata.strategy = {
                    zigzag: true,
                    cutDepth: ctx.strategy.cutDepth,
                    depthPerPass: ctx.strategy.depthPerPass,
                    feedRate: ctx.cutting.feedRate,
                    plungeRate: ctx.cutting.plungeRate
                };

                // Add a single guide command (A -> B)
                plan.commands.push(new MotionCommand(
                    'LINEAR',
                    { x: endPoint.x, y: endPoint.y, z: depthLevels[0] },
                    { feed: ctx.cutting.feedRate }
                ));

                this.calculatePlanBounds(plan);
                plans.push(plan);
            }

            return plans;
        }

        /**
         * Create a pure cutting geometry plan from a contour or simple primitive.
         */
        createPurePlan(primitive, ctx, depth, isClosed, isHole, generateCommands = true) {
            // Get all settings from the context
            const { operationId, operationType, tool, cutting, strategy } = ctx;

            const plan = new ToolpathPlan(operationId);

            // Set metadata
            plan.metadata.operationId = ctx.operationId;
            plan.metadata.operationType = ctx.operationType;
            plan.metadata.cutDepth = depth;
            plan.metadata.finalDepth = strategy.cutDepth;
            plan.metadata.feedRate = cutting.feedRate;
            plan.metadata.plungeRate = cutting.plungeRate;
            plan.metadata.entryType = strategy.entryType;
            plan.metadata.depthPerPass = strategy.depthPerPass;
            plan.metadata.spindleSpeed = cutting.spindleSpeed;
            plan.metadata.spindleDwell = cutting.spindleDwell;
            plan.metadata.toolDiameter = tool.diameter;
            plan.metadata.stepOver = strategy.stepOver;

            const isDrillMilling = ctx._isDrillMilling || false;
            const typeKey = isDrillMilling ? 'drill_mill' : 'mill';
            plan.metadata.groupKey = `T:${tool.diameter.toFixed(3)}_OP:${ctx.operationId}_TYPE:${typeKey}`;

            plan.metadata.primitiveType = primitive.type || 'path';
            plan.metadata.isClosed = isClosed;
            plan.metadata.isHole = isHole;

            // Analyze primitive sets entry/exit points and metadata
            this.analyzePrimitive(plan, primitive, depth);

            // Generate commands only if explicitly requested (used for the base unsegmented path)
            if (generateCommands) {
                this.translatePrimitiveToCutting(plan, primitive, depth, cutting.feedRate);
            }

            // Drill Helix Validation
            if (ctx.operationType === 'drill' && ctx.strategy.entryType === 'helix' && plan.commands.length === 0) {
                // If the plan is empty but is a helix entry for drill milling, populate metadata
                 if (plan.metadata.primitiveType === 'path' && primitive.arcSegments && primitive.arcSegments.length > 0) {
                    const arc = primitive.arcSegments[0];
                    const dist = Math.hypot(primitive.points[0].x - primitive.points[primitive.points.length-1].x, primitive.points[0].y - primitive.points[primitive.points.length-1].y);
                    if(primitive.arcSegments.length === 1 && dist < 0.001) {
                        plan.metadata.center = arc.center;
                        plan.metadata.radius = arc.radius;
                    }
                }
            }

            plan.metadata.optimization = {
                linkType: 'rapid',
                optimizedEntryPoint: plan.metadata.entryPoint,
                entryCommandIndex: 0
            };

            // Note: Bounds, winding and tab logic must be performed by the caller (translateOperation) after the final command set is chosen.

            return plan;
        }

        /**
         * Analyze geometry to extract entry/exit points and metadata.
         * @param {Object} geometry - The raw geometry object (Contour or Analytic Primitive)
         */
        analyzePrimitive(plan, geometry, depth) {
            const metadata = plan.metadata;

            // Determine type. Contours have no 'type' property, so they default to 'path'.
            const type = geometry.type || 'path';

            if (type === 'circle') {
                metadata.entryPoint = {
                    x: geometry.center.x + geometry.radius,
                    y: geometry.center.y,
                    z: depth
                };
                metadata.exitPoint = { ...metadata.entryPoint };
                metadata.isClosedLoop = true;
                metadata.isSimpleCircle = true;
                metadata.primitiveType = 'circle';
                metadata.center = geometry.center;
                metadata.radius = geometry.radius;

            } else if (type === 'obround') {
                const isHorizontal = geometry.width > geometry.height;
                const startAngle = isHorizontal ? (Math.PI / 2) : Math.PI;
                const obroundData = this.getObroundData(geometry);

                metadata.obroundData = obroundData;

                metadata.entryPoint = {
                    x: obroundData.startCapCenter.x + obroundData.slotRadius * Math.cos(startAngle),
                    y: obroundData.startCapCenter.y + obroundData.slotRadius * Math.sin(startAngle),
                    z: depth
                };

                metadata.exitPoint = { ...metadata.entryPoint };
                metadata.isClosedLoop = true;
                metadata.isSimpleCircle = false;
                metadata.primitiveType = 'obround';
                metadata.obroundData = obroundData;
                metadata.center = obroundData.startCapCenter;
                metadata.radius = obroundData.slotRadius;

            } else if (type === 'arc') {
                metadata.entryPoint = { ...geometry.startPoint, z: depth };
                metadata.exitPoint = { ...geometry.endPoint, z: depth };
                metadata.isClosedLoop = false;
                metadata.primitiveType = 'arc';

            } else if (type === 'path') {
                const points = geometry.points;

                if (points && points.length > 0) {
                    metadata.entryPoint = { ...points[0], z: depth };
                    metadata.isClosedLoop = plan.metadata.isClosed; 

                    if (metadata.isClosedLoop) {
                        metadata.exitPoint = { ...metadata.entryPoint };
                    } else {
                        metadata.exitPoint = { ...points[points.length - 1], z: depth };
                    }

                    metadata.primitiveType = 'path';
                    // Check for arc segments
                    metadata.hasArcs = geometry.arcSegments && geometry.arcSegments.length > 0;
                }
            }
        }

        /**
         * Translate primitive to pure cutting commands
         */
        translatePrimitiveToCutting(plan, geometry, depth, feedRate) {
            // Default to 'path' if no type (handles Contours)
            const type = geometry.type || 'path'; 

            if (type === 'circle') {
                this.translateCircle(plan, geometry, depth, feedRate, false); 
            } else if (type === 'obround') {
                this.translateObround(plan, geometry, depth, feedRate, false);
            } else if (type === 'arc') {
                this.translateArc(plan, geometry, depth, feedRate);
            } else if (type === 'path') {
                // geometry is a Contour here
                this.translatePath(plan, geometry, depth, feedRate);
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

            // Check for collapsed arc
            const minArcChordLength = 0.01; // Use the same tolerance as the optimizer
            const chordDistance = Math.hypot(
                primitive.endPoint.x - primitive.startPoint.x, 
                primitive.endPoint.y - primitive.startPoint.y
            );

            if (chordDistance < minArcChordLength) {
                // Arc is tiny, replace with a straight line to be safe
                plan.addLinear(
                    primitive.endPoint.x,
                    primitive.endPoint.y,
                    depth,
                    feedRate
                );
                return;
            }

            plan.addArc(
                primitive.endPoint.x,
                primitive.endPoint.y,
                depth,
                i, j,
                !primitive.clockwise, // Flipped back
                feedRate
            );
        }

        translatePath(plan, contour, depth, feedRate) {
            const points = contour.points;

            if (!points || points.length < 2) return;

            const isClosed = plan.metadata.isClosed;
            const arcSegments = contour.arcSegments || [];
            const minArcChordLength = 0.01;
            const minLinearLength = 0.001;

            // Build arc map
            const arcMap = new Map();
            for (const arc of arcSegments) {
                arcMap.set(arc.startIndex, arc);
            }

            // Detect full circle: all edges are arcs from same center/radius
            if (arcSegments.length >= 3 && arcSegments.length === points.length) {
                const first = arcSegments[0];
                const isFullCircle = first.center && first.radius > 0 && arcSegments.every(arc =>
                    arc.center &&
                    Math.abs(arc.center.x - first.center.x) < 0.001 &&
                    Math.abs(arc.center.y - first.center.y) < 0.001 &&
                    Math.abs(arc.radius - first.radius) < 0.001
                );

                if (isFullCircle) {
                    // Emit single full-circle arc command
                    const startX = first.center.x + first.radius;
                    const startY = first.center.y;
                    const clockwise = first.clockwise || false;
                    const gcodeClockwise = !clockwise; // Flip for G-code convention
                    plan.addArc(startX, startY, depth, -first.radius, 0, gcodeClockwise, feedRate);
                    return;
                }
            }

            // Standard segment-by-segment processing
            const isPhysicallyClosed = this._isClosedPoints(points);
            const numPoints = points.length;
            const segmentsToDraw = (isClosed && !isPhysicallyClosed) ? numPoints : numPoints - 1;

            let i = 0;
            let segmentsDrawn = 0;

            while (segmentsDrawn < segmentsToDraw) {
                const startPoint = points[i];
                const arc = arcMap.get(i);

                let nextIndex = (i + 1) % numPoints;
                if (nextIndex >= numPoints) nextIndex = 0;

                const endPoint = points[nextIndex];

                if (arc && arc.endIndex === nextIndex) {
                    // Arc segment
                    const chordDistance = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);

                    if (chordDistance >= minArcChordLength && arc.center && arc.radius > 0) {
                        const i_val = arc.center.x - startPoint.x;
                        const j_val = arc.center.y - startPoint.y;
                        const gcodeClockwise = !arc.clockwise;

                        plan.addArc(endPoint.x, endPoint.y, depth, i_val, j_val, gcodeClockwise, feedRate);
                    } else {
                        // Tiny arc or missing data, use line
                        plan.addLinear(endPoint.x, endPoint.y, depth, feedRate);
                    }
                } else {
                    // Linear segment
                    const dist = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);
                    if (dist > minLinearLength) {
                        plan.addLinear(endPoint.x, endPoint.y, depth, feedRate);
                    }

                    i = nextIndex;
                }

                i = nextIndex;
                segmentsDrawn++;
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

                    // Must pass the full context so the peck mark processor can read machine/strategy settings.
                    plan.metadata.context = ctx; 
                    plan.metadata.tool = tool;
                    plan.metadata.cutDepth = finalDepth;
                    plan.metadata.feedRate = cutting.feedRate;
                    plan.metadata.plungeRate = cutting.plungeRate;
                    plan.metadata.spindleSpeed = cutting.spindleSpeed;
                    plan.metadata.spindleDwell = cutting.spindleDwell;
                    plan.metadata.isPeckMark = true;
                    plan.metadata.entryPoint = { ...primitive.center, z: finalDepth };
                    plan.metadata.exitPoint = { ...primitive.center, z: finalDepth };
                    plan.metadata.groupKey = `T:${tool.diameter.toFixed(3)}_OP:drill_TYPE:peck`;

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

                    if (debugConfig.enabled && plan.commands.length > 0) {
                        const windingStr = actuallyClockwise ? 'CW' : 'CCW';
                        const desiredStr = desiredClockwise ? 'CW' : 'CCW';
                        const flipped = actuallyClockwise !== desiredClockwise;
                        console.log(`[Translator] Plan winding: ${windingStr} → ${desiredStr} (${flipped ? 'flipped' : 'no change'})`);
                    }
                    // Validate depth consistency
                    if (Math.abs(plan.metadata.cutDepth - ctx.strategy.cutDepth) > 0.001) {
                        this.debug(`Warning: cutDepth mismatch for peck mark: ${plan.metadata.cutDepth} vs ${ctx.strategy.cutDepth}`);
                    }
                    plans.push(plan);

                } else if (role === 'drill_milling_path') {
                    // Check for centerline before regular drill milling
                    // CenterLinePath handles its own Z-depths internally
                    if (primitive.properties?.isCenterlinePath) {
                        const centerlinePlans = this.translateCenterlinePath(primitive, ctx, depthLevels);
                        plans.push(...centerlinePlans);
                        continue; // Skip to next primitive
                    }
                    // Create a temporary context to flag this as drill-milling
                    const drillMillCtx = { ...ctx, _isDrillMilling: true };

                    // Identify the Geometry Entity
                    let geometryEntity = null;
                    
                    if (primitive.type === 'path') {
                        // Extract the contour because 'PathPrimitive' is a container.
                        if (primitive.contours && primitive.contours.length > 0) {
                            geometryEntity = primitive.contours[0];
                        }
                    } else {
                        // Analytic primitives (Circle/Obround) are their own geometry
                        geometryEntity = primitive;
                    }

                    if (!geometryEntity) continue;

                    // Process the Geometry
                    if (strategy.entryType === 'helix') {
                        // Helix handles its own Z-depths internally
                        // Note: Helix logic expects Analytic geometry (Circle/Obround)
                        const plan = this.createPurePlan(geometryEntity, drillMillCtx, finalDepth, 0, true, false); 
                        if (plan) {
                            plan.metadata.isDrillMilling = true;
                            plans.push(plan);
                        }
                    } else {
                        // Standard Path Milling (Multi-depth)
                        for (const depth of depthLevels) {
                            // Pass the unwrapper geometry Entity (Contour or Analytic)
                            const plan = this.createPurePlan(geometryEntity, drillMillCtx, depth, 0, true, false);
                            if (plan) {
                                plan.metadata.isDrillMilling = true;
                                plans.push(plan);
                            }
                        }
                    }
                }
            }
            return plans;
        }

        /**
         * Reverses a toolpath plan in-place.
         * Rebuilds the path from absolute points, correctly flipping arcs.
         */
        reversePlan(plan) {
            if (!plan || !plan.commands || plan.commands.length === 0) return;

            const commands = plan.commands;
            const newCommands = [];

            // 1. Build an absolute point list from the original path
            const points = [{ ...plan.metadata.entryPoint }];
            let currentPos = { ...plan.metadata.entryPoint };

            for (const cmd of commands) {
                const nextPos = {
                    x: cmd.x !== null ? cmd.x : currentPos.x,
                    y: cmd.y !== null ? cmd.y : currentPos.y,
                    z: cmd.z !== null ? cmd.z : currentPos.z,
                    feed: cmd.f,
                    // Store the command info *on the point it leads to*
                    cmdType: cmd.type,
                    i: cmd.i,
                    j: cmd.j,
                    // Capture metadata to preserve 'isTab' flags
                    metadata: cmd.metadata
                };
                points.push(nextPos);
                currentPos = nextPos;
            }

            // 2. Iterate the point list backwards to create new commands
            // Start from the last point (new entry) and move to the first (new exit)
            for (let i = points.length - 1; i > 0; i--) {
                const startPos = points[i]; // The new start point
                const endPos = points[i - 1]; // The new end point

                // The command data is stored on the 'startPos' (original end point)
                const cmdType = startPos.cmdType;
                const feed = startPos.feed;
                const meta = startPos.metadata; // FIX: Retrieve metadata

                let newCmd;

                if (cmdType === 'ARC_CW' || cmdType === 'ARC_CCW') {
                    // This command was an arc. Create its reverse.
                    const newType = cmdType === 'ARC_CW' ? 'ARC_CCW' : 'ARC_CW';

                    // The original 'i, j' was relative to the original start (endPos)
                    // Set the center from that.
                    const centerX = endPos.x + startPos.i;
                    const centerY = endPos.y + startPos.j;

                    // Calculate the new 'i, j' relative to the *new* start (startPos)
                    const new_i = centerX - startPos.x;
                    const new_j = centerY - startPos.y;

                    newCmd = new MotionCommand(
                        newType,
                        { x: endPos.x, y: endPos.y, z: endPos.z },
                        { i: new_i, j: new_j, feed: feed }
                    );
                } else {
                    // Default to Linear
                    newCmd = new MotionCommand(
                        'LINEAR',
                        { x: endPos.x, y: endPos.y, z: endPos.z },
                        { feed: feed }
                    );
                }

                // Restore metadata to the new command
                if (meta) {
                    newCmd.metadata = { ...meta };
                }

                newCommands.push(newCmd);
            }

            plan.commands = newCommands;

            // 3. Swap entry/exit points
            const oldEntry = plan.metadata.entryPoint;
            plan.metadata.entryPoint = plan.metadata.exitPoint;
            plan.metadata.exitPoint = oldEntry;
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

        /**
         * Calculate the total length of a contour.
         * Handles both linear segments and arc segments defined in metadata.
         */
        _calculatePathLength(contour) {
            let length = 0;
            const points = contour.points;
            if (!points || points.length < 2) return 0;

            // Create a map for fast arc lookup
            const arcMap = new Map();
            if (contour.arcSegments) {
                for (const arc of contour.arcSegments) {
                    arcMap.set(arc.startIndex, arc);
                }
            }

            const numPoints = points.length;
            // Cutouts are implicitly closed, so process the closing segment too
            const limit = numPoints; 

            for (let i = 0; i < limit; i++) {
                const nextI = (i + 1) % numPoints;
                
                // Stop if it's an open path and at the last point (safety check)
                if (nextI === 0 && !contour.closed && !this._isClosedPoints(points)) {
                    break; 
                }

                const arc = arcMap.get(i);

                if (arc && arc.endIndex === nextI) {
                    // Arc Length
                    let sweep = arc.endAngle - arc.startAngle;
                    // Normalize sweep
                    if (arc.clockwise) {
                        if (sweep > 1e-9) sweep -= 2 * Math.PI;
                    } else {
                        if (sweep < -1e-9) sweep += 2 * Math.PI;
                    }
                    length += Math.abs(sweep * arc.radius);
                } else {
                    // Linear Length
                    length += Math.hypot(
                        points[nextI].x - points[i].x, 
                        points[nextI].y - points[i].y
                    );
                }
            }
            return length;
        }

        _isClosedPoints(points) {
            if (points.length < 2) return false;
            const first = points[0];
            const last = points[points.length - 1];
            return Math.hypot(first.x - last.x, first.y - last.y) < 0.001;
        }  

    }

    window.GeometryTranslator = GeometryTranslator;
})();