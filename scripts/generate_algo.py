import os
import requests
import logging
import re
import json
import asyncio
from tenacity import retry, stop_after_attempt, wait_fixed

ALGO_FOLDER = 'algos'
MAX_RETRIES = 3
TIMEOUT = 60  # seconds

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def load_credentials():
    openai_api_key = os.getenv('OPENAI_API_KEY')
    if not openai_api_key:
        raise ValueError("OpenAI API key not found. Ensure the OPENAI_API_KEY environment variable is set.")
    return openai_api_key

def match_condensed_filename(pdf_filename):
    base_name = pdf_filename.replace('.pdf', '')
    base_name_clean = re.sub(r'[^\w\s-]', '', base_name).strip()
    words = base_name_clean.split()
    pattern = r'.*'.join(map(re.escape, words)) + r'.*condensed\.txt'
    return pattern

def find_condensed_file(guidance_folder, pdf_filename):
    pattern = match_condensed_filename(pdf_filename)
    for file in os.listdir(guidance_folder):
        if file.lower().endswith('condensed.txt'):
            if re.search(pattern, file, re.IGNORECASE):
                return os.path.join(guidance_folder, file)
    logging.warning(f"No match found for PDF filename: {pdf_filename}")
    return None

@retry(stop=stop_after_attempt(MAX_RETRIES), wait=wait_fixed(2))
def send_to_chatgpt(prompt):
    try:
        openai_api_key = load_credentials()

        body = {
            "model": "gpt-4-turbo",
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "max_tokens": 3000,
            "temperature": 0.5
        }

        response = requests.post(
            'https://api.openai.com/v1/chat/completions',
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {openai_api_key}'
            },
            json=body,
            timeout=TIMEOUT
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        logging.info(f"ChatGPT Response:\n{content}")
        return content.strip()
    except requests.exceptions.RequestException as e:
        logging.error(f"Error in send_to_chatgpt: {e}")
        raise

async def process_file(file_name, guidance_folder):
    logging.info(f"Starting to process {file_name}")
    html_file = os.path.join(ALGO_FOLDER, file_name.replace('.pdf', '.html'))
    if os.path.exists(html_file):
        logging.info(f"HTML file for '{file_name}' already exists. Skipping generation.")
        return

    condensed_txt_file = find_condensed_file(guidance_folder, file_name)
    if not condensed_txt_file:
        logging.warning(f"Condensed text file for '{file_name}' not found.")
        return

    try:
        with open(condensed_txt_file, 'r') as txt_file:
            condensed_text = txt_file.read()

        logging.info(f"Extracting clinical contexts for {file_name}")
        contexts_json = await asyncio.to_thread(step_1_extract_clinical_contexts, condensed_text)
        if not contexts_json:
            logging.error(f"Failed to extract clinical contexts for {file_name}")
            return

        try:
            contexts = json.loads(contexts_json)
        except json.JSONDecodeError as e:
            logging.error(f"Failed to parse contexts JSON for {file_name}: {e}")
            return

        logging.info(f"Rewriting guidance for {file_name}")
        guidance_json = await asyncio.to_thread(step_2_rewrite_guidance_by_context, condensed_text, contexts_json)
        if not guidance_json:
            logging.error(f"Failed to rewrite guidance for {file_name}")
            return

        try:
            guidance = json.loads(guidance_json)
        except json.JSONDecodeError as e:
            logging.error(f"Failed to parse guidance JSON for {file_name}: {e}")
            return

        logging.info(f"Generating HTML for {file_name}")
        generated_html = await asyncio.to_thread(step_3_generate_interactive_html, json.dumps(contexts), json.dumps(guidance))
        if not generated_html:
            logging.error(f"Failed to generate HTML for {file_name}")
            return

        with open(html_file, 'w', encoding='utf-8') as html_output_file:
            html_output_file.write(generated_html)
        logging.info(f"Successfully generated and saved HTML for {file_name}")

    except Exception as e:
        logging.error(f"Error processing {file_name}: {e}")

async def generate_algo_for_guidance(guidance_folder):
    tasks = []
    for file_name in os.listdir(guidance_folder):
        if file_name.endswith('.pdf'):
            task = asyncio.create_task(process_file(file_name, guidance_folder))
            tasks.append(task)
    await asyncio.gather(*tasks)

def main():
    guidance_folder = 'guidance'
    os.makedirs(ALGO_FOLDER, exist_ok=True)

    try:
        asyncio.run(generate_algo_for_guidance(guidance_folder))
    except Exception as e:
        logging.error(f"An error occurred while processing guidance documents: {e}")

if __name__ == "__main__":
    main()
