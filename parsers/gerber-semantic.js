// Semantic Gerber Parser - FIXED: Proper region handling, no duplicate perimeters
// parsers/gerber-semantic.js

class GerberSemanticParser {
    constructor(options = {}) {
        this.options = {
            units: 'mm',
            format: { integer: 3, decimal: 3 },
            debug: options.debug || false,
            joinPaths: true,
            joinTolerance: 0.001,
            detectBranching: true,
            autoFixDuplicates: true,
            ...options
        };
        
        // Parser state
        this.commands = [];
        this.apertures = new Map();
        this.currentAperture = null;
        this.currentPoint = { x: 0, y: 0 };
        this.interpolationMode = 'G01';
        this.regionMode = false;
        this.polarity = 'dark';
        this.apertureFunction = null;
        
        // Region tracking
        this.currentRegion = null;
        this.regionsProcessed = 0;
        this.inRegionBlock = false;
        
        // FIXED: Track region state more explicitly
        this.regionState = {
            active: false,
            collectingPoints: false,
            lastMove: null,
            startedAt: null // Track where region started for debugging
        };
        
        // Enhanced path tracking for branching detection
        this.traceNetwork = new Map();
        this.pathJoinStats = {
            totalDraws: 0,
            joinedIntoPath: 0,
            standaloneDraws: 0,
            pathsCreated: 0,
            branchesDetected: 0,
            complexPathsCreated: 0,
            branchingNetworksCreated: 0
        };
        
        // Coordinate validation tracking
        this.coordinateValidation = {
            validCoordinates: 0,
            invalidCoordinates: 0,
            coordinateRange: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
            suspiciousCoordinates: [],
            objectCoordinates: []
        };
        
        // Results
        this.layers = {
            polarity: 'positive',
            units: this.options.units,
            bounds: null,
            apertures: [],
            objects: []
        };
        
        this.errors = [];
        this.warnings = [];
        
        this.debugStats = {
            coordinatesInRegions: 0,
            coordinatesAsDraws: 0,
            regionsCreated: 0,
            drawsCreated: 0,
            flashesCreated: 0,
            pathsJoined: 0,
            branchingPathsCreated: 0,
            duplicatePerimetersAvoided: 0,
            duplicatePerimetersRemoved: 0
        };
    }
    
    parse(content) {
        try {
            this.debug('FIXED: Starting Gerber parse with improved command processing...');
            
            // Split into commands
            const blocks = this.splitIntoBlocks(content);
            this.debug(`Processing ${blocks.length} command blocks`);
            
            // Process each block
            blocks.forEach((block, index) => {
                this.processBlock(block, index);
            });
            
            // Validate region integrity before processing traces
            if (this.options.autoFixDuplicates) {
                this.validateRegionIntegrity();
            }
            
            // Process trace network after all draws are collected
            this.processTraceNetwork();
            
            // Finalize
            this.finalizeParse();
            
            this.debug(`FIXED: Parse complete: ${this.layers.objects.length} objects`);
            this.debug(`Region perimeter duplicates avoided: ${this.debugStats.duplicatePerimetersAvoided}`);
            this.debug(`Region perimeter duplicates removed: ${this.debugStats.duplicatePerimetersRemoved}`);
            this.debug(`Debug stats:`, this.debugStats);
            
            return {
                success: true,
                layers: this.layers,
                errors: this.errors,
                warnings: this.warnings,
                coordinateValidation: this.coordinateValidation,
                debugStats: this.debugStats,
                pathJoinStats: this.pathJoinStats
            };
            
        } catch (error) {
            this.errors.push(`Parse error: ${error.message}`);
            return {
                success: false,
                layers: this.layers,
                errors: this.errors,
                warnings: this.warnings,
                coordinateValidation: this.coordinateValidation
            };
        }
    }
    
    splitIntoBlocks(content) {
        const blocks = [];
        let currentBlock = '';
        let inExtended = false;
        
        for (let i = 0; i < content.length; i++) {
            const char = content[i];
            
            if (char === '%') {
                if (inExtended && currentBlock) {
                    blocks.push({ type: 'extended', content: currentBlock.trim() });
                    currentBlock = '';
                }
                inExtended = !inExtended;
            } else if (char === '*' && !inExtended) {
                if (currentBlock.trim()) {
                    blocks.push({ type: 'standard', content: currentBlock.trim() });
                }
                currentBlock = '';
            } else if (char !== '\r' && char !== '\n') {
                currentBlock += char;
            }
        }
        
        return blocks;
    }
    
    processBlock(block, index) {
        if (block.type === 'extended') {
            this.processExtendedCommand(block.content);
        } else {
            this.processStandardCommand(block.content);
        }
    }
    
