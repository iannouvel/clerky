/**
 * Logging Utility
 * Provides structured logging with timestamps and log levels
 */

/**
 * Logger object with level-based logging methods
 */
export const Logger = {
    levels: {
        DEBUG: 'debug',
        INFO: 'info',
        WARN: 'warn',
        ERROR: 'error'
    },

    /**
     * Format a log message with timestamp and level
     * @private
     */
    _formatMessage(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
        return data ? `${formattedMessage} ${JSON.stringify(data)}` : formattedMessage;
    },

    /**
     * Log a debug message (only in development)
     * @param {string} message - The message to log
     * @param {*} [data] - Optional data to include
     */
    debug(message, data = null) {
        // In browser environment, check for debug flag
        if (window.debugMode || localStorage.getItem('debugMode') === 'true') {
            console.debug(this._formatMessage(this.levels.DEBUG, message, data));
        }
    },

    /**
     * Log an info message
     * @param {string} message - The message to log
     * @param {*} [data] - Optional data to include
     */
    info(message, data = null) {
        console.info(this._formatMessage(this.levels.INFO, message, data));
    },

    /**
     * Log a warning message
     * @param {string} message - The message to log
     * @param {*} [data] - Optional data to include
     */
    warn(message, data = null) {
        console.warn(this._formatMessage(this.levels.WARN, message, data));
    },

    /**
     * Log an error message
     * @param {string} message - The message to log
     * @param {*} [data] - Optional data to include
     */
    error(message, data = null) {
        console.error(this._formatMessage(this.levels.ERROR, message, data));
    }
};

// Example usage:
// Logger.debug('Starting initializeApp...');
// Logger.info('Application initialized successfully', { userId: user.uid });
// Logger.error('Failed to load data', { error: error.message, stack: error.stack });
