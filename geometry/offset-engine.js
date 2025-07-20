// Core Offset Engine for PCB Toolpath Generation
// Updated for compatibility with per-file settings architecture

class PolygonOffsetEngine {
    constructor(options = {}) {
        this.options = {
            scaleFactor: options.scaleFactor || 1000000, // Micrometers for Clipper precision
            simplifyTolerance: options.simplifyTolerance || 0.001,
            debug: options.debug || false,
            ...options
        };
        
        this.clipperAvailable = typeof ClipperLib !== 'undefined';
        
        if (!this.clipperAvailable) {
            console.warn('Clipper.js not available - offset operations will use fallbacks');
        }
        
        this.debug('PolygonOffsetEngine initialized');
    }
    
    /**
     * Generate isolation routing toolpaths
     * Creates multiple outward offset passes around copper features
     * Compatible with both old and new settings formats
     */
    generateIsolationPaths(polygons, settings) {
        // Handle both old format and new per-file settings format
        const normalizedSettings = this.normalizeSettings(settings, 'isolation');
        const { toolDiameter, passes, overlap } = normalizedSettings;
        
        this.debug(`Generating isolation paths: ${passes} passes, ${toolDiameter}mm tool, ${overlap}% overlap`);
        
        if (!Array.isArray(polygons) || polygons.length === 0) {
            return [];
        }
        
        const results = [];
        const stepDistance = toolDiameter * (1 - overlap / 100);
        
        for (let pass = 0; pass < passes; pass++) {
            const offsetDistance = (toolDiameter / 2) + (pass * stepDistance);
            
            try {
                const offsetPolygons = this.offsetPolygonsOutward(polygons, offsetDistance);
                
                if (offsetPolygons.length > 0) {
                    results.push({
                        operation: 'isolation',
                        pass: pass + 1,
                        offsetDistance: offsetDistance,
                        toolDiameter: toolDiameter,
                        polygons: offsetPolygons,
                        toolpaths: this.polygonsToToolpaths(offsetPolygons, {
                            rapid: false,
                            closed: true,
                            operation: 'isolation'
                        })
                    });
                    
                    this.debug(`Pass ${pass + 1}: ${offsetPolygons.length} offset polygons at ${offsetDistance.toFixed(3)}mm`);
                }
            } catch (error) {
                console.error(`Error generating isolation pass ${pass + 1}:`, error);
            }
        }
        
        return results;
    }
    
    /**
     * Generate copper clearing toolpaths
     * Creates parallel or crosshatch patterns to remove copper areas
     */
    generateClearingPaths(polygons, settings) {
        const normalizedSettings = this.normalizeSettings(settings, 'clear');
        const { toolDiameter, overlap, pattern } = normalizedSettings;
        
        this.debug(`Generating clearing paths: ${pattern} pattern, ${toolDiameter}mm tool, ${overlap}% overlap`);
        
        if (!Array.isArray(polygons) || polygons.length === 0) {
            return [];
        }
        
        try {
            // Create unified boundary from all polygons
            const boundary = this.unionPolygons(polygons);
            if (boundary.length === 0) return [];
            
            const stepover = toolDiameter * (1 - overlap / 100);
            let toolpaths = [];
            
            switch (pattern.toLowerCase()) {
                case 'parallel':
                    toolpaths = this.generateParallelFill(boundary, stepover, 0);
                    break;
                case 'crosshatch':
                    const horizontal = this.generateParallelFill(boundary, stepover, 0);
                    const vertical = this.generateParallelFill(boundary, stepover, 90);
                    toolpaths = [...horizontal, ...vertical];
                    break;
                default:
                    throw new Error(`Unknown clearing pattern: ${pattern}`);
            }
            
            return [{
                operation: 'clearing',
                pattern: pattern,
                toolDiameter: toolDiameter,
                stepover: stepover,
                toolpaths: toolpaths
            }];
            
        } catch (error) {
            console.error('Error generating clearing paths:', error);
            return [];
        }
    }
    
