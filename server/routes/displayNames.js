const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/auth');
const displayNamesController = require('../controllers/displayNamesController');

// Route to regenerate displayNames for all guidelines
// This processes updates in batches for guidelines that match criteria or forces update
router.post('/regenerateDisplayNames', authenticateUser, displayNamesController.regenerateDisplayNames);

// Route to populate/generate displayNames via background jobs
// Or update a single guideline immediately if guidelineId is provided
router.post('/populateDisplayNames', authenticateUser, displayNamesController.populateDisplayNames);

// Route to seed hospital trust mappings
router.post('/seedHospitalTrustMappings', authenticateUser, displayNamesController.seedHospitalTrustMappings);

// Route to migrate short capitalised trust names
router.post('/migrateShortHospitalTrust', authenticateUser, displayNamesController.migrateShortHospitalTrust);

// Route to clear all display names (ADMIN utility)
router.post('/clearDisplayNames', authenticateUser, displayNamesController.clearDisplayNames);

module.exports = router;
