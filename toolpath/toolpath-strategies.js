/**
 * @file        toolpath/toolpath-strategies.js
 * @description Z-axis motion planning and entry/exit strategies
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
    const machineConfig = config.machine || {};
    const debugConfig = config.debug || {};
    
    class ToolpathStrategies {
        constructor() {
            this.precision = config.geometry?.coordinatePrecision || 0.001;
        }
        
        /**
         * Calculate Z-axis depth levels for multi-pass cutting
         */
        calculateDepthLevels(params) {
            const levels = [];
            const finalDepth = params.cutDepth || -1.0;
            
            if (!params.multiDepth) {
                // Single pass
                levels.push(finalDepth);
            } else {
                // Multiple passes
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
         * Generate plunge entry motion
         */
        generatePlungeEntry(position, targetDepth, params) {
            const commands = [];
            
            // Move to XY position at travel Z
            commands.push({
                type: 'RAPID',
                x: position.x,
                y: position.y,
                z: params.travelZ || 2.0
            });
            
            // Plunge down
            commands.push({
                type: 'PLUNGE',
                z: targetDepth,
                feed: params.plungeRate || 50
            });
            
            return commands;
        }
        
        /**
         * Generate ramp entry motion
         */
        generateRampEntry(position, targetDepth, params) {
            const commands = [];
            const rampAngle = params.rampAngle || 10; // degrees
            const rampLength = Math.abs(targetDepth) / Math.tan(rampAngle * Math.PI / 180);
            const rampSteps = Math.max(3, Math.ceil(rampLength / 1.0)); // 1mm max step
            
            // Move to start of ramp at travel Z
            commands.push({
                type: 'RAPID',
                x: position.x - rampLength,
                y: position.y,
                z: params.travelZ || 2.0
            });
            
            // Ramp down
            for (let i = 1; i <= rampSteps; i++) {
                const ratio = i / rampSteps;
                commands.push({
                    type: 'LINEAR',
                    x: position.x - rampLength + (rampLength * ratio),
                    y: position.y,
                    z: targetDepth * ratio,
                    feed: params.plungeRate || 50
                });
            }
            
            return commands;
        }
        
        /**
         * Generate helical entry motion
         */
        generateHelicalEntry(position, targetDepth, params) {
            const commands = [];
            const helixRadius = (params.tool?.diameter || 1.0) * 0.75;
            const helixPitch = params.helixPitch || 0.5; // mm per revolution
            const revolutions = Math.abs(targetDepth) / helixPitch;
            const segmentsPerRev = 16;
            const totalSegments = Math.ceil(revolutions * segmentsPerRev);
            
            // Move above helix center
            commands.push({
                type: 'RAPID',
                x: position.x,
                y: position.y,
                z: params.travelZ || 2.0
            });
            
            // Start position
            commands.push({
                type: 'LINEAR',
                x: position.x + helixRadius,
                y: position.y,
                z: 0,
                feed: params.plungeRate || 50
            });
            
            // Helical segments
            for (let i = 1; i <= totalSegments; i++) {
                const angle = (i / segmentsPerRev) * 2 * Math.PI;
                const z = (i / totalSegments) * targetDepth;
                
                // Use arcs for smoother helix
                if (i % 4 === 0) { // Every 90 degrees
                    const prevAngle = ((i - 1) / segmentsPerRev) * 2 * Math.PI;
                    const centerOffset = {
                        i: -helixRadius * Math.cos(prevAngle),
                        j: -helixRadius * Math.sin(prevAngle)
                    };
                    
                    commands.push({
                        type: 'ARC_CCW',
                        x: position.x + helixRadius * Math.cos(angle),
                        y: position.y + helixRadius * Math.sin(angle),
                        z: z,
                        i: centerOffset.i,
                        j: centerOffset.j,
                        feed: params.plungeRate || 50
                    });
                } else {
                    commands.push({
                        type: 'LINEAR',
                        x: position.x + helixRadius * Math.cos(angle),
                        y: position.y + helixRadius * Math.sin(angle),
                        z: z,
                        feed: params.plungeRate || 50
                    });
                }
            }
            
            // Move to center at depth
            commands.push({
                type: 'LINEAR',
                x: position.x,
                y: position.y,
                z: targetDepth,
                feed: params.feedRate || 150
            });
            
            return commands;
        }
        
        /**
         * Generate retract motion
         */
        generateRetract(currentZ, params) {
            return [{
                type: 'RETRACT',
                z: params.travelZ || 2.0
            }];
        }
        
        /**
         * Generate safe retract to clearance height
         */
        generateSafeRetract(params) {
            return [{
                type: 'RETRACT',
                z: params.safeZ || 5.0
            }];
        }
        
        /**
         * Calculate tab positions for cutout operations
         */
        calculateTabPositions(pathLength, params) {
            const positions = [];
            const tabCount = params.tabs || 0;
            
            if (tabCount <= 0) return positions;
            
            const tabWidth = params.tabWidth || 3.0;
            const tabHeight = params.tabHeight || 0.5;
            const spacing = pathLength / tabCount;
            
            for (let i = 0; i < tabCount; i++) {
                const centerDistance = (i + 0.5) * spacing;
                positions.push({
                    start: centerDistance - tabWidth / 2,
                    end: centerDistance + tabWidth / 2,
                    height: tabHeight
                });
            }
            
            return positions;
        }
        
        /**
         * Insert tab lift motions into command sequence
         */
        insertTabLift(commands, tabPosition, currentDepth, params) {
            const tabZ = currentDepth + tabPosition.height;
            const liftCommands = [];
            
            // Lift for tab
            liftCommands.push({
                type: 'LINEAR',
                z: tabZ,
                feed: params.plungeRate || 50
            });
            
            // Continue at tab height (coordinates handled by caller)
            
            // Plunge back down after tab
            liftCommands.push({
                type: 'PLUNGE',
                z: currentDepth,
                feed: params.plungeRate || 50
            });
            
            return liftCommands;
        }
        
        /**
         * Generate pecking cycle for drilling
         */
        generatePeckCycle(position, finalDepth, params) {
            const commands = [];
            const peckDepth = params.peckDepth || 0;
            const dwellTime = params.dwellTime || 0;
            const retractHeight = params.retractHeight || 0.5;
            
            // Move to position
            commands.push({
                type: 'RAPID',
                x: position.x,
                y: position.y,
                z: params.travelZ || 2.0
            });
            
            if (peckDepth === 0 || params.cannedCycle === 'none') {
                // Simple drilling
                commands.push({
                    type: 'PLUNGE',
                    z: finalDepth,
                    feed: params.plungeRate || 30
                });
                
                if (dwellTime > 0) {
                    commands.push({
                        type: 'DWELL',
                        duration: dwellTime
                    });
                }
                
                commands.push({
                    type: 'RETRACT',
                    z: params.travelZ || 2.0
                });
            } else {
                // Peck drilling
                let currentDepth = 0;
                let rapidDepth = 0;
                
                while (currentDepth > finalDepth) {
                    // Calculate next peck depth
                    let targetDepth = currentDepth - peckDepth;
                    if (targetDepth < finalDepth) {
                        targetDepth = finalDepth;
                    }
                    
                    // Rapid to previous depth if returning
                    if (rapidDepth < 0) {
                        commands.push({
                            type: 'RAPID',
                            z: rapidDepth + 0.1
                        });
                    }
                    
                    // Plunge peck
                    commands.push({
                        type: 'PLUNGE',
                        z: targetDepth,
                        feed: params.plungeRate || 30
                    });
                    
                    if (dwellTime > 0) {
                        commands.push({
                            type: 'DWELL',
                            duration: dwellTime
                        });
                    }
                    
                    // Retract for chip clearing if not at final depth
                    if (targetDepth > finalDepth) {
                        commands.push({
                            type: 'RETRACT',
                            z: currentDepth + retractHeight
                        });
                        rapidDepth = targetDepth;
                    }
                    
                    currentDepth = targetDepth;
                }
                
                // Final retract
                commands.push({
                    type: 'RETRACT',
                    z: params.travelZ || 2.0
                });
            }
            
            return commands;
        }
        
        /**
         * Select appropriate entry strategy based on parameters
         */
        selectEntryStrategy(params) {
            const entryType = params.entryType || 'plunge';
            
            switch(entryType) {
                case 'ramp':
                    if (params.cutDepth && Math.abs(params.cutDepth) > 0.5) {
                        return 'ramp';
                    }
                    return 'plunge';
                    
                case 'helix':
                    if (params.tool?.diameter && params.tool.diameter < 3.0) {
                        return 'helix';
                    }
                    return 'plunge';
                    
                default:
                    return 'plunge';
            }
        }
        
        /**
         * Calculate optimal feed rate based on material and tool
         */
        calculateOptimalFeed(params) {
            const baseFeed = params.feedRate || 150;
            const material = params.material || 'FR4';
            const toolDiameter = params.tool?.diameter || 1.0;
            
            // Adjust for material
            const materialFactors = {
                'FR4': 1.0,
                'aluminum': 0.5,
                'copper': 0.7,
                'plastic': 1.5
            };
            
            const materialFactor = materialFactors[material] || 1.0;
            
            // Adjust for tool diameter (smaller tools = slower)
            const toolFactor = Math.min(1.0, toolDiameter / 1.0);
            
            return baseFeed * materialFactor * toolFactor;
        }
    }
    
    window.ToolpathStrategies = ToolpathStrategies;
    
})();