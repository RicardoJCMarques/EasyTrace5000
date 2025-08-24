/**
 * Clipper2 WASM Core Module
 * Handles module initialization, state management, and memory cleanup
 * Version 3.4 - Enhanced with tangency configuration
 */

class Clipper2Core {
    constructor() {
        this.clipper2 = null;
        this.utils = null;
        this.initialized = false;
        this.testResults = new Map();
        this.memoryTracker = new Set();
        this.config = {
            polygonResolution: 64,  // Increased for smoother curves
            debugMode: false,
            autoCleanup: true,
            precision: 6,  // Decimal places for PathsD
            scale: 1000,   // Scale factor for integer precision (preserves 3 decimal places)
            // Tangency resolution configuration
            tangencyStrategy: 'polygon', // 'polygon' or 'none'
            tangencyEpsilon: 50,         // Default epsilon in scaled units (0.05 original)
            tangencyThreshold: 10,        // Detection threshold in scaled units
            validateGeometry: false,      // Enable geometry validation (performance impact)
            visualizeDebug: false         // Show debug visualizations
        };
    }

    /**
     * Initialize Clipper2 modules
     */
    async initialize() {
        if (this.initialized) return true;
        
        try {
            console.log('[INIT] Loading Clipper2 WASM modules...');
            
            // Load main module
            if (typeof Clipper2ZFactory !== 'undefined') {
                this.clipper2 = await Clipper2ZFactory();
                console.log('[OK] Clipper2 main module loaded');
            } else {
                throw new Error('Clipper2ZFactory not found - ensure clipper2z.js is loaded');
            }
            
            // Load utils if available
            if (typeof Clipper2ZUtilsFactory !== 'undefined') {
                this.utils = await Clipper2ZUtilsFactory();
                console.log('[OK] Clipper2 utils module loaded');
            } else {
                console.log('[INFO] Clipper2 utils not available - SVG operations disabled');
            }
            
            // Verify critical functions
            this.verifyFunctions();
            
            // Log configuration
            console.log('[CONFIG] Tangency resolution:', {
                strategy: this.config.tangencyStrategy,
                epsilon: this.config.tangencyEpsilon,
                threshold: this.config.tangencyThreshold
            });
            
            this.initialized = true;
            console.log('[OK] Clipper2 initialization complete');
            
            return true;
            
        } catch (error) {
            console.error('[ERROR] Failed to initialize Clipper2:', error);
            this.initialized = false;
            return false;
        }
    }

    /**
     * Verify available functions
     */
    verifyFunctions() {
        const required = ['Union64', 'Intersect64', 'Difference64', 'Xor64', 
                         'InflatePaths64', 'SimplifyPaths64'];
        
        const missing = required.filter(fn => !this.clipper2[fn]);
        
        if (missing.length > 0) {
            console.warn('[WARN] Missing functions:', missing);
        }
        
        // Check for FillRule enum
        if (!this.clipper2.FillRule) {
            throw new Error('FillRule enum not found');
        }
        
        console.log('[OK] FillRule values:', Object.keys(this.clipper2.FillRule));
        
        // Check for additional operations
        if (this.clipper2.PointInPolygon64) {
            console.log('[OK] PointInPolygon64 available');
        }
        
        if (this.clipper2.MinkowskiSum64) {
            console.log('[OK] MinkowskiSum64 available');
        }
        
        // Check for UnionSelf64
        if (this.clipper2.UnionSelf64) {
            console.log('[OK] UnionSelf64 available (optimized self-union)');
        } else {
            console.log('[INFO] UnionSelf64 not available (will use Union64 fallback)');
        }
        
        // Log available operations
        const ops = Object.keys(this.clipper2).filter(k => k.includes('64'));
        console.log('[OK] Available 64-bit operations:', ops.length);
    }

    /**
     * Track object for memory cleanup
     */
    trackObject(obj) {
        if (obj && obj.delete) {
            this.memoryTracker.add(obj);
        }
        return obj;
    }

