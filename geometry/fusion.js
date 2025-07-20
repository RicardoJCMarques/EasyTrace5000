// Polygon Fusion Engine using Clipper.js for Boolean Operations

class PolygonFusionEngine {
    constructor(options = {}) {
        this.options = {
            scaleFactor: options.scaleFactor || 1000000, // Convert mm to micrometers for Clipper
            simplifyTolerance: options.simplifyTolerance || 0.001,
            enableSimplification: options.enableSimplification !== false,
            debug: options.debug || false
        };
        
        this.stats = {
            originalPolygons: 0,
            fusedPolygons: 0,
            holes: 0,
            processingTime: 0
        };
        
        // Check if Clipper.js is available
        this.clipperAvailable = typeof ClipperLib !== 'undefined';
        if (!this.clipperAvailable) {
            console.warn('Clipper.js not loaded - polygon fusion will use simple fallback');
        }
    }
    
    // Main fusion method - merges all polygons into unified geometry
    fusePolygons(polygons, operationType = 'union') {
        if (!Array.isArray(polygons) || polygons.length === 0) {
            return [];
        }
        
        const startTime = performance.now();
        this.stats.originalPolygons = polygons.length;
        
        if (this.options.debug) {
            console.log(`🔧 Fusing ${polygons.length} polygons with operation: ${operationType}`);
        }
        
        let result;
        
        if (this.clipperAvailable && polygons.length > 1) {
            result = this.fuseWithClipper(polygons, operationType);
        } else {
            // Fallback for single polygon or no Clipper
            result = polygons.filter(p => p.isValid());
        }
        
        // Post-process results
        if (this.options.enableSimplification) {
            result = this.simplifyPolygons(result);
        }
        
        this.stats.fusedPolygons = result.length;
        this.stats.processingTime = performance.now() - startTime;
        
        if (this.options.debug) {
            console.log(`✅ Fusion complete: ${this.stats.originalPolygons} → ${this.stats.fusedPolygons} polygons (${this.stats.processingTime.toFixed(1)}ms)`);
        }
        
        return result;
    }
    
    fuseWithClipper(polygons, operationType) {
        try {
            // Separate approach: add all polygons as subjects for union
            const clipper = new ClipperLib.Clipper();
            const solution = new ClipperLib.Paths();
            
            // For union operations, add all polygons as subjects
            const validPolygons = polygons.filter(p => p.isValid());
            console.log(`🔧 Processing ${validPolygons.length} valid polygons for fusion`);
            
            for (const polygon of validPolygons) {
                const clipperPath = this.polygonToClipperPath(polygon);
                if (clipperPath.length >= 3) {
                    // Ensure correct winding for union - make all polygons clockwise
                    if (!ClipperLib.Clipper.Orientation(clipperPath)) {
                        clipperPath.reverse(); // Make clockwise
                    }
                    clipper.AddPath(clipperPath, ClipperLib.PolyType.ptSubject, true);
                } else {
                    console.warn('Skipping invalid polygon with < 3 points');
                }
            }
            
            // Execute union operation
            const success = clipper.Execute(
                ClipperLib.ClipType.ctUnion, 
                solution, 
                ClipperLib.PolyFillType.pftPositive, // Use positive fill for union
                ClipperLib.PolyFillType.pftPositive
            );
            
            if (!success) {
                console.warn('Clipper union operation failed, returning original polygons');
                return validPolygons;
            }
            
            if (solution.length === 0) {
                console.warn('Clipper union produced no results, returning original polygons');
                return validPolygons;
            }
            
            // Convert back to CopperPolygon objects
            const result = [];
            for (const path of solution) {
                if (path.length >= 3) {
                    const polygon = this.clipperPathToPolygon(path, {
                        source: 'fused',
                        operation: operationType,
                        type: 'unified_copper'
                    });
                    
                    if (polygon.isValid()) {
                        result.push(polygon);
                    }
                }
            }
            
            console.log(`✅ Clipper fusion: ${validPolygons.length} → ${result.length} polygons`);
            return result;
            
        } catch (error) {
            console.error('Error in Clipper fusion:', error);
            return polygons.filter(p => p.isValid());
        }
    }
    
    // Fuse polygons by layer
    fuseByLayer(layerMap) {
        const fusedLayers = new Map();
        
        for (const [layerName, polygons] of layerMap.entries()) {
            if (Array.isArray(polygons) && polygons.length > 0) {
                const fusedPolygons = this.fusePolygons(polygons, 'union');
                if (fusedPolygons.length > 0) {
                    fusedLayers.set(layerName, fusedPolygons);
                }
            }
        }
        
        return fusedLayers;
    }
    