    processExtendedCommand(command) {
        // Format specification
        if (command.startsWith('FSLAX') || command.startsWith('FSLAY')) {
            this.parseFormatSpec(command);
        }
        // Mode commands
        else if (command === 'MOMM') {
            this.options.units = 'mm';
            this.layers.units = 'mm';
            this.debug('Units set to metric');
        }
        else if (command === 'MOIN') {
            this.options.units = 'inch';
            this.layers.units = 'inch';
            this.debug('Units set to imperial');
        }
        // Aperture definition
        else if (command.startsWith('AD')) {
            this.parseApertureDefinition(command);
        }
        // Aperture macro
        else if (command.startsWith('AM')) {
            this.parseApertureMacro(command);
        }
        // Layer polarity
        else if (command === 'LPD') {
            this.polarity = 'dark';
        }
        else if (command === 'LPC') {
            this.polarity = 'clear';
        }
        // Aperture attributes
        else if (command.startsWith('TA.AperFunction')) {
            this.apertureFunction = command.substring(16);
        }
        else if (command.startsWith('TD')) {
            this.apertureFunction = null;
        }
    }
    
    // FIXED: New helper methods for proper command parsing
    extractCommandCodes(command) {
        const codes = [];
        
        // Extract G codes
        const gMatch = command.match(/G(\d+)/);
        if (gMatch) codes.push(`G${gMatch[1]}`);
        
        // Extract D codes (aperture selection or operation)
        const dMatch = command.match(/D(\d{2,})/);
        if (dMatch && parseInt(dMatch[1]) >= 10) {
            codes.push(`D${dMatch[1]}`);
        }
        
        // Extract M codes
        const mMatch = command.match(/M(\d+)/);
        if (mMatch) codes.push(`M${mMatch[1]}`);
        
        return codes;
    }
    
    hasCoordinates(command) {
        return /[XYIJ][+-]?\d+/.test(command);
    }
    
    processModalCommand(code) {
        if (code.startsWith('G')) {
            const value = parseInt(code.substring(1));
            switch (value) {
                case 1: 
                    this.interpolationMode = 'G01'; 
                    break;
                case 2: 
                    this.interpolationMode = 'G02'; 
                    break;
                case 3: 
                    this.interpolationMode = 'G03'; 
                    break;
                case 36:
                    this.regionMode = true;
                    this.regionState.active = true;
                    this.regionState.collectingPoints = true;
                    this.regionState.lastMove = null;
                    this.regionState.startedAt = Date.now();
                    this.startRegion();
                    this.debug('FIXED: Region mode started (G36) - will NOT create duplicate perimeter draws');
                    break;
                case 37:
                    this.endRegion();
                    this.regionMode = false;
                    this.regionState.active = false;
                    this.regionState.collectingPoints = false;
                    this.regionState.lastMove = null;
                    this.regionState.startedAt = null;
                    this.debug('FIXED: Region mode ended (G37)');
                    break;
            }
        } else if (code.startsWith('D')) {
            const aperNum = parseInt(code.substring(1));
            if (aperNum >= 10) {
                this.currentAperture = code;
            }
        } else if (code === 'M02') {
            if (this.regionState.active && this.currentRegion) {
                this.debug('Force closing region at end of file');
                this.endRegion();
                this.regionMode = false;
                this.regionState.active = false;
                this.regionState.collectingPoints = false;
            }
        }
    }
    
    // FIXED: Improved command processing that handles compound commands
    processStandardCommand(command) {
        // Parse all command codes in the block FIRST
        const commandCodes = this.extractCommandCodes(command);
        
        // Process modal commands before coordinates
        commandCodes.forEach(code => {
            this.processModalCommand(code);
        });
        
        // Handle standalone D-codes for aperture selection
        if (command.match(/^D\d+$/) && !commandCodes.length) {
            const code = parseInt(command.substring(1));
            if (code >= 10) {
                this.currentAperture = command;
            }
            return;
        }
        
        // Handle standalone G-codes
        if (command.match(/^G\d+$/) && !commandCodes.length) {
            this.processModalCommand(command);
            return;
        }
        
        // Handle M02 end of file
        if (command === 'M02') {
            this.processModalCommand('M02');
            this.debug('End of file');
            return;
        }
        
        // Only process coordinates if present and after modal commands are set
        if (this.hasCoordinates(command)) {
            this.processCoordinate(command);
        }
    }
    
    parseFormatSpec(command) {
        const match = command.match(/FS([LT])([AI])X(\d)(\d)Y(\d)(\d)/);
        if (match) {
            this.options.format = {
                integer: parseInt(match[3]),
                decimal: parseInt(match[4])
            };
            this.debug(`Format: ${match[3]}.${match[4]}`);
        }
    }
    