    /**
     * Clean up tracked objects
     */
    cleanup() {
        let cleaned = 0;
        this.memoryTracker.forEach(obj => {
            try {
                if (obj && obj.delete) {
                    obj.delete();
                    cleaned++;
                }
            } catch (e) {
                console.warn('[WARN] Failed to delete object:', e);
            }
        });
        
        this.memoryTracker.clear();
        
        if (cleaned > 0) {
            console.log(`[CLEANUP] Deleted ${cleaned} objects`);
        }
        
        return cleaned;
    }

    /**
     * Debug logging with tangency info
     */
    debug(message, data = null) {
        if (this.config.debugMode) {
            // Add tangency context if relevant
            if (message.includes('tangenc') || message.includes('epsilon')) {
                const tangencyInfo = {
                    strategy: this.config.tangencyStrategy,
                    epsilon: this.config.tangencyEpsilon,
                    threshold: this.config.tangencyThreshold
                };
                console.log(`[DEBUG] ${message}`, data || '', '[TANGENCY]', tangencyInfo);
            } else if (data) {
                console.log(`[DEBUG] ${message}`, data);
            } else {
                console.log(`[DEBUG] ${message}`);
            }
        }
    }

    /**
     * Convert Path64 to array of points (with descaling)
     */
    pathToArray(path) {
        const points = [];
        const scale = this.config.scale;
        
        for (let i = 0; i < path.size(); i++) {
            const point = path.get(i);
            points.push({
                x: Number(point.x) / scale,
                y: Number(point.y) / scale,
                z: Number(point.z) // Z value doesn't need scaling
            });
        }
        
        return points;
    }

    /**
     * Convert Paths64 to array of path arrays (with descaling)
     */
    pathsToArray(paths) {
        const result = [];
        const scale = this.config.scale;
        
        for (let i = 0; i < paths.size(); i++) {
            const path = paths.get(i);
            const points = [];
            
            for (let j = 0; j < path.size(); j++) {
                const point = path.get(j);
                points.push({
                    x: Number(point.x) / scale,
                    y: Number(point.y) / scale,
                    z: Number(point.z)
                });
            }
            
            const area = this.calculateAreaFromPoints(points);
            
            result.push({
                points: points,
                area: area,
                orientation: area > 0 ? 'outer' : 'hole',
                bounds: this.getPathBounds(points)
            });
        }
        
        return result;
    }

    /**
     * Calculate area from points array (already descaled)
     */
    calculateAreaFromPoints(points) {
        let area = 0;
        const n = points.length;
        
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            area += points[i].x * points[j].y;
            area -= points[j].x * points[i].y;
        }
        
