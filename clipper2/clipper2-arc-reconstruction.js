/**
 * Clipper2 Arc Reconstruction Module
 * Demonstrates metadata preservation through boolean operations
 * and reconstruction of analytic curves from tessellated results
 * Version 2.2 - Removed thresholds, 2 points + center is enough
 */

class CurveRegistry {
    constructor() {
        this.curves = new Map();
        this.nextId = 1;
        this.debug = false;
    }
    
    register(curveData) {
        const id = this.nextId++;
        this.curves.set(id, {
            id: id,
            type: curveData.type,
            center: { ...curveData.center },
            radius: curveData.radius,
            startAngle: curveData.startAngle,
            endAngle: curveData.endAngle,
            clockwise: curveData.clockwise || false,
            source: curveData.source || 'unknown',
            originalPointCount: curveData.originalPointCount || 0
        });
        
        if (this.debug) {
            console.log(`[CurveRegistry] Registered ${curveData.type} with ID ${id}, center (${curveData.center.x}, ${curveData.center.y}), radius ${curveData.radius}`);
        }
        
        return id;
    }
    
    getCurve(id) {
        return this.curves.get(id);
    }
    
    clear() {
        this.curves.clear();
        this.nextId = 1;
    }
    
    getStats() {
        return {
            registrySize: this.curves.size,
            nextId: this.nextId
        };
    }
}

class ArcReconstructor {
    constructor(core, geometry, defaults) {
        this.core = core;
        this.geometry = geometry;
        this.defaults = defaults;
        this.registry = new CurveRegistry();
        
        // Statistics
        this.stats = {
            inputCurves: 0,
            curveGroups: 0,
            reconstructedCurves: 0,
            fullCircles: 0,
            partialArcs: 0,
            totalPointsProcessed: 0,
            survivingPoints: 0
        };
    }
    
    /**
     * Pack metadata into Z coordinate - More robust packing
     */
    packMetadata(curveId, segmentIndex = 0) {
        if (!curveId || curveId === 0) return BigInt(0);
        
        // Use higher bits for curve ID to preserve through operations
        // Lower bits for segment index
        const packed = (BigInt(curveId) << 32n) | BigInt(segmentIndex & 0xFFFFFFFF);
        return packed;
    }
    
    /**
     * Unpack metadata from Z coordinate
     */
    unpackMetadata(z) {
        if (!z || z === 0n) {
            return { curveId: 0, segmentIndex: 0 };
        }
        
        const zBigInt = typeof z === 'bigint' ? z : BigInt(z);
        const curveId = Number((zBigInt >> 32n) & 0xFFFFFFFFn);
        const segmentIndex = Number(zBigInt & 0xFFFFFFFFn);
        
        return { curveId, segmentIndex };
    }
    
