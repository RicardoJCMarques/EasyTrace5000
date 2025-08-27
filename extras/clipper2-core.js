/**
 * Clipper2 WASM Core Module
 * Module initialization, state management, and memory cleanup
 * Version 5.0 - State-driven initialization
 */

class Clipper2Core {
    constructor() {
        this.clipper2 = null;
        this.utils = null;
        this.initialized = false;
        this.testResults = new Map();
        this.memoryTracker = new Set();
        this.defaults = Clipper2Defaults;
        this.config = { ...this.defaults.config };
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
            
            console.log('[CONFIG] Tangency resolution:', {
                strategy: this.defaults.tangency.strategy,
                epsilon: this.defaults.tangency.epsilon,
                threshold: this.defaults.tangency.threshold
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
        
        if (!this.clipper2.FillRule) {
            throw new Error('FillRule enum not found');
        }
        
        console.log('[OK] FillRule values:', Object.keys(this.clipper2.FillRule));
        
        if (this.clipper2.PointInPolygon64) {
            console.log('[OK] PointInPolygon64 available');
        }
        
        if (this.clipper2.MinkowskiSum64) {
            console.log('[OK] MinkowskiSum64 available');
        }
        
        if (this.clipper2.UnionSelf64) {
            console.log('[OK] UnionSelf64 available');
        } else {
            console.log('[INFO] UnionSelf64 not available (will use Union64 fallback)');
        }
        
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
     * Debug logging
     */
    debug(message, data = null) {
        if (this.config.debugMode) {
            if (data) {
                console.log(`[DEBUG] ${message}`, data);
            } else {
                console.log(`[DEBUG] ${message}`);
            }
        }
    }

    /**
     * Validate operation result
     */
    validateResult(operation, input, output) {
        const inputPaths = input.size();
        const outputPaths = output.size();
        
        let totalInputArea = 0;
        let totalOutputArea = 0;
        let totalInputPoints = 0;
        let totalOutputPoints = 0;
        
        // Calculate simple metrics
        for (let i = 0; i < inputPaths; i++) {
            const path = input.get(i);
            totalInputPoints += path.size();
            if (this.clipper2.AreaPath64) {
                totalInputArea += Math.abs(this.clipper2.AreaPath64(path));
            }
        }
        
        for (let i = 0; i < outputPaths; i++) {
            const path = output.get(i);
            totalOutputPoints += path.size();
            if (this.clipper2.AreaPath64) {
                totalOutputArea += Math.abs(this.clipper2.AreaPath64(path));
            }
        }
        
        const validation = {
            operation: operation,
            inputPaths: inputPaths,
            outputPaths: outputPaths,
            inputPoints: totalInputPoints,
            outputPoints: totalOutputPoints,
            inputArea: totalInputArea / (this.config.scale * this.config.scale),
            outputArea: totalOutputArea / (this.config.scale * this.config.scale),
            areaChange: (totalOutputArea - totalInputArea) / (this.config.scale * this.config.scale),
            pointReduction: totalInputPoints > 0 ? 
                (1 - totalOutputPoints / totalInputPoints) * 100 : 0,
            valid: outputPaths > 0 || operation === 'difference',
            tangencyStrategy: this.defaults.tangency.strategy,
            tangencyEpsilon: this.defaults.tangency.epsilon
        };
        
        if (outputPaths === 0 && operation !== 'difference') {
            console.warn(`[WARN] ${operation} produced no output paths`);
            if (this.defaults.tangency.strategy === 'none') {
                console.warn('[HINT] Consider enabling tangency resolution if paths are touching');
            }
        }
        
        this.debug(`${operation} validation:`, validation);
        
        return validation;
    }

    /**
     * Get memory usage info
     */
    getMemoryInfo() {
        const info = {
            trackedObjects: this.memoryTracker.size,
            testResults: this.testResults.size,
            tangencyStrategy: this.defaults.tangency.strategy
        };
        
        if (this.clipper2 && this.clipper2.HEAP8) {
            info.wasmHeapSize = this.clipper2.HEAP8.length;
            info.wasmHeapUsed = this.clipper2.HEAP8.length - this.clipper2._malloc(1);
        }
        
        return info;
    }

    /**
     * Set configuration
     */
    setConfig(config) {
        if (config.tangencyEpsilon !== undefined) {
            const minEpsilon = 10;
            const maxEpsilon = 1000;
            
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
        
        return this.config;
    }

    /**
     * Get configuration
     */
    getConfig() {
        return { ...this.config };
    }

    /**
     * Store test result
     */
    storeTestResult(testName, result) {
        this.testResults.set(testName, {
            timestamp: Date.now(),
            result: result,
            tangencyConfig: {
                strategy: this.defaults.tangency.strategy,
                epsilon: this.defaults.tangency.epsilon,
                threshold: this.defaults.tangency.threshold
            }
        });
        
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
     * Clear test results
     */
    clearTestResults() {
        this.testResults.clear();
        console.log('[CLEAR] Test results cleared');
    }

    /**
     * Perform full cleanup
     */
    destroy() {
        const cleaned = this.cleanup();
        this.clearTestResults();
        this.initialized = false;
        this.clipper2 = null;
        this.utils = null;
        
        console.log(`[DESTROY] Core module destroyed, cleaned ${cleaned} objects`);
    }

    /**
     * Get tangency info
     */
    getTangencyInfo() {
        return {
            strategy: this.defaults.tangency.strategy,
            epsilon: this.defaults.tangency.epsilon,
            epsilonOriginal: this.defaults.tangency.epsilon / this.config.scale,
            threshold: this.defaults.tangency.threshold,
            thresholdOriginal: this.defaults.tangency.threshold / this.config.scale,
            scale: this.config.scale,
            enabled: this.defaults.tangency.enabled
        };
    }

    /**
     * Log tangency diagnostics
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