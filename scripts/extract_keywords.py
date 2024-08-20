import os
import json
import requests
import logging
from PyPDF2 import PdfReader
import tiktoken  # For accurate token counting

SIGNIFICANT_TERMS_FILE = 'significant_terms.json'

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

def split_text_into_chunks(text, max_tokens=2000):
    encoding = tiktoken.encoding_for_model("gpt-4")
    tokens = encoding.encode(text)
    
    # Split tokens into chunks
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
        "max_tokens": 1000,
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

    return response.json()['choices'][0]['message']['content']

def condense_clinically_significant_text(text, max_chunk_tokens=2000):
    chunks = split_text_into_chunks(text, max_chunk_tokens)
    condensed_texts = []

    # Process each chunk
    for chunk in chunks:
        try:
            condensed_chunk = condense_chunk(chunk)
            condensed_texts.append(condensed_chunk)
        except Exception as e:
            logging.error(f"Error while processing chunk: {e}")
            continue

    # Combine the condensed chunks into a final condensed text
    return "\n\n".join(condensed_texts)

def process_files_and_generate_significant_content(directory):
    if not os.path.isdir(directory):
        logging.error(f"Directory {directory} does not exist.")
        return

    for file_name in os.listdir(directory):
        if file_name.endswith('.pdf'):
            # Define the output file name based on the PDF file name
            output_file_path = os.path.join(directory, f"{file_name} - condensed.txt")
            
            # Check if the output file already exists
            if os.path.exists(output_file_path):
                logging.info(f"File already processed: {output_file_path}. Skipping.")
                continue

            file_path = os.path.join(directory, file_name)
            logging.info(f"Processing file: {file_name}")

            # Extract text from the PDF
            extracted_text = extract_text_from_pdf(file_path)

            if not extracted_text:
                logging.warning(f"No text extracted from {file_name}")
                continue

            # Condense the text using OpenAI in chunks
            try:
                condensed_text = condense_clinically_significant_text(extracted_text)

                # Write the condensed text to the output file
                with open(output_file_path, 'w') as output_file:
                    output_file.write(condensed_text)

                logging.info(f"Condensed text written to: {output_file_path}")

            except Exception as e:
                logging.error(f"Error while processing {file_name}: {e}")
                continue

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    guidance_dir = 'guidance'
    process_files_and_generate_significant_content(guidance_dir)
