/*!
 * @file        cam-easytrace5000.js
 * @description EasyTrace5000 application controller — UI orchestration, file handling, export
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

    const C = window.PCBCAMConfig.constants;
    const D = window.PCBCAMConfig.defaults;
    const PRECISION = C.precision.coordinate;
    const textConfig = C.ui.text;
    const debugState = D.debug;
    const timingConfig = D.ui.timing;
    const opsConfig = D.operations;

    // PCB Example definitions
    const PCB_EXAMPLES = {
        'exampleSMD1': {
            name: 'Example 1 - SMD',
            files: {
                isolation: '../examples/exampleSMD1/isolation.gbr',
                drill: '../examples/exampleSMD1/drill.drl',
                clearing: '../examples/exampleSMD1/clearing.gbr',
                cutout: '../examples/exampleSMD1/cutout.gbr',
                stencil: '../examples/exampleSMD1/stencil.gbr',
            }
        },
        'exampleThroughHole1': {
            name: 'Example 2 - Through-Hole',
            files: {
                isolation: '../examples/exampleThroughHole1/Gerber_BottomLayer.gbl',
                drill: '../examples/exampleThroughHole1/Excellon_PTH_Through.drl',
                cutout: '../examples/exampleThroughHole1/Gerber_BoardOutlineLayer.gko'
            }
        },
        'line': {
            name: 'Line Test',
            files: {
                isolation: '../examples/LineTest.svg'
            }
        },
        'calibration': {
            name: '100mm Step/mm Square',
            files: {
                cutout: '../examples/100mmSquare.svg'
            }
        }
    };

    class PCBCAMController {
        constructor() {
            this.core = null;
            this.ui = null;

            // State managers
            this.parameterManager = null;
            this.modalManager = null;

            // Application-specific pipeline components (G-code needs language manager)
            this.gcodeGenerator = null;

            // Track initialization state
            this.initState = {
                coreReady: false,
                uiReady: false,
                wasmReady: false,
                fullyReady: false,
                error: null
            };

            // Pending operations queue
            this.pendingOperations = [];

            // Upload modal file tracking
            this.uploadedFiles = {
                isolation: null,
                drill: null,
                clearing: null,
                cutout: null,
                stencil: null
            };

            // Queued files for processing
            this.queuedFiles = [];

            // Pipeline state
            this.pipelineState = {
                type: 'cnc',        // 'cnc' | 'laser' | 'hybrid'
                laser: null         // null for CNC, object for laser/hybrid
            };
        }

        /**
         * Pipeline Management
         */

        setPipeline(type, laserConfig = null) {
            this.pipelineState.type = type;
            this.pipelineState.laser = laserConfig;

            // Persist to localStorage so reload remembers pipeline choice
            try {
                localStorage.setItem('pcbcam-pipeline', JSON.stringify(this.pipelineState));
            } catch (e) { /* ignore */ }

            this.debug(`Pipeline set: ${type}`, laserConfig);
            return this.pipelineState;
        }

        /**
         * Restores pipeline state from localStorage on init.
         * Called during initialize() after core is ready.
         */
        restorePipeline() {
            try {
                const saved = localStorage.getItem('pcbcam-pipeline');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    if (parsed.type && ['cnc', 'laser', 'hybrid'].includes(parsed.type)) {
                        // Merge with defaults to handle missing fields from older versions
                        this.pipelineState = {
                            type: parsed.type,
                            laser: parsed.laser ? { ...this.pipelineState.laser, ...parsed.laser } : null
                        };
                        this.debug('Restored pipeline state:', this.pipelineState);
                    }
                }
            } catch (e) { /* ignore, use defaults */ }
        }

        /**
         * Quick check used across UI modules.
         */
        isLaserPipeline() {
            return this.pipelineState.type === 'laser' || this.pipelineState.type === 'hybrid';
        }

        /**
         * Returns true if this specific operation type should use laser SVG export in the current pipeline. Stencils are routed independently — they use the same LaserImageExporter backend but have their own UI and hardcoded settings.
         */
        isLaserExportForOperation(operationType) {
            // Stencils are NOT laser operations — they have their own export path
            if (operationType === 'stencil') return false;
            if (this.pipelineState.type === 'laser') return true;
            if (this.pipelineState.type === 'hybrid') {
                return operationType === 'isolation' || operationType === 'clearing';
            }
            return false;
        }

        /**
         * Thin pass-through for modal preview ("Calculate Toolpaths" button).
         */
        async calculateToolpaths(intent) {
            return this.core.generateCNCResults(intent, this.parameterManager);
        }

        /**
         * Thin pass-through for unified export. Pre-sorts operations by pipeline type, then delegates everything to core.
         * REVIEW - seems redundant?
         */
        async executeExports(intent) {
            const cncOperationIds = [];
            const laserOperationIds = [];
            const stencilOperationIds = [];

            for (const id of intent.operationIds) {
                const op = this.core.operations.find(o => o.id === id);
                if (!op) continue;
                if (op.type === 'stencil') {
                    stencilOperationIds.push(id);
                } else if (this.isLaserExportForOperation(op.type)) {
                    laserOperationIds.push(id);
                } else {
                    cncOperationIds.push(id);
                }
            }

            return this.core.executeExport({
                ...intent,
                cncOperationIds,
                laserOperationIds,
                stencilOperationIds
            }, this.parameterManager);
        }

        /**
         * Initialization
         */

        async initialize() {
            console.log('EasyTrace5000 Workspace initializing...');

            try {
                // Initialize core engine with skip init flag to control WASM loading
                this.core = new PCBCamCore({ skipInit: true });

                // Initialize managers before UI
                this.parameterManager = new ParameterManager(this.core);
                this.languageManager = new LanguageManager();

                // Load the language file before the UI
                await this.languageManager.load();

                // Restore pipeline state before UI init
                this.restorePipeline();

                // Application-specific: G-code generator (needs language manager)
                this.gcodeGenerator = new GCodeGenerator(D.gcode);
                this.gcodeGenerator.setCore(this.core);
                this.gcodeGenerator.setLanguageManager(this.languageManager);
                this.core.setGCodeGenerator(this.gcodeGenerator);

                // Initialize engine-owned pipeline components
                this.core.initializePipeline();

                // Expose early so UI modules can access controller during init
                window.pcbcam = this;

                // ── Register operation handlers ──
                if (typeof IsolationOperationHandler !== 'undefined') {
                    this.core.registerHandler('isolation', new IsolationOperationHandler(this.core));
                }
                if (typeof ClearingOperationHandler !== 'undefined') {
                    this.core.registerHandler('clearing', new ClearingOperationHandler(this.core));
                }
                if (typeof CutoutOperationHandler !== 'undefined') {
                    this.core.registerHandler('cutout', new CutoutOperationHandler(this.core));
                }
                if (typeof DrillOperationHandler !== 'undefined') {
                    this.core.registerHandler('drill', new DrillOperationHandler(this.core));
                }
                if (typeof StencilOperationHandler !== 'undefined') {
                    this.core.registerHandler('stencil', new StencilOperationHandler(this.core));
                }

                // Initialize UI
                this.ui = new PCBCamUI(this.core, this.languageManager);

                // Initialize UI (pass parameter manager)
                const uiReady = await this.ui.init(this.parameterManager);
                this.initState.uiReady = uiReady;

                if (!uiReady) {
                    throw new Error('UI initialization failed');
                }

                // Initialize managers that depend on UI
                this.modalManager = new ModalManager(this);

                // Pass tool library to core if using advanced UI
                if (this.ui.toolLibrary) {
                    this.core.setToolLibrary(this.ui.toolLibrary);
                }

                // Initialize WASM modules
                const wasmReady = await this.initializeWASM();
                this.initState.wasmReady = wasmReady;

                if (!wasmReady) {
                    console.warn('WASM modules failed to load - running in fallback mode');
                    this.ui?.updateStatus(textConfig.statusWarning || 'Warning: Clipper2 failed to load - fusion disabled', 'warning');
                }

                // Sync pipeline UI state
                if (this.isLaserPipeline() && this.ui?.controls) {
                    this.ui.controls.updatePipelineFieldVisibility();
                }

                // Setup global event handlers
                this.setupGlobalHandlers();

                // Setup toolbar handlers
                this.setupToolbarHandlers();

                // Attach modal manager (created after UI init)
                window.pcbcam.modalManager = this.modalManager;

                // Process any pending operations
                await this.processPendingOperations();

                // Hide loading overlay and show UI
                this.hideLoadingOverlay();

                // Handle deep-linking
                const hash = window.location.hash.substring(1);

                // Modals allowed to be deep-linked
                const deepLinkModals = ['support', 'welcome', 'quickstart'];
                const isDeepLink = deepLinkModals.includes(hash);

                if (isDeepLink) {
                    // If opening #support, always open Welcome first so it sits underneath.
                    // This ensures closing Support reveals the main menu, not an empty void.
                    if (hash === 'support') {
                        this.modalManager.showModal('welcome', { examples: PCB_EXAMPLES });
                    }

                    // Open the requested deep-link modal on top
                    this.modalManager.showModal(hash, { examples: PCB_EXAMPLES });

                    // Clean the URL
                    history.replaceState(null, null, window.location.pathname);
                }
                else {
                    // Standard Boot: always show Welcome.
                    this.modalManager.showModal('welcome', { examples: PCB_EXAMPLES });
                }

                this.initState.fullyReady = true;

                console.log('PCB CAM ready');

                // Update status
                this.ui?.updateStatus(textConfig.statusReady);

            } catch (error) {
                console.error('Initialization failed:', error);
                this.initState.error = error.message;
                this.ui?.updateStatus('Initialization failed: ' + error.message, 'error');
                this.hideLoadingOverlay();
            }
        }

        async initializeWASM() {
            try {
                if (!this.core || typeof this.core.initializeProcessors !== 'function') {
                    console.warn('Core processor initialization not available');
                    return false;
                }

                this.debug('Loading Clipper2 WASM modules...');

                const result = await this.core.initializeProcessors();

                if (result) {
                    console.log('Clipper2 WASM modules loaded successfully');
                }

                return result;

            } catch (error) {
                console.error('WASM initialization error:', error);
                return false;
            }
        }

        hideLoadingOverlay() {
            const overlay = document.getElementById('loading-overlay');
            if (overlay) {
                overlay.style.opacity = '0';
                const duration = timingConfig.modalAnimationDuration;
                setTimeout(() => {
                    overlay.style.display = 'none';

                    // This function also shows the main UI
                    const toolbar = document.getElementById('cam-toolbar');
                    const workspace = document.getElementById('cam-workspace');

                    if (toolbar) toolbar.style.display = 'flex';
                    if (workspace) workspace.style.display = 'grid';

                }, duration);
            }
        }

        /**
         * Toolbar Handlers
         */

        setupToolbarHandlers() {
            // Quick Actions dropdown
            const quickActionsBtn = document.getElementById('quick-actions-btn');
            const quickActionsMenu = document.getElementById('quick-actions-menu');

            if (quickActionsBtn && quickActionsMenu) {
                // Set ARIA attributes
                quickActionsBtn.setAttribute('aria-haspopup', 'true');
                quickActionsBtn.setAttribute('aria-expanded', 'false');
                quickActionsMenu.setAttribute('role', 'menu');

                // Set role on menu items
                quickActionsMenu.querySelectorAll('.menu-item').forEach(item => {
                    item.setAttribute('role', 'menuitem');
                });

                quickActionsBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isExpanded = quickActionsBtn.classList.toggle('active');
                    quickActionsBtn.setAttribute('aria-expanded', isExpanded.toString());
                    quickActionsMenu.classList.toggle('show');
                });

                // click outside listener
                document.addEventListener('click', (e) => {
                    // If the menu is not shown, do nothing
                    if (!quickActionsMenu.classList.contains('show')) {
                        return;
                    }

                    // If the click was not on the button and not inside the menu, close it
                    if (!quickActionsBtn.contains(e.target) && !quickActionsMenu.contains(e.target)) {
                        quickActionsBtn.classList.remove('active');
                        quickActionsBtn.setAttribute('aria-expanded', 'false');
                        quickActionsMenu.classList.remove('show');
                    }
                });

                // Prevent clicks inside the menu from closing it
                quickActionsMenu.addEventListener('click', (e) => {
                    e.stopPropagation();
                });
            }

            // Toolbar action buttons
            const addFilesBtn = document.getElementById('toolbar-add-files');
            if (addFilesBtn) {
                addFilesBtn.addEventListener('click', () => {
                    this.modalManager.showModal('quickstart', { examples: PCB_EXAMPLES });
                    quickActionsBtn.classList.remove('active');
                    quickActionsMenu.classList.remove('show');
                });
            }

            const manageToolpathsBtn = document.getElementById('toolbar-manage-toolpaths');
            if (manageToolpathsBtn) {
                manageToolpathsBtn.addEventListener('click', () => {
                    // Collect operations with previews
                    const readyOps = this.core.operations.filter(op => this.core.isExportReady(op));
                    if (readyOps.length === 0) {
                        this.ui?.updateStatus('No operations ready. Generate previews first.', 'warning');
                        return;
                    }
                    this.modalManager.showModal('exportManager', { operations: readyOps });
                    quickActionsBtn.classList.remove('active');
                    quickActionsMenu.classList.remove('show');
                });
            }

            const exportCvsBtn = document.getElementById('toolbar-export-canvas');
            if (exportCvsBtn) {
                exportCvsBtn.addEventListener('click', async () => {
                    if (!this.ui?.canvasExporter) {
                        this.ui?.updateStatus('Canvas exporter not available', 'error');
                        return;
                    }

                    try {
                        this.ui.canvasExporter.exportCanvasSVG();
                        this.ui?.updateStatus('Canvas exported successfully', 'success');
                    } catch (error) {
                        console.error('Canvas export error:', error);
                        this.ui?.updateStatus('Canvas export failed: ' + error.message, 'error');
                    }

                    quickActionsBtn.classList.remove('active');
                    quickActionsMenu.classList.remove('show');
                });
            }
        }

        /**
         * Global Event Handlers
         */

        setupGlobalHandlers() {
            // Handle resize
            window.addEventListener('resize', () => {
                this.ui.renderer.core.resizeCanvas();
                this.ui.renderer.render();
            });

            // Handle file drops on entire window
            window.addEventListener('dragover', (e) => {
                e.preventDefault();
                // If a modal is open, do not allow workspace drag effects
                if (this.modalManager?.activeModal) {
                    e.dataTransfer.dropEffect = 'none';
                    return;
                }
            });

            window.addEventListener('drop', async (e) => {
                e.preventDefault();

                // If a modal is open, ignore global drops completely
                if (this.modalManager?.activeModal) {
                    return;
                }

                // Only handle if not over a specific drop zone (legacy check, kept for safety)
                if (!e.target.closest('.file-drop-zone') && !e.target.closest('#file-drop-zone')) {
                    await this.handleGlobalFileDrop(e.dataTransfer.files);
                }
            });

            /* Keyboard shortcuts */
            document.addEventListener('keydown', (e) => {
                // Don't intercept if modal is open
                if (window.pcbcam?.modalManager?.activeModal) {
                    return;
                }

                // Guard: Skip if in any interactive element
                const isInputFocused = e.target.matches(
                    'input, textarea, select, [contenteditable="true"], .property-field'
                );

                // Guard: Skip if on skip-link
                if (e.target.classList.contains('skip-link')) {
                    return;
                }

                // Toolbar Arrow Navigation
                const toolbar = document.getElementById('cam-toolbar');
                if (toolbar && toolbar.contains(document.activeElement)) {
                    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                        e.preventDefault();
                        this.navigateToolbar(e.key === 'ArrowRight' ? 1 : -1);
                        return;
                    }
                }

                // Guard: Let tree handle its own arrow navigation
                const isInTree = e.target.closest('#operations-tree');
                const isArrowKey = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key);

                if (isInputFocused) {
                    // Allow Escape to blur inputs
                    if (e.key === 'Escape') {
                        e.target.blur();
                    }
                    return;
                }

                if (isInTree && isArrowKey) {
                    return;
                }

                const key = e.key;
                const code = e.code;
                const isShift = e.shiftKey;

                // Escape: Context-aware handling
                if (key === 'Escape') {
                    // Check if a select dropdown is open (let browser handle it)
                    if (document.activeElement?.tagName === 'SELECT') {
                        // Let the native select close itself, don't prevent
                        return;
                    }

                    // Check if in an input - blur it first
                    if (document.activeElement?.matches('input, textarea')) {
                        e.preventDefault();
                        document.activeElement.blur();
                        return;
                    }

                    // Check if dropdown menu is open
                    const openDropdown = document.querySelector('.dropdown-content.show');
                    if (openDropdown) {
                        e.preventDefault();
                        openDropdown.classList.remove('show');
                        const btn = openDropdown.previousElementSibling;
                        if (btn) {
                            btn.classList.remove('active');
                            btn.setAttribute('aria-expanded', 'false');
                        }
                        return;
                    }

                    e.preventDefault();

                    // If in right sidebar, return to tree
                    const rightSidebar = document.getElementById('sidebar-right');
                    if (rightSidebar && rightSidebar.contains(document.activeElement)) {
                        this.returnFocusToTree();
                        return;
                    }

                    // If in canvas, return to tree
                    const canvas = document.getElementById('preview-canvas');
                    if (document.activeElement === canvas) {
                        this.returnFocusToTree();
                        return;
                    }

                    // Otherwise deselect
                    if (this.ui?.navTreePanel?.selectedNode) {
                        this.ui.navTreePanel.selectedNode = null;
                        document.querySelectorAll('.file-node-content.selected, .geometry-node.selected')
                            .forEach(el => el.classList.remove('selected'));
                        this.ui?.operationPanel?.clearProperties();
                    }
                    return;
                }

                /* View Controls */
                // Home: Fit to view (standard CAD shortcut)
                if (key === 'Home') {
                    e.preventDefault();
                    this.ui?.renderer?.core?.zoomFit();
                    this.ui?.renderer?.render();
                    this.ui?.renderer?.interactionHandler?.updateZoomDisplay();
                    return;
                }

                // F: Fit view (alternative)
                if (key === 'f' || key === 'F') {
                    e.preventDefault();
                    this.ui?.renderer?.core?.zoomFit();
                    this.ui?.renderer?.render();
                    this.ui?.renderer?.interactionHandler?.updateZoomDisplay();
                    return;
                }

                // =: Fit view (alternative)
                if (key === '=' || code === 'Equal') {
                    e.preventDefault();
                    this.ui?.renderer?.core?.zoomFit();
                    this.ui?.renderer?.render();
                    this.ui?.renderer?.interactionHandler?.updateZoomDisplay();
                    return;
                }

                // + : Zoom in
                if (key === '+' || code === 'NumpadAdd') {
                    e.preventDefault();
                    this.ui?.renderer?.core?.zoomIn();
                    this.ui?.renderer?.render();
                    this.ui?.renderer?.interactionHandler?.updateZoomDisplay();
                    return;
                }

                // -: Zoom out
                if (key === '-' || code === 'Minus' || code === 'NumpadSubtract') {
                    e.preventDefault();
                    this.ui?.renderer?.core?.zoomOut();
                    this.ui?.renderer?.render();
                    this.ui?.renderer?.interactionHandler?.updateZoomDisplay();
                    return;
                }

                /* Canvas Panning (Arrow Keys) */
                const panAmount = isShift ? 100 : 25; // Fast pan with Shift

                const inSidebar = document.activeElement?.closest('#sidebar-left, #sidebar-right');

                if (key === 'ArrowLeft' && !inSidebar) {
                    e.preventDefault();
                    this.ui?.renderer?.core?.pan(panAmount, 0);
                    this.ui?.renderer?.render();
                    return;
                }

                if (key === 'ArrowRight' && !inSidebar) {
                    e.preventDefault();
                    this.ui?.renderer?.core?.pan(-panAmount, 0);
                    this.ui?.renderer?.render();
                    return;
                }

                if (key === 'ArrowUp' && !inSidebar) {
                    e.preventDefault();
                    this.ui?.renderer?.core?.pan(0, panAmount);
                    this.ui?.renderer?.render();
                    return;
                }

                if (key === 'ArrowDown' && !inSidebar) {
                    e.preventDefault();
                    this.ui?.renderer?.core?.pan(0, -panAmount);
                    this.ui?.renderer?.render();
                    return;
                }

                /* DisplayToggles */
                // W: Toggle wireframe
                if (key === 'w' || key === 'W') {
                    e.preventDefault();
                    const toggle = document.getElementById('show-wireframe');
                    if (toggle) {
                        toggle.checked = !toggle.checked;
                        toggle.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    return;
                }

                // G: Toggle grid
                if (key === 'g' || key === 'G') {
                    e.preventDefault();
                    const toggle = document.getElementById('show-grid');
                    if (toggle) {
                        toggle.checked = !toggle.checked;
                        toggle.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    return;
                }

                /* Operations */
                // Delete: Remove selected operation
                if (key === 'Delete' || code === 'Delete') {
                    e.preventDefault();
                    this.removeSelectedOperation();
                    return;
                }

                /* Operation Category Cycling (1–5) */
                const opTypeByKey = { '1': 'isolation', '2': 'drill', '3': 'clearing', '4': 'cutout', '5': 'stencil' };
                const mappedOpType = opTypeByKey[key];
                if (mappedOpType) {
                    e.preventDefault();
                    this.ui?.navTreePanel?.cycleOperationCategory(mappedOpType);
                    return;
                }

                /* Origin Controls */
                // B: Bottom-left origin
                if (key === 'b' || key === 'B') {
                    e.preventDefault();
                    this.ui?.controls?.bottomLeftOrigin();
                    return;
                }

                // O: Apply/save origin
                if (key === 'o' || key === 'O') {
                    e.preventDefault();
                    this.ui?.controls?.applyOffsetAndSetOrigin();
                    return;
                }

                if (key === 'c' || key === 'C') {
                    e.preventDefault();
                    this.ui?.controls?.centerOrigin();
                    return;
                }

                /* Help */
                // F1: Show help
                if (key === 'F1') {
                    e.preventDefault();
                    if (this.modalManager) {
                        this.modalManager.showModal('help');
                    }
                    return;
                }
            });

            // Theme toggle button
            const themeToggle = document.getElementById('theme-toggle');
            if (themeToggle) {
                themeToggle.addEventListener('click', async () => {
                    if (window.ThemeLoader && window.ThemeLoader.isLoaded()) {
                        await window.ThemeLoader.toggleTheme();
                        const currentTheme = window.ThemeLoader.getCurrentTheme();
                        this.ui.renderer.setOptions({ theme: currentTheme });
                        this.ui.renderer.render();
                    }
                });
            }
        }

        navigateToolbar(direction) {
            const toolbar = document.getElementById('cam-toolbar');
            if (!toolbar) return;

            const focusables = Array.from(toolbar.querySelectorAll(
                'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
            ));

            const currentIndex = focusables.indexOf(document.activeElement);
            if (currentIndex === -1) return;

            let nextIndex = currentIndex + direction;
            if (nextIndex < 0) nextIndex = focusables.length - 1;
            if (nextIndex >= focusables.length) nextIndex = 0;

            focusables[nextIndex].focus();
        }

        returnFocusToTree() {
            const selected = document.querySelector(
                '.file-node-content.selected, .geometry-node-content.selected, .geometry-node.selected'
            );
            if (selected) {
                const focusTarget = selected.classList.contains('selected') 
                    ? selected 
                    : selected.querySelector('.file-node-content, .geometry-node-content');
                if (focusTarget) {
                    focusTarget.setAttribute('tabindex', '0');
                    focusTarget.focus();
                }
            } else {
                // Focus first category header if nothing selected
                const firstHeader = document.querySelector('.category-header');
                if (firstHeader) {
                    firstHeader.focus();
                }
            }
        }

        ensureCoordinateSystem() {
            if (this.core?.coordinateSystem && !this.core.coordinateSystem.initialized) {
                // Initialize with empty bounds if no operations
                this.core.coordinateSystem.initializeEmpty();
                this.ui.updateOriginDisplay();
            }
        }

        /**
         * File Processing
         */

        async processUploadedFiles() {
            let totalWarnings = 0;
            let formatGuessed = false;
            let fileCount = 0;

            for (const [type, file] of Object.entries(this.uploadedFiles)) {
                if (file) {
                    await this.processFile(file, type);
                    fileCount++;

                    // Track warnings generated during this batch
                    const lastOp = this.core.operations[this.core.operations.length - 1];
                    if (lastOp && lastOp.warnings && lastOp.warnings.length > 0) {
                        totalWarnings += lastOp.warnings.length;
                        if (lastOp.warnings.some(w => (typeof w === 'string' ? w : w.message).includes('No explicit format found'))) {
                            formatGuessed = true;
                        }
                    }
                }
            }

            // Reset
            this.uploadedFiles = {
                isolation: null,
                drill: null,
                clearing: null,
                cutout: null,
                stencil: null
            };

            // Ensure coordinate system is initialized after file upload
            this.ensureCoordinateSystem();

            // Auto-fit to show all loaded geometry
            if (this.ui?.renderer) {
                setTimeout(() => {
                    this.ui.renderer.core.zoomFit();
                }, 100); // Small delay to ensure rendering is complete
            }

            // Issue final batch status toast
            if (fileCount > 1) {
                if (formatGuessed) {
                    this.ui?.updateStatus(`Loaded ${fileCount} files. Warning: Excellon format guessed! See log.`, 'warning');
                } else if (totalWarnings > 0) {
                    this.ui?.updateStatus(`Loaded ${fileCount} files with ${totalWarnings} warning(s). See log.`, 'warning');
                } else {
                    this.ui?.updateStatus(`Successfully loaded ${fileCount} files.`, 'success', true);
                }
            }
        }

        async loadExample(exampleId) {
            if (!exampleId) {
                const select = document.getElementById('pcb-example-select');
                exampleId = select ? select.value : 'exampleSMD1';
            }

            const example = PCB_EXAMPLES[exampleId];
            if (!example) {
                console.error(`Example ${exampleId} not found`);
                this.ui?.updateStatus(`Example not found: ${exampleId}`, 'error');
                return;
            }

            this.ui?.updateStatus(`Loading example: ${example.name}...`, 'info');

            // Clear existing operations
            if (this.core) {
                this.core.operations = [];
                this.core.toolpaths.clear();
            }

            // Clear UI
            if (this.ui?.navTreePanel) {
                this.ui.navTreePanel.refreshTree();
            }

            // Load all files serially
            for (const [type, filepath] of Object.entries(example.files)) {
                try { 
                    const response = await fetch(filepath);
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    const content = await response.text();
                    const fileName = filepath.split('/').pop();
                    const file = new File([content], fileName, { type: 'text/plain' });

                    // Process the file with corrected type
                    await this.processFile(file, type);

                } catch (e) {
                    console.error(`Failed to load example file ${filepath}:`, e);
                    this.ui?.updateStatus(`Failed to load ${filepath.split('/').pop()}`, 'error');
                }
            }

            // Force coordinate system initialization after loading
            if (this.core?.coordinateSystem) {
                this.core.coordinateSystem.analyzeCoordinateSystem(this.core.operations);
            }

            this.ui?.updateStatus(`Example '${example.name}' loaded successfully.`, 'success');

            // Update renderer and fit view
            await this.ui.updateRendererAsync();
            this.ui.renderer.core.zoomFit();
            this.ui.renderer.render();
        }

        async processFile(file, type) {
            if (!file || !type) {
                console.error('Invalid file or type provided');
                return;
            }

            // Validate file type
            const validation = this.core?.validateFileType(file.name, type);
            if (validation && !validation.valid) {
                this.ui?.updateStatus(validation.message, 'error');
                return;
            }

            // Create operation
            const operation = this.core?.createOperation(type, file);
            if (!operation) {
                console.error('Failed to create operation');
                return;
            }

            // Add to UI tree if using advanced UI
            if (this.ui?.navTreePanel) {
                this.ui.navTreePanel.addFileNode(operation);
            }

            // Show loading status
            this.ui?.updateStatus(`${textConfig.statusLoading} ${file.name}...`, 'info', true);

            // Read and parse file
            const reader = new FileReader();

            return new Promise((resolve) => {
                reader.onload = async (e) => {
                    operation.file.content = e.target.result;

                    const success = await this.core.parseOperation(operation);

                    if (success) {
                        const count = operation.primitives.length;

                        if (operation.geometricContext?.hasArcs && debugState.enabled) {
                            let arcCount = 0;
                            operation.primitives.forEach(p => {
                                if (p.type === 'arc') arcCount++;
                                if (p.contours) p.contours.forEach(c => {
                                    if (c.arcSegments) arcCount += c.arcSegments.length;
                                });
                            });
                            console.log(`Preserved ${arcCount} arcs for potential reconstruction`);
                        }

                        // Open Cutout Path Handling
                        if (operation.needsClosurePrompt && operation._closureInfo) {

                            setTimeout(() => {
                                if (!this.modalManager) return;

                                const info = operation._closureInfo;

                                // Analyze and sort gaps FIRST
                                const actualGaps = [...(info.gaps && info.gaps.length > 0 
                                    ? info.gaps 
                                    : GeometryUtils.analyzeSegmentGaps(info.rawPrimitives)
                                )].reverse();

                                // Calculate the suggested tolerance
                                const suggestedTol = (Math.max(...actualGaps) + PRECISION).toFixed(3);

                                // Run the initial probe
                                let lastProbeResult = null;
                                const runProbe = (tol) => {
                                    const { loops, orphans } = GeometryUtils.extractClosedLoops(info.rawPrimitives, tol);
                                    return {
                                        success: orphans.length === 0 && loops.length > 0,
                                        loops: loops,
                                        chainedCount: info.rawPrimitives.length - orphans.length,
                                        totalSegments: info.rawPrimitives.length,
                                        unchainedCount: orphans.length,
                                        testedTol: tol
                                    };
                                };

                                lastProbeResult = runProbe(parseFloat(suggestedTol));

                                // Build the UI strings
                                const gapTextList = actualGaps.length > 0 
                                    ? actualGaps.slice(0, 3).map(g => g.toFixed(4) + 'mm').join(', ')
                                    : 'Unknown';

                                const formatResult = (result) => {
                                    if (!result) return '<span style="color:var(--color-error, #ff4444);">Probe failed.</span>';
                                    
                                    const ok = result.success;
                                    const color = ok ? 'var(--color-success, #44bb44)' : 'var(--color-error, #ff4444)';
                                    const icon = ok ? '✓' : '✗';

                                    let html = `<span style="color:${color};font-weight:bold;">${icon} ${result.chainedCount} of ${result.totalSegments} segments joined</span>`;

                                    if (ok) {
                                        html += `<br><span style="color:var(--color-text-secondary);">Path successfully closed using ${result.testedTol}mm tolerance.</span>`;
                                    } else {
                                        html += `<br><span style="color:var(--color-error, #ff4444);">${result.unchainedCount} segment(s) remain disconnected.</span>`;
                                        html += `<br><span style="color:var(--color-text-secondary);">Increase tolerance to bridge larger gaps.</span>`;
                                    }
                                    return html;
                                };

                                const extractedCount = operation._extractedLoops ? operation._extractedLoops.length : 0;
                                const orphanCount = info.rawPrimitives.length;
                                
                                let introHTML = `<p>The cutout geometry in <strong>${operation.file.name}</strong> contains disconnected segments.</p>`;
                                if (extractedCount > 0) {
                                    introHTML = `<p><strong>${extractedCount}</strong> closed loop(s) were extracted successfully, but <strong>${orphanCount}</strong> segment(s) remain disconnected.</p>`;
                                }

                                const bodyHTML = `
                                    ${introHTML}
                                    <div class="closure-gaps">
                                        <strong>Detected Gaps:</strong> ${gapTextList}
                                    </div>
                                    <p>Set a tolerance large enough to bridge the maximum gap:</p>
                                    <div class="closure-controls">
                                        <label for="closure-tolerance">Tolerance:</label>
                                        <div class="input-unit">
                                            <input type="number" id="closure-tolerance" value="${suggestedTol}" min="0.001" max="5.0" step="0.001">
                                            <span class="unit">mm</span>
                                        </div>
                                        <button id="closure-test-btn" class="btn btn--secondary btn--compact">Test</button>
                                    </div>
                                    <div class="closure-results" id="closure-probe-results">
                                        ${formatResult(lastProbeResult)}
                                    </div>
                                `;

                                this.modalManager.showWarning(
                                    'Open Cutout Path Detected',
                                    null,
                                    {
                                        bodyHTML: bodyHTML,
                                        confirmText: 'Close path',
                                        cancelText: 'Keep as-is',
                                        onConfirm: async () => {
                                            const resolvedLoops = lastProbeResult?.loops;
                                            if (resolvedLoops && resolvedLoops.length > 0) {
                                                const allLoops = operation._extractedLoops 
                                                    ? [...operation._extractedLoops, ...resolvedLoops] 
                                                    : resolvedLoops;
                                                const topology = GeometryUtils.classifyCutoutTopology(allLoops);
                                                const compounds = GeometryUtils.assembleCutoutCompounds(topology);

                                                operation.primitives = compounds.length > 0 ? compounds : allLoops;
                                                delete operation._extractedLoops;

                                                operation.bounds = this.core.recalculateBounds(operation.primitives);
                                                this.core.analyzeGeometricContext(operation, operation.primitives);

                                                delete operation.needsClosurePrompt;
                                                delete operation._closureInfo;

                                                // Clear the specific warning now that the geometry is fixed
                                                if (operation.warnings) {
                                                    operation.warnings = operation.warnings.filter(w => {
                                                        const msg = typeof w === 'string' ? w : w.message;
                                                        return !msg.includes('do not form closed loops');
                                                    });
                                                }

                                                if (this.ui?.navTreePanel) {
                                                    const fileNode = this.ui.navTreePanel.getNodeByOperationId(operation.id);
                                                    if (fileNode) {
                                                        this.ui.navTreePanel.updateFileGeometries(fileNode.id, operation);
                                                    }
                                                }

                                                await this.ui.updateRendererAsync();
                                                this.ui?.updateStatus('Cutout paths automatically closed.', 'success');
                                            } else {
                                                this.ui?.updateStatus('Cannot close — test with a higher tolerance first.', 'error');
                                            }
                                        },

                                        onCancel: () => {
                                            delete operation.needsClosurePrompt;
                                            delete operation._closureInfo;
                                            delete operation._extractedLoops;
                                            const hasGeometry = operation.primitives && operation.primitives.length > 0;
                                            this.ui?.updateStatus(
                                                hasGeometry ? 'Orphan segments discarded. Board outlines preserved.' : 'Cutout left as open path.',
                                                'info'
                                            );
                                        }
                                    }
                                );

                                requestAnimationFrame(() => {
                                    const testBtn = document.getElementById('closure-test-btn');
                                    const tolInput = document.getElementById('closure-tolerance');
                                    const resultsDiv = document.getElementById('closure-probe-results');
                                    const confirmBtn = document.querySelector('#warning-modal .warning-confirm');

                                    if (testBtn && tolInput && resultsDiv) {
                                        const doTest = () => {
                                            const rawTol = parseFloat(tolInput.value);
                                            if (!rawTol || rawTol <= 0) {
                                                resultsDiv.innerHTML = '<span style="color:var(--color-error, #ff4444);">Enter a positive tolerance value.</span>';
                                                return;
                                            }
                                            const tol = Math.min(5.0, Math.max(0.001, rawTol));
                                            lastProbeResult = runProbe(tol);
                                            resultsDiv.innerHTML = formatResult(lastProbeResult);
                                            if (confirmBtn) {
                                                confirmBtn.disabled = !lastProbeResult?.success;
                                            }
                                        };

                                        testBtn.addEventListener('click', doTest);
                                        tolInput.addEventListener('keypress', (e) => {
                                            if (e.key === 'Enter') doTest();
                                        });
                                        if (confirmBtn) {
                                            confirmBtn.disabled = !lastProbeResult?.success;
                                        }
                                    }
                                });
                            }, 200);
                        }

                        // SVG Drill Recovery Prompt
                        if (operation.type === 'drill' && operation.drillRecoverable) {
                            const rec = operation.drillRecoverable;

                            setTimeout(() => {
                                if (!this.modalManager) return;

                                // Build size group summaries
                                const buildSizeList = (items, type) => {
                                    if (!items || items.length === 0) return '';

                                    const groups = new Map();
                                    for (const item of items) {
                                        const d = item.detected.diameter;
                                        if (type === 'circle') {
                                            const key = d.toFixed(3);
                                            groups.set(key, (groups.get(key) || 0) + 1);
                                        } else {
                                            const slot = item.detected.originalSlot;
                                            const len = Math.hypot(slot.end.x - slot.start.x, slot.end.y - slot.start.y);
                                            const key = `${d.toFixed(3)} × ${(len + d).toFixed(3)}`;
                                            groups.set(key, (groups.get(key) || 0) + 1);
                                        }
                                    }

                                    return Array.from(groups.entries())
                                        .map(([size, count]) => {
                                            const prefix = type === 'circle' ? `⌀${size}mm` : `${size}mm`;
                                            return `<div class="recovery-size-entry">${prefix} × ${count}</div>`;
                                        }).join('');
                                };

                                const circleCount = rec.circles?.length || 0;
                                const obroundCount = rec.obrounds?.length || 0;

                                const circleColumn = circleCount > 0 ? `
                                    <div class="drill-recovery-column">
                                        <h4>Circle Candidates (${circleCount})</h4>
                                        <p>Compound paths that form complete circles.</p>
                                        ${buildSizeList(rec.circles, 'circle')}
                                    </div>
                                ` : '';

                                const obroundColumn = obroundCount > 0 ? `
                                    <div class="drill-recovery-column">
                                        <h4>Obround Candidates (${obroundCount})</h4>
                                        <p>Compound paths that form stadium/capsule shapes.</p>
                                        ${buildSizeList(rec.obrounds, 'obround')}
                                    </div>
                                ` : '';

                                // Single column class when only one type present
                                const gridClass = (circleCount > 0 && obroundCount > 0)
                                    ? 'drill-recovery-grid'
                                    : 'drill-recovery-grid drill-recovery-single';

                                const bodyHTML = `
                                    <p>The SVG file <strong>${operation.file.name}</strong> contains ${circleCount + obroundCount} compound path(s) that match known drill shapes but aren't encoded as native primitives.</p>
                                    <div class="${gridClass}">
                                        ${circleColumn}
                                        ${obroundColumn}
                                    </div>
                                    <p class="drill-recovery-question">Convert these into valid hole and slot geometry for the drill operation?</p>
                                `;

                                this.modalManager.showWarning(
                                    'Recoverable Drill Geometry',
                                    null,
                                    {
                                        bodyHTML: bodyHTML,
                                        confirmText: 'Convert',
                                        cancelText: 'Skip',
                                        onConfirm: async () => {
                                            this.core.getHandler('drill').promoteDrillRecoverable(
                                                operation,
                                                circleCount > 0,
                                                obroundCount > 0
                                            );

                                            // Update tree
                                            if (this.ui?.navTreePanel) {
                                                const fileNode = this.ui.navTreePanel.getNodeByOperationId(operation.id);
                                                if (fileNode) {
                                                    this.ui.navTreePanel.updateFileGeometries(fileNode.id, operation);
                                                }
                                            }

                                            await this.ui.updateRendererAsync();
                                            this.ui?.updateStatus(`Recovered ${circleCount + obroundCount} drill shape(s)`, 'success');
                                        },
                                        onCancel: () => {
                                            delete operation.drillRecoverable;
                                            this.ui?.updateStatus('Compound shapes skipped', 'info');
                                        }
                                    }
                                );
                            }, 250);
                        }

                        // Intercept format warnings to elevate the final status toast
                        let finalStatusMsg = `Loaded ${operation.file.name}: ${count} primitives`;
                        let finalStatusType = 'success';

                        // Surface any classification warnings to the status log
                        if (operation.warnings && operation.warnings.length > 0) {
                            for (const w of operation.warnings) {
                                const msg = typeof w === 'string' ? w : w.message;
                                const severity = (typeof w === 'object' && w.severity) || 'warning';

                                // Push the specific warning directly into the log history
                                this.ui?.updateStatus(`${operation.file.name}: ${msg}`, severity);

                                // If it's the Excellon format warning, upgrade the final toast message
                                if (msg.includes('No explicit format found')) {
                                    finalStatusMsg = `Loaded ${operation.file.name}: ${count} drills (Guessed Format!)`;
                                    finalStatusType = 'warning';
                                }
                            }
                        }

                        // Display the final summary toast
                        this.ui?.updateStatus(finalStatusMsg, finalStatusType);

                        this.core.coordinateSystem.analyzeCoordinateSystem(this.core.operations);
                    } else {
                        this.ui?.updateStatus(`Error processing ${operation.file.name}: ${operation.error}`, 'error');
                    }

                    // Update tree with geometry info if using advanced UI
                    if (this.ui?.navTreePanel) {
                        const fileNode = this.ui.navTreePanel.getNodeByOperationId(operation.id);
                        if (fileNode) {
                            this.ui.navTreePanel.updateFileGeometries(fileNode.id, operation);
                        }
                    }

                    // Update renderer to show new geometry
                    if (this.ui?.updateRendererAsync) {
                        await this.ui.updateRendererAsync();
                    } else if (this.ui?.updateRenderer) {
                        await this.ui.updateRenderer();
                    }

                    // Auto-fit on first file
                    const hasMultipleOps = this.core.operations.length > 1;
                    if (!hasMultipleOps && this.ui?.renderer) {
                        this.ui.renderer.core.zoomFit();
                    }

                    // Update statistics
                    this.ui.updateStatistics();

                    resolve();
                };

                reader.onerror = () => {
                    operation.error = 'Failed to read file';
                    this.ui?.updateStatus(`Failed to read ${file.name}`, 'error');
                    resolve();
                };

                reader.readAsText(file);
            });
        }

        async handleGlobalFileDrop(files) {
            if (!this.ui) return;
            let totalWarnings = 0;
            let formatGuessed = false;
            let fileCount = 0;

            // Process files serially to avoid race conditions
            for (let file of files) {
                const ext = file.name.toLowerCase().split('.').pop();
                const opType = this.getOperationTypeFromExtension(ext);

                if (opType) {
                    if (this.initState.fullyReady) {
                        await this.processFile(file, opType);
                        fileCount++;

                        // Track warnings generated during this batch
                        const lastOp = this.core.operations[this.core.operations.length - 1];
                        if (lastOp && lastOp.warnings && lastOp.warnings.length > 0) {
                            totalWarnings += lastOp.warnings.length;
                            if (lastOp.warnings.some(w => (typeof w === 'string' ? w : w.message).includes('No explicit format found'))) {
                                formatGuessed = true;
                            }
                        }
                    } else {
                        this.pendingOperations.push({ file, opType });
                    }
                }
            }

            // Auto-fit after all files are loaded
            if (this.pendingOperations.length === 0 && this.initState.fullyReady) {
                // Ensure coordinate system updates
                if (this.core?.coordinateSystem) {
                    this.core.coordinateSystem.analyzeCoordinateSystem(this.core.operations);
                }

                await this.ui.updateRendererAsync();
                this.ui.renderer.core.zoomFit(true);
                this.ui.renderer.render();

                // Issue final batch status toast
                if (fileCount > 1) {
                    if (formatGuessed) {
                        this.ui.updateStatus(`Loaded ${fileCount} files. Warning: Excellon format guessed! See log.`, 'warning');
                    } else if (totalWarnings > 0) {
                        this.ui.updateStatus(`Loaded ${fileCount} files with ${totalWarnings} warning(s). See log.`, 'warning');
                    } else {
                        this.ui.updateStatus(`Successfully loaded ${fileCount} files.`, 'success', true);
                    }
                }
            }

            if (this.pendingOperations.length > 0 && !this.initState.fullyReady) {
                this.ui?.updateStatus(textConfig.statusLoading);
            }
        }

        getOperationTypeFromExtension(ext) {
            for (let [type, config] of Object.entries(this.core.fileTypes)) {
                if (config.extensions && config.extensions.some(e => e.slice(1) === ext)) {
                    return type;
                }
            }
            return null;
        }

        async processPendingOperations() {
            if (this.pendingOperations.length === 0) return;

            this.debug(`Processing ${this.pendingOperations.length} pending files...`);

            for (let op of this.pendingOperations) {
                await this.processFile(op.file, op.opType);
            }

            this.pendingOperations = [];
        }

        removeSelectedOperation() {
            const selectedNode = this.ui?.navTreePanel?.selectedNode;
            if (selectedNode?.type === 'file' && selectedNode.operation) {
                this.ui.removeOperation(selectedNode.operation.id);
            }
        }

        /**
         * API for external access
         */

        getCore() {
            return this.core;
        }

        getUI() {
            return this.ui;
        }

        isReady() {
            return this.initState.fullyReady;
        }

        getStats() {
            return {
                initialization: this.initState,
                core: this.core?.getStats ? this.core.getStats() : null,
                ui: this.ui?.stats,
                toolLibrary: this.ui?.toolLibrary?.getStats?.(),
                renderer: {
                    hasRenderer: !!this.ui?.renderer,
                    layerCount: this.ui?.renderer?.layers?.size || 0
                }
            };
        }

        // Debug utilities
        debug(message, data = null) {
            if (debugState.enabled) {
                if (data !== null) {
                    console.log(`[Controller] ${message}`, data);
                } else {
                    console.log(`[Controller] ${message}`);
                }
            }
        }

        enableDebug() {
            debugState.enabled = true;
            console.log('Debug mode enabled');
        }

        disableDebug() {
            debugState.enabled = false;
            console.log('Debug mode disabled');
        }

        logState() {
            console.group('PCB CAM State');
            console.log('Initialization:', this.initState);
            console.log('Statistics:', this.getStats());
            console.log('Config:', window.PCBCAMConfig);
            console.groupEnd();
        }
    }

    /**
     * Application Bootstrap
     */

    let controller = null;

    async function startApplication() {
        if (controller) {
            console.warn('Application already initialized');
            return;
        }

        controller = new PCBCAMController();
        await controller.initialize();

        // Expose to global scope for debugging
        window.pcbcam = controller;

        return true;
    }

    // Expose startApplication to the global scope so index.html can call it
    window.startApplication = startApplication;

    // Public API functions
    window.showPCBStats = function() {
        if (!controller) {
            console.error('Application not initialized');
            return;
        }
        controller.logState();
    };

    window.enablePCBDebug = function() {
        debugState.enabled = true;
        console.log('Debug mode enabled');
    };

    window.disablePCBDebug = function() {
        debugState.enabled = false;
        console.log('Debug mode disabled');
    };

    // Global function for HTML compatibility
    window.addFile = function(type) {
        controller.debug(`addFile('${type}') called`);

        if (controller?.ui) {
            // Try to use the UI's file input trigger if available
            if (controller.ui.triggerFileInput) {
                controller.ui.triggerFileInput(type);
            } else {
                // Fall back to direct file input trigger
                const fileInput = document.getElementById('file-input-temp') || 
                                 document.getElementById('file-input-hidden');
                if (fileInput) {
                    fileInput.setAttribute('data-type', type);

                    const opConfig = opsConfig[type];
                    if (opConfig) {
                        const extensions = [...opConfig.extensions];
                        if (!extensions.includes('.svg')) {
                            extensions.push('.svg');
                        }
                        fileInput.setAttribute('accept', extensions.join(','));
                    }

                    fileInput.onchange = async (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            await controller.processFile(file, type);
                        }
                        fileInput.value = '';
                    };

                    fileInput.click();
                } else {
                    console.error('File input element not found');
                }
            }
        } else {
            console.error('Controller not initialized');
        }
    };

    // Arc reconstruction registry inspector
    window.getReconstructionRegistry = function() {
        if (!controller?.core?.geometryProcessor) {
            console.error('Geometry processor not initialized');
            return;
        }
        const registry = controller.core.geometryProcessor.arcReconstructor?.exportRegistry?.();
        if (registry) {
            controller.debug(`Arc Reconstructor Registry (${registry.length} curves):`);
            console.table(registry);
        }
        return registry;
    };
})();