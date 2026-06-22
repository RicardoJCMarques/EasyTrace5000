/*!
 * @file        operations/shape-engrave-handler.js
 * @description Engrave handler for EasyShape5000.
 *              On-line offset (zero distance) tracing the shape outline
 *              at a shallow fixed depth. Not Wired.
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 *
 * SPDX-FileCopyrightText: 2025-2026 Eltryus - Ricardo Marques
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Not wired
(function() {
    'use strict';

    class ShapeEngraveHandler extends OffsetOperationHandler {

        isInternalOffset() { return false; }
        isOnLine() { return true; }
        shouldGuardCircleCollapse() { return false; }

        async orchestrateGeneration(operation, params, core, options = {}) {
            core.resetOperationState(operation.id);

            const opParams = core.compileOperationParams(operation, params);

            // Engrave accepts open paths — no closed-path validation needed.
            // Open paths trace the centerline; closed paths trace the outline.

            await this.generateGeometry(operation, {
                ...params,
                ...opParams,
                passes: 1,
                combineOffsets: false
            });

            const total = operation.offsets?.reduce(
                (s, o) => s + (o.primitives?.length || 0), 0
            ) || 0;

            if (total === 0) {
                return { success: false, message: 'No engrave paths generated', status: 'warning' };
            }

            return { success: true, message: `Engrave: ${total} path(s) on centerline`, status: 'success' };
        }
    }

    window.ShapeEngraveHandler = ShapeEngraveHandler;
})();