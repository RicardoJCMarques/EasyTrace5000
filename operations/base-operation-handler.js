/*!
 * @file        operations/base-operation-handler.js
 * @description Base operation handler interface — contract for all operation types
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 *
 * SPDX-FileCopyrightText: 2025-2026 Eltryus - Ricardo Marques
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

(function() {
    'use strict';

    const D = window.CAMConfig.defaults;
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
         * Default preparation for offset pipeline: strips SVG visual
         * properties and forces machining-intent flags. Primitives that
         * already have fill:true + no stroke pass through unchanged.
         * Subclasses override only when they need different behavior
         * (e.g. copper handlers that preserve stroke for expandStroke).
         */
        preparePrimitivesForOffset(primitives) {
            return primitives.map(prim => {
                const props = prim.properties || {};
                if (props.fill && !props.stroke && !props.isTrace) return prim;

                // Shallow spread first (keeps a V8 hidden class — fast property
                // access downstream in the offset loop and Clipper marshalling),
                // then re-attach the prototype for class methods (getBounds etc).
                // Object.create + Object.assign built the object incrementally
                // on a bare prototype, forcing dictionary-mode lookups.
                const clone = {
                    ...prim,
                    properties: {
                        ...props,
                        fill: true,
                        stroke: false,
                        strokeWidth: 0,
                        isTrace: false
                    }
                };
                Object.setPrototypeOf(clone, Object.getPrototypeOf(prim));
                return clone;
            });
        }

        /**
         * Routes a single primitive to the appropriate geometry operation
         * during the per-pass offset loop.
         *
         * Default: calls offsetBoundary (treat everything as a filled boundary).
         * EasyTrace5000 copper handlers override to detect strokes, nesting and
         * call expandStroke with combined width instead.
         *
         * @param {Object} primitive - A single primitive to offset
         * @param {number} distance - Signed offset distance
         * @returns {Object|Array|null} Offset result(s)
         */
        async offsetSinglePrimitive(primitive, distance) {
            return this.core.geometryOffsetter.offsetBoundary(primitive, distance);
        }

        /**
         * CNC variant: Generate operation-specific geometry (offsets, drill strategy, stencil apertures).
         * Writes to operation.offsets[].
         */
        async generateGeometry(operation, settings) {
            throw new Error(`${this.constructor.name}.generateGeometry() not implemented`);
        }

        /**
         * Laser variant: Generate laser-specific geometry.
         * Default delegates to generateGeometry (offset strategy).
         */
        async generateLaserFills(operation, settings) {
            return this.generateGeometry(operation, settings);
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