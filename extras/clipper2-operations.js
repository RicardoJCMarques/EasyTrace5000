/**
 * Clipper2 Operations Module
 * Handles all boolean operations, offsets, and path manipulations
 * Version 3.9 - Fixed tangency resolution with proper epsilon values
 */

class Clipper2Operations {
    constructor(core) {
        this.core = core;
        this.stats = new Map();
        this.tangencyResolution = {
            enabled: true,
            minOffset: -50,      // Increased from -2 to -50 (0.05 units original)
            maxOffset: 50,       // Increased from 2 to 50 (0.05 units original)
            threshold: 10,       // Increased from 3 to 10 for better detection
            strategy: 'polygon'  // 'polygon' or 'none' - stroke-level can be added later
        };
    }

    /**
     * Validate and adjust epsilon to ensure it's within Clipper2's discrimination threshold
     */
    validateEpsilon(epsilon) {
        const minViable = 10;   // Minimum 0.01 units original scale
        const maxViable = 1000; // Maximum 1.0 units original scale
        
        if (Math.abs(epsilon) < minViable) {
            this.core.debug(`Epsilon ${epsilon} below Clipper2 discrimination threshold, using ${minViable}`);
            return Math.sign(epsilon) * minViable;
        }
        if (Math.abs(epsilon) > maxViable) {
            this.core.debug(`Epsilon ${epsilon} may cause visible distortion, capping at ${maxViable}`);
            return Math.sign(epsilon) * maxViable;
        }
        return epsilon;
    }

