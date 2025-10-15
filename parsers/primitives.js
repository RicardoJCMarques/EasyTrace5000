/**
 * @file        parsers/primitives.js
 * @description Defines geometric primitives (Path, Circle, Arc, Rectangle, Obround)
 * @comment     Store clockwise property for all curve registrations
 * @author      Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

/*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2025 Eltryus
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
    
    // Get config reference
    const config = window.PCBCAMConfig || {};
    const geomConfig = config.geometry || {};
    const segmentConfig = geomConfig.segments || {};
    
    // Primitive ID counter for tracking
    let nextPrimitiveId = 1;
    
    class RenderPrimitive {
        constructor(type, properties = {}) {
            this.type = type;
            this.properties = properties;
            this.bounds = null;
            
            // Unique ID for primitive tracking
            this.id = `prim_${nextPrimitiveId++}`;
            
            // Preserve original geometric context
            this.geometricContext = {
                originalType: type,
                isAnalytic: false,
                metadata: {}
            };
            
            this.creationInfo = {
                timestamp: Date.now(),
                source: 'primitive-factory'
            };
        }
        
        getBounds() {
            if (!this.bounds) {
                this.calculateBounds();
            }
            return this.bounds;
        }
        
        calculateBounds() {
            // Override in subclasses
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
        
        // Base method for curve metadata generation
        generateCurveMetadata() {
            // Override in subclasses that represent curves
            return null;
        }
    }
    
    class PathPrimitive extends RenderPrimitive {
        constructor(points, properties = {}) {
            super('path', properties);
            
            this.points = points;
            this.closed = properties.closed !== false;
            this.arcSegments = properties.arcSegments || [];
            this.curveIds = properties.curveIds || [];
            
            // UNIFIED CONTOURS SYSTEM
            this.contours = properties.contours || [];
            
            // Auto-generate simple contour if not provided
            if (this.contours.length === 0 && this.points.length >= 3) {
                this.contours = [{
                    points: this.points,
                    nestingLevel: 0,
                    isHole: false,
                    parentId: null
                }];
            }
            
            // Update geometric context if this path contains arcs
            if (this.arcSegments.length > 0) {
                this.geometricContext.containsArcs = true;
                this.geometricContext.arcData = this.arcSegments;
            }
        }
        
        calculateBounds() {
            if (!this.points || this.points.length === 0) {
                this.bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
                return;
            }
            
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            
            // Calculate bounds from points
            this.points.forEach(point => {
                if (point !== null && point !== undefined) {
                    minX = Math.min(minX, point.x);
                    minY = Math.min(minY, point.y);
                    maxX = Math.max(maxX, point.x);
                    maxY = Math.max(maxY, point.y);
                }
            });
            
            // Include holes in bounds SHOULDN'T THIS FUNCTION BE LOOKING AT .CONTOURS INSTEAD OF .HOLES??? These may be the last remnants of that system.
            if (this.holes && this.holes.length > 0) {
                this.holes.forEach(hole => {
                    if (Array.isArray(hole)) {
                        hole.forEach(point => {
                            if (point !== null && point !== undefined) {
                                minX = Math.min(minX, point.x);
                                minY = Math.min(minY, point.y);
                                maxX = Math.max(maxX, point.x);
                                maxY = Math.max(maxY, point.y);
                            }
                        });
                    }
                });
            }
            
            // Expand bounds by stroke width if stroked
            if (this.properties.stroke && this.properties.strokeWidth) {
                const halfStroke = this.properties.strokeWidth / 2;
                minX -= halfStroke;
                minY -= halfStroke;
                maxX += halfStroke;
                maxY += halfStroke;
            }
            
            this.bounds = { minX, minY, maxX, maxY };
        }
        
        addArcSegment(startIndex, endIndex, center, radius, startAngle, endAngle, clockwise) {
            this.arcSegments.push({
                startIndex,
                endIndex,
                center,
                radius,
                startAngle,
                endAngle,
                clockwise
            });
            this.geometricContext.containsArcs = true;
        }
        
        // Generate metadata for arc segments
        generateCurveMetadata() {
            if (!this.arcSegments || this.arcSegments.length === 0) {
                return null;
            }
            
            return {
                type: 'path_with_arcs',
                segments: this.arcSegments.map(seg => ({
                    type: 'arc',
                    center: { ...seg.center },
                    radius: seg.radius,
                    startAngle: seg.startAngle,
                    endAngle: seg.endAngle,
                    clockwise: seg.clockwise,
                    startIndex: seg.startIndex,
                    endIndex: seg.endIndex
                }))
            };
        }
    }
    
    class CirclePrimitive extends RenderPrimitive {
        constructor(center, radius, properties = {}) {
            super('circle', properties);
            this.center = center;
            this.radius = radius;
            
            // Mark as analytically offsettable
            this.geometricContext.isAnalytic = true;
            this.geometricContext.metadata = {
                center: { ...center },
                radius: radius
            };
            
            // Register curve with correct winding
            this.curveId = this.registerAsGlobalCurve();
            if (this.curveId) {
                this.curveIds = [this.curveId];
            }
        }
        
        registerAsGlobalCurve() {
            if (!window.globalCurveRegistry) {
                if (window.PCBCAMConfig?.debug?.enabled) {
                    console.warn('[CirclePrimitive] Global curve registry not available at creation');
                }
                return null;
            }
            
            // In screen coordinates (Y-down), 0→2π generates CW
            // Register as such for accurate reconstruction
            const curveId = window.globalCurveRegistry.register({
                type: 'circle',
                center: { ...this.center },
                radius: this.radius,
                primitiveId: this.id,
                clockwise: true,  // 0→2π is CW in Y-down screen coords
                source: 'primitive_circle'
            });
            
            if (this.debug) {
                console.log(`[CirclePrimitive] Registered circle ${this.id} as curve ${curveId} (CW in screen coords)`);
            }
            
            return curveId;
        }
        
        calculateBounds() {
            let effectiveRadius = this.radius;
            if (this.properties.strokeWidth && this.properties.stroke) {
                effectiveRadius += this.properties.strokeWidth / 2;
            }
            
            this.bounds = {
                minX: this.center.x - effectiveRadius,
                minY: this.center.y - effectiveRadius,
                maxX: this.center.x + effectiveRadius,
                maxY: this.center.y + effectiveRadius
            };
        }
        
        getCenter() {
            return { x: this.center.x, y: this.center.y };
        }
        
        getOffsetGeometry(offsetDistance) {
            return new CirclePrimitive(
                this.center,
                Math.max(0, this.radius + offsetDistance),
                { ...this.properties }
            );
        }
        
        generateCurveMetadata() {
            return {
                type: 'circle',
                center: { ...this.center },
                radius: this.radius,
                clockwise: true,
                properties: {
                    isComplete: true,
                    startAngle: 0,
                    endAngle: 2 * Math.PI
                }
            };
        }
        
        toPolygon(minSegments = null, maxSegments = null, curveIds = null) {
            const segmentConfig = window.PCBCAMConfig?.geometry?.segments || {};
            minSegments = minSegments || segmentConfig.minCircle || 16;
            maxSegments = maxSegments || segmentConfig.maxCircle || 128;
            
            const segments = GeometryOptimizer.getOptimalSegments(
                this.radius, 
                minSegments, 
                maxSegments,
                segmentConfig.targetLength || 0.1
            );
            
            const polygonPoints = [];
            const curveId = this.curveId || (curveIds && curveIds.length > 0 ? curveIds[0] : undefined);
            
            // Generate 0→2π (CW in screen coords Y-down)
            for (let i = 0; i <= segments; i++) {
                const normalizedIndex = i % segments;
                const angle = (normalizedIndex / segments) * 2 * Math.PI;
                const point = {
                    x: this.center.x + this.radius * Math.cos(angle),
                    y: this.center.y + this.radius * Math.sin(angle)
                };
                
                if (curveId !== undefined) {
                    point.curveId = curveId;
                    point.segmentIndex = normalizedIndex;
                    point.totalSegments = segments;
                    point.t = normalizedIndex / segments;
                    point.angle = angle;
                }
                
                polygonPoints.push(point);
            }
            
            const pathPrimitive = new PathPrimitive(polygonPoints, {
                ...this.properties,
                closed: true,
                originalCircle: {
                    center: { ...this.center },
                    radius: this.radius
                },
                curveIds: [curveId].filter(id => id !== undefined),
                originalPointCount: segments + 1,
                hasCompleteMetadata: true
            });
            
            return pathPrimitive;
        }
    }
    
    class RectanglePrimitive extends RenderPrimitive {
        constructor(position, width, height, properties = {}) {
            super('rectangle', properties);
            this.position = position;
            this.width = width;
            this.height = height;
            
            // Rectangles can be offset analytically
            this.geometricContext.isAnalytic = true;
            this.geometricContext.metadata = {
                position: { ...position },
                width: width,
                height: height
            };
        }
        
        calculateBounds() {
            let minX = this.position.x;
            let minY = this.position.y;
            let maxX = this.position.x + this.width;
            let maxY = this.position.y + this.height;
            
            if (this.properties.strokeWidth && this.properties.stroke) {
                const halfStroke = this.properties.strokeWidth / 2;
                minX -= halfStroke;
                minY -= halfStroke;
                maxX += halfStroke;
                maxY += halfStroke;
            }
            
            this.bounds = { minX, minY, maxX, maxY };
        }
        
        toPolygon() {
            const points = [
                { x: this.position.x, y: this.position.y },
                { x: this.position.x + this.width, y: this.position.y },
                { x: this.position.x + this.width, y: this.position.y + this.height },
                { x: this.position.x, y: this.position.y + this.height },
                { x: this.position.x, y: this.position.y } // Explicitly close
            ];
            
            return new PathPrimitive(points, {
                ...this.properties,
                closed: true,
                originalRectangle: {
                    position: { ...this.position },
                    width: this.width,
                    height: this.height
                }
            });
        }
        
        // Rectangles aren't curves
        generateCurveMetadata() {
            return null;
        }
    }
    
    class ObroundPrimitive extends RenderPrimitive {
        constructor(position, width, height, properties = {}) {
            super('obround', properties);
            this.position = position;
            this.width = width;
            this.height = height;
            
            // Check if this is actually a circle (equal dimensions)
            const tolerance = geomConfig.coordinatePrecision || 0.001;
            this.isCircular = Math.abs(width - height) < tolerance;
            
            if (this.isCircular) {
                // It's actually a circle - mark it as such
                this.geometricContext.isAnalytic = true;
                this.geometricContext.metadata = {
                    position: { ...position },
                    width: width,
                    height: height,
                    actualType: 'circle',
                    radius: width / 2,
                    center: {
                        x: position.x + width / 2,
                        y: position.y + height / 2
                    }
                };
                
                // Register as a single circle with direction, UNLESS it's a drill feature.
                // Drill features do not need curve registration for offsets.
                if (!properties.isDrillSlot && window.globalCurveRegistry) {
                    this.curveId = window.globalCurveRegistry.register({
                        type: 'circle',
                        center: this.geometricContext.metadata.center,
                        radius: this.geometricContext.metadata.radius,
                        primitiveId: this.id,
                        clockwise: false,  // Circles always CCW
                        source: 'obround_circular'
                    });
                    this.curveIds = [this.curveId];
                }
            } else {
                // True obround with semicircles
                this.geometricContext.isAnalytic = true;
                this.geometricContext.metadata = {
                    position: { ...position },
                    width: width,
                    height: height,
                    cornerRadius: Math.min(width, height) / 2
                };
                
                // Register the semicircles as curves, UNLESS it's a drill feature.
                if (!properties.isDrillSlot) {
                    this.registerSemicircles();
                }
            }
        }
        
        registerSemicircles() {
            if (!window.globalCurveRegistry) {
                return;
            }
            
            const r = Math.min(this.width, this.height) / 2;
            this.curveIds = [];
            
            // FIXED: Store clockwise property for all semicircle registrations
            // End-caps are always generated CCW
            if (this.width > this.height) {
                // Horizontal obround - two semicircles
                const leftId = window.globalCurveRegistry.register({
                    type: 'arc',
                    center: { x: this.position.x + r, y: this.position.y + r },
                    radius: r,
                    startAngle: Math.PI / 2,
                    endAngle: 3 * Math.PI / 2,
                    clockwise: false,  // CCW semicircle
                    primitiveId: this.id,
                    source: 'obround_left'
                });
                
                const rightId = window.globalCurveRegistry.register({
                    type: 'arc',
                    center: { x: this.position.x + this.width - r, y: this.position.y + r },
                    radius: r,
                    startAngle: -Math.PI / 2,
                    endAngle: Math.PI / 2,
                    clockwise: false,  // CCW semicircle
                    primitiveId: this.id,
                    source: 'obround_right'
                });
                
                if (leftId) this.curveIds.push(leftId);
                if (rightId) this.curveIds.push(rightId);
            } else {
                // Vertical obround - two semicircles
                const topId = window.globalCurveRegistry.register({
                    type: 'arc',
                    center: { x: this.position.x + r, y: this.position.y + r },
                    radius: r,
                    startAngle: Math.PI,
                    endAngle: 2 * Math.PI,
                    clockwise: false,  // CCW semicircle
                    primitiveId: this.id,
                    source: 'obround_top'
                });
                
                const bottomId = window.globalCurveRegistry.register({
                    type: 'arc',
                    center: { x: this.position.x + r, y: this.position.y + this.height - r },
                    radius: r,
                    startAngle: 0,
                    endAngle: Math.PI,
                    clockwise: false,  // CCW semicircle
                    primitiveId: this.id,
                    source: 'obround_bottom'
                });
                
                if (topId) this.curveIds.push(topId);
                if (bottomId) this.curveIds.push(bottomId);
            }
        }
        
        calculateBounds() {
            let minX = this.position.x;
            let minY = this.position.y;
            let maxX = this.position.x + this.width;
            let maxY = this.position.y + this.height;
            
            if (this.properties.strokeWidth && this.properties.stroke) {
                const halfStroke = this.properties.strokeWidth / 2;
                minX -= halfStroke;
                minY -= halfStroke;
                maxX += halfStroke;
                maxY += halfStroke;
            }
            
            this.bounds = { minX, minY, maxX, maxY };
        }
        
        // Generate curve metadata for obround
        generateCurveMetadata() {
            if (this.isCircular) {
                // Return circle metadata
                return {
                    type: 'circle',
                    center: this.geometricContext.metadata.center,
                    radius: this.geometricContext.metadata.radius,
                    clockwise: false,  // Always CCW
                    originalObround: true
                };
            }
            
            // Return obround metadata with curves
            const r = Math.min(this.width, this.height) / 2;
            const curves = [];
            
            if (this.width > this.height) {
                // Horizontal obround - two semicircles (CCW)
                curves.push({
                    type: 'arc',
                    center: { x: this.position.x + r, y: this.position.y + r },
                    radius: r,
                    startAngle: Math.PI / 2,
                    endAngle: 3 * Math.PI / 2,
                    clockwise: false
                });
                curves.push({
                    type: 'arc',
                    center: { x: this.position.x + this.width - r, y: this.position.y + r },
                    radius: r,
                    startAngle: -Math.PI / 2,
                    endAngle: Math.PI / 2,
                    clockwise: false
                });
            } else {
                // Vertical obround - two semicircles (CCW)
                curves.push({
                    type: 'arc',
                    center: { x: this.position.x + r, y: this.position.y + r },
                    radius: r,
                    startAngle: Math.PI,
                    endAngle: 2 * Math.PI,
                    clockwise: false
                });
                curves.push({
                    type: 'arc',
                    center: { x: this.position.x + r, y: this.position.y + this.height - r },
                    radius: r,
                    startAngle: 0,
                    endAngle: Math.PI,
                    clockwise: false
                });
            }
            
            return {
                type: 'obround',
                position: { ...this.position },
                width: this.width,
                height: this.height,
                curves: curves
            };
        }
        
        toPolygon(segmentsPerArc = null, curveIds = null) {
            // Handle circular case
            if (this.isCircular) {
                const center = {
                    x: this.position.x + this.width / 2,
                    y: this.position.y + this.height / 2
                };
                const radius = this.width / 2;
                
                // Create a circle primitive and convert it to polygon
                const circlePrim = new CirclePrimitive(center, radius, this.properties);
                return circlePrim.toPolygon();
            }
            
            // Normal obround handling
            const r = Math.min(this.width, this.height) / 2;
            segmentsPerArc = segmentsPerArc || segmentConfig.obround || 16;
            
            // Use geometry utilities to create proper stroked path
            const isHorizontal = this.width > this.height;
            const strokeWidth = Math.min(this.width, this.height);
            const strokeLength = Math.abs(this.width - this.height);
            
            let start, end;
            if (isHorizontal) {
                const centerY = this.position.y + this.height / 2;
                start = { x: this.position.x + r, y: centerY };
                end = { x: this.position.x + this.width - r, y: centerY };
            } else {
                const centerX = this.position.x + this.width / 2;
                start = { x: centerX, y: this.position.y + r };
                end = { x: centerX, y: this.position.y + this.height - r };
            }
            
            // Use lineToPolygon for proper end-cap metadata
            const points = GeometryUtils.lineToPolygon(start, end, strokeWidth);
            
            const pathPrimitive = new PathPrimitive(points, {
                ...this.properties,
                closed: true,
                originalObround: {
                    position: { ...this.position },
                    width: this.width,
                    height: this.height
                },
                curveIds: this.curveIds || [],
                originalPointCount: points.length,
                hasCompleteMetadata: true
            });
            
            return pathPrimitive;
        }
    }
    
    class ArcPrimitive extends RenderPrimitive {
        constructor(center, radius, startAngle, endAngle, clockwise, properties = {}) {
            super('arc', properties);
            this.center = center;
            this.radius = radius;
            this.startAngle = startAngle;
            this.endAngle = endAngle;
            this.clockwise = clockwise;
            
            // Arcs can be offset analytically
            this.geometricContext.isAnalytic = true;
            this.geometricContext.metadata = {
                center: { ...center },
                radius: radius,
                startAngle: startAngle,
                endAngle: endAngle,
                clockwise: clockwise
            };
            
            // Calculate start and end points
            this.startPoint = {
                x: center.x + radius * Math.cos(startAngle),
                y: center.y + radius * Math.sin(startAngle)
            };
            this.endPoint = {
                x: center.x + radius * Math.cos(endAngle),
                y: center.y + radius * Math.sin(endAngle)
            };
            
            // REGISTER THIS ARC AS A CURVE WITH DIRECTION
            this.curveId = this.registerAsGlobalCurve();
            if (this.curveId) {
                this.curveIds = [this.curveId];
            }
        }

        /**
         * Returns a new ArcPrimitive representing the same arc traversed in the opposite direction.
         * @returns {ArcPrimitive} A new, reversed ArcPrimitive.
         */
        reverse() {
            // To reverse an arc, we swap the start and end angles and flip the clockwise flag.
            // The properties are carried over.
            const reversedProperties = { ...this.properties };
            // We can add a property to track that this happened, for debugging.
            reversedProperties.isReversed = true;

            return new ArcPrimitive(
                this.center,
                this.radius,
                this.endAngle,      // Swap start and end
                this.startAngle,
                !this.clockwise,    // Flip direction
                reversedProperties
            );
        }
        
        registerAsGlobalCurve() {
            if (!window.globalCurveRegistry) {
                return null;
            }
            
            // FIXED: Store actual clockwise property
            const curveId = window.globalCurveRegistry.register({
                type: 'arc',
                center: { ...this.center },
                radius: this.radius,
                startAngle: this.startAngle,
                endAngle: this.endAngle,
                clockwise: this.clockwise,  // CRITICAL: Store actual direction
                primitiveId: this.id,
                source: 'primitive_arc'
            });
            
            return curveId;
        }
        
        calculateBounds() {
            let minX = Math.min(this.startPoint.x, this.endPoint.x);
            let minY = Math.min(this.startPoint.y, this.endPoint.y);
            let maxX = Math.max(this.startPoint.x, this.endPoint.x);
            let maxY = Math.max(this.startPoint.y, this.endPoint.y);
            
            // Check if arc crosses cardinal directions
            const crosses = this.getCardinalCrossings();
            let effectiveRadius = this.radius;
            
            if (this.properties.strokeWidth && this.properties.stroke) {
                effectiveRadius += this.properties.strokeWidth / 2;
            }
            
            if (crosses.right) maxX = Math.max(maxX, this.center.x + effectiveRadius);
            if (crosses.top) maxY = Math.max(maxY, this.center.y + effectiveRadius);
            if (crosses.left) minX = Math.min(minX, this.center.x - effectiveRadius);
            if (crosses.bottom) minY = Math.min(minY, this.center.y - effectiveRadius);
            
            this.bounds = { minX, minY, maxX, maxY };
        }
        
        getCardinalCrossings() {
            const normalize = angle => {
                while (angle < 0) angle += 2 * Math.PI;
                while (angle > 2 * Math.PI) angle -= 2 * Math.PI;
                return angle;
            };
            
            const start = normalize(this.startAngle);
            const end = normalize(this.endAngle);
            
            const cardinals = {
                right: 0,
                top: Math.PI / 2,
                left: Math.PI,
                bottom: 3 * Math.PI / 2
            };
            
            const crosses = {
                right: false,
                top: false,
                left: false,
                bottom: false
            };
            
            for (const [dir, angle] of Object.entries(cardinals)) {
                if (this.clockwise) {
                    if (start > end) {
                        crosses[dir] = angle >= start || angle <= end;
                    } else {
                        crosses[dir] = angle >= start && angle <= end;
                    }
                } else {
                    if (start < end) {
                        crosses[dir] = angle >= start && angle <= end;
                    } else {
                        crosses[dir] = angle <= start || angle >= end;
                    }
                }
            }
            
            return crosses;
        }
        
        getOffsetGeometry(offsetDistance) {
            return new ArcPrimitive(
                this.center,
                Math.max(0, this.radius + offsetDistance),
                this.startAngle,
                this.endAngle,
                this.clockwise,
                { ...this.properties }
            );
        }
        
        // Generate curve metadata for arc
        generateCurveMetadata() {
            return {
                type: 'arc',
                center: { ...this.center },
                radius: this.radius,
                startAngle: this.startAngle,
                endAngle: this.endAngle,
                clockwise: this.clockwise,
                startPoint: { ...this.startPoint },
                endPoint: { ...this.endPoint }
            };
        }
        
        toPolygon(minSegments = null, maxSegments = null, curveIds = null) {
            minSegments = minSegments || segmentConfig.minArc || 8;
            maxSegments = maxSegments || segmentConfig.maxArc || 64;
            
            let angleSpan = this.endAngle - this.startAngle;
            if (this.clockwise) {
                if (angleSpan > 0) angleSpan -= 2 * Math.PI;
            } else {
                if (angleSpan < 0) angleSpan += 2 * Math.PI;
            }
            
            const arcLength = Math.abs(angleSpan) * this.radius;
            const targetLength = segmentConfig.targetLength || 0.1;
            const desiredSegments = Math.ceil(arcLength / targetLength);
            const segments = Math.max(minSegments, Math.min(maxSegments, desiredSegments));
            
            const points = [];
            // Use the arc's own registered curve ID
            const curveId = this.curveId || (curveIds && curveIds.length > 0 ? curveIds[0] : undefined);
            
            // Generate points with full metadata
            for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                const angle = this.startAngle + angleSpan * t;
                const point = {
                    x: this.center.x + this.radius * Math.cos(angle),
                    y: this.center.y + this.radius * Math.sin(angle)
                };
                
                if (curveId !== undefined) {
                    point.curveId = curveId;
                    point.segmentIndex = i;
                    point.totalSegments = segments + 1;
                    point.t = t;
                    point.angle = angle;
                }
                
                points.push(point);
            }
            
            const pathPrimitive = new PathPrimitive(points, {
                ...this.properties,
                closed: false,
                arcSegments: [{
                    startIndex: 0,
                    endIndex: points.length - 1,
                    center: this.center,
                    radius: this.radius,
                    startAngle: this.startAngle,
                    endAngle: this.endAngle,
                    clockwise: this.clockwise,
                    curveId: curveId
                }],
                curveIds: [curveId].filter(id => id !== undefined),
                originalPointCount: segments + 1,
                hasCompleteMetadata: true
            });
            
            return pathPrimitive;
        }
    }
    
    // Factory with config-based defaults
    class PrimitiveFactory {
        static createCircle(center, radius, properties = {}) {
            return new CirclePrimitive(center, radius, properties);
        }
        
        static createArc(center, radius, startAngle, endAngle, clockwise, properties = {}) {
            return new ArcPrimitive(center, radius, startAngle, endAngle, clockwise, properties);
        }
        
        static createStroke(start, end, width, properties = {}) {
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            
            if (length < geomConfig.coordinatePrecision || 0.001) {
                // Zero-length stroke becomes a circle
                return new CirclePrimitive(start, width / 2, {
                    ...properties,
                    isStroke: true,
                    originalWidth: width
                });
            }
            
            // For strokes, use GeometryUtils to create proper polygon with end-caps
            const points = GeometryUtils.lineToPolygon(start, end, width);
            
            return new PathPrimitive(points, {
                ...properties,
                isStroke: true,
                originalStroke: {
                    start: { ...start },
                    end: { ...end },
                    width: width
                },
                closed: true,
                hasCompleteMetadata: true
            });
        }
        
        static createPolygon(center, diameter, sides, rotation = 0, properties = {}) {
            const points = [];
            const radius = diameter / 2;
            
            for (let i = 0; i <= sides; i++) {
                const angle = (i / sides) * 2 * Math.PI + rotation;
                points.push({
                    x: center.x + radius * Math.cos(angle),
                    y: center.y + radius * Math.sin(angle)
                });
            }
            
            return new PathPrimitive(points, { 
                ...properties, 
                closed: true,
                isPolygon: true,
                originalPolygon: {
                    center: { ...center },
                    diameter: diameter,
                    sides: sides,
                    rotation: rotation
                }
            });
        }
    }
    
    // Geometry optimization utilities using config
    class GeometryOptimizer {
        static getOptimalSegments(radius, minSegments = null, maxSegments = null, targetSegmentLength = null) {
            // Use config values if not specified
            minSegments = minSegments || segmentConfig.minCircle || 8;
            maxSegments = maxSegments || segmentConfig.maxCircle || 128;
            targetSegmentLength = targetSegmentLength || segmentConfig.targetLength || 0.1;
            
            const circumference = 2 * Math.PI * radius;
            const desiredSegments = Math.ceil(circumference / targetSegmentLength);
            return Math.max(minSegments, Math.min(maxSegments, desiredSegments));
        }
        
        static shouldPreserveAnalytic(primitive, offsetDistance) {
            if (!geomConfig.preserveArcs) return false;
            
            // Keep circles and arcs analytic if they remain valid after offset
            if (primitive.type === 'circle') {
                return (primitive.radius + offsetDistance) > 0;
            }
            if (primitive.type === 'arc') {
                return (primitive.radius + offsetDistance) > 0;
            }
            return false;
        }
        
        static toOptimalPolygon(primitive) {
            if (primitive.type === 'circle') {
                const segments = this.getOptimalSegments(primitive.radius);
                return primitive.toPolygon(
                    Math.min(segmentConfig.minCircle || 16, segments), 
                    segments
                );
            }
            if (primitive.type === 'arc') {
                const arcLength = Math.abs(primitive.endAngle - primitive.startAngle) * primitive.radius;
                const targetLength = segmentConfig.targetLength || 0.1;
                const segments = Math.ceil(arcLength / targetLength);
                return primitive.toPolygon(
                    Math.min(segmentConfig.minArc || 8, segments), 
                    segments
                );
            }
            if (primitive.type === 'rectangle') {
                return primitive.toPolygon();
            }
            if (primitive.type === 'obround') {
                const r = Math.min(primitive.width, primitive.height) / 2;
                const segments = this.getOptimalSegments(r, 8, 32);
                return primitive.toPolygon(segments);
            }
            return primitive;
        }
    }
    
    // Export
    window.RenderPrimitive = RenderPrimitive;
    window.PathPrimitive = PathPrimitive;
    window.CirclePrimitive = CirclePrimitive;
    window.RectanglePrimitive = RectanglePrimitive;
    window.ObroundPrimitive = ObroundPrimitive;
    window.ArcPrimitive = ArcPrimitive;
    window.PrimitiveFactory = PrimitiveFactory;
    window.GeometryOptimizer = GeometryOptimizer;
    
})();