    /**
     * Pre-process shapes: tessellate and tag with metadata
     */
    preprocessShapes(shapes) {
        const taggedPaths = [];
        this.stats.inputCurves = 0;
        
        shapes.forEach((shape, shapeIndex) => {
            if (shape.type === 'circle') {
                // Increased segments for better metadata survival
                const segments = 128; // Increased from 96
                const curveId = this.registry.register({
                    type: 'circle',
                    center: shape.center,
                    radius: shape.radius,
                    source: `shape${shapeIndex}`,
                    originalPointCount: segments + 1
                });
                
                this.stats.inputCurves++;
                
                // Tessellate with metadata
                const points = [];
                
                for (let i = 0; i <= segments; i++) {
                    const angle = (i / segments) * 2 * Math.PI;
                    points.push({
                        x: shape.center.x + shape.radius * Math.cos(angle),
                        y: shape.center.y + shape.radius * Math.sin(angle),
                        curveId: curveId,
                        segmentIndex: i
                    });
                }
                
                taggedPaths.push({ 
                    points, 
                    curveId, 
                    originalShape: shape,
                    shapeIndex 
                });
                
                console.log(`[ArcReconstructor] Preprocessed circle ${curveId} (shape ${shapeIndex}): ${points.length} points at (${shape.center.x}, ${shape.center.y}) r=${shape.radius}`);
                
            } else if (shape.type === 'arc') {
                const angleSpan = shape.endAngle - shape.startAngle;
                const segments = Math.max(32, Math.ceil(Math.abs(angleSpan) * 64 / Math.PI));
                
                const curveId = this.registry.register({
                    type: 'arc',
                    center: shape.center,
                    radius: shape.radius,
                    startAngle: shape.startAngle,
                    endAngle: shape.endAngle,
                    clockwise: shape.clockwise,
                    source: `shape${shapeIndex}`,
                    originalPointCount: segments + 1
                });
                
                this.stats.inputCurves++;
                
                // Tessellate with metadata
                const points = [];
                
                for (let i = 0; i <= segments; i++) {
                    const t = i / segments;
                    const angle = shape.startAngle + angleSpan * t;
                    points.push({
                        x: shape.center.x + shape.radius * Math.cos(angle),
                        y: shape.center.y + shape.radius * Math.sin(angle),
                        curveId: curveId,
                        segmentIndex: i
                    });
                }
                
                taggedPaths.push({ 
                    points, 
                    curveId, 
                    originalShape: shape,
                    shapeIndex 
                });
                
                console.log(`[ArcReconstructor] Preprocessed arc ${curveId} (shape ${shapeIndex}): ${points.length} points`);
                
            } else if (shape.type === 'polygon') {
                // Regular polygon, no curve metadata
                taggedPaths.push({ 
                    points: shape.points || shape.data, 
                    curveId: 0,
                    shapeIndex 
                });
            }
        });
        
        return taggedPaths;
    }
    
    /**
     * Convert tagged paths to Clipper2 format with Z metadata
     */
    toClipper2Paths(taggedPaths) {
        const paths = new this.core.clipper2.Paths64();
        const scale = this.defaults.config.scale;
        
        taggedPaths.forEach(({ points, curveId }) => {
            const path = new this.core.clipper2.Path64();
            
            points.forEach((point, idx) => {
                const x = BigInt(Math.round(point.x * scale));
                const y = BigInt(Math.round(point.y * scale));
                const z = point.curveId ? this.packMetadata(point.curveId, point.segmentIndex || idx) : BigInt(0);
                
                path.push_back(new this.core.clipper2.Point64(x, y, z));
            });
            
            paths.push_back(path);
        });
        
        console.log(`[ArcReconstructor] Created ${paths.size()} Clipper2 paths with metadata`);
        
        return paths;
    }
    
    /**
     * Extract and group points by curve ID from result paths
     */
    extractCurveGroups(paths) {
        const groups = new Map();
        const scale = this.defaults.config.scale;
        let totalPoints = 0;
        let taggedPoints = 0;
        
        // Iterate through result paths
        for (let i = 0; i < paths.size(); i++) {
            const path = paths.get(i);
            
            for (let j = 0; j < path.size(); j++) {
                const pt = path.get(j);
                totalPoints++;
                
                const point = {
                    x: Number(pt.x) / scale,
                    y: Number(pt.y) / scale
                };
                
                // Check if point has metadata
                if (pt.z && pt.z !== 0n) {
                    const metadata = this.unpackMetadata(pt.z);
                    
                    if (metadata.curveId > 0) {
                        taggedPoints++;
                        
                        if (!groups.has(metadata.curveId)) {
                            groups.set(metadata.curveId, []);
                        }
                        
                        groups.get(metadata.curveId).push({
                            ...point,
                            segmentIndex: metadata.segmentIndex,
                            pathIndex: i,
                            pointIndex: j
                        });
                    }
                }
            }
        }
        
        this.stats.curveGroups = groups.size;
        this.stats.totalPointsProcessed = totalPoints;
        this.stats.survivingPoints = taggedPoints;
        
        console.log(`[ArcReconstructor] Extracted ${groups.size} curve groups from ${totalPoints} points (${taggedPoints} tagged)`);
        
        // Log details for each group
        groups.forEach((points, curveId) => {
            const curve = this.registry.getCurve(curveId);
            if (curve) {
                const coverage = curve.originalPointCount > 0 ? 
                    (points.length / curve.originalPointCount * 100).toFixed(1) : 0;
                console.log(`  Curve ${curveId} (${curve.source}): ${points.length} points (${coverage}% of original)`);
            }
        });
        
        return groups;
    }
    