    /**
     * Generate cutout toolpaths
     * Creates outline paths with optional holding tabs
     */
    generateCutoutPaths(polygons, settings) {
        const normalizedSettings = this.normalizeSettings(settings, 'cutout');
        const { toolDiameter, tabs, tabWidth } = normalizedSettings;
        
        this.debug(`Generating cutout paths: ${toolDiameter}mm tool, ${tabs} tabs, ${tabWidth}mm tab width`);
        
        if (!Array.isArray(polygons) || polygons.length === 0) {
            return [];
        }
        
        try {
            const offsetDistance = toolDiameter / 2;
            const offsetPolygons = this.offsetPolygonsInward(polygons, offsetDistance);
            
            if (offsetPolygons.length === 0) {
                this.debug('No valid cutout paths after offset');
                return [];
            }
            
            let toolpaths = this.polygonsToToolpaths(offsetPolygons, {
                rapid: false,
                closed: true,
                operation: 'cutout'
            });
            
            // Add tabs if requested
            if (tabs > 0 && tabWidth > 0) {
                toolpaths = this.addTabsToToolpaths(toolpaths, tabs, tabWidth);
            }
            
            return [{
                operation: 'cutout',
                toolDiameter: toolDiameter,
                tabs: tabs,
                tabWidth: tabWidth,
                toolpaths: toolpaths
            }];
            
        } catch (error) {
            console.error('Error generating cutout paths:', error);
            return [];
        }
    }
    
    /**
     * Generate drill toolpaths from hole data
     */
    generateDrillPaths(holes, settings) {
        const normalizedSettings = this.normalizeSettings(settings, 'drill');
        const { toolDiameter, peckDepth } = normalizedSettings;
        
        this.debug(`Generating drill paths: ${holes.length} holes, ${toolDiameter}mm tool`);
        
        if (!Array.isArray(holes) || holes.length === 0) {
            return [];
        }
        
        const toolpaths = holes.map((hole, index) => ({
            operation: 'drill',
            index: index,
            position: hole.position,
            holeDiameter: hole.diameter,
            toolDiameter: toolDiameter,
            peckDepth: peckDepth || 0,
            points: [hole.position], // Single point for drilling
            rapid: true // Move to position rapidly, then drill
        }));
        
        return [{
            operation: 'drilling',
            toolDiameter: toolDiameter,
            holeCount: holes.length,
            toolpaths: toolpaths
        }];
    }
    
    /**
     * Normalize settings from either old or new format
     * Handles both direct settings object and per-file settings structure
     */
    normalizeSettings(settings, operationType) {
        // Check if this is the new per-file settings format
        if (settings && settings.tool && settings.cutting && settings.operation) {
            // New format: extract relevant settings
            const tool = settings.tool;
            const cutting = settings.cutting;
            const operation = settings.operation;
            
            let normalized = {
                toolDiameter: tool.diameter || 0.1,
                cutDepth: cutting.cutDepth || 0.1,
                cutFeed: cutting.cutFeed || 100,
                plungeFeed: cutting.plungeFeed || 50
            };
            
            // Add operation-specific settings
            switch (operationType) {
                case 'isolation':
                    normalized.passes = operation.passes || 2;
                    normalized.overlap = operation.overlap || 50;
                    normalized.strategy = operation.strategy || 'offset';
                    break;
                    
                case 'clear':
                    normalized.overlap = operation.overlap || 50;
                    normalized.pattern = operation.pattern || 'parallel';
                    normalized.angle = operation.angle || 0;
                    normalized.margin = operation.margin || 0.1;
                    break;
                    
                case 'drill':
                    normalized.peckDepth = operation.peckDepth || 0;
                    normalized.dwellTime = operation.dwellTime || 0.1;
                    normalized.retractHeight = operation.retractHeight || 1;
                    break;
                    
                case 'cutout':
                    normalized.tabs = operation.tabs || 4;
                    normalized.tabWidth = operation.tabWidth || 3;
                    normalized.tabHeight = operation.tabHeight || 0.5;
                    normalized.direction = operation.direction || 'conventional';
                    break;
            }
            
            return normalized;
        }
        
        // Old format or direct settings - use as-is with defaults
        const defaults = this.getDefaultSettings(operationType);
        return { ...defaults, ...settings };
    }
    
