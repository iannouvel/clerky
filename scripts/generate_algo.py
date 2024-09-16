import os
import json
import requests
import logging
import re
import urllib.parse  # To handle URL-encoded characters like %20

ALGO_FOLDER = 'algos'

def load_credentials():
    openai_api_key = os.getenv('OPENAI_API_KEY')
    if not openai_api_key:
        raise ValueError("OpenAI API key not found. Ensure the OPENAI_API_KEY environment variable is set.")
    return openai_api_key

def sanitize_filename(filename):
    """
    Sanitize the filename to handle URL encoding and special characters.
    This will decode any URL-encoded characters (like %20 for space) and remove any unwanted characters.
    """
    # Decode any URL-encoded characters like %20
    filename = urllib.parse.unquote(filename)
    
    # Replace multiple spaces with a single space
    filename = re.sub(r'\s+', ' ', filename).strip()
    
    # Remove invalid characters, keeping alphanumeric, spaces, parentheses, hyphens, and dots
    filename = re.sub(r'[^\w\s().-]', '', filename)
    
    return filename

def match_condensed_filename(pdf_filename):
    """
    Generate a matching pattern for the condensed text files.
    This accounts for spaces around hyphens and handles special characters.
    """
    base_name = pdf_filename.replace('.pdf', '')
    
    # Use regex to allow flexible matching of " - condensed.txt" and "- condensed.txt"
    condensed_filename_pattern = re.sub(r'\s*-\s*', r'[- ]*', base_name) + r'[- ]condensed\.txt'
    
    # Debug: Log the regex pattern
    logging.debug(f"Regex pattern for matching condensed file: {condensed_filename_pattern}")
    
    return condensed_filename_pattern

def find_condensed_file(guidance_folder, pdf_filename):
    """
    Look for a matching condensed text file in the guidance folder.
    Uses flexible pattern matching to accommodate different spacings and special characters.
    """
    condensed_filename_pattern = match_condensed_filename(pdf_filename)
    
    # Debug: Log all files in the directory
    logging.debug(f"Files in {guidance_folder}: {os.listdir(guidance_folder)}")
    
    # Scan the directory for files matching the pattern
    for file in os.listdir(guidance_folder):
        sanitized_file = sanitize_filename(file)
        logging.debug(f"Sanitized filename: {sanitized_file}")  # Debug: Log each sanitized file
        if re.match(condensed_filename_pattern, sanitized_file, re.IGNORECASE):
            logging.debug(f"Matched file: {file}")  # Debug: Log the matched file
            return os.path.join(guidance_folder, file)
    
    logging.debug(f"No match found for PDF filename: {pdf_filename}")  # Debug: Log when no match is found
    return None

def send_to_chatgpt(prompt):
    """
    Send a prompt to the OpenAI API and return the generated response.
    """
    try:
        openai_api_key = load_credentials()

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

        generated_text = response.json()['choices'][0]['message']['content']
        return generated_text
    except Exception as e:
        logging.error(f"Error while generating response: {e}")
        return None

def step_1_extract_variables(guideline_text):
    """
    Step 1: Extract the variables and options from the clinical guideline.
    """
    prompt = (
        "The attached text is a clinical guideline."
        "Identify all the variables that apply to decision-making or advice regarding clinical care."
        "Return the list of variables and the potential values for each in the following format:"
        "variable 1, option 1, option 2, variable 2, option 1, option 2, etc..."
        "\n\nHere is the guidance:\n\n" + guideline_text
    )
    return send_to_chatgpt(prompt)

def step_2_rewrite_guideline_with_if_else(guideline_text, variables):
    """
    Step 2: Re-write the guideline using if/else statements based on the variables extracted in Step 1.
    """
    prompt = (
        "Using the following variables:\n" + variables + "\n"
        "Re-write the guideline, removing all sentences or phrases that have no clinical advice."
        "Rewrite the remaining sentences as 'if this, then that, else this, then that' based on the variables."
        "\n\nHere is the guidance:\n\n" + guideline_text
    )
    return send_to_chatgpt(prompt)

def step_3_generate_html(guideline_text, variables):
    """
    Step 3: Generate the HTML code for the guideline where the user can interact with the variables.
    """
    prompt = (
        "Using the following variables:\n" + variables + "\n"
        "Re-write the guideline as an HTML code."
        "Display the variables on the left side of the screen so that the user can change them."
        "On the right side, display the clinical advice initially in grey, italicized font."
        "When the user selects a variable, update the clinical advice in black, non-italicized text."
        "Return only the HTML code in text format."
        "\n\nHere is the guidance:\n\n" + guideline_text
    )
    return send_to_chatgpt(prompt)

def generate_algo_for_guidance(guidance_folder):
    """
    Main function to generate algorithms for all guidance PDF files in the specified folder.
    """
    # Check if the guidance folder exists
    if not os.path.isdir(guidance_folder):
        logging.error(f"Directory {guidance_folder} does not exist.")
        return

    # Iterate over each file in the guidance folder
    for file_name in os.listdir(guidance_folder):
        if file_name.endswith('.pdf'):
            # Sanitize the file name to ensure consistency
            sanitized_file_name = sanitize_filename(file_name)
            logging.debug(f"Sanitized PDF filename: {sanitized_file_name}")  # Debug: Log sanitized PDF filename
            
            # Find the matching condensed file
            condensed_txt_file = find_condensed_file(guidance_folder, sanitized_file_name)
            
            # Construct the output HTML filename
            html_file = os.path.join(ALGO_FOLDER, sanitized_file_name.replace('.pdf', '.html'))
            
            if os.path.exists(html_file):
                logging.info(f"HTML file already exists for {sanitized_file_name}, skipping generation.")
                continue
            
            if not condensed_txt_file:
                logging.warning(f"Condensed text file for '{sanitized_file_name}' not found.")
                continue

            try:
                with open(condensed_txt_file, 'r') as txt_file:
                    condensed_text = txt_file.read()

                # Step 1: Extract variables
                variables = step_1_extract_variables(condensed_text)
                if not variables:
                    logging.error(f"Failed to extract variables for {sanitized_file_name}")
                    continue

                # Step 2: Rewrite guideline with if/else statements
                rewritten_guideline = step_2_rewrite_guideline_with_if_else(condensed_text, variables)
                if not rewritten_guideline:
                    logging.error(f"Failed to rewrite guideline for {sanitized_file_name}")
                    continue

                # Step 3: Generate HTML with variables on the left and advice on the right
                generated_html = step_3_generate_html(rewritten_guideline, variables)
                if not generated_html:
                    logging.error(f"Failed to generate HTML for {sanitized_file_name}")
                    continue

                # Save the generated HTML to a file
                with open(html_file, 'w') as html_output_file:
                    html_output_file.write(generated_html)
                logging.info(f"Successfully generated and saved HTML for {sanitized_file_name}")

            except Exception as e:
                logging.error(f"Error processing {sanitized_file_name}: {e}")

    logging.info("Finished processing all files in the guidance folder.")

def main():
    """
    Entry point for the script.
    """
    guidance_folder = 'guidance'

    # Ensure the output folder for algorithms exists
    os.makedirs(ALGO_FOLDER, exist_ok=True)

    # Generate the algorithm for each guidance document in the folder
    generate_algo_for_guidance(guidance_folder)

if __name__ == "__main__":
    # Set logging to debug level
    logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')
    main()
