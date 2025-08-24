/**
 * Clipper2 Geometry Module
 * Creates various geometric shapes for testing
 * Version 3.4 - Fixed winding order normalization for all geometry
 */

class Clipper2Geometry {
    constructor(core) {
        this.core = core;
    }

    /**
     * Ensure counter-clockwise winding for proper boolean operations
     * Critical for union operations with FillRule.Positive
     */
    ensureCounterClockwise(path) {
        // Check if AreaPath64 is available
        if (this.core.clipper2.AreaPath64) {
            const area = this.core.clipper2.AreaPath64(path);
            if (area < 0) {
                // Negative area means clockwise, need to reverse
                if (this.core.clipper2.ReversePath64) {
                    this.core.clipper2.ReversePath64(path);
                    this.core.debug('Reversed path from CW to CCW');
                } else {
                    // Fallback: manually reverse
                    const reversed = new this.core.clipper2.Path64();
                    for (let i = path.size() - 1; i >= 0; i--) {
                        reversed.push_back(path.get(i));
                    }
                    // Clear original and copy reversed
                    path.clear();
                    for (let i = 0; i < reversed.size(); i++) {
                        path.push_back(reversed.get(i));
                    }
                    reversed.delete();
                    this.core.debug('Manually reversed path from CW to CCW');
                }
            }
        } else {
            // If AreaPath64 not available, calculate manually
            let area = 0;
            const n = path.size();
            for (let i = 0; i < n; i++) {
                const j = (i + 1) % n;
                const pi = path.get(i);
                const pj = path.get(j);
                area += Number(pi.x * pj.y - pj.x * pi.y);
            }
            
            if (area < 0) {
                // Reverse path
                const reversed = new this.core.clipper2.Path64();
                for (let i = path.size() - 1; i >= 0; i--) {
                    reversed.push_back(path.get(i));
                }
                path.clear();
                for (let i = 0; i < reversed.size(); i++) {
                    path.push_back(reversed.get(i));
                }
                reversed.delete();
                this.core.debug('Manually calculated and reversed path from CW to CCW');
            }
        }
        
        return path;
    }

    /**
     * Create rectangle path with scaling and CCW winding
     */
    createRectangle(x, y, width, height) {
        const path = new this.core.clipper2.Path64();
        const scale = this.core.config.scale;
        
        // Create CCW rectangle (bottom-left, bottom-right, top-right, top-left)
        path.push_back(new this.core.clipper2.Point64(
            BigInt(Math.round(x * scale)), 
            BigInt(Math.round(y * scale)), 
            BigInt(0)
        ));
        path.push_back(new this.core.clipper2.Point64(
            BigInt(Math.round((x + width) * scale)), 
            BigInt(Math.round(y * scale)), 
            BigInt(0)
        ));
        path.push_back(new this.core.clipper2.Point64(
            BigInt(Math.round((x + width) * scale)), 
            BigInt(Math.round((y + height) * scale)), 
            BigInt(0)
        ));
        path.push_back(new this.core.clipper2.Point64(
            BigInt(Math.round(x * scale)), 
            BigInt(Math.round((y + height) * scale)), 
            BigInt(0)
        ));
        
        return this.core.trackObject(this.ensureCounterClockwise(path));
    }

    /**
     * Create circle path with configurable segments and scaling and CCW winding
     */
    createCircle(centerX, centerY, radius, segments = null) {
        segments = segments || this.core.config.polygonResolution || 64;
        const path = new this.core.clipper2.Path64();
        const scale = this.core.config.scale;
        
        // Create CCW circle
        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);
            
