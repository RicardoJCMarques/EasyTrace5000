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
                useM6: true,
                supportsToolLengthComp: true,
                pauseAfterToolChange: true,
                arcFormat: 'IJ',
                coordinateDecimals: 3,
                feedDecimals: 1,
                spindleDecimals: 0,
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

        // Needs dwell period in miliseconds
        formatDwell(seconds) {
            return Math.round(seconds * 1000);
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
    }

    window.UCCNCPostProcessor = UCCNCPostProcessor;
})();