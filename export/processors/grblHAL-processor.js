/*!
 * @file        export/processors/grblHAL-processor.js
 * @description grblHAL post-processing module
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 *
 * SPDX-FileCopyrightText: 2025-2026 Eltryus - Ricardo Marques
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

(function() {
    'use strict';

    class GrblHALPostProcessor extends BasePostProcessor {
        constructor() {
            super('grblHAL', {
                label: 'grblHAL (Experimental)',
                fileExtension: '.nc',
                supportsToolChange: true,
                supportsArcCommands: true,
                supportsCannedCycles: true,
                useM6: true,
                supportsToolLengthComp: false,
                pauseAfterToolChange: true,
                arcFormat: 'IJ',
                coordinateDecimals: 3,
                feedDecimals: 0,
                spindleDecimals: 0,
                modalCommands: true,
                maxSpindleSpeed: 30000,
                maxRapidRate: 5000,
                defaults: {
                    startCode: 'T1',
                    endCode: 'M5\nG0 X0 Y0\nM2',
                }
            });
        }
    }

    window.GrblHALPostProcessor = GrblHALPostProcessor;
})();