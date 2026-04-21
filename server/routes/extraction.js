const express = require('express');
const router = express.Router();
const { extractPracticePointsRaw, extractPracticePoints, savePracticePoints } = require('../services/extraction');
const { authenticateUser } = require('../middleware/auth');
const { db } = require('../config/firebase');

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
 * POST /api/ensurePracticePoints
 * Returns existing practice points, or extracts+saves them if none exist.
 * Single call that handles the full pipeline server-side.
 */
router.post('/ensurePracticePoints', authenticateUser, async (req, res) => {
    try {
        const { guidelineId } = req.body;
        if (!guidelineId) {
            return res.status(400).json({ success: false, error: 'guidelineId required' });
        }

        const guidelineRef = db.collection('guidelines').doc(guidelineId);
        const ppRef = guidelineRef.collection('practicePoints');

        // 1. Check for existing practice points
        let snap;
        try {
            snap = await ppRef.orderBy('order', 'asc').get();
        } catch (_) {
            snap = await ppRef.get();
        }

        if (snap.size > 0) {
            const points = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            console.log(`[ENSURE_PP] Found ${points.length} existing points for ${guidelineId}`);
            return res.json({ success: true, count: points.length, points, source: 'existing' });
        }

        // 2. No points — fetch guideline content
        const guidelineSnap = await guidelineRef.get();
        if (!guidelineSnap.exists) {
            return res.status(404).json({ success: false, error: `Guideline ${guidelineId} not found` });
        }

        const gData = guidelineSnap.data();
        const title = gData.humanFriendlyTitle || gData.title || guidelineId;
        let content = gData.content || gData.condensed;

        if (!content) {
            const fullDoc = await guidelineRef.collection('content').doc('full').get();
            if (fullDoc.exists) content = fullDoc.data()?.content;
        }
        if (!content) {
            const condDoc = await guidelineRef.collection('content').doc('condensed').get();
            if (condDoc.exists) content = condDoc.data()?.condensed;
        }
        if (!content) {
            return res.status(400).json({ success: false, error: 'Guideline has no content to extract practice points from' });
        }

        // 3. Extract practice points via LLM
        console.log(`[ENSURE_PP] Extracting practice points for ${guidelineId} ("${title}")`);
        const userId = req.user.uid;
        const extractResult = await extractPracticePoints(title, content, userId);
        if (!extractResult.success || !extractResult.practicePoints?.length) {
            return res.status(500).json({ success: false, error: extractResult.error || 'Extraction returned no points' });
        }

        // 4. Save them
        const saveResult = await savePracticePoints(guidelineId, extractResult.practicePoints);
        if (!saveResult.success) {
            return res.status(500).json({ success: false, error: saveResult.error || 'Failed to save extracted points' });
        }

        // 5. Re-fetch saved points (to get IDs and full structure)
        let savedSnap;
        try {
            savedSnap = await ppRef.orderBy('order', 'asc').get();
        } catch (_) {
            savedSnap = await ppRef.get();
        }
        const points = savedSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        console.log(`[ENSURE_PP] Extracted and saved ${points.length} points for ${guidelineId}`);
        res.json({ success: true, count: points.length, points, source: 'extracted' });

    } catch (err) {
        console.error('[ENSURE_PP] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/getPracticePoints?guidelineId=...
 * Fetch saved practice points for a guideline (server-side read using admin SDK)
 */
router.get('/getPracticePoints', authenticateUser, async (req, res) => {
    try {
        const { guidelineId } = req.query;

        if (!guidelineId) {
            return res.status(400).json({
                success: false,
                error: 'guidelineId query parameter required'
            });
        }

        let snap;
        try {
            snap = await db.collection('guidelines').doc(guidelineId).collection('practicePoints')
                .orderBy('order', 'asc')
                .get();
        } catch (orderErr) {
            // Fallback if orderBy fails (e.g., missing index)
            console.warn('[GET_POINTS] orderBy failed, falling back to unordered fetch:', orderErr.message);
            snap = await db.collection('guidelines').doc(guidelineId).collection('practicePoints').get();
        }

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
