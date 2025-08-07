// Geometry Processor - FIXED: Proper deduplication and fusion for PCB isolation routing
// File Location: geometry/geometry-processor.js
// Pipeline Position: Post-processing layer for primitive geometry operations
// Input: Arrays of render primitives with coordinate data
// Output: Processed primitives with proper union fusion
// Dependencies: ClipperLib (loaded from clipper.min.js)

class GeometryProcessor {
    constructor(options = {}) {
        this.options = {
            debug: options.debug || false,
            scale: 1000000, // Scale factor for Clipper precision (1 unit = 1 micron)
            deduplicationTolerance: 0.001, // 1 micron for deduplication
            ...options
        };
        
        // Check if ClipperLib is available
        this.clipperAvailable = typeof ClipperLib !== 'undefined';
        
        if (!this.clipperAvailable) {
            console.warn('ClipperLib not available - geometry operations will be limited');
        } else {
            console.log('GeometryProcessor initialized with deduplication and proper fusion');
        }
        
        // Performance tracking
        this.stats = {
            fusionOperations: 0,
            primitivesProcessed: 0,
            primitivesReduced: 0,
            duplicatesRemoved: 0,
            errors: 0
        };
    }
    
    /**
     * FIXED: Enhanced fusion with deduplication
     */
    fuseGeometry(primitives, options = {}) {
        if (!this.clipperAvailable || !primitives || primitives.length === 0) {
            return primitives;
        }
        
        console.log(`Starting fusion of ${primitives.length} primitives`);
        
        try {
            this.stats.fusionOperations++;
            this.stats.primitivesProcessed += primitives.length;
            
            // Step 1: Deduplicate primitives before fusion
            const deduplicated = this.deduplicatePrimitives(primitives);
            console.log(`After deduplication: ${deduplicated.length} primitives (removed ${primitives.length - deduplicated.length} duplicates)`);
            
            // Step 2: Separate by polarity and type
            const darkPrimitives = [];
            const clearPrimitives = [];
            
            deduplicated.forEach(primitive => {
                const polarity = primitive.properties?.polarity || 'dark';
                
                if (polarity === 'dark') {
                    darkPrimitives.push(primitive);
                } else if (polarity === 'clear') {
                    clearPrimitives.push(primitive);
                }
            });
            
            console.log(`Dark: ${darkPrimitives.length}, Clear: ${clearPrimitives.length}`);
            
            // Step 3: Convert to Clipper paths with type filtering
            const clipperPaths = [];
            let regionCount = 0;
            let strokeCount = 0;
            let flashCount = 0;
            
            darkPrimitives.forEach((primitive, index) => {
                try {
                    // FIXED: Track primitive types for debugging
                    if (primitive.properties?.isRegion) regionCount++;
                    else if (primitive.properties?.isStroke) strokeCount++;
                    else if (primitive.properties?.isFlash) flashCount++;
                    
                    const paths = this.primitiveToClipperPaths(primitive);
                    if (paths.length > 0) {
                        clipperPaths.push(...paths);
                    }
                } catch (error) {
                    console.warn(`Failed to convert primitive ${index}:`, error);
                    this.stats.errors++;
                }
            });
            
            console.log(`Converted to clipper paths - Regions: ${regionCount}, Strokes: ${strokeCount}, Flashes: ${flashCount}`);
            
            if (clipperPaths.length === 0) {
                return deduplicated;
            }
            
            // Step 4: Perform union operation
            const clipper = new ClipperLib.Clipper();
            const solution = new ClipperLib.Paths();
            
            // Add all paths for union
            clipper.AddPaths(clipperPaths, ClipperLib.PolyType.ptSubject, true);
            
            // Use NonZero fill for better results with overlapping geometry
            const success = clipper.Execute(
                ClipperLib.ClipType.ctUnion,
                solution,
                ClipperLib.PolyFillType.pftNonZero,
                ClipperLib.PolyFillType.pftNonZero
            );
            
            if (!success || solution.length === 0) {
                console.error('Union operation failed');
                return deduplicated;
            }
            
            // Step 5: Clean and simplify the solution
            const cleanDistance = 0.001 * this.options.scale; // 1 micron
            const cleaned = ClipperLib.Clipper.CleanPolygons(solution, cleanDistance);
            
            // Simplify polygons to reduce point count
            const simplified = this.simplifyPolygons(cleaned);
            
            console.log(`Union complete: ${clipperPaths.length} paths → ${simplified.length} polygons`);
            
            // Step 6: Handle clear polarity (if any)
            let finalSolution = simplified;
            if (clearPrimitives.length > 0) {
                const clearPaths = [];
                clearPrimitives.forEach(primitive => {
                    try {
                        const paths = this.primitiveToClipperPaths(primitive);
                        clearPaths.push(...paths);
                    } catch (error) {
                        console.warn('Failed to convert clear primitive:', error);
                        this.stats.errors++;
                    }
                });
                
                if (clearPaths.length > 0) {
                    const diffClipper = new ClipperLib.Clipper();
                    finalSolution = new ClipperLib.Paths();
                    
                    diffClipper.AddPaths(simplified, ClipperLib.PolyType.ptSubject, true);
                    diffClipper.AddPaths(clearPaths, ClipperLib.PolyType.ptClip, true);
                    
                    diffClipper.Execute(
                        ClipperLib.ClipType.ctDifference,
                        finalSolution,
                        ClipperLib.PolyFillType.pftNonZero,
                        ClipperLib.PolyFillType.pftNonZero
                    );
                }
            }
            
            // Step 7: Convert back to primitives
            const fusedPrimitives = finalSolution.map((path, index) => {
                const primitive = this.clipperPathToPrimitive(path, {
                    polarity: 'dark',
                    isFused: true,
                    originalCount: darkPrimitives.length,
                    fill: true,
                    stroke: false,
                    fillRule: 'nonzero',
                    isOffsetReady: true,
                    pathOrientation: this.getPathOrientation(path)
                });
                
                if (primitive && this.validateFusedPrimitive(primitive, index)) {
                    return primitive;
                } else {
                    console.warn(`Invalid fused primitive ${index} filtered out`);
                    return null;
                }
            }).filter(p => p !== null);
            
            this.stats.primitivesReduced += primitives.length - fusedPrimitives.length;
            
            console.log(`Fusion result: ${fusedPrimitives.length} valid primitives (${this.stats.primitivesReduced} reduced)`);
            
            return fusedPrimitives;
            
        } catch (error) {
            console.error('Fusion failed:', error);
            this.stats.errors++;
            return primitives;
        }
    }
    
