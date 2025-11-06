#!/usr/bin/env python3
"""
Migration script to move PDFs and processed text from GitHub to Firebase Storage and Firestore.
This script:
1. Reads all PDFs from the guidance/ directory
2. Reads processed text from guidance/condensed/
3. Uploads PDFs to Firebase Storage (pdfs/ folder)
4. Creates/updates Firestore documents with extracted text
5. Generates migration report
"""

import logging
import os
import sys
from pathlib import Path
import hashlib
import firebase_admin
from firebase_admin import credentials, firestore, storage
import time

# Add parent directory to path to import shared modules
sys.path.insert(0, str(Path(__file__).parent))

def init_firebase():
    """Initialize Firebase Admin SDK"""
    try:
        firebase_admin.get_app()
        print("Firebase already initialized")
    except ValueError:
        print("Initializing Firebase...")
        key_path = Path(__file__).parent.parent / 'gcloud_key.json'
        if key_path.exists():
            cred = credentials.Certificate(str(key_path))
        else:
            print("Error: gcloud_key.json not found in project root")
            sys.exit(1)
        
        firebase_admin.initialize_app(cred, {
            'storageBucket': 'clerky-b3be8.firebasestorage.app'
        })
    
    return firestore.client(), storage.bucket()

def calculate_file_hash(file_path):
    """Calculate SHA-256 hash of a file"""
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

def generate_guideline_id(filename):
    """Generate a clean document ID from filename"""
    clean_name = filename.lower()
    if clean_name.endswith('.pdf'):
        clean_name = clean_name[:-4]
    
    # Replace spaces and special characters with hyphens
    import re
    clean_name = re.sub(r'[^a-z0-9\-]', '-', clean_name)
    clean_name = re.sub(r'-+', '-', clean_name)  # Multiple hyphens to single
    clean_name = clean_name.strip('-')  # Remove leading/trailing hyphens
    
    return clean_name

def migrate_guideline(pdf_path, db, bucket, dry_run=False):
    """
    Migrate a single PDF to Firebase
    Returns: dict with migration status
    """
    filename = pdf_path.name
    guideline_id = generate_guideline_id(filename)
    
    result = {
        'filename': filename,
        'guideline_id': guideline_id,
        'status': 'pending',
        'error': None,
        'pdf_uploaded': False,
        'firestore_updated': False,
        'content_length': 0
    }
    
    try:
        logging.info(f"Processing: {filename}")
        
        # Calculate file hash
        file_hash = calculate_file_hash(pdf_path)
        result['file_hash'] = file_hash[:16] + '...'
        
        # Check if already exists in Firestore by hash
        existing = db.collection('guidelines').where('fileHash', '==', file_hash).limit(1).get()
        if len(list(existing)) > 0:
            logging.info(f"  Already exists (by hash): {guideline_id}")
            result['status'] = 'skipped_duplicate'
            return result
        
        if dry_run:
            logging.info(f"  [DRY RUN] Would upload: {filename} -> pdfs/{filename}")
            result['status'] = 'dry_run_success'
            return result
        
        # Upload PDF to Firebase Storage
        logging.info(f"  Uploading PDF to Firebase Storage...")
        blob = bucket.blob(f"pdfs/{filename}")
        blob.upload_from_filename(str(pdf_path), content_type='application/pdf')
        result['pdf_uploaded'] = True
        logging.info(f"  PDF uploaded: pdfs/{filename}")
        
        # Read condensed text if it exists
        condensed_path = pdf_path.parent / 'condensed' / f"{pdf_path.stem}.txt"
        condensed_text = None
        if condensed_path.exists():
            with open(condensed_path, 'r', encoding='utf-8') as f:
                condensed_text = f.read()
            logging.info(f"  Loaded condensed text: {len(condensed_text)} chars")
            result['content_length'] = len(condensed_text)
        
        # Check if Firestore document exists
        doc_ref = db.collection('guidelines').document(guideline_id)
        doc = doc_ref.get()
        
        if doc.exists:
            # Update existing document
            update_data = {
                'filename': filename,
                'originalFilename': filename,
                'fileHash': file_hash,
                'lastUpdated': firestore.SERVER_TIMESTAMP,
                'pdfInStorage': True
            }
            
            if condensed_text:
                update_data['content'] = condensed_text
                update_data['condensed'] = condensed_text
                update_data['contentExtracted'] = True
            
            doc_ref.update(update_data)
            logging.info(f"  Updated Firestore document: {guideline_id}")
        else:
            # Create new document
            doc_data = {
                'id': guideline_id,
                'title': pdf_path.stem,
                'filename': filename,
                'originalFilename': filename,
                'fileHash': file_hash,
                'organisation': 'Unknown',
                'yearProduced': 'Unknown',
                'createdAt': firestore.SERVER_TIMESTAMP,
                'lastUpdated': firestore.SERVER_TIMESTAMP,
                'pdfInStorage': True,
                'contentExtracted': bool(condensed_text),
                'processed': False,
                'keywords': [],
                'categories': [],
                'url': '',
                'metadataComplete': False
            }
            
            if condensed_text:
                doc_data['content'] = condensed_text
                doc_data['condensed'] = condensed_text
            
            doc_ref.set(doc_data)
            logging.info(f"  Created Firestore document: {guideline_id}")
        
        result['firestore_updated'] = True
        result['status'] = 'success'
        
    except Exception as e:
        logging.error(f"  Error migrating {filename}: {str(e)}")
        result['status'] = 'error'
        result['error'] = str(e)
    
    return result

