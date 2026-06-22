/*!
 * @file        .github/scripts/build.js
 * @description Production build script - CSS inlining, JSON embedding, JS bundling
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 *
 * SPDX-FileCopyrightText: 2025-2026 Eltryus - Ricardo Marques
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    // Define your app entry points here
    apps: [
        {
            name: 'EasyTrace5000',
            html: 'easytrace5000/index.html',
            jsBundle: 'easytrace5000/easytrace5000.js'
        },
        {
            name: 'EasyShape5000',
            html: 'easyshape5000/index.html',
            jsBundle: 'easyshape5000/easyshape5000.js'
        }
    ],

    // Documentation pages to process (CSS inlining only)
    docPages: [
        'index.html',
        'easytrace5000/doc/index.html',
        'easytrace5000/doc/cnc.html', 
        'easytrace5000/doc/laser.html',
        'easytrace5000/doc/accessibility.html'
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
        'other',
        // Analytic offsetting files
        'geometry-offsetter-analytic.js',
        'geometry-utils-math.js',
        'unit-converter.js'
    ],

    // Files to explicitly protect from deletion (used by unbundled docs, etc)
    preserveFiles: [
        'themes/theme-loader.js'
    ],

    // Embedded assets
    embedLanguage: 'language/en.json',
    embedTools: 'tools.json',

    // Profiles to inject directly into the JS controllers
    embedProfiles: [
        { path: 'ui/profile-trace.json', target: 'easytrace5000/cam-easytrace5000.js', varName: 'EMBEDDED_PROFILE_TRACE' },
        { path: 'ui/profile-shape.json', target: 'easyshape5000/cam-easyshape5000.js', varName: 'EMBEDDED_PROFILE_SHAPE' }
    ]
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

function buildHeader(title, subtitle, format = 'js') {
    const YEARS  = '2025-2026';
    const HOLDER = 'Eltryus - Ricardo Marques';
    const REPO   = 'https://github.com/RicardoJCMarques/EasyTrace5000';

    const heading = subtitle ? `${title} — ${subtitle}` : title;
    const timestamp = new Date().toISOString();

    if (format === 'html') {
        return `<!--!
  ${heading}
  Copyright (C) ${YEARS} ${HOLDER}
  SPDX-License-Identifier: AGPL-3.0-or-later
  Source: ${REPO}
  Built: ${timestamp}
-->`;
    }

    return `/*!
 * ${heading}
 * Copyright (C) ${YEARS} ${HOLDER}
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Source: ${REPO}
 * Built: ${timestamp}
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
        this.processedFiles = new Set();
    }

    run() {
        log(`Source: ${this.srcDir}`);
        log(`Output: ${this.distDir}`);

        this.cleanDist();
        this.copySource();

        // Embed assets
        this.embedLanguageJSON();
        this.embedToolsJSON();
        this.embedAppProfiles();
        this.embedIconSprite();

        // Process apps and docs
        this.processApps();
        this.processDocPages();

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
        const embedCode = `\n    // BUILD: Embedded English strings\n    const EMBEDDED_STRINGS = ${langJSON};\n`;
        manager = manager.replace(/\(function\(\)\s*\{\s*'use strict';/, `(function() {\n    'use strict';${embedCode}`);
        // Modify constructor to pre-populate strings
        manager = manager.replace(/this\.strings\s*=\s*\{\};/, `this.strings = EMBEDDED_STRINGS;`);

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
        const embedCode = `\n    // BUILD: Embedded default tools\n    const EMBEDDED_TOOLS = ${toolsJSON};\n`;
        library = library.replace(/\(function\(\)\s*\{\s*'use strict';/, `(function() {\n    'use strict';${embedCode}`);

        // Modify init() to prefer embedded tools
        const oldInit = /async init\(\) \{[\s\S]*?try \{[\s\S]*?const loaded = await this\.loadFromFile\('[^']*tools\.json'\);/;
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

    embedAppProfiles() {
        log('Embedding app profiles into controllers...');
        for (const profile of CONFIG.embedProfiles) {
            const profilePath = path.join(this.distDir, profile.path);
            const targetPath = path.join(this.distDir, profile.target);

            if (!fs.existsSync(profilePath) || !fs.existsSync(targetPath)) {
                log(`  Warning: Profile or target not found for ${profile.varName}, skipping`);
                continue;
            }

            const profileData = JSON.parse(readFile(profilePath));
            const profileJSON = JSON.stringify(profileData);
            let targetContent = readFile(targetPath);

            const embedCode = `\n    // BUILD: Embedded App Profile\n    window.${profile.varName} = ${profileJSON};\n`;

            targetContent = targetContent.replace(
                /\(function\(\)\s*\{\s*'use strict';/,
                `(function() {\n    'use strict';${embedCode}`
            );

            writeFile(targetPath, targetContent);
            deleteFile(profilePath); // Clean it up from the dist folder
            log(`  Embedded and removed ${profile.path}`);
        }
    }

    extractDependencies(htmlContent, htmlFilePath) {
        const css = [];
        const js = [];
        const htmlDir = path.dirname(htmlFilePath);

        // Map out every <!-- ... --> span so tags inside comments can be ignored
        const commentRanges = [];
        const commentRegex = /<!--[\s\S]*?-->/g;
        let c;
        while ((c = commentRegex.exec(htmlContent)) !== null) {
            commentRanges.push([c.index, c.index + c[0].length]);
        }
        const isCommented = (idx) => commentRanges.some(([s, e]) => idx >= s && idx < e);

        const cssRegex = /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
        let match;
        while ((match = cssRegex.exec(htmlContent)) !== null) {
            if (isCommented(match.index)) continue;
            css.push({ tag: match[0], relPath: match[1], absPath: path.resolve(htmlDir, match[1]) });
        }

        const jsRegex = /<script[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi;
        while ((match = jsRegex.exec(htmlContent)) !== null) {
            if (isCommented(match.index)) continue;
            js.push({ tag: match[0], relPath: match[1], absPath: path.resolve(htmlDir, match[1]) });
        }

        return { css, js };
    }

    embedIconSprite() {
        log('Embedding icon sprite into HTML files...');

        const iconsDir = path.join(this.srcDir, 'images', 'icons');
        if (!fs.existsSync(iconsDir)) {
            log('  Warning: images/icons/ not found, skipping');
            return;
        }

        const symbols = [];
        const iconFiles = fs.readdirSync(iconsDir)
            .filter(f => f.startsWith('icon-') && f.endsWith('.svg'))
            .sort();

        for (const file of iconFiles) {
            const content = readFile(path.join(iconsDir, file));
            const id = file.replace('.svg', '');

            const vbMatch = content.match(/viewBox=["']([^"']+)["']/);
            const viewBox = vbMatch ? vbMatch[1] : '0 0 24 24';

            const svgTagMatch = content.match(/<svg([^>]*)>/i);
            let gAttrs = '';
            const allowedAttrs = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'];

            if (svgTagMatch) {
                allowedAttrs.forEach(attr => {
                    const attrMatch = svgTagMatch[1].match(new RegExp(`${attr}=["']([^"']+)["']`, 'i'));
                    if (attrMatch) gAttrs += ` ${attr}="${attrMatch[1]}"`;
                });
            }

            if (!gAttrs.includes('fill=')) gAttrs += ' fill="none"';
            if (!gAttrs.includes('stroke=')) gAttrs += ' stroke="currentColor"';
            if (!gAttrs.includes('stroke-width=')) gAttrs += ' stroke-width="2"';
            if (!gAttrs.includes('stroke-linecap=')) gAttrs += ' stroke-linecap="round"';
            if (!gAttrs.includes('stroke-linejoin=')) gAttrs += ' stroke-linejoin="round"';

            const innerMatch = content.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
            if (!innerMatch) continue;

            const inner = innerMatch[1].trim();
            symbols.push(`  <symbol id="${id}" viewBox="${viewBox}">\n    <g${gAttrs}>\n      ${inner}\n    </g>\n  </symbol>`);
        }

        if (symbols.length === 0) {
            log('  Warning: No icon SVGs found');
            return;
        }

        const spriteBlock = `<svg id="cam-icon-sprite" aria-hidden="true" style="position: absolute; width: 0; height: 0; visibility: hidden;">\n${symbols.join('\n')}\n</svg>`;

        // Inject into each app HTML
        for (const app of CONFIG.apps) {
            const htmlPath = path.join(this.distDir, app.html);
            if (!fs.existsSync(htmlPath)) continue;

            let html = readFile(htmlPath);

            // Inject sprite directly after <body> tag
            html = html.replace(/<body>/, `<body>\n${spriteBlock}`);

            writeFile(htmlPath, html);
        }

        // Also inject into doc pages if they use icons
        for (const page of CONFIG.docPages) {
            const pagePath = path.join(this.distDir, page);
            if (!fs.existsSync(pagePath)) continue;
            let html = readFile(pagePath);
            if (html.includes('cam-icon')) {
                html = html.replace(/<body>/, `<body>\n${spriteBlock}`);
                writeFile(pagePath, html);
            }
        }

        log(`  Embedded ${symbols.length} icons as inline sprite`);
    }

    processApps() {
        log('Processing application entry points...');
        for (const app of CONFIG.apps) {
            const htmlPath = path.join(this.distDir, app.html);
            if (!fs.existsSync(htmlPath)) {
                log(`  Warning: Entry point ${app.html} not found, skipping.`);
                continue;
            }

            let htmlContent = readFile(htmlPath).replace(/\0/g, '');

            // Strip the main header
            htmlContent = htmlContent.replace(/\s*<!--![\s\S]*?-->/g, '');

            // Strip <!-- AppName ... --> blocks (GPL prose)
            htmlContent = htmlContent.replace(/\s*<!--\s*Easy(?:Trace|Shape)5000[\s\S]*?-->/g, '');

            // Inject the new compact deployment header
            const htmlHeader = buildHeader(app.name, 'Main Workspace', 'html');
            if (htmlContent.match(/<!DOCTYPE[^>]*>/i)) {
                htmlContent = htmlContent.replace(/(<!DOCTYPE[^>]*>)/i, `$1\n${htmlHeader}\n`);
            } else {
                htmlContent = htmlHeader + '\n' + htmlContent; // Fallback
            }

            const deps = this.extractDependencies(htmlContent, htmlPath);

            let cssContents = buildHeader(app.name, 'Bundled Styles', 'css');
            for (const item of deps.css) {
                if (fs.existsSync(item.absPath)) {
                    cssContents += `/* ${item.relPath} */\n${stripComments(readFile(item.absPath), 'css')}\n\n`;
                    this.processedFiles.add(item.absPath);
                    htmlContent = htmlContent.split(item.tag).join('');
                }
            }
            this.stats.css += cssContents.length;
            const styleTag = `\n    <style>\n${cssContents}    </style>\n`;
            htmlContent = htmlContent.replace('</head>', styleTag + '</head>');

            // REVIEW - Not very important but while this logic removes the comments, it doesn't remove the "new lines" where comments existed. (Everything is still handled by the deployment minifier)
            let jsContents = buildHeader(app.name, 'Bundled Logic', 'js');
            for (const item of deps.js) {
                if (fs.existsSync(item.absPath)) {
                    let content = stripComments(readFile(item.absPath), 'js');
                    if (item.relPath.includes('clipper2z')) {
                        content = content.replace(/["'](\.?\/)?(geometry\/)?clipper2z\.wasm["']/g, '"../geometry/clipper2z.wasm"');
                    }
                    jsContents += `\n// --- ${item.relPath} ---\n${content}\n`;
                    this.processedFiles.add(item.absPath);
                    htmlContent = htmlContent.split(item.tag).join('');
                }
            }
            this.stats.js += jsContents.length;

            const bundleAbsPath = path.join(this.distDir, app.jsBundle);
            writeFile(bundleAbsPath, jsContents);

            let bundleRelPath = path.relative(path.dirname(htmlPath), bundleAbsPath).replace(/\\/g, '/');
            if (!bundleRelPath.startsWith('.')) bundleRelPath = './' + bundleRelPath;

            const bundleTag = `    \n    <script defer src="${bundleRelPath}"></script>\n`;
            htmlContent = htmlContent.replace('</body>', `${bundleTag}</body>`);
            htmlContent = htmlContent.replace(/^\s*[\r\n]/gm, '');

            this.stats.html += htmlContent.length;
            writeFile(htmlPath, htmlContent);
            log(`  Processed ${app.html} -> generated ${app.jsBundle}`);
        }
    }

    processDocPages() {
        log('Processing documentation pages...');
        for (const page of CONFIG.docPages) {
            const pagePath = path.join(this.distDir, page);
            if (!fs.existsSync(pagePath)) continue;

            let htmlContent = readFile(pagePath).replace(/\0/g, ''); 

            // Strip the original headers
            htmlContent = htmlContent.replace(/[\r\n]*/, '');
            htmlContent = htmlContent.replace(/[\r\n]*/i, '');

            // Inject the new compact deployment header
            const htmlHeader = buildHeader('Documentation', 'Manual', 'html');
            if (htmlContent.match(/<!DOCTYPE[^>]*>/i)) {
                htmlContent = htmlContent.replace(/(<!DOCTYPE[^>]*>)/i, `$1\n${htmlHeader}\n`);
            } else {
                htmlContent = htmlHeader + '\n' + htmlContent;
            }

            const deps = this.extractDependencies(htmlContent, pagePath);

            let cssContents = buildHeader('Documentation', 'Bundled Styles', 'css');
            for (const item of deps.css) {
                if (fs.existsSync(item.absPath)) {
                    cssContents += `/* ${item.relPath} */\n${stripComments(readFile(item.absPath), 'css')}\n\n`;
                    htmlContent = htmlContent.split(item.tag).join('');
                }
            }

            if (deps.css.length > 0) {
                const styleTag = `\n    \n    <style>\n${cssContents}    </style>\n`;
                htmlContent = htmlContent.replace('</head>', styleTag + '</head>');
                htmlContent = htmlContent.replace(/^\s*[\r\n]/gm, '');
                writeFile(pagePath, htmlContent);
                log(`  Inlined CSS for ${page}`);
            }
        }
    }

    cleanup() {
        log('Cleaning up bundled files and empty directories...');

        // CSS was inlined into all pages, safe to remove
        for (const filePath of this.processedFiles) {
            if (CONFIG.preserveFiles.some(p => filePath.endsWith(path.normalize(p)))) {
                log(`  Preserving ${path.basename(filePath)}`);
                continue;
            }
            deleteFile(filePath);
        }

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
        if (fs.existsSync(langDir) && fs.readdirSync(langDir).length === 0) deleteDir(langDir);
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
        if (args[i] === '--src' && args[i + 1]) srcDir = args[++i];
        else if (args[i] === '--dist' && args[i + 1]) distDir = args[++i];
        else if (args[i] === '--help' || args[i] === '-h') {
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