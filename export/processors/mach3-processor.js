/*!
 * @file        export/processors/mach3-processor.js
 * @description Mach3 post-processing module
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

/*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2025-2026 Eltryus
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
                label: 'Mach3 (Experimental)',
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
                maxRapidRate: 5000,
                defaults: {
                    startCode: '',
                    endCode: 'M5\nG0 X0Y0\nM30',
                }
            });
        }

        generateToolChange(tool, options) {
            const lines = [];
            const c = options.comments || {};
            const safeZ = options.safeZ || this.config.safetyHeight;

            lines.push('');
            this.pushCommentLine(lines, (c.toolChange || 'Tool change: {name}').replace('{name}', tool.name || tool.id), options);
            this.pushCommentLine(lines, (c.toolDiameter || 'Diameter: {diameter}mm').replace('{diameter}', tool.diameter), options);
            lines.push('');

            // Stop sp
            lines.push(this.appendComment('M5', c.spindleStop, options));

            // Retract to safe Z
            lines.push(this.appendComment(`G0 Z${this.formatCoordinate(safeZ)}`, c.retractSafeZ, options));
            this.currentPosition.z = safeZ;

            // Tool change with pause
            const toolNumber = tool.number || options.toolNumber || 1;
            lines.push(`T${toolNumber} M6`);
            lines.push(this.appendComment(`G43 H${toolNumber}`, c.toolLengthComp, options));
            lines.push(this.appendComment('M0', c.toolChangePause, options));
            lines.push('');

            // Restart spindle
            const spindleSpeed = tool.spindleSpeed || options.spindleSpeed || 12000;
            lines.push(this.appendComment(`M3 S${this.formatSpindle(spindleSpeed)}`, c.spindleStart, options));
            lines.push(this.appendComment('G4 P1', c.spindleDwell, options));
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

        cancelCannedCycle(options) {
            const c = options?.comments || {};
            return this.appendComment('G80', c.cancelCannedCycle, options);
        }
    }

    window.Mach3PostProcessor = Mach3PostProcessor;
})();