    /**
     * Get default settings for operation type
     */
    getDefaultSettings(operationType) {
        const baseDefaults = {
            toolDiameter: 0.1,
            cutDepth: 0.1,
            cutFeed: 100,
            plungeFeed: 50
        };
        
        switch (operationType) {
            case 'isolation':
                return {
                    ...baseDefaults,
                    passes: 2,
                    overlap: 50,
                    strategy: 'offset'
                };
                
            case 'clear':
                return {
                    ...baseDefaults,
                    toolDiameter: 0.8,
                    cutFeed: 200,
                    overlap: 50,
                    pattern: 'parallel',
                    angle: 0,
                    margin: 0.1
                };
                
            case 'drill':
                return {
                    ...baseDefaults,
                    toolDiameter: 1.0,
                    cutFeed: 50,
                    peckDepth: 0,
                    dwellTime: 0.1,
                    retractHeight: 1
                };
                
            case 'cutout':
                return {
                    ...baseDefaults,
                    toolDiameter: 1.0,
                    cutFeed: 150,
                    tabs: 4,
                    tabWidth: 3,
                    tabHeight: 0.5,
                    direction: 'conventional'
                };
                
            default:
                return baseDefaults;
        }
    }
    
    /**
     * Core offsetting functionality using Clipper.js
     */
    offsetPolygonsOutward(polygons, distance) {
        if (!this.clipperAvailable) {
            console.warn('Using fallback offset (less precise)');
            return this.fallbackOffset(polygons, distance);
        }
        
        try {
            const clipperOffset = new ClipperLib.ClipperOffset();
            const solution = new ClipperLib.Paths();
            
            polygons.forEach(polygon => {
                if (polygon.isValid && polygon.isValid()) {
                    const clipperPath = this.polygonToClipperPath(polygon);
                    if (clipperPath.length >= 3) {
                        clipperOffset.AddPath(
                            clipperPath,
                            ClipperLib.JoinType.jtRound,
                            ClipperLib.EndType.etClosedPolygon
                        );
                    }
                }
            });
            
            const scaledDistance = distance * this.options.scaleFactor;
            clipperOffset.Execute(solution, scaledDistance);
            
            const result = solution.map(path => this.clipperPathToPolygon(path))
                                  .filter(polygon => polygon.isValid());
            
            this.debug(`Offset ${polygons.length} polygons by ${distance}mm -> ${result.length} result polygons`);
            return result;
            
        } catch (error) {
            console.error('Clipper offset error:', error);
            return this.fallbackOffset(polygons, distance);
        }
    }
    
    offsetPolygonsInward(polygons, distance) {
        return this.offsetPolygonsOutward(polygons, -distance);
    }
    
    /**
     * Union multiple polygons into one boundary
     */
    unionPolygons(polygons) {
        if (!this.clipperAvailable) {
            return polygons; // Fallback: return original polygons
        }
        
        try {
            const clipper = new ClipperLib.Clipper();
            const solution = new ClipperLib.Paths();
            
            polygons.forEach(polygon => {
                if (polygon.isValid && polygon.isValid()) {
                    const clipperPath = this.polygonToClipperPath(polygon);
                    if (clipperPath.length >= 3) {
                        clipper.AddPath(clipperPath, ClipperLib.PolyType.ptSubject, true);
                    }
                }
            });
            
            const success = clipper.Execute(
                ClipperLib.ClipType.ctUnion,
                solution,
                ClipperLib.PolyFillType.pftPositive,
                ClipperLib.PolyFillType.pftPositive
            );
            
            if (!success) return polygons;
            
            return solution.map(path => this.clipperPathToPolygon(path))
                          .filter(polygon => polygon.isValid());
            
        } catch (error) {
            console.error('Union error:', error);
            return polygons;
        }
    }
    
