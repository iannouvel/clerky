const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');

// Health check
router.get('/health', systemController.healthCheck);
router.get('/api/health', systemController.healthCheck); // Alias

// Version
router.get('/api/version', systemController.getVersion);

module.exports = router;
