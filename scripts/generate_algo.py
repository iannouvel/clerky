import os
import json
import requests
import logging
import re
from bs4 import BeautifulSoup

ALGO_FOLDER = 'algos'
MAX_RETRIES = 3

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
    print(f"Debug: Searching for pattern: {pattern}")  # Debug output
    
    for file in os.listdir(guidance_folder):
        if file.lower().endswith('condensed.txt'):
            print(f"Debug: Checking file: {file}")  # Debug output
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
            data=json.dumps(body)
        )

        if response.status_code != 200:
            error_details = response.json()
            raise Exception(f"OpenAI API error: {error_details.get('error', {}).get('message', 'Unknown error')}")

        generated_text = response.json()['choices'][0]['message']['content']
        return generated_text
    except Exception as e:
        print(f"Error while generating response: {e}")
        return None

def step_1_extract_variables(guideline_text):
    """
    Step 1: Extract the variables and options from the clinical guideline.
    """
    prompt = (
        "The attached text is a clinical guideline. "
        "Identify all the variables that apply to decision-making or advice regarding clinical care. "
        "Return the list of variables and the potential values for each in the following format: "
        "variable 1: option 1, option 2; variable 2: option 1, option 2; etc... "
        "For variables with a range of numeric values, specify the range. "
        "\n\nHere is the guidance:\n\n" + guideline_text
    )
    return send_to_chatgpt(prompt)

def step_2_rewrite_guideline_with_if_else(guideline_text, variables):
    """
    Step 2: Re-write the guideline using if/else statements based on the variables extracted in Step 1.
    """
    prompt = (
        "Using the following variables:\n" + variables + "\n"
        "Re-write the guideline, removing all sentences or phrases that have no clinical advice. "
        "Rewrite the remaining sentences as 'if this, then that, else this, then that' based on the variables. "
        "Each piece of advice should be on a new line and start with 'ADVICE: '. "
        "\n\nHere is the guidance:\n\n" + guideline_text
    )
    return send_to_chatgpt(prompt)

def generate_variables_html(variables):
    """
    Generate HTML for the variables section.
    """
    prompt = f"""
    Given the following variables and their options: {variables}
    
    Generate HTML code for input elements to represent these variables. Follow these rules:
    1. Use radio buttons for variables with 2-3 mutually exclusive options.
    2. Use checkboxes for variables where multiple options can be selected.
    3. Use dropdown menus for variables with more than 3 options.
    4. Use number input for numeric ranges, with min and max attributes.
    5. Each input should have a unique id that matches its variable name.
    6. Wrap each variable in a div with class "variable".
    
    Return only the HTML code for the variables section.
    """
    return send_to_chatgpt(prompt)

def generate_advice_html(rewritten_guideline):
    """
    Generate HTML for the advice section.
    """
    prompt = f"""
    Given the following rewritten guideline with if/else statements:
    {rewritten_guideline}
    
    Generate HTML code for the advice section. Follow these rules:
    1. Each piece of advice (starting with 'ADVICE: ') should be in its own paragraph.
    2. Each paragraph should have a class "advice" and data attributes linking it to relevant variables.
    3. Use the format data-var="variable:value" for the data attributes.
    
    Return only the HTML code for the advice section.
    """
    return send_to_chatgpt(prompt)

def generate_update_advice_function():
    """
    Generate JavaScript function to update advice based on selected variables.
    """
    prompt = """
    Generate a JavaScript function named updateAdvice that does the following:
    1. It should be called whenever a variable input changes.
    2. It should hide all advice paragraphs by default.
    3. It should check the current values of all variables.
    4. It should show only the advice paragraphs that match the current variable values.
    5. It should add the class "active" to shown paragraphs and remove it from hidden ones.
    
    Return only the JavaScript code for this function.
    """
    return send_to_chatgpt(prompt)