    /**
     * Reconstruct curves from grouped points - NO THRESHOLDS
     * 2 points + center is enough to define an arc
     */
    reconstructCurves(groups) {
        const reconstructed = [];
        this.stats.reconstructedCurves = 0;
        this.stats.fullCircles = 0;
        this.stats.partialArcs = 0;
        
        groups.forEach((points, curveId) => {
            const curveData = this.registry.getCurve(curveId);
            if (!curveData) {
                console.warn(`[ArcReconstructor] No registry entry for curve ${curveId}`);
                return;
            }
            
            // Sort points by segment index to maintain order
            points.sort((a, b) => a.segmentIndex - b.segmentIndex);
            
            console.log(`[ArcReconstructor] Reconstructing curve ${curveId} (${curveData.type}) from ${points.length} points`);
            
            // NO MINIMUM - even 2 points is enough with the center
            if (points.length < 2) {
                console.log(`  Skipping - only ${points.length} point(s), need at least 2`);
                return;
            }
            
            if (curveData.type === 'circle') {
                // Check if we have ALL points (full circle) or partial (arc)
                const isFullCircle = points.length >= curveData.originalPointCount - 1; // Allow for minor loss
                
                if (isFullCircle) {
                    // Full circle reconstruction
                    reconstructed.push({
                        type: 'circle',
                        center: curveData.center,
                        radius: curveData.radius,
                        reconstructed: true,
                        coverage: points.length / curveData.originalPointCount,
                        pointCount: points.length,
                        source: curveData.source
                    });
                    this.stats.fullCircles++;
                    this.stats.reconstructedCurves++;
                    console.log(`  Reconstructed as full circle (${points.length}/${curveData.originalPointCount} points)`);
                } else {
                    // Partial arc - reconstruct from ANY number of points >= 2
                    // Get the actual geometric span of points
                    const angles = points.map(p => {
                        return Math.atan2(
                            p.y - curveData.center.y,
                            p.x - curveData.center.x
                        );
                    });
                    
                    // Normalize angles to [0, 2π]
                    const normalizedAngles = angles.map(a => {
                        let normalized = a;
                        while (normalized < 0) normalized += Math.PI * 2;
                        while (normalized >= Math.PI * 2) normalized -= Math.PI * 2;
                        return normalized;
                    });
                    
                    // Sort angles to find the span
                    normalizedAngles.sort((a, b) => a - b);
                    
                    // Find the largest gap between consecutive angles
                    let maxGap = 0;
                    let gapStart = 0;
                    
                    for (let i = 0; i < normalizedAngles.length; i++) {
                        const current = normalizedAngles[i];
                        const next = normalizedAngles[(i + 1) % normalizedAngles.length];
                        
                        let gap;
                        if (i === normalizedAngles.length - 1) {
                            // Gap wrapping around from last to first
                            gap = (normalizedAngles[0] + Math.PI * 2) - current;
                        } else {
                            gap = next - current;
                        }
                        
                        if (gap > maxGap) {
                            maxGap = gap;
                            gapStart = (i + 1) % normalizedAngles.length;
                        }
                    }
                    
                    // Arc starts from the point after the largest gap
                    const startAngle = normalizedAngles[gapStart];
                    const endAngle = normalizedAngles[(gapStart + normalizedAngles.length - 1) % normalizedAngles.length];
                    
                    // Adjust for wrap-around
                    let adjustedEnd = endAngle;
                    if (endAngle < startAngle) {
                        adjustedEnd = endAngle + Math.PI * 2;
                    }
                    
                    reconstructed.push({
                        type: 'arc',
                        center: curveData.center,
                        radius: curveData.radius,
                        startAngle: startAngle,
                        endAngle: adjustedEnd,
                        clockwise: false,
                        reconstructed: true,
                        pointCount: points.length,
                        coverage: points.length / curveData.originalPointCount,
                        source: curveData.source
                    });
                    this.stats.partialArcs++;
                    this.stats.reconstructedCurves++;
                    console.log(`  Reconstructed as arc from ${(startAngle * 180 / Math.PI).toFixed(1)}° to ${(adjustedEnd * 180 / Math.PI).toFixed(1)}° (${points.length} points)`);
                }
            } else if (curveData.type === 'arc') {
                // Reconstruct arc segment - NO MINIMUM
                const arc = this.fitArcToPoints(points, curveData);
                if (arc) {
                    reconstructed.push(arc);
                    this.stats.partialArcs++;
                    this.stats.reconstructedCurves++;
                    console.log(`  Reconstructed arc`);
                }
            }
        });
        
        console.log(`[ArcReconstructor] Reconstructed ${reconstructed.length} curves (${this.stats.fullCircles} circles, ${this.stats.partialArcs} arcs)`);
        
        return reconstructed;
    }
    
