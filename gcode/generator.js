// G-code Generator for PCB CAM Operations
// File: gcode/generator.js
// Converts toolpaths to machine-specific G-code

class GCodeGenerator {
    constructor(options = {}) {
        this.options = {
            debug: options.debug || false,
            postProcessor: options.postProcessor || 'grbl',
            units: options.units || 'mm',
            precision: options.precision || 3,
            ...options
        };
        
        // G-code settings
        this.settings = {
            units: this.options.units,
            precision: this.options.precision,
            coordinateSystem: 'G54',
            safeZ: 2.0,
            travelZ: 1.0,
            rapidFeed: 1000,
            startCode: 'G90 G21 G17\nM3 S1000\nG4 P1',
            endCode: 'M5\nG0 Z10\nM2'
        };
        
        // State tracking
        this.currentPosition = { x: 0, y: 0, z: 0 };
        this.lastFeedRate = null;
        
        this.debug('GCodeGenerator initialized');
    }
    
    /**
     * Generate complete G-code from all operations
     */
    generateProgram(operations, machineSettings = {}, gcodeSettings = {}) {
        try {
            // Update settings
            this.updateSettings(machineSettings, gcodeSettings);
            
            this.debug(`Generating G-code for ${operations.length} operations`);
            
            const program = {
                header: this.generateHeader(operations),
                operations: [],
                footer: this.generateFooter(),
                metadata: {
                    timestamp: new Date().toISOString(),
                    generator: 'PCB CAM Enhanced v7.0',
                    postProcessor: this.options.postProcessor,
                    units: this.settings.units,
                    operations: operations.length
                },
                statistics: {
                    totalLines: 0,
                    totalLength: 0,
                    estimatedTime: 0,
                    toolChanges: 0
                }
            };
            
            // Reset state
            this.currentPosition = { x: 0, y: 0, z: this.settings.safeZ };
            this.lastFeedRate = null;
            
            // Generate G-code for each operation
            operations.forEach((operation, index) => {
                if (operation.toolpaths && operation.toolpaths.success) {
                    const operationGCode = this.generateOperationGCode(operation, index);
                    program.operations.push(operationGCode);
                    
                    // Update statistics
                    program.statistics.totalLength += operationGCode.statistics.totalLength;
                    program.statistics.estimatedTime += operationGCode.statistics.estimatedTime;
                    if (index > 0) program.statistics.toolChanges++;
                }
            });
            
            // Finalize statistics
            const allLines = [
                ...program.header.split('\n'),
                ...program.operations.flatMap(op => op.gcode.split('\n')),
                ...program.footer.split('\n')
            ].filter(line => line.trim());
            
            program.statistics.totalLines = allLines.length;
            
            // Compile complete program
            program.complete = this.compileProgram(program);
            
            this.debug(`G-code generation complete: ${program.statistics.totalLines} lines, ${program.statistics.totalLength.toFixed(2)}mm`);
            
            return {
                success: true,
                program: program,
                warnings: this.validateProgram(program)
            };
            
        } catch (error) {
            this.debug(`G-code generation failed: ${error.message}`);
            return {
                success: false,
                error: error.message,
                program: null
            };
        }
    }
    
    /**
     * Generate G-code for single operation
     */
    generateOperationGCode(operation, operationIndex) {
        const result = {
            operation: operation.id,
            type: operation.type,
            toolDiameter: operation.settings.tool.diameter,
            gcode: '',
            statistics: {
                totalLength: 0,
                estimatedTime: 0,
                moves: 0,
                rapids: 0
            }
        };
        
        const lines = [];
        
        // Operation header
        lines.push('');
        lines.push(`; Operation ${operationIndex + 1}: ${operation.type.toUpperCase()} - ${operation.file.name}`);
        lines.push(`; Tool: ${operation.settings.tool.diameter}mm ${operation.settings.tool.type}`);
        lines.push(`; Feed: ${operation.settings.cutting.cutFeed}mm/min`);
        lines.push('');
        
        // Tool change if needed
        if (operationIndex > 0) {
            lines.push(...this.generateToolChange(operation.settings.tool));
        }
        
        // Operation-specific G-code generation
        switch (operation.type) {
            case 'isolation':
                lines.push(...this.generateIsolationGCode(operation.toolpaths, operation.settings));
                break;
            case 'clear':
                lines.push(...this.generateClearingGCode(operation.toolpaths, operation.settings));
                break;
            case 'drill':
                lines.push(...this.generateDrillingGCode(operation.toolpaths, operation.settings));
                break;
            case 'cutout':
                lines.push(...this.generateCutoutGCode(operation.toolpaths, operation.settings));
                break;
        }
        
        // Calculate statistics
        result.statistics = this.calculateOperationStatistics(lines, operation.toolpaths);
        result.gcode = lines.join('\n');
        
        return result;
    }
    
