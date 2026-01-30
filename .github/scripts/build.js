/*!
 * @file        .github/scripts/build.js
 * @description Production build script - CSS inlining, JSON embedding, JS bundling
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

const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    // CSS files to inline (order matters for cascade)
    cssFiles: [
        'css/base.css',
        'css/components.css',
        'css/modals.css',
        'css/layout.css',
        'css/canvas.css',
        'css/theme.css'
    ],

    // JavaScript files in load order (from index.html)
    jsFiles: [
        'themes/theme-loader.js',
        'config.js',
        'language/language-manager.js',
        'geometry/clipper2z.js',
        'geometry/geometry-processor.js',
        'geometry/geometry-curve-registry.js',
        'geometry/geometry-arc-reconstructor.js',
        'geometry/geometry-clipper-wrapper.js',
        'geometry/geometry-utils.js',
        'geometry/geometry-offsetter.js',
        'parsers/primitives.js',
        'parsers/parser-core.js',
        'parsers/parser-gerber.js',
        'parsers/parser-excellon.js',
        'parsers/parser-svg.js',
        'parsers/parser-plotter.js',
        'renderer/renderer-core.js',
        'renderer/renderer-primitives.js',
        'renderer/renderer-overlay.js',
        'renderer/renderer-interaction.js',
        'renderer/renderer-layer.js',
        'ui/ui-tooltip.js',
        'ui/tool-library.js',
        'ui/ui-parameter-manager.js',
        'ui/ui-nav-tree-panel.js',
        'ui/ui-operation-panel.js',
        'ui/ui-status-manager.js',
        'ui/ui-controls.js',
        'ui/ui-modal-manager.js',
        'toolpath/toolpath-primitives.js',
        'toolpath/toolpath-optimizer.js',
        'toolpath/toolpath-machine-processor.js',
        'toolpath/toolpath-tab-planner.js',
        'toolpath/toolpath-geometry-translator.js',
        'gcode/processors/base-processor.js',
        'gcode/processors/grbl-processor.js',
        'gcode/processors/grblHAL-processor.js',
        'gcode/processors/roland-processor.js',
        'gcode/processors/marlin-processor.js',
        'gcode/processors/mach3-processor.js',
        'gcode/processors/linuxcnc-processor.js',
        'gcode/gcode-generator.js',
        'utils/coordinate-system.js',
        'utils/unit-converter.js',
        'utils/svg-exporter.js',
        'cam-core.js',
        'cam-ui.js',
        'cam-controller.js'
    ],

    // Documentation pages to process (CSS inlining only)
    docPages: [
        'doc/index.html',
        'doc/cnc.html', 
        'doc/laser.html',
        'doc/accessibility.html'
    ],

    // CSS files for documentation pages
    docCssFiles: [
        'css/base.css',
        'css/components.css',
        'css/theme.css',
        'css/doc.css'
    ],

    // Files/folders to exclude from dist
    excludePatterns: [
        '.git',
        '.github',
        '.gitignore',
        'NOTICE',
        'node_modules',
        'dist',
        'scripts',
        '*.md',
        'CITATION.cff',
        '.DS_Store',
        'docs',
        'extras',
        'fiveserver.config.js',
        'licensepasta.txt',
        'other'
    ],

    // Embedded assets
    embedLanguage: 'language/en.json',
    embedTools: 'tools.json',

    // Output bundle name
    bundleName: 'app.bundle.js'
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function stripComments(content, fileType) {
    // Remove block comments (/* ... */) - works for both JS and CSS
    content = content.replace(/\/\*[\s\S]*?\*\//g, '');

    // Remove single-line comments (// ...) - JS only
    if (fileType === 'js') {
        content = content.replace(/^\s*\/\/.*$/gm, '');
    }

    // Remove excessive blank lines (more than 2 consecutive)
    content = content.replace(/\n{3,}/g, '\n\n');

    return content.trim();
}

