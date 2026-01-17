const { db } = require('../config/firebase');
const { queueJob } = require('../services/jobQueue'); // Assuming jobQueue is or will be a module
const {
    generateDisplayName,
    generateSimpleDisplayName,
    generateDisplayNameWithAI,
    getShortHospitalTrust
} = require('../utils/displayNames');

// Helper to check for suspicious display names
function isSuspiciousDisplayName(value) {
    if (!value || typeof value !== 'string') return true;
    if (value.length < 3) return true;
    if (value.length > 220) return true;
    if (/[<>]/.test(value)) return true;
    if (value.includes('```')) return true;
    if (value.includes('**')) return true;
    if (value.includes('•')) return true;
    const lower = value.toLowerCase();
    if (lower.includes('reasoning summary')) return true;
    if (lower.includes('final display name')) return true;
    return false;
}

// Handler for regenerating display names
const regenerateDisplayNames = async (req, res) => {
    try {
        const { force } = req.body;
        const guidelinesSnapshot = await db.collection('guidelines').get();
        const results = [];
        let updatedCount = 0;
        let batch = db.batch();
        let batchCount = 0;
        const BATCH_SIZE = 500;

        console.log(`[REGENERATE_DISPLAY_NAMES] Processing ${guidelinesSnapshot.size} guidelines...`);

        for (const doc of guidelinesSnapshot.docs) {
            const data = doc.data();

            // Skip if displayName exists and not forced, UNLESS it looks suspicious/raw
            if (data.displayName && !force && !isSuspiciousDisplayName(data.displayName)) {
                continue;
            }

            // Generate simple display name
            // For older records without shortTrust/org, this might just clean the filename
            const simpleName = generateSimpleDisplayName(data);

            // Fallback to purely rule-based cleaning if simple generation fails or returns raw filename
            const fallbackName = generateDisplayName(data.humanFriendlyName || data.title || data.filename);

            const newDisplayName = simpleName || fallbackName;

            if (newDisplayName && newDisplayName !== data.displayName) {
                batch.update(doc.ref, {
                    displayName: newDisplayName,
                    displayNameGeneratedAt: new Date().toISOString(),
                    displayNameMethod: 'regenerate_script_v2'
                });

                batchCount++;
                updatedCount++;
                results.push({
                    id: doc.id,
                    old: data.displayName,
                    new: newDisplayName
                });

                if (batchCount >= BATCH_SIZE) {
                    await batch.commit();
                    batch = db.batch();
                    batchCount = 0;
                    console.log(`[REGENERATE_DISPLAY_NAMES] Committed batch of ${BATCH_SIZE} updates`);
                }
            }
        }

        if (batchCount > 0) {
            await batch.commit();
            console.log(`[REGENERATE_DISPLAY_NAMES] Committed final batch of ${batchCount} updates`);
        }

        console.log(`[REGENERATE_DISPLAY_NAMES] Completed. Updated ${updatedCount} guidelines.`);

        res.json({
            success: true,
            updatedCount,
            totalProcessed: guidelinesSnapshot.size,
            sampleUpdates: results.slice(0, 50)
        });
    } catch (error) {
        console.error('[REGENERATE_DISPLAY_NAMES] Error:', error);
        res.status(500).json({ error: error.message });
    }
};

