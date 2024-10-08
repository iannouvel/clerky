import os  # Provides functions for interacting with the operating system
import json  # Used for handling JSON data
import requests  # Used for making HTTP requests
import logging  # Used for logging messages for debugging and tracking purposes
from PyPDF2 import PdfReader  # For reading and extracting text from PDFs
import tiktoken  # Token counting utility for OpenAI's GPT models
import openai  # OpenAI's API for interacting with language models

# Constants for file names and paths
SIGNIFICANT_TERMS_FILE = 'significant_terms.json'  # JSON file to store significant terms
SIGNIFICANT_TERMS_FILE_SUFFIX = '- significant terms.txt'  # Suffix for individual terms files
SUMMARY_FOLDER = 'clerky/guidance/summary/'  # Directory for saving summaries

# Load OpenAI API credentials from environment variables
def load_credentials():
    openai_api_key = os.getenv('OPENAI_API_KEY')  # Fetches API key from environment
    if not openai_api_key:  # Checks if the API key is missing
        raise ValueError("OpenAI API key not found. Ensure the OPENAI_API_KEY environment variable is set.")  # Raises error if key is not found
    return openai_api_key  # Returns the API key

# Function to extract text from a PDF file
def extract_text_from_pdf(file_path):
    try:
        reader = PdfReader(file_path)  # Initializes PDF reader
        text = "".join([page.extract_text() for page in reader.pages])  # Extracts text from each page and concatenates it
        logging.info(f"Extracted text length: {len(text)} characters")  # Logs the length of extracted text
        return text  # Returns extracted text
    except Exception as e:  # Handles any errors that occur
        logging.error(f"Error reading PDF {file_path}: {e}")  # Logs the error
        return ""  # Returns an empty string if an error occurs

# Function to split text into smaller chunks based on token count
def split_text_into_chunks(text, max_tokens=4000):
    encoding = tiktoken.encoding_for_model("gpt-3.5-turbo")  # Gets the encoding for the GPT model
    tokens = encoding.encode(text)  # Encodes the text into tokens
    chunks = [encoding.decode(tokens[i:i + max_tokens]) for i in range(0, len(tokens), max_tokens)]  # Splits tokens into chunks
    logging.info(f"Text split into {len(chunks)} chunks.")  # Logs the number of chunks
    return chunks  # Returns the list of text chunks

# Function to condense a chunk of text using OpenAI's API
def condense_chunk(chunk):
    openai_api_key = load_credentials()  # Loads API credentials
    # Creates a prompt with instructions for condensing clinical text
    prompt = (
        "With the attached text from a clinical guideline, "
        "please return a condensed version of the text which removes clinically insignificant text, "
        "please remove all the scientific references, if there are any, at the end of the text as they do not need to be in the condensed output, "
        "please do not change the clinically significant text at all.\n\n"
        f"{chunk}"
    )
    
    encoding = tiktoken.encoding_for_model("gpt-3.5-turbo")  # Gets encoding for token counting
    token_count = len(encoding.encode(prompt))  # Counts the number of tokens in the prompt
    logging.debug(f"Condense chunk prompt length: {token_count} tokens")  # Logs token count of the prompt

    if token_count > 6000:  # If token count exceeds the limit
        logging.warning("Token count for condense_chunk exceeds the maximum allowed limit. Adjusting the chunk size.")  # Logs a warning
        return None  # Returns None, skipping further processing
    
    # Defines the body of the request to OpenAI's API
    body = {
        "model": "gpt-3.5-turbo",
        "messages": [{"role": "user", "content": prompt}],  # User's request to the model
        "max_tokens": 1000,  # Limit of the number of tokens in the response
        "temperature": 0.5  # Controls randomness of the output
    }

    # Makes a POST request to the OpenAI API
    response = requests.post(
        'https://api.openai.com/v1/chat/completions',
        headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {openai_api_key}'},  # Authentication header
        data=json.dumps(body)  # Converts the body to JSON format
    )

    # Checks if the API request was successful
    if response.status_code != 200:  # If the request failed
        raise Exception(f"OpenAI API error: {response.json().get('error')}")  # Raises an error with the API response message

    # Returns the condensed text from the API response
    return response.json()['choices'][0]['message']['content']

