// geometry/geometry-offset-engine.js

class OffsetGeometry {
    constructor(options = {}) {
        this.intersections = new LineIntersections();
        this.precision = options.precision || 0.001;
        this.miterLimit = options.miterLimit || 2.0;
        this.debug = options.debug || false;
    }
    
    // Offset a path primitive with arc segments
    offsetPath(primitive, distance, options = {}) {
        if (!primitive.points || primitive.points.length < 2) {
            if (this.debug) console.log('[OffsetEngine] Path has insufficient points');
            return null;
        }
        
        if (this.debug) {
            console.log(`[OffsetEngine] Offsetting path: ${primitive.points.length} points, ${primitive.arcSegments?.length || 0} arc segments`);
        }
        
        // Step 1: Decompose into segments (lines and arcs)
        const segments = this.decomposePath(primitive);
        
        if (!segments || segments.length === 0) {
            if (this.debug) console.log('[OffsetEngine] Decomposition produced no segments');
            return null;
        }
        
        // Step 2: Offset each segment individually
        const offsetSegments = segments.map(seg => 
            this.offsetSegment(seg, distance)
        ).filter(seg => seg !== null);
        
        if (offsetSegments.length === 0) {
            if (this.debug) console.log('[OffsetEngine] All segments failed to offset');
            return null;
        }
        
        // Step 3: Calculate joins between offset segments
        const joinedSegments = this.calculateJoins(
            offsetSegments, 
            distance, 
            options.joinType || 'round'
        );
        
        // Step 4: Detect and resolve self-intersections
        const cleanSegments = this.resolveSelfIntersections(joinedSegments);
        
        // Step 5: Reconstruct as PathPrimitive with arc segments
        return this.reconstructPathPrimitive(cleanSegments, primitive, distance);
    }
    
    decomposePath(primitive) {
        const segments = [];
        const points = primitive.points;
        const arcMap = new Map();

        // Validate inputs
        if (!points || points.length < 2) {
            return [];
        }

        if (this.debug) {
            console.log(`[OffsetEngine] Decomposing path: ${points.length} points, ${primitive.arcSegments?.length || 0} arc segments`);
        }
        
        // Validate and handle wrapped arcs
        if (primitive.arcSegments) {
            primitive.arcSegments.forEach((arc, idx) => {
                // Detect wrapped arcs
                if (arc.startIndex >= arc.endIndex && primitive.closed) {
                    if (this.debug) {
                        console.log(`[OffsetEngine] Splitting wrapped arc ${idx}: ${arc.startIndex}..end,0..${arc.endIndex}`);
                    }
                    
                    // Part 1: startIndex to points.length-1
                    const arc1 = {
                        ...arc,
                        endIndex: points.length - 1,
                        isWrappedSegment: true,
                        wrappedPart: 1
                    };
                    arcMap.set(arc.startIndex, arc1);
                    
                    // Part 2: 0 to endIndex
                    if (!arcMap.has(0)) {
                        const arc2 = {
                            ...arc,
                            startIndex: 0,
                            isWrappedSegment: true,
                            wrappedPart: 2
                        };
                        arcMap.set(0, arc2);
                    }
                    
                } else if (arc.startIndex >= arc.endIndex) {
                    if (this.debug) {
                        console.warn(`[OffsetEngine] Skipping invalid arc ${idx}`);
                    }
                    return;
                } else if (arc.endIndex >= points.length) {
                    if (this.debug) {
                        console.warn(`[OffsetEngine] Arc ${idx} endIndex out of bounds`);
                    }
                    return;
                } else {
                    arcMap.set(arc.startIndex, arc);
                }
            });
        }
        
        let i = 0;
        let safetyCounter = 0;
        const maxIterations = points.length * 3;
        
        while (i < points.length - 1 && safetyCounter < maxIterations) {
            safetyCounter++;
            
            if (arcMap.has(i)) {
                const arcInfo = arcMap.get(i);
                
                // Validate progression
                const newI = arcInfo.endIndex;
                if (newI <= i) {
                    console.error(`[OffsetEngine] Arc segment would move index backward: ${i} -> ${newI}`);
                    throw new Error(`Invalid arc segment index progression`);
                }
                
                // Add arc segment
                segments.push({
                    type: 'arc',
                    center: arcInfo.center,
                    radius: arcInfo.radius,
                    startAngle: arcInfo.startAngle,
                    endAngle: arcInfo.endAngle,
                    clockwise: arcInfo.clockwise,
                    startPoint: points[i],
                    endPoint: points[arcInfo.endIndex],
                    startIndex: i,
                    endIndex: arcInfo.endIndex
                });
                
                i = newI;
            } else {
                segments.push({
                    type: 'line',
                    start: points[i],
                    end: points[i + 1],
                    startIndex: i,
                    endIndex: i + 1
                });
                i++;
            }
        }
        
        if (safetyCounter >= maxIterations) {
            console.error(`[OffsetEngine] Decomposition exceeded maximum iterations: ${safetyCounter}/${maxIterations}`);
            throw new Error(`Path decomposition exceeded maximum iterations`);
        }

        if (this.debug) {
            console.log(`[OffsetEngine] Decomposition complete: ${segments.length} segments`);
        }
        return segments;
    }
    
