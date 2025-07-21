// Enhanced Polygon Offset Engine for PCB Toolpath Generation

class EnhancedOffsetEngine {
    constructor(options = {}) {
        this.options = {
            scaleFactor: options.scaleFactor || 1000000, // Micrometers for Clipper precision
            simplifyTolerance: options.simplifyTolerance || 0.001,
            debug: options.debug || false,
            ...options
        };
        
        // Initialize geometry analyzer
        this.analyzer = new GeometryAnalyzer({ debug: this.options.debug });
        
        this.clipperAvailable = typeof ClipperLib !== 'undefined';
        
        if (!this.clipperAvailable) {
            console.warn('Clipper.js not available - offset operations will use fallbacks');
        }
        
        // Caching for performance
        this.offsetCache = new Map();
        
        this.debug('EnhancedOffsetEngine initialized');
    }
    
    /**
     * Generate complete isolation routing toolpaths with validation
     */
    generateIsolationToolpaths(polygons, settings, geometryAnalysis = null) {
        if (!Array.isArray(polygons) || polygons.length === 0) {
            return { success: false, error: 'No polygons provided', toolpaths: [] };
        }
        
        // Analyze geometry if not provided
        if (!geometryAnalysis) {
            geometryAnalysis = this.analyzer.analyzeLayer(polygons, 'isolation', 'temp');
        }
        
        // Normalize settings
        const normalizedSettings = this.normalizeSettings(settings, 'isolation');
        const { toolDiameter, passes, overlap } = normalizedSettings;
        
        this.debug(`Generating isolation toolpaths: ${passes} passes, ${toolDiameter}mm tool, ${overlap}% overlap`);
        
        // Validate tool against geometry
        const validation = this.validateToolForIsolation(toolDiameter, geometryAnalysis);
        if (!validation.suitable) {
            return {
                success: false,
                error: validation.reason,
                suggestions: validation.suggestions,
                toolpaths: []
            };
        }
        
        try {
            const results = {
                success: true,
                toolDiameter: toolDiameter,
                passes: [],
                totalLength: 0,
                estimatedTime: 0,
                warnings: validation.warnings || []
            };
            
            // Generate each isolation pass
            const stepDistance = this.calculateStepDistance(toolDiameter, overlap);
            
            for (let pass = 0; pass < passes; pass++) {
                const offsetDistance = this.calculateOffsetDistance(pass, toolDiameter, stepDistance);
                
                const passResult = this.generateIsolationPass(
                    polygons, 
                    offsetDistance, 
                    pass + 1, 
                    normalizedSettings
                );
                
                if (passResult.polygons.length > 0) {
                    // Convert polygons to toolpaths
                    const toolpaths = this.polygonsToOptimizedToolpaths(
                        passResult.polygons, 
                        {
                            operation: 'isolation',
                            pass: pass + 1,
                            offsetDistance: offsetDistance,
                            closed: true
                        }
                    );
                    
                    results.passes.push({
                        passNumber: pass + 1,
                        offsetDistance: offsetDistance,
                        polygons: passResult.polygons,
                        toolpaths: toolpaths,
                        length: this.calculateTotalLength(toolpaths),
                        warnings: passResult.warnings
                    });
                    
                    results.totalLength += results.passes[pass].length;
                }
            }
            
            // Calculate estimated machining time
            results.estimatedTime = this.estimateMachiningTime(results, normalizedSettings);
            
            this.debug(`Generated ${results.passes.length} isolation passes, total length: ${results.totalLength.toFixed(2)}mm`);
            return results;
            
        } catch (error) {
            return {
                success: false,
                error: `Offset generation failed: ${error.message}`,
                toolpaths: []
            };
        }
    }
    
