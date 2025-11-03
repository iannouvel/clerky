#!/usr/bin/env python3
"""
Classify guidelines using DeepSeek AI
"""

import os
import sys
from pathlib import Path
import json
from collections import defaultdict

try:
    import PyPDF2
except ImportError:
    print("PyPDF2 is not installed. Installing it now...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "PyPDF2"])
    import PyPDF2

try:
    import requests
except ImportError:
    print("requests is not installed. Installing it now...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests"])
    import requests

def extract_text_from_pdf(pdf_path, max_chars=3000):
    """Extract text from a PDF file (first few pages only)"""
    try:
        with open(pdf_path, 'rb') as file:
            pdf_reader = PyPDF2.PdfReader(file)
            text = ""
            # Read first few pages only to save tokens
            max_pages = min(5, len(pdf_reader.pages))
            for i in range(max_pages):
                text += pdf_reader.pages[i].extract_text()
                if len(text) > max_chars:
                    break
            return text[:max_chars]  # Limit to reduce API costs
    except Exception as e:
        return None

def classify_document(text, filename, api_key):
    """Use DeepSeek API to classify the document"""
    
    prompt = f"""You are analyzing a healthcare document. Based on the content below, classify this document into ONE of these categories:

Categories:
- GUIDELINE: Clinical guidelines for patient care and treatment protocols
- FLOWCHART: Visual flowcharts or clinical pathways
- POLICY: Organisational policies, governance documents, or procedural policies
- SOP: Standard Operating Procedures (detailed step-by-step procedures)
- PROTOCOL: Treatment protocols or care protocols
- PATHWAY: Care pathways or patient pathways
- FORM: Forms, proformas, or templates
- OTHER: If it doesn't clearly fit the above categories

Document filename: {filename}

Document text (first 3000 characters):
{text}

Respond with ONLY the category name (one word: GUIDELINE, FLOWCHART, POLICY, SOP, PROTOCOL, PATHWAY, FORM, or OTHER). No explanation needed."""

    try:
        response = requests.post(
            "https://api.deepseek.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": "deepseek-chat",
                "messages": [
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.1,
                "max_tokens": 10
            },
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            classification = result['choices'][0]['message']['content'].strip().upper()
            # Clean up the response to ensure it's one of our categories
            valid_categories = ["GUIDELINE", "FLOWCHART", "POLICY", "SOP", "PROTOCOL", "PATHWAY", "FORM", "OTHER"]
            for category in valid_categories:
                if category in classification:
                    return category
            return "OTHER"
        else:
            print(f"\nAPI Error: {response.status_code} - {response.text}")
            return "ERROR"
    except Exception as e:
        print(f"\nAPI Request failed: {str(e)}")
        return "ERROR"

def main():
    # Get API key
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        api_key = input("Enter your DeepSeek API key: ").strip()
        if not api_key:
            print("Error: API key is required")
            return
    
    # Read the list of guidelines
    guidelines_file = "guidelines-list.txt"
    if not os.path.exists(guidelines_file):
        print(f"Error: {guidelines_file} not found")
        return
    
    with open(guidelines_file, 'r', encoding='utf-8') as f:
        pdf_paths = [line.strip() for line in f if line.strip()]
    
    print(f"Found {len(pdf_paths)} guidelines to classify")
    print("Starting classification...\n")
    
    # Track classifications
    classifications = defaultdict(int)
    detailed_results = []
    processed = 0
    errors = 0
    
    # Results file to save progress
    results_file = "classification-results.json"
    
    for pdf_path in pdf_paths:
        processed += 1
        pdf_name = Path(pdf_path).name
        
        print(f"Progress: {processed}/{len(pdf_paths)} ({(processed/len(pdf_paths)*100):.1f}%) - {pdf_name[:60]}...", end='\r')
        
        # Check if file exists
        if not os.path.exists(pdf_path):
            errors += 1
            detailed_results.append({
                "filename": pdf_name,
                "path": pdf_path,
                "classification": "FILE_NOT_FOUND"
            })
            continue
        
        # Extract text
        text = extract_text_from_pdf(pdf_path)
        if not text:
            errors += 1
            detailed_results.append({
                "filename": pdf_name,
                "path": pdf_path,
                "classification": "EXTRACTION_ERROR"
            })
            continue
        
        # Classify
        category = classify_document(text, pdf_name, api_key)
        classifications[category] += 1
        
        detailed_results.append({
            "filename": pdf_name,
            "path": pdf_path,
            "classification": category
        })
        
        # Save progress every 50 files
        if processed % 50 == 0:
            with open(results_file, 'w', encoding='utf-8') as f:
                json.dump(detailed_results, f, indent=2, ensure_ascii=False)
            print(f"\nProgress saved ({processed}/{len(pdf_paths)})...")
    
    # Save final results
    with open(results_file, 'w', encoding='utf-8') as f:
        json.dump(detailed_results, f, indent=2, ensure_ascii=False)
    
    # Print summary
    print("\n\n" + "="*60)
    print("CLASSIFICATION SUMMARY")
    print("="*60)
    
    # Sort by count
    sorted_categories = sorted(classifications.items(), key=lambda x: x[1], reverse=True)
    
    total_classified = sum(count for cat, count in sorted_categories if cat not in ["ERROR", "FILE_NOT_FOUND", "EXTRACTION_ERROR"])
    
    for category, count in sorted_categories:
        percentage = (count / len(pdf_paths)) * 100
        print(f"{category:20s}: {count:4d} ({percentage:5.1f}%)")
    
    print("="*60)
    print(f"Total processed: {processed}")
    print(f"Successfully classified: {total_classified}")
    print(f"Errors: {errors}")
    print(f"\nDetailed results saved to: {os.path.abspath(results_file)}")
    
    # Create a summary CSV file
    csv_file = "classification-summary.csv"
    with open(csv_file, 'w', encoding='utf-8') as f:
        f.write("Filename,Category,Path\n")
        for result in detailed_results:
            filename = result['filename'].replace('"', '""')
            category = result['classification']
            path = result['path'].replace('"', '""')
            f.write(f'"{filename}","{category}","{path}"\n')
    
    print(f"Summary CSV saved to: {os.path.abspath(csv_file)}")

if __name__ == "__main__":
    main()

