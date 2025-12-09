/**
 * @file        clipper2-svg-exporter.js
 * @description Standalone module for generating SVG strings from geometry
 * @author      Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 *
 * This module is part of the EasyTrace5000 Test Suite.
 * It interfaces with the Clipper2 library (Angus Johnson) via WASM (Erik Som).
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

class Clipper2SVGExporter {
    constructor(defaults) {
        this.defaults = defaults;
    }

    /**
     * Main Export Entry Point
     * @param {Object|Array} input - Geometry data (Clipper paths, PolyTree, or definition object)
     * @param {number} width - Canvas/ViewBox width
     * @param {number} height - Canvas/ViewBox height
     * @returns {string} SVG XML string
     */
    exportSVG(input, width, height) {
        // Defaults from config if not provided
        width = width || this.defaults.config.canvasWidth;
        height = height || this.defaults.config.canvasHeight;

        // Handle Raw Geometry Definitions
        if (input && typeof input === 'object' && !input.length && !input.size && !input.polygons) {
            if (input.type === 'strokes') return this._exportStrokes(input, width, height);
            if (input.type === 'pcb') return this._exportPcb(input, width, height);
        }

        // Prepare SVG Header
        const fillColor = this._resolveColor('var(--shape-fill)');
        const strokeColor = this._resolveColor('var(--shape-stroke)');

        let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" 
     xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="white"/>
  <g fill="${fillColor}" stroke="${strokeColor}" stroke-width="2">
`;

        // Generate Path Data
        let pathD = '';

        if (this._isPolyTree(input)) {
            pathD = this._polyTreeToSVGPath(input);
        } else {
            // Flatten input to consistent coordinate arrays
            const paths = this._normalizeToCoords(input);
            pathD = this._coordsToSVGPath(paths);
        }

        svg += `    <path d="${pathD}" fill-rule="evenodd"/>\n`;
        svg += '  </g>\n</svg>';
        
        return svg;
    }

    /**
     * Export Stroke Definitions (Letter B test)
     */
    _exportStrokes(definition, width, height) {
        const strokeWidth = definition.strokeWidth || 20;
        const strokeColor = this._resolveColor('var(--shape-stroke)');

        let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" 
xmlns="http://www.w3.org/2000/svg">
<rect width="${width}" height="${height}" fill="white"/>
<g fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round">
`;
        definition.data.forEach(stroke => {
            if (stroke.type === 'line') {
                svg += `    <line x1="${stroke.from[0]}" y1="${stroke.from[1]}" x2="${stroke.to[0]}" y2="${stroke.to[1]}"/>\n`;
            } else if (stroke.type === 'arc') {
                const r = stroke.radius;
                const startRad = (stroke.start - 90) * Math.PI / 180;
                const endRad = (stroke.end - 90) * Math.PI / 180;

                const startX = stroke.center[0] + r * Math.cos(startRad);
                const startY = stroke.center[1] + r * Math.sin(startRad);
                const endX = stroke.center[0] + r * Math.cos(endRad);
                const endY = stroke.center[1] + r * Math.sin(endRad);

                const angleDiff = Math.abs(stroke.end - stroke.start);
                const largeArc = angleDiff > 180 ? 1 : 0;
                const sweep = 1; // Assuming CCW visual convention for strokes

                svg += `    <path d="M ${startX} ${startY} A ${r} ${r} 0 ${largeArc} ${sweep} ${endX} ${endY}"/>\n`;
            }
        });

        svg += '  </g>\n</svg>';
        return svg;
    }

    /**
     * Export PCB Definitions
     */
    _exportPcb(definition, width, height) {
        const traceWidth = definition.traceWidth || 24;
        const strokeColor = this._resolveColor('var(--pcb-stroke)');

        let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" 
xmlns="http://www.w3.org/2000/svg">
<rect width="${width}" height="${height}" fill="white"/>
<g fill="${strokeColor}" stroke="${strokeColor}" stroke-linecap="round">
`;
        definition.traces?.forEach(trace => {
            svg += `    <line x1="${trace.from[0]}" y1="${trace.from[1]}" x2="${trace.to[0]}" y2="${trace.to[1]}" stroke-width="${traceWidth}"/>\n`;
        });

        definition.pads?.forEach(pad => {
            svg += `    <circle cx="${pad.center[0]}" cy="${pad.center[1]}" r="${pad.radius}"/>\n`;
        });

        svg += '  </g>\n</svg>';
        return svg;
    }

    /**
     * Convert standard coordinate arrays to SVG Path data
     */
    _coordsToSVGPath(paths) {
        return paths.map(path => {
            if (path.length === 0) return '';
            const start = path[0];
            const x = Array.isArray(start) ? start[0] : start.x;
            const y = Array.isArray(start) ? start[1] : start.y;

            let d = `M ${x} ${y}`;
            for (let i = 1; i < path.length; i++) {
                const p = path[i];
                const px = Array.isArray(p) ? p[0] : p.x;
                const py = Array.isArray(p) ? p[1] : p.y;
                d += ` L ${px} ${py}`;
            }
            return d + ' Z';
        }).join(' ');
    }

    /**
     * Recursively convert structured PolyTree to SVG Path data
     */
    _polyTreeToSVGPath(node) {
        let d = '';

        // Process current polygon (Outer)
        if (node.outer && node.outer.points) {
            d += this._coordsToSVGPath([node.outer.points]) + ' ';
        }

        // Process holes
        if (node.holes) {
            node.holes.forEach(hole => {
                d += this._coordsToSVGPath([hole.points]) + ' ';
            });
        }

        // Recurse to islands (nested polygons)
        if (node.islands) {
            node.islands.forEach(island => {
                d += this._polyTreeToSVGPath(island);
            });
        }

        // Handle root container case (array of polygons)
        if (node.polygons) {
            node.polygons.forEach(poly => {
                d += this._polyTreeToSVGPath(poly);
            });
        }
        
        return d;
    }

    /**
     * Utilities
     */

    _isPolyTree(input) {
        return input && (input.polygons || input.outer || input.holes);
    }

    _normalizeToCoords(input) {
        if (!input) return [];
        
        // Handle Clipper2 WASM Paths64 directly
        if (input.size && typeof input.get === 'function') {
            const scale = this.defaults.config.scale;
            const result = [];
            for (let i = 0; i < input.size(); i++) {
                const path = input.get(i);
                const coords = [];
                for (let j = 0; j < path.size(); j++) {
                    const pt = path.get(j);
                    coords.push([Number(pt.x) / scale, Number(pt.y) / scale]);
                }
                result.push(coords);
            }
            return result;
        }

        // Handle Array of paths
        if (Array.isArray(input)) {
            if (input.length === 0) return [];
            // Check nesting level: [[x,y]] vs [[[x,y]]]
            const isSinglePath = typeof input[0][0] === 'number';
            return isSinglePath ? [input] : input;
        }

        return [];
    }

    _resolveColor(colorVar) {
        if (colorVar.startsWith('var(')) {
            const match = colorVar.match(/var\((--[^)]+)\)/);
            if(match) {
                return getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
            }
        }
        return colorVar;
    }
}