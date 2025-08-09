// Geometry Processor - FIXED: Working fusion with proper PolyTree handling
// File Location: geometry/geometry-processor.js

class GeometryProcessor {
    constructor(options = {}) {
        this.options = {
            debug: options.debug || false,
            scale: 100000, // Scale factor for clipper (100000 units = 1mm)
            deduplicationTolerance: 0.001, // 1 micron for deduplication
            expandStrokes: true, // Always expand strokes for boolean ops
            preserveHoles: true, // Preserve holes in text like B and a
            minHoleArea: 0.01, // Minimum hole area to preserve (mm²)
            ...options
        };
        
        // Check if ClipperLib is available
        this.clipperAvailable = typeof ClipperLib !== 'undefined';
        
        if (!this.clipperAvailable) {
            console.warn('ClipperLib not available - geometry operations will be limited');
        } else {
            console.log('GeometryProcessor initialized with fixed fusion');
        }
        
        // Performance tracking
        this.stats = {
            fusionOperations: 0,
            primitivesProcessed: 0,
            primitivesReduced: 0,
            duplicatesRemoved: 0,
            strokesExpanded: 0,
            holesPreserved: 0,
            errors: 0
        };
    }
    
    /**
     * FIXED: Simplified fusion that actually works
     */
    fuseGeometry(primitives, options = {}) {
        if (!this.clipperAvailable || !primitives || primitives.length === 0) {
            return primitives;
        }
        
        console.log(`Starting fusion of ${primitives.length} primitives`);
        
        try {
            this.stats.fusionOperations++;
            this.stats.primitivesProcessed += primitives.length;
            
            // Step 1: Separate regions and traces
            const regions = [];
            const traces = [];
            
            primitives.forEach(primitive => {
                const props = primitive.properties || {};
                
                if (props.isRegion || (props.fill && !props.stroke)) {
                    regions.push(primitive);
                } else if (props.isTrace || props.isBranchSegment || props.isConnectedPath || 
                          (props.stroke && props.strokeWidth)) {
                    traces.push(primitive);
                } else if (props.isFlash || props.isPad || primitive.type === 'circle' || primitive.type === 'rectangle') {
                    // Flashes/pads are treated as regions
                    regions.push(primitive);
                } else if (primitive.type === 'path' && primitive.closed) {
                    // Default closed paths to regions
                    regions.push(primitive);
                } else {
                    // Default open paths to traces
                    traces.push(primitive);
                }
            });
            
            console.log(`Separated: ${regions.length} regions, ${traces.length} traces`);
            
            // Step 2: Convert traces to expanded regions
            const expandedTraces = [];
            traces.forEach(trace => {
                const expanded = this.expandTraceToRegion(trace);
                if (expanded) {
                    expandedTraces.push(...expanded);
                }
            });
            
            console.log(`Expanded ${traces.length} traces to ${expandedTraces.length} regions`);
            
            // Step 3: Combine all regions (original + expanded traces)
            const allRegions = [...regions, ...expandedTraces];
            
            // Step 4: Convert to Clipper paths
            const clipper = new ClipperLib.Clipper();
            let pathsAdded = 0;
            
            allRegions.forEach(region => {
                const paths = this.primitiveToClipperPaths(region, false);
                if (paths && paths.length > 0) {
                    paths.forEach(path => {
                        if (path && path.length >= 3) {
                            // FIXED: Add paths correctly with proper polarity
                            const success = clipper.AddPath(path, ClipperLib.PolyType.ptSubject, true);
                            if (success) {
                                pathsAdded++;
                            } else {
                                console.warn('Failed to add path to clipper');
                            }
                        }
                    });
                }
            });
            
            if (pathsAdded === 0) {
                console.warn('No valid paths added to clipper');
                return primitives;
            }
            
            console.log(`Added ${pathsAdded} paths to Clipper`);
            
            // Step 5: Execute union operation - use Paths output for simplicity
            const solution = new ClipperLib.Paths();
            
            const success = clipper.Execute(
                ClipperLib.ClipType.ctUnion,
                solution,
                ClipperLib.PolyFillType.pftNonZero,
                ClipperLib.PolyFillType.pftNonZero
            );
            
            if (!success || solution.length === 0) {
                console.error('Union operation failed or produced empty result');
                return primitives;
            }
            
            console.log(`Union produced ${solution.length} paths`);
            
            // Step 6: Convert solution back to primitives
            const fusedPrimitives = [];
            
            solution.forEach((path, index) => {
                if (path && path.length >= 3) {
                    const points = this.clipperPathToPoints(path);
                    
                    // FIXED: Determine if this is a hole by checking winding
                    const area = ClipperLib.Clipper.Area(path);
                    const isHole = area < 0;
                    
                    if (isHole) {
                        this.stats.holesPreserved++;
                        console.log(`Path ${index} is a hole (area: ${area})`);
                    }
                    
                    const primitive = new PathPrimitive(points, {
                        isFused: true,
                        isRegion: true,
                        fill: true,
                        stroke: false,
                        fillRule: isHole ? 'evenodd' : 'nonzero',
                        closed: true,
                        isHole: isHole
                    });
                    
                    // Validate the primitive
                    const bounds = primitive.getBounds();
                    if (isFinite(bounds.minX) && isFinite(bounds.minY) && 
                        isFinite(bounds.maxX) && isFinite(bounds.maxY)) {
                        fusedPrimitives.push(primitive);
                    } else {
                        console.warn(`Primitive ${index} has invalid bounds, skipping`);
                    }
                }
            });
            
            this.stats.primitivesReduced += primitives.length - fusedPrimitives.length;
            
            console.log(`Fusion complete: ${primitives.length} → ${fusedPrimitives.length} primitives`);
            
            // If fusion produced nothing, return original
            if (fusedPrimitives.length === 0) {
                console.warn('Fusion produced no valid primitives, returning original');
                return primitives;
            }
            
            return fusedPrimitives;
            
        } catch (error) {
            console.error('Fusion failed:', error);
            this.stats.errors++;
            return primitives;
        }
    }
    
