#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Rebuild list_of_guidelines.txt by scanning actual PDFs in guidance/ directory.
This ensures the list matches reality and has proper UTF-8 encoding.
"""

import sys
from pathlib import Path

# Ensure UTF-8 output
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

base_dir = Path(__file__).parent.parent / "guidance"

# Find all PDF files
pdf_files = sorted([f.name for f in base_dir.glob("*.pdf")])

print(f"Found {len(pdf_files)} PDF files in guidance/")

# Read current list for comparison
old_list_file = base_dir / "list_of_guidelines.txt"
if old_list_file.exists():
    with open(old_list_file, 'r', encoding='utf-8', errors='replace') as f:
        old_list = [line.strip() for line in f if line.strip()]
    print(f"Current list has {len(old_list)} entries")
else:
    old_list = []
    print("No existing list found")

# Show differences
if set(pdf_files) != set(old_list):
    print("\nDifferences found:")
    
    in_pdfs_not_list = set(pdf_files) - set(old_list)
    if in_pdfs_not_list:
        print(f"\nPDFs on disk not in list ({len(in_pdfs_not_list)}):")
        for f in sorted(in_pdfs_not_list):
            print(f"  + {f}")
    
    in_list_not_pdfs = set(old_list) - set(pdf_files)
    if in_list_not_pdfs:
        print(f"\nIn list but no PDF found ({len(in_list_not_pdfs)}):")
        for f in sorted(in_list_not_pdfs):
            print(f"  - {f}")
else:
    print("\nList matches PDFs on disk exactly")

# Write new list
output_file = base_dir / "list_of_guidelines.txt"
with open(output_file, 'w', encoding='utf-8', newline='\n') as f:
    for pdf in pdf_files:
        f.write(pdf + '\n')

print(f"\nWrote {len(pdf_files)} entries to list_of_guidelines.txt with UTF-8 encoding")
print("List is now synchronized with PDFs in guidance/ directory")

