// config.js
// Centralized configuration for PCB CAM - constants only

window.PCBCAMConfig = {
    // ============================================================================
    // GEOMETRY PROCESSING
    // ============================================================================
    geometry: {
        // Clipper2 scale factor for integer conversion
        // Higher = more precision but smaller max board size
        // 10000 = 0.1 micron precision, safe for boards up to 460mm
        clipperScale: 10000,
        
        // Coordinate validation
        maxCoordinate: 1000,           // mm - max reasonable PCB dimension
        coordinatePrecision: 0.001,    // mm - 1 micron precision threshold
        
        // Curve segmentation
        segments: {
            targetLength: 0.1,          // mm - target segment length
            minCircle: 16,              // min segments for circles
            maxCircle: 128,             // max segments for circles
            minArc: 8,                  // min segments for arcs
            maxArc: 64,                 // max segments for arcs
            obround: 16                 // segments per arc in obrounds
        },
        
        // Path optimization
        simplifyTolerance: 0.01,       // mm - path simplification tolerance
        preserveArcs: true,            // preserve arc information
        adaptiveSegmentation: true,    // adjust segments based on size
        
        // Fusion settings
        fusion: {
            enabled: false,             // default fusion state
            preserveHoles: true,        // use PolyTree for hole detection
            fillRule: 'nonzero'        // nonzero or evenodd
        }
    },
    
    // ============================================================================
    // FILE FORMATS
    // ============================================================================
    formats: {
        excellon: {
            defaultFormat: { integer: 3, decimal: 3 },
            defaultUnits: 'mm',
            defaultToolDiameter: 1.0,   // mm
            minToolDiameter: 0.1,       // mm
            maxToolDiameter: 10.0       // mm
        },
        
        gerber: {
            defaultFormat: { integer: 3, decimal: 3 },
            defaultUnits: 'mm',
            defaultAperture: 0.1,       // mm
            minAperture: 0.01,          // mm
            maxAperture: 10.0           // mm
        }
    },
    
    // ============================================================================
    // OPERATION DEFINITIONS
    // ============================================================================
    operations: {
        isolation: {
            extensions: ['.gbr', '.ger', '.gtl', '.gbl', '.gts', '.gbs', '.gto', '.gbo', '.gtp', '.gbp'],
            color: '#ff8844',
            icon: '🔄',
            tool: {
                diameter: 0.1,          // mm
                type: 'end_mill',
                material: 'carbide',
                flutes: 2
            },
            cutting: {
                cutDepth: 0.05,         // mm
                passDepth: 0.05,        // mm
                cutFeed: 100,           // mm/min
                plungeFeed: 50,         // mm/min
                spindleSpeed: 10000     // RPM
            },
            strategy: {
                passes: 1,
                overlap: 50,            // %
                method: 'offset',
                direction: 'outside',
                cornerHandling: true,
                preserveArcs: true
            }
        },
        
        clear: {
            extensions: ['.gbr', '.ger', '.gpl', '.gp1', '.gnd'],
            color: '#44ff88',
            icon: '🔄',
            tool: {
                diameter: 0.8,
                type: 'end_mill',
                material: 'carbide',
                flutes: 2
            },
            cutting: {
                cutDepth: 0.1,
                passDepth: 0.05,
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
            }
        },
        
        drill: {
            extensions: ['.drl', '.xln', '.txt', '.drill', '.exc'],
            color: '#4488ff',
            icon: '🔧',
            tool: {
                diameter: 1.0,
                type: 'drill',
                material: 'carbide',
                pointAngle: 118
            },
            cutting: {
                cutDepth: 1.8,
                passDepth: 0.2,
                cutFeed: 50,
                plungeFeed: 25,
                spindleSpeed: 10000
            },
            strategy: {
                peckDepth: 0.5,
                dwellTime: 0.1,
                retractHeight: 1,
                chipBreaking: false
            }
        },
        
        cutout: {
            extensions: ['.gbr', '.gko', '.gm1', '.outline', '.mill'],
            color: '#ff00ff',
            icon: '🔄',
            tool: {
                diameter: 1.0,
                type: 'end_mill',
                material: 'carbide',
                flutes: 2
            },
            cutting: {
                cutDepth: 1.8,
                passDepth: 0.2,
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
            }
        }
    },
    
    // ============================================================================
    // RENDERING
    // ============================================================================
    rendering: {
        // Color schemes
        themes: {
            dark: {
                canvas: {
                    background: '#1a1a1a',
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
                    cutout: '#ff00ff',
                    copper: '#ff8844',
                    fused: '#00ff00',
                    nonConductor: '#666666',
                    toolpath: '#ffff00',
                    selection: '#00ffff'
                },
                debug: {
                    holeDebug: '#ff00ff',
                    wireframe: '#00ff00',
                    bounds: '#ff0000'
                }
            },
            light: {
                canvas: {
                    background: '#ffffff',
                    grid: '#cccccc',
                    origin: '#000000',
                    originOutline: '#ffffff',
                    bounds: '#ff0000',
                    ruler: '#666666',
                    rulerText: '#333333'
                },
                layers: {
                    isolation: '#cc6600',
                    clear: '#008844',
                    drill: '#0066cc',
                    cutout: '#cc00cc',
                    copper: '#cc6600',
                    fused: '#00aa00',
                    nonConductor: '#999999',
                    toolpath: '#cccc00',
                    selection: '#0099cc'
                },
                debug: {
                    holeDebug: '#ff00ff',
                    wireframe: '#00aa00',
                    bounds: '#ff0000'
                }
            }
        },
        
        // Canvas settings
        canvas: {
            minZoom: 0.01,
            maxZoom: 1000,
            defaultZoom: 10,
            zoomStep: 1.2,              // multiplier for zoom in/out
            panSensitivity: 1.0,
            
            // Sizes in pixels
            rulerSize: 20,
            rulerTickLength: 5,
            originMarkerSize: 10,
            originCircleSize: 3,
            
            // Stroke widths
            wireframe: {
                baseThickness: 0.08,
                minThickness: 0.02,
                maxThickness: 0.2
            }
        },
        
        // Grid configuration
        grid: {
            minPixelSpacing: 40,        // pixels
            steps: [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 
                   0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100]
        },
        
        // Default render options
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
            showStats: false
        }
    },
    
    // ============================================================================
    // MACHINE SETTINGS
    // ============================================================================
    machine: {
        pcb: {
            thickness: 1.6,             // mm - standard FR4
            copperThickness: 0.035,    // mm - 1oz copper
            minFeatureSize: 0.1        // mm
        },
        
        heights: {
            safeZ: 2,                   // mm - safe height for rapids
            travelZ: 1,                 // mm - travel between cuts
            probeZ: -5,                 // mm - max probe depth
            homeZ: 10                   // mm - home position Z
        },
        
        speeds: {
            rapidFeed: 1000,            // mm/min
            probeFeed: 25,              // mm/min
            maxFeed: 2000,              // mm/min
            maxAcceleration: 100        // mm/s²
        },
        
        workspace: {
            system: 'G54',              // work coordinate system
            maxX: 200,                  // mm
            maxY: 200,                  // mm
            maxZ: 50,                   // mm
            minX: 0,                    // mm
            minY: 0,                    // mm
            minZ: -5                    // mm
        }
    },
    
    // ============================================================================
    // G-CODE GENERATION
    // ============================================================================
    gcode: {
        postProcessor: 'grbl',         // grbl, marlin, linuxcnc, mach3
        units: 'mm',                    // mm or inch
        
        // Number formatting
        precision: {
            coordinates: 3,             // decimal places for X,Y,Z
            feedrate: 0,               // decimal places for F
            spindle: 0,                // decimal places for S
            arc: 3                     // decimal places for I,J,K
        },
        
        // Templates per post-processor
        templates: {
            grbl: {
                start: 'G90 G21 G17\nM3 S1000\nG4 P1',
                end: 'M5\nG0 Z10\nM2',
                toolChange: 'M5\nG0 Z{safeZ}\nM0\nM3 S{speed}\nG4 P1'
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
        
        // Feature support
        features: {
            arcCommands: true,          // G02/G03 support
            helicalMoves: false,        // helical interpolation
            cannedCycles: false,        // G81-G89 drilling cycles
            workOffsets: true,          // G54-G59 support
            toolCompensation: false,    // G41/G42 support
            variableSpindle: true       // M3 S commands
        }
    },
    
    // ============================================================================
    // UI CONFIGURATION
    // ============================================================================
    ui: {
        theme: 'dark',                  // default theme
        showTooltips: true,
        language: 'en',
        
        // Timing (milliseconds)
        timing: {
            statusMessageDuration: 5000,
            modalAnimationDuration: 300,
            inputDebounceDelay: 300,
            renderThrottle: 16,         // ~60fps
            autoSaveInterval: 30000     // 30 seconds
        },
        
        // Input validation
        validation: {
            minToolDiameter: 0.01,      // mm
            maxToolDiameter: 10,        // mm
            minFeedRate: 1,             // mm/min
            maxFeedRate: 5000,          // mm/min
            minSpindleSpeed: 100,       // RPM
            maxSpindleSpeed: 30000,     // RPM
            minDepth: 0.001,            // mm
            maxDepth: 10                // mm
        },
        
        // Modal configuration
        modal: {
            totalPages: 3,
            titles: [
                '📝 PCB Preview & Fusion Setup',
                '⚙️ Offset Geometry Configuration',
                '🛠️ Toolpath Generation'
            ],
            defaultPage: 1
        },
        
        // Status messages
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
        // WASM settings
        wasm: {
            memoryLimit: 256,           // MB
            stackSize: 1024 * 1024,     // bytes
            enableSIMD: true,
            enableThreads: false
        },
        
        // Batch processing
        batching: {
            maxPrimitivesPerBatch: 1000,
            fusionBatchSize: 100,
            renderBatchSize: 500,
            parseChunkSize: 10000       // lines per chunk
        },
        
        // Caching
        cache: {
            enableGeometryCache: true,
            maxCacheSize: 100,          // MB
            cacheTimeout: 300000        // 5 minutes
        },
        
        // Optimization thresholds
        optimization: {
            simplifyThreshold: 10000,   // primitives count
            decimateThreshold: 0.01,    // mm
            mergeThreshold: 0.001       // mm
        }
    },
    
    // ============================================================================
    // DEBUG & DEVELOPMENT
    // ============================================================================
    debug: {
        enabled: false,
        
        // Logging flags
        logging: {
            wasmOperations: false,
            coordinateConversion: false,
            polarityHandling: false,
            parseOperations: false,
            renderOperations: false,
            fusionOperations: true,
            fileOperations: false,
            toolpathGeneration: false,
            curveRegistration: true      // NEW: track curve registration
        },
        
        // Visualization
        visualization: {
            showBounds: false,
            showStats: false,
            showCoordinates: false,
            showPrimitiveIndices: false,
            showWindingDirection: false,
            highlightHoles: false
        },
        
        // Validation
        validation: {
            validateGeometry: true,
            validateCoordinates: true,
            validatePolarity: true,
            strictParsing: false,
            warnOnInvalidData: true
        }
    },
    
    // ============================================================================
    // CONFIG-SPECIFIC HELPER METHODS
    // ============================================================================
    
    // Get operation configuration by type
    getOperation: function(type) {
        return this.operations[type] || this.operations.isolation;
    },
    
    // Get current theme colors
    getTheme: function(themeName) {
        return this.rendering.themes[themeName || this.ui.theme] || this.rendering.themes.dark;
    },
    
    // Get G-code template
    getGcodeTemplate: function(processor, type) {
        const templates = this.gcode.templates[processor || this.gcode.postProcessor];
        return templates ? templates[type] : '';
    },
    
    // Format number for G-code
    formatGcode: function(value, type = 'coordinates') {
        const precision = this.gcode.precision[type] || 3;
        return value.toFixed(precision).replace(/\.?0+$/, '');
    }
};

// ============================================================================
// GLOBAL CURVE REGISTRY - Initialized immediately
// ============================================================================
(function() {
    'use strict';
    
    class GlobalCurveRegistry {
        constructor() {
            this.registry = new Map();
            this.hashToId = new Map();
            this.primitiveIdToCurves = new Map();
            this.nextId = 1;
            this.hashPrecision = 1000;
            
            // Statistics
            this.stats = {
                registered: 0,
                circles: 0,
                arcs: 0,
                endCaps: 0
            };
        }
        
        generateHash(metadata) {
            const roundedCenter = {
                x: Math.round(metadata.center.x * this.hashPrecision) / this.hashPrecision,
                y: Math.round(metadata.center.y * this.hashPrecision) / this.hashPrecision
            };
            const roundedRadius = Math.round(metadata.radius * this.hashPrecision) / this.hashPrecision;
            
            let str = `${metadata.type}_${roundedCenter.x}_${roundedCenter.y}_${roundedRadius}`;
            
            if (metadata.type === 'arc') {
                const roundedStartAngle = Math.round((metadata.startAngle || 0) * this.hashPrecision) / this.hashPrecision;
                const roundedEndAngle = Math.round((metadata.endAngle || Math.PI * 2) * this.hashPrecision) / this.hashPrecision;
                str += `_${roundedStartAngle}_${roundedEndAngle}_${metadata.clockwise || false}`;
            }
            
            // Simple string hash
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash;
            }
            
            return Math.abs(hash);
        }
        
        register(metadata) {
            if (!metadata || !metadata.center || metadata.radius === undefined) {
                return null;
            }
            
            const hash = this.generateHash(metadata);
            
            // Check if already registered
            if (this.hashToId.has(hash)) {
                return this.hashToId.get(hash);
            }
            
            // Register new curve
            const id = this.nextId++;
            this.registry.set(id, metadata);
            this.hashToId.set(hash, id);
            
            // Track primitive association if provided
            if (metadata.primitiveId) {
                if (!this.primitiveIdToCurves.has(metadata.primitiveId)) {
                    this.primitiveIdToCurves.set(metadata.primitiveId, []);
                }
                this.primitiveIdToCurves.get(metadata.primitiveId).push(id);
            }
            
            // Update stats
            this.stats.registered++;
            if (metadata.type === 'circle') this.stats.circles++;
            else if (metadata.type === 'arc') this.stats.arcs++;
            if (metadata.source === 'end_cap') this.stats.endCaps++;
            
            if (window.PCBCAMConfig?.debug?.logging?.curveRegistration) {
                console.log(`[GlobalRegistry] Registered curve ${id}: ${metadata.type} r=${metadata.radius.toFixed(3)}`);
            }
            
            return id;
        }
        
        getCurve(id) {
            return this.registry.get(id);
        }
        
        getCurvesForPrimitive(primitiveId) {
            return this.primitiveIdToCurves.get(primitiveId) || [];
        }
        
        clear() {
            this.registry.clear();
            this.hashToId.clear();
            this.primitiveIdToCurves.clear();
            this.nextId = 1;
            this.stats = {
                registered: 0,
                circles: 0,
                arcs: 0,
                endCaps: 0
            };
        }
        
        getStats() {
            return {
                ...this.stats,
                registrySize: this.registry.size
            };
        }
    }
    
    // Create and expose global registry
    window.globalCurveRegistry = new GlobalCurveRegistry();
    
})();