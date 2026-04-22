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
router.get('/getPracticePointHistory', authenticateUser, calibrationController.getPracticePointHistory);
router.post('/resetGraduation', authenticateUser, calibrationController.resetGraduation);
router.post('/improvePracticePointAdvice', authenticateUser, calibrationController.improvePracticePointAdvice);
router.post('/rewritePracticePointRule', authenticateUser, calibrationController.rewritePracticePointRule);
router.post('/removePracticePoint', authenticateUser, calibrationController.removePracticePoint);

// ─── Phase 4: Context Evolution ──────────────────────────────────────────────
router.post('/contextEvolution/generateScenario', authenticateUser, calibrationController.generateFreshScenario);
router.post('/contextEvolution/testScenario', authenticateUser, calibrationController.testScenarioAgainstPoint);
router.get('/contextEvolution/progress', authenticateUser, calibrationController.getContextEvolutionProgress);
router.post('/contextEvolution/refineContext', authenticateUser, calibrationController.refinePointContext);
router.get('/contextEvolution/testHistory', authenticateUser, calibrationController.getContextEvolutionTestHistory);

// ─── Context Evolution: Run State Persistence ────────────────────────────────
router.post('/contextEvolution/saveRunState', authenticateUser, calibrationController.saveContextEvolutionRunState);
router.get('/contextEvolution/getRunState', authenticateUser, calibrationController.getContextEvolutionRunState);
router.delete('/contextEvolution/clearRunState', authenticateUser, calibrationController.clearContextEvolutionRunState);

module.exports = router;
