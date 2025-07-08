const { SyncRedactor } = require('@libretto/redact-pii-light');

// Create a default redactor instance and export the redact function
const defaultRedactor = new SyncRedactor();
const redactPii = (text) => defaultRedactor.redact(text);

// Export the redactPii function as the default export for browser use
module.exports = redactPii; 