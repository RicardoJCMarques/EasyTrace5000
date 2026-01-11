/**
 * @file        toolpath/toolpath-tab-planner.js
 * @description Calculates tab positions for cutout polygons
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

    /**
     * Calculates and returns tab positions (start/end distances) along a closed contour.
     */
    class ToolpathTabPlanner {
        constructor() {
            this.TOLERANCE = 0.001;
            // Tabs will only be placed on a straight segment if its length exceeds this value.
            this.MIN_SEGMENT_LENGTH = 5.0; // Review - Both these values should be in the config
        }

        /**
         * Main entry point. Calculates tab locations, splits the geometry, and returns a flat array of tagged motion commands (LINEAR or ARC) that the MachineProcessor will use to insert Z-moves.
         * @param {Object} geometrySource - The contour (must have points array and arcSegments)
         * @param {Object} context - The operation context
         * @returns {Array<MotionCommand>} Array of motion commands, tagged with isTab: boolean // Review -  description is outdated?
         */
        calculateTabPositions(geometrySource, context) {
            const tabWidth = context.strategy.cutout.tabWidth || 1.0;
            const tabCount = context.strategy.cutout.tabs || 0;

            if (tabCount <= 0 || !geometrySource.points) return [];

            const totalLength = this._calculateTotalLength(geometrySource);
            if (totalLength <= this.TOLERANCE || totalLength < tabWidth * tabCount) {
                return [];
            }

            // Calculate Tab Distance Ranges {start, end}
            const tabRanges = this._calculateTabRanges(geometrySource, tabCount, tabWidth, totalLength);

            // Split Geometry using Tab Ranges
            const motionCommands = this._splitGeometryByRanges(geometrySource, tabRanges, context.cutting.feedRate);

            return motionCommands;
        }

        /**
         * Step 1: Determines tab locations along the path perimeter.
         */
        _calculateTabRanges(geometrySource, tabCount, tabWidth, totalLength) {
            const tabHalfWidth = tabWidth / 2;
            let remainingTabs = tabCount;
            const placedTabs = [];

            const segments = this._mapSegmentsToDistance(geometrySource);

            // Find qualifying straight segments (linear and long enough)
            const straightSegments = segments
                .filter(s => s.type === 'linear' && s.length >= this.MIN_SEGMENT_LENGTH)
                .sort((a, b) => b.length - a.length);

            // Priority 1: Place tabs centered on longest straight segments
            const tabsOnStraight = Math.min(remainingTabs, straightSegments.length);
            for (let i = 0; i < tabsOnStraight; i++) {
                const segment = straightSegments[i];
                const centerDist = segment.startDistance + segment.length / 2;
                placedTabs.push({
                    start: centerDist - tabHalfWidth,
                    end: centerDist + tabHalfWidth
                });
                remainingTabs--;
            }

            // Priority 2: Equidistant placement for remaining tabs
            if (remainingTabs > 0) {
                const totalSlots = placedTabs.length + remainingTabs;
                const spacing = totalLength / totalSlots;

                for (let i = 0; i < totalSlots && remainingTabs > 0; i++) {
                    const centerDist = (spacing / 2) + (i * spacing);
                    const proposedStart = centerDist - tabHalfWidth;
                    const proposedEnd = centerDist + tabHalfWidth;

                    // Check overlap with already-placed tabs
                    const overlaps = placedTabs.some(tab =>
                        tab.start < proposedEnd + this.TOLERANCE &&
                        tab.end > proposedStart - this.TOLERANCE
                    );

                    if (!overlaps) {
                        const wrappedTabs = this._handleBoundary(
                            { start: proposedStart, end: proposedEnd },
                            totalLength
                        );
                        placedTabs.push(...wrappedTabs);
                        remainingTabs--;
                    }
                }
            }

            return placedTabs
                .filter(t => (t.end - t.start) > this.TOLERANCE)
                .sort((a, b) => a.start - b.start);
        }

        /**
         * Step 2: Creates new MotionCommand segments, splitting existing ones where a tab starts or ends.
         */
        _splitGeometryByRanges(geometrySource, tabRanges, feedRate) {
            const points = geometrySource.points;
            const arcMap = new Map();
            if (geometrySource.arcSegments) {
                for (const arc of geometrySource.arcSegments) {
                    arcMap.set(arc.startIndex, arc);
                }
            }

            const motionCommands = [];
            const numPoints = points.length;

            let currentPos = { ...points[0] };
            let currentDistance = 0;

            // Assume tabRanges are sorted by distance.

            for (let i = 0; i < numPoints; i++) {
                const nextI = (i + 1) % numPoints;
                const arc = arcMap.get(i);

                const segmentEndPos = points[nextI];
                const segmentStartDistance = currentDistance;
                let segmentLength = 0;

                // Calculate Segment Length and Arc Center
                let segData = null;
                if (arc) {
                    segData = this._getArcData(points[i], segmentEndPos, arc);
                    segmentLength = segData.length;
                } else {
                    segmentLength = Math.hypot(segmentEndPos.x - points[i].x, segmentEndPos.y - points[i].y);
                }

                const segmentEndDistance = currentDistance + segmentLength;

                let lastSplitDistance = segmentStartDistance;
                let lastSplitPos = currentPos;

                // Collect all split points on this segment (tab start and tab end points)
                const splitPoints = [];

                // Add all tab starts/ends that fall within this segment
                for (const tab of tabRanges) {
                    if (tab.start > segmentStartDistance && tab.start < segmentEndDistance) {
                        splitPoints.push({ dist: tab.start, type: 'start' });
                    }
                    if (tab.end > segmentStartDistance && tab.end < segmentEndDistance) {
                        splitPoints.push({ dist: tab.end, type: 'end' });
                    }
                }

                // Sort split points to iterate correctly
                splitPoints.sort((a, b) => a.dist - b.dist);

                for (const split of splitPoints) {
                    const splitDistance = split.dist;

                    // Check if the path is currently in a tab (distance-wise)
                    const isInTab = tabRanges.some(t => t.start <= lastSplitDistance + this.TOLERANCE && t.end >= splitDistance - this.TOLERANCE);

                    // Calculate Split Position
                    const distAlongSegment = splitDistance - segmentStartDistance;
                    const splitPos = this._getPointAlongSegment(points[i], segmentEndPos, arc, segData, distAlongSegment);

                    // Add the segment piece (from last split to current split)
                    if (splitDistance > lastSplitDistance + this.TOLERANCE) {
                         const newCmd = this._createSegmentCommand(lastSplitPos, splitPos, arc, segData, feedRate, isInTab);
                         motionCommands.push(newCmd);
                    }

                    lastSplitDistance = splitDistance;
                    lastSplitPos = splitPos;
                }

                // Add the remaining segment (from the last split point to the end of the segment)
                const remainingLength = segmentEndDistance - lastSplitDistance;
                if (remainingLength > this.TOLERANCE) {
                    const isInTab = tabRanges.some(t => t.start <= lastSplitDistance + this.TOLERANCE && t.end >= segmentEndDistance - this.TOLERANCE);

                    const finalCmd = this._createSegmentCommand(lastSplitPos, segmentEndPos, arc, segData, feedRate, isInTab);
                    motionCommands.push(finalCmd);
                }

                currentPos = segmentEndPos;
                currentDistance = segmentEndDistance;
            }

            return motionCommands;
        }


        // Geometric Utility Methods

        _getArcData(startPoint, endPoint, arc) {
             const center = { x: arc.center.x, y: arc.center.y };

             const radius = Math.hypot(startPoint.x - center.x, startPoint.y - center.y);

             const startAngle = Math.atan2(startPoint.y - center.y, startPoint.x - center.x);
             const endX = endPoint.x;
             const endY = endPoint.y;
             const endAngle = Math.atan2(endY - center.y, endX - center.x);

             let sweep = endAngle - startAngle;
             if (arc.clockwise) {
                 if (sweep > this.TOLERANCE) sweep -= 2 * Math.PI;
             } else {
                 if (sweep < -this.TOLERANCE) sweep += 2 * Math.PI;
             }

             return {
                 center,
                 radius,
                 startAngle,
                 endAngle,
                 sweep,
                 length: Math.abs(sweep * radius),
                 clockwise: arc.clockwise
             };
        }

        _getPointAlongSegment(startPoint, endPoint, arc, segData, distanceAlong) {
            if (distanceAlong < this.TOLERANCE) return startPoint;

            if (!arc) {
                // Linear Interpolation
                const dx = endPoint.x - startPoint.x;
                const dy = endPoint.y - startPoint.y;
                const len = Math.hypot(dx, dy);
                if (len < this.TOLERANCE) return startPoint;

                const ratio = Math.min(1.0, distanceAlong / len);
                return { x: startPoint.x + dx * ratio, y: startPoint.y + dy * ratio };
            } 
            else {
                // Angular Interpolation (Preserves Radius)
                if (!segData || segData.length < this.TOLERANCE) return startPoint;

                const ratio = Math.min(1.0, distanceAlong / segData.length);
                const targetAngle = segData.startAngle + (segData.sweep * ratio);

                return { 
                    x: segData.center.x + segData.radius * Math.cos(targetAngle), 
                    y: segData.center.y + segData.radius * Math.sin(targetAngle)
                };
            }
        }

        _createSegmentCommand(startPos, endPos, arc, segData, feedRate, isTab) {
            // Standard G-Code: I/J are relative distance from START point to CENTER
            const i_val = arc ? segData.center.x - startPos.x : null;
            const j_val = arc ? segData.center.y - startPos.y : null;

            // Logic inversion to match GeometryTranslator
            // !segData.clockwise -> true = CW = G2 = ARC_CW
            const type = arc ? (!segData.clockwise ? 'ARC_CW' : 'ARC_CCW') : 'LINEAR';

            const cmd = new MotionCommand(type, 
                { x: endPos.x, y: endPos.y, z: null }, 
                { i: i_val, j: j_val, feed: feedRate }
            );
            cmd.metadata = cmd.metadata || {}; 
            cmd.metadata.isTab = isTab; 
            return cmd;
        }

        /**
         * Clamps tab boundaries to (0, totalLength) and splits tabs that wrap around the seam.
         */
        _handleBoundary(tab, totalLength) {
            const newTabs = [];

            if (tab.start < 0) {
                newTabs.push({ start: tab.start + totalLength, end: totalLength });
                newTabs.push({ start: 0, end: tab.end });
            } else if (tab.end > totalLength) {
                 newTabs.push({ start: tab.start, end: totalLength });
                 newTabs.push({ start: 0, end: tab.end - totalLength });
            } else {
                newTabs.push(tab);
            }

            return newTabs.filter(t => (t.end - t.start) > this.TOLERANCE);
        }

        _mapSegmentsToDistance(geometry) {
            const segments = [];
            const points = geometry.points;
            const arcMap = new Map();
            if (geometry.arcSegments) {
                for (const arc of geometry.arcSegments) {
                    arcMap.set(arc.startIndex, arc);
                }
            }

            const numPoints = points.length;
            let currentDistance = 0;

            for (let i = 0; i < numPoints; i++) {
                const nextI = (i + 1) % numPoints;
                const arc = arcMap.get(i);
                const startPoint = points[i];
                const endPoint = points[nextI];

                let segmentLength = 0;
                let type = 'linear';

                if (arc) {
                    type = 'arc';
                    const segData = this._getArcData(startPoint, endPoint, arc);
                    segmentLength = segData.length;
                } else {
                    segmentLength = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);
                }

                segments.push({
                    type: type,
                    index: i,
                    length: segmentLength,
                    startDistance: currentDistance,
                    endDistance: currentDistance + segmentLength
                });

                currentDistance += segmentLength;
            }

            return segments;
        }

        _calculateTotalLength(geometry) {
            let length = 0;
            const points = geometry.points;
            if (!points || points.length < 2) return 0;

            const arcMap = new Map();
            if (geometry.arcSegments) {
                for (const arc of geometry.arcSegments) {
                    arcMap.set(arc.startIndex, arc);
                }
            }

            const numPoints = points.length;

            for (let i = 0; i < numPoints; i++) {
                const nextI = (i + 1) % numPoints;
                const arc = arcMap.get(i);

                if (arc && arc.endIndex === nextI) {
                    let sweep = arc.endAngle - arc.startAngle;
                    if (arc.clockwise) {
                        if (sweep > this.TOLERANCE) sweep -= 2 * Math.PI;
                    } else {
                        if (sweep < -this.TOLERANCE) sweep += 2 * Math.PI;
                    }

                    const distToNext = Math.hypot(points[nextI].x - points[i].x, points[nextI].y - points[i].y);
                    if (distToNext < this.TOLERANCE && Math.abs(sweep) < Math.PI * 0.5) {
                        sweep = arc.clockwise ? -2 * Math.PI : 2 * Math.PI;
                    }

                    length += Math.abs(sweep * arc.radius);
                } else {
                    length += Math.hypot(
                        points[nextI].x - points[i].x, 
                        points[nextI].y - points[i].y
                    );
                }
            }
            return length;
        }
    }

    window.ToolpathTabPlanner = ToolpathTabPlanner;
})();