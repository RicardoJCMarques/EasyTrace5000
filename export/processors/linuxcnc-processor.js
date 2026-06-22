/*!
 * @file        export/processors/linuxcnc-processor.js
 * @description LinuxCNC post-processing module
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 *
 * SPDX-FileCopyrightText: 2025-2026 Eltryus - Ricardo Marques
 * SPDX-License-Identifier: AGPL-3.0-or-later
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
                lineNumbering: false, // To be implemented in the future
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