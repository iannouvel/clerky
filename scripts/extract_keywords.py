import os
import sys
import json
from PyPDF2 import PdfReader, PdfWriter
import openai
from google.cloud import documentai_v1beta3 as documentai
from google.oauth2 import service_account

def split_pdf(file_path, max_pages=15):
    reader = PdfReader(file_path)
    total_pages = len(reader.pages)
    if total_pages <= max_pages:
        return [file_path]

    output_files = []
    for start in range(0, total_pages, max_pages):
        writer = PdfWriter()
        end = min(start + max_pages, total_pages)
        for page_number in range(start, end):
            writer.add_page(reader.pages[page_number])

        split_file_path = f"{file_path}_part_{start // max_pages + 1}.pdf"
        with open(split_file_path, 'wb') as f:
            writer.write(f)
        output_files.append(split_file_path)
    
    return output_files

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

    extracted_text = ""
    for part_file_path in split_pdf(file_path):
        with open(part_file_path, 'rb') as document:
            document_content = document.read()

        document = {"content": document_content, "mime_type": "application/pdf"}
        request = {"name": name, "raw_document": document}

        result = client.process_document(request=request)
        extracted_text += result.document.text + "\n"

    return extracted_text

def extract_significant_terms(text):

    project_id = os.getenv('OPENAI_KEY')
    response = openai.Completion.create(
        engine="text-davinci-002",  # Use an appropriate engine
        prompt=f"Identify and list the most significant terms from the following text:\n\n{text}",
        max_tokens=100  # Adjust based on your needs
    )
    return response.choices[0].text.strip()

def main():
    if len(sys.argv) != 2:
        print("Usage: python extract_keywords.py <file_path>")
        sys.exit(1)

    file_path = sys.argv[1]
    document_text = process_document(file_path)
    print("Extracted Document Text:")
    print(document_text)
    
    significant_terms = extract_significant_terms(document_text)
    print("Extracted Significant Terms:")
    print(significant_terms)

if __name__ == "__main__":
    main()
