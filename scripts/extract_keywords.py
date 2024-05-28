import os
import json
import requests
from google.cloud import documentai_v1 as documentai
from collections import Counter
from nltk.corpus import stopwords
from nltk.tokenize import word_tokenize
import nltk

# Ensure NLTK data is downloaded
nltk.download('punkt', quiet=True)
nltk.download('stopwords', quiet=True)

def extract_keywords(text):
    stop_words = set(stopwords.words('english'))
    words = word_tokenize(text)
    words = [word.lower() for word in words if word.isalpha()]
    filtered_words = [word for word in words if word not in stop_words]
    return [word for word, count in Counter(filtered_words).most_common(10)]

def process_document(file_path):
    # Initialize Google Document AI client
    client = documentai.DocumentUnderstandingServiceClient()
    project_id = 'YOUR_PROJECT_ID'
    location = 'us'  # Can be other regions like 'eu'
    processor_id = 'YOUR_PROCESSOR_ID'

    with open(file_path, 'rb') as document:
        content = document.read()

    document = {"content": content, "mime_type": "application/pdf"}
    request = documentai.types.ProcessRequest(
        name=f'projects/{project_id}/locations/{location}/processors/{processor_id}',
        raw_document=document
    )

    result = client.process_document(request=request)
    document_text = result.document.text

    return extract_keywords(document_text)

def main():
    # Get the uploaded file path from environment variable
    file_path = os.getenv('FILE_PATH')
    if not file_path:
        raise ValueError('No file path provided')

    keywords = process_document(file_path)
    print(json.dumps(keywords))

if __name__ == '__main__':
    main()
