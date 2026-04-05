/*!
 * @file        cam-controller.js
 * @description Initializes and connects core and UI
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
    const debugState = D.debug;
    const textConfig = C.ui.text;
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

            // Pipeline components (declare but don't instantiate yet)
            this.gcodeGenerator = null
            this.toolpathOptimizer = null

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

            // Upload modal file tracking - one per operation type
            this.uploadedFiles = {
                isolation: null,
                drill: null,
                clearing: null,
                cutout: null,
                stencil: null
            };

            // Queued files for processing
            this.queuedFiles = [];

            // Pipeline state — drives UI behavior across all modules
            this.pipelineState = {
                type: 'cnc',        // 'cnc' | 'laser' | 'hybrid'
                laser: null         // null for CNC, object for laser/hybrid
            };
        }

        /**
         * Sets the active pipeline. Called from laser config modal or welcome card.
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
         * Auto-upgrades laser → hybrid when a CNC operation type is added.
         * Called from processFile() after operation is created.
         */
        checkHybridUpgrade(operationType) {
            // HYBRID LOCK: Disabled until laser operations are fully verified.
            if (this.pipelineState.type === 'laser') {
                this.debug(`Hybrid upgrade blocked for ${operationType} — feature locked.`);
                return false; 
            }

            if (this.pipelineState.type !== 'laser') return false;

            const cncTypes = ['drill', 'cutout', 'clearing'];
            if (cncTypes.includes(operationType)) {
                this.pipelineState.type = 'hybrid';
                try {
                    localStorage.setItem('pcbcam-pipeline', JSON.stringify(this.pipelineState));
                } catch (e) { /* ignore */ }

                this.debug('Auto-upgraded to hybrid pipeline');

                // Trigger UI updates for the new hybrid state
                if (this.ui?.controls) {
                    this.ui.controls.updatePipelineFieldVisibility();
                }
                if (this.ui?.navTreePanel) {
                    this.ui.navTreePanel.refreshTree();
                }
                return true;
            }
            return false;
        }

        /**
         * Returns operation types available for the current pipeline.
         */
        getActiveOperationTypes() {
            const state = this.pipelineState;

            if (state.type === 'cnc') {
                return ['isolation', 'drill', 'clearing', 'cutout', 'stencil'];
            }

            // Laser ops — always available
            const ops = ['laser_isolation', 'laser_mask', 'laser_stencil', 'laser_silkscreen', 'laser_marking'];

            // Capability-gated laser ops
            if (state.laser?.capabilities?.canReflow) {
                ops.push('laser_reflow');
            }

            // CNC ops available in laser mode (for hybrid potential)
            if (state.laser?.capabilities?.canDrill) {
                ops.push('drill');
            }
            if (state.laser?.capabilities?.canCut) {
                ops.push('cutout');
            }

            // If already hybrid, ensure CNC ops are included
            if (state.type === 'hybrid') {
                if (!ops.includes('drill')) ops.push('drill');
                if (!ops.includes('cutout')) ops.push('cutout');
            }

            // Stencil is always available regardless of pipeline
            ops.push('stencil');

            return ops;
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

        async initialize() {
            console.log('EasyTrace5000 Workspace initializing...');

            try {
                // Initialize core with skip init flag to control WASM loading
                this.core = new PCBCamCore({ skipInit: true });

                // Initialize managers before UI
                this.parameterManager = new ParameterManager();
                this.languageManager = new LanguageManager();

                // Load the language file before the UI
                await this.languageManager.load();

                // Restore pipeline state before UI init so components can read it
                this.restorePipeline();

                // Instantiate pipeline components *after* core exists
                this.gcodeGenerator = new GCodeGenerator(D.gcode);
                this.gcodeGenerator.setCore(this.core);
                this.gcodeGenerator.setLanguageManager(this.languageManager);
                this.geometryTranslator = new GeometryTranslator(this.core);
                this.toolpathOptimizer = new ToolpathOptimizer();
                this.machineProcessor = new MachineProcessor(this.core);

                // Expose early so UI modules can access controller during init
                window.pcbcam = this;

                // Initialize UI with core and language manager
                this.ui = new PCBCamUI(this.core, this.languageManager);

                // Initialize UI (pass parameter manager)
                const uiReady = await this.ui.init(this.parameterManager);
                this.initState.uiReady = uiReady;

                if (!uiReady) {
                    throw new Error('UI initialization failed');
                }

                // Initialize managers that DO depend on UI
                this.modalManager = new ModalManager(this)

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

                // Sync pipeline UI state after all components are ready
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

                // Check if the user is trying to deep-link to support
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

                // Escape: Deselect / Close modal
                if (key === 'Escape') {
                    e.preventDefault();

                    // If in parameter panel, return to tree
                    const paramForm = document.getElementById('property-form');
                    if (paramForm && paramForm.contains(document.activeElement)) {
                        const selected = document.querySelector('.file-node-content.selected, .geometry-node-content.selected');
                        if (selected) {
                            selected.focus();
                            return;
                        }
                    }

                    // Otherwise deselect current selection
                    if (this.ui?.navTreePanel?.selectedNode) {
                        this.ui.navTreePanel.selectedNode = null;
                        document.querySelectorAll('.file-node-content.selected, .geometry-node.selected')
                            .forEach(el => el.classList.remove('selected'));
                        this.ui?.operationPanel?.clearProperties();
                    }
                    return;
                }

                // ═══════════════════════════════════════════════════════════════
                // Add a function to 1-0 numeric characters?
                // Select source files? Select operation and cycle source files?
                // ═══════════════════════════════════════════════════════════════

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

        async processUploadedFiles() {
            for (const [type, file] of Object.entries(this.uploadedFiles)) {
                if (file) {
                    await this.processFile(file, type);
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

            // Update UI
            if (this.ui?.navTreePanel) {
                this.ui.navTreePanel.expandAll();
            }

            // Auto-fit to show all loaded geometry
            if (this.ui?.renderer) {
                setTimeout(() => {
                    this.ui.renderer.core.zoomFit();
                }, 100); // Small delay to ensure rendering is complete
            }
        }

        async loadExample(exampleId) {
            const select = document.getElementById('pcb-example-select');
            exampleId = select ? select.value : 'exampleSMD1';

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
                this.core.isToolpathCacheValid = false;
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
                    this.ui?.showOperationMessage?.(type, `Failed to load ${filepath.split('/').pop()}`, 'error');
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

            // Expand operations after loading
            if (this.ui.navTreePanel) {
                this.ui.navTreePanel.expandAll();
            }
        }

        async processFile(file, type) {
            if (!file || !type) {
                console.error('Invalid file or type provided');
                return;
            }

            // Validate file type
            const validation = this.core?.validateFileType(file.name, type);
            if (validation && !validation.valid) {
                this.ui?.showOperationMessage?.(type, validation.message, 'error');
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

            // Render in operations manager if using basic UI
            if (this.ui?.renderOperations) {
                this.ui.renderOperations(type);
            }

            // Show loading status
            this.ui?.updateStatus(`${textConfig.statusLoading} ${file.name}...`);

            // Read and parse file
            const reader = new FileReader();

            return new Promise((resolve) => {
                reader.onload = async (e) => {
                    operation.file.content = e.target.result;

                    const success = await this.core.parseOperation(operation);

                    if (success) {
                        const count = operation.primitives.length;

                        if (operation.parsed?.hasArcs && debugState.enabled) {
                            console.log(`Preserved ${operation.originalArcs?.length || 0} arcs for potential reconstruction`);
                        }

                        // Open Cutout Path Handling
                        if (operation.needsClosurePrompt && operation._closureInfo) {
                            const info = operation._closureInfo;

                            setTimeout(() => {
                                if (!this.modalManager) return;

                                const defaultTolerance = 0.1;
                                let lastProbeResult = null;

                                // Run initial probe
                                const runProbe = (tol) => {
                                    const { loops, orphans } = GeometryUtils.extractClosedLoops(info.rawPrimitives, tol);

                                    return {
                                        // Only succeed if ALL segments found a home
                                        success: orphans.length === 0 && loops.length > 0,
                                        loops: loops,
                                        chainedCount: info.rawPrimitives.length - orphans.length,
                                        totalSegments: info.rawPrimitives.length,
                                        unchainedCount: orphans.length,
                                        gapCount: loops.length, // Rough estimate
                                        maxGap: tol
                                    };
                                };

                                lastProbeResult = runProbe(defaultTolerance);

                                const formatResult = (result) => {
                                    if (!result) {
                                        return '<span style="color:var(--color-error, #ff4444);">Probe failed — no segments could be analyzed.</span>';
                                    }
                                    const ok = result.success;
                                    const color = ok ? 'var(--color-success, #44bb44)' : 'var(--color-error, #ff4444)';
                                    const icon = ok ? '✓' : '✗';

                                    let html = `<span style="color:${color};font-weight:bold;">${icon} ${result.chainedCount}/${result.totalSegments} segments chained</span>`;
                                    if (result.unchainedCount > 0) {
                                        html += `<br><span style="color:var(--color-error, #ff4444);">${result.unchainedCount} segment(s) could not be chained — tolerance too low or geometry is fragmented.</span>`;
                                    }
                                    if (result.gapCount > 0) {
                                        html += `<br>Gaps bridged: ${result.gapCount} (max: ${result.maxGap.toFixed(3)} mm)`;
                                    }
                                    if (ok) {
                                        html += `<br><span style="color:var(--color-success, #44bb44);">Path can be closed.</span>`;
                                    }
                                    return html;
                                };

                                const extractedCount = operation._extractedLoops ? operation._extractedLoops.length : 0;
                                const orphanCount = info.rawPrimitives.length;
                                const contextNote = extractedCount > 0
                                    ? `${extractedCount} closed loop(s) were extracted successfully. ${orphanCount} segment(s) could not be assigned to any closed loop.`
                                    : `The cutout geometry in <strong>${operation.file.name}</strong> does not form a closed loop at the default precision (${(C.precision.coordinate).toFixed(3)} mm).`;

                                const bodyHTML = `
                                    <p>${contextNote}</p>
                                    <p>Set the maximum gap tolerance to bridge between segment endpoints:</p>
                                    <div class="closure-controls">
                                        <label for="closure-tolerance">Tolerance:</label>
                                        <div class="input-unit">
                                            <input type="number" id="closure-tolerance" value="${defaultTolerance}" min="0.001" max="5.0" step="0.01">
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
                                                // Merge with any loops that were already closed perfectly
                                                const allLoops = operation._extractedLoops 
                                                    ? [...operation._extractedLoops, ...resolvedLoops] 
                                                    : resolvedLoops;

                                                // Re-run topology classification to find holes inside the newly closed boards
                                                const topology = GeometryUtils.classifyCutoutTopology(allLoops);
                                                const compounds = GeometryUtils.assembleCutoutCompounds(topology);

                                                operation.primitives = compounds.length > 0 ? compounds : allLoops;
                                                delete operation._extractedLoops;

                                                operation.bounds = this.core.recalculateBounds(operation.primitives);
                                                this.core.analyzeGeometricContext(operation, operation.primitives);

                                                delete operation.needsClosurePrompt;
                                                delete operation._closureInfo;

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

                                // Wire up test button after modal renders
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

                                            // Enable/disable confirm button based on result
                                            if (confirmBtn) {
                                                confirmBtn.disabled = !lastProbeResult?.success;
                                            }
                                        };

                                        testBtn.addEventListener('click', doTest);
                                        tolInput.addEventListener('keypress', (e) => {
                                            if (e.key === 'Enter') doTest();
                                        });

                                        // Set initial confirm button state
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
                                            this.core._promoteDrillRecoverable(
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

                        this.ui?.showOperationMessage?.(type, `Successfully loaded ${count} primitives`, 'success');
                        this.ui?.updateStatus(`Loaded ${operation.file.name}: ${count} primitives`, 'success');

                        // Update coordinate system after successful parse
                        if (this.core?.coordinateSystem) {
                            this.core.coordinateSystem.analyzeCoordinateSystem(this.core.operations);
                        }
                    } else {
                        this.ui?.showOperationMessage?.(type, `Error: ${operation.error}`, 'error');
                        this.ui?.updateStatus(`Error processing ${operation.file.name}: ${operation.error}`, 'error');
                    }

                    // Update UI
                    if (this.ui?.renderOperations) {
                        this.ui.renderOperations(type);
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
                    this.ui?.updateStatistics?.();

                    resolve();
                };

                reader.onerror = () => {
                    operation.error = 'Failed to read file';
                    this.ui?.showOperationMessage?.(type, 'Failed to read file', 'error');
                    this.ui?.updateStatus(`Failed to read ${file.name}`, 'error');
                    resolve();
                };

                reader.readAsText(file);
            });
        }

        async handleGlobalFileDrop(files) {
            if (!this.ui) return;

            // Process files serially to avoid race conditions
            for (let file of files) {
                const ext = file.name.toLowerCase().split('.').pop();
                const opType = this.getOperationTypeFromExtension(ext);

                if (opType) {
                    if (this.initState.fullyReady) {
                        await this.processFile(file, opType);
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
            }

            if (this.pendingOperations.length > 0 && !this.initState.fullyReady) {
                this.ui?.updateStatus(textConfig.statusLoading);
            }
        }

        getOperationTypeFromExtension(ext) {
            for (let [type, op] of Object.entries(opsConfig)) {
                if (op.extensions && op.extensions.some(e => e.slice(1) === ext)) {
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
            // Try advanced UI first
            const selectedNode = this.ui?.navTreePanel.selectedNode;
            if (selectedNode?.type === 'file' && selectedNode.operation) {
                this.ui.removeOperation(selectedNode.operation.id);
                return;
            }

            // Fall back to basic UI selection method if needed
            const selectedOp = this.ui?.getSelectedOperation?.();
            if (selectedOp) {
                this.ui.removeOperation(selectedOp.id);
            }
        }

        async orchestrateToolpaths(options) {
            if (!options?.operationIds || !this.core || !this.gcodeGenerator) {
                console.error("[Controller] Orchestration failed");
                return { gcode: "; Generation Failed", lineCount: 1, planCount: 0, estimatedTime: 0, totalDistance: 0 };
            }

            // Build Contexts and Attach to Operations

            this.debug(`Building contexts for ${options.operationIds.length} operations...`);

            const operationContextPairs = [];
            for (const opId of options.operationIds) {
                try {
                    const operation = this.core.operations.find(o => o.id === opId);
                    if (!operation) throw new Error(`Operation ${opId} not found.`);

                    // Commit any live UI changes to the operation object before building the context from it.
                    if (this.parameterManager.hasUnsavedChanges(opId)) {
                        this.parameterManager.commitToOperation(operation);
                        this.debug(`Committed unsaved parameters for ${opId}`);
                    }

                    const ctx = this.core.buildToolpathContext(opId, this.parameterManager);

                    // Processor-specific context preprocessing.
                    // Roland compatibility: enforce machine-safe settings.
                    if (options.postProcessor === 'roland') {
                        this._preprocessRolandContext(ctx, operation);
                    }

                    operationContextPairs.push({ operation, context: ctx });

                } catch (error) {
                    console.warn(`Skipping operation ${opId}: ${error.message}`);
                }
            }

            if (operationContextPairs.length === 0) {
                return { gcode: "; No valid operations to process", lineCount: 1, planCount: 0, estimatedTime: 0, totalDistance: 0 };
            }

            this.debug(`Batching ${operationContextPairs.length} operations by instance...`);
            const operationSuperBatches = [];

            // Create one batch per operation instance (not by type)
            for (const { operation, context } of operationContextPairs) {
                operationSuperBatches.push({
                    type: operation.type,
                    operationId: operation.id,
                    pairs: [{ operation, context }] // Single operation per batch
                });
            }

            this.debug(`Created ${operationSuperBatches.length} super-batches (one per operation).`);

            // Loop through the super-batches
            const allMachineReadyPlans = [];
            const firstContext = operationContextPairs[0].context; // Get global context

            // This is the persistent machine position that tracks between batches
            let currentMachinePos = { x: 0, y: 0, z: firstContext.machine.safeZ };

            for (const superBatch of operationSuperBatches) {
                this.debug(`--- Processing Super-Batch: ${superBatch.type} (${superBatch.pairs.length} op/s) ---`);

                // Translate (for this super-batch only)
                const batchPlans = await this.geometryTranslator.translateAllOperations(superBatch.pairs);

                if (!batchPlans || batchPlans.length === 0) {
                    this.debug(`--- Super-Batch ${superBatch.type} produced no plans. Skipping. ---`);
                    continue;
                }

                // Optimize (for this super-batch only)
                let plansToProcess = batchPlans;
                if (options.optimize === true) {
                    this.debug(`Optimizing ${batchPlans.length} plans for batch ${superBatch.type}...`);

                    // Pass the machine's current position to the optimizer
                    // The optimizer will group by tool (groupKey) within this batch
                    plansToProcess = this.toolpathOptimizer.optimize(batchPlans, currentMachinePos);
                }

                if (plansToProcess.length === 0) {
                    this.debug(`--- Super-Batch ${superBatch.type} had no plans after optimization. Skipping. ---`);
                    continue;
                }

                // Add machine operations (for this batch only)
                this.debug('Adding machine operations...');

                // Pass the first context of this batch to the machine processor
                const batchContext = superBatch.pairs[0].context;

                // Pass the current position, and get the new position back
                const { plans: machineReadyPlans, endPos } = this.machineProcessor.processPlans(
                    plansToProcess,
                    batchContext,
                    currentMachinePos // Pass the starting position
                );

                allMachineReadyPlans.push(...machineReadyPlans);

                // The returned endPos is the new starting position for the NEXT batch
                currentMachinePos = endPos;

                this.debug(`--- Super-Batch ${superBatch.type} complete. New machine pos: (${endPos.x.toFixed(2)}, ${endPos.y.toFixed(2)}, ${endPos.z.toFixed(2)}) ---`);
            }

            // Generate G-code (from all combined machine-ready plans)
            this.debug('Generating G-code...');
            const gcodeConfig = firstContext.gcode;
            const machineConfig = firstContext.machine;
            const processorSettings = firstContext.processorSettings || {};
            const rolandSettings = processorSettings.roland || {};

            const genOptions = {
                postProcessor: options.postProcessor,
                includeComments: options.includeComments,
                singleFile: options.singleFile,
                toolChanges: options.toolChanges,
                userStartCode: gcodeConfig.userStartCode,
                userEndCode: gcodeConfig.userEndCode,
                units: gcodeConfig.units,
                safeZ: machineConfig.safeZ,
                travelZ: machineConfig.travelZ,
                coolant: machineConfig.coolant,
                vacuum: machineConfig.vacuum,
                rolandModel: rolandSettings.rolandModel,
                rolandStepsPerMM: rolandSettings.rolandStepsPerMM,
                rolandMaxFeed: rolandSettings.rolandMaxFeed,
                rolandZMode: rolandSettings.rolandZMode,
                rolandSpindleMode: rolandSettings.rolandSpindleMode,
            };

            // Generate G-code from the final, complete list of plans
            const gcode = this.gcodeGenerator.generate(allMachineReadyPlans, genOptions);

            // Calculate metrics
            this.debug('Calculating metrics...');
            // Pass context to metrics to get machine settings
            const { estimatedTime, totalDistance } = this.machineProcessor.calculatePathMetrics(allMachineReadyPlans, firstContext);

            return {
                gcode: gcode,
                lineCount: gcode.split('\n').length,
                planCount: allMachineReadyPlans.length,
                estimatedTime: estimatedTime,
                totalDistance: totalDistance
            };
        }

        /**
         * Separates a drill operation's preview into milled paths and peck groups by diameter.
         * Works regardless of millHoles setting — a milled operation still generates pecks for holes too small to mill.
         */
        _groupDrillPrimitives(operation) {
            if (!operation.preview?.primitives) return { milledPrimitives: [], peckGroups: [] };

            const milledPrimitives = [];
            const pecksByDiameter = new Map();

            for (const prim of operation.preview.primitives) {
                if (prim.properties?.role === 'peck_mark') {
                    const dia = parseFloat(
                        (prim.properties?.originalDiameter || prim.properties?.diameter || 0).toFixed(3)
                    );
                    if (!pecksByDiameter.has(dia)) pecksByDiameter.set(dia, []);
                    pecksByDiameter.get(dia).push(prim);
                } else {
                    milledPrimitives.push(prim);
                }
            }

            const peckGroups = Array.from(pecksByDiameter.entries())
                .sort((a, b) => a[0] - b[0])
                .map(([diameter, primitives]) => ({ diameter, primitives }));

            return { milledPrimitives, peckGroups };
        }

        /**
         * Roland-specific context preprocessing.
         * Enforces machine-safe settings based on the selected Roland profile.
         * Extracted from orchestrateToolpaths to keep the main loop processor-agnostic.
         */
        _preprocessRolandContext(ctx, operation) {
            const rolandSettings = ctx.processorSettings?.roland || {};
            const rolandModel = rolandSettings.rolandModel;

            // Get profile from the Roland processor itself (single source of truth)
            const rolandProcessor = this.gcodeGenerator.getProcessor('roland');
            const rolandProfile = rolandProcessor?.getProfile
                ? rolandProcessor.getProfile(rolandModel)
                : null;

            const rolandZMode = rolandSettings.rolandZMode || rolandProfile?.zMode || '3d';

            // 2.5D (PU/PD) mode: Z is always binary — no simultaneous XYZ motion.
            // Helix entry, ramp entry and mid-path tab lifts are all physically impossible.
            // 3D (Z x,y,z;) mode: full simultaneous XYZ. Arcs are linearized by the generator (supportsArcCommands: false), producing short LINEAR segments with interpolated Z — helix, ramp and tabs all work through linearization.
            if (rolandZMode === '2.5d') {
                ctx.strategy.entryType = 'plunge';

                if (operation.type === 'cutout') {
                    ctx.strategy.cutout.tabs = 0;
                }

                if (operation.type === 'drill' && ctx.strategy.drill.millHoles) {
                    if (!ctx.strategy.multiDepth) {
                        ctx.strategy.multiDepth = true;
                    }
                    const maxSafeStep = ctx.tool.diameter * 0.5;
                    if (Math.abs(ctx.strategy.depthPerPass) > maxSafeStep) {
                        ctx.strategy.depthPerPass = maxSafeStep;
                    }
                }
            }

            // Profile-based feed rate guardrails (all Z modes)
            if (rolandProfile) {
                const maxCutFeedMmMin = rolandProfile.maxFeedXY * 60;
                const maxPlungeFeedMmMin = rolandProfile.maxFeedZ * 60;

                if (ctx.cutting.feedRate > maxCutFeedMmMin) {
                    this.debug(`Clamping feed rate ${ctx.cutting.feedRate} -> ${maxCutFeedMmMin} (${rolandProfile.label} limit)`);
                    ctx.cutting.feedRate = maxCutFeedMmMin;
                }
                if (ctx.cutting.plungeRate > maxPlungeFeedMmMin) {
                    this.debug(`Clamping plunge rate ${ctx.cutting.plungeRate} -> ${maxPlungeFeedMmMin} (${rolandProfile.label} limit)`);
                    ctx.cutting.plungeRate = maxPlungeFeedMmMin;
                }
            }
        }

        /**
         * Orchestrates laser export for the given operations.
         * Preserves the pass hierarchy so the exporter can assign distinct colors per hatch angle and apply correct stroke/fill per strategy.
         */
        async orchestrateLaserExport(operations, exportOptions = {}) {
            this.debug(`Orchestrating laser export for ${operations.length} operation(s)`);

            if (!operations || operations.length === 0) {
                this.ui?.updateStatus('No operations to export', 'warning');
                return { success: false };
            }

            // REVIEW - These laser default fallbacks need more consistency.
            const spotSize = this.core.settings.laser.spotSize;
            const format = exportOptions.format || this.core.settings.laser.exportFormat;
            const dpi = exportOptions.dpi || this.core.settings.laser.exportDPI;
            const padding = exportOptions.padding ?? D.laser.exportPadding;
            const singleFile = exportOptions.singleFile !== false; // default true
            const baseName = exportOptions.baseName;

            // Build coordinate transforms
            const transforms = {
                origin: this.core.coordinateSystem?.getOriginPosition() || { x: 0, y: 0 },
                rotation: this.core.coordinateSystem?.currentRotation || 0,
                rotationCenter: this.core.coordinateSystem?.rotationCenter || null,
                mirrorX: this.core.coordinateSystem?.mirrorX || false,
                mirrorY: this.core.coordinateSystem?.mirrorY || false,
                mirrorCenter: this.core.coordinateSystem?.boardBounds ? {
                    x: this.core.coordinateSystem.boardBounds.centerX,
                    y: this.core.coordinateSystem.boardBounds.centerY
                } : { x: 0, y: 0 }
            };

            const commonOptions = {
                dpi, padding, transforms,
                bounds: this.core.coordinateSystem?.boardBounds,
                heatManagement: exportOptions.heatManagement || 'off',
                reverseCutOrder: exportOptions.reverseCutOrder || false,
                svgGrouping: exportOptions.svgGrouping || 'layer',
                colorPerPass: exportOptions.colorPerPass || false,
                palette: exportOptions.palette || null,
                paletteLumping: exportOptions.paletteLumping || false
            };

            // Build layer objects from operations
            const buildLayer = (op) => {
                if (!op.offsets || op.offsets.length === 0) return null;

                const color = exportOptions.layerColors?.[op.type] || '#000000';
                const passes = op.offsets.map((offset, idx) => ({
                    passIndex: idx + 1,
                    type: offset.type || 'offset',
                    primitives: offset.primitives || [],
                    metadata: {
                        ...(offset.metadata || {}),
                        offsetType: offset.offsetType || 'external',
                        thermalGroup: offset.metadata?.thermalGroup || offset.thermalGroup || 'shell',
                        pass: offset.pass || idx + 1,
                        distance: offset.distance
                    }
                }));

                // Build a descriptive layer name for the SVG output.
                // Stencils include the source filename so that top-paste and bottom-paste stencils get distinct Inkscape layer labels (e.g. "Stencil_paste_top" vs "Stencil_paste_bottom").
                const isStencil = op.type === 'stencil';
                let layerName = op.type;
                if (isStencil) {
                    const cleanName = op.file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
                    layerName = `Stencil_${cleanName}`;
                }

                return {
                    operationId: op.id,
                    operationType: op.type,
                    fileName: op.file.name,
                    baseColor: color,
                    layerName: layerName,
                    strokeWidth: spotSize,
                    passes
                };
            };

            // PNG split: rasterizable ops vs vector-only ops
            const isPNGFormat = format === 'png';
            const rasterTypes = ['isolation', 'clearing'];

            let layerGroups; // Array of { layers, format, filenameSuffix }

            if (isPNGFormat) {
                const rasterLayers = [];
                const vectorLayers = [];

                for (const op of operations) {
                    const layer = buildLayer(op);
                    if (!layer) continue;
                    if (rasterTypes.includes(op.type)) {
                        rasterLayers.push(layer);
                    } else {
                        vectorLayers.push(layer);
                    }
                }

                layerGroups = [];
                if (rasterLayers.length > 0) {
                    layerGroups.push({ layers: rasterLayers, format: 'png', suffix: '' });
                }
                if (vectorLayers.length > 0) {
                    layerGroups.push({ layers: vectorLayers, format: 'svg', suffix: '-vectors' });
                }
            } else if (singleFile) {
                // All operations in one SVG
                const allLayers = operations.map(buildLayer).filter(Boolean);
                if (allLayers.length > 0) {
                    layerGroups = [{ layers: allLayers, format: 'svg', suffix: '' }];
                } else {
                    layerGroups = [];
                }
            } else {
                // Multi-file: one file per operation
                layerGroups = [];
                for (const op of operations) {
                    const layer = buildLayer(op);
                    if (!layer) continue;

                    // Respect PNG format for rasterizable operations
                    const isRasterOp = isPNGFormat && rasterTypes.includes(op.type);

                    layerGroups.push({
                        layers: [layer],
                        format: isRasterOp ? 'png' : 'svg',
                        suffix: `-${op.type}`
                    });
                }
            }

            if (layerGroups.length === 0) {
                this.ui?.updateStatus('No geometry to export', 'warning');
                return { success: false };
            }

            if (typeof LaserImageExporter === 'undefined') {
                this.ui?.updateStatus('Laser image exporter module not loaded', 'error');
                return { success: false };
            }

            const exporter = new LaserImageExporter();
            const files = [];

            try {
                for (const group of layerGroups) {
                    const ext = group.format === 'png' ? '.png' : '.svg';
                    const filename = `${baseName}${group.suffix}${ext}`;

                    const result = await exporter.generate(group.layers, {
                        ...commonOptions,
                        format: group.format
                    });

                    if (result && result.blob) {
                        files.push({ blob: result.blob, filename });
                    }
                }

                if (files.length > 0) {
                    return { success: true, files };
                }
            } catch (error) {
                console.error('[Controller] Laser export failed:', error);
                this.ui?.updateStatus('Laser export failed: ' + error.message, 'error');
            }

            return { success: false, files: [] };
        }

        // API for external access
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

    // Initialize application
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
            this.debug(`Arc Reconstructor Registry (${registry.length} curves):`);
            console.table(registry);
        }
        return registry;
    };
})();