const express = require('express');
const router = express.Router();
const { extractPracticePointsRaw, extractPracticePoints, savePracticePoints } = require('../services/extraction');
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
 * POST /api/extractPracticePointsRaw
 * Extract practice points and return raw AI response (no JSON parsing)
 */
router.post('/extractPracticePointsRaw', authenticateUser, async (req, res) => {
    try {
        const { guidelineId, title, content } = req.body;

        if (!title || !content) {
            return res.status(400).json({
                success: false,
                error: 'title and content required'
            });
        }

        const userId = req.user.uid;
        const result = await extractPracticePointsRaw(title, content, userId);

        res.json(result);
    } catch (err) {
        console.error('[EXTRACTION_RAW] Error:', err.message);
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

/**
 * GET /api/getPracticePoints/:guidelineId
 * Fetch saved practice points for a guideline (server-side read using admin SDK)
 */
router.get('/getPracticePoints/:guidelineId', authenticateUser, async (req, res) => {
    try {
        const { guidelineId } = req.params;

        if (!guidelineId) {
            return res.status(400).json({
                success: false,
                error: 'guidelineId required'
            });
        }

        const snap = await db.collection('guidelines').doc(guidelineId).collection('practicePoints')
            .orderBy('order', 'asc')
            .get();

        const points = snap.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        console.log(`[GET_POINTS] Fetched ${points.length} practice points for guideline: ${guidelineId}`);

        res.json({
            success: true,
            count: points.length,
            points
        });
    } catch (err) {
        console.error('[GET_POINTS] Error:', err.message);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

module.exports = router;
