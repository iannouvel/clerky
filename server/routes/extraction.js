const express = require('express');
const router = express.Router();
const { extractPracticePoints } = require('../services/extraction');
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

module.exports = router;
