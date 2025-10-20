/**
 * @file        export/gcode-generator.js
 * @description Complete G-code generation from toolpath plans
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
    const gcodeConfig = config.gcode || {};
    const machineConfig = config.machine || {};
    
    class GCodeGenerator {
        constructor(config) {
            this.config = config;
            this.output = [];
            this.currentPosition = {x: 0, y: 0, z: 0};
            this.currentFeed = null;
            this.currentSpindleSpeed = null;
            this.modalState = {
                motionMode: null, // G0, G1, G2, G3
                coordinateMode: 'G90', // G90 absolute, G91 relative
                units: 'G21', // G20 inch, G21 mm
                plane: 'G17', // G17 XY, G18 XZ, G19 YZ
                feedRateMode: 'G94', // G93 inverse time, G94 units/min
                workOffset: 'G54'
            };
            
            // Post-processor templates
            this.postProcessors = this.initializePostProcessors();
        }
        
        initializePostProcessors() {
            return {
                grbl: {
                    name: 'GRBL',
                    fileExtension: '.nc',
                    supportsToolChange: false,
                    supportsArcCommands: true,
                    supportsCannedCycles: false,
                    arcFormat: 'IJ', // IJ or R
                    precision: {
                        coordinates: 3,
                        feedrate: 0,
                        spindle: 0
                    },
                    templates: {
                        start: 'G90 G21 G17\nG94\nM3 S{spindleSpeed}\nG4 P1',
                        end: 'M5\nG0 Z{safeZ}\nM2',
                        toolChange: 'M5\nG0 Z{safeZ}\nM0 (Tool change: {toolName})\nM3 S{spindleSpeed}\nG4 P1'
                    }
                },
                marlin: {
                    name: 'Marlin',
                    fileExtension: '.gcode',
                    supportsToolChange: false,
                    supportsArcCommands: true,
                    supportsCannedCycles: false,
                    arcFormat: 'IJ',
                    precision: {
                        coordinates: 3,
                        feedrate: 0,
                        spindle: 0
                    },
                    templates: {
                        start: 'G90 G21\nM3 S255\nG4 P1000',
                        end: 'M5\nG0 Z10\nM84',
                        toolChange: 'M5\nG0 Z{safeZ}\nM0\nM3 S255\nG4 P1000'
                    }
                },
                linuxcnc: {
                    name: 'LinuxCNC',
                    fileExtension: '.ngc',
                    supportsToolChange: true,
                    supportsArcCommands: true,
                    supportsCannedCycles: true,
                    arcFormat: 'IJ',
                    precision: {
                        coordinates: 4,
                        feedrate: 1,
                        spindle: 0
                    },
                    templates: {
                        start: 'G90 G21 G17\nG64 P0.01\nM3 S{spindleSpeed}\nG4 P1',
                        end: 'M5\nG0 Z{safeZ}\nM2',
                        toolChange: 'M5\nG0 Z{safeZ}\nT{toolNumber} M6\nM3 S{spindleSpeed}\nG4 P1'
                    }
                },
                mach3: {
                    name: 'Mach3',
                    fileExtension: '.tap',
                    supportsToolChange: true,
                    supportsArcCommands: true,
                    supportsCannedCycles: true,
                    arcFormat: 'IJ',
                    precision: {
                        coordinates: 4,
                        feedrate: 1,
                        spindle: 0
                    },
                    templates: {
                        start: 'G90 G21 G17\nM3 S{spindleSpeed}\nG4 P1',
                        end: 'M5\nG0 Z{safeZ}\nM30',
                        toolChange: 'M5\nG0 Z{safeZ}\nT{toolNumber} M6\nM3 S{spindleSpeed}\nG4 P1'
                    }
                }
            };
        }
        
        generate(toolpathPlans, options) {
            if (!toolpathPlans || toolpathPlans.length === 0) {
                return '; No toolpath data to generate G-code from';
            }
            
            // Select post-processor
            const postName = options.postProcessor || 'grbl';
            this.postProcessor = this.postProcessors[postName] || this.postProcessors.grbl;
            
            // Reset state
            this.output = [];
            this.currentPosition = {x: 0, y: 0, z: 0};
            this.currentFeed = null;
            this.currentSpindleSpeed = null;
            
            // Generate header
            this.generateHeader(options, toolpathPlans[0]);
            
            // Track tool changes
            let lastToolId = null;
            
            // Process each toolpath plan
            for (let i = 0; i < toolpathPlans.length; i++) {
                const plan = toolpathPlans[i];
                
                // Add operation comment
                if (options.includeComments) {
                    this.output.push('');
                    this.output.push(`; Operation ${i + 1}/${toolpathPlans.length}: ${plan.operationId}`);
                    if (plan.metadata?.tool) {
                        this.output.push(`; Tool: ${plan.metadata.tool.id || 'unknown'} (Dia: ${plan.metadata.tool.diameter}mm)`);
                    }
                    if (plan.metadata?.estimatedTime) {
                        const minutes = Math.floor(plan.metadata.estimatedTime / 60);
                        const seconds = Math.floor(plan.metadata.estimatedTime % 60);
                        this.output.push(`; Estimated time: ${minutes}:${seconds.toString().padStart(2, '0')}`);
                    }
                }
                
                // Handle tool change
                if (options.toolChanges && plan.metadata?.tool?.id !== lastToolId) {
                    if (lastToolId !== null) { // Not first tool
                        this.generateToolChange(plan.metadata.tool, options);
                    }
                    lastToolId = plan.metadata?.tool?.id;
                }
                
                // Process commands
                for (const cmd of plan.commands) {
                    const gcode = this.commandToGCode(cmd, options);
                    if (gcode) {
                        this.output.push(gcode);
                    }
                }
            }
            
            // Generate footer
            this.generateFooter(options);
            
            return this.output.join('\n');
        }
        
        generateHeader(options, firstPlan) {
            const settings = firstPlan?.metadata || {};
            const startCode = options.startCode || this.postProcessor.templates.start;
            
            // Add header comments
            this.output.push(`; G-code generated by EasyTrace5000`);
            this.output.push(`; Date: ${new Date().toISOString()}`);
            this.output.push(`; Post-processor: ${this.postProcessor.name}`);
            this.output.push(`; Units: ${options.units || 'mm'}`);
            this.output.push('');
            
            // Process start template
            const processedCode = this.processTemplate(startCode, {
                spindleSpeed: settings.tool?.spindleSpeed || options.spindleSpeed || 12000,
                safeZ: options.safeZ || machineConfig.heights?.safeZ || 5,
                feedRate: settings.tool?.feedRate || 100
            });
            
            this.output.push(...processedCode.split('\n').filter(line => line.trim()));
            
            // Set initial modal states
            this.modalState.coordinateMode = 'G90';
            this.modalState.units = 'G21';
            this.modalState.plane = 'G17';
            this.modalState.feedRateMode = 'G94';
        }
        
        generateFooter(options) {
            const endCode = options.endCode || this.postProcessor.templates.end;
            
            this.output.push('');
            
            // Process end template
            const processedCode = this.processTemplate(endCode, {
                safeZ: options.safeZ || machineConfig.heights?.safeZ || 5
            });
            
            this.output.push(...processedCode.split('\n').filter(line => line.trim()));
        }
        
        generateToolChange(tool, options) {
            if (!this.postProcessor.supportsToolChange) {
                // Manual tool change
                this.output.push('M5 ; Stop spindle');
                this.output.push(`G0 Z${this.formatCoord(options.safeZ || 5)}`);
                this.output.push(`M0 (Change tool to: ${tool.id || 'unknown'})`);
                this.output.push(`M3 S${tool.spindleSpeed || 12000}`);
                this.output.push('G4 P1 ; Wait for spindle');
            } else {
                // Automatic tool change
                const template = this.postProcessor.templates.toolChange;
                const toolNumber = this.extractToolNumber(tool.id) || 1;
                
                const processedCode = this.processTemplate(template, {
                    toolNumber: toolNumber,
                    toolName: tool.id || 'unknown',
                    spindleSpeed: tool.spindleSpeed || 12000,
                    safeZ: options.safeZ || 5
                });
                
                this.output.push(...processedCode.split('\n').filter(line => line.trim()));
            }
        }
        
        commandToGCode(cmd, options) {
            let code = '';
            
            switch (cmd.type) {
                case 'RAPID':
                    code = this.generateRapid(cmd);
                    break;
                    
                case 'LINEAR':
                    code = this.generateLinear(cmd);
                    break;
                    
                case 'ARC_CW':
                case 'ARC_CCW':
                    code = this.generateArc(cmd);
                    break;
                    
                case 'PLUNGE':
                    code = this.generatePlunge(cmd);
                    break;
                    
                case 'RETRACT':
                    code = this.generateRetract(cmd);
                    break;
                    
                case 'DWELL':
                    code = `G4 P${cmd.dwell}`;
                    break;
                    
                default:
                    if (options.includeComments && cmd.comment) {
                        code = `; ${cmd.comment}`;
                    }
            }
            
            return code;
        }
        
        generateRapid(cmd) {
            let code = '';
            
            // Only output G0 if not in rapid mode
            if (this.modalState.motionMode !== 'G0') {
                code = 'G0';
                this.modalState.motionMode = 'G0';
            }
            
            // Add coordinates
            if (cmd.x !== null && cmd.x !== this.currentPosition.x) {
                code += ` X${this.formatCoord(cmd.x)}`;
                this.currentPosition.x = cmd.x;
            }
            if (cmd.y !== null && cmd.y !== this.currentPosition.y) {
                code += ` Y${this.formatCoord(cmd.y)}`;
                this.currentPosition.y = cmd.y;
            }
            if (cmd.z !== null && cmd.z !== this.currentPosition.z) {
                code += ` Z${this.formatCoord(cmd.z)}`;
                this.currentPosition.z = cmd.z;
            }
            
            return code.trim();
        }
        
        generateLinear(cmd) {
            let code = '';
            
            // Only output G1 if not in linear mode
            if (this.modalState.motionMode !== 'G1') {
                code = 'G1';
                this.modalState.motionMode = 'G1';
            }
            
            // Add coordinates
            if (cmd.x !== null && cmd.x !== this.currentPosition.x) {
                code += ` X${this.formatCoord(cmd.x)}`;
                this.currentPosition.x = cmd.x;
            }
            if (cmd.y !== null && cmd.y !== this.currentPosition.y) {
                code += ` Y${this.formatCoord(cmd.y)}`;
                this.currentPosition.y = cmd.y;
            }
            if (cmd.z !== null && cmd.z !== this.currentPosition.z) {
                code += ` Z${this.formatCoord(cmd.z)}`;
                this.currentPosition.z = cmd.z;
            }
            
            // Add feed rate if changed
            if (cmd.f && cmd.f !== this.currentFeed) {
                code += ` F${this.formatFeed(cmd.f)}`;
                this.currentFeed = cmd.f;
            }
            
            return code.trim();
        }
        
        generateArc(cmd) {
            if (!this.postProcessor.supportsArcCommands) {
                // Fallback to linear approximation
                return this.generateLinear(cmd);
            }
            
            const gCommand = cmd.type === 'ARC_CW' ? 'G2' : 'G3';
            let code = '';
            
            // Only output G2/G3 if not in arc mode
            if (this.modalState.motionMode !== gCommand) {
                code = gCommand;
                this.modalState.motionMode = gCommand;
            }
            
            // End point
            code += ` X${this.formatCoord(cmd.x)}`;
            code += ` Y${this.formatCoord(cmd.y)}`;
            code += ` Z${this.formatCoord(cmd.z)}`;
            
            // Arc center (I,J format)
            if (this.postProcessor.arcFormat === 'IJ') {
                code += ` I${this.formatCoord(cmd.i)}`;
                code += ` J${this.formatCoord(cmd.j)}`;
            } else if (this.postProcessor.arcFormat === 'R') {
                // R format (radius)
                const radius = Math.hypot(cmd.i, cmd.j);
                code += ` R${this.formatCoord(radius)}`;
            }
            
            // Feed rate
            if (cmd.f && cmd.f !== this.currentFeed) {
                code += ` F${this.formatFeed(cmd.f)}`;
                this.currentFeed = cmd.f;
            }
            
            // Update position
            this.currentPosition.x = cmd.x;
            this.currentPosition.y = cmd.y;
            this.currentPosition.z = cmd.z;
            
            return code.trim();
        }
        
        generatePlunge(cmd) {
            // Plunge is just a Z-only linear move
            let code = '';
            
            if (this.modalState.motionMode !== 'G1') {
                code = 'G1';
                this.modalState.motionMode = 'G1';
            }
            
            code += ` Z${this.formatCoord(cmd.z)}`;
            
            if (cmd.f && cmd.f !== this.currentFeed) {
                code += ` F${this.formatFeed(cmd.f)}`;
                this.currentFeed = cmd.f;
            }
            
            this.currentPosition.z = cmd.z;
            
            return code.trim();
        }
        
        generateRetract(cmd) {
            // Retract is a rapid Z move
            let code = '';
            
            if (this.modalState.motionMode !== 'G0') {
                code = 'G0';
                this.modalState.motionMode = 'G0';
            }
            
            code += ` Z${this.formatCoord(cmd.z)}`;
            this.currentPosition.z = cmd.z;
            
            return code.trim();
        }
        
        formatCoord(value) {
            if (value === null || value === undefined) return '';
            const precision = this.postProcessor.precision.coordinates;
            return value.toFixed(precision).replace(/\.?0+$/, '');
        }
        
        formatFeed(value) {
            const precision = this.postProcessor.precision.feedrate;
            if (precision === 0) {
                return Math.round(value).toString();
            }
            return value.toFixed(precision).replace(/\.?0+$/, '');
        }
        
        processTemplate(template, variables) {
            let processed = template;
            
            for (const [key, value] of Object.entries(variables)) {
                const regex = new RegExp(`\\{${key}\\}`, 'g');
                processed = processed.replace(regex, value);
            }
            
            return processed;
        }
        
        extractToolNumber(toolId) {
            if (!toolId) return null;
            const match = toolId.match(/\d+/);
            return match ? parseInt(match[0]) : null;
        }
    }
    
    window.GCodeGenerator = GCodeGenerator;
    
})();