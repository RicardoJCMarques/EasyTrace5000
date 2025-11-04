/**
 * @file        toolpath/toolpath-optimizer.js
 * @description Optimizes pure geometry plans with geometric clustering
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
        
    class ToolpathOptimizer {
        constructor(options = {}) {
            this.options = {
                enablePathOrdering: config.gcode?.optimization?.pathOrdering !== false,
                enableSegmentSimplification: config.gcode?.optimization?.segmentSimplification !== false,
                enableZLevelGrouping: config.gcode?.optimization?.zLevelGrouping,
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
        optimize(pureGeometryPlans) {
            const startTime = performance.now();
            this.resetStats();
            this.stats.originalPathCount = pureGeometryPlans.length;
            
            if (!pureGeometryPlans || pureGeometryPlans.length === 0) {
                return [];
            }
            
            // Group by tool diameter
            const plansByGroupKey = new Map();
            for (const plan of pureGeometryPlans) {
                const groupKey = plan.metadata.groupKey || 'default';
                if (!plansByGroupKey.has(groupKey)) {
                    plansByGroupKey.set(groupKey, []);
                }
                plansByGroupKey.get(groupKey).push(plan);
            }
            
            if (debugConfig.enabled) {
                console.log(`[Optimizer] Grouped into ${plansByGroupKey.size} tool groups`);
            }
            
            let finalOrderedPlans = [];
            let currentMachinePos = { x: 0, y: 0, z: this.options.safeZ };
            
            // Process each tool group
            for (const [groupKey, groupPlans] of plansByGroupKey) {
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
                        // 1. Build Staydown Clusters using geometric proximity
                        const toolDiameter = zGroup[0].metadata.tool?.diameter || 1.0;
                        const staydownMargin = toolDiameter * 0.6;
                        const clusters = this.buildStaydownClusters(zGroup, staydownMargin);
                        
                        this.stats.clustersFound += clusters.length;
                        
                        if (debugConfig.enabled) {
                            console.log(`[Optimizer] Found ${clusters.length} staydown clusters for Z-level`);
                        }

                        // 2. Optimize INSIDE each cluster (allowing staydown)
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
                        
                        // 3. Optimize BETWEEN clusters (forcing rapid)
                        const orderedClusters = this.optimizePathOrder(optimizedClusters, currentMachinePos, { 
                            allowStaydown: false, 
                            isClusterRun: true
                        });

                        // 4. Flatten the results
                        for (const cluster of orderedClusters) {
                            finalOrderedPlans.push(...cluster.plans);
                        }
                        
                        // Update machine position for next Z-level or tool-group
                        if (orderedClusters.length > 0) {
                            currentMachinePos = orderedClusters[orderedClusters.length - 1].exitPoint;
                            currentMachinePos.z = this.options.safeZ;
                        }
                    } else {
                        // Path ordering is OFF, just add plans in original order
                        finalOrderedPlans.push(...zGroup);
                        if (zGroup.length > 0) {
                             const lastPlan = zGroup[zGroup.length - 1];
                             currentMachinePos = lastPlan.metadata.exitPoint || { x: 0, y: 0, z: this.options.safeZ };
                             currentMachinePos.z = this.options.safeZ;
                        }
                    }
                }
            }
            
            // Segment Simplification
            if (this.options.enableSegmentSimplification) {
                if (debugConfig.enabled) {
                    console.log(`[Optimizer] Simplifying ${finalOrderedPlans.length} paths...`);
                }
                // We simplify *after* ordering to preserve entry/exit points
                // Note: simplifySegments modifies the plan in-place
                let totalPointsRemoved = 0;
                for (const plan of finalOrderedPlans) {
                    const originalCount = plan.commands.length;
                    this.simplifySegments(plan);
                    totalPointsRemoved += (originalCount - plan.commands.length);
                }
                this.stats.pointsRemoved = totalPointsRemoved;
                 if (debugConfig.enabled) {
                    console.log(`[Optimizer] Removed ${totalPointsRemoved} collinear points.`);
                }
            }
            
            this.stats.optimizedPathCount = finalOrderedPlans.length;
            this.stats.optimizationTime = performance.now() - startTime;
            
            if (debugConfig.enabled) {
                console.log(`[Optimizer] Complete: ${finalOrderedPlans.length} paths ordered`);
                console.log(`[Optimizer] Stats:`, this.getStats());
            }
            
            return finalOrderedPlans;
        }
        
        /**
         * Groups plans into "staydown clusters" using connected components algorithm
         */
        buildStaydownClusters(plans, margin) {
            const clusters = [];
            const planIndices = new Set(plans.map((_, i) => i));
            const adjacency = new Map();

            // Pre-calculate BBoxes for all plans
            plans.forEach(plan => {
                if (!plan.metadata.boundingBox) {
                    this.calculatePlanBounds(plan);
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
            
            // Find all connected components using DFS
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
            // 1. Broad BBox Check (fast fail)
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

            // 2. Verify actual closest distance is within margin
            // This prevents connecting paths that have overlapping inflated boxes but are actually too far apart
            const closestDist = this.findClosestDistanceBetweenPlans(planA, planB);
            return closestDist <= margin;
        }
        
        /**
         * Find actual closest distance between two plans
         */
        findClosestDistanceBetweenPlans(planA, planB) {
            let minDist = Infinity;
            
            // Sample points from both plans (max 20 per plan for performance)
            const pointsA = this.samplePlanPoints(planA, 20);
            const pointsB = this.samplePlanPoints(planB, 20);
            
            for (const pA of pointsA) {
                for (const pB of pointsB) {
                    const dist = Math.hypot(pB.x - pA.x, pB.y - pA.y);
                    minDist = Math.min(minDist, dist);
                }
            }
            
            return minDist;
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
         * Helper to calculate BBox if missing
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
            for (const plan of plans) {
                const entry = (plan.entryPoint || plan.metadata?.entryPoint || { x: 0, y: 0, z: 0 });
                totalOriginalTravel += Math.hypot(entry.x - pos.x, entry.y - pos.y);
                pos = plan.exitPoint || plan.metadata?.exitPoint || entry;
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
                    // Store the link decision on the first plan of the chosen cluster
                    // This ensures the MachineProcessor knows to RAPID to this cluster.
                    if (chosen.plans && chosen.plans.length > 0) {
                        chosen.plans[0].metadata.optimization = {
                            linkType: bestResult.linkType,
                            originalEntryPoint: chosen.plans[0].metadata.entryPoint,
                            optimizedEntryPoint: bestResult.bestPoint,
                            entryCommandIndex: 0 // We don't rotate the entry point of a whole cluster
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
                    // Only rotate if it's NOT a drill operation and is a simple circle or closed loop without arcs
                    if (!chosen.metadata.isPeckMark && !chosen.metadata.isDrillMilling) {
                        if (chosen.metadata.isSimpleCircle && bestResult.linkType === 'rapid') {
                            this.rotateCircleEntry(chosen, currentPos);
                        } else if (!chosen.metadata.hasArcs && chosen.metadata.isClosedLoop) {
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
                const closestXYDist = Math.hypot(bestPoint.x - fromPos.x, bestPoint.y - fromPos.y);
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

            // Check if staydown is possible and allowed for this link
            const canStaydown = allowStaydown &&
                               !planMetadata.isPeckMark && // Never staydown for drills
                               !planMetadata.isDrillMilling && // Or drill milling
                               Math.abs(fromPos.z - planMetadata.entryPoint.z) < 0.01; // Must be at same Z

            if (canStaydown) {
                const originalEntryDist = Math.hypot(
                    planMetadata.entryPoint.x - fromPos.x,
                    planMetadata.entryPoint.y - fromPos.y
                );

                // Use calculated stepDistance + tolerance
                const toolDiameter = planMetadata.tool?.diameter || 1.0;
                // Get stepOver from settings (use default from config if missing on plan)
                const stepOverPercent = planMetadata.stepOver || (config.operations[planMetadata.operationType || 'isolation']?.defaultSettings?.stepOver) || 50;
                const stepOverRatio = stepOverPercent / 100.0;
                const stepDistance = toolDiameter * (1.0 - stepOverRatio);

                // Threshold is the expected step distance plus a small tolerance
                const tolerance = 0.1 * toolDiameter; // e.g., 10% of tool diameter
                const staydownThreshold = stepDistance + tolerance;

                if (this.options.debug) {
                   console.log(`[DEBUG Staydown] Plan ${planMetadata.operationId} (Pass ${planMetadata.pass || 1}): ToolD=${toolDiameter.toFixed(3)}, StepOver=${stepOverPercent}%, StepDist=${stepDistance.toFixed(3)}, Threshold=${staydownThreshold.toFixed(3)}`);
                   console.log(`[DEBUG Staydown]   Original Entry Dist: ${originalEntryDist.toFixed(3)}`);
                }

                // Option 1: Use original entry point if close enough (no rotation needed)
                if (originalEntryDist <= staydownThreshold) {
                     if (this.options.debug) console.log(`[DEBUG Staydown]   >> Using Original Entry (Staydown) - Within Threshold`);
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
                    // if (this.options.debug){
                        console.log(`[DEBUG Staydown]   >> Using Rotated Entry (Staydown), Dist: ${closestDist.toFixed(3)}, Index: ${commandIndex}`);
                    // }
                    return {
                        cost: closestDist, // Cost is just XY distance
                        realDistance: closestDist,
                        linkType: 'staydown',
                        bestPoint: closestPoint,
                        commandIndex: commandIndex // Signal rotation
                    };
                }
                // if (this.options.debug) {
                     console.log(`[DEBUG Staydown]   Closest point dist (${closestDist.toFixed(3)}) too far or not worth rotating.`);
                // }
            }

            // Default: Use Rapid Link
            // Find closest point (again, or for the first time if staydown wasn't possible)
            // This allows rapid links to also benefit from entry point rotation if possible.
            const { point: bestRapidPoint, distance: closestRapidXYDist, commandIndex: rapidCommandIndex } =
                this.findClosestPointOnPlan(fromPos, toPlan);

            const rapidCost = this.calculateRapidCost(fromPos, bestRapidPoint, closestRapidXYDist);

            if (this.options.debug) {
                const reason = !allowStaydown ? "Not Allowed" : (planMetadata.isPeckMark || planMetadata.isDrillMilling) ? "Drill Op" : "Too Far";
                console.log(`[DEBUG Staydown]   >> Using Rapid Link (${reason}). Cost: ${rapidCost.toFixed(1)}, Dist: ${closestRapidXYDist.toFixed(3)}, Index: ${rapidCommandIndex}`);
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
            const zTravelThreshold = 5.0;
            let zCost;
            
            if (xyDist < zTravelThreshold) {
                const travelZ = fromPos.z < 0 ? this.options.safeZ * 0.4 : fromPos.z;
                zCost = Math.abs(travelZ - fromPos.z) + Math.abs(toPos.z - travelZ);
            } else {
                zCost = Math.abs(this.options.safeZ - fromPos.z) + Math.abs(toPos.z - this.options.safeZ);
            }
            
            return (xyDist + zCost * 1.5) + 10000;
        }
        
        /**
         * Find closest point on a plan
         * Check both isPeckMark AND isDrillMilling
         */
        findClosestPointOnPlan(fromPos, plan) {
            const meta = plan.metadata;

            // Do not optimize entry points for ANY drill operations
            if (meta.isPeckMark || meta.isDrillMilling) {
                const entry = meta.entryPoint || { x: 0, y: 0, z: 0 };
                const dist = Math.hypot(entry.x - fromPos.x, entry.y - fromPos.y);
                return { point: entry, distance: dist, commandIndex: 0 };
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
                    const vecMag = Math.hypot(vecX, vecY);
                    
                    if (vecMag > 1e-6) {
                        const idealX = centerX + (vecX / vecMag) * radius;
                        const idealY = centerY + (vecY / vecMag) * radius;
                        const idealPos = { x: idealX, y: idealY, z: entryCmd.z };
                        const dist = Math.hypot(idealX - fromPos.x, idealY - fromPos.y);
                        return { point: idealPos, distance: dist, commandIndex: 0 };
                    }
                }
            }
            
            // Path searching
            const canRotate = meta.isClosedLoop;
            
            let bestPoint = meta.entryPoint || { x: 0, y: 0, z: 0 };
            let bestDist = Math.hypot(bestPoint.x - fromPos.x, bestPoint.y - fromPos.y);
            let bestIndex = 0;
            
            if (!plan.commands || plan.commands.length === 0) {
                return { point: bestPoint, distance: bestDist, commandIndex: 0 };
            }
            
            // Search for closest point
            for (let i = 0; i < plan.commands.length; i++) {
                const cmd = plan.commands[i];
                if (cmd.x === null || cmd.y === null) continue;
                
                const dist = Math.hypot(cmd.x - fromPos.x, cmd.y - fromPos.y);
                
                if (dist < bestDist) {
                    bestDist = dist;
                    bestPoint = { x: cmd.x, y: cmd.y, z: cmd.z };
                    if (canRotate) {
                        bestIndex = i;
                    }
                }
            }
            
            return { point: bestPoint, distance: bestDist, commandIndex: bestIndex };
        }
        
        /**
         * Rotate plan entry point for closed loops
         */
        rotatePlanCommands(plan, newEntryIndex) {
            if (newEntryIndex <= 0 || newEntryIndex >= plan.commands.length) return;
            
            // The command at the newEntryIndex holds the coordinates for the NEW start point
            const newStartCmd = plan.commands[newEntryIndex];
            if (!newStartCmd) return;

            // Create the new command array
            const rotated = [
                ...plan.commands.slice(newEntryIndex),
                ...plan.commands.slice(0, newEntryIndex)
            ];

            // The loop is now open. The last command in 'rotated', we must add a new closing command.
            const newStartPoint = {
                x: newStartCmd.x,
                y: newStartCmd.y,
                z: newStartCmd.z
            };
            
            // Get the feed rate from the *last* command in the new loop
            const lastLinearCmd = rotated[rotated.length - 1];
            const feed = lastLinearCmd.f || plan.metadata.feedRate;

            // Create and add the new closing command
            const closingCmd = new MotionCommand(
                'LINEAR',
                { x: newStartPoint.x, y: newStartPoint.y, z: newStartPoint.z },
                { feed: feed }
            );
            rotated.push(closingCmd);

            plan.commands = rotated;
            
            // Update metadata. Entry and Exit points should now match.
            if (plan.commands[0]) {
                plan.metadata.entryPoint = {
                    x: plan.commands[0].x,
                    y: plan.commands[0].y,
                    z: plan.commands[0].z || plan.metadata.entryPoint.z
                };
            }
            
            const lastCmd = plan.commands[plan.commands.length - 1];
            if (lastCmd) {
                plan.metadata.exitPoint = {
                    x: lastCmd.x,
                    y: lastCmd.y,
                    z: lastCmd.z || plan.metadata.exitPoint.z
                };
            }
        }
        
        /**
         * Rotate circle entry to closest point
         */
        rotateCircleEntry(plan, fromPos) {
            const center = plan.metadata.center;
            const radius = plan.metadata.radius;
            const feedRate = plan.metadata.feedRate || 150;
            const clockwise = plan.metadata.direction === 'conventional';
            const depth = plan.metadata.cutDepth;
            
            if (!center || !radius) return;
            
            const dx = fromPos.x - center.x;
            const dy = fromPos.y - center.y;
            const distToCenter = Math.hypot(dx, dy);
            
            if (distToCenter < 1e-6) return;
            
            const newEntryX = center.x + (dx / distToCenter) * radius;
            const newEntryY = center.y + (dy / distToCenter) * radius;
            
            // Rebuild circle commands
            plan.commands = [];
            plan.commands.push(new MotionCommand('LINEAR', 
                { x: newEntryX, y: newEntryY, z: depth }, 
                { feed: feedRate }
            ));
            
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

            while (i < commands.length) {
                const cmd = commands[i];

                // Resolve the absolute target position of this command
                const cmdTargetPos = {
                    x: cmd.x !== null && cmd.x !== undefined ? cmd.x : currentPos.x,
                    y: cmd.y !== null && cmd.y !== undefined ? cmd.y : currentPos.y,
                    z: cmd.z !== null && cmd.z !== undefined ? cmd.z : currentPos.z
                };

                // Check for ignorable, non-linear commands
                let isIgnorableArc = false;
                if (cmd.type === 'ARC_CW' || cmd.type === 'ARC_CCW') {
                    // Check the *arc length* of the arc (straight line from start to end)
                    const arcLength = Math.hypot(cmdTargetPos.x - currentPos.x, cmdTargetPos.y - currentPos.y);
                    
                    // If the arc moves less than 0.01mm, it's an artifact.
                    if (arcLength < 0.01) { 
                        isIgnorableArc = true;
                    }
                }

                // If it's a *significant* non-linear move, add it and continue.
                if (cmd.type !== 'LINEAR' && !isIgnorableArc) {
                    simplified.push(cmd);
                    currentPos = cmdTargetPos; // Update position
                    i++;
                    continue; // Move to the next command
                }
                
                // If it *is* LINEAR or an *ignorable arc*, process it as part of a linear sequence.

                // The *true* start point of this sequence is the `currentPos` from before this command.
                const sequenceStartPoint = { ...currentPos };
                const linearSequenceCmds = [];
                let sequenceEndPoint = cmdTargetPos; // End point of the *first* command

                if (isIgnorableArc) {
                    // Convert the ignorable arc to a LINEAR command so the simplifier can process it
                    linearSequenceCmds.push(new MotionCommand('LINEAR', { x: cmd.x, y: cmd.y, z: cmd.z }, { feed: cmd.f }));
                } else {
                    linearSequenceCmds.push(cmd); // It's the first LINEAR cmd
                }
                
                // Greedily gather all subsequent linear OR ignorable arc commands
                let j = i + 1;
                while (j < commands.length) {
                    const nextCmd = commands[j];
                    const nextCmdTargetPos = {
                        x: nextCmd.x !== null && nextCmd.x !== undefined ? nextCmd.x : sequenceEndPoint.x,
                        y: nextCmd.y !== null && nextCmd.y !== undefined ? nextCmd.y : sequenceEndPoint.y,
                        z: nextCmd.z !== null && nextCmd.z !== undefined ? nextCmd.z : sequenceEndPoint.z
                    };
                    
                    let isNextIgnorableArc = false;
                    if (nextCmd.type === 'ARC_CW' || nextCmd.type === 'ARC_CCW') {
                        const arcLength = Math.hypot(nextCmdTargetPos.x - sequenceEndPoint.x, nextCmdTargetPos.y - sequenceEndPoint.y);
                        if (arcLength < 0.01) {
                            isNextIgnorableArc = true;
                        }
                    }

                    if (nextCmd.type === 'LINEAR' || isNextIgnorableArc) {
                        // Add it to the sequence
                        if (isNextIgnorableArc) {
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

                // Now we have a full sequence:
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
                        x: linearCmd.x !== null && linearCmd.x !== undefined ? linearCmd.x : tempPos.x,
                        y: linearCmd.y !== null && linearCmd.y !== undefined ? linearCmd.y : tempPos.y,
                        z: linearCmd.z !== null && linearCmd.z !== undefined ? linearCmd.z : tempPos.z
                    };
                    
                    // Check for zero-length segments / duplicate start point ---
                    const dist = Math.hypot(tempPos.x - lastPushedPoint.x, tempPos.y - lastPushedPoint.y, tempPos.z - lastPushedPoint.z);

                    if (dist > 1e-6) { // Use a small epsilon
                        points.push({ ...tempPos, isStart: false, cmd: linearCmd });
                        lastPushedPoint = tempPos;
                    } else if (points.length > 0) {
                        // This is a zero-length move or the duplicate first point.
                        // Do not add the point, but *do* attach its command (e.g., feed rate) to the *previous* point. This ensures the command isn't lost.
                        points[points.length - 1].cmd = linearCmd;
                    }
                }

                // Simplify this point sequence using a collinear check
                const simplifiedPoints = this.simplifyCollinearPoints(points);

                // Rebuild command list from simplified points
                for (const pt of simplifiedPoints) {
                    if (pt.cmd) { // Skip the start point (cmd: null), as it was part of a previous cmd
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
         * Simplifies a point sequence by removing collinear points.
         */
        simplifyCollinearPoints(points) {
            if (points.length <= 2) {
                return points; // Not enough points to simplify
            }

            const simplified = [points[0]]; // Always keep the start point

            // "Softer" (stricter) tolerance for short segments to preserve curves
            const curveTolerance = (this.options.minSegmentLength / 100.0) || 0.0005; // e.g., 0.0005mm

            // "Aggressive" (looser) tolerance for long segments to remove collinear points
            const straightTolerance = (this.options.minSegmentLength / 10.0) || 0.005; // e.g., 0.005mm

            // The segment length at which we switch from "curve" to "straight" logic.
            // (e.g., 0.5mm)
            const segmentThreshold = this.options.minSegmentLength * 10 || 0.5; 

            for (let i = 1; i < points.length - 1; i++) {
                const p0 = simplified[simplified.length - 1]; // Last *kept* point
                const p1 = points[i];
                const p2 = points[i + 1];

                const dist = this.perpendicularDistance(p1, p0, p2);
                
                // Get the length of the segment leading *into* the point we are checking
                const segmentLength = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);

                // Apply the correct tolerance
                const effectiveTolerance = (segmentLength < segmentThreshold) ? curveTolerance : straightTolerance;
                
                // Keep the point if it deviates more than the *effective* tolerance
                if (dist >= effectiveTolerance) {
                    simplified.push(p1); 
                }
                // If collinear (dist < tolerance), p1 is dropped.
                // The next check will be against (p0, p2, p3), which is correct.
            }

            simplified.push(points[points.length - 1]); // Always keep the end point
            return simplified;
}
        
        /**
         * Douglas-Peucker line simplification algorithm
         */
        douglasPeucker(points, tolerance) {
            if (points.length <= 2) return points;
            
            // Find point with maximum distance from line
            let maxDist = 0;
            let maxIndex = 0;
            const end = points.length - 1;
            
            for (let i = 1; i < end; i++) {
                const dist = this.perpendicularDistance(
                    points[i],
                    points[0],
                    points[end]
                );
                
                if (dist > maxDist) {
                    maxDist = dist;
                    maxIndex = i;
                }
            }
            
            // If max distance is greater than tolerance, recursively simplify
            if (maxDist > tolerance) {
                const left = this.douglasPeucker(points.slice(0, maxIndex + 1), tolerance);
                const right = this.douglasPeucker(points.slice(maxIndex), tolerance);
                
                // Merge results (removing duplicate middle point)
                return [...left.slice(0, -1), ...right];
            } else {
                // All points between start and end can be removed
                return [points[0], points[end]];
            }
        }
        
        /**
         * Calculate perpendicular distance from point to line segment (3D)
         */
        perpendicularDistance(point, lineStart, lineEnd) {
            const dx = lineEnd.x - lineStart.x;
            const dy = lineEnd.y - lineStart.y;
            const dz = lineEnd.z - lineStart.z;
            
            const lengthSquared = (dx * dx) + (dy * dy) + (dz * dz);
            
            if (lengthSquared < 1e-12) { // Line segment is a point
                return Math.hypot(
                    point.x - lineStart.x,
                    point.y - lineStart.y,
                    point.z - lineStart.z
                );
            }
            
            // Parameter t of projection onto line
            let t = ((point.x - lineStart.x) * dx +
                     (point.y - lineStart.y) * dy +
                     (point.z - lineStart.z) * dz) / lengthSquared;
            
            t = Math.max(0, Math.min(1, t)); // Clamp t to [0, 1] for a line segment
            
            // Projected point
            const projX = lineStart.x + t * dx;
            const projY = lineStart.y + t * dy;
            const projZ = lineStart.z + t * dz;
            
            // Distance from point to projection
            return Math.hypot(
                point.x - projX,
                point.y - projY,
                point.z - projZ
            );
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
    }
    
    window.ToolpathOptimizer = ToolpathOptimizer;
})();