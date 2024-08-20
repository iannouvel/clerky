
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
            "the attached text is a clinical guideline. "
            "please first rewrite it as a series of 'if this then that' statements "
            "where appropriate, identify the variables that are specified in the text "
            "use the variables to write (in html) code such that the user of the rendered html can specify the variables and receive specific guidance related to the clinical situation "
            "please return ONLY the code in text form"
            "Here is the guidance:\n\n"
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
        if file_name.endswith('.pdf'):
            guidance_file_path = os.path.join(guidance_folder, file_name)
            logging.info(f"Processing: {guidance_file_path}")
            
            # Replace '.pdf - condensed' with '.html'
            html_file = os.path.join(ALGO_FOLDER, file_name.replace('.pdf - condensed', '').replace('.pdf', '.html'))

            # Check if the algo file already exists
            if os.path.exists(html_file):
                logging.info(f"Algorithm for {file_name} already exists. Skipping generation.")
                continue
            
            # Simulate the extraction of text from the guidance PDF (placeholder)
            guideline_text = f"Extracted text from {file_name}"

            # Generate the algorithm in HTML format
            generated_html = send_to_chatgpt(guideline_text)

            if generated_html:
                # Save the generated HTML
                with open(html_file, 'w') as f:
                    f.write(generated_html)

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
