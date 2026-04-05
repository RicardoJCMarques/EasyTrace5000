/*!
 * @file        export/processors/grbl-processor.js
 * @description GRBL post-processing module
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