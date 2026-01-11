/**
 * @file        clipper2-tests.js
 * @description Tests Module
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 *
 * This module is part of the EasyTrace5000 Test Suite.
 * It interfaces with the Clipper2 library (Angus Johnson) via WASM (Erik Som).
 */

/*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2025-2026 Eltryus
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

class Clipper2Tests {
    constructor() {
        this.core = null;
        this.geometry = null;
        this.operations = null;
        this.rendering = null;
        this.ui = null;
        this.testData = new Map();
        this.defaults = Clipper2Defaults;
        this.arcReconstructor = null;
        this.rabbitPath = null;
        this.testStatus = new Map();

        this.testState = {
            boolean: {
                operation: 'union',
                clipShape: 'circle',
                subjectPos: { x: 400, y: 400 },
                clipPos: { x: 200, y: 200 },
                randomShape: null,
                usePolyTree: true
            },
            letterB: {},
            pcbFusion: {},
            nested: {
                island1Pos: { x: 300, y: 300 },
                island2Pos: { x: 500, y: 500 }
            },
            offset: { ...this.defaults.geometries.offset.defaults },
            simplify: { tolerance: this.defaults.geometries.simplify.defaultTolerance },
            area: { points: [], isDrawing: false, lastPolygonPath: null, animationFrameId: null },
            pip: { points: [], edgeTolerance: this.defaults.geometries.pip.edgeTolerance },
            minkowski: { ...this.defaults.geometries.minkowski.defaults },
            'arc-reconstruction': { ...this.defaults.geometries['arc-reconstruction'].defaults }
        };
    }

    async initialize() {
        try {
            this.core = new Clipper2Core();
            await this.core.initialize();

            this.geometry = new Clipper2Geometry(this.core);
            this.operations = new Clipper2Operations(this.core);
            this.rendering = new Clipper2Rendering(this.core);

            this.geometry.initialize(this.defaults);
            this.operations.initialize(this.defaults);
            this.rendering.initialize(this.defaults);

            this.operations.setGeometryModule(this.geometry);
            this.rendering.setGeometryModule(this.geometry);
            this.core.setConfig(this.defaults.config);

            this.initializeRabbitPath();

            const boolClip = this.defaults.geometries.boolean.clips.circle;
            this.testState.boolean.clipPos = { x: boolClip.initialPos[0], y: boolClip.initialPos[1] };

            console.log('[TESTS] Initialized');
            return true;
        } catch (e) {
            console.error('[TESTS] Init failed:', e);
            return false;
        }
    }

    initializeRabbitPath() {
        const def = this.defaults.geometries.boolean.clips.rabbit;
        if (!def?.path) return;

        try {
            const coords = this.geometry.parseSVGPath(def.path, def.scale || 0.3, [0, 0]);
            if (!coords.length) return;

            const bounds = this.getPathBounds(coords);
            const cx = (bounds.minX + bounds.maxX) / 2;
            const cy = (bounds.minY + bounds.maxY) / 2;
            
            this.rabbitPath = coords.map(pt => [pt[0] - cx, pt[1] - cy]);
            console.log('[TESTS] Rabbit path ready:', this.rabbitPath.length, 'points');
        } catch (e) {
            console.error('[TESTS] Rabbit parse failed:', e);
        }
    }

    getPathBounds(coords) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        coords.forEach(p => {
            const x = Array.isArray(p) ? p[0] : p.x;
            const y = Array.isArray(p) ? p[1] : p.y;
            minX = Math.min(minX, x); minY = Math.min(minY, y);
            maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        });
        return { minX, minY, maxX, maxY };
    }

    updateTestState(testName, key, value) {
        if (this.testState[testName]) {
            this.testState[testName][key] = value;
        }
    }

    getTestState(testName) {
        return this.testState[testName] || {};
    }

    setTestStatus(testName, status) {
        this.testStatus.set(testName, status);
        const card = document.querySelector(`[data-test="${testName}"]`);
        if (card) card.dataset.status = status;
    }

    /**
     * Boolean Operations Test
     */

    async testBooleanOperation() {
        const testName = 'boolean';
        this.setTestStatus(testName, 'pending');
        const trash = [];

        try {
            const state = this.getTestState(testName);
            const { operation, clipShape, subjectPos, clipPos, usePolyTree } = state;

            const subjectDef = this.defaults.geometries.boolean.subject;
            const subjectPath = this.geometry.coordinatesToPath64(subjectDef.data);
            const subjectPaths = new this.core.clipper2.Paths64();
            subjectPaths.push_back(subjectPath);
            trash.push(subjectPath, subjectPaths);

            let clipPath;
            if (clipShape === 'rabbit' && this.rabbitPath) {
                const coords = this.rabbitPath.map(pt => [pt[0] + clipPos.x, pt[1] + clipPos.y]);
                clipPath = this.geometry.coordinatesToPath64(coords);
            } else if (clipShape === 'random') {
                let rnd = state.randomShape;
                if (!rnd) {
                    const def = this.defaults.geometries.boolean.clips.random;
                    rnd = this.defaults.generators.randomConvex(0, 0, def.avgRadius, def.variance, def.points);
                    this.updateTestState('boolean', 'randomShape', rnd);
                }
                clipPath = this.geometry.coordinatesToPath64(rnd.map(pt => [pt[0] + clipPos.x, pt[1] + clipPos.y]));
            } else {
                const def = this.defaults.geometries.boolean.clips[clipShape];
                if (def.type === 'parametric') {
                    clipPath = this.geometry.parametricToPath64(def, { position: [clipPos.x, clipPos.y] });
                } else {
                    const coords = def.data.map(pt => [pt[0] + clipPos.x, pt[1] + clipPos.y]);
                    clipPath = this.geometry.coordinatesToPath64(coords);
                }
            }

            const clipPaths = new this.core.clipper2.Paths64();
            clipPaths.push_back(clipPath);
            trash.push(clipPath, clipPaths);

            this.testData.set(`${testName}-input`, subjectPaths);
            this.testData.set(`${testName}-clip`, clipPaths);

            let result, resultCount;

            if (usePolyTree) {
                switch (operation) {
                    case 'union': result = this.operations.unionPolyTree(subjectPaths, clipPaths); break;
                    case 'intersection': result = this.operations.intersectPolyTree(subjectPaths, clipPaths); break;
                    case 'difference': result = this.operations.differencePolyTree(subjectPaths, clipPaths); break;
                    case 'xor': result = this.operations.xorPolyTree(subjectPaths, clipPaths); break;
                }
                this.testData.set(`${testName}-output`, result);
                this.rendering.renderPolyTree(result, 'boolean-canvas', this.defaults.styles.output);
                resultCount = result.polygons.length;
            } else {
                switch (operation) {
                    case 'union': result = this.operations.union(subjectPaths, clipPaths); break;
                    case 'intersection': result = this.operations.intersect(subjectPaths, clipPaths); break;
                    case 'difference': result = this.operations.difference(subjectPaths, clipPaths); break;
                    case 'xor': result = this.operations.xor(subjectPaths, clipPaths); break;
                }
                trash.push(result);
                this.testData.set(`${testName}-output`, result);
                this.rendering.render(result, 'boolean-canvas', this.defaults.styles.output);
                resultCount = result.size();
            }

            this.setTestStatus(testName, 'success');
            this.ui?.updateResult('boolean-result', `[OK] ${operation.toUpperCase()}: ${resultCount} region(s)`);
            return { success: true, output: resultCount };

        } catch (e) {
            console.error('[ERROR] Boolean:', e);
            this.setTestStatus(testName, 'error');
            this.ui?.updateResult('boolean-result', `[ERROR] ${e.message}`, false);
            return { success: false, error: e.message };
        } finally {
            trash.forEach(o => o?.delete?.());
        }
    }

    /**
     * Letter B Test
     */

    async testLetterB() {
        const testName = 'letter-b';
        this.setTestStatus(testName, 'pending');
        const trash = [];

        try {
            const def = this.defaults.geometries.letterB;
            const strokes = this.geometry.toClipper2Paths(def);
            trash.push(strokes);

            this.testData.set(`${testName}-input`, strokes);

            const result = this.operations.unionPolyTree(strokes);
            this.testData.set(`${testName}-output`, result);

            this.rendering.renderPolyTree(result, 'letter-b-canvas', {
                fillOuter: 'var(--output-fill)',
                strokeOuter: 'var(--output-stroke)',
                strokeHole: 'var(--hole-stroke)',
                strokeWidth: 2
            });

            this.setTestStatus(testName, 'success');
            this.ui?.updateResult('letter-b-result', 
                `[OK] Letter B: ${result.polygons.length} polygon(s), ${result.totalHoles} hole(s)`);
            return { success: true };

        } catch (e) {
            console.error('[ERROR] Letter B:', e);
            this.setTestStatus(testName, 'error');
            this.ui?.updateResult('letter-b-result', `[ERROR] ${e.message}`, false);
            return { success: false };
        } finally {
            trash.forEach(o => o?.delete?.());
        }
    }

    /**
     * PCB Fusion Test
     */

    async testPCBFusion() {
        const testName = 'pcb-fusion';
        this.setTestStatus(testName, 'pending');
        const trash = [];

        try {
            const def = this.defaults.geometries.pcbFusion;
            const components = this.geometry.toClipper2Paths(def);
            trash.push(components);

            this.testData.set(`${testName}-input`, components);

            const result = this.operations.unionPolyTree(components);
            this.testData.set(`${testName}-output`, result);

            this.rendering.renderPolyTree(result, 'pcb-fusion-canvas', {
                fillOuter: 'var(--pcb-fill)',
                strokeOuter: 'var(--pcb-stroke)',
                strokeWidth: 2
            });

            this.setTestStatus(testName, 'success');
            this.ui?.updateResult('pcb-fusion-result', 
                `[OK] PCB: ${result.polygons.length} region(s), ${result.totalHoles} hole(s)`);
            return { success: true };

        } catch (e) {
            console.error('[ERROR] PCB:', e);
            this.setTestStatus(testName, 'error');
            return { success: false };
        } finally {
            trash.forEach(o => o?.delete?.());
        }
    }

    /**
     * Nested Structure Test
     */

    async testNestedStructure() {
        const testName = 'nested';
        this.setTestStatus(testName, 'pending');
        const trash = [];

        try {
            const state = this.getTestState(testName);
            const def = this.defaults.geometries.nested;

            const frameOuter = this.geometry.coordinatesToPath64(def.frame.outer);
            const frameInner = this.geometry.coordinatesToPath64(def.frame.inner);
            const frameOuterP = new this.core.clipper2.Paths64();
            const frameInnerP = new this.core.clipper2.Paths64();
            frameOuterP.push_back(frameOuter);
            frameInnerP.push_back(frameInner);
            trash.push(frameOuter, frameInner, frameOuterP, frameInnerP);

            const frame = this.operations.difference(frameOuterP, frameInnerP);
            trash.push(frame);

            const islands = new this.core.clipper2.Paths64();
            trash.push(islands);

            def.islands.forEach((iDef, idx) => {
                const pos = state[`island${idx + 1}Pos`];
                const dx = pos ? pos.x - iDef.outer[0][0] : 0;
                const dy = pos ? pos.y - iDef.outer[0][1] : 0;

                const oCoords = iDef.outer.map(pt => [pt[0] + dx, pt[1] + dy]);
                const iCoords = iDef.inner.map(pt => [pt[0] + dx, pt[1] + dy]);

                const oPath = this.geometry.coordinatesToPath64(oCoords);
                const iPath = this.geometry.coordinatesToPath64(iCoords);
                const oP = new this.core.clipper2.Paths64();
                const iP = new this.core.clipper2.Paths64();
                oP.push_back(oPath);
                iP.push_back(iPath);
                trash.push(oPath, iPath, oP, iP);

                const island = this.operations.difference(oP, iP);
                for (let k = 0; k < island.size(); k++) islands.push_back(island.get(k));
                trash.push(island);
            });

            const result = this.operations.unionPolyTree(frame, islands);
            this.testData.set(`${testName}-output`, result);

            this.rendering.renderPolyTree(result, 'nested-canvas', this.defaults.styles.output);

            this.setTestStatus(testName, 'success');
            this.ui?.updateResult('nested-result', 
                `[OK] Nested: ${result.polygons.length} polygon(s), ${result.totalHoles} hole(s)`);
            return { success: true };

        } catch (e) {
            console.error('[ERROR] Nested:', e);
            this.setTestStatus(testName, 'error');
            return { success: false };
        } finally {
            trash.forEach(o => o?.delete?.());
        }
    }

    /**
     * Simplify Test
     */

    async testSimplify() {
        const testName = 'simplify';
        this.setTestStatus(testName, 'pending');
        const trash = [];

        try {
            const state = this.getTestState(testName);
            const def = this.defaults.geometries.simplify;

            const coords = this.geometry.parseSVGPath(def.path, def.scale, def.position);
            const path = this.geometry.coordinatesToPath64(coords);
            const paths = new this.core.clipper2.Paths64();
            paths.push_back(path);
            trash.push(path, paths);

            this.testData.set(`${testName}-input`, paths);

            const result = this.operations.simplify(paths, state.tolerance || def.defaultTolerance);
            trash.push(result);
            this.testData.set(`${testName}-output`, result);

            const origPts = path.size();
            let simpPts = 0;
            for (let i = 0; i < result.size(); i++) simpPts += result.get(i).size();

            this.rendering.clearCanvas('simplify-canvas');

            this.rendering.render(paths, 'simplify-canvas', {
                fillOuter: 'none',
                strokeOuter: '#d1d5db',
                strokeWidth: 4,
                clear: false
            });

            this.rendering.render(result, 'simplify-canvas', {
                fillOuter: 'var(--output-fill)',
                strokeOuter: 'var(--output-stroke)',
                strokeWidth: 2,
                clear: false
            });

            const reduction = origPts > 0 ? Math.round((1 - simpPts / origPts) * 100) : 0;

            this.setTestStatus(testName, 'success');
            this.ui?.updateResult('simplify-result', 
                `[OK] ${origPts} → ${simpPts} points (${reduction}% reduction)`);
            return { success: true };

        } catch (e) {
            console.error('[ERROR] Simplify:', e);
            this.setTestStatus(testName, 'error');
            return { success: false };
        } finally {
            trash.forEach(o => o?.delete?.());
        }
    }

    /**
     * Offset Test
     */

    async testOffset() {
        const testName = 'offset';
        this.setTestStatus(testName, 'pending');
        const trash = [];

        try {
            const state = this.getTestState(testName);
            const { shape, type, count, distance, joinType, miterLimit } = state;
            const shapeDef = this.defaults.geometries.offset.shapes[shape];

            let basePath;
            if (shapeDef.type === 'parametric') {
                basePath = this.geometry.parametricToPath64(shapeDef);
            } else {
                basePath = this.geometry.polygonToPath64(shapeDef);
            }
            trash.push(basePath);

            const paths = new this.core.clipper2.Paths64();
            paths.push_back(basePath);
            trash.push(paths);

            this.testData.set(`${testName}-input`, paths);

            const joinEnum = this.getJoinTypeEnum(joinType);
            const endEnum = this.core.clipper2.EndType.Polygon;
            const actualDist = type === 'internal' ? -Math.abs(distance) : Math.abs(distance);

            const results = [];
            for (let i = 1; i <= count; i++) {
                const r = this.operations.offset(paths, actualDist * i, joinEnum, endEnum, miterLimit);
                results.push(r);
                trash.push(r);
            }

            this.rendering.drawOffsetPaths(results, 'offset-canvas', type, paths);

            if (results.length) this.testData.set(`${testName}-output`, results[results.length - 1]);

            this.setTestStatus(testName, 'success');
            this.ui?.updateResult('offset-result', 
                `[OK] ${type} offset: ${count} iterations at ${distance}px`);
            return { success: true };

        } catch (e) {
            console.error('[ERROR] Offset:', e);
            this.setTestStatus(testName, 'error');
            return { success: false };
        } finally {
            trash.forEach(o => o?.delete?.());
        }
    }

    /**
     * Minkowski Test
     */

    async testMinkowski() {
        const testName = 'minkowski';
        this.setTestStatus(testName, 'pending');
        const trash = [];

        try {
            if (!this.core.clipper2.MinkowskiSum64) throw new Error('Minkowski not available');

            const state = this.getTestState(testName);
            const { pattern, path: pathName, operation, showSweep, showOffset } = state;

            const patternDef = this.defaults.geometries.minkowski.patterns[pattern];
            const pathDef = this.defaults.geometries.minkowski.paths[pathName];

            let patternCoords = patternDef.type === 'parametric' 
                ? this.getParametricCoords({ ...patternDef, center: [0, 0] })
                : patternDef.data;

            let pathCoords = pathDef.type === 'parametric'
                ? this.getParametricCoords(pathDef)
                : pathDef.data;

            const patternPath = this.geometry.coordinatesToPath64(patternCoords);
            const pathPath = this.geometry.coordinatesToPath64(pathCoords);
            trash.push(patternPath, pathPath);

            this.operations.normalizePathWinding(patternPath);
            this.operations.normalizePathWinding(pathPath);

            const isClosed = pathDef.isClosed !== undefined ? pathDef.isClosed : true;

            let result = operation === 'sum'
                ? this.operations.minkowskiSum(patternPath, pathPath, isClosed)
                : this.operations.minkowskiDiff(patternPath, pathPath, isClosed);
            trash.push(result);

            let visualResult = result;
            if (operation === 'diff' && isClosed) {
                const pathP = new this.core.clipper2.Paths64();
                pathP.push_back(pathPath);
                trash.push(pathP);
                visualResult = this.operations.difference(pathP, result);
                trash.push(visualResult);
            }

            this.testData.set(`${testName}-output`, visualResult);

            const canvas = document.getElementById('minkowski-canvas');
            this.rendering.clearCanvas(canvas);

            if (showSweep) this.drawMinkowskiSweep(canvas, patternCoords, pathCoords, operation);

            const pathP = new this.core.clipper2.Paths64();
            pathP.push_back(pathPath);
            trash.push(pathP);

            this.rendering.render(pathP, canvas, {
                fillOuter: 'none',
                strokeOuter: '#6b7280',
                strokeWidth: 2,
                clear: false
            });

            const style = operation === 'sum' 
                ? this.defaults.styles.minkowski.sumResult 
                : this.defaults.styles.minkowski.diffResult;

            this.rendering.render(visualResult, canvas, { ...style, strokeWidth: 2, clear: false });

            if (showOffset) {
                const eqRadius = this.calculateEquivalentRadius(patternCoords, patternDef);
                const offP = new this.core.clipper2.Paths64();
                offP.push_back(pathPath);
                trash.push(offP);

                const delta = operation === 'sum' ? eqRadius : -eqRadius;
                const offsetRes = this.operations.offset(offP, delta, 
                    this.core.clipper2.JoinType.Round,
                    isClosed ? this.core.clipper2.EndType.Polygon : this.core.clipper2.EndType.Round);
                trash.push(offsetRes);

                const ctx = canvas.getContext('2d');
                ctx.save();
                ctx.strokeStyle = '#f59e0b';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);

                for (let i = 0; i < offsetRes.size(); i++) {
                    const p = offsetRes.get(i);
                    ctx.beginPath();
                    for (let j = 0; j < p.size(); j++) {
                        const pt = p.get(j);
                        const x = Number(pt.x) / this.core.config.scale;
                        const y = Number(pt.y) / this.core.config.scale;
                        j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
                    }
                    ctx.closePath();
                    ctx.stroke();
                }
                ctx.restore();
            }

            this.setTestStatus(testName, 'success');
            this.ui?.updateResult('minkowski-result', 
                `[OK] Minkowski ${operation}: ${visualResult.size()} path(s)`);
            return { success: true };

        } catch (e) {
            console.error('[ERROR] Minkowski:', e);
            this.setTestStatus(testName, 'error');
            return { success: false };
        } finally {
            trash.forEach(o => o?.delete?.());
        }
    }

    drawMinkowskiSweep(canvas, patternCoords, pathCoords, operation) {
        const ctx = canvas.getContext('2d');
        const color = operation === 'sum' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)';
        const pattern = operation === 'sum' ? patternCoords : patternCoords.map(p => [-p[0], -p[1]]);

        ctx.save();
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.3;

        pathCoords.forEach((pos, idx) => {
            ctx.beginPath();
            ctx.arc(pos[0], pos[1], 1.5, 0, Math.PI * 2);
            ctx.fill();

            if (idx % 6 === 0) {
                ctx.globalAlpha = 0.08;
                ctx.beginPath();
                pattern.forEach((pt, j) => {
                    const x = pt[0] + pos[0], y = pt[1] + pos[1];
                    j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
                });
                ctx.closePath();
                ctx.stroke();
                ctx.globalAlpha = 1;
            }
        });
        ctx.restore();
    }

    calculateEquivalentRadius(coords, def) {
        if (def?.equivalentRadius) return def.equivalentRadius;
        let cx = 0, cy = 0;
        coords.forEach(p => { cx += p[0]; cy += p[1]; });
        cx /= coords.length; cy /= coords.length;
        let max = 0;
        coords.forEach(p => { max = Math.max(max, Math.hypot(p[0] - cx, p[1] - cy)); });
        return max;
    }

    getParametricCoords(def) {
        const pos = def.center || [0, 0];
        if (def.shape === 'circle') return this.defaults.generators.circle(pos[0], pos[1], def.radius, 32);
        if (def.shape === 'star') return this.defaults.generators.star(pos[0], pos[1], def.outerRadius, def.innerRadius, def.points);
        return [];
    }

    /**
     * Point in Polygon Test
     */

    async testPointInPolygon() {
        const testName = 'pip';
        this.setTestStatus(testName, 'pending');

        try {
            const def = this.defaults.geometries.pip;
            const polygon = this.geometry.coordinatesToPath64(def.data);
            this.testData.set('pip-polygon', polygon);

            const paths = new this.core.clipper2.Paths64();
            paths.push_back(polygon);
            this.rendering.render(paths, 'pip-canvas', this.defaults.styles.default);
            paths.delete();

            const ctx = document.getElementById('pip-canvas')?.getContext('2d');
            if (ctx) {
                ctx.font = '12px Arial';
                ctx.fillStyle = '#6b7280';
                ctx.fillText('Click to add test points', 10, 20);
            }

            this.setTestStatus(testName, '');
            this.ui?.updateResult('pip-result', 'Click to add test points');
            return { success: true };
        } catch (e) {
            console.error('[ERROR] PIP:', e);
            this.setTestStatus(testName, 'error');
            return { success: false };
        }
    }

    checkPointLocations() {
        const polygon = this.testData.get('pip-polygon');
        const points = this.testState.pip.points;

        if (!polygon) {
            this.testPointInPolygon().then(() => points?.length && this.checkPointLocations());
            return;
        }

        if (!points?.length) {
            this.ui?.updateResult('pip-result', 'No points to check');
            return;
        }

        const canvas = document.getElementById('pip-canvas');
        const ctx = canvas.getContext('2d');
        const scale = this.core.config.scale;

        const paths = new this.core.clipper2.Paths64();
        paths.push_back(polygon);
        this.rendering.render(paths, 'pip-canvas', this.defaults.styles.default);
        paths.delete();

        const { PointInPolygonResult } = this.core.clipper2;
        const IsOn = PointInPolygonResult.IsOn.value;
        const IsInside = PointInPolygonResult.IsInside.value;
        const tol = this.testState.pip.edgeTolerance;

        const results = [];

        points.forEach(pt => {
            const testPt = new this.core.clipper2.Point64(
                BigInt(Math.round(pt.x * scale)),
                BigInt(Math.round(pt.y * scale)), BigInt(0));

            const res = this.core.clipper2.PointInPolygon64(testPt, polygon).value;
            testPt.delete();

            let isNearEdge = false;
            if (res !== IsOn) {
                const offsets = [[-tol, 0], [tol, 0], [0, -tol], [0, tol]];
                let ins = 0, out = 0;
                offsets.forEach(([dx, dy]) => {
                    const np = new this.core.clipper2.Point64(
                        BigInt(Math.round((pt.x + dx) * scale)),
                        BigInt(Math.round((pt.y + dy) * scale)), BigInt(0));
                    const nr = this.core.clipper2.PointInPolygon64(np, polygon).value;
                    np.delete();
                    if (nr === IsInside) ins++; else out++;
                });
                isNearEdge = ins > 0 && out > 0;
            }

            let status, color;
            if (res === IsOn || isNearEdge) {
                status = 'ON EDGE'; color = this.rendering.getCSSVar('--pip-edge') || '#f59e0b';
            } else if (res === IsInside) {
                status = 'INSIDE'; color = this.rendering.getCSSVar('--pip-inside') || '#10b981';
            } else {
                status = 'OUTSIDE'; color = this.rendering.getCSSVar('--pip-outside') || '#ef4444';
            }

            pt.status = status;

            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.stroke();

            results.push(`(${Math.round(pt.x)}, ${Math.round(pt.y)}): ${status}`);
        });

        this.setTestStatus('pip', 'success');
        this.ui?.updateResult('pip-result', `Checked ${points.length} points:\n${results.join('\n')}`);
    }

    /**
     * Area Test
     */

    initializeAreaTest() {
        const canvas = document.getElementById('area-canvas');
        if (!canvas) return;

        if (this.testState.area.animationFrameId) {
            cancelAnimationFrame(this.testState.area.animationFrameId);
        }

        this.rendering.clearCanvas(canvas);
        this.rendering.drawGrid(canvas, this.defaults.geometries.area.gridSize);

        this.testState.area = { points: [], isDrawing: true, lastPolygonPath: null, animationFrameId: null };

        const ctx = canvas.getContext('2d');
        ctx.setLineDash([]);  // Reset dashed line from previous calculation
        ctx.font = '14px Arial';
        ctx.fillStyle = this.rendering.getCSSVar('--text') || '#374151';
        ctx.fillText('Click to add points (min 3), then Calculate', 10, 25);

        this.ui?.updateResult('area-result', 'Click points to draw polygon');
    }

    calculateArea() {
        const def = this.defaults.geometries.area;
        if (this.testState.area.points.length < def.minPoints) {
            this.ui?.updateResult('area-result', `Need at least ${def.minPoints} points`);
            return;
        }

        this.testState.area.isDrawing = false;
        const canvas = document.getElementById('area-canvas');
        const ctx = canvas.getContext('2d');
        const coords = this.testState.area.points.map(p => [p.x, p.y]);

        // Calculate area
        const path = this.geometry.coordinatesToPath64(coords, { autoFixWinding: false });
        const scaledArea = this.core.clipper2.AreaPath64(path);
        const area = scaledArea / (this.core.config.scale * this.core.config.scale);
        path.delete();

        const isCCW = area < 0;
        const orientation = isCCW ? 'COUNTER-CLOCKWISE' : 'CLOCKWISE';
        const absArea = Math.abs(area);
        const strokeColor = isCCW ? '#10b981' : '#ef4444';

        // Clear and redraw
        this.rendering.clearCanvas(canvas);
        this.rendering.drawGrid(canvas, def.gridSize);

        // Fill polygon
        ctx.fillStyle = isCCW ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)';
        ctx.beginPath();
        coords.forEach((p, i) => i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]));
        ctx.closePath();
        ctx.fill();

        // Stroke polygon
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 3;
        ctx.setLineDash([]);
        ctx.beginPath();
        coords.forEach((p, i) => i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]));
        ctx.closePath();
        ctx.stroke();

        // Draw winding arrows on each edge
        ctx.fillStyle = strokeColor;
        for (let i = 0; i < coords.length; i++) {
            const p1 = coords[i];
            const p2 = coords[(i + 1) % coords.length];

            // Midpoint of edge
            const mx = (p1[0] + p2[0]) / 2;
            const my = (p1[1] + p2[1]) / 2;

            // Direction angle
            const angle = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);

            // Draw arrow
            const arrowSize = 8;
            ctx.save();
            ctx.translate(mx, my);
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(arrowSize, 0);
            ctx.lineTo(-arrowSize, -arrowSize * 0.6);
            ctx.lineTo(-arrowSize, arrowSize * 0.6);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }

        // Redraw points on top
        const pointColor = this.rendering.resolveStyleValue('var(--shape-stroke)') || '#3b82f6';
        ctx.fillStyle = pointColor;
        this.testState.area.points.forEach(pt => {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, def.pointRadius, 0, Math.PI * 2);
            ctx.fill();
        });

        this.setTestStatus('area', 'success');
        this.ui?.updateResult('area-result', `[OK] Area: ${absArea.toFixed(0)} px² | ${orientation}`);
    }

    /**
     * Arc Reconstruction Test
     */

    async testArcReconstruction() {
        const testName = 'arc-reconstruction';
        this.setTestStatus(testName, 'pending');

        try {
            if (!this.arcReconstructor) {
                this.arcReconstructor = new ArcReconstructor(this.core, this.geometry, this.defaults);
            }

            const state = this.getTestState(testName);
            const shapes = [
                { type: 'circle', center: { x: state.circle1Pos.x, y: state.circle1Pos.y }, radius: state.circle1Radius },
                { type: 'circle', center: { x: state.circle2Pos.x, y: state.circle2Pos.y }, radius: state.circle2Radius }
            ];

            const result = this.arcReconstructor.processWithReconstruction(shapes, state.operation);

            const canvas = document.getElementById('arc-reconstruction-canvas');
            this.rendering.clearCanvas(canvas);
            this.rendering.drawGrid(canvas, 20);

            // Render result polygons
            if (result.polygons && result.polygons.length > 0) {
                this.rendering.render(result.polygons, canvas, {
                    fillOuter: 'rgba(59,130,246,0.2)',
                    strokeOuter: '#3b82f6',
                    strokeWidth: 1,
                    clear: false
                });
            }

            // Draw reconstructed curves overlay
            if (state.showReconstruction && result.reconstructedCurves?.length) {
                this.arcReconstructor.drawReconstructedCurves(result.reconstructedCurves, canvas, {
                    strokeColor: '#ff9900',
                    lineWidth: 3
                });
            }

            const stats = result.stats;
            const statsText = state.showMetadata 
                ? `\nGroups: ${stats.curveGroups}, Points: ${stats.survivingPoints}/${stats.totalPointsProcessed}`
                : '';

            this.setTestStatus(testName, 'success');
            this.ui?.updateResult('arc-reconstruction-result', 
                `[OK] ${stats.fullCircles} circle(s), ${stats.partialArcs} arc(s) reconstructed${statsText}`);
            return { success: true };

        } catch (e) {
            console.error('[ERROR] Arc:', e);
            this.setTestStatus(testName, 'error');
            this.ui?.updateResult('arc-reconstruction-result', `[ERROR] ${e.message}`);
            return { success: false };
        }
    }

    /**
     * Helpers
     */

    getJoinTypeEnum(joinType) {
        const { JoinType } = this.core.clipper2;
        if (joinType === 'Miter') return JoinType.Miter;
        if (joinType === 'Square') return JoinType.Square;
        return JoinType.Round;
    }

    formatGeometryInfo(paths) {
        if (!paths?.size) return 'No paths';
        const data = this.geometry.paths64ToCoordinates(paths);
        return `${paths.size()} paths, ${data.reduce((s, p) => s + p.coords.length, 0)} total points`;
    }

    /**
     * Default Drawing Methods
     */

    drawDefaultBoolean() {
        this.ui?.redrawDraggableCanvas('boolean');
    }

    drawDefaultLetterB() {
        const def = this.defaults.geometries.letterB;
        this.rendering.drawStrokes(def, 'letter-b-canvas', { style: this.defaults.styles.default });
    }

    drawDefaultNested() {
        this.ui?.redrawDraggableCanvas('nested');
    }

    drawDefaultOffset() {
        const state = this.getTestState('offset');
        const def = this.defaults.geometries.offset.shapes[state.shape];

        let coords;
        if (def.type === 'parametric') {
            if (def.shape === 'star') {
                coords = this.defaults.generators.star(def.center[0], def.center[1], def.outerRadius, def.innerRadius, def.points);
            } else if (def.shape === 'circle') {
                coords = this.defaults.generators.circle(def.center[0], def.center[1], def.radius);
            }
        } else {
            coords = def.data;
        }

        if (coords) {
            this.rendering.drawSimplePaths([coords], 'offset-canvas', this.defaults.styles.default);
        }
    }

    drawDefaultSimplify() {
        const def = this.defaults.geometries.simplify;
        const coords = this.geometry.parseSVGPath(def.path, def.scale, def.position);
        if (coords?.length) {
            this.rendering.drawSimplePaths([coords], 'simplify-canvas', this.defaults.styles.default);
        }
    }

    drawDefaultPCB() {
        const def = this.defaults.geometries.pcbFusion;
        this.rendering.drawStrokes(def, 'pcb-fusion-canvas', { style: this.defaults.styles.pcb });
    }

    drawDefaultPIP() {
        const def = this.defaults.geometries.pip;
        this.rendering.drawSimplePaths([def.data], 'pip-canvas', this.defaults.styles.default);

        const ctx = document.getElementById('pip-canvas')?.getContext('2d');
        if (ctx) {
            ctx.font = '12px Arial';
            ctx.fillStyle = '#6b7280';
            ctx.fillText('Click to add test points', 10, 20);
        }
    }

    drawDefaultMinkowski() {
        const canvas = document.getElementById('minkowski-canvas');
        if (!canvas) return;

        const state = this.getTestState('minkowski');
        const patternDef = this.defaults.geometries.minkowski.patterns[state.pattern];
        const pathDef = this.defaults.geometries.minkowski.paths[state.path];

        this.rendering.clearCanvas(canvas);

        if (pathDef) {
            this.rendering.drawSimplePaths([pathDef.data], canvas, {
                fillOuter: 'none',
                strokeOuter: '#6b7280',
                strokeWidth: 2,
                clear: false
            });
        }

        if (patternDef) {
            let coords;
            if (patternDef.type === 'parametric') {
                coords = this.defaults.generators[patternDef.shape](
                    100, 200,
                    patternDef.radius || patternDef.outerRadius,
                    patternDef.innerRadius,
                    patternDef.points
                );
            } else {
                coords = patternDef.data.map(pt => [pt[0] + 100, pt[1] + 200]);
            }

            this.rendering.drawSimplePaths([coords], canvas, {
                fillOuter: 'none',
                strokeOuter: '#3b82f6',
                strokeWidth: 2,
                clear: false
            });
        }
    }

    drawDefaultArea() {
        if (!this.testState.area.isDrawing) {
            this.initializeAreaTest();
        }
    }

    drawDefaultArcReconstruction() {
        const canvas = document.getElementById('arc-reconstruction-canvas');
        if (!canvas) return;

        const state = this.getTestState('arc-reconstruction');

        this.rendering.clearCanvas(canvas);
        this.rendering.drawGrid(canvas, this.defaults.config.gridSize);

        const ctx = canvas.getContext('2d');

        // Circle 1
        ctx.strokeStyle = '#3b82f6';
        ctx.fillStyle = 'rgba(59,130,246,0.2)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(state.circle1Pos.x, state.circle1Pos.y, state.circle1Radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Circle 2
        ctx.strokeStyle = '#10b981';
        ctx.fillStyle = 'rgba(16,185,129,0.2)';
        ctx.beginPath();
        ctx.arc(state.circle2Pos.x, state.circle2Pos.y, state.circle2Radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.font = '12px Arial';
        ctx.fillStyle = '#6b7280';
        ctx.textAlign = 'left';
        ctx.fillText('Drag circles to position', 10, 20);
    }

    /**
     * Reset
     */

    resetTest(testName) {
        this.testData.delete(`${testName}-output`);
        this.setTestStatus(testName, '');

        switch (testName) {
            case 'boolean':
                const bDef = this.defaults.geometries.boolean.clips.circle;
                this.testState.boolean = {
                    operation: 'union',
                    clipShape: 'circle',
                    subjectPos: { x: 400, y: 400 },
                    clipPos: { x: bDef.initialPos[0], y: bDef.initialPos[1] },
                    randomShape: null,
                    usePolyTree: true
                };
                this.drawDefaultBoolean();
                break;

            case 'letter-b':
                this.drawDefaultLetterB();
                break;

            case 'pcb-fusion':
                this.drawDefaultPCB();
                break;

            case 'nested':
                this.testState.nested = { island1Pos: { x: 300, y: 300 }, island2Pos: { x: 500, y: 500 } };
                this.drawDefaultNested();
                break;

            case 'offset':
                this.testState.offset = { ...this.defaults.geometries.offset.defaults };
                this.drawDefaultOffset();
                break;

            case 'simplify':
                this.testState.simplify = { tolerance: this.defaults.geometries.simplify.defaultTolerance };
                this.drawDefaultSimplify();
                break;

            case 'pip':
                this.testState.pip = { points: [], edgeTolerance: this.defaults.geometries.pip.edgeTolerance };
                this.testData.delete('pip-polygon');
                this.drawDefaultPIP();
                break;

            case 'area':
                if (this.testState.area.animationFrameId) {
                    cancelAnimationFrame(this.testState.area.animationFrameId);
                }
                this.testState.area = { points: [], isDrawing: false, lastPolygonPath: null, animationFrameId: null };
                this.initializeAreaTest();
                break;

            case 'minkowski':
                this.testState.minkowski = { ...this.defaults.geometries.minkowski.defaults };
                this.drawDefaultMinkowski();
                break;

            case 'arc-reconstruction':
                this.testState['arc-reconstruction'] = { ...this.defaults.geometries['arc-reconstruction'].defaults };
                this.drawDefaultArcReconstruction();
                break;
        }

        this.ui?.updateResult(`${testName}-result`, this.defaults.labels.ready);
        this.ui?.resetView(testName);

        const infoEl = document.getElementById(`${testName}-info`);
        if (infoEl) infoEl.textContent = '';
    }

    exportSVG(testName, dataType = 'output') {
        let data, filename;

        if (dataType === 'input') {
            filename = `clipper2-${testName}-input.svg`;
            data = this.testData.get(`${testName}-input`) || this.testData.get('pip-polygon');
        } else if (dataType === 'raw') {
            filename = `clipper2-${testName}-raw.svg`;
            data = this.getRawGeometry(testName);
        } else {
            filename = `clipper2-${testName}-output.svg`;
            data = this.testData.get(`${testName}-output`);
        }

        if (!data) {
            alert(`No ${dataType} data. Run test first.`);
            return;
        }

        const svg = this.rendering.exportSVG(data);
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    getRawGeometry(testName) {
        const geoms = this.defaults.geometries;
        const paths = new this.core.clipper2.Paths64();

        try {
            switch (testName) {
                case 'boolean':
                    paths.push_back(this.geometry.coordinatesToPath64(geoms.boolean.subject.data));
                    break;
                case 'offset':
                    const shape = geoms.offset.shapes[this.testState.offset.shape];
                    if (shape.type === 'parametric') {
                        paths.push_back(this.geometry.parametricToPath64(shape));
                    } else {
                        paths.push_back(this.geometry.polygonToPath64(shape));
                    }
                    break;
                case 'simplify':
                    const coords = this.geometry.parseSVGPath(geoms.simplify.path, geoms.simplify.scale, geoms.simplify.position);
                    paths.push_back(this.geometry.coordinatesToPath64(coords));
                    break;
                case 'pip':
                    paths.push_back(this.geometry.coordinatesToPath64(geoms.pip.data));
                    break;
                default:
                    return null;
            }
            return paths;
        } catch (e) {
            console.error('[ERROR] getRawGeometry:', e);
            return null;
        }
    }
}