    /**
     * Generate isolation routing G-code
     */
    generateIsolationGCode(toolpaths, settings) {
        const lines = [];
        
        if (!toolpaths.passes || toolpaths.passes.length === 0) {
            lines.push('; No isolation passes generated');
            return lines;
        }
        
        lines.push(`; Isolation routing: ${toolpaths.passes.length} passes`);
        
        toolpaths.passes.forEach((pass, passIndex) => {
            lines.push('');
            lines.push(`; Pass ${pass.passNumber}: ${pass.offsetDistance.toFixed(3)}mm offset`);
            
            if (pass.toolpaths && pass.toolpaths.length > 0) {
                pass.toolpaths.forEach((toolpath, pathIndex) => {
                    lines.push(`; Path ${pathIndex + 1}/${pass.toolpaths.length}`);
                    lines.push(...this.generateToolpath(toolpath, settings));
                });
            }
        });
        
        return lines;
    }
    
    /**
     * Generate clearing G-code
     */
    generateClearingGCode(toolpaths, settings) {
        const lines = [];
        
        if (!toolpaths.toolpaths || toolpaths.toolpaths.length === 0) {
            lines.push('; No clearing toolpaths generated');
            return lines;
        }
        
        lines.push(`; Copper clearing: ${toolpaths.pattern} pattern, ${toolpaths.toolpaths.length} paths`);
        
        toolpaths.toolpaths.forEach((toolpath, index) => {
            lines.push(`; Clearing path ${index + 1}/${toolpaths.toolpaths.length}`);
            lines.push(...this.generateToolpath(toolpath, settings));
        });
        
        return lines;
    }
    
    /**
     * Generate drilling G-code
     */
    generateDrillingGCode(toolpaths, settings) {
        const lines = [];
        
        if (!toolpaths.toolpaths || toolpaths.toolpaths.length === 0) {
            lines.push('; No drill holes found');
            return lines;
        }
        
        lines.push(`; Drilling: ${toolpaths.toolpaths.length} holes`);
        
        // Set drill cycle parameters
        const peckDepth = settings.operation.peckDepth || 0;
        const dwellTime = settings.operation.dwellTime || 0.1;
        const cutDepth = settings.cutting.cutDepth;
        
        if (peckDepth > 0) {
            lines.push(`G83 R${this.format(this.settings.safeZ)} Q${this.format(peckDepth)} F${settings.cutting.plungeFeed}`);
        } else {
            lines.push(`G81 R${this.format(this.settings.safeZ)} F${settings.cutting.plungeFeed}`);
        }
        
        toolpaths.toolpaths.forEach((hole, index) => {
            const pos = hole.points[0]; // Drill holes have single point
            lines.push(`X${this.format(pos.x)} Y${this.format(pos.y)} Z${this.format(-cutDepth)}`);
            
            if (dwellTime > 0) {
                lines.push(`G4 P${dwellTime}`);
            }
        });
        
        lines.push('G80'); // Cancel drill cycle
        
        return lines;
    }
    
    /**
     * Generate cutout G-code
     */
    generateCutoutGCode(toolpaths, settings) {
        const lines = [];
        
        if (!toolpaths.toolpaths || toolpaths.toolpaths.length === 0) {
            lines.push('; No cutout toolpaths generated');
            return lines;
        }
        
        lines.push(`; Board cutout: ${toolpaths.toolpaths.length} paths`);
        
        toolpaths.toolpaths.forEach((toolpath, index) => {
            lines.push(`; Cutout path ${index + 1}/${toolpaths.toolpaths.length}`);
            lines.push(...this.generateToolpath(toolpath, settings));
        });
        
        return lines;
    }
    
