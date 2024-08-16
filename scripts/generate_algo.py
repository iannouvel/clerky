
import os
import json
import requests

def load_credentials():
    openai_api_key = os.getenv('OPENAI_API_KEY')
    if not openai_api_key:
        raise ValueError("OpenAI API key not found. Ensure the OPENAI_API_KEY environment variable is set.")
    return openai_api_key

def send_to_chatgpt(guideline_text):
    openai_api_key = load_credentials()
    
    # Prepare the prompt
    prompt = (
        "Please generate an algorithm (in HTML format) based on the following clinical guidance. "
        "The algorithm should be presented in a clear and concise manner, using HTML to represent the structure. "
        "Focus on summarizing the key steps or decision points clearly. Here is the guidance:

"
        + guideline_text
    )

    # Prepare the body for the OpenAI API request
    body = {
        "model": "gpt-4",
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "max_tokens": 2000,
        "temperature": 0.7
    }

    try:
        # Send the POST request to the OpenAI API
        response = requests.post(
            'https://api.openai.com/v1/chat/completions',
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {openai_api_key}'
            },
            data=json.dumps(body)
        )
        
        # Handle errors
        if response.status_code != 200:
            error_details = response.json()
            raise Exception(f"OpenAI API error: {error_details.get('error', {}).get('message', 'Unknown error')}")
        
        # Extract and return the generated HTML
        generated_html = response.json()['choices'][0]['message']['content']
        return generated_html
    except Exception as e:
        print(f"Error communicating with OpenAI: {e}")
        return None

def generate_algo_for_guidance(guidance_folder, algo_folder):
    for file_name in os.listdir(guidance_folder):
        if file_name.endswith('.txt'):
            # Get the base name without extension
            base_name = os.path.splitext(file_name)[0]
            html_file = f"{algo_folder}/{base_name}.html"

            # Check if the corresponding HTML file exists
            if not os.path.exists(html_file):
                # Read the guidance text
                with open(os.path.join(guidance_folder, file_name), 'r') as f:
                    guidance_text = f.read()

                # Generate HTML using ChatGPT
                print(f"Generating algo for: {file_name}")
                generated_html = send_to_chatgpt(guidance_text)

                if generated_html:
                    # Save the generated HTML
                    with open(html_file, 'w') as html_file_obj:
                        html_file_obj.write(generated_html)
                    print(f"Generated and saved: {html_file}")
                else:
                    print(f"Failed to generate algo for: {file_name}")

if __name__ == "__main__":
    guidance_folder = "./guidance"  # Adjust this path to your guidance folder
    algo_folder = "./guidance/algo"  # Path to algo folder

    # Ensure the algo folder exists
    os.makedirs(algo_folder, exist_ok=True)

    # Generate algos for all guidance files
    generate_algo_for_guidance(guidance_folder, algo_folder)
