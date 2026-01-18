const packageJson = require('../../package.json');
const path = require('path');

const systemController = {
    // Health check endpoint
    healthCheck: (req, res) => {
        res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
    },

    // Version endpoint
    getVersion: (req, res) => {
        res.json({ version: packageJson.version });
    }
};

module.exports = systemController;
