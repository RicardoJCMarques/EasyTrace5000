/**
 * @file        export/processors/roland-processor.js
 * @description ROLAND post-processing module
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
    
    // This class DOES NOT extend BasePostProcessor.
    // It implements the same interface to be used by GCodeGenerator.
    class RolandPostProcessor {
        constructor() {
            this.name = 'roland';
            this.config = {
                fileExtension: '.rml',
                supportsToolChange: true, // Supports M0 pause
                supportsArcCommands: false, // Must be false! GCodeGenerator will linearize arcs.
                supportsCannedCycles: false,
                // RML uses integer "plotter units". 1mm = 40 units.
                unitsPerMM: 40 
            };
            
            this.resetState();
        }

        resetState() {
            // We still track position, but in MM (scaling happens on format)
            this.currentPosition = { x: 0, y: 0, z: 0 };
            this.currentSpindle = 0; // 0 = off, 1 = on
        }

        generateHeader(options) {
            const headerLines = [];
            
            // 1. Add comment block (RML uses ';')
            if (options.includeComments && options.commentBlock) {
                options.commentBlock.forEach(line => {
                    headerLines.push(`; ${line}`);
                });
                headerLines.push('');
            }

            // 2. Add the custom start code from config.js
            // This contains PA;PA;!MC0; etc.
            if (options.startCode) {
                headerLines.push(options.startCode);
            }
            
            // Set initial velocity (feed rate)
            // We find the first plan to get a feed rate.
            // This is a limitation; RML sets feed globally.
            const firstPlan = options.firstPlan;
            if (firstPlan && firstPlan.metadata && firstPlan.metadata.feedRate) {
                headerLines.push(`VS ${this.formatFeed(firstPlan.metadata.feedRate)};`);
            }
            
            return headerLines.join('\n');
        }

        generateFooter(options) {
             // Just return the custom end code from config.js
            return options.endCode || '; End of job';
        }

        setSpindle(speed) {
            const newSpeed = speed > 0 ? 1 : 0;
            if (newSpeed === this.currentSpindle) {
                return '';
            }

            this.currentSpindle = newSpeed;
            return newSpeed === 1 ? '!MC1;' : '!MC0;'; // Motor Control On/Off
        }
        
        generateToolChange(tool, options) {
            const lines = [];
            const safeZ = options.safeZ || 5.0; // Get safe Z from options

            lines.push('');
            lines.push('; Tool change');
            
            // 1. Stop spindle
            lines.push(this.setSpindle(0));
            
            // 2. Retract to safe Z (PU = Pen Up)
            lines.push(`PU ${this.formatCoordinate(this.currentPosition.x)}, ${this.formatCoordinate(this.currentPosition.y)};`);
            lines.push(`PA;PA;!PZ 0, ${this.formatCoordinate(safeZ)};`); // Z-move
            this.currentPosition.z = safeZ;

            // 3. Pause
            lines.push('M0 ; Pause for manual tool change');
            lines.push('');
            
            // 4. Set new speed (if supported, RML spindle is usually just on/off)
            // Spindle speed is set in header. We just turn it on.
            lines.push(this.setSpindle(tool.spindleSpeed || 10000));
            lines.push('');
            
            return lines.join('\n');
        }

        processCommand(cmd, options, metadata) {
            // 1. COORDINATE FORMATTING
            const coords = [];
            let hasMotion = false;
            
            const targetX = (cmd.x !== null && cmd.x !== undefined) ? cmd.x : this.currentPosition.x;
            const targetY = (cmd.y !== null && cmd.y !== undefined) ? cmd.y : this.currentPosition.y;
            const targetZ = (cmd.z !== null && cmd.z !== undefined) ? cmd.z : this.currentPosition.z;

            // Check for actual motion
            const xChanged = Math.abs(targetX - this.currentPosition.x) > 1e-6;
            const yChanged = Math.abs(targetY - this.currentPosition.y) > 1e-6;
            const zChanged = Math.abs(targetZ - this.currentPosition.z) > 1e-6;
            
            // Update state *before* formatting
            this.currentPosition = { x: targetX, y: targetY, z: targetZ };

            // 2. COMMAND TRANSLATION
            switch (cmd.type) {
                case 'RAPID':
                case 'RETRACT':
                    // Z move first, then XY move
                    if (zChanged) {
                        return `PA;PA;!PZ 0, ${this.formatCoordinate(targetZ)};`;
                    }
                    if (xChanged || yChanged) {
                        return `PU ${this.formatCoordinate(targetX)}, ${this.formatCoordinate(targetY)};`;
                    }
                    return ''; // No motion

                case 'LINEAR':
                case 'PLUNGE':
                    // RML can't do 3D linear moves. It's Z move, then XY move.
                    const rmlCmds = [];
                    if (zChanged) {
                        // Use !PZ for plunge/Z move
                        rmlCmds.push(`PA;PA;!PZ 0, ${this.formatCoordinate(targetZ)};`);
                    }
                    if (xChanged || yChanged) {
                        // Use PD for XY move
                        rmlCmds.push(`PD ${this.formatCoordinate(targetX)}, ${this.formatCoordinate(targetY)};`);
                    }
                    return rmlCmds.join('\n');
                
                case 'DWELL':
                    const milliseconds = Math.round((cmd.dwell || 0) * 1000);
                    if (milliseconds > 0) {
                        // RML 'PA' (Pause) command is in MILLISECONDS.
                        // We must use the absolute positioning prefix 'PA;PA;'
                        return `PA;PA;!PW ${milliseconds};`;
                    }
                    return '';

                // ARCs are linearized by GCodeGenerator, so we only get LINEAR
                case 'ARC_CW':
                case 'ARC_CCW':
                    return '; ARC_NOT_SUPPORTED_BY_PROCESSOR';
                
                default:
                    return '';
            }
        }
        
        // Helper Functions
        
        formatCoordinate(value) {
            if (value === null || value === undefined) return '';
            const units = Math.round(value * this.config.unitsPerMM);
            return units.toString();
        }
        
        formatFeed(value) {
            // RML feed rate is in cm/s. We get mm/min.
            // (value mm/min) * (1 min / 60s) * (1cm / 10mm) = value / 600 cm/s
            const cm_per_sec = (value / 600.0);
            // Roland only supports 1-15 cm/s
            const clamped = Math.max(1, Math.min(15, cm_per_sec));
            return clamped.toFixed(1);
        }
    }
    
    window.RolandPostProcessor = RolandPostProcessor;
})();