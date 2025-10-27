#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Final verification: For each guideline in list_of_guidelines.txt,
verify EXACTLY ONE file exists in condensed/, summary/, and significant_terms/
using exact name matching only (no fuzzy matching).
"""

import sys
import json
from pathlib import Path

# Ensure UTF-8 output
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

base_dir = Path(__file__).parent.parent / "guidance"

# Read guidelines list
with open(base_dir / "list_of_guidelines.txt", 'r', encoding='utf-8') as f:
    guidelines = [line.strip() for line in f if line.strip()]

print(f"Verifying {len(guidelines)} guidelines...\n")

directories = {
    'condensed': base_dir / 'condensed',
    'summary': base_dir / 'summary',
    'significant_terms': base_dir / 'significant_terms'
}

results = {
    'complete': [],
    'missing_condensed': [],
    'missing_summary': [],
    'missing_keywords': [],
    'total_complete': 0,
    'total_missing': 0
}

for pdf_name in guidelines:
    base_name = pdf_name.replace('.pdf', '')
    
    # Check for EXACT matches only
    has_condensed = (directories['condensed'] / f"{base_name}.txt").exists()
    has_summary = (directories['summary'] / f"{base_name}.txt").exists()
    has_keywords = (directories['significant_terms'] / f"{base_name}.txt").exists()
    
    is_complete = has_condensed and has_summary
    
    if is_complete:
        results['complete'].append(pdf_name)
        results['total_complete'] += 1
    else:
        results['total_missing'] += 1
        if not has_condensed:
            results['missing_condensed'].append(pdf_name)
        if not has_summary:
            results['missing_summary'].append(pdf_name)
        if not has_keywords:
            results['missing_keywords'].append(pdf_name)

print("="*80)
print("VERIFICATION RESULTS")
print("="*80)
print(f"\nTotal guidelines: {len(guidelines)}")
print(f"Complete (has condensed + summary): {results['total_complete']}")
print(f"Incomplete: {results['total_missing']}")
print()
print(f"Missing condensed: {len(results['missing_condensed'])}")
print(f"Missing summary: {len(results['missing_summary'])}")
print(f"Missing keywords: {len(results['missing_keywords'])}")

if results['missing_condensed']:
    print("\n\nMISSING CONDENSED FILES:")
    for pdf in results['missing_condensed']:
        print(f"  - {pdf}")

if results['missing_summary']:
    print("\n\nMISSING SUMMARY FILES:")
    for pdf in results['missing_summary']:
        print(f"  - {pdf}")

if results['missing_keywords']:
    print("\n\nMISSING KEYWORDS FILES:")
    for pdf in results['missing_keywords'][:20]:
        print(f"  - {pdf}")
    if len(results['missing_keywords']) > 20:
        print(f"  ... and {len(results['missing_keywords']) - 20} more")

# Save results
output_file = Path(__file__).parent.parent / 'final_verification_report.json'
with open(output_file, 'w', encoding='utf-8') as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

print(f"\n\nDetailed report saved to: final_verification_report.json")

if results['total_complete'] == len(guidelines):
    print("\n[SUCCESS] All {len(guidelines)} guidelines are complete!")
else:
    print(f"\n[ACTION REQUIRED] {results['total_missing']} guidelines need files generated")

