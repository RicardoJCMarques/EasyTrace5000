// geometry/geometry-offsetter.js
// FIXED: Cutout offsetting works for both positive and negative distance

class GeometryOffsetter {
    constructor(options = {}) {
        this.precision = options.precision || 0.001;
        this.debug = options.debug || false;
        this.initialized = true;
        this.geometryProcessor = null;
    }
    
    setGeometryProcessor(processor) {
        this.geometryProcessor = processor;
    }

    isInternalOffset(distance) {
        return distance > 0;
    }
    
    async offsetPrimitive(primitive, distance, options = {}) {
        if (!primitive || !primitive.type) return null;
        if (distance === 0) return primitive;
        
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
                    console.warn(`[Offsetter] Unknown type: ${primitive.type}`);
                }
                return null;
        }
    }
    
    offsetCircle(circle, distance) {
        const isInternal = distance > 0;
        const newRadius = isInternal ? 
            circle.radius - distance : 
            circle.radius + Math.abs(distance);
        
        if (newRadius <= this.precision) {
            if (this.debug) {
                console.log(`[Offsetter] Circle collapsed`);
            }
            return null;
        }
        
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
            return new CirclePrimitive(circle.center, newRadius, {
                ...circle.properties,
                isOffset: true,
                offsetDistance: distance,
                originalCurveId: offsetCurveId
            });
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
    
    offsetPath(path, distance) {
        if (!path.points || path.points.length < 2) {
            if (this.debug) {
                console.log('[Offsetter] Insufficient points');
            }
            return null;
        }
        
        const isStroke = path.properties && 
                        (path.properties.stroke || path.properties.isTrace) &&
                        path.properties.strokeWidth !== undefined;
        
        if (isStroke) {
            const isInternal = distance > 0;
            const newStrokeWidth = isInternal ?
                path.properties.strokeWidth - (2 * distance) :
                path.properties.strokeWidth + (2 * Math.abs(distance));
            
            if (newStrokeWidth <= this.precision) return null;
            
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
        
        // Closed paths (regions and cutouts)
        if (path.closed && path.properties?.fill !== false) {
            const isCutout = path.properties?.isCutout === true;
            const strokeWidth = Math.abs(distance * 2);
            const segmentPrimitives = [];
            
            // FIXED: For non-cutout regions with external offset, include original fill
            if (!isCutout && distance < 0) {
                segmentPrimitives.push(typeof PathPrimitive !== 'undefined' ?
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
                    });
            }
            
            // Generate offset perimeter segments
            for (let i = 0; i < path.points.length; i++) {
                const p1 = path.points[i];
                const p2 = path.points[(i + 1) % path.points.length];
                
                const segmentPolygon = GeometryUtils.lineToPolygon(p1, p2, strokeWidth);
                
                segmentPrimitives.push(typeof PathPrimitive !== 'undefined' ?
                    new PathPrimitive(segmentPolygon, {
                        ...path.properties,
                        originalType: isCutout ? 'cutout_segment' : 'region_segment',
                        closed: true,
                        fill: true,
                        stroke: false,
                        isOffset: true,
                        offsetDistance: distance,
                        polygonized: true,
                        segmentIndex: i,
                        isCutout: isCutout
                    }) : {
                        type: 'path',
                        points: segmentPolygon,
                        closed: true,
                        properties: {
                            ...path.properties,
                            originalType: isCutout ? 'cutout_segment' : 'region_segment',
                            fill: true,
                            stroke: false,
                            isOffset: true,
                            offsetDistance: distance,
                            polygonized: true,
                            segmentIndex: i,
                            isCutout: isCutout
                        }
                    });
            }
            
            return segmentPrimitives;
        }
        
        if (this.debug) {
            console.log('[Offsetter] Cannot offset path');
        }
        return null;
    }
    
    offsetRectangle(rectangle, distance) {
        const { x, y } = rectangle.position;
        const w = rectangle.width || 0;
        const h = rectangle.height || 0;
        
        const segments = [
            [{ x, y }, { x: x + w, y }],
            [{ x: x + w, y }, { x: x + w, y: y + h }],
            [{ x: x + w, y: y + h }, { x, y: y + h }],
            [{ x, y: y + h }, { x, y }]
        ];
        
        const strokeWidth = Math.abs(distance * 2);
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
        const { x, y } = obround.position;
        const w = obround.width || 0;
        const h = obround.height || 0;
        const r = Math.min(w, h) / 2;
        
        const points = [];
        const segments = 8;
        
        if (w > h) {
            const c1x = x + r;
            const c2x = x + w - r;
            const cy = y + r;
            
            for (let i = 0; i <= segments; i++) {
                const angle = Math.PI / 2 + (i / segments) * Math.PI;
                points.push({ 
                    x: c1x + r * Math.cos(angle), 
                    y: cy + r * Math.sin(angle) 
                });
            }
            
            for (let i = 0; i <= segments; i++) {
                const angle = -Math.PI / 2 + (i / segments) * Math.PI;
                points.push({ 
                    x: c2x + r * Math.cos(angle), 
                    y: cy + r * Math.sin(angle) 
                });
            }
        } else {
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
}

window.GeometryOffsetter = GeometryOffsetter;