    /**
     * Normalize path winding to counter-clockwise
     * Essential for proper boolean operations
     */
    normalizePathWinding(path) {
        if (this.core.clipper2.AreaPath64) {
            const area = this.core.clipper2.AreaPath64(path);
            if (area < 0) {
                // Negative area means clockwise, need to reverse
                if (this.core.clipper2.ReversePath64) {
                    this.core.clipper2.ReversePath64(path);
                    this.core.debug('Normalized path from CW to CCW');
                } else {
                    // Manual reverse fallback
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
     * Normalize all paths in a Paths64 collection to CCW
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
     * Detect tangencies between paths using vertex proximity
     * Returns map of path indices that have tangencies
     */
    detectTangencies(paths) {
        const tangentPaths = new Set();
        const threshold = this.tangencyResolution.threshold;
        const thresholdSq = threshold * threshold;
        
        // Build vertex map for all paths
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
        
        // Check for tangencies between different paths
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
        
        // Also check for collinear edges
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
     * Check if two edges are collinear within threshold
     */
    areEdgesCollinear(p1a, p1b, p2a, p2b, threshold) {
        // Calculate cross product to check collinearity
        const dx1 = Number(p1b.x - p1a.x);
        const dy1 = Number(p1b.y - p1a.y);
        const dx2 = Number(p2b.x - p2a.x);
        const dy2 = Number(p2b.y - p2a.y);
        
        const cross = Math.abs(dx1 * dy2 - dy1 * dx2);
        const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
        const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        
        if (len1 === 0 || len2 === 0) return false;
        
        // Normalized cross product should be near zero for collinear edges
        const normalizedCross = cross / (len1 * len2);
        
        if (normalizedCross > 0.01) return false; // Not collinear
        
        // Check if edges actually overlap
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
     * Resolve tangencies by applying micro-offsets with validation
     */
    resolveTangencies(paths, tangentPathIndices) {
        if (tangentPathIndices.size === 0) {
            return paths;
        }
        
        this.core.debug(`Resolving tangencies for ${tangentPathIndices.size} paths with micro-offsets`);
        
        const resolvedPaths = new this.core.clipper2.Paths64();
        const offsets = [];
        let totalOffset = 0;
        
        // Process each path
        for (let i = 0; i < paths.size(); i++) {
            const path = paths.get(i);
            
            if (tangentPathIndices.has(i)) {
                // Generate offset with validation
                const range = this.tangencyResolution.maxOffset - this.tangencyResolution.minOffset;
                let randomOffset = this.tangencyResolution.minOffset + Math.random() * range;
                
                // Validate epsilon
                randomOffset = this.validateEpsilon(randomOffset);
                
                offsets.push(randomOffset);
                totalOffset += randomOffset;
                
                // Apply micro-offset to resolve tangencies
                const tempPaths = new this.core.clipper2.Paths64();
                tempPaths.push_back(path);
                
                // Pass already-scaled offset value
                const offsetPath = this.offset(
                    tempPaths,
                    randomOffset,  // Already in scaled units
                    this.core.clipper2.JoinType.Round,
                    this.core.clipper2.EndType.Polygon,
                    2.0
                );
                
                // Add offset path(s) to result
                for (let j = 0; j < offsetPath.size(); j++) {
                    resolvedPaths.push_back(offsetPath.get(j));
                }
                
                this.core.debug(`Path ${i}: Applied micro-offset of ${randomOffset.toFixed(3)} units`);
                
                // Clean up
                tempPaths.delete();
                offsetPath.delete();
                
            } else {
                // Keep path as-is
                resolvedPaths.push_back(path);
            }
        }
        
        // Log average offset (should be near zero)
        if (offsets.length > 0) {
            const avgOffset = totalOffset / offsets.length;
            this.core.debug(`Average micro-offset: ${avgOffset.toFixed(4)} units`);
        }
        
        return this.core.trackObject(resolvedPaths);
    }

    /**
     * Set tangency resolution parameters with validation
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
     * Get current tangency resolution settings
     */
    getTangencyResolution() {
        return { ...this.tangencyResolution };
    }

    /**
     * Perform SELF-UNION operation with automatic tangency resolution
     */
    unionSelf(paths, fillRule = null, options = {}) {
        if (!this.core.initialized) {
            throw new Error('Clipper2 not initialized');
        }
        
        // Normalize all input paths to CCW
        this.normalizePathsWinding(paths);
        
        // Check for and resolve tangencies if enabled
        let processedPaths = paths;
        if (this.tangencyResolution.enabled && options.resolveTangencies !== false) {
            const tangentPaths = this.detectTangencies(paths);
            
            if (tangentPaths.size > 0) {
                processedPaths = this.resolveTangencies(paths, tangentPaths);
            }
        }
        
        // Use NonZero for proper merging when all paths are CCW
        fillRule = fillRule || this.core.clipper2.FillRule.NonZero;
        
        this.core.debug(`Performing SELF-UNION with FillRule.${fillRule === this.core.clipper2.FillRule.NonZero ? 'NonZero' : 'Positive'}`);
        
        const startTime = performance.now();
        
        try {
            // Check if UnionSelf64 is available
            if (this.core.clipper2.UnionSelf64) {
                const result = this.core.trackObject(
                    this.core.clipper2.UnionSelf64(processedPaths, fillRule)
                );
                
                const endTime = performance.now();
                const validation = this.core.validateResult('self-union', paths, result);
                validation.executionTime = endTime - startTime;
                validation.tangenciesResolved = processedPaths !== paths;
                this.storeOperationStats('self-union', validation);
                
                this.core.debug(`Self-union completed: ${validation.inputPaths} paths -> ${validation.outputPaths} paths`);
                
                // Clean up if we created temporary paths
                if (processedPaths !== paths) {
                    processedPaths.delete();
                }
                
                return result;
            }
            
            // Fallback: Use Union64 with empty clip
            const emptyClip = new this.core.clipper2.Paths64();
            
            let result = this.core.trackObject(
                this.core.clipper2.Union64(processedPaths, emptyClip, fillRule)
            );
            
            // If still multiple paths and we want a single merged result, try again
            if (result.size() > 1 && options.forceSingle) {
                this.core.debug('First pass resulted in multiple paths, attempting second union');
                const temp = result;
                result = this.core.trackObject(
                    this.core.clipper2.Union64(result, emptyClip, fillRule)
                );
                temp.delete();
            }
            
            const endTime = performance.now();
            
            const validation = this.core.validateResult('self-union', paths, result);
            validation.executionTime = endTime - startTime;
            validation.tangenciesResolved = processedPaths !== paths;
            
            this.storeOperationStats('self-union', validation);
            
            this.core.debug(`Self-union completed: ${validation.inputPaths} paths -> ${validation.outputPaths} paths`);
            
            // Cleanup
            emptyClip.delete();
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
     * Alternative union method using Clipper64 object for more control
     */
    unionWithClipper(paths, fillRule = null, options = {}) {
        if (!this.core.initialized) {
            throw new Error('Clipper2 not initialized');
        }
        
        // Normalize all input paths
        this.normalizePathsWinding(paths);
        
        // Handle tangencies if needed
        let processedPaths = paths;
        if (this.tangencyResolution.enabled && options.resolveTangencies !== false) {
            const tangentPaths = this.detectTangencies(paths);
            if (tangentPaths.size > 0) {
                processedPaths = this.resolveTangencies(paths, tangentPaths);
            }
        }
        
        // Use NonZero for normalized CCW paths
        fillRule = fillRule || this.core.clipper2.FillRule.NonZero;
        
        try {
            // Create Clipper64 instance
            const clipper = new this.core.clipper2.Clipper64();
            clipper.SetPreserveCollinear(false);
            
            // Add all paths as subjects
            clipper.AddSubject(processedPaths);
            
            // Execute union with empty clip
            const result = new this.core.clipper2.Paths64();
            const success = clipper.ExecutePath(
                this.core.clipper2.ClipType.Union, 
                fillRule, 
                result
            );
            
            if (!success) {
                throw new Error('Clipper64 union operation failed');
            }
            
            // Clean up
            clipper.delete();
            if (processedPaths !== paths) {
                processedPaths.delete();
            }
            
            this.core.debug(`Union with Clipper64 completed: ${result.size()} paths`);
            
            return this.core.trackObject(result);
            
        } catch (error) {
            console.error('[ERROR] Union with Clipper64 failed:', error);
            if (processedPaths !== paths) {
                processedPaths.delete();
            }
            throw error;
        }
    }

    /**
     * Perform TWO-INPUT UNION operation
     */
    union(subjectPaths, clipPaths, fillRule = null, options = {}) {
        if (!this.core.initialized) {
            throw new Error('Clipper2 not initialized');
        }
        
        // Normalize both inputs
        this.normalizePathsWinding(subjectPaths);
        this.normalizePathsWinding(clipPaths);
        
        // Combine paths for tangency detection if needed
        let processedSubjects = subjectPaths;
        let processedClips = clipPaths;
        
        if (this.tangencyResolution.enabled && options.resolveTangencies !== false) {
            // Check for tangencies in combined paths
            const combined = new this.core.clipper2.Paths64();
            for (let i = 0; i < subjectPaths.size(); i++) {
                combined.push_back(subjectPaths.get(i));
            }
            for (let i = 0; i < clipPaths.size(); i++) {
                combined.push_back(clipPaths.get(i));
            }
            
            const tangentPaths = this.detectTangencies(combined);
            
            if (tangentPaths.size > 0) {
                // Resolve tangencies on combined paths
                const resolved = this.resolveTangencies(combined, tangentPaths);
                
                // Split back into subjects and clips
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
        
        // Use NonZero for normalized paths
        fillRule = fillRule || this.core.clipper2.FillRule.NonZero;
        
        this.core.debug('Performing TWO-INPUT UNION operation');
        
        const startTime = performance.now();
        
        try {
            const result = this.core.trackObject(
                this.core.clipper2.Union64(processedSubjects, processedClips, fillRule)
            );
            
            const endTime = performance.now();
            
            // Combine inputs for validation
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
            
            // Cleanup
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
     * Perform INTERSECTION operation
     */
    intersect(subjectPaths, clipPaths, fillRule = null) {
        if (!this.core.initialized) {
            throw new Error('Clipper2 not initialized');
        }
        
        // Normalize inputs for consistent results
        this.normalizePathsWinding(subjectPaths);
        this.normalizePathsWinding(clipPaths);
        
        fillRule = fillRule || this.core.clipper2.FillRule.NonZero;
        
        this.core.debug('Performing INTERSECTION operation on normalized paths');
        
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
     * Perform DIFFERENCE operation
     */
    difference(subjectPaths, clipPaths, fillRule = null) {
        if (!this.core.initialized) {
            throw new Error('Clipper2 not initialized');
        }
        
        // Normalize inputs
        this.normalizePathsWinding(subjectPaths);
        this.normalizePathsWinding(clipPaths);
        
        fillRule = fillRule || this.core.clipper2.FillRule.NonZero;
        
        this.core.debug('Performing DIFFERENCE operation on normalized paths');
        
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
     * Perform XOR operation
     */
    xor(subjectPaths, clipPaths, fillRule = null) {
        if (!this.core.initialized) {
            throw new Error('Clipper2 not initialized');
        }
        
        // Normalize inputs
        this.normalizePathsWinding(subjectPaths);
        this.normalizePathsWinding(clipPaths);
        
        // XOR typically uses EvenOdd fill rule
        fillRule = fillRule || this.core.clipper2.FillRule.EvenOdd;
        
        this.core.debug('Performing XOR operation on normalized paths');
        
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
     * Perform OFFSET operation with scaling
     */
    offset(paths, delta, joinType = null, endType = null, miterLimit = 2.0) {
        if (!this.core.initialized) {
            throw new Error('Clipper2 not initialized');
        }
        
        const { JoinType, EndType } = this.core.clipper2;
        joinType = joinType || JoinType.Round;
        endType = endType || EndType.Polygon;
        
        // Don't scale delta if it's already in scaled units (for tangency resolution)
        const isAlreadyScaled = Math.abs(delta) > 1;
        const scaledDelta = isAlreadyScaled ? delta : delta * this.core.config.scale;
        
        this.core.debug(`Performing OFFSET: delta=${delta} (scaled=${scaledDelta}), miterLimit=${miterLimit}`);
        
        try {
            // Note: Offset operations preserve proper winding automatically
            const result = this.core.trackObject(
                this.core.clipper2.InflatePaths64(
                    paths,
                    scaledDelta,
                    joinType,
                    endType,
                    miterLimit,
                    0  // arc_tolerance (0 = use default)
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
     * Perform multiple offsets
     */
    multiOffset(paths, count, distance, joinType = null, endType = null, miterLimit = 2.0) {
        const results = [];
        
        try {
            let currentPaths = paths;
            
            for (let i = 0; i < count; i++) {
                const offsetDelta = distance * (i + 1);
                const result = this.offset(currentPaths, offsetDelta, joinType, endType, miterLimit);
                results.push(result);
            }
            
            return results;
            
        } catch (error) {
            console.error('[ERROR] Multi-offset failed:', error);
            throw error;
        }
    }

    /**
     * Simplify paths with scaling
     */
    simplify(paths, tolerance = 1.0, preserveCollinear = false) {
        if (!this.core.initialized) {
            throw new Error('Clipper2 not initialized');
        }
        
        // Scale the tolerance value
        const scaledTolerance = tolerance * this.core.config.scale;
        
        this.core.debug(`Simplifying paths with tolerance=${tolerance} (scaled=${scaledTolerance})`);
        
        try {
            const result = this.core.trackObject(
                this.core.clipper2.SimplifyPaths64(
                    paths,
                    scaledTolerance,
                    preserveCollinear
                )
            );
            
            // Count point reduction
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
     * Perform Minkowski sum
     */
    minkowskiSum(pattern, path, pathIsClosed = true) {
        if (!this.core.initialized) {
            throw new Error('Clipper2 not initialized');
        }
        
        if (!this.core.clipper2.MinkowskiSum64) {
            console.warn('[WARN] MinkowskiSum64 not available');
            return null;
        }
        
        try {
            const result = this.core.trackObject(
                this.core.clipper2.MinkowskiSum64(pattern, path, pathIsClosed)
            );
            
            this.core.debug(`Minkowski sum completed: ${result.size()} paths`);
            
            return result;
            
        } catch (error) {
            console.error('[ERROR] Minkowski sum failed:', error);
            throw error;
        }
    }

    /**
     * Perform Minkowski difference
     */
    minkowskiDiff(pattern, path, pathIsClosed = true) {
        if (!this.core.initialized) {
            throw new Error('Clipper2 not initialized');
        }
        
        if (!this.core.clipper2.MinkowskiDiff64) {
            console.warn('[WARN] MinkowskiDiff64 not available');
            return null;
        }
        
        try {
            const result = this.core.trackObject(
                this.core.clipper2.MinkowskiDiff64(pattern, path, pathIsClosed)
            );
            
            this.core.debug(`Minkowski diff completed: ${result.size()} paths`);
            
            return result;
            
        } catch (error) {
            console.error('[ERROR] Minkowski diff failed:', error);
            throw error;
        }
    }

    /**
     * Clean paths - remove duplicate points and normalize winding
     */
    cleanPaths(paths, distance = 1.414) {
        if (!this.core.initialized) {
            throw new Error('Clipper2 not initialized');
        }
        
        // First normalize winding
        this.normalizePathsWinding(paths);
        
        // Then simplify with very small tolerance
        return this.simplify(paths, distance, false);
    }

    /**
     * Count holes in paths
     */
    countHoles(paths) {
        let holes = 0;
        
        try {
            const pathsArray = this.core.pathsToArray(paths);
            holes = pathsArray.filter(p => p.orientation === 'hole').length;
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
        
        // Keep only last 100 stats per operation
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
        
        // Return all stats
        const allStats = {};
        this.stats.forEach((value, key) => {
            allStats[key] = value;
        });
        
        return allStats;
    }

    /**
     * Clear all statistics
     */
    clearStats() {
        this.stats.clear();
        this.core.debug('Operation statistics cleared');
    }

    /**
     * Perform rect clipping for lines
     */
    rectClipLines(rect, lines) {
        if (!this.core.initialized) {
            throw new Error('Clipper2 not initialized');
        }
        
        if (!this.core.clipper2.RectClipLines64) {
            console.warn('[WARN] RectClipLines64 not available');
            return null;
        }
        
        try {
            const result = this.core.trackObject(
                this.core.clipper2.RectClipLines64(rect, lines)
            );
            
            this.core.debug(`Rect clip completed: ${result.size()} paths`);
            
            return result;
            
        } catch (error) {
            console.error('[ERROR] Rect clip failed:', error);
            throw error;
        }
    }

    /**
     * Create PolyTree structure for hierarchical representation
     * Essential for proper hole detection in complex structures
     */
    executePolyTree(subjects, clips, clipType, fillRule = null) {
        if (!this.core.initialized) {
            throw new Error('Clipper2 not initialized');
        }
        
        // Normalize inputs
        this.normalizePathsWinding(subjects);
        if (clips && clips.size() > 0) {
            this.normalizePathsWinding(clips);
        }
        
        fillRule = fillRule || this.core.clipper2.FillRule.NonZero;
        
        try {
            // Check if we can use BooleanOpOut64 for PolyPath output
            if (this.core.clipper2.BooleanOpOut64) {
                const polyPath = new this.core.clipper2.PolyPath64();
                
                this.core.clipper2.BooleanOpOut64(
                    clipType,
                    fillRule,
                    subjects,
                    clips || new this.core.clipper2.Paths64(),
                    polyPath
                );
                
                this.core.debug('PolyTree operation completed using BooleanOpOut64');
                return this.core.trackObject(polyPath);
            }
            
            // Fallback: Use Clipper64 instance
            const clipper = new this.core.clipper2.Clipper64();
            clipper.SetPreserveCollinear(false);
            
            // Add paths
            clipper.AddSubject(subjects);
            if (clips && clips.size() > 0) {
                clipper.AddClip(clips);
            }
            
            // Create PolyPath result
            const polyPath = new this.core.clipper2.PolyPath64();
            
            // Execute with PolyPath output
            const success = clipper.ExecutePoly(clipType, fillRule, polyPath);
            
            if (!success) {
                throw new Error('PolyTree operation failed');
            }
            
            // Clean up clipper
            clipper.delete();
            
            this.core.debug('PolyTree operation completed using Clipper64');
            return this.core.trackObject(polyPath);
            
        } catch (error) {
            console.error('[ERROR] PolyTree operation failed:', error);
            throw error;
        }
    }

    /**
     * Analyze PolyTree structure for hole detection
     */
    analyzePolyTree(polyTree) {
        const stats = { 
            outers: 0, 
            holes: 0, 
            islands: 0,
            maxDepth: 0,
            totalPaths: 0
        };
        
        function traversePolyPath(polyPath, depth = 0, isRoot = false) {
            stats.maxDepth = Math.max(stats.maxDepth, depth);
            
            // Get polygon at this node
            const polygon = polyPath.polygon();
            if (polygon && polygon.size() > 0) {
                stats.totalPaths++;
                
                // Root level children (depth 0) are outer polygons
                // Their children (depth 1) are holes
                // Holes' children (depth 2) are islands
                if (depth === 0 && !isRoot) {
                    stats.outers++;
                } else if (depth === 1) {
                    stats.holes++;
                } else if (depth === 2) {
                    stats.islands++;
                }
            }
            
            // Traverse children
            const childCount = polyPath.count();
            for (let i = 0; i < childCount; i++) {
                const child = polyPath.child(i);
                traversePolyPath(child, isRoot ? 0 : depth + 1, false);
            }
        }
        
        // Start traversal from root
        traversePolyPath(polyTree, 0, true);
        
        this.core.debug('PolyTree analysis:', stats);
        return stats;
    }

    /**
     * Convert PolyTree to Paths64 while preserving hierarchy info
     */
    polyTreeToPaths(polyTree) {
        const paths = new this.core.clipper2.Paths64();
        const pathInfo = [];
        
        function extractPaths(polyPath, depth = 0) {
            const polygon = polyPath.polygon();
            if (polygon && polygon.size() > 0) {
                paths.push_back(polygon);
                pathInfo.push({
                    index: paths.size() - 1,
                    depth: depth,
                    type: depth % 2 === 0 ? 'outer' : 'hole',
                    childCount: polyPath.count()
                });
            }
            
            const childCount = polyPath.count();
            for (let i = 0; i < childCount; i++) {
                extractPaths(polyPath.child(i), depth + 1);
            }
        }
        
        extractPaths(polyTree);
        
        // Store path info for reference
        this.core.trackObject(paths);
        paths._polyTreeInfo = pathInfo;
        
        return paths;
    }
}