        return area / 2;
    }

    /**
     * Calculate area of a Path64 (handles scaling internally)
     */
    calculateArea(path) {
        const points = this.pathToArray(path);
        return this.calculateAreaFromPoints(points);
    }

    /**
     * Get bounding box of points
     */
    getPathBounds(points) {
        if (points.length === 0) {
            return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        }
        
        let minX = points[0].x, minY = points[0].y;
        let maxX = points[0].x, maxY = points[0].y;
        
        for (let i = 1; i < points.length; i++) {
            minX = Math.min(minX, points[i].x);
            minY = Math.min(minY, points[i].y);
            maxX = Math.max(maxX, points[i].x);
            maxY = Math.max(maxY, points[i].y);
        }
        
        return { minX, minY, maxX, maxY };
    }

    /**
     * Validate operation result with tangency info
     */
    validateResult(operation, input, output) {
        const inputPaths = input.size();
        const outputPaths = output.size();
        
        let totalInputArea = 0;
        let totalOutputArea = 0;
        let totalInputPoints = 0;
        let totalOutputPoints = 0;
        
        for (let i = 0; i < inputPaths; i++) {
            const path = input.get(i);
            totalInputArea += Math.abs(this.calculateArea(path));
            totalInputPoints += path.size();
        }
        
        for (let i = 0; i < outputPaths; i++) {
            const path = output.get(i);
            totalOutputArea += Math.abs(this.calculateArea(path));
            totalOutputPoints += path.size();
        }
        
        const validation = {
            operation: operation,
            inputPaths: inputPaths,
            outputPaths: outputPaths,
            inputPoints: totalInputPoints,
            outputPoints: totalOutputPoints,
            inputArea: totalInputArea,
            outputArea: totalOutputArea,
            areaChange: totalOutputArea - totalInputArea,
            pointReduction: totalInputPoints > 0 ? 
                (1 - totalOutputPoints / totalInputPoints) * 100 : 0,
            valid: outputPaths > 0 || operation === 'difference', // Difference can produce 0 paths
            tangencyStrategy: this.config.tangencyStrategy,
            tangencyEpsilon: this.config.tangencyEpsilon
        };
        
        if (outputPaths === 0 && operation !== 'difference') {
            console.warn(`[WARN] ${operation} produced no output paths`);
            if (this.config.tangencyStrategy === 'none') {
                console.warn('[HINT] Consider enabling tangency resolution if paths are touching');
            }
        }
        
        this.debug(`${operation} validation:`, validation);
        
        return validation;
    }

    /**
     * Create Path64 from array of points (with scaling)
     */
    createPath64FromPoints(points) {
        const path = new this.clipper2.Path64();
        const scale = this.config.scale;
        
        points.forEach(point => {
            path.push_back(new this.clipper2.Point64(
                BigInt(Math.round(point.x * scale)),
                BigInt(Math.round(point.y * scale)),
                BigInt(point.z || 0)
            ));
        });
        
        return this.trackObject(path);
    }

    /**
     * Create Paths64 from array of paths
     */
    createPaths64FromArrays(pathArrays) {
        const paths = new this.clipper2.Paths64();
        
        pathArrays.forEach(pointArray => {
            const path = this.createPath64FromPoints(pointArray);
            paths.push_back(path);
        });
        
        return this.trackObject(paths);
    }

    /**
     * Convert between coordinate systems
     */
    convertToScreenCoords(clipperPoint) {
        return {
            x: Number(clipperPoint.x) / this.config.scale,
            y: Number(clipperPoint.y) / this.config.scale
        };
    }

    /**
     * Convert from screen to Clipper coordinates
     */
    convertToClipperCoords(screenPoint) {
        return new this.clipper2.Point64(
            BigInt(Math.round(screenPoint.x * this.config.scale)),
            BigInt(Math.round(screenPoint.y * this.config.scale)),
            BigInt(0)
        );
    }

    /**
     * Check if point is in polygon
     */
    isPointInPolygon(point, polygon) {
        if (!this.clipper2.PointInPolygon64) {
            console.warn('[WARN] PointInPolygon64 not available');
            return null;
        }
        
        const clipperPoint = this.convertToClipperCoords(point);
        const result = this.clipper2.PointInPolygon64(clipperPoint, polygon);
        
        // Clean up temporary point
        clipperPoint.delete();
        
        // Return interpreted result
        // Result values: 0 = Outside, >0 = Inside, <0 = On Edge
        if (result === 0) return 'outside';
        if (result > 0) return 'inside';
        return 'edge';
    }

    /**
     * Get memory usage info
     */
    getMemoryInfo() {
        const info = {
            trackedObjects: this.memoryTracker.size,
            testResults: this.testResults.size,
            tangencyStrategy: this.config.tangencyStrategy
        };
        
        // Try to get WASM memory info if available
        if (this.clipper2 && this.clipper2.HEAP8) {
            info.wasmHeapSize = this.clipper2.HEAP8.length;
            info.wasmHeapUsed = this.clipper2.HEAP8.length - this.clipper2._malloc(1);
        }
        
        return info;
    }

    /**
     * Set configuration with tangency validation
     */
    setConfig(config) {
        // Validate tangency epsilon if provided
        if (config.tangencyEpsilon !== undefined) {
            const minEpsilon = 10;  // Minimum viable epsilon
            const maxEpsilon = 1000; // Maximum before distortion
            
            if (config.tangencyEpsilon < minEpsilon) {
                console.warn(`[CONFIG] Epsilon ${config.tangencyEpsilon} too small, using ${minEpsilon}`);
                config.tangencyEpsilon = minEpsilon;
            } else if (config.tangencyEpsilon > maxEpsilon) {
                console.warn(`[CONFIG] Epsilon ${config.tangencyEpsilon} too large, using ${maxEpsilon}`);
                config.tangencyEpsilon = maxEpsilon;
            }
        }
        
        Object.assign(this.config, config);
        
        if (config.debugMode !== undefined) {
            console.log(`[CONFIG] Debug mode ${config.debugMode ? 'enabled' : 'disabled'}`);
        }
        
        if (config.scale !== undefined) {
            console.log(`[CONFIG] Scale factor set to ${config.scale}`);
        }
        
        if (config.tangencyStrategy !== undefined) {
            console.log(`[CONFIG] Tangency strategy set to '${config.tangencyStrategy}'`);
        }
        
        if (config.tangencyEpsilon !== undefined) {
            const originalUnits = config.tangencyEpsilon / this.config.scale;
            console.log(`[CONFIG] Tangency epsilon set to ${config.tangencyEpsilon} (${originalUnits.toFixed(3)} original units)`);
        }
        
        return this.config;
    }

    /**
     * Get configuration
     */
    getConfig() {
        return { ...this.config };
    }

    /**
     * Store test result with tangency info
     */
    storeTestResult(testName, result) {
        this.testResults.set(testName, {
            timestamp: Date.now(),
            result: result,
            tangencyConfig: {
                strategy: this.config.tangencyStrategy,
                epsilon: this.config.tangencyEpsilon,
                threshold: this.config.tangencyThreshold
            }
        });
        
        // Keep only last 50 results
        if (this.testResults.size > 50) {
            const firstKey = this.testResults.keys().next().value;
            this.testResults.delete(firstKey);
        }
    }

    /**
     * Get test result
     */
    getTestResult(testName) {
        return this.testResults.get(testName);
    }

    /**
     * Clear all test results
     */
    clearTestResults() {
        this.testResults.clear();
        console.log('[CLEAR] Test results cleared');
    }

    /**
     * Perform full cleanup
     */
    destroy() {
        // Clean up tracked objects
        const cleaned = this.cleanup();
        
        // Clear test results
        this.clearTestResults();
        
        // Reset state
        this.initialized = false;
        this.clipper2 = null;
        this.utils = null;
        
        console.log(`[DESTROY] Core module destroyed, cleaned ${cleaned} objects`);
    }

    /**
     * Get tangency resolution info for debugging
     */
    getTangencyInfo() {
        return {
            strategy: this.config.tangencyStrategy,
            epsilon: this.config.tangencyEpsilon,
            epsilonOriginal: this.config.tangencyEpsilon / this.config.scale,
            threshold: this.config.tangencyThreshold,
            thresholdOriginal: this.config.tangencyThreshold / this.config.scale,
            scale: this.config.scale,
            enabled: this.config.tangencyStrategy !== 'none'
        };
    }

    /**
     * Log detailed tangency diagnostics
     */
    logTangencyDiagnostics() {
        const info = this.getTangencyInfo();
        console.group('[TANGENCY DIAGNOSTICS]');
        console.log('Strategy:', info.strategy);
        console.log('Enabled:', info.enabled);
        console.log('Epsilon (scaled):', info.epsilon);
        console.log('Epsilon (original):', info.epsilonOriginal.toFixed(4));
        console.log('Threshold (scaled):', info.threshold);
        console.log('Threshold (original):', info.thresholdOriginal.toFixed(4));
        console.log('Scale factor:', info.scale);
        console.log('Recommendation:', info.epsilon < 30 ? 'Increase epsilon for better tangency resolution' : 
                    info.epsilon > 100 ? 'Decrease epsilon to avoid distortion' : 'Settings in optimal range');
        console.groupEnd();
    }
}