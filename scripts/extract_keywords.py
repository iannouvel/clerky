import os
import json
from PyPDF2 import PdfReader, PdfWriter
from google.cloud import documentai_v1beta3 as documentai
from google.oauth2 import service_account
from openai import OpenAI

def load_credentials_from_env():
    google_credentials_json = os.getenv('GOOGLE_APPLICATION_CREDENTIALS_JSON')
    if not google_credentials_json:
        raise ValueError("Environment variable GOOGLE_APPLICATION_CREDENTIALS_JSON is not set or is empty")
    try:
        credentials_info = json.loads(google_credentials_json)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON in GOOGLE_APPLICATION_CREDENTIALS_JSON: {e}")
    return credentials_info

if __name__ == "__main__":
    try:
        credentials = load_credentials_from_env()
        print("Credentials loaded successfully")
    except Exception as e:
        print(f"Error loading credentials: {e}")

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
        output_files.append(split_file_path)

        with open(split_file_path, 'wb') as f:
            writer.write(f)

    return output_files

def process_document(file_path):
    credentials = load_credentials_from_env()
    client = documentai.DocumentProcessorServiceClient(credentials=credentials)
    if not os.path.exists(credentials_path):
        raise FileNotFoundError(f"Credentials file not found: {credentials_path}")

    with open(credentials_path, 'r') as credentials_file:
        credentials_data = json.load(credentials_file)

    project_id = os.getenv('GCP_PROJECT_ID')
    processor_id = os.getenv('GCP_PROCESSOR_ID')
    if not project_id or not processor_id:
        raise ValueError("GCP_PROJECT_ID or GCP_PROCESSOR_ID environment variable is not set.")

    location = 'us'  # Customize this as necessary
    name = f'projects/{project_id}/locations/{location}/processors/{processor_id}'

    all_text = ""
    for part_file_path in split_pdf(file_path):
        with open(part_file_path, 'rb') as document:
            document_content = document.read()

        document = {"content": document_content, "mime_type": "application/pdf"}
        request = {"name": name, "raw_document": document}

        result = client.process_document(request=request)
        document_text = result.document.text
        all_text += document_text

        # Remove the temporary split PDF file
        os.remove(part_file_path)

    # Save the entire extracted text to a file
    output_text_file = f"{file_path} - extracted text.txt"
    with open(output_text_file, 'w', encoding='utf-8') as text_file:
        text_file.write(all_text)
        print(f"Extracted text saved to {output_text_file}")

    return all_text

def extract_significant_terms(text):
    openai_key = os.getenv('OPENAI_API_KEY')
    if not openai_key:
        raise ValueError("OpenAI API key not found. Ensure the OPENAI_API_KEY environment variable is set.")

    try:
        client = OpenAI(api_key=openai_key)
        
        completion = client.chat.completions.create(
            model="gpt-4o",
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

def load_existing_terms(file_path):
    if os.path.exists(file_path):
        try:
            with open(file_path, 'r') as file:
                return json.load(file)
        except json.JSONDecodeError as e:
            print(f"Error reading JSON file {file_path}: {e}")
            return {}
    return {}

def save_terms(file_path, terms):
    with open(file_path, 'w') as file:
        json.dump(terms, file, indent=4)

def main():
    guidance_folder = 'guidance'
    terms_file_path = 'significant_terms.txt'
    existing_terms = load_existing_terms(terms_file_path)

    for file_name in os.listdir(guidance_folder):
        if file_name.endswith('.pdf'):
            file_path = os.path.join(guidance_folder, file_name)
            file_identifier = os.path.basename(file_path)
            extracted_text_file = f"{file_path} - extracted text.txt"

            # Check if the extracted text file already exists
            if os.path.exists(extracted_text_file):
                print(f"Extracted text file for {file_identifier} already exists. Skipping text extraction.")
            else:
                try:
                    all_text = process_document(file_path)
                except Exception as e:
                    print(f"An error occurred while extracting text for {file_identifier}: {e}")
                    continue

            if file_identifier in existing_terms:
                print(f"Terms for {file_identifier} already extracted. Skipping.")
                continue

            try:
                significant_terms = extract_significant_terms(all_text)
                if significant_terms:
                    existing_terms[file_identifier] = significant_terms
                    save_terms(terms_file_path, existing_terms)
                    print(f"Terms for {file_identifier} saved.")
                else:
                    print(f"No significant terms extracted for {file_identifier}.")
            except Exception as e:
                print(f"An error occurred with file {file_identifier}: {e}")

if __name__ == "__main__":
    main()
