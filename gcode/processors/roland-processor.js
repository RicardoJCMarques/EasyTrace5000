/*!
 * @file        gcode/processors/roland-processor.js
 * @description Roland RML-1 post-processing module
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

    /**
     * Roland RML-1 Post-Processor
     * 
     * Implements the same interface as BasePostProcessor for use by GCodeGenerator.
     * 
     * TWO COMMAND MODELS:
     * 
     * 3D Mode (MDX-40A+):
     *   All motion via Z x,y,z; command. Speed controlled by !VZ/V.
     *   No PU/PD/VS used.
     * 
     * 2.5D Mode (PU/PD):
     *   PU x,y; — rapid move to (x,y) at !PZ z2 height
     *   PD x,y; — cut move to (x,y) at !PZ z1 depth, speed VS
     *   !PZ z1,z2; — set depth register (z1=PD depth, z2=PU height)
     *   VS speed; — set XY cutting velocity (mm/sec)
     *   !VZ speed; — set Z/plunge velocity (mm/sec)
     * 
     * Common commands:
     *   PA; — Plot Absolute mode
     *   !MC 0|1; — Motor Control off/on
     *   !RC value; — Rotation Control (RPM or index 1-15)
     *   !DW ms; — Dwell in milliseconds
     * 
     * Coordinates are integer "steps" (mm × stepsPerMM).
     */
    class RolandPostProcessor {
        constructor(processorConfig = {}) {
            this.name = 'roland';
            this.config = {
                fileExtension: '.rml',
                supportsToolChange: true,
                supportsArcCommands: false,
                supportsCannedCycles: false
            };

            // Inject precision from global config
            this.epsilon = processorConfig.precision.epsilon;

            this.resetState();
        }

        resetState() {
            this.currentPosition = { x: 0, y: 0, z: 0 };
            this.currentSpindle = 0;
            this.currentFeed = null;    // VS value (mm/min internally, for 2.5D XY)
            this.currentVZ = null;      // !VZ value (mm/min internally)

            // !PZ register tracking (in mm, converted on output)
            this._pzDownMM = 0;
            this._pzUpMM = 5.0;

            // Machine parameters (set from options in generateHeader)
            this.stepsPerMM = 100;
            this.maxFeedXY = 60;        // mm/sec — machine maximum for XY
            this.maxFeedZ = 60;         // mm/sec — machine maximum for Z
            this.zMode = '3d';
            this.spindleMode = 'direct';
            this.travelZ = 3.0;
            this.safeZ = 5.0;
            this.model = 'mdx50';
            this.useLegacyVelocity = false;

            // Active profile reference (set in generateHeader)
            this.profile = null;
        }

        generateHeader(options) {
            // Load profile from centralized config, fall back to options
            this.model = options.rolandModel || 'mdx50';
            this.profile = (window.PCBCAMConfig?.roland?.getProfile)
                ? window.PCBCAMConfig.roland.getProfile(this.model)
                : null;

            // Read machine parameters — profile values are authoritative, options are overrides
            this.stepsPerMM = options.rolandStepsPerMM || this.profile?.stepsPerMM || 100;
            this.maxFeedXY = this.profile?.maxFeedXY || options.rolandMaxFeed || 60;
            this.maxFeedZ = this.profile?.maxFeedZ || this.maxFeedXY; // Fall back to XY if not specified
            this.zMode = options.rolandZMode || this.profile?.zMode || '3d';
            this.spindleMode = options.rolandSpindleMode || this.profile?.spindleMode || 'direct';
            this.travelZ = options.travelZ || 3.0;
            this.safeZ = options.safeZ || 5.0;
            this.useLegacyVelocity = this.profile?.cmdProtocol === 'legacy';

            const lines = [];

            // 1. User start code (includes machine init ;;^IN/;;^DF + PA; by default)
            //    RML has no comment syntax — semicolons are command terminators.
            //    Never inject "; text" lines — they produce junk commands / 1025 errors.
            if (options.startCode) {
                lines.push(options.startCode);
            }

            // 2. Velocity setup — differs by Z mode and protocol
            const firstPlan = options.firstPlan;
            const velCmd = this.useLegacyVelocity ? 'V' : '!VZ';

            if (this.zMode === '3d') {
                // 3D mode: Z command uses V/!VZ speed for ALL axes.
                // VS is irrelevant — never set it. Only V/!VZ matters.
                const cutFeed = (firstPlan && firstPlan.metadata) ? firstPlan.metadata.feedRate : 150;
                lines.push(`${velCmd}${this.mmMinToVS(cutFeed)};`);
                this.currentVZ = cutFeed;
            } else {
                // 2.5D mode: VS for XY cutting (PD), V/!VZ for plunge speed
                const cutFeed = (firstPlan && firstPlan.metadata) ? firstPlan.metadata.feedRate : 150;
                lines.push(`VS${this.mmMinToVS(cutFeed)};`);
                this.currentFeed = cutFeed;

                const plungeRate = (firstPlan && firstPlan.metadata && firstPlan.metadata.plungeRate)
                    ? firstPlan.metadata.plungeRate : 60;
                lines.push(`${velCmd}${this.mmMinToVS(plungeRate)};`);
                this.currentVZ = plungeRate;
            }

            // 3. Z parameters — safety registers (used as fallback in both modes)
            this._pzDownMM = 0;
            this._pzUpMM = this.travelZ;
            lines.push(`!PZ${this.fmtCoord(this._pzDownMM)},${this.fmtCoord(this._pzUpMM)};`);

            // 4. Spindle — after all setup params are established
            if (firstPlan && firstPlan.metadata && firstPlan.metadata.spindleSpeed > 0) {
                const speed = firstPlan.metadata.spindleSpeed;

                // Only emit !RC if the machine supports software spindle control
                if (this.spindleMode === 'direct') {
                    lines.push(`!RC${Math.round(speed)};`);
                }
                // 'manual': skip !RC entirely — user controls spindle physically

                lines.push('!MC1;');

                const dwell = firstPlan.metadata.spindleDwell || 0;
                if (dwell > 0 && (this.profile?.supportsDwell !== false)) {
                    lines.push(`!DW${Math.round(dwell * 1000)};`);
                }
                this.currentSpindle = speed;
            }

            return lines.join('\n');
        }

        generateFooter(options) {
            // endCode from settings (defaults to '!MC0;\n;;^DF' or '!MC0;\n;;^IN')
            return options.endCode || '!MC0;';
        }

        generateToolChange(tool, options) {
            // Functionality Placeholder
            return '';
        }

        setSpindle(speed, dwell = 0) {
            const wantOn = speed > 0;
            const wasOn = this.currentSpindle > 0;

            if (wantOn === wasOn && (!wantOn || speed === this.currentSpindle)) {
                return null;
            }

            const lines = [];

            if (wantOn && !wasOn) {
                // Turning on
                if (this.spindleMode === 'direct') {
                    lines.push(`!RC${Math.round(speed)};`);
                }
                lines.push('!MC1;');
                if (dwell > 0 && (this.profile?.supportsDwell !== false)) {
                    lines.push(`!DW${Math.round(dwell * 1000)};`);
                }
                this.currentSpindle = speed;

            } else if (!wantOn && wasOn) {
                // Turning off
                lines.push('!MC0;');
                this.currentSpindle = 0;

            } else if (wantOn && wasOn && speed !== this.currentSpindle) {
                // Speed change while running
                if (this.spindleMode === 'direct') {
                    lines.push(`!RC${Math.round(speed)};`);
                }
                this.currentSpindle = speed;
            }

            return lines.join('\n');
        }

        /**
         * Main dispatch — routes to the correct command model.
         */
        processCommand(cmd) {
            return this.zMode === '3d' ? this._process3D(cmd) : this._process25D(cmd);
        }

        /**
         * 3D Mode: All motion via V/!VZ + Z x,y,z; command.
         * 
         * Modern machines (MDX-40+): !VZ sets speed for Z command (all axes)
         * Legacy machines (MDX-15/20): V sets speed for Z command (all axes)
         * 
         * In both cases:
         *   - Z x,y,z; moves to absolute position at that speed
         *   - VS, PU, PD are NEVER used
         *   - Rapids = Z command at machine max speed
         *   - Cuts = Z command at cutting feed
         *   - Plunges = Z command at plunge feed
         */
        _process3D(cmd) {
            const targetX = cmd.x ?? this.currentPosition.x;
            const targetY = cmd.y ?? this.currentPosition.y;
            const targetZ = cmd.z ?? this.currentPosition.z;

            // Quantize to machine steps for accurate change detection
            const stepTargetX = Math.round(targetX * this.stepsPerMM);
            const stepTargetY = Math.round(targetY * this.stepsPerMM);
            const stepTargetZ = Math.round(targetZ * this.stepsPerMM);
            const stepCurrentX = Math.round(this.currentPosition.x * this.stepsPerMM);
            const stepCurrentY = Math.round(this.currentPosition.y * this.stepsPerMM);
            const stepCurrentZ = Math.round(this.currentPosition.z * this.stepsPerMM);

            const xChanged = stepTargetX !== stepCurrentX;
            const yChanged = stepTargetY !== stepCurrentY;
            const zChanged = stepTargetZ !== stepCurrentZ;

            if (!xChanged && !yChanged && !zChanged && cmd.type !== 'DWELL') {
                return '';
            }

            const lines = [];
            const velCmd = this.useLegacyVelocity ? 'V' : '!VZ';

            switch (cmd.type) {
                case 'RAPID':
                case 'RETRACT': {
                    // Set speed to machine maximum for rapid travel
                    const rapidMmSec = Math.min(this.maxFeedXY, this.maxFeedZ);
                    const rapidMmMin = rapidMmSec * 60;
                    if (this.currentVZ === null || Math.abs(rapidMmMin - this.currentVZ) > 0.1) {
                        lines.push(`${velCmd}${this.mmMinToVS(rapidMmMin, 'combined')};`);
                        this.currentVZ = rapidMmMin;
                    }
                    lines.push(`Z${this.fmtCoord(targetX)},${this.fmtCoord(targetY)},${this.fmtCoord(targetZ)};`);
                    this.currentPosition = {
                        x: stepTargetX / this.stepsPerMM,
                        y: stepTargetY / this.stepsPerMM,
                        z: stepTargetZ / this.stepsPerMM
                    };
                    break;
                }

                case 'LINEAR':
                case 'PLUNGE': {
                    // Determine dominant axis for feed clamping
                    const isZOnly = !xChanged && !yChanged && zChanged;
                    const isXYOnly = (xChanged || yChanged) && !zChanged;
                    const feedAxis = isZOnly ? 'z' : isXYOnly ? 'xy' : 'combined';

                    if (cmd.f != null) {
                        if (this.currentVZ === null || Math.abs(cmd.f - this.currentVZ) > 0.1) {
                            lines.push(`${velCmd}${this.mmMinToVS(cmd.f, feedAxis)};`);
                            this.currentVZ = cmd.f;
                        }
                    }
                    lines.push(`Z${this.fmtCoord(targetX)},${this.fmtCoord(targetY)},${this.fmtCoord(targetZ)};`);
                    this.currentPosition = {
                        x: stepTargetX / this.stepsPerMM,
                        y: stepTargetY / this.stepsPerMM,
                        z: stepTargetZ / this.stepsPerMM
                    };
                    break;
                }

                case 'DWELL': {
                    // Legacy machines (MDX-15/20) don't support !DW
                    if (this.useLegacyVelocity && !this.profile?.supportsDwell) {
                        break; // Skip silently - no dwell capability
                    }
                    const ms = Math.round((cmd.dwell || 0) * 1000);
                    if (ms > 0) {
                        lines.push(`!DW${ms};`);
                    }
                    break;
                }

                case 'ARC_CW':
                case 'ARC_CCW': {
                    console.warn('[RolandProcessor] Arc command reached processor — should have been linearized');
                    if (cmd.f != null) {
                        if (this.currentVZ === null || Math.abs(cmd.f - this.currentVZ) > 0.1) {
                            lines.push(`${velCmd}${this.mmMinToVS(cmd.f)};`);
                            this.currentVZ = cmd.f;
                        }
                    }
                    lines.push(`Z${this.fmtCoord(targetX)},${this.fmtCoord(targetY)},${this.fmtCoord(targetZ)};`);
                    this.currentPosition = {
                        x: stepTargetX / this.stepsPerMM,
                        y: stepTargetY / this.stepsPerMM,
                        z: stepTargetZ / this.stepsPerMM
                    };
                    break;
                }

                default:
                    break;
            }

            return lines.join('\n');
        }

        /**
         * 2.5D Mode: PU/PD with !PZ register management.
         * 
         * Command model:
         *   - PU x,y; — pen up, move XY at PU height (z2). Speed is max.
         *   - PD x,y; — pen down to PD depth (z1), then move XY. Speed is VS.
         *   - !PZ z1,z2; — set the depth (z1) and clearance (z2) registers
         *   - VS speed; — set XY cutting speed for PD moves
         *   - !VZ speed; — set plunge speed (Z-axis movement in PD)
         * 
         * Z position is implicit: after PU it's z2, after PD it's z1.
         * No simultaneous XYZ motion is possible.
         */
        _process25D(cmd) {
            const targetX = cmd.x ?? this.currentPosition.x;
            const targetY = cmd.y ?? this.currentPosition.y;
            const targetZ = cmd.z ?? this.currentPosition.z;

            // Quantize to machine steps for accurate change detection
            const stepTargetX = Math.round(targetX * this.stepsPerMM);
            const stepTargetY = Math.round(targetY * this.stepsPerMM);
            const stepTargetZ = Math.round(targetZ * this.stepsPerMM);
            const stepCurrentX = Math.round(this.currentPosition.x * this.stepsPerMM);
            const stepCurrentY = Math.round(this.currentPosition.y * this.stepsPerMM);
            const stepCurrentZ = Math.round(this.currentPosition.z * this.stepsPerMM);

            const xChanged = stepTargetX !== stepCurrentX;
            const yChanged = stepTargetY !== stepCurrentY;
            const zChanged = stepTargetZ !== stepCurrentZ;

            if (!xChanged && !yChanged && !zChanged && cmd.type !== 'DWELL') {
                return '';
            }

            const lines = [];

            switch (cmd.type) {
                case 'RAPID':
                case 'RETRACT': {
                    // Update the PU height register (z2) if Z target changed
                    if (zChanged) {
                        const pz = this._emitPZIfChanged(this._pzDownMM, targetZ);
                        if (pz) lines.push(pz);
                    }
                    lines.push(`PU${this.fmtCoord(targetX)},${this.fmtCoord(targetY)};`);
                    // After PU, machine Z is at z2 (up height). Track quantized XY.
                    this.currentPosition = {
                        x: stepTargetX / this.stepsPerMM,
                        y: stepTargetY / this.stepsPerMM,
                        z: this._pzUpMM
                    };
                    break;
                }

                case 'LINEAR':
                case 'PLUNGE': {
                    const velCmd = this.useLegacyVelocity ? 'V' : '!VZ';

                    // Feed rate handling
                    if (cmd.f != null) {
                        const isPlungeMove = cmd.type === 'PLUNGE' || (zChanged && !xChanged && !yChanged);
                        const isSimultaneous = zChanged && (xChanged || yChanged);

                        if (isPlungeMove || isSimultaneous) {
                            // Plunge/Z speed via V/!VZ
                            if (this.currentVZ === null || Math.abs(cmd.f - this.currentVZ) > 0.1) {
                                lines.push(`${velCmd}${this.mmMinToVS(cmd.f)};`);
                                this.currentVZ = cmd.f;
                            }
                        }
                        if (!isPlungeMove) {
                            // XY cutting speed via VS
                            if (this.currentFeed === null || Math.abs(cmd.f - this.currentFeed) > 0.1) {
                                lines.push(`VS${this.mmMinToVS(cmd.f)};`);
                                this.currentFeed = cmd.f;
                            }
                        }
                    }

                    // Update the PD depth register (z1) if Z target changed
                    if (zChanged) {
                        const pz = this._emitPZIfChanged(targetZ, this._pzUpMM);
                        if (pz) lines.push(pz);
                    }

                    lines.push(`PD${this.fmtCoord(targetX)},${this.fmtCoord(targetY)};`);
                    this.currentPosition = {
                        x: stepTargetX / this.stepsPerMM,
                        y: stepTargetY / this.stepsPerMM,
                        z: this._pzDownMM
                    };
                    break;
                }

                case 'DWELL': {
                    const ms = Math.round((cmd.dwell || 0) * 1000);
                    if (ms > 0) {
                        lines.push(`!DW${ms};`);
                    }
                    break;
                }

                case 'ARC_CW':
                case 'ARC_CCW': {
                    // Should never reach here — fallback to linear
                    console.warn('[RolandProcessor] Arc command reached 2.5D processor — should have been linearized');
                    if (zChanged) {
                        const pz = this._emitPZIfChanged(targetZ, this._pzUpMM);
                        if (pz) lines.push(pz);
                    }
                    lines.push(`PD${this.fmtCoord(targetX)},${this.fmtCoord(targetY)};`);
                    this.currentPosition = {
                        x: stepTargetX / this.stepsPerMM,
                        y: stepTargetY / this.stepsPerMM,
                        z: this._pzDownMM
                    };
                    break;
                }

                default:
                    break;
            }

            return lines.join('\n');
        }

        /**
         * Emits !PZ command only if register values actually changed.
         */
        _emitPZIfChanged(newDownMM, newUpMM) {
            const downChanged = Math.abs(newDownMM - this._pzDownMM) > this.epsilon;
            const upChanged = Math.abs(newUpMM - this._pzUpMM) > this.epsilon;

            if (downChanged || upChanged) {
                this._pzDownMM = newDownMM;
                this._pzUpMM = newUpMM;
                return `!PZ${this.fmtCoord(this._pzDownMM)},${this.fmtCoord(this._pzUpMM)};`;
            }
            return '';
        }

        /**
         * Format a mm value as integer steps for RML output.
         */
        fmtCoord(value) {
            if (value === null || value === undefined) return '0';
            return Math.round(value * this.stepsPerMM).toString();
        }

        /**
         * Convert mm/min feed rate to Roland velocity string (mm/sec, clamped to machine max).
         */
        mmMinToVS(mmPerMin, axis = 'combined') {
            const mmPerSec = mmPerMin / 60;
            let maxForAxis;
            switch (axis) {
                case 'xy': maxForAxis = this.maxFeedXY; break;
                case 'z':  maxForAxis = this.maxFeedZ; break;
                default:   maxForAxis = Math.min(this.maxFeedXY, this.maxFeedZ); break;
            }
            const clamped = Math.max(0.1, Math.min(maxForAxis, mmPerSec));
            return parseFloat(clamped.toFixed(1)).toString();
        }
    }

    window.RolandPostProcessor = RolandPostProcessor;
})();