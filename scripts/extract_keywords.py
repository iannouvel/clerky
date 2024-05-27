import os
import nltk
from nltk.corpus import stopwords
from nltk.tokenize import word_tokenize
from collections import Counter
import traceback
import PyPDF2
import json

try:
    # Download NLTK data if not already downloaded
    nltk.download('punkt', quiet=True)
    nltk.download('stopwords', quiet=True)

    def extract_keywords(text):
        stop_words = set(stopwords.words('english'))
        words = word_tokenize(text)
        words = [word.lower() for word in words if word.isalpha()]
        filtered_words = [word for word in words if word not in stop_words]
        return Counter(filtered_words).most_common(10)

    guidance_folder = 'guidance'
    data_folder = 'data'
    os.makedirs(data_folder, exist_ok=True)
    keywords_file = os.path.join(data_folder, 'keywords.json')

    # Listing new files in the guidance folder
    new_files = [f for f in os.listdir(guidance_folder) if os.path.isfile(os.path.join(guidance_folder, f))]
    print(f"Found {len(new_files)} new files in the '{guidance_folder}' folder.")

    keywords_dict = {}

    for filename in new_files:
        try:
            print(f"Processing file: {filename}")
            file_path = os.path.join(guidance_folder, filename)
            if filename.endswith('.pdf'):
                with open(file_path, 'rb') as f:
                    pdf_reader = PyPDF2.PdfReader(f)
                    text = ''
                    for page_num in range(len(pdf_reader.pages)):
                        page = pdf_reader.pages[page_num]
                        text += page.extract_text()
            else:
                with open(file_path, 'r', encoding='latin-1') as f:
                    text = f.read()
            keywords = extract_keywords(text)
            if keywords:
                print(f"Extracted keywords for '{filename}'")
                keywords_dict[filename] = [word for word, count in keywords]
                print(f"Keywords for '{filename}': {', '.join([word for word, count in keywords])}")
            else:
                print(f"No keywords extracted for '{filename}'.")
        except (UnicodeDecodeError, PyPDF2.utils.PdfReadError):
            print(f"Warning: Unable to process file '{filename}'. Skipping...")

    # Writing keywords to JSON file
    with open(keywords_file, 'w', encoding='utf-8') as kf:
        json.dump(keywords_dict, kf, ensure_ascii=False, indent=4)
    print(f"Keywords written to: {keywords_file}")

except Exception as e:
    print("An error occurred:", str(e))
    traceback.print_exc()  # Print the stack trace
    exit(1)  # Exit with a specific error code if needed
