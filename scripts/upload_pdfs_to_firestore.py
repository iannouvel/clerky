#!/usr/bin/env python3
"""
Script to extract PDF content locally and upload to Firestore.
This replaces the need to fetch PDFs via GitHub API.
"""
import logging
import os
import sys
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore
from shared.config import Config
from shared.pdf_processor import PDFProcessor
from shared.file_manager import FileManager

def init_firebase():
    """Initialize Firebase Admin SDK"""
    try:
        # Check if Firebase is already initialized
        firebase_admin.get_app()
        print("Firebase already initialized")
        return firestore.client()
    except ValueError:
        # Initialize Firebase
        print("Initializing Firebase...")
        
        # Try to get credentials from environment
        service_account_path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
        
        if service_account_path and os.path.exists(service_account_path):
            cred = credentials.Certificate(service_account_path)
        else:
            # Try using gcloud_key.json from parent directory
            key_path = Path(__file__).parent.parent / 'gcloud_key.json'
            if key_path.exists():
                cred = credentials.Certificate(str(key_path))
            else:
                print("Error: No Firebase credentials found!")
                print("Please set GOOGLE_APPLICATION_CREDENTIALS or place gcloud_key.json in the project root")
                sys.exit(1)
        
        firebase_admin.initialize_app(cred)
        return firestore.client()

def generate_guideline_id(filename):
    """Generate a clean document ID from filename"""
    # Remove .pdf extension and clean up
    clean_name = filename.lower()
    if clean_name.endswith('.pdf'):
        clean_name = clean_name[:-4]
    
    # Replace spaces and special characters with hyphens
    import re
    clean_name = re.sub(r'[^a-z0-9\-]', '-', clean_name)
    clean_name = re.sub(r'-+', '-', clean_name)  # Multiple hyphens to single
    clean_name = clean_name.strip('-')  # Remove leading/trailing hyphens
    
    # Ensure it doesn't end with -pdf
    if clean_name.endswith('-pdf'):
        clean_name = clean_name[:-4]
    
    return clean_name

def upload_pdf_content_to_firestore():
    """Extract PDF content and upload to Firestore"""
    
    # Initialize components
    config = Config()
    pdf_processor = PDFProcessor(config)
    db = init_firebase()
    
    logging.info("Starting PDF content upload to Firestore")
    
    # Get all PDF files
    guidance_dir = Path('guidance')
    pdf_files = list(guidance_dir.glob('*.pdf'))
    
    logging.info(f"Found {len(pdf_files)} PDF files to process")
    
    successful_uploads = 0
    failed_uploads = 0
    
    for pdf_file in pdf_files:
        try:
            logging.info(f"Processing: {pdf_file.name}")
            
            # Generate guideline ID
            guideline_id = generate_guideline_id(pdf_file.name)
            logging.info(f"Generated ID: {guideline_id}")
            
            # Check if content already exists in Firestore
            doc_ref = db.collection('guidelines').document(guideline_id)
            doc = doc_ref.get()
            
            if doc.exists and doc.to_dict().get('content'):
                logging.info(f"Content already exists for {guideline_id}, skipping...")
                continue
            
            # Extract text from PDF
            logging.info(f"Extracting text from {pdf_file.name}...")
            raw_text = pdf_processor.extract_text(pdf_file)
            
            if not raw_text or len(raw_text.strip()) < 100:
                logging.warning(f"Failed to extract meaningful text from {pdf_file.name}")
                failed_uploads += 1
                continue
            
            # Clean the text
            cleaned_text = pdf_processor.clean_extracted_text(raw_text)
            if not cleaned_text:
                logging.warning(f"Failed to clean text from {pdf_file.name}")
                failed_uploads += 1
                continue
            
            # Prepare document data
            doc_data = {
                'content': cleaned_text,
                'filename': pdf_file.name,
                'originalFilename': pdf_file.name,
                'contentExtracted': True,
                'extractionDate': firestore.SERVER_TIMESTAMP,
                'extractionSource': 'local_pdf_processor',
                'contentLength': len(cleaned_text),
                'lastUpdated': firestore.SERVER_TIMESTAMP
            }
            
            # If document doesn't exist, add basic metadata
            if not doc.exists:
                doc_data.update({
                    'title': pdf_file.stem,  # Filename without extension
                    'organisation': 'Unknown',  # Will be enhanced later
                    'yearProduced': 'Unknown',
                    'createdAt': firestore.SERVER_TIMESTAMP,
                    'keywords': [],
                    'categories': [],
                    'url': '',
                    'metadataComplete': False
                })
                
                # Set the entire document
                doc_ref.set(doc_data)
                logging.info(f"Created new document for {guideline_id}")
            else:
                # Update existing document with content
                update_data = {
                    'content': cleaned_text,
                    'contentExtracted': True,
                    'extractionDate': firestore.SERVER_TIMESTAMP,
                    'extractionSource': 'local_pdf_processor',
                    'contentLength': len(cleaned_text),
                    'lastUpdated': firestore.SERVER_TIMESTAMP
                }
                doc_ref.update(update_data)
                logging.info(f"Updated existing document {guideline_id} with content")
            
            successful_uploads += 1
            logging.info(f"Successfully uploaded content for {guideline_id} ({len(cleaned_text)} chars)")
            
        except Exception as e:
            logging.error(f"Error processing {pdf_file.name}: {str(e)}")
            failed_uploads += 1
            continue
    
    logging.info(f"Upload complete: {successful_uploads} successful, {failed_uploads} failed")
    print(f"\nSummary:")
    print(f"Successfully uploaded: {successful_uploads} PDFs")
    print(f"Failed uploads: {failed_uploads} PDFs")
    print(f"Total processed: {len(pdf_files)} PDFs")

if __name__ == "__main__":
    # Set up logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler('pdf_upload.log'),
            logging.StreamHandler(sys.stdout)
        ]
    )
    
    # Change to the parent directory (project root)
    os.chdir(Path(__file__).parent.parent)
    
    upload_pdf_content_to_firestore() 