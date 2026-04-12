/*!
 * @file        export/processors/base-processor.js
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
                useM6: false,
                supportsToolLengthComp: false,
                pauseAfterToolChange: false,
                arcFormat: 'IJ',
                coordinateDecimals: 3,
                feedDecimals: 0,
                spindleDecimals: 0,
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
            this.currentSpindle = 0;

            this.descriptor = {
                id: name.toLowerCase(),
                label: this.config.label || name,
                fileExtension: this.config.fileExtension || '.nc',
                capabilities: {
                    supportsToolChange: this.config.supportsToolChange || false,
                    supportsArcCommands: this.config.supportsArcCommands !== false,
                    supportsCannedCycles: this.config.supportsCannedCycles || false,
                    arcFormat: this.config.arcFormat || null,
                },
                defaults: this.config.defaults || {
                    startCode: '',
                    endCode: '',
                },
                limits: {
                    maxSpindleSpeed: this.config.maxSpindleSpeed || 30000,
                    maxRapidRate: this.config.maxRapidRate || 1000,
                },
                customParameters: this.config.customParameters || [],

            };
            this.outputScale = 1.0;
        }

        /**
         * Formats a standalone comment line for this processor's dialect.
         * Returns empty string if comments are disabled or text is empty.
         */
        formatComment(text, options) {
            if (!options?.includeComments || !text) return '';
            return this.config.commentStyle === 'semicolon'
                ? `; ${text}`
                : `(${text})`;
        }

        /**
         * Appends an inline comment to an existing G-code line.
         * Returns the line unchanged if comments are disabled.
         */
        appendComment(line, text, options) {
            const comment = this.formatComment(text, options);
            if (!comment) return line;
            return `${line} ${comment}`;
        }

        /**
         * Pushes a standalone comment line to the array.
         * Does nothing if comments are disabled, preventing empty line bloat.
         */
        pushCommentLine(linesArray, text, options) {
            if (!options?.includeComments || !text) return;
            linesArray.push(this.formatComment(text, options));
        }

        // Abstract methods
        generateHeader(options) {
            const headerLines = [];
            const c = options.comments || {};

            // Add the formatted comment block IF it exists
            if (options.includeComments && options.commentBlock) {
                options.commentBlock.forEach(line => {
                    headerLines.push(this.formatComment(line, options));
                });
                headerLines.push('');
            }

            // Set unit mode from options (comes from dropdown)
            const isInch = options.units === 'inch' || options.units === 'in';
            this.modalState.units = isInch ? 'G20' : 'G21';
            this.outputScale = isInch ? (1 / 25.4) : 1.0;

            // Output all modal commands based on state
            headerLines.push(this.modalState.coordinateMode);
            headerLines.push(this.modalState.units);
            headerLines.push(this.modalState.plane);
            headerLines.push(this.modalState.feedRateMode);
            headerLines.push('');

            // Get the template from the options, or a default
            let startCode = options.startCode;

            // Replace placeholders
            const toolNum = options.toolNumber;
            startCode = startCode.replace(/{toolNumber}/g, toolNum);

            // Conditionally add coolant/vacuum commands
            if (options.coolant && options.coolant !== 'none' && !startCode.includes('M7') && !startCode.includes('M8')) {
                if (options.coolant === 'mist') {
                    startCode += '\n' + this.appendComment('M7', c.coolantMist, options); // Mist
                } else if (options.coolant === 'flood') {
                    startCode += '\n' + this.appendComment('M8', c.coolantFlood, options); // Flood
                }
            }
            if (options.vacuum && !startCode.includes('M10')) {
                startCode += '\n' + this.appendComment('M10', c.vacuumOn, options); // Vacuum On
            }

            headerLines.push(startCode); // Add the actual start code after the modals
            return headerLines.join('\n');
        }

        generateFooter(options) {
            const c = options.comments || {};
            let endCode = options.endCode || '';

            const safeZ = options.safeZ;
            const travelZ = options.travelZ;

            endCode = endCode.replace(/{safeZ}/g, this.formatCoordinate(safeZ));
            endCode = endCode.replace(/{travelZ}/g, this.formatCoordinate(travelZ));

            // Conditionally add 'off' commands (if not already in template)
            if (options.coolant && options.coolant !== 'none' && !endCode.includes('M9')) {
                endCode = this.appendComment('M9', c.coolantOff, options) + '\n' + endCode; // Coolant Off
            }
            if (options.vacuum && !endCode.includes('M11')) {
                endCode = this.appendComment('M11', c.vacuumOff, options) + '\n' + endCode; // Vacuum Off
            }

            return endCode;
        }

        /**
         * Generates G-code to set spindle speed, only if it has changed.
         * This is the core of the stateful spindle logic.
         * @param {number} speed - The new target RPM
         * @returns {string} G-code string (e.g., "M5\nM3 S10000") or "" if no change.
         */
        setSpindle(speed, dwell = 0, options = {}) {
            if (speed === this.currentSpindle) {
                return null;
            }

            // Spindle Validation
            let targetSpeed = speed;
            if (targetSpeed > this.config.maxSpindleSpeed) {
                console.warn(`[PostProcessor] Spindle speed ${targetSpeed} exceeds machine maximum of ${this.config.maxSpindleSpeed}. Capping value.`);
                targetSpeed = this.config.maxSpindleSpeed;
            }

            const c = options.comments || {};
            this.currentSpindle = speed;

            const lines = [];

            if (speed > 0) {
                lines.push(this.appendComment(`M3 S${speed}`, c.spindleStart, options));
                if (dwell > 0) {
                    lines.push(this.appendComment(`G4 P${this.formatDwell(dwell)}`, c.spindleDwell, options));
                }
            } else {
                lines.push(this.appendComment('M5', c.spindleStop, options));
            }
            
            return lines.join('\n');
        }

        // TEST DRAFT - DO NOT CONNECT
        /*
        generateToolChange(tool, options) {
            if (!this.config.supportsToolChange) return '';

            const lines = [];
            const c = options.comments || {};
            const safeZ = options.safeZ || this.config.safetyHeight;
            const toolNumber = tool.number || options.toolNumber || 1;

            lines.push('');
            this.pushCommentLine(lines, (c.toolChange || 'Tool change: {name}').replace('{name}', tool.name || tool.id), options);
            this.pushCommentLine(lines, (c.toolDiameter || 'Diameter: {diameter}mm').replace('{diameter}', tool.diameter), options);

            // Stop Spindle and Coolant
            const stopGcode = this.setSpindle(0, 0, options);
            if (stopGcode) {
                lines.push(stopGcode);
            } else if (this.currentSpindle > 0) {
                lines.push(this.appendComment('M5', c.spindleStop, options));
                this.currentSpindle = 0;
            }

            if (options.coolant && options.coolant !== 'none') {
                lines.push(this.appendComment('M9', c.coolantOff, options));
            }

            // Retract to Safe Z
            lines.push(this.appendComment(`G0 Z${this.formatCoordinate(safeZ)}`, c.retractSafeZ, options));
            this.currentPosition.z = safeZ;

            // Tool Change Command
            if (this.config.useM6) {
                lines.push(`T${toolNumber} M6`);
            }

            // Tool Length Compensation
            if (this.config.supportsToolLengthComp) {
                lines.push(this.appendComment(`G43 H${toolNumber}`, c.toolLengthComp, options));
            }

            // Pause for Manual Change
            if (this.config.pauseAfterToolChange) {
                lines.push(this.appendComment('M0', c.toolChangePause, options));
            }
            lines.push('');

            // Restart Spindle
            const spindleSpeed = tool.spindleSpeed || options.spindleSpeed || 12000;
            const startGcode = this.setSpindle(spindleSpeed, tool.spindleDwell || 0, options);
            if (startGcode) {
                lines.push(startGcode);
            }

            // Restart Coolant
            if (options.coolant && options.coolant !== 'none') {
                if (options.coolant === 'mist') {
                    lines.push(this.appendComment('M7', c.coolantMist, options));
                } else if (options.coolant === 'flood') {
                    lines.push(this.appendComment('M8', c.coolantFlood, options));
                }
            }

            lines.push('');
            return lines.join('\n');
        }
        */

        // Base formatter that safely strips trailing zeros and handles -0
        _formatNumberSafe(value, precision, scale = 1.0) {
            if (value == null) return ''; // Catches null and undefined

            const scaled = value * scale;
            if (precision === 0) return Math.round(scaled).toString();

            // toFixed clamps precision, parseFloat strips trailing zeros & fixes '-0'
            return parseFloat(scaled.toFixed(precision)).toString();
        }

        formatCoordinate(value) { 
            return this._formatNumberSafe(value, this.config.coordinateDecimals, this.outputScale); 
        }

        formatFeed(value) { 
            return this._formatNumberSafe(value, this.config.feedDecimals, this.outputScale); 
        }

        formatSpindle(value) { 
            return this._formatNumberSafe(value, this.config.spindleDecimals); 
        }

        /**
         * Formats dwell time for the P parameter.
         */
        formatDwell(seconds) {
            // Standard G-code (GRBL, etc.) expects seconds for G4 P
            return parseFloat(seconds.toFixed(3));
        }

        generateArc(cmd) {
            if (!this.config.supportsArcCommands) {
                return this.generateLinear(cmd);
            }

            const gCommand = cmd.type === 'ARC_CW' ? 'G2' : 'G3';
            const isFullCircle = this._isFullCircle(cmd);

            // Determine if G-code command output is needed 
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
            return `G4 P${this.formatDwell(duration)}`;
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
                case 'CANNED_SIMPLE': 
                    if (this.generateSimpleDrill) return this.generateSimpleDrill({x: cmd.x, y: cmd.y}, cmd.z, cmd.retract, cmd.f, cmd.dwell);
                    return '';
                case 'CANNED_PECK':
                    // Route to G73 if requested AND supported by the specific post-processor
                    if (cmd.cycleType === 'G73' && this.generateChipBreakDrill) {
                        return this.generateChipBreakDrill({x: cmd.x, y: cmd.y}, cmd.z, cmd.retract, cmd.peckDepth, cmd.f);
                    } 
                    // Fallback to G83 if G73 isn't available, or if G83 was explicitly requested
                    else if (this.generatePeckDrill) {
                        return this.generatePeckDrill({x: cmd.x, y: cmd.y}, cmd.z, cmd.retract, cmd.peckDepth, cmd.f);
                    }
                    return '';
                default:
                    return '';
            }
        }

        /**
         * G81 — Simple drilling cycle (no dwell).
         * G82 — Drilling cycle with dwell at bottom.
         * Dwell parameter P is in milliseconds for UCCNC.
         */
        generateSimpleDrill(position, depth, retract, feedRate, dwellTime) {
            let line = '';

            // Emit cycle code only on first hole or if changed
            const cycleCode = dwellTime > 0 ? 'G82' : 'G81';
            if (cycleCode !== this.cannedState.cycleType) {
                line += cycleCode + ' ';
                this.cannedState.cycleType = cycleCode;
            }

            // Always emit XY (position changes every hole)
            line += `X${this.formatCoordinate(position.x)} Y${this.formatCoordinate(position.y)}`;

            // Emit Z, R, F, P only if changed from last canned command
            if (depth !== this.cannedState.z) {
                line += ` Z${this.formatCoordinate(depth)}`;
                this.cannedState.z = depth;
            }
            if (retract !== this.cannedState.r) {
                line += ` R${this.formatCoordinate(retract)}`;
                this.cannedState.r = retract;
            }
            if (feedRate !== this.cannedState.f) {
                line += ` F${this.formatFeed(feedRate)}`;
                this.cannedState.f = feedRate;
            }
            if (dwellTime > 0 && dwellTime !== this.cannedState.dwell) {
                line += ` P${this.formatDwell(dwellTime)}`;
                this.cannedState.dwell = dwellTime;
            }

            return line;
        }

        /**
         * G83 — Peck drilling cycle (full retract between pecks).
         */
        generatePeckDrill(position, depth, retract, peckDepth, feedRate, cycleType = 'G83') {
            let line = '';

            if (cycleType !== this.cannedState.cycleType) {
                line += cycleType + ' ';
                this.cannedState.cycleType = cycleType;
            }

            line += `X${this.formatCoordinate(position.x)} Y${this.formatCoordinate(position.y)}`;

            if (depth !== this.cannedState.z) {
                line += ` Z${this.formatCoordinate(depth)}`;
                this.cannedState.z = depth;
            }
            if (retract !== this.cannedState.r) {
                line += ` R${this.formatCoordinate(retract)}`;
                this.cannedState.r = retract;
            }
            if (peckDepth !== this.cannedState.q) {
                line += ` Q${this.formatCoordinate(peckDepth)}`;
                this.cannedState.q = peckDepth;
            }
            if (feedRate !== this.cannedState.f) {
                line += ` F${this.formatFeed(feedRate)}`;
                this.cannedState.f = feedRate;
            }

            return line;
        }

        /**
         * G73 — Chip-breaking cycle (partial retract between pecks).
         * Faster than G83 for materials that produce stringy chips.
         */
        generateChipBreakDrill(position, depth, retract, peckDepth, feedRate) {
            let line = '';

            if ('G73' !== this.cannedState.cycleType) {
                line += 'G73 ';
                this.cannedState.cycleType = 'G73';
            }

            line += `X${this.formatCoordinate(position.x)} Y${this.formatCoordinate(position.y)}`;

            if (depth !== this.cannedState.z) {
                line += ` Z${this.formatCoordinate(depth)}`;
                this.cannedState.z = depth;
            }
            if (retract !== this.cannedState.r) {
                line += ` R${this.formatCoordinate(retract)}`;
                this.cannedState.r = retract;
            }
            if (peckDepth !== this.cannedState.q) {
                line += ` Q${this.formatCoordinate(peckDepth)}`;
                this.cannedState.q = peckDepth;
            }
            if (feedRate !== this.cannedState.f) {
                line += ` F${this.formatFeed(feedRate)}`;
                this.cannedState.f = feedRate;
            }

            return line;
        }

        cancelCannedCycle(options) {
            // Reset modal tracking so next canned cycle emits full parameters
            this.cannedState = {
                cycleType: null, z: null, r: null,
                q: null, f: null, dwell: null
            };
            return 'G80';
        }

        validateCommand(cmd, options = {}) {
            const warnings = [];
            const errors = [];

            // Grab limits from the options context passed by the generator
            const maxFeed = options.maxFeed || this.config.maxFeedRate || 5000;
            const maxSafeDepth = options.lowestZ || -25.0; // Negative Z limit // Arbitrary deep limit // REVIEW - Add to config constants

            // Universal Feed Rate Check
            if (cmd.f !== undefined && cmd.f !== null) {
                if (cmd.f > maxFeed) {
                    warnings.push(`Feed rate F${cmd.f} exceeds machine maximum of ${maxFeed}.`);
                }
            }

            // Critical Z-Plunge Check (Catch runaway math errors)
            if ((cmd.type === 'LINEAR' || cmd.type === 'PLUNGE') && cmd.z !== null && cmd.z !== undefined) {
                if (cmd.z < maxSafeDepth) {
                    errors.push(`CRITICAL: Commanded Z depth (${cmd.z.toFixed(3)}mm) exceeds maximum safe cutting depth (${maxSafeDepth}mm).`);
                }
            }

            return { warnings, errors };
        }

        resetState() {
            this.currentPosition = { x: 0, y: 0, z: 0 };
            this.currentFeed = null;
            this.currentSpindle = 0;
            this.modalState = {
                motionMode: null,
                coordinateMode: 'G90',
                units: 'G21',
                plane: 'G17',
                feedRateMode: 'G94'
            };
            // Canned cycle modal state — tracks last-emitted parameters
            this.cannedState = {
                cycleType: null,
                z: null,
                r: null,
                q: null,
                f: null,
                dwell: null
            };
        }
    }

    window.BasePostProcessor = BasePostProcessor;
})();