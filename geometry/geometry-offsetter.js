// geometry/geometry-offsetter.js
// REFACTORED: Simplified offsetter - individual primitive offsetting ONLY
// All unions, intersections, joins handled by Clipper2

class GeometryOffsetter {
    constructor(options = {}) {
        this.precision = options.precision || 0.001;
        this.debug = options.debug || false;
        this.initialized = true;
        
        // Reference to geometry processor for union operations (set externally)
        this.geometryProcessor = null;
    }
    
    setGeometryProcessor(processor) {
        this.geometryProcessor = processor;
    }
    
    /**
     * Offset a single primitive by distance
     * Returns single primitive or null if collapsed
     */
    async offsetPrimitive(primitive, distance, options = {}) {
        if (!primitive || !primitive.type) {
            return null;
        }
        
        if (distance === 0) {
            return primitive;
        }
        
        switch (primitive.type) {
            case 'circle':
                return this.offsetCircle(primitive, distance);
            case 'rectangle':
                return this.offsetRectangle(primitive, distance);
            case 'path':
                return this.offsetPath(primitive, distance);
            case 'arc':
                return this.offsetArc(primitive, distance);
            case 'obround':
                return this.offsetObround(primitive, distance);
            default:
                if (this.debug) {
                    console.warn(`[Offsetter] Unknown primitive type: ${primitive.type}`);
                }
                return null;
        }
    }
    
    offsetCircle(circle, distance) {
        const newRadius = circle.radius - distance;
        
        if (newRadius <= this.precision) {
            if (this.debug) {
                console.log(`[Offsetter] Circle collapsed: ${circle.radius}mm → ${newRadius}mm`);
            }
            return null;
        }
        
        // Register offset-derived curve
        const offsetCurveId = window.globalCurveRegistry?.register({
            type: 'circle',
            center: { ...circle.center },
            radius: newRadius,
            clockwise: false,
            isOffsetDerived: true,
            sourceCurveId: circle.properties?.originalCurveId || null,
            offsetDistance: distance,
            source: 'circle_offset'
        });
        
        if (typeof CirclePrimitive !== 'undefined') {
            return new CirclePrimitive(
                circle.center,
                newRadius,
                {
                    ...circle.properties,
                    isOffset: true,
                    offsetDistance: distance,
                    originalCurveId: offsetCurveId
                }
            );
        }
        
        return {
            type: 'circle',
            center: { ...circle.center },
            radius: newRadius,
            properties: {
                ...circle.properties,
                isOffset: true,
                offsetDistance: distance,
                originalCurveId: offsetCurveId
            },
            getBounds: function() {
                return {
                    minX: this.center.x - this.radius,
                    minY: this.center.y - this.radius,
                    maxX: this.center.x + this.radius,
                    maxY: this.center.y + this.radius
                };
            }
        };
    }
    
