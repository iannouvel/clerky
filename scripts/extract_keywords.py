import os
import nltk
from nltk.corpus import stopwords
from nltk.tokenize import word_tokenize
from collections import Counter
import traceback

try:
    # Ensure that nltk data is downloaded
    nltk.download('punkt')
    nltk.download('stopwords')

    def extract_keywords(text):
        stop_words = set(stopwords.words('english'))
        words = word_tokenize(text)
        words = [word.lower() for word in words if word.isalpha()]
        filtered_words = [word for word in words if word not in stop_words]
        return Counter(filtered_words).most_common(10)

    guidance_folder = 'guidance'
    keywords_file = 'keywords.txt'

    # Listing new files in the guidance folder
    new_files = [f for f in os.listdir(guidance_folder) if os.path.isfile(os.path.join(guidance_folder, f))]
    with open(keywords_file, 'a') as kf:
        for filename in new_files:
            with open(os.path.join(guidance_folder, filename), 'r') as f:
                text = f.read()
                keywords = extract_keywords(text)
                kf.write(f"{filename}: {', '.join([word for word, count in keywords])}\n")

except Exception as e:
    print("An error occurred:", str(e))
    traceback.print_exc()  # Print the stack trace
    exit(1)  # Exit with a specific error code if needed