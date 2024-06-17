import os
import json
from PyPDF2 import PdfReader, PdfWriter
from google.cloud import documentai_v1beta3 as documentai
from google.oauth2 import service_account
from openai import OpenAI
import tiktoken

def load_credentials():
    openai.api_key = os.getenv("OPENAI_API_KEY")

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
    openai_key = os.getenv('OPENAI_API_KEY')
    if not openai_key:
        raise ValueError("OpenAI API key not found. Ensure the OPENAI_API_KEY environment variable is set.")

    try:
        encoding = tiktoken.encoding_for_model("gpt-4")
        tokens = encoding.encode(text)
        max_tokens = 8000

        if len(tokens) > max_tokens:
            tokens = tokens[:max_tokens]
            text = encoding.decode(tokens)

        completion = openai.ChatCompletion.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are a text analyzer. Extract and list the most significant terms from the provided text."},
                {"role": "user", "content": f"Extract and list the most significant terms from the following text:\n\n{text}"}
            ]
        )

        significant_terms = completion.choices[0].message.content.strip()
        return significant_terms
    except Exception as e:
        print(f"Error while extracting terms: {e}")
    return None

def main(file_path):
    load_credentials()
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