    parseApertureDefinition(command) {
        const match = command.match(/ADD(\d+)([CROP]),(.+)/);
        if (!match) {
            this.errors.push(`Invalid aperture definition: ${command}`);
            return;
        }
        
        const code = `D${match[1]}`;
        const type = match[2];
        const paramString = match[3];
        
        const params = paramString.split('X').map(p => {
            const value = parseFloat(p);
            if (!isFinite(value) || value <= 0) {
                this.warnings.push(`Invalid aperture parameter: ${p} in ${command}`);
                return 0.1;
            }
            return value;
        });
        
        const aperture = {
            code: code,
            type: this.getApertureTypeName(type),
            parameters: params,
            function: this.apertureFunction
        };
        
        const primarySize = params[0] || 0;
        if (primarySize > 25.4) {
            this.warnings.push(`Unusually large aperture ${code}: ${primarySize}mm`);
        }
        if (primarySize < 0.01) {
            this.warnings.push(`Unusually small aperture ${code}: ${primarySize}mm`);
        }
        
        this.apertures.set(code, aperture);
        this.layers.apertures.push(aperture);
        
        this.debug(`Aperture ${code}: ${aperture.type} [${params.join(', ')}]`);
    }
    
    parseApertureMacro(command) {
        const name = command.substring(2, command.indexOf('*'));
        this.debug(`Aperture macro: ${name} (stored for future use)`);
    }
    
    getApertureTypeName(code) {
        switch (code) {
            case 'C': return 'circle';
            case 'R': return 'rectangle';
            case 'O': return 'obround';
            case 'P': return 'polygon';
            default: return 'unknown';
        }
    }
    
    startRegion() {
        this.currentRegion = {
            type: 'region',
            polarity: this.polarity,
            points: [],
            function: this.apertureFunction
        };
        
        this.debug('FIXED: Started region collection (points will be added from coordinates)');
    }
    
    endRegion() {
        if (this.currentRegion && this.currentRegion.points.length >= 3) {
            const validPoints = this.currentRegion.points.filter(point => 
                isFinite(point.x) && isFinite(point.y)
            );
            
            if (validPoints.length < 3) {
                this.errors.push(`Region has insufficient valid points: ${validPoints.length}`);
                this.currentRegion = null;
                return;
            }
            
            this.currentRegion.points = validPoints;
            
            // Ensure closed
            const first = this.currentRegion.points[0];
            const last = this.currentRegion.points[this.currentRegion.points.length - 1];
            
            if (Math.abs(first.x - last.x) > 0.001 || Math.abs(first.y - last.y) > 0.001) {
                this.currentRegion.points.push({ ...first });
            }
            
            this.coordinateValidation.objectCoordinates.push({
                type: 'region',
                pointCount: this.currentRegion.points.length,
                bounds: this.calculatePointsBounds(this.currentRegion.points)
            });
            
            this.layers.objects.push(this.currentRegion);
            this.regionsProcessed++;
            this.debugStats.regionsCreated++;
            
            this.debug(`FIXED: Completed region with ${this.currentRegion.points.length} points (no perimeter draws created)`);
        }
        
        this.currentRegion = null;
    }
    
    calculatePointsBounds(points) {
        if (points.length === 0) return null;
        
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        points.forEach(point => {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        });
        
        return { minX, minY, maxX, maxY };
    }
    
    /**
     * FIXED: Process coordinates with strict region isolation and validation
     */
    processCoordinate(command) {
        const newPoint = this.parseCoordinates(command);
        const operation = this.parseOperation(command);
        
        if (!newPoint) {
            this.debug(`Failed to parse coordinates from: ${command}`);
            return;
        }
        
        // FIXED: Enhanced validation - triple-check region state
        if (this.regionMode || this.regionState.active || this.currentRegion) {
            // ANY of these conditions means we're in a region
            if (!this.regionState.active) {
                console.warn('Region mode inconsistency detected, forcing active state');
                this.regionState.active = true;
            }
            
            if (operation === 'D02') {
                // Move operation in region - just update position
                this.regionState.lastMove = newPoint;
                this.currentPoint = newPoint;
                this.debug('FIXED: D02 move in region - position updated, no draw');
            } else {
                // Any other operation in region - add point to region
                if (this.currentRegion) {
                    // If we had a D02 move and this is the first point, add the move point first
                    if (this.regionState.lastMove && this.currentRegion.points.length === 0) {
                        this.currentRegion.points.push(this.regionState.lastMove);
                        this.regionState.lastMove = null;
                    }
                    
                    this.currentRegion.points.push(newPoint);
                    this.debugStats.coordinatesInRegions++;
                    this.debugStats.duplicatePerimetersAvoided++;
                    this.debug('FIXED: Added point to region (no duplicate draw created)');
                } else {
                    this.debug('FIXED: Warning - coordinate in region mode but no active region object');
                }
                this.currentPoint = newPoint;
            }
            
            // CRITICAL: Always return early when in region mode
            return;
        }
        
        // NOT in region mode - process normally as draw/flash
        this.debugStats.coordinatesAsDraws++;
        
        switch (operation) {
            case 'D01': // Draw
                this.addToTraceNetwork(this.currentPoint, newPoint);
                break;
            case 'D02': // Move
                // Move operation - no drawing
                break;
            case 'D03': // Flash
                this.createFlash(newPoint);
                break;
        }
        
        this.currentPoint = newPoint;
    }
    
