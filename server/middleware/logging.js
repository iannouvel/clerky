const { debugLog } = require('../config/logger');

const { StepTimer } = require('../utils/stepTimer');

// Endpoint timing buffer for performance monitoring (accessible via /api/endpoint-timings)
// Exporting this to be accessible by the controller if needed, or keeping it internal if only used by middleware/monitor
const endpointTimings = [];
const MAX_TIMING_ENTRIES = 500;

const requestLogger = (req, res, next) => {
    const startTime = Date.now();
    const requestTimestamp = new Date().toISOString();

    // Skip logging for health checks to reduce noise
    const isHealthCheck = req.originalUrl === '/health' || req.originalUrl === '/api/health';

    if (!isHealthCheck) {
        debugLog(`[REQUEST] ${requestTimestamp} | ${req.method} ${req.originalUrl}`);
    }

    res.on('finish', () => {
        const duration = Date.now() - startTime;
        const responseTimestamp = new Date().toISOString();

        // Only log non-health-check responses, or slow responses (>5s), or errors
        if (!isHealthCheck || duration > 5000 || res.statusCode >= 400) {
            if (res.statusCode >= 400 || duration > 5000) {
                console.log(`[RESPONSE] ${responseTimestamp} | ${req.method} ${req.originalUrl} | Status: ${res.statusCode} | Duration: ${duration}ms`);
            } else {
                debugLog(`[RESPONSE] ${responseTimestamp} | ${req.method} ${req.originalUrl} | Status: ${res.statusCode} | Duration: ${duration}ms`);
            }
        }

        // Store timing data in buffer for the performance monitor
        endpointTimings.unshift({
            method: req.method,
            endpoint: req.originalUrl,
            status: res.statusCode,
            duration,
            requestTime: requestTimestamp,
            responseTime: responseTimestamp,
            steps: req.stepTimer?.getSteps() || []  // Include step timings if available
        });

        // Keep buffer size limited
        if (endpointTimings.length > MAX_TIMING_ENTRIES) {
            endpointTimings.pop();
        }
    });

    next();
};

module.exports = {
    StepTimer,
    requestLogger,
    endpointTimings
};
