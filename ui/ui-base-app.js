/*!
 * @file        ui/ui-base-app.js
 * @description Shared base UI core class for EasyTrace5000 and EasyShape5000.
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 *
 * SPDX-FileCopyrightText: 2025-2026 Eltryus - Ricardo Marques
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

(function() {
    'use strict';

    class BaseAppUI {
        constructor(ctrl) {
            this.ctrl = ctrl;
            this.core = ctrl.core;
            this.lang = null;

            this.renderer = null;
            this.input = null;
            this.toolController = null;
            this.canvasReadout = null;

            this.statusManager = null;
            this.controls = null;
            this.machineSettings = null;

            // Cached DOM refs (avoid repeated getElementById)
            this._dom = {};
        }

        // Shared init sequence

        async initShared() {
            this.initRenderer();
            this.initViewportInteraction();
            this.initStatusManager();
            this.initControls();
            this.initMachineSettings();
            this.initFocusZones();
            this.initResize();
            this.initializeTheme();
            this.initStaticTooltips();
        }

        // Renderer

        initRenderer() {
            const canvasId = 'preview-canvas';
            if (typeof LayerRenderer === 'undefined') return;

            this.renderer = new LayerRenderer(canvasId, this.core);

            const theme = document.documentElement.getAttribute('data-theme') || 'dark';
            const opts = this.getDefaultRendererOptions(theme);
            this.renderer.setOptions(opts);

            this.renderer.onRenderOverlay = (ctx, core) => this.renderOverlay(ctx, core);

            if (window.ResizeObserver) {
                const parent = this.renderer.canvas.parentElement;
                if (parent) {
                    new ResizeObserver(() => {
                        this.renderer.core.resizeCanvas();
                        this.renderer.render();
                    }).observe(parent);
                }
            }

            this.renderer.render();
        }

        /**
         * Subclasses override to supply app-specific renderer options.
         * Base provides the universal defaults.
         */
        getDefaultRendererOptions(theme) {
            return {
                showGrid: true,
                showOrigin: true,
                showRulers: true,
                showBounds: false,
                showOffsets: true,
                showPreviews: true,
                theme,
                primitiveFilter: (prim, layerType) => this.shouldRenderPrimitive(prim, layerType),
                resolveLayerColor: (layer) => this.resolveLayerColor(layer)
            };
        }

        /** Subclasses override */
        shouldRenderPrimitive(primitive, layerType) { return true; }
        renderOverlay(ctx, core) {}

        // Viewport interaction

        initViewportInteraction() {
            const canvas = document.getElementById('preview-canvas');
            if (!canvas || !this.renderer) return;

            if (typeof CanvasReadout !== 'undefined') {
                this.canvasReadout = new CanvasReadout(this.renderer.core);
            }

            if (typeof InputManager === 'undefined' || typeof ToolController === 'undefined') return;

            this.input = new InputManager(canvas, { readout: this.canvasReadout });

            const toolContext = this.buildToolContext(canvas);
            this.toolController = new ToolController(toolContext);
            this.toolController.setInputManager(this.input);
            this.toolController.setDefaultTool(this.createDefaultTool());
            this.input.attach(this.toolController);

            canvas.blur();
            document.body.focus();
        }

        /**
         * Subclasses override to provide app-specific tool context.
         * EasyTrace returns a simple pan/zoom context.
         * EasyShape returns a context with scene/selection awareness.
         */
        buildToolContext(canvas) {
            return {
                renderer: this.renderer,
                canvas,
                canvasReadout: this.canvasReadout,
                requestRender: () => this.renderer?.render()
            };
        }

        createDefaultTool() {
            if (typeof PanZoomTool !== 'undefined') {
                return new PanZoomTool({ allowedButtons: [0, 1, 2] });
            }
            return null;
        }

        // Status, Controls, Machine, Focus, Theme, Resize

        initStatusManager() {
            if (typeof StatusManager !== 'undefined') {
                this.statusManager = new StatusManager(this);
            }
        }

        initControls() {
            if (typeof UIControls !== 'undefined') {
                this.controls = new UIControls(this);
                this.controls.init(this.renderer);
            }
        }

        initMachineSettings() {
            if (typeof MachineSettingsUI !== 'undefined') {
                this.machineSettings = new MachineSettingsUI(this);
                this.machineSettings.setup();
            }
        }

        // REVIEW - This name is outdated? Rename to something more descriptive?
        initFocusZones() {
            UIControls.setupCollapsibles(document);
            UIControls.setupArrowSidebarNav('#sidebar-right');
        }

        initResize() {
            window.addEventListener('resize', () => {
                if (!this.renderer?.core) return;
                this.renderer.core.resizeCanvas();
                this.renderer.render();
            });
        }

        initializeTheme() {
            const theme = this.ctrl.initializeTheme();
            if (this.renderer) this.renderer.setOptions({ theme });
        }

        // Static Tooltip Scanner

        initStaticTooltips() {
            if (!this.lang || !window.TooltipManager) return;
            const processed = new Set();

            document.querySelectorAll('[data-i18n-tooltip]').forEach(el => {
                if (processed.has(el)) return;
                processed.add(el);

                const tooltipKey = el.dataset.i18nTooltip;
                const text = this.lang.get(tooltipKey);
                if (!text) return;

                // Derive a title from the sibling parameter key or fall back to element text
                const titleKey = tooltipKey.replace('tooltips.', 'parameters.');
                const title = this.lang.get(titleKey, el.textContent?.trim() || '');

                window.TooltipManager.attachWithIcon(el, { title, text }, { showOnFocus: true });
            });
        }

        // Status

        setStatus(message, type, skipLog = false) {
            if (this.statusManager) {
                this.statusManager.updateStatus(message, type || 'normal', skipLog);
            } else {
                console.warn('[UI] StatusManager not available:', message);
            }
        }

        // Zoom helpers

        zoomFit()  { this.renderer?.core?.zoomFit(true); this.renderer?.render(); this.canvasReadout?.updateZoom(); }
        zoomIn()   { this.renderer?.core?.zoomIn(); this.renderer?.render(); this.canvasReadout?.updateZoom(); }
        zoomOut()  { this.renderer?.core?.zoomOut(); this.renderer?.render(); this.canvasReadout?.updateZoom(); }

        // Canvas Spinner

        showCanvasSpinner(message) { UIControls.showCanvasSpinner(message); }
        hideCanvasSpinner() { UIControls.hideCanvasSpinner(); }

        // Layer color/z-index resolution

        /**
         * Reads a CSS variable with fallback. Currently calls getComputedStyle
         * per invocation. This is fine — resolveLayerColor runs per rebuildLayers
         * (structural changes), not per paint frame. When the theme system is
         * reworked, consider batch-reading operation colors into a cache on theme
         * change, matching RendererCore.updateThemeColors().
         */
        readCSSVar(varName, fallback) {
            const rootStyle = getComputedStyle(document.documentElement);
            return rootStyle.getPropertyValue(varName).trim() || fallback;
        }

        resolveLayerColor(layer) {
            const isBW = this.renderer?.options?.blackAndWhite;
            if (isBW) return this.readCSSVar('--color-bw-white', '#ffffff');

            switch (layer.type) {
                case 'offset':
                    if (layer.offsetType === 'external') return this.readCSSVar('--color-geometry-offset-external', '#a60000');
                    if (layer.offsetType === 'internal') return this.readCSSVar('--color-geometry-offset-internal', '#00a600');
                    if (layer.offsetType === 'on') return this.readCSSVar('--color-geometry-offset-on', '#bcbc02');
                    return '#FF0000';
                case 'preview':
                    return this.readCSSVar('--color-geometry-preview', '#0060dd');
                case 'unassigned':
                    return layer.color || this.readCSSVar('--color-text-secondary', '#a0a0a0');
            }
            return null; // signal subclass to handle
        }

        // REVIEW - Shouldn't this be handled by the renderer modules?
        getLayerZIndex(type, opts = {}) {
            if (opts.operationType === 'stencil' || type === 'stencil') return 250;
            if (opts.isStock || type === 'stock') return 0;
            const isDrill = opts.operationType === 'drill' || type === 'drill';
            switch (type) {
                case 'drill':      return 300;
                case 'fused':      return 400;
                case 'offset':
                    if (opts.isHatch || opts.strategy === 'filled') return 500;
                    return isDrill ? 650 : 600;
                case 'preview':    return isDrill ? 850 : 800;
            }
            return null; // signal subclass to handle
        }

        // Debug

        // REVIEW - debug states need to be centralized
        debug(message, data = null) {
            if (!window.CAMConfig.defaults.debug.enabled) return;
            data ? console.log(`[${this.constructor.name}] ${message}`, data)
                 : console.log(`[${this.constructor.name}] ${message}`);
            if (this.statusManager?.debugLog) {
                let statusMsg = message;
                if (data) {
                    try { statusMsg += ` ${JSON.stringify(data)}`; }
                    catch { statusMsg += ' [Object]'; }
                }
                this.statusManager.debugLog(statusMsg);
            }
        }
    }

    window.BaseAppUI = BaseAppUI;
})();