#!/usr/bin/env python3
"""
Batch process missing guideline supporting files
Generates condensed, summary, and significant_terms files for guidelines missing them
"""
import sys
import os
from pathlib import Path
from PyPDF2 import PdfReader
import re
from collections import Counter
import json

# Add the project root to path to import shared modules
sys.path.insert(0, str(Path(__file__).parent.parent))

def extract_text_from_pdf(pdf_path):
    """Extract text from PDF using PyPDF2"""
    try:
        reader = PdfReader(str(pdf_path))
        text = ""
        for i, page in enumerate(reader.pages):
            try:
                page_text = page.extract_text()
                text += page_text
                if (i + 1) % 10 == 0:
                    print(f"    Extracted {i + 1}/{len(reader.pages)} pages...", file=sys.stderr)
            except Exception as e:
                print(f"    Warning: Error on page {i + 1}: {e}", file=sys.stderr)
        return text
    except Exception as e:
        print(f"    Error reading PDF: {e}", file=sys.stderr)
        return ""

def clean_text(text):
    """Clean extracted text"""
    if not text or not text.strip():
        return ""
    
    # Basic cleanup
    cleaned = text.strip()
    cleaned = re.sub(r'\x00', '', cleaned)  # Remove null chars
    cleaned = re.sub(r'\n\s*\n\s*\n+', '\n\n', cleaned)  # Multiple newlines
    cleaned = re.sub(r' +', ' ', cleaned)  # Multiple spaces
    cleaned = re.sub(r'\t+', ' ', cleaned)  # Tabs to spaces
    
    return cleaned

def generate_summary_from_text(text, guideline_name):
    """Generate a summary from the guideline text"""
    # Extract key sections (first 2000 chars + sections with 'recommendation', 'key', 'summary')
    intro = text[:2000]
    
    # Look for key sections
    text_lower = text.lower()
    summary_parts = []
    
    # Find executive summary or key recommendations
    patterns = [
        (r'executive summary.*?(?=\n[A-Z][a-z]+ [a-z]+\n|\n\d+\.|\Z)', re.DOTALL | re.IGNORECASE),
        (r'key recommendations.*?(?=\n[A-Z][a-z]+ [a-z]+\n|\n\d+\.|\Z)', re.DOTALL | re.IGNORECASE),
        (r'overview.*?(?=\n[A-Z][a-z]+ [a-z]+\n|\n\d+\.|\Z)', re.DOTALL | re.IGNORECASE),
    ]
    
    for pattern, flags in patterns:
        matches = re.findall(pattern, text, flags)
        if matches:
            summary_parts.extend(matches[:1])  # Take first match
    
    # If we found sections, use them; otherwise use intro
    if summary_parts:
        base_text = ' '.join(summary_parts)[:3000]
    else:
        base_text = intro
    
    # Clean and condense
    base_text = ' '.join(base_text.split())  # Normalize whitespace
    
    # Create a simple summary
    summary = f"This guideline provides evidence-based recommendations for {guideline_name.lower()}. "
    
    # Extract organisation from filename
    org = "clinical guideline"
    if "NICE" in guideline_name:
        org = "NICE guideline"
    elif "RCOG" in guideline_name or "GTG" in guideline_name or "BJOG" in guideline_name:
        org = "RCOG guideline"
    elif "BASHH" in guideline_name:
        org = "BASHH guideline"
    elif "BSH" in guideline_name:
        org = "British Society for Haematology guideline"
    elif "ESHRE" in guideline_name:
        org = "ESHRE guideline"
    
    summary += f"It is intended for use by healthcare professionals in clinical practice. "
    summary += base_text[:500].strip() + "..."
    
    return summary

def extract_keywords_from_text(text, max_keywords=50):
    """Extract significant medical terms from text"""
    # Common medical terms and patterns
    medical_patterns = [
        r'\b(?:pregnancy|pregnant|prenatal|antenatal|postnatal|gestational)\b',
        r'\b(?:diabetes|diabetic|glucose|insulin|HbA1c|glycaemic|hyperglycaemia|hypoglycaemia)\b',
        r'\b(?:hypertension|pre-eclampsia|eclampsia)\b',
        r'\b(?:caesarean|vaginal birth|labour|delivery|induction)\b',
        r'\b(?:fetal|neonatal|maternal|perinatal)\b',
        r'\b(?:ultrasound|screening|monitoring|assessment)\b',
        r'\b(?:complications|risk factors|morbidity|mortality)\b',
        r'\b(?:preterm|term|postpartum|intrapartum)\b',
        r'\b(?:blood pressure|thrombosis|haemorrhage|sepsis)\b',
        r'\b(?:anaemia|infection|VTE|thromboembolism)\b',
    ]
    
    # Extract words
    words = re.findall(r'\b[a-zA-Z][a-zA-Z\-]+\b', text.lower())
    
    # Filter for medical terms
    medical_terms = []
    for pattern in medical_patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        medical_terms.extend([m.lower() for m in matches])
    
    # Count frequencies
    term_counts = Counter(medical_terms)
    
    # Get top terms
    top_terms = [term for term, count in term_counts.most_common(max_keywords)]
    
    # Add common obstetric/medical terms if not already present
    essential_terms = []
    text_lower = text.lower()
    
    # Extract from guideline title/content
    if 'diabetes' in text_lower:
        essential_terms.extend(['diabetes in pregnancy', 'gestational diabetes', 'blood glucose monitoring'])
    if 'hypertension' in text_lower or 'pre-eclampsia' in text_lower:
        essential_terms.extend(['hypertension', 'pre-eclampsia', 'blood pressure'])
    if 'sepsis' in text_lower:
        essential_terms.extend(['sepsis', 'infection', 'antibiotics'])
    
    # Combine and deduplicate
    all_terms = list(dict.fromkeys(essential_terms + top_terms))
    
    return all_terms[:max_keywords]

