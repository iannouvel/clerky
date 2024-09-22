import os
import requests
import logging
import re
import json

ALGO_FOLDER = 'algos'
MAX_RETRIES = 3

# Set up logging
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
    print(f"No match found for PDF filename: {pdf_filename}")
    return None

def send_to_chatgpt(prompt):
    try:
        openai_api_key = load_credentials()

        body = {
            "model": "gpt-4",  # Upgrade to GPT-4 for better output
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "max_tokens": 3000,  # Increase max tokens for longer responses
            "temperature": 0.5   # Lower temperature for more focused output
        }

        response = requests.post(
            'https://api.openai.com/v1/chat/completions',
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {openai_api_key}'
            },
            json=body
        )
        if response.status_code == 200:
            content = response.json()["choices"][0]["message"]["content"]
            logging.info(f"ChatGPT Response:\n{content}")
            return content.strip()
        else:
            logging.error(f"OpenAI API error: {response.status_code} {response.text}")
            return None
    except Exception as e:
        logging.error(f"Error in send_to_chatgpt: {e}")
        return None

def step_1_extract_clinical_contexts(condensed_text):
    logging.info("Starting Step 1: Extract clinical contexts")
    prompt = (
        "From the following clinical guideline, identify all distinct clinical contexts or scenarios "
        "that the guideline addresses. For each context, provide:\n"
        "1. A unique identifier (e.g., 'context_1').\n"
        "2. A brief description of the context.\n"
        "3. Any specific questions that need to be asked to determine if a user fits into this context.\n\n"
        "Return the result as a JSON array.\n\n"
        "Clinical Guideline:\n" + condensed_text
    )
    return send_to_chatgpt(prompt)

def step_2_rewrite_guidance_by_context(condensed_text, contexts_json):
    logging.info("Starting Step 2: Rewrite guidance by context")
    prompt = (
        "Based on the following clinical guideline and the identified clinical contexts, rewrite the guideline "
        "into separate sections for each context. Each section should contain:\n"
        "1. The context identifier.\n"
        "2. A detailed guidance paragraph specific to that context.\n"
        "3. Any variables relevant within that context, along with their possible values.\n\n"
        "Return the result as a JSON object where each key is the context identifier.\n\n"
        "Clinical Contexts:\n" + contexts_json + "\n\n"
        "Clinical Guideline:\n" + condensed_text
    )
    return send_to_chatgpt(prompt)

def step_3_generate_interactive_html(contexts_json, guidance_json):
    logging.info("Starting Step 3: Generate interactive HTML")
    prompt = (
        "Create a complete, functional HTML page that interacts with the user to determine their clinical context "
        "and provides them with the appropriate guidance. The page should:\n"
        "1. Dynamically ask the user the necessary questions to determine their context, based on the 'specific questions' "
        "from the clinical contexts.\n"
        "2. Once the context is determined, display the detailed guidance paragraph specific to that context.\n"
        "3. For any variables within the guidance, provide input controls (dropdowns, checkboxes, etc.) for the user to "
        "input their information.\n"
        "4. Update the displayed guidance dynamically as the user inputs their data.\n"
        "5. Ensure that all variables and their possible values are defined and used correctly.\n"
        "6. Use appropriate input types for different questions (e.g., radio buttons for yes/no, dropdowns for multiple choices).\n"
        "7. Include all necessary HTML, CSS, and JavaScript within the page.\n\n"
        "Clinical Contexts (JSON):\n" + contexts_json + "\n\n"
        "Guidance by Context (JSON):\n" + guidance_json + "\n\n"
        "Return only the complete HTML code."
    )
    return send_to_chatgpt(prompt)

def generate_algo_for_guidance(guidance_folder):
    for file_name in os.listdir(guidance_folder):
        if file_name.endswith('.pdf'):
            html_file = os.path.join(ALGO_FOLDER, file_name.replace('.pdf', '.html'))
            if os.path.exists(html_file):
                print(f"HTML file for '{file_name}' already exists. Skipping generation.")
                continue

            condensed_txt_file = find_condensed_file(guidance_folder, file_name)

            if not condensed_txt_file:
                print(f"Condensed text file for '{file_name}' not found.")
                continue

            try:
                with open(condensed_txt_file, 'r') as txt_file:
                    condensed_text = txt_file.read()

                # Step 1: Extract clinical contexts
                contexts_json = step_1_extract_clinical_contexts(condensed_text)
                if not contexts_json:
                    print(f"Failed to extract clinical contexts for {file_name}")
                    continue

                # Parse contexts JSON
                try:
                    contexts = json.loads(contexts_json)
                except json.JSONDecodeError as e:
                    print(f"Failed to parse contexts JSON for {file_name}: {e}")
                    continue

                # Step 2: Rewrite guidance by context
                guidance_json = step_2_rewrite_guidance_by_context(condensed_text, contexts_json)
                if not guidance_json:
                    print(f"Failed to rewrite guidance for {file_name}")
                    continue

                # Parse guidance JSON
                try:
                    guidance = json.loads(guidance_json)
                except json.JSONDecodeError as e:
                    print(f"Failed to parse guidance JSON for {file_name}: {e}")
                    continue

                # Step 3: Generate interactive HTML
                generated_html = step_3_generate_interactive_html(contexts_json, guidance_json)
                if not generated_html:
                    print(f"Failed to generate HTML for {file_name}")
                    continue

                # Save the generated HTML to a file
                with open(html_file, 'w', encoding='utf-8') as html_output_file:
                    html_output_file.write(generated_html)
                print(f"Successfully generated and saved HTML for {file_name}")

            except Exception as e:
                print(f"Error processing {file_name}: {e}")

    print("Finished processing all files in the guidance folder.")

def main():
    guidance_folder = 'guidance'

    # Ensure the output folder for algorithms exists
    os.makedirs(ALGO_FOLDER, exist_ok=True)

    try:
        # Generate the algorithm for each guidance document in the folder
        generate_algo_for_guidance(guidance_folder)
    except Exception as e:
        print(f"An error occurred while processing guidance documents: {e}")

if __name__ == "__main__":
    main()
