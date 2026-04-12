/*!
 * @file        toolpath/toolpath-geometry-translator.js
 * @description Translates annotated 2D primitives into 3D ToolpathPlans
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
    const PRECISION = C.precision.coordinate;
    const debugState = D.debug;

    /**
     * Primitive-driven translation router.
     * No operation-type branching — all dispatch is based on primitive properties (role, tabConfig, type).  Drill macro grouping runs as a pre-scan so the MachineProcessor receives one approach/retract cycle per hole regardless of how many concentric passes it contains.
     * Shared utilities (translatePath, translateCircle, applyTransforms, reversePlan, _enforceClimbMilling) remain here as the single implementation consumed by every operation type.
     */
    class GeometryTranslator {
        constructor(core) {
            this.core = core;
            // Initialize the tab planning module
            if (typeof ToolpathTabPlanner !== 'undefined') {
                this.tabPlanner = new ToolpathTabPlanner(this);
            } else {
                console.error("[GeometryTranslator] ToolpathTabPlanner module missing.");
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
                    console.error(`[GeometryTranslator] Missing context for operation ${operation.id}`);
                    continue;
                }

                const opPlans = await this.translateOperation(operation, context);
                allPlans.push(...opPlans);
            }

            if (debugState.enabled) {
                console.log(`[GeometryTranslator] Translated ${allPlans.length} pure geometry plans`);
            }

            return allPlans;
        }

        // ────────────────────────────────────────────────────────────
        // Main Router — Primitive-Driven
        // ────────────────────────────────────────────────────────────

        /**
         * Translates a single operation's offset geometry into ToolpathPlans.
         * Phase 1 — Pre-scan:  Groups concentric circle/obround drill milling paths by holeIndex and emits one macro plan per hole.  All other primitives pass through.
         * Phase 2 — Per-primitive dispatch based on properties.role and properties.tabConfig.  No operation-type checks.
         */
        async translateOperation(operation, ctx) {
            const plans = [];
            const depthLevels = ctx.computed.depthLevels;

            // Phase 1 — Extract grouped drill milling macros
            const { macroPlans, remainingPrimitives } =
                this._extractDrillMacros(operation, ctx, depthLevels);
            plans.push(...macroPlans);

            // Phase 2 — Role-based dispatch for everything else
            for (const primitive of remainingPrimitives) {
                const props = primitive.properties || {};
                const role = props.role;

                // Point-based macros (peck marks)
                if (role === 'peck_mark') {
                    plans.push(this._translatePeckMark(primitive, ctx, depthLevels));
                    continue;
                }

                // Remaining drill milling paths (centerlines, ungrouped fallbacks)
                if (role === 'drill_milling_path') {
                    if (props.isCenterlinePath) {
                        plans.push(...this._translateCenterlinePath(primitive, ctx, depthLevels));
                    } else {
                        plans.push(...this._translateDrillMill(primitive, ctx, depthLevels));
                    }
                    continue;
                }

                // Standard contour routing (isolation, clearing, cutout, stencil)
                let processable = primitive;

                // Ensure primitive is a path
                if (primitive.type !== 'path') {
                    const converted = typeof GeometryUtils !== 'undefined'
                        ? GeometryUtils.primitiveToPath(primitive)
                        : null;
                    if (converted?.contours?.length > 0) {
                        processable = converted;
                    }
                }

                if (!processable.contours?.length) {
                    // Fallback for raw circles/rectangles that couldn't be converted
                    plans.push(...this._processStandardPrimitive(processable, ctx, depthLevels));
                    continue;
                }

                // Process contours (checking for tab configuration)
                for (const contour of processable.contours) {
                    const isHole = contour.isHole || false;

                    if (props.tabConfig && this.tabPlanner) {
                        plans.push(...this._processTabbedContour(contour, props, ctx, depthLevels, isHole));
                    } else {
                        plans.push(...this._processStandardContour(contour, processable, ctx, depthLevels, isHole));
                    }
                }
            }

            return plans;
        }

        /**
         * Drill Macro Extraction (Pre-Scan)
         */

        /**
         * Groups concentric circle and obround drill milling paths by holeIndex, then emits a single drillMillMacro plan per hole.
         * Returns the macro plans and the list of primitives that were NOT consumed (pecks, centerlines, non-drill geometry).
         */
        _extractDrillMacros(operation, ctx, depthLevels) {
            const macroPlans = [];
            const remainingPrimitives = [];
            const { operationId, tool, cutting, strategy, transforms } = ctx;
            const finalDepth = depthLevels[depthLevels.length - 1];

            const circleMillByHole = new Map();
            const obroundMillByHole = new Map();

            // Scan all offset primitives
            for (const offset of operation.offsets) {
                for (const primitive of offset.primitives) {
                    const props = primitive.properties || {};

                    if (props.role === 'drill_milling_path' && !props.isCenterlinePath) {
                        const holeIdx = props.holeIndex ?? -1;
                        if (primitive.type === 'circle') {
                            if (!circleMillByHole.has(holeIdx)) circleMillByHole.set(holeIdx, []);
                            circleMillByHole.get(holeIdx).push(primitive);
                            continue;
                        } else if (primitive.type === 'obround') {
                            if (!obroundMillByHole.has(holeIdx)) obroundMillByHole.set(holeIdx, []);
                            obroundMillByHole.get(holeIdx).push(primitive);
                            continue;
                        }
                    }
                    remainingPrimitives.push(primitive);
                }
            }

            // Emit circle macro plans
            for (const [holeIdx, holePrimitives] of circleMillByHole) {
                const rings = holePrimitives.map((prim, idx) => ({
                    center: this.applyTransforms(prim.center, transforms),
                    radius: prim.radius,
                    pass: idx + 1
                }));

                const innerRing = rings[0];
                const entryX = innerRing.center.x + innerRing.radius;
                const entryY = innerRing.center.y;

                const plan = new ToolpathPlan(operationId);
                plan.metadata.context = ctx;
                plan.metadata.operationId = operationId;
                plan.metadata.operationType = 'drill';
                plan.metadata.isDrillMilling = true;
                plan.metadata.drillMillMacro = true;
                plan.metadata.entryType = strategy.entryType || 'plunge';
                plan.metadata.concentricRings = rings;
                plan.metadata.depthLevels = depthLevels;
                plan.metadata.cutDepth = finalDepth;
                plan.metadata.finalDepth = finalDepth;
                plan.metadata.depthPerPass = strategy.depthPerPass;
                plan.metadata.feedRate = cutting.feedRate;
                plan.metadata.plungeRate = cutting.plungeRate;
                plan.metadata.spindleSpeed = cutting.spindleSpeed;
                plan.metadata.spindleDwell = cutting.spindleDwell;
                plan.metadata.toolDiameter = tool.diameter;
                plan.metadata.center = innerRing.center;
                plan.metadata.radius = innerRing.radius;
                plan.metadata.isSimpleCircle = true;
                plan.metadata.isClosedLoop = true;
                plan.metadata.primitiveType = 'circle';
                plan.metadata.entryPoint = { x: entryX, y: entryY, z: finalDepth };
                plan.metadata.exitPoint = { x: entryX, y: entryY, z: finalDepth };
                plan.metadata.groupKey = `T:${tool.diameter.toFixed(3)}_OP:${operationId}_TYPE:drill_mill`;
                plan.metadata.optimization = {
                    linkType: 'rapid',
                    optimizedEntryPoint: plan.metadata.entryPoint,
                    entryCommandIndex: 0
                };

                macroPlans.push(plan);
            }

            // Emit obround macro plans
            for (const [holeIdx, holePrimitives] of obroundMillByHole) {
                const rings = holePrimitives.map((prim, idx) => {
                    const oData = this.getObroundData(prim);
                    oData.startCapCenter = this.applyTransforms(oData.startCapCenter, transforms);
                    oData.endCapCenter = this.applyTransforms(oData.endCapCenter, transforms);
                    oData.pA = this.applyTransforms(oData.pA, transforms);
                    oData.pB = this.applyTransforms(oData.pB, transforms);
                    oData.pC = this.applyTransforms(oData.pC, transforms);
                    oData.pD = this.applyTransforms(oData.pD, transforms);
                    return { ...oData, pass: idx + 1 };
                });

                const innerRing = rings[0];
                const entryPoint = innerRing.pA;

                const plan = new ToolpathPlan(operationId);
                plan.metadata.context = ctx;
                plan.metadata.operationId = operationId;
                plan.metadata.operationType = 'drill';
                plan.metadata.isDrillMilling = true;
                plan.metadata.drillMillMacro = true;
                plan.metadata.slotMacro = true;
                plan.metadata.entryType = strategy.entryType || 'plunge';
                plan.metadata.obroundRings = rings;
                plan.metadata.depthLevels = depthLevels;
                plan.metadata.cutDepth = finalDepth;
                plan.metadata.finalDepth = finalDepth;
                plan.metadata.depthPerPass = strategy.depthPerPass;
                plan.metadata.feedRate = cutting.feedRate;
                plan.metadata.plungeRate = cutting.plungeRate;
                plan.metadata.spindleSpeed = cutting.spindleSpeed;
                plan.metadata.spindleDwell = cutting.spindleDwell;
                plan.metadata.toolDiameter = tool.diameter;
                plan.metadata.isClosedLoop = true;
                plan.metadata.isSimpleCircle = false;
                plan.metadata.primitiveType = 'obround';
                plan.metadata.entryPoint = { x: entryPoint.x, y: entryPoint.y, z: finalDepth };
                plan.metadata.exitPoint = { x: entryPoint.x, y: entryPoint.y, z: finalDepth };
                plan.metadata.groupKey = `T:${tool.diameter.toFixed(3)}_OP:${operationId}_TYPE:drill_mill`;
                plan.metadata.optimization = {
                    linkType: 'rapid',
                    optimizedEntryPoint: plan.metadata.entryPoint,
                    entryCommandIndex: 0
                };

                macroPlans.push(plan);
            }

            return { macroPlans, remainingPrimitives };
        }

        /**
         * Specific Translation Macros
         */

        _translatePeckMark(primitive, ctx, depthLevels) {
            const { operationId, tool, cutting, strategy, transforms } = ctx;
            const finalDepth = depthLevels[depthLevels.length - 1];

            const plan = new ToolpathPlan(operationId);
            plan.metadata.context = ctx;
            plan.metadata.tool = tool;
            plan.metadata.cutDepth = finalDepth;
            plan.metadata.feedRate = cutting.feedRate;
            plan.metadata.plungeRate = cutting.plungeRate;
            plan.metadata.spindleSpeed = cutting.spindleSpeed;
            plan.metadata.spindleDwell = cutting.spindleDwell;
            plan.metadata.isPeckMark = true;

            const transformedCenter = this.applyTransforms(primitive.center, transforms);
            plan.metadata.entryPoint = { ...transformedCenter, z: finalDepth };
            plan.metadata.exitPoint = { ...transformedCenter, z: finalDepth };
            plan.metadata.groupKey = `T:${tool.diameter.toFixed(3)}_OP:drill_TYPE:peck`;

            // Pack cycle parameters for the Machine Processor
            plan.metadata.peckCycle = {
                cannedCycle: strategy.drill.cannedCycle || 'none',
                peckDepth: strategy.drill.peckDepth || 0,
                dwellTime: strategy.drill.dwellTime || 0,
                retractHeight: strategy.drill.retractHeight || 0.5
            };

            plan.metadata.peckData = {
                position: transformedCenter,
                ...primitive.properties
            };

            plan.metadata.optimization = {
                linkType: 'rapid',
                optimizedEntryPoint: plan.metadata.entryPoint,
                entryCommandIndex: 0
            };

            return plan;
        }

        /**
         * Fallback for drill milling paths that weren't captured by the macro grouping pre-scan (e.g. path-type geometry).
         */
        _translateDrillMill(primitive, ctx, depthLevels) {
            const plans = [];
            const isClosed = primitive.type === 'circle' || primitive.type === 'obround' ||
                             (primitive.contours?.[0]?.points?.length >= 3);
            const finalDepth = depthLevels[depthLevels.length - 1];

            const drillMillCtx = { ...ctx, _isDrillMilling: true };
            const geometryEntity = (primitive.type === 'path' && primitive.contours?.length > 0)
                ? primitive.contours[0]
                : primitive;

            if (ctx.strategy.entryType === 'helix') {
                const plan = this.createPurePlan(geometryEntity, drillMillCtx, finalDepth, isClosed, false, false);
                if (plan) {
                    plan.metadata.isDrillMilling = true;
                    if (isClosed) this._enforceClimbMilling(plan, false);
                    plans.push(plan);
                }
            } else {
                for (const depth of depthLevels) {
                    const plan = this.createPurePlan(geometryEntity, drillMillCtx, depth, isClosed, false, true);
                    if (plan) {
                        plan.metadata.isDrillMilling = true;
                        this.calculatePlanBounds(plan);
                        if (isClosed) this._enforceClimbMilling(plan, false);
                        plans.push(plan);
                    }
                }
            }
            return plans;
        }

        /**
         * Specialized translator for Centerline Slot Paths.
         * Generates a single "Macro" plan that the MachineProcessor expands into a Zig-Zag pattern.
         */
        _translateCenterlinePath(primitive, ctx, depthLevels) {
            const plans = [];

            // Centerline slots are wrapped in a PathPrimitive, so the points are in the first contour.
            const contour = primitive.contours[0];
            const points = contour?.points;

            if (!points || points.length < 2) return [];

            const startPoint = points[0];
            const endPoint = points[points.length - 1];
            const slotLength = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);

            // Create the plan using the contour points
            const plan = this.createPurePlan(contour, ctx, depthLevels[0], false, false, false);

            if (plan && plan.metadata.exitPoint) {
                // Only update the Z-depth of the exit point
                plan.metadata.exitPoint.z = depthLevels[depthLevels.length - 1];
                plan.metadata.primitiveType = 'centerline_slot';
                plan.metadata.isCenterlinePath = true;
                plan.metadata.isDrillMilling = true;
                plan.metadata.toolDiameter = ctx.tool.diameter;
                plan.metadata.slotLength = slotLength;

                // Instruct Machine Processor to perform zigzag step-downs
                plan.metadata.strategy = {
                    zigzag: true,
                    cutDepth: ctx.strategy.cutDepth,
                    depthPerPass: ctx.strategy.depthPerPass,
                    feedRate: ctx.cutting.feedRate,
                    plungeRate: ctx.cutting.plungeRate
                };

                // Use the transformed exit point for the guide command so MachineProcessor knows where the slot ends in machine coordinates.
                const targetX = plan.metadata.exitPoint.x;
                const targetY = plan.metadata.exitPoint.y;

                plan.commands.push(new MotionCommand(
                    'LINEAR',
                    { x: targetX, y: targetY, z: depthLevels[0] },
                    { feed: ctx.cutting.feedRate }
                ));

                this.calculatePlanBounds(plan);
                plans.push(plan);
            }

            return plans;
        }

        /**
         * Standard Multi-Depth Routing & Tabbing
         */

        _processStandardContour(contour, primitive, ctx, depthLevels, isHole) {
            const plans = [];
            for (const depth of depthLevels) {
                const isClosed = primitive.closed ?? true;
                const plan = this.createPurePlan(contour, ctx, depth, isClosed, isHole, true);
                if (plan) {
                    this.calculatePlanBounds(plan);
                    if (isClosed) {
                        this._enforceClimbMilling(plan, isHole);
                    }
                    plans.push(plan);
                }
            }
            return plans;
        }

        _processStandardPrimitive(primitive, ctx, depthLevels) {
            const plans = [];
            const isHole = primitive.properties?.isHole || primitive.properties?.polarity === 'clear';
            const isClosed = primitive.type === 'circle' ||
                             primitive.type === 'obround' ||
                             primitive.type === 'rectangle' ||
                             (primitive.closed !== false);

            for (const depth of depthLevels) {
                const plan = this.createPurePlan(primitive, ctx, depth, isClosed, isHole, true);
                if (plan) {
                    this.calculatePlanBounds(plan);
                    if (isClosed) {
                        this._enforceClimbMilling(plan, isHole);
                    }
                    plans.push(plan);
                }
            }
            return plans;
        }

        /**
         * Processes a contour that has tabConfig attached.
         * Generates tab-segmented commands via the TabPlanner, then emits one plan per depth level with tab Z-lift metadata.
         *
         * The tab planner receives the full context (ctx) for backward compatibility. The tabConfig on the primitive acts as the signal and provides the height for Z-lift calculation.
         */
        _processTabbedContour(contour, props, ctx, depthLevels, isHole) {
            const plans = [];
            const tabConfig = props.tabConfig;

            // Generate the base 2D path
            const tempPlan = new ToolpathPlan(ctx.operationId);
            tempPlan.metadata.isClosed = true;
            this.translatePrimitiveToCutting(tempPlan, contour, 0, ctx.cutting.feedRate);

            const unsegmentedCommands = tempPlan.commands.map(cmd => {
                cmd.metadata = cmd.metadata || {};
                cmd.metadata.isTab = false;
                return cmd;
            });

            if (unsegmentedCommands.length === 0) return plans;

            // Delegate to Tab Planner to split the geometry
            let segmentedCommands = [];
            if (tabConfig.count > 0 && this.tabPlanner) {
                // Pass full ctx — tab planner reads tab width/count/height from ctx.strategy.cutout
                segmentedCommands = this.tabPlanner.calculateTabPositions(contour, ctx);
                if (debugState.enabled) {
                    const tabCount = segmentedCommands.filter(c => c.metadata?.isTab).length;
                    console.log(`[GeometryTranslator] Tab Planner: ${segmentedCommands.length} segments, ${tabCount} tabs`);
                }
            }

            // Iterate Z-depths, lifting when passing through a tab region
            const finalDepth = ctx.strategy.cutDepth;
            const tabLiftAmount = tabConfig.height || 0;
            const Z_top = finalDepth + tabLiftAmount;

            for (const depth of depthLevels) {
                const plan = this.createPurePlan(contour, ctx, depth, true, isHole, false);
                if (!plan) continue;

                const useTabbedPath = segmentedCommands.length > 0 && depth < Z_top - PRECISION;
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
                this._enforceClimbMilling(plan, isHole);
                plans.push(plan);
            }

            return plans;
        }

        /**
         * Core Translation Utilities
         */

        createPurePlan(primitive, ctx, depth, isClosed, isHole, generateCommands = true) {
            // Get all settings from the context
            const { operationId, operationType, tool, cutting, strategy } = ctx;

            const plan = new ToolpathPlan(operationId);
            plan.metadata.context = ctx; 

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

            // Apply transforms to entry/exit points
            const transforms = ctx.transforms;
            if (transforms && (transforms.mirrorX || transforms.mirrorY || transforms.rotation)) {
                // Transform Entry and Exit
                if (plan.metadata.entryPoint) {
                    const transformed = this.applyTransforms(plan.metadata.entryPoint, transforms);
                    plan.metadata.entryPoint.x = transformed.x;
                    plan.metadata.entryPoint.y = transformed.y;
                }
                if (plan.metadata.exitPoint) {
                    const transformed = this.applyTransforms(plan.metadata.exitPoint, transforms);
                    plan.metadata.exitPoint.x = transformed.x;
                    plan.metadata.exitPoint.y = transformed.y;
                }

                // Transform Geometry Centers
                if (plan.metadata.obroundData) {
                    const od = plan.metadata.obroundData;

                    // Transform centers
                    od.startCapCenter = this.applyTransforms(od.startCapCenter, transforms);
                    od.endCapCenter = this.applyTransforms(od.endCapCenter, transforms);

                    // Transform all corner points
                    if (od.pA) od.pA = this.applyTransforms(od.pA, transforms);
                    if (od.pB) od.pB = this.applyTransforms(od.pB, transforms);
                    if (od.pC) od.pC = this.applyTransforms(od.pC, transforms);
                    if (od.pD) od.pD = this.applyTransforms(od.pD, transforms);

                    // Re-link metadata.center
                    if (plan.metadata.center) {
                        plan.metadata.center = od.startCapCenter;
                    }
                }
                else if (plan.metadata.center) {
                    plan.metadata.center = this.applyTransforms(plan.metadata.center, transforms);
                }
            }

            // Generate commands only if explicitly requested
            if (generateCommands) {
                this.translatePrimitiveToCutting(plan, primitive, depth, cutting.feedRate);
            }

            // Fallback safety for missed helix centers
            if (ctx.operationType === 'drill' && ctx.strategy.entryType === 'helix' && plan.commands.length === 0) {
                // If the plan is empty but is a helix entry for drill milling, populate metadata
                if (plan.metadata.primitiveType === 'path' && primitive.arcSegments && primitive.arcSegments.length > 0) {
                    const arc = primitive.arcSegments[0];
                    const dist = Math.hypot(primitive.points[0].x - primitive.points[primitive.points.length-1].x, primitive.points[0].y - primitive.points[primitive.points.length-1].y);
                    if(primitive.arcSegments.length === 1 && dist < PRECISION) {
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
                const points = geometry.points || (geometry.contours && geometry.contours[0]?.points);

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
                this.translatePath(plan, geometry, depth, feedRate);
            }
        }

        /**
         * Translate circle to cutting commands
         */
        translateCircle(plan, primitive, depth, feedRate, clockwise) {
            const transforms = plan.metadata.context?.transforms;

            // Transform the Center
            const center = this.applyTransforms(primitive.center, transforms);
            const radius = primitive.radius;

            // Determine the Transformed Start Point
            // The primitive "starts" at 3 o'clock (0 radians) in local space.
            // Transform this point so the arc starts exactly where the Entry Point is.
            const rawStart = {
                x: primitive.center.x + primitive.radius,
                y: primitive.center.y
            };
            const transformedStart = this.applyTransforms(rawStart, transforms);

            // Always CW for climb milling (coordinates already transformed)
            const actualClockwise = true;

            // Generate Arc
            const i = center.x - transformedStart.x;
            const j = center.y - transformedStart.y;

            plan.addArc(
                transformedStart.x, 
                transformedStart.y, 
                depth, 
                i, j, 
                actualClockwise, 
                feedRate
            );
        }

        /**
         * Translate obround to cutting commands (2 lines, 2 arcs)
         */
        translateObround(plan, primitive, depth, feedRate, clockwise) {
            const transforms = plan.metadata.context?.transforms;
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

            // Transform centers
            startCapCenter = this.applyTransforms(startCapCenter, transforms);
            endCapCenter = this.applyTransforms(endCapCenter, transforms);

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

            // Always CW for climb milling
            const actualClockwise = true;

            if (actualClockwise) {
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
            // Get Transform Context
            const transforms = plan.metadata.context?.transforms;

            // Transform Absolute Points
            const start = this.applyTransforms(primitive.startPoint, transforms);
            const end = this.applyTransforms(primitive.endPoint, transforms);
            const center = this.applyTransforms(primitive.center, transforms);

            // Calculate Relative I/J for G-code
            const i = center.x - start.x;
            const j = center.y - start.y;

            // Handle Winding Direction
            let isClockwise = primitive.clockwise;

            // If mirrored, it might be necessary to flip the arc direction
            if (transforms) {
                // XOR Logic: If mirrored on X OR Y (but not both), flip direction.
                const flipped = (transforms.mirrorX ? 1 : 0) ^ (transforms.mirrorY ? 1 : 0);
                if (flipped) {
                    isClockwise = !isClockwise;
                }
            }

            // Add Linear move to Start
            plan.addLinear(start.x, start.y, depth, feedRate);

            // Check for collapsed arc (Safety)
            const minArcChordLength = 0.01;
            const chordDistance = Math.hypot(end.x - start.x, end.y - start.y);

            // Calculate actual sweep to protect full circles
            let sweep = primitive.endAngle - primitive.startAngle;
            if (isClockwise && sweep > 0) sweep -= 2 * Math.PI;
            if (!isClockwise && sweep < 0) sweep += 2 * Math.PI;

            // Only skip if the chord AND the sweep are both tiny
            if (chordDistance < minArcChordLength && Math.abs(sweep) < Math.PI) {
                plan.addLinear(end.x, end.y, depth, feedRate);
                return;
            }

            // Add Arc Command
            plan.addArc(end.x, end.y, depth, i, j, isClockwise, feedRate);
        }

        translatePath(plan, contour, depth, feedRate) {
            const points = contour.points;
            if (!points || points.length < 2) return;

            const transforms = plan.metadata.context?.transforms;
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
                    Math.abs(arc.center.x - first.center.x) < PRECISION &&
                    Math.abs(arc.center.y - first.center.y) < PRECISION &&
                    Math.abs(arc.radius - first.radius) < PRECISION
                );

                if (isFullCircle) {
                    const transformedCenter = this.applyTransforms(first.center, transforms);
                    // Use the actual start point of the path, not 3 o'clock
                    const transformedStart = this.applyTransforms(points[0], transforms);
                    // Calculate I/J relative to the transformed start
                    const i = transformedCenter.x - transformedStart.x;
                    const j = transformedCenter.y - transformedStart.y;

                    // Always CW (true) for climb milling
                    plan.addArc(
                        transformedStart.x, 
                        transformedStart.y, 
                        depth, 
                        i, j, 
                        true, 
                        feedRate
                    );
                    return;
                }
            }

            // Reconstructed full circle: single arc spanning 360° // REVIEW - it feels like a band-aid for a problem before toolpath planning.
            if (arcSegments.length === 1 && points.length <= 3) {
                const arc = arcSegments[0];
                if (arc.center && arc.radius > 0) {
                    // REVIEW - this enforcement isn't necessary, review this whole logic
                    // let sweep = arc.sweepAngle;
                    // if (sweep === undefined) {
                    //     sweep = arc.endAngle - arc.startAngle;
                    //     if (arc.clockwise && sweep > 0) sweep -= 2 * Math.PI;
                    //     if (!arc.clockwise && sweep < 0) sweep += 2 * Math.PI;
                    // }
                    const transformedCenter = this.applyTransforms(arc.center, transforms);
                    // Canonical 3 o'clock entry — matches circleToPath / translateCircle
                    const rawEntry = { x: arc.center.x + arc.radius, y: arc.center.y };
                    const canonicalEntry = this.applyTransforms(rawEntry, transforms);
                    const i_val = transformedCenter.x - canonicalEntry.x;
                    const j_val = transformedCenter.y - canonicalEntry.y;

                    plan.addArc(canonicalEntry.x, canonicalEntry.y, depth, i_val, j_val, true, feedRate);

                    // Update metadata so optimizer sees consistent entry/exit and can cluster this with other passes of the same hole
                    plan.metadata.entryPoint = { x: canonicalEntry.x, y: canonicalEntry.y, z: depth };
                    plan.metadata.exitPoint = { ...plan.metadata.entryPoint };
                    plan.metadata.isSimpleCircle = true;
                    plan.metadata.isClosedLoop = true;
                    plan.metadata.center = { x: transformedCenter.x, y: transformedCenter.y };
                    plan.metadata.radius = arc.radius;
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
                const startPoint = this.applyTransforms(points[i], transforms);
                const arc = arcMap.get(i);

                let nextIndex = (i + 1) % numPoints;
                if (nextIndex >= numPoints) nextIndex = 0;

                const endPoint = this.applyTransforms(points[nextIndex], transforms);

                    // Arc segment
                if (arc && arc.endIndex === nextIndex) {
                    const chordDistance = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);

                    let sweep = arc.sweepAngle;
                    if (sweep === undefined) {
                        sweep = arc.endAngle - arc.startAngle;
                        if (arc.clockwise && sweep > 0) sweep -= 2 * Math.PI;
                        if (!arc.clockwise && sweep < 0) sweep += 2 * Math.PI;
                    }

                    // Allow arcs with a tiny chord IF their sweep angle is massive (e.g., a full circle)
                    if ((chordDistance >= minArcChordLength || Math.abs(sweep) >= Math.PI) && arc.center && arc.radius > 0) {
                        const transformedCenter = this.applyTransforms(arc.center, transforms);
                        const i_val = transformedCenter.x - startPoint.x;
                        const j_val = transformedCenter.y - startPoint.y;

                        let clockwise = arc.clockwise;
                        // Flip for mirror
                        if (transforms) {
                            const flipped = (transforms.mirrorX ? 1 : 0) ^ (transforms.mirrorY ? 1 : 0);
                            if (flipped) clockwise = !clockwise;
                        }
                        plan.addArc(endPoint.x, endPoint.y, depth, i_val, j_val, clockwise, feedRate);
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
                }

                i = nextIndex;
                segmentsDrawn++;
            }
        }

        /**
         * Reverses a toolpath plan in-place.
         * Rebuilds the path from absolute points, correctly flipping arcs.
         */

        reversePlan(plan) {
            if (!plan || !plan.commands || plan.commands.length === 0) return;

            const commands = plan.commands;
            const newCommands = [];

            // Build an absolute point list from the original path
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

            // Iterate the point list backwards to create new commands
            // Start from the last point (new entry) and move to the first (new exit)
            for (let i = points.length - 1; i > 0; i--) {
                const startPos = points[i]; // The new start point
                const endPos = points[i - 1]; // The new end point

                // The command data is stored on the 'startPos' (original end point)
                const cmdType = startPos.cmdType;
                const feed = startPos.feed;
                const meta = startPos.metadata;

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

            // Swap entry/exit points
            const oldEntry = plan.metadata.entryPoint;
            plan.metadata.entryPoint = plan.metadata.exitPoint;
            plan.metadata.exitPoint = oldEntry;
        }

        /**
         * Enforces climb milling direction on generated commands and must be called AFTER commands are generated (post-transform).
         * Climb milling direction:
         * - External contours: CW
         * - Hole contours: CCW
         */
        _enforceClimbMilling(plan, isHole = false) {
            // Skip open paths and empty plans
            if (!plan.commands || plan.commands.length < 2) return false;
            if (!plan.metadata.isClosed && !plan.metadata.isClosedLoop) return false;

            // Build point list from generated commands
            const commandPoints = [];
            let pos = { ...plan.metadata.entryPoint };

            for (const cmd of plan.commands) {
                if (cmd.x !== null && cmd.x !== undefined) pos.x = cmd.x;
                if (cmd.y !== null && cmd.y !== undefined) pos.y = cmd.y;
                commandPoints.push({ x: pos.x, y: pos.y });
            }

            if (commandPoints.length < 3) return false;

            const isCW = GeometryUtils.isClockwise(commandPoints);
            const wantCW = !isHole; // External = CW (climb), Hole = CCW (climb)

            if (isCW !== wantCW) {
                this.reversePlan(plan);
                return true;
            }
            return false;
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

        /**
         * Geometry Utilities
         */

        /**
         * Extracts dimensional data from an obround primitive.
         */
        getObroundData(primitive) {
            if (primitive.type !== 'obround') return null;

            const slotRadius = Math.min(primitive.width, primitive.height) / 2;
            const isHorizontal = primitive.width > primitive.height;
            let startCapCenter, endCapCenter;

            // Define points A, B, C, D locally to ensure consistency with entryPoint logic
            let pA, pB, pC, pD;

            if (isHorizontal) {
                const centerY = primitive.position.y + primitive.height / 2;
                startCapCenter = { x: primitive.position.x + slotRadius, y: centerY };
                endCapCenter = { x: primitive.position.x + primitive.width - slotRadius, y: centerY };

                // Horizontal: pA is Top-Left relative to start cap (90 deg)
                pA = { x: startCapCenter.x, y: startCapCenter.y + slotRadius };
                pB = { x: startCapCenter.x, y: startCapCenter.y - slotRadius };
                pC = { x: endCapCenter.x, y: endCapCenter.y - slotRadius };
                pD = { x: endCapCenter.x, y: endCapCenter.y + slotRadius };
            } else {
                const centerX = primitive.position.x + primitive.width / 2;
                startCapCenter = { x: centerX, y: primitive.position.y + slotRadius };
                endCapCenter = { x: centerX, y: primitive.position.y + primitive.height - slotRadius };

                // Vertical: pA is Left-Middle relative to start cap (180 deg)
                pA = { x: startCapCenter.x - slotRadius, y: startCapCenter.y };
                pB = { x: startCapCenter.x + slotRadius, y: startCapCenter.y };
                pC = { x: endCapCenter.x + slotRadius, y: endCapCenter.y };
                pD = { x: endCapCenter.x - slotRadius, y: endCapCenter.y };
            }

            return {
                position: primitive.position,
                width: primitive.width,
                height: primitive.height,
                isHorizontal: isHorizontal,
                slotRadius: slotRadius,
                startCapCenter: startCapCenter,
                endCapCenter: endCapCenter,
                // Pass pre-calculated corners
                pA, pB, pC, pD
            };
        }

        applyTransforms(point, transforms) {
            if (!transforms) return point;

            let x = point.x;
            let y = point.y;

            if (transforms.mirrorX || transforms.mirrorY) {
                const cx = transforms.mirrorCenter?.x ?? transforms.origin?.x ?? 0;
                const cy = transforms.mirrorCenter?.y ?? transforms.origin?.y ?? 0;
                if (transforms.mirrorX) {
                    x = 2 * cx - x;
                }
                if (transforms.mirrorY) {
                    y = 2 * cy - y;
                }
            }

            if (transforms.rotation && transforms.rotation !== 0 && transforms.rotationCenter) {
                const rcx = transforms.rotationCenter.x;
                const rcy = transforms.rotationCenter.y;
                const rad = (transforms.rotation * Math.PI) / 180;
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);

                const dx = x - rcx;
                const dy = y - rcy;

                x = rcx + (dx * cos - dy * sin);
                y = rcy + (dx * sin + dy * cos);
            }

            return { x, y };
        }

        _isClosedPoints(points) {
            if (points.length < 2) return false;
            const first = points[0];
            const last = points[points.length - 1];
            const dx = first.x - last.x;
            const dy = first.y - last.y;
            return (dx * dx + dy * dy) < (PRECISION * PRECISION);
        }

        /**
         * Calculates total path length of a contour, handling both linear segments and arc segments. Exposed for the ToolpathTabPlanner which holds a reference to this translator instance.
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
    }

    window.GeometryTranslator = GeometryTranslator;
})();