def find_missing_guidelines():
    """Find all PDFs missing their supporting files"""
    guidance_dir = Path("guidance")
    pdfs = list(guidance_dir.glob("*.pdf"))
    
    missing = []
    for pdf in pdfs:
        base_name = pdf.stem
        summary_file = guidance_dir / "summary" / f"{base_name}.txt"
        condensed_file = guidance_dir / "condensed" / f"{base_name}.txt"
        terms_file = guidance_dir / "significant_terms" / f"{base_name}.txt"
        
        if not summary_file.exists() or not condensed_file.exists() or not terms_file.exists():
            missing.append({
                'pdf': pdf,
                'base_name': base_name,
                'needs_summary': not summary_file.exists(),
                'needs_condensed': not condensed_file.exists(),
                'needs_terms': not terms_file.exists()
            })
    
    return missing

def process_guideline(guideline_info):
    """Process a single guideline"""
    pdf_path = guideline_info['pdf']
    base_name = guideline_info['base_name']
    
    print(f"\nProcessing: {base_name}")
    
    # Ensure output directories exist
    Path("guidance/summary").mkdir(exist_ok=True)
    Path("guidance/condensed").mkdir(exist_ok=True)
    Path("guidance/significant_terms").mkdir(exist_ok=True)
    
    # Extract text if needed
    condensed_text = None
    if guideline_info['needs_condensed']:
        print(f"  Extracting text from PDF...")
        raw_text = extract_text_from_pdf(pdf_path)
        if raw_text and len(raw_text.strip()) > 100:
            condensed_text = clean_text(raw_text)
            condensed_file = Path("guidance/condensed") / f"{base_name}.txt"
            with open(condensed_file, 'w', encoding='utf-8') as f:
                f.write(condensed_text)
            print(f"  [OK] Saved condensed file ({len(condensed_text)} chars)")
        else:
            print(f"  [FAIL] Failed to extract text from PDF")
            return False
    else:
        # Load existing condensed file
        condensed_file = Path("guidance/condensed") / f"{base_name}.txt"
        if condensed_file.exists():
            with open(condensed_file, 'r', encoding='utf-8') as f:
                condensed_text = f.read()
    
    # If we don't have condensed text by now, we can't continue
    if not condensed_text:
        print(f"  [FAIL] No condensed text available")
        return False
    
    # Generate summary if needed
    if guideline_info['needs_summary']:
        print(f"  Generating summary...")
        summary = generate_summary_from_text(condensed_text, base_name)
        summary_file = Path("guidance/summary") / f"{base_name}.txt"
        with open(summary_file, 'w', encoding='utf-8') as f:
            f.write(summary)
        print(f"  [OK] Saved summary file ({len(summary)} chars)")
    
    # Generate keywords if needed
    if guideline_info['needs_terms']:
        print(f"  Generating keywords...")
        keywords = extract_keywords_from_text(condensed_text)
        terms_file = Path("guidance/significant_terms") / f"{base_name}.txt"
        with open(terms_file, 'w', encoding='utf-8') as f:
            for keyword in keywords:
                f.write(f"- {keyword}\n")
        print(f"  [OK] Saved keywords file ({len(keywords)} terms)")
    
    return True

def main():
    """Main processing function"""
    print("=" * 60)
    print("BATCH PROCESSING MISSING GUIDELINES")
    print("=" * 60)
    
    # Find missing guidelines
    missing = find_missing_guidelines()
    
    if not missing:
        print("\n[OK] No missing guidelines found!")
        return True
    
    print(f"\nFound {len(missing)} guidelines with missing files:")
    for item in missing[:5]:
        status = []
        if item['needs_summary']: status.append('summary')
        if item['needs_condensed']: status.append('condensed')
        if item['needs_terms']: status.append('terms')
        print(f"  - {item['base_name']}: missing {', '.join(status)}")
    if len(missing) > 5:
        print(f"  ... and {len(missing) - 5} more")
    
    # Process each guideline
    print(f"\nProcessing {len(missing)} guidelines...")
    success_count = 0
    failed = []
    
    for i, guideline_info in enumerate(missing, 1):
        print(f"\n[{i}/{len(missing)}]", end=" ")
        if process_guideline(guideline_info):
            success_count += 1
        else:
            failed.append(guideline_info['base_name'])
    
    # Summary
    print(f"\n{'=' * 60}")
    print(f"PROCESSING COMPLETE")
    print(f"{'=' * 60}")
    print(f"Successfully processed: {success_count}/{len(missing)}")
    
    if failed:
        print(f"\nFailed to process:")
        for name in failed:
            print(f"  - {name}")
    
    print(f"\nNext steps:")
    print(f"1. Review generated files in guidance/summary, guidance/condensed, guidance/significant_terms")
    print(f"2. Commit and push to GitHub: git add guidance/ && git commit -m 'Add missing guideline files' && git push")
    print(f"3. Wait for automatic Firestore sync or trigger manual sync in the app")
    
    return success_count > 0

if __name__ == "__main__":
    try:
        success = main()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\nFATAL ERROR: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)

