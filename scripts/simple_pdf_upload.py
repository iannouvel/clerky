#!/usr/bin/env python3
"""
Simplified PDF upload script that uses existing shared infrastructure.
This avoids the firebase_admin dependency issues.
"""
import logging
import os
import sys
from pathlib import Path

def simple_upload():
    """
    Simple version that just processes PDFs using existing infrastructure
    """
    try:
        # Import the existing shared modules
        from shared.config import Config
        from shared.pdf_processor import PDFProcessor
        
        logging.info("Starting simplified PDF processing...")
        
        # Initialize components
        config = Config()
        pdf_processor = PDFProcessor(config)
        
        # Get all PDF files
        guidance_dir = Path('../guidance')  # Go up one level from scripts
        pdf_files = list(guidance_dir.glob('*.pdf'))
        
        logging.info(f"Found {len(pdf_files)} PDF files to process")
        
        successful_extractions = []
        failed_extractions = []
        
        for pdf_file in pdf_files:
            try:
                logging.info(f"Processing: {pdf_file.name}")
                
                # Extract text from PDF
                raw_text = pdf_processor.extract_text(pdf_file)
                
                if not raw_text or len(raw_text.strip()) < 100:
                    logging.warning(f"Failed to extract meaningful text from {pdf_file.name}")
                    failed_extractions.append(pdf_file.name)
                    continue
                
                # Clean the text
                cleaned_text = pdf_processor.clean_extracted_text(raw_text)
                if not cleaned_text:
                    logging.warning(f"Failed to clean text from {pdf_file.name}")
                    failed_extractions.append(pdf_file.name)
                    continue
                
                # Save to a text file for manual upload
                output_dir = Path('../extracted_content')
                output_dir.mkdir(exist_ok=True)
                
                # Generate clean filename
                clean_name = pdf_file.stem.lower()
                clean_name = clean_name.replace(' ', '_').replace('&', 'and').replace('-', '_')
                output_file = output_dir / f"{clean_name}.txt"
                
                with open(output_file, 'w', encoding='utf-8') as f:
                    f.write(f"# Extracted from: {pdf_file.name}\n")
                    f.write(f"# Content length: {len(cleaned_text)} characters\n")
                    f.write(f"# Extraction date: {os.path.getmtime(pdf_file)}\n\n")
                    f.write(cleaned_text)
                
                successful_extractions.append({
                    'pdf': pdf_file.name,
                    'text_file': output_file.name,
                    'length': len(cleaned_text)
                })
                
                logging.info(f"Successfully extracted content from {pdf_file.name} ({len(cleaned_text)} chars)")
                
            except Exception as e:
                logging.error(f"Error processing {pdf_file.name}: {str(e)}")
                failed_extractions.append(pdf_file.name)
                continue
        
        # Print summary
        print(f"\n=== EXTRACTION SUMMARY ===")
        print(f"Successfully processed: {len(successful_extractions)} PDFs")
        print(f"Failed extractions: {len(failed_extractions)} PDFs")
        print(f"Total processed: {len(pdf_files)} PDFs")
        
        if successful_extractions:
            print(f"\n✅ Successful extractions saved to: extracted_content/")
            for extraction in successful_extractions[:10]:  # Show first 10
                print(f"  - {extraction['pdf']} -> {extraction['text_file']} ({extraction['length']} chars)")
            if len(successful_extractions) > 10:
                print(f"  ... and {len(successful_extractions) - 10} more")
        
        if failed_extractions:
            print(f"\n❌ Failed extractions:")
            for failed in failed_extractions:
                print(f"  - {failed}")
        
        print(f"\n📝 Next steps:")
        print(f"1. Review the extracted text files in extracted_content/")
        print(f"2. These can be manually uploaded to Firestore or used by other scripts")
        print(f"3. The server's content repair function should pick up the content")
        
        return {
            'successful': len(successful_extractions),
            'failed': len(failed_extractions),
            'total': len(pdf_files),
            'extractions': successful_extractions
        }
        
    except ImportError as e:
        print(f"❌ Missing dependency: {e}")
        print("Please ensure you're running from the scripts directory and the shared modules are available")
        return None
    except Exception as e:
        print(f"❌ Error: {e}")
        return None

if __name__ == "__main__":
    # Set up logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s'
    )
    
    print("🔄 Starting simplified PDF content extraction...")
    result = simple_upload()
    
    if result:
        print(f"✅ Extraction completed!")
    else:
        print(f"❌ Extraction failed!")
        sys.exit(1) 