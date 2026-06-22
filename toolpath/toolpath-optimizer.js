/*!
 * @file        toolpath/toolpath-optimizer.js
 * @description Optimizes toolpath plan objects and movement between them
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
    const EPSILON = C.precision.epsilon;
    const PRECISION = C.precision.coordinate;
    const debugState = D.debug;

    class ToolpathOptimizer {
        constructor(options = {}) {
            this.options = {
                enablePathOrdering: D.gcode.optimization.pathOrdering,
                enableSegmentSimplification: D.gcode.optimization.segmentSimplification,
                enableZLevelGrouping: D.gcode.optimization.zLevelGrouping,
                angleTolerance: 1.0,
                minSegmentLength: 0.05,
                safeZ: 5.0,
                ...options
            };

            this.stats = {
                originalPathCount: 0,
                optimizedPathCount: 0,
                originalTravelDistance: 0,
                optimizedTravelDistance: 0,
                travelDistanceSaved: 0,
                pointsRemoved: 0,
                optimizationTime: 0,
                clustersFound: 0,
                staydownLinksUsed: 0
            };
        }

        /**
         * Main optimization entry - returns ordered metadata array
         */
        optimize(pureGeometryPlans, startPos) {

            // REVIEW - 3D toolpath skip, just a safeguard that could be moved/removed in the future with other guarantees they never reach the optimizer.
            for (const plan of pureGeometryPlans) {
                const m = plan.metadata;
                m.skipReentry = m.isPeckMark || m.isDrillMilling || m.isCenterlinePath || m.is3DContour;
                m.skipSimplify = m.is3DContour;
                m.skipStaydown = m.is3DContour;
            }

            const startTime = performance.now();
            this.resetStats();
            this.stats.originalPathCount = pureGeometryPlans?.length || 0;

            if (!pureGeometryPlans || pureGeometryPlans.length === 0) {
                return [];
            }

            // Contract guarantees contextual safeZ
            this.currentRunSafeZ = pureGeometryPlans[0].metadata.context.machine.safeZ;

            // Group by tool diameter
            const plansByGroupKey = new Map();
            for (const plan of pureGeometryPlans) {
                const groupKey = plan.metadata.groupKey || 'default';
                if (!plansByGroupKey.has(groupKey)) {
                    plansByGroupKey.set(groupKey, []);
                }
                plansByGroupKey.get(groupKey).push(plan);
            }

            this.debug(`Grouped into ${plansByGroupKey.size} tool groups`);

            let finalOrderedPlans = [];
            let currentMachinePos = { ...startPos };

            // Process each tool group
            for (const [groupKey, groupPlans] of plansByGroupKey) {
                this.debug(`Optimizing Tool Group: ${groupKey} (${groupPlans.length} plans)`);
                let zLevelGroups = [groupPlans];

                // Respect ZLevelGrouping option
                if (this.options.enableZLevelGrouping) {
                    zLevelGroups = this.groupByZLevel(groupPlans);
                }

                // Process each Z-level
                for (const zGroup of zLevelGroups) {
                    if (zGroup.length === 0) continue;

                    // Respect PathOrdering option
                    if (this.options.enablePathOrdering) {
                        // Build Staydown Clusters
                        const firstPlan = zGroup[0];
                        const toolDiameter = firstPlan.metadata.toolDiameter;
                        const stepOver = firstPlan.metadata.stepOver; 

                        // Calculate theoretical Step Distance
                        const stepDistance = toolDiameter * (1.0 - (stepOver / 100.0));

                        // Strict Threshold: StepDistance + Epsilon
                        const strictThreshold = stepDistance + EPSILON;

                        // Use strict threshold
                        const clusters = this.buildStaydownClusters(zGroup, strictThreshold);

                        this.stats.clustersFound += clusters.length;

                        this.debug(`Found ${clusters.length} staydown clusters for Z-level`);

                        // Optimize inside each cluster (allowing staydown)
                        const optimizedClusters = [];
                        for (const clusterPlans of clusters) {
                            const optimizedPlans = this.optimizePathOrder(clusterPlans, currentMachinePos, { allowStaydown: true });

                            // Count staydown links
                            for (let i = 1; i < optimizedPlans.length; i++) {
                                if (optimizedPlans[i].metadata.optimization?.linkType === 'staydown') {
                                    this.stats.staydownLinksUsed++;
                                }
                            }

                            if(optimizedPlans.length > 0) {
                                optimizedClusters.push({
                                    plans: optimizedPlans,
                                    entryPoint: optimizedPlans[0].metadata.optimization?.optimizedEntryPoint || optimizedPlans[0].metadata.entryPoint,
                                    exitPoint: optimizedPlans[optimizedPlans.length - 1].metadata.exitPoint
                                });
                                currentMachinePos = optimizedPlans[optimizedPlans.length - 1].metadata.exitPoint;
                            }
                        }

                        // Optimize between clusters (forcing rapid)
                        const orderedClusters = this.optimizePathOrder(optimizedClusters, currentMachinePos, { 
                            allowStaydown: false, 
                            isClusterRun: true
                        });

                        // Flatten the results
                        for (const cluster of orderedClusters) {
                            finalOrderedPlans.push(...cluster.plans);
                        }

                        // Update machine position for next Z-level or tool-group
                        if (orderedClusters.length > 0) {
                            currentMachinePos = orderedClusters[orderedClusters.length - 1].exitPoint;
                        }

                    } else {
                        // Path ordering is OFF, just add plans in original order
                        finalOrderedPlans.push(...zGroup);
                        if (zGroup.length > 0) {
                             const lastPlan = zGroup[zGroup.length - 1];
                             currentMachinePos = lastPlan.metadata.exitPoint;
                        }
                    }
                }
            }

            // Segment Simplification
            if (this.options.enableSegmentSimplification) {
                this.debug(`Simplifying ${finalOrderedPlans.length} paths...`);
                // Simplify after ordering to preserve entry/exit points
                let totalPointsRemoved = 0;
                for (const plan of finalOrderedPlans) {
                    const originalCount = plan.commands.length;
                    this.simplifySegments(plan);
                    totalPointsRemoved += (originalCount - plan.commands.length);
                }
                this.stats.pointsRemoved = totalPointsRemoved;
                this.debug(`Removed ${totalPointsRemoved} collinear points.`);
            }

            this.stats.optimizedPathCount = finalOrderedPlans.length;
            this.stats.optimizationTime = performance.now() - startTime;

            this.debug(`Complete: ${finalOrderedPlans.length} paths ordered`);
            this.debug(`Stats:`, this.getStats());

            return finalOrderedPlans;
        }

        /**
         * Groups plans into staydown clusters using connected components algorithm
         */
        buildStaydownClusters(plans, margin) {
            const clusters = [];
            const planIndices = new Set(plans.map((_, i) => i));
            const adjacency = new Map();

            // Pre-calculate Bounding Boxes for all plans
            plans.forEach(plan => {
                if (!plan.metadata.boundingBox) {
                    plan.computeBounds();
                }
            });

            // Build adjacency list (graph edges)
            for (let i = 0; i < plans.length; i++) {
                for (let j = i + 1; j < plans.length; j++) {
                    if (this.arePlansProximate(plans[i], plans[j], margin)) {
                        if (!adjacency.has(i)) adjacency.set(i, []);
                        if (!adjacency.has(j)) adjacency.set(j, []);
                        adjacency.get(i).push(j);
                        adjacency.get(j).push(i);
                    }
                }
            }

            // Find all connected components using DFS // Review - DFS is Depth-first search?
            while (planIndices.size > 0) {
                const cluster = [];
                const startNode = planIndices.values().next().value;
                const stack = [startNode];
                planIndices.delete(startNode);

                while (stack.length > 0) {
                    const currentNode = stack.pop();
                    cluster.push(plans[currentNode]);

                    if (adjacency.has(currentNode)) {
                        for (const neighbor of adjacency.get(currentNode)) {
                            if (planIndices.has(neighbor)) {
                                planIndices.delete(neighbor);
                                stack.push(neighbor);
                            }
                        }
                    }
                }
                clusters.push(cluster);
            }

            return clusters;
        }

        /**
         * Checks if two plans are within a given margin (for staydown clustering)
         */
        arePlansProximate(planA, planB, margin) {
            // Broad Bounding Box Check (fast fail)
            const boxA = planA.metadata.boundingBox;
            const boxB = planB.metadata.boundingBox;

            const inflatedBoxA = {
                minX: boxA.minX - margin, minY: boxA.minY - margin,
                maxX: boxA.maxX + margin, maxY: boxA.maxY + margin
            };

            // Check for intersection
            if (inflatedBoxA.minX > boxB.maxX || inflatedBoxA.maxX < boxB.minX ||
                inflatedBoxA.minY > boxB.maxY || inflatedBoxA.maxY < boxB.minY) {
                return false;
            }

            // Verify actual closest distance is within margin
            const closestDist = this.findClosestDistanceBetweenPlans(planA, planB);
            return closestDist <= margin;
        }

        /**
         * Find actual closest distance between two plans
         */
        findClosestDistanceBetweenPlans(planA, planB) {
            let minSqDist = Infinity;

            // Sample points from both plans (max 20 per plan for performance)
            const pointsA = this.samplePlanPoints(planA, 20);
            const pointsB = this.samplePlanPoints(planB, 20);

            for (const pA of pointsA) {
                for (const pB of pointsB) {
                    const dx = pB.x - pA.x;
                    const dy = pB.y - pA.y;
                    const sqDist = dx * dx + dy * dy;
                    if (sqDist < minSqDist) {
                        minSqDist = sqDist;
                    }
                }
            }
            return Math.sqrt(minSqDist);
        }

        /**
         * Sample representative points from a plan
         */
        samplePlanPoints(plan, maxPoints) {
            const points = plan.commands
                .filter(c => c.x !== null && c.y !== null)
                .map(c => ({x: c.x, y: c.y}));

            if (points.length <= maxPoints) {
                return points;
            }

            // Sample evenly distributed points
            const sampled = [];
            const step = points.length / maxPoints;
            for (let i = 0; i < maxPoints; i++) {
                const idx = Math.floor(i * step);
                sampled.push(points[idx]);
            }
            return sampled;
        }

        /**
         * Group paths by Z cutting depth
         */
        groupByZLevel(plans) {
            const groups = new Map();

            for (const plan of plans) {
                const zKey = Math.round((plan.metadata.cutDepth || 0) * 1000) / 1000;
                if (!groups.has(zKey)) {
                    groups.set(zKey, []);
                }
                groups.get(zKey).push(plan);
            }

            return Array.from(groups.values()).sort((a, b) => 
                (b[0].metadata.cutDepth || 0) - (a[0].metadata.cutDepth || 0)
            );
        }

        /**
         * Optimize path order using nearest neighbor with link cost analysis
         */
        optimizePathOrder(plans, startPos, options = { allowStaydown: false, isClusterRun: false }) {
            if (plans.length <= 1) return plans;

            const ordered = [];
            const remaining = [...plans];
            let currentPos = { ...startPos };

            let totalOriginalTravel = 0;
            let totalOptimizedTravel = 0;

            // Calculate original travel distance
            let pos = { ...startPos };
            for (const item of plans) {
                // Support both ToolpathPlan (metadata.entryPoint) and Cluster (entryPoint) objects
                const entry = item.entryPoint || item.metadata.entryPoint;
                const dx = entry.x - pos.x;
                const dy = entry.y - pos.y;
                totalOriginalTravel += Math.sqrt(dx * dx + dy * dy);
                pos = item.exitPoint || item.metadata.exitPoint;
            }

            // Nearest neighbor with link cost
            while (remaining.length > 0) {
                let bestIdx = 0;
                let bestResult = this.calculatePathLinkCost(currentPos, remaining[0], options.allowStaydown);
                let bestDist = bestResult.cost;

                // Search all remaining plans
                for (let i = 1; i < remaining.length; i++) {
                    const result = this.calculatePathLinkCost(currentPos, remaining[i], options.allowStaydown);
                    if (result.cost < bestDist) {
                        bestDist = result.cost;
                        bestIdx = i;
                        bestResult = result;
                    }
                }

                const chosen = remaining.splice(bestIdx, 1)[0];

                // Handle cluster run differently
                if (options.isClusterRun) {
                    if (chosen.plans && chosen.plans.length > 0) {
                        chosen.plans[0].metadata.optimization = {
                            linkType: bestResult.linkType,
                            originalEntryPoint: chosen.plans[0].metadata.entryPoint,
                            optimizedEntryPoint: bestResult.bestPoint,
                            entryCommandIndex: 0 
                        };
                    }

                    ordered.push(chosen);
                    totalOptimizedTravel += bestResult.realDistance;
                    currentPos = { ...chosen.exitPoint };
                    continue;
                }

                // Store optimization decision in plan
                chosen.metadata.optimization = {
                    linkType: bestResult.linkType,
                    originalEntryPoint: chosen.metadata.entryPoint,
                    optimizedEntryPoint: bestResult.bestPoint,
                    entryCommandIndex: bestResult.commandIndex
                };

                // Apply rotation if beneficial and safe
                if (bestResult.commandIndex > 0) {
                    // Only rotate if it's not a drill operation.
                    // Rotate paths with arcs if a staydown point on them was selected, otherwise the machine feeds to the old entry point.
                    if (!chosen.metadata.isPeckMark && !chosen.metadata.isDrillMilling) {
                        if (chosen.metadata.isSimpleCircle) {
                            this.rotateCircleEntry(chosen, currentPos);
                        } else if (chosen.metadata.isClosedLoop) {
                            this.rotatePlanCommands(chosen, bestResult.commandIndex);
                        }
                    }
                }

                ordered.push(chosen);
                totalOptimizedTravel += bestResult.realDistance;
                currentPos = { ...chosen.metadata.exitPoint };
            }

            this.stats.originalTravelDistance += totalOriginalTravel;
            this.stats.optimizedTravelDistance += totalOptimizedTravel;
            this.stats.travelDistanceSaved += (totalOriginalTravel - totalOptimizedTravel);

            return ordered;
        }

        /**
         * Calculate cost and link type for traveling between paths
         */
        calculatePathLinkCost(fromPos, toPlan, allowStaydown = false) {
            // Handle cluster objects (used when optimizing between clusters)
            if (toPlan.plans && toPlan.entryPoint) { // Check if it's a cluster object
                const bestPoint = toPlan.entryPoint;
                const dx = bestPoint.x - fromPos.x;
                const dy = bestPoint.y - fromPos.y;
                const closestXYDist = Math.sqrt(dx * dx + dy * dy);
                // Clusters always use rapid moves between them
                const rapidCost = this.calculateRapidCost(fromPos, bestPoint, closestXYDist);
                return {
                    cost: rapidCost,
                    realDistance: closestXYDist,
                    linkType: 'rapid',
                    bestPoint: bestPoint,
                    commandIndex: 0 // Cannot rotate entry of a whole cluster
                };
            }

            // Standard Plan Processing
            const planMetadata = toPlan.metadata || {}; // Ensure metadata exists

            // Ensure required fields exist with defaults
            planMetadata.exitPoint = planMetadata.exitPoint || planMetadata.entryPoint;
            planMetadata.isPeckMark = planMetadata.isPeckMark || false;
            planMetadata.isDrillMilling = planMetadata.isDrillMilling || false;
            planMetadata.isCenterlinePath = planMetadata.isCenterlinePath || false;

            // Check if staydown is possible and allowed for this link
            const canStaydown = allowStaydown &&
                               !planMetadata.isPeckMark && // Never staydown for drills
                               !planMetadata.isDrillMilling && // Or drill milling
                               Math.abs(fromPos.z - planMetadata.entryPoint.z) < 0.01; // Must be at same Z

            if (canStaydown) {
                const dxEntry = planMetadata.entryPoint.x - fromPos.x;
                const dyEntry = planMetadata.entryPoint.y - fromPos.y;
                const originalEntryDist = Math.sqrt(dxEntry * dxEntry + dyEntry * dyEntry);

                // Use calculated stepDistance + tolerance
                const toolDiameter = planMetadata.toolDiameter;
                // Get stepOver from settings
                const stepOverPercent = planMetadata.stepOver;
                const stepOverRatio = stepOverPercent / 100.0;
                const stepDistance = toolDiameter * (1.0 - stepOverRatio);

                // Threshold is the expected step distance plus a small tolerance
                const staydownThreshold = stepDistance + EPSILON;

                this.debug(`Plan ${planMetadata.operationId} (Pass ${planMetadata.pass || 1}): ToolD=${toolDiameter.toFixed(3)}, StepOver=${stepOverPercent}%, StepDist=${stepDistance.toFixed(3)}, Threshold=${staydownThreshold.toFixed(3)}`);
                this.debug(`   Original Entry Dist: ${originalEntryDist.toFixed(3)}`);

                // Option 1: Use original entry point if close enough (no rotation needed)
                if (originalEntryDist <= staydownThreshold) {
                    this.debug(`   >> Using Original Entry (Staydown) - Within Threshold`);
                    return {
                        cost: originalEntryDist, // Cost is just XY distance for staydown
                        realDistance: originalEntryDist,
                        linkType: 'staydown',
                        bestPoint: planMetadata.entryPoint,
                        commandIndex: 0 // No rotation
                    };
                }

                // Option 2: Find the closest point on the path and consider rotation
                // (findClosestPointOnPlan already handles drill safety and circle analytics)
                const { point: closestPoint, distance: closestDist, commandIndex } =
                    this.findClosestPointOnPlan(fromPos, toPlan);

                // Check if rotating to the closest point is worthwhile AND within threshold
                // Only use rotation if:
                // 1. Closest distance is within staydown threshold
                // 2. Savings vs original entry are significant (>30% improvement)
                // 3. Rotation is actually possible (commandIndex > 0)
                if (closestDist <= staydownThreshold &&
                    closestDist < originalEntryDist * 0.7 && // Significant improvement
                    commandIndex > 0)
                {
                    this.debug(`   >> Using Rotated Entry (Staydown), Dist: ${closestDist.toFixed(3)}, Index: ${commandIndex}`);
                    return {
                        cost: closestDist, // Cost is just XY distance
                        realDistance: closestDist,
                        linkType: 'staydown',
                        bestPoint: closestPoint,
                        commandIndex: commandIndex // Signal rotation
                    };
                }
                    this.debug(`   Closest point dist (${closestDist.toFixed(3)}) too far or not worth rotating.`);
            }

            // Default: Use Rapid Link
            // Find closest point (again, or for the first time if staydown wasn't possible)
            // This allows rapid links to also benefit from entry point rotation if possible.
            const { point: bestRapidPoint, distance: closestRapidXYDist, commandIndex: rapidCommandIndex } =
                this.findClosestPointOnPlan(fromPos, toPlan);

            const rapidCost = this.calculateRapidCost(fromPos, bestRapidPoint, closestRapidXYDist);

            if (debugState.enabled) {
                const reason = !allowStaydown ? "Not Allowed" : (planMetadata.isPeckMark || planMetadata.isDrillMilling) ? "Drill Op" : "Too Far";
                console.log(`[Optimizer]   >> Using Rapid Link (${reason}). Cost: ${rapidCost.toFixed(1)}, Dist: ${closestRapidXYDist.toFixed(3)}, Index: ${rapidCommandIndex}`);
            }

            return {
                cost: rapidCost,
                realDistance: closestRapidXYDist,
                linkType: 'rapid',
                bestPoint: bestRapidPoint,
                commandIndex: rapidCommandIndex // Allow rapid links to rotate too
            };
        }

        /**
         * Helper for rapid cost calculation
         */
        calculateRapidCost(fromPos, toPos, xyDist) {
            // Get optimization config
            const rapidConfig = D.toolpath.generation.rapidCost;
            const zTravelThreshold = rapidConfig.zTravelThreshold;
            const zCostFactor = rapidConfig.zCostFactor;
            const baseCost = rapidConfig.baseCost;

            const activeSafeZ = this.currentRunSafeZ ?? this.options.safeZ;
            let zCost;

            if (xyDist < zTravelThreshold) {
                const travelZ = fromPos.z < 0 ? activeSafeZ * 0.4 : fromPos.z;
                zCost = Math.abs(travelZ - fromPos.z) + Math.abs(toPos.z - travelZ);
            } else {
                zCost = Math.abs(activeSafeZ - fromPos.z) + Math.abs(toPos.z - activeSafeZ);
            }

            return (xyDist + zCost * zCostFactor) + baseCost;
        }

        /**
         * Find closest point on a plan
         */
        findClosestPointOnPlan(fromPos, plan) {
            const meta = plan.metadata;

            // Do not optimize entry points for ANY drill operations
            if (meta.isPeckMark || meta.isDrillMilling || meta.isCenterlinePath) { // Review - circles can be rotated and centerline path start/end points are interchangeable.
                const dx = meta.entryPoint.x - fromPos.x;
                const dy = meta.entryPoint.y - fromPos.y;
                return { point: meta.entryPoint, distance: Math.sqrt(dx * dx + dy * dy), commandIndex: 0 };
            }

            // Circle-specific optimization
            if (meta.isSimpleCircle) {
                const arcCmd = plan.commands.find(cmd => cmd.type === 'ARC_CW' || cmd.type === 'ARC_CCW');
                const entryCmd = plan.commands[0];

                if (arcCmd && entryCmd) {
                    const centerX = entryCmd.x + arcCmd.i;
                    const centerY = entryCmd.y + arcCmd.j;
                    const radius = Math.hypot(arcCmd.i, arcCmd.j);
                    const vecX = fromPos.x - centerX;
                    const vecY = fromPos.y - centerY;
                    const vecMagSq = vecX * vecX + vecY * vecY;

                    // REVIEW - Why isn't this epsilon linked to config?
                    if (vecMagSq > 1e-12) {
                        const vecMag = Math.sqrt(vecMagSq);
                        const idealX = centerX + (vecX / vecMag) * radius;
                        const idealY = centerY + (vecY / vecMag) * radius;
                        const dxIdeal = idealX - fromPos.x;
                        const dyIdeal = idealY - fromPos.y;
                        return { 
                            point: { x: idealX, y: idealY }, 
                            distance: Math.sqrt(dxIdeal * dxIdeal + dyIdeal * dyIdeal), 
                            commandIndex: 0 
                        };
                    }
                }
            }

            // Path searching
            const canRotate = meta.isClosedLoop;
            let bestPoint = meta.entryPoint;
            const dxEntry = bestPoint.x - fromPos.x;
            const dyEntry = bestPoint.y - fromPos.y;
            let bestDistSq = (dxEntry * dxEntry + dyEntry * dyEntry);
            let bestIndex = 0;

            if (plan.commands.length > 0) {
                // Search for closest point
                for (let i = 0; i < plan.commands.length; i++) {
                    const cmd = plan.commands[i];

                    // MotionCommand guarantees null if missing, no undefined check needed
                    if (cmd.x === null || cmd.y === null) continue;

                    const dx = cmd.x - fromPos.x;
                    const dy = cmd.y - fromPos.y;
                    const distSq = (dx * dx + dy * dy);

                    if (distSq < bestDistSq) {
                        bestDistSq = distSq;
                        bestPoint = { x: cmd.x, y: cmd.y };
                        if (canRotate) {
                            bestIndex = i;
                        }
                    }
                }
            }

            // Only perform the expensive square root once at the very end
            return { point: bestPoint, distance: Math.sqrt(bestDistSq), commandIndex: bestIndex };
        }

        /**
         * Rotate plan entry point for closed loops
         */
        rotatePlanCommands(plan, newEntryIndex) {
            if (newEntryIndex <= 0 || newEntryIndex >= plan.commands.length) return;

            // Identify the pivot command (the one that leads TO the new start point)
            const pivotCmd = plan.commands[newEntryIndex];

            // Split the commands
            // Pre-Pivot: Commands before the pivot (0 to newEntryIndex - 1)
            const prePivot = plan.commands.slice(0, newEntryIndex);

            // Post-Pivot: Commands after the pivot (newEntryIndex + 1 to end)
            // Skip newEntryIndex here because it must move to the end of the sequence
            const postPivot = plan.commands.slice(newEntryIndex + 1);

            // Check for implicit closure and create a bridge if necessary
            // Does the last command of the original path connect back to the Original Entry?
            const originalEntryPoint = plan.metadata.entryPoint;
            const lastCmd = plan.commands[plan.commands.length - 1];

            const dx = (lastCmd.x || 0) - originalEntryPoint.x;
            const dy = (lastCmd.y || 0) - originalEntryPoint.y;
            const distToOriginalEntry = Math.sqrt(dx * dx + dy * dy);

            const newCommands = [...postPivot];

            // If implicit loop (gap > epsilon), insert a linear bridge move
            if (distToOriginalEntry > PRECISION) {
                 const bridgeCmd = new MotionCommand(
                    'LINEAR',
                    { 
                        x: originalEntryPoint.x, 
                        y: originalEntryPoint.y, 
                        z: lastCmd.z !== null ? lastCmd.z : plan.metadata.cutDepth
                    },
                    { feed: plan.metadata.feedRate }
                );
                newCommands.push(bridgeCmd);
            }

            // Reassemble: Post -> Bridge -> Pre -> Pivot
            // The pivot command (Old Start -> New Start) must be the LAST move in the new loop.
            newCommands.push(...prePivot);
            newCommands.push(pivotCmd);

            // Apply
            plan.commands = newCommands;

            // Update Entry/Exit Metadata
            plan.metadata.entryPoint = { 
                x: pivotCmd.x, 
                y: pivotCmd.y, 
                z: pivotCmd.z !== null ? pivotCmd.z : plan.metadata.cutDepth
            };
            // Since the loop was closed (explicitly or via logic), exit = entry
            plan.metadata.exitPoint = plan.metadata.entryPoint;
        }

        /**
         * Rotate circle entry to closest point
         */
        // REVIEW - Not that this seems to be wired up properly yet but does it keep correct winding post-rotation? Only entry-point should move.
        rotateCircleEntry(plan, fromPos) {
            const center = plan.metadata.center;
            const radius = plan.metadata.radius;
            const feedRate = plan.metadata.feedRate; // Review - Rorate circle shouldn't be adding commands? It should rotate circle entrypoints to minimize rapid movements
            const clockwise = plan.metadata.direction === 'conventional';
            const depth = plan.metadata.cutDepth;

            if (!center || !radius) return;

            const dx = fromPos.x - center.x;
            const dy = fromPos.y - center.y;
            const distToCenter = Math.sqrt(dx * dx + dy * dy);

            if (distToCenter < PRECISION) return;

            const newEntryX = center.x + (dx / distToCenter) * radius;
            const newEntryY = center.y + (dy / distToCenter) * radius;

            plan.commands = [];

            const i_val = center.x - newEntryX;
            const j_val = center.y - newEntryY;
            plan.commands.push(new MotionCommand(clockwise ? 'ARC_CW' : 'ARC_CCW',
                { x: newEntryX, y: newEntryY, z: depth },
                { i: i_val, j: j_val, feed: feedRate }
            ));

            plan.metadata.entryPoint = { x: newEntryX, y: newEntryY, z: depth };
            plan.metadata.exitPoint = { x: newEntryX, y: newEntryY, z: depth };
        }

        /**
         * Simplify path by removing collinear points, aware of arcs.
         */
        simplifySegments(plan) {
            if (!plan.commands || plan.commands.length < 3) return;

            const simplified = [];
            const commands = plan.commands;
            let i = 0;

            // Track the end position of the last added command
            let currentPos = { x: null, y: null, z: null };
            if (plan.metadata.entryPoint) {
                currentPos = { ...plan.metadata.entryPoint };
            }

            const isIgnorableArcCmd = (c, start, end) => {
                if (c.type !== 'ARC_CW' && c.type !== 'ARC_CCW') return false;
                const dx = end.x - start.x;
                const dy = end.y - start.y;
                const iVal = c.i || 0;
                const jVal = c.j || 0;

                const isHelical = c.z !== null && Math.abs(c.z - start.z) > PRECISION; 

                return !isHelical && (dx * dx + dy * dy) < PRECISION && (iVal * iVal + jVal * jVal) < PRECISION;
            };

            const precisionSq = PRECISION * PRECISION;

            while (i < commands.length) {
                const cmd = commands[i];

                // If this command is a TAB (Z-move/geometry break), preserve it immediately and break any simplification sequence.
                if (cmd.metadata && cmd.metadata.isTab === true) {
                    simplified.push(cmd);
                    // Update currentPos to this command's end, if it has coords
                    if (cmd.x !== null && cmd.y !== null) {
                        currentPos = { x: cmd.x, y: cmd.y, z: cmd.z !== null ? cmd.z : currentPos.z };
                    }
                    i++;
                    continue;
                }

                // Resolve the absolute target position of this command
                const cmdTargetPos = {
                    x: cmd.x !== null ? cmd.x : currentPos.x,
                    y: cmd.y !== null ? cmd.y : currentPos.y,
                    z: cmd.z !== null ? cmd.z : currentPos.z
                };

                // If it's a significant non-linear move, add it and continue.
                if (cmd.type !== 'LINEAR' && !isIgnorableArcCmd(cmd, currentPos, cmdTargetPos)) {
                    simplified.push(cmd);
                    currentPos = cmdTargetPos; // Update position
                    i++;
                    continue; // Move to the next command
                }

                // If it Is linear or an ignorable arc, process it as part of a linear sequence.
                // The true start point of this sequence is the `currentPos` from before this command.
                const sequenceStartPoint = { ...currentPos };
                const linearSequenceCmds = [];
                let sequenceEndPoint = cmdTargetPos; // End point of the *first* command

                // It's either LINEAR or an ignorable ARC here
                if (cmd.type !== 'LINEAR') {
                    linearSequenceCmds.push(new MotionCommand('LINEAR', { x: cmd.x, y: cmd.y, z: cmd.z }, { feed: cmd.f }));
                } else {
                    linearSequenceCmds.push(cmd); // It's the first linear cmd
                }

                // Greedily gather all subsequent linear OR ignorable arc commands
                let j = i + 1;
                while (j < commands.length) {
                    const nextCmd = commands[j];

                    // Stop gathering when hitting a tab command
                    if (nextCmd.metadata && nextCmd.metadata.isTab === true) break;

                    const nextCmdTargetPos = {
                        x: nextCmd.x !== null ? nextCmd.x : sequenceEndPoint.x,
                        y: nextCmd.y !== null ? nextCmd.y : sequenceEndPoint.y,
                        z: nextCmd.z !== null ? nextCmd.z : sequenceEndPoint.z
                    };

                    if (nextCmd.type === 'LINEAR' || isIgnorableArcCmd(nextCmd, sequenceEndPoint, nextCmdTargetPos)) {
                        if (nextCmd.type !== 'LINEAR') {
                            linearSequenceCmds.push(new MotionCommand('LINEAR', { x: nextCmd.x, y: nextCmd.y, z: nextCmd.z }, { feed: nextCmd.f }));
                        } else {
                            linearSequenceCmds.push(nextCmd);
                        }
                        sequenceEndPoint = nextCmdTargetPos; // Update the end of the sequence
                        j++;
                    } else {
                        // It's a significant arc or other command, stop gathering.
                        break;
                    }
                }

                // Full sequence:
                // Start Point: sequenceStartPoint
                // Commands:    linearSequenceCmds (e.g., [L1, L2, L3])
                // End Point:   sequenceEndPoint

                // Build the full point list for this sequence
                const points = [{ ...sequenceStartPoint, isStart: true, cmd: null }];
                let tempPos = sequenceStartPoint;
                let lastPushedPoint = sequenceStartPoint;

                // Create a point-in-time snapshot for each command
                for (const linearCmd of linearSequenceCmds) {
                    tempPos = {
                        x: linearCmd.x !== null ? linearCmd.x : tempPos.x,
                        y: linearCmd.y !== null ? linearCmd.y : tempPos.y,
                        z: linearCmd.z !== null ? linearCmd.z : tempPos.z
                    };

                    // Check for zero-length segments / duplicate start point
                    const dx = tempPos.x - lastPushedPoint.x;
                    const dy = tempPos.y - lastPushedPoint.y;
                    const dz = tempPos.z - lastPushedPoint.z;
                    const distSq = dx * dx + dy * dy + dz * dz;

                    // Deduplicate microscopic moves before running the heavy collinear simplifier
                    // This prevents NaN errors in angle calculations later
                    if (distSq > precisionSq) {
                        points.push({ ...tempPos, isStart: false, cmd: linearCmd });
                        lastPushedPoint = tempPos;
                    } else if (points.length > 0) {
                        // This is a zero-length move or the duplicate first point.
                        // Do not add the point, but do attach its command (e.g., feed rate) to the previous point. This ensures the command isn't lost. // Review - attaching random feed commands to previous points could be dangerous
                        points[points.length - 1].cmd = linearCmd;
                    }
                }

                // Simplify this point sequence using a collinear check
                const simplifiedPoints = this.simplifyCollinearPoints(points);

                // Rebuild command list from simplified points
                for (const pt of simplifiedPoints) {
                    if (pt.cmd) { 
                        simplified.push(pt.cmd);
                    }
                }

                // Update position and main loop index
                currentPos = sequenceEndPoint;
                i = j;
            }

            plan.commands = simplified;
        }

        /**
         * Simplifies a point sequence by removing collinear points based on deviation and angle.
         */
        simplifyCollinearPoints(points) {
            if (points.length <= 2) {
                return points; // Not enough points to simplify
            }

            const simplified = [points[0]]; // Always keep the start point

            const simpConfig = D.toolpath.generation.simplification;
            const curveTolerance = simpConfig.curveToleranceFallback;
            const straightTolerance = simpConfig.straightToleranceFallback;
            const sharpCornerTolerance = simpConfig.sharpCornerTolerance;
            const straightAngleThreshold = simpConfig.straightAngleThreshold; 
            const sharpAngleThreshold = simpConfig.sharpAngleThreshold;

            for (let i = 1; i < points.length - 1; i++) {
                const p0 = simplified[simplified.length - 1]; // Last kept point
                const p1 = points[i];
                const p2 = points[i + 1];

                // Calculate deviation distance (how far p1 is from line p0-p2)
                const distSq = this.perpendicularDistanceSq(p1, p0, p2);

                const v1x = p1.x - p0.x;
                const v1y = p1.y - p0.y;
                const v2x = p2.x - p1.x;
                const v2y = p2.y - p1.y;

                // Pre-calculate magnitude squares
                const mag1Sq = v1x * v1x + v1y * v1y;
                const mag2Sq = v2x * v2x + v2y * v2y;
                const tolSq = PRECISION * PRECISION;

                let angle = 0;
                // Only calculate angle if segments are not zero-length
                if (mag1Sq > tolSq && mag2Sq > tolSq) { 
                    const mag1 = Math.sqrt(mag1Sq);
                    const mag2 = Math.sqrt(mag2Sq);

                    const dot = v1x * v2x + v1y * v2y;
                    // Clamp to avoid floating point errors with acos()
                    const cosTheta = Math.max(-1.0, Math.min(1.0, dot / (mag1 * mag2)));
                    angle = Math.acos(cosTheta) * (180 / Math.PI); // Angle 0-180
                }

                // Determine nuanced tolerance based on the angle
                let effectiveTolerance;
                if (angle > sharpAngleThreshold) {
                    // This is a sharp corner. Be extremely strict to preserve it.
                    effectiveTolerance = sharpCornerTolerance;
                } else if (angle < straightAngleThreshold) {
                    // This is a straight line. Be aggressive/loose.
                    effectiveTolerance = straightTolerance;
                } else {
                    // This is a gentle curve. Use the standard curve tolerance.
                    effectiveTolerance = curveTolerance;
                }

                // Keep the point ONLY if it deviates more than the nuanced tolerance
                if (distSq >= (effectiveTolerance * effectiveTolerance)) {
                    simplified.push(p1); 
                }
                // If dist < effectiveTolerance, p1 is dropped.
            }

            simplified.push(points[points.length - 1]); // Always keep the end point
            return simplified;
        }

        /**
         * Calculates the squared perpendicular distance from a point to a line segment.
         */
        perpendicularDistanceSq(point, lineStart, lineEnd) {
            const dx = lineEnd.x - lineStart.x;
            const dy = lineEnd.y - lineStart.y;

            const lengthSquared = (dx * dx) + (dy * dy);

            // If the line segment is essentially a single point, return the squared distance to that point
            if (lengthSquared < 1e-12) { 
                const pdx = point.x - lineStart.x;
                const pdy = point.y - lineStart.y;
                return (pdx * pdx) + (pdy * pdy);
            }

            // Project point onto the line segment to find the intersection factor 't'
            let t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lengthSquared;

            // Clamp t to [0, 1] so the intersection stays within the physical line segment
            t = Math.max(0, Math.min(1, t)); 

            // Calculate the exact intersection coordinates
            const projX = lineStart.x + t * dx;
            const projY = lineStart.y + t * dy;

            // Calculate the delta between our point and the intersection
            const pdx = point.x - projX;
            const pdy = point.y - projY;

            // Return the squared distance
            return (pdx * pdx) + (pdy * pdy);
        }

        getStats() {
            return {
                ...this.stats,
                travelSavedPercent: this.stats.originalTravelDistance > 0
                    ? ((this.stats.travelDistanceSaved / this.stats.originalTravelDistance) * 100).toFixed(1)
                    : 0
            };
        }

        resetStats() {
            this.stats = {
                originalPathCount: 0,
                optimizedPathCount: 0,
                originalTravelDistance: 0,
                optimizedTravelDistance: 0,
                travelDistanceSaved: 0,
                pointsRemoved: 0,
                optimizationTime: 0,
                clustersFound: 0,
                staydownLinksUsed: 0
            };
        }

        debug(message, data = null) {
            if (!debugState.enabled) return;
            data ? console.log(`[Optimizer] ${message}`, data)
                 : console.log(`[Optimizer] ${message}`);
        }
    }

    window.ToolpathOptimizer = ToolpathOptimizer;
})();