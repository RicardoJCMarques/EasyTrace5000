// Enhanced G-code Generator with Unified Geometry Pipeline Integration

class GcodeGenerator {
    constructor(settings) {
        if (!settings || typeof settings !== 'object') {
            throw new Error('GcodeGenerator requires a settings object');
        }
        
        this.settings = this.validateAndCleanSettings(settings);
        this.gcode = [];
        this.currentZ = 0;
        this.currentFeed = null;
        this.currentPosition = { x: 0, y: 0 };
        this.stats = {
            linesGenerated: 0,
            pathsProcessed: 0,
            holesProcessed: 0,
            totalDistance: 0,
            estimatedTime: 0
        };
        
        // NEW: Offset engine integration for toolpath generation
        this.offsetEngine = new OffsetEngine();
        
        console.log('GcodeGenerator initialized with unified geometry support');
    }
    
    validateAndCleanSettings(settings) {
        const defaults = {
            isolation: {
                toolDiameter: 0.1,
                passes: 2,
                overlap: 50
            },
            clear: {
                toolDiameter: 0.8,
                overlap: 50,
                pattern: 'parallel'
            },
            drill: {
                toolDiameter: 1.0,
                peckDepth: 0
            },
            cutout: {
                toolDiameter: 1.0,
                tabs: 4,
                tabWidth: 3
            },
            machine: {
                cutDepth: 0.1,
                passDepth: 0.5,
                pcbThickness: 1.6,
                safeZ: 2,
                travelZ: 1,
                cutFeed: 100,
                plungeFeed: 50,
                rapidFeed: 1000
            },
            gcode: {
                postProcessor: 'grbl',
                startCode: 'G90 G21 G17\nM3 S1000\nG4 P1',
                endCode: 'M5\nG0 Z10\nM2'
            },
            export: {
                combineDrillCutout: false
            },
            offset: {
                x: 0,
                y: 0
            }
        };
        
        // Deep merge with defaults
        const merged = this.deepMerge(defaults, settings);
        
        // Validate critical numeric values
        this.validateNumericSetting(merged.machine, 'cutDepth', 0.01, 10);
        this.validateNumericSetting(merged.machine, 'passDepth', 0.1, 50);
        this.validateNumericSetting(merged.machine, 'pcbThickness', 0.2, 20);
        this.validateNumericSetting(merged.machine, 'safeZ', 0.5, 100);
        this.validateNumericSetting(merged.machine, 'travelZ', 0.1, 50);
        this.validateNumericSetting(merged.machine, 'cutFeed', 10, 5000);
        this.validateNumericSetting(merged.machine, 'plungeFeed', 5, 1000);
        this.validateNumericSetting(merged.machine, 'rapidFeed', 100, 10000);
        
        this.validateNumericSetting(merged.offset, 'x', -1000, 1000);
        this.validateNumericSetting(merged.offset, 'y', -1000, 1000);
        
        return merged;
    }
    
