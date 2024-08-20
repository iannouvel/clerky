import os
import json
import requests
import logging

ALGO_FOLDER = 'algos'

def load_credentials():
    openai_api_key = os.getenv('OPENAI_API_KEY')
    if not openai_api_key:
        raise ValueError("OpenAI API key not found. Ensure the OPENAI_API_KEY environment variable is set.")
    return openai_api_key

def send_to_chatgpt(guideline_text):
    try:
        openai_api_key = load_credentials()
        
        prompt = (
            "Please generate an algorithm (in HTML format) based on the following clinical guidance. "
            "The algorithm should be presented in a clear and concise manner, using HTML to represent the structure. "
            "Focus on summarizing the key steps or decision points clearly. Here is the guidance:\n\n"
            + guideline_text
        )
        
        body = {
            "model": "gpt-4",
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "max_tokens": 2000,
            "temperature": 0.7
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

        generated_html = response.json()['choices'][0]['message']['content']
        return generated_html
    except Exception as e:
        logging.error(f"Error while generating algorithm: {e}")
        return None

def generate_algo_for_guidance(guidance_folder):
    if not os.path.isdir(guidance_folder):
        logging.error(f"Directory {guidance_folder} does not exist.")
        return

    for file_name in os.listdir(guidance_folder):
        # Only process files that end with 'extracted.txt'
        if file_name.endswith('extracted.txt'):
            base_name = os.path.splitext(file_name)[0]
            html_file = os.path.join(ALGO_FOLDER, f"{base_name}.html")
            
            # Check if the work has already been done
            if os.path.exists(html_file):
                logging.info(f"Skipping {file_name} as it has already been processed.")
                continue

            logging.info(f"Processing file: {file_name}")

            with open(os.path.join(guidance_folder, file_name), 'r') as f:
                guidance_text = f.read()

            generated_html = send_to_chatgpt(guidance_text)

            if generated_html:
                with open(html_file, 'w', encoding='utf-8') as html_file_obj:
                    html_file_obj.write(generated_html)
                logging.info(f"Generated and saved: {html_file}")
            else:
                logging.warning(f"Failed to generate algo for: {file_name}")

def main():
guidance_folder = 'guidance'

    # Ensure the algo folder exists
    os.makedirs(ALGO_FOLDER, exist_ok=True)

    # Generate algos for all guidance files
    generate_algo_for_guidance(guidance_folder)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    main()
    
