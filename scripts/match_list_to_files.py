#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
For guidelines that have text files but don't match the PDF name,
update the list to use the text file name instead.
This ensures sync will work.
"""

import sys
from pathlib import Path

# Ensure UTF-8 output
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

base_dir = Path(__file__).parent.parent / "guidance"

# Read current list
with open(base_dir / "list_of_guidelines.txt", 'r', encoding='utf-8') as f:
    guidelines = [line.strip() for line in f if line.strip()]

condensed_dir = base_dir / 'condensed'
summary_dir = base_dir / 'summary'

# Find the De Silva text file name
silva_condensed = [f.name for f in condensed_dir.glob("*Silva*Hysteroscopy*.txt") if "GP011" not in f.name]
silva_summary = [f.name for f in summary_dir.glob("*Silva*Hysteroscopy*.txt") if "GP011" not in f.name]

print("Found De Silva files:")
print(f"  Condensed: {silva_condensed}")
print(f"  Summary: {silva_summary}")

if silva_condensed and silva_summary:
    # Get the base name (without .txt)
    condensed_base = silva_condensed[0].replace('.txt', '')
    summary_base = silva_summary[0].replace('.txt', '')
    
    if condensed_base == summary_base:
        correct_name = condensed_base + '.pdf'
        print(f"\nCorrect name should be: {correct_name}")
        
        # Update the list
        updated_guidelines = []
        for g in guidelines:
            if 'Silva' in g and 'Hysteroscopy' in g:
                print(f"\nReplacing:\n  {g}\n  with:\n  {correct_name}")
                updated_guidelines.append(correct_name)
            else:
                updated_guidelines.append(g)
        
        # Write updated list
        with open(base_dir / "list_of_guidelines.txt", 'w', encoding='utf-8', newline='\n') as f:
            for g in updated_guidelines:
                f.write(g + '\n')
        
        print("\n[OK] Updated list_of_guidelines.txt")
    else:
        print(f"\n[ERROR] Condensed and summary have different names!")
else:
    print("\n[ERROR] Could not find De Silva files!")

