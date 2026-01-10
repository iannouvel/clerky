#!/usr/bin/env python3
"""
Script to synchronize clinical issues with guidelines.
It fetches guidelines from Firestore and uses an LLM to ensure each guideline
is covered by an issue in clinical_issues.json.
"""
import json
import logging
import os
import sys
import argparse
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore
from shared.openai_client import OpenAIClient
from tenacity import retry, stop_after_attempt, wait_fixed

# Initialize logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)

CLIENT = None

def get_ai_client():
    global CLIENT
    if CLIENT is None:
        CLIENT = OpenAIClient()
    return CLIENT

def init_firebase():
    """Initialize Firebase Admin SDK"""
    try:
        firebase_admin.get_app()
        return firestore.client()
    except ValueError:
        logging.info("Initializing Firebase...")
        # Start looking for credentials from the current script's location
        # The script is in /scripts, so we want to look up from there
        
        # Possible locations for gcloud_key.json
        possible_keys = [
            Path('gcloud_key.json'), # Current dir (if run from root)
            Path(__file__).parent.parent / 'gcloud_key.json', # Project root
            Path(__file__).parent / 'gcloud_key.json', # Scripts dir
        ]
        
        cred = None
        # Check env var first
        service_account_path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
        if service_account_path and os.path.exists(service_account_path):
             cred = credentials.Certificate(service_account_path)
        else:
            for key_path in possible_keys:
                if key_path.exists():
                    cred = credentials.Certificate(str(key_path))
                    break
        
        if not cred:
            logging.error("No Firebase credentials found!")
            sys.exit(1)
        
        firebase_admin.initialize_app(cred)
        return firestore.client()

