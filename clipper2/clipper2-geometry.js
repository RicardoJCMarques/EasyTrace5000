/**
 * Clipper2 Geometry Module
 * Converts between coordinate arrays and Clipper2 objects
 * Version 5.2 - Improved SVG parsing
 */

class Clipper2Geometry {
    constructor(core) {
        this.core = core;
        this.defaults = null; // Will be set during initialization
    }

    /**
     * Initialize with defaults reference
     */
    initialize(defaults) {
        this.defaults = defaults;
    }

    /**
     * Convert any geometry definition to Clipper2 Path64
     */
    toClipper2Path(definition, options = {}) {
        // Handle direct coordinate arrays
        if (Array.isArray(definition)) {
            return this.coordinatesToPath64(definition);
        }
        
        // Handle geometry definitions
        switch (definition.type) {
            case 'polygon':
                return this.polygonToPath64(definition, options);
            case 'parametric':
                return this.parametricToPath64(definition, options);
            case 'strokes':
                return this.strokesToPath64(definition, options);
            case 'svg':
                return this.svgToPath64(definition, options);
            case 'pcb':
                return this.pcbToPath64(definition, options);
            default:
                throw new Error(`Unknown geometry type: ${definition.type}`);
        }
    }

    /**
     * Convert geometry definition to Clipper2 Paths64 (multiple paths)
     */
    toClipper2Paths(definition, options = {}) {
        const paths = new this.core.clipper2.Paths64();
        
        if (definition.type === 'strokes') {
            // Each stroke becomes a separate path
            definition.data.forEach(stroke => {
                const polygon = this.defaults.generators.strokeToPolygon(
                    stroke, 
                    definition.strokeWidth
                );
                
                // Validate before adding
                const validationResult = this.validatePolygon(polygon);
                if (!validationResult.isValid) {
                    console.warn(`[GEOMETRY] Invalid stroke polygon: ${validationResult.error}`);
                }
                
                paths.push_back(this.coordinatesToPath64(polygon));
            });
        } else if (definition.type === 'pcb') {
            // Convert traces
            if (definition.traces) {
                definition.traces.forEach(trace => {
                    const polygon = this.defaults.generators.lineToPolygon(
                        trace.from, 
                        trace.to, 
                        definition.traceWidth
                    );
                    
                    // Validate before adding
                    const validationResult = this.validatePolygon(polygon);
                    if (!validationResult.isValid) {
                        console.warn(`[GEOMETRY] Invalid trace polygon: ${validationResult.error}`);
                    }
                    
                    paths.push_back(this.coordinatesToPath64(polygon));
                });
            }
            // Convert pads
            if (definition.pads) {
                definition.pads.forEach(pad => {
                    const circle = this.defaults.generators.circle(
                        pad.center[0], 
                        pad.center[1], 
                        pad.radius,
                        this.defaults.config.polygonResolution
                    );
                    paths.push_back(this.coordinatesToPath64(circle));
                });
            }
        } else {
            // Single path
            paths.push_back(this.toClipper2Path(definition, options));
        }
        
        return this.core.trackObject(paths);
    }

    /**
     * Validate polygon geometry
     * Checks for: proper closure, sufficient vertices, no self-intersection (basic check)
     */
    validatePolygon(coords) {
        const result = {
            isValid: true,
            error: null,
            warnings: []
        };
        
        // Check minimum vertices
        if (coords.length < 3) {
            result.isValid = false;
            result.error = `Polygon has ${coords.length} vertices, minimum 3 required`;
            return result;
        }
        
        // Check for duplicate consecutive points
        for (let i = 0; i < coords.length; i++) {
            const curr = coords[i];
            const next = coords[(i + 1) % coords.length];
            
            const dx = (Array.isArray(curr) ? curr[0] : curr.x) - (Array.isArray(next) ? next[0] : next.x);
            const dy = (Array.isArray(curr) ? curr[1] : curr.y) - (Array.isArray(next) ? next[1] : next.y);
            
            if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
                result.warnings.push(`Duplicate vertices at index ${i} and ${(i + 1) % coords.length}`);
            }
        }
        
