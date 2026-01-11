/**
 * @file        geometry/geometry-curve-registry.js
 * @description Curve Registry required for arc-reconstruction
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
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

(function() {
    'use strict';

    const config = window.PCBCAMConfig;
    const geomConfig = config.geometry;

    class GlobalCurveRegistry {
        constructor() {
            this.registry = new Map();
            this.hashToId = new Map();
            this.primitiveIdToCurves = new Map();
            this.offsetCurveMap = new Map();
            this.nextId = 1;
            this.hashPrecision = geomConfig.curveRegistry?.hashPrecision || 1000;

            // Statistics
            this.stats = {
                registered: 0,
                circles: 0,
                arcs: 0,
                endCaps: 0,
                offsetDerived: 0
            };
        }

        generateHash(metadata) {
            const roundedCenter = {
                x: Math.round(metadata.center.x * this.hashPrecision) / this.hashPrecision,
                y: Math.round(metadata.center.y * this.hashPrecision) / this.hashPrecision
            };
            const roundedRadius = Math.round(metadata.radius * this.hashPrecision) / this.hashPrecision;

            let str = `${metadata.type}_${roundedCenter.x}_${roundedCenter.y}_${roundedRadius}`;

            if (metadata.type === 'arc') {
                const roundedStartAngle = Math.round((metadata.startAngle || 0) * this.hashPrecision) / this.hashPrecision;
                const roundedEndAngle = Math.round((metadata.endAngle || Math.PI * 2) * this.hashPrecision) / this.hashPrecision;
                str += `_${roundedStartAngle}_${roundedEndAngle}_${metadata.clockwise === true}`;
            }

            // Include offset flag in hash to separate source from offset curves
            if (metadata.isOffsetDerived) {
                str += '_offset';
            }

            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash;
            }

            return Math.abs(hash);
        }

        register(metadata) {
            if (!metadata || !metadata.center || metadata.radius === undefined) {
                return null;
            }

            // Default to CCW if not specified (safer for end-capsin)
            if (metadata.clockwise === undefined) {
                metadata.clockwise = false;
            }

            const hash = this.generateHash(metadata);

            if (this.hashToId.has(hash)) {
                return this.hashToId.get(hash);
            }

            const curveData = {
                ...metadata,
                clockwise: metadata.clockwise,
                isOffsetDerived: metadata.isOffsetDerived || false
            };

            const id = this.nextId++;
            this.registry.set(id, curveData);
            this.hashToId.set(hash, id);

            if (metadata.primitiveId) {
                if (!this.primitiveIdToCurves.has(metadata.primitiveId)) {
                    this.primitiveIdToCurves.set(metadata.primitiveId, []);
                }
                this.primitiveIdToCurves.get(metadata.primitiveId).push(id);
            }

            // Track offset-derived curves
            if (metadata.isOffsetDerived) {
                this.offsetCurveMap.set(id, {
                    sourceId: metadata.sourceCurveId,
                    offsetDistance: metadata.offsetDistance
                });
                this.stats.offsetDerived++;
            }

            this.stats.registered++;
            if (metadata.type === 'circle') this.stats.circles++;
            else if (metadata.type === 'arc') this.stats.arcs++;
            if (metadata.source === 'end_cap' || metadata.source === 'arc_end_cap') this.stats.endCaps++;

            return id;
        }

        getCurve(id) {
            return this.registry.get(id);
        }

        getCurvesForPrimitive(primitiveId) {
            return this.primitiveIdToCurves.get(primitiveId) || [];
        }

        isOffsetDerived(curveId) {
            return this.offsetCurveMap.has(curveId);
        }

        getOffsetInfo(curveId) {
            return this.offsetCurveMap.get(curveId);
        }

        clear() {
            this.registry.clear();
            this.hashToId.clear();
            this.primitiveIdToCurves.clear();
            this.offsetCurveMap.clear();
            this.nextId = 1;
            this.stats = {
                registered: 0,
                circles: 0,
                arcs: 0,
                endCaps: 0,
                offsetDerived: 0
            };
        }

        // Review - clearOffsetCurves possibly zombie function.
        clearOffsetCurves() {
            const offsetIds = Array.from(this.offsetCurveMap.keys());
            offsetIds.forEach(id => {
                const curve = this.registry.get(id);
                if (curve) {
                    const hash = this.generateHash(curve);
                    this.hashToId.delete(hash);
                }
                this.registry.delete(id);
                this.offsetCurveMap.delete(id);
            });

            this.stats.registered -= offsetIds.length;
            this.stats.offsetDerived = 0;
        }

        getStats() {
            return {
                ...this.stats,
                registrySize: this.registry.size
            };
        }
    }

    // Create and expose global registry
    window.globalCurveRegistry = new GlobalCurveRegistry();

    // Also expose the class for potential multiple instances
    window.GlobalCurveRegistry = GlobalCurveRegistry;
})();