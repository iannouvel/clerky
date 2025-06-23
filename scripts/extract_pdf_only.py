#!/usr/bin/env python3
"""
Minimal PDF text extraction script - no AI, no Firestore, just pure text extraction.
"""
import logging
import os
import sys
from pathlib import Path
from PyPDF2 import PdfReader
from pdfminer.high_level import extract_text as pdfminer_extract
import re

def extract_text_pypdf2(file_path):
    """Extract text using PyPDF2"""
    try:
        reader = PdfReader(file_path)
        text = ""
        for i, page in enumerate(reader.pages):
            try:
                page_text = page.extract_text()
                text += page_text
                print(f"  PyPDF2: Extracted {len(page_text)} characters from page {i+1}")
            except Exception as e:
                print(f"  PyPDF2: Error extracting text from page {i+1}: {e}")
        return text
    except Exception as e:
        print(f"  PyPDF2: Error reading PDF {file_path}: {str(e)}")
        return ""

def extract_text_pdfminer(file_path):
    """Extract text using PDFMiner"""
    try:
        text = pdfminer_extract(str(file_path))
        print(f"  PDFMiner: Extracted {len(text)} characters")
        return text
    except Exception as e:
        print(f"  PDFMiner: Error extracting text: {str(e)}")
        return ""

def clean_extracted_text(text):
    """Clean up extracted text"""
    if not text or not text.strip():
        return None
    
    # Basic text cleanup
    cleaned = text.strip()
    
    # Remove excessive whitespace (multiple spaces/newlines)
    cleaned = re.sub(r'\n\s*\n\s*\n', '\n\n', cleaned)  # Multiple newlines to double
    cleaned = re.sub(r' +', ' ', cleaned)  # Multiple spaces to single
    cleaned = re.sub(r'\t+', ' ', cleaned)  # Tabs to spaces
    
    # Remove common PDF artifacts
    cleaned = re.sub(r'\f', '\n', cleaned)  # Form feeds to newlines
    cleaned = re.sub(r'\x0c', '\n', cleaned)  # Form feeds to newlines
    
    return cleaned

def extract_pdf_text(file_path):
    """Extract text from PDF using multiple methods"""
    print(f"Processing: {file_path.name}")
    
    # Try PyPDF2 first
    text = extract_text_pypdf2(file_path)
    if len(text.strip()) > 0:
        print(f"  ✅ Successfully extracted {len(text)} characters using PyPDF2")
        return text
        
    # If PyPDF2 fails, try PDFMiner
    print("  🔄 PyPDF2 failed, trying PDFMiner...")
    text = extract_text_pdfminer(file_path)
    if len(text.strip()) > 0:
        print(f"  ✅ Successfully extracted {len(text)} characters using PDFMiner")
        return text
        
    print("  ❌ All text extraction methods failed")
    return ""

def generate_guideline_id(filename):
    """Generate a clean document ID from filename"""
    clean_name = filename.lower()
    if clean_name.endswith('.pdf'):
        clean_name = clean_name[:-4]
    
    # Replace spaces and special characters with hyphens
    clean_name = re.sub(r'[^a-z0-9\-]', '-', clean_name)
    clean_name = re.sub(r'-+', '-', clean_name)  # Multiple hyphens to single
    clean_name = clean_name.strip('-')  # Remove leading/trailing hyphens
    
    # Ensure it doesn't end with -pdf
    if clean_name.endswith('-pdf'):
        clean_name = clean_name[:-4]
    
    return clean_name

def main():
    """Main extraction function"""
    print("🔄 Starting PDF text extraction...")
    
    # Get all PDF files
    guidance_dir = Path('../guidance')
    if not guidance_dir.exists():
        guidance_dir = Path('guidance')  # Try current directory
    
    pdf_files = list(guidance_dir.glob('*.pdf'))
    
    if not pdf_files:
        print(f"❌ No PDF files found in {guidance_dir.absolute()}")
        return False
    
    print(f"📁 Found {len(pdf_files)} PDF files in {guidance_dir.absolute()}")
    
    # Create output directory
    output_dir = Path('extracted_content')
    output_dir.mkdir(exist_ok=True)
    
    successful_extractions = []
    failed_extractions = []
    
    for pdf_file in pdf_files:
        try:
            # Extract text from PDF
            raw_text = extract_pdf_text(pdf_file)
            
            if not raw_text or len(raw_text.strip()) < 100:
                print(f"  ⚠️  Failed to extract meaningful text from {pdf_file.name}")
                failed_extractions.append(pdf_file.name)
                continue
            
            # Clean the text
            cleaned_text = clean_extracted_text(raw_text)
            if not cleaned_text:
                print(f"  ⚠️  Failed to clean text from {pdf_file.name}")
                failed_extractions.append(pdf_file.name)
                continue
            
            # Generate output filename
            guideline_id = generate_guideline_id(pdf_file.name)
            output_file = output_dir / f"{guideline_id}.txt"
            
            # Write extracted content
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(f"# Extracted from: {pdf_file.name}\n")
                f.write(f"# Guideline ID: {guideline_id}\n")
                f.write(f"# Content length: {len(cleaned_text)} characters\n")
                f.write(f"# Processing date: {os.path.getctime(pdf_file)}\n\n")
                f.write(cleaned_text)
            
            successful_extractions.append({
                'pdf': pdf_file.name,
                'guideline_id': guideline_id,
                'text_file': output_file.name,
                'length': len(cleaned_text)
            })
            
            print(f"  ✅ Saved: {output_file.name} ({len(cleaned_text)} chars)")
            
        except Exception as e:
            print(f"  ❌ Error processing {pdf_file.name}: {str(e)}")
            failed_extractions.append(pdf_file.name)
            continue
    
    # Print summary
    print(f"\n=== EXTRACTION SUMMARY ===")
    print(f"Successfully processed: {len(successful_extractions)} PDFs")
    print(f"Failed extractions: {len(failed_extractions)} PDFs")
    print(f"Total processed: {len(pdf_files)} PDFs")
    
    if successful_extractions:
        print(f"\n✅ Successful extractions saved to: {output_dir.absolute()}/")
        for extraction in successful_extractions[:10]:  # Show first 10
            print(f"  - {extraction['pdf']} -> {extraction['text_file']} ({extraction['length']} chars)")
        if len(successful_extractions) > 10:
            print(f"  ... and {len(successful_extractions) - 10} more")
    
    if failed_extractions:
        print(f"\n❌ Failed extractions:")
        for failed in failed_extractions:
            print(f"  - {failed}")
    
    print(f"\n📝 Next Steps:")
    print(f"1. Review the extracted text files in '{output_dir.absolute()}'")
    print(f"2. Use the content repair function in the web app to populate Firestore")
    print(f"3. Or manually copy the content to Firestore documents")
    print(f"4. The guideline IDs are provided for easy document identification")
    
    return len(successful_extractions) > 0

if __name__ == "__main__":
    success = main()
    if success:
        print(f"\n🎉 PDF extraction completed successfully!")
    else:
        print(f"\n💥 PDF extraction failed!")
        sys.exit(1) 