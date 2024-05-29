import os
import sys
import json
import io
from google.cloud import documentai_v1beta3 as documentai
from google.oauth2 import service_account
from PyPDF2 import PdfReader

def process_document(file_path):
    credentials_path = os.path.join(os.getcwd(), 'credentials.json')
    if not os.path.exists(credentials_path):
        raise FileNotFoundError(f"Credentials file not found: {credentials_path}")

    with open(credentials_path, 'r') as credentials_file:
        credentials_data = json.load(credentials_file)

    credentials = service_account.Credentials.from_service_account_info(credentials_data)
    client = documentai.DocumentProcessorServiceClient(credentials=credentials)

    project_id = os.getenv('GCP_PROJECT_ID')
    processor_id = os.getenv('GCP_PROCESSOR_ID')
    if not project_id or not processor_id:
        raise ValueError("GCP_PROJECT_ID or GCP_PROCESSOR_ID environment variable is not set.")

    location = 'us'  # Customize this as necessary
    name = f'projects/{project_id}/locations/{location}/processors/{processor_id}'

    with open(file_path, 'rb') as document:
        pdf_content = document.read()

    keywords = []
    page_number = 1
    for page_text in extract_pages_from_pdf(pdf_content):
        document = {"content": page_text, "mime_type": "application/pdf"}
        request = {"name": name, "raw_document": document}
        result = client.process_document(request=request)
        text = result.document.text
        page_keywords = extract_keywords(text)
        keywords.extend(page_keywords)
        print(f"Processed page {page_number}: {page_keywords}")
        page_number += 1

    return keywords

def extract_pages_from_pdf(pdf_content):
    reader = PdfReader(io.BytesIO(pdf_content))
    for page in reader.pages:
        yield page.extract_text()

def extract_keywords(text):
    words = text.split()
    unique_keywords = list(set(words))
    # Sort keywords based on their frequency in descending order and select top 10
    sorted_keywords = sorted(unique_keywords, key=lambda x: words.count(x), reverse=True)
    return sorted_keywords[:10]

def main():
    if len(sys.argv) != 2:
        print("Usage: python extract_keywords.py <file_path>")
        sys.exit(1)

    file_path = sys.argv[1]
    keywords = process_document(file_path)
    print("Extracted Keywords:")
    print(keywords)

if __name__ == "__main__":
    main()
