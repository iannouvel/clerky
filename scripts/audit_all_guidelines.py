#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Comprehensive audit of all guideline files.
For each guideline in list_of_guidelines.txt, check:
1. What files exist (condensed, summary, significant_terms)
2. If there are duplicates (multiple files that could match)
3. If files are missing
"""

import sys
import json
from pathlib import Path
from collections import defaultdict

# Ensure UTF-8 output
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

base_dir = Path(__file__).parent.parent / "guidance"

# Read the list of guidelines
with open(base_dir / "list_of_guidelines.txt", 'r', encoding='utf-8') as f:
    guidelines = [line.strip() for line in f if line.strip()]

print(f"Auditing {len(guidelines)} guidelines...\n")

# Track results
results = {
    'complete': [],
    'missing_condensed': [],
    'missing_summary': [],
    'missing_keywords': [],
    'has_duplicates': [],
    'total_issues': 0
}

directories = {
    'condensed': base_dir / 'condensed',
    'summary': base_dir / 'summary',
    'significant_terms': base_dir / 'significant_terms'
}

def find_matching_files(directory, base_name):
    """Find all files that might match this guideline."""
    if not directory.exists():
        return []
    
    # Look for exact match
    exact = directory / f"{base_name}.txt"
    if exact.exists():
        return [exact]
    
    # Look for similar files (fuzzy matching)
    # Split the name into parts and search
    parts = base_name.split(' - ')
    if len(parts) >= 2:
        pattern = f"*{parts[0]}*{parts[1][:15]}*"
        matches = list(directory.glob(pattern + ".txt"))
        return matches
    
    return []

for i, pdf_name in enumerate(guidelines, 1):
    base_name = pdf_name.replace('.pdf', '')
    
    # Check each directory
    status = {
        'pdf': pdf_name,
        'condensed': [],
        'summary': [],
        'significant_terms': []
    }
    
    for dir_name, dir_path in directories.items():
        matches = find_matching_files(dir_path, base_name)
        status[dir_name] = [f.name for f in matches]
    
    # Categorize the guideline
    has_issues = False
    
    if len(status['condensed']) == 0:
        results['missing_condensed'].append(pdf_name)
        has_issues = True
    elif len(status['condensed']) > 1:
        results['has_duplicates'].append({
            'guideline': pdf_name,
            'directory': 'condensed',
            'files': status['condensed']
        })
        has_issues = True
    
    if len(status['summary']) == 0:
        results['missing_summary'].append(pdf_name)
        has_issues = True
    elif len(status['summary']) > 1:
        results['has_duplicates'].append({
            'guideline': pdf_name,
            'directory': 'summary',
            'files': status['summary']
        })
        has_issues = True
    
    if len(status['significant_terms']) == 0:
        results['missing_keywords'].append(pdf_name)
        has_issues = True
    elif len(status['significant_terms']) > 1:
        results['has_duplicates'].append({
            'guideline': pdf_name,
            'directory': 'significant_terms',
            'files': status['significant_terms']
        })
        has_issues = True
    
    if not has_issues and len(status['condensed']) == 1 and len(status['summary']) == 1:
        results['complete'].append(pdf_name)
    
    if has_issues:
        results['total_issues'] += 1

# Print summary
print("=" * 80)
print("AUDIT SUMMARY")
print("=" * 80)
print(f"\nTotal guidelines: {len(guidelines)}")
print(f"Complete (all files present, no duplicates): {len(results['complete'])}")
print(f"Guidelines with issues: {results['total_issues']}")
print()

print(f"Missing condensed files: {len(results['missing_condensed'])}")
print(f"Missing summary files: {len(results['missing_summary'])}")
print(f"Missing keywords files: {len(results['missing_keywords'])}")
print(f"Have duplicates: {len(results['has_duplicates'])}")
print()

if results['missing_condensed']:
    print("\nMISSING CONDENSED FILES:")
    for pdf in results['missing_condensed'][:10]:
        print(f"  - {pdf}")
    if len(results['missing_condensed']) > 10:
        print(f"  ... and {len(results['missing_condensed']) - 10} more")

if results['missing_summary']:
    print("\nMISSING SUMMARY FILES:")
    for pdf in results['missing_summary'][:10]:
        print(f"  - {pdf}")
    if len(results['missing_summary']) > 10:
        print(f"  ... and {len(results['missing_summary']) - 10} more")

if results['has_duplicates']:
    print("\nGUIDELINES WITH DUPLICATE FILES:")
    for dup in results['has_duplicates']:
        print(f"  - {dup['guideline'][:60]}...")
        print(f"    Directory: {dup['directory']}")
        print(f"    Files found: {len(dup['files'])}")
        for f in dup['files']:
            print(f"      * {f[:70]}...")

# Save detailed results to JSON
output_file = Path(__file__).parent.parent / 'guidelines_audit_report.json'
with open(output_file, 'w', encoding='utf-8') as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

print(f"\n\nDetailed report saved to: guidelines_audit_report.json")