    /**
     * Generate parallel fill pattern within boundary
     */
    generateParallelFill(boundaryPolygons, stepover, angle = 0) {
        if (boundaryPolygons.length === 0) return [];
        
        // Calculate overall bounds
        const bounds = PolygonUtils.calculateBounds(boundaryPolygons);
        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;
        
        if (width <= 0 || height <= 0) return [];
        
        const toolpaths = [];
        const fillLines = this.generateFillLines(bounds, stepover, angle);
        
        // Clip fill lines against boundary polygons
        fillLines.forEach(line => {
            const clippedSegments = this.clipLineAgainstPolygons(line, boundaryPolygons);
            clippedSegments.forEach(segment => {
                if (segment.length >= 2) {
                    toolpaths.push({
                        operation: 'clearing',
                        rapid: false,
                        closed: false,
                        points: segment
                    });
                }
            });
        });
        
        this.debug(`Generated ${toolpaths.length} clearing toolpaths`);
        return toolpaths;
    }
    
    /**
     * Generate parallel lines for filling
     */
    generateFillLines(bounds, stepover, angle = 0) {
        const lines = [];
        const diagonal = Math.sqrt(
            (bounds.maxX - bounds.minX) ** 2 + 
            (bounds.maxY - bounds.minY) ** 2
        );
        
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;
        
        const angleRad = (angle * Math.PI) / 180;
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        
        const numLines = Math.ceil((diagonal * 2) / stepover);
        const startOffset = -(numLines * stepover) / 2;
        
        for (let i = 0; i < numLines; i++) {
            const offset = startOffset + (i * stepover);
            
            // Create line perpendicular to angle direction
            const lineStart = {
                x: centerX + offset * (-sin) - diagonal * cos,
                y: centerY + offset * cos - diagonal * sin
            };
            
            const lineEnd = {
                x: centerX + offset * (-sin) + diagonal * cos,
                y: centerY + offset * cos + diagonal * sin
            };
            
            lines.push([lineStart, lineEnd]);
        }
        
        return lines;
    }
    
    /**
     * Simple line-polygon clipping (placeholder for complex implementation)
     */
    clipLineAgainstPolygons(line, polygons) {
        // Simplified implementation - in practice, this would use
        // more sophisticated line-polygon clipping algorithms
        const segments = [];
        
        // For now, just check if line endpoints are inside any polygon
        const [start, end] = line;
        let insidePolygon = false;
        
        for (const polygon of polygons) {
            if (PolygonUtils.pointInPolygon(start, polygon) || 
                PolygonUtils.pointInPolygon(end, polygon)) {
                insidePolygon = true;
                break;
            }
        }
        
        if (insidePolygon) {
            segments.push([start, end]);
        }
        
        return segments;
    }
    
    /**
     * Add holding tabs to cutout toolpaths
     */
    addTabsToToolpaths(toolpaths, tabCount, tabWidth) {
        if (tabCount <= 0) return toolpaths;
        
        return toolpaths.map(toolpath => {
            if (!toolpath.closed || toolpath.points.length < 4) {
                return toolpath; // Can't add tabs to non-closed paths
            }
            
            const modifiedPath = this.insertTabs(toolpath.points, tabCount, tabWidth);
            
            return {
                ...toolpath,
                points: modifiedPath,
                tabs: tabCount,
                tabWidth: tabWidth
            };
        });
    }
    
