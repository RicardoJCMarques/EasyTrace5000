/**
 * Clipper2 Operations Module
 * Boolean operations, offsets, and path manipulations
 * Version 5.0 - Compatible with state-driven architecture
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
        // Apply tangency settings from defaults
        this.tangencyResolution = {
            enabled: this.defaults.tangency.enabled,
            minOffset: -this.defaults.tangency.epsilon,
            maxOffset: this.defaults.tangency.epsilon,
            threshold: this.defaults.tangency.threshold,
            strategy: this.defaults.tangency.strategy
        };
    }

    /**
     * Set geometry module reference
     */
    setGeometryModule(geometry) {
        this.geometry = geometry;
    }

    /**
     * Validate and adjust epsilon based on defaults
     */
    validateEpsilon(epsilon) {
        const minViable = 10;
        const maxViable = 1000;
        
        if (Math.abs(epsilon) < minViable) {
            this.core.debug(`Epsilon ${epsilon} below threshold, using ${minViable}`);
            return Math.sign(epsilon) * minViable;
        }
        if (Math.abs(epsilon) > maxViable) {
            this.core.debug(`Epsilon ${epsilon} may cause distortion, capping at ${maxViable}`);
            return Math.sign(epsilon) * maxViable;
        }
        return epsilon;
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
     * Detect tangencies between paths
     */
    detectTangencies(paths) {
        const tangentPaths = new Set();
        const threshold = this.tangencyResolution.threshold;
        const thresholdSq = threshold * threshold;
        
        const vertices = [];
        for (let pathIdx = 0; pathIdx < paths.size(); pathIdx++) {
            const path = paths.get(pathIdx);
            for (let ptIdx = 0; ptIdx < path.size(); ptIdx++) {
                const pt = path.get(ptIdx);
                vertices.push({
                    x: Number(pt.x),
                    y: Number(pt.y),
                    pathIdx: pathIdx,
                    ptIdx: ptIdx
                });
            }
        }
        
        // Check for close vertices
        for (let i = 0; i < vertices.length; i++) {
            for (let j = i + 1; j < vertices.length; j++) {
                if (vertices[i].pathIdx === vertices[j].pathIdx) continue;
                
                const dx = vertices[i].x - vertices[j].x;
                const dy = vertices[i].y - vertices[j].y;
                const distSq = dx * dx + dy * dy;
                
                if (distSq <= thresholdSq) {
                    tangentPaths.add(vertices[i].pathIdx);
                    tangentPaths.add(vertices[j].pathIdx);
                }
            }
        }
        
        // Check for collinear edges
        for (let i = 0; i < paths.size(); i++) {
            const path1 = paths.get(i);
            for (let j = i + 1; j < paths.size(); j++) {
                const path2 = paths.get(j);
                if (this.hasCollinearEdges(path1, path2, threshold)) {
                    tangentPaths.add(i);
                    tangentPaths.add(j);
                }
            }
        }
        
        if (tangentPaths.size > 0) {
            this.core.debug(`Detected tangencies in ${tangentPaths.size} paths`);
        }
        
        return tangentPaths;
    }

    /**
     * Check if two paths have collinear edges
     */
    hasCollinearEdges(path1, path2, threshold) {
        for (let i = 0; i < path1.size(); i++) {
            const p1a = path1.get(i);
            const p1b = path1.get((i + 1) % path1.size());
            
            for (let j = 0; j < path2.size(); j++) {
                const p2a = path2.get(j);
                const p2b = path2.get((j + 1) % path2.size());
                
                if (this.areEdgesCollinear(p1a, p1b, p2a, p2b, threshold)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Check if two edges are collinear
     */
    areEdgesCollinear(p1a, p1b, p2a, p2b, threshold) {
        const dx1 = Number(p1b.x - p1a.x);
        const dy1 = Number(p1b.y - p1a.y);
        const dx2 = Number(p2b.x - p2a.x);
        const dy2 = Number(p2b.y - p2a.y);
        
        const cross = Math.abs(dx1 * dy2 - dy1 * dx2);
        const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
        const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        
        if (len1 === 0 || len2 === 0) return false;
        
        const normalizedCross = cross / (len1 * len2);
        
        if (normalizedCross > 0.01) return false;
        
        return this.doEdgesOverlap(p1a, p1b, p2a, p2b, threshold);
    }

    /**
     * Check if two collinear edges overlap
     */
    doEdgesOverlap(p1a, p1b, p2a, p2b, threshold) {
        const x1min = Math.min(Number(p1a.x), Number(p1b.x)) - threshold;
        const x1max = Math.max(Number(p1a.x), Number(p1b.x)) + threshold;
        const y1min = Math.min(Number(p1a.y), Number(p1b.y)) - threshold;
        const y1max = Math.max(Number(p1a.y), Number(p1b.y)) + threshold;
        
        const x2min = Math.min(Number(p2a.x), Number(p2b.x));
        const x2max = Math.max(Number(p2a.x), Number(p2b.x));
        const y2min = Math.min(Number(p2a.y), Number(p2b.y));
        const y2max = Math.max(Number(p2a.y), Number(p2b.y));
        
        return !(x1max < x2min || x2max < x1min || y1max < y2min || y2max < y1min);
    }

    /**
     * Resolve tangencies by applying micro-offsets
     */
    resolveTangencies(paths, tangentPathIndices) {
        if (tangentPathIndices.size === 0) {
            return paths;
        }
        
        this.core.debug(`Resolving tangencies for ${tangentPathIndices.size} paths`);
        
        const resolvedPaths = new this.core.clipper2.Paths64();
        const offsets = [];
        let totalOffset = 0;
        
        for (let i = 0; i < paths.size(); i++) {
            const path = paths.get(i);
            
            if (tangentPathIndices.has(i)) {
                const range = this.tangencyResolution.maxOffset - this.tangencyResolution.minOffset;
                let randomOffset = this.tangencyResolution.minOffset + Math.random() * range;
                randomOffset = this.validateEpsilon(randomOffset);
                
                offsets.push(randomOffset);
                totalOffset += randomOffset;
                
                const tempPaths = new this.core.clipper2.Paths64();
                tempPaths.push_back(path);
                
                const offsetPath = this.offset(
                    tempPaths,
                    randomOffset,
                    this.core.clipper2.JoinType.Round,
                    this.core.clipper2.EndType.Polygon,
                    this.defaults.config.miterLimit
                );
                
                for (let j = 0; j < offsetPath.size(); j++) {
                    resolvedPaths.push_back(offsetPath.get(j));
                }
                
                this.core.debug(`Path ${i}: Applied micro-offset of ${randomOffset.toFixed(3)} units`);
                
                tempPaths.delete();
                offsetPath.delete();
                
            } else {
                resolvedPaths.push_back(path);
            }
        }
        
        if (offsets.length > 0) {
            const avgOffset = totalOffset / offsets.length;
            this.core.debug(`Average micro-offset: ${avgOffset.toFixed(4)} units`);
        }
        
        return this.core.trackObject(resolvedPaths);
    }

    /**
     * Set tangency resolution parameters
     */
    setTangencyResolution(settings) {
        if (settings.minOffset !== undefined) {
            settings.minOffset = this.validateEpsilon(settings.minOffset);
        }
        if (settings.maxOffset !== undefined) {
            settings.maxOffset = this.validateEpsilon(settings.maxOffset);
        }
        
        Object.assign(this.tangencyResolution, settings);
        this.core.debug('Tangency resolution settings updated:', this.tangencyResolution);
    }

    /**
     * Get tangency resolution settings
     */
    getTangencyResolution() {
        return { ...this.tangencyResolution };
    }

    /**
     * SELF-UNION operation with tangency resolution
     */
    unionSelf(paths, fillRule = null, options = {}) {
        if (!this.core.initialized) {
            throw new Error('Clipper2 not initialized');
        }
        
        this.normalizePathsWinding(paths);
        
        let processedPaths = paths;
        if (this.tangencyResolution.enabled && options.resolveTangencies !== false) {
            const tangentPaths = this.detectTangencies(paths);
            
            if (tangentPaths.size > 0) {
                processedPaths = this.resolveTangencies(paths, tangentPaths);
            }
        }
        
        fillRule = fillRule || this.core.clipper2.FillRule.NonZero;
        
        this.core.debug(`Performing SELF-UNION with FillRule.${fillRule === this.core.clipper2.FillRule.NonZero ? 'NonZero' : 'Positive'}`);
        
        const startTime = performance.now();
        
        try {
            let result;
            
            if (this.core.clipper2.UnionSelf64) {
                result = this.core.trackObject(
                    this.core.clipper2.UnionSelf64(processedPaths, fillRule)
                );
            } else {
                // Fallback to regular Union with empty clip
                const emptyClip = new this.core.clipper2.Paths64();
                result = this.core.trackObject(
                    this.core.clipper2.Union64(processedPaths, emptyClip, fillRule)
                );
                emptyClip.delete();
            }
            
            const endTime = performance.now();
            const validation = this.core.validateResult('self-union', paths, result);
            validation.executionTime = endTime - startTime;
            validation.tangenciesResolved = processedPaths !== paths;
            this.storeOperationStats('self-union', validation);
            
            this.core.debug(`Self-union completed: ${validation.inputPaths} paths -> ${validation.outputPaths} paths`);
            
            if (processedPaths !== paths) {
                processedPaths.delete();
            }
            
            return result;
            
        } catch (error) {
            console.error('[ERROR] Self-union failed:', error);
            if (processedPaths !== paths) {
                processedPaths.delete();
            }
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
        
        let processedSubjects = subjectPaths;
        let processedClips = clipPaths;
        
        if (this.tangencyResolution.enabled && options.resolveTangencies !== false) {
            const combined = new this.core.clipper2.Paths64();
            for (let i = 0; i < subjectPaths.size(); i++) {
                combined.push_back(subjectPaths.get(i));
            }
            for (let i = 0; i < clipPaths.size(); i++) {
                combined.push_back(clipPaths.get(i));
            }
            
            const tangentPaths = this.detectTangencies(combined);
            
            if (tangentPaths.size > 0) {
                const resolved = this.resolveTangencies(combined, tangentPaths);
                
                processedSubjects = new this.core.clipper2.Paths64();
                processedClips = new this.core.clipper2.Paths64();
                
                for (let i = 0; i < subjectPaths.size(); i++) {
                    processedSubjects.push_back(resolved.get(i));
                }
                for (let i = 0; i < clipPaths.size(); i++) {
                    processedClips.push_back(resolved.get(subjectPaths.size() + i));
                }
                
                combined.delete();
                resolved.delete();
            } else {
                combined.delete();
            }
        }
        
        fillRule = fillRule || this.core.clipper2.FillRule.NonZero;
        
        this.core.debug('Performing TWO-INPUT UNION operation');
        
        const startTime = performance.now();
        
        try {
            const result = this.core.trackObject(
                this.core.clipper2.Union64(processedSubjects, processedClips, fillRule)
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
            validation.tangenciesResolved = processedSubjects !== subjectPaths;
            
            this.storeOperationStats('union', validation);
            
            this.core.debug(`Union completed: ${validation.subjectCount} + ${validation.clipCount} paths -> ${validation.outputPaths} paths`);
            
            combinedInput.delete();
            if (processedSubjects !== subjectPaths) {
                processedSubjects.delete();
            }
            if (processedClips !== clipPaths) {
                processedClips.delete();
            }
            
            return result;
            
        } catch (error) {
            console.error('[ERROR] Union failed:', error);
            if (processedSubjects !== subjectPaths) {
                processedSubjects.delete();
            }
            if (processedClips !== clipPaths) {
                processedClips.delete();
            }
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