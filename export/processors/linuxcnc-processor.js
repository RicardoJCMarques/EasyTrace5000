/*!
 * @file        export/processors/linuxcnc-processor.js
 * @description LinuxCNC post-processing module
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

    class LinuxCNCPostProcessor extends BasePostProcessor {
        constructor() {
            super('LinuxCNC', {
                label: 'LinuxCNC (Experimental)',
                fileExtension: '.ngc',
                supportsToolChange: true,
                supportsArcCommands: true,
                supportsCannedCycles: true,
                useM6: true,
                supportsToolLengthComp: true,
                pauseAfterToolChange: false,
                arcFormat: 'IJ',
                coordinateDecimals: 4,
                feedDecimals: 1,
                spindleDecimals: 0,
                modalCommands: true,
                lineNumbering: false,
                maxSpindleSpeed: 24000,
                maxRapidRate: 5000,
                defaults: {
                    startCode: 'G64 P0.01\nG4 P1',
                    endCode: 'M5\nG0 X0Y0\nM2',
                }
            });
        }

        /**
         * LinuxCNC expects dwell in seconds for G4 P and G82 P parameters.
         */
        formatDwell(seconds) {
            return parseFloat(seconds.toFixed(1));
        }
    }

    window.LinuxCNCPostProcessor = LinuxCNCPostProcessor;
})();