    /**
     * Generate G-code for single toolpath
     */
    generateToolpath(toolpath, settings) {
        const lines = [];
        const points = toolpath.points;
        
        if (!points || points.length === 0) {
            return lines;
        }
        
        const cutDepth = -Math.abs(settings.cutting.cutDepth);
        const cutFeed = settings.cutting.cutFeed;
        const plungeFeed = settings.cutting.plungeFeed;
        
        // Move to start position
        const startPoint = points[0];
        lines.push(...this.moveToPosition(startPoint.x, startPoint.y, this.settings.travelZ, this.settings.rapidFeed));
        
        // Plunge to cut depth
        lines.push(...this.moveToPosition(null, null, cutDepth, plungeFeed));
        
        // Cut along path
        for (let i = 1; i < points.length; i++) {
            const point = points[i];
            
            if (point.rapid || point.tabStart) {
                // Rapid move over tab or gap
                lines.push(...this.moveToPosition(null, null, this.settings.travelZ, this.settings.rapidFeed));
                lines.push(...this.moveToPosition(point.x, point.y, null, this.settings.rapidFeed));
                
                if (!point.tabEnd) {
                    // Plunge back down after tab
                    lines.push(...this.moveToPosition(null, null, cutDepth, plungeFeed));
                }
            } else {
                // Normal cutting move
                lines.push(...this.moveToPosition(point.x, point.y, null, cutFeed));
            }
        }
        
        // Retract to travel height
        lines.push(...this.moveToPosition(null, null, this.settings.travelZ, this.settings.rapidFeed));
        
        return lines;
    }
    
    /**
     * Generate movement G-code with position tracking
     */
    moveToPosition(x, y, z, feedRate) {
        const lines = [];
        const move = {};
        
        // Build movement command
        if (x !== null && x !== this.currentPosition.x) {
            move.x = x;
            this.currentPosition.x = x;
        }
        
        if (y !== null && y !== this.currentPosition.y) {
            move.y = y;
            this.currentPosition.y = y;
        }
        
        if (z !== null && z !== this.currentPosition.z) {
            move.z = z;
            this.currentPosition.z = z;
        }
        
        // Determine movement type
        const isRapid = feedRate >= this.settings.rapidFeed || z >= this.settings.travelZ;
        const command = isRapid ? 'G0' : 'G1';
        
        // Build command line
        if (Object.keys(move).length > 0) {
            let line = command;
            
            if (move.x !== undefined) line += ` X${this.format(move.x)}`;
            if (move.y !== undefined) line += ` Y${this.format(move.y)}`;
            if (move.z !== undefined) line += ` Z${this.format(move.z)}`;
            
            // Add feed rate for G1 moves if changed
            if (!isRapid && feedRate !== this.lastFeedRate) {
                line += ` F${feedRate}`;
                this.lastFeedRate = feedRate;
            }
            
            lines.push(line);
        }
        
        return lines;
    }
    
    /**
     * Generate tool change sequence
     */
    generateToolChange(tool) {
        const lines = [];
        
        lines.push('');
        lines.push('; Tool change');
        lines.push(`M5`); // Spindle stop
        lines.push(`G0 Z${this.format(this.settings.safeZ)}`); // Move to safe height
        lines.push(`M0`); // Pause for manual tool change
        lines.push(`; Load ${tool.diameter}mm ${tool.type}`);
        lines.push(`M3 S1000`); // Spindle start
        lines.push(`G4 P2`); // Dwell for spindle spinup
        lines.push('');
        
        return lines;
    }
    
    /**
     * Generate program header
     */
    generateHeader(operations) {
        const lines = [];
        
        lines.push('; Generated by PCB CAM Enhanced v7.0');
        lines.push(`; Date: ${new Date().toISOString()}`);
        lines.push(`; Post-processor: ${this.options.postProcessor}`);
        lines.push(`; Units: ${this.settings.units}`);
        lines.push(`; Operations: ${operations.length}`);
        lines.push('');
        
        // Add operation summary
        operations.forEach((op, index) => {
            lines.push(`; Operation ${index + 1}: ${op.type} - ${op.file.name}`);
        });
        
        lines.push('');
        lines.push('; Program start');
        lines.push(this.settings.startCode);
        lines.push(this.settings.coordinateSystem);
        lines.push('');
        
        return lines.join('\n');
    }
    
    /**
     * Generate program footer
     */
    generateFooter() {
        const lines = [];
        
        lines.push('');
        lines.push('; Program end');
        lines.push(`G0 Z${this.format(this.settings.safeZ)}`); // Move to safe height
        lines.push('G0 X0 Y0'); // Return to origin
        lines.push(this.settings.endCode);
        lines.push('');
        
        return lines.join('\n');
    }
    
    /**
     * Compile complete program
     */
    compileProgram(program) {
        const sections = [
            program.header,
            ...program.operations.map(op => op.gcode),
            program.footer
        ];
        
        return sections.join('\n');
    }
    
