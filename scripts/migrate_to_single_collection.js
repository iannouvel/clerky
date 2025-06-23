#!/usr/bin/env node

/**
 * Migration script to consolidate Firestore collections into single 'guidelines' collection
 * This fixes the redundant structure where data is stored in multiple collections
 */

const admin = require('firebase-admin');
const fs = require('fs');

// Initialize Firebase Admin SDK
const serviceAccount = require('../gcloud_key.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function migrateToSingleCollection() {
  console.log('Starting migration to single collection...');
  
  try {
    const [guidelines, summaries, keywords, condensed] = await Promise.all([
      db.collection('guidelines').get(),
      db.collection('summaries').get().catch(() => ({ docs: [] })),
      db.collection('keywords').get().catch(() => ({ docs: [] })),
      db.collection('condensed').get().catch(() => ({ docs: [] }))
    ]);

    console.log(`Found ${guidelines.size} guidelines, ${summaries.docs.length} summaries, ${keywords.docs.length} keywords, ${condensed.docs.length} condensed`);

    const consolidatedData = new Map();

    // Start with main guidelines
    guidelines.forEach(doc => {
      consolidatedData.set(doc.id, { id: doc.id, ...doc.data() });
    });

    // Merge summaries
    summaries.docs.forEach(doc => {
      if (consolidatedData.has(doc.id)) {
        consolidatedData.get(doc.id).summary = doc.data().summary;
      }
    });

    // Merge keywords  
    keywords.docs.forEach(doc => {
      if (consolidatedData.has(doc.id)) {
        consolidatedData.get(doc.id).keywords = doc.data().keywords;
      }
    });

    // Merge condensed
    condensed.docs.forEach(doc => {
      if (consolidatedData.has(doc.id)) {
        consolidatedData.get(doc.id).condensed = doc.data().condensed;
      }
    });

    // Write consolidated data back
    const batch = db.batch();
    for (const [docId, data] of consolidatedData) {
      batch.set(db.collection('guidelines').doc(docId), data);
    }

    await batch.commit();
    console.log(`✅ Migrated ${consolidatedData.size} guidelines`);

    return { success: true, migrated: consolidatedData.size };
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

// Allow deletion of old collections after migration
async function deleteOldCollections() {
  console.log('🗑️  Deleting old redundant collections...\n');
  
  const collectionsToDelete = [
    'summaries',
    'keywords', 
    'condensed',
    'guidelineSummaries',
    'guidelineKeywords',
    'guidelineCondensed'
  ];

  for (const collectionName of collectionsToDelete) {
    try {
      const snapshot = await db.collection(collectionName).get();
      if (!snapshot.empty) {
        console.log(`🗑️  Deleting ${snapshot.size} documents from ${collectionName}...`);
        
        const batch = db.batch();
        snapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        await batch.commit();
        console.log(`✅ Deleted ${collectionName} collection`);
      } else {
        console.log(`ℹ️  Collection ${collectionName} is already empty`);
      }
    } catch (error) {
      console.log(`⚠️  Could not delete ${collectionName}:`, error.message);
    }
  }
  
  console.log('\n🎉 Old collections cleanup completed!');
}

// Run migration
if (require.main === module) {
  migrateToSingleCollection()
    .then(() => console.log('Migration complete!'))
    .catch(console.error);
}

// Handle cleanup flag
if (process.argv.includes('--delete-old')) {
  deleteOldCollections()
    .then(() => {
      console.log('✅ Cleanup completed!');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Cleanup failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateToSingleCollection, deleteOldCollections }; 