    deepMerge(target, source) {
        const result = { ...target };
        
        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = this.deepMerge(target[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }
        
        return result;
    }
    
    validateNumericSetting(obj, key, min, max) {
        if (typeof obj[key] !== 'number' || !isFinite(obj[key])) {
            console.warn(`Invalid ${key}, using default`);
            return;
        }
        
        if (obj[key] < min || obj[key] > max) {
            console.warn(`${key} value ${obj[key]} outside range ${min}-${max}, clamping`);
            obj[key] = Math.max(min, Math.min(max, obj[key]));
        }
    }
    
    // Enhanced generate method using unified geometry
    generate(operations) {
        console.log('Starting G-code generation with unified geometry...');
        
        if (!operations || typeof operations !== 'object') {
            throw new Error('Operations must be an object with operation arrays');
        }
        
        this.gcode = [];
        this.stats = {
            linesGenerated: 0,
            pathsProcessed: 0,
            holesProcessed: 0,
            totalDistance: 0,
            estimatedTime: 0
        };
        
        try {
            // Add header
            this.addHeader();
            
            // Add start code
            this.addStartCode();
            
            // Process each operation type in order using unified geometry
            if (this.hasValidOperations(operations.isolation)) {
                this.addComment('Operation: Isolation Routing');
                this.generateIsolationUnified(operations.isolation);
            }
            
            if (this.hasValidOperations(operations.clear)) {
                this.addComment('Operation: Copper Clearing');
                this.generateClearingUnified(operations.clear);
            }
            
            // Handle drill and cutout combination
            const drillDia = this.settings.drill.toolDiameter;
            const cutoutDia = this.settings.cutout.toolDiameter;
            const shouldCombine = this.settings.export.combineDrillCutout && 
                                Math.abs(drillDia - cutoutDia) < 0.01;
            
            if (shouldCombine) {
                if (this.hasValidOperations(operations.drill) || this.hasValidOperations(operations.cutout)) {
                    this.addComment('Operation: Drilling + Cutout (combined)');
                    if (this.hasValidOperations(operations.drill)) {
                        this.generateDrillingUnified(operations.drill);
                    }
                    if (this.hasValidOperations(operations.cutout)) {
                        this.generateCutoutUnified(operations.cutout);
                    }
                }
            } else {
                if (this.hasValidOperations(operations.drill)) {
                    this.addComment('Operation: Drilling');
                    this.generateDrillingUnified(operations.drill);
                }
                
                if (this.hasValidOperations(operations.cutout)) {
                    this.addComment('Operation: Board Cutout');
                    this.generateCutoutUnified(operations.cutout);
                }
            }
            
            // Add end code
            this.addEndCode();
            
            this.stats.linesGenerated = this.gcode.length;
            console.log('G-code generation complete:', this.stats);
            
            return this.gcode.join('\n');
            
        } catch (error) {
            console.error('Error during G-code generation:', error);
            throw new Error(`G-code generation failed: ${error.message}`);
        }
    }
    
    hasValidOperations(operationArray) {
        return Array.isArray(operationArray) && 
               operationArray.length > 0 && 
               operationArray.some(op => op && op.parsed && !op.error);
    }
    
    addHeader() {
        const date = new Date().toISOString();
        this.addComment(`Generated by PCB CAM on ${date}`);
        this.addComment(`Units: mm`);
        this.addComment(`Post-processor: ${this.settings.gcode.postProcessor}`);
        this.addComment(`Settings: Cut depth ${this.settings.machine.cutDepth}mm, Feed ${this.settings.machine.cutFeed}mm/min`);
        this.gcode.push('');
    }
    
    addStartCode() {
        if (this.settings.gcode.startCode) {
            this.gcode.push(this.settings.gcode.startCode);
            this.gcode.push('');
        }
        
        // Set initial position
        this.rapidZ(this.settings.machine.safeZ);
    }
    
    addEndCode() {
        this.gcode.push('');
        if (this.settings.gcode.endCode) {
            this.gcode.push(this.settings.gcode.endCode);
        }
    }
    
    addComment(text) {
        this.gcode.push(`; ${text}`);
    }
    
    // Movement commands with validation
    rapidXY(x, y) {
        if (!isFinite(x) || !isFinite(y)) {
            console.error('rapidXY: Invalid coordinates:', x, y);
            return;
        }
        
        // Apply offset
        const offsetX = x + this.settings.offset.x;
        const offsetY = y + this.settings.offset.y;
        
        this.gcode.push(`G0 X${this.formatNumber(offsetX)} Y${this.formatNumber(offsetY)}`);
        
        // Update position and distance
        const distance = Math.sqrt(
            Math.pow(offsetX - this.currentPosition.x, 2) + 
            Math.pow(offsetY - this.currentPosition.y, 2)
        );
        this.stats.totalDistance += distance;
        this.currentPosition.x = offsetX;
        this.currentPosition.y = offsetY;
    }
    
    rapidZ(z) {
        if (!isFinite(z)) {
            console.error('rapidZ: Invalid Z coordinate:', z);
            return;
        }
        
        this.currentZ = z;
        this.gcode.push(`G0 Z${this.formatNumber(z)}`);
    }
    
    moveXY(x, y, feed) {
        if (!isFinite(x) || !isFinite(y) || !isFinite(feed)) {
            console.error('moveXY: Invalid parameters:', x, y, feed);
            return;
        }
        
        // Apply offset
        const offsetX = x + this.settings.offset.x;
        const offsetY = y + this.settings.offset.y;
        
        if (feed !== this.currentFeed) {
            this.currentFeed = feed;
            this.gcode.push(`G1 X${this.formatNumber(offsetX)} Y${this.formatNumber(offsetY)} F${Math.round(feed)}`);
        } else {
            this.gcode.push(`G1 X${this.formatNumber(offsetX)} Y${this.formatNumber(offsetY)}`);
        }
        
        // Update position and distance
        const distance = Math.sqrt(
            Math.pow(offsetX - this.currentPosition.x, 2) + 
            Math.pow(offsetY - this.currentPosition.y, 2)
        );
        this.stats.totalDistance += distance;
        this.stats.estimatedTime += distance / feed; // minutes
        this.currentPosition.x = offsetX;
        this.currentPosition.y = offsetY;
    }
    
    moveZ(z, feed) {
        if (!isFinite(z) || !isFinite(feed)) {
            console.error('moveZ: Invalid parameters:', z, feed);
            return;
        }
        
        this.currentZ = z;
        if (feed !== this.currentFeed) {
            this.currentFeed = feed;
            this.gcode.push(`G1 Z${this.formatNumber(z)} F${Math.round(feed)}`);
        } else {
            this.gcode.push(`G1 Z${this.formatNumber(z)}`);
        }
        
        // Update time estimate
        const distance = Math.abs(z - this.currentZ);
        this.stats.estimatedTime += distance / feed;
    }
    
    // Generate isolation using unified geometry and offset engine
    generateIsolationUnified(files) {
        if (!Array.isArray(files)) {
            console.error('generateIsolationUnified: files must be an array');
            return;
        }
        
        const cutDepth = -Math.abs(this.settings.machine.cutDepth);
        let totalPaths = 0;
        
        console.log(`Processing ${files.length} isolation files with unified geometry...`);
        
        files.forEach((file, fileIndex) => {
            if (!file || !file.parsed) {
                console.warn(`Skipping invalid file ${fileIndex} in isolation`);
                return;
            }
            
            try {
                this.addComment(`File: ${file.name || `File_${fileIndex + 1}`}`);
                
                // Use unified geometry if available
                let geometryObjects = [];
                
                if (file.parsed.geometry) {
                    // Extract traces and pads for isolation
                    geometryObjects = [...file.parsed.geometry.traces, ...file.parsed.geometry.pads];
                } else {
                    // Fallback to legacy method
                    const tracePaths = file.parsed.getTracePaths ? 
                        file.parsed.getTracePaths() : [];
                    
                    geometryObjects = tracePaths.map(tp => 
                        tp.geometry || new TraceGeometry(tp.points, tp.aperture)
                    );
                }
                
                console.log(`File ${fileIndex}: processing ${geometryObjects.length} geometry objects`);
                
                if (geometryObjects.length === 0) {
                    console.warn(`File ${fileIndex}: no geometry objects found`);
                    return;
                }
                
                // Generate isolation paths using offset engine
                const isolationPaths = this.offsetEngine.generateIsolation(
                    geometryObjects,
                    this.settings.isolation.toolDiameter,
                    this.settings.isolation.passes,
                    this.settings.isolation.overlap
                );
                
                console.log(`File ${fileIndex}: generated ${isolationPaths.length} isolation paths`);
                
                // Mill each isolation path
                isolationPaths.forEach((isoPath, index) => {
                    if (isoPath && isoPath.path && Array.isArray(isoPath.path)) {
                        if (index % 10 === 0) {
                            this.addComment(`Pass ${isoPath.pass + 1}, Path ${index + 1}/${isolationPaths.length}`);
                        }
                        
                        this.millPath(isoPath.path, cutDepth);
                        totalPaths++;
                    }
                });
                
            } catch (error) {
                console.error(`Error processing isolation file ${fileIndex}:`, error);
                this.addComment(`Error processing file ${fileIndex}: ${error.message}`);
            }
        });
        
        // Return to safe Z
        this.rapidZ(this.settings.machine.safeZ);
        this.stats.pathsProcessed += totalPaths;
        console.log(`Isolation: processed ${totalPaths} paths from ${files.length} files`);
    }
    
    // Generate clearing using unified geometry
    generateClearingUnified(files) {
        if (!Array.isArray(files)) {
            console.error('generateClearingUnified: files must be an array');
            return;
        }
        
        let totalPaths = 0;
        
        console.log(`Processing ${files.length} clearing files with unified geometry...`);
        
        files.forEach((file, fileIndex) => {
            if (!file || !file.parsed) {
                console.warn(`Skipping invalid file ${fileIndex} in clearing`);
                return;
            }
            
            try {
                this.addComment(`File: ${file.name || `File_${fileIndex + 1}`}`);
                
                // Use unified geometry if available
                let geometryInput;
                
                if (file.parsed.geometry) {
                    geometryInput = file.parsed.geometry.regions;
                } else {
                    // Fallback to legacy paths
                    geometryInput = file.parsed.getSimplePaths ? 
                        file.parsed.getSimplePaths() : file.parsed.paths;
                }
                
                console.log(`Clearing file ${fileIndex}: processing ${geometryInput ? geometryInput.length : 0} items`);
                
                if (!geometryInput || geometryInput.length === 0) {
                    console.warn(`Clearing file ${fileIndex}: no geometry found`);
                    return;
                }
                
                // Generate clearing paths using offset engine
                const clearingPaths = this.offsetEngine.generateClearing(
                    geometryInput,
                    this.settings.clear.toolDiameter,
                    this.settings.clear.overlap,
                    this.settings.clear.pattern
                );
                
                console.log(`Clearing file ${fileIndex}: generated ${clearingPaths.length} clearing paths`);
                
                // Mill each path with full depth
                clearingPaths.forEach((path, index) => {
                    if (path && Array.isArray(path)) {
                        if (index % 10 === 0) {
                            this.addComment(`Clearing path ${index + 1}/${clearingPaths.length}`);
                        }
                        
                        this.millPath(path, -this.settings.machine.pcbThickness, true);
                        totalPaths++;
                    }
                });
                
            } catch (error) {
                console.error(`Error processing clearing file ${fileIndex}:`, error);
                this.addComment(`Error processing file ${fileIndex}: ${error.message}`);
            }
        });
        
        this.rapidZ(this.settings.machine.safeZ);
        this.stats.pathsProcessed += totalPaths;
        console.log(`Clearing: processed ${totalPaths} paths from ${files.length} files`);
    }
    
    // Generate drilling using unified geometry
    generateDrillingUnified(files) {
        if (!Array.isArray(files)) {
            console.error('generateDrillingUnified: files must be an array');
            return;
        }
        
        let totalHoles = 0;
        
        files.forEach((file, fileIndex) => {
            if (!file || !file.parsed) {
                console.warn(`Skipping invalid file ${fileIndex} in drilling`);
                return;
            }
            
            try {
                this.addComment(`File: ${file.name || `File_${fileIndex + 1}`}`);
                
                // Use unified geometry if available
                let holes = [];
                
                if (file.parsed.geometry && file.parsed.geometry.holes) {
                    holes = file.parsed.geometry.holes;
                } else if (file.parsed.holes) {
                    // Fallback to legacy holes
                    holes = file.parsed.holes.map(h => 
                        new HoleGeometry(h, h.diameter || 1.0, h.tool || 'T1')
                    );
                }
                
                this.addComment(`Holes: ${holes.length}`);
                
                const drillDepth = -this.settings.machine.pcbThickness - 0.1; // Add clearance
                const peckDepth = this.settings.drill.peckDepth;
                
                // Group holes by tool if possible
                const holesByTool = this.groupHolesByTool(holes);
                
                Object.entries(holesByTool).forEach(([tool, toolHoles]) => {
                    if (!Array.isArray(toolHoles) || toolHoles.length === 0) {
                        return;
                    }
                    
                    this.addComment(`Tool ${tool}: ${toolHoles.length} holes`);
                    
                    toolHoles.forEach((hole, index) => {
                        const position = hole.position || hole;
                        if (!PathUtils.isValidPoint(position)) {
                            console.warn(`Skipping invalid hole ${index} in tool ${tool}`);
                            return;
                        }
                        
                        // Move to hole position
                        this.rapidXY(position.x, position.y);
                        
                        if (peckDepth > 0 && Math.abs(drillDepth) > peckDepth) {
                            // Peck drilling
                            this.peckDrill(drillDepth, peckDepth);
                        } else {
                            // Simple drilling
                            this.rapidZ(this.settings.machine.travelZ);
                            this.moveZ(drillDepth, this.settings.machine.plungeFeed);
                            this.rapidZ(this.settings.machine.travelZ);
                        }
                        
                        totalHoles++;
                    });
                });
                
            } catch (error) {
                console.error(`Error processing drilling file ${fileIndex}:`, error);
                this.addComment(`Error processing file ${fileIndex}: ${error.message}`);
            }
        });
        
        this.rapidZ(this.settings.machine.safeZ);
        this.stats.holesProcessed += totalHoles;
        console.log(`Drilling: processed ${totalHoles} holes`);
    }
    
    // Helper to group holes by tool
    groupHolesByTool(holes) {
        const grouped = {};
        
        holes.forEach(hole => {
            const tool = hole.tool || 'T1';
            if (!grouped[tool]) {
                grouped[tool] = [];
            }
            grouped[tool].push(hole);
        });
        
        return grouped;
    }
    
    // Peck drilling cycle with validation
    peckDrill(finalDepth, peckDepth) {
        if (!isFinite(finalDepth) || !isFinite(peckDepth) || peckDepth <= 0) {
            console.error('peckDrill: Invalid parameters');
            return;
        }
        
        let currentDepth = 0;
        const retractHeight = this.settings.machine.travelZ;
        const maxPecks = 20; // Safety limit
        let peckCount = 0;
        
        while (currentDepth > finalDepth && peckCount < maxPecks) {
            currentDepth -= peckDepth;
            if (currentDepth < finalDepth) {
                currentDepth = finalDepth;
            }
            
            // Plunge
            this.rapidZ(retractHeight);
            this.moveZ(currentDepth, this.settings.machine.plungeFeed);
            
            // Retract for chip clearing (except on final plunge)
            if (currentDepth > finalDepth) {
                this.rapidZ(retractHeight);
            }
            
            peckCount++;
        }
        
        // Final retract
        this.rapidZ(retractHeight);
        
        if (peckCount >= maxPecks) {
            console.warn('Peck drilling hit safety limit');
        }
    }
    
    // Generate cutout using unified geometry and offset engine
    generateCutoutUnified(files) {
        if (!Array.isArray(files)) {
            console.error('generateCutoutUnified: files must be an array');
            return;
        }
        
        let totalPaths = 0;
        
        console.log(`Processing ${files.length} cutout files with unified geometry...`);
        
        files.forEach((file, fileIndex) => {
            if (!file || !file.parsed) {
                console.warn(`Skipping invalid file ${fileIndex} in cutout`);
                return;
            }
            
            try {
                this.addComment(`File: ${file.name || `File_${fileIndex + 1}`}`);
                
                // Use unified geometry if available
                let geometryObjects = [];
                
                if (file.parsed.geometry) {
                    geometryObjects = file.parsed.geometry.regions;
                } else {
                    // Fallback to legacy paths
                    const paths = file.parsed.getSimplePaths ? 
                        file.parsed.getSimplePaths() : file.parsed.paths;
                    
                    geometryObjects = paths.map(path => 
                        Array.isArray(path) ? new RegionGeometry(path) : path
                    ).filter(Boolean);
                }
                
                console.log(`Cutout file ${fileIndex}: processing ${geometryObjects.length} regions`);
                
                geometryObjects.forEach((geometry, pathIndex) => {
                    if (!geometry || !geometry.isValid || !geometry.isValid()) {
                        console.warn(`Skipping invalid geometry ${pathIndex} in cutout`);
                        return;
                    }
                    
                    this.addComment(`Cutout path ${pathIndex + 1}`);
                    
                    // Generate cutout with tabs using offset engine
                    const cutoutPaths = this.offsetEngine.generateCutout(
                        geometry,
                        this.settings.cutout.toolDiameter,
                        this.settings.cutout.tabs,
                        this.settings.cutout.tabWidth
                    );
                    
                    console.log(`Cutout path ${pathIndex}: generated ${cutoutPaths.length} segments`);
                    
                    // Mill each segment with full depth
                    cutoutPaths.forEach((segment, segIndex) => {
                        if (segment && Array.isArray(segment)) {
                            this.millPath(segment, -this.settings.machine.pcbThickness, true);
                            totalPaths++;
                        }
                    });
                });
                
            } catch (error) {
                console.error(`Error processing cutout file ${fileIndex}:`, error);
                this.addComment(`Error processing file ${fileIndex}: ${error.message}`);
            }
        });
        
        this.rapidZ(this.settings.machine.safeZ);
        this.stats.pathsProcessed += totalPaths;
        console.log(`Cutout: processed ${totalPaths} paths from ${files.length} files`);
    }
    
    // Mill a path at specified depth with validation
    millPath(path, depth, multipass = false) {
        if (!PathUtils.isValidPath(path)) {
            console.warn('millPath: Invalid path provided');
            return;
        }
        
        if (!isFinite(depth)) {
            console.error('millPath: Invalid depth:', depth);
            return;
        }
        
        // Clean the path
        const cleanPath = PathUtils.cleanPath(path);
        if (cleanPath.length < 2) {
            console.warn('millPath: Path too short after cleaning');
            return;
        }
        
        try {
            // Move to start position
            this.rapidZ(this.settings.machine.safeZ);
            this.rapidXY(cleanPath[0].x, cleanPath[0].y);
            
            if (multipass && Math.abs(depth) > this.settings.machine.passDepth) {
                // Multiple passes
                const numPasses = Math.ceil(Math.abs(depth) / this.settings.machine.passDepth);
                const passDepth = depth / numPasses;
                
                for (let pass = 1; pass <= numPasses; pass++) {
                    const currentDepth = passDepth * pass;
                    
                    // Plunge
                    this.moveZ(currentDepth, this.settings.machine.plungeFeed);
                    
                    // Mill path
                    for (let i = 1; i < cleanPath.length; i++) {
                        if (PathUtils.isValidPoint(cleanPath[i])) {
                            this.moveXY(cleanPath[i].x, cleanPath[i].y, this.settings.machine.cutFeed);
                        }
                    }
                    
                    // If not last pass, return to start for next pass
                    if (pass < numPasses) {
                        this.rapidZ(this.settings.machine.travelZ);
                        this.rapidXY(cleanPath[0].x, cleanPath[0].y);
                    }
                }
            } else {
                // Single pass
                this.moveZ(depth, this.settings.machine.plungeFeed);
                
                // Mill path
                for (let i = 1; i < cleanPath.length; i++) {
                    if (PathUtils.isValidPoint(cleanPath[i])) {
                        this.moveXY(cleanPath[i].x, cleanPath[i].y, this.settings.machine.cutFeed);
                    }
                }
            }
            
            // Retract
            this.rapidZ(this.settings.machine.travelZ);
            
        } catch (error) {
            console.error('Error milling path:', error);
            // Emergency retract
            this.rapidZ(this.settings.machine.safeZ);
        }
    }
    
    formatNumber(num) {
        if (!isFinite(num)) {
            console.warn('formatNumber: Invalid number:', num);
            return '0.000';
        }
        
        // Format to 3 decimal places, remove trailing zeros
        return parseFloat(num.toFixed(3)).toString();
    }
    
    // Get generation statistics
    getStats() {
        return { ...this.stats };
    }
    
    // Export functions
    downloadGcode(filename = 'pcb.gcode') {
        try {
            const gcodeText = this.gcode.join('\n');
            const blob = new Blob([gcodeText], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            URL.revokeObjectURL(url);
            console.log(`G-code downloaded as ${filename}`);
        } catch (error) {
            console.error('Error downloading G-code:', error);
            throw new Error(`Failed to download G-code: ${error.message}`);
        }
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GcodeGenerator;
} else {
    // Browser environment - attach to window
    window.GcodeGenerator = GcodeGenerator;
}