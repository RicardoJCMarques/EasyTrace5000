/*!
 * @file        export/processors/grblHAL-processor.js
 * @description grblHAL post-processing module
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

    // grblHAL is a superset of GRBL but adds M6 tool change and canned cycle support, making it similar to LinuxCNC.
    class GrblHALPostProcessor extends BasePostProcessor {
        constructor() {
            super('grblHAL', {
                label: 'grblHAL (Experimental)',
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
                maxRapidRate: 5000,
                defaults: {
                    startCode: 'T1',
                    endCode: 'M5\nG0 X0 Y0\nM2',
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

            // Call the silent setSpindle(0) from BasePostProcessor
            const stopGcode = this.setSpindle(0, 0, options);
            if (stopGcode) {
                lines.push(stopGcode);
            } else if (this.currentSpindle > 0) {
                lines.push(this.appendComment('M5', c.spindleStop, options)); // Safety Stop Fallback
                this.currentSpindle = 0;
            }

            lines.push(this.appendComment(`G0 Z${this.formatCoordinate(safeZ)}`, c.retractSafeZ, options));
            this.currentPosition.z = safeZ;

            // grblHAL uses M6 Tx for tool changes
            const toolNumber = tool.number || options.toolNumber || 1;
            lines.push(`T${toolNumber} M6`);
            lines.push(this.appendComment('M0', c.toolChangePause, options));
            lines.push('');

            const spindleSpeed = tool.spindleSpeed || 12000;

            // Call the silent setSpindle(newSpeed)
            const startGcode = this.setSpindle(spindleSpeed, 0, options);
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

        cancelCannedCycle(options) {
            const c = options?.comments || {};
            return this.appendComment('G80', c.cancelCannedCycle, options);
        }
    }

    window.GrblHALPostProcessor = GrblHALPostProcessor;
})();