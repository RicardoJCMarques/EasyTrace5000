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

    class ClearingOperationHandler extends OffsetOperationHandler {

        _isInternalOffset() { return true; }

        _needsCutInResolution() { return true; }

        async generateGeometry(operation, settings) {
            // Clone to prevent mutating shared state
            settings = { ...settings };

            // Automatically calculate the passes required to clear the entire bounding box
            if (operation.bounds && settings.toolDiameter > 0) {
                const stepOver = 50; // 50% is the optimal stepover for flat end mills
                const stepDistance = settings.toolDiameter * (1 - (stepOver / 100));

                // The maximum distance to clear is half the smallest dimension of the bounds
                const smallestDim = Math.min(
                    operation.bounds.maxX - operation.bounds.minX,
                    operation.bounds.maxY - operation.bounds.minY
                );

                settings.passes = Math.ceil((smallestDim / 2) / stepDistance);
                settings.stepOver = stepOver;
                settings.combineOffsets = true; // Always combine for cleaner clearing paths

                this.debug(`Auto-calculated clearing passes: ${settings.passes} (tool: ${settings.toolDiameter}mm)`);
            }

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