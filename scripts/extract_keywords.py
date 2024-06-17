import os
import json
import requests
from PyPDF2 import PdfReader
from google.cloud import documentai_v1beta3 as documentai
from google.oauth2 import service_account
import tiktoken
import logging
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import time

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

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

def extract_significant_terms(text):
    try:
        encoding = tiktoken.encoding_for_model("gpt-4")
        tokens = encoding.encode(text)
        max_tokens = 4000

        if len(tokens) > max_tokens:
            tokens = tokens[:max_tokens]
            text = encoding.decode(tokens)
        
        openai_api_key = load_credentials()
        prompt = f"Extract significant medical terms like diagnosis, investigation and management:\n\n{text}"
        body = {
            "model": "gpt-4",
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "max_tokens": 1000,
            "temperature": 0.5
        }

        response = requests.post(
            'https://api.openai.com/v1/chat/completions',
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {openai_api_key}'
            },
            data=json.dumps(body)
        )

        if response.status_code != 200:
            error_details = response.json()
            raise Exception(f"OpenAI API error: {error_details.get('error', {}).get('message', 'Unknown error')}")

        data = response.json()
        significant_terms = data['choices'][0]['message']['content'].strip()
        return significant_terms
    except Exception as e:
        logging.error(f"Error while extracting terms: {e}")
        return None

def compile_significant_terms():
    guidance_dir = 'guidance'
    significant_terms_dict = {}

    if not os.path.isdir(guidance_dir):
        logging.error(f"Directory {guidance_dir} does not exist.")
        return

    for file_name in os.listdir(guidance_dir):
        if file_name.endswith('.pdf'):
            file_path = os.path.join(guidance_dir, file_name)
            text = extract_text_from_pdf(file_path)
            if text:
                significant_terms = extract_significant_terms(text)
                if significant_terms:
                    significant_terms_dict[file_name] = significant_terms

    with open(SIGNIFICANT_TERMS_FILE, 'w') as f:
        json.dump(significant_terms_dict, f, indent=4)

    logging.info(f"Significant terms compiled into {SIGNIFICANT_TERMS_FILE}")

class GuidanceEventHandler(FileSystemEventHandler):
    def on_modified(self, event):
        if not event.is_directory and event.src_path.endswith('.pdf'):
            logging.info(f"File modified: {event.src_path}")
            compile_significant_terms()

    def on_created(self, event):
        if not event.is_directory and event.src_path.endswith('.pdf'):
            logging.info(f"File created: {event.src_path}")
            compile_significant_terms()

    def on_deleted(self, event):
        if not event.is_directory and event.src_path.endswith('.pdf'):
            logging.info(f"File deleted: {event.src_path}")
            compile_significant_terms()

def start_file_watcher():
    path = 'guidance'
    event_handler = GuidanceEventHandler()
    observer = Observer()
    observer.schedule(event_handler, path, recursive=False)
    observer.start()
    logging.info(f"Started file watcher for {path}")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()

if __name__ == "__main__":
    compile_significant_terms()
    start_file_watcher()
