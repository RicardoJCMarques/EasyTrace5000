/*!
 * @file        parsers/primitives.js
 * @description Defines geometric primitive data structures
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

    const config = window.PCBCAMConfig;

    let nextPrimitiveId = 1;

    /**
     * Base class for all geometric primitives data objects.
     */
    class RenderPrimitive {
        constructor(type, properties = {}) {
            this.type = type;
            this.properties = properties;
            this.bounds = null;
            this.id = `prim_${nextPrimitiveId++}`;
            this.geometricContext = {
                originalType: type,
                isAnalytic: false,
                metadata: {}
            };
        }

        getBounds() {
            if (!this.bounds) {
                this.calculateBounds();
            }
            return this.bounds;
        }

        calculateBounds() {
            this.bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        }

        getCenter() {
            const bounds = this.getBounds();
            return {
                x: (bounds.minX + bounds.maxX) / 2,
                y: (bounds.minY + bounds.maxY) / 2
            };
        }

        canOffsetAnalytically() {
            return this.geometricContext.isAnalytic;
        }

        getGeometricMetadata() {
            return this.geometricContext;
        }
    }

    /**
     * PathPrimitive - complex shape with optional analytic arcs
     */
    class PathPrimitive extends RenderPrimitive {
        constructor(contours, properties = {}) {
            super('path', properties); // Pass type to super
            this.properties = properties;
            this.closed = properties.closed !== false;
            
            if (Array.isArray(contours) && contours.length > 0) {
                this.contours = contours;
            } else {
                this.contours = [];
            }

            this.id = `path_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }

        /**
         * POLARITY, WINDING, AND HIERARCHY IN PATHPRIMITIVE
         * 
         * Three distinct but related concepts:
         * 
         * 1. properties.polarity: Gerber/CAM semantic meaning
         *    - 'dark': Copper/material present
         *    - 'clear': Copper/material removed
         *    - Used for: Boolean operations, layer semantics
         * 
         * 2. contour.isHole: Geometric hierarchy
         *    - false: Outer boundary (shell)
         *    - true: Inner boundary (hole within parent)
         *    - Used for: Rendering (with evenodd), nesting relationships
         * 
         * 3. Winding direction: Point traversal order
         *    - CCW (counter-clockwise): Positive area in Y-up
         *    - CW (clockwise): Negative area in Y-up
         *    - Convention: Outer=CCW, Hole=CW (before Y-flip)
         *    - Used for: Boolean ops, determining isHole
         * 
         * Relationship:
         * - A 'dark' primitive can have 'clear' holes (compound path)
         * - isHole is derived from winding during parsing/processing
         * - polarity affects boolean operations but not rendering
         * - Canvas rendering uses winding via 'evenodd' fill rule
         */

        calculateBounds() {
            if (!this.contours || this.contours.length === 0) {
                this.bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
                return;
            }

            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;

            this.contours.forEach(contour => {
                // Calculate bounds from outer contours only (skip holes)
                if (!contour.isHole && contour.points) {
                    contour.points.forEach(point => {
                        if (point !== null && point !== undefined) {
                            minX = Math.min(minX, point.x);
                            minY = Math.min(minY, point.y);
                            maxX = Math.max(maxX, point.x);
                            maxY = Math.max(maxY, point.y);
                        }
                    });
                }

                // Expand bounds for arc segments
                if (contour.arcSegments && contour.arcSegments.length > 0) {
                    contour.arcSegments.forEach(seg => {
                        const { center, radius, startAngle, endAngle, clockwise } = seg;
                        const checkCrossing = (angle) => {
                            const normalizedAngle = angle % (2 * Math.PI);
                            let start = startAngle % (2 * Math.PI);
                            let end = endAngle % (2 * Math.PI);

                            if (start < 0) start += 2 * Math.PI;
                            if (end < 0) end += 2 * Math.PI;

                            if (clockwise) {
                                if (start > end) {
                                    return normalizedAngle <= start && normalizedAngle >= end;
                                } else {
                                    return normalizedAngle <= start || normalizedAngle >= end;
                                }
                            } else {
                                if (start < end) {
                                    return normalizedAngle >= start && normalizedAngle <= end;
                                } else {
                                    return normalizedAngle >= start || normalizedAngle <= end;
                                }
                            }
                        };

                        if (checkCrossing(0)) maxX = Math.max(maxX, center.x + radius);
                        if (checkCrossing(Math.PI / 2)) maxY = Math.max(maxY, center.y + radius);
                        if (checkCrossing(Math.PI)) minX = Math.min(minX, center.x - radius);
                        if (checkCrossing(3 * Math.PI / 2)) minY = Math.min(minY, center.y - radius);
                    });
                }
            });

            if (!isFinite(minX)) {
                this.bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
                return;
            }

            if (this.properties.stroke && this.properties.strokeWidth) {
                const halfStroke = this.properties.strokeWidth / 2;
                minX -= halfStroke;
                minY -= halfStroke;
                maxX += halfStroke;
                maxY += halfStroke;
            }

            this.bounds = { minX, minY, maxX, maxY };
        }
    }

    /**
     * CirclePrimitive - analytic circle
     */
    class CirclePrimitive extends RenderPrimitive {
        constructor(center, radius, properties = {}) {
            super('circle', properties);
            this.center = center;
            this.radius = radius;

            this.geometricContext.isAnalytic = true;
            this.geometricContext.metadata = { 
                center: { ...center }, 
                radius: radius 
            };
        }

        calculateBounds() {
            let r = this.radius;
            if (this.properties.strokeWidth && this.properties.stroke) {
                r += this.properties.strokeWidth / 2;
            }
            this.bounds = {
                minX: this.center.x - r,
                minY: this.center.y - r,
                maxX: this.center.x + r,
                maxY: this.center.y + r
            };
        }

        getCenter() { 
            return { ...this.center };
        }
    }

    /**
     * RectanglePrimitive - analytic rectangle
     */
    class RectanglePrimitive extends RenderPrimitive {
        constructor(position, width, height, properties = {}) {
            super('rectangle', properties);
            this.position = position; // Bottom-left corner
            this.width = width;
            this.height = height;

            this.geometricContext.isAnalytic = true;
            this.geometricContext.metadata = { 
                position: { ...position }, 
                width, 
                height 
            };
        }

        calculateBounds() {
            let { x, y } = this.position;
            let w = this.width;
            let h = this.height;

            if (this.properties.strokeWidth && this.properties.stroke) {
                const halfStroke = this.properties.strokeWidth / 2;
                x -= halfStroke;
                y -= halfStroke;
                w += this.properties.strokeWidth;
                h += this.properties.strokeWidth;
            }

            this.bounds = {
                minX: x,
                minY: y,
                maxX: x + w,
                maxY: y + h
            };
        }
    }

    /**
     * ObroundPrimitive - analytic obround
     */
    class ObroundPrimitive extends RenderPrimitive {
        constructor(position, width, height, properties = {}) {
            super('obround', properties);
            this.position = position;
            this.width = width;
            this.height = height;
            
            const tolerance = config.precision.coordinate;
            this.isCircular = Math.abs(width - height) < tolerance;
            
            this.geometricContext.isAnalytic = true;
            this.geometricContext.metadata = {
                position: { ...position },
                width,
                height,
                isCircular: this.isCircular,
                cornerRadius: Math.min(width, height) / 2
            };
        }

        calculateBounds() {
            let { x, y } = this.position;
            let w = this.width;
            let h = this.height;

            if (this.properties.strokeWidth && this.properties.stroke) {
                const halfStroke = this.properties.strokeWidth / 2;
                x -= halfStroke;
                y -= halfStroke;
                w += this.properties.strokeWidth;
                h += this.properties.strokeWidth;
            }

            this.bounds = {
                minX: x,
                minY: y,
                maxX: x + w,
                maxY: y + h
            };
        }
    }

    /**
     * ArcPrimitive - analytic circular arc
     */
    class ArcPrimitive extends RenderPrimitive {
        constructor(center, radius, startAngle, endAngle, clockwise, properties = {}) {
            super('arc', properties);
            this.center = center;
            this.radius = radius;
            this.startAngle = startAngle;
            this.endAngle = endAngle;
            this.clockwise = clockwise;

            this.geometricContext.isAnalytic = true;
            this.geometricContext.metadata = {
                center,
                radius,
                startAngle,
                endAngle,
                clockwise
            };

            this.startPoint = {
                x: center.x + radius * Math.cos(startAngle),
                y: center.y + radius * Math.sin(startAngle)
            };
            this.endPoint = {
                x: center.x + radius * Math.cos(endAngle),
                y: center.y + radius * Math.sin(endAngle)
            };
        }

        calculateBounds() {
            let minX = Math.min(this.startPoint.x, this.endPoint.x);
            let minY = Math.min(this.startPoint.y, this.endPoint.y);
            let maxX = Math.max(this.startPoint.x, this.endPoint.x);
            let maxY = Math.max(this.startPoint.y, this.endPoint.y);

            // Check if arc crosses cardinal directions
            const checkCrossing = (angle) => {
                const normalizedAngle = angle % (2 * Math.PI);
                let start = this.startAngle % (2 * Math.PI);
                let end = this.endAngle % (2 * Math.PI);

                if (start < 0) start += 2 * Math.PI;
                if (end < 0) end += 2 * Math.PI;

                if (this.clockwise) {
                    if (start > end) {
                        return normalizedAngle <= start && normalizedAngle >= end;
                    } else {
                        return normalizedAngle <= start || normalizedAngle >= end;
                    }
                } else {
                    if (start < end) {
                        return normalizedAngle >= start && normalizedAngle <= end;
                    } else {
                        return normalizedAngle >= start || normalizedAngle <= end;
                    }
                }
            };

            if (checkCrossing(0)) maxX = Math.max(maxX, this.center.x + this.radius);
            if (checkCrossing(Math.PI / 2)) maxY = Math.max(maxY, this.center.y + this.radius);
            if (checkCrossing(Math.PI)) minX = Math.min(minX, this.center.x - this.radius);
            if (checkCrossing(3 * Math.PI / 2)) minY = Math.min(minY, this.center.y - this.radius);

            // Expand by stroke width if stroked
            if (this.properties.stroke && this.properties.strokeWidth) {
                const halfStroke = this.properties.strokeWidth / 2;
                minX -= halfStroke;
                minY -= halfStroke;
                maxX += halfStroke;
                maxY += halfStroke;
            }

            this.bounds = { minX, minY, maxX, maxY };
        }
    }

    /**
     * EllipticalArcPrimitive - analytic elliptical arc
     */
    class EllipticalArcPrimitive extends RenderPrimitive {
        constructor(startPoint, endPoint, params, properties = {}) {
            super('elliptical_arc', properties);

            this.startPoint = startPoint;
            this.endPoint = endPoint;
            this.rx = params.rx;
            this.ry = params.ry;
            this.phi = params.phi;
            this.fA = params.fA === 1; // Large arc flag
            this.fS = params.fS === 1; // Sweep flag

            this.geometricContext.isAnalytic = true;
            this.geometricContext.metadata = {
                ...params,
                startPoint,
                endPoint
            };
        }

        canOffsetAnalytically() {
            return false;
        }

        calculateBounds() {
            // Simple bounding box from endpoints
            const minX = Math.min(this.startPoint.x, this.endPoint.x);
            const minY = Math.min(this.startPoint.y, this.endPoint.y);
            const maxX = Math.max(this.startPoint.x, this.endPoint.x);
            const maxY = Math.max(this.startPoint.y, this.endPoint.y);

            // Expand by max radius as conservative estimate
            const maxRadius = Math.max(this.rx, this.ry);

            this.bounds = {
                minX: minX - maxRadius,
                minY: minY - maxRadius,
                maxX: maxX + maxRadius,
                maxY: maxY + maxRadius
            };
        }
    }

    /**
     * BezierPrimitive - analytic Bezier curve
     */
    class BezierPrimitive extends RenderPrimitive {
        constructor(points, properties = {}) {
            super('bezier', properties);
            this.points = points; // [p0, p1, p2] or [p0, p1, p2, p3]

            this.geometricContext.isAnalytic = true;
            this.geometricContext.metadata = {
                points: [...points],
                degree: points.length - 1
            };
        }

        canOffsetAnalytically() {
            return false;
        }

        calculateBounds() {
            // Simple bounding box from control points
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;

            this.points.forEach(point => {
                minX = Math.min(minX, point.x);
                minY = Math.min(minY, point.y);
                maxX = Math.max(maxX, point.x);
                maxY = Math.max(maxY, point.y);
            });

            // Expand by stroke width if stroked
            if (this.properties.stroke && this.properties.strokeWidth) {
                const halfStroke = this.properties.strokeWidth / 2;
                minX -= halfStroke;
                minY -= halfStroke;
                maxX += halfStroke;
                maxY += halfStroke;
            }

            this.bounds = { minX, minY, maxX, maxY };
        }
    }

    window.RenderPrimitive = RenderPrimitive;
    window.PathPrimitive = PathPrimitive;
    window.CirclePrimitive = CirclePrimitive;
    window.RectanglePrimitive = RectanglePrimitive;
    window.ObroundPrimitive = ObroundPrimitive;
    window.ArcPrimitive = ArcPrimitive;
    window.EllipticalArcPrimitive = EllipticalArcPrimitive;
    window.BezierPrimitive = BezierPrimitive;
})();