    /**
     * FIXED: Alternative fusion using PolyTree for proper hole handling
     */
    fuseGeometryWithHoles(primitives, options = {}) {
        if (!this.clipperAvailable || !primitives || primitives.length === 0) {
            return primitives;
        }
        
        console.log(`Starting PolyTree fusion of ${primitives.length} primitives`);
        
        try {
            // Steps 1-3 same as above
            const regions = [];
            const traces = [];
            
            primitives.forEach(primitive => {
                const props = primitive.properties || {};
                
                if (props.isRegion || (props.fill && !props.stroke)) {
                    regions.push(primitive);
                } else if (props.isTrace || props.isBranchSegment || props.isConnectedPath || 
                          (props.stroke && props.strokeWidth)) {
                    traces.push(primitive);
                } else if (props.isFlash || props.isPad) {
                    regions.push(primitive);
                } else if (primitive.type === 'path' && primitive.closed) {
                    regions.push(primitive);
                } else {
                    traces.push(primitive);
                }
            });
            
            const expandedTraces = [];
            traces.forEach(trace => {
                const expanded = this.expandTraceToRegion(trace);
                if (expanded) {
                    expandedTraces.push(...expanded);
                }
            });
            
            const allRegions = [...regions, ...expandedTraces];
            
            // Convert to Clipper paths and execute union
            const clipper = new ClipperLib.Clipper();
            
            allRegions.forEach(region => {
                const paths = this.primitiveToClipperPaths(region, false);
                if (paths && paths.length > 0) {
                    clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
                }
            });
            
            // Use PolyTree for proper parent-child relationships
            const polyTree = new ClipperLib.PolyTree();
            
            const success = clipper.Execute(
                ClipperLib.ClipType.ctUnion,
                polyTree,
                ClipperLib.PolyFillType.pftEvenOdd,
                ClipperLib.PolyFillType.pftEvenOdd
            );
            
            if (!success) {
                console.error('PolyTree union failed');
                return primitives;
            }
            
            // Extract from PolyTree
            const fusedPrimitives = [];
            
            // FIXED: Proper PolyTree traversal
            const extractFromPolyNode = (node, isHole = false) => {
                // Process this node's contour if it exists
                if (node.m_polygon && node.m_polygon.length >= 3) {
                    const points = this.clipperPathToPoints(node.m_polygon);
                    
                    if (!isHole) {
                        // This is an outer contour - check for child holes
                        const holes = [];
                        
                        if (node.Childs && node.Childs.length > 0) {
                            for (let i = 0; i < node.Childs.length; i++) {
                                const child = node.Childs[i];
                                if (child.m_polygon && child.m_polygon.length >= 3) {
                                    const holePoints = this.clipperPathToPoints(child.m_polygon);
                                    holes.push(holePoints);
                                    this.stats.holesPreserved++;
                                }
                                
                                // Process any islands within holes
                                if (child.Childs && child.Childs.length > 0) {
                                    for (let j = 0; j < child.Childs.length; j++) {
                                        extractFromPolyNode(child.Childs[j], false);
                                    }
                                }
                            }
                        }
                        
                        // Create primitive
                        let primitive;
                        if (holes.length > 0) {
                            primitive = this.createPrimitiveWithHoles(points, holes);
                        } else {
                            primitive = new PathPrimitive(points, {
                                isFused: true,
                                isRegion: true,
                                fill: true,
                                stroke: false,
                                closed: true
                            });
                        }
                        
                        if (primitive) {
                            fusedPrimitives.push(primitive);
                        }
                    }
                }
                
                // Process children if this is not a hole
                if (!isHole && node.Childs) {
                    for (let i = 0; i < node.Childs.length; i++) {
                        extractFromPolyNode(node.Childs[i], !isHole);
                    }
                }
            };
            
            // Start extraction from root
            if (polyTree.Childs && polyTree.Childs.length > 0) {
                for (let i = 0; i < polyTree.Childs.length; i++) {
                    extractFromPolyNode(polyTree.Childs[i], false);
                }
            }
            
            console.log(`PolyTree fusion complete: ${primitives.length} → ${fusedPrimitives.length} primitives (${this.stats.holesPreserved} holes)`);
            
            if (fusedPrimitives.length === 0) {
                console.warn('PolyTree fusion produced no primitives, returning original');
                return primitives;
            }
            
            return fusedPrimitives;
            
        } catch (error) {
            console.error('PolyTree fusion failed:', error);
            return primitives;
        }
    }
    
