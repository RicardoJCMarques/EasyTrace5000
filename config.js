/**
 * @file        config.js
 * @description Default values, configurations, small aux methods
 * @author      Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
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
            name: 'Isolation Routing',
            icon: '🎯',
            color: '#ff8844',
            extensions: ['.gbr', '.ger', '.gtl', '.gbl', '.gts', '.gbs', '.svg'],
            defaultTool: 'em_0.2mm_flat',
            tool: {
                diameter: 0.1,
                type: 'end_mill',
                material: 'carbide',
                flutes: 2
            },
            cutting: {
                cutDepth: 0.05,
                passDepth: 0.05,
                cutFeed: 100,
                plungeFeed: 50,
                spindleSpeed: 10000
            },
            strategy: {
                passes: 3,
                overlap: 50,
                method: 'offset',
                direction: 'outside',
                cornerHandling: true,
                preserveArcs: true
            },
            defaultSettings: {
                passes: 3,
                stepOver: 50,
                cutDepth: 0.05,
                direction: 'climb',
                entryType: 'plunge',
                preserveArcs: true
            }
        },
        drill: {
            name: 'Drilling',
            icon: '🔧',
            color: '#4488ff',
            extensions: ['.drl', '.xln', '.txt', '.drill', '.exc'],
            defaultTool: 'drill_1.0mm',
            tool: {
                diameter: 1.0,
                type: 'drill',
                material: 'carbide',
                pointAngle: 118
            },
            cutting: {
                cutDepth: -1.8,
                passDepth: 0.5, // Negative values blow the pipeline
                cutFeed: 50,
                plungeFeed: 25,
                spindleSpeed: 10000
            },
            strategy: {
                dwellTime: 0,        // 0 by default
                retractHeight: 0.5,  // Small automatic retract between pecks or drill operations for safety
                peckStepDepth: 0,    // Small G73 retract, 0 by default
                chipBreaking: false
            },
            defaultSettings: {
                millHoles: true,
                cannedCycle: 'none',
                peckDepth: 0,
                dwellTime: 0,
                retractHeight: 0.5,
                autoToolChange: true,
                depthCompensation: true,
                entryType: 'helix',
            }
        },
        clear: {
            name: 'Copper Clearing',
            icon: '🔄',
            color: '#44ff88',
            extensions: ['.gbr', '.ger', '.gpl', '.gp1', '.gnd', '.svg'],
            defaultTool: 'em_0.8mm_flat',
            tool: {
                diameter: 0.8,
                type: 'end_mill',
                material: 'carbide',
                flutes: 2
            },
            cutting: {
                cutDepth: 0.1,
                passDepth: 0.1,
                multiDepth: false,
                cutFeed: 200,
                plungeFeed: 50,
                spindleSpeed: 10000
            },
            strategy: {
                overlap: 50,
                pattern: 'parallel',
                angle: 0,
                margin: 0.1,
                stepDown: 0.1
            },
            defaultSettings: {
                passes: 4,
                stepOver: 60,
                cutDepth: 0.1,
                pattern: 'offset',
                direction: 'climb',
                entryType: 'plunge',
                preserveIslands: true
            }
        },
        cutout: {
            name: 'Board Cutout',
            icon: '✂️',
            color: '#333333ff', // Actual polygon fill color
            extensions: ['.gbr', '.gko', '.gm1', '.outline', '.mill', '.svg'],
            defaultTool: 'em_1.0mm_flat',
            tool: {
                diameter: 1.0,
                type: 'end_mill',
                material: 'carbide',
                flutes: 2
            },
            cutting: {
                cutDepth: -1.8,
                passDepth: 0.3,  // Negative values blow the pipeline
                cutFeed: 150,
                plungeFeed: 50,
                spindleSpeed: 10000
            },
            strategy: {
                tabs: 4,
                tabWidth: 3,
                tabHeight: 0.5,
                direction: 'conventional',
                stepDown: 0.2,
                leadIn: 0.5,
                leadOut: 0.5,
                preserveArcs: true
            },
            defaultSettings: {
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
    // UI
    // ============================================================================
    layout: {
        sidebarLeftWidth: 320,
        sidebarRightWidth: 380,
        statusBarHeight: 32,
        sectionHeaderHeight: 36,
        defaultTheme: 'dark',
        
        treeView: {
            indentSize: 16,
            nodeHeight: 28,
            showIcons: true,
            animateExpansion: true
        },
        
        canvas: {
            defaultZoom: 10,
            minZoom: 0.01,
            maxZoom: 1000,
            zoomStep: 1.2,
            panSensitivity: 1.0,
            wheelZoomSpeed: 0.002
        },
        
        visibility: {
            defaultLayers: {
                source: true,
                fused: true,
                toolpath: false,
                preview: false
            }
        },

        // UI Auto-transition settings
        ui: {
            autoTransition: true,         // Auto-advance after generation
            transitionDelay: 125          // ms delay before transition
        }
    },

    // ============================================================================
    // RENDERING
    // ============================================================================
    rendering: {
        themes: {
            dark: {
                canvas: {
                    background: '#0f0f0f',
                    grid: '#333333',
                    origin: '#ffffff',
                    originOutline: '#000000',
                    bounds: '#ff0000',
                    ruler: '#888888',
                    rulerText: '#cccccc'
                },
                layers: {
                    isolation: '#ff8844',
                    clear: '#44ff88',
                    drill: '#4488ff',
                    cutout: '#3f3f3fff',
                    copper: '#ff8844',
                    fused: '#ff8844',
                    toolpath: '#00ffff',
                    preview: '#ff8844',
                    selection: '#00ffff',
                    nonConductor: '#666666'
                },
                debug: {
                    holeDebug: '#ff00ff',
                    wireframe: '#00ff00',
                    bounds: '#ff0000'
                }
            },
            light: {
                canvas: {
                    background: '#b0b0b0ff',
                    grid: '#cccccc',
                    origin: '#000000',
                    originOutline: '#ffffff',
                    bounds: '#ff0000',
                    ruler: '#000000ff', // ruller scale?
                    rulerText: '#929292ff' // ruller background what? Where's text?
                },
                layers: {
                    isolation: '#cc6600',
                    clear: '#008844',
                    drill: '#0066cc',
                    cutout: '#a8a8a8ff',
                    copper: '#cc6600',
                    fused: '#ff8844',
                    toolpath: '#ff8844',
                    preview: '#ccaa00',
                    selection: '#0099cc',
                    nonConductor: '#999999'
                },
                debug: {
                    holeDebug: '#ff00ff',
                    wireframe: '#00aa00',
                    bounds: '#ff0000'
                }
            }
        },
        
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
            theme: 'dark',
            showHoles: true,
            holeRenderMode: 'proper',
            debugHoleWinding: false,
            showStats: false,
            debugCurvePoints: false
        },
        
        canvas: {
            minZoom: 0.01,
            maxZoom: 1000,
            defaultZoom: 10,
            zoomStep: 1.2,
            panSensitivity: 1.0,
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
        },
        
        toolpath: {
            strokeWidth: 1.5,
            showDirection: true,
            showStartPoint: true,
            animatePreview: false
        }
    },

    // ============================================================================
    // GEOMETRY PROCESSING
    // ============================================================================
    geometry: {
        clipperScale: 10000,
        maxCoordinate: 1000,
        coordinatePrecision: 0.001,
        
        offsetting: {
            joinType: 'round',
            miterLimit: 2.0,
            arcTolerance: 0.01,
            selfIntersectionCheck: true,
            preserveCollinear: false,
            unionPasses: true
        },
        
        fusion: {
            enabled: false,
            preserveHoles: true,
            preserveArcs: true,
            fillRule: 'nonzero'
        },
        
        segments: {
            targetLength: 0.01,
            minCircle: 256,
            maxCircle: 2048,
            minArc: 200,
            maxArc: 2048,
            obround: 128,
            adaptiveSegmentation: true
        },

        implicitRegionClosure: {
            enabled: true,  // Enable by default
            cutoutOnly: true, // Only apply to cutout operations
            warnOnFailure: true // Log a warning if merging fails
        },

        simplification: { // For dense paths that need internal offsetting
            enabled: true,
            tolerance: 0.001 
        },
        
        simplifyTolerance: 0.01,
        preserveArcs: true
    },
    
    // ============================================================================
    // FILE FORMATS
    // ============================================================================
    formats: {
        excellon: {
            defaultFormat: { integer: 3, decimal: 3 },
            defaultUnits: 'mm',
            defaultToolDiameter: 1.0,
            minToolDiameter: 0.1,
            maxToolDiameter: 10.0
        },
        
        gerber: {
            defaultFormat: { integer: 3, decimal: 3 },
            defaultUnits: 'mm',
            defaultAperture: 0.1,
            minAperture: 0.01,
            maxAperture: 10.0
        }
    },

    // ============================================================================
    // MACHINE SETTINGS
    // ============================================================================
    machine: {
        pcb: {
            thickness: 1.6,
            copperThickness: 0.035,
            minFeatureSize: 0.1
        },
        
        heights: {
            safeZ: 5.0,
            travelZ: 2.0,
            probeZ: -5.0,
            homeZ: 10.0
        },
        
        speeds: {
            rapidFeed: 1000,
            probeFeed: 25,
            maxFeed: 2000,
            maxAcceleration: 100
        },
        
        workspace: {
            system: 'G54',
            maxX: 200,
            maxY: 200,
            maxZ: 50,
            minX: 0,
            minY: 0,
            minZ: -5
        }
    },

    // ============================================================================
    // G-CODE GENERATION
    // ============================================================================
    gcode: {
        postProcessor: 'grbl',
        units: 'mm',
        
        precision: {
            coordinates: 3,
            feedrate: 0,
            spindle: 0,
            arc: 3
        },
        
        templates: {
            grbl: {
                start: 'G90 G21 G17\nG94\nM3 S{spindleSpeed}\nG4 P1',
                end: 'M5\nG0 Z{safeZ}\nM2',
                toolChange: 'M5\nG0 Z{safeZ}\nM0 (Tool change: {toolName})\nM3 S{spindleSpeed}\nG4 P1'
            },
            marlin: {
                start: 'G90 G21\nM3 S255\nG4 P1000',
                end: 'M5\nG0 Z10\nM84',
                toolChange: 'M5\nG0 Z{safeZ}\nM0\nM3 S{speed}\nG4 P1000'
            },
            linuxcnc: {
                start: 'G90 G21 G17\nG64 P0.01\nM3 S1000\nG4 P1',
                end: 'M5\nG0 Z10\nM2',
                toolChange: 'M5\nG0 Z{safeZ}\nT{tool} M6\nM3 S{speed}\nG4 P1'
            },
            mach3: {
                start: 'G90 G21 G17\nM3 S1000\nG4 P1',
                end: 'M5\nG0 Z10\nM30',
                toolChange: 'M5\nG0 Z{safeZ}\nT{tool} M6\nM3 S{speed}\nG4 P1'
            }
        },
        
        features: {
            arcCommands: true,
            helicalMoves: false,
            cannedCycles: false,
            workOffsets: true,
            toolCompensation: false,
            variableSpindle: true
        },

        // Optimization settings
        enableOptimization: false, // Master switch
        
        optimization: {
            enableGrouping: true,         // Group by tool diameter
            pathOrdering: true,           // Minimize rapid movements
            segmentSimplification: true,  // Remove co-linear segments
            leadInOut: true,              // Optimize loop entry points
            zLevelGrouping: true,         // Group by Z-height (experimental)

            rapidStrategy: 'adaptive',    // 'safe' | 'adaptive' | 'aggressive'
            shortTravelThreshold: 5.0,    // mm
            reducedClearance: 1.0,        // mm for short travels

            angleTolerance: 0.1,          // Degrees for co-linear detection
            minSegmentLength: 0.01        // mm minimum segment
        }
    },
    
    // ============================================================================
    // UI CONFIGURATION
    // ============================================================================
    ui: {
        theme: 'dark',
        showTooltips: true,
        language: 'en',
        
        timing: {
            statusMessageDuration: 5000,
            modalAnimationDuration: 300,
            inputDebounceDelay: 300,
            renderThrottle: 16,
            autoSaveInterval: 30000
        },
        
        validation: {
            minToolDiameter: 0.01,
            maxToolDiameter: 10,
            minFeedRate: 1,
            maxFeedRate: 5000,
            minSpindleSpeed: 100,
            maxSpindleSpeed: 30000,
            minDepth: 0.001,
            maxDepth: 10
        },
        
        modal: {
            totalPages: 3,
            titles: [
                '📋 PCB Preview & Fusion Setup',
                '⚙️ Offset Geometry Configuration',
                '🛠️ Toolpath Generation'
            ],
            defaultPage: 1
        },
        
        messages: {
            ready: 'Ready - Add PCB files to begin',
            loading: 'Loading...',
            processing: 'Processing...',
            success: 'Operation completed successfully',
            error: 'An error occurred',
            warning: 'Warning'
        }
    },

    // ============================================================================
    // PERFORMANCE
    // ============================================================================
    performance: {
        wasm: {
            memoryLimit: 256,
            stackSize: 1024 * 1024,
            enableSIMD: true,
            enableThreads: false
        },
        
        batching: {
            maxPrimitivesPerBatch: 1000,
            fusionBatchSize: 100,
            renderBatchSize: 500,
            parseChunkSize: 10000
        },
        
        cache: {
            enableGeometryCache: true,
            enableToolpathCache: true,
            maxCacheSize: 100,
            cacheTimeout: 300000
        },
        
        optimization: {
            simplifyThreshold: 10000,
            decimateThreshold: 0.01,
            mergeThreshold: 0.001
        },
        
        debounce: {
            propertyChanges: 300,
            treeSelection: 100,
            canvasInteraction: 16
        }
    },

    // ============================================================================
    // DEBUG & DEVELOPMENT
    // ============================================================================
    debug: {
        enabled: false,
        
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
            validatePolarity: true,
            strictParsing: false,
            warnOnInvalidData: true
        }
    },

    // ============================================================================
    // HELPER METHODS
    // ============================================================================
    
    getOperation: function(type) {
        return this.operations[type] || this.operations.isolation;
    },
    
    getTheme: function(themeName) {
        return this.rendering.themes[themeName || this.ui.theme] || this.rendering.themes.dark;
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
        return this.tools.find(tool => tool.id === toolId);
    },
    
    getToolsForOperation: function(operationType) {
        return this.tools.filter(tool => 
            tool.operations.includes(operationType)
        );
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