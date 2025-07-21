// Balanced Geometry Analyzer - Useful Analysis Without Spam
// Fixes the "too many function arguments" error and filters misleading warnings

class GeometryAnalyzer {
    constructor(options = {}) {
        this.options = {
            debug: options.debug || false,
            minTraceWidth: options.minTraceWidth || 0.1, // mm
            minClearance: options.minClearance || 0.1, // mm
            maxSamples: 200, // Limit sample size to prevent errors
            maxPointsPerPolygon: 1000, // Limit points to prevent memory issues
            ...options
        };
        
        this.analysisCache = new Map();
        this.debug('Balanced GeometryAnalyzer initialized');
    }
    
    /**
     * Main geometry analysis - focuses on useful metrics
     */
    analyzeGeometry(operations) {
        const analysis = {
            timestamp: Date.now(),
            operations: operations.length,
            layers: {},
            totalPolygons: 0,
            totalHoles: 0,
            bounds: null,
            warnings: [],
            clearanceAnalysis: null
        };
        
        const allPolygons = [];
        const layerAnalysis = {};
        
        // Analyze each operation/layer safely
        operations.forEach(operation => {
            try {
                if (operation.polygons && operation.polygons.length > 0) {
                    const layerData = this.analyzeLayerSafe(operation.polygons, operation.type, operation.id);
                    layerAnalysis[operation.id] = layerData;
                    
                    // Collect sample polygons for global analysis (limit size)
                    const samplePolygons = this.samplePolygons(operation.polygons, 50);
                    allPolygons.push(...samplePolygons);
                    analysis.totalPolygons += operation.polygons.length;
                }
                
                if (operation.holes && operation.holes.length > 0) {
                    analysis.totalHoles += operation.holes.length;
                }
            } catch (error) {
                analysis.warnings.push(`Error analyzing operation ${operation.id}: ${error.message}`);
                this.debug(`Analysis error for operation ${operation.id}: ${error.message}`);
            }
        });
        
        // Overall bounds
        if (allPolygons.length > 0) {
            try {
                analysis.bounds = PolygonUtils.calculateBounds(allPolygons);
            } catch (error) {
                analysis.warnings.push(`Error calculating bounds: ${error.message}`);
            }
        }
        
        // Useful inter-feature clearance analysis
        if (allPolygons.length > 1) {
            analysis.clearanceAnalysis = this.analyzeInterFeatureClearances(allPolygons);
        }
        
        analysis.layers = layerAnalysis;
        
        this.debug('Balanced geometry analysis complete:', {
            operations: analysis.operations,
            polygons: analysis.totalPolygons,
            holes: analysis.totalHoles,
            warnings: analysis.warnings.length
        });
        
        return analysis;
    }
    
    /**
     * Safe layer analysis that avoids memory issues
     */
    analyzeLayerSafe(polygons, operationType, layerId) {
        const cacheKey = `${layerId}_${polygons.length}_${operationType}`;
        if (this.analysisCache.has(cacheKey)) {
            return this.analysisCache.get(cacheKey);
        }
        
        const analysis = {
            type: operationType,
            polygonCount: polygons.length,
            totalArea: 0,
            features: {
                traces: 0,
                pads: 0,
                regions: 0
            },
            complexity: 'low',
            warnings: []
        };
        
        try {
            // Sample polygons to prevent memory issues
            const samplesToProcess = this.samplePolygons(polygons, this.options.maxSamples);
            
            // Analyze sample of polygons safely
            samplesToProcess.forEach((polygon, index) => {
                try {
                    if (!this.isPolygonValid(polygon)) {
                        analysis.warnings.push(`Invalid polygon ${index} in layer ${layerId}`);
                        return;
                    }
                    
                    const area = this.getPolygonAreaSafe(polygon);
                    analysis.totalArea += area;
                    
                    // Classify feature type
                    const featureType = this.classifyFeatureSafe(polygon);
                    analysis.features[featureType]++;
                    
                } catch (error) {
                    analysis.warnings.push(`Error processing polygon ${index}: ${error.message}`);
                }
            });
            
            // Determine complexity
            analysis.complexity = this.assessComplexity(analysis);
            
        } catch (error) {
            analysis.warnings.push(`Layer analysis error: ${error.message}`);
        }
        
        this.analysisCache.set(cacheKey, analysis);
        return analysis;
    }
    
    /**
     * Sample polygons to prevent memory overload
     */
    samplePolygons(polygons, maxSamples) {
        if (polygons.length <= maxSamples) {
            return polygons;
        }
        
        const samples = [];
        const step = Math.floor(polygons.length / maxSamples);
        
        for (let i = 0; i < polygons.length; i += step) {
            if (samples.length < maxSamples) {
                samples.push(polygons[i]);
            }
        }
        
        return samples;
    }
    