    /**
     * Convert Clipper path to points array
     */
    clipperPathToPoints(clipperPath) {
        return clipperPath.map(point => ({
            x: point.X / this.options.scale,
            y: point.Y / this.options.scale
        }));
    }
    
    /**
     * Expand a trace to a region representing its stroke area
     */
    expandTraceToRegion(trace) {
        const strokeWidth = trace.properties?.strokeWidth;
        if (!strokeWidth || strokeWidth <= 0) {
            return null;
        }
        
        const scale = this.options.scale;
        
        // Convert trace points to Clipper format
        let centerline;
        if (trace.type === 'path' && trace.points) {
            centerline = trace.points.map(pt => ({
                X: Math.round(pt.x * scale),
                Y: Math.round(pt.y * scale)
            }));
        } else {
            return null;
        }
        
        if (centerline.length < 2) {
            return null;
        }
        
        try {
            // Use ClipperOffset to expand the trace
            const co = new ClipperLib.ClipperOffset();
            const solution = new ClipperLib.Paths();
            
            // Add path with round joins for traces
            co.AddPath(
                centerline, 
                ClipperLib.JoinType.jtRound,
                trace.closed ? 
                    ClipperLib.EndType.etClosedPolygon : 
                    ClipperLib.EndType.etOpenRound
            );
            
            // Execute offset (half stroke width on each side)
            const delta = (strokeWidth / 2) * scale;
            co.Execute(solution, delta);
            
            this.stats.strokesExpanded++;
            
            // Convert back to primitives
            return solution.map(path => {
                const points = this.clipperPathToPoints(path);
                return new PathPrimitive(points, {
                    isRegion: true,
                    wasTrace: true,
                    originalStrokeWidth: strokeWidth,
                    fill: true,
                    stroke: false,
                    closed: true
                });
            });
        } catch (error) {
            console.warn('Failed to expand trace:', error);
            return null;
        }
    }
    
