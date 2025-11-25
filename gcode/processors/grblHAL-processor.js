/**
 * @file        gcode/processors/grblHAL-processor.js
 * @description grblHAL post-processing module
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

    // grblHAL is a superset of GRBL but adds M6 tool change and canned cycle support, making it similar to LinuxCNC.
    class GrblHALPostProcessor extends BasePostProcessor {
        constructor() {
            super('grblHAL', {
                fileExtension: '.nc',
                supportsToolChange: true,
                supportsArcCommands: true,
                supportsCannedCycles: true,
                arcFormat: 'IJ',
                coordinatePrecision: 3,
                feedPrecision: 0,
                spindlePrecision: 0,
                modalCommands: true,
                maxSpindleSpeed: 30000,
                maxRapidRate: 5000
            });
        }

        generateToolChange(tool, options) {
            const lines = [];
            const safeZ = options.safeZ || this.config.safetyHeight;

            lines.push('');

            // Call the silent setSpindle(0) from BasePostProcessor
            const stopGcode = this.setSpindle(0); 
            if (stopGcode) {
                lines.push(stopGcode);
            } else if (this.currentSpindle > 0) {
                lines.push('M5'); // Safety Stop Fallback
                this.currentSpindle = 0;
            }

            lines.push(`G0 Z${this.formatCoordinate(safeZ)}`);
            this.currentPosition.z = safeZ;

            // grblHAL uses M6 Tx for tool changes
            const toolNumber = tool.number || options.toolNumber || 1;
            lines.push(`T${toolNumber} M6`);
            lines.push('M0 (Tool change pause - press cycle start)');
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

        // grblHAL supports canned cycles
        generatePeckDrill(position, depth, retract, peckDepth, feedRate) {
            // G83 - Peck drilling cycle
            return `G83 X${this.formatCoordinate(position.x)} Y${this.formatCoordinate(position.y)} Z${this.formatCoordinate(depth)} R${this.formatCoordinate(retract)} Q${this.formatCoordinate(peckDepth)} F${this.formatFeed(feedRate)}`;
        }

        generateSimpleDrill(position, depth, retract, feedRate, dwell) {
            if (dwell > 0) {
                // G82 - Drilling cycle with dwell
                return `G82 X${this.formatCoordinate(position.x)} Y${this.formatCoordinate(position.y)} Z${this.formatCoordinate(depth)} R${this.formatCoordinate(retract)} P${dwell} F${this.formatFeed(feedRate)}`;
            } else {
                // G81 - Simple drilling cycle
                return `G81 X${this.formatCoordinate(position.x)} Y${this.formatCoordinate(position.y)} Z${this.formatCoordinate(depth)} R${this.formatCoordinate(retract)} F${this.formatFeed(feedRate)}`;
            }
        } // What about G73?

        cancelCannedCycle() {
            return 'G80';
        }
    }

    window.GrblHALPostProcessor = GrblHALPostProcessor;
})();