    /**
     * Fit an arc to a sequence of points
     */
    fitArcToPoints(points, curveData) {
        if (points.length < 2) return null;
        
        // Use first and last points to determine arc span
        const startPoint = points[0];
        const endPoint = points[points.length - 1];
        
        const startAngle = Math.atan2(
            startPoint.y - curveData.center.y,
            startPoint.x - curveData.center.x
        );
        const endAngle = Math.atan2(
            endPoint.y - curveData.center.y,
            endPoint.x - curveData.center.x
        );
        
        return {
            type: 'arc',
            center: curveData.center,
            radius: curveData.radius,
            startAngle: startAngle,
            endAngle: endAngle,
            clockwise: curveData.clockwise,
            reconstructed: true,
            pointCount: points.length,
            coverage: curveData.originalPointCount > 0 ? 
                points.length / curveData.originalPointCount : 0,
            source: curveData.source
        };
    }
    
    /**
     * Draw reconstructed curves with highlighting
     */
    drawReconstructedCurves(curves, canvas, style = {}) {
        const ctx = canvas.getContext('2d');
        
        ctx.save();
        
        ctx.strokeStyle = style.strokeColor || '#ff9900';
        ctx.lineWidth = style.lineWidth || 3;
        ctx.fillStyle = style.fillColor || 'rgba(255, 153, 0, 0.2)';
        ctx.setLineDash(style.lineDash || []);
        
        curves.forEach(curve => {
            if (curve.type === 'circle') {
                ctx.beginPath();
                ctx.arc(curve.center.x, curve.center.y, curve.radius, 0, 2 * Math.PI);
                if (style.fill) ctx.fill();
                ctx.stroke();
                
                // Add marker at 0° to show it's reconstructed
                ctx.beginPath();
                ctx.arc(curve.center.x + curve.radius, curve.center.y, 4, 0, 2 * Math.PI);
                ctx.fillStyle = '#ff9900';
                ctx.fill();
                
            } else if (curve.type === 'arc') {
                ctx.beginPath();
                
                // Draw the arc properly handling angle ranges
                let startAngle = curve.startAngle;
                let endAngle = curve.endAngle;
                
                // Ensure we draw the arc in the correct direction
                if (endAngle < startAngle) {
                    ctx.arc(
                        curve.center.x, 
                        curve.center.y, 
                        curve.radius, 
                        startAngle, 
                        endAngle + Math.PI * 2, 
                        false
                    );
                } else {
                    ctx.arc(
                        curve.center.x, 
                        curve.center.y, 
                        curve.radius, 
                        startAngle, 
                        endAngle, 
                        false
                    );
                }
                
                ctx.stroke();
                
                // Add markers at endpoints
                const startX = curve.center.x + curve.radius * Math.cos(curve.startAngle);
                const startY = curve.center.y + curve.radius * Math.sin(curve.startAngle);
                const endX = curve.center.x + curve.radius * Math.cos(curve.endAngle);
                const endY = curve.center.y + curve.radius * Math.sin(curve.endAngle);
                
                ctx.beginPath();
                ctx.arc(startX, startY, 4, 0, 2 * Math.PI);
                ctx.fillStyle = '#00ff00';
                ctx.fill();
                
                ctx.beginPath();
                ctx.arc(endX, endY, 4, 0, 2 * Math.PI);
                ctx.fillStyle = '#ff0000';
                ctx.fill();
            }
        });
        
        ctx.restore();
    }
    
