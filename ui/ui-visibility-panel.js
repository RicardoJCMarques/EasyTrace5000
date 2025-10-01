// ui/ui-visibility-panel.js
// Manages layer visibility controls in the status bar

(function() {
    'use strict';
    
    const config = window.PCBCAMConfig || {};
    const debugConfig = config.debug || {};
    
    class VisibilityPanel {
        constructor(ui) {
            this.ui = ui;
            this.renderer = null;
            
            // Track visibility states
            this.layerVisibility = {
                source: true,
                fused: true,
                toolpath: false,
                preview: false
            };
            
            // Track layer counts
            this.layerCounts = {
                source: 0,
                fused: 0,
                toolpath: 0,
                preview: 0
            };
            
            this.toggleBtn = null;
            this.menu = null;
            this.isMenuOpen = false;
            
            this.initialized = false;
        }
        
        init(renderer) {
            if (this.initialized) return;
            
            this.renderer = renderer;
            
            // Get elements
            this.toggleBtn = document.getElementById('visibility-toggle-btn');
            this.menu = document.getElementById('visibility-menu');
            
            if (!this.toggleBtn || !this.menu) {
                console.warn('Visibility panel elements not found');
                return;
            }
            
            // Setup toggle button
            this.toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMenu();
            });
            
            // Setup checkboxes
            Object.keys(this.layerVisibility).forEach(layerType => {
                const checkbox = document.getElementById(`vis-${layerType}`);
                if (checkbox) {
                    // Set initial state
                    checkbox.checked = this.layerVisibility[layerType];
                    
                    // Add change handler
                    checkbox.addEventListener('change', (e) => {
                        this.setLayerVisibility(layerType, e.target.checked);
                    });
                }
            });
            
            // Click outside to close menu
            document.addEventListener('click', (e) => {
                if (this.isMenuOpen && !this.toggleBtn.contains(e.target)) {
                    this.closeMenu();
                }
            });
            
            // Prevent menu clicks from closing
            if (this.menu) {
                this.menu.addEventListener('click', (e) => {
                    e.stopPropagation();
                });
            }
            
            // Load saved visibility states
            this.loadSavedStates();
            
            this.initialized = true;
            
            if (debugConfig.enabled) {
                console.log('VisibilityPanel initialized');
            }
        }
        
        toggleMenu() {
            if (this.isMenuOpen) {
                this.closeMenu();
            } else {
                this.openMenu();
            }
        }
        
        openMenu() {
            if (!this.toggleBtn) return;
            
            this.toggleBtn.classList.add('active');
            this.isMenuOpen = true;
            
            // Update counts before showing
            this.updateLayerCounts();
        }
        
        closeMenu() {
            if (!this.toggleBtn) return;
            
            this.toggleBtn.classList.remove('active');
            this.isMenuOpen = false;
        }
        
        setLayerVisibility(layerType, visible) {
            this.layerVisibility[layerType] = visible;
            
            if (this.renderer) {
                // Apply visibility to all layers of this type
                this.applyVisibilityToLayers(layerType, visible);
            }
            
            // Save state
            this.saveStates();
            
            // Update UI
            this.updateToggleButton();
            
            if (debugConfig.enabled) {
                console.log(`Layer visibility changed: ${layerType} = ${visible}`);
            }
        }
        
        applyVisibilityToLayers(layerType, visible) {
            if (!this.renderer || !this.renderer.layers) return;
            
            const prefixMap = {
                'source': 'source_',
                'fused': 'fused_',
                'toolpath': 'toolpath_',
                'preview': 'preview_'
            };
            
            const prefix = prefixMap[layerType];
            if (!prefix) return;
            
            let count = 0;
            this.renderer.layers.forEach((layer, name) => {
                if (name.startsWith(prefix)) {
                    layer.visible = visible;
                    count++;
                }
            });
            
            // Update count for this type
            this.layerCounts[layerType] = count;
            
            // Trigger render
            this.renderer.render();
            
            return count;
        }
        
        updateLayerCounts() {
            if (!this.renderer || !this.renderer.layers) return;
            
            // Reset counts
            Object.keys(this.layerCounts).forEach(type => {
                this.layerCounts[type] = 0;
            });
            
            // Count layers by type
            this.renderer.layers.forEach((layer, name) => {
                if (name.startsWith('source_')) {
                    this.layerCounts.source++;
                } else if (name.startsWith('fused_')) {
                    this.layerCounts.fused++;
                } else if (name.startsWith('toolpath_')) {
                    this.layerCounts.toolpath++;
                } else if (name.startsWith('preview_')) {
                    this.layerCounts.preview++;
                }
            });
            
            // Update menu labels with counts
            Object.keys(this.layerCounts).forEach(type => {
                const label = this.menu?.querySelector(`#vis-${type}`)?.parentElement;
                if (label) {
                    const text = label.textContent.split('(')[0].trim();
                    const count = this.layerCounts[type];
                    label.lastChild.textContent = count > 0 ? ` ${text} (${count})` : ` ${text}`;
                }
            });
        }
        
        updateToggleButton() {
            if (!this.toggleBtn) return;
            
            // Change button appearance based on visibility states
            const anyVisible = Object.values(this.layerVisibility).some(v => v);
            const allVisible = Object.values(this.layerVisibility).every(v => v);
            
            if (!anyVisible) {
                this.toggleBtn.classList.add('all-hidden');
                this.toggleBtn.classList.remove('some-visible');
            } else if (!allVisible) {
                this.toggleBtn.classList.add('some-visible');
                this.toggleBtn.classList.remove('all-hidden');
            } else {
                this.toggleBtn.classList.remove('all-hidden', 'some-visible');
            }
        }
        
        showAll() {
            Object.keys(this.layerVisibility).forEach(type => {
                this.layerVisibility[type] = true;
                const checkbox = document.getElementById(`vis-${type}`);
                if (checkbox) checkbox.checked = true;
            });
            
            this.applyAllVisibility();
            this.saveStates();
        }
        
        hideAll() {
            Object.keys(this.layerVisibility).forEach(type => {
                this.layerVisibility[type] = false;
                const checkbox = document.getElementById(`vis-${type}`);
                if (checkbox) checkbox.checked = false;
            });
            
            this.applyAllVisibility();
            this.saveStates();
        }
        
        applyAllVisibility() {
            if (!this.renderer || !this.renderer.layers) return; // Add layers check

            const prefixMap = {
                'source': 'source_',
                'fused': 'fused_',
                'toolpath': 'toolpath_',
                'preview': 'preview_'
            };
            
            // First, update the visibility state of all layers without rendering
            this.renderer.layers.forEach((layer, name) => {
                for (const type in prefixMap) {
                    if (name.startsWith(prefixMap[type])) {
                        layer.visible = this.layerVisibility[type];
                        break; // Move to the next layer once type is found
                    }
                }
            });

            // Now, trigger a single render with all changes applied
            this.renderer.render();
            
            this.updateToggleButton();
        }
        
        // Persistence
        saveStates() {
            try {
                localStorage.setItem('pcbcam-visibility', JSON.stringify(this.layerVisibility));
            } catch (e) {
                console.warn('Failed to save visibility states:', e);
            }
        }
        
        loadSavedStates() {
            try {
                const saved = localStorage.getItem('pcbcam-visibility');
                if (saved) {
                    const states = JSON.parse(saved);
                    Object.assign(this.layerVisibility, states);
                    
                    // Update checkboxes
                    Object.entries(this.layerVisibility).forEach(([type, visible]) => {
                        const checkbox = document.getElementById(`vis-${type}`);
                        if (checkbox) checkbox.checked = visible;
                    });
                    
                    // Apply to renderer if available
                    if (this.renderer) {
                        this.applyAllVisibility();
                    }
                }
            } catch (e) {
                console.warn('Failed to load visibility states:', e);
            }
        }
        
        // Called when layers are added/removed
        onLayersChanged() {
            this.updateLayerCounts();
            
            // Auto-show toolpath layers when they're generated
            if (this.layerCounts.toolpath > 0 && !this.layerVisibility.toolpath) {
                const checkbox = document.getElementById('vis-toolpath');
                if (checkbox) {
                    checkbox.checked = true;
                    this.setLayerVisibility('toolpath', true);
                }
                
                // Notify user
                if (this.ui.statusManager) {
                    this.ui.statusManager.showStatus('Toolpath layers visible', 'info');
                }
            }
        }
        
        // Get current visibility state for a specific operation/file
        getOperationVisibility(operationId) {
            if (!this.renderer || !this.renderer.layers) return {};
            
            const visibility = {
                source: false,
                fused: false,
                toolpath: false,
                preview: false
            };
            
            this.renderer.layers.forEach((layer, name) => {
                if (name.includes(operationId)) {
                    if (name.startsWith('source_')) {
                        visibility.source = layer.visible;
                    } else if (name.startsWith('fused_')) {
                        visibility.fused = layer.visible;
                    } else if (name.startsWith('toolpath_')) {
                        visibility.toolpath = layer.visible;
                    } else if (name.startsWith('preview_')) {
                        visibility.preview = layer.visible;
                    }
                }
            });
            
            return visibility;
        }
        
        // Set visibility for a specific operation
        setOperationVisibility(operationId, layerType, visible) {
            if (!this.renderer || !this.renderer.layers) return;
            
            const prefixMap = {
                'source': 'source_',
                'fused': 'fused_',
                'toolpath': 'toolpath_',
                'preview': 'preview_'
            };
            
            const prefix = prefixMap[layerType];
            if (!prefix) return;
            
            this.renderer.layers.forEach((layer, name) => {
                if (name.startsWith(prefix) && name.includes(operationId)) {
                    layer.visible = visible;
                }
            });
            
            this.renderer.render();
        }
    }
    
    // Export
    window.VisibilityPanel = VisibilityPanel;
    
})();