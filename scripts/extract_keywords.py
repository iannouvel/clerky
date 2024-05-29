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

    location = 'us'  # replace with the location of your processor
    name = f'projects/{project_id}/locations/{location}/processors/{processor_id}'

    with open(file_path, 'rb') as document:
        image_content = document.read()
        pdf_content = image_content  # Assign image_content to pdf_content

    keywords = []
    page_number = 1
    for page in extract_pages_from_pdf(pdf_content):
        document = {"content": page, "mime_type": "application/pdf"}
        request = {"name": name, "raw_document": document}
        result = client.process_document(request=request)
        document = result.document
        text = document.text
        page_keywords = extract_keywords(text)
        keywords.extend(page_keywords)
        print(f"Processed page {page_number}: {page_keywords}")
        page_number += 1

    return keywords
    
def extract_pages_from_pdf(pdf_content):
    reader = PdfReader(io.BytesIO(pdf_content))
    num_pages = reader.getNumPages()

    for page_num in range(num_pages):
        page = reader.getPage(page_num)
        yield page.getContents()

def extract_keywords(text):
    # Using a simple method to extract the keywords, you can replace this with more sophisticated methods if needed
    words = text.split()
    unique_keywords = list(set(words))
    sorted_keywords = sorted(unique_keywords, key=lambda x: text.count(x), reverse=True)
    return sorted_keywords[:10] # Return the top 10 keywords

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
