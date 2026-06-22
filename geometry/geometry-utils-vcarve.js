/*!
 * @file        geometry/geometry-utils-vcarve.js
 * @description Straight-skeleton generator for V-Carve toolpaths (3D centerline paths)
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 *
 * SPDX-FileCopyrightText: 2025-2026 Eltryus - Ricardo Marques
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Not Wired
(function() {
    'use strict';

    const C = window.CAMConfig.constants;
    const D = window.CAMConfig.defaults;
    const PRECISION = C.precision.coordinate;   // 0.001mm — node quantization grid
    const debugState = D.debug;

    // Numerical guards (module-local; promote to CAMConfig.constants.precision later if reused)
    const T_EPS    = 1e-7;   // wavefront time/distance epsilon
    const DEG_EPS  = 1e-12;  // degenerate-denominator guard

    // Vector helpers
    const sub   = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
    const dot   = (a, b) => a.x * b.x + a.y * b.y;
    const cross = (a, b) => a.x * b.y - a.y * b.x;
    const len   = (a) => Math.hypot(a.x, a.y);
    const norm  = (a) => { const l = len(a); return l < DEG_EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }; };

    // Min-heap keyed on event time (edge events win ties)
    class EventHeap {
        constructor() { this.items = []; }
        size() { return this.items.length; }
        less(a, b) {
            if (Math.abs(a.t - b.t) > T_EPS) return a.t < b.t;
            return a.type === 'edge' && b.type !== 'edge';
        }
        push(ev) {
            const arr = this.items;
            arr.push(ev);
            let i = arr.length - 1;
            while (i > 0) {
                const p = (i - 1) >> 1;
                if (this.less(arr[i], arr[p])) { [arr[i], arr[p]] = [arr[p], arr[i]]; i = p; }
                else break;
            }
        }
        pop() {
            const arr = this.items;
            const top = arr[0];
            const last = arr.pop();
            if (arr.length > 0) {
                arr[0] = last;
                let i = 0;
                while (true) {
                    const l = 2 * i + 1, r = 2 * i + 2;
                    let m = i;
                    if (l < arr.length && this.less(arr[l], arr[m])) m = l;
                    if (r < arr.length && this.less(arr[r], arr[m])) m = r;
                    if (m === i) break;
                    [arr[i], arr[m]] = [arr[m], arr[i]];
                    i = m;
                }
            }
            return top;
        }
    }

    /**
     * Straight-skeleton based V-Carve path generator.
     *
     * Algorithm: wavefront simulation (Felkel/Obdržálek style).
     *   Every boundary edge advances inward at unit speed. Vertices ride
     *   their angle bisectors. Two event types consume the wavefront:
     *     - Edge events:  two adjacent bisectors meet — an edge collapses.
     *     - Split events: a reflex vertex hits an opposite edge — the
     *       wavefront splits (or merges across a hole boundary; the
     *       pointer surgery is identical for both).
     *   Every skeleton node carries the wavefront time t, which IS the
     *   perpendicular distance to the nearest boundary. Depth follows:
     *       Z = -(startDepth + t / tan(vbitAngle / 2))
     *
     * Input contract:
     *   - One primitive = one connected region (outer + its holes).
     *     Disjoint regions must be passed as separate primitives —
     *     split-event validity cannot distinguish overlapping wedges of
     *     unrelated regions. (Handler enforces this via nesting merge.)
     *   - Contours are closed polylines. Arc tessellation has already
     *     happened upstream (arcSegments are metadata only).
     *   - contour.isHole flags are trusted when present.
     *
     * Output: array of PathPrimitive-like objects whose contour points
     * carry {x, y, z}. properties.is3DContour = true marks them for the
     * downstream pipeline (translator / optimizer / machine processor).
     *
     * Known limitations (v1, document in commit message):
     *   - Simultaneous events at identical t are processed sequentially;
     *     highly symmetric shapes (perfect squares) rely on epsilon
     *     tie-breaking. Quantized output hides sub-precision noise.
     *   - No "vertex events" (4+ bisectors meeting exactly): resolved as
     *     cascaded edge events, which is geometrically fine but can emit
     *     near-zero-length arcs (filtered at emission).
     *   - Split-event sign conventions assume CCW outers / CW holes;
     *     orientation is enforced in prepareContours.
     */

    // REVIEW - This is a weird way to do this?
    const VCarveGenerator = {

        // ═══════════════════════════════════════════════════════════
        // Public API
        // ═══════════════════════════════════════════════════════════

        /**
         * @param {Object} primitive  PathPrimitive (or convertible) — one region
         * @param {Object} options
         *   vbitAngle         {number} included angle in degrees (default 90)
         *   startDepth        {number} mm below surface where carving starts (default 0)
         *   maxDepth          {number|null} mm magnitude; Z is clamped to -maxDepth.
         *                     null disables clamping. Clamping only — flat-floor
         *                     CLEARING is a separate, future feature.
         *   simplifyTolerance {number} RDP pre-simplification in mm (default 0 = off).
         *                     Directly controls skeleton "spoke" density on
         *                     tessellated curves. Max sensible value ≈ a few × PRECISION.
         *   minChainLength    {number} drop output chains shorter than this (default 0 = keep all)
         * @returns {Array} PathPrimitive-like objects with {x,y,z} points
         */
        generateVCarvePaths(primitive, options = {}) {
            const vbitAngle = options.vbitAngle || 90;
            const startDepth = Math.max(0, options.startDepth || 0);
            const maxDepth = (options.maxDepth !== undefined && options.maxDepth !== null)
                ? Math.abs(options.maxDepth) : null;
            const simplifyTolerance = options.simplifyTolerance || 0;
            const minChainLength = options.minChainLength || 0;

            const tanHalf = Math.tan((vbitAngle * Math.PI / 180) / 2);
            if (!(tanHalf > DEG_EPS)) {
                console.error(`[VCarveGenerator] Invalid V-bit angle: ${vbitAngle}`);
                return [];
            }

            const contours = this.prepareContours(primitive, simplifyTolerance);
            if (contours.length === 0) {
                this.debug('No usable contours after preparation');
                return [];
            }

            const arcs = this.computeSkeleton(contours);
            this.debug(`Skeleton: ${arcs.length} arc(s) from ${contours.length} contour(s)`);
            if (arcs.length === 0) return [];

            const chains = this.chainArcs(arcs);
            this.debug(`Chained into ${chains.length} continuous path(s)`);

            return this.chainsToPrimitives(chains, tanHalf, startDepth, maxDepth, minChainLength);
        },

        // ═══════════════════════════════════════════════════════════
        // Stage 1 — Contour preparation
        // ═══════════════════════════════════════════════════════════

        prepareContours(primitive, simplifyTolerance) {
            let source = primitive;
            if (primitive.type !== 'path' && typeof GeometryUtils !== 'undefined'
                && GeometryUtils.primitiveToPath) {
                const converted = GeometryUtils.primitiveToPath(primitive);
                if (converted?.contours?.length > 0) source = converted;
            }
            if (!source.contours || source.contours.length === 0) return [];

            const prepared = [];
            for (const contour of source.contours) {
                let pts = (contour.points || []).map(p => ({ x: p.x, y: p.y }));
                if (pts.length < 3) continue;

                // Drop closing duplicate
                if (Math.hypot(pts[0].x - pts[pts.length - 1].x,
                               pts[0].y - pts[pts.length - 1].y) < PRECISION) {
                    pts.pop();
                }
                // Dedupe consecutive points
                pts = pts.filter((p, i) => {
                    if (i === 0) return true;
                    const q = pts[i - 1];
                    return Math.hypot(p.x - q.x, p.y - q.y) >= PRECISION;
                });
                if (pts.length < 3) continue;

                if (simplifyTolerance > 0) {
                    pts = this.simplifyRDP(pts, simplifyTolerance);
                    if (pts.length < 3) continue;
                }

                // Enforce orientation: outer CCW (area > 0), hole CW (area < 0).
                // With this convention the LEFT edge normal always points
                // into the material being carved.
                const isHole = contour.isHole === true;
                const area = this.signedArea(pts);
                if (Math.abs(area) < PRECISION * PRECISION) continue; // degenerate sliver
                if ((isHole && area > 0) || (!isHole && area < 0)) pts.reverse();

                prepared.push({ points: pts, isHole });
            }
            return prepared;
        },

        signedArea(pts) {
            let a = 0;
            for (let i = 0; i < pts.length; i++) {
                const p = pts[i], q = pts[(i + 1) % pts.length];
                a += p.x * q.y - q.x * p.y;
            }
            return a / 2;
        },

        /** Closed-loop Douglas-Peucker: anchors at the two most distant points, simplifies both halves. */
        simplifyRDP(pts, tolerance) {
            if (pts.length <= 4) return pts;
            // Find two mutually distant anchor indices (0 and farthest from 0)
            let far = 0, maxD = -1;
            for (let i = 1; i < pts.length; i++) {
                const d = (pts[i].x - pts[0].x) ** 2 + (pts[i].y - pts[0].y) ** 2;
                if (d > maxD) { maxD = d; far = i; }
            }
            const half1 = this.rdpOpen(pts.slice(0, far + 1), tolerance);
            const half2 = this.rdpOpen(pts.slice(far).concat([pts[0]]), tolerance);
            return half1.slice(0, -1).concat(half2.slice(0, -1));
        },

        rdpOpen(pts, tolerance) {
            if (pts.length <= 2) return pts;
            const first = pts[0], last = pts[pts.length - 1];
            let maxDist = 0, idx = 0;
            const dx = last.x - first.x, dy = last.y - first.y;
            const segLen = Math.hypot(dx, dy) || DEG_EPS;
            for (let i = 1; i < pts.length - 1; i++) {
                const d = Math.abs(dy * (pts[i].x - first.x) - dx * (pts[i].y - first.y)) / segLen;
                if (d > maxDist) { maxDist = d; idx = i; }
            }
            if (maxDist <= tolerance) return [first, last];
            const left = this.rdpOpen(pts.slice(0, idx + 1), tolerance);
            const right = this.rdpOpen(pts.slice(idx), tolerance);
            return left.slice(0, -1).concat(right);
        },

        // ═══════════════════════════════════════════════════════════
        // Stage 2 — Straight skeleton (wavefront simulation)
        // ═══════════════════════════════════════════════════════════

        /**
         * Computes the straight skeleton of one region (outer + holes).
         * Exposed publicly for testing / future 3D relief work.
         * @returns {Array} arcs: { x1, y1, t1, x2, y2, t2 }
         */
        computeSkeleton(contours) {
            const edges = [];        // all original edges (immutable)
            const liveVertices = []; // all wavefront vertices ever created
            const arcs = [];
            const heap = new EventHeap();

            // Build SLAV: one circular doubly-linked list per contour
            for (const contour of contours) {
                const pts = contour.points;
                const n = pts.length;
                const contourEdges = [];
                for (let i = 0; i < n; i++) {
                    const p = pts[i], q = pts[(i + 1) % n];
                    const d = norm(sub(q, p));
                    contourEdges.push({
                        p, q, dir: d,
                        normal: { x: -d.y, y: d.x },   // left normal = inward (CCW outer / CW hole)
                        bisP: null, bisQ: null          // endpoint bisectors, filled below
                    });
                }
                edges.push(...contourEdges);

                const contourVerts = [];
                for (let i = 0; i < n; i++) {
                    const eLeft = contourEdges[(i - 1 + n) % n];
                    const eRight = contourEdges[i];
                    const v = this.makeVertex(pts[i], eLeft, eRight, 0);
                    if (!v) {
                        this.debug(`Degenerate vertex at (${pts[i].x.toFixed(3)}, ${pts[i].y.toFixed(3)}) — contour skipped`);
                        contourVerts.length = 0;
                        break;
                    }
                    contourVerts.push(v);
                }
                if (contourVerts.length === 0) continue;

                for (let i = 0; i < contourVerts.length; i++) {
                    const v = contourVerts[i];
                    v.prev = contourVerts[(i - 1 + contourVerts.length) % contourVerts.length];
                    v.next = contourVerts[(i + 1) % contourVerts.length];
                    // Endpoint bisectors on the original edges (split-event wedge test)
                    v.edgeRight.bisP = norm(v.dir);
                    v.edgeLeft.bisQ = norm(v.dir);
                }
                liveVertices.push(...contourVerts);
            }
            if (liveVertices.length === 0) return arcs;

            // Initial events
            for (const v of liveVertices) {
                this.computeEdgeEvent(v, v.next, heap);
            }
            for (const v of liveVertices) {
                if (v.reflex) this.computeSplitEvents(v, edges, heap);
            }

            // Event loop
            const maxIterations = 100 * liveVertices.length + 1000;
            let iterations = 0;

            while (heap.size() > 0) {
                if (++iterations > maxIterations) {
                    console.warn(`[VCarveGenerator] Event-loop safeguard tripped (${maxIterations}). Returning partial skeleton.`);
                    break;
                }
                const ev = heap.pop();

                if (ev.type === 'edge') {
                    const { va, vb } = ev;
                    if (va.processed || vb.processed) continue;
                    if (va.next !== vb) continue;                 // stale topology

                    if (va.prev === vb) {
                        // Two-vertex loop closes
                        this.emitArc(arcs, va, ev.point, ev.t);
                        this.emitArc(arcs, vb, ev.point, ev.t);
                        va.processed = vb.processed = true;
                        continue;
                    }
                    if (va.prev === vb.next) {
                        // Triangle collapse — all three meet (numerically: close enough)
                        const vc = va.prev;
                        this.emitArc(arcs, va, ev.point, ev.t);
                        this.emitArc(arcs, vb, ev.point, ev.t);
                        this.emitArc(arcs, vc, ev.point, ev.t);
                        va.processed = vb.processed = vc.processed = true;
                        continue;
                    }

                    this.emitArc(arcs, va, ev.point, ev.t);
                    this.emitArc(arcs, vb, ev.point, ev.t);
                    va.processed = vb.processed = true;

                    const nv = this.makeVertex(ev.point, va.edgeLeft, vb.edgeRight, ev.t);
                    if (!nv) continue; // anti-parallel spike — wavefront dies here
                    nv.prev = va.prev; nv.next = vb.next;
                    va.prev.next = nv; vb.next.prev = nv;
                    liveVertices.push(nv);

                    this.computeEdgeEvent(nv.prev, nv, heap);
                    this.computeEdgeEvent(nv, nv.next, heap);
                    if (nv.reflex) this.computeSplitEvents(nv, edges, heap);

                } else {
                    // Split event
                    const v = ev.v;
                    if (v.processed) continue;

                    const pair = this.findSplitSegment(ev, liveVertices);
                    if (!pair) continue; // stale — segment no longer spans B
                    const { P, Q } = pair;
                    if (P === v || Q === v) continue;

                    this.emitArc(arcs, v, ev.point, ev.t);
                    const vPrev = v.prev, vNext = v.next;
                    v.processed = true;

                    const v1 = this.makeVertex(ev.point, v.edgeLeft, ev.edge, ev.t);
                    const v2 = this.makeVertex(ev.point, ev.edge, v.edgeRight, ev.t);

                    if (v1) {
                        v1.prev = vPrev; v1.next = Q;
                        vPrev.next = v1; Q.prev = v1;
                        liveVertices.push(v1);
                    }
                    if (v2) {
                        v2.prev = P; v2.next = vNext;
                        P.next = v2; vNext.prev = v2;
                        liveVertices.push(v2);
                    }
                    for (const nv of [v1, v2]) {
                        if (!nv) continue;
                        this.computeEdgeEvent(nv.prev, nv, heap);
                        this.computeEdgeEvent(nv, nv.next, heap);
                        if (nv.reflex) this.computeSplitEvents(nv, edges, heap);
                    }
                }
            }

            const orphans = liveVertices.filter(v => !v.processed).length;
            if (orphans > 0) {
                this.debug(`Skeleton finished with ${orphans} unprocessed vertices (degenerate input or epsilon collision)`);
            }
            return arcs;
        },

        /**
         * Wavefront vertex. position(t) = point + (t - time) * dir, where
         * dir = (nL + nR) / (1 + nL·nR) satisfies dir·nL = dir·nR = 1
         * (the vertex stays on both advancing edge lines).
         */
        makeVertex(point, edgeLeft, edgeRight, time) {
            const nL = edgeLeft.normal, nR = edgeRight.normal;
            const denom = 1 + dot(nL, nR);
            if (denom < DEG_EPS) return null; // anti-parallel edges (degenerate spike)
            return {
                point: { x: point.x, y: point.y },
                time,
                dir: { x: (nL.x + nR.x) / denom, y: (nL.y + nR.y) / denom },
                reflex: cross(edgeLeft.dir, edgeRight.dir) < -PRECISION,
                edgeLeft, edgeRight,
                prev: null, next: null,
                processed: false
            };
        },

        /** Edge event: adjacent bisector rays intersect; the shared edge collapses. */
        computeEdgeEvent(va, vb, heap) {
            if (!va || !vb || va.processed || vb.processed) return;
            const denom = cross(va.dir, vb.dir);
            if (Math.abs(denom) < DEG_EPS) return; // parallel bisectors — no meeting
            const dp = sub(vb.point, va.point);
            const a = cross(dp, vb.dir) / denom;   // time since va's creation
            const b = cross(dp, va.dir) / denom;   // time since vb's creation
            if (a < -T_EPS || b < -T_EPS) return;  // intersection behind a ray

            const I = { x: va.point.x + a * va.dir.x, y: va.point.y + a * va.dir.y };
            const E = va.edgeRight;                // shared collapsing edge
            const t = dot(sub(I, E.p), E.normal);  // absolute wavefront time
            if (t < Math.max(va.time, vb.time) - T_EPS) return;

            heap.push({ type: 'edge', t, point: I, va, vb });
        },

        /**
         * Split events: reflex vertex v hits the advancing front of a
         * non-adjacent original edge E. The collision time solves
         *   dist(position(t), line(E)) = t
         * and the collision point must lie within E's swept wedge
         * (between the bisectors of E's original endpoints).
         */
        computeSplitEvents(v, edges, heap) {
            for (const E of edges) {
                if (E === v.edgeLeft || E === v.edgeRight) continue;

                const k = dot(v.dir, E.normal);
                const denom = 1 - k;
                if (denom < DEG_EPS) continue;     // moving with the front, never catches it

                const d0 = dot(sub(v.point, E.p), E.normal);
                const t = (d0 - v.time * k) / denom;
                if (t < v.time - T_EPS) continue;

                const B = {
                    x: v.point.x + (t - v.time) * v.dir.x,
                    y: v.point.y + (t - v.time) * v.dir.y
                };

                // Wedge validity against the ORIGINAL edge geometry
                if (cross(E.dir, sub(B, E.p)) < -PRECISION) continue;            // interior side of E
                if (E.bisP && cross(E.bisP, sub(B, E.p)) > PRECISION) continue;  // inside start bisector
                if (E.bisQ && cross(E.bisQ, sub(B, E.q)) < -PRECISION) continue; // inside end bisector

                heap.push({ type: 'split', t, point: B, v, edge: E });
            }
        },

        /**
         * At pop time, locate the CURRENT wavefront segment of ev.edge
         * that spans the collision point (the original edge may have been
         * subdivided by earlier splits). Wedge test against the live
         * vertices' bisector rays.
         */
        findSplitSegment(ev, liveVertices) {
            const B = ev.point;
            for (const P of liveVertices) {
                if (P.processed || P.edgeRight !== ev.edge) continue;
                const Q = P.next;
                if (!Q || Q.processed || Q.edgeLeft !== ev.edge) continue;
                const bp = norm(P.dir), bq = norm(Q.dir);
                if (cross(bp, sub(B, P.point)) > PRECISION) continue;
                if (cross(bq, sub(B, Q.point)) < -PRECISION) continue;
                return { P, Q };
            }
            return null;
        },

        emitArc(arcs, v, point, t) {
            const dx = point.x - v.point.x, dy = point.y - v.point.y;
            if ((dx * dx + dy * dy) < PRECISION * PRECISION && Math.abs(t - v.time) < T_EPS) return;
            arcs.push({
                x1: v.point.x, y1: v.point.y, t1: v.time,
                x2: point.x,   y2: point.y,   t2: t
            });
        },

        // ═══════════════════════════════════════════════════════════
        // Stage 3 — Chain arcs into continuous polylines
        // ═══════════════════════════════════════════════════════════

        chainArcs(arcs) {
            const key = (x, y) =>
                `${Math.round(x / PRECISION)}_${Math.round(y / PRECISION)}`;

            // Node graph
            const nodes = new Map(); // key → { x, y, t, arcs: [{idx, otherKey}] }
            const getNode = (x, y, t) => {
                const k = key(x, y);
                let n = nodes.get(k);
                if (!n) { n = { x, y, t, arcs: [] }; nodes.set(k, n); }
                else if (t < n.t) n.t = t; // keep shallowest time seen at this node
                return { k, n };
            };

            arcs.forEach((arc, idx) => {
                const a = getNode(arc.x1, arc.y1, arc.t1);
                const b = getNode(arc.x2, arc.y2, arc.t2);
                if (a.k === b.k) return; // quantized to a point — drop
                a.n.arcs.push({ idx, otherKey: b.k });
                b.n.arcs.push({ idx, otherKey: a.k });
            });

            const used = new Set();
            const chains = [];

            const walk = (startKey) => {
                const chain = [];
                let currentKey = startKey;
                let node = nodes.get(currentKey);
                chain.push({ x: node.x, y: node.y, t: node.t });
                while (true) {
                    const next = node.arcs.find(a => !used.has(a.idx));
                    if (!next) break;
                    used.add(next.idx);
                    const arc = arcs[next.idx];
                    // Use the arc's own endpoint t for the point arrived at
                    const arriveAtP1 = key(arc.x1, arc.y1) === next.otherKey;
                    const px = arriveAtP1 ? arc.x1 : arc.x2;
                    const py = arriveAtP1 ? arc.y1 : arc.y2;
                    const pt = arriveAtP1 ? arc.t1 : arc.t2;
                    chain.push({ x: px, y: py, t: pt });
                    currentKey = next.otherKey;
                    node = nodes.get(currentKey);
                }
                return chain;
            };

            // Pass 1: start at odd-degree nodes, shallowest first
            // (chains begin at boundary corners → plunges happen at the surface)
            const endpoints = [...nodes.entries()]
                .filter(([, n]) => n.arcs.length % 2 === 1)
                .sort((a, b) => a[1].t - b[1].t);

            for (const [k, n] of endpoints) {
                while (n.arcs.some(a => !used.has(a.idx))) {
                    const chain = walk(k);
                    if (chain.length > 1) chains.push(chain);
                }
            }
            // Pass 2: leftover cycles / even components
            for (const [k, n] of nodes) {
                while (n.arcs.some(a => !used.has(a.idx))) {
                    const chain = walk(k);
                    if (chain.length > 1) chains.push(chain);
                }
            }

            // Prefer cutting shallow → deep
            for (const chain of chains) {
                if (chain[0].t > chain[chain.length - 1].t + T_EPS) chain.reverse();
            }
            return chains;
        },

        // ═══════════════════════════════════════════════════════════
        // Stage 4 — Depth mapping → PathPrimitives
        // ═══════════════════════════════════════════════════════════

        chainsToPrimitives(chains, tanHalf, startDepth, maxDepth, minChainLength) {
            const zOf = (t) => -(startDepth + t / tanHalf);
            const zFloor = (maxDepth !== null) ? -maxDepth : null;
            const out = [];

            for (const chain of chains) {
                if (minChainLength > 0) {
                    let l = 0;
                    for (let i = 1; i < chain.length; i++) {
                        l += Math.hypot(chain[i].x - chain[i - 1].x, chain[i].y - chain[i - 1].y);
                    }
                    if (l < minChainLength) continue;
                }

                const points = [];
                let prev = null;
                for (const node of chain) {
                    let z = zOf(node.t);
                    if (zFloor !== null && prev !== null) {
                        const zPrev = zOf(prev.t);
                        const prevClamped = zPrev < zFloor;
                        const currClamped = z < zFloor;
                        // Insert the exact crossing point so the clamped segment
                        // is geometrically correct, not just endpoint-clamped.
                        if (prevClamped !== currClamped && Math.abs(z - zPrev) > T_EPS) {
                            const f = (zFloor - zPrev) / (z - zPrev);
                            points.push({
                                x: prev.x + f * (node.x - prev.x),
                                y: prev.y + f * (node.y - prev.y),
                                z: zFloor
                            });
                        }
                    }
                    if (zFloor !== null && z < zFloor) z = zFloor;
                    points.push({ x: node.x, y: node.y, z });
                    prev = node;
                }
                if (points.length < 2) continue;

                const contour = {
                    points,
                    closed: false,
                    isHole: false,
                    nestingLevel: 0,
                    parentId: null,
                    arcSegments: [],
                    curveIds: []
                };
                const properties = {
                    isVCarve: true,
                    is3DContour: true,
                    role: 'vcarve_path',
                    stroke: true,
                    fill: false,
                    strokeWidth: 0
                };

                out.push(typeof PathPrimitive !== 'undefined'
                    ? new PathPrimitive([contour], properties)
                    : { type: 'path', contours: [contour], properties });
            }
            return out;
        },

        debug(message, data = null) {
            if (!debugState.enabled) return;
            data ? console.log(`[VCarveGenerator] ${message}`, data)
                 : console.log(`[VCarveGenerator] ${message}`);
        }
    };

    window.VCarveGenerator = VCarveGenerator;
})();