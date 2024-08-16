import os
import openai

# Set up your OpenAI API key
openai.api_key = 'your_openai_api_key'

def send_to_chatgpt(guideline_text):
    # Construct the prompt
    prompt = (
        "With the attached guideline, re-write it as HTML code where the user selects "
        "the variables that will determine the clinical advice. Use dropdowns, "
        "radio-buttons, etc., where required, and include a 'tooltip' that provides "
        "the verbatim guidance from the guideline.\n\n"
        "Guideline:\n" + guideline_text
    )

    # Send the prompt to ChatGPT
    try:
        response = openai.Completion.create(
            engine="text-davinci-003",  # or the appropriate engine
            prompt=prompt,
            max_tokens=2000,
            temperature=0.7
        )
        return response['choices'][0]['text']
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
