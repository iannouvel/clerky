const express = require('express');
const router = express.Router();
const { extractPracticePoints, savePracticePoints } = require('../services/extraction');
const { authenticateUser } = require('../middleware/auth');

/**
 * POST /api/extractPracticePoints
 * Extract practice points from guideline content
 */
router.post('/extractPracticePoints', authenticateUser, async (req, res) => {
    try {
        const { guidelineId, title, content } = req.body;

        if (!title || !content) {
            return res.status(400).json({
                success: false,
                error: 'title and content required'
            });
        }

        const userId = req.user.uid;
        const result = await extractPracticePoints(title, content, userId);

        res.json(result);
    } catch (err) {
        console.error('[EXTRACTION] Error:', err.message);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

/**
 * POST /api/savePracticePoints
 * Save extracted practice points as individual Firestore documents
 */
router.post('/savePracticePoints', authenticateUser, async (req, res) => {
    try {
        const { guidelineId, points } = req.body;

        if (!guidelineId || !Array.isArray(points) || points.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'guidelineId and non-empty points array required'
            });
        }

        const result = await savePracticePoints(guidelineId, points);

        res.json(result);
    } catch (err) {
        console.error('[SAVE_POINTS] Error:', err.message);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

module.exports = router;
