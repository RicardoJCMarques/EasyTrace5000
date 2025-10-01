// geometry/geometry-offset-engine.js
// Core offsetting algorithm with arc segment support
// FIXED: Closing segment handling, improved join geometry

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
        
        // Step 4: Detect self-intersections (for debugging/future trimming)
        if (options.detectIntersections) {
            const intersections = this.detectAllIntersections(joinedSegments);
            if (this.debug && intersections.length > 0) {
                console.log(`[OffsetEngine] Detected ${intersections.length} self-intersections`);
            }
        }
        
        // Step 5: Reconstruct as PathPrimitive with arc segments
        return this.reconstructPathPrimitive(joinedSegments, primitive, distance);
    }
    
    decomposePath(primitive) {
        const segments = [];
        const points = primitive.points;
        const arcMap = new Map();

        if (!points || points.length < 2) {
            return [];
        }
        
        // Build arc map with wrapped arc handling
        if (primitive.arcSegments) {
            primitive.arcSegments.forEach((arc, idx) => {
                // Validate arc indices
                if (arc.startIndex < 0 || arc.endIndex < 0) {
                    if (this.debug) console.warn(`[OffsetEngine] Arc ${idx} has negative indices`);
                    return;
                }
                
                // Detect wrapped arcs (end before start in closed paths)
                if (arc.startIndex >= arc.endIndex && primitive.closed) {
                    // Split into two arcs: start to end of array, then 0 to endIndex
                    const arc1 = {
                        ...arc,
                        endIndex: points.length - 1,
                        isWrappedSegment: true,
                        wrappedPart: 1
                    };
                    arcMap.set(arc.startIndex, arc1);
                    
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
                    if (this.debug) console.warn(`[OffsetEngine] Skipping invalid arc ${idx}`);
                    return;
                } else if (arc.endIndex >= points.length) {
                    if (this.debug) console.warn(`[OffsetEngine] Arc ${idx} endIndex out of bounds`);
                    return;
                } else {
                    arcMap.set(arc.startIndex, arc);
                }
            });
        }
        
        // Main decomposition loop
        let i = 0;
        let safetyCounter = 0;
        const maxIterations = points.length * 3;
        
        while (i < points.length - 1 && safetyCounter < maxIterations) {
            safetyCounter++;
            
            if (arcMap.has(i)) {
                const arcInfo = arcMap.get(i);
                const newI = arcInfo.endIndex;
                
                if (newI <= i) {
                    console.error(`[OffsetEngine] Arc would move index backward: ${i} -> ${newI}`);
                    throw new Error('Invalid arc segment progression');
                }
                
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
        
        // CRITICAL FIX: Add closing segment for closed paths
        if (primitive.closed && points.length > 2) {
            const lastIndex = points.length - 1;
            
            // Check if an arc already handles the closure
            const hasClosingArc = arcMap.has(lastIndex) && 
                (arcMap.get(lastIndex).endIndex === 0 || 
                 arcMap.get(lastIndex).wrappedPart === 1);
            
            if (!hasClosingArc) {
                // Add closing line segment
                segments.push({
                    type: 'line',
                    start: points[lastIndex],
                    end: points[0],
                    startIndex: lastIndex,
                    endIndex: 0,
                    isClosingSegment: true
                });
            }
        }
        
        if (safetyCounter >= maxIterations) {
            console.error(`[OffsetEngine] Decomposition exceeded ${maxIterations} iterations`);
            throw new Error('Path decomposition exceeded maximum iterations');
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
        
        // Perpendicular normal (90° left for standard offset)
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
            direction: { x: dx / length, y: dy / length },
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
            
            if (!next || i === segments.length - 1) continue;
            
            // Check if segments connect naturally
            const currentEnd = current.type === 'line' ? 
                current.end : current.endPoint;
            const nextStart = next.type === 'line' ? 
                next.start : next.startPoint;
            
            const gap = Math.sqrt(
                Math.pow(nextStart.x - currentEnd.x, 2) +
                Math.pow(nextStart.y - currentEnd.y, 2)
            );
            
            // If gap is significant, create a join
            if (gap > this.precision) {
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

    createJoin(seg1, seg2, distance, joinType) {
        const isConvex = this.isConvexCorner(seg1, seg2, distance);
        
        // For concave corners, always use miter (simplest)
        if (!isConvex) {
            return this.createMiterJoin(seg1, seg2);
        }
        
        // For convex corners, use specified join type
        if (joinType === 'round') {
            return this.createRoundJoin(seg1, seg2, distance);
        } else if (joinType === 'bevel') {
            return this.createBevelJoin(seg1, seg2);
        }
        
        return this.createLimitedMiterJoin(seg1, seg2, distance);
    }

    createMiterJoin(seg1, seg2) {
        // For line-to-line, try to find intersection
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
            // Update segment endpoints to meet at miter point
            seg1.end = { x: intersection.x, y: intersection.y };
            seg2.start = { x: intersection.x, y: intersection.y };
            return [];
        }
        
        // No intersection found - create simple connecting line
        return [{
            type: 'line',
            start: seg1.end,
            end: seg2.start,
            isJoin: true
        }];
    }

    createLimitedMiterJoin(seg1, seg2, distance) {
        if (seg1.type !== 'line' || seg2.type !== 'line') {
            return this.createBevelJoin(seg1, seg2);
        }
        
        const intersection = this.intersections.lineLineIntersection(
            seg1.start, seg1.end,
            seg2.start, seg2.end
        );
        
        if (!intersection) {
            return this.createBevelJoin(seg1, seg2);
        }
        
        // Check miter length against limit
        const miterDistance = Math.sqrt(
            Math.pow(intersection.x - seg1.end.x, 2) +
            Math.pow(intersection.y - seg1.end.y, 2)
        );
        
        if (miterDistance > this.miterLimit * Math.abs(distance)) {
            // Miter too long - use bevel instead
            return this.createBevelJoin(seg1, seg2);
        }
        
        // Accept miter
        seg1.end = { x: intersection.x, y: intersection.y };
        seg2.start = { x: intersection.x, y: intersection.y };
        return [];
    }

    createBevelJoin(seg1, seg2) {
        const end1 = seg1.type === 'line' ? seg1.end : seg1.endPoint;
        const start2 = seg2.type === 'line' ? seg2.start : seg2.startPoint;
        
        return [{
            type: 'line',
            start: end1,
            end: start2,
            isJoin: true,
            isBevel: true
        }];
    }

    createRoundJoin(seg1, seg2, distance) {
        // Find the original corner point
        let cornerPoint;
        if (seg1.originalSegment && seg2.originalSegment) {
            if (seg1.originalSegment.type === 'line') {
                cornerPoint = seg1.originalSegment.end;
            } else if (seg1.originalSegment.type === 'arc') {
                cornerPoint = seg1.originalSegment.endPoint;
            }
        }
        
        if (!cornerPoint) {
            return this.createBevelJoin(seg1, seg2);
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
    
    isConvexCorner(seg1, seg2, distance) {
        let v1, v2;
        
        // Get direction vectors for each segment
        if (seg1.type === 'line') {
            v1 = seg1.direction || {
                x: (seg1.end.x - seg1.start.x),
                y: (seg1.end.y - seg1.start.y)
            };
            const len = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
            v1 = { x: v1.x / len, y: v1.y / len };
        } else {
            // For arcs, use tangent at end point
            const angle = seg1.endAngle + (seg1.clockwise ? -Math.PI/2 : Math.PI/2);
            v1 = { x: Math.cos(angle), y: Math.sin(angle) };
        }
        
        if (seg2.type === 'line') {
            v2 = seg2.direction || {
                x: (seg2.end.x - seg2.start.x),
                y: (seg2.end.y - seg2.start.y)
            };
            const len = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
            v2 = { x: v2.x / len, y: v2.y / len };
        } else {
            // For arcs, use tangent at start point
            const angle = seg2.startAngle + (seg2.clockwise ? -Math.PI/2 : Math.PI/2);
            v2 = { x: Math.cos(angle), y: Math.sin(angle) };
        }
        
        // Cross product determines turn direction
        const cross = v1.x * v2.y - v1.y * v2.x;
        
        // Convex if turning in same direction as offset
        return (distance < 0 && cross > 0) || (distance > 0 && cross < 0);
    }
    
    reconstructPathPrimitive(segments, originalPrimitive, distance) {
        const points = [];
        const arcSegments = [];
        let currentIndex = 0;
        
        for (const segment of segments) {
            if (segment.type === 'line') {
                // Add line segment points
                if (points.length === 0 || 
                    !this.pointsEqual(points[points.length - 1], segment.start)) {
                    points.push(segment.start);
                    currentIndex++;
                }
                points.push(segment.end);
                currentIndex++;
            } else if (segment.type === 'arc') {
                const startIdx = currentIndex;
                
                // Sample arc into points
                const sampledPoints = this.sampleArc(segment);
                sampledPoints.forEach((p, i) => {
                    if (i === 0 && points.length > 0 &&
                        this.pointsEqual(points[points.length - 1], p)) {
                        return; // Skip duplicate
                    }
                    points.push(p);
                    currentIndex++;
                });
                
                // Store arc segment metadata
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
        
        // Use PathPrimitive constructor if available
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
            
            return pathPrim;
        }
        
        // Fallback
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

    // NEW: Detect all self-intersections (for debugging and future trimming)
    detectAllIntersections(segments) {
        const intersections = [];
        
        for (let i = 0; i < segments.length; i++) {
            for (let j = i + 2; j < segments.length; j++) {
                // Skip adjacent segments and near-adjacent (closing)
                if (Math.abs(i - j) <= 1 || 
                    (i === 0 && j === segments.length - 1)) {
                    continue;
                }
                
                const intersection = this.segmentIntersection(segments[i], segments[j]);
                if (intersection) {
                    intersections.push({
                        point: intersection,
                        segment1Index: i,
                        segment2Index: j,
                        segment1: segments[i],
                        segment2: segments[j]
                    });
                }
            }
        }
        
        return intersections;
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
}

// Export
window.OffsetGeometry = OffsetGeometry;