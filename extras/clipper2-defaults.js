/**
 * Clipper2 Defaults Module
 * Central configuration for geometry, algorithms, and test data
 * Version 4.1 - Fixed polygon generation
 */

const Clipper2Defaults = {
    // System configuration - Algorithm and calculation parameters
    config: {
        scale: 1000,            // Clipper2 integer scaling factor
        polygonResolution: 64,  // Segments for circles/arcs
        precision: 6,           // Decimal precision
        miterLimit: 10,         // Default miter limit for offsets
        // Internal canvas resolution for geometric calculations
        canvasWidth: 400,       
        canvasHeight: 400,
        gridSize: 20           // Grid spacing for drawing operations
    },
    
    // Tangency resolution settings - Algorithm parameters
    tangency: {
        strategy: 'none',
        epsilon: 50,        // In scaled units (0.05 original)
        threshold: 10,      // Detection threshold in scaled units
        enabled: false
    },
    
    // Geometry definitions - Pure coordinate data
    geometries: {
        // Letter B - defined as strokes with width
        letterB: {
            type: 'strokes',
            strokeWidth: 10,
            data: [
                { type: 'line', from: [100, 50], to: [100, 290] },
                { type: 'line', from: [100, 80], to: [200, 80] },
                { type: 'arc', center: [200, 110], radius: 30, start: -90, end: 90 },
                { type: 'line', from: [200, 140], to: [100, 140] },
                { type: 'line', from: [100, 200], to: [210, 200] },
                { type: 'arc', center: [210, 235], radius: 35, start: -90, end: 90 },
                { type: 'line', from: [210, 270], to: [100, 270] }
            ]
        },
        
        // PCB Fusion - traces and pads with geometric properties
        pcbFusion: {
            type: 'pcb',
            traceWidth: 12,
            traces: [
                { from: [50, 200], to: [350, 200] },
                { from: [150, 100], to: [150, 300] },
                { from: [250, 100], to: [350, 300] },
                { from: [150, 100], to: [250, 100] },
                { from: [150, 300], to: [350, 300] }
            ],
            pads: [
                { center: [50, 200], radius: 20 },
                { center: [150, 200], radius: 25 },
                { center: [250, 200], radius: 25 },
                { center: [350, 200], radius: 20 },
                { center: [150, 100], radius: 20 },
                { center: [150, 300], radius: 20 },
                { center: [250, 100], radius: 20 },
                { center: [350, 300], radius: 20 }
            ]
        },
        
        // Boolean operation shapes - coordinate data only
        boolean: {
            subject: {
                type: 'polygon',
                data: [[100, 100], [300, 100], [300, 300], [100, 300]]
            },
            clips: {
                circle: {
                    type: 'parametric',
                    shape: 'circle',
                    center: [200, 200],
                    radius: 80,
                    initialPos: [200, 200]
                },
                triangle: {
                    type: 'polygon',
                    data: [[0, -80], [70, 40], [-70, 40]],  // Relative to center
                    initialPos: [200, 200]
                },
                square: {
                    type: 'polygon',
                    data: [[-75, -75], [75, -75], [75, 75], [-75, 75]],  // Relative
                    initialPos: [200, 200]
                },
                star: {
                    type: 'parametric',
                    shape: 'star',
                    outerRadius: 80,
                    innerRadius: 40,
                    points: 5,
                    initialPos: [200, 200]
                },
                random: {
                    type: 'parametric',
                    shape: 'random',
                    avgRadius: 70,
                    variance: 30,
                    points: 8,
                    initialPos: [200, 200]
                },
                rabbit: {
                    type: 'svg',
                    scale: 0.3,
                    initialPos: [200, 200],
                    path: 'm 117.827,473.496 -8.148,-2.095 -7.222,-4.233 -3.845,-7.305 0.58,-7.641 1.89,-7.452 2.575,-7.243 2.333,-5.778 -5.048,-0.572 -5.048,-0.572 -6.141,-0.733 -6.125,-0.86 -2.82,2.504 -2.802,5.561 -5.16,3.469 -8.834,0.605 -8.872,-0.029 -8.869,-0.21 -8.865,-0.338 -8.859,-0.466 -8.848,-0.647 -8.7614,-1.276 -4.6459,-7.072 2.8843,-8.492 5.478,-7.198 6.608,-6.191 4.85,-4.196 2.117,-5.783 -1.772,-5.173 -4.43,-3.518 -6.853,-5.828 -4.9814,-7.442 -2.056,-8.736 -0.2667,-8.999 0.4584,-8.995 0.7962,-8.905 0.9762,-8.887 1.088,-8.875 1.1893,-8.862 1.317,-8.842 1.655,-8.785 3.787,-7.716 5.144,-6.927 5.585,-6.58 5.786,-6.405 5.895,-6.305 6.342,-6.558 6.446,-6.458 6.519,-6.383 6.579,-6.321 6.636,-6.261 6.696,-6.198 6.766,-6.117 6.88,-5.993 7.206,-5.582 7.372,-3.146 7.613,-2.527 8.59,-2.717 7.365,-4.943 3.677,-8.186 2.607,-8.624 2.726,-8.495 3.376,-8.256 4.332,-7.792 -1.458,-5.5 -5.077,-8.354 -4.107,-6.133 -4.901,-5.546 -5.143,-5.321 -5.161,-5.33 -5.026,-5.46 -4.732,-5.71 -4.769,-8.681 -4.478,-8.836 -4.388,-8.881 -4.328,-8.9118 -4.274,-8.9376 -4.213,-8.9652 -4.122,-9.0077 -3.822,-9.1367 -1.49,-5.8115 -0.796,-5.9437 3.324,-8.4038 5.66,-4.6108 6.862,-2.4246 7.305,-0.2515 8.97,1.5992 8.434,3.4654 7.769,4.7856 7.175,5.644 6.7,6.2009 6.329,6.7251 5.725,7.2478 5.129,7.6801 4.7,7.9535 4.432,8.1049 4.275,8.1894 4.065,7.831 4.152,7.785 4.462,7.591 2.947,-8.361 1.153,-9.044 0.648,-9.095 0.55,-9.3465 1.417,-9.2418 2.861,-8.9116 2.684,-7.4629 2.844,-7.4041 3.144,-7.2812 4.078,-6.7684 8.321,-1.9385 6.629,5.7311 2.392,8.9515 0.86,9.2652 0.439,9.2971 0.266,9.3041 0.18,9.3061 0.125,7.6249 0.125,7.625 0.124,7.625 0.125,7.625 4.714,0.627 7.428,1.403 7.169,2.383 6.643,3.589 5.788,4.846 4.436,6.202 3.908,6.558 3.724,6.666 3.615,6.726 4.586,8.485 4.751,8.394 5.186,8.121 4.157,6.3 1.657,7.379 -0.019,7.584 -0.839,7.545 -1.674,7.58 -3.979,6.628 -5.465,5.526 -5.56,5.682 -3.206,7.214 -1.739,6.353 2.801,8.334 2.753,9.226 2.099,9.397 1.389,9.527 0.584,9.609 -0.365,9.619 -1.55,9.497 -2.509,9.05 -2.709,8.992 -2.82,8.958 -2.793,9.166 -2.483,9.254 -2.151,9.337 -1.818,9.408 -1.504,9.462 -1.223,9.504 -0.411,9.059 0.963,9.016 2.244,8.788 3.211,8.485 3.866,8.21 4.294,7.997 4.575,7.837 4.895,8.249 4.6,8.414 2.515,9.134 -4.607,5.514 -7.789,0.876 -7.851,0.142 -7.164,-0.054 -7.147,-0.484 -6.999,-1.494 -7.326,-2.485 -5.97,-4.777 -3.65,-6.812 -2.943,-7.161 -2.096,-5.292 -2.097,-5.293 -7.611,-0.392 -7.611,-0.392 -7.611,-0.392 -7.841,-0.434 -7.837,-0.491 -7.834,-0.555 -7.822,-0.698 -9.194,-0.324 -1.815,4.861 -1.504,4.978 -2.624,9.161 2.068,6.947 1.732,7.882 -0.428,7.949 -5.904,2.831 -6.75,0.429 -6.765,0.023 -9.656,-0.241 -9.631,-0.708 v 0 z'
                }
            }
        },
        
        // Nested structure
        nested: {
            frame: {
                type: 'polygon',
                outer: [[50, 50], [350, 50], [350, 350], [50, 350]],
                inner: [[100, 100], [300, 100], [300, 300], [100, 300]]
            },
            islands: [
                {
                    type: 'polygon',
                    outer: [[150, 150], [250, 150], [250, 250], [150, 250]],
                    inner: [[180, 180], [220, 180], [220, 220], [180, 220]]
                },
                {
                    type: 'polygon',
                    outer: [[250, 250], [330, 250], [330, 330], [250, 330]],
                    inner: [[270, 270], [310, 270], [310, 310], [270, 310]]
                }
            ]
        },
        
        // Offset test shapes
        offset: {
            shapes: {
                star: {
                    type: 'parametric',
                    shape: 'star',
                    center: [200, 200],
                    outerRadius: 120,
                    innerRadius: 60,
                    points: 8
                },
                circle: {
                    type: 'parametric',
                    shape: 'circle',
                    center: [200, 200],
                    radius: 80
                },
                square: {
                    type: 'polygon',
                    data: [[120, 120], [280, 120], [280, 280], [120, 280]]
                },
                triangle: {
                    type: 'polygon',
                    data: [[200, 80], [320, 280], [80, 280]]
                },
                bottleneck: {
                    type: 'polygon',
                    data: [[120, 120], [280, 120], [220, 200], [280, 280], [120, 280], [180, 200]]
                }
            },
            defaults: {
                type: 'external',
                count: 3,
                distance: 10,
                joinType: 'Round',
                miterLimit: 10
            }
        },
        
        // Simplify test - noisy flower
        simplify: {
            type: 'parametric',
            shape: 'flower',
            center: [200, 200],
            baseRadius: 100,
            noiseFrequency: 5,
            noiseAmplitude: 30,
            segments: 100,
            defaultTolerance: 2
        },
        
        // Point in polygon test
        pip: {
            type: 'polygon',
            data: [[100, 50], [300, 100], [350, 200], [250, 350], [50, 300], [50, 150]],
            edgeTolerance: 3
        },
        
        // Area test configuration
        area: {
            gridSize: 20,
            minPoints: 3,
            pointRadius: 4
        }
    },
    
    // Visual styles - Reference CSS variables for colors
    styles: {
        // Default rendering style
        default: {
            fillOuter: 'var(--shape-fill)',
            strokeOuter: 'var(--shape-stroke)',
            fillHole: 'var(--canvas-bg)',
            strokeHole: 'var(--hole-stroke)',
            strokeWidth: 2
        },
        
        // Input geometry style
        input: {
            fillOuter: 'var(--input-fill)',
            strokeOuter: 'var(--input-stroke)',
            strokeWidth: 1
        },
        
        // Output/result style
        output: {
            fillOuter: 'var(--output-fill)',
            strokeOuter: 'var(--output-stroke)',
            strokeWidth: 2
        },
        
        // Test-specific styles
        boolean: {
            subject: {
                fillOuter: 'var(--subject-fill)',
                strokeOuter: 'var(--subject-stroke)',
                strokeWidth: 2
            },
            clip: {
                fillOuter: 'var(--clip-fill)',
                strokeOuter: 'var(--clip-stroke)',
                strokeWidth: 2
            }
        },
        
        pcb: {
            fillOuter: 'var(--pcb-fill)',
            strokeOuter: 'var(--pcb-stroke)',
            strokeWidth: 2,
            traceCap: 'round',
            traceJoin: 'round'
        },
        
        pointInPolygon: {
            inside: 'var(--pip-inside)',
            outside: 'var(--pip-outside)',
            onEdge: 'var(--pip-edge)',
            pointRadius: 5
        },
        
        draggable: {
            hover: {
                cursor: 'grab',
                strokeWidth: 3
            },
            dragging: {
                cursor: 'grabbing',
                opacity: 0.8
            }
        }
    },
    
    // Test validation expectations
    validation: {
        letterB: {
            expectedPaths: 3,
            expectedHoles: 2,
            description: 'Letter B should produce 3 paths with 2 CCW holes'
        },
        pcbFusion: {
            maxPaths: 2,
            minHoles: 1,
            description: 'PCB fusion should create merged region with hole(s)'
        }
    },
    
    // Labels and text content
    labels: {
        inputGeometry: 'Input Geometry',
        outputGeometry: 'Output Geometry',
        processing: 'Processing...',
        ready: 'Ready to run test',
        error: 'Error: ',
        warning: 'Warning: ',
        success: 'Success: '
    },
    
    // Helper functions for geometry generation
    generators: {
        /**
         * Generate circle points
         */
        circle(cx, cy, r, segments = 64) {
            const points = [];
            for (let i = 0; i < segments; i++) {
                const angle = (i / segments) * Math.PI * 2;
                points.push([
                    cx + r * Math.cos(angle),
                    cy + r * Math.sin(angle)
                ]);
            }
            return points;
        },
        
        /**
         * Generate star points
         */
        star(cx, cy, outerR, innerR, numPoints) {
            const points = [];
            for (let i = 0; i < numPoints * 2; i++) {
                const angle = (i / (numPoints * 2)) * Math.PI * 2 - Math.PI / 2;
                const radius = i % 2 === 0 ? outerR : innerR;
                points.push([
                    cx + radius * Math.cos(angle),
                    cy + radius * Math.sin(angle)
                ]);
            }
            return points;
        },
        
        /**
         * Generate random convex polygon
         */
        randomConvex(cx, cy, avgRadius, variance, numPoints) {
            const angles = [];
            for (let i = 0; i < numPoints; i++) {
                angles.push(Math.random() * Math.PI * 2);
            }
            angles.sort((a, b) => a - b);
            
            const points = [];
            angles.forEach(angle => {
                const radiusVariance = (Math.random() - 0.5) * variance;
                const radius = avgRadius + radiusVariance;
                points.push([
                    cx + radius * Math.cos(angle),
                    cy + radius * Math.sin(angle)
                ]);
            });
            return points;
        },
        
        /**
         * Generate flower shape (for simplify test)
         */
        flower(cx, cy, baseRadius, frequency, amplitude, segments) {
            const points = [];
            for (let i = 0; i <= segments; i++) {
                const angle = (i / segments) * Math.PI * 2;
                const noise = Math.sin(angle * frequency) * amplitude;
                const radius = baseRadius + noise;
                points.push([
                    cx + radius * Math.cos(angle),
                    cy + radius * Math.sin(angle)
                ]);
            }
            return points;
        },
        
        /**
         * Stroke to polygon converter
         */
        strokeToPolygon(stroke, width) {
            if (stroke.type === 'line') {
                return this.lineToPolygon(stroke.from, stroke.to, width);
            } else if (stroke.type === 'arc') {
                return this.arcToPolygon(stroke.center, stroke.radius, stroke.start, stroke.end, width);
            }
            return [];
        },
        
        /**
         * Convert line to thick polygon - FIXED VERSION
         * Creates proper CCW wound polygon with semicircular caps
         */
        lineToPolygon(from, to, width) {
            const dx = to[0] - from[0];
            const dy = to[1] - from[1];
            const len = Math.sqrt(dx * dx + dy * dy);
            const halfWidth = width / 2;
            
            // Handle zero-length lines
            if (len === 0) return this.circle(from[0], from[1], halfWidth, 16);
            
            // Unit vector along the line
            const ux = dx / len;
            const uy = dy / len;
            
            // Perpendicular vector (rotated 90 degrees CW for proper convex caps)
            const nx = uy * halfWidth;
            const ny = -ux * halfWidth;
            
            const points = [];
            const capSegments = 8;
            
            // Build polygon in CCW order:
            
            // 1. Start at left side of start point
            points.push([from[0] - nx, from[1] - ny]);
            
            // 2. Start cap (semicircle from left to right)
            const startAngle = Math.atan2(-ny, -nx);
            for (let i = 1; i < capSegments; i++) {
                const t = i / capSegments;
                const angle = startAngle + Math.PI * t;
                points.push([
                    from[0] + halfWidth * Math.cos(angle),
                    from[1] + halfWidth * Math.sin(angle)
                ]);
            }
            
            // 3. Right side of start point
            points.push([from[0] + nx, from[1] + ny]);
            
            // 4. Right side of end point
            points.push([to[0] + nx, to[1] + ny]);
            
            // 5. End cap (semicircle from right to left)
            const endAngle = Math.atan2(ny, nx);
            for (let i = 1; i < capSegments; i++) {
                const t = i / capSegments;
                const angle = endAngle + Math.PI * t;
                points.push([
                    to[0] + halfWidth * Math.cos(angle),
                    to[1] + halfWidth * Math.sin(angle)
                ]);
            }
            
            // 6. Left side of end point
            points.push([to[0] - nx, to[1] - ny]);
            
            // 7. Back to start (no need to duplicate first point)
            
            return points;
        },
        
        /**
         * Convert arc to thick polygon - simple approach without caps
         * For stroked arcs, caps are handled by adjacent line segments
         */
        arcToPolygon(center, radius, startDeg, endDeg, width) {
            const points = [];
            const segments = 32;
            const innerR = radius - width / 2;
            const outerR = radius + width / 2;
            const startRad = startDeg * Math.PI / 180;
            const endRad = endDeg * Math.PI / 180;
            
            // Build continuous polygon in CCW order:
            
            // 1. Inner arc (from start to end)
            for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                const angle = startRad + (endRad - startRad) * t;
                points.push([
                    center[0] + innerR * Math.cos(angle),
                    center[1] + innerR * Math.sin(angle)
                ]);
            }
            
            // 2. Connect to outer arc (straight line at end)
            
            // 3. Outer arc (from end to start - reversed)
            for (let i = segments; i >= 0; i--) {
                const t = i / segments;
                const angle = startRad + (endRad - startRad) * t;
                points.push([
                    center[0] + outerR * Math.cos(angle),
                    center[1] + outerR * Math.sin(angle)
                ]);
            }
            
            // 4. Connect back to start (straight line at start)
            // Polygon is automatically closed
            
            return points;
        }
    }
};

// Make available globally
if (typeof window !== 'undefined') {
    window.Clipper2Defaults = Clipper2Defaults;
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Clipper2Defaults;
}