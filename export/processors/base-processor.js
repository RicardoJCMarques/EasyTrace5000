/**
 * @file        export/processors/base-processor.js
 * @description Base post-processing orchestrator
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
        
        // Abstract methods - must be implemented by subclasses
        generateHeader(options) {
            throw new Error('generateHeader() must be implemented by subclass');
        }
        
        generateFooter(options) {
            throw new Error('generateFooter() must be implemented by subclass');
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
            const precision = this.config.spindlePrecision;
            if (precision === 0) {
                return Math.round(value).toString();
            }
            return value.toFixed(precision).replace(/\.?0+$/, '');
        }
        
        generateArc(cmd) {
            if (!this.config.supportsArcCommands) {
                return this.generateLinear(cmd); // Fallback is correct
            }

            const gCommand = cmd.type === 'ARC_CW' ? 'G2' : 'G3';
            let code = '';
            let motionGenerated = false;

            // Check for full circle using helper method
            const isFullCircle = this._isFullCircle(cmd);

            // Force a new G-code (G2/G3) if it's a full circle as this often follows a helix and confuses controllers.
            const modeChanged = (!this.config.modalCommands || this.modalState.motionMode !== gCommand || isFullCircle);

            if (modeChanged) {
                code = gCommand;
                this.modalState.motionMode = gCommand;
            }

            // Output X. G2/G3 always requires it.
            if (cmd.x !== null && cmd.x !== undefined) {
                code += ` X${this.formatCoordinate(cmd.x)}`;
                motionGenerated = true;
                this.currentPosition.x = cmd.x;
            }
            
            // Output Y. G2/G3 always requires it.
            if (cmd.y !== null && cmd.y !== undefined) {
                code += ` Y${this.formatCoordinate(cmd.y)}`;
                motionGenerated = true;
                this.currentPosition.y = cmd.y;
            }

            // Output Z. This is modal (helical).
            if (cmd.z !== null && cmd.z !== undefined) {
                const zChanged = Math.abs(cmd.z - this.currentPosition.z) > 1e-6;

                // Output Z if:
                // 1. Mode changed (e.g., G0 -> G3)
                // 2. Z value actually changed
                // 3. It's a full-circle cleanup pass (Z *must* be specified to be safe)
                if (modeChanged || zChanged || isFullCircle) {
                    code += ` Z${this.formatCoordinate(cmd.z)}`;
                    motionGenerated = true;
                }
                this.currentPosition.z = cmd.z;
            }

            // I, J, R - Always output these if specified
            if (this.config.arcFormat === 'IJ') {
                if (cmd.i !== null && cmd.i !== undefined) code += ` I${this.formatCoordinate(cmd.i)}`;
                if (cmd.j !== null && cmd.j !== undefined) code += ` J${this.formatCoordinate(cmd.j)}`;
            } else if (this.config.arcFormat === 'R') {
                const radius = Math.hypot(cmd.i ?? 0, cmd.j ?? 0);
                if (radius > 1e-6) code += ` R${this.formatCoordinate(radius)}`;
            }

            // Feed rate logic
            // Feed rate logic - simplified single-pass
            if (cmd.f !== undefined && cmd.f !== null) {
                this.currentFeed = cmd.f;
            }

            // Output F if: explicit feed provided, mode changed with motion, or motion without F
            const needsFeed = motionGenerated && (
                (cmd.f !== undefined && cmd.f !== null) ||
                modeChanged ||
                this.currentFeed !== null
            );

            if (needsFeed && code.indexOf('F') === -1 && this.currentFeed !== null) {
                code += ` F${this.formatFeed(this.currentFeed)}`;
            }

            // This prevents an empty "G2" or "G3" from being output if a degenerate arc command was somehow sent.
            if (!modeChanged && !motionGenerated) {
                // We also check if I, J, or R were added.
                // If the code is *just* "G2" or "G3", suppress it.
                if (code === gCommand) {
                    return '';
                }
            }

            return code.trim();
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
            let code = '';
            let motionGenerated = false;
            const modeChanged = (!this.config.modalCommands || this.modalState.motionMode !== 'G0');

            if (modeChanged) {
                code = 'G0';
                this.modalState.motionMode = 'G0';
            }

            if (cmd.x !== null && cmd.x !== undefined) {
                const changed = Math.abs(cmd.x - this.currentPosition.x) > 1e-6;
                if (changed || modeChanged) {
                    code += ` X${this.formatCoordinate(cmd.x)}`;
                    motionGenerated = true;
                }
                this.currentPosition.x = cmd.x;
            }
            if (cmd.y !== null && cmd.y !== undefined) {
                const changed = Math.abs(cmd.y - this.currentPosition.y) > 1e-6;
                if (changed || modeChanged) {
                    code += ` Y${this.formatCoordinate(cmd.y)}`;
                    motionGenerated = true;
                }
                this.currentPosition.y = cmd.y;
            }
            if (cmd.z !== null && cmd.z !== undefined) {
                const changed = Math.abs(cmd.z - this.currentPosition.z) > 1e-6;
                if (changed || modeChanged) {
                    code += ` Z${this.formatCoordinate(cmd.z)}`;
                    motionGenerated = true;
                }
                this.currentPosition.z = cmd.z;
            }

            // Suppress redundant only moves
            if (!modeChanged && !motionGenerated) {
                return '';
            }

            return code.trim();
        }
        
        generateLinear(cmd) {
            let code = '';
            let motionGenerated = false;
            const modeChanged = (!this.config.modalCommands || this.modalState.motionMode !== 'G1');

            if (modeChanged) {
                code = 'G1';
                this.modalState.motionMode = 'G1';
            }

            if (cmd.x !== null && cmd.x !== undefined) {
                const changed = Math.abs(cmd.x - this.currentPosition.x) > 1e-6;
                if (changed || modeChanged) {
                    code += ` X${this.formatCoordinate(cmd.x)}`;
                    motionGenerated = true;
                }
                this.currentPosition.x = cmd.x;
            }
            if (cmd.y !== null && cmd.y !== undefined) {
                const changed = Math.abs(cmd.y - this.currentPosition.y) > 1e-6;
                if (changed || modeChanged) {
                    code += ` Y${this.formatCoordinate(cmd.y)}`;
                    motionGenerated = true;
                }
                this.currentPosition.y = cmd.y;
            }
            if (cmd.z !== null && cmd.z !== undefined) {
                const changed = Math.abs(cmd.z - this.currentPosition.z) > 1e-6;
                if (changed || modeChanged) {
                    code += ` Z${this.formatCoordinate(cmd.z)}`;
                    motionGenerated = true;
                }
                this.currentPosition.z = cmd.z;
            }

            // Output feed rate
            if (cmd.f !== undefined && cmd.f !== null) {
                const feedChanged = Math.abs(cmd.f - (this.currentFeed || 0)) > 1e-6;
                if (modeChanged || (motionGenerated && feedChanged)) {
                    code += ` F${this.formatFeed(cmd.f)}`;
                    this.currentFeed = cmd.f;
                } else if (motionGenerated && !feedChanged && this.currentFeed !== null) {
                    code += ` F${this.formatFeed(this.currentFeed)}`;
                }
            } else if (modeChanged && this.currentFeed !== null) {
                 code += ` F${this.formatFeed(this.currentFeed)}`;
            }
            
            // Suppress redundant only moves
            if (!modeChanged && !motionGenerated) {
                return '';
            }

            return code.trim();
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
        
        processCommand(cmd, options) {
            switch (cmd.type) {
                case 'RAPID': return this.generateRapid(cmd);
                case 'LINEAR': return this.generateLinear(cmd);
                case 'ARC_CW':
                case 'ARC_CCW': return this.generateArc(cmd);
                case 'PLUNGE': return this.generatePlunge(cmd);
                case 'RETRACT': return this.generateRetract(cmd);
                case 'DWELL': return this.generateDwell(cmd);
                default:
                    if (cmd.comment) return `(${cmd.comment})`;
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
                units: 'G21',
                plane: 'G17',
                feedRateMode: 'G94'
            };
        }
    }
    
    window.BasePostProcessor = BasePostProcessor;
})();