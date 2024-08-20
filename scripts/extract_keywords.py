
import os
import json
import requests
import logging
from PyPDF2 import PdfReader
import tiktoken  # For accurate token counting

SIGNIFICANT_TERMS_FILE = 'significant_terms.json'
SIGNIFICANT_TERMS_FILE_SUFFIX = '- significant terms.txt'

def load_credentials():
    openai_api_key = os.getenv('OPENAI_API_KEY')
    if not openai_api_key:
        raise ValueError("OpenAI API key not found. Ensure the OPENAI_API_KEY environment variable is set.")
    return openai_api_key

def extract_text_from_pdf(file_path):
    try:
        reader = PdfReader(file_path)
        text = ""
        for page in reader.pages:
            text += page.extract_text()
        return text
    except Exception as e:
        logging.error(f"Error reading PDF {file_path}: {e}")
        return ""

def split_text_into_chunks(text, max_tokens=1500):
    # Lower the chunk size to 1500 tokens to account for the prompt and response
    encoding = tiktoken.encoding_for_model("gpt-4")
    tokens = encoding.encode(text)
    
    chunks = []
    for i in range(0, len(tokens), max_tokens):
        chunk = tokens[i:i + max_tokens]
        chunks.append(encoding.decode(chunk))
    
    return chunks

def condense_chunk(chunk):
    openai_api_key = load_credentials()
    
    prompt = (
        "With the attached text from a clinical guideline, "
        "please return a condensed version of the text which removes clinically insignificant text, "
        "but does not change the clinically significant text at all.\n\n"
        f"{chunk}"
    )

    body = {
        "model": "gpt-4",
        "messages": [{"role": "user", "content": prompt}],
        # Reduce the max_tokens in the response to 500 to avoid exceeding context limits
        "max_tokens": 500,
        "temperature": 0.5
    }

    response = requests.post(
        'https://api.openai.com/v1/chat/completions',
        headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {openai_api_key}'},
        data=json.dumps(body)
    )

    if response.status_code != 200:
        error_details = response.json()
        raise Exception(f"OpenAI API error: {error_details.get('error')}")

    return response.json().get('choices', [{}])[0].get('message', {}).get('content', '')

def process_file(file_path):
    # Extract the text from the PDF
    text = extract_text_from_pdf(file_path)

    if not text:
        return

    logging.info(f"Processing file: {file_path}")
    
    # Split the text into smaller chunks
    chunks = split_text_into_chunks(text)

    condensed_text = ""
    
    for chunk in chunks:
        try:
            condensed_chunk = condense_chunk(chunk)
            condensed_text += condensed_chunk
        except Exception as e:
            logging.error(f"Error while processing {file_path}: {e}")
            continue

    condensed_file_path = f"{file_path} - condensed.txt"
    with open(condensed_file_path, 'w') as condensed_file:
        condensed_file.write(condensed_text)

    logging.info(f"Condensed text written to: {condensed_file_path}")

# The main part of the script that processes the files
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    # Here you can add logic to loop through files and process them using process_file
    files = ["path_to_your_file.pdf"]  # Replace with actual file paths
    for file in files:
        process_file(file)