            path.push_back(new this.core.clipper2.Point64(
                BigInt(Math.round(x * scale)),
                BigInt(Math.round(y * scale)),
                BigInt(0)
            ));
        }
        
        return this.core.trackObject(this.ensureCounterClockwise(path));
    }

    /**
     * Create ellipse path with scaling and CCW winding
     */
    createEllipse(centerX, centerY, radiusX, radiusY, segments = null) {
        segments = segments || this.core.config.polygonResolution || 64;
        const path = new this.core.clipper2.Path64();
        const scale = this.core.config.scale;
        
        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const x = centerX + radiusX * Math.cos(angle);
            const y = centerY + radiusY * Math.sin(angle);
            
            path.push_back(new this.core.clipper2.Point64(
                BigInt(Math.round(x * scale)),
                BigInt(Math.round(y * scale)),
                BigInt(0)
            ));
        }
        
        return this.core.trackObject(this.ensureCounterClockwise(path));
    }

    /**
     * Create polygon from points array with scaling and CCW winding
     */
    createPolygon(points) {
        const path = new this.core.clipper2.Path64();
        const scale = this.core.config.scale;
        
        points.forEach(([x, y]) => {
            path.push_back(new this.core.clipper2.Point64(
                BigInt(Math.round(x * scale)), 
                BigInt(Math.round(y * scale)), 
                BigInt(0)
            ));
        });
        
        return this.core.trackObject(this.ensureCounterClockwise(path));
    }

    /**
     * Create PCB trace (thick line with rounded ends) with scaling and CCW winding
     */
    createTrace(x1, y1, x2, y2, width) {
        const path = new this.core.clipper2.Path64();
        const scale = this.core.config.scale;
        
        // Calculate perpendicular offset
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        
        // Handle zero-length trace as circle
        if (len === 0) {
            return this.createCircle((x1 + x2) / 2, (y1 + y2) / 2, width / 2);
        }
        
        const nx = -dy / len * width / 2;
        const ny = dx / len * width / 2;
        
        // Create trace with rounded ends in CCW order
        const segments = Math.max(8, Math.floor(this.core.config.polygonResolution / 4));
        
        // Start cap (semicircle) - CCW from bottom to top
        const startAngle = Math.atan2(ny, nx);
        for (let i = 0; i <= segments; i++) {
            const angle = startAngle + Math.PI - (i / segments) * Math.PI;
            const px = x1 + (width / 2) * Math.cos(angle);
            const py = y1 + (width / 2) * Math.sin(angle);
            path.push_back(new this.core.clipper2.Point64(
                BigInt(Math.round(px * scale)),
                BigInt(Math.round(py * scale)),
                BigInt(0)
            ));
        }
        
        // Top edge
        path.push_back(new this.core.clipper2.Point64(
            BigInt(Math.round((x2 + nx) * scale)),
            BigInt(Math.round((y2 + ny) * scale)),
            BigInt(0)
        ));
        
        // End cap (semicircle) - CCW from top to bottom
        for (let i = 0; i <= segments; i++) {
            const angle = startAngle + (i / segments) * Math.PI;
            const px = x2 + (width / 2) * Math.cos(angle);
            const py = y2 + (width / 2) * Math.sin(angle);
            path.push_back(new this.core.clipper2.Point64(
                BigInt(Math.round(px * scale)),
                BigInt(Math.round(py * scale)),
                BigInt(0)
            ));
        }
        
        // Bottom edge (back to start)
        path.push_back(new this.core.clipper2.Point64(
            BigInt(Math.round((x1 - nx) * scale)),
            BigInt(Math.round((y1 - ny) * scale)),
            BigInt(0)
        ));
        
        return this.core.trackObject(this.ensureCounterClockwise(path));
    }

    /**
     * Create PCB pad (circle) with CCW winding
     */
    createPad(x, y, radius) {
        return this.createCircle(x, y, radius);
    }

    /**
     * Create PCB via (annular ring - circle with optional hole) with CCW winding
     */
    createVia(x, y, outerRadius, innerRadius = 0) {
        // For PCB boolean operations, we only care about the copper ring
        // The drill hole is handled separately in manufacturing
        // For now, just return the outer circle
        return this.createCircle(x, y, outerRadius);
    }

    /**
     * Create arc path with scaling and CCW winding
     */
    createArc(centerX, centerY, radius, startAngle, endAngle, strokeWidth = 1) {
        const path = new this.core.clipper2.Path64();
        const segments = this.core.config.polygonResolution || 64;
        const scale = this.core.config.scale;
        
        if (strokeWidth > 1) {
            // Create thick arc (for strokes) - ensure CCW
            const innerRadius = radius - strokeWidth / 2;
            const outerRadius = radius + strokeWidth / 2;
            
            // Outer arc (CCW)
            for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                const angle = startAngle + (endAngle - startAngle) * t;
                const x = centerX + outerRadius * Math.cos(angle);
                const y = centerY + outerRadius * Math.sin(angle);
                
                path.push_back(new this.core.clipper2.Point64(
                    BigInt(Math.round(x * scale)),
                    BigInt(Math.round(y * scale)),
                    BigInt(0)
                ));
            }
            
            // Inner arc (reversed for closed shape to maintain CCW)
            for (let i = segments; i >= 0; i--) {
                const t = i / segments;
                const angle = startAngle + (endAngle - startAngle) * t;
                const x = centerX + innerRadius * Math.cos(angle);
                const y = centerY + innerRadius * Math.sin(angle);
                
                path.push_back(new this.core.clipper2.Point64(
                    BigInt(Math.round(x * scale)),
                    BigInt(Math.round(y * scale)),
                    BigInt(0)
                ));
            }
        } else {
            // Thin arc
            for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                const angle = startAngle + (endAngle - startAngle) * t;
                const x = centerX + radius * Math.cos(angle);
                const y = centerY + radius * Math.sin(angle);
                
                path.push_back(new this.core.clipper2.Point64(
                    BigInt(Math.round(x * scale)),
                    BigInt(Math.round(y * scale)),
                    BigInt(0)
                ));
            }
        }
        
        return this.core.trackObject(this.ensureCounterClockwise(path));
    }

    /**
     * Create star shape with scaling and CCW winding
     */
    createStar(centerX, centerY, outerRadius, innerRadius, points) {
        const path = new this.core.clipper2.Path64();
        const scale = this.core.config.scale;
        
        for (let i = 0; i < points * 2; i++) {
            const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
            const radius = i % 2 === 0 ? outerRadius : innerRadius;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);
            
            path.push_back(new this.core.clipper2.Point64(
                BigInt(Math.round(x * scale)),
                BigInt(Math.round(y * scale)),
                BigInt(0)
            ));
        }
        
        return this.core.trackObject(this.ensureCounterClockwise(path));
    }

    /**
     * Create regular polygon with scaling and CCW winding
     */
    createRegularPolygon(centerX, centerY, radius, sides, rotation = 0) {
        const path = new this.core.clipper2.Path64();
        const scale = this.core.config.scale;
        
        for (let i = 0; i < sides; i++) {
            const angle = (i / sides) * Math.PI * 2 + rotation;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);
            
            path.push_back(new this.core.clipper2.Point64(
                BigInt(Math.round(x * scale)),
                BigInt(Math.round(y * scale)),
                BigInt(0)
            ));
        }
        
        return this.core.trackObject(this.ensureCounterClockwise(path));
    }

    /**
     * Create noisy path for simplification testing with scaling and CCW winding
     */
    createNoisyPath(centerX, centerY, baseRadius, noiseAmount, points) {
        const path = new this.core.clipper2.Path64();
        const scale = this.core.config.scale;
        
        for (let i = 0; i < points; i++) {
            const angle = (i / points) * Math.PI * 2;
            const noise = (Math.random() - 0.5) * noiseAmount;
            const radius = baseRadius + noise;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);
            
            path.push_back(new this.core.clipper2.Point64(
                BigInt(Math.round(x * scale)),
                BigInt(Math.round(y * scale)),
                BigInt(0)
            ));
        }
        
        return this.core.trackObject(this.ensureCounterClockwise(path));
    }

    /**
     * Create spiral path with scaling and CCW winding
     */
    createSpiral(centerX, centerY, startRadius, endRadius, turns, pointsPerTurn = 32) {
        const path = new this.core.clipper2.Path64();
        const scale = this.core.config.scale;
        const totalPoints = turns * pointsPerTurn;
        
        for (let i = 0; i <= totalPoints; i++) {
            const t = i / totalPoints;
            const angle = t * turns * Math.PI * 2;
            const radius = startRadius + (endRadius - startRadius) * t;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);
            
            path.push_back(new this.core.clipper2.Point64(
                BigInt(Math.round(x * scale)),
                BigInt(Math.round(y * scale)),
                BigInt(0)
            ));
        }
        
        return this.core.trackObject(this.ensureCounterClockwise(path));
    }

    /**
     * Create grid of shapes
     */
    createGrid(shape, rows, cols, spacing, offsetX = 0, offsetY = 0) {
        const paths = new this.core.clipper2.Paths64();
        
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const x = offsetX + col * spacing;
                const y = offsetY + row * spacing;
                
                let path;
                switch(shape) {
                    case 'circle':
                        path = this.createCircle(x, y, spacing / 3);
                        break;
                    case 'square':
                        path = this.createRectangle(
                            x - spacing / 3, 
                            y - spacing / 3, 
                            spacing * 2 / 3, 
                            spacing * 2 / 3
                        );
                        break;
                    case 'hexagon':
                        path = this.createRegularPolygon(x, y, spacing / 3, 6);
                        break;
                    default:
                        path = this.createCircle(x, y, spacing / 4);
                }
                
                paths.push_back(path);
            }
        }
        
        return this.core.trackObject(paths);
    }

    /**
     * Create random convex polygon with CCW winding
     */
    createRandomConvexPolygon(centerX, centerY, avgRadius, variance, points) {
        // Generate random angles and sort them
        const angles = [];
        for (let i = 0; i < points; i++) {
            angles.push(Math.random() * Math.PI * 2);
        }
        angles.sort((a, b) => a - b);
        
        const path = new this.core.clipper2.Path64();
        const scale = this.core.config.scale;
        
        angles.forEach(angle => {
            const radiusVariance = (Math.random() - 0.5) * variance;
            const radius = avgRadius + radiusVariance;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);
            
            path.push_back(new this.core.clipper2.Point64(
                BigInt(Math.round(x * scale)),
                BigInt(Math.round(y * scale)),
                BigInt(0)
            ));
        });
        
        return this.core.trackObject(this.ensureCounterClockwise(path));
    }

    /**
     * Create Bezier curve approximation with CCW winding check
     */
    createBezierCurve(p0, p1, p2, p3, segments = 32) {
        const path = new this.core.clipper2.Path64();
        const scale = this.core.config.scale;
        
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const t2 = t * t;
            const t3 = t2 * t;
            const mt = 1 - t;
            const mt2 = mt * mt;
            const mt3 = mt2 * mt;
            
            const x = mt3 * p0[0] + 3 * mt2 * t * p1[0] + 3 * mt * t2 * p2[0] + t3 * p3[0];
            const y = mt3 * p0[1] + 3 * mt2 * t * p1[1] + 3 * mt * t2 * p2[1] + t3 * p3[1];
            
            path.push_back(new this.core.clipper2.Point64(
                BigInt(Math.round(x * scale)),
                BigInt(Math.round(y * scale)),
                BigInt(0)
            ));
        }
        
        return this.core.trackObject(this.ensureCounterClockwise(path));
    }

    /**
     * Create rounded rectangle with CCW winding
     */
    createRoundedRectangle(x, y, width, height, cornerRadius) {
        const path = new this.core.clipper2.Path64();
        const scale = this.core.config.scale;
        const segments = Math.max(4, Math.floor(this.core.config.polygonResolution / 8));
        
        // Create in CCW order
        // Top-left corner
        for (let i = 0; i <= segments; i++) {
            const angle = Math.PI + (i / segments) * Math.PI / 2;
            const px = x + cornerRadius + cornerRadius * Math.cos(angle);
            const py = y + cornerRadius + cornerRadius * Math.sin(angle);
            path.push_back(new this.core.clipper2.Point64(
                BigInt(Math.round(px * scale)),
                BigInt(Math.round(py * scale)),
                BigInt(0)
            ));
        }
        
        // Top-right corner
        for (let i = 0; i <= segments; i++) {
            const angle = -Math.PI / 2 + (i / segments) * Math.PI / 2;
            const px = x + width - cornerRadius + cornerRadius * Math.cos(angle);
            const py = y + cornerRadius + cornerRadius * Math.sin(angle);
            path.push_back(new this.core.clipper2.Point64(
                BigInt(Math.round(px * scale)),
                BigInt(Math.round(py * scale)),
                BigInt(0)
            ));
        }
        
        // Bottom-right corner
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI / 2;
            const px = x + width - cornerRadius + cornerRadius * Math.cos(angle);
            const py = y + height - cornerRadius + cornerRadius * Math.sin(angle);
            path.push_back(new this.core.clipper2.Point64(
                BigInt(Math.round(px * scale)),
                BigInt(Math.round(py * scale)),
                BigInt(0)
            ));
        }
        
        // Bottom-left corner
        for (let i = 0; i <= segments; i++) {
            const angle = Math.PI / 2 + (i / segments) * Math.PI / 2;
            const px = x + cornerRadius + cornerRadius * Math.cos(angle);
            const py = y + height - cornerRadius + cornerRadius * Math.sin(angle);
            path.push_back(new this.core.clipper2.Point64(
                BigInt(Math.round(px * scale)),
                BigInt(Math.round(py * scale)),
                BigInt(0)
            ));
        }
        
        return this.core.trackObject(this.ensureCounterClockwise(path));
    }

    /**
     * Create arrow shape with CCW winding
     */
    createArrow(x1, y1, x2, y2, headLength = 20, headWidth = 15, shaftWidth = 8) {
        const path = new this.core.clipper2.Path64();
        const scale = this.core.config.scale;
        
        // Calculate direction
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        
        if (len === 0) return this.createCircle((x1 + x2) / 2, (y1 + y2) / 2, 5);
        
        const dirX = dx / len;
        const dirY = dy / len;
        const perpX = -dirY;
        const perpY = dirX;
        
        // Arrow points in CCW order
        const points = [
            // Shaft start bottom
            [x1 - perpX * shaftWidth / 2, y1 - perpY * shaftWidth / 2],
            // Shaft start top
            [x1 + perpX * shaftWidth / 2, y1 + perpY * shaftWidth / 2],
            // Shaft to head transition top
            [x2 - dirX * headLength + perpX * shaftWidth / 2, y2 - dirY * headLength + perpY * shaftWidth / 2],
            // Head side top
            [x2 - dirX * headLength + perpX * headWidth / 2, y2 - dirY * headLength + perpY * headWidth / 2],
            // Arrow tip
            [x2, y2],
            // Head side bottom
            [x2 - dirX * headLength - perpX * headWidth / 2, y2 - dirY * headLength - perpY * headWidth / 2],
            // Shaft to head transition bottom
            [x2 - dirX * headLength - perpX * shaftWidth / 2, y2 - dirY * headLength - perpY * shaftWidth / 2]
        ];
        
        points.forEach(([px, py]) => {
            path.push_back(new this.core.clipper2.Point64(
                BigInt(Math.round(px * scale)),
                BigInt(Math.round(py * scale)),
                BigInt(0)
            ));
        });
        
        return this.core.trackObject(this.ensureCounterClockwise(path));
    }
}