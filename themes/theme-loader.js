/*!
 * @file        theme-loader.js
 * @description Theme loading and switching utility
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 *
 * SPDX-FileCopyrightText: 2025-2026 Eltryus - Ricardo Marques
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

(function() {
    'use strict';

    class ThemeLoader {
        constructor() {
            this.currentTheme = 'dark'; // Matches CSS default
            this.themes = new Map();
            // Safely fallback if CAMConfig isn't loaded (e.g., on the root index or docs)
            this.storageKey = window.CAMConfig?.constants?.storageKeys?.theme || 'cam-theme';
            this.initialized = false;

            // Registry of available themes and their paths
            this.themeRegistry = {
                'dark': '/themes/dark.json',
                'light': '/themes/light.json'
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

            document.querySelector('meta[name="theme-color"]').setAttribute(
                'content', 
                themeId === 'dark' ? '#1a1a1a' : '#f8f9fa'
            );

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