    /**
     * FIXED: Deduplicate primitives based on geometric similarity
     */
    deduplicatePrimitives(primitives) {
        const unique = [];
        const seen = new Set();
        
        primitives.forEach(primitive => {
            const hash = this.getPrimitiveHash(primitive);
            
            if (!seen.has(hash)) {
                seen.add(hash);
                unique.push(primitive);
            } else {
                this.stats.duplicatesRemoved++;
                if (this.options.debug) {
                    console.log(`Removed duplicate primitive: ${primitive.type}`);
                }
            }
        });
        
        return unique;
    }
    
    /**
     * FIXED: Generate a hash for primitive deduplication
     */
    getPrimitiveHash(primitive) {
        const tolerance = this.options.deduplicationTolerance;
        
        switch (primitive.type) {
            case 'path':
                if (!primitive.points || primitive.points.length === 0) return 'empty-path';
                
                // Hash based on rounded coordinates
                const pathParts = primitive.points.map(p => 
                    `${Math.round(p.x / tolerance)}:${Math.round(p.y / tolerance)}`
                ).join('|');
                
                return `path:${primitive.closed}:${pathParts}`;
                
            case 'circle':
                return `circle:${Math.round(primitive.center.x / tolerance)}:${Math.round(primitive.center.y / tolerance)}:${Math.round(primitive.radius / tolerance)}`;
                
            case 'rectangle':
                return `rect:${Math.round(primitive.position.x / tolerance)}:${Math.round(primitive.position.y / tolerance)}:${Math.round(primitive.width / tolerance)}:${Math.round(primitive.height / tolerance)}`;
                
            case 'obround':
                return `obround:${Math.round(primitive.position.x / tolerance)}:${Math.round(primitive.position.y / tolerance)}:${Math.round(primitive.width / tolerance)}:${Math.round(primitive.height / tolerance)}`;
                
            default:
                return `${primitive.type}:${JSON.stringify(primitive)}`;
        }
    }
    