    /**
     * FIXED: Validate region integrity and remove duplicate perimeters
     */
    validateRegionIntegrity() {
        const regions = this.layers.objects.filter(obj => obj.type === 'region');
        const draws = this.layers.objects.filter(obj => obj.type === 'draw');
        
        if (regions.length === 0 || draws.length === 0) {
            return; // Nothing to validate
        }
        
        const tolerance = 0.01; // 10 micron tolerance
        const removedDraws = [];
        
        regions.forEach((region, idx) => {
            if (!region.points || region.points.length < 3) return;
            
            // Check if any draws match this region's perimeter
            const suspiciousDraws = draws.filter(draw => {
                if (removedDraws.includes(draw)) return false;
                if (!draw.start || !draw.end) return false;
                
                // Check if draw endpoints are on region boundary
                for (let i = 0; i < region.points.length - 1; i++) {
                    const p1 = region.points[i];
                    const p2 = region.points[i + 1];
                    
                    // Check if draw matches this segment
                    if ((Math.abs(draw.start.x - p1.x) < tolerance && 
                         Math.abs(draw.start.y - p1.y) < tolerance &&
                         Math.abs(draw.end.x - p2.x) < tolerance && 
                         Math.abs(draw.end.y - p2.y) < tolerance) ||
                        (Math.abs(draw.start.x - p2.x) < tolerance && 
                         Math.abs(draw.start.y - p2.y) < tolerance &&
                         Math.abs(draw.end.x - p1.x) < tolerance && 
                         Math.abs(draw.end.y - p1.y) < tolerance)) {
                        return true;
                    }
                }
                return false;
            });
            
            if (suspiciousDraws.length > 0) {
                this.debug(`VALIDATION: Region ${idx} has ${suspiciousDraws.length} duplicate perimeter draws - removing`);
                
                // Remove the duplicate draws
                suspiciousDraws.forEach(draw => {
                    const index = this.layers.objects.indexOf(draw);
                    if (index > -1) {
                        this.layers.objects.splice(index, 1);
                        removedDraws.push(draw);
                        this.debugStats.duplicatePerimetersRemoved++;
                    }
                });
            }
        });
        
        if (this.debugStats.duplicatePerimetersRemoved > 0) {
            this.debug(`Removed ${this.debugStats.duplicatePerimetersRemoved} duplicate perimeter draws`);
        }
    }
    
    /**
     * Add draw to trace network for branching analysis
     */
    addToTraceNetwork(start, end) {
        if (!this.currentAperture) return;
        
        this.pathJoinStats.totalDraws++;
        
        const aperture = this.apertures.get(this.currentAperture);
        if (!aperture) return;
        
        // Initialize aperture trace network if needed
        if (!this.traceNetwork.has(this.currentAperture)) {
            this.traceNetwork.set(this.currentAperture, {
                draws: [],
                aperture: aperture,
                processed: false
            });
        }
        
        const network = this.traceNetwork.get(this.currentAperture);
        
        // Store the draw operation
        network.draws.push({
            start: { ...start },
            end: { ...end },
            interpolation: this.interpolationMode,
            polarity: this.polarity,
            function: this.apertureFunction || aperture.function
        });
    }
    
    /**
     * Process trace network with proper branching support and duplicate filtering
     */
    processTraceNetwork() {
        this.debug('Processing trace network for branching detection...');
        
        // FIXED: Pre-filter to remove traces that duplicate region perimeters
        this.filterDuplicatePerimeterTraces();
        
        this.traceNetwork.forEach((network, apertureCode) => {
            if (network.processed || network.draws.length === 0) return;
            
            this.debug(`Processing ${network.draws.length} draws for aperture ${apertureCode}`);
            
            // Build connectivity graph and detect branching
            const branchingAnalysis = this.analyzeBranchingNetwork(network.draws);
            
            if (branchingAnalysis.isBranching) {
                // Create branching network object
                this.createBranchingNetwork(branchingAnalysis, apertureCode, network.draws[0]);
                this.pathJoinStats.branchingNetworksCreated++;
            } else {
                // Process as regular connected paths
                const paths = this.extractConnectedPaths(network.draws);
                
                paths.forEach((pathDraws, index) => {
                    if (pathDraws.length === 1) {
                        // Single draw
                        const draw = pathDraws[0];
                        this.layers.objects.push({
                            type: 'draw',
                            start: draw.start,
                            end: draw.end,
                            aperture: apertureCode,
                            interpolation: draw.interpolation,
                            polarity: draw.polarity,
                            function: draw.function
                        });
                        this.debugStats.drawsCreated++;
                        this.pathJoinStats.standaloneDraws++;
                    } else {
                        // Connected path (no branching)
                        const pathPoints = this.convertDrawsToSimplePath(pathDraws);
                        
                        if (pathPoints.length >= 2) {
                            this.layers.objects.push({
                                type: 'draw',
                                subtype: 'connected_path',
                                points: pathPoints,
                                aperture: apertureCode,
                                interpolation: pathDraws[0].interpolation,
                                polarity: pathDraws[0].polarity,
                                function: pathDraws[0].function,
                                segmentCount: pathDraws.length,
                                isBranching: false
                            });
                            
                            this.debugStats.drawsCreated++;
                            this.pathJoinStats.pathsCreated++;
                            this.pathJoinStats.joinedIntoPath += pathDraws.length;
                        }
                    }
                });
            }
            
            network.processed = true;
        });
        
        this.debug(`Trace network processing complete: ${this.pathJoinStats.pathsCreated} paths, ${this.pathJoinStats.branchingNetworksCreated} branching networks`);
    }
    
