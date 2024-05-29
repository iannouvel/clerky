import os
import sys
import json
from google.cloud import documentai_v1beta3 as documentai
from google.oauth2 import service_account
import openai

def process_document(file_path):
    # Setup the path to your Google credentials
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
        document_content = document.read()

    # Prepare the document for processing
    document = {"content": document_content, "mime_type": "application/pdf"}
    request = {"name": name, "raw_document": document}

    result = client.process_document(request=request)
    text = result.document.text
    
    # Now use ChatGPT to extract keywords from the extracted text
    keywords = extract_significant_terms(text)
    return keywords

def extract_significant_terms(text):
    openai.api_key = os.getenv('OPENAI_KEY')

    response = openai.Completion.create(
        engine="text-davinci-002",  # Use an appropriate engine
        prompt=f"Identify and list the 10 most significant terms from the following text:\n\n{text}",
        max_tokens=100  # Adjust based on your needs
    )
    return response.choices[0].text.strip()

def main():
    if len(sys.argv) != 2:
        print("Usage: python extract_keywords.py <file_path>")
        sys.exit(1)

    file_path = sys.argv[1]
    keywords = process_document(file_path)
    print("Extracted Significant Terms:")
    print(keywords)

if __name__ == "__main__":
    main()
