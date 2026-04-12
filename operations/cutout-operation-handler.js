/*!
 * @file        operations/cutout-operation-handler.js
 * @description Board cutout — offset with cutSide control, closure detection, and tab orchestration
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
    const debugState = window.PCBCAMConfig.defaults.debug;

    class CutoutOperationHandler extends OffsetOperationHandler {
        // Base OffsetOperationHandler hooks already handle cutSide-driven offset direction.
        // No hook overrides needed — cutout is the base case.

        /**
         * Classifies raw plotter primitives for cutout operations.
         * Extracts closed loops from multi-segment geometry, detects topology
         * (board outlines vs internal holes), and flags orphan segments for
         * the closure prompt.
         */
        classifyPrimitives(operation, rawPrimitives) {
            const warnings = [];
            let primitives = rawPrimitives;

            if (primitives.length > 1) {
                const { loops, orphans, orphanGaps } = GeometryUtils.extractClosedLoops(primitives);

                if (loops.length > 0) {
                    const topology = GeometryUtils.classifyCutoutTopology(loops);
                    const compounds = GeometryUtils.assembleCutoutCompounds(topology);

                    if (compounds.length > 0) {
                        primitives = compounds;
                        const holeCount = topology.filter(t => t.isHole).length;
                        this.debug(`Cutout: ${compounds.length} board(s), ${holeCount} hole(s) from ${loops.length} loop(s)`);
                    } else {
                        primitives = loops;
                    }

                    // Preserve loops for re-classification if orphans get resolved later
                    if (orphans.length > 0) {
                        operation._extractedLoops = loops;
                    }
                }

                if (orphans.length > 0) {
                    operation.needsClosurePrompt = true;
                    operation._closureInfo = {
                        rawPrimitives: orphans,
                        gaps: orphanGaps || []
                    };

                    const gapText = orphanGaps && orphanGaps.length > 0
                        ? orphanGaps.map(g => g.toFixed(4) + 'mm').join(', ')
                        : 'unknown';
                    warnings.push({
                        message: `${orphans.length} segment(s) do not form closed loops. Gaps: ${gapText}`,
                        severity: 'warning'
                    });
                    this.debug(`${orphans.length} orphan segment(s) flagged for closure prompt`);
                }

            } else if (primitives.length === 1) {
                const pts = primitives[0].contours?.[0]?.points;
                if (pts && pts.length >= 3 && GeometryUtils.isClockwise(pts)) {
                    GeometryUtils._reverseContourWinding(primitives[0].contours[0]);
                    this.debug('Single cutout primitive reversed to CCW');
                }
            }

            return { primitives, warnings };
        }

        /**
         * Runs the base offset pipeline, then attaches tab configuration
         * to the resulting primitives so the toolpath translator can
         * detect and process them without operation-type branching.
         */
        async generateGeometry(operation, settings) {
            // Clone to prevent mutating shared state
            settings = { ...settings };

            // Force single-pass routing for cutouts, ignoring any stale cached settings
            settings.passes = 1;
            settings.stepOver = 100; 
            settings.combineOffsets = false;

            const offsets = await super.generateGeometry(operation, settings);

            // Attach tab configuration to offset primitives when tabs are requested
            const tabCount = settings.tabs || 0;
            if (tabCount > 0) {
                const tabConfig = {
                    count: tabCount,
                    width: settings.tabWidth || 0,
                    height: settings.tabHeight || 0
                };
                for (const offset of operation.offsets) {
                    for (const prim of offset.primitives) {
                        if (!prim.properties) prim.properties = {};
                        prim.properties.tabConfig = tabConfig;
                    }
                }
                this.debug(`Attached tabConfig (${tabCount} tabs) to ${operation.offsets.reduce((s, o) => s + o.primitives.length, 0)} primitive(s)`);
            }

            return offsets;
        }
    }

    window.CutoutOperationHandler = CutoutOperationHandler;
})();