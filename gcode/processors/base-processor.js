/**
 * @file        gcode/processors/base-processor.js
 * @description Base post-processing orchestrator
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

    class BasePostProcessor {
        constructor(name, config = {}) {
            this.name = name;
            this.config = {
                fileExtension: '.nc',
                supportsToolChange: false,
                supportsArcCommands: true,
                supportsCannedCycles: false,
                arcFormat: 'IJ',
                coordinatePrecision: 3,
                feedPrecision: 0,
                spindlePrecision: 0,
                lineNumbering: false,
                modalCommands: true,
                safetyHeight: 5.0,
                maxSpindleSpeed: 30000,
                ...config
            };

            this.modalState = {
                motionMode: null,
                coordinateMode: 'G90',
                units: 'G21',
                plane: 'G17',
                feedRateMode: 'G94'
            };

            this.currentPosition = { x: 0, y: 0, z: 0 };
            this.currentFeed = null;
            this.currentSpindle = null;
        }

        // Abstract methods
        generateHeader(options) {
            const headerLines = [];

            // Add the formatted comment block IF it exists
            if (options.includeComments && options.commentBlock) {
                options.commentBlock.forEach(line => {
                    headerLines.push(`; ${line}`);
                });
                headerLines.push('');
            }

            // 1. Set unit mode from options (comes from dropdown)
            this.modalState.units = (options.units === 'in') ? 'G20' : 'G21';

            // 2. Output all modal commands based on state
            headerLines.push(this.modalState.coordinateMode); // G90 - Absolute Coordinates
            headerLines.push(this.modalState.units);          // G20 or G21
            headerLines.push(this.modalState.plane);          // G17 - XY Plane
            headerLines.push(this.modalState.feedRateMode);   // G94 - Units/minute
            headerLines.push(''); // Blank line

            // Get the template from the options, or a default
            let startCode = options.startCode;

            // Replace placeholders
            const toolNum = options.toolNumber;
            startCode = startCode.replace(/{toolNumber}/g, toolNum);

            // Conditionally add coolant/vacuum commands
            if (options.coolant && options.coolant !== 'none' && !startCode.includes('M7') && !startCode.includes('M8')) {
                if (options.coolant === 'mist') {
                    startCode += '\nM7'; // Mist
                } else if (options.coolant === 'flood') {
                    startCode += '\nM8'; // Flood
                }
            }
            if (options.vacuum && !startCode.includes('M10')) {
                startCode += '\nM10'; // Vacuum On
            }

            headerLines.push(startCode); // Add the actual start code after the modals

            return headerLines.join('\n');
        }
        
        generateFooter(options) {
            let endCode = options.endCode || ''; // Get template from config.js

            const safeZ = options.safeZ;
            const travelZ = options.travelZ;

            endCode = endCode.replace(/{safeZ}/g, this.formatCoordinate(safeZ));
            endCode = endCode.replace(/{travelZ}/g, this.formatCoordinate(travelZ));

            // Conditionally add 'off' commands (if not already in template)
            if (options.coolant && options.coolant !== 'none' && !endCode.includes('M9')) {
                endCode = 'M9\n' + endCode; // Coolant Off
            }
            if (options.vacuum && !endCode.includes('M11')) {
                endCode = 'M11\n' + endCode; // Vacuum Off
            }

            return endCode;
        }

        /**
         * Generates G-code to set spindle speed, only if it has changed.
         * This is the core of the stateful spindle logic.
         * @param {number} speed - The new target RPM
         * @returns {string} G-code string (e.g., "M5\nM3 S10000") or "" if no change.
         */
        setSpindle(speed, dwell = 0) {
            if (speed === this.currentSpindle) {
                return null;
            }

            this.currentSpindle = speed;

            const lines = [];

            if (speed > 0) {
                lines.push(`M3 S${speed}`);
                if (dwell > 0) {
                    lines.push(`G4 P${dwell}`);
                }
            } else {
                lines.push('M5');
            }
            
            return lines.join('\n');
        }

        generateToolChange(tool, options) {
            throw new Error('generateToolChange() must be implemented by subclass');
        }

        // Concrete methods - can be overridden if needed
        formatCoordinate(value) {
            if (value === null || value === undefined) return '';
            const precision = this.config.coordinatePrecision;
            return value.toFixed(precision).replace(/\.?0+$/, '');
        }

        formatFeed(value) {
            const precision = this.config.feedPrecision;
            if (precision === 0) {
                return Math.round(value).toString();
            }
            return value.toFixed(precision).replace(/\.?0+$/, '');
        }

        formatSpindle(value) {
            if (value === null || value === undefined) return '0';
            const precision = this.config.spindlePrecision;
            if (precision === 0) {
                return Math.round(value).toString();
            }
            return value.toFixed(precision).replace(/\.?0+$/, '');
        }

        generateArc(cmd) {
            if (!this.config.supportsArcCommands) {
                return this.generateLinear(cmd);
            }

            const gCommand = cmd.type === 'ARC_CW' ? 'G2' : 'G3';
            const isFullCircle = this._isFullCircle(cmd);

            // Determine if we need to output the G-code command
            const needsGCode = !this.config.modalCommands || 
                            this.modalState.motionMode !== gCommand ||
                            isFullCircle;  // Full circles always need explicit G-code

            // Prepare coordinate outputs
            const coords = [];
            let hasMotion = false;

            // X coordinate
            if (cmd.x !== null && cmd.x !== undefined) {
                const xChanged = Math.abs(cmd.x - this.currentPosition.x) > 1e-6;
                // For full circles or mode changes, always output coordinates
                if (xChanged || needsGCode || isFullCircle) {
                    coords.push(`X${this.formatCoordinate(cmd.x)}`);
                    hasMotion = true;
                }
                this.currentPosition.x = cmd.x;
            }

            // Y coordinate  
            if (cmd.y !== null && cmd.y !== undefined) {
                const yChanged = Math.abs(cmd.y - this.currentPosition.y) > 1e-6;
                if (yChanged || needsGCode || isFullCircle) {
                    coords.push(`Y${this.formatCoordinate(cmd.y)}`);
                    hasMotion = true;
                }
                this.currentPosition.y = cmd.y;
            }

            // Z coordinate (helical arcs)
            if (cmd.z !== null && cmd.z !== undefined) {
                const zChanged = Math.abs(cmd.z - this.currentPosition.z) > 1e-6;
                // Always output Z if changed, or new commands, or full circles
                if (zChanged || needsGCode || isFullCircle) {
                    coords.push(`Z${this.formatCoordinate(cmd.z)}`);
                    hasMotion = true;
                }
                this.currentPosition.z = cmd.z;
            }

            // Arc parameters - always output if present
            if (this.config.arcFormat === 'IJ') {
                if (cmd.i !== null && cmd.i !== undefined) {
                    coords.push(`I${this.formatCoordinate(cmd.i)}`);
                }
                if (cmd.j !== null && cmd.j !== undefined) {
                    coords.push(`J${this.formatCoordinate(cmd.j)}`);
                }
            } else if (this.config.arcFormat === 'R') {
                const radius = Math.hypot(cmd.i ?? 0, cmd.j ?? 0);
                if (radius > 1e-6) {
                    coords.push(`R${this.formatCoordinate(radius)}`);
                }
            }

            // Feed rate handling
            if (cmd.f !== undefined && cmd.f !== null) {
                const feedChanged = this.currentFeed === null || 
                                Math.abs(cmd.f - this.currentFeed) > 1e-6;
                if (feedChanged) {
                    coords.push(`F${this.formatFeed(cmd.f)}`);
                    this.currentFeed = cmd.f;
                }
            }

            // Build final command (only output if there's either a mode change or actual motion)
            if (!needsGCode && !hasMotion) {
                return '';
            }

            let code = needsGCode ? gCommand : '';
            if (coords.length > 0) {
                code += (code ? ' ' : '') + coords.join(' ');
            }

            if (needsGCode) {
                this.modalState.motionMode = gCommand;
            }

            return code;
        }

        _isFullCircle(cmd) {
            if (!cmd.i && !cmd.j) return false;

            const targetX = (cmd.x !== null && cmd.x !== undefined) ? cmd.x : this.currentPosition.x;
            const targetY = (cmd.y !== null && cmd.y !== undefined) ? cmd.y : this.currentPosition.y;

            const xSame = Math.abs(targetX - this.currentPosition.x) < 1e-6;
            const ySame = Math.abs(targetY - this.currentPosition.y) < 1e-6;

            return xSame && ySame;
        }

        generateRapid(cmd) {
            const needsGCode = !this.config.modalCommands || this.modalState.motionMode !== 'G0';

            const coords = [];
            let hasMotion = false;

            // X coordinate
            if (cmd.x !== null && cmd.x !== undefined) {
                const xChanged = Math.abs(cmd.x - this.currentPosition.x) > 1e-6;
                if (xChanged || needsGCode) {
                    coords.push(`X${this.formatCoordinate(cmd.x)}`);
                    hasMotion = true;
                }
                this.currentPosition.x = cmd.x;
            }

            // Y coordinate
            if (cmd.y !== null && cmd.y !== undefined) {
                const yChanged = Math.abs(cmd.y - this.currentPosition.y) > 1e-6;
                if (yChanged || needsGCode) {
                    coords.push(`Y${this.formatCoordinate(cmd.y)}`);
                    hasMotion = true;
                }
                this.currentPosition.y = cmd.y;
            }

            // Z coordinate
            if (cmd.z !== null && cmd.z !== undefined) {
                const zChanged = Math.abs(cmd.z - this.currentPosition.z) > 1e-6;
                if (zChanged || needsGCode) {
                    coords.push(`Z${this.formatCoordinate(cmd.z)}`);
                    hasMotion = true;
                }
                this.currentPosition.z = cmd.z;
            }

            // Only output if there's a mode change or actual motion
            if (!needsGCode && !hasMotion) {
                return '';
            }

            let code = needsGCode ? 'G0' : '';
            if (coords.length > 0) {
                code += (code ? ' ' : '') + coords.join(' ');
            }

            if (needsGCode) {
                this.modalState.motionMode = 'G0';
            }

            return code;
        }

        generateLinear(cmd) {
            const needsGCode = !this.config.modalCommands || this.modalState.motionMode !== 'G1';

            const coords = [];
            let hasMotion = false;

            // X coordinate
            if (cmd.x !== null && cmd.x !== undefined) {
                const xChanged = Math.abs(cmd.x - this.currentPosition.x) > 1e-6; // Review - epsilon exists in config
                if (xChanged || needsGCode) {
                    coords.push(`X${this.formatCoordinate(cmd.x)}`);
                    hasMotion = true;
                }
                this.currentPosition.x = cmd.x;
            }

            // Y coordinate
            if (cmd.y !== null && cmd.y !== undefined) {
                const yChanged = Math.abs(cmd.y - this.currentPosition.y) > 1e-6; // Review - epsilon exists in config
                if (yChanged || needsGCode) {
                    coords.push(`Y${this.formatCoordinate(cmd.y)}`);
                    hasMotion = true;
                }
                this.currentPosition.y = cmd.y;
            }

            // Z coordinate
            if (cmd.z !== null && cmd.z !== undefined) {
                const zChanged = Math.abs(cmd.z - this.currentPosition.z) > 1e-6; // Review - epsilon exists in config
                if (zChanged || needsGCode) {
                    coords.push(`Z${this.formatCoordinate(cmd.z)}`);
                    hasMotion = true;
                }
                this.currentPosition.z = cmd.z;
            }

            // Feed rate
            if (cmd.f !== undefined && cmd.f !== null) {
                const feedChanged = this.currentFeed === null || 
                                Math.abs(cmd.f - this.currentFeed) > 1e-6; // Review - epsilon exists in config
                if (feedChanged) {
                    coords.push(`F${this.formatFeed(cmd.f)}`);
                    this.currentFeed = cmd.f;
                }
            }

            // Only output if there's a mode change or actual motion
            if (!needsGCode && !hasMotion) {
                return '';
            }

            let code = needsGCode ? 'G1' : '';
            if (coords.length > 0) {
                code += (code ? ' ' : '') + coords.join(' ');
            }

            if (needsGCode) {
                this.modalState.motionMode = 'G1';
            }

            return code;
        }

        generatePlunge(cmd) {
            return this.generateLinear(cmd);
        }

        generateRetract(cmd) {
            return this.generateRapid(cmd);
        }

        generateDwell(cmd) {
            const duration = cmd.dwell || cmd.duration || 0;
            return `G4 P${duration}`;
        }

        processCommand(cmd) {
            switch (cmd.type) {
                case 'RAPID': return this.generateRapid(cmd);
                case 'LINEAR': return this.generateLinear(cmd);
                case 'ARC_CW':
                case 'ARC_CCW': return this.generateArc(cmd);
                case 'PLUNGE': return this.generatePlunge(cmd);
                case 'RETRACT': return this.generateRetract(cmd);
                case 'DWELL': return this.generateDwell(cmd);
                default:
                    return '';
            }
        }

        resetState() {
            this.currentPosition = { x: 0, y: 0, z: 0 };
            this.currentFeed = null;
            this.currentSpindle = null;
            this.modalState = {
                motionMode: null,
                coordinateMode: 'G90',
                units: null,
                units: 'G21',
                plane: 'G17',
                feedRateMode: 'G94'
            };
        }
    }

    window.BasePostProcessor = BasePostProcessor;
})();