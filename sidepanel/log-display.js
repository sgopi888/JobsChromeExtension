// Log Display Manager
// Handles comprehensive log display in sidepanel
console.log('Log Display Manager loaded');

class LogDisplayManager {
    constructor() {
        this.logContainer = document.getElementById('logMessages');
        this.detailedLogsContainer = null;
        this.init();
    }

    /**
     * Initialize the log display
     */
    init() {
        // Create detailed logs section if it doesn't exist
        if (!document.getElementById('detailedLogs')) {
            this.createDetailedLogsSection();
        } else {
            this.detailedLogsContainer = document.getElementById('detailedLogsContent');
        }

        // Listen for log messages
        this.setupMessageListener();

        console.log('[LogDisplay] Initialized');
    }

    /**
     * Create detailed logs section
     */
    createDetailedLogsSection() {
        const section = document.createElement('div');
        section.id = 'detailedLogs';
        section.className = 'detailed-logs-section';
        section.innerHTML = `
            <h3>Detailed Execution Logs</h3>
            <button id="clearDetailedLogs" class="btn btn-small">Clear Detailed Logs</button>
            <div id="detailedLogsContent" class="detailed-logs-content"></div>
        `;

        // Insert after regular logs
        if (this.logContainer && this.logContainer.parentElement) {
            this.logContainer.parentElement.appendChild(section);
        }

        this.detailedLogsContainer = document.getElementById('detailedLogsContent');

        // Add clear button listener
        const clearBtn = document.getElementById('clearDetailedLogs');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearDetailedLogs());
        }
    }

    /**
     * Setup message listener
     */
    setupMessageListener() {
        chrome.runtime.onMessage.addListener((message) => {
            if (message.action === 'displayLog') {
                this.displayLog(message.data);
            }
        });
    }

    /**
     * Display log entry
     */
    displayLog(logEntry) {
        if (logEntry.type === 'detailed') {
            this.displayDetailedLog(logEntry);
        } else {
            this.displayRegularLog(logEntry);
        }
    }

    /**
     * Display regular log
     */
    displayRegularLog(logEntry) {
        if (!this.logContainer) return;

        const div = document.createElement('div');
        div.className = `log-entry ${logEntry.level}`;

        const time = new Date(logEntry.timestamp).toLocaleTimeString();
        const levelBadge = this.getLevelBadge(logEntry.level);

        div.innerHTML = `
            <span class="log-time">[${time}]</span>
            <span class="log-level ${logEntry.level}">${levelBadge}</span>
            <span class="log-message">${this.escapeHtml(logEntry.message)}</span>
        `;

        this.logContainer.appendChild(div);
        this.logContainer.scrollTop = this.logContainer.scrollHeight;

        // Keep only last 500 regular logs
        const entries = this.logContainer.querySelectorAll('.log-entry');
        if (entries.length > 500) {
            entries[0].remove();
        }
    }

    /**
     * Display detailed log (full JSON)
     */
    displayDetailedLog(logEntry) {
        if (!this.detailedLogsContainer) return;

        const div = document.createElement('div');
        div.className = 'detailed-log-entry';

        const time = new Date(logEntry.timestamp).toLocaleTimeString();

        div.innerHTML = `
            <div class="detailed-log-header">
                <span class="time">[${time}]</span>
                <span class="title">Detailed Log</span>
            </div>
            <pre class="detailed-log-content">${this.escapeHtml(logEntry.message)}</pre>
        `;

        this.detailedLogsContainer.appendChild(div);
        this.detailedLogsContainer.scrollTop = this.detailedLogsContainer.scrollHeight;

        // Keep only last 50 detailed logs
        const entries = this.detailedLogsContainer.querySelectorAll('.detailed-log-entry');
        if (entries.length > 50) {
            entries[0].remove();
        }
    }

    /**
     * Get level badge
     */
    getLevelBadge(level) {
        const badges = {
            'info': 'ℹ️',
            'warn': '⚠️',
            'error': '❌',
            'debug': '🐛'
        };
        return badges[level] || '📝';
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Clear all logs
     */
    clearLogs() {
        if (this.logContainer) {
            this.logContainer.innerHTML = '';
        }
        console.log('[LogDisplay] Regular logs cleared');
    }

    /**
     * Clear detailed logs
     */
    clearDetailedLogs() {
        if (this.detailedLogsContainer) {
            this.detailedLogsContainer.innerHTML = '';
        }
        console.log('[LogDisplay] Detailed logs cleared');
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.LogDisplayManager = new LogDisplayManager();
    });
} else {
    window.LogDisplayManager = new LogDisplayManager();
}

console.log('[LogDisplay] Module loaded');
