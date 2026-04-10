const express = require('express');
const router = express.Router();
const calibrationController = require('../controllers/calibrationController');
const { authenticateUser } = require('../middleware/auth');

// Practice point sync — seeds practicePointMetrics from auditableElements
router.post('/syncPracticePoints', authenticateUser, calibrationController.syncPracticePoints);

// Practice point metrics — read accuracy tracking data
router.get('/getPracticePointMetrics', authenticateUser, calibrationController.getPracticePointMetrics);

// Weighted sample — preview which points would be selected for a calibration run
router.get('/samplePracticePoints', authenticateUser, calibrationController.samplePracticePoints);

// Calibration runs
router.post('/runCalibration', authenticateUser, calibrationController.runCalibration);
router.post('/runCalibrationLoop', authenticateUser, calibrationController.runCalibrationLoop);
router.get('/getCalibrationJobStatus', authenticateUser, calibrationController.getCalibrationJobStatus);
router.get('/getCalibrationRuns', authenticateUser, calibrationController.getCalibrationRuns);
router.post('/resetGraduation', authenticateUser, calibrationController.resetGraduation);

module.exports = router;
