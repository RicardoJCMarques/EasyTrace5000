/**
 * @file        clipper2-defaults.js
 * @description Central configuration for geometry, algorithms, and test data
 * @author      Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

/*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2026 Eltryus
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

// Define reusable SVG path data to avoid duplication // Pulled from https://github.com/ErikSom/Clipper2-WASM/blob/main/clipper2-wasm/examples/rabbit.svg
const SVG_PATHS = {
    rabbit: 'm 117.827,473.496 -8.148,-2.095 -7.222,-4.233 -3.845,-7.305 0.58,-7.641 1.89,-7.452 2.575,-7.243 2.333,-5.778 -5.048,-0.572 -5.048,-0.572 -6.141,-0.733 -6.125,-0.86 -2.82,2.504 -2.802,5.561 -5.16,3.469 -8.834,0.605 -8.872,-0.029 -8.869,-0.21 -8.865,-0.338 -8.859,-0.466 -8.848,-0.647 -8.7614,-1.276 -4.6459,-7.072 2.8843,-8.492 5.478,-7.198 6.608,-6.191 4.85,-4.196 2.117,-5.783 -1.772,-5.173 -4.43,-3.518 -6.853,-5.828 -4.9814,-7.442 -2.056,-8.736 -0.2667,-8.999 0.4584,-8.995 0.7962,-8.905 0.9762,-8.887 1.088,-8.875 1.1893,-8.862 1.317,-8.842 1.655,-8.785 3.787,-7.716 5.144,-6.927 5.585,-6.58 5.786,-6.405 5.895,-6.305 6.342,-6.558 6.446,-6.458 6.519,-6.383 6.579,-6.321 6.636,-6.261 6.696,-6.198 6.766,-6.117 6.88,-5.993 7.206,-5.582 7.372,-3.146 7.613,-2.527 8.59,-2.717 7.365,-4.943 3.677,-8.186 2.607,-8.624 2.726,-8.495 3.376,-8.256 4.332,-7.792 -1.458,-5.5 -5.077,-8.354 -4.107,-6.133 -4.901,-5.546 -5.143,-5.321 -5.161,-5.33 -5.026,-5.46 -4.732,-5.71 -4.769,-8.681 -4.478,-8.836 -4.388,-8.881 -4.328,-8.9118 -4.274,-8.9376 -4.213,-8.9652 -4.122,-9.0077 -3.822,-9.1367 -1.49,-5.8115 -0.796,-5.9437 3.324,-8.4038 5.66,-4.6108 6.862,-2.4246 7.305,-0.2515 8.97,1.5992 8.434,3.4654 7.769,4.7856 7.175,5.644 6.7,6.2009 6.329,6.7251 5.725,7.2478 5.129,7.6801 4.7,7.9535 4.432,8.1049 4.275,8.1894 4.065,7.831 4.152,7.785 4.462,7.591 2.947,-8.361 1.153,-9.044 0.648,-9.095 0.55,-9.3465 1.417,-9.2418 2.861,-8.9116 2.684,-7.4629 2.844,-7.4041 3.144,-7.2812 4.078,-6.7684 8.321,-1.9385 6.629,5.7311 2.392,8.9515 0.86,9.2652 0.439,9.2971 0.266,9.3041 0.18,9.3061 0.125,7.6249 0.125,7.625 0.124,7.625 0.125,7.625 4.714,0.627 7.428,1.403 7.169,2.383 6.643,3.589 5.788,4.846 4.436,6.202 3.908,6.558 3.724,6.666 3.615,6.726 4.586,8.485 4.751,8.394 5.186,8.121 4.157,6.3 1.657,7.379 -0.019,7.584 -0.839,7.545 -1.674,7.58 -3.979,6.628 -5.465,5.526 -5.56,5.682 -3.206,7.214 -1.739,6.353 2.801,8.334 2.753,9.226 2.099,9.397 1.389,9.527 0.584,9.609 -0.365,9.619 -1.55,9.497 -2.509,9.05 -2.709,8.992 -2.82,8.958 -2.793,9.166 -2.483,9.254 -2.151,9.337 -1.818,9.408 -1.504,9.462 -1.223,9.504 -0.411,9.059 0.963,9.016 2.244,8.788 3.211,8.485 3.866,8.21 4.294,7.997 4.575,7.837 4.895,8.249 4.6,8.414 2.515,9.134 -4.607,5.514 -7.789,0.876 -7.851,0.142 -7.164,-0.054 -7.147,-0.484 -6.999,-1.494 -7.326,-2.485 -5.97,-4.777 -3.65,-6.812 -2.943,-7.161 -2.096,-5.292 -2.097,-5.293 -7.611,-0.392 -7.611,-0.392 -7.611,-0.392 -7.841,-0.434 -7.837,-0.491 -7.834,-0.555 -7.822,-0.698 -9.194,-0.324 -1.815,4.861 -1.504,4.978 -2.624,9.161 2.068,6.947 1.732,7.882 -0.428,7.949 -5.904,2.831 -6.75,0.429 -6.765,0.023 -9.656,-0.241 -9.631,-0.708 v 0 z'
};

const Clipper2Defaults = {
    // System configuration - Centralized constants
    config: {
        scale: 1000,            
        polygonResolution: 64,  
        precision: 6,           
        miterLimit: 10,         
        canvasWidth: 800,         // Centralized canvas width
        canvasHeight: 800,        // Centralized canvas height
        gridSize: 40,             
        debugMode: false,
        draggableMargin: 20       // Margin for draggable shapes from canvas edges
    },

    // Geometry definitions - All properly scaled for 800x800
    geometries: {
        letterB: {
            type: 'strokes',
            strokeWidth: 20,
            data: [
                { type: 'line', from: [200, 100], to: [200, 580] },
                { type: 'line', from: [200, 160], to: [400, 160] },
                { type: 'arc', center: [400, 220], radius: 60, start: -90, end: 90 },
                { type: 'line', from: [400, 280], to: [200, 280] },
                { type: 'line', from: [200, 400], to: [420, 400] },
                { type: 'arc', center: [420, 470], radius: 70, start: -90, end: 90 },
                { type: 'line', from: [420, 540], to: [200, 540] }
            ]
        },
        pcbFusion: {
            type: 'pcb',
            traceWidth: 24,
            traces: [
                { from: [100, 400], to: [700, 400] },
                { from: [300, 200], to: [300, 600] },
                { from: [500, 200], to: [700, 600] },
                { from: [300, 200], to: [500, 200] },
                { from: [300, 600], to: [700, 600] }
            ],
            pads: [
                { center: [100, 400], radius: 40 },
                { center: [300, 400], radius: 50 },
                { center: [500, 400], radius: 50 },
                { center: [700, 400], radius: 40 },
                { center: [300, 200], radius: 40 },
                { center: [300, 600], radius: 40 },
                { center: [500, 200], radius: 40 },
                { center: [700, 600], radius: 40 }
            ]
        },
        // Boolean operation shapes - properly centered for 800x800
        boolean: {
            subject: {
                type: 'polygon',
                data: [[200, 200], [600, 200], [600, 600], [200, 600]]
            },
            clips: {
                circle: {
                    type: 'parametric',
                    shape: 'circle',
                    center: [0, 0],
                    radius: 160,
                    initialPos: [200, 200]  // Array format for initial position
                },
                triangle: {
                    type: 'polygon',
                    data: [[0, -160], [140, 80], [-140, 80]],
                    initialPos: [500, 400],
                    boundingRadius: 160  // Pre-calculated for dragging bounds
                },
                square: {
                    type: 'polygon',
                    data: [[-150, -150], [150, -150], [150, 150], [-150, 150]],
                    initialPos: [500, 400],
                    boundingRadius: 150
                },
                star: {
                    type: 'parametric',
                    shape: 'star',
                    outerRadius: 160,
                    innerRadius: 80,
                    points: 5,
                    initialPos: [500, 400]
                },
                random: {
                    type: 'parametric',
                    shape: 'random',
                    avgRadius: 140,
                    variance: 60,
                    points: 8,
                    initialPos: [500, 400]
                },
                rabbit: {
                    type: 'svg',
                    path: SVG_PATHS.rabbit,
                    scale: 0.6,
                    initialPos: [500, 400],
                    boundingRadius: 160  // Approximate for dragging
                }
            }
        },
        // Nested structure - properly scaled
        nested: {
            frame: {
                type: 'polygon',
                outer: [[100, 100], [700, 100], [700, 700], [100, 700]],
                inner: [[200, 200], [600, 200], [600, 600], [200, 600]]
            },
            islands: [
                {
                    type: 'polygon',
                    outer: [[300, 300], [500, 300], [500, 500], [300, 500]],
                    inner: [[360, 360], [440, 360], [440, 440], [360, 440]]
                },
                {
                    type: 'polygon',
                    outer: [[500, 500], [660, 500], [660, 660], [500, 660]],
                    inner: [[540, 540], [620, 540], [620, 620], [540, 620]]
                }
            ],
            defaults: {
                island1Pos: { x: 300, y: 300 },
                island2Pos: { x: 500, y: 500 }
            }
        },
        // Arc Reconstruction with adjusted thresholds
        'arc-reconstruction': {
            shapes: {
                circle1: {
                    type: 'circle',
                    center: { x: 300, y: 400 },
                    radius: 90,
                    segments: 96  // Increased for better reconstruction
                },
                circle2: {
                    type: 'circle', 
                    center: { x: 500, y: 400 },
                    radius: 70,
                    segments: 96
                }
            },
            defaults: {
                operation: 'union',
                showReconstruction: true,
                showMetadata: false,
                circle1Radius: 90,
                circle2Radius: 70,
                circle1Pos: { x: 300, y: 400 },
                circle2Pos: { x: 500, y: 400 }
            },
            reconstruction: {
                polygonFill: 'rgba(59, 130, 246, 0.2)',
                polygonStroke: '#3b82f6',
                reconstructedStroke: '#ff9900',
                reconstructedFill: 'rgba(255, 153, 0, 0.1)',
                reconstructedWidth: 3,
                markerRadius: 4,
                startMarkerColor: '#00ff00',
                endMarkerColor: '#ff0000'
            }
        },
        // Offset test shapes - centered at 400,400
        offset: {
            shapes: {
                star: {
                    type: 'parametric',
                    shape: 'star',
                    center: [400, 400],
                    outerRadius: 200,
                    innerRadius: 100,
                    points: 7
                },
                circle: {
                    type: 'parametric',
                    shape: 'circle',
                    center: [400, 400],
                    radius: 200
                },
                square: {
                    type: 'polygon',
                    data: [[250, 250], [550, 250], [550, 550], [250, 550]]
                },
                triangle: {
                    type: 'polygon',
                    data: [[400, 200], [550, 500], [250, 500]]
                },
                bottleneck: {
                    type: 'polygon',
                    data: [[300, 300], [500, 300], [430, 400], [500, 500], [300, 500], [370, 400]]
                }
            },
            defaults: {
                shape: 'star',
                type: 'external',
                count: 3,
                distance: 10,
                joinType: 'Round',
                miterLimit: 10
            }
        },
        minkowski: {
            patterns: {
                circle: {
                    type: 'parametric',
                    shape: 'circle',
                    center: [0, 0],
                    radius: 30,
                    displayName: 'Circle (r=30)',
                    equivalentRadius: 30
                },
                square: {
                    type: 'polygon',
                    data: [[-20, -20], [20, -20], [20, 20], [-20, 20]],
                    displayName: 'Square (40x40)',
                    equivalentRadius: 28.28
                },
                triangle: {
                    type: 'polygon',
                    data: [[0, -24], [20, 12], [-20, 12]],
                    displayName: 'Triangle',
                    equivalentRadius: 24
                },
                star: {
                    type: 'parametric',
                    shape: 'star',
                    center: [0, 0],
                    outerRadius: 30,
                    innerRadius: 14,
                    points: 5,
                    displayName: 'Star (5 points)',
                    equivalentRadius: 30
                },
                diamond: {
                    type: 'polygon',
                    data: [[0, -30], [20, 0], [0, 30], [-20, 0]],
                    displayName: 'Diamond',
                    equivalentRadius: 30
                },
                hex: {
                    type: 'polygon',
                    data: [[30, 0], [15, 26], [-15, 26], [-30, 0], [-15, -26], [15, -26]],
                    displayName: 'Hexagon',
                    equivalentRadius: 30
                }
            },
            paths: {
                line: {
                    type: 'polygon',
                    data: [[160, 400], [640, 400]],
                    displayName: 'Horizontal Line',
                    isClosed: false
                },
                triangle: {
                    type: 'polygon',
                    data: [[400, 200], [600, 500], [200, 500]],
                    displayName: 'Triangle Path',
                    isClosed: true
                },
                square: {
                    type: 'polygon',
                    data: [[240, 240], [560, 240], [560, 560], [240, 560]],
                    displayName: 'Square Path',
                    isClosed: true
                },
                concave: {
                    type: 'polygon',
                    data: [[200, 200], [400, 200], [400, 300], [300, 300], [300, 500], [500, 500], [500, 200], [600, 200], [600, 600], [200, 600]],
                    displayName: 'Concave Path',
                    isClosed: true
                },
                zigzag: {
                    type: 'polygon',
                    data: [[160, 300], [280, 500], [400, 320], [520, 500], [640, 300]],
                    displayName: 'Zigzag Path',
                    isClosed: true
                },
                lshape: {
                    type: 'polygon',
                    data: [[200, 200], [200, 560], [560, 560]],
                    displayName: 'L-Shape Path',
                    isClosed: false
                }
            },
            defaults: {
                pattern: 'circle',
                path: 'square',
                operation: 'sum',
                pathClosed: true,
                showSweep: false,
                showOffset: false,
                sweepSteps: 8,
                patternPos: { x: 200, y: 400 }
            }
        },
        simplify: {
            type: 'svg',
            path: SVG_PATHS.rabbit,
            scale: 1.6,
            defaultTolerance: 2,
            position: [160, 10]
        },
        pip: {
            type: 'polygon',
            data: [[200, 100], [600, 200], [700, 400], [500, 700], [100, 600], [100, 300]],
            edgeTolerance: 6
        },
        area: {
            gridSize: 40,
            minPoints: 3,
            pointRadius: 8
        }
    },

    styles: {
        default: {
            fillOuter: 'var(--shape-fill)',
            strokeOuter: 'var(--shape-stroke)',
            fillHole: 'var(--canvas-bg)',
            strokeHole: 'var(--hole-stroke)',
            strokeWidth: 2
        },
        input: {
            fillOuter: 'var(--input-fill)',
            strokeOuter: 'var(--input-stroke)',
            strokeWidth: 1
        },
        output: {
            fillOuter: 'var(--output-fill)',
            strokeOuter: 'var(--output-stroke)',
            strokeWidth: 2
        },
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
        },
        minkowski: {
            pattern: {
                fillOuter: 'none',
                strokeOuter: '#3b82f6',
                strokeWidth: 2
            },
            path: {
                fillOuter: 'none',
                strokeOuter: '#6b7280',
                strokeWidth: 2
            },
            sumResult: {
                fillOuter: 'rgba(16, 185, 129, 0.5)',
                strokeOuter: '#10b981',
                strokeWidth: 2
            },
            diffResult: {
                fillOuter: 'rgba(239, 68, 68, 0.5)',
                strokeOuter: '#ef4444',
                strokeWidth: 2
            },
            sweep: {
                markerColor: 'rgba(59, 130, 246, 0.6)',
                markerRadius: 3,
                outlineAlpha: 0.3,
                strokeWidth: 1
            },
            sweepSum: {
                markerColor: 'rgba(16, 185, 129, 0.6)',
                markerRadius: 3
            },
            sweepDiff: {
                markerColor: 'rgba(239, 68, 68, 0.6)',
                markerRadius: 3
            }
        },
        arcReconstruction: {
            polygon: {
                fillOuter: 'rgba(59, 130, 246, 0.2)',
                strokeOuter: '#3b82f6',
                strokeWidth: 1
            },
            reconstructed: {
                strokeColor: '#ff9900',
                fillColor: 'rgba(255, 153, 0, 0.1)',
                lineWidth: 3,
                fill: false
            },
            metadata: {
                pointRadius: 2,
                normalPointColor: '#666',
                taggedPointColor: 'dynamic'
            },
            markers: {
                startColor: '#00ff00',
                endColor: '#ff0000',
                radius: 3
            }
        }
    },

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
        },
        minkowski: {
            expectedMinPaths: 1,
            description: 'Minkowski operation should produce at least one path'
        },
        arcReconstruction: {
            expectedMinCurves: 1,
            description: 'Arc reconstruction should identify at least one curve'
        }
    },

    labels: {
        inputGeometry: 'Input Geometry',
        outputGeometry: 'Output Geometry',
        processing: 'Processing...',
        ready: 'Ready to run test',
        error: 'Error: ',
        warning: 'Warning: ',
        success: 'Success: '
    },

    generators: {
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
        strokeToPolygon(stroke, width) {
            if (stroke.type === 'line') {
                return this.lineToPolygon(stroke.from, stroke.to, width);
            } else if (stroke.type === 'arc') {
                return this.arcToPolygon(stroke.center, stroke.radius, stroke.start, stroke.end, width);
            }
            return [];
        },
        lineToPolygon(from, to, width) {
            const dx = to[0] - from[0];
            const dy = to[1] - from[1];
            const len = Math.sqrt(dx * dx + dy * dy);
            const halfWidth = width / 2;

            if (len === 0) return this.circle(from[0], from[1], halfWidth, 16);

            const ux = dx / len;
            const uy = dy / len;

            const nx = uy * halfWidth;
            const ny = -ux * halfWidth;

            const points = [];
            const capSegments = 8;

            points.push([from[0] - nx, from[1] - ny]);

            const startAngle = Math.atan2(-ny, -nx);
            for (let i = 1; i < capSegments; i++) {
                const t = i / capSegments;
                const angle = startAngle + Math.PI * t;
                points.push([
                    from[0] + halfWidth * Math.cos(angle),
                    from[1] + halfWidth * Math.sin(angle)
                ]);
            }

            points.push([from[0] + nx, from[1] + ny]);
            points.push([to[0] + nx, to[1] + ny]);

            const endAngle = Math.atan2(ny, nx);
            for (let i = 1; i < capSegments; i++) {
                const t = i / capSegments;
                const angle = endAngle + Math.PI * t;
                points.push([
                    to[0] + halfWidth * Math.cos(angle),
                    to[1] + halfWidth * Math.sin(angle)
                ]);
            }

            points.push([to[0] - nx, to[1] - ny]);

            return points;
        },
        arcToPolygon(center, radius, startDeg, endDeg, width) {
            const points = [];
            const segments = 32;
            const capSegments = 8;
            const halfWidth = width / 2;
            const innerR = radius - halfWidth;
            const outerR = radius + halfWidth;
            if (innerR < 0) return [];
            const startRad = startDeg * Math.PI / 180;
            const endRad = endDeg * Math.PI / 180;

            const startCapCenter = [
                center[0] + radius * Math.cos(startRad),
                center[1] + radius * Math.sin(startRad)
            ];
            const endCapCenter = [
                center[0] + radius * Math.cos(endRad),
                center[1] + radius * Math.sin(endRad)
            ];

            for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                const angle = startRad + (endRad - startRad) * t;
                points.push([
                    center[0] + outerR * Math.cos(angle),
                    center[1] + outerR * Math.sin(angle)
                ]);
            }

            for (let i = 1; i <= capSegments; i++) {
                const t = i / capSegments;
                const angle = endRad + (Math.PI * t);
                points.push([
                    endCapCenter[0] + halfWidth * Math.cos(angle),
                    endCapCenter[1] + halfWidth * Math.sin(angle)
                ]);
            }

            for (let i = segments; i >= 0; i--) {
                const t = i / segments;
                const angle = startRad + (endRad - startRad) * t;
                points.push([
                    center[0] + innerR * Math.cos(angle),
                    center[1] + innerR * Math.sin(angle)
                ]);
            }

            for (let i = 1; i <= capSegments; i++) {
                const t = i / capSegments;
                const angle = (startRad + Math.PI) + (Math.PI * t);
                points.push([
                    startCapCenter[0] + halfWidth * Math.cos(angle),
                    startCapCenter[1] + halfWidth * Math.sin(angle)
                ]);
            }

            return points;
        },
        
        flower(cx, cy, baseRadius, noiseFreq, noiseAmp, segments = 64) {
            const points = [];
            for (let i = 0; i < segments; i++) {
                const angle = (i / segments) * Math.PI * 2;
                const noise = Math.sin(angle * noiseFreq) * noiseAmp;
                const r = baseRadius + noise;
                points.push([
                    cx + r * Math.cos(angle),
                    cy + r * Math.sin(angle)
                ]);
            }
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