    offsetSegment(segment, distance) {
        if (segment.type === 'line') {
            return this.offsetLine(segment, distance);
        } else if (segment.type === 'arc') {
            return this.offsetArc(segment, distance);
        }
        return null;
    }
    
    offsetLine(segment, distance) {
        const dx = segment.end.x - segment.start.x;
        const dy = segment.end.y - segment.start.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        
        if (length < this.precision) return null;
        
        // Perpendicular normal (90° left)
        const nx = -dy / length;
        const ny = dx / length;
        
        return {
            type: 'line',
            start: {
                x: segment.start.x + nx * distance,
                y: segment.start.y + ny * distance
            },
            end: {
                x: segment.end.x + nx * distance,
                y: segment.end.y + ny * distance
            },
            normal: { x: nx, y: ny },
            originalSegment: segment
        };
    }
    
    offsetArc(segment, distance) {
        const newRadius = segment.radius - distance;
        
        if (newRadius <= this.precision) {
            // Arc collapsed - convert to line
            return {
                type: 'line',
                start: segment.startPoint,
                end: segment.endPoint,
                wasArc: true,
                originalSegment: segment
            };
        }
        
        // Calculate new endpoints at new radius
        const startPoint = {
            x: segment.center.x + newRadius * Math.cos(segment.startAngle),
            y: segment.center.y + newRadius * Math.sin(segment.startAngle)
        };
        
        const endPoint = {
            x: segment.center.x + newRadius * Math.cos(segment.endAngle),
            y: segment.center.y + newRadius * Math.sin(segment.endAngle)
        };
        
        return {
            type: 'arc',
            center: segment.center,
            radius: newRadius,
            startAngle: segment.startAngle,
            endAngle: segment.endAngle,
            clockwise: segment.clockwise,
            startPoint: startPoint,
            endPoint: endPoint,
            originalSegment: segment
        };
    }
    
    calculateJoins(segments, distance, joinType) {
        const result = [];
        
        for (let i = 0; i < segments.length; i++) {
            const current = segments[i];
            const next = segments[(i + 1) % segments.length];
            
            result.push(current);
            
            if (!next) continue;
            
            // Check if segments connect naturally
            const currentEnd = current.type === 'line' ? 
                current.end : current.endPoint;
            const nextStart = next.type === 'line' ? 
                next.start : next.startPoint;
            
            const gap = Math.sqrt(
                Math.pow(nextStart.x - currentEnd.x, 2) +
                Math.pow(nextStart.y - currentEnd.y, 2)
            );
            
            if (gap > this.precision) {
                // Need a join
                const joinGeometry = this.createJoin(
                    current, next, distance, joinType
                );
                if (joinGeometry) {
                    result.push(...joinGeometry);
                }
            }
        }
        
        return result;
    }

