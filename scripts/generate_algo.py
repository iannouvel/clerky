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
            "model": "gpt-3.5-turbo",
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
    # Check if the guidance folder exists
    if not os.path.isdir(guidance_folder):
        logging.error(f"Directory {guidance_folder} does not exist.")
        return

    # Iterate over each file in the guidance folder
    for file_name in os.listdir(guidance_folder):
        # Only process PDF files
        if file_name.endswith('.pdf'):
            # Correct filename generation to capture the '.pdf' part with a better approach
            expected_condensed_filename = file_name + ' - condensed.txt'
            condensed_txt_file = os.path.join(guidance_folder, expected_condensed_filename)

            # Log the PDF file name and the expected condensed text file
            logging.info(f"Processing PDF file: {file_name}")
            logging.info(f"Looking for condensed text file: {condensed_txt_file}")

            # Check if the condensed text file exists
            if not os.path.exists(condensed_txt_file):
                # If the file is not found, log a warning and continue to the next file
                logging.warning(f"Condensed text file for '{file_name}' not found. "
                                f"Expected: {expected_condensed_filename}")
                continue

            # If the condensed text file is found, log success
            logging.info(f"Found condensed text file for '{file_name}' at: {condensed_txt_file}")

            # Construct the output HTML filename
            html_file = os.path.join(ALGO_FOLDER, file_name.replace('.pdf', '.html'))

            # Log the intended HTML file name
            logging.info(f"Generated HTML file will be: {html_file}")

            try:
                # Read the condensed file content
                with open(condensed_txt_file, 'r') as txt_file:
                    condensed_text = txt_file.read()

                # Send the condensed text to ChatGPT
                generated_html = send_to_chatgpt(condensed_text)
                
                if generated_html:
                    # Save the generated HTML to a file
                    with open(html_file, 'w') as html_output_file:
                        html_output_file.write(generated_html)
                    logging.info(f"Successfully generated and saved HTML for {file_name}")
                else:
                    logging.error(f"Failed to generate HTML for {file_name}")

            except Exception as e:
                logging.error(f"Error processing {file_name}: {e}")

    # Log completion of the process
    logging.info("Finished processing all files in the guidance folder.")
    
def main():
    guidance_folder = 'guidance'

    # Ensure the algo folder exists
    os.makedirs(ALGO_FOLDER, exist_ok=True)

    # Generate algos for all guidance files
    generate_algo_for_guidance(guidance_folder)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    main()