# Function to condense clinically significant text from a large input
def condense_clinically_significant_text(text, max_chunk_tokens=4000):
    chunks = split_text_into_chunks(text, max_chunk_tokens)  # Splits text into chunks
    condensed_texts = []  # List to store condensed text chunks

    # Loops through each chunk of text
    for chunk in chunks:
        try:
            condensed_chunk = condense_chunk(chunk)  # Condenses the current chunk
            condensed_texts.append(condensed_chunk)  # Adds the condensed chunk to the list
        except Exception as e:  # If an error occurs during condensing
            logging.error(f"Error while processing chunk: {e}")  # Logs the error
            continue  # Skips to the next chunk

    # Joins all condensed chunks into a single text and returns it
    return "\n\n".join(condensed_texts)

# Function to extract significant terms from the text
def extract_significant_terms(text):
    openai_api_key = load_credentials()  # Loads API credentials
    # Creates a prompt with instructions for extracting significant terms
    prompt = (
        "From the following clinical guideline text, extract the most clinically significant terms "
        "and keywords that are critical for understanding the guidance:\n\n"
        f"{text}"
    )
    
    encoding = tiktoken.encoding_for_model("gpt-3.5-turbo")  # Gets encoding for token counting
    token_count = len(encoding.encode(prompt))  # Counts the number of tokens in the prompt

    if token_count > 6000:  # If token count exceeds the limit
        logging.warning("Token count for extract_significant_terms exceeds the maximum allowed limit. Adjusting the chunk size.")  # Logs a warning
        return None  # Returns None, skipping further processing

    logging.debug(f"Extract significant terms prompt length: {token_count} tokens")  # Logs token count

    # Defines the body of the request to OpenAI's API
    body = {
        "model": "gpt-3.5-turbo",
        "messages": [{"role": "user", "content": prompt}],  # User's request to the model
        "max_tokens": 500,  # Limit of the number of tokens in the response
        "temperature": 0.5  # Controls randomness of the output
    }

    # Makes a POST request to the OpenAI API
    response = requests.post(
        'https://api.openai.com/v1/chat/completions',
        headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {openai_api_key}'},  # Authentication header
        data=json.dumps(body)  # Converts the body to JSON format
    )

    # Checks if the API request was successful
    if response.status_code != 200:  # If the request failed
        raise Exception(f"OpenAI API error: {response.json().get('error')}")  # Raises an error with the API response message

    # Returns the extracted significant terms from the API response
    return response.json()['choices'][0]['message']['content']

# Function to compile significant terms from multiple files into a JSON file
def compile_significant_terms(directory):
    significant_terms_dict = {}  # Dictionary to store significant terms by file name

    # Loops through all files in the directory
    for file_name in os.listdir(directory):
        if file_name.endswith('.pdf'):  # Processes only PDF files
            terms_file = os.path.join(directory, f"{file_name}{SIGNIFICANT_TERMS_FILE_SUFFIX}")  # Path for significant terms file
            if os.path.exists(terms_file):  # If the terms file already exists
                with open(terms_file, 'r') as file:
                    significant_terms_dict[file_name] = file.read()  # Reads and stores the terms from the file

    # Saves the significant terms dictionary to a JSON file
    with open(SIGNIFICANT_TERMS_FILE, 'w') as json_file:
        json.dump(significant_terms_dict, json_file, indent=4)  # Writes the dictionary to the JSON file

    logging.info(f"Significant terms compiled into {SIGNIFICANT_TERMS_FILE}")  # Logs that the terms were compiled

