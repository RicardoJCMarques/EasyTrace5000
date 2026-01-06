/**
 * @file        gcode/processors/linuxcnc-processor.js
 * @description LinuxCNC post-processing module
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

    class LinuxCNCPostProcessor extends BasePostProcessor {
        constructor() {
            super('LinuxCNC', {
                fileExtension: '.ngc',
                supportsToolChange: true,
                supportsArcCommands: true,
                supportsCannedCycles: true,
                arcFormat: 'IJ',
                coordinatePrecision: 4,
                feedPrecision: 1,
                spindlePrecision: 0,
                modalCommands: true,
                lineNumbering: false,
                maxSpindleSpeed: 24000,
                maxRapidRate: 5000
            });
        }

        generateToolChange(tool, options) {
            const lines = [];
            const safeZ = options.safeZ || this.config.safetyHeight; // Review all fallbacks

            lines.push('');
            lines.push(`(Tool change: ${tool.name || tool.id})`);
            lines.push(`(Diameter: ${tool.diameter}mm)`);
            lines.push('');

            // Turn off spindle and coolant
            lines.push('M5 (Stop spindle)');
            if (options.coolant) {
                lines.push('M9 (Coolant off)');
            }

            // Retract to safe Z
            lines.push(`G0 Z${this.formatCoordinate(safeZ)} (Retract to safe Z)`);
            this.currentPosition.z = safeZ;

            // Tool change
            const toolNumber = tool.number || options.toolNumber || 1;
            lines.push(`T${toolNumber} M6 (Load tool ${toolNumber})`);
            lines.push(`G43 H${toolNumber} (Tool length compensation)`);
            lines.push('');

            // Restart spindle
            const spindleSpeed = tool.spindleSpeed || options.spindleSpeed || 12000;
            lines.push(`M3 S${this.formatSpindle(spindleSpeed)} (Restart spindle)`);
            lines.push('G4 P1 (Wait for spindle)');

            // Restart coolant if needed
            if (options.coolant) {
                if (options.coolant === 'mist') {
                    lines.push('M7 (Mist coolant on)');
                } else if (options.coolant === 'flood') {
                    lines.push('M8 (Flood coolant on)');
                }
            }
            lines.push('');

            return lines.join('\n');
        }

        // LinuxCNC supports canned drilling cycles
        generatePeckDrill(position, depth, retract, peckDepth, feedRate) {
            const lines = [];

            // G83 - Peck drilling cycle
            lines.push(`G83 X${this.formatCoordinate(position.x)} Y${this.formatCoordinate(position.y)} Z${this.formatCoordinate(depth)} R${this.formatCoordinate(retract)} Q${this.formatCoordinate(peckDepth)} F${this.formatFeed(feedRate)}`);

            return lines.join('\n');
        }

        generateSimpleDrill(position, depth, retract, feedRate, dwell) {
            const lines = [];

            if (dwell > 0) {
                // G82 - Drilling cycle with dwell
                lines.push(`G82 X${this.formatCoordinate(position.x)} Y${this.formatCoordinate(position.y)} Z${this.formatCoordinate(depth)} R${this.formatCoordinate(retract)} P${dwell} F${this.formatFeed(feedRate)}`);
            } else {
                // G81 - Simple drilling cycle
                lines.push(`G81 X${this.formatCoordinate(position.x)} Y${this.formatCoordinate(position.y)} Z${this.formatCoordinate(depth)} R${this.formatCoordinate(retract)} F${this.formatFeed(feedRate)}`);
            }

            return lines.join('\n');
        } // What about g73?

        cancelCannedCycle() {
            return 'G80 (Cancel canned cycle)';
        }
    }

    window.LinuxCNCPostProcessor = LinuxCNCPostProcessor;
})();