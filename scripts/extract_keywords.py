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
        logging.info(f"Extracted text length: {len(text)} characters")
        return text
    except Exception as e:
        logging.error(f"Error reading PDF {file_path}: {e}")
        return ""

def split_text_into_chunks(text, max_tokens=4000):
    encoding = tiktoken.encoding_for_model("gpt-3.5-turbo")
    tokens = encoding.encode(text)
    
    chunks = []
    for i in range(0, len(tokens), max_tokens):
        chunk = tokens[i:i + max_tokens]
        chunks.append(encoding.decode(chunk))
    
    logging.info(f"Text split into {len(chunks)} chunks.")
    return chunks

def condense_chunk(chunk):
    openai_api_key = load_credentials()
    
    prompt = (
        "With the attached text from a clinical guideline, "
        "please return a condensed version of the text which removes clinically insignificant text, "
        "please remove all the scientific references, if there are any, at the end of the text as they do not need to be in the condensed output, "
        "please do not change the clinically significant text at all.\n\n"
        f"{chunk}"
    )

    encoding = tiktoken.encoding_for_model("gpt-3.5-turbo")
    tokens = encoding.encode(prompt)
    token_count = len(tokens)

    logging.debug(f"Condense chunk prompt length: {token_count} tokens")

    if token_count > 6000:  # Check to avoid exceeding token limits
        logging.warning("Token count for condense_chunk exceeds the maximum allowed limit. Adjusting the chunk size.")
        return None
    
    body = {
        "model": "gpt-3.5-turbo",
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

def condense_clinically_significant_text(text, max_chunk_tokens=4000):
    chunks = split_text_into_chunks(text, max_chunk_tokens)
    condensed_texts = []

    for chunk in chunks:
        try:
            condensed_chunk = condense_chunk(chunk)
            condensed_texts.append(condensed_chunk)
        except Exception as e:
            logging.error(f"Error while processing chunk: {e}")
            continue

    return "\n\n".join(condensed_texts)

def extract_significant_terms(text):
    openai_api_key = load_credentials()

    prompt = (
        "From the following clinical guideline text, extract the most clinically significant terms "
        "and keywords that are critical for understanding the guidance:\n\n"
        f"{text}"
    )

    encoding = tiktoken.encoding_for_model("gpt-3.5-turbo")
    tokens = encoding.encode(prompt)
    token_count = len(tokens)
    
    if token_count > 6000:  # Check to avoid exceeding token limits
        logging.warning("Token count for extract_significant_terms exceeds the maximum allowed limit. Adjusting the chunk size.")
        return None
    
    print(f"Extract significant terms prompt length: {token_count} tokens")
    print(f"Extract significant terms prompt text:\n{prompt}\n")

    body = {
        "model": "gpt-3.5-turbo",
        "messages": [{"role": "user", "content": prompt}],
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

    return response.json()['choices'][0]['message']['content']

def compile_significant_terms(directory):
    significant_terms_dict = {}

    for file_name in os.listdir(directory):
        if file_name.endswith('.pdf'):
            terms_file = os.path.join(directory, f"{file_name}{SIGNIFICANT_TERMS_FILE_SUFFIX}")
            if os.path.exists(terms_file):
                with open(terms_file, 'r') as file:
                    significant_terms = file.read()
                    significant_terms_dict[file_name] = significant_terms

    with open(SIGNIFICANT_TERMS_FILE, 'w') as json_file:
        json.dump(significant_terms_dict, json_file, indent=4)

    logging.info(f"Significant terms compiled into {SIGNIFICANT_TERMS_FILE}")

def process_one_new_file(directory):
    if not os.path.isdir(directory):
        logging.error(f"Directory {directory} does not exist.")
        return False

    for file_name in os.listdir(directory):
        if file_name.endswith('.pdf'):
            output_condensed_file_path = os.path.join(directory, f"{file_name} - condensed.txt")
            output_terms_file_path = os.path.join(directory, f"{file_name}{SIGNIFICANT_TERMS_FILE_SUFFIX}")

            if os.path.exists(output_condensed_file_path) and os.path.exists(output_terms_file_path):
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

import openai
import os

SUMMARY_FOLDER = 'clerky/guidance/summary/'

def generate_summary(text, word_limit=100):
    openai_api_key = load_credentials()
    openai.api_key = openai_api_key
    
    # Using OpenAI GPT to generate a summary
    try:
        response = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": f"Summarize the following text in {word_limit} words: {text}"}
            ]
        )
        summary = response['choices'][0]['message']['content']
        logging.info(f"Generated summary: {summary[:50]}...")
        return summary
    except Exception as e:
        logging.error(f"Error generating summary: {e}")
        return ""

def save_summary(summary, filename):
    # Ensure the directory exists
    os.makedirs(SUMMARY_FOLDER, exist_ok=True)
    
    # Full path to save the summary
    file_path = os.path.join(SUMMARY_FOLDER, filename)
    
    try:
        with open(file_path, 'w') as file:
            file.write(summary)
        logging.info(f"Summary saved at: {file_path}")
    except Exception as e:
        logging.error(f"Error saving summary: {e}")

def process_guidelines_for_summary(guideline_texts):
    for i, guideline_text in enumerate(guideline_texts):
        summary = generate_summary(guideline_text)
        filename = f'guideline_{i+1}_summary.txt'
        save_summary(summary, filename)