    offsetArc(arc, distance) {
        const newRadius = arc.radius - distance;
        
        if (newRadius <= this.precision) {
            // Collapsed to line
            if (typeof PathPrimitive !== 'undefined') {
                return new PathPrimitive([arc.startPoint, arc.endPoint], {
                    ...arc.properties,
                    isOffset: true,
                    wasArc: true,
                    closed: false
                });
            }
            
            return {
                type: 'path',
                points: [arc.startPoint, arc.endPoint],
                closed: false,
                properties: {
                    ...arc.properties,
                    isOffset: true,
                    wasArc: true
                },
                getBounds: function() {
                    const xs = this.points.map(p => p.x);
                    const ys = this.points.map(p => p.y);
                    return {
                        minX: Math.min(...xs),
                        minY: Math.min(...ys),
                        maxX: Math.max(...xs),
                        maxY: Math.max(...ys)
                    };
                }
            };
        }
        
        // Register offset arc
        const offsetCurveId = window.globalCurveRegistry?.register({
            type: 'arc',
            center: { ...arc.center },
            radius: newRadius,
            startAngle: arc.startAngle,
            endAngle: arc.endAngle,
            clockwise: arc.clockwise,
            isOffsetDerived: true,
            sourceCurveId: arc.properties?.originalCurveId || null,
            offsetDistance: distance,
            source: 'arc_offset'
        });
        
        if (typeof ArcPrimitive !== 'undefined') {
            return new ArcPrimitive(
                arc.center,
                newRadius,
                arc.startAngle,
                arc.endAngle,
                arc.clockwise,
                {
                    ...arc.properties,
                    isOffset: true,
                    offsetDistance: distance,
                    originalCurveId: offsetCurveId
                }
            );
        }
        
        const startPoint = {
            x: arc.center.x + newRadius * Math.cos(arc.startAngle),
            y: arc.center.y + newRadius * Math.sin(arc.startAngle)
        };
        
        const endPoint = {
            x: arc.center.x + newRadius * Math.cos(arc.endAngle),
            y: arc.center.y + newRadius * Math.sin(arc.endAngle)
        };
        
        return {
            type: 'arc',
            center: arc.center,
            radius: newRadius,
            startAngle: arc.startAngle,
            endAngle: arc.endAngle,
            startPoint: startPoint,
            endPoint: endPoint,
            clockwise: arc.clockwise,
            properties: {
                ...arc.properties,
                isOffset: true,
                offsetDistance: distance,
                originalCurveId: offsetCurveId
            },
            getBounds: function() {
                const points = [this.startPoint, this.endPoint, this.center];
                const xs = points.map(p => p.x);
                const ys = points.map(p => p.y);
                const padding = this.radius;
                return {
                    minX: Math.min(...xs) - padding,
                    minY: Math.min(...ys) - padding,
                    maxX: Math.max(...xs) + padding,
                    maxY: Math.max(...ys) + padding
                };
            }
        };
    }
    
    offsetRectangle(rectangle, distance) {
        const { x, y } = rectangle.position;
        const w = rectangle.width || 0;
        const h = rectangle.height || 0;
        
        // Split rectangle into 4 individual line segments
        const segments = [
            [{ x, y }, { x: x + w, y }],                    // top
            [{ x: x + w, y }, { x: x + w, y: y + h }],      // right
            [{ x: x + w, y: y + h }, { x, y: y + h }],      // bottom
            [{ x, y: y + h }, { x, y }]                     // left
        ];
        
        const strokeWidth = Math.abs(distance * 2);
        
        // Convert each segment separately, then combine
        const allPoints = [];
        segments.forEach(segment => {
            const segmentPolygon = GeometryUtils.lineToPolygon(
                segment[0], segment[1], strokeWidth
            );
            allPoints.push(...segmentPolygon);
        });
        
        if (typeof PathPrimitive !== 'undefined') {
            return new PathPrimitive(allPoints, {
                ...rectangle.properties,
                originalType: 'rectangle',
                closed: true,
                fill: true,
                stroke: false,
                isOffset: true,
                offsetDistance: distance,
                polygonized: true
            });
        }
        
        return {
            type: 'path',
            points: allPoints,
            closed: true,
            properties: {
                ...rectangle.properties,
                originalType: 'rectangle',
                fill: true,
                stroke: false,
                isOffset: true,
                offsetDistance: distance,
                polygonized: true
            }
        };
    }
    
    offsetObround(obround, distance) {
        // Treat obround outline as stroked path for proper corner handling
        const { x, y } = obround.position;
        const w = obround.width || 0;
        const h = obround.height || 0;
        const r = Math.min(w, h) / 2;
        
        const points = [];
        const segments = 8; // Reduced for outline only
        
        if (w > h) {
            // Horizontal obround - simplified outline
            const c1x = x + r;
            const c2x = x + w - r;
            const cy = y + r;
            
            // Left semicircle
            for (let i = 0; i <= segments; i++) {
                const angle = Math.PI / 2 + (i / segments) * Math.PI;
                points.push({ 
                    x: c1x + r * Math.cos(angle), 
                    y: cy + r * Math.sin(angle) 
                });
            }
            
            // Right semicircle
            for (let i = 0; i <= segments; i++) {
                const angle = -Math.PI / 2 + (i / segments) * Math.PI;
                points.push({ 
                    x: c2x + r * Math.cos(angle), 
                    y: cy + r * Math.sin(angle) 
                });
            }
        } else {
            // Vertical obround
            const cx = x + r;
            const c1y = y + r;
            const c2y = y + h - r;
            
            for (let i = 0; i <= segments; i++) {
                const angle = Math.PI + (i / segments) * Math.PI;
                points.push({ 
                    x: cx + r * Math.cos(angle), 
                    y: c1y + r * Math.sin(angle) 
                });
            }
            
            for (let i = 0; i <= segments; i++) {
                const angle = (i / segments) * Math.PI;
                points.push({ 
                    x: cx + r * Math.cos(angle), 
                    y: c2y + r * Math.sin(angle) 
                });
            }
        }
        
        // Treat as stroked outline
        const strokeWidth = Math.abs(distance * 2);
        
        if (typeof PathPrimitive !== 'undefined') {
            return new PathPrimitive(points, {
                ...obround.properties,
                originalType: 'obround',
                closed: true,
                stroke: true,
                strokeWidth: strokeWidth,
                isTrace: true,
                isOffset: true,
                offsetDistance: distance
            });
        }
        
        return {
            type: 'path',
            points: points,
            closed: true,
            properties: {
                ...obround.properties,
                originalType: 'obround',
                stroke: true,
                strokeWidth: strokeWidth,
                isTrace: true,
                isOffset: true,
                offsetDistance: distance
            }
        };
    }
    