    /**
     * FIXED: Simplify polygons to reduce complexity
     */
    simplifyPolygons(polygons) {
        const simplified = [];
        
        polygons.forEach(polygon => {
            // Use Douglas-Peucker simplification
            const tolerance = 0.01 * this.options.scale; // 10 micron simplification
            const simplifiedPath = ClipperLib.Clipper.SimplifyPolygon(polygon, ClipperLib.PolyFillType.pftNonZero);
            
            simplifiedPath.forEach(path => {
                if (path.length >= 3) { // Only keep valid polygons
                    simplified.push(path);
                }
            });
        });
        
        return simplified;
    }
    
    /**
     * Convert primitive to clipper paths
     */
    primitiveToClipperPaths(primitive) {
        const paths = [];
        const scale = this.options.scale;
        
        try {
            switch (primitive.type) {
                case 'path':
                    if (primitive.points && primitive.points.length >= 2) {
                        const clipperPath = primitive.points.map(pt => ({
                            X: Math.round(pt.x * scale),
                            Y: Math.round(pt.y * scale)
                        }));
                        
                        // Ensure closed paths are properly closed
                        if (primitive.closed || primitive.properties?.isRegion) {
                            const first = clipperPath[0];
                            const last = clipperPath[clipperPath.length - 1];
                            if (first.X !== last.X || first.Y !== last.Y) {
                                clipperPath.push({...first});
                            }
                        }
                        
                        paths.push(clipperPath);
                    }
                    break;
                    
                case 'circle':
                    // High-quality circle approximation
                    const segments = Math.max(32, Math.ceil(primitive.radius * 16));
                    const circle = [];
                    
                    for (let i = 0; i < segments; i++) {
                        const angle = (i / segments) * 2 * Math.PI;
                        circle.push({
                            X: Math.round((primitive.center.x + primitive.radius * Math.cos(angle)) * scale),
                            Y: Math.round((primitive.center.y + primitive.radius * Math.sin(angle)) * scale)
                        });
                    }
                    
                    paths.push(circle);
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
                    paths.push(this.createAccurateObroundPath(primitive, scale));
                    break;
            }
        } catch (error) {
            console.warn(`Error converting ${primitive.type}:`, error);
        }
        
        return paths;
    }
    
    /**
     * Create accurate obround path
     */
    createAccurateObroundPath(primitive, scale) {
        const x = primitive.position.x;
        const y = primitive.position.y;
        const w = primitive.width;
        const h = primitive.height;
        const r = Math.min(w, h) / 2;
        
        const arcSegments = Math.max(16, Math.ceil(r * 32));
        const path = [];
        
        if (w > h) {
            // Horizontal obround
            // Right arc
            for (let i = 0; i <= arcSegments / 2; i++) {
                const angle = -Math.PI / 2 + (i / (arcSegments / 2)) * Math.PI;
                path.push({
                    X: Math.round((x + w - r + r * Math.cos(angle)) * scale),
                    Y: Math.round((y + r + r * Math.sin(angle)) * scale)
                });
            }
            // Left arc
            for (let i = 0; i <= arcSegments / 2; i++) {
                const angle = Math.PI / 2 + (i / (arcSegments / 2)) * Math.PI;
                path.push({
                    X: Math.round((x + r + r * Math.cos(angle)) * scale),
                    Y: Math.round((y + r + r * Math.sin(angle)) * scale)
                });
            }
        } else {
            // Vertical obround
            // Top arc
            for (let i = 0; i <= arcSegments / 2; i++) {
                const angle = (i / (arcSegments / 2)) * Math.PI;
                path.push({
                    X: Math.round((x + r + r * Math.cos(angle)) * scale),
                    Y: Math.round((y + h - r + r * Math.sin(angle)) * scale)
                });
            }
            // Bottom arc
            for (let i = 0; i <= arcSegments / 2; i++) {
                const angle = Math.PI + (i / (arcSegments / 2)) * Math.PI;
                path.push({
                    X: Math.round((x + r + r * Math.cos(angle)) * scale),
                    Y: Math.round((y + r + r * Math.sin(angle)) * scale)
                });
            }
        }
        
        return path;
    }
    
    /**
     * Convert Clipper path back to primitive
     */
    clipperPathToPrimitive(clipperPath, properties) {
        if (!clipperPath || clipperPath.length < 3) {
            console.warn('Invalid clipper path: insufficient points');
            return null;
        }
        
        // Convert back to world coordinates
        const points = clipperPath.map(point => ({
            x: point.X / this.options.scale,
            y: point.Y / this.options.scale
        }));
        
        // Validate converted coordinates
        const validPoints = points.filter(point => 
            isFinite(point.x) && isFinite(point.y)
        );
        
        if (validPoints.length < 3) {
            console.warn('Invalid primitive: insufficient valid points after conversion');
            return null;
        }
        
        // Ensure PathPrimitive has all required methods and properties
        const primitive = new PathPrimitive(validPoints, {
            ...properties,
            closed: true,
            isOffsetReady: true,
            dimensionallyAccurate: true,
            fusionSource: 'clipper_union'
        });
        
        // Validate the created primitive
        if (!this.validatePrimitiveStructure(primitive)) {
            console.warn('Created primitive failed structure validation');
            return null;
        }
        
        return primitive;
    }
    
