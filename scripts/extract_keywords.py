import os
import sys
import json
from google.cloud import documentai_v1beta3 as documentai
from google.protobuf.struct_pb2 import Struct

def process_document(file_path):
    # Set the environment variable for Google Cloud credentials from GitHub secrets
    credentials_json = os.getenv('GCP_CREDENTIALS')
    if credentials_json is None:
        raise ValueError("GCP_CREDENTIALS environment variable is not set.")
    
    # Write the credentials to a file
    with open('gcloud_key.json', 'w') as f:
        f.write(credentials_json)
    
    os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = 'gcloud_key.json'

    client = documentai.DocumentProcessorServiceClient()

    # Fetching project ID and processor ID from environment variables
    project_id = os.getenv('GCP_PROJECT_ID')
    if project_id is None:
        raise ValueError("GCP_PROJECT_ID environment variable is not set.")
        
    processor_id = os.getenv('GCP_PROCESSOR_ID')
    if processor_id is None:
        raise ValueError("GCP_PROCESSOR_ID environment variable is not set.")

    location = 'us'  # replace with the location of your processor

    name = f'projects/{project_id}/locations/{location}/processors/{processor_id}'

    with open(file_path, 'rb') as document:
        image_content = document.read()

    document = {"content": image_content, "mime_type": "application/pdf"}
    request = {"name": name, "raw_document": document}

    # Adding a custom prompt for keyword extraction
    params = Struct()
    params.update({"keyword_extraction": "extract the 10 most useful keywords from this document"})
    request["params"] = params

    result = client.process_document(request=request)

    document = result.document

    # Extracting the keywords from the document
    keywords = [entity.mention_text for entity in document.entities]

    return keywords

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
