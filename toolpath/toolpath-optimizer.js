/**
 * @file        toolpath/toolpath-optimizer.js
 * @description Path optimization algorithms to minimize rapids and improve efficiency
 * @author      Eltryus - Ricardo Marques
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
        constructor() {
            this.precision = config.geometry?.coordinatePrecision || 0.001;
            this.statistics = {
                originalRapidDistance: 0,
                optimizedRapidDistance: 0,
                commandsRemoved: 0,
                pathsReordered: 0,
                optimizationTime: 0
            };
        }
        
        /**
         * Main optimization entry point
         */
        optimize(toolpathPlan, options = {}) {
            const startTime = Date.now();
            this.resetStatistics();
            
            if (!toolpathPlan || !toolpathPlan.commands || toolpathPlan.commands.length === 0) {
                return toolpathPlan;
            }
            
            // Calculate original rapid distance
            this.statistics.originalRapidDistance = this.calculateTotalRapidDistance(toolpathPlan.commands);
            
            // Apply optimization passes
            if (options.removeRedundant !== false) {
                this.removeRedundantMoves(toolpathPlan);
            }
            
            if (options.mergeContinuous !== false) {
                this.mergeContinuousMoves(toolpathPlan);
            }
            
            if (options.reorderPaths !== false) {
                this.reorderPathsForMinimalRapids(toolpathPlan);
            }
            
            if (options.optimizeRetracts !== false) {
                this.optimizeRetracts(toolpathPlan);
            }
            
            // Calculate optimized rapid distance
            this.statistics.optimizedRapidDistance = this.calculateTotalRapidDistance(toolpathPlan.commands);
            this.statistics.optimizationTime = Date.now() - startTime;
            
            if (debugConfig.enabled) {
                this.logOptimizationResults();
            }
            
            return toolpathPlan;
        }
        
        /**
         * Remove redundant moves (consecutive moves to same position)
         */
        removeRedundantMoves(toolpathPlan) {
            const commands = toolpathPlan.commands;
            const filtered = [];
            let lastPos = {x: null, y: null, z: null};
            
            for (const cmd of commands) {
                const newPos = {
                    x: cmd.x !== undefined ? cmd.x : lastPos.x,
                    y: cmd.y !== undefined ? cmd.y : lastPos.y,
                    z: cmd.z !== undefined ? cmd.z : lastPos.z
                };
                
                // Check if position actually changes
                const posChanged = 
                    Math.abs((newPos.x || 0) - (lastPos.x || 0)) > this.precision ||
                    Math.abs((newPos.y || 0) - (lastPos.y || 0)) > this.precision ||
                    Math.abs((newPos.z || 0) - (lastPos.z || 0)) > this.precision;
                
                // Keep command if position changes or it's not a motion command
                if (posChanged || cmd.type === 'DWELL' || cmd.type.startsWith('ARC')) {
                    filtered.push(cmd);
                    lastPos = newPos;
                } else {
                    this.statistics.commandsRemoved++;
                }
            }
            
            toolpathPlan.commands = filtered;
        }
        
        /**
         * Merge continuous linear moves in same direction
         */
        mergeContinuousMoves(toolpathPlan) {
            const commands = toolpathPlan.commands;
            const merged = [];
            let i = 0;
            
            while (i < commands.length) {
                const cmd = commands[i];
                
                if (cmd.type === 'LINEAR' && i < commands.length - 1) {
                    // Look ahead for mergeable moves
                    const mergeable = [cmd];
                    let j = i + 1;
                    
                    while (j < commands.length && 
                           commands[j].type === 'LINEAR' && 
                           commands[j].f === cmd.f &&
                           this.areCollinear(mergeable[mergeable.length - 1], commands[j])) {
                        mergeable.push(commands[j]);
                        j++;
                    }
                    
                    if (mergeable.length > 1) {
                        // Create merged command to final position
                        const lastCmd = mergeable[mergeable.length - 1];
                        merged.push({
                            type: 'LINEAR',
                            x: lastCmd.x,
                            y: lastCmd.y,
                            z: lastCmd.z,
                            feed: cmd.f
                        });
                        this.statistics.commandsRemoved += mergeable.length - 1;
                        i = j;
                    } else {
                        merged.push(cmd);
                        i++;
                    }
                } else {
                    merged.push(cmd);
                    i++;
                }
            }
            
            toolpathPlan.commands = merged;
        }
        
        /**
         * Reorder disconnected paths to minimize rapid movements
         */
        reorderPathsForMinimalRapids(toolpathPlan) {
            const segments = this.identifySegments(toolpathPlan.commands);
            if (segments.length <= 1) return;
            
            // Use nearest neighbor algorithm for simplicity
            const reordered = this.nearestNeighborSort(segments);
            
            // Rebuild command list
            const newCommands = [];
            for (const segment of reordered) {
                newCommands.push(...segment.commands);
            }
            
            toolpathPlan.commands = newCommands;
            this.statistics.pathsReordered = segments.length;
        }
        
        /**
         * Optimize retract heights to avoid unnecessary full retracts
         */
        optimizeRetracts(toolpathPlan) {
            const commands = toolpathPlan.commands;
            
            for (let i = 1; i < commands.length - 1; i++) {
                const prev = commands[i - 1];
                const curr = commands[i];
                const next = commands[i + 1];
                
                // Look for retract followed immediately by another plunge
                if (curr.type === 'RETRACT' && next.type === 'RAPID') {
                    // Check if we're moving over clear area
                    const distance = this.calculateDistance(prev, next);
                    
                    if (distance < 10) { // Short hop - use travel Z instead of safe Z
                        curr.z = Math.min(curr.z, 2.0); // Use travel height
                    }
                }
            }
        }
        
        /**
         * Identify continuous cutting segments
         */
        identifySegments(commands) {
            const segments = [];
            let currentSegment = null;
            
            for (const cmd of commands) {
                if (cmd.type === 'RAPID' || cmd.type === 'RETRACT') {
                    // End current segment
                    if (currentSegment && currentSegment.commands.length > 0) {
                        segments.push(currentSegment);
                        currentSegment = null;
                    }
                    
                    // Single rapid/retract segment
                    segments.push({
                        commands: [cmd],
                        start: {x: cmd.x || 0, y: cmd.y || 0},
                        end: {x: cmd.x || 0, y: cmd.y || 0},
                        isRapid: true
                    });
                } else {
                    // Cutting move
                    if (!currentSegment) {
                        currentSegment = {
                            commands: [],
                            start: {x: cmd.x || 0, y: cmd.y || 0},
                            end: null,
                            isRapid: false
                        };
                    }
                    
                    currentSegment.commands.push(cmd);
                    currentSegment.end = {x: cmd.x || 0, y: cmd.y || 0};
                }
            }
            
            // Add final segment
            if (currentSegment && currentSegment.commands.length > 0) {
                segments.push(currentSegment);
            }
            
            return segments;
        }
        
        /**
         * Sort segments using nearest neighbor algorithm
         */
        nearestNeighborSort(segments) {
            if (segments.length <= 1) return segments;
            
            // Separate rapids from cutting segments
            const rapids = segments.filter(s => s.isRapid);
            const cutting = segments.filter(s => !s.isRapid);
            
            if (cutting.length <= 1) return segments;
            
            // Start with first cutting segment
            const sorted = [cutting[0]];
            const remaining = cutting.slice(1);
            
            while (remaining.length > 0) {
                const lastEnd = sorted[sorted.length - 1].end;
                let nearestIdx = 0;
                let nearestDist = this.calculateDistance(lastEnd, remaining[0].start);
                
                // Find nearest segment
                for (let i = 1; i < remaining.length; i++) {
                    const dist = this.calculateDistance(lastEnd, remaining[i].start);
                    if (dist < nearestDist) {
                        nearestDist = dist;
                        nearestIdx = i;
                    }
                }
                
                // Move nearest to sorted
                sorted.push(remaining[nearestIdx]);
                remaining.splice(nearestIdx, 1);
            }
            
            // Rebuild with rapids between cutting segments
            const result = [];
            for (let i = 0; i < sorted.length; i++) {
                if (i > 0) {
                    // Add rapid between segments
                    const prevEnd = sorted[i - 1].end;
                    const currStart = sorted[i].start;
                    
                    result.push({
                        commands: [{
                            type: 'RAPID',
                            x: currStart.x,
                            y: currStart.y,
                            z: 2.0 // Travel height
                        }],
                        isRapid: true
                    });
                }
                result.push(sorted[i]);
            }
            
            return result;
        }
        
        /**
         * Check if two moves are collinear
         */
        areCollinear(cmd1, cmd2) {
            if (!cmd1 || !cmd2) return false;
            
            // Get direction vectors
            const dx1 = (cmd1.x || 0) - (cmd1.prevX || 0);
            const dy1 = (cmd1.y || 0) - (cmd1.prevY || 0);
            const dx2 = (cmd2.x || 0) - (cmd1.x || 0);
            const dy2 = (cmd2.y || 0) - (cmd1.y || 0);
            
            // Check cross product (should be near zero for collinear)
            const cross = dx1 * dy2 - dy1 * dx2;
            return Math.abs(cross) < this.precision;
        }
        
        /**
         * Calculate distance between two points
         */
        calculateDistance(p1, p2) {
            if (!p1 || !p2) return 0;
            
            const dx = (p2.x || 0) - (p1.x || 0);
            const dy = (p2.y || 0) - (p1.y || 0);
            const dz = (p2.z || 0) - (p1.z || 0);
            
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        
        /**
         * Calculate total rapid distance in command sequence
         */
        calculateTotalRapidDistance(commands) {
            let totalDistance = 0;
            let lastPos = {x: 0, y: 0, z: 0};
            
            for (const cmd of commands) {
                if (cmd.type === 'RAPID') {
                    const distance = this.calculateDistance(lastPos, cmd);
                    totalDistance += distance;
                }
                
                // Update position
                if (cmd.x !== undefined) lastPos.x = cmd.x;
                if (cmd.y !== undefined) lastPos.y = cmd.y;
                if (cmd.z !== undefined) lastPos.z = cmd.z;
            }
            
            return totalDistance;
        }
        
        /**
         * Reset statistics
         */
        resetStatistics() {
            this.statistics = {
                originalRapidDistance: 0,
                optimizedRapidDistance: 0,
                commandsRemoved: 0,
                pathsReordered: 0,
                optimizationTime: 0
            };
        }
        
        /**
         * Log optimization results
         */
        logOptimizationResults() {
            const stats = this.statistics;
            const reduction = stats.originalRapidDistance - stats.optimizedRapidDistance;
            const percentage = (reduction / stats.originalRapidDistance * 100).toFixed(1);
            
            console.log('[ToolpathOptimizer] Optimization complete:');
            console.log(`  Commands removed: ${stats.commandsRemoved}`);
            console.log(`  Paths reordered: ${stats.pathsReordered}`);
            console.log(`  Rapid distance: ${stats.originalRapidDistance.toFixed(1)}mm → ${stats.optimizedRapidDistance.toFixed(1)}mm`);
            console.log(`  Reduction: ${reduction.toFixed(1)}mm (${percentage}%)`);
            console.log(`  Time: ${stats.optimizationTime}ms`);
        }
        
        /**
         * Get optimization statistics
         */
        getStatistics() {
            return { ...this.statistics };
        }
    }
    
    window.ToolpathOptimizer = ToolpathOptimizer;
    
})();