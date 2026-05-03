#!/usr/bin/env node

/**
 * Migration script: Add serial numbers to practice points
 *
 * Adds a `serial` field (1-indexed) to each practice point within each guideline.
 * This enables the AI to directly reference practice points by number instead of
 * relying on text matching.
 *
 * Run with: node scripts/add-practice-point-serials.js
 */

const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.join(__dirname, '../server/config/serviceAccountKey.json');

try {
    admin.initializeApp({
        credential: admin.credential.cert(require(serviceAccountPath))
    });
} catch (error) {
    console.error('Failed to initialize Firebase Admin:', error.message);
    process.exit(1);
}

const db = admin.firestore();

async function addSerials() {
    console.log('Starting: Add serial numbers to practice points');
    console.log('=========================================================\n');

    try {
        const guidelinesSnapshot = await db.collection('guidelines').get();
        const totalDocs = guidelinesSnapshot.size;

        if (totalDocs === 0) {
            console.log('No guidelines found.');
            process.exit(0);
        }

        console.log(`Found ${totalDocs} guidelines to process.\n`);

        let processedCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        for (const doc of guidelinesSnapshot.docs) {
            const guidelineId = doc.id;
            const data = doc.data();

            try {
                const practicePoints = data.practicePoints || [];

                if (practicePoints.length === 0) {
                    console.log(`⊘ ${guidelineId}: No practice points to serialize`);
                    skippedCount++;
                    continue;
                }

                // Add serial numbers to practice points (1-indexed)
                const updatedPPs = practicePoints.map((pp, index) => ({
                    ...pp,
                    serial: index + 1
                }));

                // Check if any already have serial numbers
                const alreadyHave = practicePoints.some(pp => pp.serial !== undefined);

                // Update the guideline
                await doc.ref.update({
                    practicePoints: updatedPPs
                });

                const action = alreadyHave ? 'Updated' : 'Added';
                console.log(`✓ ${guidelineId}: ${action} serials for ${practicePoints.length} practice points`);
                updatedCount++;

            } catch (error) {
                console.error(`✗ ${guidelineId}: Error - ${error.message}`);
                errorCount++;
            }

            processedCount++;
        }

        console.log(`\n=========================================================`);
        console.log(`Migration Complete:`);
        console.log(`  ✓ Updated:  ${updatedCount}`);
        console.log(`  ⊘ Skipped:  ${skippedCount}`);
        console.log(`  ✗ Errors:   ${errorCount}`);
        console.log(`=========================================================\n`);

        if (errorCount === 0) {
            console.log('✓ All guidelines successfully updated with serial numbers!');
        } else {
            console.log('⚠ Migration completed with errors. Please review above.');
            process.exit(1);
        }

    } catch (error) {
        console.error('Fatal error during migration:', error);
        process.exit(1);
    } finally {
        await admin.app().delete();
    }
}

addSerials();