def load_clinical_issues():
    """Load the current clinical issues JSON"""
    try:
        with open('clinical_issues.json', 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        # Try full path if running from scripts dir
        path = Path(__file__).parent.parent / 'clinical_issues.json'
        with open(path, 'r') as f:
            return json.load(f)

def save_clinical_issues(issues):
    """Save the updated clinical issues JSON"""
    # Try current dir first, then project root
    if os.path.exists('clinical_issues.json'):
         with open('clinical_issues.json', 'w') as f:
            json.dump(issues, f, indent=2)
    else:
        path = Path(__file__).parent.parent / 'clinical_issues.json'
        with open(path, 'w') as f:
            json.dump(issues, f, indent=2)

@retry(stop=stop_after_attempt(3), wait=wait_fixed(2))
def analyze_guideline(guideline_data, existing_issues_flat):
    """
    Use LLM to check if guideline is covered by existing issues.
    Returns: None if covered, or "Category: Issue Name" if not covered.
    """
    client = get_ai_client()
    
    title = guideline_data.get('title', 'Unknown Title')
    content = guideline_data.get('content', '')
    summary = guideline_data.get('summary', '')[:1000] # Use summary if available, else truncated content
    
    if not summary and content:
        summary = content[:1000]
    
    prompt = f"""
    You are a clinical taxonomist. We have a list of tracked "Clinical Issues".
    
    Guideline Title: {title}
    Guideline Summary/Excerpt: {summary}
    
    Existing Clinical Issues:
    {json.dumps(existing_issues_flat, indent=2)}
    
    Task:
    Determine if this guideline is substantially covered by one of the EXISTING clinical issues.
    "Covered" means there is a general topic in the list that would naturally include this guideline.
    
    If it is covered, reply exactly with: "COVERED"
    
    If it is NOT covered, suggest a new clinical issue name and a category for it.
    The categories are usually "obstetrics" or "gynaecology" (or suggested new ones if strictly necessary).
    Reply in the format: "NEW: <Category>: <Issue Name>"
    
    Example: "NEW: obstetrics: Postpartum thyroiditis"
    """
    
    provider = os.getenv('PREFERRED_AI_PROVIDER', 'OpenAI')
    model = "gpt-4-turbo" if provider == 'OpenAI' else "deepseek-chat"
    
    response = client.chat_completion(
        messages=[{"role": "user", "content": prompt}],
        model=model,
        provider=provider
    )
    
    return response.strip()

def main():
    parser = argparse.ArgumentParser(description="Synchronize clinical issues with guidelines")
    parser.add_argument('--dry-run', action='store_true', help="Don't save changes, just print them")
    args = parser.parse_args()
    
    # Ensure we are in project root or can find files
    if not os.path.exists('clinical_issues.json') and not (Path(__file__).parent.parent / 'clinical_issues.json').exists():
        logging.error("Could not find clinical_issues.json. Please run from project root.")
        sys.exit(1)

    db = init_firebase()
    issues_data = load_clinical_issues()
    
    # Flatten existing issues for the prompt
    existing_issues_flat = []
    for category, issues in issues_data.items():
        existing_issues_flat.extend(issues)
    
    logging.info(f"Loaded {len(existing_issues_flat)} existing clinical issues.")
    
    # Fetch guidelines
    guidelines_ref = db.collection('guidelines')
    guidelines = list(guidelines_ref.stream())
    logging.info(f"Fetched {len(guidelines)} guidelines from Firestore.")
    
    new_issues_found = []
    
    for doc in guidelines:
        data = doc.to_dict()
        title = data.get('title', doc.id)
        logging.info(f"Checking guideline: {title}")
        
        try:
            result = analyze_guideline(data, existing_issues_flat)
        except Exception as e:
            logging.error(f"Failed to analyze {title}: {e}")
            continue
            
        if result.startswith("NEW:"):
            # Parse the new issue
            # Expected "NEW: category: issue name"
            parts = result.replace("NEW:", "").strip().split(":")
            if len(parts) >= 2:
                category = parts[0].strip().lower()
                issue_name = parts[1].strip()
                
                logging.info(f"  -> Suggests adding: [{category}] {issue_name}")
                
                # Check if we already plan to add this in this run
                duplicate = False
                for item in new_issues_found:
                    if item['issue'] == issue_name:
                        duplicate = True
                        break
                
                if not duplicate:
                     # Check if it's already in the file (LLM might have missed it or hallucinated)
                    if issue_name in existing_issues_flat:
                        logging.info("  -> Actually, this issue already exists. Skipping.")
                    else:
                        new_issues_found.append({
                            'category': category,
                            'issue': issue_name,
                            'source_guideline': title
                        })
                        existing_issues_flat.append(issue_name) # Add to temp list so we don't re-add
            else:
                logging.warning(f"  -> Could not parse suggestion: {result}")
        elif result == "COVERED":
            logging.info("  -> Covered.")
        else:
            logging.info(f"  -> Unexpected response: {result}")

    if not new_issues_found:
        logging.info("No new clinical issues found.")
        return

    logging.info(f"\nFound {len(new_issues_found)} new issues to add:")
    for item in new_issues_found:
        print(f"- [{item['category']}] {item['issue']} (from {item['source_guideline']})")

    if args.dry_run:
        logging.info("\nDry run complete. No changes saved.")
    else:
        # Update the data structure
        for item in new_issues_found:
            cat = item['category']
            # Normalize category if needed (try to map to existing or make new)
            # Simple mapping to current structure:
            if 'obstetric' in cat:
                target_cat = 'obstetrics'
            elif 'gynaeco' in cat or 'gyneco' in cat:
                target_cat = 'gynaecology'
            else:
                # If strictly new category is needed, or just default to one?
                # For now let's just add it as a new key if it doesn't match
                target_cat = cat
            
            if target_cat not in issues_data:
                issues_data[target_cat] = []
            
            if item['issue'] not in issues_data[target_cat]:
                 issues_data[target_cat].append(item['issue'])
        
        save_clinical_issues(issues_data)
        logging.info("Changes saved to clinical_issues.json")

if __name__ == "__main__":
    main()