    /**
     * Generate single isolation pass with validation
     */
    generateIsolationPass(polygons, offsetDistance, passNumber, settings) {
        const cacheKey = `isolation_${offsetDistance}_${polygons.length}_${passNumber}`;
        
        if (this.offsetCache.has(cacheKey)) {
            return this.offsetCache.get(cacheKey);
        }
        
        this.debug(`Generating isolation pass ${passNumber} at ${offsetDistance.toFixed(3)}mm offset`);
        
        const result = {
            passNumber: passNumber,
            offsetDistance: offsetDistance,
            polygons: [],
            warnings: []
        };
        
        try {
            // Generate offset polygons
            const offsetPolygons = this.offsetPolygonsOutward(polygons, offsetDistance);
            
            if (offsetPolygons.length === 0) {
                result.warnings.push(`Pass ${passNumber}: No valid offset at ${offsetDistance.toFixed(3)}mm`);
                this.offsetCache.set(cacheKey, result);
                return result;
            }
            
            // Validate offset doesn't interfere with original geometry
            const cleanedPolygons = this.validateAndCleanOffset(offsetPolygons, polygons, settings.toolDiameter);
            
            if (cleanedPolygons.length < offsetPolygons.length) {
                result.warnings.push(`Pass ${passNumber}: ${offsetPolygons.length - cleanedPolygons.length} paths removed due to interference`);
            }
            
            result.polygons = cleanedPolygons;
            
            // Add corner handling for sharp angles
            if (settings.cornerHandling !== false) {
                result.polygons = this.processCorners(result.polygons, settings.toolDiameter);
            }
            
            this.offsetCache.set(cacheKey, result);
            
        } catch (error) {
            result.warnings.push(`Pass ${passNumber} generation failed: ${error.message}`);
        }
        
        return result;
    }
    
    /**
     * Generate optimized clearing toolpaths
     */
    generateClearingToolpaths(polygons, settings, geometryAnalysis = null) {
        const normalizedSettings = this.normalizeSettings(settings, 'clear');
        const { toolDiameter, overlap, pattern, angle } = normalizedSettings;
        
        this.debug(`Generating clearing toolpaths: ${pattern} pattern, ${toolDiameter}mm tool, ${overlap}% overlap`);
        
        try {
            // Create unified boundary from all polygons
            const boundary = this.createUnifiedBoundary(polygons);
            if (boundary.length === 0) {
                return { success: false, error: 'No valid clearing boundary', toolpaths: [] };
            }
            
            const stepover = this.calculateStepDistance(toolDiameter, overlap);
            
            let toolpaths = [];
            
            switch (pattern.toLowerCase()) {
                case 'parallel':
                    toolpaths = this.generateParallelClearing(boundary, stepover, angle || 0);
                    break;
                case 'crosshatch':
                    const horizontal = this.generateParallelClearing(boundary, stepover, 0);
                    const vertical = this.generateParallelClearing(boundary, stepover, 90);
                    toolpaths = [...horizontal, ...vertical];
                    break;
                default:
                    throw new Error(`Unknown clearing pattern: ${pattern}`);
            }
            
            // Optimize toolpath order
            const optimizedToolpaths = this.optimizeToolpathOrder(toolpaths);
            
            return {
                success: true,
                pattern: pattern,
                toolDiameter: toolDiameter,
                stepover: stepover,
                toolpaths: optimizedToolpaths,
                totalLength: this.calculateTotalLength(optimizedToolpaths),
                estimatedTime: this.estimateMachiningTime({ totalLength: this.calculateTotalLength(optimizedToolpaths) }, normalizedSettings)
            };
            
        } catch (error) {
            return {
                success: false,
                error: `Clearing generation failed: ${error.message}`,
                toolpaths: []
            };
        }
    }
    
