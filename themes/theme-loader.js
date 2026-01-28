/*!
 * @file        theme-loader.js
 * @description Theme loading and switching utility
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

    class ThemeLoader {
        constructor() {
            this.currentTheme = 'dark'; // Matches CSS default
            this.themes = new Map();
            this.storageKey = 'pcbcam-theme';
            this.initialized = false;

            // Registry of available themes and their paths
            this.themeRegistry = {
                'dark': 'themes/dark.json',
                'light': 'themes/light.json'
            };
        }

        async init(defaultTheme = 'dark') {
            if (this.initialized) return true;

            const savedTheme = localStorage.getItem(this.storageKey);

            // If the user wants the default theme, do nothing because theme.css should be synced to dark.json
            if (!savedTheme || savedTheme === defaultTheme) {
                this.currentTheme = defaultTheme;
                // Ensure the attribute matches for icon logic (sun/moon)
                document.documentElement.setAttribute('data-theme', defaultTheme);
                this.initialized = true;
                return true;
            }

            // User wants a different theme (e.g., light). Load and apply it.
            try {
                await this.applyTheme(savedTheme);
                this.initialized = true;
                return true;
            } catch (error) {
                console.error('Theme initialization failed, falling back to default CSS:', error);
                return false;
            }
        }

        async applyTheme(themeId) {
            // Check if already loaded in memory
            if (!this.themes.has(themeId)) {

                // If not, check if it can be found
                if (this.themeRegistry[themeId]) {
                    // Lazy load it now
                    await this.loadTheme(themeId, this.themeRegistry[themeId]);
                } else {
                    console.warn(`Theme ${themeId} not found`);
                    return false;
                }
            }

            const theme = this.themes.get(themeId);

            // DOM Updates
            document.documentElement.setAttribute('data-theme', themeId);
            this.applyColorVariables(theme.colors); // Overwrites the static CSS vars

            // Persist
            localStorage.setItem(this.storageKey, themeId);
            this.currentTheme = themeId;

            window.dispatchEvent(new CustomEvent('themechange', {
                detail: { themeId, theme }
            }));

            return true;
        }

        async loadTheme(id, url) {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const themeData = await response.json();
            this.themes.set(id, themeData);
            return themeData;
        }

        applyColorVariables(colors) {
            const root = document.documentElement;
            const set = (k, v) => root.style.setProperty(k, v);

            const flatten = (prefix, obj) => {
                Object.entries(obj).forEach(([key, value]) => {
                    const kebabKey = key.replace(/[A-Z]/g, m => "-" + m.toLowerCase());
                    const newPrefix = prefix ? `${prefix}-${kebabKey}` : kebabKey;

                    if (typeof value === 'object' && value !== null) {
                        flatten(newPrefix, value);
                    } else {
                        set(`--${newPrefix}`, value);
                    }
                });
            };

            if (colors.background) flatten('color-bg', colors.background);
            if (colors.text) flatten('color-text', colors.text);
            if (colors.border) flatten('color-border', colors.border);
            if (colors.accent) flatten('color-accent', colors.accent);
            if (colors.semantic) flatten('color', colors.semantic);
            if (colors.operations) flatten('color-operation', colors.operations);
            if (colors.canvas) flatten('color-canvas', colors.canvas);
            if (colors.debug) flatten('color-debug', colors.debug);
            if (colors.geometry) flatten('color-geometry', colors.geometry);
            if (colors.primitives) flatten('color-primitive', colors.primitives);
            if (colors.bw) flatten('color-bw', colors.bw);
            if (colors.pipelines) flatten('color-pipeline', colors.pipelines);
            if (colors.interaction) flatten('color-interaction', colors.interaction);
        }

        async toggleTheme() {
            const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
            await this.applyTheme(newTheme);
            return newTheme;
        }

        getCurrentTheme() { return this.currentTheme; }
        isLoaded() { return this.initialized; }
    }

    window.ThemeLoader = new ThemeLoader();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.ThemeLoader.init());
    } else {
        window.ThemeLoader.init();
    }
})();