    offsetPath(path, distance) {
        if (!path.points || path.points.length < 2) {
            if (this.debug) {
                console.log('[Offsetter] Path has insufficient points');
            }
            return null;
        }
        
        const isStroke = path.properties && 
                        (path.properties.stroke || path.properties.isTrace) &&
                        path.properties.strokeWidth !== undefined;
        
        if (isStroke) {
            const newStrokeWidth = path.properties.strokeWidth - (2 * distance);
            
            if (newStrokeWidth <= this.precision) {
                if (this.debug) {
                    console.log(`[Offsetter] Stroke collapsed: ${path.properties.strokeWidth}mm → ${newStrokeWidth}mm`);
                }
                return null;
            }
            
            return {
                type: 'path',
                points: [...path.points],
                closed: path.closed || false,
                properties: {
                    ...path.properties,
                    strokeWidth: newStrokeWidth,
                    isOffset: true,
                    offsetDistance: distance
                }
            };
        }
        
        // FIXED: Handle closed filled paths (regions) - return array of segment primitives
        if (path.closed && path.properties?.fill !== false) {
            const strokeWidth = Math.abs(distance * 2);
            const segmentPrimitives = [];
            
            // CRITICAL: Include original filled region
            const originalRegion = typeof PathPrimitive !== 'undefined' ?
                new PathPrimitive([...path.points], {
                    ...path.properties,
                    closed: true,
                    fill: true,
                    isOffset: true,
                    offsetDistance: distance,
                    isOriginalFill: true
                }) : {
                    type: 'path',
                    points: [...path.points],
                    closed: true,
                    properties: {
                        ...path.properties,
                        fill: true,
                        isOffset: true,
                        offsetDistance: distance,
                        isOriginalFill: true
                    }
                };
            
            segmentPrimitives.push(originalRegion);
            
            // Add offset perimeter segments
            for (let i = 0; i < path.points.length; i++) {
                const p1 = path.points[i];
                const p2 = path.points[(i + 1) % path.points.length];
                
                const segmentPolygon = GeometryUtils.lineToPolygon(p1, p2, strokeWidth);
                
                segmentPrimitives.push(typeof PathPrimitive !== 'undefined' ?
                    new PathPrimitive(segmentPolygon, {
                        ...path.properties,
                        originalType: 'region_segment',
                        closed: true,
                        fill: true,
                        stroke: false,
                        isOffset: true,
                        offsetDistance: distance,
                        polygonized: true,
                        segmentIndex: i
                    }) : {
                        type: 'path',
                        points: segmentPolygon,
                        closed: true,
                        properties: {
                            ...path.properties,
                            originalType: 'region_segment',
                            fill: true,
                            stroke: false,
                            isOffset: true,
                            offsetDistance: distance,
                            polygonized: true,
                            segmentIndex: i
                        }
                    });
            }
            
            return segmentPrimitives;
        }
        
        if (this.debug) {
            console.log('[Offsetter] Cannot offset complex path');
        }
        return null;
    }
}

// Export
window.GeometryOffsetter = GeometryOffsetter;