        // Check for self-intersections (simplified check - only adjacent edges)
        const hasBasicSelfIntersection = this.checkBasicSelfIntersection(coords);
        if (hasBasicSelfIntersection) {
            result.warnings.push('Polygon may have self-intersections');
        }
        
        // Calculate and check area
        const area = this.calculateAreaFromCoords(coords);
        if (Math.abs(area) < 0.001) {
            result.isValid = false;
            result.error = 'Polygon has zero or near-zero area';
            return result;
        }
        
        // Check winding order
        if (area < 0) {
            result.warnings.push('Polygon has clockwise winding (will be reversed for CCW)');
        }
        
        // Log validation details in debug mode
        if (this.core.config.debugMode && (result.warnings.length > 0 || !result.isValid)) {
            console.log('[VALIDATE] Polygon validation:', result);
        }
        
        return result;
    }

    /**
     * Check for basic self-intersections (adjacent edges shouldn't intersect except at endpoints)
     */
    checkBasicSelfIntersection(coords) {
        const n = coords.length;
        
        for (let i = 0; i < n; i++) {
            const a1 = coords[i];
            const a2 = coords[(i + 1) % n];
            
            // Check against non-adjacent edges
            for (let j = i + 2; j < n; j++) {
                if ((i === 0 && j === n - 1) || j === i) continue; // Skip adjacent edges
                
                const b1 = coords[j];
                const b2 = coords[(j + 1) % n];
                
                if (this.doSegmentsIntersect(a1, a2, b1, b2)) {
                    return true;
                }
            }
        }
        
        return false;
    }

    /**
     * Check if two line segments intersect
     */
    doSegmentsIntersect(p1, p2, p3, p4) {
        const x1 = Array.isArray(p1) ? p1[0] : p1.x;
        const y1 = Array.isArray(p1) ? p1[1] : p1.y;
        const x2 = Array.isArray(p2) ? p2[0] : p2.x;
        const y2 = Array.isArray(p2) ? p2[1] : p2.y;
        const x3 = Array.isArray(p3) ? p3[0] : p3.x;
        const y3 = Array.isArray(p3) ? p3[1] : p3.y;
        const x4 = Array.isArray(p4) ? p4[0] : p4.x;
        const y4 = Array.isArray(p4) ? p4[1] : p4.y;
        
        const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        
        if (Math.abs(denom) < 0.0001) return false; // Parallel lines
        
        const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
        const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
        
        return t > 0 && t < 1 && u > 0 && u < 1;
    }

    /**
     * Convert coordinate array to Path64
     */
    coordinatesToPath64(coords) {
        const path = new this.core.clipper2.Path64();
        const scale = this.defaults.config.scale;
        
        coords.forEach(point => {
            const x = Array.isArray(point) ? point[0] : point.x;
            const y = Array.isArray(point) ? point[1] : point.y;
            const z = Array.isArray(point) && point[2] !== undefined ? point[2] : 
                     (point.z !== undefined ? point.z : 0);
            
            path.push_back(new this.core.clipper2.Point64(
                BigInt(Math.round(x * scale)),
                BigInt(Math.round(y * scale)),
                BigInt(z)
            ));
        });
        
        return this.core.trackObject(this.ensureCounterClockwise(path));
    }

    /**
     * Convert Path64 to coordinate array
     */
    path64ToCoordinates(path) {
        const coords = [];
        const scale = this.defaults.config.scale;
        
        for (let i = 0; i < path.size(); i++) {
            const point = path.get(i);
            coords.push([
                Number(point.x) / scale,
                Number(point.y) / scale
            ]);
        }
        
        return coords;
    }

    /**
     * Convert Paths64 to array of coordinate arrays
     */
    paths64ToCoordinates(paths) {
        const result = [];
        
        for (let i = 0; i < paths.size(); i++) {
            const path = paths.get(i);
            result.push({
                coords: this.path64ToCoordinates(path),
                area: this.calculateArea(path),
                orientation: null // Will be calculated if needed
            });
        }
        
        // Determine orientation based on area
        result.forEach(item => {
            item.orientation = item.area > 0 ? 'outer' : 'hole';
        });
        
        return result;
    }

    /**
     * Convert polygon definition to Path64
     */
    polygonToPath64(definition, options = {}) {
        let coords = definition.data;
        
        // Handle relative positioning
        if (options.position) {
            coords = coords.map(point => [
                point[0] + options.position[0],
                point[1] + options.position[1]
            ]);
        }
        
        return this.coordinatesToPath64(coords);
    }

         /**
     * Convert parametric definition to Path64
     */
    parametricToPath64(definition, options = {}) {
        const pos = options.position || definition.center || definition.initialPos || [0, 0];
        let coords;
        
        switch (definition.shape) {
            case 'circle':
                coords = this.defaults.generators.circle(
                    pos[0], 
                    pos[1], 
                    definition.radius
                );
                break;
                
            case 'star':
                coords = this.defaults.generators.star(
                    pos[0], 
                    pos[1], 
                    definition.outerRadius,
                    definition.innerRadius,
                    definition.points
                );
                break;
                
            case 'random':
                coords = options.randomShape || 
                    this.defaults.generators.randomConvex(
                        pos[0], 
                        pos[1], 
                        definition.avgRadius,
                        definition.variance,
                        definition.points
                    );
                break;
                
            case 'flower':
                coords = this.defaults.generators.flower(
                    pos[0], 
                    pos[1], 
                    definition.baseRadius,
                    definition.noiseFrequency,
                    definition.noiseAmplitude,
                    definition.segments
                );
                break;
                
            default:
                throw new Error(`Unknown parametric shape: ${definition.shape}`);
        }
        
        return this.coordinatesToPath64(coords);
    }

    /**
     * Convert strokes definition to Path64
     */
    strokesToPath64(definition, options = {}) {
        // Combine all strokes into single path (for single path requirement)
        console.warn('[GEOMETRY] Converting multiple strokes to single path - may not produce expected result');
        
        // Instead, just convert the first stroke
        if (definition.data.length > 0) {
            const polygon = this.defaults.generators.strokeToPolygon(
                definition.data[0], 
                definition.strokeWidth
            );
            return this.coordinatesToPath64(polygon);
        }
        
        return this.coordinatesToPath64([]);
    }

    /**
     * Convert SVG path to Path64
     */
    svgToPath64(definition, options = {}) {
        const pos = options.position || definition.initialPos || [0, 0];
        const scale = definition.scale || 1;
        const coords = this.parseSVGPath(definition.path, scale, pos);
        return this.coordinatesToPath64(coords);
    }

    /**
     * Convert PCB definition to Path64
     */
    pcbToPath64(definition, options = {}) {
        // Return first trace or pad as single path
        if (definition.traces && definition.traces.length > 0) {
            const trace = definition.traces[0];
            const polygon = this.defaults.generators.lineToPolygon(
                trace.from, 
                trace.to, 
                definition.traceWidth
            );
            return this.coordinatesToPath64(polygon);
        }
        
        if (definition.pads && definition.pads.length > 0) {
            const pad = definition.pads[0];
            const circle = this.defaults.generators.circle(
                pad.center[0], 
                pad.center[1], 
                pad.radius,
                this.defaults.config.polygonResolution
            );
            return this.coordinatesToPath64(circle);
        }
        
        return this.coordinatesToPath64([]);
    }

    /**
     * Parse SVG path data to coordinates - IMPROVED
     */
    parseSVGPath(pathData, scale = 1.0, offset = [0, 0]) {
        const coords = [];
        const commands = pathData.match(/[mlhvcsqtaz][^mlhvcsqtaz]*/gi);
        
        let currentX = 0, currentY = 0;
        let startX = 0, startY = 0;
        let isFirstMove = true;
        let prevControlX = 0, prevControlY = 0; // For smooth curves
        
        commands?.forEach(cmd => {
            const type = cmd[0].toLowerCase();
            const numbers = cmd.slice(1).trim().split(/[\s,]+/)
                .map(parseFloat)
                .filter(n => !isNaN(n));
            const isRelative = cmd[0] === cmd[0].toLowerCase();
            
            switch(type) {
                case 'm': // Move to
                    if (isFirstMove && isRelative) {
                        // First 'm' is always treated as absolute
                        currentX = numbers[0];
                        currentY = numbers[1];
                        isFirstMove = false;
                    } else {
                        if (isRelative) {
                            currentX += numbers[0];
                            currentY += numbers[1];
                        } else {
                            currentX = numbers[0];
                            currentY = numbers[1];
                        }
                    }
                    startX = currentX;
                    startY = currentY;
                    
                    // First move doesn't create a point
                    // Handle subsequent coordinates as line-to
                    for (let i = 2; i < numbers.length; i += 2) {
                        if (isRelative) {
                            currentX += numbers[i];
                            currentY += numbers[i + 1];
                        } else {
                            currentX = numbers[i];
                            currentY = numbers[i + 1];
                        }
                        coords.push([
                            currentX * scale + offset[0],
                            currentY * scale + offset[1]
                        ]);
                    }
                    break;
                    
                case 'l': // Line to
                    for (let i = 0; i < numbers.length; i += 2) {
                        if (isRelative) {
                            currentX += numbers[i];
                            currentY += numbers[i + 1];
                        } else {
                            currentX = numbers[i];
                            currentY = numbers[i + 1];
                        }
                        coords.push([
                            currentX * scale + offset[0],
                            currentY * scale + offset[1]
                        ]);
                    }
                    break;
                    
                case 'h': // Horizontal line
                    for (let i = 0; i < numbers.length; i++) {
                        currentX = isRelative ? currentX + numbers[i] : numbers[i];
                        coords.push([
                            currentX * scale + offset[0],
                            currentY * scale + offset[1]
                        ]);
                    }
                    break;
                    
                case 'v': // Vertical line
                    for (let i = 0; i < numbers.length; i++) {
                        currentY = isRelative ? currentY + numbers[i] : numbers[i];
                        coords.push([
                            currentX * scale + offset[0],
                            currentY * scale + offset[1]
                        ]);
                    }
                    break;
                    
                case 'c': // Cubic Bezier
                    for (let i = 0; i < numbers.length; i += 6) {
                        const cp1x = isRelative ? currentX + numbers[i] : numbers[i];
                        const cp1y = isRelative ? currentY + numbers[i + 1] : numbers[i + 1];
                        const cp2x = isRelative ? currentX + numbers[i + 2] : numbers[i + 2];
                        const cp2y = isRelative ? currentY + numbers[i + 3] : numbers[i + 3];
                        const endX = isRelative ? currentX + numbers[i + 4] : numbers[i + 4];
                        const endY = isRelative ? currentY + numbers[i + 5] : numbers[i + 5];
                        
                        // Sample the cubic bezier curve
                        const steps = 10;
                        for (let t = 1; t <= steps; t++) {
                            const s = t / steps;
                            const s2 = s * s;
                            const s3 = s2 * s;
                            const t1 = 1 - s;
                            const t2 = t1 * t1;
                            const t3 = t2 * t1;
                            
                            const x = t3 * currentX + 3 * t2 * s * cp1x + 3 * t1 * s2 * cp2x + s3 * endX;
                            const y = t3 * currentY + 3 * t2 * s * cp1y + 3 * t1 * s2 * cp2y + s3 * endY;
                            
                            coords.push([
                                x * scale + offset[0],
                                y * scale + offset[1]
                            ]);
                        }
                        
                        prevControlX = cp2x;
                        prevControlY = cp2y;
                        currentX = endX;
                        currentY = endY;
                    }
                    break;
                    
                case 's': // Smooth cubic Bezier
                    for (let i = 0; i < numbers.length; i += 4) {
                        // Reflect previous control point
                        const cp1x = 2 * currentX - prevControlX;
                        const cp1y = 2 * currentY - prevControlY;
                        const cp2x = isRelative ? currentX + numbers[i] : numbers[i];
                        const cp2y = isRelative ? currentY + numbers[i + 1] : numbers[i + 1];
                        const endX = isRelative ? currentX + numbers[i + 2] : numbers[i + 2];
                        const endY = isRelative ? currentY + numbers[i + 3] : numbers[i + 3];
                        
                        // Sample the curve
                        const steps = 10;
                        for (let t = 1; t <= steps; t++) {
                            const s = t / steps;
                            const s2 = s * s;
                            const s3 = s2 * s;
                            const t1 = 1 - s;
                            const t2 = t1 * t1;
                            const t3 = t2 * t1;
                            
                            const x = t3 * currentX + 3 * t2 * s * cp1x + 3 * t1 * s2 * cp2x + s3 * endX;
                            const y = t3 * currentY + 3 * t2 * s * cp1y + 3 * t1 * s2 * cp2y + s3 * endY;
                            
                            coords.push([
                                x * scale + offset[0],
                                y * scale + offset[1]
                            ]);
                        }
                        
                        prevControlX = cp2x;
                        prevControlY = cp2y;
                        currentX = endX;
                        currentY = endY;
                    }
                    break;
                    
                case 'q': // Quadratic Bezier
                    for (let i = 0; i < numbers.length; i += 4) {
                        const cpx = isRelative ? currentX + numbers[i] : numbers[i];
                        const cpy = isRelative ? currentY + numbers[i + 1] : numbers[i + 1];
                        const endX = isRelative ? currentX + numbers[i + 2] : numbers[i + 2];
                        const endY = isRelative ? currentY + numbers[i + 3] : numbers[i + 3];
                        
                        // Sample the quadratic bezier curve
                        const steps = 8;
                        for (let t = 1; t <= steps; t++) {
                            const s = t / steps;
                            const t1 = 1 - s;
                            
                            const x = t1 * t1 * currentX + 2 * t1 * s * cpx + s * s * endX;
                            const y = t1 * t1 * currentY + 2 * t1 * s * cpy + s * s * endY;
                            
                            coords.push([
                                x * scale + offset[0],
                                y * scale + offset[1]
                            ]);
                        }
                        
                        prevControlX = cpx;
                        prevControlY = cpy;
                        currentX = endX;
                        currentY = endY;
                    }
                    break;
                    
                case 't': // Smooth quadratic Bezier
                    for (let i = 0; i < numbers.length; i += 2) {
                        // Reflect previous control point
                        const cpx = 2 * currentX - prevControlX;
                        const cpy = 2 * currentY - prevControlY;
                        const endX = isRelative ? currentX + numbers[i] : numbers[i];
                        const endY = isRelative ? currentY + numbers[i + 1] : numbers[i + 1];
                        
                        // Sample the curve
                        const steps = 8;
                        for (let t = 1; t <= steps; t++) {
                            const s = t / steps;
                            const t1 = 1 - s;
                            
                            const x = t1 * t1 * currentX + 2 * t1 * s * cpx + s * s * endX;
                            const y = t1 * t1 * currentY + 2 * t1 * s * cpy + s * s * endY;
                            
                            coords.push([
                                x * scale + offset[0],
                                y * scale + offset[1]
                            ]);
                        }
                        
                        prevControlX = cpx;
                        prevControlY = cpy;
                        currentX = endX;
                        currentY = endY;
                    }
                    break;
                    
                case 'a': // Arc - simplified handling
                    for (let i = 0; i < numbers.length; i += 7) {
                        const endX = isRelative ? currentX + numbers[i + 5] : numbers[i + 5];
                        const endY = isRelative ? currentY + numbers[i + 6] : numbers[i + 6];
                        
                        // Simplified: just use a line for now
                        // A proper implementation would convert SVG arc to center parameterization
                        coords.push([
                            endX * scale + offset[0],
                            endY * scale + offset[1]
                        ]);
                        
                        currentX = endX;
                        currentY = endY;
                    }
                    break;
                    
                case 'z': // Close path
                    // Don't add a point, just reset position
                    currentX = startX;
                    currentY = startY;
                    break;
            }
        });
        
        return coords;
    }

    /**
     * Ensure counter-clockwise winding
     */
    ensureCounterClockwise(path) {
        const area = this.calculateArea(path);
        if (area < 0) {
            // Negative area means clockwise, need to reverse
            const reversed = new this.core.clipper2.Path64();
            for (let i = path.size() - 1; i >= 0; i--) {
                reversed.push_back(path.get(i));
            }
            path.clear();
            for (let i = 0; i < reversed.size(); i++) {
                path.push_back(reversed.get(i));
            }
            reversed.delete();
            
            if (this.core.config.debugMode) {
                console.log('[GEOMETRY] Reversed path from CW to CCW');
            }
        }
        return path;
    }

    /**
     * Calculate area of a Path64
     */
    calculateArea(path) {
        let area = 0;
        const n = path.size();
        
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const pi = path.get(i);
            const pj = path.get(j);
            area += Number(pi.x * pj.y - pj.x * pi.y);
        }
        
        return area / 2;
    }

    /**
     * Calculate area from coordinate array
     */
    calculateAreaFromCoords(coords) {
        let area = 0;
        const n = coords.length;
        
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const pi = coords[i];
            const pj = coords[j];
            const xi = Array.isArray(pi) ? pi[0] : pi.x;
            const yi = Array.isArray(pi) ? pi[1] : pi.y;
            const xj = Array.isArray(pj) ? pj[0] : pj.x;
            const yj = Array.isArray(pj) ? pj[1] : pj.y;
            
            area += xi * yj - xj * yi;
        }
        
        return area / 2;
    }

    /**
     * Get geometry from defaults by name
     */
    getGeometry(name) {
        const parts = name.split('.');
        let def = this.defaults.geometries;
        
        for (const part of parts) {
            def = def[part];
            if (!def) return null;
        }
        
        return def;
    }

    /**
     * Create shape for testing (backwards compatibility)
     */
    createRectangle(x, y, width, height) {
        const coords = [
            [x, y],
            [x + width, y],
            [x + width, y + height],
            [x, y + height]
        ];
        return this.coordinatesToPath64(coords);
    }
    
    createCircle(cx, cy, r, segments = null) {
        segments = segments || this.defaults.config.polygonResolution;
        const coords = this.defaults.generators.circle(cx, cy, r, segments);
        return this.coordinatesToPath64(coords);
    }
    
    createStar(cx, cy, outerR, innerR, points) {
        const coords = this.defaults.generators.star(cx, cy, outerR, innerR, points);
        return this.coordinatesToPath64(coords);
    }
    
    createPolygon(points) {
        return this.coordinatesToPath64(points);
    }
    
    createRandomConvexPolygon(cx, cy, avgRadius, variance, points) {
        const coords = this.defaults.generators.randomConvex(cx, cy, avgRadius, variance, points);
        return this.coordinatesToPath64(coords);
    }

    // Legacy methods for compatibility
    createTrace(x1, y1, x2, y2, width) {
        const coords = this.defaults.generators.lineToPolygon([x1, y1], [x2, y2], width);
        return this.coordinatesToPath64(coords);
    }
    
    createPad(x, y, radius) {
        return this.createCircle(x, y, radius);
    }
    
    createArc(cx, cy, radius, startAngle, endAngle, strokeWidth) {
        const coords = this.defaults.generators.arcToPolygon([cx, cy], radius, startAngle, endAngle, strokeWidth);
        return this.coordinatesToPath64(coords);
    }
}