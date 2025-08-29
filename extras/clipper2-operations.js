/**
 * Clipper2 Operations Module
 * Boolean operations, offsets, and path manipulations
 * Version 5.2 - Fixed Minkowski diff, removed tangency
 */

class Clipper2Operations {
    constructor(core) {
        this.core = core;
        this.geometry = null; // Will be set by tests module
        this.stats = new Map();
        this.defaults = null; // Will be set during initialization
    }

    /**
     * Initialize with defaults reference
     */
    initialize(defaults) {
        this.defaults = defaults;
    }

    /**
     * Set geometry module reference
     */
    setGeometryModule(geometry) {
        this.geometry = geometry;
    }

    /**
     * Normalize path winding to counter-clockwise
     */
    normalizePathWinding(path) {
        if (this.core.clipper2.AreaPath64) {
            const area = this.core.clipper2.AreaPath64(path);
            if (area < 0) {
                if (this.core.clipper2.ReversePath64) {
                    this.core.clipper2.ReversePath64(path);
                    this.core.debug('Normalized path from CW to CCW');
                } else {
                    const reversed = new this.core.clipper2.Path64();
                    for (let i = path.size() - 1; i >= 0; i--) {
                        reversed.push_back(path.get(i));
                    }
                    path.clear();
                    for (let i = 0; i < reversed.size(); i++) {
                        path.push_back(reversed.get(i));
                    }
                    reversed.delete();
                    this.core.debug('Manually normalized path from CW to CCW');
                }
            }
        }
        return path;
    }

    /**
     * Normalize all paths in a Paths64 collection
     */
    normalizePathsWinding(paths) {
        let normalizedCount = 0;
        for (let i = 0; i < paths.size(); i++) {
            const path = paths.get(i);
            if (this.core.clipper2.AreaPath64) {
                const area = this.core.clipper2.AreaPath64(path);
                if (area < 0) {
                    this.normalizePathWinding(path);
                    normalizedCount++;
                }
            }
        }
        if (normalizedCount > 0) {
            this.core.debug(`Normalized ${normalizedCount} of ${paths.size()} paths to CCW`);
        }
        return paths;
    }

    /**
     * SELF-UNION operation
     */
    unionSelf(paths, fillRule = null, options = {}) {
        if (!this.core.initialized) {
            throw new Error('Clipper2 not initialized');
        }
        
        this.normalizePathsWinding(paths);
        
        fillRule = fillRule || this.core.clipper2.FillRule.NonZero;
        
        this.core.debug(`Performing SELF-UNION with FillRule.${fillRule === this.core.clipper2.FillRule.NonZero ? 'NonZero' : 'Positive'}`);
        
        const startTime = performance.now();
        
        try {
            let result;
            
            if (this.core.clipper2.UnionSelf64) {
                result = this.core.trackObject(
                    this.core.clipper2.UnionSelf64(paths, fillRule)
                );
            } else {
                // Fallback to regular Union with empty clip
                const emptyClip = new this.core.clipper2.Paths64();
                result = this.core.trackObject(
                    this.core.clipper2.Union64(paths, emptyClip, fillRule)
                );
                emptyClip.delete();
            }
            
            const endTime = performance.now();
            const validation = this.core.validateResult('self-union', paths, result);
            validation.executionTime = endTime - startTime;
            this.storeOperationStats('self-union', validation);
            
            this.core.debug(`Self-union completed: ${validation.inputPaths} paths -> ${validation.outputPaths} paths`);
            
            return result;
            
        } catch (error) {
            console.error('[ERROR] Self-union failed:', error);
            throw error;
        }
    }

    /**
     * TWO-INPUT UNION operation
     */
    union(subjectPaths, clipPaths, fillRule = null, options = {}) {
        if (!this.core.initialized) {
            throw new Error('Clipper2 not initialized');
        }
        
        this.normalizePathsWinding(subjectPaths);
        this.normalizePathsWinding(clipPaths);
        
        fillRule = fillRule || this.core.clipper2.FillRule.NonZero;
        
        this.core.debug('Performing TWO-INPUT UNION operation');
        
