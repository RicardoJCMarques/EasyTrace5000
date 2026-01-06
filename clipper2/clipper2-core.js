/**
 * @file        clipper2-core.js
 * @description Module initialization, state management, and memory cleanup
 * @author      Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 *
 * This module is part of the EasyTrace5000 Test Suite.
 * It interfaces with the Clipper2 library (Angus Johnson) via WASM (Erik Som).
 */

/*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2026 Eltryus
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
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
        const required = ['Union64', 'Intersect64', 'Difference64', 'Xor64', 'InflatePaths64', 'SimplifyPaths64'];

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
        };

        if (outputPaths === 0 && operation !== 'difference') {
            console.warn(`[WARN] ${operation} produced no output paths`);
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
}