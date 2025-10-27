#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Check the actual status of files for the two problematic guidelines.
"""

import sys
from pathlib import Path

# Ensure UTF-8 output
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

base_dir = Path(__file__).parent.parent / "guidance"

# Check PDFs
print("Checking PDF files:")
pdfs = list(base_dir.glob("*.pdf"))
print(f"Total PDFs: {len(pdfs)}")

group_b_pdfs = [p for p in pdfs if 'Group B' in p.name or 'Streptococcal' in p.name]
silva_pdfs = [p for p in pdfs if 'Silva' in p.name or 'Hysteroscopy' in p.name]

print(f"\nGroup B Strep PDFs: {len(group_b_pdfs)}")
for p in group_b_pdfs:
    print(f"  {p.name}")

print(f"\nDe Silva PDFs: {len(silva_pdfs)}")
for p in silva_pdfs:
    print(f"  {p.name}")

# Check condensed files
print("\n\nChecking condensed files:")
condensed_dir = base_dir / "condensed"
if condensed_dir.exists():
    condensed_files = list(condensed_dir.glob("*.txt"))
    print(f"Total condensed files: {len(condensed_files)}")
    
    group_b_condensed = [f for f in condensed_files if 'Group B' in f.name or 'Streptococcal' in f.name]
    silva_condensed = [f for f in condensed_files if 'Silva' in f.name or 'Hysteroscopy' in f.name]
    
    print(f"\nGroup B Strep condensed: {len(group_b_condensed)}")
    for f in group_b_condensed:
        print(f"  {f.name}")
    
    print(f"\nDe Silva condensed: {len(silva_condensed)}")
    for f in silva_condensed:
        print(f"  {f.name}")
else:
    print("Condensed directory does not exist!")

# Check summary files
print("\n\nChecking summary files:")
summary_dir = base_dir / "summary"
if summary_dir.exists():
    summary_files = list(summary_dir.glob("*.txt"))
    print(f"Total summary files: {len(summary_files)}")
    
    group_b_summary = [f for f in summary_files if 'Group B' in f.name or 'Streptococcal' in f.name]
    silva_summary = [f for f in summary_files if 'Silva' in f.name or 'Hysteroscopy' in f.name]
    
    print(f"\nGroup B Strep summary: {len(group_b_summary)}")
    for f in group_b_summary:
        print(f"  {f.name}")
    
    print(f"\nDe Silva summary: {len(silva_summary)}")
    for f in silva_summary:
        print(f"  {f.name}")
else:
    print("Summary directory does not exist!")