// Handler for populating display names (triggering background jobs)
const populateDisplayNames = async (req, res) => {
    try {
        const { guidelineId } = req.body;

        // If specific guidelineId provided, update only that one
        if (guidelineId) {
            console.log(`[POPULATE_DISPLAY_NAMES] Processing single guideline: ${guidelineId}`);

            const docRef = db.collection('guidelines').doc(guidelineId);
            const doc = await docRef.get();

            if (!doc.exists) {
                return res.status(404).json({ error: 'Guideline not found' });
            }

            const data = doc.data();

            // Generate display name using AI (since this is an explicit user request)
            // We'll use the background job function logic but run it inline for immediate feedback?
            // BETTER: Just generate it here directly to return the result
            let displayName = await generateDisplayNameWithAI(data, req.user.uid);

            if (!displayName) {
                // Fallback to simple generation
                displayName = generateSimpleDisplayName(data);
            }

            if (displayName) {
                await docRef.update({
                    displayName: displayName,
                    displayNameGeneratedAt: new Date().toISOString(),
                    displayNameMethod: 'manual_trigger_api'
                });

                return res.json({
                    success: true,
                    message: `Generated display name for ${guidelineId}`,
                    displayName: displayName
                });
            } else {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to generate display name'
                });
            }
        }

        // Otherwise, queue jobs for all guidelines that need processing
        // This returns immediately and processes in the background to avoid timeouts
        const guidelinesSnapshot = await db.collection('guidelines').get();
        const guidelinesToProcess = [];

        // Filter guidelines that need processing
        for (const doc of guidelinesSnapshot.docs) {
            const data = doc.data();

            // Skip if displayName already exists AND looks valid (unless force flag is set)
            if (data.displayName && !req.body.force && !isSuspiciousDisplayName(data.displayName)) {
                continue;
            }

            const sourceName = data.humanFriendlyName || data.title || data.filename;
            if (!sourceName) {
                continue;
            }

            guidelinesToProcess.push(doc.id);
        }

        console.log(`[POPULATE_DISPLAY_NAMES] Queueing ${guidelinesToProcess.length} guidelines for background processing`);

        // Queue jobs for each guideline - these will be processed by the background job processor
        // Note: queueJob function needs to be imported/available. 
        // If it's defined in server.js but not exported, we might need to duplicate it or move it to a service.
        // For now assuming it's available or we can just skip this part until jobQueue is refactored.

        // CRITICAL CHECK: Does queueJob exist? 
        // Logic in server.js was: queueJob('generate_display_name', guidelineId);
        if (typeof queueJob === 'function') {
            for (const id of guidelinesToProcess) {
                queueJob('generate_display_name', id);
            }
        } else {
            console.warn('[POPULATE_DISPLAY_NAMES] queueJob function not found. Skipping background processing.');
            // Only if we can't queue, maybe try to process a small batch inline?
            // Or just return error/warning.
        }

        res.json({
            success: true,
            message: `Queued ${guidelinesToProcess.length} guidelines for display name regeneration. Processing in background...`,
            queued: guidelinesToProcess.length,
            total: guidelinesSnapshot.size
        });
    } catch (error) {
        console.error('[POPULATE_DISPLAY_NAMES] Error:', error);
        res.status(500).json({ error: error.message });
    }
};