    /**
     * Main reconstruction pipeline - Enhanced for different operations
     */
    processWithReconstruction(shapes, operation = 'union') {
        console.log(`\n[ArcReconstructor] Starting ${operation} operation with arc reconstruction`);
        
        // Clear previous data
        this.registry.clear();
        this.stats = {
            inputCurves: 0,
            curveGroups: 0,
            reconstructedCurves: 0,
            fullCircles: 0,
            partialArcs: 0,
            totalPointsProcessed: 0,
            survivingPoints: 0
        };
        
        // Step 1: Preprocess and tag
        const taggedPaths = this.preprocessShapes(shapes);
        
        // Step 2: Convert to Clipper2 format with Z metadata
        const clipperPaths = this.toClipper2Paths(taggedPaths);
        
        // Step 3: Set up Z callback for better metadata preservation
        if (this.core.clipper2.SetZCallback) {
            this.core.clipper2.SetZCallback((e1bot, e1top, e2bot, e2top, pt) => {
                // Prioritize non-zero metadata
                const candidates = [e1bot.z, e1top.z, e2bot.z, e2top.z].filter(z => z !== 0n);
                if (candidates.length > 0) {
                    // If multiple candidates, prefer the one with lower curve ID (older)
                    return candidates.reduce((a, b) => {
                        const aId = this.unpackMetadata(a).curveId;
                        const bId = this.unpackMetadata(b).curveId;
                        return aId < bId ? a : b;
                    });
                }
                return BigInt(0);
            });
        }
        
        // Step 4: Perform boolean operation
        console.log(`[ArcReconstructor] Performing ${operation} operation`);
        let result;
        
        if (operation === 'union') {
            result = this.performUnion(clipperPaths);
        } else if (operation === 'intersection') {
            result = this.performIntersection(taggedPaths, clipperPaths);
        } else if (operation === 'difference') {
            result = this.performDifference(taggedPaths, clipperPaths);
        } else {
            result = clipperPaths;
        }
        
        console.log(`[ArcReconstructor] Boolean operation produced ${result.size()} path(s)`);
        
        // Log path sizes and metadata preservation
        for (let i = 0; i < result.size(); i++) {
            const path = result.get(i);
            console.log(`  Result path ${i}: ${path.size()} points`);
            
            // Check metadata preservation
            let metadataCount = 0;
            const curveIds = new Set();
            for (let j = 0; j < path.size(); j++) {
                if (path.get(j).z !== 0n) {
                    metadataCount++;
                    const metadata = this.unpackMetadata(path.get(j).z);
                    if (metadata.curveId > 0) {
                        curveIds.add(metadata.curveId);
                    }
                }
            }
            console.log(`    Metadata preserved: ${metadataCount}/${path.size()} points, ${curveIds.size} unique curves`);
        }
        
        // Step 5: Extract curve groups from result
        const groups = this.extractCurveGroups(result);
        
        // Step 6: Reconstruct curves
        const reconstructed = this.reconstructCurves(groups);
        
        // Step 7: Combine with remaining polygonal data
        const finalResult = {
            polygons: this.geometry.paths64ToCoordinates(result),
            reconstructedCurves: reconstructed,
            stats: this.stats
        };
        
        console.log(`[ArcReconstructor] Pipeline complete:`, this.stats);
        
        // Cleanup
        clipperPaths.delete();
        if (result !== clipperPaths) {
            result.delete();
        }
        
        return finalResult;
    }
    
