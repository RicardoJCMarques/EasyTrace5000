/*!
 * @file        config.js
 * @description Centralized application configuration
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

/*
 *
 * Architecture:
 *   config.constants — Frozen at runtime (Object.freeze). Algorithmic thresholds,
 *                      format specs, engine limits, UI schema. Never saved or exported.
 *   config.defaults  — Factory-reset values for all user-facing settings. Cloned by
 *                      SettingsManager on startup, overridable via JSON import.
 *   config.*()       — Helper methods (root level, read from both sections).
 */

window.PCBCAMConfig = {

    // ╔═══════════════════════════════════════════════════════════════════════╗
    // ║  CONSTANTS                                                            ║
    // ║  Frozen at runtime. Changing these breaks math, crashes WASM, or      ║
    // ║  violates file format specs. Never persisted, exported, or imported.  ║
    // ╚═══════════════════════════════════════════════════════════════════════╝
    constants: {

        // ====================================================================
        // PRECISION
        //
        // Canonical tolerance values. Every module references these instead of
        // hardcoding numbers. When adding a new tolerance, check if an existing
        // one already covers the use case before creating a new entry.
        //
        // ====================================================================
        precision: {
            // Geometric comparisons (pure math — never change these)
            epsilon: 1e-9,              // Floating-point near-zero. Guard divisions, cross-product zero checks.
            collinear: 1e-12,           // Stricter near-zero for geometric collinearity where even tiny deviations matter.
            collinearDot: 0.995,        // Dot-product angle threshold. Unit vectors with dot > this are "parallel enough."

            // Spatial thresholds (mm — scale-dependent, but fixed for PCB)
            coordinate: 0.001,          // Coordinate quantization grid. All coordinates snap to this resolution.
            pointMatch: 0.01,           // "Same location" tolerance. 10× coordinate to absorb accumulated FP drift across multi-step pipelines (parse → offset → transform → toolpath).
            zeroLength: 0.001,          // Degenerate geometry detection. Segments shorter than this are collapsed.
            rdpSimplification: 0.005,   // Douglas-Peucker polygon simplification. Tames KiCad pour noise without affecting intentional geometry.

            // Output formatting // REVIEW - Not Connected? Should it be?
            display: 3                  // Decimal places for UI readouts and export coordinate formatting.
        },

        // ====================================================================
        // GEOMETRY ENGINE
        // ====================================================================
        geometry: {
            clipperScale: 10000,        // Integer scale factor for Clipper2 WASM. 1/10000 = 0.1µm resolution. // REVIEW - Best way to handle scale when including other CAM tools beyond EasyTrace5000 with larger objects? 
            maxCoordinate: 1000,        // Maximum valid coordinate magnitude (mm). Beyond this = suspicious.

            // REVIEW - Min and Max are dead code? metadataPacking is hardcoded in the wrapper, worth connecting?
            clipper: {
                minScale: 1000,
                maxScale: 1000000,
                metadataPacking: {      // Bit layout for Z-metadata encoding in Clipper2 integer coordinates.
                    curveIdBits: 24,
                    segmentIndexBits: 31,
                    clockwiseBit: 1,
                    reservedBits: 8
                }
            },

            segments: {                 // Tessellation quality. Tuned for visual fidelity at PCB scale.
                targetLength: 0.01,
                minCircle: 256,
                maxCircle: 2048,
                minArc: 200,
                maxArc: 2048,
                obround: 128,
                adaptiveSegmentation: true,
                minEndCap: 32,
                maxEndCap: 256,
                defaultMinSegments: 16,
                defaultFallbackSegments: { min: 32, max: 128 }
            },

            tessellation: {
                bezierSegments: 32,
                minEllipticalSegments: 8
            },

            arcReconstruction: {
                minArcPoints: 2,
                maxGapPoints: 1,
                minCirclePoints: 4,
                smallCircleRadiusThreshold: 1.0,  // REVIEW - Tesselation has it's own defaults?
                smallCircleSegments: 16,  // REVIEW - Tesselation has it's own defaults?
                defaultCircleSegments: 48,  // REVIEW - Tesselation has it's own defaults?
                fullCircleThreshold: 0.99   // Fraction of 2π above which an arc group is treated as a complete circle. // REVIEW - Dead code? needing 100% of points is working fine?
            },

            curveRegistry: {
                hashPrecision: 1000
            },

            edgeKeyPrecision: 3,
            // REVIEW - Not Connected? Should it be?
            fillRule: 'nonzero'
        },

        // ====================================================================
        // FILE FORMAT SPECIFICATIONS
        // ====================================================================
        formats: {
            excellon: {
                defaultFormat: { integer: 2, decimal: 4 },
                defaultUnits: 'mm',
                defaultToolDiameter: 1.0,
                minToolDiameter: 0.1,
                maxToolDiameter: 10.0,
                toolKeyPadding: 2
            },
            gerber: {
                defaultFormat: { integer: 3, decimal: 3 },
                defaultUnits: 'mm',
                defaultAperture: 0.1,
                minAperture: 0.01,
                maxAperture: 10.0
            },
            svg: {
                defaultStyles: {
                    fill: 'black',
                    fillOpacity: 1.0,
                    stroke: 'none',
                    strokeWidth: 1.0,
                    strokeOpacity: 1.0,
                    display: 'inline',
                    visibility: 'visible'
                }
            }
        },

        // ====================================================================
        // RENDERER ENGINE
        // ====================================================================
        renderer: {
            context: {
                alpha: false,
                desynchronized: true
            },
            lodThreshold: 1,
            zoom: {
                fitPadding: 1.1,
                fitPaddingWithOrigin: 1.35,
                factor: 1.2,
                min: 0.01,
                max: 3000
            },
            emptyCanvas: {
                originMarginLeft: 0.10,
                originMarginBottom: 0.12,
                defaultScale: 10
            },
            overlay: {
                gridLineWidth: 0.1,
                originStrokeWidth: 3,
                originOutlineWidth: 1,
                boundsLineWidth: 1,
                boundsDash: [2, 2],
                boundsMarkerSize: 5,
                boundsMarkerWidth: 2,
                rulerLineWidth: 1,
                rulerFont: '11px Arial',
                rulerCornerFont: '9px Arial',
                rulerCornerText: 'mm',
                rulerMinPixelStep: 50,
                rulerAlpha: '99',
                scaleIndicatorPadding: 10,
                scaleIndicatorBarHeight: 4,
                scaleIndicatorYOffset: 20,
                scaleIndicatorTargetPixels: 100,
                scaleIndicatorMinPixels: 50,
                scaleIndicatorEndCapWidth: 2,
                scaleIndicatorEndCapHeight: 4,
                scaleIndicatorFont: '11px Arial',
                statsX: 10,
                statsY: 50,
                statsLineHeight: 16,
                statsBGWidth: 200,
                statsFont: '12px monospace'
            },
            interaction: {
                cursorGrabbing: 'grabbing',
                cursorGrab: 'grab',
                coordPrecision: 2,
                zoomPrecision: 0
            },
            primitives: {
                offsetStrokeWidth: 1,
                centerMarkStrokeWidth: 3,
                sourceDrillStrokeWidth: 3,
                sourceDrillMarkSize: 0.2,
                sourceDrillMarkRatio: 0.4,
                peckMarkStrokeWidth: 3,
                peckMarkMarkSize: 0.2,
                peckMarkMarkRatio: 0.4,
                peckMarkDash: [0.15, 0.15],
                peckMarkRingFactor: 1.3,
                peckMarkLabelOffset: 0.3,
                reconstructedStrokeWidth: 2,
                reconstructedCenterSize: 2,
                reconstructedPathDash: [5, 5],
                defaultStrokeWidth: 0.1,
                debugPointSize: 4,
                debugFont: '11px monospace',
                debugLabelLineWidth: 2,
                debugArcStrokeWidth: 3,
                debugArcCenterSize: 4,
                debugContourStrokeWidth: 2,
                debugContourDash: [5, 5]
            }
        },

        // ====================================================================
        // LASER PROFILE DEFINITIONS
        // ====================================================================
        // REVIEW - Dead code? Worth reviving? Too granular, HTML is fine?
        // laserProfiles: {
        //     uv: {
        //         label: 'UV Laser',
        //         description: 'Direct copper ablation, stencil cutting, drilling, board cutout',
        //         laserClass: 'cold'
        //     },
        //     fiber: {
        //         label: 'Fiber Laser',
        //         description: 'Copper ablation, stencil cutting, selective reflow soldering',
        //         laserClass: 'hot'
        //     }
        // },

        // ====================================================================
        // STORAGE KEYS
        // ====================================================================
        storageKeys: {
            theme: 'pcbcam-theme',
            hideWelcome: 'pcbcam-hide-welcome',
            settings: 'pcbcam-settings',
            pipeline: 'pcbcam-pipeline'
        },

        // ====================================================================
        // PERFORMANCE: ENGINE-LEVEL
        // Parameters that would crash the app or cause infinite loops if
        // corrupted by a bad settings import. Keep frozen.
        // ====================================================================
        // performance: {
        //     REVIEW - Useless?
        //     wasm: {
        //         memoryLimit: 256,
        //         stackSize: 1024 * 1024,
        //         enableSIMD: true,
        //         enableThreads: true
        //     },
        //     REVIEW - Useless?
        //         batching: {
        //         maxPrimitivesPerBatch: 2000,
        //         fusionBatchSize: 200,
        //         renderBatchSize: 1000,
        //         parseChunkSize: 10000
        //     }
        // },

        // ====================================================================
        // UI SCHEMA
        // Validation constraints, parameter option enums, category labels,
        // icon mappings, static text. These define UI structure, not preferences.
        // ====================================================================
        ui: {
            validation: {
                toolDiameter: { min: 0.01, max: 10, step: 0.01 },
                feedRate: { min: 1, max: 5000, step: 1 },
                spindleSpeed: { min: 100, max: 30000, step: 1 },
                spindleDwell: { min: 0, max: 60, step: 0.5 },
                plungeRate: { min: 1, max: 2000, step: 1 },
                passes: { min: 1, max: 30, step: 1 },
                stepOver: { min: 10, max: 99, step: 5 },
                cutDepth: { min: -10, max: 0, step: 0.001 },
                depthPerPass: { min: 0.001, max: 5, step: 0.001 },
                peckDepth: { min: 0, max: 5, step: 0.01 },
                dwellTime: { min: 0, max: 10, step: 0.1 },
                retractHeight: { min: 0, max: 10, step: 0.01 },
                tabs: { min: 0, max: 12, step: 1 },
                tabWidth: { min: 0.5, max: 10, step: 0.1 },
                tabHeight: { min: 0.1, max: 5, step: 0.1 },
                travelZ: { min: 0, max: 50, step: 0.1 },
                safeZ: { min: 0, max: 50, step: 0.1 },
                laserSpotSize: { min: 0.01, max: 1.0, step: 0.01 },
                laserIsolationWidth: { min: 0.05, max: 2.5, step: 0.01 },
                laserStepOver: { min: 10, max: 99, step: 5 },
                laserHatchAngle: { min: 0, max: 180, step: 5 },
                laserExportPadding: { min: 0, max: 10, step: 0.5 }
            },

            parameterOptions: {
                direction: [
                    { value: 'climb', label: 'Climb' },
                    { value: 'conventional', label: 'Conventional' }
                ],
                entryType: [
                    { value: 'plunge', label: 'Plunge' },
                    // { value: 'ramp', label: 'Ramp' }, // Needs more developement - not currently viable
                    { value: 'helix', label: 'Helix' }
                ],
                cannedCycle: [
                    { value: 'none', label: 'None (G0 + G1)' },
                    { value: 'G81', label: 'G81 - Simple Drill' },
                    { value: 'G82', label: 'G82 - Dwell' },
                    { value: 'G83', label: 'G83 - Peck' },
                    { value: 'G73', label: 'G73 - Peck (Stepped)' }
                ],
                cutSide: [
                    { value: 'outside', label: 'Outside' },
                    { value: 'inside', label: 'Inside' },
                    { value: 'on', label: 'On Line' }
                ],
                workOffset: [
                    { value: 'G54', label: 'G54' },
                    { value: 'G55', label: 'G55' },
                    { value: 'G56', label: 'G56' }
                ],
                laserClearStrategy: [
                    { value: 'filled', label: 'Filled Polygon — Laser software controls fill' },
                    { value: 'offset', label: 'Offset Paths — Concentric, streak-proof' },
                    { value: 'hatch', label: 'Parallel Scan — Directional coverage' }
                ],
                laserCutSide: [
                    { value: 'outside', label: 'Outside (Kerf outward)' },
                    { value: 'inside', label: 'Inside (Kerf inward)' },
                    { value: 'on', label: 'On Line (No compensation)' }
                ],
                laserExportFormat: [
                    { value: 'svg', label: 'SVG — Vector for LightBurn, RDWorks, LaserGRBL' },
                    { value: 'png', label: 'PNG — Raster image import' }
                ]
            },

            operationPanel: {
                categories: {
                    tool: 'Tool Selection',
                    offset: 'Offset Generation',
                    depth: 'Depth Settings',
                    feeds: 'Feeds & Speeds',
                    strategy: 'Cutting Strategy',
                    drill: 'Peck Drill Parameters',
                    cutout: 'Cutout Settings',
                    stencil: 'Stencil Settings',
                    machine: 'Machine Configuration',
                    general: 'General Settings',
                    laser_tool: 'Laser Tool',
                    laser_geometry: 'Isolation',
                    laser_strategy: 'Clearing Strategy',
                    laser_cutout: 'Cut Settings',
                    laser_export: 'Export Settings'
                },
                textAreaStyle: {
                    fontFamily: 'monospace',
                    fontSize: '11px'
                }
            },

            icons: {
                treeWarning: '⚠️',
                offsetCombined: '⇔️',
                offsetPass: '↔️',
                preview: '👁️',
                toolpath: '🔧',
                defaultGeometry: '📊',
                modalDragHandle: '☰',
                tooltipTrigger: '?'
            },

            text: {
                noToolsAvailable: 'No tools available',
                gcodePlaceholder: 'Click "Calculate Toolpaths" to generate G-code',
                gcodeNoExportAlert: 'No G-code to export',
                statusReady: 'Ready - Add PCB files to begin - Click here to expand log',
                statusLoading: 'Loading...',
                statusProcessing: 'Processing...',
                statusSuccess: 'Operation completed successfully',
                statusError: 'An error occurred',
                statusWarning: 'Warning',
                logHintViz: 'Toggle verbose debug messages in the Viz Panel.'
            }
        }
    },


    // ╔═══════════════════════════════════════════════════════════════════════╗
    // ║  DEFAULTS                                                             ║
    // ║  Factory-reset values for all user-facing settings. SettingsManager   ║
    // ║  deep-clones this on startup, then merges localStorage and any        ║
    // ║  imported JSON over the clone. A bad value here produces suboptimal   ║
    // ║  but recoverable results — it never crashes the engine.               ║
    // ╚═══════════════════════════════════════════════════════════════════════╝
    defaults: {

        // ====================================================================
        // OPERATIONS
        // ====================================================================
        operations: {
            isolation: {
                name: 'Isolation Routing',
                extensions: ['.gbr', '.ger', '.gtl', '.gbl', '.svg'],
                defaultTool: 'em_0.2mm_flat',
                cutting: {
                    cutDepth: -0.04,
                    depthPerPass: 0.04,
                    feedRate: 100,
                    plungeRate: 50,
                    spindleSpeed: 10000
                },
                defaultSettings: {
                    passes: 3,
                    stepOver: 50,
                    multiDepth: false,
                    entryType: 'plunge'
                }
            },
            drill: {
                name: 'Drilling',
                extensions: ['.drl', '.xln', '.txt', '.drill', '.exc', '.svg'],
                defaultTool: 'drill_1.0mm',
                cutting: {
                    cutDepth: -1.8,
                    depthPerPass: 0.5,
                    feedRate: 50,
                    plungeRate: 25,
                    spindleSpeed: 10000
                },
                strategy: {
                    minMillingMargin: 0.05,
                    minMillingFeatureSize: 0.01
                },
                defaultSettings: {
                    millHoles: true,
                    multiDepth: true,
                    cannedCycle: 'none',
                    peckDepth: 0,
                    dwellTime: 0,
                    retractHeight: 0.5,
                    entryType: 'helix'
                }
            },
            clearing: {
                name: 'Copper Clearing',
                extensions: ['.gbr', '.ger', '.gpl', '.gp1', '.gnd', '.svg'],
                defaultTool: 'em_0.8mm_flat',
                cutting: {
                    cutDepth: -0.1,
                    depthPerPass: 0.1,
                    feedRate: 200,
                    plungeRate: 50,
                    spindleSpeed: 10000
                },
                defaultSettings: {
                    passes: 4,
                    stepOver: 50,
                    multiDepth: false,
                    entryType: 'plunge'
                }
            },
            cutout: {
                name: 'Board Cutout',
                extensions: ['.gbr', '.gko', '.gm1', '.outline', '.mill', '.svg'],
                defaultTool: 'em_1.0mm_flat',
                cutting: {
                    cutDepth: -1.8,
                    depthPerPass: 0.3,
                    feedRate: 150,
                    plungeRate: 50,
                    spindleSpeed: 10000
                },
                defaultSettings: {
                    passes: 1,
                    stepOver: 100,
                    tabs: 0,
                    tabWidth: 0,
                    tabHeight: 0,
                    multiDepth: true,
                    entryType: 'plunge',
                    cutSide: 'outside'
                }
            },
            stencil: {
                name: 'Solder Stencil',
                extensions: ['.gtp', '.gbp', '.gts', '.gbs', '.gbr', '.ger', '.svg'],
                defaultTool: null,
                cutting: null,
                defaultSettings: {
                    stencilOffset: -0.08,
                    stencilIgnoreRegions: true,
                    stencilExcludeDrillPads: true,
                    stencilAddRegHoles: false,
                    stencilRegDiameter: 3.0,
                    stencilRegMargin: 5.0
                }
            }
        },

        // ====================================================================
        // MACHINE
        // ====================================================================
        machine: {
            pcb: {
                thickness: 1.6,
                copperThickness: 0.035,
                minFeatureSize: 0.1
            },
            heights: {
                safeZ: 5.0,
                travelZ: 2.0,
                feedHeight: 1.0,    // Clearance above Z0 where G0→G1 handoff occurs.
                // REVIEW - probeZ and homeZ may be mislabeled? Or just useless?
                probeZ: -5.0,
                homeZ: 10.0
            },
            speeds: {
                rapidFeed: 1000,
                probeFeed: 25,
                maxFeed: 2000,
                maxAcceleration: 100
            },
            // REVIEW - There is currently no workspace validation
            // workspace: {
            //     system: 'G54',
            //     maxX: 200,
            //     maxY: 200,
            //     maxZ: 50,
            //     minX: 0,
            //     minY: 0,
            //     minZ: -5
            // },
            coolant: 'none',
            vacuum: false
        },

        // ====================================================================
        // G-CODE GENERATION
        // ====================================================================
        gcode: {
            postProcessor: 'grbl',
            units: 'mm',

            decimals: {
                coordinates: 3,
                feedrate: 0,
                spindle: 0,
                arc: 3
            },

            enableOptimization: true,

            // REVIEW - How many are disconnected? How many should be connected?
            optimization: {
                enableGrouping: true,
                pathOrdering: true,
                segmentSimplification: true,
                leadInOut: true,
                zLevelGrouping: true,
                rapidStrategy: 'adaptive',
                shortTravelThreshold: 5.0,
                reducedClearance: 1.0,
                angleTolerance: 0.1,
                minSegmentLength: 0.01,
                planSamplePoints: 20
            }
        },

        // ====================================================================
        // LASER PIPELINE
        // ====================================================================
        laser: {
        // Global Machine & Pipeline Settings
            spotSize: 0.02,
            exportFormat: 'svg',
            exportDPI: 1000,
            exportPadding: 5.0,
            defaultClearStrategy: 'offset',

            svgGrouping: 'none',
            reverseCutOrder: false,
            heatManagement: 'standard',
            colorPerPass: false,

            // Active profile key — drives structural SVG decisions
            activeProfile: 'generic',

            // Profile definitions — each represents a laser control software target
            profiles: {
                generic: {
                    label: 'Generic (Very Experimental)',
                    svgGrouping: 'layer',
                    reverseCutOrder: false,
                    heatManagement: 'standard', // Sort primitives smallest-first within each pass
                    colorPerPass: false, // Assign unique hue-rotated color per pass for color-mapped layers
                    layerColors: {
                        isolation: '#ff0000',
                        drill:     '#0000ff',
                        clearing:  '#00ff00',
                        cutout:    '#000000',
                        stencil:   '#860694'
                    }
                },
                lasergrbl: {
                    label: 'LaserGRBL (Very Experimental)',
                    svgGrouping: 'group',        // Standard SVG groups; LaserGRBL imports grouped geometry as separate operations
                    reverseCutOrder: false,
                    heatManagement: 'standard',
                    colorPerPass: false,
                    layerColors: {
                        isolation: '#ff0000',
                        drill:     '#0000ff',
                        clearing:  '#00ff00',
                        cutout:    '#000000',
                        stencil:   '#860694'
                    }
                },
                xToolStudio: {
                    label: 'xTool Studio (Less Experimental)',
                    svgGrouping: 'color',
                    reverseCutOrder: true,
                    heatManagement: 'standard',
                    colorPerPass: true,
                    paletteLumping: true,
                    // The exact 16 colors xCS maps to layers, ordered from Smallest/Delicate to Largest/Lumped
                    palette: [
                        '#EB3DBA', '#FE0002', '#FF7F56', '#E1C000', '#C29900', 
                        '#96D71D', '#00C715', '#00897B', '#2366FF', '#00BEFE', 
                        '#8170EF', '#A958FF', '#582FA8', '#D9D9D9', '#848B96',
                        '#000000'
                    ],
                    layerColors: {
                        isolation: '#FE0002',
                        drill:     '#2366FF',
                        clearing:  '#FE0002',
                        cutout:    '#2366FF',
                        stencil:   '#582FA8'
                    }
                },
                lightburn: {
                    label: 'LightBur (Very Experimental)n',
                    svgGrouping: 'none',           // LightBurn prefers flat geometry; it builds its own layer tree from colors
                    reverseCutOrder: true,         // LightBurn reads SVG bottom-to-top; reverse so first-in-file = first-cut
                    heatManagement: 'standard',    // Sort primitives smallest-first within each pass
                    colorPerPass: true,            // Assign unique hue-rotated color per pass
                    layerColors: {
                        isolation: '#ff0000',
                        drill:     '#0000ff',
                        clearing:  '#00ff00',
                        cutout:    '#000000',
                        stencil:   '#860694'
                    }
                },
                rdworks: {
                    label: 'RDWorks / Ruida (Very Experimental)',
                    svgGrouping: 'layer',          // RDWorks maps Inkscape layers to its own laser layers
                    reverseCutOrder: false,        // RDWorks processes layers top-to-bottom (standard DOM order)
                    heatManagement: 'off',         // RDWorks handles its own optimization internally
                    colorPerPass: false,           // Single color per layer; RDWorks assigns power/speed per layer, not per color // REVIEW - add a color per layer toggle?
                    layerColors: {
                        isolation: '#ff0000',
                        drill:     '#00ff00',
                        clearing:  '#0000ff',
                        cutout:    '#000000',
                        stencil:   '#ff00ff'
                    }
                }
            },

            // Runtime layer colors — synced from active profile on selection. // REVIEW - Should hatch have it's own dedicated color hardcoded here too?
            layerColors: {
                isolation: '#ff0000',
                drill:     '#0000ff',
                clearing:  '#00ff00',
                cutout:    '#000000',
                stencil:   '#860694'
            },

            // Strategy Definitions
            // REVIEW - Dead code, worth reviving?
            // strategies: {
            //     filled: { label: 'Filled Polygon', requiresPaths: false, svgOnly: false },
            //     offset: { label: 'Offset Paths', requiresPaths: true,  svgOnly: true },
            //     hatch:  { label: 'Hatch', requiresPaths: true,  svgOnly: true, hasAngle: true }
            // },

            // Operation-Specific Overrides
            operations: {
                isolation: { laserIsolationWidth: 0.4, laserStepOver: 10, laserClearStrategy: 'offset', laserHatchAngle: 0 },
                clearing: { laserClearingPadding: 1.0, laserStepOver: 10, laserClearStrategy: 'offset', laserHatchAngle: 0 },
                cutout: { laserCutSide: 'outside' },
                drill:  { laserCutSide: 'inside' }
            }
        },

        // ====================================================================
        // GEOMETRY PROCESSING
        // Tunable parameters affecting output quality, not correctness.
        // ====================================================================
        geometry: {
            offsetting: {
                miterLimit: 2.0,
                minRoundJointSegments: 2
            },
            fusion: {
                preserveArcs: true
            },
            // REVIEW - Dead code? Regions are handled automatically or worst case scenario the user is prompted
            implicitRegionClosure: {
                enabled: true,
                cutoutOnly: true,
                warnOnFailure: true
            },
            // REVIEW - Analytic offsetting values? Can be disabled?
            selfIntersection: {
                enabled: true,
                gridCellFactor: 4,
                endpointExclusion: 1e-6,
                spatialDedup: 0.0001,
                minLoopArea: 1e-6,
                maxPasses: 3
            },
            simplification: {
                enabled: true
            }
        },

        // ====================================================================
        // TOOLPATH GENERATION
        // ====================================================================
        toolpath: {
            generation: {
                defaultFeedRate: 150,
                rapidClearance: 0.1,
                entry: {
                    helix: {
                        radiusFactor: 0.4,
                        pitch: 0.5,
                        segmentsPerRevolution: 16
                    },
                    // REVIEW - MachineProcessor tries to look up context.strategy.entryRampAngle? Disconnected for now anyway
                    ramp: {
                        defaultAngle: 10,
                        shallowDepthFactor: 0.1
                    }
                },
                drilling: {
                    peckRapidClearance: 0.1,
                    helixPitchFactor: 0.5,
                    helixMaxDepthFactor: 3.0,
                    helixSegmentsPerRev: 16,
                    slotHelixSegments: 12,
                    slotHelixMaxPitchFactor: 0.5,
                    minHelixDiameter: 0.2,
                    defaultStepOver: 40
                },
                rapidCost: {
                    zTravelThreshold: 5.0,
                    zCostFactor: 1.5,
                    baseCost: 10000
                },
                // REVIEW - dead code?
                // staydown: {
                //     toleranceFactor: 0.1,       // Factor of toolDiameter for staydown margin.
                //     improvementThreshold: 0.7
                // },
                simplification: {
                    minArcLength: 0.01,
                    curveToleranceFactor: 100.0,
                    curveToleranceFallback: 0.0005,
                    straightToleranceFactor: 10.0,
                    straightToleranceFallback: 0.005,
                    straightAngleThreshold: 1.0,
                    sharpAngleThreshold: 10.0,
                    sharpCornerTolerance: 0.00001,
                    segmentThresholdFactor: 10.0,
                    segmentThresholdFallback: 0.5
                }
            },
            tabs: {
                cornerMarginFactor: 2.0,
                minCornerAngle: 30,
                minTabLength: 5
            }
        },

        // ====================================================================
        // EXPORT
        // ====================================================================
        export: {
            defaultBaseName: 'pcb-output',
            svg: {
                padding: 5,
                includeMetadata: true,
                useViewBox: true,
                embedStyles: true,
                styles: {
                    wireframeStrokeWidth: 0.05,
                    cutoutStrokeWidth: 0.1
                }
            }
        },

        // ====================================================================
        // UI LAYOUT
        // ====================================================================
        // REVIEW - Possibly disconnected dead code, consider if worth connecting or letting CSS do it's thing, could be relevant if users are allowed to move it in the future
        layout: {
            sidebarLeftWidth: 320,
            sidebarRightWidth: 380,
            statusBarHeight: 32,
            sectionHeaderHeight: 36,
            ui: {
                autoTransition: true,
                transitionDelay: 125
            }
        },

        // ====================================================================
        // RENDERING PREFERENCES
        // ====================================================================
        rendering: {
            defaultOptions: {
                showWireframe: false,
                showPads: true,
                blackAndWhite: false,
                showGrid: true,
                showOrigin: true,
                showBounds: false,
                showRulers: true,
                fuseGeometry: false,
                showRegions: true,
                showTraces: true,
                showDrills: true,
                showCutouts: true,
                showHoles: true,
                holeRenderMode: 'proper',
                debugHoleWinding: false,
                showStats: false,
                debugPoints: false,
                debugArcs: false,
                showOffsets: true,
                showPreviews: true,
                showPreprocessed: false,
                enableArcReconstruction: false,
                showDebugInLog: false
            },
            canvas: {
                defaultZoom: 10,
                zoomStep: 1.2,
                panSensitivity: 1.0,
                wheelZoomSpeed: 0.002,
                rulerSize: 20,
                rulerTickLength: 5,
                originMarkerSize: 10,
                originCircleSize: 3,
                wireframe: {
                    baseThickness: 0.08,
                    minThickness: 0.02,
                    maxThickness: 0.2
                }
            },
            grid: {
                enabled: true,
                minPixelSpacing: 40,
                steps: [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100]
            }
        },

        // ====================================================================
        // UI PREFERENCES
        // ====================================================================
        ui: {
            theme: 'dark',

            timing: {
                statusMessageDuration: 5000,
                modalAnimationDuration: 300,
                inputDebounceDelay: 300,
                renderThrottle: 16,
                //  autoSaveInterval: 30000, // REVIEW - Dead code?
                propertyDebounce: 500
            },

            tooltips: {
                enabled: true,
                positionPadding: 8,
                // REVIEW - Possibly disconnected, should it be?
                delayShow: 500,
                delayHide: 100
            },

            visualization: {
                geometryStageTransition: {
                    enabled: true,
                    duration: 300
                }
            }
        },

        // ====================================================================
        // PERFORMANCE TUNING
        // ====================================================================
        // performance: {
        //     REVIEW - Useless?
        //     cache: {
        //         enableGeometryCache: true,
        //         enableToolpathCache: true,
        //         maxCacheSize: 100,
        //         cacheTimeout: 300000
        //     },
        //     REVIEW - Useless?
        //     optimization: {
        //         simplifyThreshold: 10000,
        //         decimateThreshold: 0.01,
        //         mergeThreshold: 0.001
        //     },
        //     REVIEW - Useless?
        //     debounce: {
        //         propertyChanges: 300,
        //         treeSelection: 100,
        //         canvasInteraction: 16
        //     }
        // },

        // ====================================================================
        // DEBUG & DEVELOPMENT
        // ====================================================================
        debug: {
            enabled: false,
            // REVIEW - Many are disconnected? Worth connecting?
            logging: {
                wasmOperations: false,
                coordinateConversion: false,
                polarityHandling: false,
                parseOperations: false,
                renderOperations: false,
                fusionOperations: true,
                fileOperations: false,
                toolpathGeneration: false,
                curveRegistration: true,
                operations: false,
                toolpaths: false,
                rendering: false,
                interactions: false,
                cache: false
            },
            visualization: {
                showBounds: false,
                showStats: false,
                showCoordinates: false,
                // REVIEW - Disconnected? Worth connecting?
                showPrimitiveIndices: false,
                showWindingDirection: false,
                highlightHoles: false,
                showToolpathNodes: false,
                highlightOffsetSegments: false,
                showJoinTypes: false
            },
            validation: {
                validateGeometry: true,
                validateCoordinates: true,
                warnOnInvalidData: true,
                // REVIEW - Disconnected? Worth connecting?
                validatePolarity: true,
                strictParsing: false
            }
        }
    },


    // ╔═══════════════════════════════════════════════════════════════════════╗
    // ║  HELPER METHODS                                                       ║
    // ║  Use explicit PCBCAMConfig reference instead of 'this' to prevent     ║
    // ║  context loss if a module destructures the method off the object.     ║
    // ╚═══════════════════════════════════════════════════════════════════════╝

    // Currently empty

};


// ════════════════════════════════════════════════════════════════════════════
// RUNTIME FREEZE
//
// Deep-freeze the constants subtree. Accidental mutation throws in strict mode
// and silently fails in sloppy mode. Defaults are left mutable because
// SettingsManager clones and overrides them at startup.
//
// Uses globalThis for cross-environment compatibility (browser + Node/test).
// ════════════════════════════════════════════════════════════════════════════
(function deepFreeze(obj) {
    Object.freeze(obj);
    for (var i = 0, keys = Object.getOwnPropertyNames(obj); i < keys.length; i++) {
        var value = obj[keys[i]];
        if (value && typeof value === 'object' && !Object.isFrozen(value)) {
            deepFreeze(value);
        }
    }
})((typeof globalThis !== 'undefined' ? globalThis : window).PCBCAMConfig.constants);