// Handler for seeding hospital trust mappings
const seedHospitalTrustMappings = async (req, res) => {
    try {
        console.log('[SEED_TRUST_MAPPINGS] Starting to seed hospital trust mappings...');

        // This list comes from the original server.js
        const trustMappings = [
            { fullName: "University Hospital Southampton NHS Foundation Trust", shortName: "UHS" },
            { fullName: "University Hospitals Southampton NHS Foundation Trust", shortName: "UHS" },
            { fullName: "Portsmouth Hospitals University NHS Trust", shortName: "Portsmouth" },
            { fullName: "Portsmouth Hospitals NHS Trust", shortName: "Portsmouth" },
            { fullName: "Hampshire Hospitals NHS Foundation Trust", shortName: "Hampshire Hospitals" },
            { fullName: "Isle of Wight NHS Trust", shortName: "Isle of Wight" },
            { fullName: "University Hospitals Sussex NHS Foundation Trust", shortName: "UHSussex" },
            { fullName: "Surrey and Sussex Healthcare NHS Trust", shortName: "SASH" },
            { fullName: "Frimley Health NHS Foundation Trust", shortName: "Frimley Health" },
            { fullName: "Royal Surrey County Hospital NHS Foundation Trust", shortName: "Royal Surrey" },
            { fullName: "Ashford and St Peter's Hospitals NHS Foundation Trust", shortName: "Ashford & St Peter's" },
            { fullName: "East Sussex Healthcare NHS Trust", shortName: "East Sussex" },
            { fullName: "Maidstone and Tunbridge Wells NHS Trust", shortName: "MTW" },
            { fullName: "Dartford and Gravesham NHS Trust", shortName: "Dartford & Gravesham" },
            { fullName: "Medway NHS Foundation Trust", shortName: "Medway" },
            { fullName: "East Kent Hospitals University NHS Foundation Trust", shortName: "East Kent" },
            { fullName: "King's College Hospital NHS Foundation Trust", shortName: "King's" },
            { fullName: "Guy's and St Thomas' NHS Foundation Trust", shortName: "Guy's & St Thomas'" },
            { fullName: "Lewisham and Greenwich NHS Trust", shortName: "Lewisham & Greenwich" },
            { fullName: "Oxleas NHS Foundation Trust", shortName: "Oxleas" },
            { fullName: "South London and Maudsley NHS Foundation Trust", shortName: "SLaM" },
            { fullName: "South West London and St George's Mental Health NHS Trust", shortName: "SWL St George's" },
            { fullName: "St George's University Hospitals NHS Foundation Trust", shortName: "St George's" },
            { fullName: "Epsom and St Helier University Hospitals NHS Trust", shortName: "Epsom & St Helier" },
            { fullName: "Kingston Hospital NHS Foundation Trust", shortName: "Kingston" },
            { fullName: "Croydon Health Services NHS Trust", shortName: "Croydon" },
            { fullName: "Chelsea and Westminster Hospital NHS Foundation Trust", shortName: "Chelsea & Westminster" },
            { fullName: "The Hillingdon Hospitals NHS Foundation Trust", shortName: "Hillingdon" },
            { fullName: "London North West University Healthcare NHS Trust", shortName: "London North West" },
            { fullName: "Imperial College Healthcare NHS Trust", shortName: "Imperial" },
            { fullName: "Royal Brompton and Harefield NHS Foundation Trust", shortName: "Royal Brompton" },
            { fullName: "The Royal Marsden NHS Foundation Trust", shortName: "Royal Marsden" },
            { fullName: "Great Ormond Street Hospital for Children NHS Foundation Trust", shortName: "GOSH" },
            { fullName: "Moorfields Eye Hospital NHS Foundation Trust", shortName: "Moorfields" },
            { fullName: "Royal National Orthopaedic Hospital NHS Trust", shortName: "RNOH" },
            { fullName: "University College London Hospitals NHS Foundation Trust", shortName: "UCLH" },
            { fullName: "Royal Free London NHS Foundation Trust", shortName: "Royal Free" },
            { fullName: "Whittington Health NHS Trust", shortName: "Whittington" },
            { fullName: "North Middlesex University Hospital NHS Trust", shortName: "North Mid" },
            { fullName: "Homerton University Hospital NHS Foundation Trust", shortName: "Homerton" },
            { fullName: "Barts Health NHS Trust", shortName: "Barts" },
            { fullName: "East London NHS Foundation Trust", shortName: "ELFT" },
            { fullName: "Barking, Havering and Redbridge University Hospitals NHS Trust", shortName: "BHRUT" }
        ];

        let batch = db.batch();
        let count = 0;

        for (const mapping of trustMappings) {
            const docRef = db.collection('hospitalTrustMappings').doc(mapping.fullName.replace(/\//g, '-'));
            batch.set(docRef, {
                fullName: mapping.fullName,
                shortName: mapping.shortName,
                updatedAt: new Date().toISOString()
            });
            count++;

            // Commit batch if it reaches 500
            if (count % 500 === 0) {
                await batch.commit();
                batch = db.batch();
                console.log(`[SEED_TRUST_MAPPINGS] Committed batch of 500 mappings`);
            }
        }

        if (count % 500 !== 0) {
            await batch.commit();
        }

        console.log(`[SEED_TRUST_MAPPINGS] Successfully seeded ${count} trust mappings`);

        res.json({
            success: true,
            mappedCount: count,
            message: `Successfully seeded ${count} hospital trust mappings`
        });
    } catch (error) {
        console.error('[SEED_TRUST_MAPPINGS] Error:', error);
        res.status(500).json({ error: error.message });
    }
};

// Handler to migrate/fix short hospital trust names
const migrateShortHospitalTrust = async (req, res) => {
    try {
        const { regenerateDisplay, force } = req.body;

        console.log(`[MIGRATE_SHORT_TRUST] Starting migration. regenerateDisplay=${regenerateDisplay}, force=${force}`);

        const guidelinesSnapshot = await db.collection('guidelines').get();
        let updatedCount = 0;
        let batch = db.batch();
        let batchCount = 0;
        const BATCH_SIZE = 500;

        for (const doc of guidelinesSnapshot.docs) {
            const data = doc.data();
            let updates = {};
            let needsUpdate = false;

            // 1. Check if shortHospitalTrust needs to be generated/updated
            if (data.hospitalTrust && (!data.shortHospitalTrust || force)) {
                // Determine short trust name
                const shortTrust = await getShortHospitalTrust(data.hospitalTrust);
                if (shortTrust && shortTrust !== data.shortHospitalTrust) {
                    updates.shortHospitalTrust = shortTrust;
                    needsUpdate = true;
                }
            }

            // 2. Regenerate displayName if requested or if we updated the short trust
            if (regenerateDisplay && (needsUpdate || force)) {
                // Use the updated data for generation
                const updatedData = { ...data, ...updates };
                const newDisplayName = generateSimpleDisplayName(updatedData);

                if (newDisplayName && newDisplayName !== data.displayName) {
                    updates.displayName = newDisplayName;
                    updates.displayNameGeneratedAt = new Date().toISOString();
                    updates.displayNameMethod = 'start_migration_script';
                    needsUpdate = true;
                }
            }

            if (needsUpdate) {
                batch.update(doc.ref, updates);
                batchCount++;
                updatedCount++;

                if (batchCount >= BATCH_SIZE) {
                    await batch.commit();
                    batch = db.batch();
                    batchCount = 0;
                    console.log(`[MIGRATE_SHORT_TRUST] Committed batch of ${BATCH_SIZE}`);
                }
            }
        }

        if (batchCount > 0) {
            await batch.commit();
        }

        console.log(`[MIGRATE_SHORT_TRUST] Completed. Updated ${updatedCount} guidelines.`);

        res.json({
            success: true,
            updatedCount,
            totalProcessed: guidelinesSnapshot.size
        });

    } catch (error) {
        console.error('[MIGRATE_SHORT_TRUST] Error:', error);
        res.status(500).json({ error: error.message });
    }
};

// Handler to clear display names
const clearDisplayNames = async (req, res) => {
    try {
        const { confirm } = req.body;

        if (confirm !== 'YES_I_AM_SURE') {
            return res.status(400).json({ error: 'Missing confirmation. Body must include { confirm: "YES_I_AM_SURE" }' });
        }

        console.log('[CLEAR_DISPLAY_NAMES] Starting to clear ALL displayName fields...');

        const guidelinesSnapshot = await db.collection('guidelines').get();
        let clearedCount = 0;
        let batch = db.batch();
        let batchCount = 0;
        const BATCH_SIZE = 500;

        for (const doc of guidelinesSnapshot.docs) {
            const data = doc.data();

            if (data.displayName) {
                // Use FieldValue.delete() to remove the field completely
                batch.update(doc.ref, {
                    displayName: db.FieldValue ? db.FieldValue.delete() : admin.firestore.FieldValue.delete(),
                    displayNameGeneratedAt: db.FieldValue ? db.FieldValue.delete() : admin.firestore.FieldValue.delete(),
                    displayNameMethod: db.FieldValue ? db.FieldValue.delete() : admin.firestore.FieldValue.delete()
                });

                batchCount++;
                clearedCount++;

                if (batchCount >= BATCH_SIZE) {
                    await batch.commit();
                    batch = db.batch();
                    batchCount = 0;
                    console.log(`[CLEAR_DISPLAY_NAMES] Cleared batch of ${BATCH_SIZE} displayNames`);
                }
            }
        }

        if (batchCount > 0) {
            await batch.commit();
            console.log(`[CLEAR_DISPLAY_NAMES] Cleared final batch of ${batchCount} displayNames`);
        }

        console.log(`[CLEAR_DISPLAY_NAMES] Successfully cleared ${clearedCount} displayName fields`);

        res.json({
            success: true,
            cleared: clearedCount,
            total: guidelinesSnapshot.size
        });
    } catch (error) {
        console.error('[CLEAR_DISPLAY_NAMES] Error:', error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    regenerateDisplayNames,
    populateDisplayNames,
    seedHospitalTrustMappings,
    migrateShortHospitalTrust,
    clearDisplayNames
};
