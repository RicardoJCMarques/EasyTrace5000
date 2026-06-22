/*!
 * @file        toolpath/toolpath-primitives.js
 * @description Shared primitive classes for toolpath generation
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 *
 * SPDX-FileCopyrightText: 2025-2026 Eltryus - Ricardo Marques
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

(function() {
    'use strict';

    /**
     * Lightweight motion command structure
     */
    class MotionCommand {
        constructor(type, coords, params = {}) {
            this.type = type; // 'RAPID', 'LINEAR', 'ARC_CW', 'ARC_CCW', 'PLUNGE', 'RETRACT', 'DWELL'

            // Only set coordinates that are explicitly provided
            this.x = coords.x !== undefined ? coords.x : null;
            this.y = coords.y !== undefined ? coords.y : null;
            this.z = coords.z !== undefined ? coords.z : null;
            this.f = params.feed;

            // Arc parameters (I,J are relative offsets from start)
            if (type === 'ARC_CW' || type === 'ARC_CCW') {
                this.i = params.i;
                this.j = params.j;
            }

            // Optional parameters
            if (params.dwell) this.dwell = params.dwell;
            if (params.cycleType) this.cycleType = params.cycleType;
            if (params.retract !== undefined) this.retract = params.retract;
            if (params.peckDepth !== undefined) this.peckDepth = params.peckDepth;
            if (params.comment) this.comment = params.comment;
        }
    }

    /**
     * Toolpath plan container
     */
    class ToolpathPlan {
        constructor(operationId) {
            this.operationId = operationId;
            this.commands = [];
            this.metadata = {
                tool: null,
                estimatedTime: 0,
                boundingBox: null,
                totalDistance: 0,
                depthLevels: [],
                entryPoint: null,
                exitPoint: null,
                cutDepth: 0,
                feedRate: 150,
                direction: 'climb',
                isClosedLoop: false,
                isSimpleCircle: false,
                primitiveType: 'unknown',
                hasArcs: false
            };
        }

        addCommand(cmd) {
            this.commands.push(cmd);
        }

        addRapid(x, y, z) {
            this.commands.push(new MotionCommand('RAPID', {
                x: x !== undefined ? x : null, 
                y: y !== undefined ? y : null, 
                z: z !== undefined ? z : null
            }));
        }

        addLinear(x, y, z, feed) {
            this.commands.push(new MotionCommand('LINEAR', {
                x: x !== undefined ? x : null, 
                y: y !== undefined ? y : null, 
                z: z !== undefined ? z : null
            }, { feed: feed }));
        }

        addPlunge(z, feed) {
            this.commands.push(new MotionCommand('PLUNGE', {x: null, y: null, z}, {feed}));
        }

        addRetract(z) {
            this.commands.push(new MotionCommand('RETRACT', {x: null, y: null, z}));
        }

        addArc(x, y, z, i, j, clockwise, feed) {
            const type = clockwise ? 'ARC_CW' : 'ARC_CCW';
            this.commands.push(new MotionCommand(type, {x, y, z}, {i, j, feed}));
        }

        addDwell(duration) {
            this.commands.push(new MotionCommand('DWELL', {x: null, y: null, z: null}, {dwell: duration}));
        }

        addCannedSimple(x, y, z, retract, feed, dwell) {
            this.commands.push(new MotionCommand('CANNED_SIMPLE', {x, y, z}, {retract, feed, dwell}));
        }

        addCannedPeck(x, y, z, retract, peckDepth, feed, cycleType = 'G83') {
            this.commands.push(new MotionCommand('CANNED_PECK', {x, y, z}, {retract, peckDepth, feed, cycleType}));
        }

        /**
         * Computes and stores the XY bounding box from this plan's commands.
         * Single source of truth — replaces duplicated implementations in
         * GeometryTranslator and ToolpathOptimizer.
         */
        computeBounds() {
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;

            for (const cmd of this.commands) {
                if (cmd.x !== null && cmd.x !== undefined) {
                    if (cmd.x < minX) minX = cmd.x;
                    if (cmd.x > maxX) maxX = cmd.x;
                }
                if (cmd.y !== null && cmd.y !== undefined) {
                    if (cmd.y < minY) minY = cmd.y;
                    if (cmd.y > maxY) maxY = cmd.y;
                }
            }

            this.metadata.boundingBox = { minX, minY, maxX, maxY };
            return this.metadata.boundingBox;
        }
    }

    /**
     * Checks whether a points array forms a closed loop (first ≈ last).
     * Single source of truth — replaces duplicated implementations in
     * GeometryTranslator, ToolpathTabPlanner, and ToolpathOptimizer.
     * @param {Array<{x: number, y: number}>} points
     * @param {number} [precision] - Squared-distance threshold (default: uses CAMConfig coordinate precision)
     * @returns {boolean}
     */
    // REVIEW - Why is this outside of ToolpathPlan, while it's extending it? What?
    ToolpathPlan.isClosedPoints = function(points, precision) {
        if (!points || points.length < 2) return false;
        const first = points[0];
        const last = points[points.length - 1];
        const dx = first.x - last.x;
        const dy = first.y - last.y;
        const threshold = precision !== undefined ? precision : (window.CAMConfig?.constants?.precision?.coordinate || 0.001);
        return (dx * dx + dy * dy) < (threshold * threshold);
    };

    window.MotionCommand = MotionCommand;
    window.ToolpathPlan = ToolpathPlan;
})();