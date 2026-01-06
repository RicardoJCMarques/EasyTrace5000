/**
 * @file        gcode/processors/mach3-processor.js
 * @description Mach3 post-processing module
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

    class Mach3PostProcessor extends BasePostProcessor {
        constructor() {
            super('Mach3', {
                fileExtension: '.tap',
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
            const safeZ = options.safeZ || this.config.safetyHeight;

            lines.push('');
            lines.push(`(Tool change: ${tool.name || tool.id})`);
            lines.push(`(Diameter: ${tool.diameter}mm)`);
            lines.push('');

            // Stop spindle
            lines.push('M5');

            // Retract to safe Z
            lines.push(`G0 Z${this.formatCoordinate(safeZ)}`);
            this.currentPosition.z = safeZ;

            // Tool change with pause
            const toolNumber = tool.number || options.toolNumber || 1;
            lines.push(`T${toolNumber} M6`);
            lines.push(`G43 H${toolNumber}`)
            lines.push('M0 (Tool change pause - press cycle start to continue)');
            lines.push('');

            // Restart spindle
            const spindleSpeed = tool.spindleSpeed || options.spindleSpeed || 12000;
            lines.push(`M3 S${this.formatSpindle(spindleSpeed)}`);
            lines.push('G4 P1');
            lines.push('');

            return lines.join('\n');
        }

        // Mach3 supports canned drilling cycles (similar to LinuxCNC)
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
        } // What about G73?

        cancelCannedCycle() {
            return 'G80';
        }
    }

    window.Mach3PostProcessor = Mach3PostProcessor;
})();
