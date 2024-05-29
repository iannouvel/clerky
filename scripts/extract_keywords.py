import os
import sys
import json
from PyPDF2 import PdfReader, PdfWriter
import openai
from google.cloud import documentai_v1beta3 as documentai
from google.oauth2 import service_account

def split_pdf(file_path, max_pages=5):
    reader = PdfReader(file_path)
    total_pages = len(reader.pages)
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

    all_significant_terms = []
    for part_file_path in split_pdf(file_path):
        with open(part_file_path, 'rb') as document:
            document_content = document.read()

        document = {"content": document_content, "mime_type": "application/pdf"}
        request = {"name": name, "raw_document": document}

        result = client.process_document(request=request)
        extracted_text = result.document.text
        print(f"Extracted Text from {part_file_path}:")
        print(extracted_text)
        
        significant_terms = extract_significant_terms(extracted_text)
        if significant_terms:
            print("Extracted Significant Terms:")
            print(significant_terms)
            all_significant_terms.append(significant_terms)
        else:
            print("No significant terms extracted.")

    return all_significant_terms

def extract_significant_terms(text):
    openai_key = os.getenv('OPENAI_KEY')
    if not openai_key:
        raise ValueError("OpenAI API key not found. Ensure the OPENAI_KEY environment variable is set.")

    openai.api_key = openai_key

    try:
        response = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": f"Identify and list the most significant terms from the following text:\n\n{text}"}
            ],
            max_tokens=150,
        )
        return response['choices'][0]['message']['content'].strip()
    except Exception as e:
        print(f"Error while extracting terms: {e}")
    return None

def main():
    if len(sys.argv) != 2:
        print("Usage: python extract_keywords.py <file_path>")
        sys.exit(1)

    file_path = sys.argv[1]
    try:
        significant_terms = process_document(file_path)
        
        print("All Extracted Significant Terms:")
        for terms in significant_terms:
            print(terms)
            
    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    main()
