/**
 * Script to seed the hospitalTrustMappings collection in Firestore
 * 
 * This creates a mapping between full trust names and their abbreviated versions
 * for use in displayName generation.
 * 
 * Usage:
 *   node scripts/seed_hospital_trust_mappings.js
 */

const admin = require('firebase-admin');
require('dotenv').config();

// Initialize Firebase Admin (matching server.js approach)
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

// Hospital trust name mappings (full name -> short/acronym)
const trustMappings = [
  { fullName: "University Hospitals Sussex NHS Foundation Trust", shortName: "UHSussex" },
  { fullName: "Shrewsbury and Telford Hospital NHS Trust", shortName: "SaTH" },
  { fullName: "Airedale NHS Foundation Trust", shortName: "Airedale" },
  { fullName: "Ashford and St Peter's Hospitals NHS Foundation Trust", shortName: "ASPH" },
  { fullName: "Barking, Havering and Redbridge University Hospitals NHS Trust", shortName: "BHRUT" },
  { fullName: "Barnsley Hospital NHS Foundation Trust", shortName: "Barnsley" },
  { fullName: "Barts Health NHS Trust", shortName: "Barts Health" },
  { fullName: "Bedford Hospital NHS Trust", shortName: "Bedford" },
  { fullName: "Birmingham Women's and Children's NHS Foundation Trust", shortName: "BWC" },
  { fullName: "Blackpool Teaching Hospitals NHS Foundation Trust", shortName: "Blackpool" },
  { fullName: "Bradford Teaching Hospitals NHS Foundation Trust", shortName: "BTHFT" },
  { fullName: "Brighton and Sussex University Hospitals NHS Trust", shortName: "BSUH" },
  { fullName: "Buckinghamshire Healthcare NHS Trust", shortName: "Bucks Healthcare" },
  { fullName: "Cambridge University Hospitals NHS Foundation Trust", shortName: "CUH" },
  { fullName: "Cardiff and Vale University Health Board", shortName: "Cardiff & Vale" },
  { fullName: "Central Manchester University Hospitals NHS Foundation Trust", shortName: "CMFT" },
  { fullName: "Chelsea and Westminster Hospital NHS Foundation Trust", shortName: "Chelwest" },
  { fullName: "Chesterfield Royal Hospital NHS Foundation Trust", shortName: "Chesterfield Royal" },
  { fullName: "Countess of Chester Hospital NHS Foundation Trust", shortName: "COCH" },
  { fullName: "County Durham and Darlington NHS Foundation Trust", shortName: "CDDFT" },
  { fullName: "Cwm Taf Morgannwg University Health Board", shortName: "CTMUHB" },
  { fullName: "Derby Teaching Hospitals NHS Foundation Trust", shortName: "Derby Teaching" },
  { fullName: "Doncaster and Bassetlaw Teaching Hospitals NHS Foundation Trust", shortName: "DBTH" },
  { fullName: "East Kent Hospitals University NHS Foundation Trust", shortName: "EKHUFT" },
  { fullName: "East Lancashire Hospitals NHS Trust", shortName: "ELHT" },
  { fullName: "East Suffolk and North Essex NHS Foundation Trust", shortName: "ESNEFT" },
  { fullName: "Epsom and St Helier University Hospitals NHS Trust", shortName: "ESTH" },
  { fullName: "Frimley Health NHS Foundation Trust", shortName: "Frimley Health" },
  { fullName: "Gateshead Health NHS Foundation Trust", shortName: "Gateshead" },
  { fullName: "George Eliot Hospital NHS Trust", shortName: "George Eliot" },
  { fullName: "Gloucestershire Hospitals NHS Foundation Trust", shortName: "Gloucestershire" },
  { fullName: "Great Ormond Street Hospital for Children NHS Foundation Trust", shortName: "GOSH" },
  { fullName: "Great Western Hospitals NHS Foundation Trust", shortName: "GWH" },
  { fullName: "Guy's and St Thomas' NHS Foundation Trust", shortName: "GSTT" },
  { fullName: "Hampshire Hospitals NHS Foundation Trust", shortName: "HHFT" },
  { fullName: "Harrogate and District NHS Foundation Trust", shortName: "Harrogate" },
  { fullName: "Hywel Dda University Health Board", shortName: "Hywel Dda" },
  { fullName: "Imperial College Healthcare NHS Trust", shortName: "Imperial" },
  { fullName: "Ipswich Hospital NHS Trust", shortName: "Ipswich" },
  { fullName: "James Paget University Hospitals NHS Foundation Trust", shortName: "James Paget" },
  { fullName: "King's College Hospital NHS Foundation Trust", shortName: "KCH" },
  { fullName: "Kingston Hospital NHS Foundation Trust", shortName: "Kingston" },
  { fullName: "Lancashire Teaching Hospitals NHS Foundation Trust", shortName: "LTHTR" },
  { fullName: "Leeds Teaching Hospitals NHS Trust", shortName: "LTHT" },
  { fullName: "Leicester Royal Infirmary", shortName: "LRI" },
  { fullName: "Lewisham and Greenwich NHS Trust", shortName: "L&G" },
  { fullName: "Liverpool University Hospitals NHS Foundation Trust", shortName: "LUFT" },
  { fullName: "Liverpool Women's NHS Foundation Trust", shortName: "Liverpool Women's" },
  { fullName: "London North West University Healthcare NHS Trust", shortName: "LNWH" },
  { fullName: "Luton and Dunstable University Hospital NHS Foundation Trust", shortName: "L&D" },
  { fullName: "Maidstone and Tunbridge Wells NHS Trust", shortName: "MTW" },
  { fullName: "Manchester University NHS Foundation Trust", shortName: "MFT" },
  { fullName: "Mid Cheshire Hospitals NHS Foundation Trust", shortName: "Mid Cheshire" },
  { fullName: "Mid Yorkshire Hospitals NHS Trust", shortName: "Mid Yorks" },
  { fullName: "Milton Keynes University Hospital NHS Foundation Trust", shortName: "MKUH" },
  { fullName: "Newcastle upon Tyne Hospitals NHS Foundation Trust", shortName: "NUTH" },
  { fullName: "Norfolk and Norwich University Hospitals NHS Foundation Trust", shortName: "NNUH" },
  { fullName: "North Bristol NHS Trust", shortName: "NBT" },
  { fullName: "North Cumbria Integrated Care NHS Foundation Trust", shortName: "NCIC" },
  { fullName: "North Middlesex University Hospital NHS Trust", shortName: "NMUH" },
  { fullName: "North Tees and Hartlepool NHS Foundation Trust", shortName: "NTH" },
  { fullName: "Northampton General Hospital NHS Trust", shortName: "NGH" },
  { fullName: "Northern Devon Healthcare NHS Trust", shortName: "Northern Devon" },
  { fullName: "Northumbria Healthcare NHS Foundation Trust", shortName: "Northumbria" },
  { fullName: "Nottingham University Hospitals NHS Trust", shortName: "NUH" },
  { fullName: "Oxford University Hospitals NHS Foundation Trust", shortName: "OUH" },
  { fullName: "Pennine Acute Hospitals NHS Trust", shortName: "Pennine Acute" },
  { fullName: "Plymouth Hospitals NHS Trust", shortName: "Plymouth" },
  { fullName: "Portsmouth Hospitals University NHS Trust", shortName: "PHU" },
  { fullName: "Powys Teaching Health Board", shortName: "Powys" },
  { fullName: "Queen Victoria Hospital NHS Foundation Trust", shortName: "QVH" },
  { fullName: "Royal Berkshire NHS Foundation Trust", shortName: "Royal Berkshire" },
  { fullName: "Royal Cornwall Hospitals NHS Trust", shortName: "Royal Cornwall" },
  { fullName: "Royal Devon University Healthcare NHS Foundation Trust", shortName: "RDUH" },
  { fullName: "Royal Free London NHS Foundation Trust", shortName: "Royal Free" },
  { fullName: "Royal Surrey NHS Foundation Trust", shortName: "Royal Surrey" },
  { fullName: "Royal United Hospitals Bath NHS Foundation Trust", shortName: "RUH Bath" },
  { fullName: "Salisbury NHS Foundation Trust", shortName: "Salisbury" },
  { fullName: "Sandwell and West Birmingham Hospitals NHS Trust", shortName: "SWBH" },
  { fullName: "Sheffield Teaching Hospitals NHS Foundation Trust", shortName: "STH" },
  { fullName: "Sherwood Forest Hospitals NHS Foundation Trust", shortName: "SFH" },
  { fullName: "South Tees Hospitals NHS Foundation Trust", shortName: "South Tees" },
  { fullName: "South Tyneside and Sunderland NHS Foundation Trust", shortName: "STSFT" },
  { fullName: "South Warwickshire NHS Foundation Trust", shortName: "SWFT" },
  { fullName: "Southampton University Hospitals NHS Trust", shortName: "Southampton" },
  { fullName: "Southend University Hospital NHS Foundation Trust", shortName: "Southend" },
  { fullName: "St George's University Hospitals NHS Foundation Trust", shortName: "St George's" },
  { fullName: "Stockport NHS Foundation Trust", shortName: "Stockport" },
  { fullName: "Surrey and Sussex Healthcare NHS Trust", shortName: "SASH" },
  { fullName: "Swansea Bay University Health Board", shortName: "SBUHB" },
  { fullName: "Tameside and Glossop Integrated Care NHS Foundation Trust", shortName: "Tameside & Glossop" },
  { fullName: "The Dudley Group NHS Foundation Trust", shortName: "Dudley Group" },
  { fullName: "The Hillingdon Hospitals NHS Foundation Trust", shortName: "Hillingdon" },
  { fullName: "The Princess Alexandra Hospital NHS Trust", shortName: "PAH" },
  { fullName: "The Queen Elizabeth Hospital King's Lynn NHS Foundation Trust", shortName: "QEKL" },
  { fullName: "The Rotherham NHS Foundation Trust", shortName: "Rotherham" },
  { fullName: "The Royal Marsden NHS Foundation Trust", shortName: "Royal Marsden" },
  { fullName: "The Royal Wolverhampton NHS Trust", shortName: "RWT" },
  { fullName: "Torbay and South Devon NHS Foundation Trust", shortName: "TSDFT" },
  { fullName: "United Lincolnshire Hospitals NHS Trust", shortName: "ULHT" },
  { fullName: "University College London Hospitals NHS Foundation Trust", shortName: "UCLH" },
  { fullName: "University Hospital Southampton NHS Foundation Trust", shortName: "UHS" },
  { fullName: "University Hospitals Birmingham NHS Foundation Trust", shortName: "UHB" },
  { fullName: "University Hospitals Bristol and Weston NHS Foundation Trust", shortName: "UHBW" },
  { fullName: "University Hospitals Coventry and Warwickshire NHS Trust", shortName: "UHCW" },
  { fullName: "University Hospitals Dorset NHS Foundation Trust", shortName: "UHD" },
  { fullName: "University Hospitals of Derby and Burton NHS Foundation Trust", shortName: "UHDB" },
  { fullName: "University Hospitals of Leicester NHS Trust", shortName: "UHL" },
  { fullName: "University Hospitals of Morecambe Bay NHS Foundation Trust", shortName: "UHMB" },
  { fullName: "University Hospitals of North Midlands NHS Trust", shortName: "UHNM" },
  { fullName: "University Hospitals Plymouth NHS Trust", shortName: "UHP" },
  { fullName: "Walsall Healthcare NHS Trust", shortName: "Walsall" },
  { fullName: "Warrington and Halton Teaching Hospitals NHS Foundation Trust", shortName: "WHH" },
  { fullName: "West Hertfordshire Hospitals NHS Trust", shortName: "West Herts" },
  { fullName: "West Suffolk NHS Foundation Trust", shortName: "West Suffolk" },
  { fullName: "Weston Area Health NHS Trust", shortName: "Weston" },
  { fullName: "Whittington Health NHS Trust", shortName: "Whittington" },
  { fullName: "Wirral University Teaching Hospital NHS Foundation Trust", shortName: "WUTH" },
  { fullName: "Worcestershire Acute Hospitals NHS Trust", shortName: "Worcestershire Acute" },
  { fullName: "Wrightington, Wigan and Leigh NHS Foundation Trust", shortName: "WWL" },
  { fullName: "Wye Valley NHS Trust", shortName: "Wye Valley" },
  { fullName: "Yeovil District Hospital NHS Foundation Trust", shortName: "Yeovil" },
  { fullName: "York Teaching Hospital NHS Foundation Trust", shortName: "York Teaching" }
];