    /**
     * Perform union operation
     */
    performUnion(paths) {
        // Union all paths together
        const fillRule = this.core.clipper2.FillRule.NonZero;
        
        if (paths.size() === 1) {
            // Single path, just return it
            return paths;
        }
        
        // Union multiple paths
        const emptyClip = new this.core.clipper2.Paths64();
        const result = this.core.clipper2.Union64(
            paths,
            emptyClip,
            fillRule,
            true  // Preserve collinear points
        );
        emptyClip.delete();
        return this.core.trackObject(result);
    }
    
    /**
     * Perform intersection - properly handle based on shapes
     */
    performIntersection(taggedPaths, clipperPaths) {
        if (clipperPaths.size() < 2) {
            console.warn('[ArcReconstructor] Intersection requires at least 2 paths');
            return clipperPaths;
        }
        
        // Build subject and clip based on shape indices
        const subject = new this.core.clipper2.Paths64();
        const clip = new this.core.clipper2.Paths64();
        
        // Use shape indices to determine subject/clip
        if (taggedPaths.length >= 2) {
            // First shape is subject
            if (taggedPaths[0].shapeIndex === 0) {
                subject.push_back(clipperPaths.get(0));
            }
            // Second shape is clip
            if (taggedPaths[1].shapeIndex === 1) {
                clip.push_back(clipperPaths.get(1));
            }
        } else {
            // Fallback to path order
            subject.push_back(clipperPaths.get(0));
            clip.push_back(clipperPaths.get(1));
        }
        
        console.log(`[ArcReconstructor] Intersecting shapes`);
        
        const result = this.core.clipper2.Intersect64(
            subject, 
            clip, 
            this.core.clipper2.FillRule.NonZero,
            true  // Preserve collinear points
        );
        
        subject.delete();
        clip.delete();
        
        return this.core.trackObject(result);
    }
    
    /**
     * Perform difference operation
     */
    performDifference(taggedPaths, clipperPaths) {
        if (clipperPaths.size() < 2) {
            console.warn('[ArcReconstructor] Difference requires at least 2 paths');
            return clipperPaths;
        }
        
        const subject = new this.core.clipper2.Paths64();
        const clip = new this.core.clipper2.Paths64();
        
        // Build based on shape indices
        if (taggedPaths.length >= 2) {
            if (taggedPaths[0].shapeIndex === 0) {
                subject.push_back(clipperPaths.get(0));
            }
            if (taggedPaths[1].shapeIndex === 1) {
                clip.push_back(clipperPaths.get(1));
            }
        } else {
            subject.push_back(clipperPaths.get(0));
            clip.push_back(clipperPaths.get(1));
        }
        
        console.log(`[ArcReconstructor] Subtracting shape 1 from shape 0`);
        
        const result = this.core.clipper2.Difference64(
            subject, 
            clip, 
            this.core.clipper2.FillRule.NonZero,
            true  // Preserve collinear points
        );
        
        subject.delete();
        clip.delete();
        
        return this.core.trackObject(result);
    }
    
    /**
     * Get statistics
     */
    getStats() {
        return {
            ...this.stats,
            registrySize: this.registry.getStats().registrySize
        };
    }
}

// Make available globally
if (typeof window !== 'undefined') {
    window.CurveRegistry = CurveRegistry;
    window.ArcReconstructor = ArcReconstructor;
}