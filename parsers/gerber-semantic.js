// parsers/gerber-semantic.js
// Simplified Gerber parser for Clipper2 pipeline
// Fixed: No duplicate trace creation during region mode

class GerberSemanticParser {
    constructor(options = {}) {
        this.options = {
            units: 'mm',
            format: { integer: 3, decimal: 3 },
            debug: options.debug || false,
            ...options
        };
        
        // Parser state
        this.apertures = new Map();
        this.currentAperture = null;
        this.currentPoint = { x: 0, y: 0 };
        this.interpolationMode = 'G01';
        this.regionMode = false;
        this.polarity = 'dark';
        
        // Current region being built
        this.currentRegion = null;
        
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
            regionsCreated: 0,
            drawsCreated: 0,
            flashesCreated: 0,
            tracesCreated: 0,
            totalObjects: 0,
            regionModeChanges: 0,
            coordinatesInRegion: 0
        };
    }
    
    parse(content) {
        try {
            this.debug('Starting simplified Gerber parse for Clipper2...');
            
            const blocks = this.splitIntoBlocks(content);
            this.debug(`Processing ${blocks.length} command blocks`);
            
            blocks.forEach((block) => {
                this.processBlock(block);
            });
            
            // Finalize any open region
            if (this.regionMode && this.currentRegion) {
                this.debug('WARNING: File ended with open region, closing it');
                this.endRegion();
            }
            
            this.finalizeParse();
            
            this.debug(`Parse complete: ${this.layers.objects.length} objects created`);
            this.debug(`Stats: ${JSON.stringify(this.debugStats)}`);
            
            return {
                success: true,
                layers: this.layers,
                errors: this.errors,
                warnings: this.warnings,
                debugStats: this.debugStats
            };
            
        } catch (error) {
            this.errors.push(`Parse error: ${error.message}`);
            return {
                success: false,
                layers: this.layers,
                errors: this.errors,
                warnings: this.warnings,
                debugStats: this.debugStats
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
    
    processBlock(block) {
        if (block.type === 'extended') {
            this.processExtendedCommand(block.content);
        } else {
            this.processStandardCommand(block.content);
        }
    }
    
    processExtendedCommand(command) {
        if (command.startsWith('FS')) {
            this.parseFormatSpec(command);
        } else if (command.startsWith('MO')) {
            this.options.units = command.includes('MM') ? 'mm' : 'inch';
            this.layers.units = this.options.units;
            this.debug(`Units: ${this.options.units}`);
        } else if (command.startsWith('AD')) {
            this.parseApertureDefinition(command);
        } else if (command.startsWith('LP')) {
            this.polarity = command.includes('D') ? 'dark' : 'clear';
            this.debug(`Polarity: ${this.polarity}`);
        } else if (command.startsWith('AM')) {
            // Aperture macros - simplified handling
            this.debug('Aperture macro detected (simplified handling)');
        }
    }

    processStandardCommand(command) {
        // FIXED: Check for region mode first with proper parsing
        if (command.includes('G36')) {
            if (!this.regionMode) {
                this.debugStats.regionModeChanges++;
                this.regionMode = true;
                this.startRegion();
                this.debug(`G36: Entering region mode (change #${this.debugStats.regionModeChanges})`);
            }
            // Remove G36 from command for further processing
            command = command.replace('G36', '').trim();
            if (!command) return;
        }
        
        if (command.includes('G37')) {
            if (this.regionMode) {
                this.debugStats.regionModeChanges++;
                this.regionMode = false;
                this.endRegion();
                this.debug(`G37: Exiting region mode (change #${this.debugStats.regionModeChanges})`);
            }
            // Remove G37 from command for further processing
            command = command.replace('G37', '').trim();
            if (!command) return;
        }

        // Handle other G-codes
        if (command.includes('G01')) {
            this.interpolationMode = 'G01'; // Linear
        } else if (command.includes('G02')) {
            this.interpolationMode = 'G02'; // Clockwise arc
        } else if (command.includes('G03')) {
            this.interpolationMode = 'G03'; // Counter-clockwise arc
        } else if (command.includes('G74')) {
            this.quadrantMode = 'single';
        } else if (command.includes('G75')) {
            this.quadrantMode = 'multi';
        }

        // D-code for aperture selection
        const dMatch = command.match(/D(\d{2,})/);
        if (dMatch) {
            const dCode = parseInt(dMatch[1]);
            if (dCode >= 10) {
                this.currentAperture = `D${dMatch[1]}`;
                this.debug(`Selected aperture: ${this.currentAperture}`);
            }
        }
        
        // M-code for end of file
        if (command.startsWith('M02') || command.startsWith('M00')) {
            if (this.regionMode) {
                this.debug('WARNING: File ended in region mode, closing region');
                this.endRegion();
            }
            return;
        }

        // Process coordinates if they exist
        if (/[XY]/.test(command)) {
            this.processCoordinate(command);
        }
    }

    startRegion() {
        this.currentRegion = {
            type: 'region',
            polarity: this.polarity,
            points: [],
            interpolations: [] // Track interpolation mode for each segment
        };
        
        // Add current point as start of region
        if (this.currentPoint) {
            this.currentRegion.points.push({ ...this.currentPoint });
            this.debugStats.coordinatesInRegion++;
        }
        
        this.debug(`Region started (G36) at (${this.currentPoint.x.toFixed(3)}, ${this.currentPoint.y.toFixed(3)})`);
    }

    endRegion() {
        if (this.currentRegion && this.currentRegion.points.length >= 3) {
            // Ensure region is closed
            const first = this.currentRegion.points[0];
            const last = this.currentRegion.points[this.currentRegion.points.length - 1];
            const tolerance = 0.001;
            
            if (Math.abs(first.x - last.x) > tolerance || Math.abs(first.y - last.y) > tolerance) {
                this.currentRegion.points.push({ ...first });
                this.debug('Region auto-closed by adding first point');
            }
            
            // Add completed region to objects
            this.layers.objects.push(this.currentRegion);
            this.debugStats.regionsCreated++;
            this.debugStats.totalObjects++;
            
            this.debug(`Region completed with ${this.currentRegion.points.length} points, polarity: ${this.currentRegion.polarity}`);
        } else if (this.currentRegion) {
            this.warnings.push(`Region discarded with only ${this.currentRegion?.points?.length || 0} points`);
        }
        
        this.currentRegion = null;
        this.debug('Region ended (G37)');
    }

    processCoordinate(command) {
        const newPoint = this.parseCoordinates(command);
        if (!newPoint) return;

        // Check for D codes (D01=draw, D02=move, D03=flash)
        let operation = null;
        if (command.includes('D01')) operation = 'D01';
        else if (command.includes('D02')) operation = 'D02';
        else if (command.includes('D03')) operation = 'D03';

        // Store last command for arc data extraction
        this.lastCommand = command;

        // FIXED: Properly handle region mode
        if (this.regionMode) {
            if (this.currentRegion) {
                // In region mode, D02 is move without adding to boundary
                // D01 or no D-code adds to boundary
                if (operation === 'D02') {
                    // Just move, don't add point
                    this.debug(`Region mode: Move to (${newPoint.x.toFixed(3)}, ${newPoint.y.toFixed(3)})`);
                } else {
                    // Add point to region boundary
                    this.debugStats.coordinatesInRegion++;
                    
                    // Handle arcs in region mode
                    if (this.interpolationMode === 'G02' || this.interpolationMode === 'G03') {
                        const arcData = this.parseArcData(command);
                        if (arcData) {
                            const arcPoints = this.interpolateArc(
                                this.currentPoint,
                                newPoint,
                                arcData,
                                this.interpolationMode === 'G02'
                            );
                            // Add interpolated arc points (skip first as it's the current point)
                            arcPoints.slice(1).forEach(pt => {
                                this.currentRegion.points.push(pt);
                                this.debugStats.coordinatesInRegion++;
                            });
                            this.debug(`Region mode: Added ${arcPoints.length - 1} arc points`);
                        } else {
                            // Fallback to line if arc data is invalid
                            this.currentRegion.points.push(newPoint);
                            this.debug(`Region mode: Added point (${newPoint.x.toFixed(3)}, ${newPoint.y.toFixed(3)})`);
                        }
                    } else {
                        // Linear interpolation
                        this.currentRegion.points.push(newPoint);
                        this.debug(`Region mode: Added point (${newPoint.x.toFixed(3)}, ${newPoint.y.toFixed(3)})`);
                    }
                }
            }
            // Update position and return - NO trace creation in region mode
            this.currentPoint = newPoint;
            return;
        }
        
        // Normal mode (not in region) - create traces/flashes
        if (operation === 'D01') {
            // Draw operation - create a trace
            this.createTrace(this.currentPoint, newPoint);
        } else if (operation === 'D03') {
            // Flash operation - create a pad
            this.createFlash(newPoint);
        }
        // D02 is just a move, no geometry created
        
        // Update current position
        this.currentPoint = newPoint;
    }

    createTrace(start, end) {
        if (!this.currentAperture) {
            this.warnings.push('Draw operation without aperture selection');
            return;
        }
        
        const aperture = this.apertures.get(this.currentAperture);
        if (!aperture) {
            this.warnings.push(`Aperture ${this.currentAperture} not defined`);
            return;
        }
        
        const trace = {
            type: 'trace',
            start: { ...start },
            end: { ...end },
            width: aperture.parameters[0] || 0.1,
            aperture: this.currentAperture,
            polarity: this.polarity,
            interpolation: this.interpolationMode
        };
        
        // Handle arc traces
        if (this.interpolationMode === 'G02' || this.interpolationMode === 'G03') {
            const arcData = this.parseArcData(this.lastCommand);
            if (arcData) {
                trace.arc = arcData;
                trace.clockwise = this.interpolationMode === 'G02';
            }
        }
        
        this.layers.objects.push(trace);
        this.debugStats.tracesCreated++;
        this.debugStats.totalObjects++;
        
        this.debug(`Trace created: (${start.x.toFixed(3)}, ${start.y.toFixed(3)}) to (${end.x.toFixed(3)}, ${end.y.toFixed(3)}), width: ${trace.width}`);
    }

    createFlash(position) {
        if (!this.currentAperture) {
            this.warnings.push('Flash operation without aperture selection');
            return;
        }
        
        const aperture = this.apertures.get(this.currentAperture);
        if (!aperture) {
            this.warnings.push(`Aperture ${this.currentAperture} not defined`);
            return;
        }
        
        const flash = {
            type: 'flash',
            position: { ...position },
            shape: aperture.type,
            parameters: [...aperture.parameters],
            aperture: this.currentAperture,
            polarity: this.polarity
        };
        
        // Simplify shape information
        if (aperture.type === 'circle') {
            flash.radius = aperture.parameters[0] / 2;
        } else if (aperture.type === 'rectangle') {
            flash.width = aperture.parameters[0];
            flash.height = aperture.parameters[1] || aperture.parameters[0];
        } else if (aperture.type === 'obround') {
            flash.width = aperture.parameters[0];
            flash.height = aperture.parameters[1] || aperture.parameters[0];
        } else if (aperture.type === 'polygon') {
            flash.diameter = aperture.parameters[0];
            flash.vertices = aperture.parameters[1] || 3;
            flash.rotation = aperture.parameters[2] || 0;
        }
        
        this.layers.objects.push(flash);
        this.debugStats.flashesCreated++;
        this.debugStats.totalObjects++;
        
        this.debug(`Flash created at (${position.x.toFixed(3)}, ${position.y.toFixed(3)}), shape: ${aperture.type}`);
    }

    parseArcData(command) {
        // Parse I and J offsets for arc center
        const iMatch = command.match(/I([+-]?\d+)/);
        const jMatch = command.match(/J([+-]?\d+)/);
        
        if (iMatch || jMatch) {
            return {
                i: iMatch ? this.parseCoordinateValue(iMatch[1]) : 0,
                j: jMatch ? this.parseCoordinateValue(jMatch[1]) : 0
            };
        }
        
        return null;
    }

    interpolateArc(start, end, arcData, clockwise) {
        // Calculate arc center from offset
        const center = {
            x: start.x + arcData.i,
            y: start.y + arcData.j
        };
        
        // Calculate radius
        const radius = Math.sqrt(
            Math.pow(start.x - center.x, 2) + 
            Math.pow(start.y - center.y, 2)
        );
        
        // Calculate angles
        const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
        const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
        
        // Calculate angle span
        let angleSpan = endAngle - startAngle;
        if (clockwise) {
            if (angleSpan > 0) angleSpan -= 2 * Math.PI;
        } else {
            if (angleSpan < 0) angleSpan += 2 * Math.PI;
        }
        
        // Generate interpolated points
        const points = [];
        const segments = Math.max(8, Math.abs(angleSpan) * 10); // Adaptive segmentation
        
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const angle = startAngle + angleSpan * t;
            points.push({
                x: center.x + radius * Math.cos(angle),
                y: center.y + radius * Math.sin(angle)
            });
        }
        
        return points;
    }

    finalizeParse() {
        // Store apertures in layers
        this.layers.apertures = Array.from(this.apertures.values());
        
        // Calculate bounds
        this.calculateBounds();
        
        // Report statistics
        if (this.options.debug) {
            console.log('[GerberSemantic] Parse Statistics:');
            console.log(`  Regions: ${this.debugStats.regionsCreated}`);
            console.log(`  Traces: ${this.debugStats.tracesCreated}`);
            console.log(`  Flashes: ${this.debugStats.flashesCreated}`);
            console.log(`  Total objects: ${this.debugStats.totalObjects}`);
            console.log(`  Region mode changes: ${this.debugStats.regionModeChanges}`);
            console.log(`  Coordinates in regions: ${this.debugStats.coordinatesInRegion}`);
        }
        
        this.debug('Parse finalized');
    }

    calculateBounds() {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        let hasData = false;
        
        this.layers.objects.forEach(obj => {
            if (obj.type === 'region' && obj.points) {
                obj.points.forEach(point => {
                    minX = Math.min(minX, point.x);
                    minY = Math.min(minY, point.y);
                    maxX = Math.max(maxX, point.x);
                    maxY = Math.max(maxY, point.y);
                    hasData = true;
                });
            } else if (obj.type === 'trace') {
                minX = Math.min(minX, obj.start.x, obj.end.x);
                minY = Math.min(minY, obj.start.y, obj.end.y);
                maxX = Math.max(maxX, obj.start.x, obj.end.x);
                maxY = Math.max(maxY, obj.start.y, obj.end.y);
                hasData = true;
            } else if (obj.type === 'flash') {
                const radius = obj.radius || (Math.max(obj.width || 0, obj.height || 0) / 2);
                minX = Math.min(minX, obj.position.x - radius);
                minY = Math.min(minY, obj.position.y - radius);
                maxX = Math.max(maxX, obj.position.x + radius);
                maxY = Math.max(maxY, obj.position.y + radius);
                hasData = true;
            }
        });
        
        if (hasData) {
            this.layers.bounds = {
                minX, minY, maxX, maxY,
                width: maxX - minX,
                height: maxY - minY
            };
        }
    }

    parseCoordinates(command) {
        const point = { ...this.currentPoint };
        
        const xMatch = command.match(/X([+-]?\d+)/);
        if (xMatch) {
            point.x = this.parseCoordinateValue(xMatch[1]);
        }
        
        const yMatch = command.match(/Y([+-]?\d+)/);
        if (yMatch) {
            point.y = this.parseCoordinateValue(yMatch[1]);
        }
        
        return point;
    }

    parseCoordinateValue(value) {
        const format = this.options.format;
        const negative = value.startsWith('-');
        const absValue = value.replace(/^[+-]/, '');
        
        const totalDigits = format.integer + format.decimal;
        const paddedValue = absValue.padStart(totalDigits, '0');
        
        const integerPart = paddedValue.slice(0, format.integer);
        const decimalPart = paddedValue.slice(format.integer);
        
        let coordinate = parseFloat(`${integerPart}.${decimalPart}`);
        
        if (negative) coordinate = -coordinate;
        
        // Convert to mm if units are inches
        if (this.options.units === 'inch') {
            coordinate *= 25.4;
        }
        
        return coordinate;
    }

    parseFormatSpec(command) {
        const match = command.match(/FS[LT][AI]X(\d)(\d)Y(\d)(\d)/);
        if (match) {
            this.options.format = {
                integer: parseInt(match[1]),
                decimal: parseInt(match[2])
            };
            this.debug(`Format: ${this.options.format.integer}.${this.options.format.decimal}`);
        }
    }

    parseApertureDefinition(command) {
        const match = command.match(/ADD(\d+)([CROP]),(.+)/);
        if (!match) return;
        
        const code = `D${match[1]}`;
        const typeChar = match[2];
        const params = match[3].split('X').map(p => parseFloat(p));
        
        let type;
        switch (typeChar) {
            case 'C': type = 'circle'; break;
            case 'R': type = 'rectangle'; break;
            case 'O': type = 'obround'; break;
            case 'P': type = 'polygon'; break;
            default: type = 'unknown';
        }
        
        const aperture = {
            code: code,
            type: type,
            parameters: params
        };
        
        this.apertures.set(code, aperture);
        this.debug(`Aperture ${code}: ${type} [${params.join(', ')}]`);
    }
    
    debug(message) {
        if (this.options.debug) {
            console.log(`[GerberSemantic] ${message}`);
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GerberSemanticParser;
} else {
    window.GerberSemanticParser = GerberSemanticParser;
}