    /**
     * Generate cutout toolpaths with tab support
     */
    generateCutoutToolpaths(polygons, settings) {
        const normalizedSettings = this.normalizeSettings(settings, 'cutout');
        const { toolDiameter, tabs, tabWidth, direction } = normalizedSettings;
        
        this.debug(`Generating cutout toolpaths: ${toolDiameter}mm tool, ${tabs} tabs, ${direction} milling`);
        
        try {
            // Calculate tool offset for cutout
            const offsetDistance = toolDiameter / 2;
            
            // Determine offset direction based on milling direction
            const inwardOffset = direction === 'conventional';
            const offsetPolygons = inwardOffset ? 
                this.offsetPolygonsInward(polygons, offsetDistance) :
                this.offsetPolygonsOutward(polygons, offsetDistance);
            
            if (offsetPolygons.length === 0) {
                return { success: false, error: 'No valid cutout paths after offset', toolpaths: [] };
            }
            
            // Convert to toolpaths
            let toolpaths = this.polygonsToOptimizedToolpaths(offsetPolygons, {
                operation: 'cutout',
                closed: true,
                direction: direction
            });
            
            // Add tabs if requested
            if (tabs > 0 && tabWidth > 0) {
                toolpaths = this.addTabsToToolpaths(toolpaths, tabs, tabWidth);
            }
            
            return {
                success: true,
                toolDiameter: toolDiameter,
                direction: direction,
                tabs: tabs,
                tabWidth: tabWidth,
                toolpaths: toolpaths,
                totalLength: this.calculateTotalLength(toolpaths),
                estimatedTime: this.estimateMachiningTime({ totalLength: this.calculateTotalLength(toolpaths) }, normalizedSettings)
            };
            
        } catch (error) {
            return {
                success: false,
                error: `Cutout generation failed: ${error.message}`,
                toolpaths: []
            };
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
            return { success: false, error: 'No holes provided', toolpaths: [] };
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
        
        return {
            success: true,
            operation: 'drilling',
            toolDiameter: toolDiameter,
            holeCount: holes.length,
            toolpaths: toolpaths,
            totalLength: 0, // No cutting length for drilling
            estimatedTime: holes.length * 0.1 // Rough estimate: 0.1 min per hole
        };
    }
    
    /**
     * Validate tool suitability for isolation routing
     */
    validateToolForIsolation(toolDiameter, geometryAnalysis) {
        const validation = {
            suitable: true,
            reason: null,
            suggestions: [],
            warnings: []
        };
        
        const minClearance = geometryAnalysis.clearances.minimum;
        const minTraceWidth = geometryAnalysis.traceWidths.minimum;
        
        // Check if tool is too large for clearances
        if (isFinite(minClearance) && toolDiameter >= minClearance * 0.9) {
            validation.suitable = false;
            validation.reason = `Tool diameter ${toolDiameter}mm too large for minimum clearance ${minClearance.toFixed(3)}mm`;
            validation.suggestions.push(`Use tool ≤ ${(minClearance * 0.8).toFixed(3)}mm`);
            return validation;
        }
        
        // Check if tool is too large for trace widths
        if (isFinite(minTraceWidth) && toolDiameter >= minTraceWidth * 0.7) {
            validation.suitable = false;
            validation.reason = `Tool diameter ${toolDiameter}mm too large for minimum trace width ${minTraceWidth.toFixed(3)}mm`;
            validation.suggestions.push(`Use tool ≤ ${(minTraceWidth * 0.6).toFixed(3)}mm`);
            return validation;
        }
        
        // Warnings for sub-optimal tool sizes
        if (toolDiameter < 0.05) {
            validation.warnings.push('Very small tool - may break easily');
        }
        
        if (isFinite(minClearance) && toolDiameter > minClearance * 0.6) {
            validation.warnings.push('Tool is large relative to clearances - single pass may be sufficient');
        }
        
        return validation;
    }
    
    /**
     * Enhanced parallel clearing with proper line clipping
     */
    generateParallelClearing(boundaryPolygons, stepover, angle = 0) {
        if (boundaryPolygons.length === 0) return [];
        
        // Calculate overall bounds
        const bounds = PolygonUtils.calculateBounds(boundaryPolygons);
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;
        
        // Generate parallel lines
        const lines = this.generateParallelLines(bounds, stepover, angle, centerX, centerY);
        
        // Clip lines against boundary polygons and create toolpaths
        const toolpaths = [];
        
        lines.forEach((line, index) => {
            const clippedSegments = this.clipLineAgainstPolygons(line, boundaryPolygons);
            
            clippedSegments.forEach((segment, segIndex) => {
                if (segment.length >= 2) {
                    toolpaths.push({
                        operation: 'clearing',
                        type: 'parallel',
                        lineIndex: index,
                        segmentIndex: segIndex,
                        rapid: false,
                        closed: false,
                        points: segment,
                        angle: angle
                    });
                }
            });
        });
        
        this.debug(`Generated ${toolpaths.length} clearing toolpaths with ${stepover.toFixed(3)}mm stepover`);
        return toolpaths;
    }
    
    /**
     * Generate parallel lines for clearing pattern
     */
    generateParallelLines(bounds, stepover, angle, centerX, centerY) {
        const lines = [];
        
        // Calculate rotated bounding box
        const diagonal = Math.sqrt(
            Math.pow(bounds.maxX - bounds.minX, 2) + 
            Math.pow(bounds.maxY - bounds.minY, 2)
        );
        
        const angleRad = (angle * Math.PI) / 180;
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        
        // Generate lines perpendicular to angle direction
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
     * Enhanced line-polygon clipping
     */
    clipLineAgainstPolygons(line, polygons) {
        const [lineStart, lineEnd] = line;
        const segments = [];
        
        // Find all intersection points
        const intersections = [];
        
        polygons.forEach(polygon => {
            const polyIntersections = this.linePolygonIntersections(line, polygon);
            intersections.push(...polyIntersections);
        });
        
        // Sort intersections by distance along line
        intersections.sort((a, b) => a.t - b.t);
        
        // Create segments between intersections that are inside polygons
        if (intersections.length === 0) {
            // No intersections - check if entire line is inside
            const midpoint = {
                x: (lineStart.x + lineEnd.x) / 2,
                y: (lineStart.y + lineEnd.y) / 2
            };
            
            if (this.pointInAnyPolygon(midpoint, polygons)) {
                segments.push([lineStart, lineEnd]);
            }
        } else {
            // Process segments between intersections
            for (let i = 0; i <= intersections.length; i++) {
                const segStart = i === 0 ? lineStart : intersections[i - 1].point;
                const segEnd = i === intersections.length ? lineEnd : intersections[i].point;
                
                const midpoint = {
                    x: (segStart.x + segEnd.x) / 2,
                    y: (segStart.y + segEnd.y) / 2
                };
                
                if (this.pointInAnyPolygon(midpoint, polygons)) {
                    segments.push([segStart, segEnd]);
                }
            }
        }
        
        return segments;
    }
    
    /**
     * Calculate intersections between line and polygon
     */
    linePolygonIntersections(line, polygon) {
        const [lineStart, lineEnd] = line;
        const intersections = [];
        const points = polygon.points;
        
        for (let i = 0; i < points.length - 1; i++) {
            const edgeStart = points[i];
            const edgeEnd = points[i + 1];
            
            const intersection = this.lineSegmentIntersection(
                lineStart, lineEnd,
                edgeStart, edgeEnd
            );
            
            if (intersection) {
                intersections.push(intersection);
            }
        }
        
        return intersections;
    }
    
    /**
     * Calculate intersection between two line segments
     */
    lineSegmentIntersection(line1Start, line1End, line2Start, line2End) {
        const x1 = line1Start.x, y1 = line1Start.y;
        const x2 = line1End.x, y2 = line1End.y;
        const x3 = line2Start.x, y3 = line2Start.y;
        const x4 = line2End.x, y4 = line2End.y;
        
        const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        if (Math.abs(denom) < 1e-10) return null; // Parallel lines
        
        const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
        const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
        
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
            return {
                point: {
                    x: x1 + t * (x2 - x1),
                    y: y1 + t * (y2 - y1)
                },
                t: t
            };
        }
        
        return null;
    }
    
    /**
     * Check if point is inside any of the polygons
     */
    pointInAnyPolygon(point, polygons) {
        return polygons.some(polygon => PolygonUtils.pointInPolygon(point, polygon));
    }
    
    /**
     * Optimize toolpath order to minimize rapid moves
     */
    optimizeToolpathOrder(toolpaths) {
        if (toolpaths.length <= 1) return toolpaths;
        
        const optimized = [];
        const unvisited = [...toolpaths];
        let currentPosition = { x: 0, y: 0 };
        
        // Start with toolpath closest to origin
        let nextIndex = this.findClosestToolpath(currentPosition, unvisited);
        optimized.push(unvisited.splice(nextIndex, 1)[0]);
        
        // Greedily select next closest toolpath
        while (unvisited.length > 0) {
            const lastToolpath = optimized[optimized.length - 1];
            currentPosition = lastToolpath.points[lastToolpath.points.length - 1];
            
            nextIndex = this.findClosestToolpath(currentPosition, unvisited);
            optimized.push(unvisited.splice(nextIndex, 1)[0]);
        }
        
        return optimized;
    }
    
    /**
     * Find closest toolpath to current position
     */
    findClosestToolpath(position, toolpaths) {
        let minDistance = Infinity;
        let closestIndex = 0;
        
        toolpaths.forEach((toolpath, index) => {
            const startPoint = toolpath.points[0];
            const distance = this.distance(position, startPoint);
            
            if (distance < minDistance) {
                minDistance = distance;
                closestIndex = index;
            }
        });
        
        return closestIndex;
    }
    
    /**
     * Core offsetting functionality using Clipper.js
     */
    offsetPolygonsOutward(polygons, distance) {
        if (!this.clipperAvailable) {
            return this.fallbackOffset(polygons, distance);
        }
        
        try {
            const clipperOffset = new ClipperLib.ClipperOffset();
            const solution = new ClipperLib.Paths();
            
            // Add valid polygons to offset
            let validPolygons = 0;
            polygons.forEach(polygon => {
                if (polygon.isValid && polygon.isValid()) {
                    const clipperPath = this.polygonToClipperPath(polygon);
                    if (clipperPath.length >= 3) {
                        clipperOffset.AddPath(
                            clipperPath,
                            ClipperLib.JoinType.jtRound,
                            ClipperLib.EndType.etClosedPolygon
                        );
                        validPolygons++;
                    }
                }
            });
            
            if (validPolygons === 0) {
                this.debug('No valid polygons for offset');
                return [];
            }
            
            // Execute offset
            const scaledDistance = distance * this.options.scaleFactor;
            clipperOffset.Execute(solution, scaledDistance);
            
            // Convert back to CopperPolygon objects
            const result = solution.map(path => {
                const polygon = this.clipperPathToPolygon(path);
                polygon.properties.source = 'offset';
                polygon.properties.offsetDistance = distance;
                return polygon;
            }).filter(polygon => polygon.isValid());
            
            this.debug(`Offset ${validPolygons} polygons by ${distance.toFixed(3)}mm -> ${result.length} results`);
            return result;
            
        } catch (error) {
            this.debug(`Clipper offset error: ${error.message}`);
            return this.fallbackOffset(polygons, distance);
        }
    }
    
    offsetPolygonsInward(polygons, distance) {
        return this.offsetPolygonsOutward(polygons, -distance);
    }
    
    /**
     * Create unified boundary from multiple polygons
     */
    createUnifiedBoundary(polygons) {
        if (!this.clipperAvailable) {
            return polygons; // Fallback: return original polygons
        }
        
        try {
            const clipper = new ClipperLib.Clipper();
            const solution = new ClipperLib.Paths();
            
            // Add all valid polygons
            polygons.forEach(polygon => {
                if (polygon.isValid && polygon.isValid()) {
                    const clipperPath = this.polygonToClipperPath(polygon);
                    if (clipperPath.length >= 3) {
                        clipper.AddPath(clipperPath, ClipperLib.PolyType.ptSubject, true);
                    }
                }
            });
            
            // Execute union
            const success = clipper.Execute(
                ClipperLib.ClipType.ctUnion,
                solution,
                ClipperLib.PolyFillType.pftPositive,
                ClipperLib.PolyFillType.pftPositive
            );
            
            if (!success || solution.length === 0) {
                return polygons;
            }
            
            return solution.map(path => this.clipperPathToPolygon(path))
                          .filter(polygon => polygon.isValid());
            
        } catch (error) {
            this.debug(`Union error: ${error.message}`);
            return polygons;
        }
    }
    
    /**
     * Validate offset doesn't interfere with original geometry
     */
    validateAndCleanOffset(offsetPolygons, originalPolygons, toolDiameter) {
        const minSafeDistance = toolDiameter / 2;
        const validOffsets = [];
        
        for (const offsetPoly of offsetPolygons) {
            let isValid = true;
            
            // Check distance to all original polygons
            for (const originalPoly of originalPolygons) {
                const distance = this.calculateMinPolygonDistance(offsetPoly, originalPoly);
                if (distance !== null && distance < minSafeDistance) {
                    isValid = false;
                    break;
                }
            }
            
            if (isValid) {
                validOffsets.push(offsetPoly);
            }
        }
        
        return validOffsets;
    }
    
    /**
     * Calculate minimum distance between two polygons
     */
    calculateMinPolygonDistance(poly1, poly2) {
        // Simplified distance calculation using bounding boxes and sample points
        const bounds1 = poly1.getBounds();
        const bounds2 = poly2.getBounds();
        
        // Quick bounding box check
        const boundingDistance = this.boundingBoxDistance(bounds1, bounds2);
        if (boundingDistance > 10) return null; // Skip distant polygons
        
        // Sample-based distance calculation
        const samples1 = this.samplePolygonPerimeter(poly1, 8);
        const samples2 = this.samplePolygonPerimeter(poly2, 8);
        
        let minDistance = Infinity;
        
        for (const p1 of samples1) {
            for (const p2 of samples2) {
                const distance = this.distance(p1, p2);
                minDistance = Math.min(minDistance, distance);
            }
        }
        
        return isFinite(minDistance) ? minDistance : null;
    }
    
    /**
     * Sample points along polygon perimeter
     */
    samplePolygonPerimeter(polygon, count = 8) {
        const points = polygon.points;
        if (points.length <= count) return [...points];
        
        const samples = [];
        const step = points.length / count;
        
        for (let i = 0; i < count; i++) {
            const index = Math.floor(i * step);
            samples.push(points[index]);
        }
        
        return samples;
    }
    
    /**
     * Convert polygons to optimized toolpaths
     */
    polygonsToOptimizedToolpaths(polygons, options = {}) {
        const toolpaths = polygons.map((polygon, index) => {
            const points = options.closed ? [...polygon.points] : polygon.points.slice(0, -1);
            
            return {
                operation: options.operation || 'generic',
                index: index,
                rapid: options.rapid || false,
                closed: options.closed !== false,
                points: points,
                length: this.calculatePathLength(points),
                ...options
            };
        });
        
        // Optimize order if multiple toolpaths
        if (toolpaths.length > 1) {
            return this.optimizeToolpathOrder(toolpaths);
        }
        
        return toolpaths;
    }
    
    /**
     * Process corners for better tool access
     */
    processCorners(polygons, toolDiameter) {
        // Basic corner processing - can be enhanced later
        return polygons.map(polygon => {
            // For now, just ensure polygons are properly simplified
            return PolygonUtils.simplify(polygon, this.options.simplifyTolerance);
        });
    }
    
    /**
     * Add holding tabs to cutout toolpaths
     */
    addTabsToToolpaths(toolpaths, tabCount, tabWidth) {
        if (tabCount <= 0 || tabWidth <= 0) return toolpaths;
        
        return toolpaths.map(toolpath => {
            if (!toolpath.closed || toolpath.points.length < 4) {
                return toolpath;
            }
            
            const modifiedPoints = this.insertTabs(toolpath.points, tabCount, tabWidth);
            
            return {
                ...toolpath,
                points: modifiedPoints,
                tabs: tabCount,
                tabWidth: tabWidth,
                length: this.calculatePathLength(modifiedPoints)
            };
        });
    }
    
    /**
     * Insert tabs into closed toolpath
     */
    insertTabs(points, tabCount, tabWidth) {
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
            
            // Check if tab should be inserted in this segment
            if (currentLength + segmentLength > nextTabPosition && 
                nextTabPosition + tabWidth <= currentLength + segmentLength) {
                
                const tabStartT = (nextTabPosition - currentLength) / segmentLength;
                const tabEndT = (nextTabPosition + tabWidth - currentLength) / segmentLength;
                
                const tabStart = {
                    x: segmentStart.x + (segmentEnd.x - segmentStart.x) * tabStartT,
                    y: segmentStart.y + (segmentEnd.y - segmentStart.y) * tabStartT
                };
                
                const tabEnd = {
                    x: segmentStart.x + (segmentEnd.x - segmentStart.x) * tabEndT,
                    y: segmentStart.y + (segmentEnd.y - segmentStart.y) * tabEndT
                };
                
                // Add tab sequence: cut to tab start, rapid over tab, continue cutting
                modifiedPoints.push(tabStart);
                modifiedPoints.push({ ...tabStart, rapid: true, tabStart: true });
                modifiedPoints.push({ ...tabEnd, rapid: true, tabEnd: true });
                modifiedPoints.push(tabEnd);
                
                nextTabPosition += tabSpacing;
            }
            
            currentLength += segmentLength;
        }
        
        return modifiedPoints;
    }
    