# Function to process one new file in a directory (for extracting text, condensing, and extracting terms)
def process_one_new_file(directory):
    if not os.path.isdir(directory):  # Checks if the given directory exists
        logging.error(f"Directory {directory} does not exist.")  # Logs an error if the directory is missing
        return False  # Returns False if directory is invalid

    # Loops through all files in the directory
    for file_name in os.listdir(directory):
        if file_name.endswith('.pdf'):  # Processes only PDF files
            output_condensed_file_path = os.path.join(directory, f"{file_name} - condensed.txt")  # Path for the condensed output file
            output_terms_file_path = os.path.join(directory, f"{file_name}{SIGNIFICANT_TERMS_FILE_SUFFIX}")  # Path for the significant terms file

            # Skip files that have already been processed
            if os.path.exists(output_condensed_file_path) and os.path.exists(output_terms_file_path):
                continue  # Skip already processed files

            file_path = os.path.join(directory, file_name)  # Full path of the current PDF file
            logging.info(f"Processing new file: {file_name}")  # Logs the file being processed

            extracted_text = extract_text_from_pdf(file_path)  # Extracts text from the PDF
            if not extracted_text:  # If no text was extracted
                logging.warning(f"No text extracted from {file_name}")  # Logs a warning
                continue  # Skips to the next file

            try:
                condensed_text = condense_clinically_significant_text(extracted_text)  # Condenses the extracted text

                # Saves the condensed text to a file
                with open(output_condensed_file_path, 'w') as output_file:
                    output_file.write(condensed_text)

                logging.info(f"Condensed text written to: {output_condensed_file_path}")  # Logs success in saving condensed text

#                significant_terms = extract_significant_terms(condensed_text)  # Extracts significant terms from the condensed text
#
#                # Saves the significant terms to a file
#                with open(output_terms_file_path, 'w') as terms_file:
#                    terms_file.write(significant_terms)
#
#                logging.info(f"Significant terms written to: {output_terms_file_path}")  # Logs success in saving significant terms
#
#                # Compiles the significant terms into the main JSON file
#                compile_significant_terms(directory)
#
                return True  # Returns True indicating that a file was successfully processed

            except Exception as e:  # Catches any errors that occur during processing
                logging.error(f"Error while processing {file_name}: {e}")  # Logs the error
                return False  # Returns False if an error occurred

    logging.info("No new files to process.")  # Logs if no new files were found to process
    return False  # Returns False if no new files were processed

# Function to generate a summary of the text
def generate_summary(text, word_limit=100):
    openai_api_key = load_credentials()  # Loads API credentials
    openai.api_key = openai_api_key  # Sets the OpenAI API key for the OpenAI library
    
    try:
        # Makes a request to the OpenAI API to summarize the text
        response = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",  # Specifies the GPT model to use
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},  # Sets the role of the assistant
                {"role": "user", "content": f"Summarize the following text in {word_limit} words: {text}"}  # User's request for summarization
            ]
        )
        summary = response['choices'][0]['message']['content']  # Extracts the summary from the API response
        logging.info(f"Generated summary: {summary[:50]}...")  # Logs the first 50 characters of the summary
        return summary  # Returns the generated summary
    except Exception as e:  # Catches any errors that occur during the API call
        logging.error(f"Error generating summary: {e}")  # Logs the error
        return ""  # Returns an empty string if an error occurs

# Function to save the summary to a file
def save_summary(summary, filename):
    os.makedirs(SUMMARY_FOLDER, exist_ok=True)  # Creates the summary folder if it doesn't exist
    file_path = os.path.join(SUMMARY_FOLDER, filename)  # Defines the full path for saving the summary
    
    try:
        with open(file_path, 'w') as file:  # Opens the file for writing
            file.write(summary)  # Writes the summary to the file
        logging.info(f"Summary saved at: {file_path}")  # Logs success in saving the summary
    except Exception as e:  # Catches any errors that occur while saving
        logging.error(f"Error saving summary: {e}")  # Logs the error

# Function to process multiple guidelines and generate summaries for each
def process_guidelines_for_summary(guideline_texts):
    for i, guideline_text in enumerate(guideline_texts):  # Loops through each guideline text
        summary = generate_summary(guideline_text)  # Generates a summary for the current guideline
        filename = f'guideline_{i+1}_summary.txt'  # Defines the filename for the summary
        save_summary(summary, filename)  # Saves the summary to the specified file

# Main entry point of the script
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)  # Configures logging to display INFO-level messages
    guidance_dir = 'guidance'  # Specifies the directory containing guidance files
    processed = process_one_new_file(guidance_dir)  # Processes one new file from the directory
    if processed:  # If a file was successfully processed
        logging.info("Successfully processed one new file. Exiting.")  # Logs success
    else:  # If no file was processed
        logging.info("No new files processed. Exiting.")  # Logs no new files found
