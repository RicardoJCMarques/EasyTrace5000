/**
 * @file        theme-loader.js
 * @description Theme loading and switching utility
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

    class ThemeLoader {
        constructor() {
            this.currentTheme = null;
            this.themes = new Map();
            this.storageKey = 'pcbcam-theme';
            this.initialized = false;
        }

        /**
         * Initialize theme system
         * @param {string} defaultTheme - Default theme ID ('dark' or 'light')
         * @returns {Promise<boolean>} Success status
         */
        async init(defaultTheme = 'dark') {
            if (this.initialized) return true;

            try {
                // Load both themes
                await Promise.all([
                    this.loadTheme('dark', 'themes/dark.json'),
                    this.loadTheme('light', 'themes/light.json')
                ]);

                // Get saved theme or use default
                const savedTheme = localStorage.getItem(this.storageKey) || defaultTheme;

                // Apply theme
                await this.applyTheme(savedTheme);

                this.initialized = true;
                return true;

            } catch (error) {
                console.error('Theme initialization failed:', error);
                // Apply fallback theme from CSS
                this.applyFallbackTheme(defaultTheme);
                return false;
            }
        }

        /**
         * Load theme from JSON file
         * @param {string} id - Theme ID
         * @param {string} url - Theme JSON file URL
         * @returns {Promise<Object>} Theme data
         */
        async loadTheme(id, url) {
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const themeData = await response.json();

                // Validate theme structure
                if (!this.validateTheme(themeData)) {
                    throw new Error(`Invalid theme structure in ${url}`);
                }

                this.themes.set(id, themeData);
                return themeData;

            } catch (error) {
                console.error(`Failed to load theme ${id} from ${url}:`, error);
                throw error;
            }
        }

        /**
         * Validate theme data structure
         * @param {Object} theme - Theme data
         * @returns {boolean} Valid
         */
        validateTheme(theme) {
            if (!theme || typeof theme !== 'object') return false;
            if (!theme.id || !theme.colors) return false;

            const requiredCategories = ['background', 'text', 'border', 'accent'];
            return requiredCategories.every(cat => theme.colors[cat]);
        }

        /**
         * Apply theme to document
         * @param {string} themeId - Theme ID to apply
         * @returns {Promise<boolean>} Success status
         */
        async applyTheme(themeId) {
            const theme = this.themes.get(themeId);

            if (!theme) {
                console.warn(`Theme ${themeId} not found`);
                return false;
            }

            // Set theme attribute on document
            document.documentElement.setAttribute('data-theme', themeId);

            // Apply all color variables to :root
            this.applyColorVariables(theme.colors);

            // Save preference
            localStorage.setItem(this.storageKey, themeId);

            this.currentTheme = themeId;

            // Dispatch theme change event
            window.dispatchEvent(new CustomEvent('themechange', {
                detail: { themeId, theme }
            }));

            return true;
        }

        /**
         * Apply color variables to CSS
         * @param {Object} colors - Color definitions
         */
        applyColorVariables(colors) {
            const root = document.documentElement;

            // Background colors
            if (colors.background) {
                root.style.setProperty('--color-bg-primary', colors.background.primary);
                root.style.setProperty('--color-bg-secondary', colors.background.secondary);
                root.style.setProperty('--color-bg-tertiary', colors.background.tertiary);
                root.style.setProperty('--color-bg-hover', colors.background.hover);
                root.style.setProperty('--color-bg-active', colors.background.active);
            }

            // Text colors
            if (colors.text) {
                root.style.setProperty('--color-text-primary', colors.text.primary);
                root.style.setProperty('--color-text-secondary', colors.text.secondary);
                root.style.setProperty('--color-text-disabled', colors.text.disabled);
                root.style.setProperty('--color-text-hint', colors.text.hint);
            }

            // Border colors
            if (colors.border) {
                root.style.setProperty('--color-border-primary', colors.border.primary);
                root.style.setProperty('--color-border-secondary', colors.border.secondary);
                root.style.setProperty('--color-border-focus', colors.border.focus);
            }

            // Accent colors
            if (colors.accent) {
                root.style.setProperty('--color-accent-primary', colors.accent.primary);
                root.style.setProperty('--color-accent-hover', colors.accent.hover);
                root.style.setProperty('--color-accent-active', colors.accent.active);
            }

            // Semantic colors
            if (colors.semantic) {
                root.style.setProperty('--color-success', colors.semantic.success);
                root.style.setProperty('--color-warning', colors.semantic.warning);
                root.style.setProperty('--color-error', colors.semantic.error);
                root.style.setProperty('--color-info', colors.semantic.info);
            }

            // Operation colors
            if (colors.operations) {
                root.style.setProperty('--color-operation-isolation', colors.operations.isolation);
                root.style.setProperty('--color-operation-drill', colors.operations.drill);
                root.style.setProperty('--color-operation-clearing', colors.operations.clearing);
                root.style.setProperty('--color-operation-cutout', colors.operations.cutout);
                root.style.setProperty('--color-operation-toolpath', colors.operations.toolpath);
            }

            // Canvas colors
            if (colors.canvas) {
                root.style.setProperty('--color-canvas-bg', colors.canvas.background);
                root.style.setProperty('--color-canvas-grid', colors.canvas.grid);
                root.style.setProperty('--color-canvas-origin', colors.canvas.origin);
                root.style.setProperty('--color-canvas-origin-outline', colors.canvas.originOutline);
                root.style.setProperty('--color-canvas-bounds', colors.canvas.bounds);
                root.style.setProperty('--color-canvas-ruler', colors.canvas.ruler);
                root.style.setProperty('--color-canvas-ruler-text', colors.canvas.rulerText);
            }

            // Debug colors
            if (colors.debug) {
                root.style.setProperty('--color-debug-points', colors.debug.points);
                root.style.setProperty('--color-debug-arcs', colors.debug.arcs);
                root.style.setProperty('--color-debug-wireframe', colors.debug.wireframe);
                root.style.setProperty('--color-debug-bounds', colors.debug.bounds);
            }

            // Geometry colors
            if (colors.geometry) {
                if (colors.geometry.source) {
                    root.style.setProperty('--color-geometry-source-isolation', colors.geometry.source.isolation);
                    root.style.setProperty('--color-geometry-source-drill', colors.geometry.source.drill);
                    root.style.setProperty('--color-geometry-source-clearing', colors.geometry.source.clearing);
                    root.style.setProperty('--color-geometry-source-cutout', colors.geometry.source.cutout);
                }
                if (colors.geometry.offset) {
                    root.style.setProperty('--color-geometry-offset-external', colors.geometry.offset.external);
                    root.style.setProperty('--color-geometry-offset-internal', colors.geometry.offset.internal);
                    root.style.setProperty('--color-geometry-offset-on', colors.geometry.offset.on);
                }
                root.style.setProperty('--color-geometry-preview', colors.geometry.preview);
                root.style.setProperty('--color-geometry-toolpath', colors.geometry.toolpath);
                root.style.setProperty('--color-geometry-selection', colors.geometry.selection);
            }

            // Primitive-specific colors
            if (colors.primitives) {
                root.style.setProperty('--color-primitive-offset-internal', colors.primitives.offsetInternal);
                root.style.setProperty('--color-primitive-offset-external', colors.primitives.offsetExternal);
                root.style.setProperty('--color-primitive-peck-good', colors.primitives.peckMarkGood);
                root.style.setProperty('--color-primitive-peck-warn', colors.primitives.peckMarkWarn);
                root.style.setProperty('--color-primitive-peck-error', colors.primitives.peckMarkError);
                root.style.setProperty('--color-primitive-peck-slow', colors.primitives.peckMarkSlow);
                root.style.setProperty('--color-primitive-reconstructed', colors.primitives.reconstructed);
                root.style.setProperty('--color-primitive-reconstructed-path', colors.primitives.reconstructedPath);
                root.style.setProperty('--color-primitive-debug-label', colors.primitives.debugLabel);
                root.style.setProperty('--color-primitive-debug-label-stroke', colors.primitives.debugLabelStroke);
            }

            // Black and White
            if (colors.bw) {
                root.style.setProperty('--color-bw-white', colors.bw.white);
                root.style.setProperty('--color-bw-black', colors.bw.black);
            }
        }

        /**
         * Apply fallback theme (uses CSS defaults)
         * @param {string} themeId - Theme ID
         */
        applyFallbackTheme(themeId) {
            document.documentElement.setAttribute('data-theme', themeId);
            localStorage.setItem(this.storageKey, themeId);
            this.currentTheme = themeId;
        }

        /**
         * Toggle between light and dark themes
         * @returns {Promise<string>} New theme ID
         */
        async toggleTheme() {
            const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
            await this.applyTheme(newTheme);
            return newTheme;
        }

        /**
         * Get current theme ID
         * @returns {string|null} Current theme ID
         */
        getCurrentTheme() {
            return this.currentTheme;
        }

        /**
         * Get theme data
         * @param {string} themeId - Theme ID
         * @returns {Object|null} Theme data
         */
        getTheme(themeId) {
            return this.themes.get(themeId) || null;
        }

        /**
         * Check if themes are loaded
         * @returns {boolean} Loaded status
         */
        isLoaded() {
            return this.initialized;
        }
    }

    // Create global instance
    window.ThemeLoader = new ThemeLoader();

    // Auto-initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.ThemeLoader.init();
        });
    } else {
        window.ThemeLoader.init();
    }

})();