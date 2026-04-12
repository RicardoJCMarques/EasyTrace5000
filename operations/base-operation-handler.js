/*!
 * @file        operations/base-operation-handler.js
 * @description Base operation handler interface — contract for all operation types
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

    const D = window.PCBCAMConfig.defaults;
    const debugState = D.debug;

    class BaseOperationHandler {
        constructor(core) {
            this.core = core;
        }

        /**
         * Pre-validation classification of raw plotter output.
         * Override to filter/transform primitives before validation and compositing.
         * Called after ParserPlotter, before analyzeGeometricContext.
         * @param {Object} operation - The operation object (may set flags like needsClosurePrompt)
         * @param {Array} rawPrimitives - Raw plotter output
         * @returns {{ primitives: Array, warnings: Array }}
         */
        classifyPrimitives(operation, rawPrimitives) {
            return { primitives: rawPrimitives, warnings: [] };
        }

        /**
         * Post-parse hook called after operation.primitives and bounds are set.
         * Override for classification that needs the final validated primitive set.
         * @param {Object} operation - The operation with .primitives populated
         */
        postParsePrimitives(operation) {
            // No-op by default
        }

        /**
         * Phase 1 (cnc variant): Generate operation-specific geometry (offsets, drill strategy, stencil apertures).
         * Writes to operation.offsets[].
         */
        async generateGeometry(operation, settings) {
            throw new Error(`${this.constructor.name}.generateGeometry() not implemented`);
        }

        /**
         * Phase 1 (laser variant): Generate laser-specific geometry.
         * Default delegates to generateGeometry (offset strategy).
         */
        async generateLaserGeometry(operation, settings) {
            return this.generateGeometry(operation, settings);
        }

        /**
         * Phase 2: Translate geometry into pure cutting plans.
         * Override in future phases to move translation logic from GeometryTranslator.
         * Returns null to indicate the translator should use its current logic.
         */
        async translateToPlans(operation, context) {
            return null;
        }

        /**
         * Build an export layer descriptor for laser/stencil SVG/PNG export.
         */
        buildExportLayer(operation, exportOptions) {
            return null;
        }

        debug(message, data = null) {
            if (debugState.enabled) {
                const tag = `[${this.constructor.name}]`;
                if (data) console.log(`${tag} ${message}`, data);
                else console.log(`${tag} ${message}`);
            }
        }
    }

    window.BaseOperationHandler = BaseOperationHandler;
})();