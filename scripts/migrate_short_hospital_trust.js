/**
 * Migration script to backfill shortHospitalTrust field for existing guidelines
 * and regenerate displayNames with the new format.
 * 
 * Usage:
 *   node scripts/migrate_short_hospital_trust.js [--dry-run] [--regenerate-display]
 * 
 * Options:
 *   --dry-run            Show what would be updated without making changes
 *   --regenerate-display Also regenerate displayNames for updated guidelines
 *   --force              Update all guidelines even if shortHospitalTrust already exists
 */

const admin = require('firebase-admin');
require('dotenv').config();

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const REGENERATE_DISPLAY = args.includes('--regenerate-display');
const FORCE = args.includes('--force');

// Initialize Firebase Admin
if (!admin.apps.length) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  
  const serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: privateKey
  };
  
  if (!serviceAccount.projectId || !serviceAccount.clientEmail || !serviceAccount.privateKey) {
    console.error('Error: Missing required Firebase configuration fields');
    console.error('Please ensure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY are set in .env file');
    process.exit(1);
  }
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: 'clerky-b3be8.firebasestorage.app'
  });
  
  console.log('✓ Firebase Admin SDK initialised successfully');
}

const db = admin.firestore();

// Load hospital trust mappings from Firestore
async function loadHospitalTrustMappings() {
  console.log('\nLoading hospital trust mappings from Firestore...');
  
  const snapshot = await db.collection('hospitalTrustMappings').get();
  
  const mappings = new Map();
  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.fullName && data.shortName) {
      mappings.set(data.fullName, data.shortName);
    }
  });
  
  console.log(`✓ Loaded ${mappings.size} trust mappings`);
  return mappings;
}

// Generate an acronym fallback
function generateTrustAcronym(trustName) {
  if (!trustName) return '';
  
  let cleanName = trustName
    .replace(/\s+NHS\s+(Foundation\s+)?Trust$/i, '')
    .replace(/\s+University\s+Health\s+Board$/i, '')
    .replace(/\s+Health\s+Board$/i, '')
    .replace(/\s+Healthcare\s+NHS\s+Trust$/i, '')
    .trim();
  
  if (cleanName.split(/\s+/).length <= 2 && cleanName.length <= 15) {
    return cleanName;
  }
  
  const words = cleanName.split(/\s+/);
  const acronym = words
    .filter(word => word.length > 2 || /^(of|and|the)$/i.test(word) === false)
    .map(word => word.charAt(0).toUpperCase())
    .join('');
  
  return acronym || cleanName.substring(0, 10);
}

// Get short trust name from mappings or generate fallback
function getShortHospitalTrust(fullName, mappings) {
  if (!fullName) return null;
  
  // Check exact match
  if (mappings.has(fullName)) {
    return mappings.get(fullName);
  }
  
  // Try case-insensitive match
  for (const [key, value] of mappings) {
    if (key.toLowerCase() === fullName.toLowerCase()) {
      return value;
    }
  }
  
  // Fallback to generated acronym
  console.log(`  ⚠ No mapping found for "${fullName}", generating acronym`);
  return generateTrustAcronym(fullName);
}

// Simple rule-based display name generation (fallback)
function generateDisplayName(rawName, scope, shortTrust) {
  if (!rawName) return rawName;
  
  let cleaned = rawName.trim();
  
  // Remove common prefixes/codes
  cleaned = cleaned.replace(/^(MP|CG|SP|MD|GP|GAU)\d+\s*[-:]?\s*/i, '');
  cleaned = cleaned.replace(/^UHSx\s*/i, '');
  cleaned = cleaned.replace(/\bUHS-CG-\d+-\d+\b/gi, '');
  
  // Remove version numbers
  cleaned = cleaned.replace(/\s+v\d+(\.\d+)*(\.\d+)?\b/gi, '');
  cleaned = cleaned.replace(/\s+V\d+\b/g, '');
  
  // Remove dates
  cleaned = cleaned.replace(/\b\d{4}-\d{1,2}\b/g, '');
  cleaned = cleaned.replace(/\b\d{4}v\d+\b/gi, '');
  
  // Clean up extra spaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  cleaned = cleaned.replace(/^[-\s]+|[-\s]+$/g, '');
  
  // Build display name
  let displayName = cleaned;
  
  if (scope === 'local' && shortTrust) {
    displayName = `${cleaned} - Local - ${shortTrust}`;
  } else if (scope === 'national') {
    displayName = `${cleaned} - National`;
  }
  
  return displayName;
}

