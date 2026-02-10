// Unified Logger Module
// Captures ALL logs and forwards to UI in real-time
console.log('Unified Logger loaded');

class UnifiedLogger {
    constructor() {
        this.logs = [];
        this.maxLogs = 1000;
        this.logLevel = 'debug'; // debug, info, warn, error
        this.enabled = true;

        // Intercept console.log
        this.interceptConsoleLogs();
    }

    /**
     * Intercept and capture all console.log calls
     */
    interceptConsoleLogs() {
        const originalConsoleLog = console.log;
        const originalConsoleError = console.error;
        const originalConsoleWarn = console.warn;

        const self = this;

        console.log = function(...args) {
            originalConsoleLog.apply(console, args);
            if (self.enabled) {
                self.captureLog('info', args);
            }
        };

        console.error = function(...args) {
            originalConsoleError.apply(console, args);
            if (self.enabled) {
                self.captureLog('error', args);
            }
        };

        console.warn = function(...args) {
            originalConsoleWarn.apply(console, args);
            if (self.enabled) {
                self.captureLog('warn', args);
            }
        };

        console.log('[UnifiedLogger] Console interception active');
    }

    /**
     * Capture log entry and forward to UI
     */
    captureLog(level, args) {
        try {
            const logEntry = {
                level,
                message: args.map(arg => {
                    if (typeof arg === 'object') {
                        try {
                            return JSON.stringify(arg, null, 2);
                        } catch (e) {
                            return String(arg);
                        }
                    }
                    return String(arg);
                }).join(' '),
                timestamp: new Date().toISOString(),
                location: 'content-script'
            };

            this.logs.push(logEntry);

            // Keep only last N logs
            if (this.logs.length > this.maxLogs) {
                this.logs.shift();
            }

            // Forward to sidepanel
            this.forwardToUI(logEntry);
        } catch (error) {
            // Prevent infinite loop if logging fails
        }
    }

    /**
     * Forward log to sidepanel UI
     */
    forwardToUI(logEntry) {
        try {
            chrome.runtime.sendMessage({
                action: 'logToUI',
                data: logEntry
            }).catch(err => {
                // Silently fail if sidepanel not open
            });
        } catch (error) {
            // Ignore messaging errors
        }
    }

    /**
     * Log with full detail (no truncation)
     * Special function for detailed JSON dumps
     */
    logFull(title, data) {
        try {
            const fullLog = {
                level: 'info',
                message: `\n${'='.repeat(50)}\n${title}\n${'='.repeat(50)}\n${JSON.stringify(data, null, 2)}\n${'='.repeat(50)}`,
                timestamp: new Date().toISOString(),
                location: 'content-script',
                type: 'detailed'
            };

            // Also log to console for debugging
            console.log(fullLog.message);

            this.forwardToUI(fullLog);
        } catch (error) {
            console.error('[UnifiedLogger] Error in logFull:', error);
        }
    }

    /**
     * Get all logs
     */
    getAllLogs() {
        return this.logs;
    }

    /**
     * Clear logs
     */
    clearLogs() {
        this.logs = [];
        console.log('[UnifiedLogger] Logs cleared');
    }

    /**
     * Enable/disable logging
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        console.log(`[UnifiedLogger] Logging ${enabled ? 'enabled' : 'disabled'}`);
    }
}

// Initialize global logger
window.UnifiedLogger = new UnifiedLogger();

// Export convenience functions
window.logFull = (title, data) => window.UnifiedLogger.logFull(title, data);
window.getAllLogs = () => window.UnifiedLogger.getAllLogs();
window.clearLogs = () => window.UnifiedLogger.clearLogs();

console.log('[UnifiedLogger] Functions exported: logFull, getAllLogs, clearLogs');
