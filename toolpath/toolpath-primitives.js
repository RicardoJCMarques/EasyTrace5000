/**
 * @file        toolpath/toolpath-primitives.js
 * @description Shared primitive classes for toolpath generation
 * @author      Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

/*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2026 Eltryus
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
    }

    window.MotionCommand = MotionCommand;
    window.ToolpathPlan = ToolpathPlan;
})();