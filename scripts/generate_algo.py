import os
import requests
import logging
import re

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
    
    ### this prints the name of the file being searched for ###
    #print(f"Debug: Searching for pattern: {pattern}")  # Debug output
    
    for file in os.listdir(guidance_folder):
        if file.lower().endswith('condensed.txt'):
            
            ### this prints the name of the condensed file being used ###
            #print(f"Debug: Checking file: {file}")  # Debug output
            
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
            logging.info(f"ChatGPT Response:\n{content}")  # Add this line
            return content
        else:
            logging.error(f"OpenAI API error: {response.status_code} {response.text}")
            return None
    except Exception as e:
        logging.error(f"Error in send_to_chatgpt: {e}")
        return None

def step_1_rewrite_guideline_with_if_else(condensed_text):
    logging.info("Starting Step 1: Rewrite guideline with if/else")
    prompt = (
        "Rewrite the entire attached clinical guideline as a series of if-then-elseif-then-else statements. "
        "Follow these rules strictly:\n"
        "1. Use programming-like syntax (if, else if, else) for all clinical advice and guidance.\n"
        "2. Ignore any information that does not provide specific clinical advice or guidance.\n"
        "3. Each statement should start with a condition (if or else if) followed by the corresponding advice.\n"
        "4. Use 'else' for default advice when no specific conditions are met.\n"
        "5. Nest conditions when necessary to represent complex decision trees.\n"
        "6. Use clear, consistent variable names for patient characteristics or clinical findings.\n\n"
        "Example format:\n"
        "if (patient_age < 40 and symptoms_severe):\n"
        "    Recommend treatment A\n"
        "else if (patient_age >= 40 and symptoms_moderate):\n"
        "    Recommend treatment B\n"
        "else:\n"
        "    Recommend standard care\n\n"
        "Here is the guideline to rewrite:\n\n" + condensed_text
    )
    return send_to_chatgpt(prompt)
    
def step_2_extract_variables(rewritten_guideline):
    logging.info("Starting Step 2: Extract variables")
    prompt = (
        "From the following if-then-else structured clinical guideline, extract all variables and their possible values. "
        "Return the result as a JSON array where each object represents a variable with its name and possible values. "
        "Follow these rules:\n"
        "1. Identify all variables used in if/else conditions.\n"
        "2. Determine the possible values for each variable from the conditions.\n"
        "3. For numerical variables, specify the range or threshold used.\n"
        "4. For categorical variables, list all possible categories mentioned.\n"
        "5. For boolean variables, use true/false as values.\n\n"
        "Example format:\n"
        "[\n"
        "  {\n"
        "    \"name\": \"patient_age\",\n"
        "    \"type\": \"numeric\",\n"
        "    \"values\": [\"<40\", \">=40\"]\n"
        "  },\n"
        "  {\n"
        "    \"name\": \"symptoms_severity\",\n"
        "    \"type\": \"categorical\",\n"
        "    \"values\": [\"mild\", \"moderate\", \"severe\"]\n"
        "  }\n"
        "]\n\n"
        "Here is the rewritten guideline:\n\n" + rewritten_guideline
    )
    return send_to_chatgpt(prompt)
    
def step_3_generate_html(rewritten_guideline, variables):
    logging.info("Starting Step 3: Generate HTML")
    prompt = (
        "Create an interactive HTML page that renders the clinical guideline based on user inputs. "
        "Use the following information and follow these rules strictly:\n"
        "1. Create a two-column layout: variables on the left, advice on the right.\n"
        "2. Use the provided variables to create appropriate input controls (radio buttons, checkboxes, or dropdowns).\n"
        "3. Implement JavaScript to update the advice in real-time as the user changes inputs.\n"
        "4. Ensure the logic in your JavaScript accurately reflects the if-then-else structure of the rewritten guideline.\n"
        "5. Use clear, readable formatting for both the input controls and the displayed advice.\n"
        "6. Make the page responsive and user-friendly.\n"
        "7. Include only the HTML, CSS, and JavaScript needed for this specific guideline.\n\n"
        "Rewritten guideline:\n" + rewritten_guideline + "\n\n"
        "Variables:\n" + variables + "\n\n"
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
                    
                # Step 1: Rewrite guideline with if/else statements
                rewritten_guideline = step_1_rewrite_guideline_with_if_else(condensed_text)
                if not rewritten_guideline:
                    print(f"Failed to rewrite guideline for {file_name}")
                    continue

                # Step 2: Extract variables
                variables = step_2_extract_variables(rewritten_guideline)
                if not variables:
                    print(f"Failed to extract variables for {file_name}")
                    continue

                # Step 3: Generate HTML with variables on the left and advice on the right
                generated_html = step_3_generate_html(rewritten_guideline, variables)
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
    
