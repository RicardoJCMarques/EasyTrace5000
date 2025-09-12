// ui/ui-modal.js
// Modal management and page navigation

(function() {
    'use strict';
    
    const config = window.PCBCAMConfig || {};
    const modalConfig = config.ui?.modal || {};
    const debugConfig = config.debug || {};
    
    class ModalManager {
        constructor() {
            this.currentPage = modalConfig.defaultPage || 1;
            this.totalPages = modalConfig.totalPages || 3;
            this.isOpen = false;
            this.modal = null;
            
            this.callbacks = {
                onOpen: null,
                onClose: null,
                onPageChange: null
            };
        }
        
        init() {
            this.modal = document.getElementById('preview-modal');
            if (!this.modal) {
                console.warn('Preview modal element not found');
                return false;
            }
            
            this.setupEventListeners();
            return true;
        }
        
        setupEventListeners() {
            // Close button
            const closeBtn = document.getElementById('modal-close-btn');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.close());
            }
            
            // Navigation buttons
            const backBtn = document.getElementById('modal-back-btn');
            const nextBtn = document.getElementById('modal-next-btn');
            
            if (backBtn) {
                backBtn.addEventListener('click', () => this.handleBackButton());
            }
            
            if (nextBtn) {
                nextBtn.addEventListener('click', () => this.navigateNext());
            }
        }
        
        open() {
            if (!this.modal) return false;
            
            document.body.style.overflow = 'hidden';
            this.modal.classList.add('active');
            this.isOpen = true;
            
            this.currentPage = modalConfig.defaultPage || 1;
            this.updatePage();
            
            if (this.callbacks.onOpen) {
                this.callbacks.onOpen();
            }
            
            if (debugConfig.enabled) {
                console.log('Modal opened');
            }
            
            return true;
        }
        
        close() {
            if (!this.modal) return;
            
            this.modal.classList.remove('active');
            document.body.style.overflow = '';
            this.isOpen = false;
            
            if (this.callbacks.onClose) {
                this.callbacks.onClose();
            }
            
            if (debugConfig.enabled) {
                console.log('Modal closed');
            }
        }
        
        navigateNext() {
            if (this.currentPage < this.totalPages) {
                this.navigateTo(this.currentPage + 1);
            }
        }
        
        navigatePrevious() {
            if (this.currentPage > 1) {
                this.navigateTo(this.currentPage - 1);
            }
        }
        
        navigateTo(page) {
            if (page < 1 || page > this.totalPages) return;
            
            const oldPage = this.currentPage;
            this.currentPage = page;
            this.updatePage();
            
            if (this.callbacks.onPageChange) {
                this.callbacks.onPageChange(this.currentPage, oldPage);
            }
        }
        
        handleBackButton() {
            if (this.currentPage === 1) {
                this.close();
            } else {
                this.navigatePrevious();
            }
        }
        
        updatePage() {
            // Update title
            const modalTitle = document.getElementById('modal-title');
            const pageIndicator = document.getElementById('page-indicator');
            const backBtn = document.getElementById('modal-back-btn');
            const nextBtn = document.getElementById('modal-next-btn');
            
            // Hide all pages
            for (let i = 1; i <= this.totalPages; i++) {
                const page = document.getElementById(`modal-page-${i}`);
                if (page) {
                    page.style.display = 'none';
                }
            }
            
            // Show current page
            const currentPageEl = document.getElementById(`modal-page-${this.currentPage}`);
            if (currentPageEl) {
                currentPageEl.style.display = 'block';
            }
            
            // Update title
            const titles = modalConfig.titles || [
                '🔍 PCB Preview & Fusion Setup',
                '⚙️ Offset Geometry Configuration', 
                '🛠️ Toolpath Generation'
            ];
            
            if (modalTitle) {
                modalTitle.textContent = titles[this.currentPage - 1] || titles[0];
            }
            
            // Update page indicator
            if (pageIndicator) {
                pageIndicator.textContent = `Page ${this.currentPage} of ${this.totalPages}`;
            }
            
            // Update buttons
            if (backBtn) {
                backBtn.textContent = this.currentPage === 1 ? '← Back to Main' : '← Previous';
            }
            
            if (nextBtn) {
                if (this.currentPage < this.totalPages) {
                    nextBtn.style.display = 'block';
                    nextBtn.textContent = 'Next →';
                } else {
                    nextBtn.style.display = 'none';
                }
            }
        }
        
        setCallbacks(callbacks) {
            Object.assign(this.callbacks, callbacks);
        }
        
        getCurrentPage() {
            return this.currentPage;
        }
        
        isModalOpen() {
            return this.isOpen;
        }
    }
    
    // Export
    window.ModalManager = ModalManager;
    
})();