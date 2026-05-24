#!/usr/bin/env node
/**
 * Refresh tests/.auth/state.json without needing the user to log in.
 *
 * Approach:
 *   1. Mint a Firebase custom token via admin SDK (uses serviceAccountKey.json)
 *   2. Exchange it for a fresh idToken + refreshToken via Identity Toolkit REST API
 *   3. Build the firebase:authUser:* JSON shape Firebase JS SDK expects in
 *      localStorage, with new tokens and a fresh expiration time
 *   4. Write the updated state to tests/.auth/state.json
 *
 * After this, Playwright runs that load this storage state will be authenticated
 * for ~1 hour (then the refresh token kicks in for the next ~60 days).
 */

const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

const REPO_ROOT = path.join(__dirname, '..');
const AUTH_STATE_PATH = path.join(REPO_ROOT, 'tests', '.auth', 'state.json');
const SA = require(path.join(REPO_ROOT, 'server', 'config', 'serviceAccountKey.json'));

// Match the firebaseConfig.apiKey in firebase-init.js
const FIREBASE_WEB_API_KEY = 'AIzaSyAF5y6k9THaRKxLZemqcYDj4y_EgCcDbX8';

(async () => {
    if (!fs.existsSync(AUTH_STATE_PATH)) {
        console.error('No existing state.json — need user to log in via UI first');
        process.exit(1);
    }
    admin.initializeApp({ credential: admin.credential.cert(SA) });

    const state = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf8'));
    const lsItem = state.origins?.[0]?.localStorage?.find(x => x.name.startsWith('firebase:authUser:'));
    if (!lsItem) { console.error('No firebase:authUser entry'); process.exit(1); }
    const stored = JSON.parse(lsItem.value);
    const uid = stored.uid;
    console.log(`Refreshing auth for uid=${uid} email=${stored.email}`);

    // Step 1: mint custom token
    const customToken = await admin.auth().createCustomToken(uid);
    console.log('Custom token minted');

    // Step 2: exchange custom token → ID + refresh token via REST
    const exchangeUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_WEB_API_KEY}`;
    const exchangeResp = await fetch(exchangeUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    });
    if (!exchangeResp.ok) {
        const txt = await exchangeResp.text();
        console.error(`Token exchange failed: ${exchangeResp.status} ${txt}`);
        process.exit(1);
    }
    const { idToken, refreshToken, expiresIn } = await exchangeResp.json();
    const expirationTime = Date.now() + (parseInt(expiresIn, 10) * 1000);
    console.log(`Got fresh tokens; access token expires ${new Date(expirationTime).toISOString()}`);

    // Step 3: rebuild the firebase:authUser:* localStorage entry with fresh tokens
    const updated = {
        ...stored,
        stsTokenManager: {
            refreshToken,
            accessToken: idToken,
            expirationTime,
        },
        lastLoginAt: String(Date.now()),
    };

    lsItem.value = JSON.stringify(updated);

    // Step 4: persist the updated state file
    fs.writeFileSync(AUTH_STATE_PATH, JSON.stringify(state, null, 2));
    console.log(`Wrote refreshed state to ${AUTH_STATE_PATH}`);

    // Step 5: ensure today's disclaimer acceptance is recorded in Firestore.
    // The app redirects to /disclaimer.html if disclaimerAcceptance/{uid}.acceptanceTime
    // isn't today — which silently breaks any Playwright run after midnight.
    const db = admin.firestore();
    await db.collection('disclaimerAcceptance').doc(uid).set({
        acceptanceTime: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log('Disclaimer acceptance recorded for today');

    await admin.app().delete();
    process.exit(0);
})().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