async function migrateShortHospitalTrust() {
  console.log('\n=== Hospital Trust Short Name Migration ===\n');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log(`Regenerate displayNames: ${REGENERATE_DISPLAY ? 'Yes' : 'No'}`);
  console.log(`Force update all: ${FORCE ? 'Yes' : 'No'}`);
  
  // Load mappings first
  const mappings = await loadHospitalTrustMappings();
  
  if (mappings.size === 0) {
    console.error('\n✗ No hospital trust mappings found in Firestore!');
    console.error('Please run: node scripts/seed_hospital_trust_mappings.js first');
    process.exit(1);
  }
  
  // Query guidelines that have hospitalTrust set
  console.log('\nQuerying guidelines with hospitalTrust...');
  
  const guidelinesSnapshot = await db.collection('guidelines')
    .where('hospitalTrust', '!=', null)
    .get();
  
  console.log(`Found ${guidelinesSnapshot.size} guidelines with hospitalTrust field`);
  
  const results = {
    updated: 0,
    skipped: 0,
    errors: 0,
    details: []
  };
  
  const BATCH_SIZE = 500;
  let batch = db.batch();
  let batchCount = 0;
  
  for (const doc of guidelinesSnapshot.docs) {
    const data = doc.data();
    const hospitalTrust = data.hospitalTrust;
    
    // Skip if already has shortHospitalTrust (unless force flag)
    if (data.shortHospitalTrust && !FORCE) {
      results.skipped++;
      continue;
    }
    
    // Get short name
    const shortHospitalTrust = getShortHospitalTrust(hospitalTrust, mappings);
    
    if (!shortHospitalTrust) {
      results.errors++;
      results.details.push({
        id: doc.id,
        error: 'Could not generate short trust name',
        hospitalTrust: hospitalTrust
      });
      continue;
    }
    
    // Prepare update
    const updates = {
      shortHospitalTrust: shortHospitalTrust,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    // Optionally regenerate displayName
    if (REGENERATE_DISPLAY) {
      const sourceName = data.humanFriendlyName || data.title || data.filename;
      const scope = data.scope || 'local';
      updates.displayName = generateDisplayName(sourceName, scope, shortHospitalTrust);
    }
    
    results.details.push({
      id: doc.id,
      hospitalTrust: hospitalTrust,
      shortHospitalTrust: shortHospitalTrust,
      displayName: updates.displayName || '(not updated)'
    });
    
    if (!DRY_RUN) {
      batch.update(doc.ref, updates);
      batchCount++;
      
      // Commit batch when full
      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        console.log(`  Committed batch of ${batchCount} updates`);
        batch = db.batch();
        batchCount = 0;
      }
    }
    
    results.updated++;
  }
  
  // Commit remaining updates
  if (!DRY_RUN && batchCount > 0) {
    await batch.commit();
    console.log(`  Committed final batch of ${batchCount} updates`);
  }
  
  // Print results
  console.log('\n=== Migration Results ===');
  console.log(`Updated: ${results.updated}`);
  console.log(`Skipped (already has shortHospitalTrust): ${results.skipped}`);
  console.log(`Errors: ${results.errors}`);
  
  if (results.details.length > 0) {
    console.log('\n=== Sample Updates ===');
    const sampleSize = Math.min(10, results.details.length);
    for (let i = 0; i < sampleSize; i++) {
      const detail = results.details[i];
      if (detail.error) {
        console.log(`  ✗ ${detail.id}: ${detail.error}`);
      } else {
        console.log(`  ✓ ${detail.id}`);
        console.log(`    Trust: ${detail.hospitalTrust} → ${detail.shortHospitalTrust}`);
        if (REGENERATE_DISPLAY && detail.displayName !== '(not updated)') {
          console.log(`    Display: ${detail.displayName}`);
        }
      }
    }
    
    if (results.details.length > sampleSize) {
      console.log(`  ... and ${results.details.length - sampleSize} more`);
    }
  }
  
  if (DRY_RUN) {
    console.log('\n⚠ This was a dry run. No changes were made.');
    console.log('Run without --dry-run to apply changes.');
  }
  
  return results;
}

// Run the migration
migrateShortHospitalTrust()
  .then((results) => {
    console.log('\n✓ Migration complete');
    process.exit(results.errors > 0 ? 1 : 0);
  })
  .catch((error) => {
    console.error('\n✗ Migration failed:', error);
    process.exit(1);
  });






