/**
 * @file        utils/unit-converter.js
 * @description Handles unit conversions across the application
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
    const debugConfig = config.debug;

    /**
     * Standard conversions to millimeters (base unit for CAM operations)
     */
    const TO_MM = {
        'mm': 1,
        'cm': 10,
        'm': 1000,
        'in': 25.4,
        'inch': 25.4,
        'mil': 0.0254,        // 1/1000 inch
        'thou': 0.0254,       // Same as mil
        'pt': 25.4 / 72,      // PostScript point (1/72 inch)
        'pc': 25.4 / 6,       // Pica (1/6 inch)
        'px': 25.4 / 96,      // CSS pixel (assumes 96 DPI)
    };

    /**
     * Default DPI for pixel-based conversions
     */
    const DEFAULT_DPI = 96;

    class UnitConverter {
        constructor(options = {}) {
            this.defaultUnit = options.defaultUnit || 'mm';
            this.dpi = options.dpi || DEFAULT_DPI;
            
            // For SVG viewBox mapping
            this.viewBox = null;
            this.documentSize = null;
        }

        /**
         * Convert a value from one unit to another
         * @param {number} value - The value to convert
         * @param {string} fromUnit - Source unit
         * @param {string} toUnit - Target unit (default: 'mm')
         * @returns {number} Converted value
         */
        convert(value, fromUnit, toUnit = 'mm') {
            if (!isFinite(value)) return value;
            
            const from = this._normalizeUnit(fromUnit);
            const to = this._normalizeUnit(toUnit);
            
            if (from === to) return value;
            
            // Convert to mm first, then to target
            const inMM = this.toMM(value, from);
            return this.fromMM(inMM, to);
        }

        /**
         * Convert value to millimeters
         */
        toMM(value, fromUnit) {
            if (!isFinite(value)) return value;
            
            const unit = this._normalizeUnit(fromUnit);
            const factor = TO_MM[unit];
            
            if (factor === undefined) {
                this._warn(`Unknown unit: ${fromUnit}, treating as mm`);
                return value;
            }
            
            return value * factor;
        }

        /**
         * Convert value from millimeters
         */
        fromMM(valueMM, toUnit) {
            if (!isFinite(valueMM)) return valueMM;
            
            const unit = this._normalizeUnit(toUnit);
            const factor = TO_MM[unit];
            
            if (factor === undefined) {
                this._warn(`Unknown unit: ${toUnit}, treating as mm`);
                return valueMM;
            }
            
            return valueMM / factor;
        }

        /**
         * Parse an SVG/CSS length value with unit
         * @param {string} valueStr - Value like "10mm", "5in", "100"
         * @param {string} defaultUnit - Unit to use if none specified
         * @returns {{value: number, unit: string}}
         */
        parseLength(valueStr, defaultUnit = null) {
            if (typeof valueStr === 'number') {
                return { value: valueStr, unit: defaultUnit || this.defaultUnit };
            }
            
            const str = String(valueStr).trim();
            const match = str.match(/^(-?[\d.]+(?:e[+-]?\d+)?)\s*([a-z%]*)$/i);
            
            if (!match) {
                return { value: parseFloat(str) || 0, unit: defaultUnit || this.defaultUnit };
            }
            
            return {
                value: parseFloat(match[1]),
                unit: match[2] || defaultUnit || this.defaultUnit
            };
        }

        /**
         * Parse and convert an SVG/CSS length to mm
         */
        parseLengthToMM(valueStr, defaultUnit = 'px') {
            const { value, unit } = this.parseLength(valueStr, defaultUnit);
            return this.toMM(value, unit);
        }

        /**
         * Set up viewBox-to-real-world mapping for SVG
         * @param {object} viewBox - {x, y, width, height} in user units
         * @param {object} docSize - {width, height, widthUnit, heightUnit} real dimensions
         */
        setViewBoxMapping(viewBox, docSize) {
            this.viewBox = viewBox;
            this.documentSize = docSize;
            
            // Calculate scale factors
            if (viewBox && docSize) {
                const docWidthMM = this.toMM(docSize.width, docSize.widthUnit || 'px');
                const docHeightMM = this.toMM(docSize.height, docSize.heightUnit || 'px');
                
                this.viewBoxScale = {
                    x: docWidthMM / viewBox.width,
                    y: docHeightMM / viewBox.height
                };
                
                this._debug(`ViewBox mapping: ${viewBox.width}x${viewBox.height} user units -> ${docWidthMM.toFixed(2)}x${docHeightMM.toFixed(2)} mm`);
            }
        }

        /**
         * Convert viewBox coordinates to mm
         */
        viewBoxToMM(x, y) {
            if (!this.viewBoxScale) {
                // No mapping set, assume 1:1 with default unit
                return { x, y };
            }
            
            return {
                x: (x - (this.viewBox?.x || 0)) * this.viewBoxScale.x,
                y: (y - (this.viewBox?.y || 0)) * this.viewBoxScale.y
            };
        }

        /**
         * Get the uniform scale factor from viewBox to mm
         * (uses average if non-uniform)
         */
        getViewBoxScaleMM() {
            if (!this.viewBoxScale) return 1;
            return (this.viewBoxScale.x + this.viewBoxScale.y) / 2;
        }

        /**
         * Check if viewBox has uniform scaling
         */
        hasUniformViewBoxScale() {
            if (!this.viewBoxScale) return true;
            const tolerance = 0.001;
            return Math.abs(this.viewBoxScale.x - this.viewBoxScale.y) < tolerance;
        }

        /**
         * Set DPI for pixel conversions
         */
        setDPI(dpi) {
            this.dpi = dpi;
            // Update px conversion factor
            TO_MM['px'] = 25.4 / dpi;
        }

        /**
         * Get supported units
         */
        getSupportedUnits() {
            return Object.keys(TO_MM);
        }

        /**
         * Check if a unit is supported
         */
        isSupported(unit) {
            return TO_MM[this._normalizeUnit(unit)] !== undefined;
        }

        _normalizeUnit(unit) {
            if (!unit) return this.defaultUnit;
            return String(unit).toLowerCase().trim();
        }

        _debug(message) {
            if (debugConfig?.enabled) {
                console.log(`[UnitConverter] ${message}`);
            }
        }

        _warn(message) {
            console.warn(`[UnitConverter] ${message}`);
        }
    }

    // Create singleton instance
    const unitConverter = new UnitConverter();

    // Export both class and instance
    window.UnitConverter = UnitConverter;
    window.unitConverter = unitConverter;
})();