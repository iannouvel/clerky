const winston = require('winston');
const { format } = winston;
const path = require('path');
const fs = require('fs');

// Create required directories if they don't exist
// Adjusted path to point to project root/logs
const logsDir = path.join(__dirname, '../../logs');

if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Configure Winston logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.json()
    ),
    defaultMeta: { service: 'clerky-server' },
    transports: [
        // Write all logs to console
        new winston.transports.Console({
            format: format.combine(
                format.colorize(),
                format.simple()
            )
        }),
        // Write all logs with level 'info' and below to combined.log
        new winston.transports.File({
            filename: path.join(logsDir, 'combined.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            tailable: true
        }),
        // Write all logs with level 'error' and below to error.log
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            tailable: true
        })
    ]
});

// Debug logging helper - only logs when DEBUG_LOGGING env var is set
const DEBUG_LOGGING = process.env.DEBUG_LOGGING === 'true';
const debugLog = (...args) => { if (DEBUG_LOGGING) console.log(...args); };

module.exports = {
    logger,
    debugLog
};
