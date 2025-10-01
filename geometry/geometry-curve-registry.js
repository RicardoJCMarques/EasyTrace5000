// geometry/geometry-curve-registry.js
// Centralized curve metadata registry for arc reconstruction
// Extracted from config.js for better modularity

(function() {
    'use strict';
    
    class GlobalCurveRegistry {
        constructor() {
            this.registry = new Map();
            this.hashToId = new Map();
            this.primitiveIdToCurves = new Map();
            this.offsetCurveMap = new Map(); // Track offset-derived curves
            this.nextId = 1;
            this.hashPrecision = 1000;
            
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
            
            // Default to CCW if not specified (safer for end-caps)
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
        
        clearOffsetCurves() {
            // Remove only offset-derived curves
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