    createMiterJoin(seg1, seg2) {
        if (seg1.type !== 'line' || seg2.type !== 'line') {
            const end1 = seg1.type === 'line' ? seg1.end : seg1.endPoint;
            const start2 = seg2.type === 'line' ? seg2.start : seg2.startPoint;
            return [{
                type: 'line',
                start: end1,
                end: start2,
                isJoin: true
            }];
        }
        
        const intersection = this.intersections.lineLineIntersection(
            seg1.start, seg1.end,
            seg2.start, seg2.end
        );
        
        if (intersection) {
            seg1.end = { x: intersection.x, y: intersection.y };
            seg2.start = { x: intersection.x, y: intersection.y };
            return [];
        }
        
        return [{
            type: 'line',
            start: seg1.end,
            end: seg2.start,
            isJoin: true
        }];
    }

    createLimitedMiterJoin(seg1, seg2, distance) {
        if (seg1.type !== 'line' || seg2.type !== 'line') {
            const end1 = seg1.type === 'line' ? seg1.end : seg1.endPoint;
            const start2 = seg2.type === 'line' ? seg2.start : seg2.startPoint;
            return [{
                type: 'line',
                start: end1,
                end: start2,
                isJoin: true
            }];
        }
        
        const intersection = this.intersections.lineLineIntersection(
            seg1.start, seg1.end,
            seg2.start, seg2.end
        );
        
        if (!intersection) {
            return [{
                type: 'line',
                start: seg1.end,
                end: seg2.start,
                isJoin: true
            }];
        }
        
        const miterDistance = Math.sqrt(
            Math.pow(intersection.x - seg1.end.x, 2) +
            Math.pow(intersection.y - seg1.end.y, 2)
        );
        
        if (miterDistance > this.miterLimit * Math.abs(distance)) {
            return [{
                type: 'line',
                start: seg1.end,
                end: seg2.start,
                isJoin: true,
                isBevel: true
            }];
        }
        
        seg1.end = { x: intersection.x, y: intersection.y };
        seg2.start = { x: intersection.x, y: intersection.y };
        return [];
    }

    createRoundJoin(seg1, seg2, distance) {
        let cornerPoint;
        if (seg1.originalSegment && seg2.originalSegment) {
            if (seg1.originalSegment.type === 'line') {
                cornerPoint = seg1.originalSegment.end;
            } else if (seg1.originalSegment.type === 'arc') {
                cornerPoint = seg1.originalSegment.endPoint;
            }
        }
        
        if (!cornerPoint) {
            const end1 = seg1.type === 'line' ? seg1.end : seg1.endPoint;
            const start2 = seg2.type === 'line' ? seg2.start : seg2.startPoint;
            return [{
                type: 'line',
                start: end1,
                end: start2,
                isJoin: true
            }];
        }
        
        const seg1End = seg1.type === 'line' ? seg1.end : seg1.endPoint;
        const seg2Start = seg2.type === 'line' ? seg2.start : seg2.startPoint;
        
        const angle1 = Math.atan2(seg1End.y - cornerPoint.y, seg1End.x - cornerPoint.x);
        const angle2 = Math.atan2(seg2Start.y - cornerPoint.y, seg2Start.x - cornerPoint.x);
        
        let sweepAngle = angle2 - angle1;
        while (sweepAngle > Math.PI) sweepAngle -= 2 * Math.PI;
        while (sweepAngle < -Math.PI) sweepAngle += 2 * Math.PI;
        
        return [{
            type: 'arc',
            center: cornerPoint,
            radius: Math.abs(distance),
            startPoint: seg1End,
            endPoint: seg2Start,
            startAngle: angle1,
            endAngle: angle2,
            clockwise: sweepAngle < 0,
            isJoin: true
        }];
    }