    /**
     * Utility methods
     */
    normalizeSettings(settings, operationType) {
        // Handle both old format and new per-file settings format
        if (settings && settings.tool && settings.cutting && settings.operation) {
            // New format
            const result = {
                toolDiameter: settings.tool.diameter || 0.1,
                cutDepth: settings.cutting.cutDepth || 0.1,
                cutFeed: settings.cutting.cutFeed || 100,
                plungeFeed: settings.cutting.plungeFeed || 50
            };
            
            // Add operation-specific settings
            switch (operationType) {
                case 'isolation':
                    result.passes = settings.operation.passes || 2;
                    result.overlap = settings.operation.overlap || 50;
                    result.strategy = settings.operation.strategy || 'offset';
                    result.cornerHandling = settings.operation.cornerHandling !== false;
                    break;
                case 'clear':
                    result.overlap = settings.operation.overlap || 50;
                    result.pattern = settings.operation.pattern || 'parallel';
                    result.angle = settings.operation.angle || 0;
                    break;
                case 'cutout':
                    result.tabs = settings.operation.tabs || 4;
                    result.tabWidth = settings.operation.tabWidth || 3;
                    result.direction = settings.operation.direction || 'conventional';
                    break;
                case 'drill':
                    result.peckDepth = settings.operation.peckDepth || 0;
                    result.dwellTime = settings.operation.dwellTime || 0.1;
                    break;
            }
            
            return result;
        }
        
        // Old format - use defaults
        return this.getDefaultSettings(operationType);
    }
    
