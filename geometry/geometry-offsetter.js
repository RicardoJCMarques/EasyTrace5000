// geometry/geometry-offsetter.js

class GeometryOffsetter {
    constructor(options = {}) {
        this.offsetEngine = new OffsetGeometry(options);
        this.precision = options.precision || 0.001;
        this.debug = options.debug || false;
        this.initialized = true;
    }
    
    async offsetPrimitive(primitive, distance, options = {}) {
        if (this.debug) {
            console.log(`[Offsetter] Offsetting ${primitive.type} by ${distance}mm`);
        }
        
        if (distance === 0) return primitive;
        
        // Validate input
        if (!primitive || !primitive.type) {
            throw new Error('Invalid primitive: missing type');
        }
        
        try {
            if (primitive.type === 'circle') {
                return this.offsetCircle(primitive, distance);
            } else if (primitive.type === 'path') {
                if (this.debug) {
                    console.log(`[Offsetter] Path has ${primitive.points?.length || 0} points, ${primitive.arcSegments?.length || 0} arc segments`);
                }
                if (!primitive.points || primitive.points.length < 2) {
                    console.warn(`[Offsetter] Path primitive has insufficient points: ${primitive.points?.length || 0}`);
                    return null;
                }
                return this.offsetEngine.offsetPath(primitive, distance, options);
            } else if (primitive.type === 'arc') {
                return this.offsetArc(primitive, distance);
            } else if (primitive.type === 'rectangle') {
                return this.offsetRectangle(primitive, distance, options);
            } else if (primitive.type === 'obround') {
                return this.offsetObround(primitive, distance, options);
            }
            
            console.warn(`[Offsetter] Unknown primitive type: ${primitive.type}`);
            return null;
            
        } catch (error) {
            console.error(`[Offsetter] Failed to offset ${primitive.type} by ${distance}mm:`, error);
            return null;
        }
    }
    
    // FIXED: Return CirclePrimitive instance instead of plain object
    offsetCircle(circle, distance) {
        const newRadius = circle.radius - distance;
        
        if (newRadius <= this.precision) {
            if (this.debug) {
                console.log(`[Offsetter] Circle collapsed: ${circle.radius}mm -> ${newRadius}mm`);
            }
            return null;
        }
        
        if (this.debug) {
            console.log(`[Offsetter] Circle offset: ${circle.radius}mm -> ${newRadius}mm`);
        }
        
        // CRITICAL FIX: Use CirclePrimitive constructor if available
        if (typeof CirclePrimitive !== 'undefined') {
            return new CirclePrimitive(
                circle.center,
                newRadius,
                {
                    ...circle.properties,
                    isOffset: true,
                    offsetDistance: distance
                }
            );
        }
        
        // Fallback with getBounds method
        if (this.debug) {
            console.warn('[Offsetter] CirclePrimitive not available, using fallback');
        }
        
        return {
            type: 'circle',
            center: { ...circle.center },
            radius: newRadius,
            properties: {
                ...circle.properties,
                isOffset: true,
                offsetDistance: distance
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
    
    // FIXED: Return ArcPrimitive instance instead of plain object
    offsetArc(arc, distance) {
        const newRadius = arc.radius - distance;
        
        if (newRadius <= this.precision) {
            // Collapsed to line
            if (this.debug) {
                console.log(`[Offsetter] Arc collapsed to line: ${arc.radius}mm -> ${newRadius}mm`);
            }
            
            // Return as PathPrimitive
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
        
        if (this.debug) {
            console.log(`[Offsetter] Arc offset: ${arc.radius}mm -> ${newRadius}mm`);
        }
        
        // CRITICAL FIX: Use ArcPrimitive constructor if available
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
                    offsetDistance: distance
                }
            );
        }
        
        // Fallback with getBounds
        if (this.debug) {
            console.warn('[Offsetter] ArcPrimitive not available, using fallback');
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
                offsetDistance: distance
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
    
    // NEW: Rectangle offsetting - convert to path and offset
    offsetRectangle(rectangle, distance, options = {}) {
        if (this.debug) {
            console.log(`[Offsetter] Converting rectangle to path for offsetting`);
        }
        
        // Convert rectangle to closed path
        const { x, y } = rectangle.position;
        const w = rectangle.width || 0;
        const h = rectangle.height || 0;
        
        const points = [
            { x, y },
            { x: x + w, y },
            { x: x + w, y: y + h },
            { x, y: y + h }
        ];
        
        // Create temporary path primitive
        let pathPrimitive;
        if (typeof PathPrimitive !== 'undefined') {
            pathPrimitive = new PathPrimitive(points, {
                ...rectangle.properties,
                originalType: 'rectangle',
                closed: true
            });
        } else {
            pathPrimitive = {
                type: 'path',
                points: points,
                closed: true,
                properties: {
                    ...rectangle.properties,
                    originalType: 'rectangle'
                }
            };
        }
        
        // Offset the path
        const offsetPath = this.offsetEngine.offsetPath(pathPrimitive, distance, options);
        
        if (offsetPath && this.debug) {
            console.log(`[Offsetter] Rectangle converted and offset successfully`);
        }
        
        return offsetPath;
    }
    
    // NEW: Obround offsetting - convert to path and offset
    offsetObround(obround, distance, options = {}) {
        if (this.debug) {
            console.log(`[Offsetter] Converting obround to path for offsetting`);
        }
        
        // Convert obround to path with rounded ends
        const { x, y } = obround.position;
        const w = obround.width || 0;
        const h = obround.height || 0;
        const r = Math.min(w, h) / 2;
        
        const points = [];
        const segments = 16; // Quarter circle segments
        
        if (w > h) {
            // Horizontal obround
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
            
            // Bottom semicircle
            for (let i = 0; i <= segments; i++) {
                const angle = Math.PI + (i / segments) * Math.PI;
                points.push({ 
                    x: cx + r * Math.cos(angle), 
                    y: c1y + r * Math.sin(angle) 
                });
            }
            
            // Top semicircle
            for (let i = 0; i <= segments; i++) {
                const angle = (i / segments) * Math.PI;
                points.push({ 
                    x: cx + r * Math.cos(angle), 
                    y: c2y + r * Math.sin(angle) 
                });
            }
        }
        
        // Create path primitive
        let pathPrimitive;
        if (typeof PathPrimitive !== 'undefined') {
            pathPrimitive = new PathPrimitive(points, {
                ...obround.properties,
                originalType: 'obround',
                closed: true
            });
        } else {
            pathPrimitive = {
                type: 'path',
                points: points,
                closed: true,
                properties: {
                    ...obround.properties,
                    originalType: 'obround'
                }
            };
        }
        
        // Offset the path
        const offsetPath = this.offsetEngine.offsetPath(pathPrimitive, distance, options);
        
        if (offsetPath && this.debug) {
            console.log(`[Offsetter] Obround converted and offset successfully`);
        }
        
        return offsetPath;
    }
    
    // Calculate offset parameters for a tool
    calculateOffsetParameters(tool, passes = 1, stepOverPercent = 50) {
        if (!tool || !tool.geometry?.diameter) {
            throw new Error('Invalid tool for offset calculation');
        }
        
        const diameter = tool.geometry.diameter;
        const stepOver = stepOverPercent / 100;
        const stepDistance = diameter * (1 - stepOver);
        const offsets = [];
        
        for (let i = 0; i < passes; i++) {
            // Negative for external offset (tool outside geometry)
            offsets.push(-(diameter / 2 + i * stepDistance));
        }
        
        return {
            diameter,
            stepOver,
            stepDistance,
            offsets
        };
    }
}