    /**
     * FIXED: Filter out traces that duplicate region perimeters
     */
    filterDuplicatePerimeterTraces() {
        const regions = this.layers.objects.filter(obj => obj.type === 'region');
        
        if (regions.length === 0) {
            return; // No regions to check against
        }
        
        const tolerance = 0.01; // 10 micron tolerance
        let totalRemoved = 0;
        
        this.traceNetwork.forEach((network, apertureCode) => {
            if (network.processed || !network.draws) return;
            
            const filteredDraws = [];
            
            network.draws.forEach(draw => {
                let isDuplicate = false;
                
                // Check if this draw matches any region edge
                for (const region of regions) {
                    if (!region.points || region.points.length < 3) continue;
                    
                    // Check each edge of the region
                    for (let i = 0; i < region.points.length - 1; i++) {
                        const p1 = region.points[i];
                        const p2 = region.points[i + 1];
                        
                        // Check if draw matches this edge (in either direction)
                        if ((Math.abs(draw.start.x - p1.x) < tolerance && 
                             Math.abs(draw.start.y - p1.y) < tolerance &&
                             Math.abs(draw.end.x - p2.x) < tolerance && 
                             Math.abs(draw.end.y - p2.y) < tolerance) ||
                            (Math.abs(draw.start.x - p2.x) < tolerance && 
                             Math.abs(draw.start.y - p2.y) < tolerance &&
                             Math.abs(draw.end.x - p1.x) < tolerance && 
                             Math.abs(draw.end.y - p1.y) < tolerance)) {
                            isDuplicate = true;
                            break;
                        }
                    }
                    
                    if (isDuplicate) break;
                }
                
                if (!isDuplicate) {
                    filteredDraws.push(draw);
                } else {
                    totalRemoved++;
                    this.debugStats.duplicatePerimetersRemoved++;
                    this.debugStats.duplicatePerimetersAvoided++;
                }
            });
            
            network.draws = filteredDraws;
        });
        
        if (totalRemoved > 0) {
            this.debug(`FIXED: Removed ${totalRemoved} duplicate perimeter traces before processing`);
        }
    }
    
    /**
     * Analyze network for branching structure
     */
    analyzeBranchingNetwork(draws) {
        const junctions = new Map();
        const tolerance = this.options.joinTolerance;
        
        // Build junction map
        draws.forEach((draw, index) => {
            const startKey = `${draw.start.x.toFixed(6)},${draw.start.y.toFixed(6)}`;
            const endKey = `${draw.end.x.toFixed(6)},${draw.end.y.toFixed(6)}`;
            
            if (!junctions.has(startKey)) {
                junctions.set(startKey, {
                    point: draw.start,
                    connections: []
                });
            }
            junctions.get(startKey).connections.push({ drawIndex: index, isStart: true });
            
            if (!junctions.has(endKey)) {
                junctions.set(endKey, {
                    point: draw.end,
                    connections: []
                });
            }
            junctions.get(endKey).connections.push({ drawIndex: index, isStart: false });
        });
        
        // Find branch points (junctions with 3+ connections)
        const branchPoints = [];
        let maxConnections = 0;
        
        junctions.forEach((junction, key) => {
            if (junction.connections.length > 2) {
                branchPoints.push({
                    point: junction.point,
                    connectionCount: junction.connections.length,
                    connections: junction.connections
                });
                maxConnections = Math.max(maxConnections, junction.connections.length);
            }
        });
        
        return {
            isBranching: branchPoints.length > 0,
            branchPoints: branchPoints,
            junctions: junctions,
            maxConnections: maxConnections,
            draws: draws
        };
    }
    
