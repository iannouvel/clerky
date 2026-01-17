const { admin, db } = require('../config/firebase');
const { debugLog } = require('../config/logger');

// ============================================================================
// BACKGROUND JOB QUEUE SYSTEM
// ============================================================================

const jobQueue = [];
const processingJobs = new Set();
const MAX_CONCURRENT_JOBS = 3;
let isProcessingQueue = false;
let cancelJobQueue = false; // Flag to stop processing

// Registry of job handlers: type -> function(job, guidelineData)
const jobHandlers = {};

/**
 * Register a handler function for a specific job type
 * @param {string} type - The job type identifier
 * @param {Function} handler - Async function(job, guidelineData)
 */
function registerJobHandler(type, handler) {
    jobHandlers[type] = handler;
    debugLog(`[JOB_QUEUE] Registered handler for job type: ${type}`);
}

/**
 * Cancel all pending jobs in the queue
 * @returns {number} Number of jobs cleared
 */
function clearJobQueue() {
    const count = jobQueue.length;
    jobQueue.length = 0; // Clear the array
    cancelJobQueue = true;
    console.log(`[JOB_QUEUE] Cleared ${count} pending jobs`);
    return count;
}

/**
 * Add job to queue
 * @param {string} jobType 
 * @param {string} guidelineId 
 * @param {Object} data 
 * @returns {string} Job ID
 */
function queueJob(jobType, guidelineId, data = {}) {
    const job = {
        id: `${jobType}-${guidelineId}-${Date.now()}`,
        type: jobType,
        guidelineId: guidelineId,
        data: data,
        status: 'pending',
        createdAt: new Date().toISOString(),
        attempts: 0,
        maxAttempts: 3,
        error: null
    };

    jobQueue.push(job);
    console.log(`[JOB_QUEUE] Added job: ${job.id}, queue length: ${jobQueue.length}`);

    // Start processing if not already running
    if (!isProcessingQueue) {
        processJobQueue();
    }

    return job.id;
}

/**
 * Process job queue
 */
async function processJobQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;
    cancelJobQueue = false;

    debugLog(`[JOB_QUEUE] Starting queue processor, ${jobQueue.length} jobs pending`);

    while (jobQueue.length > 0) {
        if (cancelJobQueue) {
            console.log(`[JOB_QUEUE] Queue processing cancelled`);
            break;
        }

        // Wait if we're at max concurrent jobs
        while (processingJobs.size >= MAX_CONCURRENT_JOBS) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const job = jobQueue.shift();
        if (!job) continue;

        processingJobs.add(job.id);

        // Process job asynchronously
        processJob(job).then(() => {
            processingJobs.delete(job.id);
        }).catch((error) => {
            console.error(`[JOB_QUEUE] Job ${job.id} failed:`, error);
            processingJobs.delete(job.id);
        });

        // Small delay between job starts
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Wait for all jobs to complete
    while (processingJobs.size > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    isProcessingQueue = false;
    console.log(`[JOB_QUEUE] Queue processor stopped, all jobs completed`);
}

/**
 * Process individual job
 * @param {Object} job 
 */
async function processJob(job) {
    debugLog(`[JOB_QUEUE] Processing job: ${job.id}, type: ${job.type}`);

    try {
        job.attempts++;
        job.status = 'processing';

        const guidelineRef = db.collection('guidelines').doc(job.guidelineId);
        const doc = await guidelineRef.get();

        if (!doc.exists) {
            throw new Error(`Guideline not found: ${job.guidelineId}`);
        }

        const guidelineData = doc.data();
        let result;

        const handler = jobHandlers[job.type];
        if (handler) {
            result = await handler(job, guidelineData);
        } else {
            throw new Error(`Unknown job type: ${job.type}`);
        }

        job.status = 'completed';
        job.completedAt = new Date().toISOString();
        console.log(`[JOB_QUEUE] Job completed: ${job.id}`);

        return result;

    } catch (error) {
        console.error(`[JOB_QUEUE] Job ${job.id} error:`, error.message);

        job.error = error.message;

        // Retry if not at max attempts
        if (job.attempts < job.maxAttempts) {
            debugLog(`[JOB_QUEUE] Retrying job ${job.id}, attempt ${job.attempts}/${job.maxAttempts}`);
            job.status = 'pending';
            jobQueue.push(job); // Re-queue
        } else {
            console.error(`[JOB_QUEUE] Job ${job.id} failed after ${job.attempts} attempts`);
            job.status = 'failed';

            // Update Firestore with error
            try {
                const guidelineRef = db.collection('guidelines').doc(job.guidelineId);
                await guidelineRef.update({
                    processing: false, // Ensure we clear the flag on fatal failure
                    [`processingErrors.${job.type}`]: error.message,
                    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                });
            } catch (updateError) {
                console.error(`[JOB_QUEUE] Failed to update error in Firestore:`, updateError);
            }
        }
        throw error;
    }
}

module.exports = {
    queueJob,
    clearJobQueue,
    registerJobHandler
};
