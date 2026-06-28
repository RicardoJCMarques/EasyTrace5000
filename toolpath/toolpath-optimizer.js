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
                angleTolerance: 1.0,
                minSegmentLength: 0.05,
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
         * Main optimization entry.
         * Plans are flat 2D features - depth is passthrough metadata
         * used exclusively by the MachineProcessor later.
         */
        optimize(pureGeometryPlans, startPos) {

            const startTime = performance.now();
            this.resetStats();
            this.stats.originalPathCount = pureGeometryPlans?.length || 0;

            if (!pureGeometryPlans || pureGeometryPlans.length === 0) {
                return [];
            }

            // Group by tool+operation
            const plansByGroupKey = new Map();
            for (const plan of pureGeometryPlans) {
                const groupKey = plan.metadata.groupKey || 'default';
                if (!plansByGroupKey.has(groupKey)) {
                    plansByGroupKey.set(groupKey, []);
                }
                plansByGroupKey.get(groupKey).push(plan);
            }

            this.debug(`Grouped into ${plansByGroupKey.size} groups`);

            let finalOrderedPlans = [];
            let currentMachinePos = { ...startPos };

            // Process each group
            for (const [groupKey, groupPlans] of plansByGroupKey) {
                this.debug(`Optimizing Tool Group: ${groupKey} (${groupPlans.length} plans)`);

                if (!this.options.enablePathOrdering) {
                    finalOrderedPlans.push(...groupPlans);
                    if (groupPlans.length > 0) {
                        currentMachinePos = groupPlans[groupPlans.length - 1].metadata.exitPoint;
                    }
                    continue;
                }

                const policy = groupPlans[0]?.metadata?.toolpathPolicy || {};
                const partition = policy.staydownPartition || 'shape';

                const { regions, allowStaydown } = this.buildRegions(groupPlans, partition);
                const skipShapeGuard = (partition === 'proximity');

                // Wrap regions in proxies for cluster-level sorting
                const clusterProxies = regions.map(regionPlans => ({
                    plans: regionPlans,
                    entryPoint: regionPlans[0].metadata.entryPoint,
                    exitPoint: regionPlans[regionPlans.length - 1].metadata.exitPoint
                }));

                // Sort the clusters globally, starting from currentMachinePos
                let seq = this.optimizePathOrder(clusterProxies, currentMachinePos, {
                    allowStaydown: false, isClusterRun: true
                });

                seq = this.refineRegionOrder(seq, currentMachinePos);

                // Optimize the actual toolpaths WITHIN each sorted cluster
                for (const cluster of seq) {
                    const ordered = this.optimizePathOrder(cluster.plans, currentMachinePos, {
                        allowStaydown, skipShapeGuard
                    });

                    // Count staydown links
                    for (let i = 1; i < ordered.length; i++) {
                        if (ordered[i].metadata.optimization?.linkType === 'staydown') {
                            this.stats.staydownLinksUsed++;
                        }
                    }

                    if (ordered.length) {
                        finalOrderedPlans.push(...ordered);
                        currentMachinePos = ordered[ordered.length - 1].metadata.exitPoint;
                    }
                }
            }

            // Segment simplification
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
        buildStaydownClusters(plans, margin, usePassAdjacency = true) {
            const clusters = [];
            const planIndices = new Set(plans.map((_, i) => i));
            const adjacency = new Map();

            // Pre-calculate Bounding Boxes for all plans
            plans.forEach(plan => {
                if (!plan.metadata.boundingBox) {
                    plan.computeBounds();
                }
            });

            // Two plans are connected if they are spatially close OR (within one
            // shape) they are consecutive offset passes. Pass-adjacency is the
            // generator's connectivity guarantee and is robust on concave shapes
            // where vertex sampling under-reports closeness.
            const adjacentPass = (a, b) => {
                if (!usePassAdjacency) return false;
                const pa = a.metadata.pass, pb = b.metadata.pass;
                if (pa === null || pa === undefined || pb === null || pb === undefined) return false;
                return Math.abs(pa - pb) === 1;
            };

            // Build adjacency list (graph edges)
            for (let i = 0; i < plans.length; i++) {
                for (let j = i + 1; j < plans.length; j++) {
                    if (adjacentPass(plans[i], plans[j]) ||
                        this.arePlansProximate(plans[i], plans[j], margin)) {
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
            // Sample points on one side, test against the OTHER side's segments, both
            // directions. Catches mid-segment close approaches between near-parallel
            // offset lines that vertex-to-vertex sampling missed (false "too far").
            const ptsA = this.samplePlanPoints(planA, 24);
            const ptsB = this.samplePlanPoints(planB, 24);
            const segA = this.samplePlanPoints(planA, 64);
            const segB = this.samplePlanPoints(planB, 64);

            let minSq = Infinity;
            const scan = (pts, seg) => {
                if (!seg || seg.length === 0) return;
                for (const p of pts) {
                    if (seg.length === 1) {
                        const dx = p.x - seg[0].x;
                        const dy = p.y - seg[0].y;
                        const sq = dx * dx + dy * dy;
                        if (sq < minSq) minSq = sq;
                    } else {
                        for (let i = 1; i < seg.length; i++) {
                            const sq = GeometryUtils.getSqDistToSegment(p, seg[i - 1], seg[i]);
                            if (sq < minSq) minSq = sq;
                        }
                    }
                }
            };
            scan(ptsA, segB);
            scan(ptsB, segA);
            return Math.sqrt(minSq);
        }

        /**
         * Sample representative points from a plan
         */
        samplePlanPoints(plan, maxPoints) {
            // A full circle is emitted as ONE arc command, so command sampling
            // yields a single point and every proximity / closest-distance test
            // collapses (the circle can never join a stay-down cluster). Walk the
            // real circumference instead. isSimpleCircle is set for analytic
            // circles AND, via analyzePrimitive, for arc-reconstructed circular
            // paths, so this one gate covers both populations.
            if (plan.metadata?.isSimpleCircle) {
                const arcCmd = plan.commands.find(c => c.type === 'ARC_CW' || c.type === 'ARC_CCW');
                const entryCmd = plan.commands[0];
                const centerX = plan.metadata.center?.x ?? ((arcCmd && entryCmd) ? entryCmd.x + arcCmd.i : undefined);
                const centerY = plan.metadata.center?.y ?? ((arcCmd && entryCmd) ? entryCmd.y + arcCmd.j : undefined);
                const radius  = plan.metadata.radius ?? (arcCmd ? Math.hypot(arcCmd.i, arcCmd.j) : undefined);
                if (centerX !== undefined && centerY !== undefined && radius > 0) {
                    const pts = [];
                    for (let k = 0; k <= maxPoints; k++) {
                        const a = (k / maxPoints) * Math.PI * 2;
                        pts.push({ x: centerX + Math.cos(a) * radius, y: centerY + Math.sin(a) * radius });
                    }
                    return pts;
                }
            }

            const points = plan.commands
                .filter(c => c.x !== null && c.y !== null)
                .map(c => ({ x: c.x, y: c.y }));

            if (points.length <= maxPoints) {
                return points;
            }

            // Sample evenly distributed points
            const sampled = [];
            const step = points.length / maxPoints;
            for (let i = 0; i < maxPoints; i++) {
                sampled.push(points[Math.floor(i * step)]);
            }
            return sampled;
        }

        /**
         * Partition a tool-group's plans into regions, two levels deep.
         *
         * @param {string} partition - 'shape' (hard wall per shapeKey) or
         *   'proximity' (connected-by-stepover clusters, ignores shapeKey).
         *
         * IDENTITY (shapeKey): a hard partition that staydown must
         *   never cross. This is the gouge boundary between separate source
         *   shapes (or separate parts placed close together on the bed).
         *
         * PROXIMITY (within each shape): splits a shape's geometry
         *   into connected sub-clusters. Concentric pocket rings stay together
         *   (each within one stepover of the next, so they form one connected
         *   component and clear layer-by-layer). The outer and inner loops of
         *   an "O" / a holed profile are separated by the wall (> one stepover),
         *   so they split into their own sub-regions and each is cut on its own
         *   terms - all of its Z-passes consecutively - instead of interleaving
         *   outer/inner at every depth.
         *
         * Each resulting sub-region is therefore BOTH same-shape (staydown is
         * safe) AND one connected cluster (correct cut granularity).
         *
         * Falls back to pure proximity with allowStaydown when no shapeKey
         * is present; the caller may also force proximity via the partition arg.
         *
         * @returns {{ regions: Array, allowStaydown: boolean }}
         */
        buildRegions(plans, partition = 'shape') {
            const hasKey = (k) => k !== undefined && k !== null && k !== -1;

            // Helper: split a set of plans into connected staydown sub-clusters.
            // Within a single shape treat consecutive passes as connected
            // (generator guarantee), so concave shapes whose offset vertices
            // sample far apart are not wrongly split. Across shapes this
            // helper isn't given a pass signal, so it degrades to pure proximity.
            const subdivideByProximity = (groupPlans, usePassAdjacency) => {
                if (groupPlans.length <= 1) return [groupPlans];
                const first = groupPlans[0];
                const stepDistance =
                    first.metadata.toolDiameter * (1.0 - (first.metadata.stepOver / 100.0));
                return this.buildStaydownClusters(
                    groupPlans, stepDistance + EPSILON, usePassAdjacency
                );
            };

            // PROXIMITY MODE
            // Isolation / clearing: proximity clusters ARE the staydown
            // unit.
            if (partition === 'proximity') {
                const clusters = subdivideByProximity(plans, false);
                this.debug(`buildRegions: proximity mode - ${clusters.length} cluster(s)`);
                return { regions: clusters, allowStaydown: true };
            }

            // SHAPE MODE
            const identity = plans.some(p => hasKey(p.metadata.shapeKey));

            if (identity) {
                // Level 1: hard partition by shapeKey.
                const byKey = new Map();
                let loose = 0;
                for (const p of plans) {
                    const k = hasKey(p.metadata.shapeKey)
                        ? p.metadata.shapeKey
                        : `loose_${loose++}`;
                    if (!byKey.has(k)) byKey.set(k, []);
                    byKey.get(k).push(p);
                }

                // Level 2: proximity sub-clustering inside each shape.
                // Pass-adjacency is enabled here because all plans share one shape.
                const regions = [];
                for (const [, shapePlans] of byKey) {
                    for (const sub of subdivideByProximity(shapePlans, true)) {
                        if (sub.length > 0) regions.push(sub);
                    }
                }

                this.debug(
                    `buildRegions: identity mode - ${byKey.size} shape(s) → ${regions.length} sub-region(s)`
                );
                return { regions, allowStaydown: true };
            }

            // No identity: pure proximity. allowStaydown stays true since
            // unidentified plans default to distance-based safety.
            const clusters = subdivideByProximity(plans, false);
            this.debug(`buildRegions: proximity fallback - ${clusters.length} cluster(s)`);
            return { regions: clusters, allowStaydown: true };
        }

        /**
         * Or-opt relocate pass over the region sequence (look-ahead seed = greedy NN result).
         * Direction-PRESERVING: it only moves a region to a better slot, never reverses a
         * region's internal path - safe for multi-Z regions whose depth order is fixed.
         * Geometry-neutral: regions are rapid-linked, so reordering changes only travel.
         * This is the extension point: swap this for Or-3 / 2-opt / LK later without
         * touching geometry or stay-down.
         */
        refineRegionOrder(regions, startPos) {
            if (regions.length < 3) return regions;
            const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
            const cost = (seq) => {
                let pos = startPos, c = 0;
                for (const r of seq) { c += d(pos, r.entryPoint); pos = r.exitPoint; }
                return c;
            };

            let best = regions.slice();
            let bestCost = cost(best);
            let improved = true, guard = 0;
            while (improved && guard++ < 6) {            // tiny N; a few passes converge
                improved = false;
                for (let i = 0; i < best.length && !improved; i++) {
                    const without = best.slice();
                    const [moved] = without.splice(i, 1);
                    for (let j = 0; j <= without.length; j++) {
                        if (j === i) continue;
                        const trial = without.slice();
                        trial.splice(j, 0, moved);
                        const c = cost(trial);
                        if (c < bestCost - 1e-6) { best = trial; bestCost = c; improved = true; break; }
                    }
                }
            }
            return best;
        }

        /**
         * Optimize path order using nearest neighbor with link cost analysis
         */
        optimizePathOrder(plans, startPos, options = { allowStaydown: false, isClusterRun: false }) {
            if (plans.length <= 1) return plans;

            const ordered = [];
            const remaining = [...plans];
            let currentPos = { ...startPos };
            // No prior plan at the start of a run → first link can't be staydown anyway.
            this.lastShapeKey = null;
            this.skipShapeGuard = options.skipShapeGuard || false;

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

                // Rotate entry point to reduce travel. Circles always
                // rotate via projection (commandIndex is always 0 for
                // circles, but rotateCircleEntry handles it correctly).
                // Paths rotate only when a non-entry vertex was selected.
                if (!chosen.metadata.isPeckMark && !chosen.metadata.isDrillMilling) {
                    if (chosen.metadata.isSimpleCircle) {
                        this.rotateCircleEntry(chosen, currentPos);
                    } else if (bestResult.commandIndex >= 0 && chosen.metadata.isClosedLoop) {
                        this.rotatePlanCommands(chosen, bestResult.commandIndex);
                    }
                }

                ordered.push(chosen);
                totalOptimizedTravel += bestResult.realDistance;
                currentPos = { ...chosen.metadata.exitPoint };
                this.lastShapeKey = chosen.metadata.shapeKey ?? null;
            }

            this.stats.originalTravelDistance += totalOriginalTravel;
            this.stats.optimizedTravelDistance += totalOptimizedTravel;
            this.stats.travelDistanceSaved += (totalOriginalTravel - totalOptimizedTravel);

            return ordered;
        }

        /**
         * Calculate cost and link type for traveling between plans.
         */
        calculatePathLinkCost(fromPos, toPlan, allowStaydown = false) {
            // Cluster objects (used when optimizing between clusters/regions)
            if (toPlan.plans && toPlan.entryPoint) {
                const bestPoint = toPlan.entryPoint;
                const dx = bestPoint.x - fromPos.x;
                const dy = bestPoint.y - fromPos.y;
                const closestXYDist = Math.sqrt(dx * dx + dy * dy);
                const rapidCost = this.calculateRapidCost(fromPos, bestPoint, closestXYDist);
                return {
                    cost: rapidCost,
                    realDistance: closestXYDist,
                    linkType: 'rapid',
                    bestPoint: bestPoint,
                    commandIndex: -1
                };
            }

            const planMetadata = toPlan.metadata || {};
            planMetadata.exitPoint = planMetadata.exitPoint || planMetadata.entryPoint;
            planMetadata.isPeckMark = planMetadata.isPeckMark || false;
            planMetadata.isDrillMilling = planMetadata.isDrillMilling || false;
            planMetadata.isCenterlinePath = planMetadata.isCenterlinePath || false;

            // Stay-down safety checks.
            // sameShape: prevents the tool from dragging across open material
            // between separate features.
            // Multi-depth plans must NOT stay-down - the tool would traverse
            // at the previous feature's final depth through uncleared material.
            const sameShape = this.skipShapeGuard ? true :
                (planMetadata.shapeKey === undefined ||
                               planMetadata.shapeKey === null ||
                               this.lastShapeKey === undefined ||
                               this.lastShapeKey === null)
                ? true
                : (planMetadata.shapeKey === this.lastShapeKey);

            const isMultiDepth = (planMetadata.depthLevels?.length || 1) > 1;

            const canStaydown = allowStaydown &&
                               sameShape &&
                               !isMultiDepth &&
                               !planMetadata.isPeckMark &&
                               !planMetadata.isDrillMilling;

            if (canStaydown) {
                const dxEntry = planMetadata.entryPoint.x - fromPos.x;
                const dyEntry = planMetadata.entryPoint.y - fromPos.y;
                const originalEntryDist = Math.sqrt(dxEntry * dxEntry + dyEntry * dyEntry);

                const toolDiameter = planMetadata.toolDiameter;
                const stepOverPercent = planMetadata.stepOver;
                const stepOverRatio = stepOverPercent / 100.0;
                const stepDistance = toolDiameter * (1.0 - stepOverRatio);
                const staydownThreshold = stepDistance + EPSILON;

                this.debug(`Plan ${planMetadata.operationId} (Pass ${planMetadata.pass || 1}): ToolD=${toolDiameter.toFixed(3)}, StepOver=${stepOverPercent}%, StepDist=${stepDistance.toFixed(3)}, Threshold=${staydownThreshold.toFixed(3)}`);
                this.debug(`   Original Entry Dist: ${originalEntryDist.toFixed(3)}`);

                // Original entry is close enough (no rotation needed)
                if (originalEntryDist <= staydownThreshold) {
                    this.debug(`   >> Using Original Entry (Staydown) - Within Threshold`);
                    return {
                        cost: originalEntryDist,
                        realDistance: originalEntryDist,
                        linkType: 'staydown',
                        bestPoint: planMetadata.entryPoint,
                        commandIndex: -1
                    };
                }

                // Find closest point on the path and consider rotation
                const { point: closestPoint, distance: closestDist, commandIndex } =
                    this.findClosestPointOnPlan(fromPos, toPlan);

                if (closestDist <= staydownThreshold && (commandIndex >= 0 || planMetadata.isSimpleCircle))
                {
                    this.debug(`   >> Using Rotated Entry (Staydown), Dist: ${closestDist.toFixed(3)}, Index: ${commandIndex}`);
                    return {
                        cost: closestDist,
                        realDistance: closestDist,
                        linkType: 'staydown',
                        bestPoint: closestPoint,
                        commandIndex: commandIndex
                    };
                }
                    this.debug(`   Closest point dist (${closestDist.toFixed(3)}) beyond staydown threshold.`);
            }

            // Rapid link
            const { point: bestRapidPoint, distance: closestRapidXYDist, commandIndex: rapidCommandIndex } =
                this.findClosestPointOnPlan(fromPos, toPlan);

            const rapidCost = this.calculateRapidCost(fromPos, bestRapidPoint, closestRapidXYDist);

            if (debugState.enabled) {
                const reason = !allowStaydown ? "Not Allowed" :
                    (planMetadata.isPeckMark || planMetadata.isDrillMilling) ? "Drill Op" :
                    isMultiDepth ? "Multi-Depth" : "Too Far";
                console.log(`[Optimizer]   >> Using Rapid Link (${reason}). Cost: ${rapidCost.toFixed(1)}, Dist: ${closestRapidXYDist.toFixed(3)}, Index: ${rapidCommandIndex}`);
            }

            return {
                cost: rapidCost,
                realDistance: closestRapidXYDist,
                linkType: 'rapid',
                bestPoint: bestRapidPoint,
                commandIndex: rapidCommandIndex
            };
        }

        /**
         * Helper for rapid cost calculation
         */
        calculateRapidCost(fromPos, toPos, xyDist) {
            const rapidConfig = D.toolpath.generation.rapidCost || {};
            const baseCost = rapidConfig.baseCost || 10000;

            return xyDist + baseCost;
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
                            commandIndex: -1
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
            let bestIndex = -1;

            if (plan.commands.length > 0) {
                for (let i = 0; i < plan.commands.length; i++) {
                    const cmd = plan.commands[i];
                    if (cmd.x === null || cmd.y === null) continue;

                    // For closed loops, skip commands whose target ≈ entry.
                    // Rotating to these (or their neighbor) places the
                    // closure command first, producing a degenerate zero-move
                    // and breaking the simplifier's collinearity reference.
                    if (canRotate) {
                        const ceX = cmd.x - meta.entryPoint.x;
                        const ceY = cmd.y - meta.entryPoint.y;
                        if (ceX * ceX + ceY * ceY < PRECISION * PRECISION) continue;
                    }

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
         * Rotate plan entry point for closed loops.
         *
         * TODO [ROTATION-ARC-IJ] - This splice rotation breaks arc commands.
         * Arc I/J offsets are relative to the arc's start point. When rotation
         * moves the entry, the command that was previously mid-sequence now
         * starts from a different position, but its I/J still reference the
         * old start. Fix: after splicing, walk the rotated commands and
         * recalculate I/J for any ARC_CW/ARC_CCW command whose preceding
         * position changed. Alternatively, store arcs as absolute center
         * coordinates internally and convert to relative I/J only at G-code
         * emission time.
         */
        rotatePlanCommands(plan, newEntryIndex) {
            if (newEntryIndex < 0 || newEntryIndex >= plan.commands.length) return;

            // Identify the pivot command (the one that leads TO the new start point)
            const pivotCmd = plan.commands[newEntryIndex];

            // Split the commands
            // Pre-Pivot: Commands before the pivot (0 to newEntryIndex - 1)
            const prePivot = plan.commands.slice(0, newEntryIndex);

            // Post-Pivot: Commands after the pivot (newEntryIndex + 1 to end)
            // Skip newEntryIndex here because it must move to the end of the sequence
            const postPivot = plan.commands.slice(newEntryIndex + 1);

            plan.commands = [...postPivot, ...prePivot, pivotCmd];

            // Update Entry/Exit Metadata
            plan.metadata.entryPoint = { 
                x: pivotCmd.x, 
                y: pivotCmd.y 
            };

            // Since the loop was closed (explicitly or via logic), exit = entry
            plan.metadata.exitPoint = { ...plan.metadata.entryPoint };
        }

        /**
         * Rotate circle entry to closest point.
         *
         * TODO [CIRCLE-ROTATION] - This updates entry/exit metadata and the
         * single arc command's target + I/J, which is correct for a full-circle
         * arc (G2/G3 back to start). Winding is preserved because the arc
         * direction (CW/CCW) doesn't change - only the start/end point moves
         * along the circle. The current implementation is functionally correct
         * for simple circles. For compound circles (multi-arc approximations
         * from arc reconstruction), this would need to rotate within the arc
         * sequence, not just update the first command.
         */
        rotateCircleEntry(plan, fromPos) {
            const center = plan.metadata.center;
            const radius = plan.metadata.radius;

            if (!center || !radius) return;

            const dx = fromPos.x - center.x;
            const dy = fromPos.y - center.y;
            const distToCenter = Math.sqrt(dx * dx + dy * dy);

            if (distToCenter < PRECISION) return;

            const newEntryX = center.x + (dx / distToCenter) * radius;
            const newEntryY = center.y + (dy / distToCenter) * radius;

            plan.metadata.entryPoint = { x: newEntryX, y: newEntryY };
            plan.metadata.exitPoint = { x: newEntryX, y: newEntryY };

            if (plan.commands && plan.commands.length > 0) {
                const cmd = plan.commands[0];
                cmd.x = newEntryX;
                cmd.y = newEntryY;
                if (cmd.i !== undefined && cmd.j !== undefined) {
                    cmd.i = center.x - newEntryX;
                    cmd.j = center.y - newEntryY;
                }
            }
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
            let currentPos = { x: null, y: null };
            if (plan.metadata.entryPoint) {
                currentPos = { x: plan.metadata.entryPoint.x, y: plan.metadata.entryPoint.y };
            }

            const isIgnorableArcCmd = (c, start, end) => {
                if (c.type !== 'ARC_CW' && c.type !== 'ARC_CCW') return false;
                const dx = end.x - start.x;
                const dy = end.y - start.y;
                const iVal = c.i || 0;
                const jVal = c.j || 0;

                return (dx * dx + dy * dy) < PRECISION && (iVal * iVal + jVal * jVal) < PRECISION;
            };

            const precisionSq = PRECISION * PRECISION;

            while (i < commands.length) {
                const cmd = commands[i];

                // If this command is a TAB (Z-move/geometry break), preserve it immediately and break any simplification sequence.
                if (cmd.metadata && cmd.metadata.isTab === true) {
                    simplified.push(cmd);
                    // Update currentPos to this command's end, if it has coords
                    if (cmd.x !== null && cmd.y !== null) {
                        currentPos = { x: cmd.x, y: cmd.y };
                    }
                    i++;
                    continue;
                }

                // Resolve the absolute target position of this command
                const cmdTargetPos = {
                    x: cmd.x !== null ? cmd.x : currentPos.x,
                    y: cmd.y !== null ? cmd.y : currentPos.y
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
                    linearSequenceCmds.push(new MotionCommand('LINEAR', { x: cmd.x, y: cmd.y }, { feed: cmd.f }));
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
                        y: nextCmd.y !== null ? nextCmd.y : sequenceEndPoint.y
                    };

                    if (nextCmd.type === 'LINEAR' || isIgnorableArcCmd(nextCmd, sequenceEndPoint, nextCmdTargetPos)) {
                        if (nextCmd.type !== 'LINEAR') {
                            linearSequenceCmds.push(new MotionCommand('LINEAR', { x: nextCmd.x, y: nextCmd.y }, { feed: nextCmd.f }));
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
                        y: linearCmd.y !== null ? linearCmd.y : tempPos.y
                    };

                    // Check for zero-length segments / duplicate start point
                    const dx = tempPos.x - lastPushedPoint.x;
                    const dy = tempPos.y - lastPushedPoint.y;
                    const distSq = dx * dx + dy * dy;

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

                // Closed-loop guard: when first ≈ last, the collinearity
                // reference line degenerates to a point and all deviations
                // become absolute distances, over-removing corners on small
                // contours. Strip the duplicate closure point, simplify the
                // open sequence, then re-attach the closure unconditionally.
                let closureCmd = null;
                const isClosed = plan.metadata.isClosedLoop || plan.metadata.isClosed;
                if (isClosed && points.length >= 4) {
                    const fp = points[0];
                    const lp = points[points.length - 1];
                    const cdx = lp.x - fp.x;
                    const cdy = lp.y - fp.y;
                    if (cdx * cdx + cdy * cdy < precisionSq) {
                        closureCmd = points.pop().cmd;
                    }
                }

                const simplifiedPoints = this.simplifyCollinearPoints(points);
                for (const pt of simplifiedPoints) {
                    if (pt.cmd) { 
                        simplified.push(pt.cmd);
                    }
                }
                if (closureCmd) {
                    simplified.push(closureCmd);
                }
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

            // A closed loop reduced below 3 points is degenerate geometry
            // that would produce a missing or zero-area cut. Abort and
            // return the original points to preserve the shape.
            if (simplified.length < 3 && points.length >= 3) {
                return points;
            }

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