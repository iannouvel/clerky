#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Verify that the 4 fixed guidelines now have their properly named files.
"""

import sys
from pathlib import Path

# Ensure UTF-8 output
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

base_dir = Path(__file__).parent.parent / "guidance"

# The 4 guidelines that were fixed (base names without .pdf)
guidelines = [
    "BJOG - 2017 -  Prevention of Earlyâonset Neonatal Group B Streptococcal Disease",
    "BJOG - 2024 - De Silva - Outpatient Hysteroscopy",
    "BJOG - 2024 - NelsonâPiercy - Management of Nausea and Vomiting in Pregnancy and Hyperemesis Gravidarum",
    "BSH - 2021 - OtengâNtim - Sickle Cell Disease In Pregnancy"
]

directories = ["condensed", "summary", "significant_terms"]

print("Verifying fixed guideline files:\n")
all_good = True

for guideline in guidelines:
    print(f"\n{guideline[:60]}...")
    for directory in directories:
        file_path = base_dir / directory / f"{guideline}.txt"
        exists = file_path.exists()
        status = "[OK]" if exists else "[MISSING]"
        print(f"  {status} {directory}/")
        if not exists and directory in ["condensed", "summary"]:
            all_good = False
            # Try to find similar files
            dir_path = base_dir / directory
            if dir_path.exists():
                pattern = guideline.split(" - ")[0] + "*" + guideline.split(" - ")[1][:10] + "*"
                matches = list(dir_path.glob(pattern + ".txt"))
                if matches:
                    print(f"      Found similar: {matches[0].name[:50]}...")

if all_good:
    print("\n[SUCCESS] All required files exist!")
else:
    print("\n[WARNING] Some files are still missing")

