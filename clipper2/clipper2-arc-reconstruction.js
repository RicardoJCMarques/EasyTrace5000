/**
 * @file        clipper2-arc-reconstruction.js
 * @description Demonstrates metadata preservation through boolean operations and reconstruction of analytic curves from tessellated results
 * @author      Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
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

class CurveRegistry {
    constructor() {
        this.curves = new Map();
        this.nextId = 1;
        this.debug = false;
    }

    register(curveData) {
        const id = this.nextId++;
        this.curves.set(id, {
            id,
            type: curveData.type,
            center: { ...curveData.center },
            radius: curveData.radius,
            startAngle: curveData.startAngle ?? 0,
            endAngle: curveData.endAngle ?? Math.PI * 2,
            clockwise: curveData.clockwise || false,
            source: curveData.source || 'unknown',
            originalPointCount: curveData.originalPointCount || 0
        });

        if (this.debug) {
            console.log(`[CurveRegistry] Registered ${curveData.type} ID ${id}: center (${curveData.center.x.toFixed(1)}, ${curveData.center.y.toFixed(1)}), r=${curveData.radius}`);
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
        return { registrySize: this.curves.size, nextId: this.nextId };
    }
}

class ArcReconstructor {
    constructor(core, geometry, defaults) {
        this.core = core;
        this.geometry = geometry;
        this.defaults = defaults;
        this.registry = new CurveRegistry();

        // Thresholds
        this.minArcPoints = 3;
        this.fullCircleThreshold = 1; // Only full coverate = full reconstructed circle

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

    // Pack curveId + segmentIndex into Z coordinate
    packMetadata(curveId, segmentIndex = 0) {
        if (!curveId || curveId === 0) return BigInt(0);
        return (BigInt(curveId) << 32n) | BigInt(segmentIndex & 0xFFFFFFFF);
    }

    // Unpack metadata from Z coordinate
    unpackMetadata(z) {
        if (!z || z === 0n) return { curveId: 0, segmentIndex: 0 };
        const zBigInt = typeof z === 'bigint' ? z : BigInt(z);
        return {
            curveId: Number((zBigInt >> 32n) & 0xFFFFFFFFn),
            segmentIndex: Number(zBigInt & 0xFFFFFFFFn)
        };
    }

    // Tessellate shapes and tag with metadata
    preprocessShapes(shapes) {
        const taggedPaths = [];
        this.stats.inputCurves = 0;

        shapes.forEach((shape, idx) => {
            if (shape.type === 'circle') {
                const segments = 128;
                const curveId = this.registry.register({
                    type: 'circle',
                    center: shape.center,
                    radius: shape.radius,
                    source: `shape${idx}`,
                    originalPointCount: segments
                });

                this.stats.inputCurves++;
                const points = [];

                for (let i = 0; i < segments; i++) {
                    const angle = (i / segments) * 2 * Math.PI;
                    points.push({
                        x: shape.center.x + shape.radius * Math.cos(angle),
                        y: shape.center.y + shape.radius * Math.sin(angle),
                        curveId,
                        segmentIndex: i
                    });
                }

                taggedPaths.push({ points, curveId, originalShape: shape, shapeIndex: idx });

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
                    source: `shape${idx}`,
                    originalPointCount: segments + 1
                });

                this.stats.inputCurves++;
                const points = [];

                for (let i = 0; i <= segments; i++) {
                    const t = i / segments;
                    const angle = shape.startAngle + angleSpan * t;
                    points.push({
                        x: shape.center.x + shape.radius * Math.cos(angle),
                        y: shape.center.y + shape.radius * Math.sin(angle),
                        curveId,
                        segmentIndex: i
                    });
                }

                taggedPaths.push({ points, curveId, originalShape: shape, shapeIndex: idx });

            } else if (shape.type === 'polygon') {
                taggedPaths.push({ points: shape.points || shape.data, curveId: 0, shapeIndex: idx });
            }
        });

        return taggedPaths;
    }

    // Convert tagged paths to Clipper2 Paths64 with Z metadata
    toClipper2Paths(taggedPaths) {
        const paths = new this.core.clipper2.Paths64();
        const scale = this.defaults.config.scale;

        taggedPaths.forEach(({ points, curveId }) => {
            const path = new this.core.clipper2.Path64();

            points.forEach((pt, idx) => {
                const x = BigInt(Math.round(pt.x * scale));
                const y = BigInt(Math.round(pt.y * scale));
                const z = pt.curveId ? this.packMetadata(pt.curveId, pt.segmentIndex ?? idx) : BigInt(0);
                path.push_back(new this.core.clipper2.Point64(x, y, z));
            });

            paths.push_back(path);
        });

        return paths;
    }

    // Extract points grouped by curve ID from result
    extractCurveGroups(paths) {
        const groups = new Map();
        const scale = this.defaults.config.scale;
        let totalPoints = 0, taggedPoints = 0;

        for (let i = 0; i < paths.size(); i++) {
            const path = paths.get(i);
            for (let j = 0; j < path.size(); j++) {
                const pt = path.get(j);
                totalPoints++;

                if (pt.z && pt.z !== 0n) {
                    const meta = this.unpackMetadata(pt.z);
                    if (meta.curveId > 0) {
                        taggedPoints++;
                        if (!groups.has(meta.curveId)) groups.set(meta.curveId, []);
                        groups.get(meta.curveId).push({
                            x: Number(pt.x) / scale,
                            y: Number(pt.y) / scale,
                            segmentIndex: meta.segmentIndex,
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

        return groups;
    }

    // Reconstruct curves from grouped points
    reconstructCurves(groups) {
        const reconstructed = [];
        this.stats.reconstructedCurves = 0;
        this.stats.fullCircles = 0;
        this.stats.partialArcs = 0;

        groups.forEach((points, curveId) => {
            const curveData = this.registry.getCurve(curveId);
            if (!curveData || points.length < 2) return;

            // Sort by segment index
            points.sort((a, b) => a.segmentIndex - b.segmentIndex);

            // Detect wrap-around gaps and merge if needed
            const mergedPoints = this.mergeWrappedPoints(points, curveData);
            
            if (curveData.type === 'circle') {
                const coverage = mergedPoints.length / curveData.originalPointCount;

                if (coverage >= this.fullCircleThreshold) {
                    // Full circle
                    reconstructed.push({
                        type: 'circle',
                        center: curveData.center,
                        radius: curveData.radius,
                        reconstructed: true,
                        coverage,
                        pointCount: mergedPoints.length,
                        source: curveData.source
                    });
                    this.stats.fullCircles++;
                    this.stats.reconstructedCurves++;
                } else if (mergedPoints.length >= this.minArcPoints) {
                    // Partial arc
                    const arcParams = this.calculateArcFromPoints(mergedPoints, curveData);
                    if (arcParams) {
                        reconstructed.push({
                            type: 'arc',
                            center: curveData.center,
                            radius: curveData.radius,
                            startAngle: arcParams.startAngle,
                            endAngle: arcParams.endAngle,
                            clockwise: arcParams.clockwise,
                            reconstructed: true,
                            pointCount: mergedPoints.length,
                            coverage,
                            source: curveData.source
                        });
                        this.stats.partialArcs++;
                        this.stats.reconstructedCurves++;
                    }
                }
            } else if (curveData.type === 'arc' && mergedPoints.length >= 2) {
                const arcParams = this.calculateArcFromPoints(mergedPoints, curveData);
                if (arcParams) {
                    reconstructed.push({
                        type: 'arc',
                        center: curveData.center,
                        radius: curveData.radius,
                        startAngle: arcParams.startAngle,
                        endAngle: arcParams.endAngle,
                        clockwise: arcParams.clockwise,
                        reconstructed: true,
                        pointCount: mergedPoints.length,
                        coverage: curveData.originalPointCount > 0 ? mergedPoints.length / curveData.originalPointCount : 0,
                        source: curveData.source
                    });
                    this.stats.partialArcs++;
                    this.stats.reconstructedCurves++;
                }
            }
        });

        return reconstructed;
    }

    // Merge points that wrap around (e.g., indices 120-127 and 0-10)
    mergeWrappedPoints(points, curveData) {
        if (points.length < 2) return points;

        const maxIdx = curveData.originalPointCount - 1;
        const sorted = [...points].sort((a, b) => a.segmentIndex - b.segmentIndex);

        // Find largest gap
        let maxGap = 0, gapPos = -1;
        for (let i = 0; i < sorted.length - 1; i++) {
            const gap = sorted[i + 1].segmentIndex - sorted[i].segmentIndex;
            if (gap > maxGap) { maxGap = gap; gapPos = i; }
        }

        // Check wrap-around gap
        const wrapGap = (maxIdx - sorted[sorted.length - 1].segmentIndex) + sorted[0].segmentIndex;
        if (wrapGap < maxGap && wrapGap <= 3) {
            // Reorder: start after the largest gap
            return [...sorted.slice(gapPos + 1), ...sorted.slice(0, gapPos + 1)];
        }

        return sorted;
    }

    // Calculate arc parameters from points
    calculateArcFromPoints(points, curveData) {
        if (points.length < 2) return null;

        const start = points[0];
        const end = points[points.length - 1];

        const startAngle = Math.atan2(start.y - curveData.center.y, start.x - curveData.center.x);
        const endAngle = Math.atan2(end.y - curveData.center.y, end.x - curveData.center.x);

        // Determine direction from point progression
        let clockwise = false;
        if (points.length >= 3) {
            let cwVotes = 0, ccwVotes = 0;
            for (let i = 1; i < Math.min(5, points.length); i++) {
                const a1 = Math.atan2(points[i - 1].y - curveData.center.y, points[i - 1].x - curveData.center.x);
                const a2 = Math.atan2(points[i].y - curveData.center.y, points[i].x - curveData.center.x);
                let delta = a2 - a1;
                while (delta > Math.PI) delta -= 2 * Math.PI;
                while (delta < -Math.PI) delta += 2 * Math.PI;
                if (delta > 0) ccwVotes++; else if (delta < 0) cwVotes++;
            }
            clockwise = cwVotes > ccwVotes;
        }

        return { startAngle, endAngle, clockwise };
    }

    // Draw reconstructed curves
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

                // Marker at 0°
                ctx.beginPath();
                ctx.arc(curve.center.x + curve.radius, curve.center.y, 4, 0, 2 * Math.PI);
                ctx.fillStyle = '#ff9900';
                ctx.fill();

            } else if (curve.type === 'arc') {
                ctx.beginPath();
                const start = curve.startAngle;
                let end = curve.endAngle;
                if (curve.clockwise) {
                    ctx.arc(curve.center.x, curve.center.y, curve.radius, start, end, true);
                } else {
                    ctx.arc(curve.center.x, curve.center.y, curve.radius, start, end, false);
                }
                ctx.stroke();

                // Endpoint markers
                const sx = curve.center.x + curve.radius * Math.cos(start);
                const sy = curve.center.y + curve.radius * Math.sin(start);
                const ex = curve.center.x + curve.radius * Math.cos(end);
                const ey = curve.center.y + curve.radius * Math.sin(end);

                ctx.beginPath();
                ctx.arc(sx, sy, 4, 0, 2 * Math.PI);
                ctx.fillStyle = '#00ff00';
                ctx.fill();

                ctx.beginPath();
                ctx.arc(ex, ey, 4, 0, 2 * Math.PI);
                ctx.fillStyle = '#ff0000';
                ctx.fill();
            }
        });

        ctx.restore();
    }

    // Main pipeline
    processWithReconstruction(shapes, operation = 'union') {
        console.log(`[ArcReconstructor] Starting ${operation} with arc reconstruction`);

        this.registry.clear();
        this.stats = {
            inputCurves: 0, curveGroups: 0, reconstructedCurves: 0,
            fullCircles: 0, partialArcs: 0, totalPointsProcessed: 0, survivingPoints: 0
        };

        // Preprocess and tag
        const taggedPaths = this.preprocessShapes(shapes);

        // Convert to Clipper2
        const clipperPaths = this.toClipper2Paths(taggedPaths);

        // Perform boolean operation
        let result;
        const fillRule = this.core.clipper2.FillRule.NonZero;

        if (operation === 'union') {
            if (clipperPaths.size() === 1) {
                result = clipperPaths;
            } else {
                const emptyClip = new this.core.clipper2.Paths64();
                result = this.core.clipper2.Union64(clipperPaths, emptyClip, fillRule, true);
                emptyClip.delete();
            }
        } else if (operation === 'intersection' && clipperPaths.size() >= 2) {
            const subject = new this.core.clipper2.Paths64();
            const clip = new this.core.clipper2.Paths64();
            subject.push_back(clipperPaths.get(0));
            clip.push_back(clipperPaths.get(1));
            result = this.core.clipper2.Intersect64(subject, clip, fillRule, true);
            subject.delete();
            clip.delete();
        } else if (operation === 'difference' && clipperPaths.size() >= 2) {
            const subject = new this.core.clipper2.Paths64();
            const clip = new this.core.clipper2.Paths64();
            subject.push_back(clipperPaths.get(0));
            clip.push_back(clipperPaths.get(1));
            result = this.core.clipper2.Difference64(subject, clip, fillRule, true);
            subject.delete();
            clip.delete();
        } else {
            result = clipperPaths;
        }

        console.log(`[ArcReconstructor] Boolean produced ${result.size()} path(s)`);

        // Extract curve groups
        const groups = this.extractCurveGroups(result);

        // Reconstruct curves
        const reconstructed = this.reconstructCurves(groups);

        // Convert to JS coordinates
        const polygons = this.geometry.paths64ToCoordinates(result);

        console.log(`[ArcReconstructor] Complete:`, this.stats);

        // Cleanup
        if (result !== clipperPaths) result.delete();
        clipperPaths.delete();

        return { polygons, reconstructedCurves: reconstructed, stats: this.stats };
    }

    getStats() {
        return { ...this.stats, registrySize: this.registry.getStats().registrySize };
    }
}

// Export globally
if (typeof window !== 'undefined') {
    window.CurveRegistry = CurveRegistry;
    window.ArcReconstructor = ArcReconstructor;
}