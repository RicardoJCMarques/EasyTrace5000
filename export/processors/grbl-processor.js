/*!
 * @file        export/processors/grbl-processor.js
 * @description GRBL post-processing module
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 *
 * SPDX-FileCopyrightText: 2025-2026 Eltryus - Ricardo Marques
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

(function() {
    'use strict';

    class GRBLPostProcessor extends BasePostProcessor {
        constructor() {
            super('GRBL', {
                label: 'Grbl',
                fileExtension: '.nc',
                supportsToolChange: false, // REVIEW - Consider a manual tool change macro. Stops spindle, goes to origin, raises Z, allows change, probe? raise again, finally allows resume? Makera has a similar system?
                supportsArcCommands: true,
                supportsCannedCycles: false,
                useM6: false,
                supportsToolLengthComp: false,
                pauseAfterToolChange: false,
                arcFormat: 'IJ',
                coordinateDecimals: 3,
                feedDecimals: 0,
                spindleDecimals: 0,
                modalCommands: true,
                maxSpindleSpeed: 30000,
                maxRapidRate: 2000,
                defaults: {
                    startCode: 'T1\n',
                    endCode: 'M5\nG0 X0Y0\nM2',
                }
            });
        }
    }

    window.GRBLPostProcessor = GRBLPostProcessor;
})();