    /**
     * Calculate operation statistics
     */
    calculateOperationStatistics(lines, toolpaths) {
        const stats = {
            totalLength: 0,
            estimatedTime: 0,
            moves: 0,
            rapids: 0
        };
        
        // Count moves
        lines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('G0')) {
                stats.rapids++;
            } else if (trimmed.startsWith('G1')) {
                stats.moves++;
            }
        });
        
        // Calculate total length from toolpaths
        if (toolpaths) {
            if (toolpaths.totalLength) {
                stats.totalLength = toolpaths.totalLength;
            } else if (toolpaths.passes) {
                stats.totalLength = toolpaths.passes.reduce((sum, pass) => sum + (pass.length || 0), 0);
            } else if (toolpaths.toolpaths) {
                stats.totalLength = toolpaths.toolpaths.reduce((sum, tp) => sum + (tp.length || 0), 0);
            }
        }
        
        // Estimate time from toolpaths
        if (toolpaths && toolpaths.estimatedTime) {
            stats.estimatedTime = toolpaths.estimatedTime;
        }
        
        return stats;
    }
    
    /**
     * Validate generated program
     */
    validateProgram(program) {
        const warnings = [];
        
        // Check for empty operations
        const emptyOps = program.operations.filter(op => !op.gcode || op.gcode.trim().length === 0);
        if (emptyOps.length > 0) {
            warnings.push(`${emptyOps.length} operations generated empty G-code`);
        }
        
        // Check for very short operations
        const shortOps = program.operations.filter(op => op.statistics.totalLength < 0.1);
        if (shortOps.length > 0) {
            warnings.push(`${shortOps.length} operations have very short toolpaths (<0.1mm)`);
        }
        
        // Check total program size
        if (program.statistics.totalLines > 10000) {
            warnings.push(`Large program: ${program.statistics.totalLines} lines (may be slow to process)`);
        }
        
        return warnings;
    }
    
    /**
     * Export program to file
     */
    exportToFile(program, filename = null) {
        if (!program || !program.complete) {
            throw new Error('No program to export');
        }
        
        const defaultFilename = `pcb_cam_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.nc`;
        const finalFilename = filename || defaultFilename;
        
        const blob = new Blob([program.complete], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = finalFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        URL.revokeObjectURL(url);
        
        this.debug(`G-code exported: ${finalFilename} (${program.statistics.totalLines} lines)`);
        
        return {
            filename: finalFilename,
            size: program.complete.length,
            lines: program.statistics.totalLines
        };
    }
    
    /**
     * Update generator settings
     */
    updateSettings(machineSettings = {}, gcodeSettings = {}) {
        // Update machine settings
        if (machineSettings.safeZ !== undefined) this.settings.safeZ = machineSettings.safeZ;
        if (machineSettings.travelZ !== undefined) this.settings.travelZ = machineSettings.travelZ;
        if (machineSettings.rapidFeed !== undefined) this.settings.rapidFeed = machineSettings.rapidFeed;
        if (machineSettings.workCoordinateSystem !== undefined) this.settings.coordinateSystem = machineSettings.workCoordinateSystem;
        
        // Update G-code settings
        if (gcodeSettings.units !== undefined) this.settings.units = gcodeSettings.units;
        if (gcodeSettings.startCode !== undefined) this.settings.startCode = gcodeSettings.startCode;
        if (gcodeSettings.endCode !== undefined) this.settings.endCode = gcodeSettings.endCode;
        if (gcodeSettings.postProcessor !== undefined) this.options.postProcessor = gcodeSettings.postProcessor;
        
        this.debug('Settings updated:', { machine: machineSettings, gcode: gcodeSettings });
    }
    
    /**
     * Format coordinate value
     */
    format(value) {
        if (value === null || value === undefined) return '';
        return parseFloat(value).toFixed(this.settings.precision);
    }
    
    /**
     * Get generator statistics
     */
    getStatistics() {
        return {
            postProcessor: this.options.postProcessor,
            units: this.settings.units,
            precision: this.settings.precision,
            currentPosition: { ...this.currentPosition }
        };
    }
    
    debug(message, data = null) {
        if (this.options.debug) {
            if (data) {
                console.log(`[GCodeGenerator] ${message}`, data);
            } else {
                console.log(`[GCodeGenerator] ${message}`);
            }
        }
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GCodeGenerator;
} else {
    window.GCodeGenerator = GCodeGenerator;
}