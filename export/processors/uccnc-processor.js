/*!
 * @file        export/processors/uccnc-processor.js
 * @description UCCNC post-processing module
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

    /**
     * UCCNC Post-Processor
     *
     * Targets machines running UCCNC control software (cncdrive.com).
     * UCCNC is a Mach3-compatible controller with its own extensions.
     *
     * Key characteristics:
     *   - Standard G-code with parenthesis-style comments
     *   - G64 constant velocity / path blending mode
     *   - Full canned drilling cycles (G81, G82, G83, G73)
     *   - Tool change via T M6 with G43 Hxx tool length compensation
     *   - Dwell (G4 P) in MILLISECONDS (not seconds)
     *   - M30 program end with rewind
     *   - Helical arcs supported, XY plane (G17) circular interpolation
     */
    class UCCNCPostProcessor extends BasePostProcessor {
        constructor() {
            super('UCCNC', {
                label: 'UCCNC (Experimental)',
                fileExtension: '.nc',
                commentStyle: 'parenthesis',
                supportsToolChange: true,
                supportsArcCommands: true,
                supportsCannedCycles: true,
                arcFormat: 'IJ',
                coordinatePrecision: 3,
                feedPrecision: 1,
                spindlePrecision: 0,
                modalCommands: true,
                lineNumbering: false,
                maxSpindleSpeed: 24000,
                maxRapidRate: 5000,
                defaults: {
                    startCode: 'G64\nT1',
                    endCode: 'M5\nG0 X0 Y0\nM30',
                }
            });
        }

        /**
         * Override: UCCNC expects dwell in milliseconds (G4 P<ms>).
         * The pipeline provides dwell in seconds.
         */
        generateDwell(cmd) {
            const seconds = cmd.dwell || cmd.duration || 0;
            const ms = Math.round(seconds * 1000);
            if (ms <= 0) return '';
            return `G4 P${ms}`;
        }

        /**
         * Override: Spindle control with millisecond dwell.
         */
        setSpindle(speed, dwell = 0, options = {}) {
            if (speed === this.currentSpindle) return null;

            const c = options.comments || {};
            this.currentSpindle = speed;
            const lines = [];

            if (speed > 0) {
                lines.push(this.appendComment(`M3 S${speed}`, c.spindleStart, options));
                if (dwell > 0) {
                    const ms = Math.round(dwell * 1000);
                    lines.push(this.appendComment(`G4 P${ms}`, c.spindleDwell, options));
                }
            } else {
                lines.push(this.appendComment('M5', c.spindleStop, options));
            }

            return lines.join('\n');
        }

        generateToolChange(tool, options) {
            const lines = [];
            const c = options.comments || {};
            const safeZ = options.safeZ || this.config.safetyHeight;

            lines.push('');
            this.pushCommentLine(lines, (c.toolChange || 'Tool change: {name}').replace('{name}', tool.name || tool.id), options);
            this.pushCommentLine(lines, (c.toolDiameter || 'Diameter: {diameter}mm').replace('{diameter}', tool.diameter), options);

            // Spindle stop
            const stopGcode = this.setSpindle(0, 0, options);
            if (stopGcode) {
                lines.push(stopGcode);
            } else if (this.currentSpindle > 0) {
                lines.push(this.appendComment('M5', c.spindleStop, options));
                this.currentSpindle = 0;
            }

            // Coolant off before tool change
            if (options.coolant && options.coolant !== 'none') {
                lines.push(this.appendComment('M9', c.coolantOff, options));
            }

            // Retract to safe Z
            lines.push(this.appendComment(`G0 Z${this.formatCoordinate(safeZ)}`, c.retractSafeZ, options));
            this.currentPosition.z = safeZ;

            // Tool change
            const toolNumber = tool.number || options.toolNumber || 1;
            lines.push(`T${toolNumber} M6`);

            // Tool length compensation
            lines.push(this.appendComment(`G43 H${toolNumber}`, c.toolLengthComp, options));

            // Pause for operator verification
            lines.push(this.appendComment('M0', c.toolChangePause, options));
            lines.push('');

            // Restart spindle
            const spindleSpeed = tool.spindleSpeed || options.spindleSpeed || 12000;
            const startGcode = this.setSpindle(spindleSpeed, 0, options);
            if (startGcode) {
                lines.push(startGcode);
            }

            // Restart coolant if needed
            if (options.coolant && options.coolant !== 'none') {
                if (options.coolant === 'mist') {
                    lines.push(this.appendComment('M7', c.coolantMist, options));
                } else if (options.coolant === 'flood') {
                    lines.push(this.appendComment('M8', c.coolantFlood, options));
                }
            }

            lines.push('');
            return lines.join('\n');
        }

        /**
         * G83 — Peck drilling cycle (full retract between pecks).
         */
        generatePeckDrill(position, depth, retract, peckDepth, feedRate) {
            return `G83 X${this.formatCoordinate(position.x)} Y${this.formatCoordinate(position.y)} Z${this.formatCoordinate(depth)} R${this.formatCoordinate(retract)} Q${this.formatCoordinate(peckDepth)} F${this.formatFeed(feedRate)}`;
        }

        /**
         * G73 — Chip-breaking cycle (partial retract between pecks).
         * Faster than G83 for materials that produce stringy chips.
         */
        generateChipBreakDrill(position, depth, retract, peckDepth, feedRate) {
            return `G73 X${this.formatCoordinate(position.x)} Y${this.formatCoordinate(position.y)} Z${this.formatCoordinate(depth)} R${this.formatCoordinate(retract)} Q${this.formatCoordinate(peckDepth)} F${this.formatFeed(feedRate)}`;
        }

        /**
         * G81 — Simple drilling cycle (no dwell).
         * G82 — Drilling cycle with dwell at bottom.
         * Dwell parameter P is in milliseconds for UCCNC.
         */
        generateSimpleDrill(position, depth, retract, feedRate, dwell) {
            if (dwell > 0) {
                const dwellMs = Math.round(dwell * 1000);
                return `G82 X${this.formatCoordinate(position.x)} Y${this.formatCoordinate(position.y)} Z${this.formatCoordinate(depth)} R${this.formatCoordinate(retract)} P${dwellMs} F${this.formatFeed(feedRate)}`;
            } else {
                return `G81 X${this.formatCoordinate(position.x)} Y${this.formatCoordinate(position.y)} Z${this.formatCoordinate(depth)} R${this.formatCoordinate(retract)} F${this.formatFeed(feedRate)}`;
            }
        }

        cancelCannedCycle(options) {
            const c = options?.comments || {};
            return this.appendComment('G80', c.cancelCannedCycle, options);
        }
    }

    window.UCCNCPostProcessor = UCCNCPostProcessor;
})();