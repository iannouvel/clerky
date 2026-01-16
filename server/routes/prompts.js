const express = require('express');
const router = express.Router();
const promptsController = require('../controllers/promptsController');
const { authenticateUser } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Debug Endpoint
router.get('/debug-prompts', authenticateUser, promptsController.debugPrompts);

// Prompt Management
router.get('/getPrompts', authenticateUser, promptsController.getPrompts);
router.post('/updatePrompts', authenticateUser, upload.none(), promptsController.updatePrompts);
router.post('/syncPromptsToFirestore', authenticateUser, promptsController.syncPromptsToFirestore);

// Prompt Evolution
router.post('/evolvePrompts', authenticateUser, promptsController.evolvePrompts);
router.post('/evolvePromptsSequential', authenticateUser, promptsController.evolvePromptsSequential);

module.exports = router;