async function seedHospitalTrustMappings() {
  console.log(`\nSeeding ${trustMappings.length} hospital trust mappings to Firestore...\n`);
  
  const BATCH_SIZE = 500; // Firestore batch limit
  let batch = db.batch();
  let batchCount = 0;
  let totalCount = 0;
  
  try {
    // First, check if collection already has data
    const existingSnapshot = await db.collection('hospitalTrustMappings').limit(1).get();
    if (!existingSnapshot.empty) {
      console.log('⚠ Collection already contains data. Deleting existing documents first...');
      
      // Delete all existing documents
      const allDocs = await db.collection('hospitalTrustMappings').get();
      let deleteBatch = db.batch();
      let deleteCount = 0;
      
      for (const doc of allDocs.docs) {
        deleteBatch.delete(doc.ref);
        deleteCount++;
        
        if (deleteCount >= BATCH_SIZE) {
          await deleteBatch.commit();
          console.log(`  Deleted ${deleteCount} documents...`);
          deleteBatch = db.batch();
          deleteCount = 0;
        }
      }
      
      if (deleteCount > 0) {
        await deleteBatch.commit();
        console.log(`  Deleted ${deleteCount} documents...`);
      }
      
      console.log(`✓ Cleared existing collection\n`);
      batch = db.batch(); // Reset batch after deletion
    }
    
    // Add all mappings
    for (const mapping of trustMappings) {
      // Use a clean document ID based on a hash of the full name
      const docId = mapping.fullName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 100); // Firestore doc ID limit
      
      const docRef = db.collection('hospitalTrustMappings').doc(docId);
      
      batch.set(docRef, {
        fullName: mapping.fullName,
        shortName: mapping.shortName,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      batchCount++;
      totalCount++;
      
      // Commit batch when it reaches the limit
      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        console.log(`  Committed batch of ${batchCount} mappings (${totalCount}/${trustMappings.length} total)`);
        batch = db.batch();
        batchCount = 0;
      }
    }
    
    // Commit remaining mappings
    if (batchCount > 0) {
      await batch.commit();
      console.log(`  Committed final batch of ${batchCount} mappings`);
    }
    
    console.log(`\n✓ Successfully seeded ${totalCount} hospital trust mappings to Firestore`);
    
    // Verify by reading a sample
    const sampleDoc = await db.collection('hospitalTrustMappings')
      .where('fullName', '==', 'University Hospitals Sussex NHS Foundation Trust')
      .limit(1)
      .get();
    
    if (!sampleDoc.empty) {
      const sample = sampleDoc.docs[0].data();
      console.log(`\n✓ Verification: "${sample.fullName}" -> "${sample.shortName}"`);
    }
    
  } catch (error) {
    console.error('Error seeding hospital trust mappings:', error);
    throw error;
  }
}

// Run the script
seedHospitalTrustMappings()
  .then(() => {
    console.log('\n✓ Seeding complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Seeding failed:', error);
    process.exit(1);
  });


