/*!
 * @file        export/processors/mach3-processor.js
 * @description Mach3 post-processing module
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 *
 * SPDX-FileCopyrightText: 2025-2026 Eltryus - Ricardo Marques
 * SPDX-License-Identifier: AGPL-3.0-or-later
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
                useM6: true,
                supportsToolLengthComp: true,
                pauseAfterToolChange: true,
                arcFormat: 'IJ',
                coordinateDecimals: 4,
                feedDecimals: 1,
                spindleDecimals: 0,
                modalCommands: true,
                lineNumbering: false, // To be implemented in the future
                maxSpindleSpeed: 24000,
                maxRapidRate: 5000,
                defaults: {
                    startCode: '',
                    endCode: 'M5\nG0 X0Y0\nM30',
                }
            });
        }
    }

    window.Mach3PostProcessor = Mach3PostProcessor;
})();