    /**
     * Create branching network object with multiple paths
     */
    createBranchingNetwork(analysis, apertureCode, sampleDraw) {
        this.debug(`Creating branching network with ${analysis.branchPoints.length} branch points`);
        
        // Create a composite structure representing the branching network
        const branchingNetwork = {
            type: 'branching_network',
            aperture: apertureCode,
            polarity: sampleDraw.polarity,
            function: sampleDraw.function,
            branchPoints: analysis.branchPoints.map(bp => ({
                x: bp.point.x,
                y: bp.point.y,
                connections: bp.connectionCount
            })),
            segments: []
        };
        
        // Add all draw segments as separate paths
        analysis.draws.forEach(draw => {
            branchingNetwork.segments.push({
                start: { ...draw.start },
                end: { ...draw.end },
                interpolation: draw.interpolation
            });
        });
        
        this.layers.objects.push(branchingNetwork);
        this.debugStats.branchingPathsCreated++;
        this.pathJoinStats.branchesDetected++;
        
        this.debug(`Created branching network with ${branchingNetwork.segments.length} segments`);
    }
    
    /**
     * Extract connected paths using proper graph traversal
     */
    extractConnectedPaths(draws) {
        const paths = [];
        const visited = new Set();
        const tolerance = this.options.joinTolerance;
        
        // Build adjacency list for connectivity
        const adjacency = new Map();
        draws.forEach((draw, index) => {
            adjacency.set(index, []);
        });
        
        // Find connections between draws
        for (let i = 0; i < draws.length; i++) {
            for (let j = i + 1; j < draws.length; j++) {
                if (this.drawsConnect(draws[i], draws[j], tolerance)) {
                    adjacency.get(i).push(j);
                    adjacency.get(j).push(i);
                }
            }
        }
        
        // Extract connected components using DFS
        for (let i = 0; i < draws.length; i++) {
            if (visited.has(i)) continue;
            
            const component = [];
            const stack = [i];
            
            while (stack.length > 0) {
                const current = stack.pop();
                if (visited.has(current)) continue;
                
                visited.add(current);
                component.push(draws[current]);
                
                // Add connected draws to stack
                adjacency.get(current).forEach(neighbor => {
                    if (!visited.has(neighbor)) {
                        stack.push(neighbor);
                    }
                });
            }
            
            paths.push(component);
        }
        
        return paths;
    }
    
    /**
     * Check if two draws connect at their endpoints
     */
    drawsConnect(draw1, draw2, tolerance) {
        const connections = [
            { p1: draw1.end, p2: draw2.start },
            { p1: draw1.end, p2: draw2.end },
            { p1: draw1.start, p2: draw2.start },
            { p1: draw1.start, p2: draw2.end }
        ];
        
        return connections.some(conn => {
            const dist = Math.sqrt(
                Math.pow(conn.p1.x - conn.p2.x, 2) + 
                Math.pow(conn.p1.y - conn.p2.y, 2)
            );
            return dist <= tolerance;
        });
    }
    
    /**
     * Convert connected draws to a simple path (no branching)
     */
    convertDrawsToSimplePath(draws) {
        if (draws.length === 0) return [];
        if (draws.length === 1) return [draws[0].start, draws[0].end];
        
        // Build ordered path
        const pathPoints = [];
        const used = new Set();
        const tolerance = this.options.joinTolerance;
        
        // Start with first draw
        pathPoints.push({ ...draws[0].start }, { ...draws[0].end });
        used.add(0);
        
        // Iteratively add connected draws
        let changed = true;
        while (changed && used.size < draws.length) {
            changed = false;
            
            for (let i = 0; i < draws.length; i++) {
                if (used.has(i)) continue;
                
                const draw = draws[i];
                const pathStart = pathPoints[0];
                const pathEnd = pathPoints[pathPoints.length - 1];
                
                // Check connections
                if (this.pointsClose(pathEnd, draw.start, tolerance)) {
                    pathPoints.push({ ...draw.end });
                    used.add(i);
                    changed = true;
                } else if (this.pointsClose(pathEnd, draw.end, tolerance)) {
                    pathPoints.push({ ...draw.start });
                    used.add(i);
                    changed = true;
                } else if (this.pointsClose(pathStart, draw.end, tolerance)) {
                    pathPoints.unshift({ ...draw.start });
                    used.add(i);
                    changed = true;
                } else if (this.pointsClose(pathStart, draw.start, tolerance)) {
                    pathPoints.unshift({ ...draw.end });
                    used.add(i);
                    changed = true;
                }
                
                if (changed) break;
            }
        }
        
        return pathPoints;
    }
    
