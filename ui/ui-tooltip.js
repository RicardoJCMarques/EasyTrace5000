/**
 * @file        ui/ui-tooltip.js
 * @description Manages all UI tooltips
 * @author      Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

/*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2025 Eltryus
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
    
    class TooltipManager {
        constructor() {
            this.tooltip = null;
            this.currentTarget = null;
            this.showTimeout = null;
            this.hideTimeout = null;
            this.delayShow = 300; // ms
            this.delayHide = 150; // ms
            
            this.createTooltip();
        }
        
        createTooltip() {
            this.tooltip = document.createElement('div');
            this.tooltip.className = 'tooltip';
            this.tooltip.innerHTML = '<div class="tooltip-content"></div>';
            document.body.appendChild(this.tooltip);
        }
        
        show(target, content, options = {}) {
            clearTimeout(this.hideTimeout);
            
            if (this.showTimeout) {
                clearTimeout(this.showTimeout);
            }
            
            this.showTimeout = setTimeout(() => {
                this.currentTarget = target;
                this.renderContent(content, options);
                this.position(target, options.position);
                this.tooltip.classList.add('visible');
            }, options.immediate ? 0 : this.delayShow);
        }
        
        hide() {
            clearTimeout(this.showTimeout);
            
            this.hideTimeout = setTimeout(() => {
                this.tooltip.classList.remove('visible');
                this.currentTarget = null;
            }, this.delayHide);
        }
        
        renderContent(content, options = {}) {
            const container = this.tooltip.querySelector('.tooltip-content');
            container.innerHTML = '';
            
            if (typeof content === 'string') {
                container.textContent = content;
            } else if (content.text) {
                // Structured tooltip
                if (content.title) {
                    const title = document.createElement('div');
                    title.className = 'tooltip-title';
                    title.textContent = content.title;
                    container.appendChild(title);
                }
                
                const text = document.createElement('div');
                text.className = 'tooltip-text';
                text.textContent = content.text;
                container.appendChild(text);
                
                if (content.example) {
                    const example = document.createElement('div');
                    example.className = 'tooltip-example';
                    example.textContent = content.example;
                    container.appendChild(example);
                }
            } else if (content.html) {
                container.innerHTML = content.html;
            }
            
            // Apply max width if specified
            if (options.maxWidth) {
                this.tooltip.style.maxWidth = options.maxWidth + 'px';
            }
        }
        
        position(target, preferredPosition = 'top') {
            const rect = target.getBoundingClientRect();
            const tooltipRect = this.tooltip.getBoundingClientRect();
            
            const positions = {
                top: {
                    left: rect.left + (rect.width - tooltipRect.width) / 2,
                    top: rect.top - tooltipRect.height - 8
                },
                bottom: {
                    left: rect.left + (rect.width - tooltipRect.width) / 2,
                    top: rect.bottom + 8
                },
                left: {
                    left: rect.left - tooltipRect.width - 8,
                    top: rect.top + (rect.height - tooltipRect.height) / 2
                },
                right: {
                    left: rect.right + 8,
                    top: rect.top + (rect.height - tooltipRect.height) / 2
                }
            };
            
            // Try preferred position first
            let position = positions[preferredPosition];
            
            // Check if tooltip would go off-screen and adjust
            const padding = 8;
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            
            // Adjust horizontal position
            if (position.left < padding) {
                position.left = padding;
            } else if (position.left + tooltipRect.width > viewportWidth - padding) {
                position.left = viewportWidth - tooltipRect.width - padding;
            }
            
            // Adjust vertical position - flip if needed
            if (position.top < padding) {
                // Flip to bottom if top doesn't fit
                position = positions.bottom;
            } else if (position.top + tooltipRect.height > viewportHeight - padding) {
                // Flip to top if bottom doesn't fit
                position = positions.top;
            }
            
            this.tooltip.style.left = position.left + 'px';
            this.tooltip.style.top = position.top + 'px';
        }
        
        // Helper to attach tooltip to element
        attach(element, content, options = {}) {
            element.addEventListener('mouseenter', () => {
                this.show(element, content, options);
            });
            
            element.addEventListener('mouseleave', () => {
                this.hide();
            });
            
            // Optional: show on focus for accessibility
            if (options.showOnFocus) {
                element.addEventListener('focus', () => {
                    this.show(element, content, { immediate: true });
                });
                
                element.addEventListener('blur', () => {
                    this.hide();
                });
            }
        }
        
        // Helper to attach tooltip with icon
        attachWithIcon(element, content, options = {}) {
            const icon = document.createElement('span');
            icon.className = 'tooltip-trigger';
            icon.innerHTML = '?';
            icon.setAttribute('tabindex', '0');
            icon.setAttribute('role', 'button');
            icon.setAttribute('aria-label', 'Show help');
            
            element.appendChild(icon);
            
            this.attach(icon, content, { ...options, showOnFocus: true });
            
            return icon;
        }
    }
    
    window.TooltipManager = new TooltipManager();
    
})();