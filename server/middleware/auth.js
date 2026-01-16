const { admin } = require('../config/firebase');

// Authentication middleware
const authenticateUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ message: 'No authorization header' });
    }
    try {
        // Verify Firebase token
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        res.status(401).json({ message: 'Invalid token' });
    }
};

// Workflow authentication middleware
const authenticateWorkflow = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            throw new Error('No authorization header');
        }

        // Verify workflow token
        const token = authHeader.split('Bearer ')[1];
        // Use a special workflow token stored in environment variables
        if (token === process.env.WORKFLOW_TOKEN) {
            next();
        } else {
            throw new Error('Invalid workflow token');
        }
    } catch (error) {
        console.error('Workflow authentication error:', error);
        res.status(401).json({ message: 'Invalid token' });
    }
};

module.exports = {
    authenticateUser,
    authenticateWorkflow
};