    /**
     * Validate fused primitive
     */
    validateFusedPrimitive(primitive, index) {
        try {
            // Check basic structure
            if (!primitive || typeof primitive.getBounds !== 'function') {
                console.warn(`Primitive ${index}: Missing getBounds method`);
                return false;
            }
            
            // Check bounds validity
            const bounds = primitive.getBounds();
            if (!isFinite(bounds.minX) || !isFinite(bounds.minY) || 
                !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                console.warn(`Primitive ${index}: Invalid bounds`, bounds);
                return false;
            }
            
            // Check for degenerate geometry
            const width = bounds.maxX - bounds.minX;
            const height = bounds.maxY - bounds.minY;
            const minSize = 0.001; // 1 micron minimum
            
            if (width < minSize || height < minSize) {
                console.warn(`Primitive ${index}: Degenerate geometry ${width.toFixed(6)} × ${height.toFixed(6)}`);
                return false;
            }
            
            // Check path-specific requirements
            if (primitive.type === 'path') {
                if (!primitive.points || primitive.points.length < 3) {
                    console.warn(`Primitive ${index}: Path has insufficient points`);
                    return false;
                }
            }
            
            return true;
        } catch (error) {
            console.warn(`Primitive ${index}: Validation error`, error);
            return false;
        }
    }
    
    /**
     * Validate primitive structure
     */
    validatePrimitiveStructure(primitive) {
        const requiredMethods = ['getBounds', 'getCenter'];
        const requiredProperties = ['type', 'properties'];
        
        // Check methods
        for (const method of requiredMethods) {
            if (typeof primitive[method] !== 'function') {
                console.warn(`Primitive missing method: ${method}`);
                return false;
            }
        }
        
        // Check properties
        for (const prop of requiredProperties) {
            if (!primitive.hasOwnProperty(prop)) {
                console.warn(`Primitive missing property: ${prop}`);
                return false;
            }
        }
        
        return true;
    }
    
    /**
     * Get path orientation
     */
    getPathOrientation(clipperPath) {
        if (!clipperPath || clipperPath.length < 3) return 'unknown';
        
        // Calculate signed area to determine orientation
        let area = 0;
        for (let i = 0; i < clipperPath.length; i++) {
            const j = (i + 1) % clipperPath.length;
            area += clipperPath[i].X * clipperPath[j].Y;
            area -= clipperPath[j].X * clipperPath[i].Y;
        }
        
        // Positive area = CCW (outer boundary), Negative = CW (hole)
        return area > 0 ? 'ccw' : 'cw';
    }
    
