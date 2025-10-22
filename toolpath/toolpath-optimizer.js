/**
 * @file        toolpath-optimizer.js
 * @description Complete toolpath optimization system
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

    /**
     * Path ordering optimizer using nearest-neighbor with 2-opt improvement
     */
    class PathOrderOptimizer {
        /**
         * Optimize path ordering to minimize rapid traverse distance
         * @param {Array} paths - Array of path objects with startPoint and endPoint
         * @returns {Array} Reordered paths
         */
        optimize(paths) {
            if (paths.length <= 1) return paths;
            
            // Phase 1: Nearest neighbor construction
            const ordered = this.nearestNeighbor(paths);
            
            // Phase 2: 2-opt local optimization
            return this.twoOptImprove(ordered, 100); // Max 100 iterations
        }
        
        nearestNeighbor(paths) {
            const result = [];
            const remaining = paths.map((p, idx) => ({ ...p, originalIndex: idx }));
            let current = { x: 0, y: 0 }; // Start from origin
            
            while (remaining.length > 0) {
                let nearest = 0;
                let minDist = Infinity;
                let shouldReverse = false;
                
                for (let i = 0; i < remaining.length; i++) {
                    const path = remaining[i];
                    const start = this.getPathStart(path);
                    const end = this.getPathEnd(path);
                    
                    const startDist = this.distance(current, start);
                    const endDist = this.distance(current, end);
                    
                    if (startDist < minDist) {
                        minDist = startDist;
                        nearest = i;
                        shouldReverse = false;
                    }
                    if (endDist < minDist) {
                        minDist = endDist;
                        nearest = i;
                        shouldReverse = true;
                    }
                }
                
                const path = remaining.splice(nearest, 1)[0];
                if (shouldReverse) {
                    this.reversePath(path);
                }
                result.push(path);
                current = this.getPathEnd(path);
            }
            
            return result;
        }
        
        twoOptImprove(paths, maxIterations) {
            let improved = true;
            let result = [...paths];
            let iterations = 0;
            
            while (improved && iterations < maxIterations) {
                improved = false;
                iterations++;
                
                for (let i = 0; i < result.length - 1; i++) {
                    for (let j = i + 2; j < result.length; j++) {
                        const delta = this.calculateSwapDelta(result, i, j);
                        if (delta < -1e-6) {
                            result = this.performSwap(result, i, j);
                            improved = true;
                        }
                    }
                }
            }
            
            return result;
        }
        
        calculateSwapDelta(paths, i, j) {
            const prevI = i > 0 ? this.getPathEnd(paths[i - 1]) : { x: 0, y: 0 };
            const endI = this.getPathEnd(paths[i]);
            const startJ = this.getPathStart(paths[j]);
            const nextJ = j < paths.length - 1 ? this.getPathStart(paths[j + 1]) : null;
            
            // Current distance
            const currentDist = this.distance(prevI, this.getPathStart(paths[i])) +
                              this.distance(endI, startJ);
            
            // New distance after swap
            const newDist = this.distance(prevI, startJ) +
                          this.distance(this.getPathEnd(paths[j]), this.getPathStart(paths[i]));
            
            return newDist - currentDist;
        }
        
        performSwap(paths, i, j) {
            const result = [...paths];
            const section = result.slice(i, j + 1).reverse();
            result.splice(i, j - i + 1, ...section);
            return result;
        }
        
        getPathStart(path) {
            if (path.commands && path.commands.length > 0) {
                const first = path.commands[0];
                return { x: first.x ?? 0, y: first.y ?? 0 };
            }
            return path.startPoint || { x: 0, y: 0 };
        }
        
        getPathEnd(path) {
            if (path.commands && path.commands.length > 0) {
                const last = path.commands[path.commands.length - 1];
                return { x: last.x ?? 0, y: last.y ?? 0 };
            }
            return path.endPoint || { x: 0, y: 0 };
        }
        
        reversePath(path) {
            if (path.commands) {
                path.commands.reverse();
                // Swap start/end points if they exist
                if (path.startPoint && path.endPoint) {
                    [path.startPoint, path.endPoint] = [path.endPoint, path.startPoint];
                }
            }
        }
        
        distance(p1, p2) {
            return Math.hypot(p2.x - p1.x, p2.y - p1.y);
        }
    }

    /**
     * Segment simplifier with arc preservation
     */
    class SegmentSimplifier {
        /**
         * Simplify linear segments while preserving arcs
         * @param {Array} commands - Motion commands
         * @param {Object} options - Simplification options
         * @returns {Array} Simplified commands
         */
        simplify(commands, options = {}) {
            const tolerance = options.angleTolerance || 0.5; // degrees
            const minLength = options.minSegmentLength || 0.01; // mm
            
            if (commands.length < 3) return commands;
            
            const simplified = [];
            let i = 0;
            
            while (i < commands.length) {
                const cmd = commands[i];
                
                // Never merge non-linear commands
                if (cmd.type !== 'LINEAR') {
                    simplified.push(cmd);
                    i++;
                    continue;
                }
                
                // Try to build a merge group
                const mergeGroup = [cmd];
                let j = i + 1;
                
                while (j < commands.length && 
                       commands[j].type === 'LINEAR' &&
                       this.canMerge(commands[j], mergeGroup, tolerance)) {
                    mergeGroup.push(commands[j]);
                    j++;
                }
                
                // Merge if we have 3+ co-linear segments
                if (mergeGroup.length >= 3) {
                    const merged = this.mergeSegments(mergeGroup);
                    simplified.push(merged);
                    i = j;
                } else {
                    simplified.push(cmd);
                    i++;
                }
            }
            
            return simplified;
        }
        
        canMerge(nextCmd, currentGroup, angleTolerance) {
            const lastInGroup = currentGroup[currentGroup.length - 1];
            
            // Don't merge across feed changes
            if (nextCmd.f !== undefined && lastInGroup.f !== undefined && 
                nextCmd.f !== lastInGroup.f) {
                return false;
            }
            
            // Don't merge across Z changes
            if (nextCmd.z !== undefined && lastInGroup.z !== undefined &&
                Math.abs(nextCmd.z - lastInGroup.z) > 1e-6) {
                return false;
            }
            
            // Need at least 2 segments to calculate angle
            if (currentGroup.length < 2) return true;
            
            const prevInGroup = currentGroup[currentGroup.length - 2];
            
            // Calculate vectors
            const v1 = {
                x: lastInGroup.x - prevInGroup.x,
                y: lastInGroup.y - prevInGroup.y
            };
            
            const v2 = {
                x: nextCmd.x - lastInGroup.x,
                y: nextCmd.y - lastInGroup.y
            };
            
            // Check angle between vectors
            const angle = this.angleBetween(v1, v2);
            return Math.abs(angle) < angleTolerance;
        }
        
        angleBetween(v1, v2) {
            const len1 = Math.hypot(v1.x, v1.y);
            const len2 = Math.hypot(v2.x, v2.y);
            
            if (len1 < 1e-9 || len2 < 1e-9) return 0;
            
            const dot = v1.x * v2.x + v1.y * v2.y;
            const cosAngle = dot / (len1 * len2);
            
            // Clamp to avoid NaN from floating point errors
            return Math.acos(Math.max(-1, Math.min(1, cosAngle))) * 180 / Math.PI;
        }
        
        mergeSegments(group) {
            // Create single segment from first to last point
            const first = group[0];
            const last = group[group.length - 1];
            
            return new MotionCommand('LINEAR', {
                x: last.x,
                y: last.y,
                z: last.z
            }, {
                feed: first.f
            });
        }
    }

    /**
     * Z-level grouping optimizer
     */
    class ZLevelGrouper {
        /**
         * Group operations by Z-level to minimize Z movements
         * @param {Array} commands - Motion commands
         * @returns {Array} Regrouped commands by Z-level
         */
        groupByZLevel(commands) {
            // Extract all unique Z-levels with their operations
            const zLevels = new Map();
            let currentZ = 0;
            
            for (const cmd of commands) {
                // Track Z position
                if (cmd.z !== undefined && cmd.z !== null) {
                    currentZ = cmd.z;
                }
                
                // Only group cutting moves (LINEAR and ARC)
                if (cmd.type === 'LINEAR' || cmd.type === 'ARC_CW' || cmd.type === 'ARC_CCW') {
                    // Round Z to avoid floating point grouping issues
                    const zKey = Math.round(currentZ * 10000) / 10000;
                    
                    if (!zLevels.has(zKey)) {
                        zLevels.set(zKey, []);
                    }
                    zLevels.get(zKey).push(cmd);
                }
            }
            
            // Sort by Z (highest to lowest for safety)
            const sortedLevels = Array.from(zLevels.entries())
                .sort((a, b) => b[0] - a[0]);
            
            // Rebuild command list
            const regrouped = [];
            const safeZ = 5.0; // Safe retract height
            
            for (const [z, levelCommands] of sortedLevels) {
                // Retract to safe Z before moving to new level
                if (regrouped.length > 0) {
                    regrouped.push(new MotionCommand('RETRACT', { z: safeZ }));
                }
                
                // Add all commands for this Z-level
                regrouped.push(...levelCommands);
            }
            
            return regrouped;
        }
    }

    /**
     * Lead-in/lead-out point optimizer for closed loops
     */
    class LeadInOutOptimizer {
        /**
         * Optimize entry/exit points for closed loops
         * @param {Array} commands - Motion commands
         * @param {Object} previousPosition - Previous tool position
         * @returns {Array} Optimized commands
         */
        optimize(commands, previousPosition = { x: 0, y: 0 }) {
            const result = [];
            let currentLoop = [];
            let prevPos = { ...previousPosition };
            
            for (let i = 0; i < commands.length; i++) {
                const cmd = commands[i];
                
                // Accumulate potential loop
                if (cmd.type === 'LINEAR' || cmd.type === 'ARC_CW' || cmd.type === 'ARC_CCW') {
                    currentLoop.push(cmd);
                } else {
                    // Non-cutting move - process accumulated loop
                    if (currentLoop.length > 0) {
                        if (this.isClosedLoop(currentLoop)) {
                            const optimized = this.optimizeLoop(currentLoop, prevPos);
                            result.push(...optimized);
                            prevPos = this.getEndPoint(optimized[optimized.length - 1]);
                        } else {
                            result.push(...currentLoop);
                            if (currentLoop.length > 0) {
                                prevPos = this.getEndPoint(currentLoop[currentLoop.length - 1]);
                            }
                        }
                        currentLoop = [];
                    }
                    result.push(cmd);
                }
            }
            
            // Process remaining loop
            if (currentLoop.length > 0) {
                if (this.isClosedLoop(currentLoop)) {
                    const optimized = this.optimizeLoop(currentLoop, prevPos);
                    result.push(...optimized);
                } else {
                    result.push(...currentLoop);
                }
            }
            
            return result;
        }
        
        isClosedLoop(commands) {
            if (commands.length < 3) return false;
            
            const first = commands[0];
            const last = commands[commands.length - 1];
            
            const firstPt = { x: first.x ?? 0, y: first.y ?? 0 };
            const lastPt = { x: last.x ?? 0, y: last.y ?? 0 };
            
            const dist = Math.hypot(lastPt.x - firstPt.x, lastPt.y - firstPt.y);
            
            return dist < 0.01; // 10 micron tolerance
        }
        
        optimizeLoop(loopCommands, previousPosition) {
            // Find point furthest from previous position
            let maxDist = -1;
            let bestIndex = 0;
            
            for (let i = 0; i < loopCommands.length; i++) {
                const pt = this.getEndPoint(loopCommands[i]);
                const dist = Math.hypot(
                    pt.x - previousPosition.x,
                    pt.y - previousPosition.y
                );
                
                if (dist > maxDist) {
                    maxDist = dist;
                    bestIndex = i;
                }
            }
            
            // Rotate command array to start at optimal point
            return [
                ...loopCommands.slice(bestIndex),
                ...loopCommands.slice(0, bestIndex)
            ];
        }
        
        getEndPoint(cmd) {
            return {
                x: cmd.x ?? 0,
                y: cmd.y ?? 0,
                z: cmd.z ?? 0
            };
        }
    }

    /**
     * Main toolpath optimizer orchestrator
     */
    class ToolpathOptimizer {
        constructor(config = {}) {
            this.config = {
                enablePathOrdering: true,
                enableSegmentSimplification: true,
                enableZLevelGrouping: false, // Can cause issues with complex operations
                enableLeadInOut: true,
                angleTolerance: 0.5, // degrees
                minSegmentLength: 0.01, // mm
                ...config
            };
            
            this.pathOrderer = new PathOrderOptimizer();
            this.segmentSimplifier = new SegmentSimplifier();
            this.zGrouper = new ZLevelGrouper();
            this.leadOptimizer = new LeadInOutOptimizer();
            
            this.stats = {
                originalCommandCount: 0,
                optimizedCommandCount: 0,
                originalRapidDistance: 0,
                optimizedRapidDistance: 0
            };
        }
        
        /**
         * Optimize toolpath plans
         * @param {Array} toolpathPlans - Array of toolpath plan objects
         * @returns {Array} Optimized toolpath plans
         */
        optimize(toolpathPlans) {
            if (!toolpathPlans || toolpathPlans.length === 0) {
                return toolpathPlans;
            }
            
            // Reset stats
            this.stats = {
                originalCommandCount: 0,
                optimizedCommandCount: 0,
                originalRapidDistance: 0,
                optimizedRapidDistance: 0
            };
            
            const optimized = [];
            
            for (const plan of toolpathPlans) {
                const optimizedPlan = { ...plan };
                
                this.stats.originalCommandCount += plan.commands.length;
                
                // Phase 1: Path ordering (if plan has multiple paths)
                if (this.config.enablePathOrdering && plan.paths && plan.paths.length > 1) {
                    optimizedPlan.paths = this.pathOrderer.optimize(plan.paths);
                    // Rebuild commands from reordered paths
                    optimizedPlan.commands = this.rebuildCommands(optimizedPlan.paths);
                }
                
                // Phase 2: Lead-in/out optimization for closed loops
                if (this.config.enableLeadInOut && optimizedPlan.commands) {
                    optimizedPlan.commands = this.leadOptimizer.optimize(
                        optimizedPlan.commands,
                        { x: 0, y: 0 }
                    );
                }
                
                // Phase 3: Z-level grouping (optional, can disrupt operation sequence)
                if (this.config.enableZLevelGrouping && optimizedPlan.commands) {
                    optimizedPlan.commands = this.zGrouper.groupByZLevel(optimizedPlan.commands);
                }
                
                // Phase 4: Segment simplification (MUST be last)
                if (this.config.enableSegmentSimplification && optimizedPlan.commands) {
                    optimizedPlan.commands = this.segmentSimplifier.simplify(
                        optimizedPlan.commands,
                        {
                            angleTolerance: this.config.angleTolerance,
                            minSegmentLength: this.config.minSegmentLength
                        }
                    );
                }
                
                this.stats.optimizedCommandCount += optimizedPlan.commands.length;
                optimized.push(optimizedPlan);
            }
            
            return optimized;
        }
        
        rebuildCommands(paths) {
            const commands = [];
            for (const path of paths) {
                if (path.commands) {
                    commands.push(...path.commands);
                }
            }
            return commands;
        }
        
        getStats() {
            return {
                ...this.stats,
                commandReduction: this.stats.originalCommandCount > 0 ?
                    ((this.stats.originalCommandCount - this.stats.optimizedCommandCount) / 
                     this.stats.originalCommandCount * 100).toFixed(1) + '%' :
                    '0%'
            };
        }
    }

    // Export to global namespace
    window.ToolpathOptimizer = ToolpathOptimizer;
})();