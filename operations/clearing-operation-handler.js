/*!
 * @file        operations/clearing-operation-handler.js
 * @description Copper clearing — always-internal offsets with cut-in resolution
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

    const C = window.PCBCAMConfig.constants;

    class ClearingOperationHandler extends OffsetOperationHandler {

        _isInternalOffset() { return true; }

        _needsCutInResolution() { return true; }

        async generateGeometry(operation, settings) {
            settings = { ...settings };

            const stepOver = settings.stepOver;
            const stepDistance = settings.toolDiameter * (1 - (stepOver / 100));

            // Auto-calculate passes to cover the full geometry
            if (operation.bounds && stepDistance > 0) {
                const smallestDim = Math.min(
                    operation.bounds.maxX - operation.bounds.minX,
                    operation.bounds.maxY - operation.bounds.minY
                );
                settings.passes = Math.ceil((smallestDim / 2) / stepDistance);

                // Clamp to safety limit
                const maxPasses = C.ui.validation.maxAutoPasses; 
                settings.passes = Math.min(settings.passes, maxPasses);
            }

            settings.stepOver = stepOver;
            settings.combineOffsets = true;

            this.debug(`Auto-calculated clearing: ${settings.passes} passes, ${stepOver}% stepover`);

            return super.generateGeometry(operation, settings);
        }

        /**
         * Laser clearance zone: the source geometry itself IS the area to fill.
         * Fuse primitives into clean polygons for hatching/filling.
         */
        async _getClearanceZone(operation, settings) {
            this.core.geometryProcessor.clearProcessorCache();
            const result = await this.core.geometryProcessor.fuseGeometry(
                operation.primitives,
                { enableArcReconstruction: false }
            );
            this.debug(`Clearing zone from source geometry: ${result.length} polygon(s)`);
            return result;
        }
    }

    window.ClearingOperationHandler = ClearingOperationHandler;
})();