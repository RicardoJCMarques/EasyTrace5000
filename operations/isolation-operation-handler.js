/*!
 * @file        operations/isolation-operation-handler.js
 * @description Isolation routing — external offsets around copper with cut-in resolution
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

    class IsolationOperationHandler extends OffsetOperationHandler {

        _needsCutInResolution() { return true; }

        /**
         * Laser clearance zone: expanded copper minus original copper (halo around traces).
         */
        async _getClearanceZone(operation, settings) {
            const isolationWidth = settings.isolationWidth
                || (settings.toolDiameter * settings.passes * (1 - (settings.stepOver || 50) / 100))
                || 0.3;
            this.debug(`Isolation clearance width: ${isolationWidth.toFixed(3)}mm`);
            return this._generateClearancePolygon(operation, isolationWidth);
        }
    }

    window.IsolationOperationHandler = IsolationOperationHandler;
})();