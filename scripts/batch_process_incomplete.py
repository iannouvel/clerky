#!/usr/bin/env python3
"""
Batch process incomplete guidelines in Firestore.
Triggers background processing for guidelines missing content, summaries, or terms.
"""

import logging
import os
import sys
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore
import requests
import time

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
    
    return firestore.client()

def find_incomplete_guidelines(db):
    """Find all guidelines with missing content"""
    logging.info("Scanning Firestore for incomplete guidelines...")
    
    guidelines = db.collection('guidelines').stream()
    
    incomplete = []
    
    for doc in guidelines:
        guideline_id = doc.id
        data = doc.to_dict()
        
        missing_fields = []
        
        # Check for missing fields
        if not data.get('content'):
            missing_fields.append('content')
        if not data.get('condensed'):
            missing_fields.append('condensed')
        if not data.get('summary'):
            missing_fields.append('summary')
        if not data.get('significantTerms') or data.get('significantTerms') == []:
            missing_fields.append('terms')
        if not data.get('auditableElements') or data.get('auditableElements') == []:
            missing_fields.append('auditable')
        
        if missing_fields:
            incomplete.append({
                'id': guideline_id,
                'filename': data.get('filename') or data.get('originalFilename'),
                'title': data.get('title'),
                'missing': missing_fields,
                'has_pdf_in_storage': bool(data.get('filename'))
            })
    
    logging.info(f"Found {len(incomplete)} guidelines with missing content")
    return incomplete

def trigger_processing(guideline_id, server_url, auth_token):
    """Trigger background processing for a guideline"""
    try:
        response = requests.post(
            f"{server_url}/processGuidelineBackground",
            json={'guidelineId': guideline_id, 'force': False},
            headers={'Authorization': f'Bearer {auth_token}'},
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            return True, result.get('jobsQueued', 0)
        else:
            error_msg = response.json().get('error', 'Unknown error')
            return False, error_msg
            
    except Exception as e:
        return False, str(e)

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Batch process incomplete guidelines')
    parser.add_argument('--dry-run', action='store_true', help='Just scan and report, don\'t trigger processing')
    parser.add_argument('--limit', type=int, default=None, help='Limit number to process')
    parser.add_argument('--server-url', type=str, default='https://clerky-uzni.onrender.com', help='Server URL')
    parser.add_argument('--auth-token', type=str, help='Firebase Auth ID token (get from browser dev tools)')
    args = parser.parse_args()
    
    # Set up logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler('batch_processing.log'),
            logging.StreamHandler(sys.stdout)
        ]
    )
    
    logging.info("="*80)
    logging.info("Batch Processing Incomplete Guidelines")
    logging.info(f"Dry run: {args.dry_run}")
    logging.info(f"Server: {args.server_url}")
    logging.info("="*80)
    
    # Initialize Firebase
    db = init_firebase()
    
    # Find incomplete guidelines
    incomplete = find_incomplete_guidelines(db)
    
    if not incomplete:
        logging.info("No incomplete guidelines found!")
        return
    
    # Sort by most missing fields first
    incomplete.sort(key=lambda x: len(x['missing']), reverse=True)
    
    # Apply limit if specified
    if args.limit:
        incomplete = incomplete[:args.limit]
        logging.info(f"Limited to {len(incomplete)} guidelines")
    
    # Print report
    logging.info("\nIncomplete Guidelines:")
    logging.info("-" * 80)
    for item in incomplete:
        logging.info(f"  {item['id']}")
        logging.info(f"    Filename: {item['filename']}")
        logging.info(f"    Missing: {', '.join(item['missing'])}")
        logging.info(f"    Has PDF in Storage: {item['has_pdf_in_storage']}")
        logging.info("")
    
    if args.dry_run:
        logging.info(f"\n[DRY RUN] Would process {len(incomplete)} guidelines")
        logging.info("\nTo actually process, run without --dry-run and provide --auth-token")
        logging.info("\nTo get auth token:")
        logging.info("  1. Open Clerky in browser and sign in as admin")
        logging.info("  2. Open browser console")
        logging.info("  3. Run: firebase.auth().currentUser.getIdToken().then(t => console.log(t))")
        logging.info("  4. Copy the token and use: --auth-token YOUR_TOKEN")
        return
    
    if not args.auth_token:
        logging.error("ERROR: --auth-token required for processing")
        logging.info("\nTo get auth token:")
        logging.info("  1. Open Clerky in browser and sign in as admin")
        logging.info("  2. Open browser console")
        logging.info("  3. Run: firebase.auth().currentUser.getIdToken().then(t => console.log(t))")
        logging.info("  4. Copy the token and use: --auth-token YOUR_TOKEN")
        sys.exit(1)
    
    # Process guidelines
    logging.info(f"\nProcessing {len(incomplete)} guidelines...")
    logging.info("-" * 80)
    
    success_count = 0
    error_count = 0
    
    for i, item in enumerate(incomplete, 1):
        guideline_id = item['id']
        logging.info(f"\n[{i}/{len(incomplete)}] Processing: {guideline_id}")
        
        success, result = trigger_processing(guideline_id, args.server_url, args.auth_token)
        
        if success:
            logging.info(f"  ✅ Success - Queued {result} jobs")
            success_count += 1
        else:
            logging.error(f"  ❌ Error: {result}")
            error_count += 1
        
        # Rate limiting - don't overwhelm server
        if i % 5 == 0:
            logging.info("  Pausing for 3 seconds...")
            time.sleep(3)
    
    # Summary
    logging.info("\n" + "="*80)
    logging.info("BATCH PROCESSING COMPLETE")
    logging.info("="*80)
    logging.info(f"Total guidelines: {len(incomplete)}")
    logging.info(f"Successfully queued: {success_count}")
    logging.info(f"Errors: {error_count}")
    logging.info(f"\nNote: Processing happens in background on the server.")
    logging.info(f"Check server logs or use /getProcessingStatus endpoint to monitor progress.")
    logging.info("="*80)

if __name__ == "__main__":
    main()