    /**
     * Convert primitive to Clipper paths
     */
    primitiveToClipperPaths(primitive, shouldExpand = false) {
        const paths = [];
        const scale = this.options.scale;
        const props = primitive.properties || {};
        
        try {
            switch (primitive.type) {
                case 'path':
                    if (!primitive.points || primitive.points.length < 2) {
                        return [];
                    }
                    
                    // Handle compound paths with holes
                    if (props.isCompound && props.hasHoles) {
                        // Split the compound path back into separate paths
                        const subPaths = [];
                        let currentPath = [];
                        
                        primitive.points.forEach(point => {
                            if (point === null) {
                                // Path break marker
                                if (currentPath.length >= 3) {
                                    subPaths.push(currentPath);
                                    currentPath = [];
                                }
                            } else {
                                currentPath.push({
                                    X: Math.round(point.x * scale),
                                    Y: Math.round(point.y * scale)
                                });
                            }
                        });
                        
                        if (currentPath.length >= 3) {
                            subPaths.push(currentPath);
                        }
                        
                        return subPaths;
                    }
                    
                    // Regular path
                    const clipperPath = [];
                    primitive.points.forEach(pt => {
                        if (pt && isFinite(pt.x) && isFinite(pt.y)) {
                            clipperPath.push({
                                X: Math.round(pt.x * scale),
                                Y: Math.round(pt.y * scale)
                            });
                        }
                    });
                    
                    // Ensure closed paths are properly closed
                    if (primitive.closed && clipperPath.length >= 3) {
                        const first = clipperPath[0];
                        const last = clipperPath[clipperPath.length - 1];
                        if (first.X !== last.X || first.Y !== last.Y) {
                            clipperPath.push({...first});
                        }
                        paths.push(clipperPath);
                    } else if (clipperPath.length >= 2) {
                        // Open path - might need expansion
                        if (shouldExpand) {
                            console.warn('Cannot expand open path in this context');
                        } else {
                            paths.push(clipperPath);
                        }
                    }
                    break;
                    
                case 'circle':
                    // Convert circle to polygon
                    const segments = Math.max(16, Math.ceil(primitive.radius * 8));
                    const circle = [];
                    
                    for (let i = 0; i < segments; i++) {
                        const angle = (i / segments) * 2 * Math.PI;
                        circle.push({
                            X: Math.round((primitive.center.x + primitive.radius * Math.cos(angle)) * scale),
                            Y: Math.round((primitive.center.y + primitive.radius * Math.sin(angle)) * scale)
                        });
                    }
                    
                    if (circle.length >= 3) {
                        paths.push(circle);
                    }
                    break;
                    
                case 'rectangle':
                    const rect = [
                        { X: Math.round(primitive.position.x * scale), 
                          Y: Math.round(primitive.position.y * scale) },
                        { X: Math.round((primitive.position.x + primitive.width) * scale), 
                          Y: Math.round(primitive.position.y * scale) },
                        { X: Math.round((primitive.position.x + primitive.width) * scale), 
                          Y: Math.round((primitive.position.y + primitive.height) * scale) },
                        { X: Math.round(primitive.position.x * scale), 
                          Y: Math.round((primitive.position.y + primitive.height) * scale) }
                    ];
                    paths.push(rect);
                    break;
                    
                case 'obround':
                    // Convert obround to path
                    const obroundPath = this.obroundToPath(primitive, scale);
                    if (obroundPath && obroundPath.length >= 3) {
                        paths.push(obroundPath);
                    }
                    break;
            }
        } catch (error) {
            console.warn(`Error converting ${primitive.type} to Clipper paths:`, error);
        }
        
        return paths;
    }
    
    /**
     * Convert obround to clipper path
     */
    obroundToPath(primitive, scale) {
        const x = primitive.position.x;
        const y = primitive.position.y;
        const w = primitive.width;
        const h = primitive.height;
        const r = Math.min(w, h) / 2;
        
        const path = [];
        const segments = Math.max(8, Math.ceil(r * 4));
        
        if (w > h) {
            // Horizontal obround
            // Right semicircle
            for (let i = 0; i <= segments / 2; i++) {
                const angle = (-Math.PI / 2) + (i / (segments / 2)) * Math.PI;
                path.push({
                    X: Math.round((x + w - r + r * Math.cos(angle)) * scale),
                    Y: Math.round((y + r + r * Math.sin(angle)) * scale)
                });
            }
            // Left semicircle
            for (let i = 0; i <= segments / 2; i++) {
                const angle = (Math.PI / 2) + (i / (segments / 2)) * Math.PI;
                path.push({
                    X: Math.round((x + r + r * Math.cos(angle)) * scale),
                    Y: Math.round((y + r + r * Math.sin(angle)) * scale)
                });
            }
        } else {
            // Vertical obround
            // Top semicircle
            for (let i = 0; i <= segments / 2; i++) {
                const angle = (i / (segments / 2)) * Math.PI;
                path.push({
                    X: Math.round((x + r + r * Math.cos(angle)) * scale),
                    Y: Math.round((y + h - r + r * Math.sin(angle)) * scale)
                });
            }
            // Bottom semicircle
            for (let i = 0; i <= segments / 2; i++) {
                const angle = Math.PI + (i / (segments / 2)) * Math.PI;
                path.push({
                    X: Math.round((x + r + r * Math.cos(angle)) * scale),
                    Y: Math.round((y + r + r * Math.sin(angle)) * scale)
                });
            }
        }
        
        return path;
    }
    
