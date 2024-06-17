import os
import json
import requests
from PyPDF2 import PdfReader, PdfWriter
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

def split_pdf(input_pdf_path, output_dir):
    reader = PdfReader(input_pdf_path)
    for i, page in enumerate(reader.pages):
        writer = PdfWriter()
        writer.add_page(page)
        output_path = os.path.join(output_dir, f"page_{i+1}.pdf")
        with open(output_path, "wb") as output_pdf:
            writer.write(output_pdf)

def process_with_documentai(file_path, project_id, processor_id):
    credentials = service_account.Credentials.from_service_account_file(
        os.getenv("GOOGLE_APPLICATION_CREDENTIALS_JSON")
    )
    client = documentai.DocumentProcessorServiceClient(credentials=credentials)
    name = client.processor_path(project_id, "us", processor_id)

    with open(file_path, "rb") as image:
        image_content = image.read()

    document = {"content": image_content, "mime_type": "application/pdf"}
    request = {"name": name, "raw_document": document}
    result = client.process_document(request=request)
    return result.document.text

def extract_significant_terms(text):
    openai_api_key = load_credentials()

    try:
        encoding = tiktoken.encoding_for_model("gpt-4")
        tokens = encoding.encode(text)
        max_tokens = 6500

        if len(tokens) > max_tokens:
            tokens = tokens[:max_tokens]
            text = encoding.decode(tokens)

        prompt = f"Extract and list the 10 most significant terms from the following text in descending order of relevance, excluding generic medical terms like diagnosis, investigation and management:\n\n{text}"
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

def main(file_path):
    text = extract_text_from_pdf(file_path)
    
    # Save extracted text to a file
    extracted_text_file = f"{file_path} - extracted text.txt"
    with open(extracted_text_file, 'w') as file:
        file.write(text)
    
    # Extract significant terms from the text
    significant_terms = extract_significant_terms(text)

    if significant_terms:
        # Save significant terms to a file
        terms_file = f"{file_path} - significant terms.txt"
        with open(terms_file, 'w') as file:
            file.write(significant_terms)
        print(f"Significant terms extracted and saved to {terms_file}")
    else:
        print(f"No significant terms extracted for {file_path}")

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python extract_keywords.py <pdf_file_path>")
        sys.exit(1)
    
    file_path = sys.argv[1]
    print(f"Processing file: {file_path}")
    main(file_path)
