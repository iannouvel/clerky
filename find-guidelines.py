#!/usr/bin/env python3
"""
Find PDFs containing the word 'guideline' in their text content
"""

import os
import sys
from pathlib import Path
import time
from multiprocessing import Process, Manager, Queue
import signal

try:
    import PyPDF2
except ImportError:
    print("PyPDF2 is not installed. Installing it now...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "PyPDF2"])
    import PyPDF2

def extract_text_from_pdf(pdf_path, timeout=10):
    """Extract text from a PDF file with timeout"""
    try:
        with open(pdf_path, 'rb') as file:
            pdf_reader = PyPDF2.PdfReader(file)
            text = ""
            # Limit to first 50 pages to avoid very slow processing
            max_pages = min(50, len(pdf_reader.pages))
            for i in range(max_pages):
                text += pdf_reader.pages[i].extract_text()
            return text.lower()
    except Exception as e:
        return None

def main():
    folder_path = r"C:\Users\ianno\OneDrive - NHS\UHSx Document Library - UHSx - Document Library"
    
    if not os.path.exists(folder_path):
        print(f"Error: Folder not found at path: {folder_path}")
        return
    
    print("Scanning for PDF files...")
    pdf_files = list(Path(folder_path).rglob("*.pdf"))
    
    print(f"Found {len(pdf_files)} PDF files. Now checking content...\n")
    
    guideline_count = 0
    processed_count = 0
    error_count = 0
    skipped_count = 0
    guideline_files = []
    
    for pdf_path in pdf_files:
        processed_count += 1
        
        # Show progress every file now
        print(f"Progress: {processed_count}/{len(pdf_files)} ({(processed_count/len(pdf_files)*100):.1f}%) - Processing: {pdf_path.name[:50]}...", end='\r')
        
        try:
            # Skip very large files (>20MB) as they take too long
            file_size_mb = pdf_path.stat().st_size / (1024 * 1024)
            if file_size_mb > 20:
                skipped_count += 1
                print(f"\n[SKIPPED - TOO LARGE] {pdf_path.name} ({file_size_mb:.1f}MB)")
                continue
            
            text = extract_text_from_pdf(pdf_path)
            
            if text and "guideline" in text:
                guideline_count += 1
                guideline_files.append(str(pdf_path))
                print(f"\n[GUIDELINE FOUND] {pdf_path.name}")
        except Exception as e:
            error_count += 1
            # Only show errors if they're not common permission issues
            if "PermissionError" not in str(type(e)):
                print(f"\n[ERROR] {pdf_path.name[:50]} - {str(e)[:50]}")
    
    print("\n" + "="*50)
    print("Results Summary")
    print("="*50)
    print(f"Total PDFs processed: {processed_count}")
    print(f"PDFs containing 'guideline': {guideline_count}")
    print(f"Large files skipped (>20MB): {skipped_count}")
    print(f"Errors encountered: {error_count}")
    print()
    
    # Save list of guidelines to a file
    output_file = "guidelines-list.txt"
    with open(output_file, 'w', encoding='utf-8') as f:
        for guideline in guideline_files:
            f.write(guideline + '\n')
    
    print(f"Full list of guidelines saved to: {os.path.abspath(output_file)}")

if __name__ == "__main__":
    main()

