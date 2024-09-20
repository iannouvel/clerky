import os
import requests
import logging
import re

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
            return response.json()["choices"][0]["message"]["content"]
        else:
            logging.error(f"OpenAI API error: {response.status_code} {response.text}")
            return None
    except Exception as e:
        logging.error(f"Error in send_to_chatgpt: {e}")
        return None

def step_1_rewrite_guideline_with_if_else(condensed_text):
    """
    Rewrite the guideline with the appropriate conditions, removing excess text.
    """
    prompt = (
    "Rewrite the attached guideline based on the following rules:"
    "1. Remove all text that does not provide clinically informative guidance."
    "2. Rewrite all text that provides clinically informative guidance in the following format: Condition applicable to the information first, followed by a colon:"
    "Here is an example of how I'd like the guideline text rewritten: "
    "Original text:"
    "Encourage women to have continuous support during labour as this can reduce the need for assisted vaginal birth. " 
    "Inform women that epidural analgesia may increase the need for assisted vaginal birth although this is less likely with newer analgesic techniques. [New 2020" 
    "Inform women that administering epidural analgesia in the latent phase of labour compared to the active phase of labour does not increase the risk of assisted vaginal birth. [New 2020]"
    "Encourage women not using epidural analgesia to adopt upright or lateral positions in the second stage of labour as this reduces the need for assisted vaginal birth. "
    "Encourage women using epidural analgesia to adopt lying down lateral positions rather than upright positions in the second stage of labour as this increases the rate of spontaneous vaginal birth. [New 2020]" 
    "Recommend delayed pushing for 1–2 hours in nulliparous women with epidural analgesia as this may reduce the need for rotational and midpelvic assisted vaginal birth. "
    "Do not routinely discontinue epidural analgesia during pushing as this increases the woman’s pain with no evidence of a reduction in the incidence of assisted vaginal birth. [New 2020]"
    "Encourage women to have continuous support during labour as this can reduce the need for assisted vaginal birth."
    "Rewritten text: " 
    "For all: encourage women to have continuous support during labour as this can reduce the need for assisted vaginal birth."
    "For all: inform women that epidural analgesia may increase the need for assisted vaginal birth although this is less likely with newer analgesic techniques. [New 2020] "
    "For all: inform women that administering epidural analgesia in the latent phase of labour compared to the active phase of labour does not increase the risk of assisted vaginal birth. [New 2020]"
    "For women not using epidural analgesia: encourage the patient  to adopt upright or lateral positions in the second stage of labour as this reduces the need for assisted vaginal birth. "
    "For women using epidural analgesia: encourage the patient to adopt lying down lateral positions rather than upright positions in the second stage of labour as this increases the rate of spontaneous vaginal birth. [New 2020]" 
    "For nulliparous women with epidural analgesia: recommend delayed pushing for 1–2 hours as this may reduce the need for rotational and midpelvic assisted vaginal birth. "
    "For women with epidural analgesia: do not routinely discontinue epidural analgesia during pushing as this increases the woman’s pain with no evidence of a reduction in the incidence of assisted vaginal birth. [New 2020]"
    "\n\nHere is the guidance:\n\n" + condensed_text
    
    return send_to_chatgpt(prompt)
    
def step_2_extract_variables(condensed_text):
    prompt = (
        "Here follows a clinical guideline rewritten such that each piece of advice is prefaced with a condition, ie 'For all' or 'For women with' and then a specific condition. "
        "Please return to the user a list of the variables to the user and the associated options. "
        "The user will need to know what type of variable it is. "
        "For example, if the text says: 'For patients under 40', then the variable will be 'Age of patient' and the options should be '<40' and '>= 40'. "
        "For another example, if the text says: 'For patients using epidural analgesia', then the variable will be a boolean for 'Using epidural analgesia' with 'true/false' as the options. "
        f"\n\nHere is the text:\n\n{condensed_text}"
    )
    return send_to_chatgpt(prompt)

def step_3_generate_html(rewritten_guideline, variables):
    prompt = (
        "Using the attached text and list of variables: "
        "Re-write the text as HTML. "
        "The displayed html should be a page divided in two with a line going down the middle. "
        "The left side should be titled 'Clinical Variables'. "
        "The right side should be titled 'Advice'. "
        "Display the variables on the left side of the screen so that the user can change them, using features such as radio buttons and drop-downs, etc... "
        "Pre-select all the variables on the left with the most common or likely variable within the set of variables. "
        "When the user changes a variable, the clinical advice should dynamically update. "
        "Return only the HTML code in text format. "
        f"\n\nHere is the guidance:\n\n{rewritten_guideline}"
        f"\n\nHere are the variables:\n\n{variables}"
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
    
