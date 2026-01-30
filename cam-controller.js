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

    const config = window.PCBCAMConfig;
    const debugConfig = config.debug;
    const textConfig = config.ui.text;
    const timingConfig = config.ui.timing;
    const storageKeys = config.storageKeys;
    const opsConfig = config.operations;

    // PCB Example definitions
    const PCB_EXAMPLES = {
        'exampleSMD1': {
            name: 'Example 1 - SMD',
            files: {
                isolation: 'examples/exampleSMD1/isolation.gbr',
                drill: 'examples/exampleSMD1/drill.drl',
                clearing: 'examples/exampleSMD1/clearing.gbr',
                cutout: 'examples/exampleSMD1/cutout.gbr'
            }
        },
        'exampleThroughHole1': {
            name: 'Example 2 - Through-Hole',
            files: {
                isolation: 'examples/exampleThroughHole1/Gerber_BottomLayer.gbl',
                drill: 'examples/exampleThroughHole1/Excellon_PTH_Through.drl',
                cutout: 'examples/exampleThroughHole1/Gerber_BoardOutlineLayer.gko'
            }
        },
        'line': {
            name: 'Line Test',
            files: {
                isolation: 'examples/LineTest.svg'
            }
        },
        'calibration': {
            name: '100mm Step/mm Square',
            files: {
                cutout: 'examples/100mmSquare.svg'
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
                cutout: null
            };

            // Queued files for processing
            this.queuedFiles = [];
        }

        async initialize() {
            console.log('EasyTrace5000 Workspace initializing...');

            try {
                // Initialize core with skip init flag to control WASM loading
                this.core = new PCBCamCore({ skipInit: true });

                // Initialize managers before UI
                this.parameterManager = new ParameterManager();
                this.languageManager = new LanguageManager();

                // Load the language file beforethe UI
                await this.languageManager.load();

                // Instantiate pipeline components *after* core exists
                this.gcodeGenerator = new GCodeGenerator(config.gcode);
                this.gcodeGenerator.setCore(this.core);
                this.geometryTranslator = new GeometryTranslator(this.core);
                this.toolpathOptimizer = new ToolpathOptimizer();
                this.machineProcessor = new MachineProcessor(this.core);                

                // Initialize UI with core and language manager
                this.ui = new PCBCamUI(this.core, this.languageManager)

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

                // Setup global event handlers
                this.setupGlobalHandlers();

                // Setup toolbar handlers
                this.setupToolbarHandlers();

                // Expose controller globally for PropertyInspector
                window.pcbcam = this;
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
                    const readyOps = this.core.operations.filter(op => op.preview);
                    if (readyOps.length === 0) {
                        this.ui?.updateStatus('No operations ready. Generate previews first.', 'warning');
                        return;
                    }
                    this.modalManager.showToolpathModal(readyOps);
                    quickActionsBtn.classList.remove('active');
                    quickActionsMenu.classList.remove('show');
                });
            }

            const exportSvgBtn = document.getElementById('toolbar-export-svg');
            if (exportSvgBtn) {
                exportSvgBtn.addEventListener('click', async () => {
                    if (!this.ui?.svgExporter) {
                        this.ui?.updateStatus('SVG exporter not available', 'error');
                        return;
                    }

                    try {
                        this.ui.svgExporter.exportSVG();
                        this.ui?.updateStatus('SVG exported successfully', 'success');
                    } catch (error) {
                        console.error('SVG export error:', error);
                        this.ui?.updateStatus('SVG export failed: ' + error.message, 'error');
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
                // Select source files?
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
                cutout: null
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
            if (!exampleId) {
                // If no ID provided, try to get from welcome modal select // Review - is this a Fallback?
                const select = document.getElementById('pcb-example-select');
                exampleId = select ? select.value : 'xiao';
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

                        if (operation.parsed?.hasArcs && debugConfig.enabled) {
                            console.log(`Preserved ${operation.originalArcs?.length || 0} arcs for potential reconstruction`);
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
                        const fileNode = Array.from(this.ui.navTreePanel.nodes.values())
                            .find(n => n.operation?.id === operation.id);
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
            const operations = config.operations;
            for (let [type, op] of Object.entries(operations)) {
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

            // Create pairs instead of mutating operations
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

                    // Pass as a pair
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

            const genOptions = {
                postProcessor: options.postProcessor,
                includeComments: options.includeComments,
                singleFile: options.singleFile,
                toolChanges: options.toolChanges,
                startCode: gcodeConfig.startCode,
                endCode: gcodeConfig.endCode,
                units: gcodeConfig.units,
                safeZ: machineConfig.safeZ,
                travelZ: machineConfig.travelZ,
                coolant: machineConfig.coolant,
                vacuum: machineConfig.vacuum
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

        async exportSVG() {
            if (this.ui?.exportSVG) {
                await this.ui.exportSVG();
                return;
            }

            if (!this.ui?.svgExporter || !this.ui?.renderer) {
                this.ui?.updateStatus('SVG export not available', 'error');
                return;
            }

            try {
                const svgString = this.ui.svgExporter.exportSVG({
                    precision: 2,
                    padding: 5,
                    optimizePaths: true,
                    includeMetadata: true,
                    includeArcReconstructionStats: this.ui.fusionStats?.arcReconstructionEnabled
                });

                if (svgString) {
                    // Create download
                    const blob = new Blob([svgString], { type: 'image/svg+xml' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'pcb-export.svg';
                    a.click();
                    URL.revokeObjectURL(url);

                    this.ui.updateStatus('SVG exported successfully', 'success');
                } else {
                    this.ui.updateStatus('SVG export failed - no content to export', 'warning');
                }
            } catch (error) {
                console.error('SVG export error:', error);
                this.ui?.updateStatus('SVG export failed: ' + error.message, 'error');
            }
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
            if (debugConfig.enabled) {
                if (data !== null) {
                    console.log(`[Controller] ${message}`, data);
                } else {
                    console.log(`[Controller] ${message}`);
                }
            }
        }

        enableDebug() {
            debugConfig.enabled = true;
            console.log('Debug mode enabled');
        }

        disableDebug() {
            debugConfig.enabled = false;
            console.log('Debug mode disabled');
        }

        logState() {
            console.group('PCB CAM State');
            console.log('Initialization:', this.initState);
            console.log('Statistics:', this.getStats());
            console.log('Config:', config);
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

        // Check for required core classes // Review - add all classes
        const requiredClasses = [
            'PCBCamCore',
            'PCBCamUI',
            'LayerRenderer',
            'NavTreePanel',
            'OperationPanel',
            'ToolLibrary',
            'StatusManager',
            'UIControls'
        ];

        const missing = requiredClasses.filter(cls => typeof window[cls] === 'undefined');

        if (missing.length > 0) {
            console.error('Missing classes:', missing);

            // Update loading text
            const loadingText = document.getElementById('loading-text');
            if (loadingText) {
                loadingText.textContent = 'Loading error - missing modules';
            }

            return false;
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

    window.showCamStats = window.showPCBStats; // Alias for compatibility // Review - stats system

    window.enablePCBDebug = function() {
        debugConfig.enabled = true;
        console.log('Debug mode enabled');
    };

    window.disablePCBDebug = function() {
        debugConfig.enabled = false;
        console.log('Debug mode disabled');
    };

    // Global function for HTML compatibility
    window.addFile = function(type) {
        this.debug(`🎯 addFile('${type}') called`); // Review - emojis and icons

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