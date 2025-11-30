/**
 * @file        config.js
 * @description Configuration - Single file (to be split later) - Under review
 * @author      Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 * @todo REFACTOR: Split into config/constants.js and config/settings.js
 * @todo CLEANUP: Remove all [DEPRECATED] sections after theme system migration
 * @todo AUDIT: Review all [AUDIT-NEEDED] entries for actual usage
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

window.PCBCAMConfig = {
    // ============================================================================
    // OPERATION DEFAULTS
    // ============================================================================
    operations: {
        isolation: {
            name: 'Isolation Routing',              // [USED IN: cam-core.js, ui-nav-tree-panel.js] [MOVE TO: constants.js]
            icon: '🎯',                              // [USED IN: cam-core.js, ui-nav-tree-panel.js] [MOVE TO: constants.js]
            extensions: ['.gbr', '.ger', '.gtl', '.gbl', '.gts', '.gbs', '.svg'], // [USED IN: cam-core.js] [MOVE TO: constants.js]
            defaultTool: 'em_0.2mm_flat',           // [USED IN: cam-core.js] [MOVE TO: settings.js]
            tool: {                                  // [USED IN: cam-core.js line ~130] [MOVE TO: settings.js]
                diameter: 0.1,
                type: 'end_mill',
                material: 'carbide',
                flutes: 2
            },
            cutting: {                               // [USED IN: cam-core.js, ui-parameter-manager.js] [MOVE TO: settings.js]
                cutDepth: -0.04,
                passDepth: 0.04,
                cutFeed: 100,
                plungeFeed: 50,
                spindleSpeed: 10000
            },
            strategy: {                              // [USED IN: cam-core.js] [MOVE TO: settings.js]
                passes: 3,
                overlap: 50,
                method: 'offset',
                direction: 'outside',
                cornerHandling: true,
                preserveArcs: true
            },
            defaultSettings: {                       // [USED IN: cam-core.js, ui-parameter-manager.js, toolpath-optimizer.js] [MOVE TO: settings.js]
                passes: 3,
                stepOver: 50,
                cutDepth: -0.05,
                direction: 'climb',
                entryType: 'plunge',
                preserveArcs: true
            }
        },
        drill: {
            name: 'Drilling',                        // [USED IN: cam-core.js, ui-nav-tree-panel.js] [MOVE TO: constants.js]
            icon: '🔧',                              // [USED IN: cam-core.js, ui-nav-tree-panel.js] [MOVE TO: constants.js]
            extensions: ['.drl', '.xln', '.txt', '.drill', '.exc'], // [USED IN: cam-core.js] [MOVE TO: constants.js]
            defaultTool: 'drill_1.0mm',             // [USED IN: cam-core.js] [MOVE TO: settings.js]
            tool: {                                  // [USED IN: cam-core.js] [MOVE TO: settings.js]
                diameter: 1.0,
                type: 'drill',
                material: 'carbide',
                pointAngle: 118
            },
            cutting: {                               // [USED IN: cam-core.js, ui-parameter-manager.js] [MOVE TO: settings.js]
                cutDepth: -1.8,
                passDepth: 0.5,
                cutFeed: 50,
                plungeFeed: 25,
                spindleSpeed: 10000
            },
            strategy: {                              // [USED IN: cam-core.js] [MOVE TO: settings.js]
                minMillingMargin: 0.05,
                minMillingFeatureSize: 0.01,
                dwellTime: 0,
                retractHeight: 0.5,
                peckStepDepth: 0,
                chipBreaking: false
            },
            defaultSettings: {                       // [USED IN: cam-core.js, ui-parameter-manager.js] [MOVE TO: settings.js]
                millHoles: true,
                multiDepth: true,
                cannedCycle: 'none',
                peckDepth: 0,
                dwellTime: 0,
                retractHeight: 0.5,
                autoToolChange: true,
                depthCompensation: true,
                entryType: 'helix',
            }
        },
        clearing: {
            name: 'Copper Clearing',                 // [USED IN: cam-core.js, ui-nav-tree-panel.js] [MOVE TO: constants.js]
            icon: '🔄',                              // [USED IN: cam-core.js, ui-nav-tree-panel.js] [MOVE TO: constants.js]
            extensions: ['.gbr', '.ger', '.gpl', '.gp1', '.gnd', '.svg'], // [USED IN: cam-core.js] [MOVE TO: constants.js]
            defaultTool: 'em_0.8mm_flat',           // [USED IN: cam-core.js] [MOVE TO: settings.js]
            tool: {                                  // [USED IN: cam-core.js] [MOVE TO: settings.js]
                diameter: 0.8,
                type: 'end_mill',
                material: 'carbide',
                flutes: 2
            },
            cutting: {                               // [USED IN: cam-core.js, ui-parameter-manager.js] [MOVE TO: settings.js]
                cutDepth: -0.1,
                passDepth: 0.1,
                multiDepth: false,
                cutFeed: 200,
                plungeFeed: 50,
                spindleSpeed: 10000
            },
            strategy: {                              // [USED IN: cam-core.js] [MOVE TO: settings.js]
                overlap: 50,
                pattern: 'parallel',
                angle: 0,
                margin: 0.1,
                stepDown: 0.1
            },
            defaultSettings: {                       // [USED IN: cam-core.js, ui-parameter-manager.js] [MOVE TO: settings.js]
                passes: 4,
                stepOver: 50,
                cutDepth: -0.1,
                pattern: 'offset',
                direction: 'climb',
                entryType: 'plunge',
                preserveIslands: true
            }
        },
        cutout: {
            name: 'Board Cutout',                    // [USED IN: cam-core.js, ui-nav-tree-panel.js] [MOVE TO: constants.js]
            icon: '✂️',                              // [USED IN: cam-core.js, ui-nav-tree-panel.js] [MOVE TO: constants.js]
            extensions: ['.gbr', '.gko', '.gm1', '.outline', '.mill', '.svg'], // [USED IN: cam-core.js] [MOVE TO: constants.js]
            defaultTool: 'em_1.0mm_flat',           // [USED IN: cam-core.js] [MOVE TO: settings.js]
            tool: {                                  // [USED IN: cam-core.js] [MOVE TO: settings.js]
                diameter: 1.0,
                type: 'end_mill',
                material: 'carbide',
                flutes: 2
            },
            cutting: {                               // [USED IN: cam-core.js, ui-parameter-manager.js] [MOVE TO: settings.js]
                cutDepth: -1.8,
                passDepth: 0.3,
                cutFeed: 150,
                plungeFeed: 50,
                spindleSpeed: 10000
            },
            strategy: {                              // [USED IN: cam-core.js] [MOVE TO: settings.js]
                tabs: 4,
                tabWidth: 3,
                tabHeight: 0.5,
                direction: 'conventional',
                stepDown: 0.2,
                leadIn: 0.5,
                leadOut: 0.5,
                preserveArcs: true
            },
            defaultSettings: {                       // [USED IN: cam-core.js, ui-parameter-manager.js] [MOVE TO: settings.js]
                passes: 1,
                stepOver: 100,
                cutDepth: 0.2,
                tabs: 4,
                tabWidth: 3.0,
                tabHeight: 0.5,
                direction: 'climb',
                entryType: 'plunge',
                leadIn: 0.5,
                leadOut: 0.5,
                cutSide: 'outside'
            }
        }
    },

    // ============================================================================
    // STORAGE KEYS (ADD THIS BLOCK)
    // ============================================================================
    storageKeys: {
        theme: 'pcbcam-theme',
        hideWelcome: 'pcbcam-hide-welcome'
    },

    // ============================================================================
    // UI CONFIGURATION
    // ============================================================================
    layout: {
        sidebarLeftWidth: 320,                       // [USED IN: base.css --sidebar-left-width] [MOVE TO: settings.js]
        sidebarRightWidth: 380,                      // [USED IN: base.css --sidebar-right-width] [MOVE TO: settings.js]
        statusBarHeight: 32,                         // [USED IN: base.css --status-bar-height] [MOVE TO: settings.js]
        sectionHeaderHeight: 36,                     // [USED IN: base.css --section-header-height] [MOVE TO: settings.js]
        defaultTheme: 'dark',                        // [USED IN: cam-ui.js, theme-loader.js] [MOVE TO: settings.js]
        
        treeView: {                                  // [UNUSED] [AUDIT-NEEDED] [MOVE TO: settings.js]
            indentSize: 16,
            nodeHeight: 28,
            showIcons: true,
            animateExpansion: true
        },
        
        canvas: {                                    // [USED IN: cam-ui.js, ui-controls.js, renderer-interaction.js] [MOVE TO: settings.js]
            defaultZoom: 10,
            minZoom: 0.01,
            maxZoom: 1000,
            zoomStep: 1.2,
            panSensitivity: 1.0,
            wheelZoomSpeed: 0.002                    // [USED IN: renderer-interaction.js]
        },
        
        visibility: {                                // [UNUSED - replaced by rendering.defaultOptions] [MOVE TO: settings.js]
            defaultLayers: {
                source: true,
                fused: true,
                toolpath: false,
                preview: false
            }
        },

        ui: {                                        // [USED IN: cam-controller.js, ui-operation-panel.js] [MOVE TO: settings.js]
            autoTransition: true,
            transitionDelay: 125
        }
    },

    // ============================================================================
    // RENDERING CONFIGURATION
    // [MOVE TO: settings.js] - User preferences
    // ============================================================================
    rendering: {
        defaultOptions: {                            // [USED IN: cam-ui.js, ui-controls.js, renderer-core.js] [MOVE TO: settings.js]
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
            theme: 'dark',
            showHoles: true,
            holeRenderMode: 'proper',
            debugHoleWinding: false,
            showStats: false,
            debugPoints: false,
            debugArcs: false,
            showOffsets: true,                      // [ADDED] Default visibility for offset layers
            showPreviews: true,                     // [ADDED] Default visibility for preview layers
            showPreprocessed: false,                // [ADDED] Default visibility for pre-processed geometry
            enableArcReconstruction: false,         // [ADDED] Default visibility for reconstructed arcs
            showDebugInLog: false
        },
        
        canvas: {                                    // [USED IN: renderer-core.js, renderer-overlay.js] [MOVE TO: settings.js]
            minZoom: 0.01,
            maxZoom: 1000,
            defaultZoom: 10,
            zoomStep: 1.2,
            panSensitivity: 1.0,
            rulerSize: 20,                           // [USED IN: renderer-overlay.js]
            rulerTickLength: 5,                      // [USED IN: renderer-overlay.js]
            originMarkerSize: 10,                    // [USED IN: renderer-overlay.js]
            originCircleSize: 3,                     // [USED IN: renderer-overlay.js]
            wireframe: {                             // [USED IN: renderer-core.js]
                baseThickness: 0.08,
                minThickness: 0.02,
                maxThickness: 0.2
            }
        },
        
        grid: {                                      // [USED IN: renderer-overlay.js] [MOVE TO: settings.js]
            enabled: true,
            minPixelSpacing: 40,
            steps: [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100]
        },
        
        toolpath: {                                  // [USED IN: layer-renderer.js (not provided)] [MOVE TO: settings.js]
            strokeWidth: 1.5,
            showDirection: true,
            showStartPoint: true,
            animatePreview: false
        }
    },

    // ============================================================================
    // RENDERER (NON-THEME)
    // [ADDED] For settings in renderer-*.js files
    // ============================================================================
    renderer: {
        context: {                                   // [ADDED] [HARDCODED in renderer-core.js]
            alpha: false,
            desynchronized: true
        },
        lodThreshold: 1,                             // [ADDED] [HARDCODED in renderer-core.js]
        zoom: {
            fitPadding: 1.1,                         // [ADDED] [HARDCODED in renderer-core.js]
            factor: 1.2,                             // [ADDED] [HARDCODED in renderer-core.js]
            min: 0.01,                               // [ADDED] [HARDCODED in renderer-core.js, layout.canvas.minZoom]
            max: 1000                                // [ADDED] [HARDCODED in renderer-core.js, layout.canvas.maxZoom]
        },
        overlay: {                                   // [ADDED] [HARDCODED in renderer-overlay.js]
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
        // primitives: {                                // [ADDED] [HARDCODED in renderer-primitives.js] Review - Redundant?
        //     offsetStrokeWidth: 2,
        //     centerMarkStrokeWidth: 3,
        //     sourceDrillStrokeWidth: 3,
        //     sourceDrillMarkSize: 0.2,
        //     sourceDrillMarkRatio: 0.4,
        //     peckMarkStrokeWidth: 3,
        //     peckMarkMarkSize: 0.2,
        //     peckMarkMarkRatio: 0.4,
        //     peckMarkDash: [0.15, 0.15],
        //     peckMarkRingFactor: 1.3,
        //     peckMarkLabelOffset: 0.3,
        //     reconstructedStrokeWidth: 2,
        //     reconstructedCenterSize: 2,
        //     reconstructedPathDash: [5, 5],
        //     defaultStrokeWidth: 0.1,
        //     debugPointSize: 4,
        //     debugPointFont: '10px monospace',
        //     debugLabelLineWidth: 2,
        //     debugArcStrokeWidth: 3,
        //     debugArcCenterSize: 4,
        //     debugArcFont: 'bold 12px monospace',
        //     debugContourStrokeWidth: 2,
        //     debugContourDash: [5, 5],
        //     debugContourFont: '12px monospace'
        // },
        interaction: {                               // [ADDED] [HARDCODED in renderer-interaction.js]
            cursorGrabbing: 'grabbing',
            cursorGrab: 'grab',
            coordPrecision: 2,
            zoomPrecision: 0
        },
        primitives: {                                // [ADDED] [HARDCODED in renderer-primitives.js]
            offsetStrokeWidth: 2,
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

    // ============================================================================
    // GEOMETRY PROCESSING
    // [MOVE TO: settings.js] - Processing parameters
    // ============================================================================
    geometry: {
        clipperScale: 10000,                         // [USED IN: cam-core.js, geometry-processor.js, geometry-arc-reconstructor.js, geometry-clipper-wrapper.js] [MOVE TO: constants.js]
        maxCoordinate: 1000,                         // [USED IN: cam-core.js line ~280, parser-core.js] [MOVE TO: constants.js]
        coordinatePrecision: 0.001,                  // [USED IN: cam-core.js, geometry-offsetter.js, coordinate-system.js, geometry-utils.js, parser-core.js, parser-gerber.js, parser-plotter.js, primitives.js] [MOVE TO: constants.js]
        
        offsetting: {                                // [USED IN: cam-core.js line ~55, geometry-offsetter.js] [MOVE TO: settings.js]
            joinType: 'round',                       // [AUDIT-NEEDED] Used by geometry-offsetter?
            miterLimit: 2.0,                         // [USED IN: cam-core.js line ~525, geometry-offsetter.js]
            arcTolerance: 0.01,                      // [AUDIT-NEEDED] Used by geometry-offsetter?
            selfIntersectionCheck: true,             // [AUDIT-NEEDED] Implemented?
            preserveCollinear: false,                // [AUDIT-NEEDED] Used where?
            unionPasses: true,                       // [AUDIT-NEEDED] Used where?
            epsilon: 1e-9,                           // [ADDED] [HARDCODED in geometry-offsetter.js] For line intersection checks.
            collinearDotThreshold: 0.995,            // [ADDED] [HARDCODED in geometry-offsetter.js] For collinearity checks.
            minRoundJointSegments: 2                 // [ADDED] [HARDCODED in geometry-offsetter.js] Min segments for a rounded corner.
        },
        
        fusion: {                                    // [USED IN: cam-core.js] [MOVE TO: settings.js]
            enabled: false,                          // [REDUNDANT] UI toggle exists in ui-controls.js
            preserveHoles: true,                     // [AUDIT-NEEDED] Used by geometry-processor?
            preserveArcs: true,                      // [USED IN: cam-core.js line ~750, svg-exporter.js]
            fillRule: 'nonzero'                      // [USED IN: geometry-processor.js, geometry-clipper-wrapper.js]
        },
        
        segments: {                                  // [USED IN: geometry-utils.js] [MOVE TO: settings.js]
            targetLength: 0.01,
            minCircle: 256,
            maxCircle: 2048,
            minArc: 200,
            maxArc: 2048,
            obround: 128,
            adaptiveSegmentation: true,
            minEndCap: 32,                           // [ADDED] [HARDCODED in geometry-utils.js]
            maxEndCap: 256,                          // [ADDED] [HARDCODED in geometry-utils.js]
            defaultMinSegments: 16,                  // [ADDED] [HARDCODED in geometry-utils.js] Fallback min segments for tessellation.
            defaultFallbackSegments: {               // [ADDED] [HARDCODED in geometry-utils.js] Default for unknown types.
                min: 32,
                max: 128
            }
        },

        tessellation: {                              // [ADDED] For settings in geometry-utils.js
            bezierSegments: 32,                      // [ADDED] [HARDCODED in geometry-utils.js]
            minEllipticalSegments: 8                 // [ADDED] [HARDCODED in geometry-utils.js]
        },

        arcReconstruction: {                         // [ADDED] For settings in geometry-arc-reconstructor.js
            minArcPoints: 2,                         // [ADDED] [HARDCODED in geometry-arc-reconstructor.js]
            maxGapPoints: 1,                         // [ADDED] [HARDCODED in geometry-arc-reconstructor.js]
            minCirclePoints: 4,                      // [ADDED] [HARDCODED in geometry-arc-reconstructor.js]
            smallCircleRadiusThreshold: 1.0,         // [ADDED] [HARDCODED in geometry-arc-reconstructor.js]
            smallCircleSegments: 16,                 // [ADDED] [HARDCODED in geometry-arc-reconstructor.js]
            defaultCircleSegments: 48,               // [ADDED] [HARDCODED in geometry-arc-reconstructor.js]
            mergeEpsilon: 1e-9                       // [ADDED] [HARDCODED in geometry-arc-reconstructor.js]
        },

        curveRegistry: {                             // [ADDED] For settings in geometry-curve-registry.js
            hashPrecision: 1000                      // [ADDED] [HARDCODED in geometry-curve-registry.js]
        },

        clipper: {                                   // [ADDED] For settings in geometry-clipper-wrapper.js & geometry-utils.js
            minScale: 1000,                          // [ADDED] [HARDCODED in geometry-utils.js]
            maxScale: 1000000,                       // [ADDED] [HARDCODED in geometry-utils.js]
            metadataPacking: {                       // [MOVE TO: constants.js]
                curveIdBits: 24,                     // [ADDED] [HARDCODED in geometry-clipper-wrapper.js]
                segmentIndexBits: 31,                // [ADDED] [HARDCODED in geometry-clipper-wrapper.js]
                clockwiseBit: 1,                     // [ADDED] [HARDCODED in geometry-clipper-wrapper.js]
                reservedBits: 8                      // [ADDED] [HARDCODED in geometry-clipper-wrapper.js]
            }
        },

        implicitRegionClosure: {                     // [USED IN: cam-core.js (cutout merge logic)] [MOVE TO: settings.js]
            enabled: true,
            cutoutOnly: true,
            warnOnFailure: true
        },

        simplification: {                            // [USED IN: geometry-processor.js, geometry-offsetter.js] [MOVE TO: settings.js]
            enabled: true,
            tolerance: 0.001 
        },
        
        simplifyTolerance: 0.01,                     // [DUPLICATE of simplification.tolerance] [AUDIT-NEEDED]
        preserveArcs: true,                          // [DUPLICATE of fusion.preserveArcs] [AUDIT-NEEDED]
        edgeKeyPrecision: 3,                         // [ADDED] [HARDCODED in parser-core.js]
        zeroLengthTolerance: 0.0001,                 // [ADDED] [HARDCODED in parser-gerber.js]
        svgPointMatchTolerance: 1e-2,                // [ADDED] [HARDCODED in parser-svg.js]
        svgZeroLengthTolerance: 1e-6                 // [ADDED] [HARDCODED in parser-svg.js]
    },


    // ============================================================================
    // Centralized precision constants
    // [MOVE TO: constants.js]
    // ============================================================================

    precision: {
        // Geometric comparison thresholds
        pointEquality: 1e-6,           // Two points are "same" if closer than this
        zeroLength: 1e-9,              // Segment length considered zero
        collinear: 1e-12,              // Perpendicular distance for collinearity
        
        // Toolpath thresholds
        xyMatch: 0.01,                 // XY position matching for multi-depth detection
        closedLoop: 0.01,              // Distance to consider loop closed
        
        // Machine thresholds
        rapidClearance: 0.1,           // Clearance for rapid moves
        staydownMargin: 0.5            // Factor of tool diameter for staydown // This value needs auditing and testing. Base condition is offset distance, plus nuance for diagonnal points in corners.
    },
    
    // ============================================================================
    // FILE FORMATS
    // [MOVE TO: constants.js] - Format specifications
    // ============================================================================
    formats: {
        excellon: {                                  // [USED IN: parser-excellon.js, parser-core.js] [MOVE TO: constants.js]
            defaultFormat: { integer: 2, decimal: 4 }, // [ADDED] [HARDCODED in parser-excellon.js]
            defaultUnits: 'mm',
            defaultToolDiameter: 1.0,
            minToolDiameter: 0.1,
            maxToolDiameter: 10.0,
            toolKeyPadding: 2                        // [ADDED] [HARDCODED in parser-excellon.js]
        },
        
        gerber: {                                    // [USED IN: parser-gerber.js, parser-plotter.js, parser-core.js] [MOVE TO: constants.js]
            defaultFormat: { integer: 3, decimal: 3 },
            defaultUnits: 'mm',
            defaultAperture: 0.1,
            minAperture: 0.01,
            maxAperture: 10.0
        },

        svg: {                                       // [ADDED] For settings in parser-svg.js
            defaultStyles: {                         // [ADDED] [HARDCODED in parser-svg.js]
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

    // ============================================================================
    // MACHINE SETTINGS
    // [MOVE TO: settings.js] - User machine configuration
    // ============================================================================
    machine: {
        pcb: {                                       // [USED IN: cam-core.js line ~120] [MOVE TO: settings.js]
            thickness: 1.6,
            copperThickness: 0.035,
            minFeatureSize: 0.1
        },
        
        heights: {                                   // [USED IN: cam-core.js line ~120, ui-controls.js, toolpath-machine-processor.js] [MOVE TO: settings.js]
            safeZ: 5.0,
            travelZ: 2.0,
            probeZ: -5.0,
            homeZ: 10.0
        },
        
        speeds: {                                    // [USED IN: cam-core.js line ~120, toolpath-machine-processor.js] [MOVE TO: settings.js]
            rapidFeed: 1000,
            probeFeed: 25,
            maxFeed: 2000,
            maxAcceleration: 100
        },
        
        workspace: {                                 // [USED IN: cam-core.js line ~120] [MOVE TO: settings.js]
            system: 'G54',
            maxX: 200,
            maxY: 200,
            maxZ: 50,
            minX: 0,
            minY: 0,
            minZ: -5
        },

        coolant: 'none', // 'none', 'mist', 'flood'
        vacuum: false

    },

    // ============================================================================
    // G-CODE GENERATION
    // [MOVE TO: constants.js] - G-code templates (static)
    // [MOVE TO: settings.js] - Generation preferences (user configurable)
    // ============================================================================
    gcode: {
        postProcessor: 'grbl',                       // [USED IN: cam-core.js line ~120, ui-modal-manager.js] [MOVE TO: settings.js]
        units: 'mm',                                 // [USED IN: cam-core.js line ~120, ui-controls.js] [MOVE TO: settings.js]
        
        precision: {                                 // [USED IN: gcode-generator.js (not provided), svg-exporter.js] [MOVE TO: constants.js]
            coordinates: 3,
            feedrate: 0,
            spindle: 0,
            arc: 3
        },
        
        templates: {                                 // [USED IN: cam-core.js line ~120, gcode-generator.js (not provided)] [MOVE TO: constants.js]
            grbl: {
                start: 'T1\n',
                end: 'M5\nG0 X0Y0\nM2',
                toolChange: 'M5\nG0 Z{safeZ}\nM0 (Tool change: {toolName})\nM3 S{spindleSpeed}\nG4 P1'
            },
            roland: {
                start: 'PA;PA;!MC0;',
                end: 'PU0,0;!MC0;H;',
                toolChange: '!MC0;(Manual tool change required)!MC1;'
            },
            marlin: {
                start: '',
                end: 'M5\nG0 X0Y0\nM84',
                toolChange: 'M5\nG0 Z{safeZ}\nM0\nM3 S{speed}\nG4 P1000'
            },
            linuxcnc: {
                start: 'G64 P0.01\nG4 P1',
                end: 'M5\nG0 X0Y0\nM2',
                toolChange: 'M5\nG0 Z{safeZ}\nT{tool} M6\nM3 S{speed}\nG4 P1'
            },
            mach3: {
                start: '',
                end: 'M5\nG0 X0Y0\nM30',
                toolChange: 'M5\nG0 Z{safeZ}\nT{tool} M6\nM3 S{speed}\nG4 P1'
            },
            grblHAL: {
                start: 'T1',
                end: 'M5\nG0 X0 Y0\nM2',
                toolChange: 'M5\nG0 Z{safeZ}\nT{tool} M6\nM0\nM3 S{speed}\nG4 P1'
            }
        },
        
        features: {                                  // [USED IN: gcode-generator.js (not provided)] [MOVE TO: constants.js]
            arcCommands: true,
            helicalMoves: false,
            cannedCycles: false,
            workOffsets: true,
            toolCompensation: false,
            variableSpindle: true
        },

        enableOptimization: true,                   // [USED IN: ui-modal-manager.js line ~265] [MOVE TO: settings.js]
        
        optimization: {                              // [USED IN: toolpath-optimizer.js] [MOVE TO: settings.js]
            enableGrouping: true,
            pathOrdering: true,
            segmentSimplification: true,
            leadInOut: true,
            zLevelGrouping: true, // allow users to pick and choose?

            rapidStrategy: 'adaptive',
            shortTravelThreshold: 5.0,
            reducedClearance: 1.0,

            angleTolerance: 0.1,
            minSegmentLength: 0.01,
            staydownMarginFactor: 0.6,               // [ADDED] [HARDCODED in toolpath-optimizer.js]
            planSamplePoints: 20                     // [ADDED] [HARDCODED in toolpath-optimizer.js]
        }
    },

    // ============================================================================
    // TOOLPATH GENERATION
    // [ADDED] For settings in toolpath-*.js files
    // ============================================================================
    toolpath: {
        generation: {                                // [ADDED] For settings in toolpath-geometry-translator.js, toolpath-machine-processor.js
            defaultFeedRate: 150,                    // [ADDED] [HARDCODED in toolpath-primitives.js]
            closedLoopTolerance: 0.01,               // [ADDED] [HARDCODED in toolpath-geometry-translator.js]
            minSegmentLength: 0.001,                 // [ADDED] [HARDCODED in toolpath-geometry-translator.js]
            multiDepthXYTolerance: 0.01,             // [ADDED] [HARDCODED in toolpath-machine-processor.js]
            entry: {                                 // [ADDED] [HARDCODED in toolpath-machine-processor.js]
                helix: {
                    radiusFactor: 0.4,
                    pitch: 0.5,
                    segmentsPerRevolution: 16
                },
                ramp: {
                    defaultAngle: 10,
                    shallowDepthFactor: 0.1
                }
            },
            drilling: {                              // [ADDED] [HARDCODED in toolpath-machine-processor.js]
                peckRapidClearance: 0.1,
                helixPitchFactor: 0.5,
                helixMaxDepthFactor: 3.0,
                helixSegmentsPerRev: 16,
                slotHelixSegments: 12,
                slotHelixMaxPitchFactor: 0.5,
                minHelixDiameter: 0.2
            },
            rapidCost: {                             // [ADDED] [HARDCODED in toolpath-machine-processor.js, toolpath-optimizer.js]
                zTravelThreshold: 5.0,
                zCostFactor: 1.5,
                baseCost: 10000
            },
            staydown: {                              // [ADDED] [HARDCODED in toolpath-machine-processor.js]
                toleranceFactor: 0.1,
                improvementThreshold: 0.7
            },
            simplification: {                        // [ADDED] [HARDCODED in toolpath-machine-processor.js] Isn't this inside the optimizer?
                minArcLength: 0.01,
                minSegmentEpsilon: 1e-6,
                curveToleranceFactor: 100.0,
                curveToleranceFallback: 0.0005,
                straightToleranceFactor: 10.0,
                straightToleranceFallback: 0.005,
                straightAngleThreshold: 1.0,  // Angle (deg) below which is "straight"
                sharpAngleThreshold: 10.0, // Angle (deg) above which is "sharp"
                sharpCornerTolerance: 0.00001, // Tolerance for "sharp" corners
                segmentThresholdFactor: 10.0,
                segmentThresholdFallback: 0.5,
                linePointEpsilon: 1e-12
            }
        },
        tabs: {                                      // [ADDED] For settings in toolpath-geometry-translator.js
            cornerMarginFactor: 2.0,                 // [ADDED] [HARDCODED in toolpath-geometry-translator.js]
            minCornerAngle: 30,                      // [ADDED] [HARDCODED in toolpath-geometry-translator.js]
            minTabLengthFactor: 1.5
        }
    },
    
    // ============================================================================
    // EXPORT SETTINGS
    // ============================================================================
    export: {
        svg: {                                       // [USED IN: svg-exporter.js]
            padding: 5,                              // [ADDED] [HARDCODED in svg-exporter.js] Padding in mm
            includeMetadata: true,                   // [ADDED] [HARDCODED in svg-exporter.js]
            useViewBox: true,                        // [ADDED] [HARDCODED in svg-exporter.js]
            embedStyles: true,                       // [ADDED] [HARDCODED in svg-exporter.js]
            styles: {                                // [ADDED] Hardcoded styles from svg-exporter.js
                wireframeStrokeWidth: 0.05,          // [ADDED]
                cutoutStrokeWidth: 0.1               // [ADDED]
            }
        }
    },
    
    // ============================================================================
    // UI CONFIGURATION
    // ============================================================================
    ui: {
        theme: 'dark',                               // [USED IN: cam-ui.js, theme-loader.js] [MOVE TO: settings.js]
        showTooltips: true,                          // [USED IN: ui-tooltip.js] [MOVE TO: settings.js]
        language: 'en',                              // [UNUSED] [AUDIT-NEEDED] [MOVE TO: settings.js]
        
        timing: {                                    // [USED IN: status-manager.js, cam-controller.js] [MOVE TO: settings.js]
            statusMessageDuration: 5000,
            modalAnimationDuration: 300,
            inputDebounceDelay: 300,
            renderThrottle: 16,
            autoSaveInterval: 30000,
            propertyDebounce: 500                   // [ADDED] [HARDCODED in ui-operation-panel.js]
        },
        
        validation: {                                // [USED IN: ui-operation-panel.js, ui-parameter-manager.js] [MOVE TO: constants.js]
            minToolDiameter: 0.01,
            maxToolDiameter: 10,
            minFeedRate: 1,
            maxFeedRate: 5000,
            minSpindleSpeed: 100,
            maxSpindleSpeed: 30000,
            minDepth: 0.001,
            maxDepth: 10,
            passes: { min: 1, max: 30, step: 1 },
            stepOver: { min: 10, max: 100, step: 5 },
            cutDepth: { min: -10, max: 0, step: 0.001 },
            depthPerPass: { min: 0.001, max: 5, step: 0.001 },
            peckDepth: { min: 0, max: 5, step: 0.01 },
            dwellTime: { min: 0, max: 10, step: 0.1 },
            retractHeight: { min: 0, max: 10, step: 0.01 },
            tabs: { min: 0, max: 12, step: 1 },
            tabWidth: { min: 0.5, max: 10, step: 0.1 },
            tabHeight: { min: 0.1, max: 5, step: 0.1 },
            travelZ: { min: 0, max: 50, step: 0.1 },
            safeZ: { min: 0, max: 50, step: 0.1 }
        },
        
        text: {
            noToolsAvailable: 'No tools available',
            gcodePlaceholder: 'Click "Calculate Toolpaths" to generate G-code',
            gcodeDefaultFilename: 'output.nc',
            gcodeNoExportAlert: 'No G-code to export',

            statusReady: 'Ready - Add PCB files to begin - Click here to expand log',
            statusLoading: 'Loading...',
            statusProcessing: 'Processing...',
            statusSuccess: 'Operation completed successfully',
            statusError: 'An error occurred',
            statusWarning: 'Warning',
            logHintViz: 'Toggle verbose debug messages in the Viz Panel.'
        },
        tooltips: {                                // Tooltip module to be completely rebuilt
            enabled: true,
            delay: 500,       // [DEPRECATED] - Use delayShow
            maxWidth: 300,    // [DEPRECATED] - Use per-tooltip option
            delayShow: 500,   // [ADDED] [HARDCODED in ui-tooltip.js]
            delayHide: 100,   // [ADDED] [HARDCODED in ui-tooltip.js]
            positionPadding: 8 // [ADDED] [HARDCODED in ui-tooltip.js]
        },
        
        visualization: {                             // [USED IN: ui-controls.js] [MOVE TO: settings.js]
            geometryStageTransition: {
                enabled: true,
                duration: 300
            }
        },
        icons: {                                     // Useless? Deprecate in the future? Replace with theme compatible svgs?
            treeWarning: '⚠️',
            offsetCombined: '⇔️',
            offsetPass: '↔️',
            preview: '👁️',
            toolpath: '🔧',
            defaultGeometry: '📊',
            modalDragHandle: '☰',
            tooltipTrigger: '?'
        },

        // [ADDED] For ui-operation-panel
        operationPanel: {                        // [USED IN: ui-operation-panel.js] [MOVE TO: constants.js]
            categories: {
                tool: 'Tool Selection',
                offset: 'Offset Generation',
                depth: 'Depth Settings',
                feeds: 'Feeds & Speeds',
                strategy: 'Cutting Strategy',
                drill: 'Drilling Parameters',
                cutout: 'Cutout Settings',
                machine: 'Machine Configuration',
                general: 'General Settings'
            },
            textAreaStyle: {
                fontFamily: 'monospace',
                fontSize: '11px'
            },
            warningPanelCSS: {
                background: '#fff3cd',
                border: '1px solid #ffc107',
                borderRadius: '4px',
                padding: '12px',
                marginBottom: '16px',
                color: '#856404'
            },
            warningHeaderCSS: {
                fontWeight: 'bold',
                marginBottom: '8px'
            },
            warningListCSS: {
                margin: '0',
                paddingLeft: '20px',
                fontSize: '13px'
            }
        },

        parameterOptions: {                         // [USED IN: ui-parameter-manager.js] [MOVE TO: constants.js]
            direction: [
                { value: 'climb', label: 'Climb' },
                { value: 'conventional', label: 'Conventional' }
            ],
            entryType: [
                { value: 'plunge', label: 'Plunge' },
                { value: 'ramp', label: 'Ramp' },
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
            postProcessor: [
                { value: 'grbl', label: 'Grbl' },
                { value: 'roland', label: 'Roland (RML) (Experimental)' },
                { value: 'mach3', label: 'Mach3 (Experimental)' },
                { value: 'linuxcnc', label: 'LinuxCNC (Experimental)' },
                { value: 'grblHAL', label: 'grblHAL (Experimental)' },
                { value: 'marlin', label: 'Marlin (Experimental)' }
            ],
            workOffset: [
                { value: 'G54', label: 'G54' },
                { value: 'G55', label: 'G55' },
                { value: 'G56', label: 'G56' }
            ]
        },
    },

    // ============================================================================
    // PERFORMANCE TUNING
    // [MOVE TO: settings.js] - Runtime optimization settings
    // ============================================================================
    performance: {
        wasm: {                                      // [USED IN: geometry-processor.js (not provided)] [MOVE TO: settings.js]
            memoryLimit: 256,
            stackSize: 1024 * 1024,
            enableSIMD: true,
            enableThreads: false
        },
        
        batching: {                                  // [USED IN: layer-renderer.js, parser-plotter.js (not provided)] [MOVE TO: settings.js]
            maxPrimitivesPerBatch: 1000,
            fusionBatchSize: 100,
            renderBatchSize: 500,
            parseChunkSize: 10000
        },
        
        cache: {                                     // [USED IN: geometry-processor.js (not provided)] [MOVE TO: settings.js]
            enableGeometryCache: true,
            enableToolpathCache: true,
            maxCacheSize: 100,
            cacheTimeout: 300000
        },
        
        optimization: {                              // [USED IN: geometry-processor.js (not provided)] [MOVE TO: settings.js]
            simplifyThreshold: 10000,
            decimateThreshold: 0.01,
            mergeThreshold: 0.001
        },
        
        debounce: {                                  // [USED IN: ui-operation-panel.js, ui-nav-tree-panel.js] [MOVE TO: settings.js]
            propertyChanges: 300,
            treeSelection: 100,
            canvasInteraction: 16
        }
    },

    // ============================================================================
    // DEBUG & DEVELOPMENT
    // [MOVE TO: settings.js] - Development flags
    // ============================================================================
    debug: {
        enabled: false,                              // [USED IN: ALL modules] [MOVE TO: settings.js]
        
        logging: {                                   // [USED IN: cam-core.js, cam-controller.js, geometry-processor.js, coordinate-system.js, svg-exporter.js, parser-core.js, parser-plotter.js, toolpath-optimizer.js, toolpath-machine-processor.js] [MOVE TO: settings.js]
            wasmOperations: false,
            coordinateConversion: false,             // [USED IN: coordinate-system.js]
            polarityHandling: false,
            parseOperations: false,                  // [USED IN: parser-core.js]
            renderOperations: false,
            fusionOperations: true,
            fileOperations: false,                   // [USED IN: svg-exporter.js]
            toolpathGeneration: false,               // [USED IN: toolpath-machine-processor.js]
            curveRegistration: true,                 // [USED IN: geometry-processor.js]
            operations: false,
            toolpaths: false,                        // [USED IN: toolpath-optimizer.js]
            rendering: false,                        // [USED IN: renderer-core.js]
            interactions: false,
            cache: false
        },
        
        visualization: {                             // [USED IN: layer-renderer.js (not provided)] [MOVE TO: settings.js]
            showBounds: false,
            showStats: false,
            showCoordinates: false,
            showPrimitiveIndices: false,
            showWindingDirection: false,
            highlightHoles: false,
            showToolpathNodes: false,
            highlightOffsetSegments: false,
            showJoinTypes: false
        },
        
        validation: {                                // [USED IN: cam-core.js line ~280, parser-core.js, parser-plotter.js] [MOVE TO: settings.js]
            validateGeometry: true,
            validateCoordinates: true,
            validatePolarity: true,
            strictParsing: false,
            warnOnInvalidData: true
        }
    },

    // ============================================================================
    // HELPER METHODS
    // [KEEP IN: config.js] - Utility functions stay in main config
    // ============================================================================
    
    getOperation: function(type) {
        return this.operations[type] || this.operations.isolation;
    },
    
    getGcodeTemplate: function(processor, type) {
        const templates = this.gcode.templates[processor || this.gcode.postProcessor];
        return templates ? templates[type] : '';
    },
    
    formatGcode: function(value, type = 'coordinates') {
        const precision = this.gcode.precision[type] || 3;
        return value.toFixed(precision).replace(/\.?0+$/, '');
    },
    
    getDefaultTool: function(operationType) {
        const op = this.operations[operationType];
        if (!op) return null;
        
        const toolId = op.defaultTool;
        // [NOTE] This assumes external tool-library.js handles tool definitions
        return this.tools ? this.tools.find(tool => tool.id === toolId) : null;
    },
    
    getToolsForOperation: function(operationType) {
        // [NOTE] This assumes external tool-library.js handles tool definitions
        return this.tools ? this.tools.filter(tool => 
            tool.operations.includes(operationType)
        ) : [];
    },

    validateTool: function(tool) {
        const required = ['id', 'name', 'type', 'geometry', 'cutting', 'operations'];
        const geometryRequired = ['diameter'];
        const cuttingRequired = ['feedRate', 'plungeRate', 'spindleSpeed'];
        
        for (const field of required) {
            if (!tool[field]) {
                console.error(`Tool validation failed: missing '${field}'`);
                return false;
            }
        }
        
        for (const field of geometryRequired) {
            if (tool.geometry[field] === undefined) {
                console.error(`Tool validation failed: missing 'geometry.${field}'`);
                return false;
            }
        }
        
        for (const field of cuttingRequired) {
            if (tool.cutting[field] === undefined) {
                console.error(`Tool validation failed: missing 'cutting.${field}'`);
                return false;
            }
        }
        
        return true;
    }
};