        const startTime = performance.now();
        
        try {
            const result = this.core.trackObject(
                this.core.clipper2.Union64(subjectPaths, clipPaths, fillRule)
            );
            
            const endTime = performance.now();
            
            const combinedInput = new this.core.clipper2.Paths64();
            for (let i = 0; i < subjectPaths.size(); i++) {
                combinedInput.push_back(subjectPaths.get(i));
            }
            for (let i = 0; i < clipPaths.size(); i++) {
                combinedInput.push_back(clipPaths.get(i));
            }
            
            const validation = this.core.validateResult('union', combinedInput, result);
            validation.executionTime = endTime - startTime;
            validation.subjectCount = subjectPaths.size();
            validation.clipCount = clipPaths.size();
            
            this.storeOperationStats('union', validation);
            
            this.core.debug(`Union completed: ${validation.subjectCount} + ${validation.clipCount} paths -> ${validation.outputPaths} paths`);
            
            combinedInput.delete();
            
            return result;
            
        } catch (error) {
            console.error('[ERROR] Union failed:', error);
            throw error;
        }
    }

    /**
     * INTERSECTION operation
     */
    intersect(subjectPaths, clipPaths, fillRule = null) {
        if (!this.core.initialized) {
            throw new Error('Clipper2 not initialized');
        }
        
        this.normalizePathsWinding(subjectPaths);
        this.normalizePathsWinding(clipPaths);
        
        fillRule = fillRule || this.core.clipper2.FillRule.NonZero;
        
        this.core.debug('Performing INTERSECTION operation');
        
        const startTime = performance.now();
        
        try {
            const result = this.core.trackObject(
                this.core.clipper2.Intersect64(subjectPaths, clipPaths, fillRule)
            );
            
            const endTime = performance.now();
            
            const validation = this.core.validateResult('intersect', subjectPaths, result);
            validation.executionTime = endTime - startTime;
            validation.clipCount = clipPaths.size();
            
            this.storeOperationStats('intersect', validation);
            
            this.core.debug(`Intersection completed: ${validation.outputPaths} overlapping regions`);
            
            return result;
            
        } catch (error) {
            console.error('[ERROR] Intersection failed:', error);
            throw error;
        }
    }

    /**
     * DIFFERENCE operation
     */
    difference(subjectPaths, clipPaths, fillRule = null) {
        if (!this.core.initialized) {
            throw new Error('Clipper2 not initialized');
        }
        
        this.normalizePathsWinding(subjectPaths);
        this.normalizePathsWinding(clipPaths);
        
        fillRule = fillRule || this.core.clipper2.FillRule.NonZero;
        
        this.core.debug('Performing DIFFERENCE operation');
        
        const startTime = performance.now();
        
        try {
            const result = this.core.trackObject(
                this.core.clipper2.Difference64(subjectPaths, clipPaths, fillRule)
            );
            
            const endTime = performance.now();
            
            const validation = this.core.validateResult('difference', subjectPaths, result);
            validation.executionTime = endTime - startTime;
            validation.holesCreated = this.countHoles(result);
            
            this.storeOperationStats('difference', validation);
            
            this.core.debug(`Difference completed: ${validation.outputPaths} paths, ${validation.holesCreated} holes`);
            
            return result;
            
        } catch (error) {
            console.error('[ERROR] Difference failed:', error);
            throw error;
        }
    }

    /**
     * XOR operation
     */
    xor(subjectPaths, clipPaths, fillRule = null) {
        if (!this.core.initialized) {
            throw new Error('Clipper2 not initialized');
        }
        
        this.normalizePathsWinding(subjectPaths);
        this.normalizePathsWinding(clipPaths);
        
        fillRule = fillRule || this.core.clipper2.FillRule.EvenOdd;
        
        this.core.debug('Performing XOR operation');
        
        const startTime = performance.now();
        
        try {
            const result = this.core.trackObject(
                this.core.clipper2.Xor64(subjectPaths, clipPaths, fillRule)
            );
            
            const endTime = performance.now();
            
            const validation = this.core.validateResult('xor', subjectPaths, result);
            validation.executionTime = endTime - startTime;
            
            this.storeOperationStats('xor', validation);
            
            this.core.debug(`XOR completed: ${validation.outputPaths} non-overlapping regions`);
            
            return result;
            
        } catch (error) {
            console.error('[ERROR] XOR failed:', error);
            throw error;
        }
    }

