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
            json=body
        )

        if response.status_code == 200:
            return response.json()["choices"][0]["message"]["content"]
        else:
            logging.error(f"OpenAI API error: {response.status_code} {response.text}")
            return None
    except Exception as e:
        logging.error(f"Error in send_to_chatgpt: {e}")
        return None

def step_1_extract_variables(condensed_text):
    """
    Extract the clinical variables from the condensed guidance text.
    """
    # Placeholder logic to extract variables
    variables = [
        {"name": "age", "label": "Patient Age", "type": "select", "options": ["20", "25", "30", "35", "40", "45"]},
        {"name": "pregnancyWeeks", "label": "Weeks of Pregnancy", "type": "select", "options": ["8", "12", "20", "28", "36"]},
        {"name": "fetalHeartRate", "label": "Fetal Heart Rate (bpm)", "type": "number", "min": 60, "max": 200, "default": 140},
        {"name": "bleeding", "label": "Vaginal Bleeding", "type": "radio", "options": ["yes", "no"]}
    ]
    return variables

def step_2_rewrite_guideline_with_if_else(condensed_text, variables):
    """
    Rewrite the guideline using if/else statements based on the extracted variables.
    """
    # Placeholder logic for rewriting the guideline
    rewritten_guideline = {
        "conditions": [
            {"condition": 'age > 35', "text": "Advanced maternal age may require additional monitoring and screening."},
            {"condition": 'pregnancyWeeks < 12', "text": "Early pregnancy care should focus on prenatal vitamins and lifestyle factors."},
            {"condition": 'pregnancyWeeks > 28', "text": "Ensure regular monitoring for gestational diabetes and preeclampsia."},
            {"condition": 'fetalHeartRate < 110', "text": "Fetal bradycardia detected. Immediate evaluation needed."},
            {"condition": 'fetalHeartRate > 160', "text": "Fetal tachycardia detected. Review maternal health status and fetal well-being."},
            {"condition": 'bleeding == "yes"', "text": "Vaginal bleeding in pregnancy is a red flag. Perform an ultrasound and evaluate placental health."}
        ],
        "static_guidance": [
            "Perform routine screening for STIs and other infections.",
            "Ensure folic acid intake of at least 400 mcg per day.",
            "Encourage regular prenatal visits for continuous monitoring.",
            "Discuss birth plan options with the patient.",
            "Monitor blood pressure regularly for signs of preeclampsia."
        ]
    }
    return rewritten_guideline

def step_3_generate_html(condensed_text, variables, rewritten_guideline):
    """
    Generate an HTML file using the given template, displaying clinical variables on the left and advice on the right.
    """
    html_template = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Obstetrics & Gynecology Clinical Tool</title>
        <style>
            body {{
                display: flex;
                justify-content: space-between;
                font-family: Arial, sans-serif;
            }}
            .container {{
                display: flex;
                width: 100%;
                padding: 20px;
            }}
            .variables, .guidance {{
                width: 45%;
                padding: 20px;
                border: 1px solid #ccc;
                border-radius: 8px;
                background-color: #f9f9f9;
            }}
            .guidance {{
                padding-left: 30px;
                background-color: #f1f1f1;
            }}
            .variables label, .variables select, .variables input {{
                display: block;
                margin-bottom: 15px;
            }}
        </style>
        <script>
            function updateGuidance() {{
                {generate_js_guidance_logic(variables, rewritten_guideline)}
            }}

            // Automatically update guidance when the page loads
            window.onload = function() {{
                updateGuidance();
            }}
        </script>
    </head>
    <body>
        <div class="container">
            <div class="variables">
                <h2>Clinical Variables</h2>
                {generate_variable_inputs(variables)}
            </div>

            <div class="guidance">
                <h2>Clinical Guidance</h2>
                <pre id="guidanceContent">
                    <!-- Guidance will be dynamically displayed here -->
                </pre>
            </div>
        </div>
    </body>
    </html>
    """
    return html_template

def generate_variable_inputs(variables):
    """
    Generate the HTML input fields for the variables.
    """
    input_html = ""
    for var in variables:
        input_html += f'<label for="{var["name"]}">{var["label"]}:</label>'
        if var["type"] == "select":
            input_html += f'<select id="{var["name"]}" onchange="updateGuidance()">'
            for option in var["options"]:
                input_html += f'<option value="{option}">{option}</option>'
            input_html += '</select>'
        elif var["type"] == "number":
            input_html += f'<input type="number" id="{var["name"]}" min="{var["min"]}" max="{var["max"]}" value="{var["default"]}" oninput="updateGuidance()">'
        elif var["type"] == "radio":
            for option in var["options"]:
                input_html += f'<input type="radio" name="{var["name"]}" value="{option}" onchange="updateGuidance()"> {option}'
    return input_html

def generate_js_guidance_logic(variables, rewritten_guideline):
    """
    Generate the JavaScript logic to update guidance based on variables.
    """
    js_logic = "let guidanceText = [];\n"
    count = 1

    for condition in rewritten_guideline["conditions"]:
        js_logic += f'if ({condition["condition"]}) {{ guidanceText.push("{count}. {condition["text"]}"); count++; }}\n'

    # Additional static guidance
    js_logic += "\n".join([f'guidanceText.push("{count}. {guideline}"); count++;' for count, guideline in enumerate(rewritten_guideline["static_guidance"], start=count)])

    js_logic += 'document.getElementById("guidanceContent").innerText = guidanceText.join("\\n");\n'
    
    return js_logic

def generate_algo_for_guidance(guidance_folder):
    """
    Process each guidance document and generate HTML based on extracted variables and rewritten guidelines.
    """
    for file_name in os.listdir(guidance_folder):
        if file_name.endswith('.pdf'):
            print(f"Processing {file_name}...")

            condensed_txt_file = find_condensed_file(guidance_folder, file_name)
            
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
                html_file = os.path.join(ALGO_FOLDER, file_name.replace('.pdf', '.html'))
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
