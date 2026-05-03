#!/usr/bin/env node

/**
 * Migration script: Rename auditableElements → practicePoints in Firestore
 *
 * Renames the following fields on all guideline documents:
 * - auditableElements → practicePoints
 * - auditableElementsRegeneratedAt → practicePointsRegeneratedAt
 * - auditableElementsRegeneratedBy → practicePointsRegeneratedBy
 *
 * Run with: node scripts/migrate-auditable-to-practice-points.js
 */

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.join(__dirname, '../server/config/serviceAccountKey.json');

try {
    admin.initializeApp({
        credential: admin.credential.cert(require(serviceAccountPath))
    });
} catch (error) {
    console.error('Failed to initialize Firebase Admin:', error.message);
    console.error('Make sure FIREBASE_SERVICE_ACCOUNT_PATH is set or serviceAccountKey.json exists');
    process.exit(1);
}

const db = admin.firestore();

async function migrateAuditableElements() {
    console.log('Starting migration: auditableElements → practicePoints');
    console.log('=========================================================\n');

    try {
        const guidelinesSnapshot = await db.collection('guidelines').get();
        const totalDocs = guidelinesSnapshot.size;

        if (totalDocs === 0) {
            console.log('No guidelines found to migrate.');
            process.exit(0);
        }

        console.log(`Found ${totalDocs} guidelines to process.\n`);

        let migratedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        for (const doc of guidelinesSnapshot.docs) {
            const guidelineId = doc.id;
            const data = doc.data();

            try {
                // Check if document has old field names
                const hasOldFields =
                    data.auditableElements !== undefined ||
                    data.auditableElementsRegeneratedAt !== undefined ||
                    data.auditableElementsRegeneratedBy !== undefined;

                if (!hasOldFields) {
                    console.log(`⊘ ${guidelineId}: No old fields to migrate`);
                    skippedCount++;
                    continue;
                }

                // Prepare update object
                const updateObj = {};
                let fieldCount = 0;

                // Migrate auditableElements → practicePoints
                if (data.auditableElements !== undefined) {
                    updateObj.practicePoints = data.auditableElements;
                    updateObj.auditableElements = admin.firestore.FieldValue.delete();
                    fieldCount++;
                }

                // Migrate auditableElementsRegeneratedAt → practicePointsRegeneratedAt
                if (data.auditableElementsRegeneratedAt !== undefined) {
                    updateObj.practicePointsRegeneratedAt = data.auditableElementsRegeneratedAt;
                    updateObj.auditableElementsRegeneratedAt = admin.firestore.FieldValue.delete();
                    fieldCount++;
                }

                // Migrate auditableElementsRegeneratedBy → practicePointsRegeneratedBy
                if (data.auditableElementsRegeneratedBy !== undefined) {
                    updateObj.practicePointsRegeneratedBy = data.auditableElementsRegeneratedBy;
                    updateObj.auditableElementsRegeneratedBy = admin.firestore.FieldValue.delete();
                    fieldCount++;
                }

                // Perform update
                await doc.ref.update(updateObj);

                console.log(`✓ ${guidelineId}: Migrated ${fieldCount} field(s)`);
                migratedCount++;

            } catch (error) {
                console.error(`✗ ${guidelineId}: Error during migration - ${error.message}`);
                errorCount++;
            }
        }

        console.log(`\n=========================================================`);
        console.log(`Migration Complete:`);
        console.log(`  ✓ Migrated: ${migratedCount}`);
        console.log(`  ⊘ Skipped:  ${skippedCount}`);
        console.log(`  ✗ Errors:   ${errorCount}`);
        console.log(`=========================================================\n`);

        if (errorCount === 0) {
            console.log('✓ All guidelines successfully migrated!');
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

// Run migration
migrateAuditableElements();
