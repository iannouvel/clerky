import os
import requests
import logging
import re
import asyncio
from tenacity import retry, stop_after_attempt, wait_fixed
from difflib import SequenceMatcher

ALGO_FOLDER = 'algos'
MAX_RETRIES = 3
TIMEOUT = 60  # seconds

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def load_credentials():
    openai_api_key = os.getenv('OPENAI_API_KEY')
    if not openai_api_key:
        raise ValueError("OpenAI API key not found. Ensure the OPENAI_API_KEY environment variable is set.")
    return openai_api_key

def similarity_ratio(a, b):
    return SequenceMatcher(None, a, b).ratio()

def find_condensed_file(guidance_folder, pdf_filename):
    base_name = pdf_filename.replace('.pdf', '')
    base_name_clean = re.sub(r'[^\w\s-]', '', base_name).strip().lower()
    
    best_match = None
    highest_ratio = 0
    
    for file in os.listdir(guidance_folder):
        if file.lower().endswith('condensed.txt'):
            file_clean = re.sub(r'[^\w\s-]', '', file).strip().lower()
            ratio = similarity_ratio(base_name_clean, file_clean)
            
            if ratio > highest_ratio:
                highest_ratio = ratio
                best_match = file

    if best_match and highest_ratio > 0.6:  # You can adjust this threshold
        logging.info(f"Found best match for '{pdf_filename}': '{best_match}' (similarity: {highest_ratio:.2f})")
        return os.path.join(guidance_folder, best_match)
    else:
        logging.warning(f"No suitable match found for PDF filename: {pdf_filename}")
        logging.info("Available condensed files:")
        for file in os.listdir(guidance_folder):
            if file.lower().endswith('condensed.txt'):
                logging.info(f"- {file}")
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

def generate_html_for_guidance(condensed_text):
    logging.info("Generating HTML for the clinical guideline")
    prompt = (
        "You are provided with a condensed clinical guideline. Based on this guideline, generate a complete and interactive HTML page that implements an algorithm for decision-making. "
        "The HTML should be structured as follows:\n"
        "1. A two-column layout where questions are shown on the left and dynamic guidance on the right.\n"
        "2. The user should be able to select their clinical context (e.g., antenatal, postnatal, triage) from a dropdown menu.\n"
        "3. Based on the user's input, display only the relevant questions and dynamically update the guidance as they answer.\n"
        "4. The guidance should be contextual based on the user's responses.\n"
        "5. Include all necessary HTML, CSS, and JavaScript in the same page.\n"
        "6. Ensure accessibility features and proper input types for the questions.\n\n"
        "Condensed Clinical Guideline:\n" + condensed_text + "\n\n"
        "Please return the entire HTML code for this page."
    )
    return send_to_chatgpt(prompt)

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

        logging.info(f"Generating HTML for {file_name}")
        generated_html = await asyncio.to_thread(generate_html_for_guidance, condensed_text)
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