    /**
     * Safe polygon validation
     */
    isPolygonValid(polygon) {
        return polygon && 
               polygon.points && 
               Array.isArray(polygon.points) && 
               polygon.points.length >= 3 &&
               polygon.points.length <= this.options.maxPointsPerPolygon &&
               polygon.points.every(p => p && 
                   typeof p.x === 'number' && 
                   typeof p.y === 'number' &&
                   isFinite(p.x) && 
                   isFinite(p.y));
    }
    
    /**
     * Safe area calculation
     */
    getPolygonAreaSafe(polygon) {
        try {
            if (polygon.getArea && typeof polygon.getArea === 'function') {
                const area = polygon.getArea();
                return isFinite(area) ? area : 0;
            }
            
            // Fallback area calculation
            return this.calculatePolygonArea(polygon.points);
        } catch (error) {
            this.debug(`Error calculating polygon area: ${error.message}`);
            return 0;
        }
    }
    
    /**
     * Simple area calculation fallback
     */
    calculatePolygonArea(points) {
        if (!points || points.length < 3) return 0;
        
        let area = 0;
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            if (p1 && p2) {
                area += (p1.x * p2.y - p2.x * p1.y);
            }
        }
        
        return Math.abs(area) / 2;
    }
    
    /**
     * Safe feature classification
     */
    classifyFeatureSafe(polygon) {
        try {
            const area = this.getPolygonAreaSafe(polygon);
            const bounds = this.getPolygonBoundsSafe(polygon);
            
            if (!bounds) return 'regions';
            
            const width = bounds.maxX - bounds.minX;
            const height = bounds.maxY - bounds.minY;
            const aspectRatio = Math.max(width, height) / Math.min(width, height);
            
            // Classification logic
            if (polygon.properties && polygon.properties.type) {
                return polygon.properties.type;
            }
            
            if (area < 1.0 && aspectRatio > 3) {
                return 'traces'; // Narrow, elongated features
            } else if (area < 4.0 && aspectRatio < 2) {
                return 'pads'; // Small, roughly square features
            } else {
                return 'regions'; // Large area fills
            }
        } catch (error) {
            this.debug(`Error classifying feature: ${error.message}`);
            return 'regions'; // Default fallback
        }
    }
    
    /**
     * Safe bounds calculation
     */
    getPolygonBoundsSafe(polygon) {
        try {
            if (polygon.getBounds && typeof polygon.getBounds === 'function') {
                return polygon.getBounds();
            }
            
            // Fallback bounds calculation
            return this.calculateBounds(polygon.points);
        } catch (error) {
            this.debug(`Error getting polygon bounds: ${error.message}`);
            return null;
        }
    }
    
    /**
     * Calculate bounds from points
     */
    calculateBounds(points) {
        if (!points || points.length === 0) return null;
        
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        points.forEach(point => {
            if (point && typeof point.x === 'number' && typeof point.y === 'number') {
                minX = Math.min(minX, point.x);
                minY = Math.min(minY, point.y);
                maxX = Math.max(maxX, point.x);
                maxY = Math.max(maxY, point.y);
            }
        });
        
        if (!isFinite(minX)) return null;
        
        return { minX, minY, maxX, maxY };
    }
    
    /**
     * Useful inter-feature clearance analysis (not corner clearances)
     */
    analyzeInterFeatureClearances(polygons) {
        if (polygons.length < 2) return null;
        
        const clearanceAnalysis = {
            measurements: [],
            statistics: {
                minimum: Infinity,
                maximum: -Infinity,
                average: 0,
                count: 0
            },
            warnings: []
        };
        
        try {
            // Limit comparisons to prevent performance issues
            const maxComparisons = 100;
            const sampleSize = Math.min(polygons.length, Math.sqrt(maxComparisons));
            const step = Math.max(1, Math.floor(polygons.length / sampleSize));
            
            for (let i = 0; i < polygons.length - 1; i += step) {
                for (let j = i + step; j < polygons.length; j += step) {
                    if (clearanceAnalysis.measurements.length >= maxComparisons) break;
                    
                    const poly1 = polygons[i];
                    const poly2 = polygons[j];
                    
                    if (this.isPolygonValid(poly1) && this.isPolygonValid(poly2)) {
                        const clearance = this.calculateInterFeatureClearance(poly1, poly2);
                        
                        if (clearance !== null && clearance < 10) { // Only reasonable clearances
                            clearanceAnalysis.measurements.push({
                                distance: clearance,
                                polygon1: i,
                                polygon2: j
                            });
                            
                            clearanceAnalysis.statistics.minimum = Math.min(clearanceAnalysis.statistics.minimum, clearance);
                            clearanceAnalysis.statistics.maximum = Math.max(clearanceAnalysis.statistics.maximum, clearance);
                            clearanceAnalysis.statistics.count++;
                        }
                    }
                }
                if (clearanceAnalysis.measurements.length >= maxComparisons) break;
            }
            
            // Calculate average
            if (clearanceAnalysis.statistics.count > 0) {
                const sum = clearanceAnalysis.measurements.reduce((s, m) => s + m.distance, 0);
                clearanceAnalysis.statistics.average = sum / clearanceAnalysis.statistics.count;
            }
            
            // Generate meaningful warnings (not 0.000mm corner spam)
            if (clearanceAnalysis.statistics.minimum < 0.1 && clearanceAnalysis.statistics.minimum > 0) {
                clearanceAnalysis.warnings.push(`Tight clearance detected: ${clearanceAnalysis.statistics.minimum.toFixed(3)}mm between features`);
            }
            
        } catch (error) {
            clearanceAnalysis.warnings.push(`Clearance analysis error: ${error.message}`);
        }
        
        return clearanceAnalysis;
    }
    
    /**
     * Calculate clearance between separate features (not corner clearances)
     */
    calculateInterFeatureClearance(poly1, poly2) {
        try {
            // Quick bounding box check first
            const bounds1 = this.getPolygonBoundsSafe(poly1);
            const bounds2 = this.getPolygonBoundsSafe(poly2);
            
            if (!bounds1 || !bounds2) return null;
            
            const boundingDistance = this.boundingBoxDistance(bounds1, bounds2);
            if (boundingDistance > 5) return null; // Skip distant features
            
            // Sample-based distance calculation (limited points)
            const samples1 = this.samplePolygonPoints(poly1, 5);
            const samples2 = this.samplePolygonPoints(poly2, 5);
            
            let minDistance = Infinity;
            
            for (const p1 of samples1) {
                for (const p2 of samples2) {
                    const distance = this.distance(p1, p2);
                    minDistance = Math.min(minDistance, distance);
                }
            }
            
            return isFinite(minDistance) && minDistance > 0.001 ? minDistance : null;
        } catch (error) {
            this.debug(`Error calculating feature clearance: ${error.message}`);
            return null;
        }
    }
    
    /**
     * Sample points from polygon (limited to prevent memory issues)
     */
    samplePolygonPoints(polygon, maxPoints = 5) {
        try {
            const points = polygon.points;
            if (!points || points.length === 0) return [];
            
            if (points.length <= maxPoints) return [...points];
            
            const samples = [];
            const step = Math.floor(points.length / maxPoints);
            
            for (let i = 0; i < maxPoints; i++) {
                const index = Math.min(i * step, points.length - 1);
                if (points[index]) {
                    samples.push(points[index]);
                }
            }
            
            return samples;
        } catch (error) {
            this.debug(`Error sampling polygon points: ${error.message}`);
            return [];
        }
    }
    
    /**
     * Calculate distance between bounding boxes
     */
    boundingBoxDistance(bounds1, bounds2) {
        const dx = Math.max(0, Math.max(bounds1.minX - bounds2.maxX, bounds2.minX - bounds1.maxX));
        const dy = Math.max(0, Math.max(bounds1.minY - bounds2.maxY, bounds2.minY - bounds1.maxY));
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    /**
     * Simple distance calculation
     */
    distance(p1, p2) {
        if (!p1 || !p2 || typeof p1.x !== 'number' || typeof p1.y !== 'number' ||
            typeof p2.x !== 'number' || typeof p2.y !== 'number') {
            return Infinity;
        }
        
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    /**
     * Assess complexity based on metrics
     */
    assessComplexity(layerAnalysis) {
        const polygonCount = layerAnalysis.polygonCount;
        const featureVariety = Object.values(layerAnalysis.features).filter(count => count > 0).length;
        
        if (polygonCount > 500 || featureVariety >= 3) {
            return 'high';
        } else if (polygonCount > 100 || featureVariety >= 2) {
            return 'medium';
        } else {
            return 'low';
        }
    }
    
    /**
     * Get useful analysis summary for UI
     */
    getAnalysisSummary(operations) {
        try {
            const summary = {
                totalOperations: operations.length,
                totalPolygons: 0,
                totalHoles: 0,
                operationTypes: new Set(),
                hasErrors: false,
                clearanceInfo: null
            };
            
            operations.forEach(operation => {
                summary.operationTypes.add(operation.type);
                
                if (operation.polygons) {
                    summary.totalPolygons += operation.polygons.length;
                }
                
                if (operation.holes) {
                    summary.totalHoles += operation.holes.length;
                }
                
                if (operation.error) {
                    summary.hasErrors = true;
                }
            });
            
            summary.operationTypes = Array.from(summary.operationTypes);
            
            return summary;
        } catch (error) {
            this.debug(`Error generating analysis summary: ${error.message}`);
            return {
                totalOperations: 0,
                totalPolygons: 0,
                totalHoles: 0,
                operationTypes: [],
                hasErrors: true,
                error: error.message
            };
        }
    }
    
    /**
     * Debug logging
     */
    debug(message, data = null) {
        if (this.options.debug) {
            if (data) {
                console.log(`[GeometryAnalyzer] ${message}`, data);
            } else {
                console.log(`[GeometryAnalyzer] ${message}`);
            }
        }
    }
    
    /**
     * Clear analysis cache
     */
    clearCache() {
        this.analysisCache.clear();
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GeometryAnalyzer;
} else {
    window.GeometryAnalyzer = GeometryAnalyzer;
}