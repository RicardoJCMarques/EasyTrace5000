/**
 * @file        gcode/processors/marlin-processor.js
 * @description Marlin post-processing module
 * @author      Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

/*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2026 Eltryus
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

    class MarlinPostProcessor extends BasePostProcessor {
        constructor() {
            super('Marlin', {
                fileExtension: '.gcode',
                supportsToolChange: false,
                supportsArcCommands: true,
                supportsCannedCycles: false,
                arcFormat: 'IJ',
                coordinatePrecision: 3,
                feedPrecision: 0,
                spindlePrecision: 0,
                modalCommands: true,
                maxSpindleSpeed: 255, // PWM range
                maxRapidRate: 1000
            });
        }

        generateToolChange(tool, options) {
            const lines = [];
            const safeZ = options.safeZ || this.config.safetyHeight;

            lines.push('');
            lines.push(`; Tool change: ${tool.name || tool.id}`);
            lines.push(`; Diameter: ${tool.diameter}mm`);

            if (options.useM3) {
                lines.push('M5 ; Stop spindle');
            } else {
                lines.push('M107 ; Stop fan');
            }

            lines.push(`G0 Z${this.formatCoordinate(safeZ)} ; Retract to safe Z`);
            this.currentPosition.z = safeZ;
            lines.push('M0 ; Pause for manual tool change');
            lines.push('');

            const spindleSpeed = tool.spindleSpeed || options.spindleSpeed || 12000;
            const pwmValue = Math.min(255, Math.round((spindleSpeed / 30000) * 255));

            if (options.useM3) {
                lines.push(`M3 S${pwmValue} ; Restart spindle`);
            } else {
                lines.push(`M106 S${pwmValue} ; Restart fan`);
            }
            lines.push('G4 P1000 ; Wait for spindle');
            lines.push('');

            return lines.join('\n');
        }
    }

    window.MarlinPostProcessor = MarlinPostProcessor;
})();