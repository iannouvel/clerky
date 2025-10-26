#!/usr/bin/env python3
"""
Extract and process NICE 2020 Diabetes in Pregnancy guideline
"""
import sys
from pathlib import Path
from PyPDF2 import PdfReader

def main():
    # Paths
    pdf_path = Path("guidance/NICE 2020 - Diabetes in Pregnancy.pdf")
    output_file = Path("guidance/condensed/NICE 2020 - Diabetes in Pregnancy.txt")
    
    # Ensure output directory exists
    output_file.parent.mkdir(parents=True, exist_ok=True)
    
    # Extract text
    print(f"Reading PDF: {pdf_path}", file=sys.stderr)
    reader = PdfReader(str(pdf_path))
    text = ""
    for i, page in enumerate(reader.pages):
        page_text = page.extract_text()
        text += page_text
        print(f"  Extracted page {i+1}/{len(reader.pages)}", file=sys.stderr)
    
    print(f"\nExtracted {len(text)} characters total", file=sys.stderr)
    
    # Clean text
    text = text.replace('\x00', '')  # Remove null characters
    text = ' '.join(text.split())  # Normalize whitespace
    
    # Save to condensed file
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(text)
    
    print(f"\nSaved to: {output_file}", file=sys.stderr)
    print(f"SUCCESS", file=sys.stderr)
    
    # Return the text for further processing
    return text

if __name__ == "__main__":
    main()