def post_process_html(variables_html, advice_html, update_advice_function):
    """
    Combine the generated HTML parts and post-process to ensure validity.
    """
    html_template = """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Clinical Guideline</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 0; display: flex; }
            #variables { width: 30%; padding: 20px; background-color: #f0f0f0; }
            #advice { width: 70%; padding: 20px; }
            .variable { margin-bottom: 10px; }
            .advice { color: #888; font-style: italic; }
            .active { color: #000; font-style: normal; }
        </style>
    </head>
    <body>
        <div id="variables">
            <h2>Variables</h2>
            {variables_html}
        </div>
        <div id="advice">
            <h2>Clinical Advice</h2>
            {advice_html}
        </div>
        <script>
            {update_advice_function}
            // Add event listeners to all inputs
            document.querySelectorAll('#variables input, #variables select').forEach(input => {
                input.addEventListener('change', () => updateAdvice());
            });
            // Initial call to set up the advice
            updateAdvice();
        </script>
    </body>
    </html>
    """
    
    # Use BeautifulSoup to parse and clean up the HTML
    soup = BeautifulSoup(html_template.format(
        variables_html=variables_html,
        advice_html=advice_html,
        update_advice_function=update_advice_function
    ), 'html.parser')
    
    # Additional post-processing steps can be added here
    
    return soup.prettify()

def step_3_generate_html(guideline_text, variables, rewritten_guideline):
    """
    Step 3: Generate the HTML code for the guideline where the user can interact with the variables.
    """
    for _ in range(MAX_RETRIES):
        try:
            variables_html = generate_variables_html(variables)
            advice_html = generate_advice_html(rewritten_guideline)
            update_advice_function = generate_update_advice_function()
            
            final_html = post_process_html(variables_html, advice_html, update_advice_function)
            
            # Validate HTML structure (you may want to add more checks)
            if all(tag in final_html for tag in ['<!DOCTYPE html>', '<html', '<head', '<body', '<script']):
                return final_html
            else:
                raise ValueError("Generated HTML is missing crucial elements")
        except Exception as e:
            print(f"Error in HTML generation: {e}. Retrying...")
    
    print("Failed to generate valid HTML after maximum retries")
    return None

def generate_algo_for_guidance(guidance_folder):
    """
    Main function to generate algorithms for all guidance PDF files in the specified folder.
    """
    # Check if the guidance folder exists
    if not os.path.isdir(guidance_folder):
        print(f"Directory {guidance_folder} does not exist.")
        return

    # Iterate over each file in the guidance folder
    for file_name in os.listdir(guidance_folder):
        if file_name.endswith('.pdf'):
            
            # Find the matching condensed file
            condensed_txt_file = find_condensed_file(guidance_folder, file_name)
            
            # Construct the output HTML filename
            html_file = os.path.join(ALGO_FOLDER, file_name.replace('.pdf', '.html'))
            
            if os.path.exists(html_file):
                print(f"HTML file already exists for {file_name}, skipping generation.")
                continue
            
            if not condensed_txt_file:
                print(f"Condensed text file for '{file_name}' not found.")
                continue

            try:
                with open(condensed_txt_file, 'r') as txt_file:
                    condensed_text = txt_file.read()

                # Step 1: Extract variables
                variables = step_1_extract_variables(condensed_text)
                if not variables:
                    print(f"Failed to extract variables for {file_name}")
                    continue

                # Step 2: Rewrite guideline with if/else statements
                rewritten_guideline = step_2_rewrite_guideline_with_if_else(condensed_text, variables)
                if not rewritten_guideline:
                    print(f"Failed to rewrite guideline for {file_name}")
                    continue

                # Step 3: Generate HTML with variables on the left and advice on the right
                generated_html = step_3_generate_html(condensed_text, variables, rewritten_guideline)
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
    """
    Entry point for the script.
    """
    guidance_folder = 'guidance'

    # Ensure the output folder for algorithms exists
    os.makedirs(ALGO_FOLDER, exist_ok=True)

    # Generate the algorithm for each guidance document in the folder
    generate_algo_for_guidance(guidance_folder)

if __name__ == "__main__":
    main()