    /**
     * Create a primitive that represents a shape with holes
     */
    createPrimitiveWithHoles(outerPoints, holes) {
        // For canvas rendering, we need to create a compound path
        // The outer boundary should be CCW, holes should be CW
        
        // Ensure outer is CCW
        const outerArea = this.calculateSignedArea(outerPoints);
        if (outerArea < 0) {
            outerPoints = outerPoints.slice().reverse();
        }
        
        // Build compound path with null separators
        const allPoints = [...outerPoints];
        
        holes.forEach(hole => {
            const holeArea = this.calculateSignedArea(hole);
            const orientedHole = holeArea > 0 ? hole.slice().reverse() : hole;
            
            // Add a break in the path
            allPoints.push(null); // Marker for path break
            allPoints.push(...orientedHole);
        });
        
        // Create a special compound path primitive
        const primitive = new PathPrimitive(allPoints, {
            isFused: true,
            isRegion: true,
            hasHoles: true,
            holeCount: holes.length,
            fill: true,
            stroke: false,
            fillRule: 'evenodd', // Critical for hole rendering
            closed: true,
            isCompound: true
        });
        
        return primitive;
    }
    
    /**
     * Calculate signed area to determine path orientation
     */
    calculateSignedArea(points) {
        let area = 0;
        for (let i = 0; i < points.length; i++) {
            const j = (i + 1) % points.length;
            area += points[i].x * points[j].y;
            area -= points[j].x * points[i].y;
        }
        return area / 2;
    }
    
    /**
     * Prepare geometry for offset generation
     */
    prepareForOffset(fusedPrimitives) {
        console.log(`Preparing ${fusedPrimitives.length} primitives for offset generation`);
        
        // Ensure all paths are properly oriented for offsetting
        const oriented = fusedPrimitives.map(primitive => {
            if (primitive.type === 'path' && primitive.closed && !primitive.properties?.hasHoles) {
                // Simple paths: ensure outer boundaries are CCW
                const area = this.calculateSignedArea(primitive.points);
                
                if (area < 0) {
                    // Reverse points to make CCW
                    primitive.points = primitive.points.slice().reverse();
                    if (primitive.properties) {
                        primitive.properties.orientationCorrected = true;
                    }
                }
            }
            // Compound paths with holes are already properly oriented
            
            // Mark as offset-ready
            if (primitive.properties) {
                primitive.properties.isOffsetReady = true;
            }
            
            return primitive;
        });
        
        return oriented;
    }
    
    /**
     * Generate offset geometry
     */
    generateOffset(primitives, offsetDistance, options = {}) {
        if (!this.clipperAvailable) {
            throw new Error('ClipperLib required for offset generation');
        }
        
        if (offsetDistance === 0) {
            return primitives;
        }
        
        console.log(`Generating offset: ${offsetDistance}mm`);
        
        try {
            // Convert to Clipper paths
            const clipperPaths = [];
            primitives.forEach(primitive => {
                const paths = this.primitiveToClipperPaths(primitive);
                if (paths && paths.length > 0) {
                    clipperPaths.push(...paths);
                }
            });
            
            if (clipperPaths.length === 0) {
                console.warn('No valid paths for offset');
                return [];
            }
            
            // Create offset
            const co = new ClipperLib.ClipperOffset();
            const solution = new ClipperLib.Paths();
            
            // Add paths
            clipperPaths.forEach(path => {
                if (path && path.length >= 3) {
                    co.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
                }
            });
            
            // Execute offset
            const delta = offsetDistance * this.options.scale;
            co.Execute(solution, delta);
            
            // Convert back to primitives
            const offsetPrimitives = solution.map((path, index) => {
                const points = this.clipperPathToPoints(path);
                return new PathPrimitive(points, {
                    isOffset: true,
                    offsetDistance: offsetDistance,
                    fill: false,
                    stroke: true,
                    strokeWidth: 0.1,
                    isToolpath: true,
                    closed: true
                });
            }).filter(p => p !== null);
            
            console.log(`Offset complete: ${offsetPrimitives.length} paths generated`);
            return offsetPrimitives;
            
        } catch (error) {
            console.error('Offset generation failed:', error);
            return [];
        }
    }
    
    /**
     * Get processing statistics
     */
    getStats() {
        return { ...this.stats };
    }
    
    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            fusionOperations: 0,
            primitivesProcessed: 0,
            primitivesReduced: 0,
            duplicatesRemoved: 0,
            strokesExpanded: 0,
            holesPreserved: 0,
            errors: 0
        };
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GeometryProcessor;
} else {
    window.GeometryProcessor = GeometryProcessor;
}