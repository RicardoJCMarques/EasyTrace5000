/**
 * @file        export/gcode-generator.js
 * @description Complete G-code generation from toolpath plans
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
    
    class GCodeGenerator {
        constructor(config) {
            this.config = config;
            this.processors = new Map();
            this.currentProcessor = null;
            this.core = null;
            this.untransformedPosition = { x: 0, y: 0, z: 0 };
            
            this.registerDefaultProcessors();
        }

        setCore(coreInstance) {
            this.core = coreInstance;
        }
        
        registerDefaultProcessors() {
            if (typeof GRBLPostProcessor !== 'undefined') {
                this.registerProcessor('grbl', new GRBLPostProcessor());
            }
            if (typeof MarlinPostProcessor !== 'undefined') {
                this.registerProcessor('marlin', new MarlinPostProcessor());
            }
            if (typeof RolandPostProcessor !== 'undefined') {
                this.registerProcessor('roland', new RolandPostProcessor());
            }
            if (typeof LinuxCNCPostProcessor !== 'undefined') {
                this.registerProcessor('linuxcnc', new LinuxCNCPostProcessor());
            }
            if (typeof Mach3PostProcessor !== 'undefined') {
                this.registerProcessor('mach3', new Mach3PostProcessor());
            }
        }
        
        registerProcessor(name, processor) {
            this.processors.set(name.toLowerCase(), processor);
        }
        
        getProcessor(name) {
            return this.processors.get(name.toLowerCase());
        }
        
        generate(toolpathPlans, options) {
            if (!toolpathPlans || toolpathPlans.length === 0) {
                return '; No toolpath data available';
            }
            
            const processorName = options.postProcessor || 'grbl';
            this.currentProcessor = this.getProcessor(processorName);
            
            if (!this.currentProcessor) {
                throw new Error(`Post-processor '${processorName}' not found`);
            }
            
            this.currentProcessor.resetState();
            this.untransformedPosition = { x: 0, y: 0, z: 0 };
            
            const output = [];
            output.push(this.currentProcessor.generateHeader(options));
            
            let coordinateTransform = null;
            if (this.core && this.core.coordinateSystem) {
                coordinateTransform = this.core.coordinateSystem.getCoordinateTransform();
            }

            for (const plan of toolpathPlans) {
                for (const cmd of plan.commands) {
                    
                    // Snapshot untransformed position at START of command
                    const untransformedStartPos = { ...this.untransformedPosition };

                    let commandsToProcess = [cmd];

                    // Linearize arcs if needed
                    if ((cmd.type === 'ARC_CW' || cmd.type === 'ARC_CCW') &&
                        !this.currentProcessor.config.supportsArcCommands) 
                    {
                        const radius = Math.hypot(cmd.i || 0, cmd.j || 0);
                        const baseResolution = options.arcResolution || 0.1;
                        const adaptiveResolution = radius < 2 ? baseResolution * 0.5 : 
                                                radius > 10 ? baseResolution * 2 : 
                                                baseResolution;
                        
                        commandsToProcess = this.linearizeArc(cmd, untransformedStartPos, adaptiveResolution);
                    }
                    
                    // Process each command/segment
                    for (const commandToProcess of commandsToProcess) {
                        const startPosForTransform = { ...this.untransformedPosition };
                        
                        let transformedCmd = commandToProcess;
                        if (coordinateTransform) {
                            transformedCmd = this.transformCommand(commandToProcess, coordinateTransform, startPosForTransform);
                        }

                        const gcode = this.currentProcessor.processCommand(transformedCmd, options);
                        if (gcode) {
                            output.push(gcode);
                        }

                        // Update untransformed position to END of segment
                        if (commandToProcess.x !== null && commandToProcess.x !== undefined) {
                            this.untransformedPosition.x = commandToProcess.x;
                        }
                        if (commandToProcess.y !== null && commandToProcess.y !== undefined) {
                            this.untransformedPosition.y = commandToProcess.y;
                        }
                        if (commandToProcess.z !== null && commandToProcess.z !== undefined) {
                            this.untransformedPosition.z = commandToProcess.z;
                        }
                    }
                }
            }
            
            output.push(this.currentProcessor.generateFooter(options));
            return output.join('\n');
        }

        transformCommand(cmd, transform, currentUntransformedPos) {
            const transformed = { ...cmd };
            
            const hasX = cmd.x !== null && cmd.x !== undefined;
            const hasY = cmd.y !== null && cmd.y !== undefined;
            
            const x = hasX ? cmd.x : currentUntransformedPos.x;
            const y = hasY ? cmd.y : currentUntransformedPos.y;
            
            // Apply Offset
            let tx = x + transform.offsetX;
            let ty = y + transform.offsetY;
            
            // Apply Rotation
            if (transform.rotation !== 0 && transform.rotationCenter) {
                const rad = (transform.rotation * Math.PI) / 180;
                const cx = transform.rotationCenter.x + transform.offsetX;
                const cy = transform.rotationCenter.y + transform.offsetY;
                
                const dx = tx - cx;
                const dy = ty - cy;
                
                tx = cx + (dx * Math.cos(rad) - dy * Math.sin(rad));
                ty = cy + (dx * Math.sin(rad) + dy * Math.cos(rad));
            }
            
            // Only write back coordinates present in original command
            if (hasX) transformed.x = tx;
            if (hasY) transformed.y = ty;
            
            // Transform I,J for arcs (relative offsets)
            if ((cmd.type === 'ARC_CW' || cmd.type === 'ARC_CCW') && transform.rotation !== 0) {
                const rad = (transform.rotation * Math.PI) / 180;
                const i = cmd.i || 0;
                const j = cmd.j || 0;
                
                transformed.i = i * Math.cos(rad) - j * Math.sin(rad);
                transformed.j = i * Math.sin(rad) + j * Math.cos(rad);
            }
            
            return transformed;
        }
        
        /**
         * Linearize arc command
         */
        linearizeArc(cmd, startPos, resolution = 1.0) {
            const linearizedCmds = [];
            
            const start = {
                x: startPos.x,
                y: startPos.y,
                z: startPos.z
            };
            const end = {
                x: (cmd.x !== null && cmd.x !== undefined) ? cmd.x : start.x,
                y: (cmd.y !== null && cmd.y !== undefined) ? cmd.y : start.y,
                z: (cmd.z !== null && cmd.z !== undefined) ? cmd.z : start.z
            };
            const center = {
                x: start.x + (cmd.i || 0),
                y: start.y + (cmd.j || 0)
            };
            const radius = Math.hypot(cmd.i || 0, cmd.j || 0);
            
            if (radius < 1e-9) {
                return [new MotionCommand('LINEAR', end, { feed: cmd.f })];
            }
            
            const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
            const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
            
            let sweep = endAngle - startAngle;
            if (cmd.type === 'ARC_CW') {
                if (sweep >= 1e-9) sweep -= 2 * Math.PI;
            } else {
                if (sweep <= -1e-9) sweep += 2 * Math.PI;
            }
            
            // Handle full circle
            const dist = Math.hypot(start.x - end.x, start.y - end.y);
            if (dist < 1e-6 && Math.abs(sweep) < 1e-6) {
                sweep = (cmd.type === 'ARC_CW') ? -2 * Math.PI : 2 * Math.PI;
            }
            
            const arcLength = Math.abs(sweep) * radius;
            const segments = Math.max(2, Math.ceil(arcLength / resolution));
            const angleStep = sweep / segments;
            const zStep = (end.z - start.z) / segments;

            for (let i = 1; i <= segments; i++) {
                const angle = startAngle + i * angleStep;
                
                const nextX = (i === segments) ? end.x : (center.x + radius * Math.cos(angle));
                const nextY = (i === segments) ? end.y : (center.y + radius * Math.sin(angle));
                const nextZ = (i === segments) ? end.z : (start.z + i * zStep);

                linearizedCmds.push(new MotionCommand('LINEAR', 
                    { x: nextX, y: nextY, z: nextZ }, 
                    { feed: cmd.f }
                ));
            }
            
            return linearizedCmds;
        }
        
        getAvailableProcessors() {
            return Array.from(this.processors.keys());
        }
        
        getProcessorInfo(name) {
            const processor = this.getProcessor(name);
            if (!processor) return null;
            
            return {
                name: processor.name,
                fileExtension: processor.config.fileExtension,
                supportsToolChange: processor.config.supportsToolChange,
                supportsArcCommands: processor.config.supportsArcCommands,
                supportsCannedCycles: processor.config.supportsCannedCycles
            };
        }
    }
    
    window.GCodeGenerator = GCodeGenerator;
})();