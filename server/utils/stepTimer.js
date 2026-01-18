// StepTimer helper for profiling endpoint internals
class StepTimer {
    constructor(endpoint) {
        this.endpoint = endpoint;
        this.steps = [];
        this.startTime = Date.now();
        this.lastStep = this.startTime;
    }

    step(name) {
        const now = Date.now();
        const duration = now - this.lastStep;
        this.steps.push({ name, duration, timestamp: new Date().toISOString() });
        this.lastStep = now;
        return duration;
    }

    getSteps() {
        return this.steps;
    }

    getTotalTime() {
        return Date.now() - this.startTime;
    }

    getSummary() {
        return {
            endpoint: this.endpoint,
            totalTimeMs: this.getTotalTime(),
            steps: this.steps
        };
    }
}

module.exports = StepTimer;
