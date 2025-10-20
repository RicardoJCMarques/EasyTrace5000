/**
 * @file        toolpath/toolpath-calculator.js
 * @description Complete toolpath calculation engine
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
    const machineConfig = config.machine || {};
    
    // Lightweight motion command structure
    class MotionCommand {
        constructor(type, coords, params = {}) {
            this.type = type; // 'RAPID', 'LINEAR', 'ARC_CW', 'ARC_CCW', 'PLUNGE', 'RETRACT', 'DWELL'
            this.x = coords.x;
            this.y = coords.y;
            this.z = coords.z;
            this.f = params.feed;
            
            // Arc parameters (I,J are relative offsets from start)
            if (type === 'ARC_CW' || type === 'ARC_CCW') {
                this.i = params.i;
                this.j = params.j;
            }
            
            // Optional parameters
            if (params.dwell) this.dwell = params.dwell;
            if (params.comment) this.comment = params.comment;
        }
    }
    
    // Toolpath plan container
    class ToolpathPlan {
        constructor(operationId) {
            this.operationId = operationId;
            this.commands = [];
            this.metadata = {
                tool: null,
                estimatedTime: 0,
                boundingBox: null,
                totalDistance: 0,
                depthLevels: []
            };
        }
        
        addCommand(cmd) {
            this.commands.push(cmd);
        }
        
        addRapid(x, y, z) {
            this.commands.push(new MotionCommand('RAPID', {x, y, z}));
        }
        
        addLinear(x, y, z, feed) {
            this.commands.push(new MotionCommand('LINEAR', {x, y, z}, {feed}));
        }
        
        addPlunge(z, feed) {
            this.commands.push(new MotionCommand('PLUNGE', {x: null, y: null, z}, {feed}));
        }
        
        addRetract(z) {
            this.commands.push(new MotionCommand('RETRACT', {x: null, y: null, z}));
        }
        
        addArc(x, y, z, i, j, clockwise, feed) {
            const type = clockwise ? 'ARC_CW' : 'ARC_CCW';
            this.commands.push(new MotionCommand(type, {x, y, z}, {i, j, feed}));
        }
        
        addDwell(duration) {
            this.commands.push(new MotionCommand('DWELL', {x: null, y: null, z: null}, {dwell: duration}));
        }
    }
    
    class ToolpathCalculator {
        constructor(core) {
            this.core = core;
            this.currentPosition = {x: 0, y: 0, z: 0};
        }
        
        async calculateToolpath(operation) {
            if (!operation.offsets || operation.offsets.length === 0) {
                throw new Error('No offset geometry to calculate toolpath from');
            }
            
            const plan = new ToolpathPlan(operation.id);
            const settings = operation.settings || {};
            
            // Extract key parameters
            const params = {
                cutDepth: settings.cutDepth || -1.0,
                depthPerPass: settings.depthPerPass || 0.5,
                multiDepth: settings.multiDepth || false,
                safeZ: settings.safeZ || machineConfig.heights?.safeZ || 5.0,
                travelZ: settings.travelZ || machineConfig.heights?.travelZ || 2.0,
                feedRate: settings.feedRate || 150,
                plungeRate: settings.plungeRate || 50,
                spindleSpeed: settings.spindleSpeed || 12000,
                direction: settings.direction || 'climb',
                entryType: settings.entryType || 'plunge',
                tabs: settings.tabs || 0,
                tabWidth: settings.tabWidth || 3.0,
                tabHeight: settings.tabHeight || 0.5,
                tool: settings.tool || { diameter: 1.0 },
                
                // Drilling specific
                cannedCycle: settings.cannedCycle || 'none',
                peckDepth: settings.peckDepth || 0,
                dwellTime: settings.dwellTime || 0,
                retractHeight: settings.retractHeight || 0.5
            };
            
            // Calculate depth levels
            const depthLevels = this.calculateDepthLevels(params);
            plan.metadata.depthLevels = depthLevels;
            plan.metadata.tool = params.tool;
            
            // Initial rapid to safe Z
            plan.addRetract(params.safeZ);
            
            // Process based on operation type
            if (operation.type === 'drill') {
                this.processDrillOperation(plan, operation, params, depthLevels);
            } else if (operation.type === 'cutout') {
                this.processCutoutOperation(plan, operation, params, depthLevels);
            } else {
                this.processMillingOperation(plan, operation, params, depthLevels);
            }
            
            // Final retract
            plan.addRetract(params.safeZ);
            
            // Calculate metadata
            this.calculateMetadata(plan);
            
            if (debugConfig.enabled) {
                console.log(`[ToolpathCalculator] Generated ${plan.commands.length} commands for operation ${operation.id}`);
            }
            
            return plan;
        }
        
        calculateDepthLevels(params) {
            const levels = [];
            
            if (!params.multiDepth) {
                // Single depth
                levels.push(params.cutDepth);
            } else {
                // Multiple passes
                let currentDepth = 0;
                while (currentDepth > params.cutDepth) {
                    currentDepth -= params.depthPerPass;
                    if (currentDepth < params.cutDepth) {
                        currentDepth = params.cutDepth;
                    }
                    levels.push(currentDepth);
                }
            }
            
            return levels;
        }
        
        processMillingOperation(plan, operation, params, depthLevels) {
            for (const offsetGroup of operation.offsets) {
                if (!offsetGroup.primitives || offsetGroup.primitives.length === 0) continue;
                
                for (const depthLevel of depthLevels) {
                    // Process each primitive at this depth
                    for (const primitive of offsetGroup.primitives) {
                        this.processPrimitive(plan, primitive, depthLevel, params);
                    }
                }
            }
        }
        
        processDrillOperation(plan, operation, params, depthLevels) {
            // Drill operations should have strategy primitives in offsets
            const strategyPrimitives = operation.offsets[0]?.primitives || [];
            
            for (const primitive of strategyPrimitives) {
                const role = primitive.properties?.role;
                
                if (role === 'peck_mark') {
                    // Peck drilling at this position
                    this.generatePeckCycle(plan, primitive, params, depthLevels);
                } else if (role === 'drill_milling_path') {
                    // Mill the hole
                    for (const depth of depthLevels) {
                        this.processPrimitive(plan, primitive, depth, params);
                    }
                }
            }
        }
        
        generatePeckCycle(plan, primitive, params, depthLevels) {
            const position = primitive.center;
            const finalDepth = depthLevels[depthLevels.length - 1];
            
            // Rapid to position at travel Z
            plan.addRapid(position.x, position.y, params.travelZ);
            
            if (params.cannedCycle === 'none' || params.peckDepth === 0) {
                // Simple drill
                plan.addPlunge(finalDepth, params.plungeRate);
                if (params.dwellTime > 0) {
                    plan.addDwell(params.dwellTime);
                }
                plan.addRetract(params.travelZ);
            } else {
                // Peck drilling
                let currentDepth = 0;
                while (currentDepth > finalDepth) {
                    currentDepth -= params.peckDepth;
                    if (currentDepth < finalDepth) {
                        currentDepth = finalDepth;
                    }
                    
                    plan.addPlunge(currentDepth, params.plungeRate);
                    
                    if (params.dwellTime > 0) {
                        plan.addDwell(params.dwellTime);
                    }
                    
                    if (currentDepth > finalDepth) {
                        // Retract for chip clearing
                        plan.addRetract(params.retractHeight);
                        // Rapid back down
                        plan.addRapid(null, null, currentDepth + 0.1);
                    }
                }
                
                plan.addRetract(params.travelZ);
            }
        }
        
        processCutoutOperation(plan, operation, params, depthLevels) {
            const tabPositions = params.tabs > 0 ? this.calculateTabPositions(operation, params) : [];
            
            for (const offsetGroup of operation.offsets) {
                if (!offsetGroup.primitives || offsetGroup.primitives.length === 0) continue;
                
                for (const depthLevel of depthLevels) {
                    const isLastPass = depthLevel === depthLevels[depthLevels.length - 1];
                    
                    for (const primitive of offsetGroup.primitives) {
                        if (isLastPass && tabPositions.length > 0) {
                            this.processPrimitiveWithTabs(plan, primitive, depthLevel, params, tabPositions);
                        } else {
                            this.processPrimitive(plan, primitive, depthLevel, params);
                        }
                    }
                }
            }
        }
        
        calculateTabPositions(operation, params) {
            const positions = [];
            if (!operation.offsets[0]?.primitives[0]) return positions;
            
            const primitive = operation.offsets[0].primitives[0];
            if (primitive.type !== 'path' || !primitive.points) return positions;
            
            const totalLength = this.calculatePathLength(primitive.points);
            const spacing = totalLength / params.tabs;
            
            for (let i = 0; i < params.tabs; i++) {
                const distance = i * spacing + spacing / 2;
                const position = this.getPointAtDistance(primitive.points, distance);
                if (position) {
                    positions.push({
                        start: distance - params.tabWidth / 2,
                        end: distance + params.tabWidth / 2,
                        position: position,
                        height: params.tabHeight
                    });
                }
            }
            
            return positions;
        }
        
        processPrimitive(plan, primitive, depth, params) {
            const entryPoint = this.getEntryPoint(primitive);
            if (!entryPoint) return;
            
            // Move to entry position
            plan.addRapid(entryPoint.x, entryPoint.y, params.travelZ);
            
            // Entry strategy
            if (params.entryType === 'plunge') {
                plan.addPlunge(depth, params.plungeRate);
            } else if (params.entryType === 'ramp') {
                this.generateRampEntry(plan, entryPoint, depth, params);
            } else if (params.entryType === 'helix') {
                this.generateHelixEntry(plan, entryPoint, depth, params);
            }
            
            // Process the primitive geometry
            if (primitive.type === 'circle') {
                this.processCircle(plan, primitive, depth, params);
            } else if (primitive.type === 'arc') {
                this.processArc(plan, primitive, depth, params);
            } else if (primitive.type === 'path') {
                this.processPath(plan, primitive, depth, params);
            }
            
            // Retract
            plan.addRetract(params.travelZ);
        }
        
        processPrimitiveWithTabs(plan, primitive, depth, params, tabPositions) {
            if (primitive.type !== 'path' || !primitive.points) {
                // Fallback to normal processing for non-paths
                this.processPrimitive(plan, primitive, depth, params);
                return;
            }
            
            const entryPoint = this.getEntryPoint(primitive);
            plan.addRapid(entryPoint.x, entryPoint.y, params.travelZ);
            plan.addPlunge(depth, params.plungeRate);
            
            // Process path with tab lifts
            let currentDistance = 0;
            let currentTabIndex = 0;
            
            for (let i = 0; i < primitive.points.length - 1; i++) {
                const p1 = primitive.points[i];
                const p2 = primitive.points[i + 1];
                const segmentLength = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                
                // Check if we need to lift for a tab
                if (currentTabIndex < tabPositions.length) {
                    const tab = tabPositions[currentTabIndex];
                    
                    if (currentDistance <= tab.start && currentDistance + segmentLength >= tab.start) {
                        // Lift for tab
                        const tabZ = depth + tab.height;
                        plan.addLinear(null, null, tabZ, params.plungeRate);
                        plan.addLinear(p2.x, p2.y, tabZ, params.feedRate);
                        plan.addPlunge(depth, params.plungeRate);
                        currentTabIndex++;
                    } else {
                        plan.addLinear(p2.x, p2.y, depth, params.feedRate);
                    }
                } else {
                    plan.addLinear(p2.x, p2.y, depth, params.feedRate);
                }
                
                currentDistance += segmentLength;
            }
            
            plan.addRetract(params.travelZ);
        }
        
        processCircle(plan, primitive, depth, params) {
            const radius = primitive.radius;
            const center = primitive.center;
            
            // Start at 0 degrees
            const startX = center.x + radius;
            const startY = center.y;
            
            // Move to start
            plan.addLinear(startX, startY, depth, params.feedRate);
            
            // Full circle as G2/G3
            const clockwise = params.direction === 'conventional';
            plan.addArc(startX, startY, depth, -radius, 0, clockwise, params.feedRate);
        }
        
        processArc(plan, primitive, depth, params) {
            // Move to start point
            plan.addLinear(primitive.startPoint.x, primitive.startPoint.y, depth, params.feedRate);
            
            // Arc move
            const i = primitive.center.x - primitive.startPoint.x;
            const j = primitive.center.y - primitive.startPoint.y;
            
            plan.addArc(
                primitive.endPoint.x,
                primitive.endPoint.y,
                depth,
                i, j,
                primitive.clockwise,
                params.feedRate
            );
        }
        
        processPath(plan, primitive, depth, params) {
            const points = primitive.points;
            if (!points || points.length < 2) return;
            
            // Check for arc segments
            const arcSegments = primitive.arcSegments || [];
            let arcIndex = 0;
            
            for (let i = 0; i < points.length; i++) {
                const point = points[i];
                
                // Check if this point starts an arc
                if (arcIndex < arcSegments.length && i === arcSegments[arcIndex].startIndex) {
                    const arc = arcSegments[arcIndex];
                    const endPoint = points[arc.endIndex];
                    
                    // Calculate I,J
                    const i_val = arc.center.x - point.x;
                    const j_val = arc.center.y - point.y;
                    
                    plan.addArc(
                        endPoint.x,
                        endPoint.y,
                        depth,
                        i_val,
                        j_val,
                        arc.clockwise,
                        params.feedRate
                    );
                    
                    // Skip to end of arc
                    i = arc.endIndex - 1; // -1 because loop will increment
                    arcIndex++;
                } else if (i > 0) {
                    // Linear move
                    plan.addLinear(point.x, point.y, depth, params.feedRate);
                }
            }
        }
        
        generateRampEntry(plan, entryPoint, targetDepth, params) {
            const rampLength = Math.abs(targetDepth) * 3; // 3:1 ramp ratio
            const steps = Math.ceil(rampLength / 1.0); // 1mm steps
            
            for (let i = 1; i <= steps; i++) {
                const ratio = i / steps;
                const z = ratio * targetDepth;
                const x = entryPoint.x + ratio * rampLength;
                plan.addLinear(x, entryPoint.y, z, params.plungeRate);
            }
        }
        
        generateHelixEntry(plan, entryPoint, targetDepth, params) {
            const helixRadius = params.tool.diameter * 1.5;
            const helixPitch = 0.5; // mm per revolution
            const revolutions = Math.abs(targetDepth) / helixPitch;
            const steps = Math.ceil(revolutions * 16); // 16 segments per revolution
            
            for (let i = 1; i <= steps; i++) {
                const angle = (i / steps) * revolutions * 2 * Math.PI;
                const z = (i / steps) * targetDepth;
                const x = entryPoint.x + helixRadius * Math.cos(angle);
                const y = entryPoint.y + helixRadius * Math.sin(angle);
                plan.addLinear(x, y, z, params.plungeRate);
            }
        }
        
        getEntryPoint(primitive) {
            if (primitive.type === 'circle') {
                return {
                    x: primitive.center.x + primitive.radius,
                    y: primitive.center.y
                };
            } else if (primitive.type === 'arc') {
                return primitive.startPoint;
            } else if (primitive.type === 'path' && primitive.points?.length > 0) {
                return primitive.points[0];
            }
            return null;
        }
        
        calculatePathLength(points) {
            let length = 0;
            for (let i = 1; i < points.length; i++) {
                length += Math.hypot(
                    points[i].x - points[i - 1].x,
                    points[i].y - points[i - 1].y
                );
            }
            return length;
        }
        
        getPointAtDistance(points, targetDistance) {
            let currentDistance = 0;
            
            for (let i = 1; i < points.length; i++) {
                const segmentLength = Math.hypot(
                    points[i].x - points[i - 1].x,
                    points[i].y - points[i - 1].y
                );
                
                if (currentDistance + segmentLength >= targetDistance) {
                    const ratio = (targetDistance - currentDistance) / segmentLength;
                    return {
                        x: points[i - 1].x + ratio * (points[i].x - points[i - 1].x),
                        y: points[i - 1].y + ratio * (points[i].y - points[i - 1].y)
                    };
                }
                
                currentDistance += segmentLength;
            }
            
            return points[points.length - 1];
        }
        
        calculateMetadata(plan) {
            let totalDistance = 0;
            let totalTime = 0;
            let minX = Infinity, minY = Infinity, minZ = Infinity;
            let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
            
            let lastPosition = {x: 0, y: 0, z: 0};
            
            for (const cmd of plan.commands) {
                // Update bounds
                if (cmd.x !== null) {
                    minX = Math.min(minX, cmd.x);
                    maxX = Math.max(maxX, cmd.x);
                }
                if (cmd.y !== null) {
                    minY = Math.min(minY, cmd.y);
                    maxY = Math.max(maxY, cmd.y);
                }
                if (cmd.z !== null) {
                    minZ = Math.min(minZ, cmd.z);
                    maxZ = Math.max(maxZ, cmd.z);
                }
                
                // Calculate distance and time
                if (cmd.type === 'LINEAR' || cmd.type === 'RAPID') {
                    const distance = Math.sqrt(
                        Math.pow((cmd.x || lastPosition.x) - lastPosition.x, 2) +
                        Math.pow((cmd.y || lastPosition.y) - lastPosition.y, 2) +
                        Math.pow((cmd.z || lastPosition.z) - lastPosition.z, 2)
                    );
                    totalDistance += distance;
                    
                    const feed = cmd.f || (cmd.type === 'RAPID' ? 1000 : 100);
                    totalTime += (distance / feed) * 60; // Convert to seconds
                } else if (cmd.type === 'ARC_CW' || cmd.type === 'ARC_CCW') {
                    // Approximate arc length
                    const radius = Math.hypot(cmd.i, cmd.j);
                    const arcLength = radius * Math.PI; // Approximate as semicircle
                    totalDistance += arcLength;
                    
                    const feed = cmd.f || 100;
                    totalTime += (arcLength / feed) * 60;
                } else if (cmd.type === 'DWELL') {
                    totalTime += cmd.dwell || 0;
                }
                
                // Update position
                if (cmd.x !== null) lastPosition.x = cmd.x;
                if (cmd.y !== null) lastPosition.y = cmd.y;
                if (cmd.z !== null) lastPosition.z = cmd.z;
            }
            
            plan.metadata.totalDistance = totalDistance;
            plan.metadata.estimatedTime = totalTime;
            plan.metadata.boundingBox = {
                minX: isFinite(minX) ? minX : 0,
                minY: isFinite(minY) ? minY : 0,
                minZ: isFinite(minZ) ? minZ : 0,
                maxX: isFinite(maxX) ? maxX : 0,
                maxY: isFinite(maxY) ? maxY : 0,
                maxZ: isFinite(maxZ) ? maxZ : 0
            };
        }
    }
    
    window.ToolpathCalculator = ToolpathCalculator;
    window.MotionCommand = MotionCommand;
    window.ToolpathPlan = ToolpathPlan;
    
})();