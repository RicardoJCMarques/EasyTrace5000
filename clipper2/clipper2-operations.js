/**
 * @file        clipper2-operations.js
 * @description Boolean operations, offsets, and path manipulations
 * @author      Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

/*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2025 Eltryus
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

class Clipper2Operations {
    constructor(core) {
        this.core = core;
        this.geometry = null;
        this.stats = new Map();
        this.defaults = null;
    }

    initialize(defaults) {
        this.defaults = defaults;
    }

    setGeometryModule(geometry) {
        this.geometry = geometry;
    }

    /**
     * Normalize path winding to CCW using Clipper2's native AreaPath64
     */
    normalizePathWinding(path) {
        if (!this.core.clipper2.AreaPath64) return path;

        const area = this.core.clipper2.AreaPath64(path);
        // Clipper2: Negative area = CW, Positive = CCW
        // Subjects must be CCW (positive area)
        if (area < 0) {
            if (this.core.clipper2.ReversePath64) {
                this.core.clipper2.ReversePath64(path);
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
            }
        }
        return path;
    }

    normalizePathsWinding(paths) {
        for (let i = 0; i < paths.size(); i++) {
            this.normalizePathWinding(paths.get(i));
        }
        return paths;
    }

    /**
     * Paths64 Operations (Return WASM objects - caller must delete)
     */

    unionSelf(paths, fillRule = null) {
        if (!this.core.initialized) throw new Error('Clipper2 not initialized');

        this.normalizePathsWinding(paths);
        fillRule = fillRule || this.core.clipper2.FillRule.NonZero;

        if (this.core.clipper2.UnionSelf64) {
            return this.core.trackObject(this.core.clipper2.UnionSelf64(paths, fillRule));
        }

        const emptyClip = new this.core.clipper2.Paths64();
        const result = this.core.trackObject(this.core.clipper2.Union64(paths, emptyClip, fillRule));
        emptyClip.delete();
        return result;
    }

    union(subjectPaths, clipPaths, fillRule = null) {
        if (!this.core.initialized) throw new Error('Clipper2 not initialized');

        this.normalizePathsWinding(subjectPaths);
        this.normalizePathsWinding(clipPaths);
        fillRule = fillRule || this.core.clipper2.FillRule.NonZero;

        return this.core.trackObject(
            this.core.clipper2.Union64(subjectPaths, clipPaths, fillRule)
        );
    }

    intersect(subjectPaths, clipPaths, fillRule = null) {
        if (!this.core.initialized) throw new Error('Clipper2 not initialized');

        this.normalizePathsWinding(subjectPaths);
        this.normalizePathsWinding(clipPaths);
        fillRule = fillRule || this.core.clipper2.FillRule.NonZero;

        return this.core.trackObject(
            this.core.clipper2.Intersect64(subjectPaths, clipPaths, fillRule)
        );
    }

    difference(subjectPaths, clipPaths, fillRule = null) {
        if (!this.core.initialized) throw new Error('Clipper2 not initialized');

        this.normalizePathsWinding(subjectPaths);
        this.normalizePathsWinding(clipPaths);
        fillRule = fillRule || this.core.clipper2.FillRule.NonZero;

        return this.core.trackObject(
            this.core.clipper2.Difference64(subjectPaths, clipPaths, fillRule)
        );
    }

    xor(subjectPaths, clipPaths, fillRule = null) {
        if (!this.core.initialized) throw new Error('Clipper2 not initialized');

        this.normalizePathsWinding(subjectPaths);
        this.normalizePathsWinding(clipPaths);
        fillRule = fillRule || this.core.clipper2.FillRule.EvenOdd;

        return this.core.trackObject(
            this.core.clipper2.Xor64(subjectPaths, clipPaths, fillRule)
        );
    }

    /**
     * PolyTree Operations (Return JS objects - no cleanup needed)
     */

    unionPolyTree(subjectPaths, clipPaths = null, fillRule = null) {
        if (!this.core.initialized) throw new Error('Clipper2 not initialized');

        this.normalizePathsWinding(subjectPaths);
        if (clipPaths) this.normalizePathsWinding(clipPaths);

        fillRule = fillRule || this.core.clipper2.FillRule.NonZero;

        const { Clipper64, PolyPath64, ClipType } = this.core.clipper2;
        const clipper = new Clipper64();
        const solution = new PolyPath64();

        try {
            clipper.AddSubject(subjectPaths);
            if (clipPaths && clipPaths.size() > 0) {
                clipper.AddClip(clipPaths);
            }

            const success = clipper.ExecutePoly(ClipType.Union, fillRule, solution);
            if (!success) throw new Error('PolyTree union failed');

            return this._polyTreeToStructured(solution);
        } finally {
            clipper.delete();
            solution.delete();
        }
    }

    intersectPolyTree(subjectPaths, clipPaths, fillRule = null) {
        if (!this.core.initialized) throw new Error('Clipper2 not initialized');

        this.normalizePathsWinding(subjectPaths);
        this.normalizePathsWinding(clipPaths);
        fillRule = fillRule || this.core.clipper2.FillRule.NonZero;

        const { Clipper64, PolyPath64, ClipType } = this.core.clipper2;
        const clipper = new Clipper64();
        const solution = new PolyPath64();

        try {
            clipper.AddSubject(subjectPaths);
            clipper.AddClip(clipPaths);

            const success = clipper.ExecutePoly(ClipType.Intersection, fillRule, solution);
            if (!success) throw new Error('PolyTree intersection failed');

            return this._polyTreeToStructured(solution);
        } finally {
            clipper.delete();
            solution.delete();
        }
    }

    differencePolyTree(subjectPaths, clipPaths, fillRule = null) {
        if (!this.core.initialized) throw new Error('Clipper2 not initialized');

        this.normalizePathsWinding(subjectPaths);
        this.normalizePathsWinding(clipPaths);
        fillRule = fillRule || this.core.clipper2.FillRule.NonZero;

        const { Clipper64, PolyPath64, ClipType } = this.core.clipper2;
        const clipper = new Clipper64();
        const solution = new PolyPath64();

        try {
            clipper.AddSubject(subjectPaths);
            clipper.AddClip(clipPaths);

            const success = clipper.ExecutePoly(ClipType.Difference, fillRule, solution);
            if (!success) throw new Error('PolyTree difference failed');

            return this._polyTreeToStructured(solution);
        } finally {
            clipper.delete();
            solution.delete();
        }
    }

    xorPolyTree(subjectPaths, clipPaths, fillRule = null) {
        if (!this.core.initialized) throw new Error('Clipper2 not initialized');

        this.normalizePathsWinding(subjectPaths);
        this.normalizePathsWinding(clipPaths);
        fillRule = fillRule || this.core.clipper2.FillRule.EvenOdd;

        const { Clipper64, PolyPath64, ClipType } = this.core.clipper2;
        const clipper = new Clipper64();
        const solution = new PolyPath64();

        try {
            clipper.AddSubject(subjectPaths);
            clipper.AddClip(clipPaths);

            const success = clipper.ExecutePoly(ClipType.Xor, fillRule, solution);
            if (!success) throw new Error('PolyTree XOR failed');

            return this._polyTreeToStructured(solution);
        } finally {
            clipper.delete();
            solution.delete();
        }
    }

    /**
     * Convert PolyTree to structured JS object
     * Clipper2 PolyPath hierarchy:
     *   Level 0 (root children): Outer polygons
     *   Level 1: Holes in those outers
     *   Level 2: Islands (outers inside holes)
     *   etc.
     */
    _polyTreeToStructured(polyNode) {
        const scale = this.defaults?.config?.scale || 1000;
        const result = {
            polygons: [],
            totalHoles: 0,
            maxNestingLevel: 0
        };

        // Extract points from a PolyPath node
        const extractPoints = (node) => {
            const poly = node.polygon();
            if (!poly || poly.size() < 3) return null;
            
            const points = [];
            for (let i = 0; i < poly.size(); i++) {
                const pt = poly.get(i);
                points.push({
                    x: Number(pt.x) / scale,
                    y: Number(pt.y) / scale
                });
            }
            return points;
        };

        // Recursively process nodes
        const processNode = (node, level, parentPolygon) => {
            const points = extractPoints(node);
            if (!points) return;

            const isHole = level % 2 === 1;
            result.maxNestingLevel = Math.max(result.maxNestingLevel, level);

            if (isHole) {
                // This is a hole - add to parent's holes array
                result.totalHoles++;
                if (parentPolygon) {
                    parentPolygon.holes.push({
                        points,
                        nestingLevel: level,
                        isHole: true
                    });
                }

                // Process children (islands inside this hole)
                for (let i = 0; i < node.count(); i++) {
                    processNode(node.child(i), level + 1, parentPolygon);
                }
            } else {
                // This is an outer polygon (or island)
                const newPolygon = {
                    outer: {
                        points,
                        nestingLevel: level,
                        isHole: false
                    },
                    holes: [],
                    islands: []
                };

                if (level === 0) {
                    // Top-level polygon
                    result.polygons.push(newPolygon);
                } else if (parentPolygon) {
                    // Nested island
                    parentPolygon.islands.push(newPolygon);
                }

                // Process children (holes in this outer)
                for (let i = 0; i < node.count(); i++) {
                    processNode(node.child(i), level + 1, newPolygon);
                }
            }
        };

        // Process all root children (level 0 outers)
        for (let i = 0; i < polyNode.count(); i++) {
            processNode(polyNode.child(i), 0, null);
        }

        return result;
    }

     /**
     * Other Operations
     */

    offset(paths, delta, joinType = null, endType = null, miterLimit = null) {
        if (!this.core.initialized) throw new Error('Clipper2 not initialized');

        const { JoinType, EndType } = this.core.clipper2;
        joinType = joinType || JoinType.Round;
        endType = endType || EndType.Polygon;
        miterLimit = miterLimit || this.defaults?.config?.miterLimit || 10;

        const scaledDelta = delta * (this.defaults?.config?.scale || 1000);

        return this.core.trackObject(
            this.core.clipper2.InflatePaths64(paths, scaledDelta, joinType, endType, miterLimit, 0)
        );
    }

    simplify(paths, tolerance = 1.0, preserveCollinear = false) {
        if (!this.core.initialized) throw new Error('Clipper2 not initialized');

        const scaledTolerance = tolerance * (this.defaults?.config?.scale || 1000);

        return this.core.trackObject(
            this.core.clipper2.SimplifyPaths64(paths, scaledTolerance, preserveCollinear)
        );
    }

    minkowskiSum(pattern, path, pathIsClosed = true) {
        if (!this.core.initialized) throw new Error('Clipper2 not initialized');
        if (!this.core.clipper2.MinkowskiSum64) throw new Error('MinkowskiSum64 not available');

        return this.core.trackObject(
            this.core.clipper2.MinkowskiSum64(pattern, path, pathIsClosed)
        );
    }

    minkowskiDiff(pattern, path, pathIsClosed = true) {
        if (!this.core.initialized) throw new Error('Clipper2 not initialized');
        if (!this.core.clipper2.MinkowskiDiff64) throw new Error('MinkowskiDiff64 not available');

        return this.core.trackObject(
            this.core.clipper2.MinkowskiDiff64(pattern, path, pathIsClosed)
        );
    }

    countHoles(paths) {
        if (!this.geometry) return 0;
        const pathData = this.geometry.paths64ToCoordinates(paths);
        return pathData.filter(p => p.orientation === 'hole').length;
    }

    storeOperationStats(operation, stats) {
        if (!this.stats.has(operation)) this.stats.set(operation, []);
        const opStats = this.stats.get(operation);
        opStats.push({ timestamp: Date.now(), ...stats });
        if (opStats.length > 100) opStats.shift();
    }

    getOperationStats(operation = null) {
        if (operation) return this.stats.get(operation) || [];
        const all = {};
        this.stats.forEach((v, k) => all[k] = v);
        return all;
    }

    clearStats() {
        this.stats.clear();
    }
}