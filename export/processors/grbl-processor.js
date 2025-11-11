/**
 * @file        export/processors/grbl-processor.js
 * @description GRBL post-processing module
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
    
    class GRBLPostProcessor extends BasePostProcessor {
        constructor() {
            super('GRBL', {
                fileExtension: '.nc',
                supportsToolChange: false,
                supportsArcCommands: true,
                supportsCannedCycles: false,
                arcFormat: 'IJ',
                coordinatePrecision: 3,
                feedPrecision: 0,
                spindlePrecision: 0,
                modalCommands: true,
                maxSpindleSpeed: 30000,
                maxRapidRate: 1000
            });
        }
        
        generateToolChange(tool, options) {
            const lines = [];
            const safeZ = options.safeZ || this.config.safetyHeight;

            lines.push('');

            // Call the silent setSpindle(0)
            const stopGcode = this.setSpindle(0); 
            if (stopGcode) {
                lines.push(stopGcode);
            } else if (this.currentSpindle > 0) {
                lines.push('M5 ; Spindle Stop'); // Fallback
                this.currentSpindle = 0;
            }

            lines.push(`G0 Z${this.formatCoordinate(safeZ)}`);
            this.currentPosition.z = safeZ;
            lines.push('M0'); // Pause
            lines.push('');

            const spindleSpeed = tool.spindleSpeed || 12000;

            // Call the silent setSpindle(newSpeed)
            const startGcode = this.setSpindle(spindleSpeed);
            if (startGcode) {
                lines.push(startGcode);
            }

            lines.push('');

            return lines.join('\n');
        }
        
        // GRBL-specific: validate command safety
        validateCommand(cmd) {
            const warnings = [];
            
            // Check spindle speed limits
            if (cmd.type === 'SPINDLE' && cmd.speed > this.config.maxSpindleSpeed) {
                warnings.push(`Spindle speed ${cmd.speed} exceeds maximum ${this.config.maxSpindleSpeed}`);
            }
            
            // Check for unsupported features
            if (cmd.type && cmd.type.includes('CANNED')) {
                warnings.push('Canned cycles not supported by GRBL - will be expanded');
            }
            
            return warnings;
        }
    }
    
    window.GRBLPostProcessor = GRBLPostProcessor;
})();