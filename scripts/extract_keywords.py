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
    openai_key = os.getenv('OPENAI_API_KEY')
    if not openai_key:
        raise ValueError("OpenAI API key not found. Ensure the OPENAI_API_KEY environment variable is set.")

    try:
        client = openai.OpenAI(api_key=openai_key)
        
        assistant = client.beta.assistants.create(
            name="Text Analyzer",
            instructions="You are a text analyzer. Extract and list the most significant terms from the provided text.",
            model="gpt-4-1106-preview",
        )
        
        thread = client.beta.threads.create()
        
        message = client.beta.threads.messages.create(
            thread_id=thread.id,
            role="user",
            content=f"Extract and list the most significant terms from the following text:\n\n{text}",
        )
        
        run = client.beta.threads.runs.create_and_poll(
            thread_id=thread.id,
            assistant_id=assistant.id,
            instructions="Please extract the most significant terms from the provided text.",
        )
        
        if run.status == "completed":
            messages = client.beta.threads.messages.list(thread_id=thread.id)
            
            significant_terms = []
            for message in messages:
                if message.role == "assistant" and message.content[0].type == "text":
                    significant_terms.append(message.content[0].text.value.strip())
            
            client.beta.assistants.delete(assistant.id)
            return "\n".join(significant_terms)
        
    except Exception as e:
        print(f"Error while extracting terms: {e}")
    return None

def load_existing_terms(file_path):
    if not os.path.exists(file_path):
        return {}

    with open(file_path, 'r') as file:
        lines = file.readlines()

    terms_dict = {}
    for line in lines:
        if ':' in line:
            file_identifier, terms = line.split(':', 1)
            terms_dict[file_identifier.strip()] = terms.strip()

    return terms_dict

def save_terms(file_path, terms_dict):
    with open(file_path, 'w') as file:
        for file_identifier, terms in terms_dict.items():
            file.write(f"{file_identifier}: {terms}\n")

def main():
    guidance_folder = 'guidance'
    terms_file_path = 'significant_terms.txt'
    existing_terms = load_existing_terms(terms_file_path)

    for file_name in os.listdir(guidance_folder):
        if file_name.endswith('.pdf'):
            file_path = os.path.join(guidance_folder, file_name)
            file_identifier = os.path.basename(file_path)

            if file_identifier in existing_terms:
                print(f"Terms for {file_identifier} already extracted. Skipping.")
                continue

            try:
                significant_terms = process_document(file_path)
                if significant_terms:
                    terms_text = "\n".join(significant_terms)
                    existing_terms[file_identifier] = terms_text
                    save_terms(terms_file_path, existing_terms)
                    print(f"Terms for {file_identifier} saved.")
                else:
                    print(f"No significant terms extracted for {file_identifier}.")

            except Exception as e:
                print(f"An error occurred with file {file_identifier}: {e}")

if __name__ == "__main__":
    main()
