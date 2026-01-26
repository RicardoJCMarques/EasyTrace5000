/*!
 * @file        language/language-manager.js
 * @description Language & translation manager
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

    class LanguageManager {
        constructor() {
            this.strings = {};
            this.isLoaded = false;
        }

        /**
         * Loads the language file from the server.
         * @param {string} [lang='en'] - The language to load (future use).
         */
        async load(lang = 'en') {
            try {
                const response = await fetch(`language/${lang}.json`);
                if (!response.ok) {
                    throw new Error(`Failed to load language/${lang}.json: ${response.statusText}`);
                }
                const data = await response.json();
                this.strings = data.strings || {}; // Store just the "strings" object
                this.isLoaded = true;
                console.log(`[Lang] Language pack 'en' loaded.`);
            } catch (err) {
                console.error('[Lang] Failed to load language file:', err);
                this.strings = {}; // Fallback to empty
                this.isLoaded = false;
            }
        }

        /**
         * Gets a string by its key.
         * @param {string} key - The key, e.g., "toolbar.addFiles" or "tooltips.toolDiameter"
         * @param {string} [defaultValue=''] - A fallback value if the key isn't found.
         * @returns {string}
         */
        get(key, defaultValue = '') {
            if (!this.isLoaded) {
                console.warn(`[Lang] Tried to get key "${key}" before strings were loaded.`);
            }

            // This reducer handily navigates nested JSON keys
            // 'tooltips.toolDiameter' -> this.strings['tooltips']['toolDiameter']
            try {
                const value = key.split('.').reduce((obj, k) => obj[k], this.strings);
                return value !== undefined ? value : defaultValue;
            } catch (e) {
                return defaultValue; // Key path was invalid
            }
        }

        /**
         * Checks if a translation key exists.
         * @param {string} key - The key to check, e.g., "tooltips.parameters.toolDiameter"
         * @returns {boolean}
         */
        has(key) {
            try {
                // This logic is similar to get(), but returns true/false
                const value = key.split('.').reduce((obj, k) => obj[k], this.strings);
                return value !== undefined;
            } catch (e) {
                return false; // Key path was invalid
            }
        }
    }

    window.LanguageManager = LanguageManager;
})();