    getDefaultSettings(operationType) {
        const base = { toolDiameter: 0.1, cutFeed: 100 };
        switch (operationType) {
            case 'isolation': return { ...base, passes: 2, overlap: 50, cornerHandling: true };
            case 'clear': return { ...base, toolDiameter: 0.8, overlap: 50, pattern: 'parallel' };
            case 'cutout': return { ...base, toolDiameter: 1.0, tabs: 4, tabWidth: 3, direction: 'conventional' };
            case 'drill': return { ...base, toolDiameter: 1.0, peckDepth: 0 };
            default: return base;
        }
    }
    
    calculateStepDistance(toolDiameter, overlapPercent) {
        return toolDiameter * (1 - overlapPercent / 100);
    }
    
    calculateOffsetDistance(passIndex, toolDiameter, stepDistance) {
        return (toolDiameter / 2) + (passIndex * stepDistance);
    }
    
    calculatePathLength(points) {
        let length = 0;
        for (let i = 0; i < points.length - 1; i++) {
            length += this.distance(points[i], points[i + 1]);
        }
        return length;
    }
    
    calculateTotalLength(toolpaths) {
        return toolpaths.reduce((total, toolpath) => total + (toolpath.length || 0), 0);
    }
    
    estimateMachiningTime(results, settings) {
        // Simple time estimation based on length and feed rate
        const totalLength = results.totalLength || 0;
        const feedRate = settings.cutFeed || 100; // mm/min
        return totalLength / feedRate; // minutes
    }
    
    distance(p1, p2) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    boundingBoxDistance(bounds1, bounds2) {
        const dx = Math.max(0, Math.max(bounds1.minX - bounds2.maxX, bounds2.minX - bounds1.maxX));
        const dy = Math.max(0, Math.max(bounds1.minY - bounds2.maxY, bounds2.minY - bounds1.maxY));
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
    
    fallbackOffset(polygons, distance) {
        this.debug(`Using fallback offset: ${distance.toFixed(3)}mm`);
        // Basic fallback - return simplified copies
        return polygons.map(polygon => {
            const offsetPoints = polygon.points.map(point => ({
                x: point.x + distance * 0.1,
                y: point.y + distance * 0.1
            }));
            return new CopperPolygon(offsetPoints, { ...polygon.properties, source: 'fallback_offset' });
        });
    }
    
    debug(message, data = null) {
        if (this.options.debug) {
            if (data) {
                console.log(`[EnhancedOffsetEngine] ${message}`, data);
            } else {
                console.log(`[EnhancedOffsetEngine] ${message}`);
            }
        }
    }
    
    clearCache() {
        this.offsetCache.clear();
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EnhancedOffsetEngine;
} else {
    window.EnhancedOffsetEngine = EnhancedOffsetEngine;
}