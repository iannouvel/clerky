const admin = require('firebase-admin');
const crypto = require('crypto');
const { debugLog } = require('./logger');

let db;

try {
    // Initialize Firebase Admin SDK
    // Support both FIREBASE_PRIVATE_KEY (raw) and FIREBASE_PRIVATE_KEY_BASE64 (encoded)
    let privateKey;
    if (process.env.FIREBASE_PRIVATE_KEY_BASE64) {
        const buffer = Buffer.from(process.env.FIREBASE_PRIVATE_KEY_BASE64, 'base64');
        privateKey = buffer.toString('utf8');
        debugLog('[DEBUG] Firebase: Loaded private key from BASE64 environment variable');
    } else if (process.env.FIREBASE_PRIVATE_KEY) {
        // Handle raw key with potential line break issues
        const rawKey = process.env.FIREBASE_PRIVATE_KEY;

        // If the key is wrapped in quotes, strip them
        if ((rawKey.startsWith('"') && rawKey.endsWith('"')) || (rawKey.startsWith("'") && rawKey.endsWith("'"))) {
            privateKey = rawKey.slice(1, -1).replace(/\\n/g, '\n');
        } else {
            privateKey = rawKey.replace(/\\n/g, '\n');
        }

        // Validate the private key format
        const keyStart = privateKey.indexOf('-----BEGIN PRIVATE KEY-----');
        const keyEnd = privateKey.indexOf('-----END PRIVATE KEY-----');

        if (keyStart === -1 || keyEnd === -1) {
            console.error('Invalid private key format: Missing BEGIN/END markers');
            // Try alternative formats
            if (privateKey.indexOf('BEGIN PRIVATE KEY') > -1 && privateKey.indexOf('END PRIVATE KEY') > -1) {
                // Add missing dashes
                privateKey = privateKey.replace(/BEGIN PRIVATE KEY/g, '-----BEGIN PRIVATE KEY-----');
                privateKey = privateKey.replace(/END PRIVATE KEY/g, '-----END PRIVATE KEY-----');
                console.log('Fixed private key format by adding dashes');
            } else {
                throw new Error('Firebase private key is malformed - cannot find valid PEM format. Consider using FIREBASE_PRIVATE_KEY_BASE64 instead.');
            }
        } else {
            // console.log('Private key format appears correct');
        }

        // Additional validation - check for proper line structure
        const lines = privateKey.split('\n');
        if (lines.length < 3) {
            console.warn('Private key has unusually few lines, attempting to fix formatting...');

            // Try to reconstruct proper line breaks
            const keyContent = privateKey.replace(/-----BEGIN PRIVATE KEY-----/, '')
                .replace(/-----END PRIVATE KEY-----/, '')
                .replace(/\s+/g, '');

            // Reconstruct with proper 64-character lines
            const formattedKey = '-----BEGIN PRIVATE KEY-----\n' +
                keyContent.match(/.{1,64}/g).join('\n') +
                '\n-----END PRIVATE KEY-----';

            privateKey = formattedKey;
            console.log('Reformatted private key with proper line breaks');
        }

    } else {
        throw new Error('Neither FIREBASE_PRIVATE_KEY nor FIREBASE_PRIVATE_KEY_BASE64 environment variable is set');
    }

    // Test the private key before using it
    debugLog('[DEBUG] Firebase: Testing private key validity...');
    try {
        const testMessage = 'test';
        const sign = crypto.createSign('RSA-SHA256');
        sign.update(testMessage);
        sign.sign(privateKey); // This will throw if the key is invalid
        debugLog('[DEBUG] Firebase: Private key validation successful');
    } catch (keyError) {
        console.error('[ERROR] Firebase: Private key validation failed:', keyError.message);
        throw new Error(`Invalid private key format: ${keyError.message}`);
    }

    // Initialize the SDK with validated credentials
    const serviceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey
    };

    // Validate all required fields
    if (!serviceAccount.projectId || !serviceAccount.clientEmail || !serviceAccount.privateKey) {
        throw new Error('Missing required Firebase configuration fields');
    }

    debugLog('[DEBUG] Firebase: Initializing Firebase Admin SDK...');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: 'clerky-b3be8.firebasestorage.app'
    });

    debugLog('[DEBUG] Firebase: Firebase Admin SDK initialized successfully');

    // Initialize Firestore with additional error handling
    debugLog('[DEBUG] Firebase: Initializing Firestore...');
    db = admin.firestore();
    db.settings({
        ignoreUndefinedProperties: true,
        preferRest: true // Prefer REST API over gRPC
    });

    debugLog('[DEBUG] Firebase: Firestore instance created with REST API configuration');

} catch (error) {
    console.error('SERVER INITIALIZATION ERROR:', error);
    // process.exit(1); // Maybe don't exit in module, just throw?
    throw error;
}

module.exports = {
    admin,
    db
};
