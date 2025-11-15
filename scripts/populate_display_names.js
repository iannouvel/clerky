/**
 * Script to populate displayName field for all existing guidelines
 * 
 * Usage:
 *   node scripts/populate_display_names.js [guidelineId]
 * 
 * If guidelineId is provided, only that guideline will be updated.
 * Otherwise, all guidelines will be updated.
 */

const admin = require('firebase-admin');
require('dotenv').config(); // Load environment variables

// Initialize Firebase Admin (matching server.js approach)
if (!admin.apps.length) {
  // Get private key from environment and handle newline escaping
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  
  const serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: privateKey
  };
  
  // Validate all required fields
  if (!serviceAccount.projectId || !serviceAccount.clientEmail || !serviceAccount.privateKey) {
    console.error('Error: Missing required Firebase configuration fields');
    console.error('Please ensure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY are set in .env file');
    process.exit(1);
  }
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: 'clerky-b3be8.firebasestorage.app'
  });
  
  console.log('✓ Firebase Admin SDK initialized successfully');
}

const db = admin.firestore();

// Import the generateDisplayName function from server.js
// Since we can't easily import it, we'll duplicate the logic here
function cleanHumanFriendlyName(rawName) {
  if (!rawName || typeof rawName !== 'string') {
    return rawName;
  }
  
  let cleaned = rawName.trim();
  
  // Remove common AI response prefixes
  cleaned = cleaned.replace(/^(The\s+)?(human-friendly\s+name\s+or\s+short\s+title\s+of\s+this\s+guideline\s+is\s*[:"]*\s*)/i, '');
  cleaned = cleaned.replace(/^(Human-friendly\s+name\s+or\s+short\s+title\s+of\s+the\s+guideline\s*[:"]*\s*)/i, '');
  cleaned = cleaned.replace(/^(Title\s*[:]*\s*)/i, '');
  cleaned = cleaned.replace(/^(The\s+short\s+title\s+of\s+this\s+guideline\s+is\s*[:"]*\s*)/i, '');
  
  // Remove internal reference codes at the beginning (MP053, CG12004, etc.)
  cleaned = cleaned.replace(/^(MP|CG|SP|MD|GP|GAU)\d+\s*[-:]?\s*/i, '');
  
  // Remove common prefixes that don't add value
  cleaned = cleaned.replace(/^(Guideline|Protocol|Policy|Standard|Procedure)\s*[-:]?\s*/i, '');
  
  // Remove relevance scores and parenthetical information at the end
  cleaned = cleaned.replace(/\s*\([^)]*relevance[^)]*\)$/i, '');
  cleaned = cleaned.replace(/\s*\([^)]*score[^)]*\)$/i, '');
  cleaned = cleaned.replace(/\s*\(high\s+relevance[^)]*\)$/i, '');
  cleaned = cleaned.replace(/\s*\(medium\s+relevance[^)]*\)$/i, '');
  cleaned = cleaned.replace(/\s*\(low\s+relevance[^)]*\)$/i, '');
  cleaned = cleaned.replace(/\s*\(not\s+relevant[^)]*\)$/i, '');
  
  // Remove standalone numeric scores in parentheses at the end
  cleaned = cleaned.replace(/\s*\(\d*\.?\d+\)$/g, '');
  
  // Remove version information in parentheses
  cleaned = cleaned.replace(/\s*\(v?\d+(\.\d+)?\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*\(version\s*\d+(\.\d+)?\)\s*$/i, '');
  
  // Remove file extensions
  cleaned = cleaned.replace(/\.(pdf|doc|docx|txt)$/i, '');
  
  // Remove quotes at the beginning and end
  cleaned = cleaned.replace(/^["']|["']$/g, '');
  
  // Remove trailing periods that aren't part of abbreviations
  cleaned = cleaned.replace(/\.$/, '');
  
  // Common abbreviation expansions for better readability
  const abbreviationMappings = {
    'APH': 'Antepartum Haemorrhage',
    'PPH': 'Postpartum Haemorrhage',
    'BSOTS': 'Blood Saving in Obstetric Theatres',
    'BAC': 'Birth After Caesarean',
    'LSCS': 'Lower Segment Caesarean Section',
    'CTG': 'Cardiotocography',
    'FHR': 'Fetal Heart Rate',
    'PCOS': 'Polycystic Ovary Syndrome',
    'IVF': 'In Vitro Fertilisation',
    'ICSI': 'Intracytoplasmic Sperm Injection'
  };
  
  // Apply abbreviation expansions for standalone abbreviations at the start
  Object.entries(abbreviationMappings).forEach(([abbrev, expansion]) => {
    const regex = new RegExp(`^${abbrev}\\b`, 'i');
    if (regex.test(cleaned)) {
      cleaned = cleaned.replace(regex, expansion);
    }
  });
  
  // Clean up multiple spaces and normalize spacing
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // Capitalize first letter if it's not already
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  
  return cleaned;
}

function generateDisplayName(rawName) {
  if (!rawName || typeof rawName !== 'string') {
    return rawName;
  }
  
  // Start with the base cleaning function
  let cleaned = cleanHumanFriendlyName(rawName);
  
  // Remove "UHSx" prefixes (case-insensitive, with optional space after)
  cleaned = cleaned.replace(/^UHSx\s*/i, '');
  
  // Remove hash codes like "UHS-CG-0009-2023" (pattern: UHS-CG-digits-digits)
  cleaned = cleaned.replace(/\bUHS-CG-\d+-\d+\b/gi, '');
  
  // Remove version numbers in various formats (v0.0.1, V2, v1.2.3, etc.)
  cleaned = cleaned.replace(/\s+v\d+(\.\d+)*(\.\d+)?\b/gi, '');
  cleaned = cleaned.replace(/\s+V\d+\b/g, '');
  cleaned = cleaned.replace(/\s+version\s+\d+(\.\d+)?/gi, '');
  
  // Remove dates in various formats (2020-10, 2011v2, etc.)
  cleaned = cleaned.replace(/\b\d{4}-\d{1,2}\b/g, ''); // YYYY-MM format
  cleaned = cleaned.replace(/\b\d{4}v\d+\b/gi, ''); // YYYYvN format
  cleaned = cleaned.replace(/\b\d{4}\s+\d{1,2}\b/g, ''); // YYYY MM format
  
  // Remove "Appendix X" prefixes (case-insensitive)
  cleaned = cleaned.replace(/^Appendix\s+\d+\s+/i, '');
  
  // Remove "Proforma" suffixes (case-insensitive, with optional text before)
  cleaned = cleaned.replace(/\s+Proforma\s*$/i, '');
  cleaned = cleaned.replace(/\s+-\s*Proforma\s*$/i, '');
  
  // Remove common suffixes like "FINAL", "DRAFT", etc.
  cleaned = cleaned.replace(/\s+(FINAL|DRAFT|REVISED|UPDATED)\s*$/i, '');
  
  // Remove parenthetical hash codes and reference codes
  cleaned = cleaned.replace(/\s*\([^)]*UHS[^)]*\)/gi, '');
  cleaned = cleaned.replace(/\s*\([^)]*CG-\d+[^)]*\)/gi, '');
  
  // Remove standalone reference codes (e.g., "PID Proforma - June 2011v2")
  cleaned = cleaned.replace(/\b(PID|GAU|MP|CG|SP|MD|GP)\s+Proforma\s*/gi, '');
  
  // Fix capitalization - Title Case for main words, lowercase for articles/prepositions
  // List of words that should be lowercase (unless first word)
  const lowercaseWords = ['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 
                          'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with'];
  
  // Split into words and capitalize appropriately
  const words = cleaned.split(/\s+/);
  const titleCased = words.map((word, index) => {
    if (word.length === 0) return word;
    
    // Always capitalize first word
    if (index === 0) {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }
    
    // Lowercase articles/prepositions unless they're acronyms (all caps)
    if (lowercaseWords.includes(word.toLowerCase()) && word !== word.toUpperCase()) {
      return word.toLowerCase();
    }
    
    // Capitalize first letter, lowercase rest
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
  
  cleaned = titleCased.join(' ');
  
  // Clean up multiple spaces and normalize spacing
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // Remove leading/trailing dashes and spaces
  cleaned = cleaned.replace(/^[- ]+|[- ]+$/g, '');
  
  // Ensure first letter is capitalized
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  
  return cleaned;
}

async function populateDisplayNames(guidelineId = null, force = false) {
  try {
    if (guidelineId) {
      // Update single guideline
      const guidelineRef = db.collection('guidelines').doc(guidelineId);
      const doc = await guidelineRef.get();
      
      if (!doc.exists) {
        console.error(`Guideline not found: ${guidelineId}`);
        return { success: false, error: 'Guideline not found' };
      }
      
      const data = doc.data();
      const sourceName = data.humanFriendlyName || data.title || data.filename;
      
      if (!sourceName) {
        console.error(`No source name found for guideline: ${guidelineId}`);
        return { success: false, error: 'No source name found' };
      }
      
      const displayName = generateDisplayName(sourceName);
      
      await guidelineRef.update({
        displayName: displayName,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
      
      console.log(`✓ Updated ${guidelineId}: "${sourceName}" -> "${displayName}"`);
      
      return {
        success: true,
        updated: 1,
        results: [{
          guidelineId: guidelineId,
          oldTitle: sourceName,
          newDisplayName: displayName
        }]
      };
    }
    
    // Update all guidelines
    const guidelinesSnapshot = await db.collection('guidelines').get();
    const results = [];
    let updatedCount = 0;
    let batch = db.batch();
    let batchCount = 0;
    const BATCH_SIZE = 500; // Firestore batch limit
    
    console.log(`Processing ${guidelinesSnapshot.size} guidelines...`);
    
    for (const doc of guidelinesSnapshot.docs) {
      const data = doc.data();
      
      // Skip if displayName already exists (unless force flag is set)
      if (data.displayName && !force) {
        continue;
      }
      
      const sourceName = data.humanFriendlyName || data.title || data.filename;
      
      if (!sourceName) {
        results.push({
          guidelineId: doc.id,
          success: false,
          error: 'No source name found'
        });
        continue;
      }
      
      const displayName = generateDisplayName(sourceName);
      const guidelineRef = db.collection('guidelines').doc(doc.id);
      
      batch.update(guidelineRef, {
        displayName: displayName,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
      
      batchCount++;
      updatedCount++;
      
      results.push({
        guidelineId: doc.id,
        success: true,
        oldTitle: sourceName,
        newDisplayName: displayName
      });
      
      // Commit batch when it reaches the limit
      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        console.log(`Committed batch of ${batchCount} updates (${updatedCount}/${guidelinesSnapshot.size} total)`);
        batch = db.batch(); // Create new batch
        batchCount = 0;
      }
    }
    
    // Commit remaining updates
    if (batchCount > 0) {
      await batch.commit();
      console.log(`Committed final batch of ${batchCount} updates`);
    }
    
    console.log(`\n✓ Successfully updated ${updatedCount} guidelines`);
    
    return {
      success: true,
      updated: updatedCount,
      total: guidelinesSnapshot.size,
      results: results
    };
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

// Run the script
const guidelineId = process.argv[2] || null;
const force = process.argv.includes('--force');

populateDisplayNames(guidelineId, force)
  .then(result => {
    console.log('\nResult:', JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });

