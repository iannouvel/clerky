import os
import sys
from google.cloud import documentai_v1beta3 as documentai

def process_document(file_path):
    # Set the environment variable for Google Cloud credentials
    credentials_path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
    if credentials_path is None:
        raise ValueError("GOOGLE_APPLICATION_CREDENTIALS environment variable is not set.")
    if not os.path.exists(credentials_path):
        raise FileNotFoundError(f"Credentials file not found: {credentials_path}")

    client = documentai.DocumentProcessorServiceClient()

    # Assuming you have the necessary configuration for processing the document
    project_id = 'YOUR_PROJECT_ID'  # replace with your project ID
    location = 'us'  # replace with the location of your processor
    processor_id = 'YOUR_PROCESSOR_ID'  # replace with your processor ID

    name = f'projects/{project_id}/locations/{location}/processors/{processor_id}'

    with open(file_path, 'rb') as document:
        image_content = document.read()

    document = {"content": image_content, "mime_type": "application/pdf"}
    request = {"name": name, "raw_document": document}

    result = client.process_document(request=request)

    document = result.document

    text = document.text

    # Here you can implement your keyword extraction logic
    keywords = extract_keywords(text)
    return keywords

def extract_keywords(text):
    # Implement your keyword extraction logic here
    # For simplicity, let's just split the text into words and return unique ones
    words = text.split()
    unique_keywords = list(set(words))
    return unique_keywords

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