    /**
     * OFFSET operation
     */
    offset(paths, delta, joinType = null, endType = null, miterLimit = null) {
        if (!this.core.initialized) {
            throw new Error('Clipper2 not initialized');
        }
        
        const { JoinType, EndType } = this.core.clipper2;
        joinType = joinType || JoinType.Round;
        endType = endType || EndType.Polygon;
        miterLimit = miterLimit || this.defaults.config.miterLimit;
        
        // Delta needs to be scaled
        const scaledDelta = delta * this.defaults.config.scale;
        
        this.core.debug(`Performing OFFSET: delta=${delta} (scaled=${scaledDelta}), miterLimit=${miterLimit}`);
        
        try {
            const result = this.core.trackObject(
                this.core.clipper2.InflatePaths64(
                    paths,
                    scaledDelta,
                    joinType,
                    endType,
                    miterLimit,
                    0
                )
            );
            
            this.core.debug(`Offset completed: ${result.size()} paths`);
            
            return result;
            
        } catch (error) {
            console.error('[ERROR] Offset failed:', error);
            throw error;
        }
    }

    /**
     * Multiple offsets
     */
    multiOffset(paths, count, distance, joinType = null, endType = null, miterLimit = null) {
        const results = [];
        
        try {
            for (let i = 0; i < count; i++) {
                const offsetDelta = distance * (i + 1);
                const result = this.offset(paths, offsetDelta, joinType, endType, miterLimit);
                results.push(result);
            }
            
            return results;
            
        } catch (error) {
            console.error('[ERROR] Multi-offset failed:', error);
            throw error;
        }
    }

    /**
     * MINKOWSKI SUM operation
     * @param {Path64} pattern - The pattern shape to sweep
     * @param {Path64} path - The path to sweep the pattern along
     * @param {boolean} pathIsClosed - Whether to treat the path as closed
     * @returns {Paths64} The Minkowski sum result
     */
    minkowskiSum(pattern, path, pathIsClosed = true) {
        if (!this.core.initialized) {
            throw new Error('Clipper2 not initialized');
        }
        
        if (!this.core.clipper2.MinkowskiSum64) {
            throw new Error('MinkowskiSum64 not available in this Clipper2 build');
        }
        
        this.core.debug('Performing MINKOWSKI SUM operation');
        
        const startTime = performance.now();
        
        try {
            const result = this.core.trackObject(
                this.core.clipper2.MinkowskiSum64(pattern, path, pathIsClosed)
            );
            
            const endTime = performance.now();
            
            const validation = {
                operation: 'minkowski-sum',
                patternPoints: pattern.size(),
                pathPoints: path.size(),
                outputPaths: result.size(),
                executionTime: endTime - startTime,
                pathIsClosed: pathIsClosed
            };
            
            // Validate at least one output path
            if (result.size() === 0) {
                console.warn('[WARN] Minkowski Sum produced no output paths');
            } else {
                let totalPoints = 0;
                for (let i = 0; i < result.size(); i++) {
                    totalPoints += result.get(i).size();
                }
                validation.totalOutputPoints = totalPoints;
            }
            
            this.storeOperationStats('minkowski-sum', validation);
            
            this.core.debug(`Minkowski Sum completed: ${validation.outputPaths} path(s), ${validation.totalOutputPoints || 0} total points`);
            
            return result;
            
        } catch (error) {
            console.error('[ERROR] Minkowski Sum failed:', error);
            throw error;
        }
    }

