import os
import json
import requests
import logging
from PyPDF2 import PdfReader
import tiktoken  # For accurate token counting

SIGNIFICANT_TERMS_FILE = 'significant_terms.json'
SIGNIFICANT_TERMS_FILE_SUFFIX = '- significant terms.txt'
SUMMARY_FILE_SUFFIX = '- summary.txt'
SUMMARY_DIRECTORY = 'clerky/guidance/summary'

def load_credentials():
    openai_api_key = os.getenv('OPENAI_API_KEY')
    if not openai_api_key:
        raise ValueError("OpenAI API key not found. Ensure the OPENAI_API_KEY environment variable is set.")
    return openai_api_key

# ... [Previous functions remain unchanged] ...

def generate_summary(condensed_text):
    openai_api_key = load_credentials()
    
    prompt = (
        "Please provide a 100-word summary of the following clinical guideline:\n\n"
        f"{condensed_text}"
    )

    encoding = tiktoken.encoding_for_model("gpt-3.5-turbo")
    tokens = encoding.encode(prompt)
    token_count = len(tokens)

    logging.debug(f"Generate summary prompt length: {token_count} tokens")

    if token_count > 6000:  # Check to avoid exceeding token limits
        logging.warning("Token count for generate_summary exceeds the maximum allowed limit. Adjusting the input text.")
        return None
    
    body = {
        "model": "gpt-3.5-turbo",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 200,  # Allowing some buffer for the 100-word summary
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

def process_one_new_file(directory):
    if not os.path.isdir(directory):
        logging.error(f"Directory {directory} does not exist.")
        return False

    for file_name in os.listdir(directory):
        if file_name.endswith('.pdf'):
            output_condensed_file_path = os.path.join(directory, f"{file_name} - condensed.txt")
            output_terms_file_path = os.path.join(directory, f"{file_name}{SIGNIFICANT_TERMS_FILE_SUFFIX}")
            output_summary_file_path = os.path.join(SUMMARY_DIRECTORY, f"{file_name}{SUMMARY_FILE_SUFFIX}")

            if os.path.exists(output_condensed_file_path) and os.path.exists(output_terms_file_path) and os.path.exists(output_summary_file_path):
                continue  # Skip already processed files

            file_path = os.path.join(directory, file_name)
            logging.info(f"Processing new file: {file_name}")

            extracted_text = extract_text_from_pdf(file_path)
            if not extracted_text:
                logging.warning(f"No text extracted from {file_name}")
                continue

            try:
                condensed_text = condense_clinically_significant_text(extracted_text)

                with open(output_condensed_file_path, 'w') as output_file:
                    output_file.write(condensed_text)

                logging.info(f"Condensed text written to: {output_condensed_file_path}")

                significant_terms = extract_significant_terms(condensed_text)

                with open(output_terms_file_path, 'w') as terms_file:
                    terms_file.write(significant_terms)

                logging.info(f"Significant terms written to: {output_terms_file_path}")

                # Generate and save summary if it doesn't exist
                if not os.path.exists(output_summary_file_path):
                    summary = generate_summary(condensed_text)
                    os.makedirs(SUMMARY_DIRECTORY, exist_ok=True)
                    with open(output_summary_file_path, 'w') as summary_file:
                        summary_file.write(summary)
                    logging.info(f"Summary written to: {output_summary_file_path}")

                # Compile the significant terms into the JSON file
                compile_significant_terms(directory)

                return True  # Successfully processed one new file

            except Exception as e:
                logging.error(f"Error while processing {file_name}: {e}")
                return False

    logging.info("No new files to process.")
    return False

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    guidance_dir = 'guidance'
    processed = process_one_new_file(guidance_dir)
    if processed:
        logging.info("Successfully processed one new file. Exiting.")
    else:
        logging.info("No new files processed. Exiting.")
