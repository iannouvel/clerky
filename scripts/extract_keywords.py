import os
import json
import requests
from PyPDF2 import PdfReader
from google.cloud import documentai_v1beta3 as documentai
from google.oauth2 import service_account
import tiktoken
import logging

SIGNIFICANT_TERMS_FILE = 'significant_terms.json'

def load_credentials():
    openai_api_key = os.getenv('OPENAI_API_KEY')
    if not openai_api_key:
        raise ValueError("OpenAI API key not found. Ensure the OPENAI_API_KEY environment variable is set.")
    return openai_api_key

def extract_text_from_pdf(file_path):
    try:
        reader = PdfReader(file_path)
        text = ""
        for page in reader.pages:
            text += page.extract_text()
        return text
    except Exception as e:
        logging.error(f"Error reading PDF {file_path}: {e}")
        return ""

def extract_significant_terms(text):
    try:
        encoding = tiktoken.encoding_for_model("gpt-4")
        tokens = encoding.encode(text)
        max_tokens = 4000

        if len(tokens) > max_tokens:
            tokens = tokens[:max_tokens]
            text = encoding.decode(tokens)
        
        openai_api_key = load_credentials()
        prompt = f"Please extract the 10 most clinically relevant terms from this text, excluding common medical words like diagnosis, investigation, management:\n\n{text}"
        body = {
            "model": "gpt-4",
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "max_tokens": 1000,
            "temperature": 0.5
        }

        response = requests.post(
            'https://api.openai.com/v1/chat/completions',
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {openai_api_key}'
            },
            data=json.dumps(body)
        )

        if response.status_code != 200:
            error_details = response.json()
            raise Exception(f"OpenAI API error: {error_details.get('error', {}).get('message', 'Unknown error')}")

        data = response.json()
        significant_terms = data['choices'][0]['message']['content'].strip()
        return significant_terms
    except Exception as e:
        logging.error(f"Error while extracting terms: {e}")
        return None

def compile_significant_terms():
    guidance_dir = 'guidance'
    significant_terms_dict = {}

    if not os.path.isdir(guidance_dir):
        logging.error(f"Directory {guidance_dir} does not exist.")
        return

    for file_name in os.listdir(guidance_dir):
        if file_name.endswith('.pdf'):
            file_path = os.path.join(guidance_dir, file_name)
            text = extract_text_from_pdf(file_path)
            if text:
                significant_terms = extract_significant_terms(text)
                if significant_terms:
                    significant_terms_dict[file_name] = significant_terms

    with open(SIGNIFICANT_TERMS_FILE, 'w') as f:
        json.dump(significant_terms_dict, f, indent=4)

def main():
    guidance_dir = 'guidance'
    for file_name in os.listdir(guidance_dir):
        if file_name.endswith('.pdf'):
            file_path = os.path.join(guidance_dir, file_name)
            extracted_text_file = f"{file_path} - extracted text.txt"
            terms_file = f"{file_path} - significant terms.txt"

            # Check if the work has already been done
            if os.path.exists(extracted_text_file) and os.path.exists(terms_file):
                logging.info(f"Skipping {file_path} as it has already been processed.")
                continue

            logging.info(f"Processing file: {file_path}")

            text = extract_text_from_pdf(file_path)
            if not text:
                continue

            # Save extracted text to a file
            with open(extracted_text_file, 'w') as file:
                file.write(text)

            # Extract significant terms from the text
            significant_terms = extract_significant_terms(text)

            if significant_terms:
                # Save significant terms to a file
                with open(terms_file, 'w') as file:
                    file.write(significant_terms)
                logging.info(f"Significant terms extracted and saved to {terms_file}")
            else:
                logging.warning(f"No significant terms extracted for {file_path}")

    # Compile all significant terms into a single JSON file
    compile_significant_terms()

def compile_significant_terms():
    guidance_dir = 'guidance'
    significant_terms_dict = {}

    if not os.path.isdir(guidance_dir):
        logging.error(f"Directory {guidance_dir} does not exist.")
        return

    for file_name in os.listdir(guidance_dir):
        if file_name.endswith('.pdf'):
            terms_file = os.path.join(guidance_dir, f"{file_name} - significant terms.txt")
            if os.path.exists(terms_file):
                with open(terms_file, 'r') as file:
                    significant_terms = file.read()
                    significant_terms_dict[file_name] = significant_terms

    with open(SIGNIFICANT_TERMS_FILE, 'w') as f:
        json.dump(significant_terms_dict, f, indent=4)

    logging.info(f"Significant terms compiled into {SIGNIFICANT_TERMS_FILE}")

if __name__ == "__main__":
    main()
