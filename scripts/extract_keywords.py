import os
import json
import requests
from PyPDF2 import PdfReader
from google.cloud import documentai_v1beta3 as documentai
from google.oauth2 import service_account
import tiktoken

def load_credentials():
    openai_api_key = os.getenv('OPENAI_API_KEY')
    if not openai_api_key:
        raise ValueError("OpenAI API key not found. Ensure the OPENAI_API_KEY environment variable is set.")
    return openai_api_key

def extract_text_from_pdf(file_path):
    reader = PdfReader(file_path)
    text = ""
    for page in reader.pages:
        text += page.extract_text()
    return text

def extract_significant_terms(text):
    try:
        openai_api_key = load_credentials()
        prompt = f"Extract significant medical terms like diagnosis, investigation and management:\n\n{text}"
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
            raise Exception(f"OpenAI API error: {error_details['error']['message']}")

        data = response.json()
        significant_terms = data['choices'][0]['message']['content'].strip()
        return significant_terms
    except Exception as e:
        print(f"Error while extracting terms: {e}")
    return None

def main():
    guidance_dir = 'guidance'
    for file_name in os.listdir(guidance_dir):
        if file_name.endswith('.pdf'):
            file_path = os.path.join(guidance_dir, file_name)
            extracted_text_file = f"{file_path} - extracted text.txt"
            terms_file = f"{file_path} - significant terms.txt"

            # Check if the work has already been done
            if os.path.exists(extracted_text_file) and os.path.exists(terms_file):
                print(f"Skipping {file_path} as it has already been processed.")
                continue

            print(f"Processing file: {file_path}")

            text = extract_text_from_pdf(file_path)

            # Save extracted text to a file
            with open(extracted_text_file, 'w') as file:
                file.write(text)

            # Extract significant terms from the text
            significant_terms = extract_significant_terms(text)

            if significant_terms:
                # Save significant terms to a file
                with open(terms_file, 'w') as file:
                    file.write(significant_terms)
                print(f"Significant terms extracted and saved to {terms_file}")
            else:
                print(f"No significant terms extracted for {file_path}")

if __name__ == "__main__":
    main()
