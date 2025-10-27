#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fix character encoding mismatches between PDF names in list_of_guidelines.txt
and their corresponding text files in condensed/, summary/, and significant_terms/.
"""

import os
import sys
import shutil
from pathlib import Path

# Ensure UTF-8 output
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# Define the base directory
base_dir = Path(__file__).parent.parent / "guidance"

# Define the mappings: old_name -> new_name (without .txt extension)
# These are the base names (without .pdf or .txt)
renames = {
    # 1. Early-onset Neonatal Group B Strep
    "BJOG - 2017 -  Prevention of Early‐onset Neonatal Group B Streptococcal Disease": 
        "BJOG - 2017 -  Prevention of Earlyâonset Neonatal Group B Streptococcal Disease",
    
    # 2. De Silva Outpatient Hysteroscopy  
    "BJOG - 2024 - DeÂ Silva - Outpatient Hysteroscopy":
        "BJOG - 2024 - De Silva - Outpatient Hysteroscopy",
    
    # 3. Nelson-Piercy Hyperemesis (no change needed - already matches)
    "BJOG - 2024 - NelsonâPiercy - Management of Nausea and Vomiting in Pregnancy and Hyperemesis Gravidarum":
        "BJOG - 2024 - NelsonâPiercy - Management of Nausea and Vomiting in Pregnancy and Hyperemesis Gravidarum",
    
    # 4. Oteng-Ntim Sickle Cell (no change needed - already matches)
    "BSH - 2021 - OtengâNtim - Sickle Cell Disease In Pregnancy":
        "BSH - 2021 - OtengâNtim - Sickle Cell Disease In Pregnancy"
}

directories = ["condensed", "summary", "significant_terms"]

def find_similar_file(directory, target_base):
    """Find a file that closely matches the target base name."""
    dir_path = base_dir / directory
    if not dir_path.exists():
        return None
    
    # Look for files containing key parts of the name
    key_parts = target_base.split(" - ")
    if len(key_parts) >= 3:
        search_pattern = f"*{key_parts[0]}*{key_parts[1]}*{key_parts[2][:20]}*"
    else:
        search_pattern = f"*{target_base[:30]}*"
    
    matches = list(dir_path.glob(search_pattern + ".txt"))
    if matches:
        return matches[0]
    return None

def main():
    renamed_count = 0
    
    for old_base, new_base in renames.items():
        # Skip if old and new are the same
        if old_base == new_base:
            print(f"[SKIP] Already correct: {new_base[:60]}...")
            continue
            
        for directory in directories:
            dir_path = base_dir / directory
            if not dir_path.exists():
                continue
                
            old_path = dir_path / f"{old_base}.txt"
            new_path = dir_path / f"{new_base}.txt"
            
            # If new path already exists, skip
            if new_path.exists():
                print(f"[EXISTS] {directory}/{new_base[:60]}... already exists")
                continue
            
            # Try to find the old file (might have encoding issues in the name)
            if old_path.exists():
                found_file = old_path
            else:
                # Try to find it with fuzzy matching
                found_file = find_similar_file(directory, old_base)
            
            if found_file and found_file.exists():
                try:
                    shutil.move(str(found_file), str(new_path))
                    print(f"[OK] Renamed in {directory}/: {found_file.name[:50]}... -> {new_path.name[:50]}...")
                    renamed_count += 1
                except Exception as e:
                    print(f"[ERROR] Failed to rename {found_file}: {e}")
            else:
                print(f"[NOT FOUND] {directory}/{old_base[:60]}...")
    
    print(f"\n[SUMMARY] Renamed {renamed_count} files total")

if __name__ == "__main__":
    main()