    pointsClose(p1, p2, tolerance) {
        return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2)) <= tolerance;
    }
    
    parseCoordinates(command) {
        const point = { ...this.currentPoint };
        
        try {
            const xMatch = command.match(/X([+-]?\d+)/);
            if (xMatch) {
                point.x = this.parseCoordinateValue(xMatch[1]);
            }
            
            const yMatch = command.match(/Y([+-]?\d+)/);
            if (yMatch) {
                point.y = this.parseCoordinateValue(yMatch[1]);
            }
            
            const iMatch = command.match(/I([+-]?\d+)/);
            if (iMatch) {
                point.i = this.parseCoordinateValue(iMatch[1]);
            }
            
            const jMatch = command.match(/J([+-]?\d+)/);
            if (jMatch) {
                point.j = this.parseCoordinateValue(jMatch[1]);
            }
            
            if (!this.validateCoordinates(point)) {
                return null;
            }
            
            this.coordinateValidation.validCoordinates++;
            this.updateCoordinateRange(point);
            
            return point;
            
        } catch (error) {
            this.coordinateValidation.invalidCoordinates++;
            this.errors.push(`Coordinate parsing error: ${error.message} in command: ${command}`);
            return null;
        }
    }
    
    validateCoordinates(point) {
        if (!isFinite(point.x) || !isFinite(point.y)) {
            this.errors.push(`Non-finite coordinates: (${point.x}, ${point.y})`);
            this.coordinateValidation.invalidCoordinates++;
            return false;
        }
        
        const maxCoordinate = 1000;
        if (Math.abs(point.x) > maxCoordinate || Math.abs(point.y) > maxCoordinate) {
            this.coordinateValidation.suspiciousCoordinates.push({
                coordinates: { x: point.x, y: point.y },
                reason: 'coordinates_too_large'
            });
            this.warnings.push(`Suspiciously large coordinates: (${point.x.toFixed(3)}, ${point.y.toFixed(3)})`);
        }
        
        if (point.i !== undefined && !isFinite(point.i)) {
            this.warnings.push(`Invalid I coordinate: ${point.i}`);
        }
        if (point.j !== undefined && !isFinite(point.j)) {
            this.warnings.push(`Invalid J coordinate: ${point.j}`);
        }
        
        return true;
    }
    
    updateCoordinateRange(point) {
        const range = this.coordinateValidation.coordinateRange;
        range.minX = Math.min(range.minX, point.x);
        range.minY = Math.min(range.minY, point.y);
        range.maxX = Math.max(range.maxX, point.x);
        range.maxY = Math.max(range.maxY, point.y);
    }
    
    parseCoordinateValue(value) {
        const format = this.options.format;
        const negative = value.startsWith('-');
        const absValue = value.replace(/^[+-]/, '');
        
        if (!/^\d+$/.test(absValue)) {
            throw new Error(`Invalid coordinate format: ${value}`);
        }
        
        const totalDigits = format.integer + format.decimal;
        if (absValue.length > totalDigits) {
            this.warnings.push(`Coordinate value "${value}" exceeds format specification ${format.integer}.${format.decimal}`);
        }
        
        const padded = absValue.padStart(totalDigits, '0');
        const integerPart = padded.slice(0, format.integer);
        const decimalPart = padded.slice(format.integer);
        
        let coordinate = parseFloat(`${integerPart}.${decimalPart}`);
        
        if (!isFinite(coordinate)) {
            throw new Error(`Invalid coordinate calculation: ${value} -> ${integerPart}.${decimalPart}`);
        }
        
        if (negative) coordinate = -coordinate;
        
        if (this.options.units === 'inch') {
            coordinate *= 25.4;
            
            if (Math.abs(coordinate) > 254) {
                this.warnings.push(`Very large coordinate after inch conversion: ${coordinate.toFixed(3)}mm`);
            }
        }
        
        return coordinate;
    }
    
    parseOperation(command) {
        if (command.includes('D01')) return 'D01';
        if (command.includes('D02')) return 'D02';
        if (command.includes('D03')) return 'D03';
        return 'D01';
    }
    
    createFlash(position) {
        // FIXED: Never create flash in region mode
        if (this.regionState.active) {
            this.debug('FIXED: Skipping flash creation - in region mode');
            return;
        }
        
        if (!this.currentAperture) return;
        
        const aperture = this.apertures.get(this.currentAperture);
        if (!aperture) return;
        
        const flash = {
            type: 'flash',
            position: { ...position },
            aperture: this.currentAperture,
            polarity: this.polarity,
            function: this.apertureFunction || aperture.function
        };
        
        const apertureSize = aperture.parameters[0] || 0;
        this.coordinateValidation.objectCoordinates.push({
            type: 'flash',
            aperture: this.currentAperture,
            bounds: {
                minX: position.x - apertureSize / 2,
                minY: position.y - apertureSize / 2,
                maxX: position.x + apertureSize / 2,
                maxY: position.y + apertureSize / 2
            }
        });
        
        this.layers.objects.push(flash);
        this.debugStats.flashesCreated++;
    }
    
    finalizeParse() {
        this.calculateBounds();
        this.validateCoordinateConsistency();
        
        // Sort objects by type for better rendering
        this.layers.objects.sort((a, b) => {
            const typeOrder = { 
                region: 0, 
                branching_network: 1, 
                connected_path: 2, 
                draw: 3, 
                flash: 4 
            };
            const aOrder = typeOrder[a.subtype || a.type] || 5;
            const bOrder = typeOrder[b.subtype || b.type] || 5;
            return aOrder - bOrder;
        });
        
        this.debug('FIXED: Parsing Statistics:');
        this.debug(`  Regions created: ${this.debugStats.regionsCreated}`);
        this.debug(`  Draws created: ${this.debugStats.drawsCreated}`);
        this.debug(`  Flashes created: ${this.debugStats.flashesCreated}`);
        this.debug(`  Duplicate perimeters avoided: ${this.debugStats.duplicatePerimetersAvoided}`);
        this.debug(`  Duplicate perimeters removed: ${this.debugStats.duplicatePerimetersRemoved}`);
        this.debug(`  Branching networks: ${this.pathJoinStats.branchingNetworksCreated}`);
        this.debug(`  Connected paths: ${this.pathJoinStats.pathsCreated}`);
    }
    
    validateCoordinateConsistency() {
        if (this.coordinateValidation.objectCoordinates.length === 0) return;
        
        const range = this.coordinateValidation.coordinateRange;
        const width = range.maxX - range.minX;
        const height = range.maxY - range.minY;
        
        if (width > 500 || height > 500) {
            this.warnings.push(`Layer dimensions are unusually large: ${width.toFixed(1)} × ${height.toFixed(1)} mm`);
        }
        
        if (width < 0.1 || height < 0.1) {
            this.warnings.push(`Layer dimensions are unusually small: ${width.toFixed(3)} × ${height.toFixed(3)} mm`);
        }
        
        this.debug(`FIXED: Coordinate consistency check complete`);
    }
    
    calculateBounds() {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        let hasValidData = false;
        
        this.layers.objects.forEach(obj => {
            try {
                if (obj.type === 'region' || obj.subtype === 'connected_path') {
                    obj.points.forEach(point => {
                        if (isFinite(point.x) && isFinite(point.y)) {
                            minX = Math.min(minX, point.x);
                            minY = Math.min(minY, point.y);
                            maxX = Math.max(maxX, point.x);
                            maxY = Math.max(maxY, point.y);
                            hasValidData = true;
                        }
                    });
                } else if (obj.type === 'branching_network') {
                    obj.segments.forEach(segment => {
                        if (isFinite(segment.start.x) && isFinite(segment.start.y)) {
                            minX = Math.min(minX, segment.start.x);
                            minY = Math.min(minY, segment.start.y);
                            maxX = Math.max(maxX, segment.start.x);
                            maxY = Math.max(maxY, segment.start.y);
                            hasValidData = true;
                        }
                        if (isFinite(segment.end.x) && isFinite(segment.end.y)) {
                            minX = Math.min(minX, segment.end.x);
                            minY = Math.min(minY, segment.end.y);
                            maxX = Math.max(maxX, segment.end.x);
                            maxY = Math.max(maxY, segment.end.y);
                            hasValidData = true;
                        }
                    });
                } else if (obj.type === 'draw') {
                    if (isFinite(obj.start.x) && isFinite(obj.start.y) &&
                        isFinite(obj.end.x) && isFinite(obj.end.y)) {
                        minX = Math.min(minX, obj.start.x, obj.end.x);
                        minY = Math.min(minY, obj.start.y, obj.end.y);
                        maxX = Math.max(maxX, obj.start.x, obj.end.x);
                        maxY = Math.max(maxY, obj.start.y, obj.end.y);
                        hasValidData = true;
                    }
                } else if (obj.type === 'flash') {
                    if (isFinite(obj.position.x) && isFinite(obj.position.y)) {
                        const aperture = this.apertures.get(obj.aperture);
                        if (aperture) {
                            const radius = aperture.parameters[0] / 2;
                            minX = Math.min(minX, obj.position.x - radius);
                            minY = Math.min(minY, obj.position.y - radius);
                            maxX = Math.max(maxX, obj.position.x + radius);
                            maxY = Math.max(maxY, obj.position.y + radius);
                            hasValidData = true;
                        }
                    }
                }
            } catch (error) {
                this.warnings.push(`Error calculating bounds for ${obj.type}: ${error.message}`);
            }
        });
        
        if (hasValidData && isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY)) {
            this.layers.bounds = { minX, minY, maxX, maxY };
            this.debug(`FIXED: Calculated bounds: (${minX.toFixed(3)}, ${minY.toFixed(3)}) to (${maxX.toFixed(3)}, ${maxY.toFixed(3)})`);
        } else {
            this.warnings.push('Unable to calculate valid bounds from layer data');
        }
    }
    
    debug(message, data = null) {
        if (this.options.debug) {
            if (data) {
                console.log(`[GerberSemantic-FIXED] ${message}`, data);
            } else {
                console.log(`[GerberSemantic-FIXED] ${message}`);
            }
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GerberSemanticParser;
} else {
    window.GerberSemanticParser = GerberSemanticParser;
}