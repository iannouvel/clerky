
import os
import requests
import logging
from PyPDF2 import PdfReader

# Constants
SUMMARY_FILE_SUFFIX = '- summary.txt'
OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"

def load_credentials():
    openai_api_key = os.getenv('OPENAI_API_KEY')
    if not openai_api_key:
        raise ValueError("OpenAI API key not found. Ensure the OPENAI_API_KEY environment variable is set.")
    return openai_api_key

def extract_text_from_pdf(pdf_path):
    reader = PdfReader(pdf_path)
    extracted_text = ''
    for page in reader.pages:
        extracted_text += page.extract_text()
    return extracted_text

def send_to_chatgpt(text, api_key):
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    data = {
        "model": "gpt-3.5-turbo",
        "messages": [
            {"role": "system", "content": "Summarize the clinically significant text in 100 words."},
            {"role": "user", "content": text},
        ],
        "temperature": 0.7,
        "max_tokens": 150,
    }
    response = requests.post(OPENAI_API_URL, headers=headers, json=data)
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]

def process_pdfs_and_generate_summary(directory):
    openai_api_key = load_credentials()

    for file_name in os.listdir(directory):
        if file_name.endswith('.pdf'):
            pdf_file_path = os.path.join(directory, file_name)
            output_summary_file_path = os.path.join(directory, "summary", f"{file_name.replace('.pdf', SUMMARY_FILE_SUFFIX)}")

            if os.path.exists(output_summary_file_path):
                logging.info(f"Summary already exists for {file_name}. Skipping...")
                continue  # Skip if summary already exists

            # Extract text from the PDF
            extracted_text = extract_text_from_pdf(pdf_file_path)
            if not extracted_text:
                logging.warning(f"No text extracted from {file_name}")
                continue

            try:
                # Send the extracted text to ChatGPT for summarization
                summary_text = send_to_chatgpt(extracted_text, openai_api_key)

                # Save the summary to the guidance/summary folder
                os.makedirs(os.path.join(directory, "summary"), exist_ok=True)  # Ensure summary directory exists
                with open(output_summary_file_path, 'w') as summary_file:
                    summary_file.write(summary_text)

                logging.info(f"Summary written to: {output_summary_file_path}")

            except Exception as e:
                logging.error(f"Error while processing summary for {file_name}: {e}")

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    guidance_dir = 'clerky/guidance'
    process_pdfs_and_generate_summary(guidance_dir)