    /**
     * Insert tabs into a closed path
     */
    insertTabs(points, tabCount, tabWidth) {
        if (points.length < 4 || tabCount <= 0) return points;
        
        const totalLength = this.calculatePathLength(points);
        const tabSpacing = totalLength / tabCount;
        
        const modifiedPoints = [];
        let currentLength = 0;
        let nextTabPosition = tabSpacing;
        
        for (let i = 0; i < points.length - 1; i++) {
            const segmentStart = points[i];
            const segmentEnd = points[i + 1];
            const segmentLength = this.distance(segmentStart, segmentEnd);
            
            modifiedPoints.push(segmentStart);
            
            // Check if a tab should be inserted in this segment
            if (currentLength + segmentLength > nextTabPosition) {
                const tabStart = currentLength + segmentLength - nextTabPosition;
                const tabEnd = tabStart + tabWidth;
                
                if (tabEnd <= segmentLength) {
                    // Insert tab by skipping the cutting move
                    const t1 = tabStart / segmentLength;
                    const t2 = tabEnd / segmentLength;
                    
                    const tabStartPoint = {
                        x: segmentStart.x + (segmentEnd.x - segmentStart.x) * t1,
                        y: segmentStart.y + (segmentEnd.y - segmentStart.y) * t1
                    };
                    
                    const tabEndPoint = {
                        x: segmentStart.x + (segmentEnd.x - segmentStart.x) * t2,
                        y: segmentStart.y + (segmentEnd.y - segmentStart.y) * t2
                    };
                    
                    modifiedPoints.push(tabStartPoint);
                    modifiedPoints.push({ ...tabStartPoint, rapid: true }); // Rapid up
                    modifiedPoints.push({ ...tabEndPoint, rapid: true });   // Rapid over tab
                    modifiedPoints.push(tabEndPoint); // Plunge back down
                    
                    nextTabPosition += tabSpacing;
                }
            }
            
            currentLength += segmentLength;
        }
        
        return modifiedPoints;
    }
    
    /**
     * Convert polygons to toolpath format
     */
    polygonsToToolpaths(polygons, options = {}) {
        return polygons.map((polygon, index) => ({
            operation: options.operation || 'generic',
            index: index,
            rapid: options.rapid || false,
            closed: options.closed !== false, // Default to true
            points: [...polygon.points],
            ...options
        }));
    }
    
    /**
     * Utility methods
     */
    calculatePathLength(points) {
        let length = 0;
        for (let i = 0; i < points.length - 1; i++) {
            length += this.distance(points[i], points[i + 1]);
        }
        return length;
    }
    
    distance(p1, p2) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    polygonToClipperPath(polygon) {
        return polygon.points.map(point => ({
            X: Math.round(point.x * this.options.scaleFactor),
            Y: Math.round(point.y * this.options.scaleFactor)
        }));
    }
    
    clipperPathToPolygon(clipperPath) {
        const points = clipperPath.map(point => ({
            x: point.X / this.options.scaleFactor,
            y: point.Y / this.options.scaleFactor
        }));
        
        return new CopperPolygon(points, { source: 'toolpath' });
    }
    
    /**
     * Fallback offset for when Clipper.js is not available
     */
    fallbackOffset(polygons, distance) {
        console.warn(`Using simplified offset fallback: ${distance}mm`);
        // Very basic implementation - in practice, you'd want a more sophisticated fallback
        return polygons.map(polygon => {
            const scaledPoints = polygon.points.map(point => ({
                x: point.x + (distance * 0.1), // Rough approximation
                y: point.y + (distance * 0.1)
            }));
            return new CopperPolygon(scaledPoints, polygon.properties);
        });
    }
    
    debug(message, data = null) {
        if (this.options.debug) {
            if (data) {
                console.log(`[OffsetEngine] ${message}`, data);
            } else {
                console.log(`[OffsetEngine] ${message}`);
            }
        }
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PolygonOffsetEngine;
} else {
    window.PolygonOffsetEngine = PolygonOffsetEngine;
}