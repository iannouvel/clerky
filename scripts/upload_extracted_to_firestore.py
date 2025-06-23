#!/usr/bin/env python3
"""
Simple script to upload extracted PDF content to Firestore.
This reads the extracted text files and uploads them directly to Firestore.
"""
import json
import os
import sys
from pathlib import Path
import re

def extract_guideline_id_from_filename(filename):
    """Extract guideline ID from filename"""
    # Remove .txt extension
    name = filename.replace('.txt', '')
    # The filename IS the guideline ID
    return name

def extract_original_filename_from_content(content):
    """Extract original PDF filename from content header"""
    lines = content.split('\n')
    for line in lines[:10]:  # Check first 10 lines
        if line.startswith('# Extracted from:'):
            return line.replace('# Extracted from:', '').strip()
    return None

def process_extracted_files():
    """Process all extracted text files and prepare for Firestore upload"""
    
    content_dir = Path('extracted_content')
    if not content_dir.exists():
        print(f"❌ Extracted content directory not found: {content_dir.absolute()}")
        return None
        
    text_files = list(content_dir.glob('*.txt'))
    
    if not text_files:
        print(f"❌ No text files found in {content_dir.absolute()}")
        return None
        
    print(f"📁 Found {len(text_files)} extracted text files")
    
    firestore_updates = []
    successful_processing = []
    failed_processing = []
    
    for text_file in text_files:
        try:
            print(f"Processing: {text_file.name}")
            
            # Read the content
            with open(text_file, 'r', encoding='utf-8') as f:
                content = f.read()
            
            if not content or len(content.strip()) < 100:
                print(f"  ⚠️  File {text_file.name} has insufficient content")
                failed_processing.append(text_file.name)
                continue
            
            # Extract guideline ID and metadata
            guideline_id = extract_guideline_id_from_filename(text_file.name)
            original_filename = extract_original_filename_from_content(content)
            
            # Remove metadata headers from content
            content_lines = content.split('\n')
            actual_content_start = 0
            for i, line in enumerate(content_lines):
                if line.startswith('#'):
                    actual_content_start = i + 1
                else:
                    break
            
            # Skip empty lines after headers
            while (actual_content_start < len(content_lines) and 
                   not content_lines[actual_content_start].strip()):
                actual_content_start += 1
            
            clean_content = '\n'.join(content_lines[actual_content_start:]).strip()
            
            if not clean_content or len(clean_content) < 100:
                print(f"  ⚠️  File {text_file.name} has insufficient clean content")
                failed_processing.append(text_file.name)
                continue
            
            # Prepare Firestore update
            firestore_update = {
                'guideline_id': guideline_id,
                'content': clean_content,
                'content_length': len(clean_content),
                'original_filename': original_filename,
                'source': 'local_pdf_extraction',
                'extraction_date': os.path.getctime(text_file)
            }
            
            firestore_updates.append(firestore_update)
            successful_processing.append({
                'file': text_file.name,
                'guideline_id': guideline_id,
                'content_length': len(clean_content),
                'original_filename': original_filename
            })
            
            print(f"  ✅ Processed: {guideline_id} ({len(clean_content)} chars)")
            
        except Exception as e:
            print(f"  ❌ Error processing {text_file.name}: {str(e)}")
            failed_processing.append(text_file.name)
            continue
    
    # Save the Firestore updates to a JSON file
    output_file = Path('firestore_content_updates.json')
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(firestore_updates, f, indent=2, ensure_ascii=False)
    
    # Print summary
    print(f"\n=== PROCESSING SUMMARY ===")
    print(f"Successfully processed: {len(successful_processing)} files")
    print(f"Failed processing: {len(failed_processing)} files")
    print(f"Total files: {len(text_files)} files")
    
    if successful_processing:
        print(f"\n✅ Firestore updates prepared for {len(firestore_updates)} guidelines")
        print(f"📄 Updates saved to: {output_file.absolute()}")
        
        # Show first few examples
        for item in successful_processing[:10]:
            print(f"  - {item['guideline_id']}: {item['content_length']} chars")
        if len(successful_processing) > 10:
            print(f"  ... and {len(successful_processing) - 10} more")
    
    if failed_processing:
        print(f"\n❌ Failed processing:")
        for failed in failed_processing:
            print(f"  - {failed}")
    
    print(f"\n📝 Next Steps:")
    print(f"1. The file '{output_file.name}' contains all the content updates")
    print(f"2. You can use the server's endpoint to upload this content")
    print(f"3. Or manually copy individual content to Firestore documents")
    print(f"4. The guideline IDs match the Firestore document IDs")
    
    return {
        'successful': len(successful_processing),
        'failed': len(failed_processing),
        'total': len(text_files),
        'updates': firestore_updates,
        'output_file': str(output_file.absolute())
    }

def main():
    """Main function"""
    print("🔄 Processing extracted PDF content for Firestore upload...")
    
    result = process_extracted_files()
    
    if result and result['successful'] > 0:
        print(f"\n🎉 Content processing completed successfully!")
        print(f"   {result['successful']} guidelines ready for Firestore upload")
        return True
    else:
        print(f"\n💥 Content processing failed!")
        return False

if __name__ == "__main__":
    success = main()
    if not success:
        sys.exit(1) 