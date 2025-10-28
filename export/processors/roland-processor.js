/**
 * @file        export/processors/roland-processor.js
 * @description ROLAND post-processing module
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

(function() {
    'use strict';
    
    class RolandPostProcessor extends BasePostProcessor {
        constructor() {
            super('Roland', {
                fileExtension: '.rml',
                supportsToolChange: false,
                supportsArcCommands: false, // Roland uses straight line approximation
                supportsCannedCycles: false,
                coordinatePrecision: 2,
                feedPrecision: 0,
                modalCommands: false, // Roland doesn't use modal commands the same way
                useRMLFormat: true,
                zAxisInverted: true, // Roland Z is positive down
                unitsPerMM: 40 // Roland units (1/40mm resolution)
            });
        }
        
        generateHeader(options) {
            const lines = [];
            
            lines.push('PA;PA;'); // Initialize
            lines.push('!MC0;'); // Motor control
            lines.push('VS10;'); // Speed setting
            lines.push('!VZ10;'); // Z-axis speed
            lines.push('!PZ0,0;'); // Set Z origin
            lines.push('PU0,0;'); // Pen up, move to origin
            
            return lines.join('\n');
        }
        
        generateFooter(options) {
            const lines = [];
            
            lines.push('PU0,0;'); // Pen up, return to origin
            lines.push('!MC0;'); // Motors off
            lines.push('H;'); // Home
            
            return lines.join('\n');
        }
        
        generateToolChange(tool, options) {
            return '!MC0;\n(Manual tool change required)\n!MC1;';
        }
        
        // Override coordinate formatting for Roland units
        formatCoordinate(value) {
            if (value === null || value === undefined) return '';
            const units = Math.round(value * this.config.unitsPerMM);
            return units.toString();
        }
        
        // Override command generation for Roland RML format
        generateRapid(cmd) {
            if (cmd.x === null && cmd.y === null) {
                // Z-only move
                const z = this.config.zAxisInverted ? -cmd.z : cmd.z;
                // Update state
                if (cmd.z !== null && cmd.z !== undefined) this.currentPosition.z = cmd.z;
                return `PU${this.formatCoordinate(z)};`;
            }
            
            // Update state
            if (cmd.x !== null && cmd.x !== undefined) this.currentPosition.x = cmd.x;
            if (cmd.y !== null && cmd.y !== undefined) this.currentPosition.y = cmd.y;
            
            return `PU${this.formatCoordinate(cmd.x)},${this.formatCoordinate(cmd.y)};`;
        }
        
        generateLinear(cmd) {
            // Handle Z-only moves
            if ((cmd.x === null || cmd.x === undefined) && 
                (cmd.y === null || cmd.y === undefined)) {
                if (cmd.z !== null && cmd.z !== undefined) {
                    const z = this.config.zAxisInverted ? -cmd.z : cmd.z;
                    this.currentPosition.z = cmd.z;
                    return `Z${this.formatCoordinate(z)},${this.formatCoordinate(z)};`;
                }
                return ''; // No motion at all
            }

            // Determine target position, using current position for unspecified axes
            const targetX = (cmd.x !== null && cmd.x !== undefined) ? cmd.x : this.currentPosition.x;
            const targetY = (cmd.y !== null && cmd.y !== undefined) ? cmd.y : this.currentPosition.y;
            
            // Check if position actually changed
            const xChanged = Math.abs(targetX - this.currentPosition.x) > 1e-6;
            const yChanged = Math.abs(targetY - this.currentPosition.y) > 1e-6;
            
            if (!xChanged && !yChanged) {
                // No XY motion, check for Z
                if (cmd.z !== null && cmd.z !== undefined) {
                    const zChanged = Math.abs(cmd.z - this.currentPosition.z) > 1e-6;
                    if (zChanged) {
                        const z = this.config.zAxisInverted ? -cmd.z : cmd.z;
                        this.currentPosition.z = cmd.z;
                        return `Z${this.formatCoordinate(z)},${this.formatCoordinate(z)};`;
                    }
                }
                // Even if no motion, update state for null coordinates
                if (cmd.x !== null && cmd.x !== undefined) this.currentPosition.x = cmd.x;
                if (cmd.y !== null && cmd.y !== undefined) this.currentPosition.y = cmd.y;
                return ''; // Truly redundant move
            }

            // Update state for X and Y
            this.currentPosition.x = targetX;
            this.currentPosition.y = targetY;
            
            // Handle Z if specified (helical move in Roland terms)
            if (cmd.z !== null && cmd.z !== undefined) {
                this.currentPosition.z = cmd.z;
                // Roland doesn't really support helical pen-down moves well
                // This might need special handling
            }

            return `PD${this.formatCoordinate(targetX)},${this.formatCoordinate(targetY)};`;
        }
        
        generatePlunge(cmd) {
            const z = this.config.zAxisInverted ? -cmd.z : cmd.z;
            // Update state
            if (cmd.z !== null && cmd.z !== undefined) this.currentPosition.z = cmd.z;
            return `Z${this.formatCoordinate(z)},${this.formatCoordinate(z)};`;
        }
        
        generateRetract(cmd) {
            const z = this.config.zAxisInverted ? -cmd.z : cmd.z;
            // Update state
            if (cmd.z !== null && cmd.z !== undefined) this.currentPosition.z = cmd.z;
            return `PU${this.formatCoordinate(z)};`;
        }
    }
    
    window.RolandPostProcessor = RolandPostProcessor;
})();