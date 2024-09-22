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
    """
    Generate a more flexible pattern to match the condensed text file.
    """
    base_name = pdf_filename.replace('.pdf', '')
    # Remove special characters and extra spaces
    base_name_clean = re.sub(r'[^\w\s-]', '', base_name).strip()
    words = base_name_clean.split()
    # Create a pattern that matches words in any order
    pattern = r'.*'.join(map(re.escape, words)) + r'.*condensed\.txt'
    return pattern

def find_condensed_file(guidance_folder, pdf_filename):
    """
    Look for a matching condensed text file in the guidance folder using a more flexible approach.
    """
    pattern = match_condensed_filename(pdf_filename)
    for file in os.listdir(guidance_folder):
        if file.lower().endswith('condensed.txt'):
            if re.search(pattern, file, re.IGNORECASE):
                return os.path.join(guidance_folder, file)
    print(f"No match found for PDF filename: {pdf_filename}")
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

def step_1_ascertain_clinical_context(condensed_text):
    logging.info("Starting Step 1: Ascertain clinical contexts")
    prompt = (
        "From the following clinical guideline, identify all possible clinical contexts or scenarios "
        "that are relevant to the guideline. For each context, provide a brief description. "
        "Then, create a series of questions that can be asked to a user to determine which context applies to them. "
        "The questions should be clear, concise, and cover all necessary aspects to distinguish between contexts.\n\n"
        "Clinical Guideline:\n" + condensed_text
    )
    return send_to_chatgpt(prompt)

def step_2_rewrite_guidance_for_context(condensed_text, contexts):
    logging.info("Starting Step 2: Rewrite guidance for each context")
    prompt = (
        "Based on the following clinical guideline and the identified clinical contexts, rewrite the guideline as a series "
        "of paragraphs. Each paragraph should provide specific advice and guidance relevant to one context. "
        "Ensure that the advice is clear, actionable, and specific to the context.\n\n"
        "Clinical Contexts and Questions:\n" + contexts + "\n\n"
        "Clinical Guideline:\n" + condensed_text
    )
    return send_to_chatgpt(prompt)

def step_3_identify_variables(rewritten_guidance):
    logging.info("Starting Step 3: Identify and describe variables")
    prompt = (
        "From the rewritten clinical guideline, identify all variables that are relevant within each context. "
        "For each variable, provide its name, description, and possible values (e.g., ranges, categories). "
        "Return the result as a JSON array where each object represents a variable with its name, description, and possible values.\n\n"
        "Rewritten Guidance:\n" + rewritten_guidance
    )
    return send_to_chatgpt(prompt)

def step_4_generate_html(rewritten_guidance, variables, contexts):
    logging.info("Starting Step 4: Generate interactive HTML")
    prompt = (
        "Create an interactive HTML page that presents the clinical guideline to the user. "
        "The page should:\n"
        "1. First, ask the user the questions necessary to determine their clinical context.\n"
        "2. Based on the user's responses, display the specific guidance paragraphs relevant to their context.\n"
        "3. Use the identified variables to create appropriate input controls (radio buttons, checkboxes, dropdowns, etc.).\n"
        "4. Implement JavaScript to dynamically update the displayed guidance based on user inputs.\n"
        "5. Ensure the page is user-friendly, responsive, and the advice is clearly presented.\n"
        "6. Include comments in the code to explain the functionality.\n\n"
        "Rewritten Guidance:\n" + rewritten_guidance + "\n\n"
        "Variables:\n" + variables + "\n\n"
        "Context Questions and Descriptions:\n" + contexts + "\n\n"
        "Return only the complete HTML code (including embedded CSS and JavaScript) for the interactive page."
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

                # Step 1: Ascertain clinical contexts
                contexts = step_1_ascertain_clinical_context(condensed_text)
                if not contexts:
                    print(f"Failed to ascertain clinical contexts for {file_name}")
                    continue

                # Step 2: Rewrite guidance for each context
                rewritten_guidance = step_2_rewrite_guidance_for_context(condensed_text, contexts)
                if not rewritten_guidance:
                    print(f"Failed to rewrite guidance for {file_name}")
                    continue

                # Step 3: Identify variables
                variables = step_3_identify_variables(rewritten_guidance)
                if not variables:
                    print(f"Failed to identify variables for {file_name}")
                    continue

                # Step 4: Generate HTML with variables and contexts
                generated_html = step_4_generate_html(rewritten_guidance, variables, contexts)
                if not generated_html:
                    print(f"Failed to generate HTML for {file_name}")
                    continue

                # Save the generated HTML to a file
                with open(html_file, 'w') as html_output_file:
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
        # You might want to add logging here as well

if __name__ == "__main__":
    main()
