// geometry/geometry-offsetter.js
// High-level offsetting interface with multi-pass union support

class GeometryOffsetter {
    constructor(options = {}) {
        this.offsetEngine = new OffsetGeometry(options);
        this.precision = options.precision || 0.001;
        this.debug = options.debug || false;
        this.initialized = true;
        
        // Reference to geometry processor for union operations
        this.geometryProcessor = options.geometryProcessor || null;
    }
    
    // Set geometry processor reference for union operations
    setGeometryProcessor(processor) {
        this.geometryProcessor = processor;
    }
    
    async offsetPrimitive(primitive, distance, options = {}) {
        if (this.debug) {
            console.log(`[Offsetter] Offsetting ${primitive.type} by ${distance}mm`);
        }
        
        if (distance === 0) return primitive;
        
        if (!primitive || !primitive.type) {
            throw new Error('Invalid primitive: missing type');
        }
        
        try {
            if (primitive.type === 'circle') {
                return this.offsetCircle(primitive, distance);
            } else if (primitive.type === 'path') {
                if (!primitive.points || primitive.points.length < 2) {
                    console.warn(`[Offsetter] Path has insufficient points: ${primitive.points?.length || 0}`);
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
            console.error(`[Offsetter] Failed to offset ${primitive.type}:`, error);
            return null;
        }
    }
    
    offsetCircle(circle, distance) {
        const newRadius = circle.radius - distance;
        
        if (newRadius <= this.precision) {
            if (this.debug) {
                console.log(`[Offsetter] Circle collapsed: ${circle.radius}mm -> ${newRadius}mm`);
            }
            return null;
        }
        
        // Register offset-derived curve
        const offsetCurveId = window.globalCurveRegistry?.register({
            type: 'circle',
            center: { ...circle.center },
            radius: newRadius,
            clockwise: false, // Circles are CCW
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
        
        // Register offset-derived arc
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
    
    offsetRectangle(rectangle, distance, options = {}) {
        // Convert to path and offset
        const { x, y } = rectangle.position;
        const w = rectangle.width || 0;
        const h = rectangle.height || 0;
        
        const points = [
            { x, y },
            { x: x + w, y },
            { x: x + w, y: y + h },
            { x, y: y + h }
        ];
        
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
        
        return this.offsetEngine.offsetPath(pathPrimitive, distance, options);
    }
    
    offsetObround(obround, distance, options = {}) {
        // Convert to path and offset
        const { x, y } = obround.position;
        const w = obround.width || 0;
        const h = obround.height || 0;
        const r = Math.min(w, h) / 2;
        
        const points = [];
        const segments = 16;
        
        if (w > h) {
            // Horizontal obround
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
        
        return this.offsetEngine.offsetPath(pathPrimitive, distance, options);
    }
    
    // NEW: Multi-pass offsetting with optional union
    async offsetMultiPass(primitives, offsets, options = {}) {
        if (this.debug) {
            console.log(`[Offsetter] Multi-pass offset: ${offsets.length} passes`);
        }
        
        const passResults = [];
        
        // Generate each pass
        for (let i = 0; i < offsets.length; i++) {
            const distance = offsets[i];
            const passGeometry = [];
            
            for (const primitive of primitives) {
                const offset = await this.offsetPrimitive(primitive, distance, options);
                if (offset) {
                    if (Array.isArray(offset)) {
                        passGeometry.push(...offset);
                    } else {
                        passGeometry.push(offset);
                    }
                }
            }
            
            passResults.push({
                pass: i + 1,
                distance: distance,
                primitives: passGeometry
            });
        }
        
        // Optionally union all passes
        if (options.unionPasses && this.geometryProcessor) {
            if (this.debug) {
                console.log(`[Offsetter] Unioning ${passResults.length} passes`);
            }
            
            try {
                // Collect all primitives from all passes
                const allPrimitives = [];
                passResults.forEach(pass => {
                    allPrimitives.push(...pass.primitives);
                });
                
                // Perform union
                const united = await this.geometryProcessor.unionGeometry(allPrimitives);
                
                return [{
                    pass: 'merged',
                    distance: offsets[0], // Outermost
                    primitives: united,
                    sourcePassCount: offsets.length
                }];
            } catch (error) {
                console.error('[Offsetter] Union failed, returning individual passes:', error);
                return passResults;
            }
        }
        
        return passResults;
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

// Export
window.GeometryOffsetter = GeometryOffsetter;