function log(msg) {
    console.log(`[build] ${msg}`);
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function copyRecursive(src, dest, excludes = []) {
    if (!fs.existsSync(src)) return;

    const basename = path.basename(src);

    // Check exclusions before stat
    for (const pattern of excludes) {
        if (pattern.startsWith('*')) {
            if (basename.endsWith(pattern.slice(1))) return;
        } else if (basename === pattern) {
            return;
        }
    }

    const stat = fs.statSync(src);

    if (stat.isDirectory()) {
        ensureDir(dest);
        for (const child of fs.readdirSync(src)) {
            copyRecursive(path.join(src, child), path.join(dest, child), excludes);
        }
    } else {
        fs.copyFileSync(src, dest);
    }
}

function readFile(filepath) {
    return fs.existsSync(filepath) ? fs.readFileSync(filepath, 'utf8') : '';
}

function writeFile(filepath, content) {
    ensureDir(path.dirname(filepath));
    fs.writeFileSync(filepath, content);
}

function deleteFile(filepath) {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
}

function deleteDir(dirpath) {
    if (fs.existsSync(dirpath)) {
        fs.rmSync(dirpath, { recursive: true, force: true });
    }
}

function buildCssHeader(title) {
    return `/*!
 * ${title}
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @license     AGPL-3.0-or-later
 * Built: ${new Date().toISOString()}
 */\n\n`;
}

// ============================================================================
// BUILD STEPS
// ============================================================================

class Builder {
    constructor(srcDir, distDir) {
        this.srcDir = path.resolve(srcDir);
        this.distDir = path.resolve(distDir);
        this.stats = { css: 0, js: 0, html: 0 };
    }

    run() {
        log(`Source: ${this.srcDir}`);
        log(`Output: ${this.distDir}`);

        this.cleanDist();
        this.copySource();
        this.embedLanguageJSON();
        this.embedToolsJSON();
        this.inlineDocCSS();
        this.inlineCSS();
        this.bundleJS();
        this.updateHTML();
        this.cleanup();
        this.printStats();
    }

    cleanDist() {
        log('Cleaning dist folder...');
        deleteDir(this.distDir);
        ensureDir(this.distDir);
    }

    copySource() {
        log('Copying source files...');
        copyRecursive(this.srcDir, this.distDir, CONFIG.excludePatterns);
    }

    embedLanguageJSON() {
        log('Embedding language strings into language-manager.js...');

        const langPath = path.join(this.distDir, CONFIG.embedLanguage);
        const managerPath = path.join(this.distDir, 'language/language-manager.js');

        if (!fs.existsSync(langPath) || !fs.existsSync(managerPath)) {
            log('  Warning: Language files not found, skipping');
            return;
        }

        const langData = JSON.parse(readFile(langPath));
        const langJSON = JSON.stringify(langData.strings || {});
        let manager = readFile(managerPath);

        // Insert embedded strings after 'use strict'
        const embedCode = `\n    // BUILD: Embedded English strings (eliminates blocking fetch)\n    const EMBEDDED_STRINGS = ${langJSON};\n`;
        manager = manager.replace(
            /\(function\(\)\s*\{\s*'use strict';/,
            `(function() {\n    'use strict';${embedCode}`
        );

        // Modify constructor to pre-populate strings
        manager = manager.replace(
            /this\.strings\s*=\s*\{\};/,
            `this.strings = EMBEDDED_STRINGS;`
        );

        // Modify load() to skip fetch for English
        const oldLoad = /async load\(lang\s*=\s*'en'\)\s*\{[\s\S]*?try\s*\{[\s\S]*?const response = await fetch/;
        const newLoad = `async load(lang = 'en') {
            // Fast path: English is embedded
            if (lang === 'en') {
                this.isLoaded = true;
                console.log('[Lang] Using embedded English strings.');
                return;
            }

            // Slow path: fetch other languages
            try {
                const response = await fetch`;

        manager = manager.replace(oldLoad, newLoad);

        writeFile(managerPath, manager);
        deleteFile(langPath);
        log('  Embedded and removed en.json');
    }

    embedToolsJSON() {
        log('Embedding tools.json into tool-library.js...');

        const toolsPath = path.join(this.distDir, CONFIG.embedTools);
        const libraryPath = path.join(this.distDir, 'ui/tool-library.js');

        if (!fs.existsSync(toolsPath) || !fs.existsSync(libraryPath)) {
            log('  Warning: Tools file or library not found, skipping');
            return;
        }

        const toolsData = JSON.parse(readFile(toolsPath));
        const toolsJSON = JSON.stringify(toolsData);
        let library = readFile(libraryPath);

        // Insert embedded constant
        const embedCode = `\n    // BUILD: Embedded default tools (eliminates blocking fetch)\n    const EMBEDDED_TOOLS = ${toolsJSON};\n`;

        library = library.replace(
            /\(function\(\)\s*\{\s*'use strict';/,
            `(function() {\n    'use strict';${embedCode}`
        );

        // Modify init() to prefer embedded tools
        const oldInit = /async init\(\) \{[\s\S]*?try \{[\s\S]*?\/\/ Load from external file \(single source of truth\)[\s\S]*?const loaded = await this\.loadFromFile\('tools\.json'\);/;

        const newInit = `async init() {
            if (this.isLoaded) return true;

            try {
                // BUILD: Load embedded tools
                if (typeof EMBEDDED_TOOLS !== 'undefined') {
                    this.importTools(EMBEDDED_TOOLS);
                    this.isLoaded = true;
                    this.debug('Loaded ' + this.tools.length + ' embedded tools');
                    return true;
                }

                // Fallback (dev mode behavior)
                const loaded = await this.loadFromFile('tools.json');`;

        library = library.replace(oldInit, newInit);

        writeFile(libraryPath, library);
        deleteFile(toolsPath);
        log('  Embedded and removed tools.json');
    }

    inlineCSS() {
        log('Inlining CSS into HTML...');

        const cssContents = buildCssHeader('EasyTrace5000 - Bundled Styles') + CONFIG.cssFiles
            .map(file => {
                const filepath = path.join(this.distDir, file);
                if (!fs.existsSync(filepath)) {
                    log(`  Warning: ${file} not found`);
                    return '';
                }
                const content = stripComments(readFile(filepath), 'css');
                this.stats.css += content.length;
                return `/* ${file} */\n${content}`;
            })
            .filter(Boolean)
            .join('\n\n');

        const htmlPath = path.join(this.distDir, 'index.html');
        let html = readFile(htmlPath);

        // Remove CSS link tags
        html = html.replace(/<link rel="stylesheet" href="css\/[^"]+\.css">\s*/g, '');

        // Remove CSS architecture comment
        html = html.replace(/\s*<!-- Modular CSS Architecture -->\s*/g, '\n    ');

        // Insert inline style before </head>
        const styleTag = `\n    <!-- BUILD: Inlined CSS -->\n    <style>\n${cssContents}\n    </style>\n`;
        html = html.replace('</head>', styleTag + '</head>');

        writeFile(htmlPath, html);

        // Delete CSS folder
        deleteDir(path.join(this.distDir, 'css'));
        log(`  Inlined ${(this.stats.css / 1024).toFixed(1)}KB CSS`);
    }

    inlineDocCSS() {
        log('Inlining CSS into documentation pages...');

        const cssContents = buildCssHeader('EasyTrace5000 Documentation - Bundled Styles') + CONFIG.docCssFiles
            .map(file => {
                const filepath = path.join(this.distDir, file);
                if (!fs.existsSync(filepath)) {
                    log(`  Warning: ${file} not found`);
                    return '';
                }
                return `/* ${file} */\n${stripComments(readFile(filepath), 'css')}`;
            })
            .filter(Boolean)
            .join('\n\n');

        // Process each documentation page
        for (const page of CONFIG.docPages) {
            const pagePath = path.join(this.distDir, page);
            if (!fs.existsSync(pagePath)) {
                log(`  Warning: ${page} not found, skipping`);
                continue;
            }

            let html = readFile(pagePath);

            // Remove CSS link tags
            html = html.replace(/<link rel="stylesheet" href="(\.\.\/)?css\/[^"]+\.css">\s*/g, '');

            // Insert inline style before </head>
            const styleTag = `\n    <!-- BUILD: Inlined CSS -->\n    <style>\n${cssContents}\n    </style>\n`;
            html = html.replace('</head>', styleTag + '</head>');

            writeFile(pagePath, html);
            log(`  Processed ${page}`);
        }
    }

    bundleJS() {
        log('Bundling JavaScript...');

        const header = `/*!
 * EasyTrace5000 - Bundled Application Logic
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 * Built: ${new Date().toISOString()}
 * --- Embedded Libraries ---
 * Clipper2 WASM: Copyright (c) 2010-2024 Angus Johnson + ErikSom (Boost License 1.0)
 * See /geometry/LICENSE for details.
 */
`;

        const jsContents = CONFIG.jsFiles
            .map(file => {
                const filepath = path.join(this.distDir, file);
                if (!fs.existsSync(filepath)) {
                    log(`  Warning: ${file} not found`);
                    return '';
                }
                let content = stripComments(readFile(filepath), 'js');

                // Fix WASM path in clipper2z.js (factory always has wrong relative path)
                if (file.includes('clipper2z')) {
                    content = content.replace(
                        /["'](\.?\/)?(geometry\/)?clipper2z\.wasm["']/g,
                        '"geometry/clipper2z.wasm"'
                    );
                }

                this.stats.js += content.length;
                return `\n// --- ${file} ---\n${content}`;
            })
            .filter(Boolean)
            .join('\n');

        const bundle = header + jsContents;
        const bundlePath = path.join(this.distDir, CONFIG.bundleName);
        writeFile(bundlePath, bundle);

        // Files to preserve (used by doc pages separately)
        const preserveFiles = ['themes/theme-loader.js'];

        // Delete individual JS files and track directories
        const jsDirs = new Set();
        CONFIG.jsFiles.forEach(file => {
            // Skip files that should be preserved
            if (preserveFiles.includes(file)) {
                log(`  Preserving ${file} for doc pages`);
                return;
            }

            const filepath = path.join(this.distDir, file);
            deleteFile(filepath);
            const dir = path.dirname(file);
            if (dir !== '.') jsDirs.add(dir);
        });

        // Delete empty JS directories (non-empty ones like geometry/ are preserved)
        jsDirs.forEach(dir => {
            const dirPath = path.join(this.distDir, dir);
            if (fs.existsSync(dirPath)) {
                const remaining = fs.readdirSync(dirPath);
                if (remaining.length === 0) {
                    deleteDir(dirPath);
                } else {
                    log(`  Keeping ${dir}/ (contains: ${remaining.join(', ')})`);
                }
            }
        });

        log(`  Bundled ${(this.stats.js / 1024).toFixed(1)}KB JS into ${CONFIG.bundleName}`);
    }

    updateHTML() {
        log('Updating HTML script references...');

        const htmlPath = path.join(this.distDir, 'index.html');
        let html = readFile(htmlPath);

        // Remove all deferred script tags (the individual JS files, including theme-loader)
        html = html.replace(/<script defer src="[^"]+\.js"><\/script>\s*/g, '');

        // Remove the "Application Scripts" comment
        html = html.replace(/\s*<!-- Application Scripts[^>]*-->\s*/g, '\n');

        // Remove any standalone theme loader comment if present
        html = html.replace(/\s*<!-- Theme Loader[^>]*-->\s*/g, '\n');

        // Insert bundle before the inline initialization script
        const bundleTag = `    <!-- BUILD: Bundled application js logic -->\n    <script defer src="${CONFIG.bundleName}"></script>\n\n    `;

        // Insert before the inline init script
        html = html.replace(
            /(<script>\s*document\.addEventListener\('DOMContentLoaded')/,
            `${bundleTag}$1`
        );

        // Update loading progress UI
        html = html.replace(
            /<div id="loading-progress"[^>]*>[^<]*<\/div>/,
            '<div id="loading-progress" class="loading-progress" role="progressbar" aria-label="Application loading">Loading...</div>'
        );

        this.stats.html = html.length;
        writeFile(htmlPath, html);
        log('  Replaced defer scripts with ' + CONFIG.bundleName);
    }

    cleanup() {
        log('Cleaning up empty directories...');

        // Clean any remaining empty directories
        const cleanEmptyDirs = (dir) => {
            if (!fs.existsSync(dir)) return;
            for (const item of fs.readdirSync(dir)) {
                const itemPath = path.join(dir, item);
                if (fs.statSync(itemPath).isDirectory()) {
                    cleanEmptyDirs(itemPath);
                    if (fs.readdirSync(itemPath).length === 0) {
                        fs.rmdirSync(itemPath);
                    }
                }
            }
        };

        cleanEmptyDirs(this.distDir);

        // Remove language folder if empty (en.json was deleted)
        const langDir = path.join(this.distDir, 'language');
        if (fs.existsSync(langDir) && fs.readdirSync(langDir).length === 0) {
            deleteDir(langDir);
        }
    }

    printStats() {
        log('');
        log('Build complete!');
        log(`  CSS inlined: ${(this.stats.css / 1024).toFixed(1)}KB`);
        log(`  JS bundled:  ${(this.stats.js / 1024).toFixed(1)}KB`);
        log(`  HTML size:   ${(this.stats.html / 1024).toFixed(1)}KB`);
    }
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

function main() {
    const args = process.argv.slice(2);

    // Parse arguments
    let srcDir = '.';
    let distDir = './dist';

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--src' && args[i + 1]) {
            srcDir = args[++i];
        } else if (args[i] === '--dist' && args[i + 1]) {
            distDir = args[++i];
        } else if (args[i] === '--help' || args[i] === '-h') {
            console.log(`
EasyTrace5000 Build Script

Usage: node build.js [options]

Options:
  --src <dir>    Source directory (default: current directory)
  --dist <dir>   Output directory (default: ./dist)
  --help, -h     Show this help

Examples:
  node build.js                      # Build from . to ./dist
  node build.js --dist ./build       # Build from . to ./build
  node build.js --src ../src --dist ./dist
`);
            process.exit(0);
        }
    }

    // Validate source exists
    if (!fs.existsSync(srcDir)) {
        console.error(`Error: Source directory '${srcDir}' does not exist`);
        process.exit(1);
    }

    // Run build
    const builder = new Builder(srcDir, distDir);
    builder.run();
}

main();