def reprocess_existing_guidelines(db, dry_run=False, fields=None):
    """
    Reprocess existing guidelines for missing content
    """
    import requests
    
    logging.info("Starting reprocessing of existing guidelines...")
    
    # Get all guidelines from Firestore
    guidelines = db.collection('guidelines').stream()
    
    reprocess_count = 0
    skip_count = 0
    error_count = 0
    
    for doc in guidelines:
        guideline_id = doc.id
        data = doc.to_dict()
        
        # Check what's missing
        missing_fields = []
        
        if fields is None or 'summary' in fields:
            if not data.get('summary'):
                missing_fields.append('summary')
        
        if fields is None or 'terms' in fields:
            if not data.get('significantTerms'):
                missing_fields.append('terms')
        
        if fields is None or 'auditable' in fields:
            if not data.get('auditableElements'):
                missing_fields.append('auditable')
        
        if not missing_fields:
            skip_count += 1
            continue
        
        logging.info(f"Guideline {guideline_id} missing: {', '.join(missing_fields)}")
        
        if dry_run:
            logging.info(f"  [DRY RUN] Would reprocess: {guideline_id}")
            reprocess_count += 1
            continue
        
        # Trigger background processing via server endpoint
        try:
            # Note: This requires server to be running and accessible
            # For now, just log that manual processing is needed
            logging.info(f"  Needs manual processing via /processGuidelineBackground endpoint")
            reprocess_count += 1
        except Exception as e:
            logging.error(f"  Error: {str(e)}")
            error_count += 1
    
    logging.info(f"\nReprocessing summary:")
    logging.info(f"  Need reprocessing: {reprocess_count}")
    logging.info(f"  Already complete: {skip_count}")
    logging.info(f"  Errors: {error_count}")

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Migrate PDFs to Firebase Storage and Firestore')
    parser.add_argument('--dry-run', action='store_true', help='Run without making changes')
    parser.add_argument('--limit', type=int, default=None, help='Limit number of PDFs to migrate (for testing)')
    parser.add_argument('--pattern', type=str, default='*.pdf', help='File pattern to match (default: *.pdf)')
    parser.add_argument('--reprocess', action='store_true', help='Reprocess existing guidelines for missing content')
    parser.add_argument('--fields', type=str, help='Comma-separated list of fields to reprocess (summary,terms,auditable)')
    args = parser.parse_args()
    
    # Set up logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler('migration.log'),
            logging.StreamHandler(sys.stdout)
        ]
    )
    
    logging.info("="*80)
    logging.info("Starting migration to Firebase Storage and Firestore")
    logging.info(f"Dry run: {args.dry_run}")
    logging.info(f"Reprocess mode: {args.reprocess}")
    logging.info(f"Limit: {args.limit or 'None'}")
    logging.info("="*80)
    
    # Initialize Firebase
    db, bucket = init_firebase()
    
    # Handle reprocess mode
    if args.reprocess:
        fields_list = None
        if args.fields:
            fields_list = [f.strip() for f in args.fields.split(',')]
            logging.info(f"Reprocessing fields: {fields_list}")
        
        reprocess_existing_guidelines(db, dry_run=args.dry_run, fields=fields_list)
        
        logging.info("\nReprocessing complete!")
        logging.info("Note: Use the /processGuidelineBackground endpoint to actually trigger processing")
        return
    
    # Find all PDFs
    guidance_dir = Path('guidance')
    if not guidance_dir.exists():
        logging.error(f"Guidance directory not found: {guidance_dir.absolute()}")
        sys.exit(1)
    
    pdf_files = sorted(list(guidance_dir.glob(args.pattern)))
    logging.info(f"Found {len(pdf_files)} PDF files in {guidance_dir}")
    
    if args.limit:
        pdf_files = pdf_files[:args.limit]
        logging.info(f"Limited to {len(pdf_files)} files")
    
    # Migrate each PDF
    results = []
    start_time = time.time()
    
    for i, pdf_path in enumerate(pdf_files, 1):
        logging.info(f"\n[{i}/{len(pdf_files)}] Migrating: {pdf_path.name}")
        result = migrate_guideline(pdf_path, db, bucket, dry_run=args.dry_run)
        results.append(result)
        
        # Rate limiting to avoid overwhelming Firebase
        if i % 10 == 0:
            logging.info(f"Processed {i} files, pausing for 2 seconds...")
            time.sleep(2)
    
    # Generate report
    elapsed_time = time.time() - start_time
    
    logging.info("\n" + "="*80)
    logging.info("MIGRATION REPORT")
    logging.info("="*80)
    
    success_count = sum(1 for r in results if r['status'] == 'success')
    skipped_count = sum(1 for r in results if r['status'] == 'skipped_duplicate')
    error_count = sum(1 for r in results if r['status'] == 'error')
    dry_run_count = sum(1 for r in results if r['status'] == 'dry_run_success')
    
    logging.info(f"Total files processed: {len(results)}")
    logging.info(f"Successfully migrated: {success_count}")
    logging.info(f"Skipped (duplicates): {skipped_count}")
    logging.info(f"Errors: {error_count}")
    if args.dry_run:
        logging.info(f"Dry run (would migrate): {dry_run_count}")
    logging.info(f"Time elapsed: {elapsed_time:.2f} seconds")
    
    if error_count > 0:
        logging.info("\nErrors:")
        for r in results:
            if r['status'] == 'error':
                logging.info(f"  - {r['filename']}: {r['error']}")
    
    # Save detailed report to JSON
    import json
    report_file = 'migration_report.json'
    with open(report_file, 'w') as f:
        json.dump({
            'summary': {
                'total': len(results),
                'success': success_count,
                'skipped': skipped_count,
                'errors': error_count,
                'dry_run': args.dry_run,
                'elapsed_time': elapsed_time
            },
            'results': results
        }, f, indent=2)
    
    logging.info(f"\nDetailed report saved to: {report_file}")
    logging.info("="*80)
    
    if error_count > 0:
        sys.exit(1)

if __name__ == "__main__":
    main()