    /**
     * MINKOWSKI DIFFERENCE operation
     * @param {Path64} pattern - The pattern shape to subtract
     * @param {Path64} path - The path to subtract the pattern from
     * @param {boolean} pathIsClosed - Whether to treat the path as closed
     * @returns {Paths64} The Minkowski difference result
     */
    minkowskiDiff(pattern, path, pathIsClosed = true) {
        if (!this.core.initialized) {
            throw new Error('Clipper2 not initialized');
        }
        
        if (!this.core.clipper2.MinkowskiDiff64) {
            throw new Error('MinkowskiDiff64 not available in this Clipper2 build');
        }
        
        this.core.debug('Performing MINKOWSKI DIFF operation');
        
        const startTime = performance.now();
        
        try {
            const result = this.core.trackObject(
                this.core.clipper2.MinkowskiDiff64(pattern, path, pathIsClosed)  // FIXED: Now correctly calls MinkowskiDiff64
            );
            
            const endTime = performance.now();
            
            const validation = {
                operation: 'minkowski-diff',
                patternPoints: pattern.size(),
                pathPoints: path.size(),
                outputPaths: result.size(),
                executionTime: endTime - startTime,
                pathIsClosed: pathIsClosed
            };
            
            // Validate at least one output path
            if (result.size() === 0) {
                console.warn('[WARN] Minkowski Diff produced no output paths');
            } else {
                let totalPoints = 0;
                for (let i = 0; i < result.size(); i++) {
                    totalPoints += result.get(i).size();
                }
                validation.totalOutputPoints = totalPoints;
            }
            
            this.storeOperationStats('minkowski-diff', validation);
            
            this.core.debug(`Minkowski Diff completed: ${validation.outputPaths} path(s), ${validation.totalOutputPoints || 0} total points`);
            
            return result;
            
        } catch (error) {
            console.error('[ERROR] Minkowski Diff failed:', error);
            throw error;
        }
    }

    /**
     * Simplify paths
     */
    simplify(paths, tolerance = 1.0, preserveCollinear = false) {
        if (!this.core.initialized) {
            throw new Error('Clipper2 not initialized');
        }
        
        const scaledTolerance = tolerance * this.defaults.config.scale;
        
        this.core.debug(`Simplifying paths with tolerance=${tolerance} (scaled=${scaledTolerance})`);
        
        try {
            const result = this.core.trackObject(
                this.core.clipper2.SimplifyPaths64(
                    paths,
                    scaledTolerance,
                    preserveCollinear
                )
            );
            
            let originalPoints = 0;
            let simplifiedPoints = 0;
            
            for (let i = 0; i < paths.size(); i++) {
                originalPoints += paths.get(i).size();
            }
            for (let i = 0; i < result.size(); i++) {
                simplifiedPoints += result.get(i).size();
            }
            
            const reduction = originalPoints > 0 ? 
                Math.round((1 - simplifiedPoints / originalPoints) * 100) : 0;
            
            this.core.debug(`Simplify completed: ${originalPoints} -> ${simplifiedPoints} points (${reduction}% reduction)`);
            
            return result;
            
        } catch (error) {
            console.error('[ERROR] Simplify failed:', error);
            throw error;
        }
    }

    /**
     * Count holes in paths
     */
    countHoles(paths) {
        let holes = 0;
        
        try {
            if (this.geometry) {
                const pathData = this.geometry.paths64ToCoordinates(paths);
                holes = pathData.filter(p => p.orientation === 'hole').length;
            }
        } catch (error) {
            console.warn('[WARN] Could not count holes:', error);
        }
        
        return holes;
    }

    /**
     * Store operation statistics
     */
    storeOperationStats(operation, stats) {
        if (!this.stats.has(operation)) {
            this.stats.set(operation, []);
        }
        
        this.stats.get(operation).push({
            timestamp: Date.now(),
            ...stats
        });
        
        const opStats = this.stats.get(operation);
        if (opStats.length > 100) {
            opStats.shift();
        }
    }

    /**
     * Get operation statistics
     */
    getOperationStats(operation = null) {
        if (operation) {
            return this.stats.get(operation) || [];
        }
        
        const allStats = {};
        this.stats.forEach((value, key) => {
            allStats[key] = value;
        });
        
        return allStats;
    }

    /**
     * Clear statistics
     */
    clearStats() {
        this.stats.clear();
        this.core.debug('Operation statistics cleared');
    }
}