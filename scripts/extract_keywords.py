import os
import json
import requests
import logging
from PyPDF2 import PdfReader
import tiktoken  # For accurate token counting
from rapidfuzz import fuzz, process

SIGNIFICANT_TERMS_FILE = 'significant_terms.json'
SIGNIFICANT_TERMS_FILE_SUFFIX = '- significant terms.txt'
SUMMARY_FILE_SUFFIX = '- summary.txt'
CONDENSED_FILE_SUFFIX = ' - condensed.txt'
SUMMARY_DIRECTORY = 'guidance/summary'


def load_credentials():
    logging.info("Calling load_credentials")
    openai_api_key = os.getenv('OPENAI_API_KEY')
    if not openai_api_key:
        raise ValueError("OpenAI API key not found. Ensure the OPENAI_API_KEY environment variable is set.")
    return openai_api_key


def extract_text_from_pdf(file_path):
    logging.info("Calling extract_text_from_pdf")
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
    logging.info("Calling split_text_into_chunks")
    encoding = tiktoken.encoding_for_model("gpt-3.5-turbo")
    tokens = encoding.encode(text)
    
    chunks = []
    for i in range(0, len(tokens), max_tokens):
        chunk = tokens[i:i + max_tokens]
        chunks.append(encoding.decode(chunk))
    
    logging.info(f"Text split into {len(chunks)} chunks.")
    return chunks


def condense_chunk(chunk):
    logging.info("Calling condense_chunk")
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
    logging.info("Calling condense_clinically_significant_text")
    chunks = split_text_into_chunks(text, max_chunk_tokens)
    condensed_texts = []

    for chunk in chunks:
        try:
            condensed_chunk = condense_chunk(chunk)
            if condensed_chunk:
                condensed_texts.append(condensed_chunk)
        except Exception as e:
            logging.error(f"Error while processing chunk: {e}")
            continue

    return "\n\n".join(condensed_texts) if condensed_texts else None


def extract_significant_terms(text):
    logging.info("Calling extract_significant_terms")
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


def generate_summary(condensed_text):
    logging.info("Calling generate_summary")
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
    logging.info("Calling process_one_new_file")
    if not os.path.isdir(directory):
        logging.error(f"Directory {directory} does not exist.")
        return False

    processed_flag = False
    for file_name in os.listdir(directory):
        if file_name.endswith('.pdf'):
            base_name, ext = os.path.splitext(file_name)
            
            # Check for associated files using fuzzy matching
            files_in_directory = os.listdir(directory)
            output_condensed_file_match = process.extractOne(f"{base_name}{CONDENSED_FILE_SUFFIX}", files_in_directory, scorer=fuzz.ratio)
            output_terms_file_match = process.extractOne(f"{base_name}{SIGNIFICANT_TERMS_FILE_SUFFIX}", files_in_directory, scorer=fuzz.ratio)
            output_summary_file_match = process.extractOne(f"{base_name}{SUMMARY_FILE_SUFFIX}", files_in_directory, scorer=fuzz.ratio)

            if output_condensed_file_match is None or output_condensed_file_match[1] <= 80:
                logging.warning(f"No suitable match found for condensed file: {base_name}{CONDENSED_FILE_SUFFIX} in directory: {directory}")
            if output_terms_file_match is None or output_terms_file_match[1] <= 80:
                logging.warning(f"No suitable match found for significant terms file: {base_name}{SIGNIFICANT_TERMS_FILE_SUFFIX} in directory: {directory}")
            if output_summary_file_match is None or output_summary_file_match[1] <= 80:
                logging.warning(f"No suitable match found for summary file: {base_name}{SUMMARY_FILE_SUFFIX} in directory: {SUMMARY_DIRECTORY}")

            output_condensed_file_path = os.path.join(directory, output_condensed_file_match[0]) if output_condensed_file_match and output_condensed_file_match[1] > 80 else os.path.join(directory, f"{base_name}{CONDENSED_FILE_SUFFIX}")
            output_terms_file_path = os.path.join(directory, output_terms_file_match[0]) if output_terms_file_match and output_terms_file_match[1] > 80 else os.path.join(directory, f"{base_name}{SIGNIFICANT_TERMS_FILE_SUFFIX}")
            output_summary_file_path = os.path.join(SUMMARY_DIRECTORY, output_summary_file_match[0]) if output_summary_file_match and output_summary_file_match[1] > 80 else os.path.join(SUMMARY_DIRECTORY, f"{base_name}{SUMMARY_FILE_SUFFIX}")

            file_path = os.path.join(directory, file_name)
            extracted_text = None
            condensed_text = None

            # Generate condensed text if missing
            if not os.path.exists(output_condensed_file_path):
                logging.info(f"Condensed file missing for {file_name}, generating...")
                extracted_text = extract_text_from_pdf(file_path)
                if extracted_text:
                    condensed_text = condense_clinically_significant_text(extracted_text)
                    if condensed_text:
                        with open(output_condensed_file_path, 'w') as output_file:
                            output_file.write(condensed_text)
                        logging.info(f"Condensed text written to: {output_condensed_file_path}")
                        processed_flag = True

            # Generate significant terms if missing
            if not os.path.exists(output_terms_file_path):
                logging.info(f"Significant terms file missing for {file_name}, generating...")
                if condensed_text is None:
                    if os.path.exists(output_condensed_file_path):
                        with open(output_condensed_file_path, 'r') as file:
                            condensed_text = file.read()
                if condensed_text:
                    significant_terms = extract_significant_terms(condensed_text)
                    if significant_terms:
                        with open(output_terms_file_path, 'w') as terms_file:
                            terms_file.write(significant_terms)
                        logging.info(f"Significant terms written to: {output_terms_file_path}")
                        processed_flag = True

            # Generate summary if missing
            if not os.path.exists(output_summary_file_path):
                logging.info(f"Summary file missing for {file_name}, generating...")
                if condensed_text is None:
                    if os.path.exists(output_condensed_file_path):
                        with open(output_condensed_file_path, 'r') as file:
                            condensed_text = file.read()
                if condensed_text:
                    summary = generate_summary(condensed_text)
                    if summary:
                        os.makedirs(SUMMARY_DIRECTORY, exist_ok=True)
                        with open(output_summary_file_path, 'w') as summary_file:
                            summary_file.write(summary)
                        logging.info(f"Summary written to: {output_summary_file_path}")
                        processed_flag = True

    return processed_flag


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logging.info("Calling main routine")
    guidance_dir = 'guidance'
    
    # Process new PDF files
    process_one_new_file(guidance_dir)
