#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Remove duplicate files in condensed/, summary/, and significant_terms/.
For each guideline, ensure exactly ONE file exists in each directory.
Keep the largest file (most complete content).
"""

import sys
from pathlib import Path

# Ensure UTF-8 output
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

base_dir = Path(__file__).parent.parent / "guidance"

# Read guidelines list
with open(base_dir / "list_of_guidelines.txt", 'r', encoding='utf-8') as f:
    guidelines = [line.strip().replace('.pdf', '') for line in f if line.strip()]

print(f"Checking {len(guidelines)} guidelines for duplicate files...\n")

directories = {
    'condensed': base_dir / 'condensed',
    'summary': base_dir / 'summary',
    'significant_terms': base_dir / 'significant_terms'
}

duplicates_removed = 0
orphans_found = []

for guideline_base in guidelines:
    for dir_name, dir_path in directories.items():
        if not dir_path.exists():
            continue
        
        # Look for exact match
        exact_match = dir_path / f"{guideline_base}.txt"
        
        # Look for similar files (fuzzy match using first few parts of name)
        parts = guideline_base.split(' - ')
        if len(parts) >= 2:
            pattern = f"{parts[0]} - {parts[1][:15]}*"
            matches = list(dir_path.glob(pattern + ".txt"))
        else:
            matches = [exact_match] if exact_match.exists() else []
        
        # Filter to only files that reasonably match this guideline
        relevant_matches = []
        for m in matches:
            # Simple heuristic: if the first two parts match closely, it's relevant
            if len(parts) >= 2:
                if parts[0] in m.name and parts[1][:10] in m.name:
                    relevant_matches.append(m)
        
        if len(relevant_matches) > 1:
            # Keep the largest file, delete others
            relevant_matches.sort(key=lambda x: x.stat().st_size, reverse=True)
            keep = relevant_matches[0]
            
            for dup in relevant_matches[1:]:
                print(f"[DUPLICATE] {dir_name}/{dup.name}")
                print(f"  Keeping: {keep.name} ({keep.stat().st_size} bytes)")
                print(f"  Deleting: {dup.name} ({dup.stat().st_size} bytes)")
                dup.unlink()
                duplicates_removed += 1

# Check for orphaned files (files that don't match any guideline)
print(f"\n\nChecking for orphaned files...")
for dir_name, dir_path in directories.items():
    if not dir_path.exists():
        continue
    
    all_files = set(f.name for f in dir_path.glob("*.txt"))
    expected_files = set(f"{g}.txt" for g in guidelines)
    
    orphans = all_files - expected_files
    if orphans:
        print(f"\n{dir_name}/ has {len(orphans)} files not matching any guideline:")
        for orphan in sorted(list(orphans)[:10]):
            print(f"  - {orphan}")
            orphans_found.append(f"{dir_name}/{orphan}")
        if len(orphans) > 10:
            print(f"  ... and {len(orphans) - 10} more")

print(f"\n\n{'='*80}")
print("SUMMARY")
print('='*80)
print(f"Duplicates removed: {duplicates_removed}")
print(f"Orphaned files found: {len(orphans_found)}")
if duplicates_removed == 0 and len(orphans_found) == 0:
    print("\n[OK] No cleanup needed - all files are properly organized!")