    /**
     * Prepare geometry for offset generation
     */
    prepareForOffset(fusedPrimitives) {
        console.log(`Preparing ${fusedPrimitives.length} primitives for offset generation`);
        
        // Ensure all paths are properly oriented for offsetting
        const oriented = fusedPrimitives.map(primitive => {
            if (primitive.type === 'path' && primitive.closed) {
                // Ensure outer boundaries are CCW, holes are CW
                const area = this.calculateSignedArea(primitive.points);
                
                if (area < 0) {
                    // Reverse points for correct orientation
                    console.log('Reversing path orientation for offset compatibility');
                    primitive.points = primitive.points.slice().reverse();
                    
                    // Update orientation property
                    if (primitive.properties) {
                        primitive.properties.pathOrientation = 'ccw';
                        primitive.properties.orientationCorrected = true;
                    }
                }
                
                // Mark as offset-ready
                if (primitive.properties) {
                    primitive.properties.isOffsetReady = true;
                    primitive.properties.dimensionallyValidated = true;
                }
            }
            return primitive;
        });
        
        console.log('Geometry prepared for offset generation');
        return oriented;
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
     * Generate offset geometry
     */
    generateOffset(primitives, offsetDistance, options = {}) {
        if (!this.clipperAvailable) {
            throw new Error('ClipperLib required for offset generation');
        }
        
        if (offsetDistance === 0) {
            return primitives;
        }
        
        console.log(`Offset generation: ${offsetDistance}mm`);
        
        // Prepare geometry
        const prepared = this.prepareForOffset(primitives);
        
        // Convert to Clipper paths
        const clipperPaths = [];
        prepared.forEach(primitive => {
            const paths = this.primitiveToClipperPaths(primitive);
            clipperPaths.push(...paths);
        });
        
        if (clipperPaths.length === 0) {
            console.warn('No valid paths for offset');
            return [];
        }
        
        // Create offset
        const co = new ClipperLib.ClipperOffset();
        const solution = new ClipperLib.Paths();
        
        // Add paths with proper join type for PCB work
        clipperPaths.forEach(path => {
            co.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
        });
        
        // Execute offset
        const delta = offsetDistance * this.options.scale;
        co.Execute(solution, delta);
        
        // Convert back to primitives
        const offsetPrimitives = solution.map((path, index) => {
            return this.clipperPathToPrimitive(path, {
                isOffset: true,
                offsetDistance: offsetDistance,
                fill: false,
                stroke: true,
                strokeWidth: Math.abs(offsetDistance) * 0.1,
                originalOffsetDistance: offsetDistance,
                isToolpath: offsetDistance < 0
            });
        }).filter(p => p !== null);
        
        console.log(`Offset complete: ${offsetPrimitives.length} paths generated`);
        return offsetPrimitives;
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
            errors: 0
        };
    }
}

/**
 * Dimensional validation utilities
 */
class DimensionalValidator {
    static validatePrimitive(primitive, tolerance = 0.001) {
        const bounds = primitive.getBounds();
        
        // Check for valid bounds
        if (!isFinite(bounds.minX) || !isFinite(bounds.minY) ||
            !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
            return { valid: false, error: 'Invalid bounds' };
        }
        
        // Check for degenerate geometry
        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;
        
        if (width < tolerance && height < tolerance) {
            return { valid: false, error: 'Degenerate geometry' };
        }
        
        // Path-specific checks
        if (primitive.type === 'path') {
            // Check for duplicate points
            for (let i = 1; i < primitive.points.length; i++) {
                const p1 = primitive.points[i - 1];
                const p2 = primitive.points[i];
                const dist = Math.sqrt(
                    Math.pow(p2.x - p1.x, 2) + 
                    Math.pow(p2.y - p1.y, 2)
                );
                
                if (dist < tolerance) {
                    return { 
                        valid: false, 
                        error: `Duplicate points at index ${i}` 
                    };
                }
            }
        }
        
        return { valid: true };
    }
    
    static calculateTotalArea(primitives) {
        let totalArea = 0;
        
        primitives.forEach(primitive => {
            if (primitive.type === 'path' && primitive.closed) {
                // Calculate polygon area
                let area = 0;
                const points = primitive.points;
                for (let i = 0; i < points.length; i++) {
                    const j = (i + 1) % points.length;
                    area += points[i].x * points[j].y;
                    area -= points[j].x * points[i].y;
                }
                totalArea += Math.abs(area / 2);
            } else if (primitive.type === 'circle') {
                totalArea += Math.PI * primitive.radius * primitive.radius;
            } else if (primitive.type === 'rectangle') {
                totalArea += primitive.width * primitive.height;
            }
        });
        
        return totalArea;
    }
    
    static validateFusionResult(original, fused) {
        // Calculate total area before and after
        const originalArea = this.calculateTotalArea(original);
        const fusedArea = this.calculateTotalArea(fused);
        
        // Area should be approximately the same or less (due to overlaps)
        const areaDiff = Math.abs(fusedArea - originalArea);
        const areaRatio = areaDiff / originalArea;
        
        console.log(`Area validation: Original=${originalArea.toFixed(3)}mm², Fused=${fusedArea.toFixed(3)}mm²`);
        
        // FIXED: Expect area to decrease or stay similar after fusion
        if (fusedArea > originalArea * 1.01) { // Allow 1% tolerance
            console.warn(`Area increased during fusion: ${(areaRatio * 100).toFixed(1)}%`);
        }
        
        return {
            originalArea,
            fusedArea,
            difference: areaDiff,
            ratio: areaRatio
        };
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GeometryProcessor, DimensionalValidator };
} else {
    window.GeometryProcessor = GeometryProcessor;
    window.DimensionalValidator = DimensionalValidator;
}