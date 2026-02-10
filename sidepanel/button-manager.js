// Button Manager - Handles separate Fill Text and Fill Menus workflows
console.log('Button Manager loaded');

class ButtonManager {
    constructor() {
        this.textBtn = null;
        this.menusBtn = null;
        this.originalBtn = null;
        this.init();
    }

    init() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupButtons());
        } else {
            this.setupButtons();
        }
    }

    setupButtons() {
        // Find original "Start Filling" button
        this.originalBtn = document.getElementById('fillBtn');
        if (!this.originalBtn) {
            console.warn('[ButtonManager] Original fillBtn not found');
            return;
        }

        // Hide original button (keep it for backward compatibility)
        this.originalBtn.style.display = 'none';

        // Create container for new buttons
        const container = document.createElement('div');
        container.className = 'split-fill-buttons';
        container.innerHTML = `
            <button id="fillTextBtn" class="btn btn-primary" disabled>
                📝 Fill Text Fields
            </button>
            <button id="fillMenusBtn" class="btn btn-secondary" disabled>
                ☑️ Fill Menus
            </button>
        `;

        // Insert before original button
        this.originalBtn.parentElement.insertBefore(container, this.originalBtn);

        // Get references to new buttons
        this.textBtn = document.getElementById('fillTextBtn');
        this.menusBtn = document.getElementById('fillMenusBtn');

        // Add event listeners
        if (this.textBtn) {
            this.textBtn.addEventListener('click', () => this.handleFillText());
        }
        if (this.menusBtn) {
            this.menusBtn.addEventListener('click', () => this.handleFillMenus());
        }

        console.log('[ButtonManager] Split buttons initialized');
    }

    async handleFillText() {
        console.log('[ButtonManager] Fill Text Fields clicked');

        try {
            // Get session data
            const { session } = await chrome.storage.local.get('session');
            if (!session || !session.fillPlan) {
                this.showMessage('No fill plan available. Scan page and ask LLM first.', 'error');
                return;
            }

            // Filter only text/email/tel/textarea fields (type action)
            const textPlan = session.fillPlan.filter(item =>
                item.action === 'type'
            );

            if (textPlan.length === 0) {
                this.showMessage('No text fields to fill in the plan.', 'warn');
                return;
            }

            this.showMessage(`Starting text field filling (${textPlan.length} fields)...`);
            await this.executeFillPlan(textPlan);
        } catch (error) {
            console.error('[ButtonManager] Error filling text fields:', error);
            this.showMessage(`Error: ${error.message}`, 'error');
        }
    }

    async handleFillMenus() {
        console.log('[ButtonManager] Fill Menus clicked');

        try {
            // Get session data
            const { session } = await chrome.storage.local.get('session');
            if (!session || !session.fillPlan) {
                this.showMessage('No fill plan available. Scan page and ask LLM first.', 'error');
                return;
            }

            // Filter only select/check/radio fields
            const menuPlan = session.fillPlan.filter(item =>
                item.action === 'select' || item.action === 'check'
            );

            if (menuPlan.length === 0) {
                this.showMessage('No menu fields to fill in the plan.', 'warn');
                return;
            }

            this.showMessage(`Starting menu filling (${menuPlan.length} fields)...`);
            await this.executeFillPlan(menuPlan);
        } catch (error) {
            console.error('[ButtonManager] Error filling menus:', error);
            this.showMessage(`Error: ${error.message}`, 'error');
        }
    }

    async executeFillPlan(fillPlan) {
        try {
            // Disable buttons during execution
            this.disableButtons();
            this.updateStatus('Filling...');

            // Get current tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) {
                throw new Error('No active tab found');
            }

            // Get fields from session or auto-scan if missing
            const { session } = await chrome.storage.local.get('session');
            let fields = Array.isArray(session?.fields) ? session.fields : [];
            if (!fields.length) {
                this.showMessage('No cached fields. Auto-scanning page...', 'info');
                const scanResponse = await chrome.tabs.sendMessage(tab.id, { action: 'scanPage' });
                if (!scanResponse || !scanResponse.success) {
                    throw new Error('Scan failed, cannot fill without metadata.');
                }
                fields = Array.isArray(scanResponse.fields) ? scanResponse.fields : [];
                if (!fields.length) {
                    this.showMessage('Scan returned 0 fields. Aborting fill.', 'warn');
                    this.updateStatus('Error');
                    return;
                }
            }

            // Send message to content script
            const response = await chrome.tabs.sendMessage(tab.id, {
                action: 'startFilling',
                data: {
                    fillPlan,
                    fields
                }
            });

            if (response && response.success) {
                this.showMessage('✓ Filling complete!', 'success');
                this.updateStatus('Complete');
            } else {
                this.showMessage('Filling encountered errors. Check logs.', 'warn');
                this.updateStatus('Error');
            }
        } catch (error) {
            console.error('[ButtonManager] Execution error:', error);
            this.showMessage(`Execution error: ${error.message}`, 'error');
            this.updateStatus('Error');
        } finally {
            // Re-enable buttons
            this.enableButtons();
        }
    }

    enableButtons() {
        if (this.textBtn) this.textBtn.disabled = false;
        if (this.menusBtn) this.menusBtn.disabled = false;
        console.log('[ButtonManager] Buttons enabled');
    }

    disableButtons() {
        if (this.textBtn) this.textBtn.disabled = true;
        if (this.menusBtn) this.menusBtn.disabled = true;
        console.log('[ButtonManager] Buttons disabled');
    }

    showMessage(text, type = 'info') {
        // Use existing addSystemMessage if available
        if (typeof addSystemMessage === 'function') {
            addSystemMessage(text, type);
        } else {
            console.log(`[ButtonManager] ${type.toUpperCase()}: ${text}`);
        }
    }

    updateStatus(status) {
        // Use existing updateStatus if available
        if (typeof updateStatus === 'function') {
            updateStatus(status);
        } else {
            console.log(`[ButtonManager] Status: ${status}`);
        }
    }
}

// Initialize when DOM is ready
let buttonManager = null;
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        buttonManager = new ButtonManager();
        window.ButtonManager = buttonManager;
    });
} else {
    buttonManager = new ButtonManager();
    window.ButtonManager = buttonManager;
}

console.log('[ButtonManager] Module loaded');