    sampleArc(segment) {
        const points = [];
        
        let sweepAngle = segment.endAngle - segment.startAngle;
        if (segment.clockwise) {
            if (sweepAngle > 0) sweepAngle -= 2 * Math.PI;
        } else {
            if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
        }
        
        const arcLength = Math.abs(sweepAngle) * segment.radius;
        const segments = Math.max(2, Math.ceil(arcLength / 0.1));
        
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const angle = segment.startAngle + sweepAngle * t;
            
            points.push({
                x: segment.center.x + segment.radius * Math.cos(angle),
                y: segment.center.y + segment.radius * Math.sin(angle)
            });
        }
        
        return points;
    }

    pointsEqual(p1, p2) {
        if (!p1 || !p2) return false;
        return Math.abs(p1.x - p2.x) < this.precision && 
            Math.abs(p1.y - p2.y) < this.precision;
    }
    
    createJoin(seg1, seg2, distance, joinType) {
        const isConvex = this.isConvexCorner(seg1, seg2, distance);
        
        if (!isConvex) {
            return this.createMiterJoin(seg1, seg2);
        }
        
        if (joinType === 'round') {
            return this.createRoundJoin(seg1, seg2, distance);
        }
        
        return this.createLimitedMiterJoin(seg1, seg2, distance);
    }
    
    isConvexCorner(seg1, seg2, distance) {
        let v1, v2;
        
        if (seg1.type === 'line') {
            const dx = seg1.end.x - seg1.start.x;
            const dy = seg1.end.y - seg1.start.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            v1 = { x: dx / len, y: dy / len };
        } else {
            const angle = seg1.endAngle + 
                (seg1.clockwise ? -Math.PI/2 : Math.PI/2);
            v1 = { x: Math.cos(angle), y: Math.sin(angle) };
        }
        
        if (seg2.type === 'line') {
            const dx = seg2.end.x - seg2.start.x;
            const dy = seg2.end.y - seg2.start.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            v2 = { x: dx / len, y: dy / len };
        } else {
            const angle = seg2.startAngle + 
                (seg2.clockwise ? -Math.PI/2 : Math.PI/2);
            v2 = { x: Math.cos(angle), y: Math.sin(angle) };
        }
        
        const cross = v1.x * v2.y - v1.y * v2.x;
        
        return (distance < 0 && cross > 0) || 
               (distance > 0 && cross < 0);
    }
    
    // FIXED: Return proper PathPrimitive instance instead of plain object
    reconstructPathPrimitive(segments, originalPrimitive, distance) {
        const points = [];
        const arcSegments = [];
        let currentIndex = 0;
        
        if (this.debug) {
            console.log(`[OffsetEngine] Reconstructing path from ${segments.length} segments`);
        }
        
        for (const segment of segments) {
            if (segment.type === 'line') {
                if (points.length === 0 || 
                    !this.pointsEqual(points[points.length - 1], segment.start)) {
                    points.push(segment.start);
                    currentIndex++;
                }
                points.push(segment.end);
                currentIndex++;
            } else if (segment.type === 'arc') {
                const startIdx = currentIndex;
                
                const sampledPoints = this.sampleArc(segment);
                sampledPoints.forEach((p, i) => {
                    if (i === 0 && points.length > 0 &&
                        this.pointsEqual(points[points.length - 1], p)) {
                        return;
                    }
                    points.push(p);
                    currentIndex++;
                });
                
                arcSegments.push({
                    startIndex: startIdx,
                    endIndex: currentIndex - 1,
                    center: segment.center,
                    radius: segment.radius,
                    startAngle: segment.startAngle,
                    endAngle: segment.endAngle,
                    clockwise: segment.clockwise,
                    sweepAngle: segment.endAngle - segment.startAngle
                });
            }
        }
        
        if (this.debug) {
            console.log(`[OffsetEngine] Reconstructed: ${points.length} points, ${arcSegments.length} arc segments`);
        }
        
        // CRITICAL FIX: Use PathPrimitive constructor if available
        if (typeof PathPrimitive !== 'undefined') {
            const pathPrim = new PathPrimitive(points, {
                ...originalPrimitive.properties,
                isOffset: true,
                offsetDistance: distance,
                hasArcs: arcSegments.length > 0,
                closed: originalPrimitive.closed
            });
            pathPrim.arcSegments = arcSegments;
            pathPrim.closed = originalPrimitive.closed || false;
            
            if (this.debug) {
                console.log('[OffsetEngine] Created PathPrimitive instance');
            }
            
            return pathPrim;
        }
        
        // Fallback: Create object with getBounds method
        if (this.debug) {
            console.warn('[OffsetEngine] PathPrimitive not available, using fallback');
        }
        
        return {
            type: 'path',
            points: points,
            arcSegments: arcSegments,
            closed: originalPrimitive.closed || false,
            properties: {
                ...originalPrimitive.properties,
                isOffset: true,
                offsetDistance: distance,
                hasArcs: arcSegments.length > 0
            },
            getBounds: function() {
                if (this.points.length === 0) {
                    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
                }
                let minX = Infinity, minY = Infinity;
                let maxX = -Infinity, maxY = -Infinity;
                this.points.forEach(p => {
                    minX = Math.min(minX, p.x);
                    minY = Math.min(minY, p.y);
                    maxX = Math.max(maxX, p.x);
                    maxY = Math.max(maxY, p.y);
                });
                return { minX, minY, maxX, maxY };
            }
        };
    }

    resolveSelfIntersections(segments) {
        if (segments.length < 3) return segments;
        
        const result = [];
        const processed = new Set();
        
        for (let i = 0; i < segments.length; i++) {
            if (processed.has(i)) continue;
            
            const currentSeg = segments[i];
            let hasIntersection = false;
            
            for (let j = 0; j < result.length - 1; j++) {
                const prevSeg = result[j];
                
                if (Math.abs(i - j) <= 1 || 
                    Math.abs(i - j) >= segments.length - 1) {
                    continue;
                }
                
                const intersection = this.segmentIntersection(
                    currentSeg, 
                    prevSeg
                );
                
                if (intersection) {
                    hasIntersection = true;
                    this.trimLoop(result, j, currentSeg, intersection);
                    break;
                }
            }
            
            if (!hasIntersection) {
                result.push(currentSeg);
            }
        }
        
        return result;
    }

    segmentIntersection(seg1, seg2) {
        if (seg1.type === 'line' && seg2.type === 'line') {
            return this.intersections.lineLineSegmentIntersection(seg1, seg2);
        } else if (seg1.type === 'line' && seg2.type === 'arc') {
            return this.intersections.lineArcSegmentIntersection(seg1, seg2);
        } else if (seg1.type === 'arc' && seg2.type === 'line') {
            return this.intersections.lineArcSegmentIntersection(seg2, seg1);
        } else if (seg1.type === 'arc' && seg2.type === 'arc') {
            return this.intersections.arcArcSegmentIntersection(seg1, seg2);
        }
        return null;
    }

    trimLoop(result, intersectionIndex, currentSegment, intersection) {
        const prevSeg = result[intersectionIndex];
        if (prevSeg.type === 'line') {
            prevSeg.end = intersection;
        } else if (prevSeg.type === 'arc') {
            const dx = intersection.x - prevSeg.center.x;
            const dy = intersection.y - prevSeg.center.y;
            prevSeg.endAngle = Math.atan2(dy, dx);
            prevSeg.endPoint = intersection;
        }
        
        result.splice(intersectionIndex + 1);
        
        if (currentSegment.type === 'line') {
            currentSegment.start = intersection;
        } else if (currentSegment.type === 'arc') {
            const dx = intersection.x - currentSegment.center.x;
            const dy = intersection.y - currentSegment.center.y;
            currentSegment.startAngle = Math.atan2(dy, dx);
            currentSegment.startPoint = intersection;
        }
    }
}