    // Create polygon difference (subtract holes)
    subtractHoles(basePolygons, holePolygons) {
        if (!this.clipperAvailable || !Array.isArray(holePolygons) || holePolygons.length === 0) {
            return basePolygons;
        }
        
        try {
            const clipper = new ClipperLib.Clipper();
            const solution = new ClipperLib.Paths();
            
            // Add base polygons as subjects
            for (const polygon of basePolygons) {
                if (polygon.isValid()) {
                    const clipperPath = this.polygonToClipperPath(polygon);
                    if (clipperPath.length >= 3) {
                        clipper.AddPath(clipperPath, ClipperLib.PolyType.ptSubject, true);
                    }
                }
            }
            
            // Add holes as clips
            for (const hole of holePolygons) {
                if (hole.isValid()) {
                    const clipperPath = this.polygonToClipperPath(hole);
                    if (clipperPath.length >= 3) {
                        clipper.AddPath(clipperPath, ClipperLib.PolyType.ptClip, true);
                    }
                }
            }
            
            const success = clipper.Execute(
                ClipperLib.ClipType.ctDifference,
                solution,
                ClipperLib.PolyFillType.pftEvenOdd,
                ClipperLib.PolyFillType.pftEvenOdd
            );
            
            if (!success) {
                return basePolygons;
            }
            
            const result = [];
            for (const path of solution) {
                const polygon = this.clipperPathToPolygon(path, {
                    source: 'hole_subtraction'
                });
                
                if (polygon.isValid()) {
                    result.push(polygon);
                }
            }
            
            return result;
            
        } catch (error) {
            console.error('Error in hole subtraction:', error);
            return basePolygons;
        }
    }
    
    // Convert CopperPolygon to Clipper path
    polygonToClipperPath(polygon) {
        return polygon.points.map(point => ({
            X: Math.round(point.x * this.options.scaleFactor),
            Y: Math.round(point.y * this.options.scaleFactor)
        }));
    }
    
    // Convert Clipper path to CopperPolygon
    clipperPathToPolygon(clipperPath, properties = {}) {
        const points = clipperPath.map(point => ({
            x: point.X / this.options.scaleFactor,
            y: point.Y / this.options.scaleFactor
        }));
        
        return new CopperPolygon(points, properties);
    }
    
    // Simplify polygons after fusion
    simplifyPolygons(polygons) {
        if (!this.options.enableSimplification) {
            return polygons;
        }
        
        return polygons.map(polygon => {
            try {
                return PolygonUtils.simplify(polygon, this.options.simplifyTolerance);
            } catch (error) {
                console.warn('Error simplifying polygon:', error);
                return polygon;
            }
        }).filter(p => p.isValid());
    }
    
    // Offset polygon (for isolation routing)
    offsetPolygon(polygon, distance) {
        if (!this.clipperAvailable) {
            console.warn('Clipper.js required for polygon offsetting');
            return [polygon];
        }
        
        try {
            const clipperOffset = new ClipperLib.ClipperOffset();
            const solution = new ClipperLib.Paths();
            
            const clipperPath = this.polygonToClipperPath(polygon);
            clipperOffset.AddPath(clipperPath, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
            
            const scaledDistance = distance * this.options.scaleFactor;
            clipperOffset.Execute(solution, scaledDistance);
            
            const result = [];
            for (const path of solution) {
                const offsetPolygon = this.clipperPathToPolygon(path, {
                    ...polygon.properties,
                    source: 'offset',
                    offsetDistance: distance
                });
                
                if (offsetPolygon.isValid()) {
                    result.push(offsetPolygon);
                }
            }
            
            return result;
            
        } catch (error) {
            console.error('Error in polygon offset:', error);
            return [polygon];
        }
    }
    
    // Offset multiple polygons
    offsetPolygons(polygons, distance) {
        const result = [];
        
        for (const polygon of polygons) {
            if (polygon.isValid()) {
                const offsetPolygons = this.offsetPolygon(polygon, distance);
                result.push(...offsetPolygons);
            }
        }
        
        return result;
    }
    
    // Get processing statistics
    getStats() {
        return { ...this.stats };
    }
    
    // Reset statistics
    resetStats() {
        this.stats = {
            originalPolygons: 0,
            fusedPolygons: 0,
            holes: 0,
            processingTime: 0
        };
    }
    
    // Check if Clipper.js is available
    isClipperAvailable() {
        return this.clipperAvailable;
    }
    
    // Configure options
    configure(newOptions) {
        this.options = { ...this.options, ...newOptions };
        return this;
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PolygonFusionEngine;
} else {
    window.PolygonFusionEngine = PolygonFusionEngine;
}